const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Workspace memory — persistent project context that survives restarts.
 *
 * Stored at `<workspace>/.dev-studio/memory.json` so it travels with the
 * project (commit it and your whole team + every AI model shares the same
 * understanding of the codebase).
 *
 * The AI (solo chat and the 4-role team) gets `contextBlock()` injected into
 * its system prompt, so a run today knows the decisions made last week.
 */

const MAX_RUNS = 40;
const MAX_NOTES = 200;
const MAX_TASKS = 200;

function blank() {
  return {
    version: 1,
    project: { name: '', summary: '', stack: [], conventions: [] },
    notes: [],   // decisions: { id, ts, title, body, tags[] }
    tasks: [],   // { id, ts, title, status: todo|doing|done }
    runs: []     // { ts, prompt, provider, actions, chars }
  };
}

function shortId() {
  return crypto.randomBytes(5).toString('hex');
}

function asArray(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean);
  return [];
}

class MemoryStore {
  constructor(file) {
    this.file = file;
    this.data = this._load();
  }

  _load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!d || typeof d !== 'object') return blank();
      const base = blank();
      return {
        version: 1,
        project: { ...base.project, ...(d.project || {}) },
        notes: Array.isArray(d.notes) ? d.notes.slice(-MAX_NOTES) : [],
        tasks: Array.isArray(d.tasks) ? d.tasks.slice(-MAX_TASKS) : [],
        runs: Array.isArray(d.runs) ? d.runs.slice(-MAX_RUNS) : []
      };
    } catch {
      return blank();
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n');
      return true;
    } catch {
      return false;
    }
  }

  get() {
    return JSON.parse(JSON.stringify(this.data));
  }

  stats() {
    const tasks = this.data.tasks;
    return {
      notes: this.data.notes.length,
      tasks: tasks.length,
      open: tasks.filter((t) => t.status !== 'done').length,
      done: tasks.filter((t) => t.status === 'done').length,
      runs: this.data.runs.length,
      hasProject: Boolean(this.data.project.summary || this.data.project.name)
    };
  }

  /* ---------------- project ---------------- */

  setProject(patch = {}) {
    const p = this.data.project;
    if (typeof patch.name === 'string') p.name = patch.name.slice(0, 200);
    if (typeof patch.summary === 'string') p.summary = patch.summary.slice(0, 4000);
    if (patch.stack !== undefined) p.stack = asArray(patch.stack).slice(0, 40);
    if (patch.conventions !== undefined) p.conventions = asArray(patch.conventions).slice(0, 60);
    this._save();
    return this.get();
  }

  /* ---------------- notes (decisions) ---------------- */

  addNote({ title, body = '', tags = [] } = {}) {
    const t = String(title || '').trim();
    if (!t) throw new Error('A note needs a title');
    const note = {
      id: shortId(),
      ts: new Date().toISOString(),
      title: t.slice(0, 200),
      body: String(body || '').slice(0, 4000),
      tags: asArray(tags).slice(0, 10)
    };
    this.data.notes.push(note);
    if (this.data.notes.length > MAX_NOTES) this.data.notes = this.data.notes.slice(-MAX_NOTES);
    this._save();
    return note;
  }

  updateNote(id, patch = {}) {
    const n = this.data.notes.find((x) => x.id === id);
    if (!n) throw new Error(`No note with id ${id}`);
    if (typeof patch.title === 'string' && patch.title.trim()) n.title = patch.title.trim().slice(0, 200);
    if (typeof patch.body === 'string') n.body = patch.body.slice(0, 4000);
    if (patch.tags !== undefined) n.tags = asArray(patch.tags).slice(0, 10);
    n.updated = new Date().toISOString();
    this._save();
    return n;
  }

  removeNote(id) {
    const before = this.data.notes.length;
    this.data.notes = this.data.notes.filter((x) => x.id !== id);
    const removed = this.data.notes.length !== before;
    if (removed) this._save();
    return removed;
  }

  /* ---------------- tasks ---------------- */

  addTask({ title } = {}) {
    const t = String(title || '').trim();
    if (!t) throw new Error('A task needs a title');
    const task = { id: shortId(), ts: new Date().toISOString(), title: t.slice(0, 300), status: 'todo' };
    this.data.tasks.push(task);
    if (this.data.tasks.length > MAX_TASKS) this.data.tasks = this.data.tasks.slice(-MAX_TASKS);
    this._save();
    return task;
  }

  setTaskStatus(id, status) {
    const s = ['todo', 'doing', 'done'].includes(status) ? status : 'todo';
    const t = this.data.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`No task with id ${id}`);
    t.status = s;
    this._save();
    return t;
  }

  removeTask(id) {
    const before = this.data.tasks.length;
    this.data.tasks = this.data.tasks.filter((x) => x.id !== id);
    const removed = this.data.tasks.length !== before;
    if (removed) this._save();
    return removed;
  }

  /* ---------------- run history ---------------- */

  recordRun({ prompt = '', provider = '', actions = 0, chars = 0 } = {}) {
    this.data.runs.push({
      ts: new Date().toISOString(),
      prompt: String(prompt).slice(0, 300),
      provider: String(provider).slice(0, 60),
      actions: Number(actions) || 0,
      chars: Number(chars) || 0
    });
    if (this.data.runs.length > MAX_RUNS) this.data.runs = this.data.runs.slice(-MAX_RUNS);
    this._save();
  }

  clear(kind) {
    if (!kind || kind === 'all') this.data = blank();
    else if (this.data[kind]) this.data[kind] = Array.isArray(this.data[kind]) ? [] : blank()[kind];
    this._save();
    return this.get();
  }

  /* ---------------- what the AI sees ---------------- */

  contextBlock(maxChars = 2500) {
    const d = this.data;
    const st = this.stats();
    if (!st.notes && !st.tasks && !st.hasProject) return '';

    const lines = ['## Project memory (persistent context from earlier sessions)'];
    if (d.project.name) lines.push(`Project: ${d.project.name}`);
    if (d.project.summary) lines.push(`Summary: ${d.project.summary}`);
    if (d.project.stack?.length) lines.push(`Stack: ${d.project.stack.join(', ')}`);
    if (d.project.conventions?.length) {
      lines.push('Conventions to always follow:');
      d.project.conventions.slice(0, 20).forEach((c) => lines.push(`- ${c}`));
    }

    const open = d.tasks.filter((t) => t.status !== 'done');
    if (open.length) {
      lines.push(`Open tasks (${open.length}):`);
      open.slice(-15).forEach((t) => lines.push(`- [${t.status}] ${t.title}`));
    }

    if (d.notes.length) {
      lines.push('Decisions already made — do not re-litigate, build on them:');
      d.notes.slice(-8).reverse().forEach((n) => {
        const body = n.body ? ` — ${n.body.slice(0, 220)}` : '';
        lines.push(`- ${n.title}${body}`);
      });
    }

    let out = lines.join('\n');
    if (out.length > maxChars) out = out.slice(0, maxChars - 1) + '…';
    return out;
  }
}

module.exports = { MemoryStore, MAX_RUNS, MAX_NOTES, MAX_TASKS };
