const { app, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { startBridge } = require('./bridge.cjs');
const { makeWorkspaceHelpers } = require('./workspace.cjs');
const { Terminal } = require('./terminal.cjs');
const providers = require('../shared/providers.cjs');
const agent = require('../shared/agent.cjs');
const orchestrator = require('../shared/orchestrator.cjs');
const { PluginManager } = require('../shared/plugins.cjs');
const { LockManager } = require('../shared/lock.cjs');

const state = { terminal: null, rootRef: null, permissions: null, bridge: null, bridgeMode: 'full' };
function getState() {
  return state;
}

function registerIpc(mainIpc, { workspace, getWindow }) {
  state.rootRef = { value: workspace };
  state.permissions = { runCommands: true, writeFiles: true };
  const ws = makeWorkspaceHelpers(state.rootRef);

  // Single source of truth for handlers: every channel is registered with
  // Electron AND kept here so the loopback bridge can call the very same
  // functions from Chrome. No duplicated logic, no second implementation.
  const handlers = new Map();
  const handle = (channel, fn) => {
    handlers.set(channel, fn);
    mainIpc.handle(channel, fn);
  };

  // Read keys from an env file sitting next to the app (or in userData),
  // so packaged builds can be configured without rebuilding.
  const envCandidates = [
    path.join(app.getPath('userData'), 'dev-studio.env'),
    path.join(path.dirname(app.getPath('exe')), 'dev-studio.env'),
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', 'dev-studio.env')
  ];
  for (const f of envCandidates) providers.loadKeysFromEnvFile(f);

  // ---------- plugin system ----------
  const userPluginDir = path.join(app.getPath('userData'), 'plugins');
  fs.mkdirSync(userPluginDir, { recursive: true });
  const pluginManager = new PluginManager({
    dirs: [path.join(__dirname, '..', 'plugins'), userPluginDir],
    persistFile: path.join(app.getPath('userData'), 'plugins.json')
  });
  pluginManager.scan();
  pluginManager.loadAll();
  state.pluginManager = pluginManager;

  handle('plugins:list', () => ({ ok: true, plugins: pluginManager.list(), dirs: pluginManager.dirs }));
  handle('plugins:scan', () => {
    pluginManager.scan();
    pluginManager.loadAll();
    return { ok: true, plugins: pluginManager.list() };
  });
  handle('plugins:setEnabled', (_e, id, on) => {
    const r = pluginManager.setEnabled(id, on);
    if (r.ok) state.lock?.audit(on ? 'plugin.enable' : 'plugin.disable', { id });
    return r;
  });
  handle('plugins:test', (_e, id) => pluginManager.test(id));
  handle('plugins:openFolder', async (_e, which) => {
    const dir = which === 'user' ? userPluginDir : pluginManager.dirs[0];
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    return { ok: !err, error: err || null, dir };
  });

  // ---------- app lock + audit ----------
  const lock = new LockManager(path.join(app.getPath('userData'), 'lock.json'));
  state.lock = lock;

  handle('lock:state', () => ({
    ok: true,
    set: lock.isSet(),
    autoLockMinutes: lock.getAutoLock(),
    attemptsLeft: lock.attemptsLeft(),
    retryInMs: lock.lockoutMs()
  }));
  handle('lock:set', (_e, pin) => {
    try { lock.setPin(pin); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  handle('lock:verify', (_e, pin) => {
    const retryBefore = lock.lockoutMs();
    if (retryBefore > 0) {
      return {
        ok: false,
        locked: true,
        retryInMs: retryBefore,
        attemptsLeft: 0,
        error: `Too many wrong PINs — locked for another ${Math.ceil(retryBefore / 1000)}s`
      };
    }
    const good = lock.verify(pin);
    if (good) lock.noteUnlock(); else lock.noteDenied();
    const retryInMs = lock.lockoutMs();
    return {
      ok: good,
      attemptsLeft: lock.attemptsLeft(),
      retryInMs,
      locked: retryInMs > 0,
      error: good ? undefined : (retryInMs > 0
        ? `Too many wrong PINs — locked for ${Math.ceil(retryInMs / 1000)}s`
        : 'Wrong PIN')
    };
  });
  handle('lock:change', (_e, oldPin, newPin) => {
    try { lock.changePin(oldPin, newPin); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  handle('lock:clear', () => { lock.clearPin(); return { ok: true }; });
  handle('lock:note', (_e, kind) => {
    if (kind === 'lock') lock.noteLock();
    else if (kind === 'unlock') lock.noteUnlock();
    return { ok: true };
  });
  handle('lock:autoLock', (_e, minutes) => { lock.setAutoLock(minutes); return { ok: true, autoLockMinutes: lock.getAutoLock() }; });
  handle('audit:read', (_e, limit) => ({ ok: true, entries: lock.readAudit(limit || 200) }));
  handle('audit:clear', () => { lock.clearAudit(); return { ok: true }; });

  const send = (channel, payload) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };

  // Sends to the desktop window AND to any Chrome tab attached to the bridge,
  // so both surfaces see the same live terminal output.
  const broadcast = (channel, payload) => {
    send(channel, payload);
    const wss = state.bridge?.wss;
    if (!wss) return;
    for (const client of wss.clients) {
      try { if (client.readyState === 1) client.send(JSON.stringify({ channel, payload })); } catch {}
    }
  };

  // ---------- app info ----------
  handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    workspace: state.rootRef.value,
    packaged: app.isPackaged,
    envFileUsed: envCandidates.find((f) => fs.existsSync(f)) || null
  }));

  // ---------- capabilities & permissions ----------
  handle('app:capabilities', () => ({
    ok: true,
    workspace: state.rootRef.value,
    permissions: { ...state.permissions },
    features: [
      { id: 'files', name: 'Read & write files inside the workspace', detail: 'Path-traversal is blocked; the agent can never touch files outside it.', toggle: null },
      { id: 'writeFiles', name: 'Agent creates & edits files', detail: 'Turn off to make the agent read-only.', toggle: 'writeFiles' },
      { id: 'runCommands', name: 'Agent runs shell commands', detail: 'The interactive terminal always works; this gates the AI.', toggle: 'runCommands' },
      { id: 'network', name: 'Send prompts to the provider you pick', detail: 'Keys go only to that provider. The built-in engine needs no network.', toggle: null },
      { id: 'external', name: 'Open links & folders outside the app', detail: 'Used by "Open workspace" and provider help links.', toggle: null }
    ]
  }));

  handle('app:setPermission', (_e, key, enabled) => {
    if (!(key in state.permissions)) return { ok: false, error: 'Unknown permission: ' + key };
    state.permissions[key] = Boolean(enabled);
    return { ok: true, permissions: { ...state.permissions } };
  });

  // ---------- open / reveal workspace in the OS file manager ----------
  handle('shell:open', async () => {
    const err = await shell.openPath(state.rootRef.value);
    return { ok: !err, error: err || null };
  });

  handle('shell:reveal', async () => {
    shell.showItemInFolder(state.rootRef.value);
    return { ok: true };
  });

  // ---------- workspace selection ----------
  handle('workspace:choose', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose your project workspace',
      defaultPath: state.rootRef.value,
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths[0]) return { changed: false, workspace: state.rootRef.value };
    state.rootRef.value = res.filePaths[0];
    state.lock?.audit('workspace.change', { workspace: state.rootRef.value });
    fs.mkdirSync(state.rootRef.value, { recursive: true });
    if (state.terminal) {
      state.terminal.dispose();
      state.terminal = null;
    }
    return { changed: true, workspace: state.rootRef.value };
  });

  // ---------- providers ----------
  handle('providers:list', () => providers.listProviders());

  handle('providers:setKey', (_e, providerId, apiKey) => {
    const p = providers.PROVIDERS.find((x) => x.id === providerId);
    if (!p) return { ok: false, error: 'Unknown provider' };
    if (!p.keyEnv) return { ok: false, error: 'This provider needs no key' };
    providers.setKey(p.keyEnv, apiKey);
    state.lock?.audit(apiKey ? 'key.set' : 'key.remove', { provider: providerId });

    // Persist so the key survives restarts (main process only, never renderer).
    try {
      const file = path.join(app.getPath('userData'), 'dev-studio.env');
      const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const lines = existing
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith(p.keyEnv + '='));
      if (apiKey) lines.push(`${p.keyEnv}=${String(apiKey).trim()}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
    } catch (err) {
      return { ok: true, persisted: false, warning: err.message };
    }
    return { ok: true, persisted: true, ready: Boolean(apiKey) };
  });

  // ---------- provider connectivity test (real call, no agent actions) ----------
  handle('providers:test', async (_e, providerId) => {
    const p = providers.PROVIDERS.find((x) => x.id === providerId);
    if (!p) return { ok: false, error: 'Unknown provider' };
    if (p.keyEnv && !providers.getKey(p.keyEnv)) {
      return { ok: false, code: 'NO_KEY', error: 'No API key set yet — paste one above first.' };
    }
    const t0 = Date.now();
    try {
      const reply = await providers.chat(providerId, null, [
        { role: 'user', content: 'Reply with exactly one word: ok' }
      ]);
      return { ok: true, latencyMs: Date.now() - t0, sample: String(reply).slice(0, 140) };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - t0, error: err.message };
    }
  });

  // ---------- chat + agent ----------
  handle('ai:chat', async (_e, payload) => {
    const { provider, model, messages, agentMode } = payload || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return { ok: false, error: 'messages array is required' };
    }
    try {
      const full = agentMode ? [{ role: 'system', content: agent.systemPrompt() }, ...messages] : messages;
      const reply = await providers.chat(provider, model, full);
      let actionResults = [];
      let skipped = [];
      if (agentMode) {
        let actions = agent.parseActions(reply);
        // Honour the user's permission toggles before executing anything.
        if (!state.permissions.writeFiles) {
          skipped = skipped.concat(actions.filter((a) => a.type === 'write_file').map((a) => a.path));
          actions = actions.filter((a) => a.type !== 'write_file');
        }
        if (!state.permissions.runCommands) {
          skipped = skipped.concat(actions.filter((a) => a.type === 'run_command').map((a) => a.command));
          actions = actions.filter((a) => a.type !== 'run_command');
        }
        if (actions.length) actionResults = await agent.executeActions(actions, ws);
      }
      state.lock?.audit('agent.run', { provider, actions: actionResults.length });
      return { ok: true, reply: agent.stripActions(reply), raw: reply, actionResults, skipped };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || 'ERROR' };
    }
  });

  // ---------- ensemble / AI team ----------
  handle('ai:roles', () => ({ ok: true, roles: orchestrator.ROLES }));

  handle('ai:ensemble', async (_e, payload) => {
    const { userText, overrides } = payload || {};
    if (!userText || typeof userText !== 'string') return { ok: false, error: 'userText is required' };
    try {
      const r = await orchestrator.runEnsemble({
        userText,
        overrides,
        ws,
        permissions: state.permissions
      });
      state.lock?.audit('ensemble.run', { steps: r.steps.length, actions: r.actionResults.length });
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ---------- files ----------
  handle('files:list', () => ({ ok: true, tree: ws.tree(), workspace: state.rootRef.value }));

  handle('files:read', (_e, rel) => {
    try {
      return { ok: true, content: ws.read(rel) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('files:write', (_e, rel, content) => {
    try {
      ws.write(rel, content);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('files:delete', (_e, rel) => {
    try {
      ws.remove(rel);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ---------- terminal ----------
  function ensureTerminal() {
    if (state.terminal && state.terminal.alive) return state.terminal;
    state.terminal = new Terminal({
      cwd: state.rootRef.value,
      onOutput: (data) => broadcast('terminal:data', { type: 'output', data }),
      onExit: (code) => broadcast('terminal:data', { type: 'exit', code }),
      onCommandDone: (info) => broadcast('terminal:data', { type: 'done', ...info })
    });
    state.terminal.start();
    return state.terminal;
  }

  handle('terminal:start', () => {
    const t = ensureTerminal();
    return { ok: true, cwd: t.cwd, platform: process.platform };
  });

  handle('terminal:send', async (_e, command) => {
    const t = ensureTerminal();
    broadcast('terminal:data', { type: 'echo', command });
    const r = await t.run(command);
    return { ok: true, ...r };
  });

  handle('terminal:kill', () => {
    if (state.terminal) {
      state.terminal.dispose();
      state.terminal = null;
    }
    return { ok: true };
  });

  // ---------- loopback bridge: same workspace, opened in Chrome ----------
  // Method names mirror the renderer API (window.studio) exactly, so one UI
  // runs on both surfaces. Channels that only make sense on the desktop
  // (folder pickers, reveal-in-explorer) are deliberately NOT exposed.
  const bridgeMethods = {
    appInfo: 'app:info',
    capabilities: 'app:capabilities',
    setPermission: 'app:setPermission',
    providers: 'providers:list',
    setKey: 'providers:setKey',
    testConnection: 'providers:test',
    chat: 'ai:chat',
    roles: 'ai:roles',
    ensemble: 'ai:ensemble',
    plugins: 'plugins:list',
    pluginsScan: 'plugins:scan',
    pluginSetEnabled: 'plugins:setEnabled',
    pluginTest: 'plugins:test',
    files: 'files:list',
    readFile: 'files:read',
    writeFile: 'files:write',
    deleteFile: 'files:delete',
    lockState: 'lock:state',
    lockSet: 'lock:set',
    lockVerify: 'lock:verify',
    lockChange: 'lock:change',
    lockClear: 'lock:clear',
    lockNote: 'lock:note',
    lockAutoLock: 'lock:autoLock',
    auditRead: 'audit:read',
    auditClear: 'audit:clear',
    terminalStart: 'terminal:start',
    terminalSend: 'terminal:send',
    terminalKill: 'terminal:kill',
    bridgeMode: 'bridge:mode',
    bridgeSetMode: 'bridge:setMode'
  };

  // Methods a read-only Chrome tab must NOT be able to call.
  const mutatingMethods = [
    'setPermission', 'setKey', 'writeFile', 'deleteFile',
    'chat', 'ensemble', 'pluginSetEnabled',
    'terminalSend', 'terminalKill',
    'lockSet', 'lockChange', 'lockClear', 'lockAutoLock', 'auditClear',
    'bridgeSetMode'
  ];

  const bridgeImpl = {};
  for (const [method, channel] of Object.entries(bridgeMethods)) {
    bridgeImpl[method] = (...args) => {
      const fn = handlers.get(channel);
      if (!fn) return { ok: false, error: `channel not available: ${channel}` };
      return fn(null, ...args);
    };
  }

  function createWss(server, bridgeToken) {
    const { WebSocketServer } = require('ws');
    const wss = new WebSocketServer({ noServer: true });
    wss.clients = new Set();
    server.on('upgrade', (req, socket, head) => {
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/ws') { socket.destroy(); return; }
        const t = u.searchParams.get('token') || '';
        const a = Buffer.from(String(t));
        const b = Buffer.from(bridgeToken);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (sock) => {
          wss.clients.add(sock);
          sock.on('close', () => wss.clients.delete(sock));
          sock.on('error', () => wss.clients.delete(sock));
        });
      } catch {
        socket.destroy();
      }
    });
    return wss;
  }

  async function ensureBridge(mode) {
    if (mode === 'readonly' || mode === 'full') state.bridgeMode = mode;
    if (state.bridge) return { ok: true, url: state.bridge.url, port: state.bridge.port, mode: state.bridgeMode };
    const distDir = path.join(__dirname, '..', 'dist');
    if (!fs.existsSync(path.join(distDir, 'index.html'))) {
      return { ok: false, error: 'Renderer build missing — run `npm run build` first.' };
    }
    const bridge = await startBridge({
      distDir,
      impl: bridgeImpl,
      createWss,
      mutating: mutatingMethods,
      isReadOnly: () => state.bridgeMode === 'readonly'
    });
    state.bridge = bridge;
    lock.audit('bridge.start', { port: bridge.port, mode: state.bridgeMode });
    return { ok: true, url: bridge.url, port: bridge.port, mode: state.bridgeMode };
  }

  handle('bridge:start', (_e, mode) => ensureBridge(mode));

  handle('bridge:open', async (_e, mode) => {
    const r = await ensureBridge(mode);
    if (!r.ok) return r;
    await shell.openExternal(r.url);
    lock.audit('bridge.open', { port: r.port, mode: r.mode });
    return { ok: true, url: r.url, port: r.port, mode: r.mode };
  });

  // Switch the live browser session between "full access" and "look, don't touch".
  handle('bridge:setMode', (_e, mode) => {
    const m = mode === 'readonly' ? 'readonly' : 'full';
    state.bridgeMode = m;
    lock.audit('bridge.mode', { mode: m, running: !!state.bridge });
    return { ok: true, mode: m };
  });

  handle('bridge:mode', () => ({ ok: true, mode: state.bridgeMode }));

  handle('bridge:stop', async () => {
    if (!state.bridge) return { ok: true, running: false };
    const port = state.bridge.port;
    await state.bridge.stop();
    state.bridge = null;
    lock.audit('bridge.stop', { port });
    return { ok: true, running: false };
  });

  handle('bridge:state', () => ({
    ok: true,
    running: !!state.bridge,
    port: state.bridge?.port || null,
    url: state.bridge?.url || null,
    mode: state.bridgeMode
  }));
}

module.exports = { registerIpc, getState };
