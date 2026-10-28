const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === 'win32';

const SYSTEM_PROMPT = `You are the built-in AI of Dev Studio, an autonomous coding agent running inside a desktop app.
You write code, create files, and run commands for the user inside their project workspace.

You act by emitting action blocks: a fenced code block whose language tag starts with "action:", followed by JSON.

Example:
\`\`\`action:write_file
{"path": "app.py", "content": "print('hello')"}
\`\`\`

\`\`\`action:run_command
{"command": "python app.py"}
\`\`\`

Available actions:
- write_file  {"path": "<relative path>", "content": "<full file content>"}
- run_command {"command": "<shell command>"}   (runs in the workspace, 60s timeout)
- read_file   {"path": "<relative path>"}
- list_files  {}

Rules:
1. Paths are ALWAYS relative to the workspace root. Never use ".." or absolute paths.
2. This is a ${IS_WIN ? 'Windows machine — use Windows commands (dir, type, py/python, npm).' : 'POSIX machine — use standard shell commands.'}
3. Work in small increments. After writing files, run them to verify they work.
4. Explain briefly in normal text OUTSIDE the action blocks what you did.
5. If the user only wants to chat, emit no action blocks at all.`;

function parseActions(replyText) {
  const actions = [];
  if (typeof replyText !== 'string') return actions;
  const re = /```action:(\w+)\s*\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(replyText)) !== null) {
    const type = m[1];
    try {
      const payload = JSON.parse(m[2]);
      actions.push({ type, ...payload });
    } catch (e) {
      actions.push({ type: 'error', error: `Invalid JSON in ${type} action: ${e.message}` });
    }
  }
  return actions;
}

/** Strip action blocks so the UI can show only human-readable prose. */
function stripActions(replyText) {
  return String(replyText || '').replace(/```action:\w+\s*\r?\n[\s\S]*?```/g, '').trim();
}

async function executeActions(actions, ws) {
  const results = [];

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'write_file': {
          if (!action.path) throw new Error('write_file needs a "path"');
          ws.write(action.path, action.content ?? '');
          results.push({ type: 'write_file', path: action.path, ok: true, bytes: Buffer.byteLength(action.content ?? '') });
          break;
        }
        case 'read_file': {
          const content = ws.read(action.path);
          results.push({ type: 'read_file', path: action.path, ok: true, content: content.slice(0, 20000) });
          break;
        }
        case 'list_files': {
          results.push({ type: 'list_files', ok: true, files: ws.listFlat() });
          break;
        }
        case 'run_command': {
          if (!action.command) throw new Error('run_command needs a "command"');
          const r = await runShell(action.command, ws.root(), 60000);
          results.push({ type: 'run_command', command: action.command, ok: r.code === 0, code: r.code, stdout: r.stdout, stderr: r.stderr });
          break;
        }
        case 'error':
          results.push({ type: 'error', ok: false, error: action.error });
          break;
        default: {
          // Plugin-registered agent tools: an action whose type matches a
          // registered tool name is dispatched to that tool.
          const tool = TOOLS.get(action.type);
          if (tool) {
            try {
              const out = await tool.run(action, { ws, runShell, workspace: ws.root() });
              results.push({ type: action.type, ok: out?.ok !== false, output: out?.output ?? out?.stdout ?? '', detail: out || null });
            } catch (err) {
              results.push({ type: action.type, ok: false, error: err.message });
            }
          } else {
            results.push({ type: action.type, ok: false, error: `Unknown action type: ${action.type}` });
          }
        }
      }
    } catch (err) {
      results.push({ type: action.type, ok: false, error: err.message });
    }
  }
  return results;
}

/** Cross-platform one-shot command execution. */
async function runShell(command, cwd, timeoutMs = 60000) {
  const args = IS_WIN ? ['/d', '/s', '/c', command] : ['-lc', command];
  const bin = IS_WIN ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || 'bash');

  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    });
    return { code: 0, stdout: tail(stdout), stderr: tail(stderr) };
  } catch (err) {
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: tail(err.stdout || ''),
      stderr: tail(err.stderr || err.message || ''),
      timedOut: err.killed === true
    };
  }
}

function tail(s) {
  s = String(s || '');
  return s.length > 20000 ? s.slice(-20000) : s;
}

/* ------------------------------------------------------------------ */
/* Plugin tool registry                                                */
/* ------------------------------------------------------------------ */

const TOOLS = new Map();

/**
 * Plugin API — register a new agent action.
 * def: { name, description, run(action, ctx) => { ok, output } }
 * ctx: { ws, runShell, workspace }
 */
function registerTool(def, pluginId) {
  if (!def || typeof def.name !== 'string' || typeof def.run !== 'function') {
    throw new Error('tool plugin must export { name, run(action, ctx) }');
  }
  TOOLS.set(def.name, { ...def, pluginId: pluginId || def.name });
  return def.name;
}

function unregisterToolsByPlugin(pluginId) {
  let n = 0;
  for (const [name, t] of [...TOOLS]) {
    if (t.pluginId === pluginId) { TOOLS.delete(name); n++; }
  }
  return n;
}

function listTools() {
  return [...TOOLS.values()].map((t) => ({ name: t.name, description: t.description || '', pluginId: t.pluginId }));
}

function hasTool(name) {
  return TOOLS.has(name);
}

/** System prompt + a live list of plugin-registered tools, so the AI knows they exist. */
function systemPrompt() {
  const tools = listTools();
  if (!tools.length) return SYSTEM_PROMPT;
  return (
    SYSTEM_PROMPT +
    '\n\nAdditional actions provided by installed plugins:\n' +
    tools.map((t) => `- ${t.name}  ${t.description}`).join('\n') +
    '\nEmit them exactly like the built-in actions, e.g. ```action:git_commit\n{"message":"add login"}\n```'
  );
}

module.exports = {
  SYSTEM_PROMPT, systemPrompt, parseActions, stripActions, executeActions, runShell, IS_WIN,
  registerTool, unregisterToolsByPlugin, listTools, hasTool
};
