/**
 * ReAct agent — the Deep brain for connected frontier models.
 *
 * Instead of one-shot planning, the model works step by step like a real
 * engineer: it calls ONE tool per turn, reads the observation, and decides
 * the next move. Tools: web_search (live, no key), read_file, list_files,
 * write_file, run_command, done. Writes and commands pass the SAME permission
 * gates as chat/Autopilot; skipped work is reported back to the model so it
 * can adapt instead of hallucinating success. Observations are truncated,
 * the loop is capped, and `done` (or the cap) ends the run with an answer.
 *
 * Tool-call parsing is fence-tolerant: ```tool fenced JSON, bare JSON with a
 * "tool" key, or JSON plus prose all parse. A reply with no tool call gets
 * one nudge; a second ramble is treated as the final answer.
 */
const agent = require('./agent.cjs');
const websearch = require('./websearch.cjs');

const IS_WIN = process.platform === 'win32';
const PY = IS_WIN ? 'py' : 'python3';

const SYSTEM = (goal, researchContext, prior) => [
  'You are Dev Studio Deep Agent, a careful software engineer working inside the user\'s real PC workspace.',
  'Solve the GOAL step by step. Reply with EXACTLY ONE tool call per message, as JSON:',
  '```tool',
  '{"tool":"<name>", ...args}',
  '```',
  'Tools:',
  '- {"tool":"web_search","query":"..."}            live web results (use for current facts/docs)',
  '- {"tool":"read_file","path":"rel/path"}         read a workspace file',
  '- {"tool":"list_files"}                          list the workspace tree',
  '- {"tool":"write_file","path":"rel/path","content":"..."}   create/overwrite a file (needs write permission)',
  `- {"tool":"run_command","command":"..."}         run in the workspace terminal; python is "${PY}" (needs run permission)`,
  '- {"tool":"done","answer":"final answer for the user","files":["rel/path"]}   finish',
  'Rules: relative paths only; zero-dependency code; after writing each .js file verify it with run_command "node --check <path>" and fix failures before done; never claim success you have not observed; if a tool is SKIPPED by permissions, adapt (explain in the final answer) instead of retrying.',
  researchContext ? `\nResearch already gathered (use if relevant):\n${researchContext}\n` : '',
  prior ? `\n${prior}\n` : '',
  `GOAL: ${goal}`
].filter(Boolean).join('\n');

