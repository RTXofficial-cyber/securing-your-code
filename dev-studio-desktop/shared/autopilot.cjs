/**
 * Autopilot — autonomous plan → execute → verify → fix loops.
 *
 * Give it a goal ("add a login page with validation", "build me a website"),
 * and it will:
 *   1. PLAN     — ask the selected model for a JSON plan (steps + actions +
 *                 verify commands). The offline built-in engine plans by
 *                 emitting its normal action blocks.
 *   2. EXECUTE  — run the actions through the SAME permission gates as chat
 *                 (writeFiles / runCommands); skipped work is reported, never
 *                 silent.
 *   3. VERIFY   — run the verify commands; a non-zero exit means failure.
 *   4. FIX      — on failure, feed the error back to the model and repeat,
 *                 up to maxIterations.
 *
 * Everything is audited by the caller (ipc) and nothing escapes permissions.
 */
const agent = require('./agent.cjs');

const PLAN_PROMPT = (goal, extra, prior) => [
  'You are Dev Studio Autopilot, an autonomous software engineer inside the user\'s workspace.',
  'Produce a concrete plan for the goal below. Respond with ONLY a JSON object, no prose, no fences:',
  '{"summary":"one line","steps":[{"title":"short title","actions":[{"type":"write_file","path":"rel/path","content":"full file content"} OR {"type":"run_command","command":"shell command"}]}],"verify":["shell command that proves success (exit 0)"],"done":"what the user will have at the end"}',
  'Rules: relative paths only; zero-dependency code; every written .js file must pass `node --check`; keep files small and complete.',
  prior ? `${prior}\n` : '',
  extra ? `Previous attempt failed. Fix exactly this error:\n${extra}\n` : '',
  `GOAL: ${goal}`
].join('\n');

function parsePlan(text) {
  const m = /\{[\s\S]*\}/.exec(String(text || ''));
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]);
    if (!p || typeof p !== 'object') return null;
    const steps = Array.isArray(p.steps) ? p.steps.filter((s) => s && Array.isArray(s.actions)) : [];
    return {
      summary: String(p.summary || 'plan'),
      done: String(p.done || ''),
      steps,
      verify: Array.isArray(p.verify) ? p.verify.filter((c) => typeof c === 'string').slice(0, 8) : []
    };
  } catch {
    return null;
  }
}

function builtinPlan(reply) {
  const actions = agent.parseActions(reply);
  if (!actions.length) return null;
  const verify = [];
  for (const a of actions) {
    if (a.type === 'write_file' && /\.([cm]?js|cjs)$/.test(a.path || '')) verify.push(`node --check ${a.path}`);
    if (a.type === 'write_file' && /\.py$/.test(a.path || '')) verify.push(`python3 -m py_compile ${a.path}`);
  }
  return {
    summary: 'offline scaffold plan',
    done: 'scaffolded and verified offline',
    steps: [{ title: 'scaffold + verify', actions }],
    verify: verify.slice(0, 8)
  };
}

function gateActions(actions, permissions) {
  const kept = [];
  const skipped = [];
  for (const a of actions || []) {
    if (a.type === 'write_file' && !permissions.writeFiles) { skipped.push(`write ${a.path}`); continue; }
    if (a.type === 'run_command' && !permissions.runCommands) { skipped.push(`run ${String(a.command).slice(0, 80)}`); continue; }
    kept.push(a);
  }
  return { kept, skipped };
}

async function runMission(opts) {
  const {
    goal,
    provider = 'builtin',
    model = null,
    ws,
    permissions = { runCommands: true, writeFiles: true },
    chat,
    maxIterations = 3,
    prior = ''
  } = opts;

  const iterations = [];
  const filesWritten = new Set();
  let lastError = '';
  let plan = null;
  let ok = false;
  let summary = '';
  let done = '';

  for (let iter = 1; iter <= maxIterations; iter += 1) {
    // ---- 1. plan ----
    if (!plan || lastError) {
      let reply;
      try {
        reply = await chat(provider, model, [
          { role: 'system', content: PLAN_PROMPT(goal, lastError, prior) },
          { role: 'user', content: goal }
        ]);
      } catch (e) {
        iterations.push({ iter, phase: 'plan', ok: false, log: `planner error: ${e.message}` });
        break;
      }
      plan = provider === 'builtin' ? builtinPlan(reply) : parsePlan(reply);
      if (!plan) plan = builtinPlan(reply); // frontier models that ramble still get salvaged
      if (!plan) {
        iterations.push({ iter, phase: 'plan', ok: false, log: 'planner returned no usable plan' });
        break;
      }
      summary = plan.summary;
      done = plan.done;
    }

    // ---- 2. execute ----
    const allActions = plan.steps.flatMap((s) => s.actions);
    const { kept, skipped } = gateActions(allActions, permissions);
    let results = [];
    if (kept.length) results = await agent.executeActions(kept, ws);
    for (const r of results) {
      if (r.type === 'write_file' && r.ok !== false) filesWritten.add(r.path);
    }
    const execLog = results
      .map((r) => `${r.type} ${r.path || r.command || ''} -> ${r.ok === false ? `FAIL ${r.error || ''}` : 'ok'}${r.stdout ? `\n${String(r.stdout).slice(0, 400)}` : ''}`)
      .join('\n');

    // ---- 3. verify ----
    const verifyResults = [];
    if (permissions.runCommands) {
      for (const cmd of plan.verify) {
        const r = await agent.runShell(cmd, ws.root(), 60000);
        verifyResults.push({ cmd, code: r.code, out: `${r.stdout || ''}${r.stderr || ''}`.slice(-1200) });
      }
    }
    const failures = verifyResults.filter((v) => v.code !== 0);
    const execFailures = results.filter((r) => r.ok === false);
    ok = failures.length === 0 && execFailures.length === 0;

    iterations.push({
      iter,
      phase: ok ? 'verified' : 'fixing',
      ok,
      title: plan.summary,
      steps: plan.steps.map((s) => s.title),
      actions: kept.length,
      skipped,
      verify: verifyResults.map((v) => ({ cmd: v.cmd, code: v.code })),
      log: [execLog, ...verifyResults.map((v) => `$ ${v.cmd}\n${v.out}`)].filter(Boolean).join('\n').slice(-6000)
    });

    if (ok) break;
    lastError = [
      ...execFailures.map((r) => `${r.type} failed: ${r.error || ''}`),
      ...failures.map((v) => `VERIFY FAILED (${v.code}): $ ${v.cmd}\n${v.out}`)
    ].join('\n').slice(0, 4000);
    plan = null; // force a fix-plan next iteration
  }

  return {
    ok,
    goal,
    provider,
    summary,
    done,
    iterations,
    files: [...filesWritten],
    error: ok ? null : lastError || 'mission did not verify'
  };
}

module.exports = { runMission, parsePlan, builtinPlan, gateActions, PLAN_PROMPT };
