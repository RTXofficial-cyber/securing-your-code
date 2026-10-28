/**
 * Ensemble / "AI team" orchestrator.
 *
 * Runs several connected models in the background, one per role, and hands
 * each step's output (plus real project context) to the next, so the models
 * genuinely inform each other:
 *
 *   Researcher  -> accurate facts, libraries, APIs, pitfalls   (Perplexity ideal)
 *   Architect   -> implementation plan, file layout            (Claude / GPT)
 *   Coder       -> writes the code as agent actions            (GPT / Claude)
 *   Reviewer    -> correctness pass, emits fix-up actions      (Claude / GPT)
 *
 * Any role whose preferred provider is not connected automatically falls back
 * to the next connected provider, and finally to the offline built-in engine,
 * so the pipeline ALWAYS completes.
 */

const agent = require('./agent.cjs');
const providers = require('./providers.cjs');

const ROLES = [
  { id: 'research', label: 'Researcher', preferred: 'perplexity', icon: '⌕' },
  { id: 'plan', label: 'Architect', preferred: 'anthropic', icon: '⌗' },
  { id: 'code', label: 'Coder', preferred: 'openai', icon: '⌨' },
  { id: 'review', label: 'Reviewer', preferred: 'anthropic', icon: '✓' }
];

/** Build a compact, truthful snapshot of the project to feed every model. */
function projectContext(ws, maxFiles = 6, maxChars = 1500) {
  let tree;
  try { tree = ws.tree(); } catch { tree = []; }
  const flat = [];
  (function walk(nodes) {
    for (const n of nodes || []) {
      if (n.type === 'dir') walk(n.children);
      else flat.push(n);
    }
  })(tree);

  const parts = ['FILE TREE:'];
  parts.push(flat.length ? flat.map((f) => `  ${f.path} (${f.size} B)`).join('\n') : '  (empty workspace)');

  const interesting = flat
    .filter((f) => /\.(js|jsx|ts|tsx|py|json|html|css|md)$/i.test(f.name) && f.size > 0 && f.size < 20000)
    .slice(0, maxFiles);

  if (interesting.length) {
    parts.push('\nKEY FILE CONTENTS:');
    for (const f of interesting) {
      try {
        const c = ws.read(f.path);
        parts.push(`\n--- ${f.path} ---\n${c.slice(0, maxChars)}${c.length > maxChars ? '\n…(truncated)' : ''}`);
      } catch {}
    }
  }
  return parts.join('\n');
}

/** Pick the provider for a role: user override -> preferred -> any connected -> builtin. */
function resolveProvider(roleId, overrides) {
  const role = ROLES.find((r) => r.id === roleId);
  const list = providers.listProviders();
  const ready = (id) => { const p = list.find((x) => x.id === id); return Boolean(p && p.ready); };

  const candidates = [overrides?.[roleId], role.preferred, ...list.filter((p) => p.ready && p.id !== 'builtin').map((p) => p.id), 'builtin'];
  for (const id of candidates) {
    if (id && ready(id)) return list.find((p) => p.id === id);
  }
  return list.find((p) => p.id === 'builtin');
}

async function callRole(provider, roleId, prompt, context) {
  const messages = [
    {
      role: 'system',
      content:
        `You are the ${roleId.toUpperCase()} specialist in a multi-AI software team inside Dev Studio.\n` +
        `Work only from the PROJECT CONTEXT and prior team output given to you. Be concise and concrete.\n` +
        `ROLE:${roleId}\n\nPROJECT CONTEXT:\n${context}`
    },
    { role: 'user', content: prompt }
  ];
  const t0 = Date.now();
  const output = await providers.chat(provider.id, null, messages);
  return { output, latencyMs: Date.now() - t0 };
}

/**
 * Run the full pipeline. Returns { steps, actionResults, summary }.
 * A failing step never aborts the run — it is recorded and the team moves on.
 */
