import React, { useCallback, useEffect, useState } from 'react';
import { api, isDesktop } from './lib/api.js';
import Landing from './components/Landing.jsx';
import Setup from './components/Setup.jsx';
import Studio from './components/Studio.jsx';
import LockScreen from './components/LockScreen.jsx';

/**
 * Views: Landing (marketing) -> Setup (install/connect/permissions) -> Studio.
 * All gated behind the optional PIN lock; auto-locks after idle if configured.
 */
export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('ds-theme') || 'light');
  const [view, setView] = useState(() => localStorage.getItem('ds-view') || 'landing');
  const [providers, setProviders] = useState([]);
  const [info, setInfo] = useState(null);
  const [locked, setLocked] = useState(null); // null = checking
  const [settingsTarget, setSettingsTarget] = useState(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ds-theme', theme);
  }, [theme]);

  useEffect(() => { localStorage.setItem('ds-view', view); }, [view]);

  const reloadProviders = useCallback(async () => {
    try { setProviders(await api.providers()); } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    api.lockState().then((r) => setLocked(Boolean(r?.set))).catch(() => setLocked(false));
    reloadProviders();
    api.appInfo().then(setInfo).catch(() => {});
  }, [reloadProviders]);

  // ---- auto-lock on idle ----
  useEffect(() => {
    if (locked !== false) return;
    let minutes = 0;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    api.lockState().then((r) => { minutes = r?.autoLockMinutes || 0; }).catch(() => {});
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'wheel'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const iv = setInterval(() => {
      if (minutes > 0 && Date.now() - last > minutes * 60000) {
        api.lockNote?.('lock');
        setLocked(true);
      }
    }, 5000);
    return () => {
      clearInterval(iv);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [locked]);

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  const go = (v) => { setView(v); window.scrollTo?.(0, 0); };
  const openSettingsFor = (providerId) => { setSettingsTarget(providerId || true); setView('studio'); };
  const doLock = () => { api.lockNote?.('lock'); setLocked(true); };

  if (locked === null) {
    return <div className="lockscreen"><div className="lock-card"><div className="brand" style={{ justifyContent: 'center' }}><span className="brand-mark">D</span> Dev Studio</div></div></div>;
  }

  if (locked) {
    return <LockScreen onUnlocked={() => setLocked(false)} />;
  }

  return view === 'landing' ? (
    <Landing
      providers={providers}
      info={info}
      theme={theme}
      isDesktop={isDesktop}
      onToggleTheme={toggleTheme}
      onOpen={() => go('studio')}
      onSetup={() => go('setup')}
    />
  ) : view === 'setup' ? (
    <Setup
      providers={providers}
      info={info}
      theme={theme}
      isDesktop={isDesktop}
      onToggleTheme={toggleTheme}
      onHome={() => go('landing')}
      onOpen={() => go('studio')}
      onConnect={(id) => openSettingsFor(id)}
      onProvidersChanged={reloadProviders}
    />
  ) : (
    <Studio
      info={info}
      theme={theme}
      providers={providers}
      isDesktop={isDesktop}
      settingsTarget={settingsTarget}
      onSettingsTargetHandled={() => setSettingsTarget(null)}
      onToggleTheme={toggleTheme}
      onHome={() => go('landing')}
      onSetup={() => go('setup')}
      onLock={doLock}
      onProvidersChanged={reloadProviders}
    />
  );
}
