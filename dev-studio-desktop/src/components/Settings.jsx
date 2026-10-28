import React, { useState } from 'react';
import { api } from '../lib/api.js';

export default function Settings({ info, providers, workspace, onClose, onSaved, onChooseWorkspace }) {
  const [selected, setSelected] = useState(providers.find((p) => p.keyEnv)?.id || 'builtin');
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  const current = providers.find((p) => p.id === selected);

  const save = async () => {
    if (!current?.keyEnv) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await api.setKey(current.id, value.trim());
      if (r?.ok) {
        setMsg({ kind: 'ok', text: r.persisted ? 'Key saved. It stays on this machine only.' : `Key set for this session (${r.warning || 'not persisted'})` });
        setValue('');
        onSaved?.();
      } else {
        setMsg({ kind: 'bad', text: r?.error || 'Could not save key' });
      }
    } catch (e) {
      setMsg({ kind: 'bad', text: e.message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setValue('');
    setSaving(true);
    const r = await api.setKey(current.id, '');
    setMsg({ kind: 'ok', text: r?.ok ? 'Key removed.' : 'Could not remove key.' });
    setSaving(false);
    onSaved?.();
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Settings</h3>
            <p>Connect AI providers and manage your workspace.</p>
          </div>
          <button className="icon-btn modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div>
            <div className="sec-label" style={{ marginBottom: 8 }}>Providers</div>
            {providers.map((p) => (
              <div className="prov-row" key={p.id}>
                <div style={{ flex: 1 }}>
                  <div className="nm">{p.name} <span style={{ color: 'var(--faint)', fontWeight: 400 }}>· {p.vendor}</span></div>
                  <div className="ke">{p.keyEnv || 'no key required'}</div>
                </div>
                <span className={`tag ${p.ready ? 'on' : 'off'}`}>{p.ready ? 'connected' : 'not connected'}</span>
                {p.keyEnv && (
                  <button className="btn btn-sm" onClick={() => { setSelected(p.id); setMsg(null); setValue(''); }}>
                    {p.ready ? 'Change' : 'Connect'}
                  </button>
                )}
              </div>
            ))}
          </div>

          {current?.keyEnv && (
            <div className="field">
              <label htmlFor="apikey">{current.keyEnv} — {current.name}</label>
              <input
                id="apikey"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your API key"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              />
              <div className="hint">
                {current.description}
                {current.docs && <> · Get a key at <a href="#" onClick={(e) => { e.preventDefault(); api_openExternal(current.docs); }}>{current.docs.replace(/^https?:\/\//, '')}</a></>}
                <br />Stored only on this computer, used only by the provider you pick in chat.
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn btn-sm btn-solid" onClick={save} disabled={saving || !value.trim()}>
                  {saving ? 'Saving…' : 'Save key'}
                </button>
                {current.ready && (
                  <button className="btn btn-sm" onClick={remove} disabled={saving}>Remove key</button>
                )}
              </div>
            </div>
          )}

          {msg && (
            <div className="act" style={{ color: msg.kind === 'ok' ? 'var(--ok)' : 'var(--bad)', borderColor: 'var(--line)' }}>
              {msg.text}
            </div>
          )}

          <div className="field">
            <label>Workspace</label>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, wordBreak: 'break-all', color: 'var(--muted)', marginBottom: 8 }}>
              {workspace}
            </div>
            <button className="btn btn-sm" onClick={onChooseWorkspace}>⇄ Choose folder…</button>
            <div className="hint">Where the agent writes code and where the terminal starts.</div>
          </div>

          <div className="field">
            <label>About</label>
            <dl className="kv">
              <dt>Version</dt><dd>{info?.version || '—'}</dd>
              <dt>Platform</dt><dd>{info?.platform || '—'} {info?.arch || ''}</dd>
              <dt>Electron</dt><dd>{info?.electron || '—'}</dd>
              <dt>Node</dt><dd>{info?.node || '—'}</dd>
              <dt>Packaged</dt><dd>{info?.packaged ? 'yes (.exe build)' : 'no (development)'}</dd>
              {info?.envFileUsed && <><dt>Env file</dt><dd>{info.envFileUsed}</dd></>}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

function api_openExternal(url) {
  // Opened by the main process, never inside the app window.
  window.open(url, '_blank');
}
