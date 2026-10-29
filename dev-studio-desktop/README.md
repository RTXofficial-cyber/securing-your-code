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
- **Multi-file refactor** — `refactor util.js` or `split util.js into
  helpers.js` reads the real file, moves only *independent* ("leaf")
  functions into a new CommonJS module, rewrites the original to
  `require` it, and emits `node --check` verification for both files.
  String/comment-aware brace matching keeps bodies intact; functions that
  call siblings or use top-level state stay put, and an existing target
  file is never overwritten (pick another name instead).

## Can it compete with GPT-6 Astra? (honest answer)

Astra is a frontier *model* (100,000+ GPU training run). Dev Studio is not a
model — it is the *harness*: the workspace, terminal, permission gates, audit
log, live web research, plan → execute → verify → check loop. The winning move
is not competing with Astra but **driving** it:

- Connectors already list **GPT-6 Astra** (ChatGPT connector via
  `OPENAI_API_KEY`, or OpenRouter via `OPENROUTER_API_KEY`).
- Deep/Auto/Team modes feed your goal + live research + your real project
  memory into whichever model you pick, gate every write/command behind your
  permissions, verify with exit codes and finish with syntax checks.
- Offline, the built-in brain keeps the same loop running — smaller brain,
  same discipline, zero cost, zero data leaves your PC.

Where Dev Studio wins outright: ownership (your files never leave your
machine unless you allow it), the audit trail, and working with no key at all.

## Troubleshooting connectors

- **429 "no credits remaining" / `credit_balance_exhausted`** — your key is
  fine, the *account* has no API balance. A ChatGPT Plus subscription does
  **not** include API credits; add them at
  https://platform.openai.com/settings/organization/billing. Free routes
  meanwhile: Groq connector (free tier), Ollama (local, free), or the
  built-in Studio Agent (no key at all).
- **401 invalid key** — re-paste it in Settings → Connectors; keys are
  platform-specific.
- **404 model not found** — new frontier models (e.g. GPT-6 Astra) roll out
  to enterprise accounts first; pick another model from the dropdown.

The app translates all of these raw HTTP/JSON failures into plain guidance
with the exact next step (`friendlyProviderError`).

## GRAND THEFT MONO — "make a game like GTA" actually works now

Ask the built-in AI for `make me a game like gta` (or open world / crime /
mafia / heist / police chase / driving game) and it scaffolds a complete
mini open-world crime game — zero dependencies, one file, headless-proven:

- **Open city** 2400×1800 with road grid, dashed lanes, buildings with
  window lights, camera follow and collision push-out
- **Vehicles**: 16 parked cars you can steal (X/E), arcade driving physics
  (acceleration, speed-sensitive steering, handbrake, crash response)
- **Pedestrians** that wander, flee from wanted players… and can be run
  over — which is a crime
- **5-star WANTED system**: crimes raise stars, police cruisers spawn
  off-camera and chase you; in cars they ram you (both take damage,
  destroyed cruisers cost another star), on foot they pull up, stop and
  **BUST** you; escape their radius for 7 s and stars cool off
- **Courier missions**: reach the P marker, deliver to D against a
  distance-scaled timer, escalating cash rewards
- **Minimap** with buildings, markers, flashing cop dots, and the player

Honest scale note shipped with it: GTA VI is ~2000 people × a decade. This
is the same *systems* — open world, vehicles, wanted level, police AI,
missions, minimap — distilled into ~350 lines that provably run (the test
suite plays it headlessly for 600 frames, then white-boxes the hit-and-run,
cop spawns and the arrest). A KB topic ("how are GTA-style games built")
explains the seven pillars for question-shaped asks.

## Mission experience — the agent learns from its own history

Every Deep/Auto mission is recorded in
`<workspace>/.dev-studio/experience.json`: goal, engine, outcome, files,
failures and a one-line lesson. Before the next mission, the most relevant
entries (token-overlap ranked, top 3) are injected into the planner prompt /
ReAct system prompt:

```
Lessons from previous missions in THIS workspace (use them, do not repeat
old mistakes):
- "build me a website about tea" [mission, FAILED]: script.js had a stray
  comma; run node --check before done
```

So the agent starts with scar tissue instead of amnesia — the same trick a
senior engineer has over a junior one. The file travels with the project,
caps at 40 entries (newest first), survives reloads, and `clear()` (or
clearing just failures/successes) is safe at any time. Chat transcripts show
`[prior] N purane mission(s) ke lessons inject hue`, and `deep.run`/`auto.run`
audit entries record how many lessons rode along.

## ReAct agent — connected models work step by step, not one-shot

When a real model (OpenAI/GPT-6 Astra, Claude, Gemini, Groq, OpenRouter,
Ollama…) is selected, Deep mode's build path runs a **ReAct loop**: the model
calls ONE tool per turn and reads the real observation before deciding the
next move — exactly how a careful engineer works:

```
web_search → read_file → write_file → run_command (node --check) → done
```

- Fence-tolerant tool protocol (```tool JSON, bare JSON, or JSON inside prose)
- Permission gates apply per tool: a SKIPPED write/command is *reported back
  to the model* so it adapts instead of hallucinating success
- Observations are real (web results, file contents, exit codes, stdout),
  truncated and capped; rambling replies get one nudge, then become the answer
- The loop caps at 14 steps; `done` ends it with a final answer + file list
- Afterwards the CHECK phase still re-verifies every written file locally
- Offline (built-in provider) Deep mode keeps the plan→execute→verify→fix
  Autopilot loop — smaller brain, same discipline

Every step is rendered in the chat transcript: `[step N] tool · args ·
observation`, so nothing the agent did is hidden. `deep.run` audit entries
now record engine + step count.

## Deep mode — the full agent: research → build → check

A fourth chat pill, **Deep**, runs the whole loop in one message:

1. **RESEARCH (Perplexity-style)** — goals that need the live web ("what is
   the latest …?", "search X", anything ending in `?` that isn't a build
   request) go through real web search: DuckDuckGo HTML first, Wikipedia
   opensearch + intro extract as fallback. No API key, no account, no cost.
   Pure questions come back as **cited answers** (numbered `[title](url)`
   sources), and nothing is written to disk.
2. **BUILD (Claude-style)** — build-shaped goals go through the Autopilot
   mission loop. When research fits the goal ("research the latest css
   framework and build me a website"), the live snippets are injected into
   the planner prompt, so a connected frontier model plans with real,
   current facts.
3. **CHECK** — after the mission verifies, every written `.js`/`.cjs`/`.py`
   file gets a final syntax check (`node --check` / `py_compile`); a mission
   is only reported ✓ when checks pass too.

Offline is honest: if the web is unreachable, Deep says so and falls back to
the built-in brain's knowledge — it never pretends to have searched.
`web:search` is read-only (guest bridge links may use it); `deep:run` is
audited and gated by the same writeFiles/runCommands permissions as
everything else.

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
