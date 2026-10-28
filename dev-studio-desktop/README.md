# Dev Studio — Windows desktop app

A native desktop AI development studio: chat with Claude, ChatGPT, Perplexity,
Gemini and Groq behind one interface, and let the built-in agent write real
files and run real commands in your project workspace — with a Monaco editor
and a persistent terminal beside it.

Built with Electron + React + Vite. **Zero native dependencies**, so the
Windows build does not need Visual Studio Build Tools and cannot fail on
`node-gyp` / `node-pty` recompiles.

## Get the .exe

### Option A — GitHub Actions builds it for you (no local toolchain)

Push this branch and open **Actions → "Build Windows Desktop App"**. The
workflow runs on a real Windows runner and uploads two artifacts:

- `Dev-Studio-<version>-Windows-x64.exe` — NSIS installer
- `Dev-Studio-<version>-Portable.exe` — single portable exe, no install

Download from the run's **Artifacts** section and run it.

### Option B — build it on your own Windows PC

Requirements: Node.js 18+ (LTS recommended). Nothing else.

```bash
cd dev-studio-desktop
npm ci          # or: npm install
npm run dist:win
```

Installers land in `dev-studio-desktop/release/`:

- `Dev Studio-1.0.0-Windows-x64.exe` (installer)
- `Dev Studio-1.0.0-Portable.exe` (portable)

Double-click either one. Windows SmartScreen may warn about an unsigned app
the first time — choose *More info → Run anyway*.

### Development

```bash
npm start        # build the frontend, then launch Electron with hot paths
npm run dev      # Vite dev server only (browser preview of the UI)
npm test:logic   # agent / sandbox / terminal / provider tests (no Electron needed)
```

## Connect AI providers

Open **Settings** in the app rail and paste a key, or drop a `dev-studio.env`
file next to the app (or in your user-data folder):

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
PERPLEXITY_API_KEY=pplx-...
GEMINI_API_KEY=...
GROQ_API_KEY=gsk_...
```

Keys are stored only on your machine and are sent only to the provider you
select in the chat panel. With no keys at all, the built-in **Studio Agent v1**
still works offline: it writes files, runs commands and shows the output.

## Plugins (official extension API)

Dev Studio ships with a real plugin system. A plugin is a folder containing:

```
my-plugin/
  plugin.json    { "id", "name", "version", "entry", "description"?, "type"?, "enabledByDefault"? }
  index.cjs      module exporting `provider` and/or `tools`
```

- **provider plugin** — adds a new AI connector:
  `{ id, name, vendor?, keyEnv?, docs?, models:[{id,name}], chat(model, messages) }`
- **tools plugin** — adds new agent actions the AI can emit:
  `[{ name, description?, run(action, ctx) }]` with `ctx = { ws, runShell, workspace }`

Plugin folders are loaded from `<app>/plugins` (official, shipped in the .exe)
and `<userData>/plugins` (yours). Manage them in **Settings → Plugins**:
enable/disable (persisted), test, rescan, and open your install folder.
A plugin that throws on load is marked `error` and isolated — it can never
crash the app.

Shipped official plugins:

| Plugin | Kind | What it adds |
|---|---|---|
| `ollama` | provider | local models via Ollama (no key, no internet) |
| `openrouter` | provider | one key → hundreds of hosted models |
| `git-tools` | tools | `git_init`, `git_status`, `git_commit`, `git_log` agent actions |

## Use your own AI

Edit `shared/builtin.cjs` and replace the `chat(model, messages)` function with
a call to your own model or endpoint. Keep the signature
`(model, messages) => Promise<string>`; the agent actions, editor and terminal
all keep working unchanged.

## Where your code lives

The agent and the terminal operate on a single **workspace folder**
(default: `Documents/Dev Studio Workspace`). Change it any time via
**Settings → Workspace**. The agent can never read or write outside it —
path traversal is blocked at the IPC layer.

## Layout

```
electron/       main process: window, IPC, terminal, workspace sandboxing
shared/         provider connectors + agent engine (pure Node, unit-tested)
src/            React renderer: landing page + studio UI
resources/      app icon
test/           logic tests that run without Electron
.github/..      CI workflow that produces the Windows .exe
```

## Security notes

- `contextIsolation: on`, `nodeIntegration: off`, renderer talks to the main
  process only through an explicit allow-list of IPC channels.
- A Content-Security-Policy blocks remote scripts; Monaco and xterm are
  bundled locally, so the app works with no internet.
- The terminal runs real commands — that is the point of the app. Treat the
  workspace folder like any folder you hand to a developer.
