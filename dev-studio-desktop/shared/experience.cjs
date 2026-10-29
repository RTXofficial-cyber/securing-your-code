/**
 * Mission experience — Deep/Auto learn from their own history.
 *
 * Every finished mission (Deep ReAct run, Deep offline mission, Auto run)
 * is recorded in <workspace>/.dev-studio/experience.json: goal, engine,
 * outcome, files, failures and a one-line lesson. Before the next mission,
 * the most relevant entries are injected into the planner / ReAct system
 * prompt, so the agent starts with scar tissue instead of amnesia:
 *
 *   "node --check failed on app.js because of a stray comma" last time
 *   → this time the plan verifies more carefully.
 *
 * The file travels with the project (same convention as memory.json), is
 * capped at 40 entries, and can be cleared without touching anything else.
 */
const fs = require('fs');
const path = require('path');

const STOP = new Set(['build', 'make', 'create', 'write', 'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'karo', 'banao', 'mujhe', 'mein', 'kiya', 'please', 'help', 'using', 'add', 'new', 'file', 'files', 'code', 'script', 'app', 'website', 'page', 'project', 'run', 'fix', 'search', 'research']);

function tokens(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9]{4,}/g) || [];
}

class ExperienceStore {
  constructor(file) {
    this.file = file;
    this.data = { entries: [] };
    this.load();
  }

  load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (d && Array.isArray(d.entries)) this.data = { entries: d.entries };
    } catch { this.data = { entries: [] }; }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch { /* read-only workspace: experience is a bonus, never fatal */ }
  }

  record(e) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: new Date().toISOString(),
      goal: String(e.goal || '').slice(0, 200),
      engine: String(e.engine || 'mission'),
      ok: Boolean(e.ok),
      files: (e.files || []).slice(0, 8),
      failures: (e.failures || []).slice(0, 3).map((f) => String(f).slice(0, 300)),
      lesson: String(e.lesson || '').slice(0, 300)
    };
    this.data.entries.unshift(entry);
    this.data.entries = this.data.entries.slice(0, 40);
    this.save();
    return entry;
  }

  stats() {
    const entries = this.data.entries;
    return { total: entries.length, successes: entries.filter((e) => e.ok).length, failures: entries.filter((e) => !e.ok).length };
  }

  relevant(goal, k = 3) {
    const g = new Set(tokens(goal).filter((t) => !STOP.has(t)));
    if (!g.size) return [];
    const scored = this.data.entries.map((e) => {
      const t = tokens(`${e.goal} ${e.lesson} ${e.failures.join(' ')}`).filter((x) => !STOP.has(x));
      const overlap = new Set(t.filter((x) => g.has(x))).size;
      return { e, score: overlap };
    }).filter((x) => x.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((x) => x.e);
  }

  contextBlock(goal, k = 3) {
    const entries = this.relevant(goal, k);
    if (!entries.length) return '';
    const lines = ['Lessons from previous missions in THIS workspace (use them, do not repeat old mistakes):'];
    for (const e of entries) {
      const what = e.lesson || (e.failures.length ? e.failures[0] : (e.ok ? 'worked' : 'failed'));
      lines.push(`- "${e.goal.slice(0, 90)}" [${e.engine}, ${e.ok ? 'SUCCEEDED' : 'FAILED'}]: ${what}`);
    }
    return lines.join('\n');
  }

  clear(kind) {
    if (kind === 'failures') this.data.entries = this.data.entries.filter((e) => e.ok);
    else if (kind === 'successes') this.data.entries = this.data.entries.filter((e) => !e.ok);
    else this.data.entries = [];
    this.save();
    return this.stats();
  }

  get() { return this.data.entries; }
}

module.exports = { ExperienceStore };
