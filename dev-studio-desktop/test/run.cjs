/**
 * Logic tests that run WITHOUT Electron, so they can be verified anywhere.
 * Covers: agent action parsing, path-escape protection, cross-platform
 * command execution, provider registry, and key handling.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const agent = require('../shared/agent.cjs');
const providers = require('../shared/providers.cjs');
const { makeWorkspaceHelpers } = require('../electron/workspace.cjs');
const { Terminal } = require('../electron/terminal.cjs');
const orchestrator = require('../shared/orchestrator.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-test-'));
const ws = makeWorkspaceHelpers({ value: tmp });

let pass = 0;
let fail = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${name}\n      ${e.message}`);
    fail++;
  }
}

(async () => {
  console.log('\nDev Studio — logic tests\n');

  console.log('Agent action parsing');
  await test('parses write_file action blocks', () => {
    const acts = agent.parseActions('hi\n```action:write_file\n{"path":"a.js","content":"x"}\n```\nbye');
    assert.strictEqual(acts.length, 1);
    assert.strictEqual(acts[0].type, 'write_file');
    assert.strictEqual(acts[0].path, 'a.js');
  });

  await test('parses multiple actions in order', () => {
    const acts = agent.parseActions(
      '```action:write_file\n{"path":"a.js","content":"1"}\n```\n```action:run_command\n{"command":"node a.js"}\n```'
    );
    assert.strictEqual(acts.length, 2);
    assert.strictEqual(acts[1].type, 'run_command');
    assert.strictEqual(acts[1].command, 'node a.js');
  });

  await test('reports invalid JSON instead of throwing', () => {
    const acts = agent.parseActions('```action:write_file\n{bad json}\n```');
    assert.strictEqual(acts[0].type, 'error');
  });

  await test('stripActions removes blocks but keeps prose', () => {
    const out = agent.stripActions('Hello\n```action:run_command\n{"command":"ls"}\n```\nDone');
    assert.strictEqual(out, 'Hello\n\nDone');
  });

  await test('plain chat yields zero actions', () => {
    assert.strictEqual(agent.parseActions('Just a normal reply with ```js code``` blocks').length, 0);
  });

  console.log('\nWorkspace safety');
  await test('writes and reads a file', () => {
    ws.write('sub/dir/file.txt', 'hello');
    assert.strictEqual(ws.read('sub/dir/file.txt'), 'hello');
  });

  await test('blocks path traversal (../)', () => {
    assert.throws(() => ws.read('../../etc/passwd'), /outside the workspace/);
  });

  await test('blocks absolute path escape', () => {
    assert.throws(() => ws.write(os.tmpdir() + '/evil.txt', 'x'), /outside the workspace/);
  });

  await test('refuses to delete workspace root', () => {
    assert.throws(() => ws.remove('.'), /Cannot delete the workspace root/);
  });

  await test('tree lists nested files and ignores node_modules', () => {
    ws.write('node_modules/junk/index.js', 'x');
    ws.write('keep.js', 'x');
    const t = ws.tree();
    assert.ok(t.some((n) => n.name === 'keep.js'));
    assert.ok(!t.some((n) => n.name === 'node_modules'));
  });

  console.log('\nCommand execution');
  await test('runs a shell command and captures stdout', async () => {
    const r = await agent.runShell(agent.IS_WIN ? 'echo RUN_OK' : 'echo RUN_OK', tmp);
    assert.strictEqual(r.code, 0);
    assert.match(r.stdout, /RUN_OK/);
  });

  await test('reports non-zero exit codes', async () => {
    const r = await agent.runShell(agent.IS_WIN ? 'exit /b 3' : 'exit 3', tmp);
    assert.notStrictEqual(r.code, 0);
  });

  await test('enforces timeouts', async () => {
    const r = await agent.runShell(agent.IS_WIN ? 'ping -n 6 127.0.0.1' : 'sleep 5', tmp, 400);
    assert.ok(r.timedOut || r.code !== 0, 'expected timeout or failure');
  });

  await test('executeActions writes then runs the file', async () => {
    const results = await agent.executeActions(
      [
        { type: 'write_file', path: 'run-me.js', content: "console.log('AGENT_RAN_OK');" },
        { type: 'run_command', command: 'node run-me.js' }
      ],
      ws
    );
    assert.strictEqual(results[0].ok, true);
    assert.strictEqual(results[1].ok, true, results[1].stderr);
    assert.match(results[1].stdout, /AGENT_RAN_OK/);
  });

  console.log('\nTerminal shell');
  await test('persistent shell keeps cwd between commands', async () => {
    const t = new Terminal({ cwd: tmp });
    t.start();
    const mkdir = agent.IS_WIN ? 'mkdir tdir' : 'mkdir -p tdir';
    await t.run(mkdir);
    const r = await t.run(agent.IS_WIN ? 'cd tdir' : 'cd tdir');
    assert.ok(r.cwd.includes('tdir'), `cwd was ${r.cwd}`);
    const r2 = await t.run(agent.IS_WIN ? 'echo HERE' : 'echo HERE');
    assert.strictEqual(r2.exitCode, 0, 'sentinel/exit code not parsed');
    t.dispose();
  });

  await test('terminal reports exit codes', async () => {
    const t = new Terminal({ cwd: tmp });
    t.start();
    const r = await t.run(agent.IS_WIN ? 'exit /b 7' : 'exit 7');
    // `exit` closes the shell; either the code is captured or the shell exits cleanly
    assert.ok(r.exitCode === 7 || r.killed || r.exitCode === -1, `got ${JSON.stringify(r)}`);
    t.dispose();
  });

  console.log('\nProviders');
  await test('registry exposes 6 providers', () => {
    const list = providers.listProviders();
    assert.strictEqual(list.length, 6);
  });

  await test('built-in engine needs no key and is ready', () => {
    const b = providers.listProviders().find((p) => p.id === 'builtin');
    assert.strictEqual(b.ready, true);
    assert.strictEqual(b.keyEnv, null);
  });

  await test('keyed providers are not ready without a key', () => {
    const a = providers.listProviders().find((p) => p.id === 'anthropic');
    assert.strictEqual(a.ready, Boolean(providers.getKey('ANTHROPIC_API_KEY')));
  });

  await test('chat refuses a provider with no key', async () => {
    providers.setKey('OPENAI_API_KEY', '');
    await assert.rejects(() => providers.chat('openai', 'gpt-4o', [{ role: 'user', content: 'hi' }]), /not connected/);
    // raw HTTP blobs must become human guidance, not JSON walls
    const q = providers.friendlyProviderError(429, '{"error":{"message":"You have no credits remaining.","code":"credit_balance_exhausted"}}');
    assert.match(q, /credits khatam/);
    assert.match(q, /platform\.openai\.com\/settings\/organization\/billing/);
    assert.match(q, /Groq/);
    assert.match(q, /Ollama/);
    const k = providers.friendlyProviderError(401, '{"error":{"message":"Incorrect API key provided","type":"invalid_request_error"}}');
    assert.match(k, /Key invalid/);
    const m = providers.friendlyProviderError(404, '{"error":{"message":"The model `gpt-9` does not exist"}}');
    assert.match(m, /model ID provider par nahi mila/);
    const r = providers.friendlyProviderError(429, '{"error":{"message":"Rate limit reached"}}');
    assert.match(r, /Rate limit/);
  });

  await test('setKey makes a provider ready', () => {
    providers.setKey('OPENAI_API_KEY', 'sk-test-123');
    const p = providers.listProviders().find((x) => x.id === 'openai');
    assert.strictEqual(p.ready, true);
    providers.setKey('OPENAI_API_KEY', '');
  });

  await test('env file loading parses KEY=value lines', () => {
    const f = path.join(tmp, 'dev-studio.env');
    fs.writeFileSync(f, '# comment\nGROQ_API_KEY="gsk_abc"\n\nEMPTY=\n');
    providers.loadKeysFromEnvFile(f);
    assert.strictEqual(providers.getKey('GROQ_API_KEY'), 'gsk_abc');
    providers.setKey('GROQ_API_KEY', '');
  });

  await test('built-in engine returns a real action for a coding request', async () => {
    const reply = await providers.chat('builtin', 'studio-agent-1', [
      { role: 'user', content: 'write a node script that greets me' }
    ]);
    const acts = agent.parseActions(reply);
    assert.ok(acts.some((a) => a.type === 'write_file'), 'expected a write_file action');
  });

  await test('every provider declares models with id+name', () => {
    for (const p of providers.PROVIDERS) {
      assert.ok(Array.isArray(p.models) && p.models.length > 0, `${p.id} has no models`);
      for (const m of p.models) {
        assert.ok(m.id && m.name, `${p.id} model missing id/name`);
      }
    }
  });

  console.log('\nStudio Agent v2 scaffolds');
  await test('website intent writes a 3-file static site', async () => {
    const reply = await providers.chat('builtin', null, [{ role: 'user', content: 'build me a website' }]);
    const acts = agent.parseActions(reply);
    const files = acts.filter((a) => a.type === 'write_file').map((a) => a.path);
    assert.deepStrictEqual(files.sort(), ['app.js', 'index.html', 'styles.css']);
    assert.ok(acts.some((a) => a.type === 'run_command'), 'should verify with a command');
  });

  await test('api intent writes server.js and syntax-checks it', async () => {
    const reply = await providers.chat('builtin', null, [{ role: 'user', content: 'create a rest api' }]);
    const acts = agent.parseActions(reply);
    assert.ok(acts.some((a) => a.type === 'write_file' && a.path === 'server.js'));
    assert.ok(acts.some((a) => a.type === 'run_command' && /node --check server\.js/.test(a.command)));
  });

  await test('python intent byte-compiles to verify', async () => {
    const reply = await providers.chat('builtin', null, [{ role: 'user', content: 'make a python server' }]);
    const acts = agent.parseActions(reply);
    assert.ok(acts.some((a) => a.type === 'write_file' && a.path === 'app.py'));
    assert.ok(acts.some((a) => a.type === 'run_command' && /py_compile/.test(a.command)));
  });

  await test('cli intent runs the tool after writing it', async () => {
    const reply = await providers.chat('builtin', null, [{ role: 'user', content: 'write a cli tool' }]);
    const acts = agent.parseActions(reply);
    assert.ok(acts.some((a) => a.type === 'write_file' && a.path === 'cli.js'));
    assert.ok(acts.filter((a) => a.type === 'run_command').length >= 2, 'expected help + real run');
  });

  await test('games scaffold via Game Studio; todo stays single-file', async () => {
    const g = agent.parseActions(await providers.chat('builtin', null, [{ role: 'user', content: 'make a game' }]));
    const t = agent.parseActions(await providers.chat('builtin', null, [{ role: 'user', content: 'make a todo app' }]));
    assert.ok(g.some((a) => a.type === 'game_new' && a.dir === 'game'), 'games use the Game Studio plugin');
    assert.ok(t.some((a) => a.path === 'todo.html'));
  });

  await test('scaffolded JS is syntactically valid (node --check)', async () => {
    const reply = await providers.chat('builtin', null, [{ role: 'user', content: 'build me a website' }]);
    const acts = agent.parseActions(reply);
    const results = await agent.executeActions(acts.filter((a) => a.type === 'write_file'), ws);
    assert.ok(results.every((r) => r.ok));
    const check = await agent.runShell('node --check app.js', tmp);
    assert.strictEqual(check.code, 0, check.stderr);
  });

  await test('scaffolded python compiles', async () => {
    const reply = await providers.chat('builtin', null, [{ role: 'user', content: 'make a python server' }]);
    const acts = agent.parseActions(reply);
    await agent.executeActions(acts.filter((a) => a.type === 'write_file'), ws);
    const py = agent.IS_WIN ? 'py' : 'python3';
    const check = await agent.runShell(`${py} -m py_compile app.py`, tmp);
    assert.strictEqual(check.code, 0, check.stderr);
  });

  console.log('\nEnsemble / AI team');
  await test('exposes the four team roles', () => {
    assert.deepStrictEqual(orchestrator.ROLES.map((r) => r.id), ['research', 'plan', 'code', 'review']);
  });

  await test('role provider falls back to builtin when nothing is connected', () => {
    providers.setKey('OPENAI_API_KEY', '');
    providers.setKey('PERPLEXITY_API_KEY', '');
    const p = orchestrator.resolveProvider('research', {});
    assert.strictEqual(p.id, 'builtin');
  });

  await test('role provider honours an explicit override when connected', () => {
    providers.setKey('GROQ_API_KEY', 'gsk_test');
    const p = orchestrator.resolveProvider('code', { code: 'groq' });
    assert.strictEqual(p.id, 'groq');
    providers.setKey('GROQ_API_KEY', '');
  });

  await test('projectContext includes tree and file contents', () => {
    ws.write('ctx-probe.js', 'console.log(1);');
    const ctx = orchestrator.projectContext(ws);
    assert.match(ctx, /FILE TREE/);
    assert.match(ctx, /ctx-probe\.js/);
    assert.match(ctx, /console\.log\(1\)/);
  });

  await test('offline team run completes all four steps and writes code', async () => {
    const r = await orchestrator.runEnsemble({ userText: 'build me a website', ws });
    assert.strictEqual(r.steps.length, 4);
    assert.ok(r.steps.every((s) => s.ok), JSON.stringify(r.steps.map((s) => s.error)));
    assert.deepStrictEqual(r.steps.map((s) => s.role), ['research', 'plan', 'code', 'review']);
    assert.ok(r.actionResults.some((a) => a.type === 'write_file' && a.ok), 'coder should have written files');
    assert.ok(r.actionResults.some((a) => a.type === 'run_command'), 'team should verify by running');
    assert.ok(r.summary.length > 0);
  });

  await test('permissions gate the team coder', async () => {
    const r = await orchestrator.runEnsemble({
      userText: 'build me a website',
      ws,
      permissions: { runCommands: false, writeFiles: false }
    });
    const mutating = r.actionResults.filter((a) => a.type === 'write_file' || a.type === 'run_command');
    assert.strictEqual(mutating.length, 0, 'no writes/runs should execute when blocked');
    assert.strictEqual(r.steps.length, 4);
  });

  console.log('\nPlugin system');
  const { PluginManager } = require('../shared/plugins.cjs');
  const officialDir = path.join(__dirname, '..', 'plugins');
  const userDir = path.join(tmp, 'user-plugins');
  fs.mkdirSync(userDir, { recursive: true });

  // a user plugin that adds a provider + a tool
  fs.mkdirSync(path.join(userDir, 'demo'), { recursive: true });
  // enabledByDefault:true opts a USER plugin in (the new secure default is off)
  fs.writeFileSync(path.join(userDir, 'demo', 'plugin.json'), JSON.stringify({
    id: 'demo', name: 'Demo plugin', version: '1.0.0', entry: 'index.cjs', type: 'bundle', enabledByDefault: true
  }));
  fs.writeFileSync(path.join(userDir, 'demo', 'index.cjs'), `
    module.exports = {
      provider: {
        id: 'demo-ai', name: 'Demo AI', vendor: 'Demo', keyEnv: null,
        models: [{ id: 'demo-1', name: 'Demo 1' }],
        async chat() { return 'demo reply'; }
      },
      tools: [{ name: 'demo_tool', description: 'demo', async run() { return { ok: true, output: 'tool ran' }; } }]
    };
  `);

  // a deliberately broken plugin — must be isolated, never fatal
  fs.mkdirSync(path.join(userDir, 'broken'), { recursive: true });
  fs.writeFileSync(path.join(userDir, 'broken', 'plugin.json'), JSON.stringify({
    id: 'broken', name: 'Broken', version: '1.0.0', entry: 'index.cjs'
  }));
  fs.writeFileSync(path.join(userDir, 'broken', 'index.cjs'), 'throw new Error("boom on load");');

  const pm = new PluginManager({ dirs: [officialDir, userDir], persistFile: path.join(tmp, 'plugins.json') });

  await test('scan discovers official + user plugins', () => {
    const list = pm.scan();
    const ids = list.map((p) => p.id).sort();
    assert.deepStrictEqual(ids, ['broken', 'demo', 'game-studio', 'git-tools', 'ollama', 'openrouter', 'workspace-inspector']);
  });

  await test('loadAll registers plugin providers and tools', () => {
    pm.loadAll();
    assert.ok(providers.hasProvider('ollama'), 'ollama provider registered');
    assert.ok(providers.hasProvider('openrouter'), 'openrouter provider registered');
    assert.ok(providers.hasProvider('demo-ai'), 'demo provider registered');
    assert.ok(agent.hasTool('git_status'), 'git tools registered');
    assert.ok(agent.hasTool('demo_tool'), 'demo tool registered');
  });

  await test('broken plugin is isolated with status error when enabled', () => {
    // disabled by default (user dir) -> no load attempted
    assert.strictEqual(pm.list().find((p) => p.id === 'broken').status, 'disabled');
    // enabling it surfaces the crash as status:error, and the app survives
    pm.setEnabled('broken', true);
    const b = pm.list().find((p) => p.id === 'broken');
    assert.strictEqual(b.status, 'error');
    assert.match(b.error, /boom on load/);
    pm.setEnabled('broken', false);
  });

  await test('plugin provider answers chat', async () => {
    const r = await providers.chat('demo-ai', null, [{ role: 'user', content: 'hi' }]);
    assert.strictEqual(r, 'demo reply');
  });

  await test('plugin tool runs as an agent action', async () => {
    const res = await agent.executeActions([{ type: 'demo_tool' }], ws);
    assert.strictEqual(res[0].ok, true);
    assert.match(res[0].output, /tool ran/);
  });

  await test('git tools work end to end', async () => {
    const init = await agent.executeActions([{ type: 'git_init' }], ws);
    assert.strictEqual(init[0].ok, true, init[0].output);
    await agent.runShell('git config user.email "test@dev.studio" && git config user.name "Test"', tmp);
    ws.write('tracked.txt', 'x');
    const st = await agent.executeActions([{ type: 'git_status' }], ws);
    assert.strictEqual(st[0].ok, true, st[0].output);
    assert.match(st[0].output, /tracked\.txt/);
    const cm = await agent.executeActions([{ type: 'git_commit', message: 'plugin test' }], ws);
    assert.strictEqual(cm[0].ok, true, cm[0].output);
  });

  await test('systemPrompt advertises plugin tools', () => {
    const sp = agent.systemPrompt();
    assert.match(sp, /git_commit/);
    assert.match(sp, /demo_tool/);
  });

  await test('disabling a plugin unregisters it', () => {
    const r = pm.setEnabled('demo', false);
    assert.strictEqual(r.ok, true);
    assert.ok(!providers.hasProvider('demo-ai'), 'provider removed');
    assert.ok(!agent.hasTool('demo_tool'), 'tool removed');
    const v = pm.list().find((p) => p.id === 'demo');
    assert.strictEqual(v.status, 'disabled');
    pm.setEnabled('demo', true);
    assert.ok(providers.hasProvider('demo-ai'), 'provider back after re-enable');
  });

  await test('enable state persists to disk', () => {
    pm.setEnabled('ollama', false);
    const pm2 = new PluginManager({ dirs: [officialDir, userDir], persistFile: path.join(tmp, 'plugins.json') });
    pm2.scan();
    assert.strictEqual(pm2.list().find((p) => p.id === 'ollama').enabled, false);
    pm2.setEnabled('ollama', true);
  });

  console.log('\nStudio Agent v2 conversation');

  await test('builtin answers each question differently (no canned intro)', async () => {
    const ask = (t) => providers.chat('builtin', null, [{ role: 'user', content: t }]);

    const hi = await ask('hello');
    assert.match(hi, /Dev Studio/i);
    assert.ok(!hi.includes('Try any of these'), 'greeting must not dump the intro');

    const who = await ask('who are you?');
    assert.match(who, /offline/i);
    assert.match(who, /Studio Agent v2/);

    const rec = await ask('what is recursion?');
    assert.match(rec, /Recursion/);
    assert.match(rec, /base case/i);

    const css = await ask('how do i center a div with css?');
    assert.match(css, /flex/i);

    const fn = await ask('what is a closure in javascript?');
    assert.match(fn, /closure/i);

    const math = await ask('what is 2+2*10?');
    assert.match(math, /= 22/);

    const thanks = await ask('thank you!');
    assert.match(thanks, /welcome/i);

    const q1 = await ask('explain blockchain consensus simply');
    const q2 = await ask('why is the sky blue at noon?');
    assert.notStrictEqual(q1, q2, 'two questions must not get identical replies');
    assert.ok(q1.includes('blockchain'), 'fallback quotes the question keywords');
    assert.ok(q2.includes('sky'), 'fallback quotes the question keywords');
    assert.ok(!q1.includes("I'm **Studio Agent v2**, Dev Studio's built-in offline engine. I plan"), 'fallback is not the intro');

    // build-shaped questions still scaffold real files
    const build = await ask('can you write a cli tool for me?');
    const acts = agent.parseActions(build);
    assert.ok(acts.some((a) => a.type === 'write_file'), 'build-shaped question still builds');
  });

  console.log('\nGame Studio');
  const vm = require('node:vm');

  await test('GameKit engine + all genre templates are valid JavaScript', () => {
    const files = [
      'shared/gamekit/engine.js',
      ...['arena', 'platformer', 'shmup', 'runner'].map((g) => `shared/gamekit/templates/${g}.js`)
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      new vm.Script(src, { filename: f }); // throws on any syntax error
    }
  });

  await test('game_new scaffolds engine + template + page into the workspace', () => {
    const entry = require('../plugins/game-studio/index.cjs');
    const written = {};
    const ctx = {
      ws: { write: (rel, content) => { written[rel] = content; }, tree: () => [], read: () => '' },
      runShell: async () => ({ ok: true, output: '' }),
      workspace: tmp
    };
    const tool = entry.tools.find((t) => t.name === 'game_new');
    const r = tool.run({ genre: 'space shooter', dir: 'game' }, ctx);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.spec.control, 'space', 'request words become a spec');
    assert.ok(written['game/engine.js'].includes('class GameKit'));
    assert.ok(written['game/game.js'].includes('GAME_SPEC'), 'composed games carry their DNA');
    assert.ok(written['game/index.html'].includes('<canvas'));
    // explicit preset still uses the hand-tuned template
    const r2 = tool.run({ genre: 'platformer', dir: 'game2' }, ctx);
    assert.strictEqual(r2.genre, 'platformer');
    assert.ok(written['game2/game.js'].includes('MONO JUMP'));
    // city preset scaffolds the mini open-world game
    const r3 = tool.run({ genre: 'city', dir: 'game3' }, ctx);
    assert.strictEqual(r3.genre, 'city');
    assert.ok(written['game3/game.js'].includes('__cityGame'), 'city template landed intact');
    assert.ok(written['game3/index.html'].includes('GRAND THEFT MONO'));
    // genre word-matching routes GTA-ish asks to city
    assert.strictEqual(entry.genreOf('a gta clone'), 'city');
    assert.strictEqual(entry.genreOf('open world crime game'), 'city');
    const list = entry.tools.find((t) => t.name === 'game_list');
    ctx.ws.tree = () => [{ name: 'game', path: 'game', type: 'dir', children: [
      { name: 'game.js', path: 'game/game.js', type: 'file' },
      { name: 'engine.js', path: 'game/engine.js', type: 'file' }
    ] }];
    ctx.ws.read = () => written['game/game.js'];
    const l = list.run({}, ctx);
    assert.strictEqual(l.games.length, 1);
    assert.strictEqual(l.games[0].dir, 'game');
  });

  await test('builtin routes game requests to the Game Studio plugin', async () => {
    const mk = (t) => providers.chat('builtin', null, [{ role: 'user', content: t }]);
    const a1 = agent.parseActions(await mk('make a space shooter game with bombs'));
    const s1 = a1.find((a) => a.type === 'game_new');
    assert.ok(s1, 'game_new emitted');
    assert.strictEqual(s1.spec.control, 'space');
    assert.ok(s1.spec.modifiers.includes('bomb'));
    const a2 = agent.parseActions(await mk('make a platformer game'));
    assert.ok(a2.some((a) => a.type === 'game_new' && a.genre === 'platformer'));
    const a3 = agent.parseActions(await mk('make a game'));
    assert.ok(a3.some((a) => a.type === 'game_new' && a.dir === 'game'));
    assert.ok(a3.some((a) => a.type === 'game_check'), 'game is verified after scaffolding');
    const gtaReply = await mk('make me a game like gta');
    assert.match(gtaReply, /GRAND THEFT MONO/);
    const a4 = agent.parseActions(gtaReply);
    assert.ok(a4.some((a) => a.type === 'game_new' && a.genre === 'city'));
    // question-shaped GTA query hits the knowledge base, not the scaffold
    const kb = await mk('how are gta style open-world games made?');
    assert.match(kb, /pillars|streamed world/i);
    assert.ok(!agent.parseActions(kb).some((a) => a.type === 'game_new'), 'questions must not scaffold');
  });

  await test('city (mini-GTA) mechanics work under the hood', () => {
    const { runGame } = require('./harness/headless.cjs');
    const engine = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gamekit', 'engine.js'), 'utf8');
    const city = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gamekit', 'templates', 'city.js'), 'utf8');
    const sb = runGame({ engineSrc: engine, gameSrc: city, frames: 600 });
    const G = sb.__cityGame;
    assert.ok(G, 'test hook exposed');
    assert.ok(G.buildings.length > 20 && G.cars.length >= 12 && G.peds.length >= 12);
    assert.equal(typeof G.wanted, 'number');
    // hit-and-run raises the wanted level
    G.state = 'play';
    const car = G.cars[0];
    G.player.inCar = car; G.player.x = car.x; G.player.y = car.y;
    car.angle = 0; car.speed = 200;
    const ped = G.peds[0]; ped.x = car.x + 18; ped.y = car.y;
    const w0 = G.wanted;
    G.scene.update(G, 1 / 60);
    assert.ok(G.wanted > w0, 'running over a ped is a crime');
    // wanted level brings the police
    G.wanted = 4; G.spawnT = 0.05;
    for (let i = 0; i < 150; i += 1) G.scene.update(G, 1 / 60);
    assert.ok(G.cops.length >= 1, 'cops spawn for wanted players');
    // on foot and cornered -> BUSTED (the ramming phase may have WASTED him: reset,
    // and stage it at an open intersection so building push-out cannot flake)
    G.state = 'play'; G.player.hp = 100;
    G.player.inCar = null; G.player.arrestT = 0;
    G.player.x = 848; G.player.y = 848;
    G.cops.length = 0;
    G.cops.push({ x: 860, y: 848, w: 46, h: 24, angle: Math.PI, speed: 0, hp: 50, flash: 0 });
    for (let i = 0; i < 90; i += 1) G.scene.update(G, 1 / 60);
    assert.equal(G.state, 'over', 'arrest ends the run');
    assert.match(String(G._overReason || ''), /BUSTED/);
  });

  await test('every shipped game runs 600 simulated frames headlessly', () => {
    const { runGame } = require('./harness/headless.cjs');
    const engine = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gamekit', 'engine.js'), 'utf8');
    for (const t of ['arena', 'platformer', 'shmup', 'runner', 'composed', 'city']) {
      const game = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gamekit', 'templates', `${t}.js`), 'utf8');
      runGame({ engineSrc: engine, gameSrc: game, frames: 600 }); // throws on any runtime error
    }
  });

  await test('composed games from very different requests all run headlessly', () => {
    const { runGame } = require('./harness/headless.cjs');
    const { parseSpec } = require('../shared/gamekit/spec.cjs');
    const engine = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gamekit', 'engine.js'), 'utf8');
    const composed = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gamekit', 'templates', 'composed.js'), 'utf8');
    const requests = [
      'make a zombie survival game with dash',
      'flappy bird style pipe runner',
      'space shooter with bombs and rapid fire',
      'platformer reach the flag with double jump',
      'collect gems topdown unarmed with magnet and shield'
    ];
    const seen = new Set();
    for (const r of requests) {
      const spec = parseSpec(r);
      seen.add(JSON.stringify([spec.control, spec.enemies, spec.goal]));
      const src = `const GAME_SPEC = ${JSON.stringify(spec)};\n` + composed;
      runGame({ engineSrc: engine, gameSrc: src, frames: 400 });
    }
    assert.ok(seen.size >= 4, `requests must produce different DNA, got ${seen.size}`);
  });

  await test('parseSpec turns sentences into different game DNA', () => {
    const { parseSpec, describeSpec } = require('../shared/gamekit/spec.cjs');
    const a = parseSpec('zombie survival arena with dash');
    const b = parseSpec('flappy pipe runner');
    const c = parseSpec('space shooter with bombs');
    assert.strictEqual(a.control, 'topdown');
    assert.ok(a.enemies.includes('chaser'));
    assert.ok(a.modifiers.includes('dash'));
    assert.strictEqual(b.control, 'flap');
    assert.ok(b.enemies.includes('pipes'));
    assert.strictEqual(c.control, 'space');
    assert.ok(c.modifiers.includes('bomb'));
    assert.notStrictEqual(describeSpec(a), describeSpec(b));
    assert.strictEqual(parseSpec('collect gems, no weapons, pacifist').weapon, 'none');
    assert.strictEqual(parseSpec('neon cyber survival').theme, 'neon');
  });

  console.log('\nWorkspace Inspector');

  await test('project_analyze reports stack, sizes and TODOs; find_code greps', () => {
    const entry = require('../plugins/workspace-inspector/index.cjs');
    const dir = path.join(tmp, 'proj');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', dependencies: { react: '1' } }));
    fs.writeFileSync(path.join(dir, 'src', 'app.jsx'), 'import React from "react";\n// TODO: fix this\nconst x = 1;\n'.repeat(3));
    fs.writeFileSync(path.join(dir, 'src', 'big.txt'), 'x'.repeat(5000));
    const ctx = { workspace: dir, ws: { tree: () => [] }, runShell: async () => ({ ok: true }) };
    const an = entry.tools.find((t) => t.name === 'project_analyze').run({}, ctx);
    assert.strictEqual(an.ok, true);
    assert.match(an.report, /PROJECT AUDIT/);
    assert.ok(an.todos >= 3, 'TODO markers counted');
    assert.ok(an.signals.includes('React'), 'stack detected');
    const fc = entry.tools.find((t) => t.name === 'find_code').run({ query: 'TODO' }, ctx);
    assert.ok(fc.count >= 3);
    assert.match(fc.hits[0], /app\.jsx:\d+:/);
  });

  await test('builtin emits analyze and find actions for project questions', async () => {
    const mk = (t) => providers.chat('builtin', null, [{ role: 'user', content: t }]);
    const a1 = agent.parseActions(await mk('analyze my project'));
    assert.ok(a1.some((a) => a.type === 'project_analyze'));
    const a2 = agent.parseActions(await mk('find "TODO" in my code'));
    const f = a2.find((a) => a.type === 'find_code');
    assert.ok(f, 'find_code emitted');
    assert.strictEqual(f.query, 'TODO');
  });

  console.log('\nStudio Agent v3 brain');
  const brain = require('../shared/builtin.cjs');

  await test('brain reads real workspace files to explain them', async () => {
    const dir = path.join(tmp, 'brainws');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'logic.js'),
      'const fs = require("fs");\nfunction add(a, b) { return a + b; }\nfunction mul(a, b) { return a * b; }\nmodule.exports = { add, mul };\n// TODO: div\n');
    brain.setWorkspace(makeWorkspaceHelpers({ value: dir }));
    const r = await brain.chat('studio-agent-2', [{ role: 'user', content: 'explain logic.js' }]);
    assert.match(r, /add/);
    assert.match(r, /mul/);
    assert.match(r, /TODO/);
    assert.match(r, /lines/);
    const show = await brain.chat('studio-agent-2', [{ role: 'user', content: 'show logic.js' }]);
    assert.match(show, /function add/);
  });

  await test('error doctor diagnoses pasted traces with concrete fixes', async () => {
    const r1 = await brain.chat('x', [{ role: 'user', content: "node server.js\nError: Cannot find module 'express'\n    at require (node.js:1:1)" }]);
    assert.match(r1, /missing module/i);
    assert.match(r1, /npm install express/);
    const acts = agent.parseActions(r1);
    assert.ok(acts.some((a) => a.type === 'run_command' && /npm install express/.test(a.command)));
    const r2 = await brain.chat('x', [{ role: 'user', content: 'listen EADDRINUSE: address already in use :::8080' }]);
    assert.match(r2, /port/i);
    const r3 = await brain.chat('x', [{ role: 'user', content: "TypeError: app.listen is not a function" }]);
    assert.match(r3, /type error/i);
  });

  await test('refactor splits a real file into modules and the result runs', async () => {
    const dir = path.join(tmp, 'brainws');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'util.js'), [
      'const fs = require("fs");',
      '',
      'function add(a, b) {',
      '  const tricky = "unbalanced } brace in string";',
      '  return a + b + tricky.length;',
      '}',
      '',
      'function greet(name) {',
      '  // a comment with a } brace',
      '  return `Hello ${name}!`;',
      '}',
      '',
      'function main() {',
      '  console.log(greet("world"), add(1, 2), fs.existsSync("."));',
      '}',
      '',
      'main();',
      ''
    ].join('\n'));
    const reply = await brain.chat('x', [{ role: 'user', content: 'refactor util.js' }]);
    assert.match(reply, /util-lib\.js/);
    const acts = agent.parseActions(reply);
    const writes = acts.filter((a) => a.type === 'write_file');
    assert.ok(writes.some((w) => w.path === 'util-lib.js' && /module\.exports/.test(w.content) && /function add/.test(w.content)));
    assert.ok(writes.some((w) => w.path === 'util.js' && /require\('.\/util-lib\.js'\)/.test(w.content)));
    assert.ok(acts.some((a) => a.type === 'run_command' && /node --check/.test(a.command)));
    // main() calls greet/add, so it must STAY in util.js (dependency guard)
    const lib = writes.find((w) => w.path === 'util-lib.js');
    assert.ok(/function greet/.test(lib.content) && /function add/.test(lib.content));
    assert.ok(!/function main/.test(lib.content));
    // execute for real, then run — behaviour must be unchanged
    const wsR = makeWorkspaceHelpers({ value: dir });
    await agent.executeActions(acts, wsR);
    const check = await agent.runShell('node --check util-lib.js && node --check util.js && node util.js', dir, 30000);
    assert.equal(check.code, 0, 'refactored project must pass --check and run: ' + check.stderr);
    assert.match(check.stdout, /Hello world!/);
    // guards: refusing to overwrite an existing target, and ESM files
    const again = await brain.chat('x', [{ role: 'user', content: 'split util.js into util-lib.js' }]);
    assert.match(again, /pehle se maujood/);
    fs.writeFileSync(path.join(dir, 'esm.js'), 'export function a() {}\nexport function b() {}\n');
    const esm = await brain.chat('x', [{ role: 'user', content: 'refactor esm.js' }]);
    assert.match(esm, /ES modules/);
  });

  await test('follow-ups work: run it, fix it, rename, guarded delete', async () => {
    fs.writeFileSync(path.join(tmp, 'brainws', 'hello.js'), 'console.log(1);\n');
    await brain.chat('x', [{ role: 'user', content: 'write a node script that greets me' }]);
    const run = await brain.chat('x', [{ role: 'user', content: 'run it' }]);
    const acts = agent.parseActions(run);
    assert.ok(acts.some((a) => a.type === 'run_command' && /node hello\.js/.test(a.command)), 'runs the last scaffolded file');

    await brain.chat('x', [{ role: 'user', content: "Error: Cannot find module 'left-pad'" }]);
    const fix = await brain.chat('x', [{ role: 'user', content: 'fix it' }]);
    assert.ok(agent.parseActions(fix).some((a) => /npm install left-pad/.test(a.command || '')), 'replays the stored fix');

    const ren = await brain.chat('x', [{ role: 'user', content: 'rename hello.js to greet.js' }]);
    assert.ok(agent.parseActions(ren).some((a) => a.type === 'run_command' && /(mv|move)/.test(a.command)));

    const guard = await brain.chat('x', [{ role: 'user', content: 'delete hello.js' }]);
    assert.match(guard, /confirm/i);
    assert.strictEqual(agent.parseActions(guard).length, 0, 'delete needs explicit confirmation');
    const conf = await brain.chat('x', [{ role: 'user', content: 'yes delete hello.js' }]);
    assert.ok(agent.parseActions(conf).some((a) => /(rm|del)/.test(a.command)));
  });

  console.log('\nAutopilot');
  const autopilot = require('../shared/autopilot.cjs');

  await test('autopilot runs a JSON plan and verifies it in one pass', async () => {
    const dir = path.join(tmp, 'auto1');
    fs.mkdirSync(dir, { recursive: true });
    const wsAuto = makeWorkspaceHelpers({ value: dir });
    let calls = 0;
    const chat = async () => {
      calls += 1;
      return JSON.stringify({
        summary: 'add util', done: 'a.js verified',
        steps: [{ title: 'write a.js', actions: [{ type: 'write_file', path: 'a.js', content: 'console.log(1);\n' }] }],
        verify: ['node --check a.js']
      });
    };
    const r = await autopilot.runMission({ goal: 'add util', provider: 'frontier', ws: wsAuto, permissions: { writeFiles: true, runCommands: true }, chat, maxIterations: 2 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(calls, 1, 'no fix loop when verify passes');
    assert.ok(fs.existsSync(path.join(dir, 'a.js')));
    assert.deepStrictEqual(r.files, ['a.js']);
  });

  await test('autopilot fix loop recovers from a failing verify', async () => {
    const dir = path.join(tmp, 'auto2');
    fs.mkdirSync(dir, { recursive: true });
    const wsAuto = makeWorkspaceHelpers({ value: dir });
    let calls = 0;
    const chat = async () => {
      calls += 1;
      const broken = calls === 1;
      return JSON.stringify({
        summary: broken ? 'first try' : 'fix', done: 'fixed',
        steps: [{ title: 'write', actions: [{ type: 'write_file', path: 'b.js', content: broken ? 'console.log(;\n' : 'console.log(2);\n' }] }],
        verify: ['node --check b.js']
      });
    };
    const r = await autopilot.runMission({ goal: 'fix', provider: 'frontier', ws: wsAuto, permissions: { writeFiles: true, runCommands: true }, chat, maxIterations: 3 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.iterations.length, 2, 'one failing iteration, then a fix');
    assert.strictEqual(calls, 2);
  });

  await test('autopilot respects permission gates and reports skips', async () => {
    const dir = path.join(tmp, 'auto3');
    fs.mkdirSync(dir, { recursive: true });
    const wsAuto = makeWorkspaceHelpers({ value: dir });
    const chat = async () => JSON.stringify({
      summary: 'write', done: '',
      steps: [{ title: 'w', actions: [{ type: 'write_file', path: 'c.js', content: 'x\n' }] }],
      verify: []
    });
    const r = await autopilot.runMission({ goal: 'g', provider: 'frontier', ws: wsAuto, permissions: { writeFiles: false, runCommands: false }, chat, maxIterations: 1 });
    assert.ok(!fs.existsSync(path.join(dir, 'c.js')), 'write must be refused');
    assert.ok(r.iterations[0].skipped.some((s) => s.includes('write c.js')));
    assert.strictEqual(r.ok, true, 'nothing to verify -> ok, but skips stay visible');
  });

  await test('autopilot with the offline built-in planner scaffolds and verifies', async () => {
    const dir = path.join(tmp, 'auto4');
    fs.mkdirSync(dir, { recursive: true });
    const wsAuto = makeWorkspaceHelpers({ value: dir });
    const r = await autopilot.runMission({
      goal: 'build me a website',
      provider: 'builtin',
      ws: wsAuto,
      permissions: { writeFiles: true, runCommands: true },
      chat: (pr, md, messages) => providers.chat(pr, md, messages),
      maxIterations: 2
    });
    assert.strictEqual(r.ok, true, r.error || 'builtin mission should verify');
    assert.ok(fs.existsSync(path.join(dir, 'index.html')));
  });

  console.log('\nDeep agent (web research + build + check)');
  const websearch = require('../shared/websearch.cjs');
  const deep = require('../shared/deep.cjs');
  const brainD = require('../shared/builtin.cjs');

  const DDG_HTML = [
    '<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fen%2Fblog&rut=abc">Node.js &mdash; Latest Releases</a>',
    '<a class="result__snippet" rel="nofollow" href="#">The latest <b>version</b> of Node.js ships weekly.</a></div>',
    '<div class="result"><a rel="nofollow" class="result__a" href="https://example.com/two">Second &amp; result</a>',
    '<a class="result__snippet" rel="nofollow" href="#">Another snippet here.</a></div>'
  ].join('\n');
  const WIKI_OPEN = JSON.stringify(['express', ['Express (web framework)'], ['Express is a back-end web framework for Node.js.'], ['https://en.wikipedia.org/wiki/Express_(web_framework)']]);
  const WIKI_EXTRACT = JSON.stringify({ query: { pages: { '1': { extract: 'Express is a minimal and flexible Node.js web application framework.' } } } });

  function mockFetch(map) {
    return async (url) => {
      for (const k of Object.keys(map)) {
        if (String(url).includes(k)) return { ok: true, status: 200, text: async () => map[k] };
      }
      return { ok: false, status: 404, text: async () => '' };
    };
  }

  await test('websearch parses DuckDuckGo and falls back to Wikipedia', async () => {
    const ddg = await websearch.deepResearch('node latest version', { fetchImpl: mockFetch({ 'duckduckgo.com/html': DDG_HTML }) });
    assert.equal(ddg.source, 'duckduckgo');
    assert.equal(ddg.results.length, 2);
    assert.equal(ddg.results[0].url, 'https://nodejs.org/en/blog'); // uddg redirect unwrapped
    assert.match(ddg.results[0].title, /Node\.js — Latest Releases/); // entities decoded, tags stripped
    assert.match(ddg.results[1].title, /Second & result/);
    assert.match(ddg.results[0].snippet, /latest version of Node\.js/);
    const wiki = await websearch.deepResearch('express framework', { fetchImpl: mockFetch({ 'action=opensearch': WIKI_OPEN, 'prop=extracts': WIKI_EXTRACT }) });
    assert.equal(wiki.source, 'wikipedia');
    assert.equal(wiki.results[0].url, 'https://en.wikipedia.org/wiki/Express_(web_framework)');
    assert.match(wiki.summary, /minimal and flexible/);
    const dead = await websearch.deepResearch('anything', { fetchImpl: mockFetch({}) });
    assert.equal(dead.offline, true);
    assert.equal(dead.results.length, 0);
  });

  await test('built-in brain answers "search X" with cited live results', async () => {
    websearch.setFetch(mockFetch({ 'duckduckgo.com/html': DDG_HTML }));
    try {
      const r = await brainD.chat('x', [{ role: 'user', content: 'search node js latest version' }]);
      assert.match(r, /live web se \(duckduckgo\)/);
      assert.match(r, /\[Node\.js — Latest Releases\]\(https:\/\/nodejs\.org\/en\/blog\)/);
      const offline = await websearch.deepResearch('x', { fetchImpl: mockFetch({}) });
      assert.equal(offline.offline, true);
    } finally { websearch.setFetch(null); }
    websearch.setFetch(mockFetch({})); // no network at all
    const honest = await brainD.chat('x', [{ role: 'user', content: 'search quantum news' }]);
    assert.match(honest, /kuch nahi mila/);
    websearch.setFetch(null);
  });

  await test('deep answer mode: research question gets a cited answer, no writes', async () => {
    const dir = path.join(tmp, 'deepws');
    fs.mkdirSync(dir, { recursive: true });
    const r = await deep.deepRun({
      goal: 'what is express in node.js?',
      ws: makeWorkspaceHelpers({ value: dir }),
      chat: (pr, md, msgs) => brainD.chat(md, msgs),
      fetchImpl: mockFetch({ 'action=opensearch': WIKI_OPEN, 'prop=extracts': WIKI_EXTRACT })
    });
    assert.equal(r.mode, 'answer');
    assert.equal(r.ok, true);
    assert.match(r.answer, /wikipedia\.org\/wiki\/Express/);
    assert.match(r.answer, /minimal and flexible/);
    assert.equal(r.mission, null);
    assert.equal(r.checks.length, 0);
    assert.equal(fs.readdirSync(dir).length, 0); // nothing was written
  });

  await test('deep build mode: research rides along, mission runs, checks prove files', async () => {
    const dir = path.join(tmp, 'deepws2');
    fs.mkdirSync(dir, { recursive: true });
    const wsB = makeWorkspaceHelpers({ value: dir });
    brainD.setWorkspace(wsB);
    const r = await deep.deepRun({
      goal: 'research the latest css framework and build me a website',
      ws: wsB,
      permissions: { writeFiles: true, runCommands: true },
      chat: (pr, md, msgs) => brainD.chat(md, msgs),
      fetchImpl: mockFetch({ 'duckduckgo.com/html': DDG_HTML })
    });
    assert.equal(r.mode, 'build');
    assert.ok(r.research && r.research.count >= 2, 'live sources were gathered first');
    assert.equal(r.mission.ok, true, 'mission verified: ' + JSON.stringify(r.mission.iterations));
    assert.ok(r.mission.files.length > 0);
    assert.ok(fs.existsSync(path.join(dir, 'index.html')));
    for (const c of r.checks) assert.equal(c.code, 0, 'check must pass: ' + c.cmd + ' ' + c.out);
    assert.equal(r.ok, true);
  });

  await test('deep offline fallback answers honestly and gates permissions', async () => {
    const dir = path.join(tmp, 'deepws3');
    fs.mkdirSync(dir, { recursive: true });
    const off = await deep.deepRun({
      goal: 'what is recursion?',
      ws: makeWorkspaceHelpers({ value: dir }),
      chat: (pr, md, msgs) => brainD.chat(md, msgs),
      fetchImpl: mockFetch({}) // every source dead
    });
    assert.equal(off.mode, 'answer');
    assert.match(off.answer, /built-in knowledge se/);
    const gated = await deep.deepRun({
      goal: 'build me a website',
      ws: makeWorkspaceHelpers({ value: dir }),
      permissions: { writeFiles: false, runCommands: false },
      chat: (pr, md, msgs) => brainD.chat(md, msgs),
      fetchImpl: mockFetch({})
    });
    assert.equal(gated.mode, 'build');
    assert.ok(gated.mission.iterations.some((it) => it.skipped && it.skipped.length > 0), 'skips must be visible');
    assert.equal(gated.checks.length, 0, 'no runCommands -> no check commands');
    assert.equal(fs.readdirSync(dir).length, 0, 'gated mission wrote nothing');
  });

  console.log('\nReAct agent (step-by-step tool loop)');
  const react = require('../shared/react.cjs');

  function scripted(replies) {
    let i = 0;
    return async () => replies[Math.min(i, replies.length - 1)] && replies[i++] || replies[replies.length - 1];
  }

  await test('parseToolCall is fence-tolerant and rejects rambling', async () => {
    assert.deepEqual(react.parseToolCall('```tool\n{"tool":"done","answer":"hi"}\n```'), { tool: 'done', answer: 'hi' });
    assert.deepEqual(react.parseToolCall('Sure! ```json {"tool":"list_files"} ``` Let me look.'), { tool: 'list_files' });
    assert.deepEqual(react.parseToolCall('{"tool":"read_file","path":"a.js"}'), { tool: 'read_file', path: 'a.js' });
    assert.equal(react.parseToolCall('I think we should consider many options here'), null);
    assert.equal(react.parseToolCall('{"nope": true}'), null);
  });

  await test('react loop: search -> write -> verify -> done, all observed for real', async () => {
    const dir = path.join(tmp, 'reactws');
    fs.mkdirSync(dir, { recursive: true });
    const wsR = makeWorkspaceHelpers({ value: dir });
    const chat = scripted([
      '```tool\n{"tool":"web_search","query":"node js hello world best practice"}\n```',
      'Let me write the file. ```tool\n{"tool":"write_file","path":"hello.js","content":"console.log(\'hello react\');\\n"}\n```',
      '```tool\n{"tool":"run_command","command":"node --check hello.js && node hello.js"}\n```',
      '```tool\n{"tool":"done","answer":"hello.js likh diya aur verify kar liya.","files":["hello.js"]}\n```'
    ]);
    const r = await react.runAgent({
      goal: 'write and verify hello.js',
      provider: 'openai', model: 'gpt-test', ws: wsR,
      permissions: { writeFiles: true, runCommands: true },
      chat,
      fetchImpl: mockFetch({ 'duckduckgo.com/html': DDG_HTML })
    });
    assert.equal(r.ok, true);
    assert.equal(r.engine, 'react');
    assert.match(r.answer, /verify kar liya/);
    assert.deepEqual(r.files, ['hello.js']);
    assert.equal(r.steps.length, 4);
    assert.equal(r.steps[0].tool, 'web_search');
    assert.match(r.steps[0].observation, /nodejs\.org/); // live results reached the model
    assert.match(r.steps[1].observation, /wrote hello\.js/);
    assert.match(r.steps[2].observation, /exit 0/);
    assert.match(r.steps[2].observation, /hello react/); // real stdout observed
    assert.equal(fs.readFileSync(path.join(dir, 'hello.js'), 'utf8'), "console.log('hello react');\n");
  });

  await test('react gates writes/commands and reports skips back to the model', async () => {
    const dir = path.join(tmp, 'reactws2');
    fs.mkdirSync(dir, { recursive: true });
    const chat = scripted([
      '{"tool":"write_file","path":"x.js","content":"1"}',
      '{"tool":"run_command","command":"node x.js"}',
      '{"tool":"done","answer":"permissions ki wajah se kuch nahi likha."}'
    ]);
    const r = await react.runAgent({
      goal: 'make something', provider: 'openai', ws: makeWorkspaceHelpers({ value: dir }),
      permissions: { writeFiles: false, runCommands: false }, chat, fetchImpl: mockFetch({})
    });
    assert.equal(r.steps[0].skipped, true);
    assert.match(r.steps[0].observation, /SKIPPED by permissions/);
    assert.equal(r.steps[1].skipped, true);
    assert.deepEqual(r.files, []);
    assert.equal(fs.readdirSync(dir).length, 0);
  });

  await test('react nudges rambling models and caps the loop', async () => {
    const dir = path.join(tmp, 'reactws3');
    fs.mkdirSync(dir, { recursive: true });
    const chat = scripted(['Hmm, let me think about the best approach here...']);
    const r = await react.runAgent({
      goal: 'anything', provider: 'openai', ws: makeWorkspaceHelpers({ value: dir }), chat, maxSteps: 3, fetchImpl: mockFetch({})
    });
    assert.equal(r.steps.length, 2); // nudge once, then the second ramble becomes the answer
    assert.match(r.steps[0].observation, /nudged/);
    assert.match(r.answer, /best approach/); // second ramble becomes the answer
  });

  await test('deep build mode uses the react loop for connected providers and checks files', async () => {
    const dir = path.join(tmp, 'reactws4');
    fs.mkdirSync(dir, { recursive: true });
    const chat = scripted([
      '```tool\n{"tool":"list_files"}\n```',
      '```tool\n{"tool":"write_file","path":"app.js","content":"const x = 41 + 1;\\nconsole.log(x);\\n"}\n```',
      '```tool\n{"tool":"run_command","command":"node --check app.js"}\n```',
      '```tool\n{"tool":"done","answer":"app.js ready and verified."}\n```'
    ]);
    const r = await deep.deepRun({
      goal: 'build a tiny script that prints 42',
      provider: 'openai', model: 'gpt-test',
      ws: makeWorkspaceHelpers({ value: dir }),
      permissions: { writeFiles: true, runCommands: true },
      chat, fetchImpl: mockFetch({})
    });
    assert.equal(r.mode, 'build');
    assert.equal(r.engine, 'react');
    assert.equal(r.ok, true);
    assert.deepEqual(r.mission.files, ['app.js']);
    assert.equal(r.checks.length, 1);
    assert.equal(r.checks[0].code, 0); // CHECK phase re-proved the file locally
    assert.match(r.react.answer, /verified/);
  });

  console.log('\nMission experience (agent learns from past runs)');
  const { ExperienceStore } = require('../shared/experience.cjs');

  await test('experience store persists, ranks relevance, caps and clears', async () => {
    const dir = path.join(tmp, 'expws');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, '.dev-studio', 'experience.json');
    const store = new ExperienceStore(file);
    store.record({ goal: 'build me a landing page with a navbar', engine: 'react', ok: true, files: ['index.html'], lesson: 'verified with node --check; navbar css grid worked' });
    store.record({ goal: 'write a snake game in python', engine: 'mission', ok: false, files: [], failures: ['VERIFY FAILED: python syntax'], lesson: 'py_compile caught an indentation error' });
    assert.equal(fs.existsSync(file), true);
    const reloaded = new ExperienceStore(file);
    assert.equal(reloaded.stats().total, 2);
    assert.equal(reloaded.stats().failures, 1);
    const rel = reloaded.relevant('build a landing page for my portfolio');
    assert.ok(rel.length >= 1 && /landing page/.test(rel[0].goal)); // token overlap wins
    const block = reloaded.contextBlock('add a navbar to my page');
    assert.match(block, /Lessons from previous missions/);
    assert.match(block, /navbar/);
    for (let i = 0; i < 45; i += 1) reloaded.record({ goal: `filler task number ${i}`, ok: true, lesson: 'filler' });
    assert.equal(reloaded.get().length, 40); // capped
    assert.equal(reloaded.clear('failures').failures, 0);
    assert.equal(reloaded.clear().total, 0);
  });

  await test('deepRun injects relevant lessons into the plan prompt and records the outcome', async () => {
    const dir = path.join(tmp, 'expws2');
    fs.mkdirSync(dir, { recursive: true });
    const store = new ExperienceStore(path.join(dir, '.dev-studio', 'experience.json'));
    store.record({ goal: 'build me a website about tea', engine: 'mission', ok: false, failures: ['VERIFY FAILED (1): node --check script.js'], lesson: 'script.js had a stray comma; run node --check before done' });
    const seen = [];
    const r = await deep.deepRun({
      goal: 'build me a website about coffee',
      ws: makeWorkspaceHelpers({ value: dir }),
      permissions: { writeFiles: true, runCommands: true },
      chat: async (pr, md, msgs) => { seen.push(msgs); return brainD.chat(md, msgs); },
      fetchImpl: mockFetch({}),
      experience: store
    });
    assert.equal(r.mode, 'build');
    assert.ok(r.priorCount >= 1, 'lessons were injected');
    const sysPrompt = seen[0].find((m) => m.role === 'system').content;
    assert.match(sysPrompt, /Lessons from previous missions/);
    assert.match(sysPrompt, /stray comma/); // the actual scar tissue reached the planner
    assert.equal(r.ok, true);
    const after = store.get();
    assert.ok(after.length >= 2);
    assert.match(after[0].goal, /coffee/); // this mission was recorded for next time
    assert.equal(after[0].ok, true);
    assert.match(after[0].lesson, /verify passed/);
  });

  await test('react agents get lessons in their system prompt; failed checks are remembered', async () => {
    const dir = path.join(tmp, 'expws3');
    fs.mkdirSync(dir, { recursive: true });
    const store = new ExperienceStore(path.join(dir, '.dev-studio', 'experience.json'));
    store.record({ goal: 'build a tiny script that prints numbers', engine: 'react', ok: false, failures: ['run_command: exit 1 SyntaxError'], lesson: 'always node --check after writing' });
    const seen = [];
    const badChat = scripted([
      '```tool\n{"tool":"write_file","path":"bad.js","content":"const = ;\\n"}\n```',
      '```tool\n{"tool":"done","answer":"done"}\n```'
    ]);
    const bad = await deep.deepRun({
      goal: 'build a tiny script that prints hello',
      provider: 'openai', model: 'gpt-test',
      ws: makeWorkspaceHelpers({ value: dir }),
      permissions: { writeFiles: true, runCommands: true },
      chat: async (pr, md, msgs) => { seen.push(msgs); return badChat(pr, md, msgs); },
      fetchImpl: mockFetch({}),
      experience: store
    });
    const sysPrompt = seen[0].find((m) => m.role === 'system').content;
    assert.match(sysPrompt, /always node --check after writing/); // lesson reached the ReAct agent
    assert.equal(bad.engine, 'react');
    assert.equal(bad.ok, false); // CHECK phase caught the broken file locally
    assert.match(bad.error, /CHECK FAILED/);
    const newest = store.get()[0];
    assert.equal(newest.ok, false);
    assert.match(newest.failures.join(' '), /CHECK FAILED/);
    assert.match(newest.lesson, /tools: write_file → done/);
  });

  console.log('\nApp lock & audit');
  const { LockManager } = require('../shared/lock.cjs');

  await test('PIN set / verify / change / clear (scrypt, no plaintext)', () => {
    const lm = new LockManager(path.join(tmp, 'lock.json'));
    assert.strictEqual(lm.isSet(), false);
    assert.throws(() => lm.setPin('12'), /at least 4/);
    lm.setPin('1234');
    assert.strictEqual(lm.isSet(), true);
    assert.strictEqual(lm.verify('1234'), true);
    assert.strictEqual(lm.verify('0000'), false);
    assert.throws(() => lm.changePin('9999', '5678'), /incorrect/);
    lm.changePin('1234', '5678');
    assert.strictEqual(lm.verify('5678'), true);
    const raw = fs.readFileSync(path.join(tmp, 'lock.json'), 'utf8');
    assert.ok(!raw.includes('5678'), 'PIN must never be stored in plaintext');
    lm.clearPin();
    assert.strictEqual(lm.isSet(), false);
  });

  await test('audit log records, reads newest-first, and clears', () => {
    const lm = new LockManager(path.join(tmp, 'lock2.json'));
    lm.audit('test.event', { a: 1 });
    lm.audit('test.two');
    const e = lm.readAudit();
    assert.strictEqual(e.length, 2);
    assert.strictEqual(e[0].event, 'test.two');
    lm.clearAudit();
    assert.strictEqual(lm.readAudit().length, 0);
  });

  await test('auto-lock minutes persist across instances', () => {
    const f = path.join(tmp, 'lock3.json');
    const lm = new LockManager(f);
    lm.setAutoLock(10);
    const lm2 = new LockManager(f);
    assert.strictEqual(lm2.getAutoLock(), 10);
  });

  await test('user plugins default OFF, official default ON', () => {
    const { PluginManager: PM } = require('../shared/plugins.cjs');
    const offDir = path.join(tmp, 'offdir');
    fs.mkdirSync(path.join(offDir, 'userplug'), { recursive: true });
    fs.writeFileSync(path.join(offDir, 'userplug', 'plugin.json'), JSON.stringify({ id: 'userplug', name: 'U', version: '1', entry: 'index.cjs' }));
    fs.writeFileSync(path.join(offDir, 'userplug', 'index.cjs'), 'module.exports={};');
    const pm = new PM({ dirs: [path.join(__dirname, '..', 'plugins'), offDir], persistFile: path.join(tmp, 'p2.json') });
    const list = pm.scan();
    assert.strictEqual(list.find((p) => p.id === 'userplug').enabled, false, 'user plugin must default off');
    assert.strictEqual(list.find((p) => p.id === 'ollama').enabled, true, 'official plugin defaults on');
  });

  console.log('\nLoopback bridge (Chrome <-> desktop app)');
  const http = require('node:http');
  const { startBridge } = require('../electron/bridge.cjs');

  await test('bridge serves the build, gates RPC by token, loopback only', async () => {
    const distDir = path.join(tmp, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html><body>bridge-ok</body></html>');

    const impl = {
      files: async () => ({ ok: true, tree: [{ name: 'a.txt', path: 'a.txt', type: 'file' }] }),
      echo: async (x) => ({ ok: true, x })
    };
    const b = await startBridge({ distDir, impl });

    try {
      assert.strictEqual(b.host, '127.0.0.1', 'bridge must bind loopback only');
      assert.ok(b.port > 0);
      assert.ok(b.url.includes(b.token), 'URL carries the token');
      assert.strictEqual(b.token.length, 64, '256-bit hex token');

      // page + assets are served from disk
      const page = await fetch(b.url);
      assert.strictEqual(page.status, 200);
      assert.match(await page.text(), /bridge-ok/);

      // correct token -> RPC reaches the same impl the desktop uses
      const good = await fetch(`http://127.0.0.1:${b.port}/api/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ds-token': b.token },
        body: JSON.stringify({ method: 'echo', args: ['hi'] })
      });
      assert.strictEqual(good.status, 200);
      assert.deepStrictEqual(await good.json(), { ok: true, x: 'hi' });

      // wrong / missing token -> 401
      const bad = await fetch(`http://127.0.0.1:${b.port}/api/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ds-token': 'nope' },
        body: JSON.stringify({ method: 'echo', args: ['hi'] })
      });
      assert.strictEqual(bad.status, 401);
      const anon = await fetch(`http://127.0.0.1:${b.port}/api/rpc`, { method: 'POST', body: '{}' });
      assert.strictEqual(anon.status, 401);

      // unknown method -> 404 (whitelist)
      const unknown = await fetch(`http://127.0.0.1:${b.port}/api/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ds-token': b.token },
        body: JSON.stringify({ method: 'constructor', args: [] })
      });
      assert.strictEqual(unknown.status, 404);

      // path traversal is neutralized: the URL parser collapses '..' before the
      // filesystem is touched, so a file outside dist/ can never be read.
      const secret = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
      const trav = await new Promise((resolve, reject) => {
        const rq = http.request(
          { host: '127.0.0.1', port: b.port, path: `/../package.json?ds_token=${b.token}`, method: 'GET' },
          (rs) => {
            const chunks = [];
            rs.on('data', (c) => chunks.push(c));
            rs.on('end', () => resolve({ status: rs.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
          }
        );
        rq.on('error', reject);
        rq.end();
      });
      assert.ok(!trav.body.includes('"electron-builder"'), 'traversal must not leak files outside dist/');
      assert.ok(trav.status === 403 || trav.status === 404 || trav.status === 200, `unexpected status ${trav.status}`);
      assert.ok(secret.includes('"electron-builder"'), 'sanity: the target file really is sensitive');
    } finally {
      await b.stop();
    }
  });

  await test('PIN brute force is throttled after 5 wrong attempts', () => {
    const lm = new LockManager(path.join(tmp, 'lock4.json'));
    lm.setPin('4321');
    assert.strictEqual(lm.attemptsLeft(), 5);
    for (let i = 0; i < 4; i += 1) assert.strictEqual(lm.verify('0000'), false);
    assert.strictEqual(lm.attemptsLeft(), 1);
    assert.strictEqual(lm.lockoutMs(), 0, 'no cooldown before the 5th failure');
    assert.strictEqual(lm.verify('0000'), false); // 5th wrong attempt
    assert.strictEqual(lm.attemptsLeft(), 0);
    const left = lm.lockoutMs();
    assert.ok(left > 0 && left <= 30_000, `cooldown should be running, got ${left}`);
    assert.strictEqual(lm.verify('4321'), false, 'even the correct PIN is refused during cooldown');
    // simulate the cooldown expiring
    lm.data.lockedUntil = Date.now() - 1;
    lm._save();
    assert.strictEqual(lm.lockoutMs(), 0);
    assert.strictEqual(lm.verify('4321'), true);
    assert.strictEqual(lm.attemptsLeft(), 5, 'counter resets after a success');
    assert.ok(lm.readAudit(50).some((e) => e.event === 'pin.lockout'), 'lockout must be audited');
  });

  await test('read-only bridge refuses mutating methods but still serves reads', async () => {
    const distDir = path.join(tmp, 'dist2');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html>ro</html>');

    let mode = 'full';
    const impl = {
      files: async () => ({ ok: true, tree: [] }),
      readFile: async (p) => ({ ok: true, content: `content of ${p}` }),
      writeFile: async () => ({ ok: true, wrote: true })
    };
    const b = await startBridge({
      distDir,
      impl,
      mutating: ['writeFile'],
      isReadOnly: () => mode === 'readonly'
    });
    const call = (method, args = []) => fetch(`http://127.0.0.1:${b.port}/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ds-token': b.token },
      body: JSON.stringify({ method, args })
    });

    try {
      const full = await call('writeFile', ['a.txt', 'hi']);
      assert.strictEqual(full.status, 200);
      assert.deepStrictEqual(await full.json(), { ok: true, wrote: true });

      mode = 'readonly';
      const blocked = await call('writeFile', ['a.txt', 'hi']);
      assert.strictEqual(blocked.status, 403);
      const bj = await blocked.json();
      assert.strictEqual(bj.ok, false);
      assert.strictEqual(bj.readOnly, true);
      assert.match(bj.error, /read-only/i);

      // reads keep working in read-only mode
      const read = await call('readFile', ['a.txt']);
      assert.strictEqual(read.status, 200);
      assert.strictEqual((await read.json()).content, 'content of a.txt');
      const list = await call('files');
      assert.strictEqual(list.status, 200);
    } finally {
      await b.stop();
    }
  });

  console.log('\nWorkspace memory');
  const { MemoryStore } = require('../shared/memory.cjs');

  await test('memory persists project, notes and tasks across reloads', () => {
    const f = path.join(tmp, 'ws', '.dev-studio', 'memory.json');
    const m = new MemoryStore(f);
    assert.strictEqual(m.contextBlock(), '', 'empty memory injects nothing into the prompt');

    m.setProject({ name: 'Shop', summary: 'E-commerce back office', stack: 'React, Node 20', conventions: ['2-space indent', 'no secrets in repo'] });
    const n = m.addNote({ title: 'Auth uses JWT', body: '15 min refresh tokens', tags: ['auth'] });
    const t = m.addTask({ title: 'Add rate limiting to /api/login' });

    const reloaded = new MemoryStore(f);
    assert.strictEqual(reloaded.get().project.name, 'Shop');
    assert.deepStrictEqual(reloaded.get().project.stack, ['React', 'Node 20']);
    assert.strictEqual(reloaded.get().notes[0].id, n.id);

    const ctx = reloaded.contextBlock();
    assert.match(ctx, /Project memory/);
    assert.match(ctx, /Auth uses JWT/);
    assert.match(ctx, /Add rate limiting/);
    assert.match(ctx, /no secrets in repo/);

    reloaded.setTaskStatus(t.id, 'done');
    assert.strictEqual(new MemoryStore(f).stats().done, 1);
    assert.ok(!new MemoryStore(f).contextBlock().includes('[done]'), 'finished tasks leave the prompt');
  });

  await test('memory caps run history and clears by kind', () => {
    const m = new MemoryStore(path.join(tmp, 'ws2', '.dev-studio', 'memory.json'));
    for (let i = 0; i < 60; i += 1) m.recordRun({ prompt: `p${i}`, provider: 'builtin', actions: 0, chars: 10 });
    assert.strictEqual(m.get().runs.length, 40, 'run history is capped');
    m.addTask({ title: 'x' });
    m.clear('tasks');
    assert.strictEqual(m.get().tasks.length, 0);
    m.addNote({ title: 'keep' });
    m.clear('all');
    assert.strictEqual(m.get().notes.length, 0);
    assert.throws(() => m.addNote({}), /title/i);
    assert.throws(() => m.addTask({}), /title/i);
  });

  await test('systemPrompt injects memory alongside plugin tools', () => {
    const base = agent.systemPrompt();
    const withMem = agent.systemPrompt('## Project memory\nStack: React, Electron');
    assert.ok(!base.includes('Project memory'));
    assert.match(withMem, /## Project memory/);
    assert.ok(withMem.startsWith(base), 'memory is appended after the standard prompt');
  });

  await test('guest tokens: read-only by default, expiring, revocable', async () => {
    const distDir = path.join(tmp, 'dist3');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html>guest</html>');

    const guests = [];
    let lastUsed = null;
    const impl = {
      files: async () => ({ ok: true, tree: [] }),
      writeFile: async () => ({ ok: true })
    };
    const b = await startBridge({
      distDir,
      impl,
      mutating: ['writeFile'],
      guests: () => guests,
      onGuestUse: (id) => { lastUsed = id; }
    });
    const call = (tok, method, args = []) => fetch(`http://127.0.0.1:${b.port}/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ds-token': tok },
      body: JSON.stringify({ method, args })
    });

    try {
      // no token at all
      assert.strictEqual((await call('', 'files')).status, 401);

      // read-only guest: reads fine, writes refused
      const g1 = { id: 'g1', label: 'reviewer', token: 'guest-token-one', readOnly: true, expiresAt: Date.now() + 60_000 };
      guests.push(g1);
      assert.strictEqual((await call(g1.token, 'files')).status, 200);
      const blocked = await call(g1.token, 'writeFile', ['a.txt', 'x']);
      assert.strictEqual(blocked.status, 403);
      assert.strictEqual((await blocked.json()).guest, true);
      assert.strictEqual(lastUsed, 'g1', 'guest use is tracked');

      // explicitly full-access guest may write
      const g2 = { id: 'g2', label: 'pair', token: 'guest-token-two', readOnly: false, expiresAt: Date.now() + 60_000 };
      guests.push(g2);
      assert.strictEqual((await call(g2.token, 'writeFile', ['a.txt', 'x'])).status, 200);

      // expired guest is rejected outright
      g1.expiresAt = Date.now() - 1000;
      assert.strictEqual((await call(g1.token, 'files')).status, 401);

      // revoked guest is rejected outright
      guests.length = 0;
      assert.strictEqual((await call(g2.token, 'files')).status, 401);

      // the owner token keeps working regardless
      assert.strictEqual((await call(b.token, 'files')).status, 200);
      assert.strictEqual((await call(b.token, 'writeFile', ['a.txt', 'x'])).status, 200);
    } finally {
      await b.stop();
    }
  });

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
