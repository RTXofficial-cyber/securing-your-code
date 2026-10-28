/**
 * Official plugin: Git tools.
 * Demonstrates a TOOLS plugin — it registers new agent actions the AI can
 * emit, e.g. ```action:git_commit {"message":"add login"} ```.
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

async function git(args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true
    });
    return { ok: true, output: (stdout || stderr || '').slice(-20000) };
  } catch (e) {
    const out = ((e.stdout || '') + (e.stderr || '')).slice(-20000);
    return { ok: false, output: out || e.message };
  }
}

module.exports = {
  tools: [
    {
      name: 'git_init',
      description: 'Initialise a git repository in the workspace.',
      run: (_a, ctx) => git(['init'], ctx.workspace)
    },
    {
      name: 'git_status',
      description: 'Show working-tree status.',
      run: (_a, ctx) => git(['status', '--short', '--branch'], ctx.workspace)
    },
    {
      name: 'git_commit',
      description: 'Stage everything and commit. Params: { "message": "..." }',
      run: async (a, ctx) => {
        await git(['add', '-A'], ctx.workspace);
        return git(['commit', '-m', a.message || 'Update from Dev Studio'], ctx.workspace);
      }
    },
    {
      name: 'git_log',
      description: 'Recent commit history. Params: { "limit": 10 }',
      run: (a, ctx) => git(['log', '--oneline', '-n', String(a.limit || 10)], ctx.workspace)
    }
  ]
};
