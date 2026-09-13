/**
 * Screenshot harness (dev tool, not part of the game).
 * Boots the real game in jsdom, swaps the canvas for a real software raster
 * (@napi-rs/canvas) and saves PNGs so the rendering can be eyeballed without a
 * browser.
 *
 *   node tests/shot.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(here, 'shots');
mkdirSync(outDir, { recursive: true });

/* fonts so canvas text is not blank */
const fontDir = '/usr/share/fonts/truetype/dejavu';
for (const [file, family, weight] of [
  ['DejaVuSans.ttf', 'system-ui', 400],
  ['DejaVuSans-Bold.ttf', 'system-ui', 700],
  ['DejaVuSansMono-Bold.ttf', 'ui-monospace', 700],
]) {
  try {
    GlobalFonts.registerFromPath(join(fontDir, file), family);
  } catch {
    /* optional */
  }
}

const W = 1280;
const H = 800;

const html = readFileSync(join(root, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:8080/', runScripts: 'outside-only' });
const win = dom.window;

/* --- real raster behind the <canvas> element ---------------------------- */
const backings = new WeakMap();
win.HTMLCanvasElement.prototype.getContext = function (type) {
  let b = backings.get(this);
  if (!b) {
    b = { canvas: createCanvas(this.width || 300, this.height || 150), ctx: null };
    b.ctx = b.canvas.getContext('2d');
    backings.set(this, b);
  }
  return b.ctx;
};
function syncBacking(el) {
  const b = backings.get(el);
  if (!b) return null;
  if (b.canvas.width !== el.width || b.canvas.height !== el.height) {
    b.canvas.width = el.width;
    b.canvas.height = el.height;
  }
  return b.canvas;
}

/* --- deterministic frames ---------------------------------------------- */
const rafQueue = [];
win.requestAnimationFrame = (cb) => {
  rafQueue.push(cb);
  return rafQueue.length;
};
win.cancelAnimationFrame = () => {};
win.devicePixelRatio = 1;

for (const k of ['window', 'document', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLElement', 'KeyboardEvent', 'Event', 'MouseEvent']) {
  try {
    Object.defineProperty(globalThis, k, { value: win[k], configurable: true, writable: true });
  } catch {
    /* ignore */
  }
}

let clock = 0;
function frames(n, stepMs = 1000 / 60) {
  for (let i = 0; i < n; i++) {
    const cb = rafQueue.shift();
    if (!cb) throw new Error('raf queue empty');
    clock += stepMs;
    cb(clock);
  }
}

await import('../src/main.js');
const game = win.__game;
if (!game) throw new Error('game did not boot');

const canvasEl = win.document.getElementById('game');
canvasEl.getBoundingClientRect = () => ({ width: W, height: H, left: 0, top: 0, right: W, bottom: H, x: 0, y: 0 });
game.renderer.resize();

function shot(name) {
  const c = syncBacking(canvasEl);
  if (!c) throw new Error('no backing canvas');
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, c.toBuffer('image/png'));
  console.log('  → ' + file);
  return file;
}

/* ---------------------------------------------------------------- shots */

console.log('attract (menyu ortidagi demo)');
game.renderer.cam.scale = 0.4; // let the lerp start from somewhere sane
frames(150);
shot('01-attract');

console.log('o‘yin boshlanishi');
const { Match } = await import('../src/match.js');
game.match = new Match({
  seed: 20260913,
  humans: 1,
  bots: 5,
  difficulty: 'spicy',
  arenaRadius: 6,
  roundsToWin: 3,
  maxRounds: 7,
  humanNames: ['Siz'],
});
game.attract = null;
game.state = 'playing';
game.ui.buildChips(game.match.players, game.match.opts.roundsToWin);
game.ui.show('hud');
frames(45);
shot('02-countdown');

// a couple of seconds of play: cracks, dashes, first powerup
frames(60 * 6);
game.renderer.doFlash('#ffffff', 0.0);
shot('03-early');

// mid round: force some drama (cracked tiles + a powerup + a falling bot)
const arena = game.match.arena;
const bots = game.match.players.filter((p) => p.isBot && p.alive);
if (bots[0]) {
  const t = arena.tileAt(bots[0].x, bots[0].y);
  if (t) arena.forceCrack(t, 0.9);
  bots[0].dashT = 0.12;
  bots[0].hopT = 0.12;
}
if (bots[1]) {
  const t = arena.tileAt(bots[1].x, bots[1].y);
  if (t) arena.forceCrack(t, 0.35);
}
game.match.spawnPowerup();
game.match.spawnPowerup();
frames(20);
shot('04-mid');

// endgame: shrunken arena, someone falling
for (let i = 0; i < 3; i++) {
  if (arena.maxRing > 2) arena.collapseRing();
}
const victim = game.match.players.find((p) => p.isBot && p.alive);
if (victim) {
  const t = arena.tileAt(victim.x, victim.y);
  if (t) arena.forceCrack(t, 0.02);
  victim.falling = true;
  victim.fallT = 0.35;
}
const me = game.match.players.find((p) => !p.isBot);
if (me) {
  me.titanT = 4;
  me.dashT = 0.1;
  me.hopT = 0.1;
}
frames(14);
shot('05-endgame');

// close-up of the tile materials
console.log('material yaqin plan');
const zoom = game.renderer.cam;
zoom.scale = 1.5;
zoom.targetScale = 1.5;
frames(1);
shot('06-closeup');

console.log('\nTayyor. Rasmlar: tests/shots/');
