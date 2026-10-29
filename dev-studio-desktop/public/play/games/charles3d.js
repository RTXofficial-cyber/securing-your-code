const GAME_SPEC3D = {"control":"train","enemy":"stalker","weapon":"hitscan","goal":"collect","world":"rails","atmosphere":{"fogNear":26,"fogFar":210,"ambient":0.16,"rain":true},"title":"CHOO CHARLES TRAIN","seedText":"choo-choo charles style train horror game"};
/**
 * COMPOSED3D — the any-3D-game runtime, built on GameKit3D.
 *
 * A GAME_SPEC3D (from spec3d.cjs parseSpec3d) decides EVERYTHING:
 *   control  : fps | swing | train | drive     (how you move)
 *   enemy    : zombie | soldier | stalker | police | none
 *   weapon   : hitscan | none                  (click/F to shoot, R reload)
 *   goal     : waves | escape | collect | deliver
 *   world    : city | mansion | rails | arena  (geometry generator)
 *   atmosphere: fog distances, ambient light, rain
 *
 * Resident Evil => dark mansion, zombies, escape. Spider-Man => bright city,
 * web-swinging, tokens. Choo-Choo Charles => rails in the dark, a monster
 * hunting your train, scraps. GTA5 => drive the city, deliveries, police.
 * COD => arena, soldier waves, hitscan. Different games, one runtime.
 */
const SPEC = (typeof GAME_SPEC3D !== 'undefined' && GAME_SPEC3D) || {
  control: 'fps', enemy: 'soldier', weapon: 'hitscan', goal: 'waves', world: 'arena',
  atmosphere: { fogNear: 170, fogFar: 900, ambient: 0.34, rain: false },
  title: 'MONO OPS 3D', seedText: ''
};

const CONTROLS_HELP = {
  fps: ['WASD — move · Shift — sprint', 'drag mouse / ←→ — look · ↑↓ — pitch', 'click or F — shoot · R — reload'],
  swing: ['WASD — run · SPACE (hold) — web-swing', 'release at the right moment to fly', 'drag mouse / ←→ — look'],
  train: ['W/S — throttle / brake · A/D — switch track', 'click or F — shoot at whatever hunts you'],
  drive: ['W/S — gas / brake · A/D — steer', 'SPACE — handbrake · reach markers to deliver']
};

const g = new GameKit({
  title: String(SPEC.title || 'COMPOSED 3D').slice(0, 28).toUpperCase(),
  width: 960, height: 540, accent: '#ffffff',
  titleCard: {
    tagline: `${SPEC.control} · ${SPEC.enemy} · ${SPEC.goal} · ${SPEC.world}${SPEC.atmosphere && SPEC.atmosphere.ambient < 0.25 ? ' · DARK' : ''}`,
    controls: CONTROLS_HELP[SPEC.control] || CONTROLS_HELP.fps
  }
});

const WORLD_SIZE = { city: 1600, mansion: 960, arena: 800, rails: 4000 };
const EYE = 17;

