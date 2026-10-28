import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function Settings({ info, providers, workspace, focusProvider, onClose, onSaved, onChooseWorkspace, onLock }) {
  const [selected, setSelected] = useState(focusProvider || providers.find((p) => p.keyEnv)?.id || 'builtin');
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState(null);
  const [caps, setCaps] = useState(null);
  const [plugins, setPlugins] = useState(null);
  const [pluginMsg, setPluginMsg] = useState({});
  const [lockInfo, setLockInfo] = useState(null);
  const [audit, setAudit] = useState(null);
  const [sec, setSec] = useState({ cur: '', nw: '', cf: '' });
  const [secMsg, setSecMsg] = useState(null);
  const [bridge, setBridge] = useState(null);
  const [bridgeMsg, setBridgeMsg] = useState('');

  // live bridge state: running? which mode? (desktop app only)
  useEffect(() => {
    let live = true;
    const load = () => api.bridgeState?.().then((r) => { if (live && r?.ok) setBridge(r); }).catch(() => {});
    load();
    const id = setInterval(load, 4000);
    return () => { live = false; clearInterval(id); };
  }, []);

  const openChrome = async () => {
    const r = await api.bridgeOpen?.(bridge?.mode || 'full');
    if (r?.ok) setBridgeMsg(`Chrome opened on http://127.0.0.1:${r.port} — ${r.mode === 'readonly' ? 'read-only' : 'full access'}`);
    else setBridgeMsg(r?.error || 'Could not start the browser bridge');
  };

  const setBridgeMode = async (mode) => {
    const r = await api.bridgeSetMode?.(mode);
    if (r?.ok) {
      setBridge((b) => ({ ...(b || {}), mode: r.mode, running: Boolean(b?.running) }));
      setBridgeMsg(r.mode === 'readonly'
        ? 'Chrome is now read-only: it can view files and the terminal, but cannot write, run commands, change keys or talk to the AI.'
        : 'Chrome has full access to this workspace again.');
    } else setBridgeMsg(r?.error || 'Could not change browser access');
  };

  const current = providers.find((p) => p.id === selected);

  useEffect(() => { if (focusProvider) { setSelected(focusProvider); setMsg(null); setValue(''); setTestRes(null); } }, [focusProvider]);

  useEffect(() => {
    api.capabilities().then(setCaps).catch(() => {});
    api.plugins().then((r) => r?.ok && setPlugins(r)).catch(() => {});
    api.lockState().then(setLockInfo).catch(() => {});
    api.auditRead(50).then((r) => r?.ok && setAudit(r.entries)).catch(() => {});
  }, []);

  const savePin = async () => {
    setSecMsg(null);
    if (sec.nw !== sec.cf) { setSecMsg({ ok: false, text: 'New PIN and confirmation do not match.' }); return; }
    const r = lockInfo?.set ? await api.lockChange(sec.cur, sec.nw) : await api.lockSet(sec.nw);
    if (r?.ok) {
      setSecMsg({ ok: true, text: lockInfo?.set ? 'PIN changed.' : 'PIN set. The app now locks behind it.' });
      setSec({ cur: '', nw: '', cf: '' });
      setLockInfo(await api.lockState());
    } else setSecMsg({ ok: false, text: r?.error || 'Could not save PIN' });
  };

  const clearPin = async () => {
    const r = await api.lockClear();
    if (r?.ok) { setLockInfo(await api.lockState()); setSecMsg({ ok: true, text: 'PIN removed.' }); }
  };

  const setAuto = async (m) => {
    const r = await api.lockAutoLock(m);
    if (r?.ok) setLockInfo((l) => ({ ...l, autoLockMinutes: r.autoLockMinutes }));
  };

  const togglePlugin = async (id, on) => {
    const r = await api.pluginSetEnabled(id, on);
    if (r?.ok) {
      setPlugins((p) => ({ ...p, plugins: p.plugins.map((x) => (x.id === id ? r.plugin : x)) }));
      onSaved?.();
    } else setPluginMsg((m) => ({ ...m, [id]: { ok: false, text: r?.error } }));
  };

  const testPlugin = async (id) => {
    setPluginMsg((m) => ({ ...m, [id]: { pending: true } }));
    const r = await api.pluginTest(id);
    setPluginMsg((m) => ({
      ...m,
      [id]: r?.ok
        ? { ok: true, text: r.kind === 'tools' ? `✓ tools registered: ${r.tools.join(', ')}` : `✓ provider responded: “${r.sample}”` }
        : { ok: false, text: `✗ ${r?.error}` }
    }));
  };

  const rescan = async () => {
    const r = await api.pluginsScan();
    if (r?.ok) { setPlugins(r); onSaved?.(); }
  };

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

          {/* ---- security ---- */}
          <div className="field">
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Security — app lock &amp; audit</span>
              {onLock && <button className="btn btn-sm" onClick={() => { onClose(); onLock(); }}>lock now</button>}
            </label>
            <div className="cap-detail" style={{ marginBottom: 8 }}>
              {lockInfo?.set
                ? 'A PIN protects this app. Only a correct PIN opens your workspace, keys and terminal.'
                : 'No PIN set — anyone with access to this machine can open the app. Recommended: set one.'}
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {lockInfo?.set && (
                <input className="lock-input inline" type="password" placeholder="Current PIN" value={sec.cur} onChange={(e) => setSec((s) => ({ ...s, cur: e.target.value }))} />
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="lock-input inline" type="password" placeholder="New PIN (4+ chars)" value={sec.nw} onChange={(e) => setSec((s) => ({ ...s, nw: e.target.value }))} style={{ flex: 1 }} />
                <input className="lock-input inline" type="password" placeholder="Confirm" value={sec.cf} onChange={(e) => setSec((s) => ({ ...s, cf: e.target.value }))} style={{ flex: 1 }} />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn btn-sm btn-solid" onClick={savePin} disabled={!sec.nw || !sec.cf}>{lockInfo?.set ? 'Change PIN' : 'Set PIN'}</button>
                {lockInfo?.set && <button className="btn btn-sm" onClick={clearPin}>Remove PIN</button>}
                <span className="cap-detail">Auto-lock after</span>
                <select className="sel sel-sm" style={{ width: 90 }} value={lockInfo?.autoLockMinutes ?? 0} onChange={(e) => setAuto(e.target.value)}>
                  <option value={0}>never</option><option value={5}>5 min</option><option value={10}>10 min</option><option value={30}>30 min</option>
                </select>
              </div>
              {secMsg && <div className="cap-detail" style={{ color: secMsg.ok ? 'var(--ok)' : 'var(--bad)' }}>{secMsg.text}</div>}
            </div>

            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="cap-detail" style={{ margin: 0 }}>Audit log (newest first)</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" onClick={() => api.auditRead(50).then((r) => r?.ok && setAudit(r.entries))}>⟳</button>
                <button className="btn btn-sm" onClick={() => api.auditClear().then(() => setAudit([]))}>clear</button>
              </span>
            </div>
            <div className="audit-box">
              {audit?.length ? audit.map((a, i) => (
                <div className="audit-row" key={i}>
                  <span className="audit-ts">{new Date(a.ts).toLocaleString()}</span>
                  <span className="audit-ev">{a.event}</span>
                  {a.detail && <span className="audit-dt">{JSON.stringify(a.detail)}</span>}
                </div>
              )) : <div className="cap-detail">No audit entries yet.</div>}
            </div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="cap-detail" style={{ margin: 0 }}>
                Browser access (Chrome on this PC){bridge?.running ? ` — live on 127.0.0.1:${bridge.port}` : ' — not running'}
              </span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select
                  className="sel sel-sm"
                  style={{ width: 130 }}
                  value={bridge?.mode || 'full'}
                  onChange={(e) => setBridgeMode(e.target.value)}
                  title="What a Chrome tab attached to this workspace may do"
                >
                  <option value="full">full access</option>
                  <option value="readonly">read-only</option>
                </select>
                <button className="btn btn-sm btn-solid" onClick={openChrome}>◎ open in chrome</button>
                {bridge?.running && <button className="btn btn-sm" onClick={async () => { await api.bridgeStop?.(); setBridge((b) => ({ ...(b || {}), running: false })); setBridgeMsg('Browser bridge stopped — no port is listening.'); }}>stop</button>}
              </span>
            </div>
            {bridgeMsg && <div className="cap-detail">{bridgeMsg}</div>}
            <div className="hint">
              Hardening active: renderer sandboxed, no Node access, all permission requests denied,
              external network calls from the UI blocked, plugin code isolated, keys stored 0600,
              PIN throttled after 5 wrong attempts, browser bridge loopback-only + token-gated.
            </div>
          </div>

          {/* ---- plugins ---- */}
          <div className="field">
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Plugins</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" onClick={rescan}>⟳ rescan</button>
                <button className="btn btn-sm" onClick={async () => { const r = await api.pluginOpenFolder('user'); if (!r?.ok) alert(r?.error || r?.dir || 'Unavailable here'); }}>＋ install folder</button>
              </span>
            </label>
            {plugins ? (
              <div className="cap-list compact">
                {plugins.plugins.map((p) => (
                  <div className="cap-row" key={p.id}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="cap-name">
                        {p.name} <span style={{ color: 'var(--faint)', fontWeight: 400 }}>v{p.version}</span>
                        {p.official && <span className="tag on" style={{ marginLeft: 6 }}>official</span>}
                        <span className={`tag ${p.status === 'loaded' ? 'on' : 'off'}`} style={{ marginLeft: 4 }}>{p.status}</span>
                      </div>
                      <div className="cap-detail">{p.description}</div>
                      <div className="cap-detail" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                        {p.provides.provider ? `provider: ${p.provides.provider.id}` : ''}
                        {p.provides.provider && p.provides.tools.length ? ' · ' : ''}
                        {p.provides.tools.length ? `tools: ${p.provides.tools.join(', ')}` : ''}
                      </div>
                      {p.error && <div className="cap-detail" style={{ color: 'var(--bad)' }}>{p.error}</div>}
                      {pluginMsg[p.id] && !pluginMsg[p.id].pending && (
                        <div className="cap-detail" style={{ color: pluginMsg[p.id].ok ? 'var(--ok)' : 'var(--bad)' }}>{pluginMsg[p.id].text}</div>
                      )}
                    </div>
                    <button className="btn btn-sm" disabled={!p.enabled || pluginMsg[p.id]?.pending} onClick={() => testPlugin(p.id)}>
                      {pluginMsg[p.id]?.pending ? '…' : 'test'}
                    </button>
                    <label className="switch">
                      <input type="checkbox" checked={p.enabled} onChange={(e) => togglePlugin(p.id, e.target.checked)} />
                      <span>{p.enabled ? 'on' : 'off'}</span>
                    </label>
                  </div>
                ))}
                {plugins.plugins.length === 0 && (
                  <div className="cap-row"><div className="cap-detail">No plugins found. Drop a folder with plugin.json into the install folder above.</div></div>
                )}
              </div>
            ) : <div className="hint">Loading…</div>}
            <div className="hint">
              A plugin is a folder with <code>plugin.json</code> + a module that exports <code>provider</code> and/or <code>tools</code>.
              Official plugins ship inside the app; yours live in the install folder. A broken plugin is isolated, never fatal.
            </div>
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
