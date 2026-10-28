import React, { useCallback, useEffect, useState } from 'react';
import { api, isDesktop } from './lib/api.js';
import Landing from './components/Landing.jsx';
import Studio from './components/Studio.jsx';

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('ds-theme') || 'light');
  const [view, setView] = useState('landing');
  const [providers, setProviders] = useState([]);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ds-theme', theme);
  }, [theme]);

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

  return view === 'landing' ? (
    <Landing
      providers={providers}
      info={info}
      theme={theme}
      isDesktop={isDesktop}
      onToggleTheme={toggleTheme}
      onOpen={() => setView('studio')}
    />
  ) : (
    <Studio
      info={info}
      theme={theme}
      providers={providers}
      isDesktop={isDesktop}
      onToggleTheme={toggleTheme}
      onHome={() => setView('landing')}
      onProvidersChanged={reloadProviders}
    />
  );
}
