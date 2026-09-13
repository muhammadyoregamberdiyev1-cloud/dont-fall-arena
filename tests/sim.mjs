/**
 * Headless smoke test: plays whole matches with bots only and checks the
 * simulation stays sane (no NaN, rounds terminate, somebody wins).
 *
 *   node tests/sim.mjs
 */

import { Match, ROUND_STATE } from '../src/match.js';
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

console.log(failures === 0 ? '\n✅ Barcha testlar o‘tdi' : `\n❌ ${failures} ta xato`);
process.exit(failures === 0 ? 0 : 1);
