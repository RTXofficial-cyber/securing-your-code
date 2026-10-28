import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/** Minimal, safe markdown-ish renderer (bold, inline code, line breaks). */
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

function ActionList({ results }) {
  if (!results?.length) return null;
  return (
    <div className="actions">
      {results.map((r, i) => {
        const label =
          r.type === 'write_file' ? `✓ wrote ${r.path}${r.bytes ? ` (${r.bytes} B)` : ''}` :
          r.type === 'run_command' ? `${r.ok ? '✓' : '✗'} ran: ${r.command}` :
          r.type === 'read_file' ? `✓ read ${r.path}` :
          r.type === 'list_files' ? `✓ listed workspace (${r.files?.length ?? 0} entries)` :
          r.type === 'error' ? `✗ ${r.error}` : r.type;
        const out = r.stdout || r.stderr || r.content || (r.files ? r.files.join('\n') : '');
        return (
          <div key={i}>
            <div className={`act ${r.ok === false ? 'fail' : 'ok'}`}>{label}</div>
            {r.type === 'run_command' && out && <div className="act-out">{out.trim()}</div>}
            {r.type === 'error' && r.error && null}
          </div>
        );
      })}
    </div>
  );
}

const WELCOME = `Welcome to Dev Studio.

Describe the software you want and I'll build it in your workspace — writing files, running them, and showing you the output.

Turn **Agent Mode** off if you just want to talk. Open **Settings** in the rail to connect Claude, ChatGPT, Perplexity, Gemini or Groq.`;

export default function ChatPane({ providers, onAgentActed }) {
  const [provider, setProvider] = useState('builtin');
  const [model, setModel] = useState('studio-agent-1');
  const [agentMode, setAgentMode] = useState(true);
  const [messages, setMessages] = useState([{ role: 'assistant', content: WELCOME, actionResults: [] }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef(null);
  const taRef = useRef(null);

  const current = providers.find((p) => p.id === provider);
  const models = current?.models?.length ? current.models : [{ id: model, name: model }];

  useEffect(() => {
    if (providers.length && !providers.some((p) => p.id === provider)) setProvider(providers[0].id);
  }, [providers]);

  useEffect(() => {
    if (current && !current.models.some((m) => m.id === model)) setModel(current.models[0].id);
  }, [current]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    if (taRef.current) taRef.current.style.height = '62px';

    const history = [...messages, { role: 'user', content: text, actionResults: [] }];
    setMessages(history);
    setBusy(true);

    try {
      const res = await api.chat({
        provider,
        model,
        agentMode,
        messages: history.map((m) => ({ role: m.role, content: m.content }))
      });
      if (res?.ok) {
        setMessages((h) => [
          ...h,
          { role: 'assistant', content: res.reply || '(done — see actions below)', actionResults: res.actionResults || [] }
        ]);
        if (res.actionResults?.length) onAgentActed?.();
      } else {
        setMessages((h) => [...h, { role: 'error', content: res?.error || 'Request failed', actionResults: [] }]);
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

  return (
    <aside className="chatpane">
      <div className="chat-head">
        <div className="chat-row">
          <select className="sel" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.vendor} {p.ready ? '✓' : '(no key)'}
              </option>
            ))}
          </select>
          {current && (
            <span className={`tag ${current.ready ? 'on' : 'off'}`} style={{ flexShrink: 0 }}>
              {current.ready ? 'ready' : 'no key'}
            </span>
          )}
        </div>
        <select className="sel" value={model} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <label className="switch">
          <input type="checkbox" checked={agentMode} onChange={(e) => setAgentMode(e.target.checked)} />
          <span><b>Agent Mode</b> — lets the AI write files and run commands in your workspace</span>
        </label>
      </div>

      <div className="chat-msgs">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <Rich text={m.content} />
            {m.role === 'assistant' && <ActionList results={m.actionResults} />}
          </div>
        ))}
        {busy && (
          <div className="typing"><i /><i /><i /> {agentMode ? 'building…' : 'thinking…'}</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-in">
        <textarea
          ref={taRef}
          value={input}
          placeholder={agentMode ? 'Describe what to build…' : 'Message the model…'}
          onChange={(e) => { setInput(e.target.value); autoGrow(e); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
        />
        <button className="send" onClick={send} disabled={busy || !input.trim()} title="Send (Enter)">↑</button>
      </div>
    </aside>
  );
}
