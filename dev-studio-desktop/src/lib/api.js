/**
 * Renderer <-> backend bridge.
 *
 * In the packaged Windows app, `window.studio` is injected by the Electron
 * preload script and talks to the main process over IPC (no HTTP server,
 * no ports, works offline).
 *
 * In a plain browser (npm run dev) there is no bridge, so we fall back to a
 * local mock that keeps the whole UI explorable for design work.
 */

export const isDesktop = typeof window !== 'undefined' && !!window.studio;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mockPin = null;

const mockTree = [
  {
    name: 'src',
    path: 'src',
    type: 'dir',
    children: [{ name: 'index.js', path: 'src/index.js', type: 'file', size: 120 }]
  },
  { name: 'README.md', path: 'README.md', type: 'file', size: 64 }
];

const mock = {
  appInfo: async () => ({
    version: '1.0.0',
    platform: 'browser-mock',
    arch: '-',
    electron: '-',
    node: '-',
    workspace: '(browser preview — run the desktop app for a real workspace)',
    packaged: false
  }),
  chooseWorkspace: async () => ({ changed: false, workspace: '(browser preview)' }),
  providers: async () => {
    await sleep(120);
    return [
      { id: 'builtin', name: 'Dev Studio AI', vendor: 'Built-in', keyEnv: null, ready: true, models: [{ id: 'studio-agent-1', name: 'Studio Agent v1 (built-in)' }] },
      { id: 'anthropic', name: 'Claude', vendor: 'Anthropic', keyEnv: 'ANTHROPIC_API_KEY', ready: false, models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }] },
      { id: 'openai', name: 'ChatGPT', vendor: 'OpenAI', keyEnv: 'OPENAI_API_KEY', ready: false, models: [{ id: 'gpt-4o', name: 'GPT-4o' }] },
      { id: 'perplexity', name: 'Perplexity', vendor: 'Perplexity', keyEnv: 'PERPLEXITY_API_KEY', ready: false, models: [{ id: 'sonar', name: 'Sonar' }] },
      { id: 'gemini', name: 'Gemini', vendor: 'Google', keyEnv: 'GEMINI_API_KEY', ready: false, models: [{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }] },
      { id: 'groq', name: 'Groq', vendor: 'Groq', keyEnv: 'GROQ_API_KEY', ready: false, models: [{ id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' }] }
    ];
  },
  setKey: async () => ({ ok: true, persisted: false }),
  testConnection: async (id) => {
    await sleep(500);
    if (id === 'builtin') return { ok: true, latencyMs: 3, sample: 'ok' };
    return { ok: false, code: 'NO_KEY', error: 'No API key set yet — paste one above first.' };
  },
  capabilities: async () => ({
    ok: true,
    workspace: '(browser preview)',
    permissions: { runCommands: true, writeFiles: true },
    features: [
      { id: 'files', name: 'Read & write files inside the workspace', detail: 'Path-traversal is blocked.', toggle: null },
      { id: 'writeFiles', name: 'Agent creates & edits files', detail: 'Turn off to make the agent read-only.', toggle: 'writeFiles' },
      { id: 'runCommands', name: 'Agent runs shell commands', detail: 'The interactive terminal always works; this gates the AI.', toggle: 'runCommands' },
      { id: 'network', name: 'Send prompts to the provider you pick', detail: 'Keys go only to that provider.', toggle: null },
      { id: 'external', name: 'Open links & folders outside the app', detail: 'Used by "Open workspace" and help links.', toggle: null }
    ]
  }),
  setPermission: async () => ({ ok: true, permissions: { runCommands: true, writeFiles: true } }),
  openWorkspace: async () => ({ ok: false, error: 'Only available in the desktop app' }),
  revealWorkspace: async () => ({ ok: false, error: 'Only available in the desktop app' }),
  chat: async ({ messages }) => {
    await sleep(600);
    const last = messages[messages.length - 1]?.content || '';
    return {
      ok: true,
      reply: `Browser preview mode. You said: "${last}"\n\nRun the packaged desktop app (Dev Studio.exe) to get the real agent, workspace and terminal.`,
      actionResults: []
    };
  },
  roles: async () => ({
    ok: true,
    roles: [
      { id: 'research', label: 'Researcher', preferred: 'perplexity', icon: '⌕' },
      { id: 'plan', label: 'Architect', preferred: 'anthropic', icon: '⌗' },
      { id: 'code', label: 'Coder', preferred: 'openai', icon: '⌨' },
      { id: 'review', label: 'Reviewer', preferred: 'anthropic', icon: '✓' }
    ]
  }),
  ensemble: async ({ userText }) => {
    await sleep(900);
    return {
      ok: true,
      steps: [
        { role: 'research', label: 'Researcher', icon: '⌕', providerId: 'builtin', providerName: 'Dev Studio AI', ok: true, latencyMs: 120, output: '(browser preview) Zero-dependency approach recommended; verify by running.' },
        { role: 'plan', label: 'Architect', icon: '⌗', providerId: 'builtin', providerName: 'Dev Studio AI', ok: true, latencyMs: 140, output: '(browser preview) 1. write files  2. run to verify  3. review.' },
        { role: 'code', label: 'Coder', icon: '⌨', providerId: 'builtin', providerName: 'Dev Studio AI', ok: true, latencyMs: 200, output: '(browser preview) code step — live only in the desktop app.' },
        { role: 'review', label: 'Reviewer', icon: '✓', providerId: 'builtin', providerName: 'Dev Studio AI', ok: true, latencyMs: 90, output: 'APPROVED (browser preview).' }
      ],
      actionResults: [],
      summary: `Browser preview of the AI-team pipeline for: "${userText}". Run the desktop app to have the real team research, plan, code and review in your workspace.`
    };
  },
  plugins: async () => ({
    ok: true,
    dirs: ['(bundled plugins)', '(user plugins)'],
    plugins: [
      { id: 'ollama', name: 'Ollama (local models)', version: '1.0.0', type: 'provider', enabled: true, status: 'loaded', official: true, description: 'Local models on localhost:11434 — no key, no internet.', provides: { provider: { id: 'ollama', name: 'Ollama' }, tools: [] } },
      { id: 'openrouter', name: 'OpenRouter', version: '1.0.0', type: 'provider', enabled: true, status: 'loaded', official: true, description: 'One key for hundreds of hosted models.', provides: { provider: { id: 'openrouter', name: 'OpenRouter' }, tools: [] } },
      { id: 'git-tools', name: 'Git tools', version: '1.0.0', type: 'tools', enabled: true, status: 'loaded', official: true, description: 'Agent actions: git_init, git_status, git_commit, git_log.', provides: { provider: null, tools: ['git_init', 'git_status', 'git_commit', 'git_log'] } }
    ]
  }),
  pluginsScan: async () => mock.plugins(),
  pluginSetEnabled: async () => ({ ok: true }),
  pluginTest: async (id) => ({ ok: true, kind: id === 'git-tools' ? 'tools' : 'provider', sample: 'ok', tools: ['git_init', 'git_status', 'git_commit', 'git_log'] }),
  pluginOpenFolder: async () => ({ ok: false, error: 'Only available in the desktop app' }),
  lockState: async () => ({ ok: true, set: mockPin !== null, autoLockMinutes: 0 }),
  lockSet: async (pin) => {
    if (String(pin || '').length < 4) return { ok: false, error: 'PIN must be at least 4 characters' };
    mockPin = String(pin);
    return { ok: true };
  },
  lockVerify: async (pin) => ({ ok: String(pin) === mockPin }),
  lockChange: async (o, n) => (String(o) === mockPin ? ((mockPin = String(n)), { ok: true }) : { ok: false, error: 'Current PIN is incorrect' }),
  lockClear: async () => { mockPin = null; return { ok: true }; },
  lockNote: async () => ({ ok: true }),
  lockAutoLock: async (m) => ({ ok: true, autoLockMinutes: Number(m) || 0 }),
  auditRead: async () => ({ ok: true, entries: [{ ts: new Date().toISOString(), event: 'preview.start', detail: null }] }),
  auditClear: async () => ({ ok: true }),
  files: async () => ({ ok: true, tree: mockTree, workspace: '(browser preview)' }),
  readFile: async (p) => ({ ok: true, content: `// ${p}\n// Preview content — desktop app reads real files.\n` }),
  writeFile: async () => ({ ok: true }),
  deleteFile: async () => ({ ok: true }),
  terminalStart: async () => ({ ok: true, cwd: '(browser preview)', platform: 'browser' }),
  terminalSend: async (c) => {
    await sleep(150);
    return { ok: true, exitCode: 0, cwd: '(browser preview)', output: `[preview] would run: ${c}` };
  },
  terminalKill: async () => ({ ok: true }),
  onTerminal: () => () => {},
  bridgeStart: async () => ({ ok: false, error: 'Only available in the desktop app' }),
  bridgeOpen: async () => ({ ok: false, error: 'Only available in the desktop app' }),
  bridgeStop: async () => ({ ok: true, running: false }),
  bridgeState: async () => ({ ok: true, running: false, port: null, url: null, mode: 'full' }),
  bridgeMode: async () => ({ ok: true, mode: 'full' }),
  bridgeSetMode: async (m) => ({ ok: true, mode: m === 'readonly' ? 'readonly' : 'full' })
};

/**
 * Loopback bridge transport.
 *
 * When the desktop app opens THIS build in Chrome (button: "Open in Chrome"),
 * it hands the tab a one-time token in the URL. The tab then talks to the
 * desktop main process over http://127.0.0.1:<port>/api/rpc + a WebSocket —
 * so Chrome and the .exe share one workspace, one terminal, one plugin set
 * and one PIN lock. Same UI, same files, two surfaces.
 */
const bridgeToken = (() => {
  if (typeof window === 'undefined') return null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('ds_token');
    if (fromUrl) {
      window.sessionStorage?.setItem('ds_token', fromUrl);
      return fromUrl;
    }
    return window.sessionStorage?.getItem('ds_token') || null;
  } catch {
    return null;
  }
})();

