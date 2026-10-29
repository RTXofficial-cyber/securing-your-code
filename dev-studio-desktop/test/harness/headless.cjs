/**
 * Headless game runner.
 *
 * Loads the GameKit engine + a game source into a VM sandbox with a stubbed
 * canvas / DOM / audio, pumps N fixed frames and feeds simulated input
 * (keys, clicks). If ANY runtime error exists — typo, undefined variable,
 * NaN physics — this throws, so "the game doesn't run" can never ship.
 */
const vm = require('vm');

function makeCtx() {
  const grad = { addColorStop() {} };
  const base = {
    fillStyle: '', strokeStyle: '', globalAlpha: 1, font: '', textAlign: '', textBaseline: '',
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setTransform() {},
    fillRect() {}, clearRect() {}, strokeRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, rect() {}, roundRect() {},
    fill() {}, stroke() {},
    fillText() {}, strokeText() {},
    measureText: () => ({ width: 10 }),
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    drawImage() {}, putImageData() {}, getImageData: () => ({ data: [] })
  };
  return new Proxy(base, {
    get: (t, k) => (k in t ? t[k] : () => {}),
    set: (t, k, v) => { t[k] = v; return true; }
  });
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runGame({ engineSrc, gameSrc, frames = 600, extraSrcs = [], fuzz = null }) {
  const listeners = {};
  const rafQ = [];
  let now = 0;
  const ctx = makeCtx();
  const canvas = {
    width: 960,
    height: 540,
    getContext: () => ctx,
    addEventListener: (t, f) => { (listeners['canvas:' + t] = listeners['canvas:' + t] || []).push(f); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 })
  };
  const store = new Map();
  const sandbox = {
    console,
    Math, JSON, Date, Object, Array, String, Number, Boolean, isFinite, isNaN, parseInt, parseFloat,
    performance: { now: () => now },
    requestAnimationFrame: (cb) => { rafQ.push(cb); return rafQ.length; },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    navigator: { getGamepads: () => [] },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    document: {
      getElementById: () => canvas,
      createElement: () => canvas,
      body: { appendChild() {} }
    },
    setTimeout: () => 0,
    setInterval: () => 0,
    clearInterval() {},
    clearTimeout() {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(engineSrc, sandbox, { filename: 'engine.js' });
  extraSrcs.forEach((src, i) => vm.runInContext(src, sandbox, { filename: `extra${i}.js` }));
  vm.runInContext(gameSrc, sandbox, { filename: 'game.js' });

  const fire = (type, ev) => (listeners[type] || []).forEach((f) => f(ev));
  const FUZZ_CODES = ['Space', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'ShiftLeft', 'ShiftRight', 'KeyX', 'KeyE', 'KeyQ', 'KeyP', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyM'];
  if (fuzz !== null) {
    // seeded chaos: random key/mouse storms — robustness testing, AAA style
    const rnd = mulberry32(fuzz);
    const held = new Set();
    for (let i = 0; i < frames; i += 1) {
      now += 8 + rnd() * 30; // jittered frame times too
      if (rnd() < 0.25) {
        const code = FUZZ_CODES[Math.floor(rnd() * FUZZ_CODES.length)];
        if (held.has(code)) { held.delete(code); fire('keyup', { code }); }
        else { held.add(code); fire('keydown', { code, preventDefault() {} }); }
      }
      if (rnd() < 0.08) fire('canvas:mousedown', { clientX: Math.floor(rnd() * 960), clientY: Math.floor(rnd() * 540), preventDefault() {} });
      if (rnd() < 0.08) fire('canvas:touchstart', { touches: [{ clientX: Math.floor(rnd() * 960), clientY: Math.floor(rnd() * 540) }], preventDefault() {} });
      if (rnd() < 0.06) fire('canvas:touchend', {});
      if (rnd() < 0.1) fire('mouseup', {});
      const q = rafQ.splice(0, rafQ.length);
      q.forEach((cb) => cb(now));
    }
    return sandbox;
  }
  const codes = ['Space', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'ShiftLeft', 'KeyX', 'Enter', 'ArrowUp'];
  for (let i = 0; i < frames; i += 1) {
    now += 16.6;
    if (i === 2) fire('keydown', { code: 'Enter', preventDefault() {} });   // leave title screen
    if (i % 37 === 0) fire('keydown', { code: codes[Math.floor(i / 37) % codes.length], preventDefault() {} });
    if (i % 37 === 5) fire('keyup', { code: codes[Math.floor(i / 37) % codes.length] });
    if (i % 53 === 0) fire('canvas:mousedown', { clientX: 100 + (i % 300), clientY: 120, preventDefault() {} });
    if (i % 53 === 10) fire('mouseup', {});
    const q = rafQ.splice(0, rafQ.length);
    q.forEach((cb) => cb(now));
  }
  return sandbox;
}

module.exports = { runGame, makeCtx };
