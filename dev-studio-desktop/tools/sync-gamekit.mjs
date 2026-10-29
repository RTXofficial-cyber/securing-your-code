/**
 * Copies the GameKit engine + genre templates into public/play/ so the
 * built renderer ships a playable arcade (/play) with the exact same code
 * the plugin scaffolds into user workspaces. Run automatically by `npm run build`.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseSpec3d } = require('../shared/gamekit/spec3d.cjs');
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const kit = path.join(root, 'shared', 'gamekit');
const out = path.join(root, 'public', 'play');

fs.mkdirSync(path.join(out, 'games'), { recursive: true });
fs.copyFileSync(path.join(kit, 'engine.js'), path.join(out, 'engine.js'));
fs.copyFileSync(path.join(kit, 'engine3d.js'), path.join(out, 'engine3d.js'));

const templates = fs.readdirSync(path.join(kit, 'templates')).filter((f) => f.endsWith('.js'));
for (const t of templates) {
  fs.copyFileSync(path.join(kit, 'templates', t), path.join(out, 'games', t));
}

// pre-composed 3D demos: franchise DNA baked in, playable straight from the arcade
const composed3d = fs.readFileSync(path.join(kit, 'templates', 'composed3d.js'), 'utf8');
const demos3d = {
  horror3d: 'resident evil style survival horror game',
  swing3d: 'spider-man swinging through the city collecting tokens',
  charles3d: 'choo-choo charles style train horror game',
  ops3d: 'call of duty fps with enemy waves'
};
for (const [name, req] of Object.entries(demos3d)) {
  const spec = parseSpec3d(req);
  fs.writeFileSync(path.join(out, 'games', `${name}.js`), `const GAME_SPEC3D = ${JSON.stringify(spec)};\n` + composed3d);
}

const names = [...templates.map((t) => t.replace(/\.js$/, '')), ...Object.keys(demos3d)];
const meta = {
  titles: {
    arena: 'VOID ARENA — twin-stick survival',
    city: 'GRAND THEFT MONO — mini open-world crime city',
    city3d: 'MONO CITY 3D — first-person 3D city (real perspective renderer)',
    horror3d: 'ESCAPE THE DARK — 3D survival horror (zombies, mansion)',
    swing3d: 'WEB SWING CITY — 3D superhero collectathon',
    charles3d: 'THE HUNTER EXPRESS — 3D train horror in the rain',
    ops3d: 'MONO OPS 3D — 3D wave shooter (soldiers, arena)',
    platformer: 'MONO JUMP — precision platformer',
    shmup: 'STARFALL — vertical shooter',
    runner: 'LINE RUNNER — endless runner',
    composed: 'COMPOSED — the any-game runtime'
  },
  names
};
fs.writeFileSync(path.join(out, 'games.json'), JSON.stringify(meta, null, 2));
console.log(`[gamekit] synced engine + ${names.length} games -> public/play`);
