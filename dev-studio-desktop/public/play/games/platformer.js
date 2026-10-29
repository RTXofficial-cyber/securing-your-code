/** MONO JUMP — precision platformer. A/D move, Space/W jump (coyote time + buffer), R restart. */
const g = new GameKit({ title: 'MONO JUMP', width: 960, height: 540 });

const LEVELS = [
  '................................................................................',
  '................................................................................',
  '................................................................................',
  '.........................ooo....................................................',
  '........................#####......................................F............',
  '..............o..........................................#####..................',
  '.............###.......o..........................oo............................',
  '......................###.......................####..........###...............',
  '....o.....................................oo....................................',
  '...###...........####..................####..........##......#####..............',
  '................................................................................',
  'P....................................................###########################',
  '########################....#########....##########.............................',
  '################################################################################'
];

function build(g) {
  g.solids = []; g.coins = []; g.flag = null; g.spawn = { x: 40, y: 40 };
  LEVELS.forEach((row, ry) => {
    [...row].forEach((ch, rx) => {
      const x = rx * 24; const y = ry * 36;
      if (ch === '#') g.solids.push({ x, y, w: 24, h: 36 });
      if (ch === 'o') g.coins.push({ x: x + 6, y: y + 6, w: 12, h: 12, got: false });
      if (ch === 'F') g.flag = { x, y: y - 12, w: 24, h: 48 };
      if (ch === 'P') g.spawn = { x, y };
    });
  });
}

g.start({
  init(g) {
    build(g);
    g.p = { x: g.spawn.x, y: g.spawn.y, w: 20, h: 28, vx: 0, vy: 0, coyote: 0, buf: 0, face: 1, squash: 0, dead: false };
    g.cam = 0; g.deaths = 0; g.state = 'play'; g.score = 0;
    g.audio.beep(523, 0.08, 'triangle', 0.1);
  },
  update(g, dt) {
    if (g.input.hit('KeyP', 'Escape')) g.togglePause();
    if (g.state === 'pause') return;
    if (g.input.hit('KeyR')) { g.deaths += 1; g.start(this); return; }
    const P = g.p;
    const ax = g.input.axis().x;
    P.vx = g.lerp(P.vx, ax * 260, 0.35);
    if (ax) P.face = ax > 0 ? 1 : -1;

    if (g.input.hit('Space', 'KeyW', 'ArrowUp')) P.buf = 0.12;
    P.buf -= dt; P.coyote -= dt;

    P.vy = Math.min(P.vy + 1500 * dt, 760);
    // horizontal
    P.x += P.vx * dt;
    for (const s of g.solids) {
      if (g.aabb(P, s)) {
        if (P.vx > 0) P.x = s.x - P.w; else if (P.vx < 0) P.x = s.x + s.w;
        P.vx = 0;
      }
    }
    // vertical
    const wasAir = P.vy !== 0;
    P.y += P.vy * dt;
    let grounded = false;
    for (const s of g.solids) {
      if (g.aabb(P, s)) {
        if (P.vy > 0) { P.y = s.y - P.h; grounded = true; if (wasAir && P.vy > 380) { P.squash = 0.14; g.audio.beep(160, 0.06, 'square', 0.08); g.burst(P.x + 10, P.y + P.h, 6, 'rgba(245,244,240,.7)', 120); } }
        else if (P.vy < 0) P.y = s.y + s.h;
        P.vy = 0;
      }
    }
    if (grounded) P.coyote = 0.1;
    if (P.buf > 0 && P.coyote > 0) {
      P.vy = -560; P.buf = 0; P.coyote = 0; P.squash = -0.12;
      g.audio.beep(440, 0.09, 'square', 0.1, 260);
      g.burst(P.x + 10, P.y + P.h, 8, 'rgba(245,244,240,.8)', 150);
    }
    P.squash = g.lerp(P.squash, 0, 0.2);

    for (const c of g.coins) {
      if (!c.got && g.aabb(P, c)) {
        c.got = true; g.addScore(50);
        g.audio.chord([784, 988], 0.1, 'triangle', 0.1);
        g.burst(c.x + 6, c.y + 6, 12, '#ffffff', 220);
      }
    }
    if (g.flag && g.aabb(P, g.flag)) {
      g.addScore(500);
      g.audio.chord([523, 659, 784, 1046], 0.25, 'triangle', 0.12);
      g.gameOver('LEVEL CLEAR');
      g.state = 'win';
    }
    if (P.y > LEVELS.length * 36 + 120) {
      g.deaths += 1;
      g.audio.noise(0.3, 0.25, 600);
      g.start(this);
    }
    g.cam = g.lerp(g.cam, g.clamp(P.x - g.width / 2 + 10, 0, 60 * 24 - g.width), 0.12);
  },
  draw(g) {
    const c = g.ctx;
    c.save();
    c.translate(-Math.round(g.cam), 0);
    c.fillStyle = 'rgba(245,244,240,.92)';
    for (const s of g.solids) c.fillRect(s.x, s.y, s.w + 1, s.h + 1);
    for (const co of g.coins) {
      if (co.got) continue;
      const bob = Math.sin(g.time * 5 + co.x) * 3;
      g.circle(co.x + 6, co.y + 6 + bob, 6, '#ffffff');
      g.circle(co.x + 6, co.y + 6 + bob, 2.5, '#0b0b0b');
    }
    if (g.flag) {
      g.rect(g.flag.x + 2, g.flag.y, 4, g.flag.h, '#ffffff');
      const w = Math.sin(g.time * 6) * 3;
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.moveTo(g.flag.x + 6, g.flag.y);
      c.lineTo(g.flag.x + 30 + w, g.flag.y + 8);
      c.lineTo(g.flag.x + 6, g.flag.y + 16);
      c.fill();
    }
    const P = g.p;
    const sq = P.squash;
    c.save();
    c.translate(P.x + P.w / 2, P.y + P.h);
    c.scale(1 + sq, 1 - sq);
    c.fillStyle = '#f5f4f0';
    c.fillRect(-P.w / 2, -P.h, P.w, P.h);
    c.fillStyle = '#0b0b0b';
    c.fillRect(P.face > 0 ? 2 : -8, -P.h + 7, 6, 6);
    c.restore();
    c.restore();
    if (g.state === 'win') g.drawGameOver('every coin, zero regrets');
    g.text(`DEATHS ${g.deaths}`, 16, g.height - 20, 12, 'rgba(245,244,240,.6)', 'left', 600);
  }
});
