/**
 * Deep mode — the full agent: RESEARCH → PLAN → EXECUTE → VERIFY → CHECK.
 *
 * Perplexity half: a research-shaped goal ("what is the latest express
 * version?") goes live on the web (DuckDuckGo → Wikipedia fallback) and comes
 * back as a cited answer. Claude half: a build-shaped goal goes through the
 * Autopilot mission loop (plan → gated actions → verify → fix); when research
 * fits the goal, live snippets are injected into the planner prompt first.
 * After every build, a final CHECK pass syntax-verifies each written file, so
 * "done" always means "proven", never "promised".
 *
 * If a frontier provider (OpenRouter / Ollama / any connected model) is
 * selected, it drives the same loop — the web context rides along in its
 * planning prompt. Offline, the built-in brain plans instead. Permissions and
 * the audit log apply to everything, exactly like chat and Autopilot.
 */
const autopilot = require('./autopilot.cjs');
const websearch = require('./websearch.cjs');
const agent = require('./agent.cjs');
const react = require('./react.cjs');

const IS_WIN = process.platform === 'win32';
const PY = IS_WIN ? 'py' : 'python3';

const BUILD = /\b(build|make|create|write|add|implement|generate|scaffold|refactor|develop|banao|banana|likho)\b/i;
const RECENCY = /\b(latest|current|recent|news|today|version|release|price|who won|weather|documentation|docs)\b/i;
const SEARCHY = /\b(search|google|look ?up|research|find out|web|perplexity|khojo)\b/i;

function needsResearch(goal) {
  const g = String(goal || '').trim();
  if (!g) return false;
  if (SEARCHY.test(g)) return true;
  if (RECENCY.test(g) && !BUILD.test(g)) return true;
  return /\?\s*$/.test(g) && !BUILD.test(g);
}

function cite(results) {
  return (results || []).slice(0, 8).map((r, i) =>
    `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`.trimEnd()
  ).join('\n');
}

function composeAnswer(research, goal) {
  const lines = [`**${goal}**`, '', `Live web se (${research.source}):`];
  if (research.summary) lines.push('', `> ${research.summary.split('\n')[0]}`, '');
  lines.push('', cite(research.results));
  lines.push('', '_Sources upar linked hain. Connected frontier model (OpenRouter/Ollama) ke saath Deep mode inhi snippets se poora synthesis likhta hai._');
  return lines.join('\n');
}

async function deepRun(opts) {
  const {
    goal,
    provider = 'builtin',
    model = null,
    ws,
    permissions = { runCommands: true, writeFiles: true },
    chat,
    fetchImpl = null,
    maxIterations = 3
  } = opts || {};

  const out = { goal, provider, mode: null, ok: false, research: null, answer: null, mission: null, checks: [], error: null };
  const isBuild = BUILD.test(String(goal || ''));

  // ---- 1. RESEARCH (only when the goal wants the web) ----
  let research = null;
  if (needsResearch(goal)) {
    research = await websearch.deepResearch(goal, { fetchImpl });
    out.research = {
      source: research.source,
      offline: research.offline,
      count: (research.results || []).length,
      results: (research.results || []).slice(0, 8)
    };
  }

  // ---- 2. ANSWER path (pure research question, results in hand) ----
  if (!isBuild && research && research.results && research.results.length) {
    out.mode = 'answer';
    out.answer = composeAnswer(research, goal);
    out.ok = true;
    return out;
  }

  // ---- 2b. ANSWER path with no web (offline) — fall back to the brain ----
  if (!isBuild && (!research || research.offline)) {
    out.mode = 'answer';
    try {
      const reply = await chat(provider, model, [{ role: 'user', content: String(goal) }]);
      out.answer = (research && research.offline
        ? '_Web se jawab nahi mila (offline ya blocked) — built-in knowledge se:_\n\n'
        : '') + String(reply || '');
      out.ok = true;
    } catch (e) {
      out.answer = null;
      out.error = e.message;
    }
    return out;
  }

  // ---- 3. BUILD path: research context rides into the planner prompt ----
  out.mode = 'build';
  let enriched = String(goal);
  if (research && research.results && research.results.length) {
    enriched += '\n\nResearch context from the live web (use only if relevant):\n'
      + research.results.slice(0, 5).map((r) => `- ${r.title}: ${r.snippet} (${r.url})`).join('\n');
  }
  if (provider && provider !== 'builtin') {
    // Frontier models get the full ReAct loop: one tool per turn, real
    // observations, permission gates, until the model calls done.
    const researchContext = research && research.results && research.results.length
      ? research.results.slice(0, 5).map((r) => `- ${r.title}: ${r.snippet} (${r.url})`).join('\n')
      : '';
    const r = await react.runAgent({
      goal: String(goal), provider, model, ws, permissions, chat, fetchImpl,
      maxSteps: Number(opts.maxSteps) || 8,
      researchContext
    });
    out.engine = 'react';
    out.react = r;
    out.mission = {
      ok: r.ok, summary: 'deep react agent', done: String(r.answer || '').slice(0, 140),
      iterations: [], files: r.files, error: r.error
    };
  } else {
    out.mission = await autopilot.runMission({
      goal: enriched, provider, model, ws, permissions, chat, maxIterations
    });
  }
  const mission = out.mission;

  // ---- 4. CHECK phase: prove every written file parses ----
  if (permissions.runCommands && ws && typeof ws.root === 'function') {
    for (const f of mission.files || []) {
      let cmd = null;
      if (/\.([cm]?js|cjs)$/.test(f)) cmd = `node --check "${f}"`;
      else if (/\.py$/.test(f)) cmd = `${PY} -m py_compile "${f}"`;
      if (!cmd) continue;
      const r = await agent.runShell(cmd, ws.root(), 30000);
      out.checks.push({ file: f, cmd, code: r.code, out: `${r.stdout || ''}${r.stderr || ''}`.slice(-500) });
    }
  }
  const failed = out.checks.filter((c) => c.code !== 0);
  out.ok = Boolean(mission.ok) && failed.length === 0;
  out.error = mission.ok
    ? (failed.length ? failed.map((c) => `CHECK FAILED (${c.code}): ${c.file}`).join('\n') : null)
    : mission.error;
  return out;
}

module.exports = { deepRun, needsResearch, composeAnswer, cite };
