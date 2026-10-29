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
    assert.deepStrictEqual(ids, ['broken', 'demo', 'game-studio', 'git-tools', 'ollama', 'openrouter']);
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
    assert.strictEqual(r.genre, 'shmup', 'genre aliases resolve');
    assert.ok(written['game/engine.js'].includes('class GameKit'));
    assert.ok(written['game/game.js'].includes('STARFALL'));
    assert.ok(written['game/index.html'].includes('<canvas'));
    const list = entry.tools.find((t) => t.name === 'game_list');
    ctx.ws.tree = () => [{ name: 'game', path: 'game', type: 'dir', children: [
      { name: 'game.js', path: 'game/game.js', type: 'file' },
      { name: 'engine.js', path: 'game/engine.js', type: 'file' }
    ] }];
    ctx.ws.read = () => written['game/game.js'];
    const l = list.run({}, ctx);
    assert.strictEqual(l.games.length, 1);
    assert.strictEqual(l.games[0].title, 'STARFALL');
  });

  await test('builtin routes game requests to the Game Studio plugin', async () => {
    const mk = (t) => providers.chat('builtin', null, [{ role: 'user', content: t }]);
    const a1 = agent.parseActions(await mk('make a space shooter game'));
    assert.ok(a1.some((a) => a.type === 'game_new' && a.genre === 'shmup'));
    const a2 = agent.parseActions(await mk('make a platformer game'));
    assert.ok(a2.some((a) => a.type === 'game_new' && a.genre === 'platformer'));
    const a3 = agent.parseActions(await mk('make a game'));
    assert.ok(a3.some((a) => a.type === 'game_new' && a.dir === 'game'));
    assert.ok(a3.some((a) => a.type === 'game_check'), 'game is verified after scaffolding');
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
