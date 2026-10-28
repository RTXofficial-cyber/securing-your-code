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
  }
};

contextBridge.exposeInMainWorld('studio', studio);
