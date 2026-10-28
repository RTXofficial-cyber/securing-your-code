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

export default function EditorPane({ file, onSave, onNew }) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dark, setDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark');

  useEffect(() => {
    const obs = new MutationObserver(() => {
      setDark(document.documentElement.getAttribute('data-theme') === 'dark');
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    setDraft(file?.content ?? '');
    setDirty(false);
  }, [file?.path, file?.content]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && file) {
        e.preventDefault();
        doSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const doSave = async () => {
    if (!file) return;
    setSaving(true);
    try {
      await onSave(file.path, draft);
      setDirty(false);
    } catch (e) {
      alert(String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  if (!file) {
    return (
      <div className="editor-pane">
        <div className="pane-head">
          <span className="pane-title">Editor</span>
        </div>
        <div className="editor-empty">
          <div className="big">No file open</div>
          <p>Pick a file from the workspace rail on the left, or let the agent create one for you.</p>
          <button className="btn btn-sm" onClick={onNew}>＋ New file</button>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-pane">
      <div className="pane-head">
        <span className="pane-title">
          <b>{file.path.split('/').pop()}</b> — {file.path}
          {dirty && <span style={{ color: 'var(--faint)' }}> · unsaved</span>}
        </span>
        <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--mono)' }}>Ctrl+S</span>
        <button className="btn btn-sm btn-solid" onClick={doSave} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div className="editor-body">
        <MonacoEditor
          height="100%"
          language={langOf(file.path)}
          theme={dark ? 'vs-dark' : 'vs'}
          value={draft}
          onChange={(v) => { setDraft(v ?? ''); setDirty(true); }}
          options={{
            fontSize: 13,
            fontFamily: 'var(--mono)',
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            tabSize: 2,
            renderWhitespace: 'selection',
            padding: { top: 14, bottom: 14 }
          }}
        />
      </div>
    </div>
  );
}
