import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { api } from '../lib/api.js';

function shortCwd(cwd) {
  if (!cwd) return '~';
  const parts = String(cwd).split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? '…' + parts.slice(-2).join('/') : cwd;
}

export default function TerminalPane({ cwd, platform, onChanged }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const sendRef = useRef(null);
  const lineRef = useRef('');
  const busyRef = useRef(false);
  const startedRef = useRef(false);
  const streamedRef = useRef(0);
  const cwdRef = useRef(cwd);
  const histRef = useRef([]);
  const histIdx = useRef(-1);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shellCwd, setShellCwd] = useState(cwd);
  const [lastExit, setLastExit] = useState(null);

  useEffect(() => { cwdRef.current = cwd; }, [cwd]);

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12.5,
      fontFamily: "ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace",
      theme: {
        background: '#000000', foreground: '#e8e6e1', cursor: '#e8e6e1',
        selectionBackground: '#3a3a3a',
        black: '#000000', brightBlack: '#6a6862', white: '#e8e6e1', brightWhite: '#ffffff',
        red: '#e0857c', green: '#6fbf8f', yellow: '#d9c07a',
        blue: '#7fa8d9', magenta: '#c39ad9', cyan: '#7fc9c0'
      }
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;

    const prompt = () => term.write(`\x1b[1;32m${shortCwd(cwdRef.current)}\x1b[0m \x1b[90m❯\x1b[0m `);

    term.writeln('\x1b[1mDev Studio Terminal\x1b[0m');
    term.writeln('\x1b[90mLive shell in your workspace. Type a command, press Enter. ↑/↓ = history.\x1b[0m');
    term.writeln('');

    api.terminalStart()
      .then((r) => {
        startedRef.current = true;
        setConnected(true);
        if (r?.cwd) { cwdRef.current = r.cwd; setShellCwd(r.cwd); }
        prompt();
        term.focus();
      })
      .catch(() => term.writeln('\x1b[31mTerminal unavailable in this context.\x1b[0m'));

    const off = api.onTerminal((msg) => {
      if (!msg) return;
      if (msg.type === 'output') { streamedRef.current += (msg.data || '').length; term.write(msg.data); }
      if (msg.type === 'done' && msg.cwd) { cwdRef.current = msg.cwd; setShellCwd(msg.cwd); }
      if (msg.type === 'exit') { term.writeln('\x1b[31m[shell exited]\x1b[0m'); setConnected(false); startedRef.current = false; }
    });

    const sendCommand = (raw) => {
      const cmd = String(raw).trim();
      term.writeln('');
      lineRef.current = '';
      if (!cmd) { prompt(); return; }
      if (cmd === ':clear') { term.clear(); prompt(); return; }

      histRef.current.push(cmd);
      histIdx.current = histRef.current.length;
      busyRef.current = true; setBusy(true); streamedRef.current = 0;

      api.terminalSend(cmd)
        .then((r) => {
          if (r?.cwd) { cwdRef.current = r.cwd; setShellCwd(r.cwd); }
          // FIX: backends that don't stream (browser preview) still return output
          // in the response — render it so nothing is silently lost.
          if (streamedRef.current === 0 && r?.output) term.write(String(r.output).replace(/\n/g, '\r\n'));
          if (r?.timedOut) term.writeln('\x1b[33m[command timed out]\x1b[0m');
          setLastExit(r?.exitCode ?? null);
          if (r?.exitCode !== undefined && r.exitCode !== 0) term.writeln(`\x1b[90m[exit ${r.exitCode}]\x1b[0m`);
          onChanged?.();
        })
        .catch((e) => term.writeln(`\x1b[31m${e.message}\x1b[0m`))
        .finally(() => { busyRef.current = false; setBusy(false); prompt(); });
    };
    sendRef.current = sendCommand;

    term.onData((data) => {
      if (!startedRef.current || busyRef.current) return;
      if (data === '\r') { sendCommand(lineRef.current); return; }
      if (data === '\x7f' || data === '\b') {
        if (lineRef.current.length) { lineRef.current = lineRef.current.slice(0, -1); term.write('\b \b'); }
        return;
      }
      if (data === '\x03') { term.write('^C'); term.writeln(''); lineRef.current = ''; prompt(); return; }
      if (data === '\x1b[A' || data === '\x1b[B') {
        if (!histRef.current.length) return;
        histIdx.current = data === '\x1b[A' ? Math.max(0, histIdx.current - 1) : Math.min(histRef.current.length, histIdx.current + 1);
        const h = histRef.current[histIdx.current] ?? '';
        term.write('\r\x1b[K'); prompt(); term.write(h); lineRef.current = h;
        return;
      }
      if (data >= ' ' || data === '\t') { const ch = data === '\t' ? '  ' : data; lineRef.current += ch; term.write(ch); }
    });

    const focusHandler = () => term.focus();
    hostRef.current.addEventListener('mousedown', focusHandler);
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      hostRef.current?.removeEventListener('mousedown', focusHandler);
      off?.();
      term.dispose();
    };
  }, []);

  const runQuick = (cmd) => {
    const term = termRef.current;
    if (!term || !sendRef.current) return;
    term.focus();
    if (cmd === ':clear') { term.clear(); return; }
    term.write(cmd);          // echo as if typed
    sendRef.current(cmd);     // then execute through the same path as Enter
  };

  const isWin = platform === 'win32';
  const QUICK = [
    { label: 'list', cmd: isWin ? 'dir' : 'ls -la' },
    { label: 'node -v', cmd: 'node --version' },
    { label: 'pwd', cmd: isWin ? 'cd' : 'pwd' },
    { label: 'clear', cmd: ':clear' }
  ];

  return (
    <div className="term-pane">
      <div className="pane-head term-head">
        <span className={`dot ${connected ? '' : 'off'}`} title={connected ? 'shell connected' : 'not connected'} />
        <span className="pane-title"><b>Terminal</b> — {shortCwd(shellCwd)}</span>
        <div className="quick-chips">
          {QUICK.map((q) => <button key={q.label} className="chip" onClick={() => runQuick(q.cmd)}>{q.label}</button>)}
        </div>
        <span className="term-hint">{busy ? 'running…' : !connected ? 'connecting…' : lastExit === null || lastExit === 0 ? 'ready' : `exit ${lastExit}`}</span>
        <button className="btn btn-sm term-btn" onClick={() => { termRef.current?.clear(); termRef.current?.focus(); }}>Clear</button>
      </div>
      <div className="term-body" ref={hostRef} />
    </div>
  );
}
