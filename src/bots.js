/**
 * Bot brains. Each bot re-plans on a reaction timer, scores every hex it can
 * reach, then steers toward the best one and dashes over gaps when it must.
 */

import { TILE } from './config.js?v=20260913';
import { hexDistance, hexSpiral } from './hex.js?v=20260913';
import { clamp } from './rng.js?v=20260913';

const CANDIDATE_CACHE = new Map();

function candidates(arena, look) {
  const k = look;
  if (!CANDIDATE_CACHE.has(k)) CANDIDATE_CACHE.set(k, hexSpiral(look));
  return CANDIDATE_CACHE.get(k);
}

/** Would a straight walk from p to (tx,ty) cross a hole? */
function pathBlocked(arena, p, tx, ty) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.min(10, Math.ceil(dist / (arena.size * 0.55)));
  if (steps <= 0) return false;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const tile = arena.tileAt(p.x + dx * t, p.y + dy * t);
    if (!tile || tile.state === TILE.GONE || tile.state === TILE.FALLING) return true;
  }
  return false;
}

function powerupValue(type, p, arena) {
  switch (type) {
    case 'shatter': {
      // Great when enemies are near, useless in an empty corner.
      return 40;
    }
    case 'freeze':
      return 34;
    case 'phantom':
      return arena.standingCount() < arena.list.length * 0.45 ? 60 : 30;
    case 'speed':
      return p.dashCd > 0.4 ? 40 : 24;
    case 'titan':
      return 34;
    default:
      return 20;
  }
}

/**
 * Pick a destination for the bot. Mutates p.ai, returns nothing.
 */
export function planBot(p, arena, world, rng) {
  const ai = p.ai;
  const here = arena.tileAt(p.x, p.y);
  const look = ai.lookahead;
  const cells = candidates(arena, look);

  const enemies = world.players.filter((o) => o !== p && o.alive);
  let best = null;
  let bestScore = -Infinity;

  const centreBias = 2.2 + (1 - ai.skill) * 1.5;

  for (const c of cells) {
    const tile = arena.get(c.q, c.r);
    if (!tile || tile.state === TILE.GONE) continue;
    const dist = hexDistance(tile.q, tile.r, here ? here.q : 0, here ? here.r : 0);
    if (dist > look) continue;

    let score = arena.safety(tile, { centreBias });

    // Travelling costs time; far tiles only win when everything near is bad.
    score -= dist * (9 - ai.skill * 3);

    // A gap on the way needs a dash we may not have.
    const blocked = dist > 0 && pathBlocked(arena, p, tile.x, tile.y);
    if (blocked) score -= p.dashCd <= 0 ? 26 : 120;

    // Loot.
    if (tile.powerup) {
      score += powerupValue(tile.powerup.type, p, arena) * (0.5 + ai.greed);
      score -= dist * 2;
    }

    // Aggression: hovering next to a doomed enemy is worth a lot.
    if (enemies.length) {
      for (const e of enemies) {
        const ed = Math.hypot(e.x - tile.x, e.y - tile.y);
        if (ed < arena.size * 1.6) {
          const vulnerable =
            (e.tile && e.tile.state <= TILE.CRACKED ? 1 : 0) +
            (e.falling ? 2 : 0) +
            (arena.maxRing - (e.tile ? e.tile.d : 0) <= 1 ? 1.2 : 0);
          score += ai.skill * 26 * vulnerable - (1 - ai.skill) * 10;
        }
      }
    }

    // Crowding: bots spread out a bit so they do not clump.
    for (const o of enemies) {
      const od = Math.hypot(o.x - tile.x, o.y - tile.y);
      if (od < arena.size * 1.1) score -= 14;
    }

    score += (rng() - 0.5) * ai.jitter;

    if (score > bestScore) {
      bestScore = score;
      best = tile;
    }
  }

  if (!best) {
    const any = arena.list.filter((t) => t.state === TILE.SOLID);
    best = any.length ? any[Math.floor(rng() * any.length)] : here;
  }

  ai.target = best;
  ai.targetX = best.x + (rng() - 0.5) * arena.size * 0.4;
  ai.targetY = best.y + (rng() - 0.5) * arena.size * 0.4;
}

