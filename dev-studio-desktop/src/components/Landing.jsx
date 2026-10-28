import React from 'react';

const FEATURES = [
  {
    n: '01',
    icon: '◈',
    title: 'An agent that actually builds',
    body: 'Your AI writes files, runs commands, reads the output and fixes its own mistakes — inside your real project folder, not a throwaway sandbox.'
  },
  {
    n: '02',
    icon: '❯_',
    title: 'A true terminal',
    body: 'A persistent shell on Windows, macOS and Linux. cd, npm, git, python — everything you type behaves exactly like your own terminal.'
  },
  {
    n: '03',
    icon: '⌘',
    title: 'A real code editor',
    body: 'Monaco, the engine inside VS Code, bundled into the app. Syntax highlighting, search, multi-cursor — and it works with no internet at all.'
  },
  {
    n: '04',
    icon: '◐',
    title: 'Every frontier model',
    body: 'Claude, ChatGPT, Perplexity, Gemini and Groq behind one interface. Switch models mid-conversation and compare how each one builds.'
  },
  {
    n: '05',
    icon: '⚿',
    title: 'Your keys stay yours',
    body: 'API keys live in the desktop app on your machine and are never routed through anyone else\'s server. Your code never leaves your disk.'
  },
  {
    n: '06',
    icon: '✦',
    title: 'Plug in your own AI',
    body: 'One function, one file. Point Dev Studio at your own model or endpoint and the agent, editor and terminal all keep working unchanged.'
  }
];

const STEPS = [
  { n: '1', h: 'Install the .exe', p: 'Run the Windows installer, or the portable build if you prefer no install at all. Nothing else to set up.' },
  { n: '2', h: 'Connect a model', p: 'Paste an API key in Settings, or start immediately with the built-in engine — no key required.' },
  { n: '3', h: 'Describe the software', p: 'Tell the agent what to build. It writes the files, runs them, and shows you the output. You steer.' }
];

