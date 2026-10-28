const { contextBridge, ipcRenderer } = require('electron');

/**
 * The ONLY surface exposed to the renderer.
 * Everything is an explicit, promise-based channel — no raw Node access.
 */
const studio = {
  // ---- app / environment ----
  appInfo: () => ipcRenderer.invoke('app:info'),
  capabilities: () => ipcRenderer.invoke('app:capabilities'),
  setPermission: (key, enabled) => ipcRenderer.invoke('app:setPermission', key, enabled),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  openWorkspace: () => ipcRenderer.invoke('shell:open'),
  revealWorkspace: () => ipcRenderer.invoke('shell:reveal'),

  // ---- AI providers ----
  providers: () => ipcRenderer.invoke('providers:list'),
  setKey: (providerId, apiKey) => ipcRenderer.invoke('providers:setKey', providerId, apiKey),
  testConnection: (providerId) => ipcRenderer.invoke('providers:test', providerId),
  chat: (payload) => ipcRenderer.invoke('ai:chat', payload),
  roles: () => ipcRenderer.invoke('ai:roles'),
  ensemble: (payload) => ipcRenderer.invoke('ai:ensemble', payload),

  // ---- app lock & audit ----
  lockState: () => ipcRenderer.invoke('lock:state'),
  lockSet: (pin) => ipcRenderer.invoke('lock:set', pin),
  lockVerify: (pin) => ipcRenderer.invoke('lock:verify', pin),
  lockChange: (oldPin, newPin) => ipcRenderer.invoke('lock:change', oldPin, newPin),
  lockClear: () => ipcRenderer.invoke('lock:clear'),
  lockNote: (kind) => ipcRenderer.invoke('lock:note', kind),
  lockAutoLock: (minutes) => ipcRenderer.invoke('lock:autoLock', minutes),
  auditRead: (limit) => ipcRenderer.invoke('audit:read', limit),
  auditClear: () => ipcRenderer.invoke('audit:clear'),

  // ---- plugins ----
  plugins: () => ipcRenderer.invoke('plugins:list'),
  pluginsScan: () => ipcRenderer.invoke('plugins:scan'),
  pluginSetEnabled: (id, on) => ipcRenderer.invoke('plugins:setEnabled', id, on),
  pluginTest: (id) => ipcRenderer.invoke('plugins:test', id),
  pluginOpenFolder: (which) => ipcRenderer.invoke('plugins:openFolder', which),

  // ---- workspace files ----
  files: () => ipcRenderer.invoke('files:list'),
  readFile: (p) => ipcRenderer.invoke('files:read', p),
  writeFile: (p, content) => ipcRenderer.invoke('files:write', p, content),
  deleteFile: (p) => ipcRenderer.invoke('files:delete', p),

  // ---- terminal ----
  terminalStart: () => ipcRenderer.invoke('terminal:start'),
  terminalSend: (command) => ipcRenderer.invoke('terminal:send', command),
  terminalKill: () => ipcRenderer.invoke('terminal:kill'),
  onTerminal: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },

  // ---- loopback bridge (open this same workspace in Chrome) ----
  bridgeStart: (mode) => ipcRenderer.invoke('bridge:start', mode),
  bridgeOpen: (mode) => ipcRenderer.invoke('bridge:open', mode),
  bridgeStop: () => ipcRenderer.invoke('bridge:stop'),
  bridgeState: () => ipcRenderer.invoke('bridge:state'),
  bridgeMode: () => ipcRenderer.invoke('bridge:mode'),
  bridgeSetMode: (mode) => ipcRenderer.invoke('bridge:setMode', mode),

  // ---- expiring guest links (desktop only creates/revokes them) ----
  bridgeGuestList: () => ipcRenderer.invoke('bridge:guestList'),
  bridgeGuestCreate: (opts) => ipcRenderer.invoke('bridge:guestCreate', opts),
  bridgeGuestRevoke: (id) => ipcRenderer.invoke('bridge:guestRevoke', id),

  // ---- workspace memory (persistent project context for the AI) ----
  memoryGet: () => ipcRenderer.invoke('memory:get'),
  memoryProject: (patch) => ipcRenderer.invoke('memory:project', patch),
  memoryAddNote: (note) => ipcRenderer.invoke('memory:addNote', note),
  memoryUpdateNote: (id, patch) => ipcRenderer.invoke('memory:updateNote', id, patch),
  memoryRemoveNote: (id) => ipcRenderer.invoke('memory:removeNote', id),
  memoryAddTask: (task) => ipcRenderer.invoke('memory:addTask', task),
  memorySetTask: (id, status) => ipcRenderer.invoke('memory:setTask', id, status),
  memoryRemoveTask: (id) => ipcRenderer.invoke('memory:removeTask', id),
  memoryClear: (kind) => ipcRenderer.invoke('memory:clear', kind)
};

contextBridge.exposeInMainWorld('studio', studio);
