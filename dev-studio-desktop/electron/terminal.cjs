const { spawn } = require('child_process');
const os = require('os');

/**
 * A dependency-free terminal that works identically on Windows, macOS and Linux.
 *
 * Why not node-pty? It is a NATIVE module: it needs Visual Studio Build Tools on
 * Windows and must be recompiled for every Electron ABI. That is the single most
 * common reason desktop-app builds fail on user machines. This implementation
 * keeps the shell persistent (so `cd` and env vars survive) and detects command
 * completion + exit code + cwd with a sentinel echo, giving a real terminal
 * experience with zero native dependencies.
 */

const IS_WIN = process.platform === 'win32';
const SENTINEL = '@@STUDIO_DONE_';
const SENTINEL_RE = /@@STUDIO_DONE_(\d+)_(-?\d+)_(.*?)@@/;

class Terminal {
  constructor({ cwd, onOutput, onExit, onCommandDone }) {
    this.cwd = cwd;
    this.onOutput = onOutput || (() => {});
    this.onExit = onExit || (() => {});
    this.onCommandDone = onCommandDone || (() => {});
    this.buffer = '';
    this.counter = 0;
    this.pending = new Map();
    this.alive = false;
    this.child = null;
  }

  start() {
    if (this.alive) return { ok: true, alreadyRunning: true, cwd: this.cwd };

    const opts = {
      cwd: this.cwd,
      env: { ...process.env, TERM: 'xterm-256color', NO_COLOR: undefined },
      windowsHide: true
    };

    if (IS_WIN) {
      // /q disables command echoing so the pane shows only real output.
      this.child = spawn(process.env.ComSpec || 'cmd.exe', ['/q'], opts);
    } else {
      // Deliberately NOT interactive (-i): with piped stdin an interactive bash
      // echoes every command back and prints job-control warnings, polluting the
      // pane. The renderer provides its own line editing, so a plain shell
      // reading commands from the pipe is exactly what we want.
      this.child = spawn(process.env.SHELL || 'bash', ['--norc', '--noprofile'], {
        ...opts,
        env: { ...opts.env, PS1: '', PS2: '', PROMPT_COMMAND: '', HISTFILE: '/dev/null' }
      });
    }

    this.alive = true;

    this.child.stdout.on('data', (d) => this._consume(d.toString()));
    this.child.stderr.on('data', (d) => this._consume(d.toString()));

    this.child.on('error', (err) => {
      this.alive = false;
      this.onOutput(`\r\n\x1b[31m[shell error] ${err.message}\x1b[0m\r\n`);
      this.onExit(1);
    });

    this.child.on('close', (code) => {
      this.alive = false;
      for (const [, p] of this.pending) {
        p.resolve({ exitCode: -1, cwd: this.cwd, output: '', killed: true });
      }
      this.pending.clear();
      this.onExit(code ?? 0);
    });

    return { ok: true, cwd: this.cwd, platform: process.platform, shell: IS_WIN ? 'cmd.exe' : 'bash' };
  }

  /** Send one command. Resolves when its sentinel arrives. */
  run(command) {
    if (!this.alive) this.start();
    if (!this.child || !this.child.stdin.writable) {
      return Promise.resolve({ exitCode: -1, cwd: this.cwd, output: '', error: 'shell not writable' });
    }

    const id = ++this.counter;
    // The sentinel line is parsed/executed AFTER the user's command finishes, so
    // the exit status and working directory it reports are always current.
    const lines = IS_WIN
      ? `${command}\r\necho ${SENTINEL}${id}_%errorlevel%_%CD%@@\r\n`
      : `${command}\nprintf '${SENTINEL}${id}_%s_%s@@\\n' "$?" "$(pwd)"\n`;

    return new Promise((resolve) => {
      this.pending.set(id, {
        resolve,
        startedAt: Date.now(),
        timer: setTimeout(() => {
          if (this.pending.has(id)) {
            this.pending.delete(id);
            resolve({ exitCode: -1, cwd: this.cwd, output: '', timedOut: true });
          }
        }, 10 * 60 * 1000)
      });
      this.child.stdin.write(lines);
    });
  }

  _consume(chunk) {
    this.buffer += chunk;

    const m = this.buffer.match(SENTINEL_RE);
    if (m) {
      const id = Number(m[1]);
      const exitCode = Number(m[2]);
      const newCwd = (m[3] || '').trim();

      const before = this.buffer.slice(0, m.index);
      this.buffer = this.buffer.slice(m.index + m[0].length).replace(/^(\r?\n)+/, '');

      if (before) this.onOutput(normalize(before));
      if (newCwd) this.cwd = newCwd;

      const p = this.pending.get(id);
      if (p) {
        this.pending.delete(id);
        clearTimeout(p.timer);
        p.resolve({ exitCode, cwd: this.cwd, output: before });
        this.onCommandDone({ exitCode, cwd: this.cwd, id });
      }
      return;
    }

    // No sentinel yet: stream everything except the trailing partial line,
    // which may be an incomplete sentinel.
    const lastNl = Math.max(this.buffer.lastIndexOf('\n'), this.buffer.lastIndexOf('\r'));
    if (lastNl >= 0) {
      const emit = this.buffer.slice(0, lastNl + 1);
      this.buffer = this.buffer.slice(lastNl + 1);
      if (emit.trim()) this.onOutput(normalize(emit));
    }
  }

  dispose() {
    try {
      if (this.child && this.alive) this.child.kill(IS_WIN ? 'SIGKILL' : 'SIGHUP');
    } catch {}
    this.alive = false;
    this.pending.clear();
  }
}

function normalize(s) {
  // Present a consistent LF->CRLF stream for xterm.js
  return s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}

module.exports = { Terminal, osPlatform: os.platform() };
