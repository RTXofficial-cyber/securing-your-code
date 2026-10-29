/** VOID ARENA — twin-stick survival. WASD move, mouse aim, click/space shoot, Shift dash. */
const g = new GameKit({ title: 'VOID ARENA', width: 960, height: 540, accent: '#ffffff' });

g.start({
  init(g) {
    g.player = { x: g.width / 2, y: g.height / 2, w: 26, h: 26, hp: 5, cd: 0, dash: 0, dx: 0, dy: 0, inv: 0 };
    g.bullets = []; g.foes = []; g.orbs = [];
    g.wave = 0; g.spawnT = 0; g.state = 'play'; g.score = 0;
  },
  spawn(g) {
    const side = g.randInt(0, 3);
    const p = { w: 24, h: 24, hp: 2, spd: g.rand(60, 95) + g.wave * 4 };
    if (side === 0) { p.x = g.rand(g.width); p.y = -30; }
    if (side === 1) { p.x = g.rand(g.width); p.y = g.height + 30; }
    if (side === 2) { p.x = -30; p.y = g.rand(g.height); }
    if (side === 3) { p.x = g.width + 30; p.y = g.rand(g.height); }
    g.foes.push(p);
  },
  update(g, dt) {
    if (g.input.hit('KeyP', 'Escape')) g.togglePause();
    if (g.state === 'pause') return;
    if (g.state === 'over') { if (g.input.hit('Enter')) g.start(this); return; }

    const P = g.player;
    const ax = g.input.axis();
    let mx = g.input.mouse.x; let my = g.input.mouse.y;
    const aim = Math.atan2(my - P.y, mx - P.x);

    if (P.dash > 0) { P.dash -= dt; P.x += P.dx * 640 * dt; P.y += P.dy * 640 * dt; }
    else { P.x += ax.x * 240 * dt; P.y += ax.y * 240 * dt; }
    if (g.input.hit('ShiftLeft', 'ShiftRight') && P.dash <= 0) {
      P.dash = 0.16; P.inv = 0.3;
      const m = Math.hypot(ax.x, ax.y) || 1;
      P.dx = ax.x / m; P.dy = ax.y / m;
      g.audio.beep(700, 0.07, 'sawtooth', 0.1, -300);
      g.burst(P.x, P.y, 8, '#ffffff', 160);
    }
    P.x = g.clamp(P.x, 13, g.width - 13); P.y = g.clamp(P.y, 13, g.height - 13);
    P.inv = Math.max(0, P.inv - dt); P.cd -= dt;

    const firing = g.input.mouse.down || g.input.down('Space');
    if (firing && P.cd <= 0) {
      P.cd = 0.13;
      g.bullets.push({ x: P.x + Math.cos(aim) * 16, y: P.y + Math.sin(aim) * 16, vx: Math.cos(aim) * 560, vy: Math.sin(aim) * 560, life: 1.4 });
      g.audio.beep(880, 0.05, 'square', 0.07, -220);
      g.shake(1.5);
    }

    g.wave += dt * 0.12;
    g.spawnT -= dt;
    if (g.spawnT <= 0) { g.spawnT = Math.max(0.35, 1.5 - g.wave * 0.1); this.spawn(g); }

    for (let i = g.bullets.length - 1; i >= 0; i -= 1) {
      const b = g.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.x > g.width + 20 || b.y < -20 || b.y > g.height + 20) g.bullets.splice(i, 1);
    }

    for (let i = g.foes.length - 1; i >= 0; i -= 1) {
      const f = g.foes[i];
      const a = Math.atan2(P.y - f.y, P.x - f.x);
      f.x += Math.cos(a) * f.spd * dt; f.y += Math.sin(a) * f.spd * dt;
      for (let j = g.bullets.length - 1; j >= 0; j -= 1) {
        const b = g.bullets[j];
        if (g.aabb({ x: b.x - 3, y: b.y - 3, w: 6, h: 6 }, f)) {
          g.bullets.splice(j, 1);
          f.hp -= 1;
          g.burst(b.x, b.y, 6, '#ffffff', 200);
          g.audio.beep(320, 0.05, 'square', 0.08);
          if (f.hp <= 0) {
            g.foes.splice(i, 1);
            g.addScore(10);
            g.burst(f.x + 12, f.y + 12, 18, '#ffffff', 320);
            g.shake(5); g.stop(40);
            g.audio.noise(0.14, 0.18, 1400);
            if (Math.random() < 0.18) g.orbs.push({ x: f.x, y: f.y, t: 0 });
          }
          break;
        }
      }
      if (P.inv <= 0 && g.aabb({ x: P.x - 13, y: P.y - 13, w: 26, h: 26 }, f)) {
        P.hp -= 1; P.inv = 1;
        g.shake(12); g.stop(90);
        g.audio.noise(0.3, 0.28, 700);
        g.burst(P.x, P.y, 26, '#ffffff', 380);
        g.foes.splice(i, 1);
        if (P.hp <= 0) { g.gameOver(`wave ${Math.floor(g.wave) + 1}`); }
      }
    }

    for (let i = g.orbs.length - 1; i >= 0; i -= 1) {
      const o = g.orbs[i];
      o.t += dt;
      const d = g.dist(o.x, o.y, P.x, P.y);
      if (d < 90) { o.x += (P.x - o.x) * 4 * dt; o.y += (P.y - o.y) * 4 * dt; }
      if (d < 18) {
        g.orbs.splice(i, 1);
        if (P.hp < 5) P.hp += 1; else g.addScore(25);
        g.audio.chord([523, 659, 784], 0.12, 'triangle', 0.1);
      }
      if (o.t > 12) g.orbs.splice(i, 1);
    }
  },
  draw(g) {
    const P = g.player;
    if (g.state === 'over') { g.drawGameOver(); return; }
    for (const o of g.orbs) { g.circle(o.x + 6, o.y + 6, 5 + Math.sin(g.time * 8) * 1.5, 'rgba(255,255,255,.85)'); }
    for (const b of g.bullets) g.rect(b.x - 3, b.y - 3, 6, 6, '#ffffff');
    for (const f of g.foes) {
      g.ctx.save();
      g.ctx.translate(f.x + 12, f.y + 12);
      g.ctx.rotate(Math.atan2(P.y - f.y, P.x - f.x));
      g.rect(-12, -12, 24, 24, 'rgba(245,244,240,.9)');
      g.rect(4, -4, 10, 8, '#0b0b0b');
      g.ctx.restore();
    }
    if (P.inv <= 0 || g.frame % 8 < 4) {
      const aim = Math.atan2(g.input.mouse.y - P.y, g.input.mouse.x - P.x);
      g.ctx.save();
      g.ctx.translate(P.x, P.y);
      g.ctx.rotate(aim);
      g.rect(-13, -13, 26, 26, '#f5f4f0');
      g.rect(8, -3, 14, 6, '#0b0b0b');
      g.ctx.restore();
    }
    for (let i = 0; i < 5; i += 1) {
      g.rect(16 + i * 16, g.height - 22, 12, 12, i < P.hp ? '#ffffff' : 'rgba(245,244,240,.2)');
    }
    g.text(`WAVE ${Math.floor(g.wave) + 1}`, g.width / 2, 20, 14, 'rgba(245,244,240,.7)', 'center', 700);
  }
});
