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

function runGame({ engineSrc, gameSrc, frames = 600 }) {
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
  vm.runInContext(gameSrc, sandbox, { filename: 'game.js' });

  const fire = (type, ev) => (listeners[type] || []).forEach((f) => f(ev));
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
