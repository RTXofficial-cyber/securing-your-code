const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');

const { registerIpc, getState } = require('./ipc.cjs');

const isDev = !app.isPackaged && !!process.env.VITE_DEV_SERVER_URL;

function defaultWorkspace() {
  const override = process.env.DEVSTUDIO_WORKSPACE;
  if (override) return override;
  try {
    return path.join(app.getPath('documents'), 'Dev Studio Workspace');
  } catch {
    return path.join(app.getPath('userData'), 'workspace');
  }
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0e0e0e',
    title: 'Dev Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webviewTag: false,
      allowRunningInsecureContent: false
    }
  });

  // Never navigate away to external origins inside the app window.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost')) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => win.show());

  const distIndex = path.join(__dirname, '..', 'dist', 'index.html');
  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (fs.existsSync(distIndex)) {
    win.loadFile(distIndex);
  } else {
    win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          '<h1 style="font-family:sans-serif;color:#fff;background:#0e0e0e;padding:40px">' +
            'Frontend build missing.<br><br>Run <code>npm run build</code> then restart.</h1>'
        )
    );
  }
}

app.whenReady().then(() => {
  const workspace = defaultWorkspace();
  fs.mkdirSync(workspace, { recursive: true });

  /* ---------- defence in depth ---------- */
  const ses = session.defaultSession;
  // Deny every permission request (camera, mic, geolocation, notifications...)
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  // The renderer may only talk to loopback (the local bridge). Anything else
  // is cancelled, so a compromised page cannot phone home.
  ses.webRequest.onBeforeRequest((details, callback) => {
    const u = details.url;
    if (/^https?:/i.test(u) && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?([/?#]|$)/i.test(u)) {
      callback({ cancel: true });
    } else {
      callback({});
    }
  });
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(null);
  }

  registerIpc(ipcMain, { workspace, getWindow: () => win });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  try {
    getState().terminal?.dispose();
  } catch {}
  if (process.platform !== 'darwin') app.quit();
});
