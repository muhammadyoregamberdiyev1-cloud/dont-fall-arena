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
ok(doc.getElementById('powerList').children.length === 5, 'powerup list rendered in the menu');

console.log('menu → match');
frames(30); // attract mode running behind the menu
click('optDiff'); // sanity: clicking the container does not explode
doc.querySelector('#optDiff button[data-v="spicy"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
doc.querySelector('#optBots button[data-v="2"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
// 1 raundlik match — test tez tugashi uchun
doc.querySelector('#optRounds button[data-v="1"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const nameInput = doc.getElementById('optName');
nameInput.value = 'Tester';
nameInput.dispatchEvent(new win.Event('input', { bubbles: true }));

click('btnStart');
ok(doc.getElementById('menu').classList.contains('hidden'), 'menu hidden after start');
ok(!doc.getElementById('hud').classList.contains('hidden'), 'hud shown after start');

console.log('gameplay frames');
frames(120);
key('keydown', 'KeyW');
key('keydown', 'KeyD');
frames(90);
key('keydown', 'Space');
frames(20);
key('keyup', 'Space');
key('keyup', 'KeyW');
key('keyup', 'KeyD');
frames(120);

const timerText = doc.getElementById('hudTimer').textContent;
ok(/^\d+:\d\d$/.test(timerText), `timer renders (${timerText})`);
ok(doc.getElementById('hudRound').textContent.startsWith('RAUND'), 'round label renders');
ok(doc.querySelectorAll('#hudScores .chip').length === 3, `score chips built (${doc.querySelectorAll('#hudScores .chip').length})`);
ok(doc.getElementById('hudAlive').textContent.includes('TIRIK'), 'alive counter renders');

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
  ok(doc.querySelectorAll('#reStandings .st-row').length === 3, 'standings listed');
}

console.log('run to match end');
let sawMatchEnd = false;
for (let i = 0; i < 400 && !sawMatchEnd; i++) {
  frames(60);
  if (!doc.getElementById('matchEnd').classList.contains('hidden')) sawMatchEnd = true;
}
ok(sawMatchEnd, 'match-end screen appeared');
if (sawMatchEnd) {
  ok(doc.querySelectorAll('#meStandings .st-row').length === 3, 'final standings listed');
  ok(doc.querySelectorAll('#meStats .stat').length === 6, 'stats rendered');
}

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
