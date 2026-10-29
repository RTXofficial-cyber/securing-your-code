/**
 * Game spec composer 3D — turns franchise-flavoured requests into 3D DNA.
 *
 * "resident evil style survival horror"  -> fps + zombies + hitscan + escape, dark mansion
 * "spider-man swinging through the city" -> swing + city + collect, bright
 * "choo-choo charles train horror"       -> train + stalker + scraps on rails, dark
 * "gta 5 open world crime"               -> drive + police + deliveries, day city
 * "call of duty fps waves"               -> fps + soldiers + hitscan + waves, arena
 *
 * composed3d.js implements every combination on top of GameKit3D, so each
 * request produces a genuinely different 3D game — different control scheme,
 * enemies, goal, world and atmosphere. Not a reskin.
 */

const CONTROLS = ['fps', 'swing', 'train', 'drive'];
const ENEMIES = ['zombie', 'soldier', 'stalker', 'police', 'none'];
const WEAPONS = ['hitscan', 'none'];
const GOALS = ['waves', 'escape', 'collect', 'deliver'];
const WORLDS = ['city', 'mansion', 'rails', 'arena'];

// franchise fingerprints, checked in order (first match wins per field)
const FRANCHISES = [
  { re: /resident\s*evil|survival horror|zombie apocalypse|\bre\d\b/i,
    dna: { control: 'fps', enemy: 'zombie', weapon: 'hitscan', goal: 'escape', world: 'mansion', dark: true } },
  { re: /spider[\s-]?man|spiderman|marvel|superhero|web[- ]?swing|swinging/i,
    dna: { control: 'swing', enemy: 'stalker', weapon: 'none', goal: 'collect', world: 'city', dark: false } },
  { re: /choo[\s-]?chop|choo[\s-]?choo|charles|train (?:horror|monster)|monster train/i,
    dna: { control: 'train', enemy: 'stalker', weapon: 'hitscan', goal: 'collect', world: 'rails', dark: true } },
  { re: /gta\s*[56v]|grand theft auto\s*[56v]|call of duty|\bcod\b|battlefield|counter[- ]strike|modern warfare/i,
    dna: null } // split below: gta->drive, cod->fps
];

function titleize3d(text, fallback) {
  const stop = new Set(['make', 'create', 'build', 'write', 'me', 'the', 'game', 'play', 'please', 'for', 'with', 'and', 'of', 'style', 'like', 'type', 'kind', 'bana', 'banao', 'karo', 'ek', 'mujhe', 'new', '3d', 'first', 'person']);
  const words = String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  const picked = [...new Set(words)].slice(0, 3);
  return (picked.length ? picked.join(' ') : fallback).toUpperCase();
}

function parseSpec3d(text) {
  const t = String(text || '');
  const low = t.toLowerCase();

  let dna = null;
  if (/gta\s*[56v]|grand theft auto\s*[56v]|heist|crime city/i.test(low)) {
    dna = { control: 'drive', enemy: 'police', weapon: 'none', goal: 'deliver', world: 'city', dark: false };
  } else if (/call of duty|\bcod\b|battlefield|counter[- ]strike|modern warfare|military shooter|warzone/i.test(low)) {
    dna = { control: 'fps', enemy: 'soldier', weapon: 'hitscan', goal: 'waves', world: 'arena', dark: false };
  } else {
    for (const f of FRANCHISES) if (f.dna && f.re.test(t)) { dna = { ...f.dna }; break; }
  }

  // generic word-by-word composition when no franchise matched
  if (!dna) {
    const control = /swing|web|spider|fly|glide/.test(low) ? 'swing'
      : /train|rails|track|locomotive/.test(low) ? 'train'
      : /driv|car|vehicle|race|steal|traffic/.test(low) ? 'drive'
      : 'fps';
    const enemy = /zombie|undead|infected/.test(low) ? 'zombie'
      : /soldier|enemy|terrorist|army|nazi|bot\b/.test(low) ? 'soldier'
      : /monster|spider|creature|stalker|beast/.test(low) ? 'stalker'
      : /cop|police|law/.test(low) ? 'police'
      : control === 'drive' ? 'police'
      : control === 'fps' || control === 'train' ? 'soldier' : 'none';
    const weapon = /shoot|gun|weapon|rifle|pistol|sniper|combat/.test(low) || enemy !== 'none' ? 'hitscan' : 'none';
    const goal = /escape|survive the night|get out/.test(low) ? 'escape'
      : /collect|gather|scrap|token|pickup/.test(low) ? 'collect'
      : /deliver|courier|package|mission/.test(low) ? 'deliver'
      : /wave|horde|endless/.test(low) ? 'waves'
      : enemy !== 'none' ? 'waves' : 'collect';
    const world = control === 'train' ? 'rails'
      : control === 'drive' || control === 'swing' ? 'city'
      : /mansion|house|indoor|corridor|lab/.test(low) ? 'mansion'
      : /city|urban|street|downtown/.test(low) ? 'city' : 'arena';
    const dark = /horror|dark|night|scary|creepy|haunted/.test(low) || world === 'mansion';
    dna = { control, enemy, weapon, goal, world, dark };
  }

  // per-word overrides still apply on top of franchise DNA
  if (/horror|dark|night|scary|creepy/.test(low)) dna.dark = true;
  if (/bright|day|sunny/.test(low)) dna.dark = false;
  if (/no enemies|peaceful|zen|relax/.test(low)) { dna.enemy = 'none'; }
  if (/waves|horde|endless/.test(low)) dna.goal = 'waves';
  if (/escape/.test(low)) dna.goal = 'escape';
  if (/collect|scraps|tokens/.test(low)) dna.goal = 'collect';
  if (/deliver|courier/.test(low)) dna.goal = 'deliver';

  const atmosphere = dna.dark
    ? { fogNear: 26, fogFar: 210, ambient: 0.16, rain: dna.world === 'rails' || /rain/.test(low) }
    : { fogNear: 170, fogFar: 900, ambient: 0.34, rain: /rain/.test(low) };

  return {
    control: dna.control, enemy: dna.enemy, weapon: dna.weapon, goal: dna.goal,
    world: dna.world, atmosphere, title: titleize3d(t, 'mono ops 3d'), seedText: t.slice(0, 140)
  };
}

function describeSpec3d(spec) {
  return [
    `control: ${spec.control}`,
    `enemies: ${spec.enemy}`,
    `weapon: ${spec.weapon}`,
    `goal: ${spec.goal}`,
    `world: ${spec.world}`,
    `mood: ${spec.atmosphere.ambient < 0.25 ? 'dark/horror' : 'daylight'}${spec.atmosphere.rain ? ' + rain' : ''}`
  ].join(' · ');
}

module.exports = { parseSpec3d, describeSpec3d, CONTROLS, ENEMIES, WEAPONS, GOALS, WORLDS };
