/**
 * DOM smoke test: boots the real index.html in jsdom with stubbed canvas +
 * WebAudio, then plays a few hundred frames as a human and checks that the
 * UI reacts and nothing throws.
 *
 *   node tests/dom.mjs     (requires: npm i -D jsdom)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.error('jsdom o‘rnatilmagan: `npm i -D jsdom`');
  process.exit(1);
}

let failures = 0;
const ok = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  ✗ ' + msg);
  } else {
    console.log('  ✓ ' + msg);
  }
};

/* ------------------------------------------------------------ fake canvas */

function audioParam() {
  return {
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
    linearRampToValueAtTime() {},
    setTargetAtTime() {},
    cancelScheduledValues() {},
  };
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.state = 'running';
    this.destination = { connect: () => {} };
  }
  createGain() {
    return { gain: audioParam(), connect: (n) => n, disconnect() {} };
  }
  createOscillator() {
    return { type: 'sine', frequency: audioParam(), detune: audioParam(), connect: (n) => n, start() {}, stop() {} };
  }
  createBiquadFilter() {
    return { type: 'lowpass', frequency: audioParam(), Q: audioParam(), gain: audioParam(), connect: (n) => n };
  }
  createBuffer(ch, len) {
    return { length: len, getChannelData: () => new Float32Array(len) };
  }
  createBufferSource() {
    return { buffer: null, connect: (n) => n, start() {}, stop() {} };
  }
  resume() {}
  close() {}
}

function fakeCtx2d() {
  const grad = { addColorStop() {} };
  const noop = () => {};
  const store = {};
  return new Proxy(store, {
    get(t, prop) {
      if (prop in t) return t[prop];
      // memoise so the hot render loop stays cheap
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') {
        return (t[prop] = () => grad);
      }
      if (prop === 'measureText') return (t[prop] = () => ({ width: 40 }));
      if (prop === 'getImageData') return (t[prop] = () => ({ data: new Uint8ClampedArray(4) }));
      return (t[prop] = noop);
    },
    set(t, prop, v) {
      t[prop] = v;
      return true;
    },
  });
}

/* -------------------------------------------------------------- boot dom */

const html = readFileSync(join(root, 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  pretendToBeVisual: false,
  url: 'http://localhost:8080/',
  runScripts: 'outside-only',
});
const win = dom.window;

win.HTMLCanvasElement.prototype.getContext = function () {
  return fakeCtx2d();
};
win.AudioContext = FakeAudioContext;
win.devicePixelRatio = 1;
if (!win.localStorage) {
  // jsdom always ships one, but be safe
}

// deterministic animation frames
const rafQueue = [];
win.requestAnimationFrame = (cb) => {
  rafQueue.push(cb);
  return rafQueue.length;
};
win.cancelAnimationFrame = () => {};

// publish globals the modules expect
for (const k of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'HTMLElement',
  'KeyboardEvent',
  'Event',
  'MouseEvent',
  'getComputedStyle',
]) {
  if (!(k in win)) continue;
  try {
    Object.defineProperty(globalThis, k, { value: win[k], configurable: true, writable: true });
  } catch {
    /* node keeps some globals read-only (navigator) — not needed here */
  }
}

let clock = 0;
function frames(n, stepMs = 16.7) {
  for (let i = 0; i < n; i++) {
    const cb = rafQueue.shift();
    if (!cb) throw new Error('requestAnimationFrame queue empty — loop died');
    clock += stepMs;
    cb(clock);
  }
}

function key(type, code, opts = {}) {
  win.dispatchEvent(new win.KeyboardEvent(type, { code, key: code, bubbles: true, ...opts }));
}

function click(id) {
  const el = win.document.getElementById(id);
  if (!el) throw new Error('element missing: ' + id);
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
}

/* ------------------------------------------------------------------ tests */

console.log('DOM boot');
const main = await import('../src/main.js');
ok(!!main, 'main.js imported');

const doc = win.document;
ok(!doc.getElementById('menu').classList.contains('hidden'), 'menu visible at boot');

console.log('lobby');
const game = win.__game;
ok(doc.querySelector('#menuRoot .m-title')?.textContent === "DON'T FALL!", 'lobby title rendered');
ok(doc.querySelectorAll('#menuRoot .stat-pill').length === 5, 'stat pills rendered');
ok(!!doc.querySelector('#menuRoot .season'), 'season banner rendered');
ok(doc.querySelectorAll('#menuRoot .card').length === 7, 'card grid rendered');

console.log('online screen');
const clickEv = () => new win.MouseEvent('click', { bubbles: true });
doc.querySelector('[data-act="goto-online"]').dispatchEvent(clickEv());
ok(!!doc.querySelector('[data-act="net-connect"]'), 'online screen shows the connect button');
doc.querySelector('[data-act="net-connect"]').dispatchEvent(clickEv());
frames(3);
ok(!!doc.querySelector('#menuRoot .net-status'), 'net status pill rendered (no WebSocket in jsdom → graceful fail)');
doc.querySelector('[data-act="back"]').dispatchEvent(clickEv());
ok(!!doc.querySelector('[data-act="goto-online"]'), 'back returns home');

