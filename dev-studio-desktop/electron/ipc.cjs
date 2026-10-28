const { app, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { makeWorkspaceHelpers } = require('./workspace.cjs');
const { Terminal } = require('./terminal.cjs');
const providers = require('../shared/providers.cjs');
const agent = require('../shared/agent.cjs');
const orchestrator = require('../shared/orchestrator.cjs');
const { PluginManager } = require('../shared/plugins.cjs');

const state = { terminal: null, rootRef: null, permissions: null };
function getState() {
  return state;
}

function registerIpc(mainIpc, { workspace, getWindow }) {
  state.rootRef = { value: workspace };
  state.permissions = { runCommands: true, writeFiles: true };
  const ws = makeWorkspaceHelpers(state.rootRef);

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

  mainIpc.handle('plugins:list', () => ({ ok: true, plugins: pluginManager.list(), dirs: pluginManager.dirs }));
  mainIpc.handle('plugins:scan', () => {
    pluginManager.scan();
    pluginManager.loadAll();
    return { ok: true, plugins: pluginManager.list() };
  });
  mainIpc.handle('plugins:setEnabled', (_e, id, on) => {
    const r = pluginManager.setEnabled(id, on);
    return r;
  });
  mainIpc.handle('plugins:test', (_e, id) => pluginManager.test(id));
  mainIpc.handle('plugins:openFolder', async (_e, which) => {
    const dir = which === 'user' ? userPluginDir : pluginManager.dirs[0];
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    return { ok: !err, error: err || null, dir };
  });

  const send = (channel, payload) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };

  // ---------- app info ----------
  mainIpc.handle('app:info', () => ({
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
  mainIpc.handle('app:capabilities', () => ({
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

  mainIpc.handle('app:setPermission', (_e, key, enabled) => {
    if (!(key in state.permissions)) return { ok: false, error: 'Unknown permission: ' + key };
    state.permissions[key] = Boolean(enabled);
    return { ok: true, permissions: { ...state.permissions } };
  });

  // ---------- open / reveal workspace in the OS file manager ----------
  mainIpc.handle('shell:open', async () => {
    const err = await shell.openPath(state.rootRef.value);
    return { ok: !err, error: err || null };
  });

  mainIpc.handle('shell:reveal', async () => {
    shell.showItemInFolder(state.rootRef.value);
    return { ok: true };
  });

  // ---------- workspace selection ----------
  mainIpc.handle('workspace:choose', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose your project workspace',
      defaultPath: state.rootRef.value,
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths[0]) return { changed: false, workspace: state.rootRef.value };
    state.rootRef.value = res.filePaths[0];
    fs.mkdirSync(state.rootRef.value, { recursive: true });
    if (state.terminal) {
      state.terminal.dispose();
      state.terminal = null;
    }
    return { changed: true, workspace: state.rootRef.value };
  });

  // ---------- providers ----------
  mainIpc.handle('providers:list', () => providers.listProviders());

  mainIpc.handle('providers:setKey', (_e, providerId, apiKey) => {
    const p = providers.PROVIDERS.find((x) => x.id === providerId);
    if (!p) return { ok: false, error: 'Unknown provider' };
    if (!p.keyEnv) return { ok: false, error: 'This provider needs no key' };
    providers.setKey(p.keyEnv, apiKey);

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
  mainIpc.handle('providers:test', async (_e, providerId) => {
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
  mainIpc.handle('ai:chat', async (_e, payload) => {
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
      return { ok: true, reply: agent.stripActions(reply), raw: reply, actionResults, skipped };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || 'ERROR' };
    }
  });

  // ---------- ensemble / AI team ----------
  mainIpc.handle('ai:roles', () => ({ ok: true, roles: orchestrator.ROLES }));

  mainIpc.handle('ai:ensemble', async (_e, payload) => {
    const { userText, overrides } = payload || {};
    if (!userText || typeof userText !== 'string') return { ok: false, error: 'userText is required' };
    try {
      const r = await orchestrator.runEnsemble({
        userText,
        overrides,
        ws,
        permissions: state.permissions
      });
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ---------- files ----------
  mainIpc.handle('files:list', () => ({ ok: true, tree: ws.tree(), workspace: state.rootRef.value }));

  mainIpc.handle('files:read', (_e, rel) => {
    try {
      return { ok: true, content: ws.read(rel) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  mainIpc.handle('files:write', (_e, rel, content) => {
    try {
      ws.write(rel, content);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  mainIpc.handle('files:delete', (_e, rel) => {
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
      onOutput: (data) => send('terminal:data', { type: 'output', data }),
      onExit: (code) => send('terminal:data', { type: 'exit', code }),
      onCommandDone: (info) => send('terminal:data', { type: 'done', ...info })
    });
    state.terminal.start();
    return state.terminal;
  }

  mainIpc.handle('terminal:start', () => {
    const t = ensureTerminal();
    return { ok: true, cwd: t.cwd, platform: process.platform };
  });

  mainIpc.handle('terminal:send', async (_e, command) => {
    const t = ensureTerminal();
    send('terminal:data', { type: 'echo', command });
    const r = await t.run(command);
    return { ok: true, ...r };
  });

  mainIpc.handle('terminal:kill', () => {
    if (state.terminal) {
      state.terminal.dispose();
      state.terminal = null;
    }
    return { ok: true };
  });
}

module.exports = { registerIpc, getState };
