import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, isDesktop } from '../lib/api.js';
import FileTree from './FileTree.jsx';
import EditorPane from './Editor.jsx';
import TerminalPane from './Terminal.jsx';
import ChatPane from './Chat.jsx';
import Settings from './Settings.jsx';

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

export default function Studio({
  info, theme, providers, settingsTarget, onSettingsTargetHandled,
  onToggleTheme, onHome, onSetup, onProvidersChanged
}) {
  // ---- editors (tabs) ----
  const [openFiles, setOpenFiles] = useState([]);
  const [activePath, setActivePath] = useState(null);

  // ---- panel visibility (VS Code-like sliding) ----
  const [showExplorer, setShowExplorer] = useState(true);
  const [showChat, setShowChat] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);

  // ---- panel sizes ----
  const [railW, setRailW] = useState(236);
  const [chatW, setChatW] = useState(392);
  const [termH, setTermH] = useState(236);

  const [tree, setTree] = useState([]);
  const [workspace, setWorkspace] = useState(info?.workspace || '');
  const [settingsOpen, setSettingsOpen] = useState(Boolean(settingsTarget));
  const [tick, setTick] = useState(0);

  const centerRef = useRef(null);
  const drag = useRef(null); // 'rail' | 'chat' | 'term'

  useEffect(() => {
    if (settingsTarget) { setSettingsOpen(true); onSettingsTargetHandled?.(); }
  }, [settingsTarget]);

  const refresh = useCallback(async () => {
    try {
      const r = await api.files();
      if (r?.ok) { setTree(r.tree || []); if (r.workspace) setWorkspace(r.workspace); }
    } catch (e) { console.error(e); }
  }, []);
  useEffect(() => { refresh(); }, [refresh, tick]);

  // ---- unified drag handling for all three splitters ----
  useEffect(() => {
    const move = (e) => {
      if (!drag.current) return;
      if (drag.current === 'rail') setRailW(clamp(e.clientX - 44, 170, 420));
      if (drag.current === 'chat') setChatW(clamp(window.innerWidth - e.clientX, 300, 640));
      if (drag.current === 'term' && centerRef.current) {
        const rect = centerRef.current.getBoundingClientRect();
        setTermH(clamp(rect.bottom - e.clientY, 100, rect.height - 150));
      }
    };
    const up = () => { drag.current = null; document.body.style.cursor = ''; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  const startDrag = (which) => (e) => { drag.current = which; document.body.style.cursor = which === 'term' ? 'row-resize' : 'col-resize'; e.preventDefault(); };

  // ---- editor tab management ----
  const openFileFromTree = async (p) => {
    const r = await api.readFile(p);
    if (!r?.ok) { alert(r?.error || 'Could not open file'); return; }
    setOpenFiles((fs) => {
      const i = fs.findIndex((f) => f.path === p);
      if (i >= 0) { const c = [...fs]; c[i] = { path: p, content: r.content }; return c; }
      return [...fs, { path: p, content: r.content }];
    });
    setActivePath(p);
  };

  const closeFile = (p) => {
    setOpenFiles((fs) => {
      const next = fs.filter((f) => f.path !== p);
      if (activePath === p) setActivePath(next.length ? next[next.length - 1].path : null);
      return next;
    });
  };

  const saveFile = async (p, content) => {
    const r = await api.writeFile(p, content);
    if (!r?.ok) throw new Error(r?.error || 'Save failed');
    setOpenFiles((fs) => fs.map((f) => (f.path === p ? { ...f, content } : f)));
    setTick((t) => t + 1);
  };

  const newFile = async () => {
    const name = prompt('New file name (relative to workspace):', 'app.js');
    if (!name) return;
    const r = await api.writeFile(name.trim(), '');
    if (r?.ok) { setTick((t) => t + 1); openFileFromTree(name.trim()); }
    else alert(r?.error || 'Could not create file');
  };

  const chooseWorkspace = async () => {
    const r = await api.chooseWorkspace();
    if (r?.changed) { setWorkspace(r.workspace); setOpenFiles([]); setActivePath(null); setTick((t) => t + 1); }
  };

  const readyCount = providers.filter((p) => p.ready).length;

  return (
    <div className="studio">
      {/* ---------- Activity bar ---------- */}
      <div className="activitybar">
        <button className={`abtn ${showExplorer ? 'on' : ''}`} title="Toggle Explorer" onClick={() => setShowExplorer((v) => !v)}>▤</button>
        <button className={`abtn ${showChat ? 'on' : ''}`} title="Toggle AI panel" onClick={() => setShowChat((v) => !v)}>◈</button>
        <button className={`abtn ${showTerminal ? 'on' : ''}`} title="Toggle Terminal" onClick={() => setShowTerminal((v) => !v)}>❯_</button>
        <div className="ab-spacer" />
        <button className="abtn" title="Setup & permissions" onClick={onSetup}>⚙</button>
        <button className="abtn" title="Settings & API keys" onClick={() => setSettingsOpen(true)}>⚿</button>
        <button className="abtn" title={theme === 'light' ? 'Dark theme' : 'Light theme'} onClick={onToggleTheme}>{theme === 'light' ? '☾' : '☀'}</button>
        <button className="abtn" title="Back to home" onClick={onHome}>⌂</button>
      </div>

      {/* ---------- Explorer rail (slides) ---------- */}
      {showExplorer && (
        <>
          <aside className="rail" style={{ width: railW }}>
            <div className="rail-top">
              <span className="rail-heading">Explorer</span>
              <button className="rail-back" onClick={newFile} title="New file">＋</button>
              <button className="rail-back" onClick={() => setShowExplorer(false)} title="Hide">✕</button>
            </div>
            <div className="rail-scroll">
              <div className="rail-section">
                <div className="rail-label"><span>Workspace</span></div>
                <FileTree tree={tree} openPath={activePath} onOpen={openFileFromTree} />
              </div>
            </div>
            <div className="rail-foot">
              <div className="rail-ws" title={workspace}>{workspace}</div>
              <button className="rail-btn" onClick={chooseWorkspace}>⇄ &nbsp;Change workspace</button>
            </div>
          </aside>
          <div className="vsplit" onMouseDown={startDrag('rail')} title="Drag to resize" />
        </>
      )}

      {/* ---------- Center: tabs + editor + terminal ---------- */}
      <main className="center" ref={centerRef}>
        {!isDesktop && <div className="banner">⚠ Browser preview — the live agent, AI team, workspace and terminal run in the desktop app.</div>}
        <EditorPane
          openFiles={openFiles}
          activePath={activePath}
          onSelect={setActivePath}
          onClose={closeFile}
          onSave={saveFile}
          onNew={newFile}
        />
        {showTerminal && (
          <>
            <div className="splitter" onMouseDown={startDrag('term')} title="Drag to resize"><span /></div>
            <div style={{ height: termH, flex: 'none', display: 'flex', flexDirection: 'column' }}>
              <TerminalPane cwd={workspace} platform={info?.platform} onChanged={() => setTick((t) => t + 1)} onHide={() => setShowTerminal(false)} />
            </div>
          </>
        )}
      </main>

      {/* ---------- AI panel (slides) ---------- */}
      {showChat && (
        <>
          <div className="vsplit" onMouseDown={startDrag('chat')} title="Drag to resize" />
          <div className="chatpane" style={{ width: chatW }}>
            <ChatPane
              providers={providers}
              onAgentActed={() => setTick((t) => t + 1)}
              onFileCreated={openFileFromTree}
              onNeedConnect={() => setSettingsOpen(true)}
              onHide={() => setShowChat(false)}
            />
          </div>
        </>
      )}

      {/* ---------- Status bar ---------- */}
      <div className="statusbar">
        <button className="sb-item" onClick={chooseWorkspace} title="Change workspace">⌥ {workspace ? workspace.split(/[\\/]/).filter(Boolean).slice(-1)[0] : 'workspace'}</button>
        <span className="sb-item">{openFiles.length} editor{openFiles.length === 1 ? '' : 's'} open</span>
        <span className="sb-item">{readyCount} model{readyCount === 1 ? '' : 's'} connected</span>
        <div className="sb-spacer" />
        <span className="sb-item">{info?.packaged ? 'packaged build' : isDesktop ? 'desktop dev' : 'browser preview'}</span>
        <button className="sb-item" onClick={onSetup}>setup &amp; .exe</button>
        <button className="sb-item" onClick={onToggleTheme}>{theme === 'light' ? '☾ dark' : '☀ light'}</button>
        <span className="sb-item">v{info?.version || '1.0.0'}</span>
      </div>

      {settingsOpen && (
        <Settings
          info={info}
          providers={providers}
          workspace={workspace}
          focusProvider={typeof settingsTarget === 'string' ? settingsTarget : null}
          onClose={() => setSettingsOpen(false)}
          onSaved={onProvidersChanged}
          onChooseWorkspace={chooseWorkspace}
        />
      )}
    </div>
  );
}
