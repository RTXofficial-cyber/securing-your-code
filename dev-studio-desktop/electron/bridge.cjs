const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Loopback bridge: lets a browser (Chrome) open the SAME workspace that the
 * desktop app owns — one set of files, two surfaces, VS Code style.
 *
 * Security posture:
 *   - binds to 127.0.0.1 ONLY (never a LAN/0.0.0.0 socket)
 *   - a 256-bit random token is required on every request (?ds_token= or x-ds-token)
 *   - only whitelisted RPC methods are reachable, and they are the exact same
 *     functions the desktop renderer calls (workspace, providers, lock, plugins)
 *   - serves the production build from disk; no remote fetches
 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function readBody(req, limit = 5_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'null',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function authOk(req, url, token) {
  const provided = req.headers['x-ds-token'] || url.searchParams.get('ds_token') || url.searchParams.get('token');
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function startBridge({ distDir, impl, createWss, host = '127.0.0.1', mutating = [], isReadOnly = () => false }) {
  const token = crypto.randomBytes(32).toString('hex');
  const absDist = path.resolve(distDir);
  // Whitelist = the methods we were actually given. Nothing else is callable.
  const allowed = new Set(Object.keys(impl).filter((k) => typeof impl[k] === 'function'));
  // In read-only mode these are refused, so a browser tab can look but not touch.
  const mutatingSet = new Set(mutating);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const isPage = url.pathname === '/' || url.pathname === '/index.html';

    // The page itself and the RPC endpoint both require the token. Static assets
    // are same-origin and content-addressed, but we still require it everywhere.
    if (!authOk(req, url, token)) {
      json(res, 401, { ok: false, error: 'invalid or missing bridge token' });
      return;
    }

    if (req.method === 'OPTIONS') { json(res, 200, { ok: true }); return; }

    if (req.method === 'POST' && url.pathname === '/api/rpc') {
      try {
        const raw = await readBody(req);
        const { method, args } = JSON.parse(raw || '{}');
        if (!allowed.has(method)) { json(res, 404, { ok: false, error: `unknown method: ${method}` }); return; }
        if (mutatingSet.has(method) && isReadOnly()) {
          json(res, 403, {
            ok: false,
            readOnly: true,
            error: `Read-only Chrome session — "${method}" needs full access from the desktop app`
          });
          return;
        }
        const result = await impl[method](...(Array.isArray(args) ? args : []));
        json(res, 200, result === undefined ? { ok: true } : result);
      } catch (err) {
        json(res, 500, { ok: false, error: err?.message || 'rpc failed' });
      }
      return;
    }

    // static files from the built renderer
    const rel = isPage ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const file = path.resolve(absDist, rel);
    if (!file.startsWith(absDist + path.sep) && file !== path.join(absDist, 'index.html')) {
      json(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
    try {
      const data = fs.readFileSync(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': 'no-store'
      });
      res.end(data);
    } catch {
      // SPA fallback
      try {
        const index = fs.readFileSync(path.join(absDist, 'index.html'));
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': index.length });
        res.end(index);
      } catch {
        json(res, 404, { ok: false, error: 'not found' });
      }
    }
  });

  const wss = createWss ? createWss(server, token) : null;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const port = server.address().port;

  return {
    server,
    wss,
    host,
    port,
    token,
    url: `http://${host}:${port}/?ds_token=${token}`,
    stop() {
      return new Promise((resolve) => {
        if (wss && typeof wss.close === 'function') { try { wss.close(); } catch {} }
        server.close(() => resolve());
        // force-close idle keep-alive sockets so close() resolves promptly
        try { server.closeAllConnections?.(); } catch {}
      });
    }
  };
}

module.exports = { startBridge, MIME };
