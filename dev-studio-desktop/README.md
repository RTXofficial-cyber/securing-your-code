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

**Fastest:** double-click **`build-windows.bat`**. It checks Node, installs,
runs the tests, builds and packs the `.exe` files into `release/`, then opens
that folder for you. Prefer to do it by hand?

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
| `game-studio` | tools | `game_new` / `game_check` / `game_list` — composes complete games |
| `workspace-inspector` | tools | `project_analyze` / `find_code` / `project_stats` — offline project audit & search |
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
electron/       main process: window, IPC, terminal, sandboxing, bridge.cjs
shared/         providers, agent, orchestrator, plugins.cjs, lock.cjs, memory.cjs
src/            React renderer: landing, setup, studio, lock screen, memory panel
plugins/        official plugins: ollama, openrouter, git-tools,
                game-studio, workspace-inspector
resources/      app icon
test/           logic tests (run.cjs) + component tests (ui/*.test.jsx)
e2e/            Playwright specs that drive real Chrome
ci/             GitHub Actions: tests, Chrome E2E, Windows .exe, mac/linux
```

## Security — only you get in

**App lock (PIN).** Settings → Security lets you set a PIN. From then on the
app opens on a lock screen and nothing else is reachable until the PIN is
entered.

- The PIN is hashed with **scrypt + a random salt** and compared with
  `timingSafeEqual`; the plaintext PIN is never written to disk.
- State lives in `<userData>/lock.json` with **0600** permissions.
- **Auto-lock** on idle (off / 5 / 15 / 30 / 60 min), plus a lock button in the
  status bar and an activity-bar shortcut.
- Failed attempts are recorded and the lock screen tells you so.
- **Brute-force throttle**: 5 wrong PINs → 30 s cooldown (the lock screen counts
  it down and even the correct PIN is refused until it expires), audited as
  `pin.lockout`. The counter resets after a successful unlock.

**Audit log.** Every sensitive event is appended to `<userData>/lock.json.audit.log`
and viewable in Settings → Security: `pin.set` / `pin.change` / `pin.denied`,
`lock` / `unlock`, `key.set` / `key.remove`, `workspace.change`,
`plugin.enable` / `plugin.disable`, `agent.run`, `ensemble.run`,
`bridge.start` / `bridge.open` / `bridge.stop`. You can clear it in one click.

**Electron hardening** (`electron/main.cjs`):

| Control | Setting |
| --- | --- |
| Renderer sandbox | `sandbox: true`, `nodeIntegration: false`, `contextIsolation: true` |
| Webviews | `webviewTag: false` + `will-attach-webview` prevented |
| Mixed content | `allowRunningInsecureContent: false` |
| Permissions | `setPermissionRequestHandler` **denies every request** (camera, mic, geolocation, notifications…) |
| Network | `webRequest.onBeforeRequest` **cancels any non-loopback http(s) request** made by the UI |
| IPC | explicit allow-list only; the preload exposes promise methods, nothing else |

**Plugin trust split.** Plugins inside the app bundle (`plugins/`, shipped by
us) are official and enabled by default. Plugins you drop into
`<userData>/plugins` are **off until you enable them** — a stray folder can
never activate itself. A plugin can also opt in explicitly with
`"enabledByDefault": true` in its `plugin.json`.

**Agent permissions.** Settings → Permissions gates `writeFiles` and
`runCommands`; when off, the AI can only read. Actions it was not allowed to
run are reported back to you in the chat (`skipped[]`), never silently dropped.

The terminal runs real commands — that is the point of the app. Treat the
workspace folder like any folder you hand to a developer.

## Open in Chrome — one PC, one set of files, two surfaces

VS Code-style: the desktop app owns the workspace, and you can open **that same
workspace** in Chrome with the ◎ button in the activity bar ("Open in Chrome")
or the status bar.

```
Dev Studio (.exe)  ── owns ──▶  C:\your\workspace   ◀── same files ──  Chrome tab
       │                                                                     ▲
       └── loopback bridge: http://127.0.0.1:<random port>/?ds_token=…  ─────┘
```

- The bridge binds **127.0.0.1 only** — it is not reachable from your network.
- Every request needs a **256-bit random token** (checked with
  `timingSafeEqual`), handed to the tab in the URL when you click the button.
- Only **whitelisted RPC methods** are callable, and they are literally the same
  functions the desktop renderer uses — so Chrome gets the real workspace, real
  providers, real plugins, real PIN lock and a **live shared terminal**
  (WebSocket), not a mock.
- Desktop-only actions (folder picker, reveal in Explorer) are clearly reported
  as such in the browser instead of pretending to work.
- **Two access modes** (Settings → Security → "Browser access"):
  - **full access** — Chrome can edit files, run commands and talk to the AI.
  - **read-only** — the tab can *look* (files, tree, live terminal output,
    providers, plugins) but every mutating call is refused with a clear
    `403 read-only Chrome session` message: writes, deletes, shell commands,
    AI runs, key changes, plugin toggles, permission changes, PIN changes.
    Switch modes live; the tab shows a banner saying which one it is in.
- **Guest links** (Settings → Security): mint a short-lived URL for another
  Chrome tab on this PC — pick a label, a lifetime (15 min / 1 h / 8 h / 24 h)
  and whether it is **read-only** (the default) or full access. The list shows
  expiry and last-used time; **revoke** kills a link instantly, and expired
  links are rejected with 401. Tokens are never shown again after creation
  except in the one URL you copy, and only the desktop app can mint or revoke
  them (a browser tab cannot create more guests).
- Close it any time: Settings → Security → `stop`, or quit the app. Nothing is
  left listening when the app exits, and every start/open/mode-change is audited.

## The built-in AI is an agent, not a chatbot

Studio Agent (offline, no key) now behaves like a personal engineer:

- **Reads your real files** — `explain server.js` / `show app.py` answer from the
  actual content: dependencies, defined functions, exports, TODO markers.
- **Debugs with you** — paste any trace (`Cannot find module 'x'`, EADDRINUSE,
  ENOENT, `is not a function`, CORS, Python import errors, git conflicts…) and
  it returns a diagnosis, the failing snippet from your file when it can find
  the line, concrete fix steps, and a *safe* action (e.g. `npm install x`).
  `fix it` replays the stored fix.
- **Understands follow-ups** — `run it` executes the last scaffolded file,
  `rename a.js to b.js` works, and `delete x.js` demands an explicit
  `yes delete x.js` confirmation before any action exists.
- Everything mutating still travels as action blocks through the permission
  gates and the audit log; reads use the sandboxed workspace helper.

## Autopilot — autonomous plan → execute → verify → fix

Flip the chat to **Auto** and give it a goal: *"add a login page with
validation"*, *"build me a website"*, *"refactor the parser into its own
file"*. Dev Studio then works like an engineer, in loops:

1. **PLAN** — the selected model returns a JSON plan (steps, file writes,
   shell commands, verify commands). The offline built-in engine plans with
   its normal action blocks, so Auto works with no key too.
2. **EXECUTE** — actions run through the *same* permission gates as chat
   (`writeFiles`, `runCommands`); anything refused is listed as SKIPPED in the
   transcript, never silent.
3. **VERIFY** — every verify command must exit 0; output is kept in the
   transcript.
4. **FIX** — on failure the exact error is fed back and a fix plan runs, up to
   3 iterations (4 max). Every mission is audited (`auto.run`).

The chat shows each iteration: phase, action count, skips, verify exit codes
and logs — so you can always see *why* it did what it did.

## Project memory — the AI remembers your codebase

Big projects break chat-style AI: every new run starts from zero. Dev Studio
keeps persistent, editable context per workspace in
`<workspace>/.dev-studio/memory.json` (open it with **✎** in the activity bar
or the memory chip in the status bar):

- **Project** — name, one-paragraph summary, stack, and conventions the models
  must always follow.
- **Decisions & notes** — what is already settled, so the team builds on it
  instead of re-litigating it.
- **Task list** — `todo / doing / done`; only open tasks are injected, so
  "continue where we left off" actually works.
- **Run history** — the last 40 agent/team runs (prompt, provider, actions).

All of it is injected into the **system prompt of the solo agent** and into
**every role of the AI team** (Researcher, Architect, Coder and the Reviewer —
which re-reads it after the code was written). The panel shows exactly
*"What the AI actually receives"*, capped at 2,500 characters so it never eats
your context window.

It is plain JSON inside your project: commit it and your teammates — and every
model you connect — inherit the same understanding of the codebase.

## Game Studio — say "make a game", get a finished game

The built-in AI ships with **GameKit** (`shared/gamekit/engine.js`): a
zero-dependency browser engine with a fixed-timestep loop, keyboard / mouse /
touch / **gamepad** input, AABB physics, particles, screen shake, hit-stop,
squash & stretch, WebAudio synth SFX, parallax starfield, pause, and
localStorage high-scores. On top of it sit four complete genre templates:

| Genre | Template | Feel |
|---|---|---|
| `arena` | VOID ARENA | twin-stick survival, dashes, heal orbs, waves |
| `platformer` | MONO JUMP | coyote time, jump buffering, squash & stretch, coins, flag |
| `shmup` | STARFALL | patterns, power-ups, bombs, bosses-lite big foes |
| `runner` | LINE RUNNER | double jump, slide, ramps speed forever, gems |

Ask the AI *"make a game"* / *"make a platformer"* / *"make a space shooter"* —
the official **game-studio plugin** (`action:game_new`) copies the engine +
template into `game/`, then `action:game_check` syntax-verifies it. Press the
**▶ play** button in the activity bar and the game opens in your browser.

### Any game, not four games
Free-form requests go through the **spec composer** (`shared/gamekit/spec.cjs`):
your sentence becomes game DNA — control scheme (`platform / runner / flap /
topdown / space`), enemy behaviours (`chaser / shooter / dropper / walker /
pipes`), weapon, goal (`survive / reach / collect / waves`), modifiers
(`dash / double-jump / bomb / shield / magnet / rapid`) and theme
(`mono / neon / paper / crt`). The **composed runtime**
(`templates/composed.js`) implements every combination, so *"zombie survival
with dash"* and *"flappy pipe runner"* are different games, not reskins. The
generated `game/game.js` starts with its `GAME_SPEC` so you can read and edit
the DNA yourself. Bare requests (`make a platformer`) still use the four
hand-tuned templates.

### Games are proven to run
`test/harness/headless.cjs` loads the engine + every game into a VM with a
stubbed canvas/DOM/audio and pumps 600 frames of simulated input. Any runtime
error fails the build — "the game doesn't run" cannot ship. It already caught
a real crash in a template, which is now fixed.

The same four games ship inside the app as an arcade: open
`<app>/play/` (or `/play/` on the preview server) and play them with no
install — proof the engine is real, not a promise.

## Testing

```bash
npm run test:logic   # 57 pure-Node tests: agent, providers, plugins, lock, memory, bridge
npm run test:ui      # 10 React component tests (vitest + jsdom + Testing Library)
npm test             # both of the above
npm run test:e2e     # real Chrome (Playwright) against the production build
```

For `test:e2e` the first time: `npx playwright install chromium`, then
`npm run build && npm run test:e2e`. It serves `dist/` with `vite preview` and
drives Chromium through landing → setup → studio, the explorer/tabs/terminal,
the 4-step AI team pipeline and every Settings panel.

CI (`ci/build-desktop.yml`) runs four jobs on every push: **test** (logic +
unit), **e2e-chrome** (real Chromium + production build, traces uploaded on
failure), **windows** (builds the `.exe` installers) and a **mac-linux** matrix.