g.start({
  init(g) {
    g.state = 'play';
    const WS0 = WORLD_SIZE[SPEC.world] || 800;
    g.ws = WS0;
    g.solids = [];   // collision boxes {x0,z0,w,d,h,base}
    g.rails = SPEC.world === 'rails';

    /* ---- world geometry ---- */
    if (SPEC.world === 'city') {
      for (let bx = 0; bx < 5; bx += 1) for (let bz = 0; bz < 5; bz += 1) {
        const inset = g.rand(14, 34);
        const x0 = bx * 320 + 80 + inset; const z0 = bz * 320 + 80 + inset;
        g.solids.push({ x0, z0, w: 320 - 80 - inset * 2, d: 320 - 80 - inset * 2, h: g.rand(70, 240), base: g.rand(0.46, 0.7) });
      }
    } else if (SPEC.world === 'mansion') {
      // outer walls + interior corridor walls with doorways
      const S = WS0;
      const wall = (x, z, w, d) => g.solids.push({ x0: x, z0: z, w, d, h: 64, base: 0.5 });
      wall(0, 0, S, 16); wall(0, S - 16, S, 16); wall(0, 0, 16, S); wall(S - 16, 0, 16, S);
      for (let i = 1; i <= 2; i += 1) {
        const p = i * (S / 3);
        wall(p - 8, 0, 16, S / 3 - 70); wall(p - 8, S / 3 + 70, 16, S / 3 - 70); wall(p - 8, 2 * S / 3 + 70, 16, S / 3 - 70);
        wall(0, p - 8, S / 3 - 70, 16); wall(S / 3 + 70, p - 8, S / 3 - 70, 16); wall(2 * S / 3 + 70, p - 8, S / 3 - 70, 16);
      }
      for (let i = 0; i < 6; i += 1) { // furniture crates
        g.solids.push({ x0: g.rand(60, S - 120), z0: g.rand(60, S - 120), w: g.rand(30, 70), d: g.rand(30, 70), h: g.rand(20, 44), base: 0.4 });
      }
    } else if (SPEC.world === 'arena') {
      for (let i = 0; i < 12; i += 1) {
        g.solids.push({ x0: g.rand(60, WS0 - 160), z0: g.rand(60, WS0 - 160), w: g.rand(40, 110), d: g.rand(40, 110), h: g.rand(26, 60), base: g.rand(0.4, 0.62) });
      }
    } else if (g.rails) {
      for (let z = 0; z < WS0; z += 300) { // trackside ruins
        if (Math.random() < 0.7) g.solids.push({ x0: -380 + g.rand(-60, 60), z0: z + g.rand(0, 120), w: g.rand(60, 140), d: g.rand(60, 140), h: g.rand(50, 180), base: g.rand(0.3, 0.5) });
        if (Math.random() < 0.7) g.solids.push({ x0: 220 + g.rand(-60, 60), z0: z + g.rand(0, 120), w: g.rand(60, 140), d: g.rand(60, 140), h: g.rand(50, 180), base: g.rand(0.3, 0.5) });
      }
    }

    /* ---- ground tiles ---- */
    g.tiles3 = [];
    if (g.rails) {
      for (let z = 0; z < WS0; z += 200) g.tiles3.push({ x: -240, z, s: 480, color: 0.07 });
    } else {
      const n = Math.ceil(WS0 / 160);
      for (let tx = 0; tx < n; tx += 1) for (let tz = 0; tz < n; tz += 1) {
        g.tiles3.push({ x: tx * 160, z: tz * 160, s: 160, color: SPEC.world === 'city' && (tx % 2 === 0 || tz % 2 === 0) ? 0.15 : 0.085 });
      }
    }

    /* ---- player ---- */
    const spawn = g.rails ? { x: 0, z: 200 } : SPEC.world === 'mansion' ? { x: WS0 / 2, z: WS0 / 2 } : { x: WS0 / 2, z: WS0 * 0.7 };
    g.P3 = {
      x: spawn.x, y: EYE, z: spawn.z, yaw: g.rails ? Math.PI : g.rand(Math.PI * 2), pitch: 0,
      hp: 100, hitT: 0, msg: '', msgT: 0, vx: 0, vy: 0, vz: 0,
      swinging: false, anchor: null, ammo: 12, reload: 0, fireT: 0,
      lane: 0, speed: g.rails ? 90 : 0, carAngle: 0
    };
    g.lookPrev = null;

    /* ---- goal state ---- */
    g.goal = { wave: 1, kills: 0, collected: 0, delivered: 0, timer: 0, phase: 'go' };
    g.items = []; g.marker = null; g.dropoff = null;
    if (SPEC.goal === 'collect') {
      for (let i = 0; i < (g.rails ? 15 : 12); i += 1) g.items.push(this.spawnPoint(g, true));
    } else if (SPEC.goal === 'escape') {
      const S = WS0;
      g.marker = { x: g.rand(40, 120), z: g.rand(40, 120) }; // far corner from centre spawn
      g.goal.dist = Math.hypot(g.marker.x - g.P3.x, g.marker.z - g.P3.z);
    } else if (SPEC.goal === 'deliver') {
      g.marker = this.spawnPoint(g, true);
    }

    /* ---- enemies ---- */
    g.foes = [];
    g.spawnT = 1.5;
    g.hunter = null; // the single stalker on rails
    if (g.rails && SPEC.enemy !== 'none') g.hunter = { gap: 420, hp: 8, weave: 0 };
    if (SPEC.goal === 'waves' && SPEC.enemy !== 'none') this.spawnWave(g);
  },

  /* ---------- helpers ---------- */
  spawnPoint(g, awayFromPlayer) {
    if (g.rails) {
      const z = (g.P3.z + g.rand(300, 1600)) % g.ws;
      return { x: (g.randInt(0, 2) - 1) * 44, z };
    }
    let p = { x: g.rand(50, g.ws - 50), z: g.rand(50, g.ws - 50) };
    if (awayFromPlayer) {
      let tries = 0;
      while (g.dist(p.x, p.z, g.P3.x, g.P3.z) < 260 && tries < 14) { p = { x: g.rand(50, g.ws - 50), z: g.rand(50, g.ws - 50) }; tries += 1; }
    }
    return p;
  },

  spawnWave(g) {
    const n = 3 + g.goal.wave * 2;
    for (let i = 0; i < n; i += 1) this.spawnFoe(g);
  },

  spawnFoe(g) {
    const p = this.spawnPoint(g, true);
    const kind = SPEC.enemy;
    const stats = {
      zombie: { hp: 2, spd: g.rand(30, 50), dmg: 12, h: 20, w: 9, base: 0.34 },
      soldier: { hp: 2, spd: g.rand(72, 95), dmg: 8, h: 20, w: 9, base: 0.72 },
      stalker: { hp: 3, spd: g.rand(112, 140), dmg: 18, h: 26, w: 13, base: 0.92 },
      police: { hp: 3, spd: g.rand(95, 120), dmg: 14, h: 14, w: 20, base: 0.85 }
    }[kind] || { hp: 2, spd: 60, dmg: 10, h: 20, w: 9, base: 0.6 };
    g.foes.push({ x: p.x, z: p.z, ...stats, kind, t: g.rand(10), fireT: g.rand(1) });
  },

  collideWorld(g, r) {
    const P = g.P3;
    for (const b of g.solids) {
      const nx = g.clamp(P.x, b.x0, b.x0 + b.w);
      const nz = g.clamp(P.z, b.z0, b.z0 + b.d);
      let dx = P.x - nx; let dz = P.z - nz;
      let d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 < 0.0001) { dx = 0; dz = -1; d2 = 1; }
      const d = Math.sqrt(d2);
      P.x = nx + (dx / d) * r; P.z = nz + (dz / d) * r;
    }
    if (!g.rails) { P.x = g.clamp(P.x, 8, g.ws - 8); P.z = g.clamp(P.z, 8, g.ws - 8); }
  },

  hurt(g, dmg, why) {
    const P = g.P3;
    if (P.hitT > 0) return;
    P.hp -= dmg; P.hitT = 0.85;
    g.shake(10); g.audio.noise(0.2, 0.26, 600);
    g.burst(g.width / 2, g.height / 2, 12, '#ffffff', 300);
    P.msg = why; P.msgT = 1.8;
    if (P.hp <= 0) g.gameOver(`${why} — ${g.goal.kills} kills, ${g.goal.collected} collected, ${g.goal.delivered} delivered`);
  },

  shoot(g) {
    const P = g.P3;
    if (SPEC.weapon !== 'hitscan' || P.reload > 0 || P.fireT > 0) return;
    if (P.ammo <= 0) { P.reload = 1.2; g.audio.beep(200, 0.08, 'square', 0.08); return; }
    P.ammo -= 1; P.fireT = 0.16;
    g.audio.beep(900, 0.04, 'square', 0.07, -500);
    g.shake(2);
    const fx = Math.sin(P.yaw) * Math.cos(P.pitch); const fz = -Math.cos(P.yaw) * Math.cos(P.pitch);
    let best = null; let bestD = 520;
    const targets = g.foes.slice();
    if (g.hunter) targets.push({ x: g.P3.x, z: g.P3.z - g.hunter.gap, hunter: true, hp: g.hunter.hp });
    for (const f of targets) {
      const dx = f.x - P.x; const dz = f.z - P.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      const cosAng = (dx * fx + dz * fz) / (d || 1);
      if (cosAng < 0.93) continue; // ~21° cone
      best = f; bestD = d;
    }
    if (best) {
      if (best.hunter) {
        g.hunter.hp -= 1; g.hunter.gap += 150;
        g.audio.noise(0.25, 0.3, 800);
        if (g.hunter.hp <= 0) { g.hunter = null; g.addScore(400); g.P3.msg = 'THE HUNTER IS DOWN +$400'; g.P3.msgT = 3; }
      } else {
        best.hp -= 1;
        const i = g.foes.indexOf(best);
        if (best.hp <= 0 && i >= 0) {
          g.foes.splice(i, 1);
          g.goal.kills += 1;
          g.addScore(best.kind === 'stalker' ? 40 : 25);
          g.audio.noise(0.14, 0.2, 1200);
        }
      }
    }
  },

  update(g, dt) {
    if (g.input.hit('KeyP', 'Escape')) g.togglePause();
    if (g.state === 'pause') return;
    if (g.state === 'over') { if (g.input.hit('Enter')) g.start(this); return; }
    const P = g.P3;
    P.hitT = Math.max(0, P.hitT - dt);
    P.fireT = Math.max(0, P.fireT - dt);
    P.msgT = Math.max(0, P.msgT - dt);
    if (P.reload > 0) { P.reload -= dt; if (P.reload <= 0) P.ammo = 12; }
    if (g.input.hit('KeyR') && P.ammo < 12 && P.reload <= 0) P.reload = 1.2;

    /* ---- look ---- */
    if (g.input.mouse.down) {
      if (g.lookPrev) {
        P.yaw += (g.input.mouse.x - g.lookPrev.x) * 0.005;
        P.pitch = g.clamp(P.pitch + (g.input.mouse.y - g.lookPrev.y) * 0.004, -1.1, 1.1);
      }
      g.lookPrev = { x: g.input.mouse.x, y: g.input.mouse.y };
    } else g.lookPrev = null;
    const yawLimit = g.rails ? 2.6 : null; // train: you CAN look back at the hunter
    if (g.input.down('ArrowLeft', 'KeyQ')) P.yaw -= 2.1 * dt;
    if (g.input.down('ArrowRight', 'KeyE')) P.yaw += 2.1 * dt;
    if (g.input.down('ArrowUp')) P.pitch = g.clamp(P.pitch - 1.2 * dt, -1.1, 1.1);
    if (g.input.down('ArrowDown')) P.pitch = g.clamp(P.pitch + 1.2 * dt, -1.1, 1.1);
    if (yawLimit !== null) { // train camera springs back to the track
      const target = Math.PI; let dA = target - P.yaw;
      while (dA > Math.PI) dA -= Math.PI * 2; while (dA < -Math.PI) dA += Math.PI * 2;
      if (Math.abs(dA) > yawLimit) P.yaw += Math.sign(dA) * 1.4 * dt;
    }

    const ax = g.input.axis();

    /* ---- movement per control scheme ---- */
    if (SPEC.control === 'fps') {
      const sprint = g.input.down('ShiftLeft', 'ShiftRight') ? 215 : 118;
      const fx = Math.sin(P.yaw); const fz = -Math.cos(P.yaw);
      const rx = Math.cos(P.yaw); const rz = Math.sin(P.yaw);
      let mvx = fx * -ax.y + rx * ax.x; let mvz = fz * -ax.y + rz * ax.x;
      const ml = Math.hypot(mvx, mvz);
      if (ml > 0.01) { P.x += (mvx / ml) * sprint * dt; P.z += (mvz / ml) * sprint * dt; }
      this.collideWorld(g, 9);
    } else if (SPEC.control === 'swing') {
      const GRAV = 34;
      if (g.input.down('Space')) {
        if (!P.swinging) {
          P.swinging = true;
          const fx = Math.sin(P.yaw); const fz = -Math.cos(P.yaw);
          P.anchor = { x: P.x + fx * 110, y: P.y + 75, z: P.z + fz * 110 };
          g.audio.beep(1200, 0.05, 'sine', 0.06, 300);
        }
        // rope constraint + forward pump
        const ax2 = P.anchor.x - P.x; const ay2 = P.anchor.y - P.y; const az2 = P.anchor.z - P.z;
        const L = Math.hypot(ax2, ay2, az2) || 1;
        if (L > 130) { const pull = (L - 130) * 6; P.vx += (ax2 / L) * pull * dt; P.vy += (ay2 / L) * pull * dt; P.vz += (az2 / L) * pull * dt; }
        const fx = Math.sin(P.yaw); const fz = -Math.cos(P.yaw);
        P.vx += fx * 300 * dt; P.vz += fz * 300 * dt;
      } else if (P.swinging) { P.swinging = false; P.anchor = null; }
      if (P.swinging) { P.vy -= GRAV * 0.45 * dt; } // lighter gravity mid-swing
      else {
        P.vy -= GRAV * dt;
        const sprint = g.input.down('ShiftLeft', 'ShiftRight') ? 215 : 118;
        const fx = Math.sin(P.yaw); const fz = -Math.cos(P.yaw);
        const rx = Math.cos(P.yaw); const rz = Math.sin(P.yaw);
        const ctrl = P.y > EYE + 2 ? 70 : sprint;
        P.vx += (fx * -ax.y + rx * ax.x) * ctrl * (P.y > EYE + 2 ? dt * 3 : dt * 8);
        P.vz += (fz * -ax.y + rz * ax.x) * ctrl * (P.y > EYE + 2 ? dt * 3 : dt * 8);
      }
      P.vx *= Math.max(0, 1 - (P.swinging ? 0.25 : 6) * dt);
      P.vz *= Math.max(0, 1 - (P.swinging ? 0.25 : 6) * dt);
      P.x += P.vx * dt; P.y += P.vy * dt; P.z += P.vz * dt;
      if (P.y <= EYE) { P.y = EYE; P.vy = 0; if (P.swinging) { P.swinging = false; P.anchor = null; } }
      this.collideWorld(g, 9);
    } else if (SPEC.control === 'train') {
      P.speed = g.clamp(P.speed + (g.input.down('KeyW') ? 70 : g.input.down('KeyS') ? -90 : -6) * dt, 35, 175);
      P.z += P.speed * dt;
      if (P.z > g.ws) P.z -= g.ws;
      if (g.input.hit('KeyA', 'ArrowLeft')) P.lane = Math.max(-1, P.lane - 1);
      if (g.input.hit('KeyD', 'ArrowRight')) P.lane = Math.min(1, P.lane + 1);
      const targetX = P.lane * 44;
      P.x += (targetX - P.x) * Math.min(1, 5 * dt);
      P.y = 26;
    } else if (SPEC.control === 'drive') {
      const throttle = g.input.down('KeyW', 'ArrowUp') ? 1 : g.input.down('KeyS', 'ArrowDown') ? -1 : 0;
      P.speed += throttle * 380 * dt;
      if (g.input.down('Space')) P.speed *= Math.max(0, 1 - 4.5 * dt);
      P.speed *= Math.max(0, 1 - 1.1 * dt);
      P.speed = g.clamp(P.speed, -150, 430);
      P.carAngle += (g.input.down('KeyD', 'ArrowRight') ? 1 : g.input.down('KeyA', 'ArrowLeft') ? -1 : 0) * 2.4 * dt * g.clamp(P.speed / 140, -1, 1);
      P.x += Math.sin(P.carAngle) * P.speed * dt;
      P.z += -Math.cos(P.carAngle) * P.speed * dt;
      const bx = P.x; const bz = P.z;
      this.collideWorld(g, 20);
      if (bx !== P.x || bz !== P.z) { if (Math.abs(P.speed) > 230) { g.shake(9); g.audio.noise(0.16, 0.22, 500); } P.speed *= -0.25; }
      P.y = 22;
      P.yaw += ((P.carAngle - P.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, 6 * dt); // camera follows car
    }

    /* ---- weapon ---- */
    if (SPEC.weapon === 'hitscan' && (g.input.mouse.clicked || g.input.hit('KeyF'))) this.shoot(g);

    /* ---- enemies ---- */
    if (g.rails && g.hunter) {
      const h = g.hunter;
      h.gap = Math.max(24, h.gap - (14 + g.goal.collected * 1.6) * dt); // it keeps closing in
      h.weave += dt;
      if (h.gap <= 26) this.hurt(g, 18, 'THE HUNTER TEARS AT YOUR TRAIN');
    } else if (SPEC.enemy !== 'none' && !g.rails) {
      // ambient spawning for non-wave goals
      if (SPEC.goal !== 'waves') {
        g.spawnT -= dt;
        const cap = SPEC.enemy === 'police' ? 3 : 8;
        if (g.spawnT <= 0 && g.foes.length < cap) { g.spawnT = SPEC.enemy === 'police' ? 5 : 3.2; this.spawnFoe(g); }
      }
      for (let i = g.foes.length - 1; i >= 0; i -= 1) {
        const f = g.foes[i];
        f.t += dt;
        const dx = P.x - f.x; const dz = P.z - f.z;
        const d = Math.hypot(dx, dz) || 1;
        let mx = (dx / d) * f.spd; let mz = (dz / d) * f.spd;
        if (f.kind === 'stalker') { const wv = Math.sin(f.t * 3.4) * 46; mx += (-dz / d) * wv; mz += (dx / d) * wv; } // weaving charge
        f.x += mx * dt; f.z += mz * dt;
        if (!g.rails) {
          // keep foes out of solids (cheap push-out)
          for (const b of g.solids) {
            const nx = g.clamp(f.x, b.x0, b.x0 + b.w); const nz = g.clamp(f.z, b.z0, b.z0 + b.d);
            const ddx = f.x - nx; const ddz = f.z - nz; const dd2 = ddx * ddx + ddz * ddz;
            if (dd2 < 64 && dd2 > 0.0001) { const dd = Math.sqrt(dd2); f.x = nx + (ddx / dd) * 8; f.z = nz + (ddz / dd) * 8; }
          }
        }
        if (f.kind === 'soldier' && d < 260) { // ranged poke
          f.fireT -= dt;
          if (f.fireT <= 0) { f.fireT = 1.15; this.hurt(g, 6, 'UNDER FIRE'); }
        }
        if (d < (f.kind === 'police' ? 34 : 22)) this.hurt(g, f.dmg, f.kind === 'zombie' ? 'A ZOMBIE TEARS AT YOU' : f.kind === 'stalker' ? 'THE STALKER STRIKES' : f.kind === 'police' ? 'BUSTED BY THE COPS' : 'ENEMY CONTACT');
      }
      // waves goal: clear the wave to advance
      if (SPEC.goal === 'waves' && g.foes.length === 0) {
        g.goal.wave += 1;
        g.addScore(100 * (g.goal.wave - 1));
        P.msg = `WAVE ${g.goal.wave} INCOMING`; P.msgT = 2.4;
        g.audio.chord([392, 523, 659], 0.16, 'triangle', 0.12);
        this.spawnWave(g);
      }
    }

    /* ---- goals ---- */
    if (SPEC.goal === 'collect') {
      for (let i = g.items.length - 1; i >= 0; i -= 1) {
        const it = g.items[i];
        if (g.dist(it.x, it.z, P.x, P.z) < 26) {
          g.items.splice(i, 1);
          g.goal.collected += 1; g.addScore(50);
          g.audio.chord([523, 659, 784], 0.12, 'triangle', 0.1);
          g.burst(g.width / 2, g.height * 0.55, 16, '#ffffff', 260);
          P.msg = g.rails ? `SCRAP ${g.goal.collected}/15 (+$50)` : `SECURED ${g.goal.collected}/12 (+$50)`;
          P.msgT = 1.6;
          if ((g.rails && g.goal.collected >= 15) || (!g.rails && g.goal.collected >= 12)) {
            g.addScore(500); g.gameOver(`ALL CARGO SECURED — the ${g.rails ? 'train rolls on' : 'city is yours'}`); return;
          }
          g.items.push(this.spawnPoint(g, true));
        }
      }
    } else if (SPEC.goal === 'escape' && g.marker) {
      const d = g.dist(g.marker.x, g.marker.z, P.x, P.z);
      if (d < 34) { g.addScore(700); g.gameOver('YOU ESCAPED THE DARK'); return; }
      if (Math.floor(g.time * 2) % 2 === 0 && P.msgT <= 0) { P.msg = `EXIT ${Math.round(d)}m — run`; P.msgT = 0.4; }
    } else if (SPEC.goal === 'deliver') {
      const M = g.goal;
      if (M.phase === 'go' && g.marker) {
        if (g.dist(g.marker.x, g.marker.z, P.x, P.z) < 40) {
          M.phase = 'drop';
          g.dropoff = this.spawnPoint(g, true);
          M.timer = 30 + g.dist(g.marker.x, g.marker.z, g.dropoff.x, g.dropoff.z) / 26;
          g.audio.chord([523, 659], 0.12, 'triangle', 0.1);
          P.msg = 'CARGO ABOARD — reach the drop, clock is running'; P.msgT = 2.4;
        }
      } else if (M.phase === 'drop' && g.dropoff) {
        M.timer -= dt;
        if (g.dist(g.dropoff.x, g.dropoff.z, P.x, P.z) < 40) {
          M.delivered += 1;
          const reward = 120 + (M.delivered - 1) * 80;
          g.addScore(reward);
          g.audio.chord([523, 659, 784], 0.16, 'triangle', 0.12);
          P.msg = `DELIVERED +$${reward} (${M.delivered}/3)`; P.msgT = 2.4;
          if (M.delivered >= 3) { g.addScore(600); g.gameOver('ALL DELIVERIES COMPLETE — the city belongs to you'); return; }
          M.phase = 'go'; g.marker = this.spawnPoint(g, true); g.dropoff = null;
        } else if (M.timer <= 0) {
          P.msg = 'MISSED — the buyer walked'; P.msgT = 2.4;
          g.audio.beep(160, 0.2, 'sawtooth', 0.1, -60);
          M.phase = 'go'; g.marker = this.spawnPoint(g, true); g.dropoff = null;
        }
      }
    }
  },

  draw(g) {
    const P = g.P3;
    const K3 = globalThis.GameKit3D || (typeof window !== 'undefined' ? window.GameKit3D : null);
    if (g.state === 'over') { g.drawGameOver(); return; }
    if (!K3) { g.text('engine3d.js missing', g.width / 2, g.height / 2, 18, '#fff', 'center'); return; }

    const camera = {
      pos: [P.x, P.y, P.z], yaw: P.yaw, pitch: P.pitch,
      fov: 74, aspect: g.width / g.height, near: 5, far: 2400,
      width: g.width, height: g.height
    };
    const faces = [];
    const near = (x, z, r) => {
      const dz = g.rails ? Math.min(Math.abs(z - P.z), g.ws - Math.abs(z - P.z)) : Math.abs(z - P.z);
      return Math.hypot(x - P.x, dz) < r;
    };

    /* world */
    for (const t of g.tiles3) if (near(t.x + t.s / 2, t.z + t.s / 2, 1200)) faces.push(K3.groundFace(t.x, t.z, t.s, t.color));
    for (const b of g.solids) if (near(b.x0 + b.w / 2, b.z0 + b.d / 2, 1100)) faces.push(...K3.boxFaces(b.x0, 0, b.z0, b.w, b.h, b.d, b.base));
    if (g.rails) {
      for (let i = -4; i < 16; i += 1) { // sleepers around the player (wrapped)
        let z = (Math.floor(P.z / 40) + i) * 40;
        const zz = ((z % g.ws) + g.ws) % g.ws;
        if (!near(0, zz, 700)) continue;
        faces.push(...K3.boxFaces(-72, 0.5, zz - 4, 144, 1.5, 8, 0.3));
        faces.push(...K3.boxFaces(-56, 1.5, zz - 2.5, 4, 3, 5, 0.5)); // rails
        faces.push(...K3.boxFaces(52, 1.5, zz - 2.5, 4, 3, 5, 0.5));
      }
      // the player's train engine
      faces.push(...K3.boxFaces(P.x - 22, 4, P.z - 46, 44, 30, 92, 0.8));
      faces.push(...K3.boxFaces(P.x - 14, 34, P.z - 20, 28, 14, 34, 0.62));
    }

    /* items + markers */
    for (const it of g.items) {
      if (!near(it.x, it.z, 620)) continue;
      const bob = 16 + Math.sin(g.time * 3 + it.x) * 3;
      for (const f of K3.boxFaces(it.x - 6, bob, it.z - 6, 12, 12, 12, 0.98)) faces.push(K3.rotateFaceY(f, it.x, it.z, g.time * 2));
    }
    const mark = SPEC.goal === 'deliver' && g.goal.phase === 'drop' ? g.dropoff : g.marker;
    if (mark) {
      if (near(mark.x, mark.z, 1400)) {
        faces.push(...K3.boxFaces(mark.x - 7, 0, mark.z - 7, 14, 74 + Math.sin(g.time * 4) * 5, 14, 0.95));
      }
    }

    /* enemies */
    for (const f of g.foes) {
      if (!near(f.x, f.z, 700)) continue;
      const bob = f.kind === 'zombie' ? Math.sin(f.t * 6) * 1.4 : 0;
      if (f.kind === 'police') faces.push(...K3.boxFaces(f.x - f.w / 2, 1, f.z - f.w / 2, f.w, f.h, f.w * 1.9, f.base));
      else faces.push(...K3.boxFaces(f.x - f.w / 2, bob, f.z - f.w / 2, f.w, f.h, f.w, f.base));
    }
    if (g.hunter) { // the rail stalker: a big weaving horror behind the train
      const hz = P.z - g.hunter.gap;
      const wx = Math.sin(g.hunter.weave * 2.2) * 26;
      faces.push(...K3.boxFaces(wx - 34, 6, hz - 50, 68, 46, 100, 0.9));
      faces.push(...K3.boxFaces(wx - 14, 52, hz - 20, 28, 22, 34, 0.98));
      for (let leg = 0; leg < 4; leg += 1) {
        const lx = wx + (leg < 2 ? -46 : 46); const lz = hz - (leg % 2 === 0 ? 34 : 10);
        faces.push(...K3.boxFaces(lx - 4, 0, lz - 4, 8, 40, 8, 0.5));
      }
    }

    const atm = SPEC.atmosphere || {};
    K3.renderScene(g.ctx, {
      camera, faces,
      fogNear: atm.fogNear === undefined ? 170 : atm.fogNear,
      fogFar: atm.fogFar === undefined ? 900 : atm.fogFar,
      ambient: atm.ambient === undefined ? 0.34 : atm.ambient,
      light: atm.ambient < 0.25 ? [-0.3, 0.55, -0.45] : [-0.45, 0.82, -0.38]
    });

    /* rain (screen space) */
    if (atm.rain) {
      const c = g.ctx;
      c.strokeStyle = 'rgba(245,244,240,.28)';
      for (let i = 0; i < 55; i += 1) {
        const rx = ((i * 173 + g.frame * 13) % g.width);
        const ry = ((i * 337 + g.frame * 29) % g.height);
        c.beginPath(); c.moveTo(rx, ry); c.lineTo(rx - 2, ry + 13); c.stroke();
      }
    }

    /* web line while swinging */
    if (P.swinging && P.anchor) {
      const K3p = K3.projectPoint(camera, [P.anchor.x, P.anchor.y, P.anchor.z]);
      if (K3p) {
        g.ctx.strokeStyle = 'rgba(245,244,240,.9)';
        g.ctx.beginPath(); g.ctx.moveTo(g.width / 2, g.height / 2 + 40); g.ctx.lineTo(K3p.x, K3p.y); g.ctx.stroke();
      }
    }

    /* ---- HUD ---- */
    const c = g.ctx;
    c.strokeStyle = 'rgba(245,244,240,.85)';
    c.beginPath();
    c.moveTo(g.width / 2 - 9, g.height / 2); c.lineTo(g.width / 2 + 9, g.height / 2);
    c.moveTo(g.width / 2, g.height / 2 - 9); c.lineTo(g.width / 2, g.height / 2 + 9);
    c.stroke();
    for (let i = 0; i < 10; i += 1) g.rect(16 + i * 13, g.height - 24, 10, 12, i * 10 < P.hp ? '#ffffff' : 'rgba(245,244,240,.16)');
    let goalText = '';
    if (SPEC.goal === 'waves') goalText = `WAVE ${g.goal.wave} · FOES ${g.foes.length} · KILLS ${g.goal.kills}`;
    if (SPEC.goal === 'collect') goalText = g.rails ? `SCRAP ${g.goal.collected}/15` : `CARGO ${g.goal.collected}/12`;
    if (SPEC.goal === 'escape' && g.marker) goalText = `EXIT ${Math.round(g.dist(g.marker.x, g.marker.z, P.x, P.z))}m`;
    if (SPEC.goal === 'deliver') goalText = g.goal.phase === 'drop' ? `DELIVER ${Math.ceil(Math.max(0, g.goal.timer))}s · ${g.goal.delivered}/3` : `REACH PICKUP · ${g.goal.delivered}/3`;
    g.text(goalText, g.width / 2, g.height - 20, 13, 'rgba(245,244,240,.85)', 'center', 700);
    g.text(`${SPEC.control.toUpperCase()} · ${SPEC.enemy.toUpperCase()}`, 16, g.height - 42, 11, 'rgba(245,244,240,.55)', 'left', 600);
    if (SPEC.weapon === 'hitscan') {
      g.text(P.reload > 0 ? 'RELOADING…' : `AMMO ${P.ammo}/12`, g.width - 16, g.height - 24, 14, '#ffffff', 'right', 800);
    }
    if (SPEC.control === 'train' || SPEC.control === 'drive') g.text(`${Math.round(Math.abs(P.speed))} km/h`, g.width - 16, g.height - 46, 12, 'rgba(245,244,240,.7)', 'right', 600);
    if (g.hunter) g.text(`HUNTER ${Math.round(g.hunter.gap)}m BEHIND`, g.width / 2, 44, 13, '#ffffff', 'center', 800);
    if (P.msgT > 0) g.text(P.msg, g.width / 2, g.height - 60, 13, '#ffffff', 'center', 700);

    /* minimap for open worlds */
    if (!g.rails) {
      const mw = 120; const mh = 120; const mx = g.width - mw - 14; const my = g.height - mh - 40;
      const s = mw / g.ws;
      c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(mx, my, mw, mh);
      c.strokeStyle = 'rgba(245,244,240,.5)'; c.strokeRect(mx + 0.5, my + 0.5, mw - 1, mh - 1);
      c.fillStyle = 'rgba(245,244,240,.25)';
      for (const b of g.solids) c.fillRect(mx + b.x0 * s, my + b.z0 * s, Math.max(1, b.w * s), Math.max(1, b.d * s));
      c.fillStyle = 'rgba(245,244,240,.9)';
      for (const it of g.items) c.fillRect(mx + it.x * s - 1.5, my + it.z * s - 1.5, 3, 3);
      if (mark) c.fillRect(mx + mark.x * s - 2, my + mark.z * s - 2, 4, 4);
      for (const f of g.foes) c.fillRect(mx + f.x * s - 1, my + f.z * s - 1, 2.5, 2.5);
      c.save(); c.translate(mx + P.x * s, my + P.z * s); c.rotate(P.yaw);
      c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(0, -5); c.lineTo(3.4, 4); c.lineTo(-3.4, 4); c.closePath(); c.fill();
      c.restore();
    }
  }
});

if (typeof window !== 'undefined') window.__composed3d = g; // test hook
g.__SPEC = SPEC;