export default function Landing({ providers, info, theme, isDesktop, onToggleTheme, onOpen }) {
  const connected = providers.filter((p) => p.ready).length;
  const provList = providers.length
    ? providers
    : [
        { id: 'builtin', name: 'Dev Studio AI', vendor: 'Built-in', description: 'Works with no API key.', ready: true },
        { id: 'anthropic', name: 'Claude', vendor: 'Anthropic', description: 'Sonnet, Opus and Haiku.', ready: false },
        { id: 'openai', name: 'ChatGPT', vendor: 'OpenAI', description: 'GPT-4o and o-series.', ready: false },
        { id: 'perplexity', name: 'Perplexity', vendor: 'Perplexity', description: 'Search-augmented Sonar.', ready: false },
        { id: 'gemini', name: 'Gemini', vendor: 'Google', description: 'Flash and Pro.', ready: false },
        { id: 'groq', name: 'Groq', vendor: 'Groq', description: 'Very fast Llama.', ready: false }
      ];

  return (
    <div className="landing">
      {/* ---------- Nav ---------- */}
      <nav className="nav">
        <div className="brand">
          <span className="brand-mark">D</span>
          Dev Studio
        </div>
        <div className="nav-links">
          <button className="nav-link" onClick={() => scroll('models')}>Models</button>
          <button className="nav-link" onClick={() => scroll('features')}>Features</button>
          <button className="nav-link" onClick={() => scroll('start')}>Get started</button>
        </div>
        <div className="nav-spacer" />
        <button className="icon-btn" onClick={onToggleTheme} title="Toggle theme">
          {theme === 'light' ? '☾' : '☀'}
        </button>
        <button className="btn btn-solid" onClick={onOpen}>Open Studio →</button>
      </nav>

      {/* ---------- Hero ---------- */}
      <div className="wrap">
        <header className="hero">
          <div className="eyebrow">
            <span className="pulse" />
            AI development studio
          </div>
          <h1 className="display">
            Build massive software, <em>with AI at the keyboard.</em>
          </h1>
          <p className="hero-sub">
            A native desktop app where Claude, ChatGPT, Perplexity, Gemini and Groq write real code into
            your project — and a live editor and terminal let you run it the moment it lands.
          </p>
          <div className="hero-cta">
            <button className="btn btn-solid btn-lg" onClick={onOpen}>Open the Studio</button>
            <button className="btn btn-lg" onClick={() => scroll('start')}>How it works</button>
          </div>
          <div className="hero-note">
            {isDesktop
              ? `Running the Windows desktop build · v${info?.version || '1.0.0'} · ${connected} model${connected === 1 ? '' : 's'} connected`
              : 'Browser preview — run Dev Studio.exe for the live agent, workspace and terminal'}
          </div>
        </header>

        {/* ---------- Product preview ---------- */}
        <div className="preview-shell">
          <div className="preview-bar">
            <span className="preview-dot" />
            <span className="preview-dot" />
            <span className="preview-dot" />
            <span className="preview-title">Dev Studio — my-project</span>
          </div>
          <div className="preview-body">
            <div className="preview-side">
              <div className="ps-item">▾ src</div>
              <div className="ps-item" style={{ paddingLeft: 16 }}>server.js</div>
              <div className="ps-item on" style={{ paddingLeft: 16 }}>app.py</div>
              <div className="ps-item">▸ tests</div>
              <div className="ps-item">package.json</div>
            </div>
            <div className="preview-main">
              <div className="preview-code">
                <div><span className="k">from</span> http.server <span className="k">import</span> HTTPServer</div>
                <div>&nbsp;</div>
                <div><span className="k">def</span> handler(req):</div>
                <div>&nbsp;&nbsp;<span className="k">return</span> <span className="s">"Hello from Dev Studio"</span></div>
                <div>&nbsp;</div>
                <div>HTTPServer((<span className="s">"127.0.0.1"</span>, 8080), handler).serve_forever()</div>
                <div style={{ marginTop: 14, color: 'var(--faint)' }}>─ terminal ─────────────────────</div>
                <div>&gt; python app.py</div>
                <div style={{ color: 'var(--ok)' }}>Serving on http://localhost:8080</div>
              </div>
            </div>
            <div className="preview-chat">
              <div className="pv-msg u">build me a web app</div>
              <div className="pv-msg a">
                Scaffolding a dependency-free server and verifying the runtime.
                <div style={{ marginTop: 7, fontFamily: 'var(--mono)', fontSize: 10.5, opacity: .7 }}>
                  ✓ wrote app.py<br />✓ ran python app.py
                </div>
              </div>
              <div className="pv-msg u">add a /health route</div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Models ---------- */}
      <section className="band alt" id="models">
        <div className="wrap">
          <div className="sec-head">
            <div className="sec-label">Models</div>
            <h2 className="sec-title">One interface. Every model you actually use.</h2>
            <p className="sec-sub">
              Connect as many as you like and switch between them mid-conversation. Keys are stored on your
              machine and sent only to the provider you chose.
            </p>
          </div>
          <div className="providers">
            {provList.map((p) => (
              <div className="prov" key={p.id}>
                <div className="prov-top">
                  <span className="prov-name">{p.name}</span>
                  <span className={`tag ${p.ready ? 'on' : 'off'}`}>{p.ready ? 'connected' : 'add key'}</span>
                </div>
                <div className="prov-vendor">{p.vendor}</div>
                <div className="prov-desc">{p.description}</div>
              </div>
            ))}
            <div className="prov">
              <div className="prov-top">
                <span className="prov-name">Your own</span>
                <span className="tag">1 file</span>
              </div>
              <div className="prov-vendor">Custom</div>
              <div className="prov-desc">Replace one function in shared/builtin.cjs to run your own model.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Features ---------- */}
      <section className="band" id="features">
        <div className="wrap">
          <div className="sec-head">
            <div className="sec-label">What's inside</div>
            <h2 className="sec-title">Not a chatbot with a code block. A workshop.</h2>
            <p className="sec-sub">
              The agent, the editor and the terminal all point at the same folder on your disk — so what the
              AI writes is what you run, edit and ship.
            </p>
          </div>
          <div className="features">
            {FEATURES.map((f) => (
              <div className="feat" key={f.n}>
                <div className="feat-num">{f.n}</div>
                <span className="feat-icon">{f.icon}</span>
                <h3 className="feat-title">{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Steps ---------- */}
      <section className="band alt" id="start">
        <div className="wrap">
          <div className="sec-head">
            <div className="sec-label">Get started</div>
            <h2 className="sec-title">Three steps to your first build.</h2>
          </div>
          <div className="steps">
            {STEPS.map((s) => (
              <div className="step" key={s.n}>
                <div className="step-n">{s.n}</div>
                <h4>{s.h}</h4>
                <p>{s.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Specs ---------- */}
      <div className="wrap">
        <div className="specs">
          <div className="spec"><div className="spec-k">.exe</div><div className="spec-v">Native Windows build</div></div>
          <div className="spec"><div className="spec-k">0</div><div className="spec-v">Native dependencies</div></div>
          <div className="spec"><div className="spec-k">6</div><div className="spec-v">AI providers</div></div>
          <div className="spec"><div className="spec-k">100%</div><div className="spec-v">Local workspace</div></div>
          <div className="spec"><div className="spec-k">∅</div><div className="spec-v">No account needed</div></div>
        </div>
      </div>

      {/* ---------- CTA ---------- */}
      <div className="cta-band">
        <div className="wrap">
          <h2>Stop copying code out of a chat window.</h2>
          <p>Open the Studio and let the agent build something in your workspace right now.</p>
          <div className="hero-cta">
            <button className="btn btn-solid btn-lg" onClick={onOpen}>Open Studio →</button>
          </div>
        </div>
      </div>

      <footer className="foot wrap">
        <span className="brand" style={{ fontSize: 13 }}>
          <span className="brand-mark" style={{ width: 18, height: 18, fontSize: 11 }}>D</span>
          Dev Studio
        </span>
        <span>v{info?.version || '1.0.0'}</span>
        <span>·</span>
        <span>{info?.platform === 'win32' ? 'Windows' : info?.platform || 'desktop'} {info?.arch || ''}</span>
        <span>·</span>
        <span>Built with Electron</span>
      </footer>
    </div>
  );
}

function scroll(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
