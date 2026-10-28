import React, { useEffect, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';

function langOf(p = '') {
  if (/\.(jsx?|mjs|cjs)$/.test(p)) return 'javascript';
  if (/\.tsx?$/.test(p)) return 'typescript';
  if (/\.pyw?$/.test(p)) return 'python';
  if (/\.json$/.test(p)) return 'json';
  if (/\.html?$/.test(p)) return 'html';
  if (/\.css$/.test(p)) return 'css';
  if (/\.md$/.test(p)) return 'markdown';
  if (/\.ya?ml$/.test(p)) return 'yaml';
  if (/\.(sh|bash|zsh|bat|cmd|ps1)$/.test(p)) return 'shell';
  if (/\.(c|h|cpp|hpp|cc)$/.test(p)) return 'cpp';
  if (/\.(go|rs|java|rb|php|sql|xml|toml|ini)$/.test(p)) return p.split('.').pop();
  return 'plaintext';
}

export default function EditorPane({ openFiles, activePath, onSelect, onClose, onSave, onNew }) {
  const file = openFiles.find((f) => f.path === activePath) || null;
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dark, setDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark');

  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.getAttribute('data-theme') === 'dark'));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => { setDraft(file?.content ?? ''); setDirty(false); }, [activePath, file?.content]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && file) { e.preventDefault(); doSave(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const doSave = async () => {
    if (!file) return;
    setSaving(true);
    try { await onSave(file.path, draft); setDirty(false); }
    catch (e) { alert(String(e.message || e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="editor-pane">
      {/* Tab bar — VS Code style */}
      <div className="tabs">
        <div className="tabs-scroll">
          {openFiles.length === 0 && <span className="tabs-empty">no editors open</span>}
          {openFiles.map((f) => (
            <button
              key={f.path}
              className={`tab ${f.path === activePath ? 'active' : ''}`}
              onClick={() => onSelect(f.path)}
              title={f.path}
            >
              <span className="tab-name">{f.path.split('/').pop()}</span>
              <span
                className="tab-close"
                onClick={(e) => { e.stopPropagation(); onClose(f.path); }}
                title="Close"
              >✕</span>
            </button>
          ))}
        </div>
        <button className="tab-add" onClick={onNew} title="New file">＋</button>
        {file && (
          <button className="btn btn-sm btn-solid tab-save" onClick={doSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : dirty ? '● Save' : 'Save'}
          </button>
        )}
      </div>

      {file ? (
        <div className="editor-body">
          <MonacoEditor
            height="100%"
            language={langOf(file.path)}
            theme={dark ? 'vs-dark' : 'vs'}
            value={draft}
            onChange={(v) => { setDraft(v ?? ''); setDirty(true); }}
            options={{
              fontSize: 13, fontFamily: 'var(--mono)', minimap: { enabled: false },
              automaticLayout: true, scrollBeyondLastLine: false, smoothScrolling: true,
              cursorBlinking: 'smooth', tabSize: 2, renderWhitespace: 'selection',
              padding: { top: 14, bottom: 14 }
            }}
          />
        </div>
      ) : (
        <div className="editor-empty">
          <div className="big">No file open</div>
          <p>Pick a file from Explorer, click a “wrote …” line in the AI panel, or create one.</p>
          <button className="btn btn-sm" onClick={onNew}>＋ New file</button>
        </div>
      )}
    </div>
  );
}
