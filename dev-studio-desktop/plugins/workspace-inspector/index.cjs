/**
 * Official plugin: Workspace Inspector.
 *
 * Gives the AI the two things a personal assistant needs most:
 *   action:project_analyze  {}                 -> full offline audit report
 *   action:find_code        {"query":"TODO"}   -> grep across every text file
 *   action:project_stats    {}                 -> quick numbers
 *
 * Everything runs locally on the workspace folder; nothing leaves the PC.
 */
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['node_modules', '.git', 'dist', 'release', '.dev-studio', '.vscode', '__pycache__']);
const TEXT = new Set(['.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx', '.html', '.css', '.scss', '.json', '.md', '.py', '.txt', '.yml', '.yaml', '.bat', '.sh', '.ps1', '.c', '.h', '.cpp', '.cs', '.go', '.rs', '.java', '.sql', '.vue', '.svelte']);
const MAX_FILE = 2 * 1024 * 1024;

function walk(dir, rel, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name.startsWith('.git')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out);
    else out.push({ rel: r, abs: path.join(dir, e.name) });
  }
  return out;
}

function readSafe(abs) {
  try {
    const st = fs.statSync(abs);
    if (st.size > MAX_FILE) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch { return null; }
}

function analyze(workspace) {
  const files = walk(workspace, '', []);
  const byExt = new Map();
  const signals = new Set();
  let todos = 0;
  let loc = 0;
  const sized = [];

  for (const f of files) {
    const ext = path.extname(f.rel).toLowerCase() || '(none)';
    const st = (() => { try { return fs.statSync(f.abs); } catch { return null; } })();
    if (st) sized.push({ rel: f.rel, size: st.size, mtime: st.mtimeMs });
    if (!TEXT.has(ext)) { byExt.set(ext, (byExt.get(ext) || 0) + 1); continue; }
    const src = readSafe(f.abs);
    if (src === null) continue;
    const lines = src.split('\n').length;
    loc += lines;
    byExt.set(ext, (byExt.get(ext) || 0) + lines);
    const head = src.slice(0, 4000).toLowerCase();
    if (/react|jsx/.test(head) || ext === '.jsx') signals.add('React');
    if (/electron/.test(head)) signals.add('Electron');
    if (/express/.test(head)) signals.add('Express');
    if (/vite/.test(head)) signals.add('Vite');
    if (/playwright/.test(head)) signals.add('Playwright');
    if (/vitest|jest/.test(head)) signals.add('tests');
    if (ext === '.py') signals.add('Python');
    if (ext === '.sql') signals.add('SQL');
    if (/mongoose|prisma|sequelize/.test(head)) signals.add('ORM/DB');
    if (/postgres|mysql|sqlite/.test(head)) signals.add('DB');
    todos += (src.match(/\b(TODO|FIXME|HACK|XXX)\b/g) || []).length;
  }

  const topLoc = [...byExt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const biggest = sized.sort((a, b) => b.size - a.size).slice(0, 5);
  const newest = sized.sort((a, b) => b.mtime - a.mtime).slice(0, 5);

  const report = [
    `PROJECT AUDIT — ${path.basename(workspace) || workspace}`,
    `files: ${files.length} · text lines: ~${loc.toLocaleString()} · TODO/FIXME: ${todos}`,
    signals.size ? `stack signals: ${[...signals].join(', ')}` : 'stack signals: none detected',
    '',
    'lines by type:',
    ...topLoc.map(([e, n]) => `  ${e.padEnd(8)} ${typeof n === 'number' ? n.toLocaleString() : n}`),
    '',
    'largest files:',
    ...biggest.map((f) => `  ${(f.size / 1024).toFixed(1).padStart(8)} kB  ${f.rel}`),
    '',
    'most recently touched:',
    ...newest.map((f) => `  ${new Date(f.mtime).toISOString().slice(0, 16).replace('T', ' ')}  ${f.rel}`),
    '',
    todos > 0 ? `Suggestion: ${todos} TODO/FIXME markers found — ask me "find TODO in my code" to list them.` : 'No TODO markers — clean slate.'
  ].join('\n');

  return { ok: true, files: files.length, loc, todos, signals: [...signals], report };
}

function findCode(workspace, query, max = 40) {
  const q = String(query || '').toLowerCase();
  if (!q) return { ok: false, error: 'query is required' };
  const files = walk(workspace, '', []);
  const hits = [];
  for (const f of files) {
    if (!TEXT.has(path.extname(f.rel).toLowerCase())) continue;
    const src = readSafe(f.abs);
    if (src === null) continue;
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].toLowerCase().includes(q)) {
        hits.push(`${f.rel}:${i + 1}: ${lines[i].trim().slice(0, 140)}`);
        if (hits.length >= max) return { ok: true, query, count: hits.length, truncated: true, hits };
      }
    }
  }
  return { ok: true, query, count: hits.length, truncated: false, hits };
}

module.exports = {
  tools: [
    {
      name: 'project_analyze',
      description: 'Analyse the whole workspace: stack, sizes, TODOs, structure. No params.',
      run: (_a, ctx) => {
        try { return analyze(ctx.workspace); } catch (e) { return { ok: false, error: e.message }; }
      }
    },
    {
      name: 'find_code',
      description: 'Search every text file in the workspace. Params: { "query": "TODO" }',
      run: (a, ctx) => {
        try { return findCode(ctx.workspace, a?.query, Number(a?.max) || 40); } catch (e) { return { ok: false, error: e.message }; }
      }
    },
    {
      name: 'project_stats',
      description: 'Quick numbers: file count, lines, TODOs, stack signals.',
      run: (_a, ctx) => {
        try {
          const r = analyze(ctx.workspace);
          return { ok: true, files: r.files, loc: r.loc, todos: r.todos, signals: r.signals };
        } catch (e) { return { ok: false, error: e.message }; }
      }
    }
  ]
};