/**
 * Produce this frame's input for a bot.
 * @returns {{mx:number,my:number,dash:boolean}}
 */
export function botInput(p, arena, world, dt, rng) {
  const ai = p.ai;
  ai.thinkT -= dt;
  if (ai.thinkT <= 0 || !ai.target || ai.target.state === TILE.GONE) {
    planBot(p, arena, world, rng);
    ai.thinkT = ai.reaction * (0.7 + rng() * 0.7);
  }

  let tx = ai.targetX;
  let ty = ai.targetY;

  // Emergency: the floor under us is about to give way.
  const here = p.tile || arena.tileAt(p.x, p.y);
  const panic =
    here &&
    ((here.state === TILE.CRACKED && here.timer < 0.42) || here.state === TILE.FALLING || p.falling);
  if (panic) {
    ai.panic = 0.35;
    let bestN = null;
    let bestS = -Infinity;
    for (const c of candidates(arena, 2)) {
      const t = arena.get((here ? here.q : 0) + c.q, (here ? here.r : 0) + c.r);
      if (!t || t.state !== TILE.SOLID) continue;
      const s = arena.safety(t, { centreBias: 3 }) - hexDistance(t.q, t.r, here.q, here.r) * 14;
      if (s > bestS) {
        bestS = s;
        bestN = t;
      }
    }
    if (bestN) {
      tx = bestN.x;
      ty = bestN.y;
    }
  } else {
    ai.panic = Math.max(0, ai.panic - dt);
  }

  let dx = tx - p.x;
  let dy = ty - p.y;
  const dist = Math.hypot(dx, dy);

  // Flee a charging enemy if we are near an edge.
  for (const o of world.players) {
    if (o === p || !o.alive) continue;
    if (o.dashT <= 0) continue;
    const ox = p.x - o.x;
    const oy = p.y - o.y;
    const od = Math.hypot(ox, oy);
    if (od < arena.size * 3.2 && od > 0.001) {
      const closing = (o.vx * -ox + o.vy * -oy) / od;
      if (closing > 60) {
        const w = clamp(1 - od / (arena.size * 3.2), 0, 1) * ai.skill * 90;
        dx += (ox / od) * w;
        dy += (oy / od) * w;
      }
    }
  }

  const len = Math.hypot(dx, dy) || 1;
  const mx = dist < arena.size * 0.25 ? 0 : dx / len;
  const my = dist < arena.size * 0.25 ? 0 : dy / len;

  // Dash decisions.
  let wantDash = false;
  if (p.dashCd <= 0 && len > 1) {
    const nx = mx;
    const ny = my;
    const probe = arena.size * 1.5;
    const ahead = arena.tileAt(p.x + nx * probe, p.y + ny * probe);
    const aheadGap = !arena.supports(ahead, p.phantomT);
    const immediate = arena.tileAt(p.x + nx * arena.size * 0.7, p.y + ny * arena.size * 0.7);
    const immediateGap = !arena.supports(immediate, p.phantomT);

    const skillRoll = rng() < ai.dashSkill;
    if ((immediateGap || (panic && aheadGap) || p.falling) && skillRoll) {
      wantDash = true;
    } else if (panic && here && here.state === TILE.CRACKED && here.timer < 0.2 && rng() < ai.dashSkill) {
      wantDash = true;
    } else if (ai.panic > 0 && rng() < 0.25 * ai.dashSkill) {
      wantDash = true;
    } else {
      // Opportunistic dash to body-check a close enemy.
      for (const o of world.players) {
        if (o === p || !o.alive) continue;
        const od = Math.hypot(o.x - p.x, o.y - p.y);
        if (od < arena.size * 2.4 && od > 0.001 && rng() < ai.skill * 0.5 * dt * 6) {
          const dot = ((o.x - p.x) * mx + (o.y - p.y) * my) / od;
          if (dot > 0.82) {
            wantDash = true;
            // aim the dash at them
            return { mx: (o.x - p.x) / od, my: (o.y - p.y) / od, dash: true };
          }
        }
      }
    }
  }

  return { mx, my, dash: wantDash };
}
