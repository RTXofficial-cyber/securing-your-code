import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import FileTree from './FileTree.jsx';
import EditorPane from './Editor.jsx';
import TerminalPane from './Terminal.jsx';
import ChatPane from './Chat.jsx';
import Settings from './Settings.jsx';

export default function Studio({ info, theme, providers, isDesktop, onToggleTheme, onHome, onProvidersChanged }) {
  const [tree, setTree] = useState([]);
  const [workspace, setWorkspace] = useState(info?.workspace || '');
  const [openFile, setOpenFile] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await api.files();
      if (r?.ok) {
        setTree(r.tree || []);
        if (r.workspace) setWorkspace(r.workspace);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh, tick]);

  const openFileFromTree = async (p) => {
    const r = await api.readFile(p);
    if (r?.ok) setOpenFile({ path: p, content: r.content });
    else alert(r?.error || 'Could not open file');
  };

  const saveFile = async (p, content) => {
    const r = await api.writeFile(p, content);
    if (!r?.ok) throw new Error(r?.error || 'Save failed');
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
    if (r?.changed) {
      setWorkspace(r.workspace);
      setOpenFile(null);
      setTick((t) => t + 1);
    }
  };

  return (
    <div className="studio">
      {/* ---------- Black rail ---------- */}
      <aside className="rail">
        <div className="rail-top">
          <span className="brand-mark">D</span>
          <span className="brand">Dev Studio</span>
          <button className="rail-back" onClick={onHome} title="Back to home">←</button>
        </div>

        <div className="rail-scroll">
          <div className="rail-section">
            <div className="rail-label">
              <span>Workspace</span>
              <button onClick={newFile} title="New file">＋</button>
            </div>
            <FileTree tree={tree} openPath={openFile?.path} onOpen={openFileFromTree} onRefresh={() => setTick((t) => t + 1)} />
          </div>
        </div>

        <div className="rail-foot">
          <div className="rail-ws" title={workspace}>{workspace}</div>
          <button className="rail-btn" onClick={chooseWorkspace}>⇄ &nbsp;Change workspace</button>
          <button className="rail-btn" onClick={onToggleTheme}>{theme === 'light' ? '☾' : '☀'} &nbsp;{theme === 'light' ? 'Dark' : 'Light'} theme</button>
          <button className="rail-btn" onClick={() => setSettingsOpen(true)}>⚙ &nbsp;Settings &amp; API keys</button>
        </div>
      </aside>

      {/* ---------- Center: editor + terminal ---------- */}
      <main className="center">
        {!isDesktop && (
          <div className="banner">
            ⚠ Browser preview — the agent, workspace and terminal are live in the desktop app.
          </div>
        )}
        <EditorPane file={openFile} onSave={saveFile} onNew={newFile} />
        <TerminalPane cwd={workspace} onChanged={() => setTick((t) => t + 1)} />
      </main>

      {/* ---------- Chat ---------- */}
      <ChatPane providers={providers} onAgentActed={() => setTick((t) => t + 1)} />

      {settingsOpen && (
        <Settings
          info={info}
          providers={providers}
          workspace={workspace}
          onClose={() => setSettingsOpen(false)}
          onSaved={onProvidersChanged}
          onChooseWorkspace={chooseWorkspace}
        />
      )}
    </div>
  );
}
