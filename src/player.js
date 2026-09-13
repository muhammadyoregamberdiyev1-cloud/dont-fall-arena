/**
 * Player entities + their physics. Pure logic, no DOM.
 * A player is a circle sliding over the hex floor; if the floor under them
 * stops supporting them they get a short scramble window, then they fall.
 */

import { PLAYER, MATERIALS, TILE, POWERUPS, DIFFICULTY } from './config.js';
import { clamp, approach } from './rng.js';
import { hexDistance } from './hex.js';

let nextId = 1;

export function createPlayer(spec = {}) {
  const difficulty = spec.difficulty ? DIFFICULTY[spec.difficulty] : null;
  return {
    id: spec.id ?? nextId++,
    name: spec.name ?? 'Oyinchi',
    color: spec.color ?? '#ff5d73',
    isBot: !!spec.isBot,
    isLocal: !!spec.isLocal,
    controls: spec.controls ?? null,
    difficulty: spec.difficulty ?? 'normal',

    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: PLAYER.radius,
    facing: 0,

    alive: true,
    grounded: false,
    falling: false,
    fallT: 0,
    doomed: false,
    hopT: 0,
    place: 0,

    dashT: 0,
    dashCd: 0,
    dashDirX: 1,
    dashDirY: 0,
    dashTrail: [],

    // timed effects
    speedT: 0,
    phantomT: 0,
    freezeT: 0,
    titanT: 0,

    // interaction bookkeeping
    bumpedBy: null,
    bumpedAt: -99,
    bumpCd: 0,
    tile: null,

    // match level
    wins: 0,
    points: 0,
    stats: { falls: 0, bumps: 0, eliminations: 0, powerups: 0, survived: 0, bestTime: 0 },

    ai: {
      skill: difficulty ? difficulty.skill : 0.8,
      reaction: difficulty ? difficulty.reaction : 0.2,
      lookahead: difficulty ? difficulty.lookahead : 3,
      dashSkill: difficulty ? difficulty.dashSkill : 0.75,
      greed: difficulty ? difficulty.greed : 0.7,
      jitter: difficulty ? difficulty.jitter : 12,
      thinkT: 0,
      target: null,
      targetX: 0,
      targetY: 0,
      wantDash: false,
      panic: 0,
      wobbleSeed: Math.random() * 100,
    },

    // presentation
    squash: 0,
    glow: 0,
    trail: [],
  };
}

export function resetPlayerForRound(p, tile, facing) {
  p.x = tile.x;
  p.y = tile.y;
  p.vx = 0;
  p.vy = 0;
  p.facing = facing ?? 0;
  p.alive = true;
  p.grounded = true;
  p.falling = false;
  p.fallT = 0;
  p.doomed = false;
  p.hopT = 0;
  p.dashT = 0;
  p.dashCd = 0;
  p.speedT = 0;
  p.phantomT = 0;
  p.freezeT = 0;
  p.titanT = 0;
  p.bumpedBy = null;
  p.bumpedAt = -99;
  p.bumpCd = 0;
  p.place = 0;
  p.tile = tile;
  p.squash = 0;
  p.glow = 0.6;
  p.dashTrail.length = 0;
  p.trail.length = 0;
  if (p.ai) {
    p.ai.thinkT = 0;
    p.ai.target = tile;
    p.ai.targetX = tile.x;
    p.ai.targetY = tile.y;
    p.ai.wantDash = false;
    p.ai.panic = 0;
  }
}

