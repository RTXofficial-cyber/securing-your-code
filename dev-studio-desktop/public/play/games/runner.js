/** LINE RUNNER — endless runner. Space/W jump (double jump), S slide, speed ramps forever. */
const g = new GameKit({ title: 'LINE RUNNER', width: 960, height: 420 });

g.start({
  init(g) {
    g.ground = g.height - 70;
    g.p = { x: 150, y: g.ground - 40, w: 26, h: 40, vy: 0, jumps: 0, slide: 0, dead: false };
    g.obs = []; g.gems = []; g.t = 0; g.speed = 330; g.next = 1.1; g.state = 'play'; g.score = 0;
    g.audio.chord([392, 523], 0.12, 'triangle', 0.1);
  },
  update(g, dt) {
    if (g.input.hit('KeyP', 'Escape')) g.togglePause();
    if (g.state === 'pause') return;
    if (g.state === 'over') { if (g.input.hit('Enter')) g.start(this); return; }
    g.t += dt;
    g.speed = 330 + g.t * 9;
    g.score = Math.floor(g.t * 10);
    if (g.score > g.best) { g.best = g.score; g.save('best', g.best); }

    const P = g.p;
    const jumping = g.input.hit('Space', 'KeyW', 'ArrowUp', 'GamepadA');
    if (jumping && P.jumps < 2) {
      P.vy = P.jumps === 0 ? -620 : -540;
      P.jumps += 1;
      g.audio.beep(P.jumps === 1 ? 420 : 560, 0.08, 'square', 0.1, 200);
      g.burst(P.x + 13, P.y + P.h, 8, 'rgba(245,244,240,.8)', 140);
    }
    const wantSlide = g.input.down('KeyS', 'ArrowDown');
    if (wantSlide && P.y >= g.ground - P.h - 1) P.slide = 0.35;
    P.slide = Math.max(0, P.slide - dt);
    P.h = P.slide > 0 ? 22 : 40;

    P.vy += 1650 * dt;
    P.y += P.vy * dt;
    if (P.y + P.h >= g.ground) {
      if (P.vy > 420) { g.burst(P.x + 13, g.ground, 7, 'rgba(245,244,240,.7)', 130); g.audio.beep(150, 0.05, 'square', 0.07); }
      P.y = g.ground - P.h; P.vy = 0; P.jumps = 0;
    }

    g.next -= dt;
    if (g.next <= 0) {
      g.next = g.rand(0.62, 1.25) - Math.min(0.25, g.t * 0.004);
      const kind = g.randInt(0, 2);
      if (kind === 0) g.obs.push({ x: g.width + 40, y: g.ground - 42, w: 22, h: 42, type: 'block' });
      if (kind === 1) g.obs.push({ x: g.width + 40, y: g.ground - 96, w: 60, h: 16, type: 'bar' });
      if (kind === 2) { g.obs.push({ x: g.width + 40, y: g.ground - 34, w: 18, h: 34, type: 'block' }); g.obs.push({ x: g.width + 78, y: g.ground - 34, w: 18, h: 34, type: 'block' }); }
      if (Math.random() < 0.5) {
        const gy = g.ground - g.rand(70, 150);
        for (let i = 0; i < 3; i += 1) g.gems.push({ x: g.width + 60 + i * 34, y: gy, w: 12, h: 12 });
      }
    }

    for (let i = g.obs.length - 1; i >= 0; i -= 1) {
      const o = g.obs[i];
      o.x -= g.speed * dt;
      if (o.x + o.w < -20) { g.obs.splice(i, 1); continue; }
      if (g.aabb({ x: P.x + 3, y: P.y + 2, w: P.w - 6, h: P.h - 4 }, o)) {
        g.state = 'over';
        g.shake(16); g.stop(120);
        g.audio.noise(0.45, 0.32, 500);
        g.burst(P.x + 13, P.y + 20, 40, '#ffffff', 420);
        g.gameOver(`${Math.floor(g.t * 10)} metres`);
      }
    }
    for (let i = g.gems.length - 1; i >= 0; i -= 1) {
      const c = g.gems[i];
      c.x -= g.speed * dt;
      if (c.x < -20) { g.gems.splice(i, 1); continue; }
      if (g.aabb(P, c)) {
        g.gems.splice(i, 1);
        g.score += 25;
        g.audio.beep(1046, 0.06, 'triangle', 0.1);
        g.burst(c.x + 6, c.y + 6, 8, '#ffffff', 180);
      }
    }
  },
  draw(g) {
    if (g.state === 'over') { g.drawGameOver(); return; }
    g.rect(0, g.ground, g.width, 3, 'rgba(245,244,240,.9)');
    for (let i = 0; i < 24; i += 1) {
      const x = (i * 90 - (g.t * g.speed * 0.4) % 90) % (g.width + 90);
      g.rect(x, g.ground + 14, 34, 2, 'rgba(245,244,240,.18)');
    }
    for (const o of g.obs) {
      g.rect(o.x, o.y, o.w, o.h, '#f5f4f0');
      g.rect(o.x + 3, o.y + 3, o.w - 6, 4, '#0b0b0b');
    }
    for (const c of g.gems) {
      g.ctx.save();
      g.ctx.translate(c.x + 6, c.y + 6);
      g.ctx.rotate(g.time * 4);
      g.rect(-6, -6, 12, 12, '#ffffff');
      g.ctx.restore();
    }
    const P = g.p;
    g.ctx.save();
    g.ctx.translate(P.x + P.w / 2, P.y + P.h);
    const lean = g.clamp(P.vy / 1400, -0.16, 0.16);
    g.ctx.rotate(lean);
    g.rect(-P.w / 2, -P.h, P.w, P.h, '#f5f4f0');
    g.rect(2, -P.h + 6, 7, 7, '#0b0b0b');
    const stride = P.y + P.h >= g.ground - 1 ? Math.sin(g.time * 16) * 4 : 0;
    g.rect(-P.w / 2 + 2, -2 - Math.max(0, stride), 8, 3, '#f5f4f0');
    g.rect(P.w / 2 - 10, -2 - Math.max(0, -stride), 8, 3, '#f5f4f0');
    g.ctx.restore();
    g.text(`${Math.floor(g.t * 10)}m   ·   ${Math.round(g.speed)} km/h`, g.width / 2, 22, 14, 'rgba(245,244,240,.75)', 'center', 700);
  }
});
