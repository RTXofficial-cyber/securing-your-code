/**
 * AIR DEVELOPING — landing Worker (Cloudflare).
 * Zero dependencies on purpose: Workers Builds only bundles this file.
 * Serves a black & white (Claude-style) landing page with the release zip
 * download link, plus /health for honest uptime checks.
 */

const ZIP_URL =
  'https://github.com/RTXofficial-cyber/securing-your-code/raw/arena/4ce36fdf-securing-your-code/Air-Developing.zip';
const VERSION = 'v1.26.0';

const PAGE = [
  '<!doctype html>',
  '<html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>AIR DEVELOPING</title>',
  '<style>',
  ':root{color-scheme:dark}',
  'body{margin:0;background:#0e0e0e;color:#f4f3ef;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;display:grid;place-items:center;min-height:100vh}',
  'main{width:min(92vw,560px);padding:48px 0;text-align:left}',
  'h1{font-size:34px;letter-spacing:.12em;margin:0 0 6px;font-weight:600}',
  'p.sub{color:#8a887f;margin:0 0 28px;font-size:14px;line-height:1.6}',
  '.badge{display:inline-block;border:1px solid #3a3a38;border-radius:999px;padding:3px 12px;font-size:12px;color:#f4f3ef;margin-bottom:18px}',
  'a.dl{display:inline-block;background:#f4f3ef;color:#0e0e0e;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;font-size:15px}',
  'a.dl:hover{background:#ffffff}',
  'ul{color:#8a887f;font-size:13px;line-height:1.9;padding-left:18px;margin:28px 0 0}',
  'li b{color:#f4f3ef;font-weight:600}',
  'footer{margin-top:34px;color:#5c5b56;font-size:12px}',
  '</style></head><body><main>',
  '<div class="badge">' + VERSION + ' &middot; AIR BRAIN MODULE</div>',
  '<h1>AIR DEVELOPING</h1>',
  '<p class="sub">Windows desktop app for developing massive software.<br>Built-in offline AI <b style="color:#f4f3ef">Air_you</b> &mdash; 7-region brain (PERCEIVE &rarr; RECALL &rarr; PLAN &rarr; REASON &rarr; ACT &rarr; VERIFY &rarr; LEARN), Claude / ChatGPT / Perplexity / Gemini / Groq connectors, real terminal, Game Studio.</p>',
  '<a class="dl" href="' + ZIP_URL + '">Download Air-Developing.zip</a>',
  '<ul>',
  '<li><b>v1.26</b> &mdash; Air Brain Module: live knowledge graph, Hebbian learning</li>',
  '<li><b>v1.25</b> &mdash; World Organize Pack: 26 gym stations, hospital, 19 shops</li>',
  '<li><b>v1.24</b> &mdash; Organized Gym: exercise only at its machine</li>',
  '<li><b>Since v1.0</b> &mdash; every upgrade ships inside the one zip, A&ndash;Z working</li>',
  '</ul>',
  '<footer>Deployed as a Cloudflare Worker &middot; source of truth: the zip on GitHub</footer>',
  '</main></body></html>'
].join('\n');

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, app: 'AIR DEVELOPING', version: VERSION }), {
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.pathname === '/download') {
      return Response.redirect(ZIP_URL, 302);
    }
    return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
};
