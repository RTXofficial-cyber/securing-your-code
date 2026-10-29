/**
 * Copies the GameKit engine + genre templates into public/play/ so the
 * built renderer ships a playable arcade (/play) with the exact same code
 * the plugin scaffolds into user workspaces. Run automatically by `npm run build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const kit = path.join(root, 'shared', 'gamekit');
const out = path.join(root, 'public', 'play');

fs.mkdirSync(path.join(out, 'games'), { recursive: true });
fs.copyFileSync(path.join(kit, 'engine.js'), path.join(out, 'engine.js'));

const templates = fs.readdirSync(path.join(kit, 'templates')).filter((f) => f.endsWith('.js'));
for (const t of templates) {
  fs.copyFileSync(path.join(kit, 'templates', t), path.join(out, 'games', t));
}

const names = templates.map((t) => t.replace(/\.js$/, ''));
const meta = {
  titles: {
    arena: 'VOID ARENA — twin-stick survival',
    platformer: 'MONO JUMP — precision platformer',
    shmup: 'STARFALL — vertical shooter',
    runner: 'LINE RUNNER — endless runner',
    composed: 'COMPOSED — the any-game runtime'
  },
  names
};
fs.writeFileSync(path.join(out, 'games.json'), JSON.stringify(meta, null, 2));
console.log(`[gamekit] synced engine + ${names.length} games -> public/play`);
