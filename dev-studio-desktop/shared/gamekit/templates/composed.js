/**
 * COMPOSED — one runtime, every game.
 *
 * The plugin injects `GAME_SPEC` (control scheme, enemy behaviours, weapon,
 * goal, modifiers, theme) parsed from YOUR request, so "zombie survival with
 * dash" and "flappy pipe runner" are genuinely different games: different
 * physics, different enemy AI, different win condition — not a reskin.
 */
const SPEC = (typeof GAME_SPEC !== 'undefined' && GAME_SPEC) || {
  control: 'topdown', enemies: ['chaser'], weapon: 'bullet', goal: 'waves',
  modifiers: ['dash'], theme: 'mono', title: 'VOID ARENA'
};

const THEMES = {
  mono: { bg: '#0b0b0b', fg: '#f5f4f0', accent: '#ffffff' },
  neon: { bg: '#05060a', fg: '#e8fbff', accent: '#7df9ff' },
  paper: { bg: '#f4f1ea', fg: '#1c1b18', accent: '#1c1b18' },
  crt: { bg: '#001200', fg: '#b8ffcf', accent: '#5cff8f' }
};
const TH = THEMES[SPEC.theme] || THEMES.mono;

const CTRL_HINT = {
  platform: ['A/D move · Space jump', 'P pause · M mute'],
  runner: ['Space jump · S slide', 'P pause · M mute'],
  flap: ['Space / click to flap', 'P pause · M mute'],
  topdown: ['WASD move · mouse aim · click fire', 'Shift dash · P pause · M mute'],
  space: ['WASD move · Space fire', 'X bomb · P pause · M mute']
};

const g = new GameKit({
  title: SPEC.title,
  width: SPEC.control === 'space' ? 720 : 960,
  height: SPEC.control === 'space' ? 720 : 540,
  bg: TH.bg, fg: TH.fg, accent: TH.accent,
  titleCard: {
    tagline: `${SPEC.control} · ${SPEC.enemies.join('+') || 'calm'} · goal: ${SPEC.goal}`,
    controls: CTRL_HINT[SPEC.control] || []
  }
});

const HAS = (m) => SPEC.modifiers.includes(m);
const GROUND_OFFSET = 70;

