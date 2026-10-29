/**
 * GRAND THEFT MONO — a mini open-world crime city (GTA-style homage).
 *
 * A drivable top-down city: walk on foot, jack any parked car (X/E), run
 * courier missions for cash, and if you commit crimes the WANTED stars rise
 * and police cars spawn and chase you. Five stars is a bad day. Monochrome,
 * zero-dependency, one file — the honest arcade-scale answer to "make a game
 * like GTA" (the real one took thousands of people a decade; this is the
 * same SYSTEMS — open city, vehicles, pedestrians, wanted level, police AI,
 * missions, minimap — distilled into ~350 lines).
 *
 * Controls: WASD/arrows walk+drive · X or E enter/exit car · SPACE handbrake
 *           · P pause · M mute. Reach P marker, deliver to D before the clock.
 */
const g = new GameKit({
  title: 'GRAND THEFT MONO', width: 960, height: 540, accent: '#ffffff',
  titleCard: {
    tagline: 'steal cars · run packages · outrun the stars',
    controls: [
      'WASD / arrows — walk · drive',
      'X or E — enter / exit car · SPACE — handbrake',
      'P marker → pick up · D marker → deliver before time runs out',
      'Crimes raise WANTED ★ — police will find you'
    ]
  }
});

const W = { w: 2400, h: 1800, pitch: 400, road: 96 }; // world grid

function roadPoint(g, margin = 120) {
  // a random point that sits ON a road strip (center ± small jitter)
  const vertical = Math.random() < 0.5;
  if (vertical) {
    const col = g.randInt(0, Math.max(1, Math.floor(W.w / W.pitch)) - 1);
    return { x: col * W.pitch + W.road / 2 + g.rand(-24, 24), y: g.rand(margin, W.h - margin) };
  }
  const row = g.randInt(0, Math.max(1, Math.floor(W.h / W.pitch)) - 1);
  return { x: g.rand(margin, W.w - margin), y: row * W.pitch + W.road / 2 + g.rand(-24, 24) };
}

