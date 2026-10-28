const fs = require('fs');
const path = require('path');

/**
 * Workspace helpers. Every path from the renderer or the AI agent is
 * resolved against the workspace root and rejected if it escapes it.
 */

const IGNORED = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'release', '.next']);

function makeWorkspaceHelpers(rootRef) {
  const root = () => rootRef.value;

  function safe(rel) {
    const base = root();
    const p = path.resolve(base, rel || '.');
    if (p !== base && !p.startsWith(base + path.sep)) {
      throw new Error('Access denied: path is outside the workspace');
    }
    return p;
  }

  function tree(dir, rel = '', depth = 0) {
    if (depth > 5) return [];
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out = [];
    for (const e of entries) {
      if (IGNORED.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        out.push({ name: e.name, path: r, type: 'dir', children: tree(abs, r, depth + 1) });
      } else {
        let size = 0;
        try { size = fs.statSync(abs).size; } catch {}
        out.push({ name: e.name, path: r, type: 'file', size });
      }
    }
    out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    return out;
  }

  function listFlat(dir, rel = '', depth = 0, acc = []) {
    if (depth > 4) return acc;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return acc;
    }
    for (const e of entries) {
      if (IGNORED.has(e.name)) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        acc.push(r + '/');
        listFlat(path.join(dir, e.name), r, depth + 1, acc);
      } else {
        acc.push(r);
      }
    }
    return acc;
  }

  return {
    root,
    safe,
    tree: () => tree(root()),
    listFlat: () => listFlat(root()),
    read: (rel) => fs.readFileSync(safe(rel), 'utf8'),
    write: (rel, content) => {
      const p = safe(rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content ?? '');
      return p;
    },
    remove: (rel) => {
      const p = safe(rel);
      if (p === root()) throw new Error('Cannot delete the workspace root');
      fs.rmSync(p, { recursive: true, force: true });
      return true;
    }
  };
}

module.exports = { makeWorkspaceHelpers };
