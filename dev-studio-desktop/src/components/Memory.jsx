import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Workspace memory.
 *
 * Everything here is stored in <workspace>/.dev-studio/memory.json and injected
 * into the system prompt of both the solo agent and the 4-role AI team, so the
 * models keep the project's decisions, conventions and open tasks between runs
 * — which is what makes them usable on a large codebase.
 */
const NEXT = { todo: 'doing', doing: 'done', done: 'todo' };

export default function MemoryPanel({ workspace, onClose }) {
  const [mem, setMem] = useState(null);
  const [stats, setStats] = useState(null);
  const [context, setContext] = useState('');
  const [msg, setMsg] = useState('');
  const [proj, setProj] = useState({ name: '', summary: '', stack: '', conventions: '' });
  const [note, setNote] = useState({ title: '', body: '' });
  const [task, setTask] = useState('');

  const reload = useCallback(async () => {
    const r = await api.memoryGet?.();
    if (r?.ok) {
      setMem(r.memory);
      setStats(r.stats);
      setContext(r.context || '');
      setProj({
        name: r.memory?.project?.name || '',
        summary: r.memory?.project?.summary || '',
        stack: (r.memory?.project?.stack || []).join(', '),
        conventions: (r.memory?.project?.conventions || []).join('\n')
      });
    } else if (r?.error) setMsg(r.error);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 4000); };

  const saveProject = async () => {
    const r = await api.memoryProject({
      name: proj.name,
      summary: proj.summary,
      stack: proj.stack.split(',').map((s) => s.trim()).filter(Boolean),
      conventions: proj.conventions.split('\n').map((s) => s.trim()).filter(Boolean)
    });
    if (r?.ok) { setMem(r.memory); await reload(); flash('Project context saved — the AI will use it on every run.'); }
    else flash(r?.error || 'Could not save');
  };

  const addNote = async () => {
    if (!note.title.trim()) return;
    const r = await api.memoryAddNote({ title: note.title, body: note.body });
    if (r?.ok) { setNote({ title: '', body: '' }); await reload(); flash('Decision recorded.'); }
    else flash(r?.error || 'Could not add note');
  };

  const addTask = async () => {
    if (!task.trim()) return;
    const r = await api.memoryAddTask({ title: task });
    if (r?.ok) { setTask(''); await reload(); flash('Task added — the AI sees open tasks.'); }
    else flash(r?.error || 'Could not add task');
  };

  const cycle = async (t) => {
    await api.memorySetTask(t.id, NEXT[t.status] || 'todo');
    await reload();
  };

  return (
    <div className="backdrop" onClick={onClose}>
    <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head">
        <div>
          <h3>Project memory</h3>
          <p>Persistent context for the AI — stored in your workspace, shared by every model and every run.</p>
        </div>
        <button className="btn btn-sm modal-close" onClick={onClose}>✕</button>
      </div>

      <div className="modal-body">
        {stats && (
          <div className="mem-stats">
            <span><b>{stats.notes}</b> decisions</span>
            <span><b>{stats.open}</b> open tasks</span>
            <span><b>{stats.done}</b> done</span>
            <span><b>{stats.runs}</b> logged runs</span>
            <span className="mem-path" title={workspace}>{workspace}</span>
          </div>
        )}

        {/* ---- project ---- */}
        <div className="field">
          <label>Project</label>
          <div className="cap-detail" style={{ marginBottom: 8 }}>
            One paragraph the models read before they write a single line. Keep it current.
          </div>
          <input
            className="lock-input inline"
            placeholder="Project name"
            value={proj.name}
            onChange={(e) => setProj((p) => ({ ...p, name: e.target.value }))}
          />
          <textarea
            className="lock-input inline mem-area"
            placeholder="What is this software? Who uses it? What matters most (performance, offline, security, scale)?"
            value={proj.summary}
            onChange={(e) => setProj((p) => ({ ...p, summary: e.target.value }))}
          />
          <input
            className="lock-input inline"
            placeholder="Stack, comma separated — React, Electron, Node 20, PostgreSQL"
            value={proj.stack}
            onChange={(e) => setProj((p) => ({ ...p, stack: e.target.value }))}
          />
          <textarea
            className="lock-input inline mem-area"
            placeholder={'Conventions, one per line —\nAll files use 2-space indent\nNever commit API keys\nTests live next to source'}
            value={proj.conventions}
            onChange={(e) => setProj((p) => ({ ...p, conventions: e.target.value }))}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-solid" onClick={saveProject}>Save project context</button>
          </div>
        </div>

        {/* ---- decisions ---- */}
        <div className="field">
          <label>Decisions &amp; notes</label>
          <div className="cap-detail" style={{ marginBottom: 8 }}>
            Things already settled — the team builds on them instead of re-litigating.
          </div>
          {mem?.notes?.length ? (
            <div className="mem-list">
              {mem.notes.slice().reverse().map((n) => (
                <div className="mem-row" key={n.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mem-title">{n.title}</div>
                    {n.body && <div className="mem-body">{n.body}</div>}
                    <div className="mem-meta">
                      {new Date(n.ts).toLocaleDateString()}
                      {n.tags?.length ? ` · ${n.tags.join(', ')}` : ''}
                    </div>
                  </div>
                  <button className="btn btn-sm" onClick={async () => { await api.memoryRemoveNote(n.id); await reload(); }}>✕</button>
                </div>
              ))}
            </div>
          ) : <div className="cap-detail">No decisions recorded yet.</div>}
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <input
              className="lock-input inline"
              placeholder="Decision — e.g. Auth uses JWT with 15 min refresh"
              value={note.title}
              onChange={(e) => setNote((n) => ({ ...n, title: e.target.value }))}
            />
            <textarea
              className="lock-input inline mem-area"
              placeholder="Why (optional) — the reasoning the AI should respect"
              value={note.body}
              onChange={(e) => setNote((n) => ({ ...n, body: e.target.value }))}
            />
            <button className="btn btn-sm btn-solid" onClick={addNote} disabled={!note.title.trim()}>＋ record decision</button>
          </div>
        </div>

        {/* ---- tasks ---- */}
        <div className="field">
          <label>Task list</label>
          <div className="cap-detail" style={{ marginBottom: 8 }}>
            Open tasks are injected into the prompt, so “continue where we left off” actually works.
          </div>
          {mem?.tasks?.length ? (
            <div className="mem-list">
              {mem.tasks.slice().reverse().map((t) => (
                <div className="mem-row" key={t.id}>
                  <button className={`mem-status s-${t.status}`} title="Click to change status" onClick={() => cycle(t)}>{t.status}</button>
                  <span className={`mem-title ${t.status === 'done' ? 'done' : ''}`} style={{ flex: 1 }}>{t.title}</span>
                  <button className="btn btn-sm" onClick={async () => { await api.memoryRemoveTask(t.id); await reload(); }}>✕</button>
                </div>
              ))}
            </div>
          ) : <div className="cap-detail">No tasks yet.</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              className="lock-input inline"
              style={{ flex: 1 }}
              placeholder="Add a task — e.g. Add rate limiting to /api/login"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTask()}
            />
            <button className="btn btn-sm btn-solid" onClick={addTask} disabled={!task.trim()}>＋ add</button>
          </div>
        </div>

        {/* ---- what the AI sees ---- */}
        <details className="pstep">
          <summary>What the AI actually receives</summary>
          <pre className="mem-ctx">{context || '(empty — add a project summary, decisions or tasks)'}</pre>
        </details>

        {msg && <div className="cap-detail">{msg}</div>}

        <div className="hint">
          Stored as plain JSON at <code>.dev-studio/memory.json</code> inside your workspace — commit it and your
          teammates (and every model) inherit the same context. Clearing it never touches your code.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={async () => { await api.memoryClear('runs'); await reload(); flash('Run history cleared.'); }}>clear run history</button>
          <button className="btn btn-sm" onClick={async () => { await api.memoryClear('tasks'); await reload(); flash('Tasks cleared.'); }}>clear tasks</button>
          <button className="btn btn-sm" onClick={async () => { await api.memoryClear('all'); await reload(); flash('All memory cleared.'); }}>clear everything</button>
        </div>
      </div>
    </div>
    </div>
  );
}
