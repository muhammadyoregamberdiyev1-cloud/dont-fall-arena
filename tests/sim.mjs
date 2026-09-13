/**
 * Headless smoke test: plays whole matches with bots only and checks the
 * simulation stays sane (no NaN, rounds terminate, somebody wins).
 *
 *   node tests/sim.mjs
 */

import { Match, ROUND_STATE } from '../src/match.js';
import { Arena } from '../src/arena.js';
import { grantPowerup } from '../src/player.js';
import { makeRng } from '../src/rng.js';
import { TILE } from '../src/config.js';
import { hexDistance, pixelToAxial, axialToPixel, hexRing, hexSpiral } from '../src/hex.js';

let failures = 0;
const ok = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  ✗ ' + msg);
  }
};

/* ---------------------------------------------------------- hex grid maths */
console.log('hex maths');
{
  ok(hexSpiral(0).length === 1, 'spiral(0) has 1 cell');
  ok(hexSpiral(2).length === 19, 'spiral(2) has 19 cells');
  ok(hexRing(3).length === 18, 'ring(3) has 18 cells');
  ok(hexDistance(2, -1, 0, 0) === 2, 'distance (2,-1)->(0,0) == 2');
  for (const size of [10, 46, 90]) {
    for (const { q, r } of hexSpiral(4)) {
      const p = axialToPixel(q, r, size);
      const back = pixelToAxial(p.x + 0.001, p.y - 0.001, size);
      ok(back.q === q && back.r === r, `round-trip q=${q} r=${r} size=${size}`);
    }
  }
  // the centre of a hex must map back to itself
  const c = axialToPixel(3, -2, 46);
  const cb = pixelToAxial(c.x, c.y, 46);
  ok(cb.q === 3 && cb.r === -2, 'exact centre round-trip');
}

/* ------------------------------------------------------------- full matches */
console.log('matches');
const difficulties = ['chill', 'normal', 'spicy', 'nightmare'];
let totalRounds = 0;
let totalFalls = 0;
let matchWinners = 0;

for (let m = 0; m < 6; m++) {
  const match = new Match({
    seed: 1234 + m * 977,
    humans: 0,
    bots: 4 + (m % 3),
    difficulty: difficulties[m % difficulties.length],
    roundsToWin: 3,
    maxRounds: 6,
  });

  let guard = 0;
  let sawPlaying = false;
  const dt = 1 / 60;
  while (match.state !== ROUND_STATE.MATCH_END && guard++ < 60 * 60 * 12) {
    match.update(dt, new Map());
    if (match.state === ROUND_STATE.PLAYING) sawPlaying = true;

    for (const p of match.players) {
      ok(Number.isFinite(p.x) && Number.isFinite(p.y), `p${p.id} position finite (round ${match.round})`);
      ok(Number.isFinite(p.vx) && Number.isFinite(p.vy), `p${p.id} velocity finite (round ${match.round})`);
      ok(Math.abs(p.vx) < 4000 && Math.abs(p.vy) < 4000, `p${p.id} velocity bounded`);
      if (!Number.isFinite(p.x)) break;
    }
    for (const t of match.arena.list) {
      ok(t.state >= TILE.GONE && t.state <= TILE.SOLID, 'tile state in range');
      ok(Number.isFinite(t.timer), 'tile timer finite');
    }
    match.drainEvents();
  }

  ok(sawPlaying, `match ${m}: reached PLAYING`);
  ok(match.state === ROUND_STATE.MATCH_END, `match ${m}: finished (state=${match.state}, guard=${guard})`);
  ok(match.round >= 1 && match.round <= match.opts.maxRounds + 1, `match ${m}: round count sane (${match.round})`);
  ok(!!match.matchWinner, `match ${m}: has a winner`);
  if (match.matchWinner) matchWinners++;

  totalRounds += match.round;
  for (const p of match.players) totalFalls += p.stats.falls;

  console.log(
    `  match ${m}: ${match.round} raund, g'olib ${match.matchWinner?.name ?? '—'}, ` +
      `${match.players.length} o'yinchi, ${guard} kadr`
  );
}

ok(matchWinners === 6, 'every match produced a winner');
ok(totalRounds >= 6, 'rounds were actually played');
ok(totalFalls > 0, 'players fell');

/* ------------------------------------------------------------- arena shrink */
console.log('arena shrink + chaos');
{
  const match = new Match({ seed: 99, humans: 0, bots: 2, difficulty: 'spicy', roundsToWin: 1, maxRounds: 1 });
  const dt = 1 / 60;
  const startRing = match.arena.maxRing;
  let sawQuake = false;
  let sawCollapse = false;
  for (let i = 0; i < 60 * 60; i++) {
    match.update(dt, new Map());
    for (const e of match.drainEvents()) {
      if (e.type === 'quake') sawQuake = true;
      if (e.type === 'collapse') sawCollapse = true;
    }
    if (match.state === ROUND_STATE.MATCH_END) break;
  }
  ok(sawQuake, 'quakes fired');
  ok(sawCollapse, 'ring collapse fired');
  ok(match.arena.maxRing < startRing, `arena shrank (${startRing} -> ${match.arena.maxRing})`);
}

/* ------------------------------------------------------------ pause/resume */
console.log('pause');
{
  const match = new Match({ seed: 5, humans: 0, bots: 3 });
  match.update(1 / 60, new Map());
  const before = match.time;
  match.paused = true;
  for (let i = 0; i < 120; i++) match.update(1 / 60, new Map());
  ok(match.time === before, 'time frozen while paused');
  match.paused = false;
  match.update(1 / 60, new Map());
  ok(match.time > before, 'time resumes');
}

/* ------------------------------------------------------- V2: two arenas */