async function runEnsemble({ userText, overrides = {}, ws, permissions = { runCommands: true, writeFiles: true }, memory = '' }) {
  const memBlock = String(memory || '').trim();
  const withMemory = (ctx) => (memBlock ? `${ctx}\n\n${memBlock}` : ctx);
  const context = withMemory(projectContext(ws));
  const steps = [];
  let actionResults = [];
  let research = '';
  let plan = '';
  let codeOut = '';

  const record = (role, provider, res) => {
    steps.push({
      role: role.id, label: role.label, icon: role.icon,
      providerId: provider.id, providerName: provider.name,
      ok: true, output: res.output, latencyMs: res.latencyMs
    });
  };
  const recordFail = (role, provider, err) => {
    steps.push({ role: role.id, label: role.label, icon: role.icon, providerId: provider?.id, providerName: provider?.name, ok: false, error: err.message });
  };

  // 1 — Research
  {
    const role = ROLES[0];
    const provider = resolveProvider('research', overrides);
    try {
      const r = await callRole(provider, 'research',
        `List the accurate, current technical facts needed to build this request: best-fit libraries (prefer zero-dependency where possible), APIs, file layout and common pitfalls. Bullet points only, no code.\n\nREQUEST: ${userText}`,
        context);
      research = r.output;
      record(role, provider, r);
    } catch (e) { recordFail(role, provider, e); research = '(research step failed: ' + e.message + ')'; }
  }

  // 2 — Plan
  {
    const role = ROLES[1];
    const provider = resolveProvider('plan', overrides);
    try {
      const r = await callRole(provider, 'plan',
        `Produce a short numbered implementation plan (files to create, what each contains, order of work, how to verify). No code blocks.\n\nRESEARCH FROM TEAM:\n${research}\n\nREQUEST: ${userText}`,
        context);
      plan = r.output;
      record(role, provider, r);
    } catch (e) { recordFail(role, provider, e); plan = '(planning step failed: ' + e.message + ')'; }
  }

  // 3 — Code (emits agent actions, which we execute)
  {
    const role = ROLES[2];
    const provider = resolveProvider('code', overrides);
    try {
      const r = await callRole(provider, 'code',
        `Write the complete working code now. Emit Dev Studio action blocks (\`\`\`action:write_file / action:run_command) for every file, then verify by running it. Follow the team plan.\n\nPLAN:\n${plan}\n\nREQUEST: ${userText}`,
        context);
      codeOut = r.output;
      record(role, provider, r);

      let actions = agent.parseActions(r.output);
      if (!permissions.writeFiles) actions = actions.filter((a) => a.type !== 'write_file');
      if (!permissions.runCommands) actions = actions.filter((a) => a.type !== 'run_command');
      if (actions.length) actionResults = actionResults.concat(await agent.executeActions(actions, ws));
    } catch (e) { recordFail(role, provider, e); }
  }

  // 4 — Review (may emit corrective actions)
  {
    const role = ROLES[3];
    const provider = resolveProvider('review', overrides);
    try {
      const runLog = actionResults
        .filter((a) => a.type === 'run_command')
        .map((a) => `$ ${a.command}\n${(a.stdout || '') + (a.stderr || '')}`.slice(0, 1200))
        .join('\n\n');
      const r = await callRole(provider, 'review',
        `Review the team's work for correctness, security and missing edge cases. If something must change, emit fix-up action blocks; otherwise state "APPROVED" and list 2-3 concrete improvements.\n\nCODE OUTPUT:\n${agent.stripActions(codeOut).slice(0, 4000)}\n\nRUN LOG:\n${runLog || '(nothing was run)'}\n\nREQUEST: ${userText}`,
        withMemory(projectContext(ws))); // re-read context AFTER the coder wrote files
      record(role, provider, r);

      let fixes = agent.parseActions(r.output);
      if (!permissions.writeFiles) fixes = fixes.filter((a) => a.type !== 'write_file');
      if (!permissions.runCommands) fixes = fixes.filter((a) => a.type !== 'run_command');
      if (fixes.length) actionResults = actionResults.concat(await agent.executeActions(fixes, ws));
    } catch (e) { recordFail(role, provider, e); }
  }

  const reviewStep = steps.find((s) => s.role === 'review');
  const summary =
    (reviewStep?.ok ? agent.stripActions(reviewStep.output) : '') ||
    agent.stripActions(codeOut) ||
    'The team completed its run; see the step trace above.';

  return { steps, actionResults, summary };
}

module.exports = { ROLES, runEnsemble, projectContext, resolveProvider };