console.log('daily bonus claim');
const xpBefore = game.profile.data.xp;
doc.querySelector('[data-act="goto-daily"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
doc.querySelector('[data-act="claim-bonus"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok(game.profile.data.xp === xpBefore + 100, 'daily bonus grants +100 XP');
doc.querySelector('[data-act="back"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

console.log('language toggle');
doc.querySelector('[data-act="lang"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok(doc.querySelector('#menuRoot').innerHTML.includes('Everyone for themselves'), 'lobby flips to EN');
doc.querySelector('[data-act="lang"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok(doc.querySelector('#menuRoot').innerHTML.includes('Har kim o'), 'lobby flips back to UZ');

console.log('mode selector + offline map vote');
doc.querySelector('[data-act="mode:2v2"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok(doc.querySelector('#menuRoot .mode-desc').textContent.includes('A jamoa'), '2v2 shows team description');
doc.querySelector('[data-act="mode:solo"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
doc.querySelector('[data-act="play"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
frames(3);
ok(!!doc.querySelector('#voteOverlay:not(.hidden)'), 'map vote overlay appears before the match');
ok(doc.querySelectorAll('#voteOverlay .vote-card').length === 2, 'exactly two arena cards');
doc.querySelector('#voteOverlay [data-vote="color_grid"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
frames(2);
ok(doc.querySelector('#vc-color_grid').classList.contains('mine'), 'my vote is highlighted');
for (let i = 0; i < 60 * 11; i++) frames(1);
ok(doc.querySelector('#voteOverlay').classList.contains('hidden'), 'vote closes after the deadline');

console.log('menu → match');
frames(30);
doc.querySelector('[data-act="setup-bots"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok(!!doc.querySelector('[data-seg="seats"]'), 'setup screen shows mode segments');
doc.querySelector('[data-seg="difficulty"] button[data-v="spicy"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
doc.querySelector('[data-seg="seats"] button[data-v="4"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok(game.ui.opts.seats === 4 && game.ui.opts.difficulty === 'spicy', 'setup options applied');
doc.querySelector('[data-act="start"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
frames(3);
if (doc.querySelector('#voteOverlay:not(.hidden)')) {
  doc.querySelector('#voteOverlay [data-vote="chaos_core"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  frames(60 * 11);
}
ok(doc.getElementById('menu').classList.contains('hidden'), 'menu hidden after start');
ok(!doc.getElementById('hud').classList.contains('hidden'), 'hud shown after start');

console.log('gameplay frames');
frames(200); // countdown ~3s
const meP = () => game.match.players.find((p) => !p.isBot);
const before = { x: meP().x, y: meP().y };
key('keydown', 'KeyW');
key('keydown', 'KeyD');
frames(60);
const moved = Math.hypot(meP().x - before.x, meP().y - before.y);
ok(moved > 40, `human moves with WASD (Δ=${moved.toFixed(0)}px)`);
const cdBefore = meP().dashCd;
key('keydown', 'Space');
frames(4);
key('keyup', 'Space');
ok(meP().dashCd > cdBefore || meP().dashT > 0, 'dash fires on SPACE');
frames(60);

console.log('countdown + centre messages');
ok(doc.getElementById('hudMsg').querySelector('span').textContent.length > 0, 'centre message shown');

console.log('pause / resume');
key('keydown', 'Escape');
ok(!doc.getElementById('pause').classList.contains('hidden'), 'pause screen opens on ESC');
click('btnResume');
ok(doc.getElementById('pause').classList.contains('hidden'), 'resume hides pause');
frames(60);

console.log('mute');
key('keydown', 'KeyM');
ok(doc.getElementById('btnSound').textContent === '🔇', 'sound icon toggles off');
key('keydown', 'KeyM');
ok(doc.getElementById('btnSound').textContent === '🔊', 'sound icon toggles on');

console.log('long run to round end');
let sawRoundEnd = false;
for (let i = 0; i < 200 && !sawRoundEnd; i++) {
  frames(60);
  if (!doc.getElementById('roundEnd').classList.contains('hidden')) sawRoundEnd = true;
}
ok(sawRoundEnd, 'round-end screen appeared');
if (sawRoundEnd) {
  ok(doc.querySelectorAll('#reResults .res-row').length > 0, 'round results listed');
  ok(doc.querySelectorAll('#reStandings .st-row').length === 4, 'standings listed');
}

console.log('run to match end');
let sawMatchEnd = false;
for (let i = 0; i < 400 && !sawMatchEnd; i++) {
  frames(60);
  if (!doc.getElementById('matchEnd').classList.contains('hidden')) sawMatchEnd = true;
}
ok(sawMatchEnd, 'match-end screen appeared');
if (sawMatchEnd) {
  ok(doc.querySelectorAll('#meStandings .st-row').length === 4, 'final standings listed');
  ok(doc.querySelectorAll('#meStats .stat').length === 6, 'stats rendered');
}

console.log('profile recorded');
ok(game.profile.data.games >= 1, 'match recorded into profile');
ok(game.profile.data.xp > xpBefore, 'xp earned from the match');

console.log('rematch + back to menu');
click('btnRematch');
frames(60);
ok(doc.getElementById('matchEnd').classList.contains('hidden'), 'match end hidden after rematch');
ok(!doc.getElementById('hud').classList.contains('hidden'), 'hud back after rematch');
key('keydown', 'Escape');
click('btnQuit');
frames(30);
ok(!doc.getElementById('menu').classList.contains('hidden'), 'back to menu');

console.log(failures === 0 ? '\n✅ DOM testlari o‘tdi' : `\n❌ ${failures} ta xato`);
process.exit(failures === 0 ? 0 : 1);