console.log('V2 arenas');
{
  const a1 = new Arena({ arenaId: 'color_grid', rng: makeRng(11) });
  ok(a1.list.length === 64, 'arena #1 loads: 8x8 = 64 tiles');
  ok(a1.gridType === 'square' && a1.maxRing === 4, 'arena #1 square grid with 4 rings');
  ok(a1.list.filter((t) => t.d === 4).length === 28, 'arena #1 outer ring = 28 tiles');
  const a2 = new Arena({ arenaId: 'chaos_core', rng: makeRng(11) });
  ok(a2.list.length === 127 && a2.gridType === 'hex', 'arena #2 loads: hex 127 tiles');
  const b1 = new Arena({ arenaId: 'color_grid', rng: makeRng(11) });
  ok(
    a1.list.every((t, i) => t.mat === b1.list[i].mat && t.ci === b1.list[i].ci),
    'arena data is deterministic per seed'
  );
  const t5 = a1.list[5];
  ok(a1.tileAt(t5.x, t5.y) === t5, 'square tileAt round-trip');
  ok(a1.dist(0, 0, 7, 7) === 7 && a2.dist(0, 0, 3, 0) === 3, 'grid distances per geometry');
  const spawn = a1.spawnPoints(4);
  ok(spawn.length === 4 && spawn.every((t) => t && t.state === TILE.SOLID), 'arena #1 spawn points');
}

console.log('V2 modifiers + events + powerups');
{
  const m = new Match({ seed: 5, humans: 1, bots: 3, arenaId: 'chaos_core', mode: 'solo', modifier: 'fastTiles' });
  ok(m.modifier === 'fastTiles', 'modifier can be fixed via opts');
  ok(m.arena.modCrack === 0.55, 'FAST TILES halves crack time');
  const m2 = new Match({ seed: 6, humans: 1, bots: 3, modifier: 'doubleJump' });
  ok(m2.players.every((p) => p.dashMax === 2), 'DOUBLE JUMP grants 2 dash charges');
  const m3 = new Match({ seed: 7, humans: 1, bots: 3 });
  m3.state = 'playing';
  let saw = null;
  for (let i = 0; i < 60 * 45 && !saw; i++) {
    m3.update(1 / 60, new Map());
    for (const e of m3.drainEvents()) if (e.type === 'event') saw = e.kind;
  }
  ok(!!saw, `random event fired within 45s (${saw})`);
  for (const k of ['shockwave', 'tornado', 'ice', 'speed', 'blackout', 'darkness', 'lowGrav', 'lavaWave', 'collapseWave', 'quake']) {
    m3.triggerEvent(k);
    for (let i = 0; i < 30; i++) m3.update(1 / 60, new Map());
    m3.drainEvents();
  }
  ok(m3.players.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), 'all 10 event types keep sim finite');

  const m4 = new Match({ seed: 8, humans: 1, bots: 1 });
  const p = m4.players[0];
  m4.state = 'playing';
  const pts0 = p.points;
  grantPowerup(p, 'star', m4.arena, () => {});
  ok(p.starT > 0 && p.points === pts0 + 15, 'star: 2x window + instant points');
  grantPowerup(p, 'mirror', m4.arena, () => {});
  ok(p.mirrorT > 0, 'mirror: control inversion timer');
  const bx = p.x;
  const by = p.y;
  grantPowerup(p, 'portal', m4.arena, () => {});
  ok(Math.hypot(p.x - bx, p.y - by) > 0.5, 'portal teleports to a safe tile');
}

console.log('V2 teams + combo + near-miss');
{
  const m = new Match({ seed: 9, humans: 1, bots: 3, mode: '2v2' });
  ok(m.teamMode, '2v2 enables team mode');
  ok(m.players.filter((p) => p.team === 0).length === 2 && m.players.filter((p) => p.team === 1).length === 2, 'teams balanced 2/2');
  let steps = 0;
  while (m.state !== 'matchEnd' && steps < 60 * 60 * 14) {
    m.update(1 / 60, new Map());
    m.drainEvents();
    steps++;
  }
  ok(m.state === 'matchEnd' && m.matchWinner && (m.matchWinner.team === 0 || m.matchWinner.team === 1), 'team match ends with a team winner');

  const mc = new Match({ seed: 10, humans: 1, bots: 2 });
  const p = mc.players[0];
  mc.state = 'playing';
  let combo = false;
  for (let i = 0; i < 400; i++) {
    mc.update(1 / 60, new Map([[p.id, { mx: i % 40 < 20 ? 0.8 : -0.8, my: 0, dash: i === 10 }]]));
    for (const e of mc.drainEvents()) if (e.type === 'combo') combo = true;
  }
  ok(combo, 'landing combo registered');
  const mn = new Match({ seed: 12, humans: 1, bots: 2 });
  mn.state = 'playing';
  const pn = mn.players[0];
  for (let i = 0; i < 30; i++) mn.update(1 / 60, new Map());
  mn.drainEvents();
  mn.state = 'playing';
  const t = mn.arena.tileAt(pn.x, pn.y);
  if (t) {
    mn.arena.forceCrack(t, 1);
    const p = pn;
    const mc2 = mn;
    p.prevTile = t;
    p.prevLeaveT = mc2.time;
    p.x += mc2.arena.size * 1.4;
    let near = false;
    for (let i = 0; i < 5; i++) {
      mc2.state = 'playing';
      mc2.update(1 / 60, new Map());
      for (const e of mc2.drainEvents()) if (e.type === 'nearMiss') near = true;
    }
    ok(near, 'near-miss warning when escaping a cracking tile');
  } else {
    ok(false, 'near-miss: player on a tile');
  }
}

console.log(failures === 0 ? '\n✅ Barcha testlar o‘tdi' : `\n❌ ${failures} ta xato`);
process.exit(failures === 0 ? 0 : 1);
