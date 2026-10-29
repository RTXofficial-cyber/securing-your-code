/**
 * Official plugin: Game Studio.
 *
 * Gives the AI three actions:
 *   action:game_new    {"genre":"arena|platformer|shmup|runner","dir":"game"}
 *   action:game_check  {"dir":"game"}
 *   action:game_list   {}
 *
 * game_new copies the GameKit engine + a full genre template into the
 * workspace, so "make a game" produces a playable, juicy, finished game —
 * not a stub. Everything is zero-dependency and runs from a double-click.
 */
const fs = require('fs');
const path = require('path');

const KIT = path.join(__dirname, '..', '..', 'shared', 'gamekit');

const GENRES = {
  arena: ['arena', 'twin-stick', 'survival', 'top-down', 'topdown'],
  platformer: ['platformer', 'platform', 'jump', 'mario', 'metroidvania'],
  shmup: ['shmup', 'shooter', 'space', 'star', 'invaders', 'bullet'],
  runner: ['runner', 'run', 'endless', 'dash', 'flappy']
};

function genreOf(text) {
  const t = String(text || '').toLowerCase();
  for (const [genre, words] of Object.entries(GENRES)) {
    if (words.some((w) => t.includes(w))) return genre;
  }
  return 'arena';
}

const PAGE = (title) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      html, body { margin:0; height:100%; background:#0b0b0b; display:flex; align-items:center; justify-content:center; overflow:hidden; }
      canvas { max-width:100%; max-height:100%; box-shadow:0 0 0 1px #2a2a2a; border-radius:10px; }
    </style>
  </head>
  <body>
    <canvas id="game" width="960" height="540"></canvas>
    <script src="./engine.js"></script>
    <script src="./game.js"></script>
  </body>
</html>
`;

module.exports = {
  tools: [
    {
      name: 'game_new',
      description: 'Scaffold a complete game into the workspace. Params: { "genre": "arena|platformer|shmup|runner", "dir": "game" }',
      run: (a, ctx) => {
        try {
          const genre = GENRES[String(a?.genre || '').toLowerCase()] ? String(a.genre).toLowerCase() : genreOf(a?.genre);
          const dir = String(a?.dir || 'game').replace(/[^a-z0-9_/-]/gi, '') || 'game';
          const engine = fs.readFileSync(path.join(KIT, 'engine.js'), 'utf8');
          const game = fs.readFileSync(path.join(KIT, 'templates', `${genre}.js`), 'utf8');
          ctx.ws.write(`${dir}/engine.js`, engine);
          ctx.ws.write(`${dir}/game.js`, game);
          ctx.ws.write(`${dir}/index.html`, PAGE(`DEV STUDIO — ${genre.toUpperCase()}`));
          return {
            ok: true,
            genre,
            dir,
            files: [`${dir}/index.html`, `${dir}/engine.js`, `${dir}/game.js`],
            play: `Open ${dir}/index.html in a browser, or press the ▶ button in Dev Studio.`
          };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }
    },
    {
      name: 'game_check',
      description: 'Syntax-verify a scaffolded game. Params: { "dir": "game" }',
      run: async (a, ctx) => {
        const dir = String(a?.dir || 'game').replace(/[^a-z0-9_/-]/gi, '') || 'game';
        const r = await ctx.runShell(`node --check ${dir}/game.js && node --check ${dir}/engine.js && echo GAME_SYNTAX_OK`, ctx.workspace, 30000);
        return r;
      }
    },
    {
      name: 'game_list',
      description: 'List games in the workspace and their genres.',
      run: (_a, ctx) => {
        try {
          const tree = ctx.ws.tree();
          const dirs = tree.filter((n) => n.type === 'dir');
          const found = [];
          for (const d of dirs) {
            const kids = (d.children || []).map((c) => c.name);
            if (kids.includes('game.js') && kids.includes('engine.js')) {
              const src = ctx.ws.read(`${d.path}/game.js`).slice(0, 200);
              const title = /GameKit\(\{ title: '([^']+)'/.exec(src);
              found.push({ dir: d.path, title: title ? title[1] : d.path });
            }
          }
          return { ok: true, games: found };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }
    }
  ]
};

module.exports.genreOf = genreOf;
