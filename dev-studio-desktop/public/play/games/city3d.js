/**
 * MONO CITY 3D — a first-person 3D city, rendered by GameKit3D.
 *
 * Real perspective 3D: you walk (and sprint) through a block city with
 * directional sunlight, backface culling and distance fog. Traffic cruises
 * the roads and will hit you; glowing packages float at street level —
 * collect them for cash. Monochrome, zero dependencies, headless-proven.
 *
 * Controls: WASD walk · Shift sprint · mouse-drag or ←/→ look, ↑/↓ pitch
 *           · Q/E turn · P pause · M mute. Packages pay $50 each.
 */
const g = new GameKit({
  title: 'MONO CITY 3D', width: 960, height: 540, accent: '#ffffff',
  titleCard: {
    tagline: 'a real 3D city — walk it, survive traffic, grab the packages',
    controls: [
      'WASD — walk · Shift — sprint',
      'drag mouse or ←/→ — look · ↑/↓ or Q/E — turn/pitch',
      'floating packages = $50 · traffic = pain',
      'fog hides the horizon; the minimap does not lie'
    ]
  }
});

const CW = 1600;          // world size (x and z)
const PITCH = 320;        // block pitch
const ROAD = 80;          // road strip width
const EYE = 17;           // camera height on foot

function roadPoint3(g) {
  if (Math.random() < 0.5) {
    const col = g.randInt(0, Math.floor(CW / PITCH) - 1);
    return { x: col * PITCH + ROAD / 2 + g.rand(-22, 22), z: g.rand(80, CW - 80) };
  }
  const row = g.randInt(0, Math.floor(CW / PITCH) - 1);
  return { x: g.rand(80, CW - 80), z: row * PITCH + ROAD / 2 + g.rand(-22, 22) };
}