export const isBridge = !isDesktop && !!bridgeToken;

function makeBridgeTransport(token) {
  const rpc = async (method, ...args) => {
    const res = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ds-token': token },
      body: JSON.stringify({ method, args })
    });
    if (res.status === 401) return { ok: false, error: 'Bridge token rejected — reopen from the desktop app' };
    try { return await res.json(); } catch { return { ok: false, error: 'Bad bridge response' }; }
  };

  let ws = null;
  const subs = new Set();
  const ensureWs = () => {
    if (ws && ws.readyState !== 3) return ws;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg?.channel === 'terminal:data') subs.forEach((cb) => cb(msg.payload));
      } catch {}
    };
    return ws;
  };

  const desktopOnly = (what) => async () => ({ ok: false, error: `${what} — use the desktop app for this` });

  return {
    appInfo: () => rpc('appInfo'),
    capabilities: () => rpc('capabilities'),
    setPermission: (k, v) => rpc('setPermission', k, v),
    providers: () => rpc('providers'),
    setKey: (id, key) => rpc('setKey', id, key),
    testConnection: (id) => rpc('testConnection', id),
    chat: (payload) => rpc('chat', payload),
    roles: () => rpc('roles'),
    ensemble: (payload) => rpc('ensemble', payload),
    plugins: () => rpc('plugins'),
    pluginsScan: () => rpc('pluginsScan'),
    pluginSetEnabled: (id, on) => rpc('pluginSetEnabled', id, on),
    pluginTest: (id) => rpc('pluginTest', id),
    files: () => rpc('files'),
    readFile: (p) => rpc('readFile', p),
    writeFile: (p, c) => rpc('writeFile', p, c),
    deleteFile: (p) => rpc('deleteFile', p),
    lockState: () => rpc('lockState'),
    lockSet: (pin) => rpc('lockSet', pin),
    lockVerify: (pin) => rpc('lockVerify', pin),
    lockChange: (o, n) => rpc('lockChange', o, n),
    lockClear: () => rpc('lockClear'),
    lockNote: (kind) => rpc('lockNote', kind),
    lockAutoLock: (m) => rpc('lockAutoLock', m),
    auditRead: (limit) => rpc('auditRead', limit),
    auditClear: () => rpc('auditClear'),
    terminalStart: () => { ensureWs(); return rpc('terminalStart'); },
    terminalSend: (c) => rpc('terminalSend', c),
    terminalKill: () => rpc('terminalKill'),
    onTerminal: (cb) => { ensureWs(); subs.add(cb); return () => subs.delete(cb); },
    // these have no meaning inside a browser tab
    chooseWorkspace: desktopOnly('Folder picker is desktop-only'),
    openWorkspace: desktopOnly('Opening folders is desktop-only'),
    revealWorkspace: desktopOnly('Revealing folders is desktop-only'),
    pluginOpenFolder: desktopOnly('Opening the plugins folder is desktop-only'),
    bridgeStart: () => ({ ok: true, already: true }),
    bridgeOpen: () => ({ ok: false, error: 'You are already in Chrome' }),
    bridgeStop: () => ({ ok: false, error: 'Close it from the desktop app' }),
    bridgeState: () => ({ ok: true, running: true, port: Number(window.location.port) || null, url: window.location.href }),
    bridgeMode: () => rpc('bridgeMode'),
    bridgeSetMode: (m) => rpc('bridgeSetMode', m)
  };
}

export const api = isDesktop ? window.studio : (bridgeToken ? makeBridgeTransport(bridgeToken) : mock);
