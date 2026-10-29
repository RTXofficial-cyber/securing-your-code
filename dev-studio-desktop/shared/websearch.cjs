/**
 * Live web search for Deep mode — no API key, no account, no cost.
 *
 *   1. DuckDuckGo HTML endpoint (real titles/urls/snippets)
 *   2. Wikipedia opensearch + intro extract as a reliable fallback
 *
 * Every network call is time-boxed (8 s) and failure-soft: offline simply
 * yields `{ results: [], offline: true }` and callers degrade gracefully.
 * `setFetch()` injects a fetch implementation (used by the test suite so the
 * whole research pipeline is proven end-to-end without a network).
 */

let FETCH = null;
function setFetch(f) { FETCH = typeof f === 'function' ? f : null; }
function getFetch() {
  if (FETCH) return FETCH;
  if (typeof fetch === 'function') return fetch;
  return null;
}

const TIMEOUT_MS = 8000;

async function getText(url, headers = {}) {
  const f = getFetch();
  if (!f) return null;
  try {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
    const res = await f(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DevStudio/1.6', ...headers },
      signal: ctl ? ctl.signal : undefined
    });
    if (t) clearTimeout(t);
    if (!res || !res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/* ---------- html helpers ---------- */
function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…')
    .replace(/&lsquo;|&rsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&'); // &amp; last so &amp;mdash; decodes to literal "&mdash;"
}
function stripTags(s) { return decodeEntities(String(s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); }
function unwrapDdg(href) {
  const h = String(href || '');
  const m = /uddg=([^&]+)/.exec(h);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return h; } }
  return h.replace(/^\/\//, 'https://');
}

/* ---------- source 1: DuckDuckGo HTML ---------- */
async function searchDdg(query, max = 6) {
  const html = await getText('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query));
  if (!html) return [];
  const out = [];
  const links = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snips = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
  for (let i = 0; i < links.length && out.length < max; i += 1) {
    const url = unwrapDdg(links[i][1]);
    if (!/^https?:\/\//.test(url)) continue;
    out.push({
      title: stripTags(links[i][2]).slice(0, 160),
      url,
      snippet: (snips[i] ? stripTags(snips[i][1]) : '').slice(0, 400)
    });
  }
  return out;
}

/* ---------- source 2: Wikipedia (fallback + summaries) ---------- */
async function searchWiki(query, max = 5) {
  const j = await getText('https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=' + max + '&search=' + encodeURIComponent(query));
  if (!j) return [];
  try {
    const arr = JSON.parse(j);
    if (!Array.isArray(arr) || arr.length < 4) return [];
    return arr[1].slice(0, max).map((title, i) => ({
      title: String(title),
      url: String(arr[3][i] || ''),
      snippet: String(arr[2][i] || '')
    })).filter((r) => r.url);
  } catch { return []; }
}

async function wikiExtract(title) {
  const j = await getText('https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&redirects=1&titles=' + encodeURIComponent(title));
  if (!j) return '';
  try {
    const pages = JSON.parse(j)?.query?.pages || {};
    const first = Object.values(pages)[0];
    return String(first?.extract || '').slice(0, 900);
  } catch { return ''; }
}

/* ---------- the one call Deep mode uses ---------- */
async function deepResearch(query, opts = {}) {
  if (opts.fetchImpl) setFetch(opts.fetchImpl);
  const q = String(query || '').trim().slice(0, 200);
  if (!q) return { query: q, source: null, results: [], summary: '', offline: true };
  let results = await searchDdg(q);
  let source = 'duckduckgo';
  let summary = '';
  if (!results.length) {
    results = await searchWiki(q);
    source = results.length ? 'wikipedia' : null;
    if (results.length) summary = await wikiExtract(results[0].title);
  }
  if (opts.fetchImpl) setFetch(null); // never leave an injected fetch behind
  return { query: q, source, results, summary, offline: !results.length };
}

module.exports = { setFetch, deepResearch, searchDdg, searchWiki, wikiExtract, stripTags, unwrapDdg };
