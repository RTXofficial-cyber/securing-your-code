import React, { useCallback, useEffect, useState } from 'react';
import { api, isDesktop } from './lib/api.js';
import Landing from './components/Landing.jsx';
import Setup from './components/Setup.jsx';
import Studio from './components/Studio.jsx';

/**
 * Three linked views: Landing (marketing) -> Setup (install/connect/permissions)
 * -> Studio (the working app). Every view links to the others.
 */
export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('ds-theme') || 'light');
  const [view, setView] = useState(() => localStorage.getItem('ds-view') || 'landing');
  const [providers, setProviders] = useState([]);
  const [info, setInfo] = useState(null);
  // Lets any view deep-link into Settings (e.g. "connect this provider").
  const [settingsTarget, setSettingsTarget] = useState(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ds-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('ds-view', view);
  }, [view]);

  const reloadProviders = useCallback(async () => {
    try {
      setProviders(await api.providers());
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    reloadProviders();
    api.appInfo().then(setInfo).catch(() => {});
  }, [reloadProviders]);

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  const go = (v) => { setView(v); window.scrollTo?.(0, 0); };

  const openSettingsFor = (providerId) => {
    setSettingsTarget(providerId || true);
    setView('studio');
  };

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
      onProvidersChanged={reloadProviders}
    />
  );
}