/** Effects that tick down on their own. */
function tickEffects(p, dt) {
  p.speedT = Math.max(0, p.speedT - dt);
  p.phantomT = Math.max(0, p.phantomT - dt);
  p.freezeT = Math.max(0, p.freezeT - dt);
  p.titanT = Math.max(0, p.titanT - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.bumpCd = Math.max(0, p.bumpCd - dt);
  p.glow = Math.max(0, p.glow - dt * 1.5);
  p.squash = approach(p.squash, 0, 9, dt);
}

export function speedMul(p) {
  return p.speedT > 0 ? 1.45 : 1;
}

export function dashCooldownFor(p) {
  return PLAYER.dashCooldown * (p.speedT > 0 ? 0.6 : 1);
}

export function tryDash(p, dirX, dirY, emit) {
  if (p.dashCd > 0 || p.dashT > 0) return false;
  const len = Math.hypot(dirX, dirY);
  if (len < 0.01) {
    dirX = Math.cos(p.facing);
    dirY = Math.sin(p.facing);
  } else {
    dirX /= len;
    dirY /= len;
  }
  p.dashDirX = dirX;
  p.dashDirY = dirY;
  p.dashT = PLAYER.dashTime;
  p.hopT = PLAYER.dashTime + 0.06;
  p.dashCd = dashCooldownFor(p);
  p.squash = -0.5;
  p.facing = Math.atan2(dirY, dirX);
  if (emit) emit('dash', { player: p, x: p.x, y: p.y, dx: dirX, dy: dirY });
  return true;
}

/**
 * Advance one player by dt.
 * @param {object} p player
 * @param {import('./arena.js').Arena} arena
 * @param {number} dt seconds
 * @param {{mx:number,my:number,dash:boolean}} input desired direction + dash request
 * @param {object} ctx { time, emit }
 */
export function stepPlayer(p, arena, dt, input, ctx) {
  tickEffects(p, dt);

  if (!p.alive) {
    p.fallT += dt;
    p.vx *= Math.exp(-2 * dt);
    p.vy *= Math.exp(-2 * dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    return;
  }

  const sm = speedMul(p);
  const maxSpeed = PLAYER.maxSpeed * sm;
  let mx = input?.mx ?? 0;
  let my = input?.my ?? 0;
  const mlen = Math.hypot(mx, my);
  if (mlen > 1) {
    mx /= mlen;
    my /= mlen;
  }

  // Dash request (also usable mid-fall: the hop can save you).
  if (input?.dash) tryDash(p, mx || Math.cos(p.facing), my || Math.sin(p.facing), ctx.emit);

  const tile = arena.tileAt(p.x, p.y);
  p.tile = tile;
  const supported = arena.supports(tile, p.phantomT);

  // --- horizontal movement -------------------------------------------------
  if (p.dashT > 0) {
    p.dashT -= dt;
    const t = clamp(p.dashT / PLAYER.dashTime, 0, 1);
    const sp = PLAYER.dashSpeed * (0.34 + 0.66 * t) * (p.speedT > 0 ? 1.15 : 1);
    p.vx = p.dashDirX * sp;
    p.vy = p.dashDirY * sp;
    p.facing = Math.atan2(p.dashDirY, p.dashDirX);
  } else {
    const control = p.falling ? PLAYER.airControl : 1;
    p.vx += mx * PLAYER.accel * control * dt;
    p.vy += my * PLAYER.accel * control * dt;

    const friction = p.falling
      ? 1.6
      : supported && tile
        ? MATERIALS[tile.mat].friction
        : 3.2;
    const damp = Math.exp(-friction * dt);
    p.vx *= damp;
    p.vy *= damp;

    const sp = Math.hypot(p.vx, p.vy);
    if (sp > maxSpeed) {
      p.vx = (p.vx / sp) * maxSpeed;
      p.vy = (p.vy / sp) * maxSpeed;
    }
    if (mlen > 0.1) {
      const want = Math.atan2(my, mx);
      let diff = want - p.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      p.facing += diff * Math.min(1, dt * 14);
    }
  }

  if (p.hopT > 0) p.hopT -= dt;
  const hopping = p.hopT > 0;

  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // --- footing -------------------------------------------------------------
  const newTile = arena.tileAt(p.x, p.y);
  p.tile = newTile;
  const nowSupported = hopping || arena.supports(newTile, p.phantomT);

  if (nowSupported && !hopping) {
    if (p.falling) {
      const saved = p.fallT <= PLAYER.saveWindow;
      p.fallT = 0;
      p.falling = false;
      p.doomed = false;
      p.squash = 0.45;
      if (ctx.emit) ctx.emit(saved ? 'scramble' : 'land', { player: p, x: p.x, y: p.y });
    }
    p.grounded = true;
    // Standing on a tile wears it out.
    if (newTile && newTile.state !== TILE.GONE) {
      newTile.occupants++;
      if (p.freezeT <= 0 && p.phantomT <= 0 && newTile.state === TILE.SOLID) {
        arena.addPressure(newTile, dt * (p.titanT > 0 ? 0.75 : 1));
      } else if (p.freezeT <= 0 && p.phantomT <= 0 && newTile.state === TILE.CRACKED) {
        newTile.timer -= dt * 0.45;
      }
    }
  } else {
    p.grounded = hopping;
    if (!hopping) {
      if (!p.falling) {
        p.falling = true;
        p.fallT = 0;
        if (ctx.emit) ctx.emit('slip', { player: p, x: p.x, y: p.y });
      }
      p.fallT += dt;
      if (p.fallT > PLAYER.saveWindow && !p.doomed) {
        p.doomed = true;
        if (ctx.emit) ctx.emit('doomed', { player: p, x: p.x, y: p.y });
      }
      if (p.fallT >= PLAYER.saveWindow + PLAYER.fallDuration) {
        p.alive = false;
        p.falling = true;
        p.stats.falls++;
        if (ctx.emit) ctx.emit('fell', { player: p, x: p.x, y: p.y, bumpedBy: p.bumpedBy, bumpedAt: p.bumpedAt, time: ctx.time });
      }
    } else if (p.falling && arena.supports(newTile, p.phantomT)) {
      // Hopped over a gap and found ground exactly as the hop ended.
      p.fallT = 0;
    }
  }

  // presentation trail
  p.trail.push({ x: p.x, y: p.y, t: 0 });
  if (p.trail.length > 18) p.trail.shift();
  for (const t of p.trail) t.t += dt;
  if (p.dashT > 0 || hopping) {
    p.dashTrail.push({ x: p.x, y: p.y, life: 0.35 });
  }
  for (let i = p.dashTrail.length - 1; i >= 0; i--) {
    p.dashTrail[i].life -= dt;
    if (p.dashTrail[i].life <= 0) p.dashTrail.splice(i, 1);
  }
}

/** Soft circle-vs-circle pushing; a dashing player hits much harder. */
export function resolveCollisions(players, ctx) {
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.0001;
      const min = (a.radius + b.radius) * PLAYER.bumpRadiusBoost;
      if (dist >= min) continue;

      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = min - dist;

      const aDash = a.dashT > 0;
      const bDash = b.dashT > 0;
      const aMass = (aDash ? 2.6 : 1) * (a.titanT > 0 ? 1.7 : 1);
      const bMass = (bDash ? 2.6 : 1) * (b.titanT > 0 ? 1.7 : 1);
      const total = aMass + bMass;

      a.x -= nx * overlap * (bMass / total);
      a.y -= ny * overlap * (bMass / total);
      b.x += nx * overlap * (aMass / total);
      b.y += ny * overlap * (aMass / total);

      const hit = (aDash || bDash) && (a.bumpCd <= 0 || b.bumpCd <= 0);
      if (hit) {
        const power = PLAYER.bumpImpulse * (aDash && bDash ? 1.4 : 1);
        const aTitan = a.titanT > 0 ? 2 : 1;
        const bTitan = b.titanT > 0 ? 2 : 1;
        b.vx += nx * power * aTitan * (aMass / total) * 1.6;
        b.vy += ny * power * aTitan * (aMass / total) * 1.6;
        a.vx -= nx * power * bTitan * (bMass / total) * 1.6;
        a.vy -= ny * power * bTitan * (bMass / total) * 1.6;
        b.hopT = Math.min(b.hopT, 0.05);
        a.hopT = Math.min(a.hopT, 0.05);
        if (aDash) {
          b.bumpedBy = a.id;
          b.bumpedAt = ctx.time;
        }
        if (bDash) {
          a.bumpedBy = b.id;
          a.bumpedAt = ctx.time;
        }
        a.bumpCd = PLAYER.bumpCooldown;
        b.bumpCd = PLAYER.bumpCooldown;
        a.squash = 0.4;
        b.squash = 0.4;
        if (ctx.emit) {
          ctx.emit('bump', {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            a,
            b,
            power: aDash ? a : b,
          });
        }
      } else {
        // gentle shove so bodies do not interpenetrate
        const soft = 60;
        b.vx += nx * soft * dtSafe(ctx);
        b.vy += ny * soft * dtSafe(ctx);
        a.vx -= nx * soft * dtSafe(ctx);
        a.vy -= ny * soft * dtSafe(ctx);
      }
    }
  }
}

function dtSafe(ctx) {
  return ctx.dt ?? 1 / 60;
}

/** Instant powerup application (timed effects live on the player). */
export function grantPowerup(p, type, arena, emit) {
  const def = POWERUPS[type];
  if (!def) return;
  p.stats.powerups++;
  switch (type) {
    case 'speed':
      p.speedT = def.duration;
      break;
    case 'phantom':
      p.phantomT = def.duration;
      break;
    case 'titan':
      p.titanT = def.duration;
      break;
    case 'freeze':
      p.freezeT = def.duration;
      if (arena) {
        const t = arena.tileAt(p.x, p.y);
        if (t) arena.stabilize(t);
        for (const n of arena.neighbors(t)) arena.stabilize(n);
      }
      break;
    case 'shatter':
      if (arena) {
        const t = arena.tileAt(p.x, p.y);
        if (t) {
          for (const cand of arena.list) {
            if (cand === t) continue;
            const d = hexDistance(cand.q, cand.r, t.q, t.r);
            if (d <= def.radius && cand.state >= TILE.CRACKED) arena.forceCrack(cand, d === 1 ? 0.5 : 0.95);
          }
        }
      }
      break;
  }
  if (emit) emit('powerup', { player: p, type, x: p.x, y: p.y, def });
}
