import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';

function Rich({ text }) {
  const parts = useMemo(() => String(text || '').split(/(\*\*[^*]+\*\*|`[^`]+`)/g), [text]);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (/^`[^`]+`$/.test(p)) {
          return (
            <code key={i} style={{ fontFamily: 'var(--mono)', fontSize: '12px', background: 'var(--bg-sunken)', padding: '1px 5px', borderRadius: 4 }}>
              {p.slice(1, -1)}
            </code>
          );
        }
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </>
  );
}

function ActionList({ results, skipped, onOpenFile }) {
  if (!results?.length && !skipped?.length) return null;
  return (
    <div className="actions">
      {(results || []).map((r, i) => {
        const label =
          r.type === 'write_file' ? `✓ wrote ${r.path}${r.bytes ? ` (${r.bytes} B)` : ''}` :
          r.type === 'run_command' ? `${r.ok ? '✓' : '✗'} ran: ${r.command}` :
          r.type === 'read_file' ? `✓ read ${r.path}` :
          r.type === 'list_files' ? `✓ listed workspace (${r.files?.length ?? 0} entries)` :
          r.type === 'error' ? `✗ ${r.error}` : r.type;
        const out = r.stdout || r.stderr || (r.files ? r.files.join('\n') : '');
        const clickable = r.type === 'write_file' && r.ok && onOpenFile;
        return (
          <div key={i}>
            <div
              className={`act ${r.ok === false ? 'fail' : 'ok'} ${clickable ? 'clickable' : ''}`}
              onClick={clickable ? () => onOpenFile(r.path) : undefined}
              title={clickable ? 'Open in editor' : undefined}
            >
              {label}{clickable && <span className="act-open">open ↗</span>}
            </div>
            {r.type === 'run_command' && out && <div className="act-out">{out.trim()}</div>}
          </div>
        );
      })}
      {(skipped || []).length > 0 && (
        <div className="act fail">⛔ {skipped.length} action{skipped.length > 1 ? 's' : ''} blocked by your permissions</div>
      )}
    </div>
  );
}

/** The multi-AI pipeline trace: which model did which job, and what it said. */
function Pipeline({ steps }) {
  if (!steps?.length) return null;
  return (
    <div className="pipeline">
      <div className="pipeline-title">AI team run</div>
      {steps.map((s, i) => (
        <details className={`pstep ${s.ok ? '' : 'fail'}`} key={i}>
          <summary>
            <span className="pstep-icon">{s.icon}</span>
            <span className="pstep-label">{s.label}</span>
            <span className="pstep-model">{s.providerName}</span>
            <span className="pstep-meta">{s.ok ? `${s.latencyMs}ms` : 'failed'}</span>
          </summary>
          <div className="pstep-body">{s.ok ? s.output : s.error}</div>
        </details>
      ))}
    </div>
  );
}

const WELCOME = `Welcome to Dev Studio.

**Deep mode** (below) is the full agent: it researches the live web (cited answers, Perplexity-style); with a connected model it works step by step like an engineer — one tool per turn (web_search / read_file / write_file / run_command), reading real observations until it calls done; offline it runs the plan→execute→verify→fix loop instead. Either way it finishes with syntax checks on every file it wrote.\n\n**Auto mode** (below) is autonomous: it plans the goal, writes and runs the code, verifies it (exit codes), and on failure feeds the error back and fixes it — up to 3 loops, always inside your permission toggles.\n\n**Team mode** (below) runs several AIs in the background on one request: a Researcher gathers accurate facts, an Architect plans, a Coder writes the code, and a Reviewer checks it — each sees your real project files, and each hands its output to the next.

Solo mode uses one model. Click any “wrote …” line to open that file.`;

export default function ChatPane({ providers, onAgentActed, onFileCreated, onNeedConnect, onHide }) {
  const [provider, setProvider] = useState('builtin');
  const [model, setModel] = useState('');
  const [agentMode, setAgentMode] = useState(true);
  const [teamMode, setTeamMode] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [deepMode, setDeepMode] = useState(false);
  const [roles, setRoles] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [messages, setMessages] = useState([{ role: 'assistant', content: WELCOME, actionResults: [] }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef(null);
  const taRef = useRef(null);

  const current = providers.find((p) => p.id === provider);
  const models = current?.models?.length ? current.models : [{ id: model || 'default', name: model || 'default' }];

  useEffect(() => { api.roles().then((r) => r?.roles && setRoles(r.roles)).catch(() => {}); }, []);
  useEffect(() => {
    if (providers.length && !providers.some((p) => p.id === provider)) setProvider(providers[0].id);
  }, [providers]);
  useEffect(() => {
    if (current && !current.models.some((m) => m.id === model)) setModel(current.models[0].id);
  }, [current]);
  useEffect(() => { bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' }); }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    if (taRef.current) taRef.current.style.height = '62px';

    setMessages((h) => [...h, { role: 'user', content: text, actionResults: [] }]);
    setBusy(true);

    try {
      if (deepMode) {
        setMessages((h) => [...h, { role: 'assistant', content: 'DEEP — researching the live web, planning, executing, verifying and checking… (this can take a minute)', actionResults: [] }]);
        const res = await api.deepRun({ goal: text, provider, model });
        setMessages((h) => h.slice(0, -1).concat(res?.ok || res?.mode ? [{
          role: 'assistant',
          content: [
            res.mode === 'answer'
              ? `DEEP RESEARCH ✓ — ${res.research?.count || 0} live source(s) via ${res.research?.source || 'web'}\n\n${res.answer || ''}`
              : [
                `DEEP ${res.ok ? '✓ VERIFIED + CHECKED' : '✗ STOPPED'} — ${res.mission?.summary || res.goal}`,
                res.research?.count ? `\n[research] ${res.research.count} live source(s) via ${res.research.source}:\n${res.research.results.slice(0, 4).map((r, i) => `${i + 1}. [${r.title}](${r.url})`).join('\n')}` : '',
                ...(res.react
                  ? res.react.steps.map((st) => `\n[step ${st.step}] ${st.tool}${st.skipped ? ' · SKIPPED by permissions' : ''} ${st.args || ''}\n${(st.observation || '').slice(0, 700)}`).concat(res.react.answer ? [`\n[answer] ${res.react.answer}`] : [])
                  : (res.mission?.iterations || []).map((it) => `\n[iter ${it.iter}] ${it.phase} · ${it.actions} action(s)${it.skipped?.length ? ` · SKIPPED by permissions: ${it.skipped.join('; ')}` : ''}\n${(it.log || '').slice(0, 1200)}`)),
                res.checks?.length ? `\n[check] ${res.checks.map((c) => `${c.file} → ${c.cmd} → exit ${c.code}`).join('\n')}` : '',
                `\nfiles: ${res.mission?.files?.length ? res.mission.files.join(', ') : 'none'}`,
                res.error ? `error: ${res.error}` : ''
              ].filter(Boolean).join('\n')
          ].flat().filter(Boolean).join('\n'),
          actionResults: []
        }] : [{ role: 'error', content: res?.error || 'Deep run failed', actionResults: [] }]));
        if (res?.mission?.files?.length) { onAgentActed?.(); onFileCreated?.(res.mission.files[0]); }
      } else if (autoMode) {
        setMessages((h) => [...h, { role: 'assistant', content: 'AUTOPILOT — planning, executing and verifying… (this can take a minute)', actionResults: [] }]);
        const res = await api.autoRun({ goal: text, provider, model });
        setMessages((h) => h.slice(0, -1).concat(res?.ok || res?.iterations ? [{
          role: 'assistant',
          content: [
            `AUTOPILOT ${res.ok ? '✓ VERIFIED' : '✗ STOPPED'} — ${res.summary || res.goal}`,
            ...res.iterations.map((it) => `\n[iter ${it.iter}] ${it.phase} · ${it.actions} action(s)${it.skipped?.length ? ` · SKIPPED by permissions: ${it.skipped.join('; ')}` : ''}\n${(it.log || '').slice(0, 1500)}`),
            `\nfiles: ${res.files?.length ? res.files.join(', ') : 'none'}`,
            res.done ? `result: ${res.done}` : '',
            res.error ? `error: ${res.error}` : ''
          ].filter(Boolean).join('\n'),
          actionResults: []
        }] : [{ role: 'error', content: res?.error || 'Autopilot failed', actionResults: [] }]));
        if (res?.files?.length) { onAgentActed?.(); onFileCreated?.(res.files[0]); }
      } else if (teamMode) {
        const res = await api.ensemble({ userText: text, overrides });
        if (res?.ok) {
          setMessages((h) => [...h, {
            role: 'assistant', content: res.summary || 'Team run complete.',
            steps: res.steps || [], actionResults: res.actionResults || []
          }]);
          if (res.actionResults?.length) onAgentActed?.();
          const firstWrite = (res.actionResults || []).find((a) => a.type === 'write_file' && a.ok);
          if (firstWrite) onFileCreated?.(firstWrite.path);
        } else {
          setMessages((h) => [...h, { role: 'error', content: res?.error || 'Team run failed', actionResults: [] }]);
        }
      } else {
        const history = messages.concat([{ role: 'user', content: text }]);
        const res = await api.chat({
          provider, model, agentMode,
          messages: history.map((m) => ({ role: m.role, content: m.content }))
        });
        if (res?.ok) {
          setMessages((h) => [...h, {
            role: 'assistant', content: res.reply || '(done — see actions below)',
            actionResults: res.actionResults || [], skipped: res.skipped || []
          }]);
          if (res.actionResults?.length) onAgentActed?.();
          const firstWrite = (res.actionResults || []).find((a) => a.type === 'write_file' && a.ok);
          if (firstWrite) onFileCreated?.(firstWrite.path);
        } else {
          setMessages((h) => [...h, { role: 'error', content: res?.error || 'Request failed', actionResults: [] }]);
        }
      }
    } catch (e) {
      setMessages((h) => [...h, { role: 'error', content: `Unexpected error: ${e.message}`, actionResults: [] }]);
    } finally {
      setBusy(false);
    }
  };

  const autoGrow = (e) => {
    const el = e.target;
    el.style.height = '62px';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  };

  const needsKey = current && current.keyEnv && !current.ready;
  const options = providers.map((p) => p.id);

  return (
    <aside className="chatpane-inner">
      <div className="chat-head">
        <div className="chat-row">
          <span className="chat-title">AI</span>
          <div className="mode-switch">
            <button className={`mode-btn ${!teamMode && !autoMode && !deepMode ? 'on' : ''}`} onClick={() => { setTeamMode(false); setAutoMode(false); setDeepMode(false); }}>Solo</button>
            <button className={`mode-btn ${teamMode ? 'on' : ''}`} onClick={() => { setTeamMode(true); setAutoMode(false); setDeepMode(false); }}>Team</button>
            <button className={`mode-btn ${autoMode ? 'on' : ''}`} title="Autonomous: plan, execute, verify and fix — inside your permissions" onClick={() => { setAutoMode(true); setTeamMode(false); setDeepMode(false); }}>Auto</button>
            <button className={`mode-btn ${deepMode ? 'on' : ''}`} title="Deep: live web research + step-by-step agent (connected models) or plan→verify loop (offline) + final checks" onClick={() => { setDeepMode(true); setTeamMode(false); setAutoMode(false); }}>Deep</button>
          </div>
          <button className="icon-btn" onClick={onHide} title="Hide panel">✕</button>
        </div>

        {!teamMode ? (
          <>
            <div className="chat-row">
              <select className="sel" value={provider} onChange={(e) => setProvider(e.target.value)}>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {p.vendor} {p.ready ? '✓' : '(no key)'}</option>
                ))}
              </select>
              {needsKey ? (
                <button className="btn btn-sm btn-solid" onClick={onNeedConnect}>Connect</button>
              ) : (
                current && <span className="tag on" style={{ flexShrink: 0 }}>ready</span>
              )}
            </div>
            <select className="sel" value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <label className="switch">
              <input type="checkbox" checked={agentMode} onChange={(e) => setAgentMode(e.target.checked)} />
              <span><b>Agent Mode</b> — AI may write files &amp; run commands</span>
            </label>
          </>
        ) : (
          <div className="team-grid">
            {roles.map((r) => (
              <div className="team-role" key={r.id}>
                <span className="team-role-label">{r.icon} {r.label}</span>
                <select
                  className="sel sel-sm"
                  value={overrides[r.id] || ''}
                  onChange={(e) => setOverrides((o) => ({ ...o, [r.id]: e.target.value || undefined }))}
                >
                  <option value="">auto ({r.preferred})</option>
                  {options.map((id) => {
                    const p = providers.find((x) => x.id === id);
                    return <option key={id} value={id}>{p?.name}{p && !p.ready ? ' (no key)' : ''}</option>;
                  })}
                </select>
              </div>
            ))}
            <div className="team-note">Each step receives your project files and the previous steps’ output. Unconnected picks fall back automatically.</div>
          </div>
        )}
      </div>

      <div className="chat-msgs">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.steps && <Pipeline steps={m.steps} />}
            <Rich text={m.content} />
            {m.role === 'assistant' && <ActionList results={m.actionResults} skipped={m.skipped} onOpenFile={onFileCreated} />}
          </div>
        ))}
        {busy && <div className="typing"><i /><i /><i /> {teamMode ? 'AI team working…' : agentMode ? 'building…' : 'thinking…'}</div>}
        <div ref={bottomRef} />
      </div>

      <div className="chat-in">
        <textarea
          ref={taRef}
          value={input}
          placeholder={teamMode ? 'Ask the whole team… e.g. "build me a website"' : agentMode ? 'e.g. "build me a website" / "create an api"' : 'Message the model…'}
          onChange={(e) => { setInput(e.target.value); autoGrow(e); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="send" onClick={send} disabled={busy || !input.trim()} title="Send (Enter)">↑</button>
      </div>
    </aside>
  );
}
