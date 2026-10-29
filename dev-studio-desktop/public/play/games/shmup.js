/** STARFALL — vertical shmup. Arrows/WASD move, Space/click fire, X bomb, P pause. */
const g = new GameKit({ title: 'STARFALL', width: 720, height: 720 });

g.start({
  init(g) {
    g.p = { x: g.width / 2, y: g.height - 80, w: 26, h: 26, cd: 0, hp: 3, inv: 0 };
    g.shots = []; g.foes = []; g.eshots = []; g.power = 1; g.bombs = 2;
    g.wave = 0; g.t = 0; g.state = 'play'; g.score = 0;
  },
  update(g, dt) {
    if (g.input.hit('KeyP', 'Escape')) g.togglePause();
    if (g.state === 'pause') return;
    if (g.state === 'over') { if (g.input.hit('Enter')) g.start(this); return; }
    g.t += dt;
    const P = g.p;
    const ax = g.input.axis();
    P.x = g.clamp(P.x + ax.x * 320 * dt, 16, g.width - 16);
    P.y = g.clamp(P.y + ax.y * 320 * dt, 40, g.height - 20);
    P.cd -= dt; P.inv = Math.max(0, P.inv - dt);

    if ((g.input.down('Space') || g.input.mouse.down) && P.cd <= 0) {
      P.cd = 0.14;
      const n = g.power;
      for (let i = 0; i < n; i += 1) {
        const off = (i - (n - 1) / 2) * 10;
        g.shots.push({ x: P.x + off, y: P.y - 16, vy: -620, vx: off * 1.6 });
      }
      g.audio.beep(980, 0.045, 'square', 0.06, -300);
    }
    if (g.input.hit('KeyX') && g.bombs > 0) {
      g.bombs -= 1;
      g.shake(16); g.stop(80);
      g.audio.noise(0.5, 0.32, 400);
      g.burst(P.x, P.y, 60, '#ffffff', 520);
      g.foes.forEach((f) => { g.addScore(f.hp * 5); g.burst(f.x, f.y, 10, '#ffffff', 260); });
      g.eshots = []; g.foes = [];
    }

    // spawn patterns
    g.wave += dt;
    if (Math.floor(g.t * 1.4) !== Math.floor((g.t - dt) * 1.4)) {
      const kind = g.randInt(0, 2);
      if (kind === 0) g.foes.push({ x: g.rand(40, g.width - 60), y: -30, w: 26, h: 26, hp: 2, vy: g.rand(90, 130) + g.wave * 2, vx: 0, shoot: g.rand(1, 2.4) });
      if (kind === 1) { const dir = g.pick([-1, 1]); g.foes.push({ x: dir < 0 ? -30 : g.width + 30, y: g.rand(60, 240), w: 26, h: 26, hp: 3, vy: 40, vx: dir * -1 * g.rand(110, 150), shoot: g.rand(0.8, 1.8) }); }
      if (kind === 2) g.foes.push({ x: g.rand(40, g.width - 60), y: -30, w: 40, h: 34, hp: 8, vy: 55, vx: 0, shoot: 0.9, big: true });
    }

    for (let i = g.shots.length - 1; i >= 0; i -= 1) {
      const s = g.shots[i];
      s.y += s.vy * dt; s.x += s.vx * dt;
      if (s.y < -20) { g.shots.splice(i, 1); continue; }
      for (let j = g.foes.length - 1; j >= 0; j -= 1) {
        const f = g.foes[j];
        if (g.aabb({ x: s.x - 3, y: s.y - 8, w: 6, h: 12 }, f)) {
          g.shots.splice(i, 1);
          f.hp -= 1;
          g.burst(s.x, s.y, 4, '#ffffff', 160);
          g.audio.beep(300, 0.04, 'square', 0.06);
          if (f.hp <= 0) {
            g.foes.splice(j, 1);
            g.addScore(f.big ? 120 : 30);
            g.burst(f.x + f.w / 2, f.y + f.h / 2, f.big ? 30 : 14, '#ffffff', 340);
            g.shake(f.big ? 9 : 4); g.stop(f.big ? 60 : 25);
            g.audio.noise(f.big ? 0.3 : 0.12, 0.2, f.big ? 500 : 1600);
            if (Math.random() < (f.big ? 0.6 : 0.08)) g.foes.push({ x: f.x, y: f.y, w: 16, h: 16, hp: 1, vy: 70, vx: 0, shoot: 99, drop: true });
          }
          break;
        }
      }
    }

    for (let i = g.foes.length - 1; i >= 0; i -= 1) {
      const f = g.foes[i];
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.shoot -= dt;
      if (f.shoot <= 0 && !f.drop && f.y > 0) {
        f.shoot = g.rand(1.2, 2.6);
        const a = Math.atan2(P.y - f.y, P.x - f.x);
        g.eshots.push({ x: f.x + f.w / 2, y: f.y + f.h, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200 });
        g.audio.beep(180, 0.05, 'sawtooth', 0.05);
      }
      if (f.drop) {
        if (g.aabb({ x: P.x - 13, y: P.y - 13, w: 26, h: 26 }, f)) {
          g.foes.splice(i, 1);
          if (g.power < 4) g.power += 1; else g.addScore(100);
          g.audio.chord([659, 830, 988], 0.14, 'triangle', 0.11);
          g.burst(f.x, f.y, 16, '#ffffff', 240);
        }
      } else if (P.inv <= 0 && g.aabb({ x: P.x - 11, y: P.y - 11, w: 22, h: 22 }, f)) {
        g.foes.splice(i, 1);
        P.hp -= 1; P.inv = 1.4;
        g.shake(13); g.stop(90);
        g.audio.noise(0.35, 0.3, 600);
        g.burst(P.x, P.y, 30, '#ffffff', 400);
        if (P.hp <= 0) g.gameOver(`survived ${Math.floor(g.wave)}s`);
      }
      if (f.y > g.height + 40 || f.x < -60 || f.x > g.width + 60) g.foes.splice(i, 1);
    }

    for (let i = g.eshots.length - 1; i >= 0; i -= 1) {
      const s = g.eshots[i];
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.y > g.height + 20 || s.y < -20 || s.x < -20 || s.x > g.width + 20) { g.eshots.splice(i, 1); continue; }
      if (P.inv <= 0 && g.dist(s.x, s.y, P.x, P.y) < 14) {
        g.eshots.splice(i, 1);
        P.hp -= 1; P.inv = 1.4;
        g.shake(11); g.stop(80);
        g.audio.noise(0.3, 0.26, 700);
        if (P.hp <= 0) g.gameOver(`survived ${Math.floor(g.wave)}s`);
      }
    }
  },
  draw(g) {
    if (g.state === 'over') { g.drawGameOver(); return; }
    const P = g.p;
    for (const s of g.shots) g.rect(s.x - 2, s.y - 10, 4, 12, '#ffffff');
    for (const s of g.eshots) g.circle(s.x, s.y, 5, 'rgba(245,244,240,.95)');
    for (const f of g.foes) {
      if (f.drop) { g.circle(f.x + 8, f.y + 8, 8, '#ffffff'); g.circle(f.x + 8, f.y + 8, 3, '#0b0b0b'); continue; }
      g.rect(f.x, f.y, f.w, f.h, 'rgba(245,244,240,.92)');
      g.rect(f.x + f.w * 0.25, f.y + f.h * 0.55, f.w * 0.5, 4, '#0b0b0b');
    }
    if (P.inv <= 0 || g.frame % 8 < 4) {
      g.ctx.save();
      g.ctx.translate(P.x, P.y);
      g.ctx.fillStyle = '#f5f4f0';
      g.ctx.beginPath();
      g.ctx.moveTo(0, -16); g.ctx.lineTo(13, 12); g.ctx.lineTo(0, 6); g.ctx.lineTo(-13, 12);
      g.ctx.closePath(); g.ctx.fill();
      if (g.frame % 4 < 2) { g.ctx.fillStyle = 'rgba(255,255,255,.7)'; g.ctx.fillRect(-2, 10, 4, 8); }
      g.ctx.restore();
    }
    for (let i = 0; i < 3; i += 1) g.rect(16 + i * 18, g.height - 24, 14, 14, i < P.hp ? '#ffffff' : 'rgba(245,244,240,.2)');
    g.text(`BOMBS ${'X'.repeat(g.bombs)}${'·'.repeat(2 - g.bombs)}`, g.width - 16, g.height - 18, 12, 'rgba(245,244,240,.7)', 'right', 700);
    g.text(`POWER ${g.power}`, 16, g.height - 44, 12, 'rgba(245,244,240,.7)', 'left', 700);
  }
});
