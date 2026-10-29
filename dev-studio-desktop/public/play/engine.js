/**
 * Dev Studio GameKit — a zero-dependency, browser-native game engine.
 *
 * Small on purpose: one file, no build step, no libraries. Big on feel:
 * fixed-timestep loop, keyboard/mouse/touch/gamepad input, AABB physics,
 * particles, screen shake, hit-stop, WebAudio synth SFX, parallax layers,
 * save games and a scene stack. This is what the built-in AI scaffolds when
 * you say "make a game" — and it is the same engine the /play demo runs on.
 *
 * Usage (see templates/):
 *   const g = new GameKit({ title: 'NEON RUN', width: 960, height: 540 });
 *   g.start({ init(g){}, update(g, dt){}, draw(g){} });
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  const aabb = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  /* ---------------- audio: tiny synth, no assets ---------------- */
  class Synth {
    constructor() { this.ctx = null; this.muted = false; }
    ensure() {
      if (!this.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    beep(freq = 440, dur = 0.08, type = 'square', vol = 0.16, slide = 0) {
      const ctx = this.ensure();
      if (!ctx || this.muted) return;
      const o = ctx.createOscillator();
      const gn = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ctx.currentTime + dur);
      gn.gain.setValueAtTime(vol, ctx.currentTime);
      gn.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(gn).connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + dur + 0.02);
    }
    noise(dur = 0.18, vol = 0.22, filterHz = 900) {
      const ctx = this.ensure();
      if (!ctx || this.muted) return;
      const n = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = filterHz;
      const gn = ctx.createGain(); gn.gain.value = vol;
      src.connect(f).connect(gn).connect(ctx.destination);
      src.start();
    }
    chord(freqs, dur = 0.22, type = 'triangle', vol = 0.12) {
      freqs.forEach((f, i) => setTimeout(() => this.beep(f, dur, type, vol), i * 55));
    }
  }

  /* ---------------- input ---------------- */
  class Input {
    constructor(canvas) {
      this.keys = new Set();
      this.pressed = new Set();
      this.mouse = { x: 0, y: 0, down: false, clicked: false };
      this.canvas = canvas;
      addEventListener('keydown', (e) => {
        if (!this.keys.has(e.code)) this.pressed.add(e.code);
        this.keys.add(e.code);
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      });
      addEventListener('keyup', (e) => this.keys.delete(e.code));
      const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        this.mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
        this.mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
      };
      canvas.addEventListener('mousemove', pos);
      canvas.addEventListener('mousedown', (e) => { pos(e); this.mouse.down = true; this.mouse.clicked = true; });
      addEventListener('mouseup', () => { this.mouse.down = false; });
      canvas.addEventListener('touchstart', (e) => {
        const t = e.touches[0]; pos(t); this.mouse.down = true; this.mouse.clicked = true; e.preventDefault();
      }, { passive: false });
      canvas.addEventListener('touchmove', (e) => { pos(e.touches[0]); e.preventDefault(); }, { passive: false });
      addEventListener('touchend', () => { this.mouse.down = false; });
    }
    down(...codes) { return codes.some((c) => this.keys.has(c)); }
    hit(...codes) { return codes.some((c) => this.pressed.has(c)); }
    axis() {
      let x = 0; let y = 0;
      if (this.down('ArrowLeft', 'KeyA')) x -= 1;
      if (this.down('ArrowRight', 'KeyD')) x += 1;
      if (this.down('ArrowUp', 'KeyW')) y -= 1;
      if (this.down('ArrowDown', 'KeyS')) y += 1;
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) {
        if (!p) continue;
        if (Math.abs(p.axes[0]) > 0.25) x += p.axes[0];
        if (Math.abs(p.axes[1]) > 0.25) y += p.axes[1];
        if (p.buttons[0]?.pressed) this.pressed.add('GamepadA');
        if (p.buttons[14]?.pressed) x -= 1;
        if (p.buttons[15]?.pressed) x += 1;
      }
      return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
    }
    endFrame() { this.pressed.clear(); this.mouse.clicked = false; }
  }

  /* ---------------- the kit ---------------- */
  class GameKit {
    constructor(opts = {}) {
      this.title = opts.title || 'DEV STUDIO GAME';
      this.width = opts.width || 960;
      this.height = opts.height || 540;
      this.canvas = opts.canvas || document.getElementById('game') || (() => {
        const c = document.createElement('canvas');
        document.body.appendChild(c);
        return c;
      })();
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      this.ctx = this.canvas.getContext('2d');
      this.input = new Input(this.canvas);
      this.audio = new Synth();
      this.particles = [];
      this.shakeMag = 0;
      this.hitStop = 0;
      this.time = 0;
      this.frame = 0;
      this.state = 'play';
      this.scene = null;
      this.score = 0;
      this.bg = opts.bg || '#0b0b0b';
      this.fg = opts.fg || '#f5f4f0';
      this.accent = opts.accent || '#ffffff';
      this.stars = Array.from({ length: 70 }, () => ({
        x: rand(this.width), y: rand(this.height), z: rand(0.25, 1), r: rand(0.6, 2.2)
      }));
      this.best = this.load('best', 0);
      this.titleCard = opts.titleCard || null; // { tagline, controls[] }
      this.state = this.titleCard ? 'title' : 'play';
    }

    /* helpers -------------------------------------------------- */
    clamp(v, a, b) { return clamp(v, a, b); }
    lerp(a, b, t) { return lerp(a, b, t); }
    rand(a, b) { return rand(a, b); }
    randInt(a, b) { return randInt(a, b); }
    pick(arr) { return pick(arr); }
    dist(x1, y1, x2, y2) { return dist(x1, y1, x2, y2); }
    aabb(a, b) { return aabb(a, b); }
    glow(x, y, r, col) {
      const c = this.ctx;
      c.globalAlpha = 0.22; c.fillStyle = col || this.accent;
      c.beginPath(); c.arc(x, y, r * 2.4, 0, TAU); c.fill();
      c.globalAlpha = 1; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    }
    rrect(x, y, w, h, r, col) {
      const c = this.ctx;
      c.fillStyle = col || this.fg;
      c.beginPath();
      if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
      c.fill();
    }
    rect(x, y, w, h, col) { this.ctx.fillStyle = col || this.fg; this.ctx.fillRect(x, y, w, h); }
    circle(x, y, r, col) { this.ctx.fillStyle = col || this.fg; this.ctx.beginPath(); this.ctx.arc(x, y, r, 0, TAU); this.ctx.fill(); }
    text(str, x, y, size = 18, col, align = 'left', weight = 700) {
      const c = this.ctx;
      c.fillStyle = col || this.fg;
      c.font = `${weight} ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      c.textAlign = align; c.textBaseline = 'middle';
      c.fillText(str, x, y);
    }
    shake(mag = 6) { this.shakeMag = Math.max(this.shakeMag, mag); }
    stop(ms = 60) { this.hitStop = Math.max(this.hitStop, ms); }
    burst(x, y, n = 14, col, speed = 260) {
      for (let i = 0; i < n; i += 1) {
        const a = rand(TAU);
        const s = rand(speed * 0.3, speed);
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.7), t: 0, col: col || this.accent, r: rand(1.5, 4) });
      }
    }
    save(key, val) { try { localStorage.setItem(`ds:${this.title}:${key}`, JSON.stringify(val)); } catch {} }
    load(key, fallback) { try { const v = localStorage.getItem(`ds:${this.title}:${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } }
    addScore(n) {
      this.score += n;
      if (this.score > this.best) { this.best = this.score; this.save('best', this.best); }
    }

    /* scenes --------------------------------------------------- */
    start(scene) {
      this.scene = scene;
      scene.init ? scene.init(this) : null;
      this._last = performance.now();
      this._acc = 0;
      const step = 1 / 60;
      const loop = (now) => {
        requestAnimationFrame(loop);
        let dt = (now - this._last) / 1000;
        this._last = now;
        if (dt > 0.25) dt = 0.25;
        if (this.hitStop > 0) { this.hitStop -= dt * 1000; dt = 0; }
        this._acc += dt;
        while (this._acc >= step) {
          this.time += step;
          this.frame += 1;
          if (this.state === 'title') {
            if (this.input.pressed.size > 0 || this.input.mouse.clicked) {
              this.state = 'play';
              this.audio.chord([392, 523, 659], 0.14, 'triangle', 0.12);
              this.burst(this.width / 2, this.height / 2, 24, this.accent, 300);
            }
          } else if (this.scene && this.scene.update) this.scene.update(this, step);
          this._updateParticles(step);
          this.shakeMag = lerp(this.shakeMag, 0, 0.18);
          this.input.endFrame();
          this._acc -= step;
        }
        this._draw();
      };
      requestAnimationFrame(loop);
      return this;
    }

    _updateParticles(dt) {
      for (let i = this.particles.length - 1; i >= 0; i -= 1) {
        const p = this.particles[i];
        p.t += dt;
        if (p.t >= p.life) { this.particles.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.92; p.vy = p.vy * 0.92 + 240 * dt;
      }
    }

    _draw() {
      const c = this.ctx;
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = this.bg;
      c.fillRect(0, 0, this.width, this.height);
      if (this.shakeMag > 0.4) {
        c.translate(rand(-this.shakeMag, this.shakeMag), rand(-this.shakeMag, this.shakeMag));
      }
      // parallax starfield (cheap depth, always on)
      for (const s of this.stars) {
        const y = (s.y + this.time * 18 * s.z) % this.height;
        c.globalAlpha = 0.16 + s.z * 0.3;
        c.fillStyle = this.fg;
        c.fillRect(s.x, y, s.r, s.r);
      }
      c.globalAlpha = 1;
      if (this.scene && this.scene.draw) this.scene.draw(this);
      for (const p of this.particles) {
        const a = 1 - p.t / p.life;
        c.globalAlpha = a * 0.25;              // glow halo
        c.fillStyle = p.col;
        c.beginPath(); c.arc(p.x, p.y, p.r * 2.6, 0, TAU); c.fill();
        c.globalAlpha = a;                     // hot core
        c.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
      }
      c.globalAlpha = 1;
      c.restore();
      // vignette: cheap depth, keeps the eye centre-stage
      const vg = c.createRadialGradient(this.width / 2, this.height / 2, this.height * 0.35, this.width / 2, this.height / 2, this.height * 0.95);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.42)');
      c.fillStyle = vg;
      c.fillRect(0, 0, this.width, this.height);
      // HUD
      this.text(this.title, 16, 20, 14, this.fg, 'left', 800);
      this.text(`SCORE ${this.score}`, this.width - 16, 20, 14, this.fg, 'right', 800);
      this.text(`BEST ${this.best}`, this.width - 16, 40, 11, 'rgba(245,244,240,.55)', 'right', 600);
      if (this.audio.muted) this.text('MUTED (M)', 16, 40, 11, 'rgba(245,244,240,.55)', 'left', 600);
      if (this.input.hit('KeyM')) this.audio.muted = !this.audio.muted;
      if (this.state === 'title' && this.titleCard) {
        c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(0, 0, this.width, this.height);
        this.text(this.title, this.width / 2, this.height / 2 - 58, 52, this.fg, 'center', 800);
        this.text(this.titleCard.tagline || '', this.width / 2, this.height / 2 - 18, 15, 'rgba(245,244,240,.75)', 'center', 500);
        (this.titleCard.controls || []).forEach((line, i) => {
          this.text(line, this.width / 2, this.height / 2 + 16 + i * 20, 13, 'rgba(245,244,240,.6)', 'center', 500);
        });
        if (this.frame % 70 < 45) this.text('PRESS ANY KEY', this.width / 2, this.height / 2 + 96, 14, this.accent, 'center', 800);
        this.text(`BEST ${this.best}`, this.width / 2, this.height / 2 + 128, 11, 'rgba(245,244,240,.5)', 'center', 600);
      }
      if (this.state === 'pause') {
        c.fillStyle = 'rgba(0,0,0,.62)'; c.fillRect(0, 0, this.width, this.height);
        this.text('PAUSED', this.width / 2, this.height / 2 - 10, 40, this.fg, 'center', 800);
        this.text('P or Esc to resume', this.width / 2, this.height / 2 + 26, 14, 'rgba(245,244,240,.7)', 'center', 500);
      }
    }

    togglePause() {
      this.state = this.state === 'pause' ? 'play' : 'pause';
      this.audio.beep(this.state === 'pause' ? 220 : 440, 0.07, 'square', 0.1);
    }
    gameOver(reason) {
      this.state = 'over';
      this.shake(14);
      this.audio.noise(0.4, 0.3, 500);
      this.audio.chord([196, 147, 98], 0.3, 'sawtooth', 0.1);
      this.save('best', this.best);
      this._overReason = reason || '';
    }
    drawGameOver(sub) {
      const c = this.ctx;
      c.fillStyle = 'rgba(0,0,0,.7)'; c.fillRect(0, 0, this.width, this.height);
      this.text('GAME OVER', this.width / 2, this.height / 2 - 34, 46, this.fg, 'center', 800);
      this.text(sub || this._overReason || '', this.width / 2, this.height / 2 + 4, 16, 'rgba(245,244,240,.8)', 'center', 500);
      this.text(`SCORE ${this.score}   ·   BEST ${this.best}`, this.width / 2, this.height / 2 + 34, 18, this.accent, 'center', 800);
      if (this.frame % 60 < 40) this.text('press ENTER to play again', this.width / 2, this.height / 2 + 72, 13, 'rgba(245,244,240,.7)', 'center', 500);
    }
  }

  GameKit.Synth = Synth; // expose for tests/templates that want raw audio
  global.GameKit = GameKit;
  global.GameKitUtils = { clamp, lerp, rand, randInt, pick, dist, aabb, TAU };
})(typeof window !== 'undefined' ? window : globalThis);