g.start({
  init(g) {
    g.state = 'play';
    g.buildings = [];
    for (let bx = 0; bx * W.pitch < W.w; bx += 1) {
      for (let by = 0; by * W.pitch < W.h; by += 1) {
        const x0 = bx * W.pitch + W.road + 14;
        const y0 = by * W.pitch + W.road + 14;
        const bw = W.pitch - W.road - 28;
        const bh = W.pitch - W.road - 28;
        if (bw <= 40 || bh <= 40) continue;
        const split = Math.random() < 0.55;
        if (split) {
          const cut = g.rand(0.35, 0.65);
          if (Math.random() < 0.5) {
            g.buildings.push({ x: x0, y: y0, w: bw * cut - 8, h: bh });
            g.buildings.push({ x: x0 + bw * cut + 8, y: y0, w: bw * (1 - cut) - 8, h: bh });
          } else {
            g.buildings.push({ x: x0, y: y0, w: bw, h: bh * cut - 8 });
            g.buildings.push({ x: x0, y: y0 + bh * cut + 8, w: bw, h: bh * (1 - cut) - 8 });
          }
        } else {
          g.buildings.push({ x: x0 + g.rand(0, 20), y: y0 + g.rand(0, 20), w: bw - g.rand(0, 40), h: bh - g.rand(0, 40) });
        }
      }
    }
    const c0 = roadPoint(g);
    g.player = { x: c0.x, y: c0.y, r: 9, hp: 100, face: 0, inCar: null, arrestT: 0 };
    g.cam = { x: 0, y: 0 };
    g.cars = [];
    for (let i = 0; i < 16; i += 1) {
      const p = roadPoint(g);
      const vertical = (p.x % W.pitch) < W.road; // parked along the road direction
      g.cars.push({
        x: p.x, y: p.y, w: 46, h: 24, angle: vertical ? Math.PI / 2 : 0,
        speed: 0, maxSpeed: 430, accel: 380, hp: 60, flash: 0
      });
    }
    g.peds = [];
    for (let i = 0; i < 26; i += 1) {
      const p = roadPoint(g);
      g.peds.push({ x: p.x + g.rand(-30, 30), y: p.y + g.rand(-30, 30), dir: g.rand(Math.PI * 2), t: g.rand(1, 3), spd: g.rand(40, 70) });
    }
    g.cops = [];
    g.wanted = 0; g.decayT = 0; g.spawnT = 0;
    g.mission = { phase: 'go', done: 0, timer: 0, msg: '' };
    this.newMission(g, true);
    g.score = 0;
  },

  /* ---------- helpers (called as this.foo(g)) ---------- */
  collideBuildings(g, e, half) {
    for (const b of g.buildings) {
      if (e.x + half < b.x || e.x - half > b.x + b.w || e.y + half < b.y || e.y - half > b.y + b.h) continue;
      const dxL = (e.x + half) - b.x; const dxR = (b.x + b.w) - (e.x - half);
      const dyT = (e.y + half) - b.y; const dyB = (b.y + b.h) - (e.y - half);
      const m = Math.min(dxL, dxR, dyT, dyB);
      if (m === dxL) e.x = b.x - half; else if (m === dxR) e.x = b.x + b.w + half;
      else if (m === dyT) e.y = b.y - half; else e.y = b.y + b.h + half;
    }
    e.x = g.clamp(e.x, 10, W.w - 10); e.y = g.clamp(e.y, 10, W.h - 10);
  },
  crime(g, n) {
    g.wanted = Math.min(5, g.wanted + n);
    g.decayT = 0;
    g.shake(6);
    g.audio.noise(0.2, 0.2, 600);
  },
  newMission(g, first) {
    const p = roadPoint(g, 200);
    if (!first) {
      // keep the next pickup away from the player
      let tries = 0;
      while (g.dist(p.x, p.y, g.player.x, g.player.y) < 500 && tries < 12) { const q = roadPoint(g, 200); p.x = q.x; p.y = q.y; tries += 1; }
    }
    g.mission = { phase: 'go', done: g.mission ? g.mission.done : 0, timer: 0, msg: 'Reach the P marker', px: p.x, py: p.y, dx: 0, dy: 0 };
  },
  spawnCop(g) {
    // spawn on a road, off-camera but not absurdly far
    let p = roadPoint(g, 160);
    let tries = 0;
    while (g.dist(p.x, p.y, g.player.x, g.player.y) < 620 && tries < 14) { p = roadPoint(g, 160); tries += 1; }
    g.cops.push({ x: p.x, y: p.y, w: 46, h: 24, angle: g.rand(Math.PI * 2), speed: 0, hp: 50, flash: 0 });
    g.audio.beep(660, 0.09, 'square', 0.08, 220);
  },

  update(g, dt) {
    if (g.input.hit('KeyP', 'Escape')) g.togglePause();
    if (g.state === 'pause') return;
    if (g.state === 'over') { if (g.input.hit('Enter')) g.start(this); return; }

    const P = g.player;
    const ax = g.input.axis();

    /* ---- enter / exit vehicles ---- */
    if (g.input.hit('KeyX', 'KeyE')) {
      if (P.inCar) {
        const car = P.inCar;
        car.speed = 0;
        P.inCar = null;
        P.x = car.x + Math.cos(car.angle + Math.PI / 2) * 34;
        P.y = car.y + Math.sin(car.angle + Math.PI / 2) * 34;
        this.collideBuildings(g, P, P.r);
        g.audio.beep(300, 0.06, 'square', 0.08);
      } else {
        let best = null; let bd = 52;
        for (const car of g.cars) {
          const d = g.dist(car.x, car.y, P.x, P.y);
          if (d < bd) { bd = d; best = car; }
        }
        if (best) {
          P.inCar = best;
          P.x = best.x; P.y = best.y;
          g.audio.beep(520, 0.07, 'square', 0.09, 120);
        }
      }
    }

    /* ---- player movement ---- */
    if (P.inCar) {
      const car = P.inCar;
      const throttle = -ax.y;
      car.speed += throttle * car.accel * dt;
      if (g.input.down('Space')) car.speed *= Math.max(0, 1 - 4.5 * dt); // handbrake
      car.speed *= Math.max(0, 1 - 1.1 * dt); // friction
      car.speed = g.clamp(car.speed, -150, car.maxSpeed);
      const turn = 2.5 * dt * g.clamp(car.speed / 130, -1, 1);
      car.angle += ax.x * turn;
      P.face = car.angle;
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      const before = { x: car.x, y: car.y };
      this.collideBuildings(g, car, 20);
      if (before.x !== car.x || before.y !== car.y) {
        if (Math.abs(car.speed) > 220) { g.shake(9); g.audio.noise(0.18, 0.24, 500); g.burst(car.x - g.cam.x, car.y - g.cam.y, 12, '#ffffff', 240); }
        car.speed *= -0.25;
      }
      P.x = car.x; P.y = car.y;

      /* ---- running over pedestrians ---- */
      if (Math.abs(car.speed) > 55) {
        for (let i = g.peds.length - 1; i >= 0; i -= 1) {
          const pd = g.peds[i];
          if (g.dist(pd.x, pd.y, car.x, car.y) < 26) {
            g.peds.splice(i, 1);
            this.crime(g, 1);
            g.burst(pd.x - g.cam.x, pd.y - g.cam.y, 20, '#ffffff', 300);
            g.stop(50);
          }
        }
      }
    } else {
      const spd = 175;
      P.x += ax.x * spd * dt; P.y += ax.y * spd * dt;
      if (ax.x || ax.y) P.face = Math.atan2(ax.y, ax.x);
      this.collideBuildings(g, P, P.r);
    }

    /* ---- camera ---- */
    g.cam.x = g.clamp(P.x - g.width / 2, 0, Math.max(0, W.w - g.width));
    g.cam.y = g.clamp(P.y - g.height / 2, 0, Math.max(0, W.h - g.height));

    /* ---- pedestrians wander ---- */
    if (g.peds.length < 26 && Math.random() < dt * 0.8) {
      const p = roadPoint(g, 160);
      if (g.dist(p.x, p.y, P.x, P.y) > 480) g.peds.push({ x: p.x, y: p.y, dir: g.rand(Math.PI * 2), t: 1, spd: g.rand(40, 70) });
    }
    for (const pd of g.peds) {
      pd.t -= dt;
      if (pd.t <= 0) { pd.t = g.rand(1.2, 3.4); pd.dir = g.rand(Math.PI * 2); }
      const flee = !P.inCar && g.dist(pd.x, pd.y, P.x, P.y) < 60 && g.wanted > 0;
      const s = pd.spd * (flee ? 2.4 : 1);
      pd.x += Math.cos(pd.dir) * s * dt; pd.y += Math.sin(pd.dir) * s * dt;
      this.collideBuildings(g, pd, 5);
    }

    /* ---- wanted level: spawn + decay ---- */
    if (g.wanted > 0) {
      g.spawnT -= dt;
      if (g.spawnT <= 0 && g.cops.length < g.wanted + 1) {
        g.spawnT = Math.max(1.2, 5 - g.wanted * 0.7);
        this.spawnCop(g);
      }
      let nearest = 1e9;
      for (const cp of g.cops) nearest = Math.min(nearest, g.dist(cp.x, cp.y, P.x, P.y));
      if (nearest > 500) g.decayT += dt; else g.decayT = 0;
      if (g.decayT > 7) { g.wanted -= 1; g.decayT = 0; g.mission.msg = g.wanted > 0 ? `Wanted ★${g.wanted} — cooling off…` : 'You lost the cops.'; }
    } else if (g.cops.length) {
      g.cops.length = 0; // peace returns
    }

    /* ---- police AI ---- */
    for (let i = g.cops.length - 1; i >= 0; i -= 1) {
      const cp = g.cops[i];
      cp.flash += dt;
      const d = g.dist(cp.x, cp.y, P.x, P.y);
      const want = Math.atan2(P.y - cp.y, P.x - cp.x);
      let dA = want - cp.angle;
      while (dA > Math.PI) dA -= Math.PI * 2;
      while (dA < -Math.PI) dA += Math.PI * 2;
      cp.angle += g.clamp(dA, -2.6 * dt, 2.6 * dt);
      // chase hard in a car; creep close and stop to arrest on foot
      const target = (!P.inCar && d < 60) ? 26 : 150 + g.wanted * 22;
      cp.speed += (target - cp.speed) * 1.4 * dt;
      cp.x += Math.cos(cp.angle) * cp.speed * dt;
      cp.y += Math.sin(cp.angle) * cp.speed * dt;
      this.collideBuildings(g, cp, 20);

      if (P.inCar) {
        // ramming: both cars take damage
        if (d < 38) {
          P.hp -= 16 * dt * 3; cp.hp -= 26 * dt * 3;
          P.inCar.speed *= 0.86; cp.speed *= -0.4;
          if (g.frame % 12 === 0) { g.shake(4); g.burst((cp.x + P.x) / 2 - g.cam.x, (cp.y + P.y) / 2 - g.cam.y, 4, '#ffffff', 160); }
          if (cp.hp <= 0) {
            g.cops.splice(i, 1);
            this.crime(g, 1);
            g.addScore(60);
            g.burst(cp.x - g.cam.x, cp.y - g.cam.y, 26, '#ffffff', 380);
            g.shake(10); g.stop(60);
            g.mission.msg = 'Cop car destroyed — +★';
          }
        }
      } else {
        // on foot: cops close in and arrest
        if (d < 34) {
          cp.speed *= Math.max(0, 1 - 3 * dt); // the cruiser pulls up and stops
          P.arrestT += dt;
          if (P.arrestT > 0.7) { g.gameOver(`BUSTED at ★${g.wanted} — ${g.mission.done} missions done`); return; }
        } else P.arrestT = Math.max(0, P.arrestT - dt * 2);
      }
    }

    /* ---- missions ---- */
    const M = g.mission;
    if (M.phase === 'go') {
      if (g.dist(P.x, P.y, M.px, M.py) < 42) {
        let d = roadPoint(g, 200); let tries = 0;
        while (g.dist(d.x, d.y, P.x, P.y) < 700 && tries < 14) { d = roadPoint(g, 200); tries += 1; }
        M.dx = d.x; M.dy = d.y;
        M.timer = 30 + g.dist(P.x, P.y, d.x, d.y) / 26;
        M.phase = 'deliver'; M.msg = 'Package aboard — reach D before the clock';
        g.audio.chord([523, 659], 0.12, 'triangle', 0.1);
      }
    } else if (M.phase === 'deliver') {
      M.timer -= dt;
      if (g.dist(P.x, P.y, M.dx, M.dy) < 42) {
        M.done += 1;
        const reward = 100 + (M.done - 1) * 75;
        g.addScore(reward);
        g.audio.chord([523, 659, 784], 0.16, 'triangle', 0.12);
        g.burst(P.x - g.cam.x, P.y - g.cam.y, 22, '#ffffff', 300);
        M.msg = `Delivered! +$${reward}`;
        this.newMission(g);
      } else if (M.timer <= 0) {
        M.msg = 'MISSED — the buyer walked. New pickup marked.';
        g.audio.beep(160, 0.2, 'sawtooth', 0.1, -60);
        this.newMission(g);
      }
    }

    /* ---- death ---- */
    if (P.hp <= 0) { g.gameOver(`WASTED — ${g.mission.done} missions, ★${g.wanted}`); return; }
  },

  draw(g) {
    const c = g.ctx;
    const P = g.player;
    if (g.state === 'over') { g.drawGameOver(); return; }
    const cam = g.cam;

    c.save();
    c.translate(-cam.x, -cam.y);

    /* roads: dark strips + dashed lanes */
    c.fillStyle = '#151515';
    for (let x = 0; x * W.pitch <= W.w; x += 1) c.fillRect(x * W.pitch, 0, W.road, W.h);
    for (let y = 0; y * W.pitch <= W.h; y += 1) c.fillRect(0, y * W.pitch, W.w, W.road);
    c.strokeStyle = 'rgba(245,244,240,.18)';
    c.setLineDash([14, 18]);
    c.beginPath();
    for (let x = 0; x * W.pitch <= W.w; x += 1) { c.moveTo(x * W.pitch + W.road / 2, 0); c.lineTo(x * W.pitch + W.road / 2, W.h); }
    for (let y = 0; y * W.pitch <= W.h; y += 1) { c.moveTo(0, y * W.pitch + W.road / 2); c.lineTo(W.w, y * W.pitch + W.road / 2); }
    c.stroke();
    c.setLineDash([]);

    /* buildings */
    for (const b of g.buildings) {
      if (b.x + b.w < cam.x - 20 || b.x > cam.x + g.width + 20 || b.y + b.h < cam.y - 20 || b.y > cam.y + g.height + 20) continue;
      c.fillStyle = '#232323'; c.fillRect(b.x, b.y, b.w, b.h);
      c.strokeStyle = 'rgba(245,244,240,.35)'; c.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      c.fillStyle = 'rgba(245,244,240,.08)';
      for (let wx = b.x + 12; wx < b.x + b.w - 12; wx += 34) {
        for (let wy = b.y + 12; wy < b.y + b.h - 12; wy += 34) c.fillRect(wx, wy, 8, 8);
      }
    }

    /* mission markers */
    const M = g.mission;
    const pulse = 26 + Math.sin(g.time * 5) * 6;
    if (M.phase === 'go') {
      c.strokeStyle = '#ffffff'; c.lineWidth = 2;
      c.beginPath(); c.arc(M.px, M.py, pulse, 0, Math.PI * 2); c.stroke();
      g.text('P', M.px, M.py, 22, '#ffffff', 'center', 800);
    } else {
      c.strokeStyle = 'rgba(245,244,240,.9)'; c.lineWidth = 2;
      c.beginPath(); c.arc(M.dx, M.dy, pulse, 0, Math.PI * 2); c.stroke();
      g.text('D', M.dx, M.dy, 22, '#ffffff', 'center', 800);
    }
    c.lineWidth = 1;

    /* parked + cop + player cars */
    const drawCar = (car, body, light) => {
      c.save();
      c.translate(car.x, car.y);
      c.rotate(car.angle);
      c.fillStyle = body;
      c.fillRect(-car.w / 2, -car.h / 2, car.w, car.h);
      c.fillStyle = '#0b0b0b';
      c.fillRect(car.w / 2 - 12, -car.h / 2 + 4, 8, car.h - 8); // windshield
      if (light && g.frame % 24 < 12) { c.fillStyle = '#ffffff'; c.fillRect(-6, -car.h / 2 - 3, 12, 4); }
      c.restore();
    };
    for (const car of g.cars) {
      if (car === P.inCar) continue;
      if (car.x + 40 < cam.x || car.x - 40 > cam.x + g.width || car.y + 40 < cam.y || car.y - 40 > cam.y + g.height) continue;
      drawCar(car, 'rgba(245,244,240,.42)', false);
    }
    for (const cp of g.cops) drawCar(cp, '#f5f4f0', true);

    /* pedestrians */
    for (const pd of g.peds) {
      if (pd.x < cam.x - 10 || pd.x > cam.x + g.width + 10 || pd.y < cam.y - 10 || pd.y > cam.y + g.height + 10) continue;
      g.circle(pd.x, pd.y, 4.5, 'rgba(245,244,240,.8)');
    }

    /* player */
    if (P.inCar) drawCar(P.inCar, '#f5f4f0', false);
    else {
      g.circle(P.x, P.y, P.r, '#f5f4f0');
      c.strokeStyle = '#0b0b0b';
      c.beginPath(); c.moveTo(P.x, P.y);
      c.lineTo(P.x + Math.cos(P.face) * 13, P.y + Math.sin(P.face) * 13);
      c.stroke();
    }
    c.restore();

    /* ---------- HUD (screen space) ---------- */
    const stars = '\u2605'.repeat(g.wanted) + '\u2606'.repeat(5 - g.wanted);
    g.text(`WANTED ${stars}`, g.width / 2, 20, 15, g.wanted ? '#ffffff' : 'rgba(245,244,240,.4)', 'center', 800);
    for (let i = 0; i < 10; i += 1) {
      g.rect(16 + i * 13, g.height - 24, 10, 12, i * 10 < P.hp ? '#ffffff' : 'rgba(245,244,240,.16)');
    }
    g.text(`MISSIONS ${M.done}`, 16, g.height - 40, 12, 'rgba(245,244,240,.6)', 'left', 600);
    if (M.phase === 'deliver') g.text(`${Math.max(0, Math.ceil(M.timer))}s`, g.width / 2, g.height - 40, 16, '#ffffff', 'center', 800);
    if (M.msg) g.text(M.msg, g.width / 2, g.height - 62, 12, 'rgba(245,244,240,.75)', 'center', 500);
    if (!P.inCar) {
      let near = false;
      for (const car of g.cars) if (g.dist(car.x, car.y, P.x, P.y) < 52) near = true;
      if (near) g.text('X / E — steal this car', g.width / 2, g.height - 84, 12, 'rgba(245,244,240,.8)', 'center', 600);
    }
    if (P.arrestT > 0.1) g.text('GET AWAY OR YOU ARE BUSTED', g.width / 2, 46, 14, '#ffffff', 'center', 800);

    /* minimap */
    const mw = 150; const mh = 112; const mx = g.width - mw - 14; const my = g.height - mh - 14;
    const sx = mw / W.w; const sy = mh / W.h;
    c.fillStyle = 'rgba(0,0,0,.62)'; c.fillRect(mx, my, mw, mh);
    c.strokeStyle = 'rgba(245,244,240,.5)'; c.strokeRect(mx + 0.5, my + 0.5, mw - 1, mh - 1);
    c.fillStyle = 'rgba(245,244,240,.22)';
    for (const b of g.buildings) c.fillRect(mx + b.x * sx, my + b.y * sy, Math.max(1, b.w * sx), Math.max(1, b.h * sy));
    const dot = (x, y, col, r) => { c.fillStyle = col; c.beginPath(); c.arc(mx + x * sx, my + y * sy, r, 0, Math.PI * 2); c.fill(); };
    if (M.phase === 'go') dot(M.px, M.py, 'rgba(245,244,240,.9)', 3); else dot(M.dx, M.dy, 'rgba(245,244,240,.9)', 3);
    if (g.frame % 20 < 12) for (const cp of g.cops) dot(cp.x, cp.y, '#ffffff', 2.5);
    dot(P.x, P.y, '#ffffff', 3.5);
  }
});

if (typeof window !== 'undefined') window.__cityGame = g; // test hook
