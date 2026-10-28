import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { api } from '../lib/api.js';

function shortCwd(cwd) {
  if (!cwd) return '~';
  const parts = String(cwd).split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? '…' + parts.slice(-2).join('/') : cwd;
}

export default function TerminalPane({ cwd, onChanged }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const lineRef = useRef('');
  const busyRef = useRef(false);
  const cwdRef = useRef(cwd);
  const histRef = useRef([]);
  const histIdx = useRef(-1);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shellCwd, setShellCwd] = useState(cwd);

  useEffect(() => { cwdRef.current = cwd; }, [cwd]);

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: false,
      disableStdin: false,
      fontSize: 12.5,
      fontFamily: "ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace",
      theme: {
        background: '#000000',
        foreground: '#e8e6e1',
        cursor: '#e8e6e1',
        selectionBackground: '#3a3a3a',
        black: '#000000', brightBlack: '#6a6862',
        white: '#e8e6e1', brightWhite: '#ffffff',
        red: '#e0857c', green: '#6fbf8f', yellow: '#d9c07a',
        blue: '#7fa8d9', magenta: '#c39ad9', cyan: '#7fc9c0'
      }
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const prompt = () => {
      term.write(`\x1b[1m${shortCwd(cwdRef.current)}\x1b[0m \x1b[90m❯\x1b[0m `);
    };

    term.write('\x1b[1mDev Studio Terminal\x1b[0m\r\n');
    term.write('\x1b[90mPersistent shell in your workspace. Type a command and press Enter.\x1b[0m\r\n\r\n');

    let started = false;
    api.terminalStart()
      .then((r) => {
        started = true;
        setConnected(true);
        if (r?.cwd) { cwdRef.current = r.cwd; setShellCwd(r.cwd); }
        prompt();
        term.focus();
      })
      .catch(() => {
        term.write('\x1b[31mTerminal unavailable in this context.\x1b[0m\r\n');
      });

    const off = api.onTerminal((msg) => {
      if (!msg) return;
      if (msg.type === 'output') term.write(msg.data);
      if (msg.type === 'done') {
        if (msg.cwd) { cwdRef.current = msg.cwd; setShellCwd(msg.cwd); }
      }
      if (msg.type === 'exit') {
        term.write('\r\n\x1b[31m[shell exited]\x1b[0m\r\n');
        setConnected(false);
      }
    });

    term.onData((data) => {
      if (!started || busyRef.current) return;

      if (data === '\r') {
        const cmd = lineRef.current;
        term.write('\r\n');
        lineRef.current = '';
        if (!cmd.trim()) { prompt(); return; }
        histRef.current.push(cmd);
        histIdx.current = histRef.current.length;
        busyRef.current = true;
        setBusy(true);
        api.terminalSend(cmd)
          .then((r) => {
            if (r?.cwd) { cwdRef.current = r.cwd; setShellCwd(r.cwd); }
            if (r?.timedOut) term.write('\r\n\x1b[33m[command timed out after 10 minutes]\x1b[0m\r\n');
            if (r?.exitCode !== undefined && r.exitCode !== 0) {
              term.write(`\x1b[90m[exit ${r.exitCode}]\x1b[0m\r\n`);
            }
            onChanged?.();
          })
          .catch((e) => term.write(`\r\n\x1b[31m${e.message}\x1b[0m\r\n`))
          .finally(() => {
            busyRef.current = false;
            setBusy(false);
            prompt();
          });
        return;
      }

      if (data === '\x7f' || data === '\b') {
        if (lineRef.current.length) {
          lineRef.current = lineRef.current.slice(0, -1);
          term.write('\b \b');
        }
        return;
      }

      if (data === '\x03') {
        term.write('^C\r\n');
        lineRef.current = '';
        prompt();
        return;
      }

      if (data === '\x1b[A') { // up
        if (histRef.current.length === 0) return;
        histIdx.current = Math.max(0, histIdx.current - 1);
        const h = histRef.current[histIdx.current] ?? '';
        term.write('\r\x1b[K');
        prompt();
        term.write(h);
        lineRef.current = h;
        return;
      }
      if (data === '\x1b[B') { // down
        if (histRef.current.length === 0) return;
        histIdx.current = Math.min(histRef.current.length, histIdx.current + 1);
        const h = histRef.current[histIdx.current] ?? '';
        term.write('\r\x1b[K');
        prompt();
        term.write(h);
        lineRef.current = h;
        return;
      }

      if (data >= ' ' || data === '\t') {
        lineRef.current += data === '\t' ? '  ' : data;
        term.write(data === '\t' ? '  ' : data);
      }
    });

    const ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      off?.();
      term.dispose();
    };
  }, []);

  return (
    <div className="term-pane">
      <div className="pane-head term-head">
        <span className={`dot ${connected ? '' : 'off'}`} />
        <span className="pane-title">
          <b>Terminal</b> — {shortCwd(shellCwd)}
        </span>
        <span className="term-hint">{busy ? 'running…' : 'ready'}</span>
        <button
          className="btn btn-sm"
          style={{ borderColor: '#2a2a2a', color: '#9a9891' }}
          onClick={() => { termRef.current?.clear(); termRef.current?.focus(); }}
        >
          Clear
        </button>
      </div>
      <div className="term-body" ref={hostRef} />
    </div>
  );
}