g.start({
  init(g) {
    g.ground = g.height - GROUND_OFFSET;
    g.p = {
      x: SPEC.control === 'runner' || SPEC.control === 'flap' ? 150 : g.width / 2,
      y: SPEC.control === 'platform' || SPEC.control === 'runner' ? g.ground - 40 : g.height / 2,
      w: 24, h: 40, vx: 0, vy: 0, jumps: 0, cd: 0, dash: 0, dx: 0, dy: 0,
      hp: HAS('shield') ? 4 : 3, inv: 0, slide: 0, face: 1
    };
    g.foes = []; g.bullets = []; g.eshots = []; g.picks = []; g.gems = []; g.obs = [];
    g.t = 0; g.spawnT = 1.2; g.speed = (SPEC.control === 'runner' ? 330 : SPEC.control === 'flap' ? 210 : 0);
    g.got = 0; g.need = SPEC.goal === 'collect' ? 12 : 0;
    g.levelLen = 5200; g.flag = null;
    g.power = 1; g.bombs = HAS('bomb') ? 2 : 0;
    g.state = 'title'; g.score = 0;
    if (SPEC.goal === 'reach') g.flag = { x: g.levelLen, y: g.ground - 60, w: 24, h: 60 };
  },

  fire(g, aim) {
    const P = g.p;
    const n = g.power;
    for (let i = 0; i < n; i += 1) {
      const off = (i - (n - 1) / 2) * 0.12;
      if (SPEC.control === 'space') {
        g.bullets.push({ x: P.x + off * 60, y: P.y - 16, vx: off * 160, vy: -620 });
      } else {
        g.bullets.push({ x: P.x + Math.cos(aim + off) * 16, y: P.y + Math.sin(aim + off) * 16, vx: Math.cos(aim + off) * 560, vy: Math.sin(aim + off) * 560 });
      }
    }
    g.audio.beep(880, 0.05, 'square', 0.07, -260);
    g.shake(1.5);
  },

  spawn(g) {
    const kind = g.pick(SPEC.enemies);
    if (kind === 'pipes') {
      const gap = g.rand(150, 200);
      const gy = g.rand(90, g.height - gap - 90);
      g.obs.push({ x: g.width + 60, y: 0, w: 46, h: gy, pipe: true });
      g.obs.push({ x: g.width + 60, y: gy + gap, w: 46, h: g.height - gy - gap, pipe: true });
      if (Math.random() < 0.6) g.gems.push({ x: g.width + 83, y: gy + gap / 2, w: 12, h: 12 });
      return;
    }
    if (kind === 'walker') { g.foes.push({ x: g.flag ? g.rand(600, g.levelLen) : g.rand(g.width), y: g.ground - 26, w: 24, h: 26, hp: 2, kind, dir: g.pick([-1, 1]), spd: g.rand(60, 110) }); return; }
    if (kind === 'dropper') { g.foes.push({ x: g.rand(30, g.width - 30), y: -30, w: 22, h: 22, hp: 1, kind, vy: g.rand(140, 240) }); return; }
    if (kind === 'shooter') {
      const side = g.randInt(0, 3);
      const f = { w: 26, h: 26, hp: 3, kind, shoot: g.rand(0.8, 1.6), spd: 40 };
      if (side === 0) { f.x = g.rand(g.width); f.y = -30; }
      if (side === 1) { f.x = g.rand(g.width); f.y = g.height + 30; }
      if (side === 2) { f.x = -30; f.y = g.rand(g.height); }
      if (side === 3) { f.x = g.width + 30; f.y = g.rand(g.height); }
      g.foes.push(f);
      return;
    }
    // chaser (default)
    const side = g.randInt(0, 3);
    const f = { w: 24, h: 24, hp: 2, kind: 'chaser', spd: g.rand(65, 105) + Math.min(80, g.t * 2) };
    if (side === 0) { f.x = g.rand(g.width); f.y = -30; }
    if (side === 1) { f.x = g.rand(g.width); f.y = g.height + 30; }
    if (side === 2) { f.x = -30; f.y = g.rand(g.height); }
    if (side === 3) { f.x = g.width + 30; f.y = g.rand(g.height); }
    g.foes.push(f);
  },

  hurt(g, dmg) {
    const P = g.p;
    if (P.inv > 0) return;
    P.hp -= dmg; P.inv = 1.1;
    g.shake(12); g.stop(90);
    g.audio.noise(0.3, 0.28, 700);
    g.burst(P.x + P.w / 2, P.y + P.h / 2, 26, TH.accent, 380);
    if (P.hp <= 0) g.gameOver(`${Math.floor(g.score)} pts`);
  },

  update(g, dt) {
    if (g.input.hit('KeyP', 'Escape')) g.togglePause();
    if (g.state === 'pause' || g.state === 'title') return;
    if (g.state === 'over') { if (g.input.hit('Enter')) g.start(this); return; }
    g.t += dt;
    const P = g.p;
    const ax = g.input.axis();
    P.inv = Math.max(0, P.inv - dt);
    P.cd -= dt;

    /* ------- movement per control scheme ------- */
    if (SPEC.control === 'platform' || SPEC.control === 'runner') {
      if (SPEC.control === 'platform') P.vx = g.lerp(P.vx, ax.x * 260, 0.35);
      else P.vx = 0;
      if (g.input.hit('Space', 'KeyW', 'ArrowUp', 'GamepadA')) {
        const maxJ = HAS('double-jump') ? 2 : 1;
        if (P.jumps < maxJ) {
          P.vy = -620; P.jumps += 1;
          g.audio.beep(P.jumps === 1 ? 420 : 560, 0.08, 'square', 0.1, 200);
          g.burst(P.x + P.w / 2, P.y + P.h, 8, TH.fg, 140);
        }
      }
      if (SPEC.control === 'runner' && g.input.down('KeyS', 'ArrowDown') && P.y + P.h >= g.ground - 1) P.slide = 0.35;
      P.slide = Math.max(0, P.slide - dt);
      P.h = P.slide > 0 ? 22 : 40;
      P.vy = Math.min(P.vy + 1650 * dt, 800);
      P.x += P.vx * dt;
      P.y += P.vy * dt;
      if (P.y + P.h >= g.ground) { P.y = g.ground - P.h; P.vy = 0; P.jumps = 0; }
      P.x = g.clamp(P.x, 8, (g.flag ? g.levelLen : g.width) - P.w - 8);
      if (SPEC.control === 'runner') g.speed = 330 + g.t * 9;
    } else if (SPEC.control === 'flap') {
      if (g.input.hit('Space', 'KeyW', 'ArrowUp', 'GamepadA') || g.input.mouse.clicked) {
        P.vy = -380;
        g.audio.beep(500, 0.06, 'triangle', 0.09, 160);
        g.burst(P.x + P.w / 2, P.y + P.h, 5, TH.fg, 110);
      }
      P.vy = Math.min(P.vy + 1250 * dt, 700);
      P.y += P.vy * dt;
      if (P.y + P.h >= g.ground) { P.y = g.ground - P.h; P.vy = 0; }
      if (P.y < 0) { P.y = 0; P.vy = 0; }
      g.speed = 210 + g.t * 4;
      g.score = Math.floor(g.t * 10);
    } else if (SPEC.control === 'topdown') {
      if (P.dash > 0) { P.dash -= dt; P.x += P.dx * 640 * dt; P.y += P.dy * 640 * dt; }
      else { P.x += ax.x * 250 * dt; P.y += ax.y * 250 * dt; }
      if (HAS('dash') && g.input.hit('ShiftLeft', 'ShiftRight') && P.dash <= 0) {
        P.dash = 0.16; P.inv = Math.max(P.inv, 0.3);
        const m = Math.hypot(ax.x, ax.y) || 1;
        P.dx = ax.x / m; P.dy = ax.y / m;
        g.audio.beep(700, 0.07, 'sawtooth', 0.1, -300);
        g.burst(P.x + 12, P.y + 12, 8, TH.accent, 160);
      }
      P.x = g.clamp(P.x, 12, g.width - P.w - 12);
      P.y = g.clamp(P.y, 12, g.height - P.h - 12);
      if (SPEC.weapon === 'bullet' && (g.input.mouse.down || g.input.down('Space')) && P.cd <= 0) {
        P.cd = HAS('rapid') ? 0.08 : 0.13;
        this.fire(g, Math.atan2(g.input.mouse.y - (P.y + 12), g.input.mouse.x - (P.x + 12)));
      }
    } else { // space
      P.x = g.clamp(P.x + ax.x * 320 * dt, 16, g.width - 16);
      P.y = g.clamp(P.y + ax.y * 320 * dt, 40, g.height - 20);
      if (SPEC.weapon === 'bullet' && (g.input.down('Space') || g.input.mouse.down) && P.cd <= 0) {
        P.cd = HAS('rapid') ? 0.08 : 0.14;
        this.fire(g, -Math.PI / 2);
      }
      if (HAS('bomb') && g.input.hit('KeyX') && g.bombs > 0) {
        g.bombs -= 1;
        g.shake(16); g.stop(80);
        g.audio.noise(0.5, 0.32, 400);
        g.burst(P.x, P.y, 60, TH.accent, 520);
        g.foes.forEach((f) => { g.addScore(15); g.burst(f.x + f.w / 2, f.y + f.h / 2, 10, TH.accent, 260); });
        g.foes = []; g.eshots = [];
      }
    }

    /* ------- spawning ------- */
    g.spawnT -= dt;
    if (g.spawnT <= 0 && SPEC.enemies.join() !== 'none') {
      g.spawnT = SPEC.control === 'runner' || SPEC.control === 'flap'
        ? g.rand(0.7, 1.3)
        : Math.max(0.35, 1.5 - g.t * 0.03);
      this.spawn(g);
    }
    if (SPEC.goal === 'collect' && g.gems.length < 4 && Math.random() < 0.02) {
      g.gems.push({ x: g.rand(40, g.width - 60), y: g.rand(60, g.height - 100), w: 12, h: 12 });
    }

    /* ------- bullets ------- */
    for (let i = g.bullets.length - 1; i >= 0; i -= 1) {
      const b = g.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < -30 || b.x > g.width + 30 || b.y < -30 || b.y > g.height + 30) { g.bullets.splice(i, 1); continue; }
      for (let j = g.foes.length - 1; j >= 0; j -= 1) {
        const f = g.foes[j];
        if (g.aabb({ x: b.x - 3, y: b.y - 3, w: 6, h: 6 }, f)) {
          g.bullets.splice(i, 1);
          f.hp -= 1;
          g.burst(b.x, b.y, 5, TH.accent, 180);
          g.audio.beep(320, 0.04, 'square', 0.07);
          if (f.hp <= 0) {
            g.foes.splice(j, 1);
            g.addScore(20);
            g.burst(f.x + f.w / 2, f.y + f.h / 2, 16, TH.accent, 320);
            g.shake(5); g.stop(35);
            g.audio.noise(0.13, 0.18, 1500);
            if (Math.random() < 0.16) g.picks.push({ x: f.x, y: f.y, w: 14, h: 14, kind: Math.random() < 0.5 ? 'heal' : 'power', t: 0 });
          }
          break;
        }
      }
    }

    /* ------- foes ------- */
    for (let i = g.foes.length - 1; i >= 0; i -= 1) {
      const f = g.foes[i];
      if (f.kind === 'chaser' || f.kind === 'shooter') {
        const a = Math.atan2(P.y - f.y, P.x - f.x);
        const spd = f.kind === 'shooter' ? f.spd : f.spd;
        f.x += Math.cos(a) * spd * dt;
        f.y += Math.sin(a) * spd * dt;
        if (f.kind === 'shooter') {
          f.shoot -= dt;
          if (f.shoot <= 0 && f.y > 0 && f.y < g.height) {
            f.shoot = g.rand(1.2, 2.4);
            g.eshots.push({ x: f.x + f.w / 2, y: f.y + f.h / 2, vx: Math.cos(a) * 210, vy: Math.sin(a) * 210 });
            g.audio.beep(180, 0.05, 'sawtooth', 0.05);
          }
        }
      } else if (f.kind === 'dropper') {
        f.y += f.vy * dt;
        if (f.y > g.height + 40) { g.foes.splice(i, 1); continue; }
      } else if (f.kind === 'walker') {
        f.x += f.dir * f.spd * dt;
        if (f.x < 40 || f.x > (g.flag ? g.levelLen - 40 : g.width - 40)) f.dir *= -1;
      }
      if (g.aabb({ x: P.x + 3, y: P.y + 2, w: P.w - 6, h: P.h - 4 }, f)) {
        if (SPEC.control === 'runner' || SPEC.control === 'flap' || SPEC.control === 'platform') {
          g.foes.splice(i, 1);
          this.hurt(g, 1);
        } else {
          g.foes.splice(i, 1);
          g.burst(f.x + f.w / 2, f.y + f.h / 2, 14, TH.accent, 300);
          this.hurt(g, 1);
        }
      }
    }

    /* ------- pipes / obstacles (scrolling controls) ------- */
    if (g.speed > 0) {
      for (let i = g.obs.length - 1; i >= 0; i -= 1) {
        const o = g.obs[i];
        o.x -= g.speed * dt;
        if (o.x + o.w < -30) { g.obs.splice(i, 1); g.addScore(5); continue; }
        if (g.aabb({ x: P.x + 3, y: P.y + 2, w: P.w - 6, h: P.h - 4 }, o)) {
          g.gameOver(`${Math.floor(g.score)} pts`);
        }
      }
      for (let i = g.gems.length - 1; i >= 0; i -= 1) {
        const c = g.gems[i];
        c.x -= g.speed * dt;
        if (c.x < -20) { g.gems.splice(i, 1); continue; }
        if (g.aabb(P, c)) {
          g.gems.splice(i, 1);
          g.got += 1; g.addScore(25);
          g.audio.beep(1046, 0.06, 'triangle', 0.1);
          g.burst(c.x + 6, c.y + 6, 8, TH.accent, 180);
          if (SPEC.goal === 'collect' && g.got >= g.need) g.gameOver('ALL COLLECTED');
        }
      }
    } else {
      for (let i = g.gems.length - 1; i >= 0; i -= 1) {
        const c = g.gems[i];
        if (HAS('magnet')) {
          const d = g.dist(c.x, c.y, P.x, P.y);
          if (d < 140) { c.x += (P.x - c.x) * 3 * dt; c.y += (P.y - c.y) * 3 * dt; }
        }
        if (g.aabb(P, c)) {
          g.gems.splice(i, 1);
          g.got += 1; g.addScore(25);
          g.audio.beep(1046, 0.06, 'triangle', 0.1);
          g.burst(c.x + 6, c.y + 6, 8, TH.accent, 180);
          if (SPEC.goal === 'collect' && g.got >= g.need) g.gameOver('ALL COLLECTED');
        }
      }
    }

    /* ------- enemy shots ------- */
    for (let i = g.eshots.length - 1; i >= 0; i -= 1) {
      const s = g.eshots[i];
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.x < -20 || s.x > g.width + 20 || s.y < -20 || s.y > g.height + 20) { g.eshots.splice(i, 1); continue; }
      if (g.dist(s.x, s.y, P.x + P.w / 2, P.y + P.h / 2) < 15) {
        g.eshots.splice(i, 1);
        this.hurt(g, 1);
      }
    }

    /* ------- pickups ------- */
    for (let i = g.picks.length - 1; i >= 0; i -= 1) {
      const o = g.picks[i];
      o.t += dt;
      if (HAS('magnet')) {
        const d = g.dist(o.x, o.y, P.x, P.y);
        if (d < 160) { o.x += (P.x - o.x) * 3 * dt; o.y += (P.y - o.y) * 3 * dt; }
      }
      if (g.aabb(P, o)) {
        g.picks.splice(i, 1);
        if (o.kind === 'heal') { P.hp = Math.min(HAS('shield') ? 4 : 3, P.hp + 1); g.audio.chord([523, 659], 0.12, 'triangle', 0.1); }
        else { g.power = Math.min(4, g.power + 1); g.audio.chord([659, 830, 988], 0.14, 'triangle', 0.1); }
        g.burst(o.x + 7, o.y + 7, 14, TH.accent, 240);
      }
      if (o.t > 12) g.picks.splice(i, 1);
    }

    /* ------- reach-the-flag goal ------- */
    if (g.flag && SPEC.control === 'platform') {
      g.cam = g.lerp(g.cam || 0, g.clamp(P.x - g.width / 2 + 10, 0, g.levelLen - g.width + 200), 0.12);
      P.x += 0; // camera handles view
      if (P.x > g.levelLen - 40) { g.addScore(500); g.gameOver('REACHED THE FLAG'); g.state = 'win'; }
      if (P.y > g.height + 200) { this.hurt(g, 99); }
    }
    if (SPEC.goal === 'waves' || SPEC.control === 'runner' || SPEC.control === 'flap') {
      const tp = Math.floor(g.t * 10);
      if (tp > (g.timePts || 0)) { g.addScore(tp - (g.timePts || 0)); g.timePts = tp; }
    }
  },

  draw(g) {
    const c = g.ctx;
    const P = g.p;
    if (g.state === 'over' || g.state === 'win') { g.drawGameOver(); return; }
    const cam = g.cam || 0;
    c.save();
    c.translate(-Math.round(cam), 0);

    // goal flag
    if (g.flag) {
      g.rect(g.flag.x + 4, g.flag.y, 5, g.flag.h, TH.fg);
      c.fillStyle = TH.fg;
      c.beginPath();
      c.moveTo(g.flag.x + 9, g.flag.y);
      c.lineTo(g.flag.x + 40 + Math.sin(g.time * 6) * 3, g.flag.y + 10);
      c.lineTo(g.flag.x + 9, g.flag.y + 20);
      c.fill();
    }
    // ground line for side-scrollers
    if (SPEC.control === 'platform' || SPEC.control === 'runner' || SPEC.control === 'flap') {
      g.rect(cam, g.ground, g.width, 3, TH.fg);
    }
    // obstacles / pipes
    for (const o of g.obs) {
      g.rrect(o.x, o.y, o.w, o.h, 6, TH.fg);
      g.rect(o.x + 5, o.y + (o.pipe ? o.h - 8 : 4), o.w - 10, 4, TH.bg);
    }
    // gems
    for (const co of g.gems) {
      c.save();
      c.translate(co.x + 6, co.y + 6);
      c.rotate(g.time * 4);
      g.glow(0, 0, 6, TH.accent);
      c.restore();
    }
    // pickups
    for (const o of g.picks) {
      const pulse = 6 + Math.sin(g.time * 8) * 1.5;
      g.glow(o.x + 7, o.y + 7, pulse, TH.accent);
      g.text(o.kind === 'heal' ? '+' : 'P', o.x + 7, o.y + 8, 10, TH.bg, 'center', 800);
    }
    // bullets
    for (const b of g.bullets) g.rect(b.x - 2, b.y - 8, 4, 12, TH.accent);
    for (const s of g.eshots) g.glow(s.x, s.y, 5, TH.fg);
    // foes
    for (const f of g.foes) {
      if (f.kind === 'walker') {
        g.rrect(f.x, f.y, f.w, f.h, 5, TH.fg);
        g.rect(f.x + (f.dir > 0 ? f.w - 9 : 3), f.y + 6, 6, 6, TH.bg);
      } else if (f.kind === 'dropper') {
        c.save(); c.translate(f.x + f.w / 2, f.y + f.h / 2); c.rotate(g.time * 6);
        g.rect(-f.w / 2, -f.h / 2, f.w, f.h, TH.fg);
        c.restore();
      } else {
        g.rrect(f.x, f.y, f.w, f.h, 6, TH.fg);
        g.rect(f.x + 5, f.y + f.h * 0.55, f.w - 10, 4, TH.bg);
        if (f.kind === 'shooter') g.rect(f.x + f.w / 2 - 2, f.y + f.h, 4, 8, TH.fg);
      }
    }
    // player
    if (P.inv <= 0 || g.frame % 8 < 4) {
      c.save();
      c.translate(P.x + P.w / 2, P.y + P.h);
      if (SPEC.control === 'space') {
        c.translate(0, P.h / 2);
        c.fillStyle = TH.fg;
        c.beginPath();
        c.moveTo(0, -P.h); c.lineTo(13, -4); c.lineTo(0, -10); c.lineTo(-13, -4);
        c.closePath(); c.fill();
        if (g.frame % 4 < 2) { c.fillStyle = TH.accent; c.fillRect(-2, -4, 4, 8); }
      } else if (SPEC.control === 'flap') {
        c.fillStyle = TH.fg;
        c.beginPath(); c.arc(0, -P.h / 2, 12, 0, Math.PI * 2); c.fill();
        const wing = Math.sin(g.time * 20) * 8;
        c.fillRect(-20, -P.h / 2 - 3 + wing * 0.3, 14, 6);
        c.fillStyle = TH.bg; c.fillRect(3, -P.h / 2 - 4, 5, 5);
      } else {
        const sq = P.vy !== 0 ? -0.08 : 0;
        c.scale(1 + sq, 1 - sq);
        g.rrect(-P.w / 2, -P.h, P.w, P.h, 6, TH.fg);
        c.fillStyle = TH.bg;
        c.fillRect(P.vx >= 0 ? 2 : -9, -P.h + 7, 7, 7);
      }
      if (HAS('shield') && P.hp > 3) { c.strokeStyle = TH.accent; c.globalAlpha = 0.5; c.beginPath(); c.arc(0, -P.h / 2, 24, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1; }
      c.restore();
    }
    c.restore();

    // HUD extras
    const maxHp = HAS('shield') ? 4 : 3;
    for (let i = 0; i < maxHp; i += 1) {
      g.rrect(16 + i * 18, g.height - 24, 14, 14, 3, i < P.hp ? TH.fg : 'rgba(128,128,128,.25)');
    }
    if (SPEC.goal === 'collect') g.text(`${g.got}/${g.need}`, g.width / 2, 22, 15, TH.fg, 'center', 800);
    if (SPEC.goal === 'reach' && g.flag) g.text(`FLAG ${Math.max(0, Math.round((g.flag.x - P.x) / 10))}m`, g.width / 2, 22, 13, TH.fg, 'center', 700);
    if (HAS('bomb')) g.text(`BOMBS ${g.bombs}`, g.width - 16, g.height - 18, 12, TH.fg, 'right', 700);
    if (g.power > 1) g.text(`POWER ${g.power}`, 16, g.height - 44, 12, TH.fg, 'left', 700);
  }
});
