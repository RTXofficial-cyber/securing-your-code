/**
 * Game spec composer — turns a free-form request into a game DNA.
 *
 * "make a zombie survival game with dash"  ->  topdown + chasers + dash
 * "flappy bird style runner"               ->  runner + flap + pipes
 * "space shooter with bombs"               ->  space + shooters + bomb
 *
 * The composed runtime (templates/composed.js) implements every combination,
 * so two different requests produce two genuinely different games: different
 * control scheme, enemy behaviour, weapons, win condition and tuning — not a
 * reskin of one file.
 */

const CONTROLS = {
  platform: { gravity: 1650, speed: 260, jump: -620 },
  runner: { gravity: 1650, speed: 0, jump: -620, scroll: 330 },
  flap: { gravity: 1250, speed: 0, jump: -380, scroll: 210 },
  topdown: { speed: 250 },
  space: { speed: 320 }
};

const ENEMY_KINDS = ['chaser', 'shooter', 'dropper', 'walker', 'pipes', 'none'];
const WEAPONS = ['bullet', 'none'];
const GOALS = ['survive', 'reach', 'collect', 'waves'];
const MODIFIERS = ['dash', 'double-jump', 'bomb', 'shield', 'magnet', 'rapid'];

const WORDS = {
  control: [
    [/platform|jump|mario|metroidvania|parkour/, 'platform'],
    [/flappy|flap|bird|pipe/, 'flap'],
    [/runner|endless|run|sprint|subway/, 'runner'],
    [/space|shmup|shooter|galaga|invaders|spaceship|star/, 'space'],
    [/zombie|survival|arena|top.?down|twin.?stick|horde|vampire/, 'topdown']
  ],
  enemies: [
    [/pipe|obstacle|barrier|wall/, 'pipes'],
    [/zombie|horde|chase|swarm|monster|virus/, 'chaser'],
    [/turret|gunner|shooter|cannon|boss/, 'shooter'],
    [/drop|falling|meteor|rain|bomb/, 'dropper'],
    [/patrol|guard|soldier|walker|slime/, 'walker']
  ],
  weapon: [
    [/shoot|gun|bullet|fire|laser|blast|twin.?stick/, 'bullet']
  ],
  goal: [
    [/reach|flag|exit|finish|escape|rescue/, 'reach'],
    [/collect|coin|gem|pickup|treasure|gather/, 'collect'],
    [/wave|horde|endless|survive|survival|score/, 'waves'],
    [/level|puzzle|complete|clear/, 'reach']
  ],
  modifiers: [
    [/dash/, 'dash'],
    [/double jump|double-jump|air jump/, 'double-jump'],
    [/bomb|nuke|blast/, 'bomb'],
    [/shield|armor|armour|protect/, 'shield'],
    [/magnet|attract/, 'magnet'],
    [/rapid|fast fire|speedy|turbo/, 'rapid']
  ]
};

function titleize(text, fallback) {
  const stop = new Set(['make', 'create', 'build', 'write', 'me', 'a', 'an', 'the', 'game', 'play', 'please', 'for', 'with', 'and', 'of', 'in', 'to', 'new', 'kind', 'type', 'bana', 'banao', 'karo', 'ek']);
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  const picked = [...new Set(words)].slice(0, 3);
  if (!picked.length) return fallback;
  return picked.join(' ').toUpperCase();
}

function parseSpec(text) {
  const t = String(text || '').toLowerCase();

  let control = null;
  for (const [re, v] of WORDS.control) if (re.test(t)) { control = v; break; }
  if (!control) control = /game|play/.test(t) ? 'topdown' : 'topdown';

  const enemies = [];
  for (const [re, v] of WORDS.enemies) if (re.test(t)) enemies.push(v);
  if (!enemies.length) {
    if (control === 'platform') enemies.push('walker');
    else if (control === 'runner' || control === 'flap') enemies.push('pipes');
    else if (control === 'space') enemies.push('shooter', 'dropper');
    else enemies.push('chaser');
  }
  if ((control === 'runner' || control === 'flap') && !enemies.includes('pipes')) enemies.push('pipes');

  let weapon = 'none';
  for (const [re, v] of WORDS.weapon) if (re.test(t)) { weapon = v; break; }
  if (weapon === 'none' && (control === 'space' || control === 'topdown') && !/no (gun|shoot|weapon)|unarmed|pacifist/.test(t)) weapon = 'bullet';

  let goal = null;
  for (const [re, v] of WORDS.goal) if (re.test(t)) { goal = v; break; }
  if (!goal) {
    if (control === 'platform') goal = 'reach';
    else if (control === 'runner' || control === 'flap') goal = 'waves';
    else if (control === 'space') goal = 'waves';
    else goal = 'waves';
  }
  if (goal === 'collect' && enemies.length === 0) enemies.push('none');

  const modifiers = [];
  for (const [re, v] of WORDS.modifiers) if (re.test(t)) modifiers.push(v);
  if (control === 'platform' && !modifiers.includes('double-jump')) modifiers.push('double-jump');
  if (control === 'topdown' && !modifiers.includes('dash')) modifiers.push('dash');
  if (control === 'space' && !modifiers.includes('bomb')) modifiers.push('bomb');

  // theme: mono by default, a few tasteful alternates
  let theme = 'mono';
  if (/neon|glow|cyber|synth/.test(t)) theme = 'neon';
  if (/paper|sketch|pencil|notebook/.test(t)) theme = 'paper';
  if (/crt|retro|arcade cabinet/.test(t)) theme = 'crt';

  const titles = { platform: 'SKYLINE DASH', runner: 'LINE RUNNER', flap: 'PAPER WINGS', topdown: 'VOID ARENA', space: 'STARFALL' };
  const spec = {
    control,
    enemies: enemies.filter((e) => ENEMY_KINDS.includes(e)).slice(0, 3),
    weapon: WEAPONS.includes(weapon) ? weapon : 'none',
    goal: GOALS.includes(goal) ? goal : 'waves',
    modifiers: modifiers.filter((m) => MODIFIERS.includes(m)).slice(0, 4),
    theme,
    title: titleize(t, titles[control] || 'DEV STUDIO GAME'),
    seedText: String(text || '').slice(0, 120)
  };
  return spec;
}

/** Human-readable mechanics summary, shown in chat so the user sees the DNA. */
function describeSpec(s) {
  const ctrl = {
    platform: 'run + jump (coyote time, double jump)',
    runner: 'auto-run, jump & slide',
    flap: 'tap to flap, dodge gaps',
    topdown: '8-way move + dash',
    space: 'free-fly ship'
  }[s.control];
  return [
    `control: ${ctrl}`,
    `enemies: ${s.enemies.join(', ') || 'none'}`,
    `weapon: ${s.weapon}`,
    `goal: ${s.goal}`,
    `extras: ${s.modifiers.join(', ') || 'none'}`,
    `look: ${s.theme}`
  ].join(' · ');
}

module.exports = { parseSpec, describeSpec, titleize, CONTROLS, ENEMY_KINDS, WEAPONS, GOALS, MODIFIERS };
