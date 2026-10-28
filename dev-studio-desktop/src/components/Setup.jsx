import React, { useEffect, useState } from 'react';
import { api, isDesktop } from '../lib/api.js';

function CopyCmd({ cmd }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      prompt('Copy this command:', cmd);
    }
  };
  return (
    <div className="cmdrow">
      <code>{cmd}</code>
      <button className="btn btn-sm" onClick={copy}>{copied ? '✓ copied' : 'copy'}</button>
    </div>
  );
}

export default function Setup({ providers, info, theme, isDesktop, onToggleTheme, onHome, onOpen, onConnect, onProvidersChanged }) {
  const [caps, setCaps] = useState(null);
  const [testing, setTesting] = useState(null);
  const [testResult, setTestResult] = useState({});

  const loadCaps = async () => {
    try { setCaps(await api.capabilities()); } catch (e) { console.error(e); }
  };
  useEffect(() => { loadCaps(); }, []);

  const toggle = async (key, enabled) => {
    const r = await api.setPermission(key, enabled);
    if (r?.ok) setCaps((c) => ({ ...c, permissions: r.permissions }));
  };

  const test = async (id) => {
    setTesting(id);
    const r = await api.testConnection(id);
    setTestResult((t) => ({ ...t, [id]: r }));
    setTesting(null);
    onProvidersChanged?.();
  };

  return (
    <div className="landing">
      <nav className="nav">
        <button className="brand" onClick={onHome} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          <span className="brand-mark">D</span> Dev Studio
        </button>
        <div className="nav-links">
          <button className="nav-link" onClick={onHome}>Home</button>
          <button className="nav-link" onClick={onOpen}>Studio</button>
        </div>
        <div className="nav-spacer" />
        <button className="icon-btn" onClick={onToggleTheme}>{theme === 'light' ? '☾' : '☀'}</button>
        <button className="btn btn-solid" onClick={onOpen}>Open Studio →</button>
      </nav>

      <div className="wrap">
        <header className="hero" style={{ paddingBottom: 40 }}>
          <div className="eyebrow"><span className="pulse" /> Setup &amp; permissions</div>
          <h1 className="display" style={{ maxWidth: '18ch' }}>From installer to first build.</h1>
          <p className="hero-sub">
            Everything the app can do, how to get the <code>.exe</code>, how to connect your models, and
            exactly which permissions you grant it.
          </p>
        </header>

        {/* ---------- 1. Get the exe ---------- */}
        <section className="band" style={{ borderTop: 'none', paddingTop: 8 }}>
          <div className="sec-head">
            <div className="sec-label">Step 1</div>
            <h2 className="sec-title">Get the Windows .exe</h2>
          </div>

          <div className="setup-grid">
            <div className="setup-card">
              <div className="setup-tag">Option A · no toolchain</div>
              <h3>Let GitHub build it</h3>
              <p>
                Move the shipped workflow into place and push. A real Windows runner compiles the app and
                uploads the installer + portable exe as downloadable artifacts.
              </p>
              <CopyCmd cmd="mkdir -p .github/workflows" />
              <CopyCmd cmd="git mv dev-studio-desktop/ci/build-desktop.yml .github/workflows/build-desktop.yml" />
              <CopyCmd cmd="git commit -m 'Enable desktop CI' && git push" />
              <p className="dim">Then: Actions → “Build Dev Studio Desktop” → Artifacts.</p>
            </div>

            <div className="setup-card">
              <div className="setup-tag">Option B · on your PC</div>
              <h3>Build it locally</h3>
              <p>Needs only Node.js 18+. No Visual Studio, no node-gyp, no native modules — the build cannot fail on compiled dependencies.</p>
              <CopyCmd cmd="cd dev-studio-desktop" />
              <CopyCmd cmd="npm ci" />
              <CopyCmd cmd="npm run dist:win" />
              <p className="dim">Output: release/Dev Studio-1.0.0-Windows-x64.exe and …-Portable.exe</p>
            </div>
          </div>
        </section>

        {/* ---------- 2. Connect models ---------- */}
        <section className="band alt">
          <div className="sec-head">
            <div className="sec-label">Step 2</div>
            <h2 className="sec-title">Connect your models</h2>
            <p className="sec-sub">
              Keys are stored on this machine only and sent only to the provider you select.
              The built-in engine needs nothing — it works offline.
            </p>
          </div>

          <div className="providers">
            {providers.map((p) => (
              <div className="prov" key={p.id}>
                <div className="prov-top">
                  <span className="prov-name">{p.name}</span>
                  <span className={`tag ${p.ready ? 'on' : 'off'}`}>{p.ready ? 'connected' : 'add key'}</span>
                </div>
                <div className="prov-vendor">{p.vendor}</div>
                <div className="prov-desc">{p.description}</div>
                <div className="prov-actions">
                  {p.keyEnv ? (
                    <>
                      <button className="btn btn-sm" onClick={() => onConnect(p.id)}>{p.ready ? 'Change key' : 'Connect'}</button>
                      <button className="btn btn-sm" disabled={testing === p.id} onClick={() => test(p.id)}>
                        {testing === p.id ? 'testing…' : 'Test'}
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-sm" disabled={testing === p.id} onClick={() => test(p.id)}>
                      {testing === p.id ? 'testing…' : 'Test offline engine'}
                    </button>
                  )}
                </div>
                {testResult[p.id] && (
                  <div className={`act ${testResult[p.id].ok ? 'ok' : 'fail'}`} style={{ marginTop: 8 }}>
                    {testResult[p.id].ok
                      ? `✓ reachable in ${testResult[p.id].latencyMs}ms`
                      : `✗ ${testResult[p.id].error}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ---------- 3. Permissions ---------- */}
        <section className="band">
          <div className="sec-head">
            <div className="sec-label">Step 3</div>
            <h2 className="sec-title">Permissions — you stay in control</h2>
            <p className="sec-sub">
              The app only ever touches the workspace folder you choose. Toggle what the AI agent is allowed
              to do; the interactive terminal is always yours.
            </p>
          </div>

          {caps ? (
            <div className="cap-list">
              {caps.features.map((f) => (
                <div className="cap-row" key={f.id}>
                  <div style={{ flex: 1 }}>
                    <div className="cap-name">{f.name}</div>
                    <div className="cap-detail">{f.detail}</div>
                  </div>
                  {f.toggle ? (
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={Boolean(caps.permissions[f.toggle])}
                        onChange={(e) => toggle(f.toggle, e.target.checked)}
                      />
                      <span>{caps.permissions[f.toggle] ? 'allowed' : 'blocked'}</span>
                    </label>
                  ) : (
                    <span className="tag on">always on</span>
                  )}
                </div>
              ))}
              <div className="cap-row" style={{ justifyContent: 'flex-start', gap: 10 }}>
                <button className="btn btn-sm" onClick={async () => { const r = await api.openWorkspace(); if (!r?.ok) alert(r?.error || 'Unavailable'); }}>
                  ⌥ Open workspace folder
                </button>
                <button className="btn btn-sm" onClick={async () => { const r = await api.revealWorkspace(); if (!r?.ok) alert(r?.error || 'Unavailable'); }}>
                  ⌖ Reveal in file manager
                </button>
                <span className="dim" style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{caps.workspace}</span>
              </div>
            </div>
          ) : (
            <p className="dim">Loading capabilities…</p>
          )}
        </section>

        {/* ---------- 4. Build ---------- */}
        <div className="cta-band">
          <div className="wrap">
            <h2>Ready. Open the Studio and build something.</h2>
            <p>
              {isDesktop
                ? 'You are running the desktop app — the agent, editor and terminal are fully live.'
                : 'You are in a browser preview — the desktop app unlocks the live agent, workspace and terminal.'}
            </p>
            <div className="hero-cta">
              <button className="btn btn-solid btn-lg" onClick={onOpen}>Open Studio →</button>
              <button className="btn btn-lg" onClick={onHome}>← Back to home</button>
            </div>
          </div>
        </div>

        <footer className="foot wrap">
          <span>v{info?.version || '1.0.0'}</span><span>·</span>
          <span>{info?.platform || 'desktop'} {info?.arch || ''}</span><span>·</span>
          <button className="nav-link" onClick={onHome}>Landing</button>
          <button className="nav-link" onClick={onOpen}>Studio</button>
        </footer>
      </div>
    </div>
  );
}