function parseToolCall(text) {
  const t = String(text || '');
  const candidates = [];
  const fence = /```(?:tool|json)?\s*([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(t))) candidates.push(m[1]);
  candidates.push(t); // bare JSON somewhere in prose
  for (const c of candidates) {
    const braces = /\{[\s\S]*\}/.exec(c);
    if (!braces) continue;
    try {
      const o = JSON.parse(braces[0]);
      if (o && typeof o === 'object' && typeof o.tool === 'string') return o;
    } catch { /* try next candidate */ }
  }
  return null;
}

function summarizeArgs(call) {
  const { tool, ...rest } = call;
  const s = JSON.stringify(rest);
  return s.length > 160 ? s.slice(0, 157) + '…' : s;
}

async function runAgent(opts) {
  const {
    goal,
    provider,
    model = null,
    ws,
    permissions = { runCommands: true, writeFiles: true },
    chat,
    fetchImpl = null,
    maxSteps = 8,
    researchContext = '',
    prior = ''
  } = opts || {};

  const cap = Math.min(14, Math.max(2, Number(maxSteps) || 8));
  const messages = [{ role: 'system', content: SYSTEM(String(goal || ''), researchContext, prior) }];
  const steps = [];
  const files = new Set();
  let answer = '';
  let nudged = false;

  for (let i = 1; i <= cap; i += 1) {
    let reply;
    try {
      reply = await chat(provider, model, messages);
    } catch (e) {
      return { ok: false, engine: 'react', answer: '', steps, files: [...files], error: e.message };
    }
    messages.push({ role: 'assistant', content: String(reply) });
    const call = parseToolCall(reply);

    if (!call) {
      if (!nudged && i < cap) {
        nudged = true;
        messages.push({ role: 'user', content: 'Respond with EXACTLY ONE tool call: ```tool\n{"tool":"...", ...}\n``` — or {"tool":"done","answer":"..."} to finish.' });
        steps.push({ step: i, tool: '(no tool call)', args: '', observation: 'nudged the model to use the tool protocol', skipped: false });
        continue;
      }
      answer = String(reply).slice(0, 4000);
      steps.push({ step: i, tool: '(final text)', args: '', observation: 'model answered without the done tool', skipped: false });
      break;
    }

    const tool = call.tool;
    let observation = '';
    let skipped = false;

    if (tool === 'done') {
      answer = String(call.answer || '').slice(0, 4000);
      if (Array.isArray(call.files)) for (const f of call.files) if (typeof f === 'string') files.add(f);
      steps.push({ step: i, tool: 'done', args: summarizeArgs(call), observation: 'finished', skipped: false });
      break;
    } else if (tool === 'web_search') {
      const r = await websearch.deepResearch(call.query || goal, { fetchImpl });
      observation = r.results && r.results.length
        ? r.results.slice(0, 5).map((x, j) => `${j + 1}. ${x.title} (${x.url})\n   ${x.snippet}`).join('\n')
          + (r.summary ? `\nSummary: ${r.summary.slice(0, 400)}` : '')
        : 'no web results (offline or blocked)';
    } else if (tool === 'read_file') {
      try {
        const c = ws.read(String(call.path || ''));
        observation = String(c).slice(0, 3000);
      } catch (e) {
        observation = `read failed: ${e.message}`;
      }
    } else if (tool === 'list_files') {
      try {
        observation = ws.listFlat().slice(0, 200).join('\n') || '(empty workspace)';
      } catch (e) {
        observation = `list failed: ${e.message}`;
      }
    } else if (tool === 'write_file') {
      if (!permissions.writeFiles) {
        skipped = true;
        observation = 'SKIPPED by permissions: write_file is not allowed right now';
      } else {
        try {
          const results = await agent.executeActions([{ type: 'write_file', path: String(call.path || ''), content: String(call.content ?? '') }], ws);
          const r = results[0] || {};
          if (r.ok === false) observation = `write failed: ${r.error || 'unknown'}`;
          else {
            files.add(String(call.path));
            observation = `wrote ${call.path} (${String(call.content ?? '').length} bytes)`;
          }
        } catch (e) {
          observation = `write failed: ${e.message}`;
        }
      }
    } else if (tool === 'run_command') {
      if (!permissions.runCommands) {
        skipped = true;
        observation = 'SKIPPED by permissions: run_command is not allowed right now';
      } else {
        const r = await agent.runShell(String(call.command || '').slice(0, 2000), ws.root(), 60000);
        observation = `exit ${r.code}${r.timedOut ? ' (TIMED OUT)' : ''}\n${String(r.stdout || '').slice(-1200)}${String(r.stderr || '').slice(-1200)}`.trim();
      }
    } else {
      observation = `unknown tool "${tool}" — use one of: web_search, read_file, list_files, write_file, run_command, done`;
    }

    observation = String(observation).slice(0, 2000);
    steps.push({ step: i, tool, args: summarizeArgs(call), observation, skipped });
    messages.push({ role: 'user', content: `Observation (${tool}):\n${observation}` });
  }

  if (!answer && !steps.some((s) => s.tool === 'done')) {
    answer = `Step limit (${cap}) pohanch gaya — jo kaam hua woh upar listed hai. Dobara chalaiye ya maxSteps barhaiye.`;
  }
  return { ok: true, engine: 'react', answer, steps, files: [...files], error: null };
}

module.exports = { runAgent, parseToolCall, SYSTEM };
