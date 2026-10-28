const { app, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const { makeWorkspaceHelpers } = require('./workspace.cjs');
const { Terminal } = require('./terminal.cjs');
const providers = require('../shared/providers.cjs');
const agent = require('../shared/agent.cjs');

const state = { terminal: null, rootRef: null };
function getState() {
  return state;
}

function registerIpc(mainIpc, { workspace, getWindow }) {
  state.rootRef = { value: workspace };
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

  // ---------- chat + agent ----------
  mainIpc.handle('ai:chat', async (_e, payload) => {
    const { provider, model, messages, agentMode } = payload || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return { ok: false, error: 'messages array is required' };
    }
    try {
      const full = agentMode ? [{ role: 'system', content: agent.SYSTEM_PROMPT }, ...messages] : messages;
      const reply = await providers.chat(provider, model, full);
      let actionResults = [];
      if (agentMode) {
        const actions = agent.parseActions(reply);
        if (actions.length) actionResults = await agent.executeActions(actions, ws);
      }
      return { ok: true, reply: agent.stripActions(reply), raw: reply, actionResults };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || 'ERROR' };
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
