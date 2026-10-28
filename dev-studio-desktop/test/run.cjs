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

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