g.start({
  init(g) {
    g.state = 'play';
    // ---- city layout: 5x5 blocks, one building each, random heights ----
    g.buildings3 = [];
    for (let bx = 0; bx < 5; bx += 1) {
      for (let bz = 0; bz < 5; bz += 1) {
        const inset = g.rand(14, 34);
        const x0 = bx * PITCH + ROAD + inset;
        const z0 = bz * PITCH + ROAD + inset;
        const w = PITCH - ROAD - inset * 2;
        const d = PITCH - ROAD - inset * 2;
        g.buildings3.push({ x0, z0, w, d, h: g.rand(60, 260), base: g.rand(0.46, 0.72), cx: x0 + w / 2, cz: z0 + d / 2 });
      }
    }
    // ---- ground tiles (painter-sort friendly 160px quads) ----
    g.tiles3 = [];
    for (let tx = 0; tx < 10; tx += 1) {
      for (let tz = 0; tz < 10; tz += 1) {
        const isRoad = tx % 2 === 0 || tz % 2 === 0;
        g.tiles3.push({ x: tx * 160, z: tz * 160, color: isRoad ? 0.15 : 0.085 });
      }
    }
    // ---- traffic ----
    g.cars3 = [];
    for (let i = 0; i < 10; i += 1) {
      const axis = Math.random() < 0.5 ? 'x' : 'z';
      const lane = g.randInt(0, Math.floor(CW / PITCH) - 1) * PITCH + ROAD / 2 + (Math.random() < 0.5 ? -16 : 16);
      g.cars3.push({ axis, lane, along: g.rand(0, CW), dir: Math.random() < 0.5 ? 1 : -1, speed: g.rand(70, 150) });
    }
    // ---- packages ----
    g.collect3 = [];
    for (let i = 0; i < 12; i += 1) {
      const p = roadPoint3(g);
      g.collect3.push({ x: p.x, z: p.z });
    }
    g.collected = 0;
    // ---- player ----
    const sp = roadPoint3(g);
    g.P3 = { x: sp.x, z: sp.z, yaw: g.rand(Math.PI * 2), pitch: 0, hp: 100, hitT: 0, msg: '', msgT: 0 };
    g.lookPrev = null;
    g.score = 0;
  },

  collideCity(g) {
    const P = g.P3;
    const r = 9;
    for (const b of g.buildings3) {
      const nx = g.clamp(P.x, b.x0, b.x0 + b.w);
      const nz = g.clamp(P.z, b.z0, b.z0 + b.d);
      let dx = P.x - nx; let dz = P.z - nz;
      let d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 < 0.0001) { dx = 0; dz = -1; d2 = 1; } // dead centre: push north
      const d = Math.sqrt(d2);
      P.x = nx + (dx / d) * r;
      P.z = nz + (dz / d) * r;
    }
    P.x = g.clamp(P.x, 8, CW - 8); P.z = g.clamp(P.z, 8, CW - 8);
  },

  update(g, dt) {
    if (g.input.hit('KeyP', 'Escape')) g.togglePause();
    if (g.state === 'pause') return;
    if (g.state === 'over') { if (g.input.hit('Enter')) g.start(this); return; }
    const P = g.P3;

    /* ---- look: mouse drag, arrows, Q/E ---- */
    if (g.input.mouse.down) {
      if (g.lookPrev) {
        P.yaw += (g.input.mouse.x - g.lookPrev.x) * 0.005;
        P.pitch = g.clamp(P.pitch + (g.input.mouse.y - g.lookPrev.y) * 0.004, -1.15, 1.15);
      }
      g.lookPrev = { x: g.input.mouse.x, y: g.input.mouse.y };
    } else g.lookPrev = null;
    if (g.input.down('ArrowLeft')) P.yaw -= 2.1 * dt;
    if (g.input.down('ArrowRight')) P.yaw += 2.1 * dt;
    if (g.input.down('ArrowUp')) P.pitch = g.clamp(P.pitch - 1.3 * dt, -1.15, 1.15);
    if (g.input.down('ArrowDown')) P.pitch = g.clamp(P.pitch + 1.3 * dt, -1.15, 1.15);
    if (g.input.down('KeyQ')) P.yaw -= 2.1 * dt;
    if (g.input.down('KeyE')) P.yaw += 2.1 * dt;

    /* ---- walk ---- */
    const ax = g.input.axis();
    const sprint = g.input.down('ShiftLeft', 'ShiftRight') ? 215 : 118;
    // forward on the ground plane for the current yaw (camera looks -z at yaw 0)
    const fx = Math.sin(P.yaw); const fz = -Math.cos(P.yaw);
    const rx = Math.cos(P.yaw); const rz = Math.sin(P.yaw);
    let mvx = 0; let mvz = 0;
    mvx += fx * -ax.y + rx * ax.x;
    mvz += fz * -ax.y + rz * ax.x;
    const ml = Math.hypot(mvx, mvz);
    if (ml > 0.01) { P.x += (mvx / ml) * sprint * dt; P.z += (mvz / ml) * sprint * dt; }
    this.collideCity(g);

    /* ---- traffic ---- */
    P.hitT = Math.max(0, P.hitT - dt);
    for (const car of g.cars3) {
      car.along += car.dir * car.speed * dt;
      if (car.along < -40) car.along = CW + 40;
      if (car.along > CW + 40) car.along = -40;
      const cx = car.axis === 'x' ? car.along : car.lane;
      const cz = car.axis === 'x' ? car.lane : car.along;
      if (P.hitT <= 0 && g.dist(cx, cz, P.x, P.z) < 26) {
        P.hp -= 15; P.hitT = 1.1;
        // knockback away from the car
        const kx = P.x - cx; const kz = P.z - cz;
        const kl = Math.hypot(kx, kz) || 1;
        P.x += (kx / kl) * 34; P.z += (kz / kl) * 34;
        this.collideCity(g);
        g.shake(12); g.stop(70);
        g.audio.noise(0.25, 0.3, 500);
        g.burst(g.width / 2, g.height / 2, 18, '#ffffff', 320);
        P.msg = 'HIT BY TRAFFIC — watch the roads!'; P.msgT = 2.4;
        if (P.hp <= 0) { g.gameOver(`WASTED — ${g.collected} packages collected`); return; }
      }
    }

    /* ---- packages ---- */
    for (let i = 0; i < g.collect3.length; i += 1) {
      const cp = g.collect3[i];
      if (g.dist(cp.x, cp.z, P.x, P.z) < 24) {
        g.collected += 1;
        g.addScore(50);
        g.audio.chord([523, 659, 784], 0.14, 'triangle', 0.12);
        g.burst(g.width / 2, g.height * 0.55, 20, '#ffffff', 280);
        P.msg = `PACKAGE SECURED +$50 (${g.collected} total)`; P.msgT = 2;
        const np = roadPoint3(g);
        g.collect3[i] = { x: np.x, z: np.z };
      }
    }
    P.msgT = Math.max(0, P.msgT - dt);
  },

  draw(g) {
    const P = g.P3;
    const K3 = globalThis.GameKit3D || (typeof window !== 'undefined' ? window.GameKit3D : null);
    if (g.state === 'over') { g.drawGameOver(); return; }
    if (!K3) { g.text('engine3d.js missing', g.width / 2, g.height / 2, 18, '#fff', 'center'); return; }

    const camera = {
      pos: [P.x, EYE, P.z], yaw: P.yaw, pitch: P.pitch,
      fov: 72, aspect: g.width / g.height, near: 5, far: 2200,
      width: g.width, height: g.height
    };

    /* ---- assemble visible faces (distance-culled) ---- */
    const faces = [];
    const inRange = (x, z, r) => g.dist(x, z, P.x, P.z) < r;
    for (const t of g.tiles3) if (inRange(t.x + 80, t.z + 80, 1150)) faces.push(K3.groundFace(t.x, t.z, 160, t.color));
    for (const b of g.buildings3) if (inRange(b.cx, b.cz, 1150)) faces.push(...K3.boxFaces(b.x0, 0, b.z0, b.w, b.h, b.d, b.base));
    for (const car of g.cars3) {
      const cx = car.axis === 'x' ? car.along : car.lane;
      const cz = car.axis === 'x' ? car.lane : car.along;
      if (!inRange(cx, cz, 700)) continue;
      if (car.axis === 'x') faces.push(...K3.boxFaces(cx - 20, 1, cz - 10, 40, 13, 20, 0.88));
      else faces.push(...K3.boxFaces(cx - 10, 1, cz - 20, 20, 13, 40, 0.88));
    }
    for (const cp of g.collect3) {
      if (!inRange(cp.x, cp.z, 500)) continue;
      const bob = 14 + Math.sin(g.time * 3 + cp.x) * 3;
      const cube = K3.boxFaces(cp.x - 6, bob, cp.z - 6, 12, 12, 12, 0.98);
      for (const f of cube) faces.push(K3.rotateFaceY(f, cp.x, cp.z, g.time * 2));
    }

    K3.renderScene(g.ctx, { camera, faces, fogNear: 160, fogFar: 880, light: [-0.45, 0.82, -0.38] });

    /* ---- HUD (screen space) ---- */
    const c = g.ctx;
    c.strokeStyle = 'rgba(245,244,240,.85)';
    c.beginPath();
    c.moveTo(g.width / 2 - 9, g.height / 2); c.lineTo(g.width / 2 + 9, g.height / 2);
    c.moveTo(g.width / 2, g.height / 2 - 9); c.lineTo(g.width / 2, g.height / 2 + 9);
    c.stroke();
    for (let i = 0; i < 10; i += 1) g.rect(16 + i * 13, g.height - 24, 10, 12, i * 10 < P.hp ? '#ffffff' : 'rgba(245,244,240,.16)');
    g.text(`PACKAGES ${g.collected}`, 16, g.height - 42, 12, 'rgba(245,244,240,.65)', 'left', 600);
    if (P.msgT > 0) g.text(P.msg, g.width / 2, g.height - 62, 13, '#ffffff', 'center', 700);

    /* ---- minimap: top-down truth ---- */
    const mw = 132; const mh = 132; const mx = g.width - mw - 14; const my = g.height - mh - 14;
    const s = mw / CW;
    c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(mx, my, mw, mh);
    c.strokeStyle = 'rgba(245,244,240,.5)'; c.strokeRect(mx + 0.5, my + 0.5, mw - 1, mh - 1);
    c.fillStyle = 'rgba(245,244,240,.25)';
    for (const b of g.buildings3) c.fillRect(mx + b.x0 * s, my + b.z0 * s, b.w * s, b.d * s);
    c.fillStyle = 'rgba(245,244,240,.9)';
    for (const cp of g.collect3) c.fillRect(mx + cp.x * s - 1.5, my + cp.z * s - 1.5, 3, 3);
    for (const car of g.cars3) {
      const cx = car.axis === 'x' ? car.along : car.lane;
      const cz = car.axis === 'x' ? car.lane : car.along;
      c.fillRect(mx + cx * s - 1.5, my + cz * s - 1.5, 3, 3);
    }
    // player arrow
    c.save();
    c.translate(mx + P.x * s, my + P.z * s);
    c.rotate(P.yaw);
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(0, -5); c.lineTo(3.4, 4); c.lineTo(-3.4, 4); c.closePath(); c.fill();
    c.restore();
  }
});

if (typeof window !== 'undefined') window.__city3d = g; // test hook
