import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function Settings({ info, providers, workspace, focusProvider, onClose, onSaved, onChooseWorkspace }) {
  const [selected, setSelected] = useState(focusProvider || providers.find((p) => p.keyEnv)?.id || 'builtin');
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState(null);
  const [caps, setCaps] = useState(null);

  const current = providers.find((p) => p.id === selected);

  useEffect(() => { if (focusProvider) { setSelected(focusProvider); setMsg(null); setValue(''); setTestRes(null); } }, [focusProvider]);

  useEffect(() => {
    api.capabilities().then(setCaps).catch(() => {});
  }, []);

  const reloadCaps = async () => setCaps(await api.capabilities().catch(() => caps));

  const save = async () => {
    if (!current?.keyEnv) return;
    setSaving(true); setMsg(null); setTestRes(null);
    try {
      const r = await api.setKey(current.id, value.trim());
      if (r?.ok) {
        setMsg({ kind: 'ok', text: r.persisted ? 'Key saved on this machine only.' : `Key set for this session (${r.warning || 'not persisted'})` });
        setValue('');
        onSaved?.();
      } else setMsg({ kind: 'bad', text: r?.error || 'Could not save key' });
    } catch (e) { setMsg({ kind: 'bad', text: e.message }); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    setValue(''); setSaving(true);
    const r = await api.setKey(current.id, '');
    setMsg({ kind: 'ok', text: r?.ok ? 'Key removed.' : 'Could not remove key.' });
    setSaving(false); setTestRes(null);
    onSaved?.();
  };

  const test = async () => {
    setTesting(true); setTestRes(null);
    const r = await api.testConnection(current.id);
    setTestRes(r);
    setTesting(false);
    onSaved?.();
  };

  const togglePerm = async (key, enabled) => {
    const r = await api.setPermission(key, enabled);
    if (r?.ok) setCaps((c) => ({ ...c, permissions: r.permissions }));
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Settings</h3>
            <p>Connect models, test them, and control exactly what the app may do.</p>
          </div>
          <button className="icon-btn modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* ---- providers ---- */}
          <div>
            <div className="sec-label" style={{ marginBottom: 8 }}>AI providers</div>
            {providers.map((p) => (
              <div className="prov-row" key={p.id}>
                <div style={{ flex: 1 }}>
                  <div className="nm">{p.name} <span style={{ color: 'var(--faint)', fontWeight: 400 }}>· {p.vendor}</span></div>
                  <div className="ke">{p.keyEnv || 'no key required · works offline'}</div>
                </div>
                <span className={`tag ${p.ready ? 'on' : 'off'}`}>{p.ready ? 'connected' : 'not connected'}</span>
                <button className="btn btn-sm" onClick={() => { setSelected(p.id); setMsg(null); setValue(''); setTestRes(null); }}>
                  Select
                </button>
              </div>
            ))}
          </div>

          {/* ---- key + test ---- */}
          {current?.keyEnv ? (
            <div className="field">
              <label htmlFor="apikey">{current.keyEnv} — {current.name}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  id="apikey"
                  type={show ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste your API key"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
                />
                <button className="btn btn-sm" onClick={() => setShow((s) => !s)} title="Show / hide">{show ? 'hide' : 'show'}</button>
              </div>
              <div className="hint">
                {current.description}
                {current.docs && <> · <a href="#" onClick={(e) => { e.preventDefault(); window.open(current.docs, '_blank'); }}>get a key</a></>}
                <br />Stored only on this computer; sent only to {current.name}.
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-sm btn-solid" onClick={save} disabled={saving || !value.trim()}>{saving ? 'Saving…' : 'Save key'}</button>
                <button className="btn btn-sm" onClick={test} disabled={testing}>{testing ? 'Testing…' : 'Test connection'}</button>
                {current.ready && <button className="btn btn-sm" onClick={remove} disabled={saving}>Remove key</button>}
              </div>
              {testRes && (
                <div className={`act ${testRes.ok ? 'ok' : 'fail'}`} style={{ marginTop: 10 }}>
                  {testRes.ok ? `✓ ${current.name} reachable in ${testRes.latencyMs}ms — “${testRes.sample}”` : `✗ ${testRes.error}`}
                </div>
              )}
            </div>
          ) : (
            <div className="field">
              <label>{current?.name} — built-in</label>
              <div className="hint">{current?.description}</div>
              <button className="btn btn-sm" onClick={test} disabled={testing} style={{ marginTop: 8 }}>{testing ? 'Testing…' : 'Test offline engine'}</button>
              {testRes && <div className={`act ${testRes.ok ? 'ok' : 'fail'}`} style={{ marginTop: 10 }}>{testRes.ok ? `✓ offline engine responded in ${testRes.latencyMs}ms` : `✗ ${testRes.error}`}</div>}
            </div>
          )}

          {msg && <div className="act" style={{ color: msg.kind === 'ok' ? 'var(--ok)' : 'var(--bad)', borderColor: 'var(--line)' }}>{msg.text}</div>}

          {/* ---- permissions ---- */}
          <div className="field">
            <label>Permissions</label>
            {caps ? (
              <div className="cap-list compact">
                {caps.features.filter((f) => f.toggle).map((f) => (
                  <div className="cap-row" key={f.id}>
                    <div style={{ flex: 1 }}>
                      <div className="cap-name">{f.name}</div>
                      <div className="cap-detail">{f.detail}</div>
                    </div>
                    <label className="switch">
                      <input type="checkbox" checked={Boolean(caps.permissions[f.toggle])} onChange={(e) => togglePerm(f.toggle, e.target.checked)} />
                      <span>{caps.permissions[f.toggle] ? 'allowed' : 'blocked'}</span>
                    </label>
                  </div>
                ))}
              </div>
            ) : <div className="hint">Loading…</div>}
          </div>

          {/* ---- workspace ---- */}
          <div className="field">
            <label>Workspace</label>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, wordBreak: 'break-all', color: 'var(--muted)', marginBottom: 8 }}>{workspace}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-sm" onClick={onChooseWorkspace}>⇄ Choose folder…</button>
              <button className="btn btn-sm" onClick={async () => { const r = await api.openWorkspace(); if (!r?.ok) alert(r?.error || 'Unavailable here'); }}>⌥ Open folder</button>
              <button className="btn btn-sm" onClick={async () => { const r = await api.revealWorkspace(); if (!r?.ok) alert(r?.error || 'Unavailable here'); }}>⌖ Reveal</button>
            </div>
            <div className="hint">Where the agent writes code and the terminal starts. The agent can never leave this folder.</div>
          </div>

          {/* ---- about ---- */}
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
