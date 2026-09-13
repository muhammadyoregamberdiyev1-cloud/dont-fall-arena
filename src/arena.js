/**
 * The arena: a disc of hexagonal tiles that cracks, collapses and shrinks.
 * Pure simulation — rendering reads from it, it never touches the DOM.
 */

import { TILE, MAT, MATERIALS, ARENA } from './config.js';
import { axialToPixel, pixelToAxial, hexDistance, hexSpiral, hexRing } from './hex.js';
import { clamp } from './rng.js';

const key = (q, r) => q + ',' + r;

export class Arena {
  constructor({ radius = ARENA.radius, size = ARENA.tileSize, rng, mixSpecials = ARENA.mixSpecials }) {
    this.radius = radius;
    this.size = size;
    this.rng = rng;
    this.mixSpecials = mixSpecials;
    this.tiles = new Map();
    this.list = [];
    this.maxRing = radius;
    this.elapsed = 0;
    this.nextQuake = ARENA.firstQuake;
    this.nextCollapse = ARENA.firstCollapse;
    this.collapseWarn = 0;
    this.quakeFlash = 0;
    this.events = [];
    this.build();
  }

  build() {
    this.tiles.clear();
    this.list = [];
    for (const { q, r } of hexSpiral(this.radius)) {
      const p = axialToPixel(q, r, this.size);
      const d = hexDistance(q, r, 0, 0);
      let mat = MAT.NORMAL;
      if (d > 0 && this.rng.chance(this.mixSpecials)) {
        const roll = this.rng();
        mat = roll < 0.4 ? MAT.STEEL : roll < 0.75 ? MAT.ICE : MAT.CRUMBLE;
      }
      const tile = {
        q,
        r,
        d,
        x: p.x,
        y: p.y,
        mat,
        state: TILE.SOLID,
        hp: MATERIALS[mat].hp * (d === 0 ? 3 : 1),
        pressure: 0,
        timer: 0,
        fallT: 0,
        occupants: 0,
        wobble: 0,
        wobbleT: this.rng() * 6.28,
        flash: 0,
        seed: this.rng(),
        powerup: null,
      };
      this.tiles.set(key(q, r), tile);
      this.list.push(tile);
    }
  }

  get(q, r) {
    return this.tiles.get(key(q, r)) || null;
  }

  tileAt(x, y) {
    const { q, r } = pixelToAxial(x, y, this.size);
    return this.get(q, r);
  }

  neighbors(tile) {
    const out = [];
    if (!tile) return out;
    for (const [dq, dr] of [
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [0, 1],
    ]) {
      const n = this.get(tile.q + dq, tile.r + dr);
      if (n) out.push(n);
    }
    return out;
  }

  /** Can something stand on this tile right now? */
  supports(tile, phantom = 0) {
    if (!tile) return false;
    if (tile.state === TILE.SOLID || tile.state === TILE.CRACKED) return true;
    if (tile.state === TILE.FALLING && phantom > 0 && tile.fallT < MATERIALS[tile.mat].fallTime * 0.7) {
      return true;
    }
    return false;
  }

  solidCount() {
    let n = 0;
    for (const t of this.list) if (t.state === TILE.SOLID) n++;
    return n;
  }

  standingCount() {
    let n = 0;
    for (const t of this.list) if (t.state !== TILE.GONE) n++;
    return n;
  }

  get worldRadius() {
    return this.size * (this.maxRing + 0.5) * 1.8;
  }

  addPressure(tile, amount) {
    if (!tile || tile.state === TILE.GONE || tile.state === TILE.FALLING) return;
    tile.pressure += amount;
    if (tile.pressure >= tile.hp && tile.state === TILE.SOLID) {
      tile.state = TILE.CRACKED;
      tile.timer = MATERIALS[tile.mat].crackTime;
      tile.pressure = 0;
      tile.flash = 0.25;
      this.pushEvent('crack', { q: tile.q, r: tile.r, x: tile.x, y: tile.y, mat: tile.mat });
    }
  }

  /** Force a tile into the cracking state (quakes, ring collapse, powers). */
  forceCrack(tile, timeMul = 1) {
    if (!tile || tile.state < TILE.SOLID) return false;
    if (tile.state === TILE.SOLID) {
      tile.state = TILE.CRACKED;
      tile.timer = MATERIALS[tile.mat].crackTime * timeMul;
      tile.flash = 0.3;
      this.pushEvent('crack', { q: tile.q, r: tile.r, x: tile.x, y: tile.y, mat: tile.mat, forced: true });
      return true;
    }
    tile.timer = Math.min(tile.timer, 0.22 * timeMul);
    return true;
  }

  /** Repair a tile (freeze powerup). */
  stabilize(tile) {
    if (!tile || tile.state === TILE.GONE) return false;
    tile.state = TILE.SOLID;
    tile.pressure = 0;
    tile.timer = 0;
    tile.fallT = 0;
    tile.flash = -0.4; // negative flash = blue "heal" pulse in the renderer
    this.pushEvent('stabilize', { q: tile.q, r: tile.r, x: tile.x, y: tile.y });
    return true;
  }

  pushEvent(type, data) {
    this.events.push({ type, ...data });
  }

  /** Called by the match at the very start of a frame, before physics. */
  clearOccupancy() {
    for (const t of this.list) t.occupants = 0;
  }

  drainEvents() {
    const e = this.events || [];
    this.events = [];
    return e;
  }

  /** Random solid tiles get loaded up — the arena itself attacks. */
  quake(count) {
    const candidates = this.list.filter(
      (t) => t.state === TILE.SOLID && t.d <= this.maxRing && t.d > 0
    );
    if (!candidates.length) return;
    const picks = this.rng.shuffle(candidates.slice()).slice(0, count);
    for (const t of picks) {
      this.addPressure(t, t.hp * 0.95);
      t.wobble = 0.5;
    }
    this.quakeFlash = 0.5;
    this.pushEvent('quake', { count: picks.length });
  }

  /** Shrink the arena by one ring. */
  collapseRing() {
    const ring = hexRing(this.maxRing);
    let hit = 0;
    for (const { q, r } of ring) {
      const t = this.get(q, r);
      if (!t) continue;
      if (t.state === TILE.CRACKED) {
        t.timer = Math.min(t.timer, 0.4);
        hit++;
      } else if (t.state === TILE.SOLID) {
        if (this.forceCrack(t, 0.55)) hit++;
      }
    }
    if (this.maxRing > ARENA.minRing) this.maxRing--;
    this.pushEvent('collapse', { ring: this.maxRing + 1, hit });
    this.collapseWarn = 0;
  }

  update(dt) {
    this.elapsed += dt;
    this.quakeFlash = Math.max(0, this.quakeFlash - dt);

    // Scheduled chaos.
    if (this.elapsed >= this.nextQuake) {
      // Quakes come faster as the round drags on, and very fast once the
      // arena has nothing left to shrink.
      const interval =
        this.maxRing <= 0
          ? ARENA.suddenDeathQuake
          : Math.max(2.4, ARENA.quakeInterval - this.elapsed / 45);
      this.nextQuake += interval;
      const n = ARENA.quakeBase + Math.floor(this.elapsed / ARENA.quakeRamp);
      this.quake(n);
    }

    const toCollapse = this.nextCollapse - this.elapsed;
    this.collapseWarn = toCollapse < 2 ? clamp(toCollapse / 2, 0, 1) : 0;
    if (this.elapsed >= this.nextCollapse && this.maxRing >= ARENA.minRing) {
      this.nextCollapse += ARENA.collapseInterval;
      this.collapseRing();
    }

    for (const t of this.list) {
      t.flash += (0 - t.flash) * Math.min(1, dt * 8);
      t.wobble = Math.max(0, t.wobble - dt * 1.6);
      t.wobbleT += dt * (3 + t.wobble * 12);

      if (t.state === TILE.SOLID) {
        // Pressure bleeds off so a quick tap does not doom a tile.
        t.pressure = Math.max(0, t.pressure - dt * 0.18 * t.hp);
      } else if (t.state === TILE.CRACKED) {
        t.timer -= dt * (1 + t.occupants * 1.1);
        t.wobble = Math.max(t.wobble, 0.18);
        if (t.timer <= 0) {
          t.state = TILE.FALLING;
          t.fallT = 0;
          this.pushEvent('fall', { q: t.q, r: t.r, x: t.x, y: t.y, mat: t.mat });
        }
      } else if (t.state === TILE.FALLING) {
        t.fallT += dt;
        if (t.fallT >= MATERIALS[t.mat].fallTime) {
          t.state = TILE.GONE;
          t.powerup = null;
        }
      }
    }
  }

  /**
   * How attractive is this tile for the AI / for choosing escape routes.
   * Higher is safer. Accounts for state, neighbours, ring shrink and load.
   */
  safety(tile, opts = {}) {
    if (!tile) return -1000;
    if (tile.state === TILE.GONE) return -1000;
    let s = 0;
    if (tile.state === TILE.SOLID) s += 100;
    else if (tile.state === TILE.CRACKED) s += 100 * clamp(tile.timer / MATERIALS[tile.mat].crackTime, 0, 1) * 0.45;
    else if (tile.state === TILE.FALLING) s -= 60;

    // Remaining durability.
    if (tile.state === TILE.SOLID) s += 26 * clamp(1 - tile.pressure / tile.hp, 0, 1);

    // Neighbours: isolated tiles are traps.
    let solidN = 0;
    for (const n of this.neighbors(tile)) {
      if (n.state === TILE.SOLID) solidN++;
      else if (n.state === TILE.CRACKED) solidN += 0.4;
    }
    s += solidN * 7;

    // The ring is closing in — staying near the rim is suicide.
    const rimMargin = this.maxRing - tile.d;
    s += clamp(rimMargin, -3, 6) * 6;
    if (rimMargin <= 0) s -= 90;

    // Centre bias (late game the middle is the only place left).
    s -= tile.d * (opts.centreBias ?? 2.2);

    // Tiles that already carry someone's weight will break soon.
    s -= tile.occupants * 12;
    if (tile.mat === MAT.CRUMBLE) s -= 34;
    if (tile.mat === MAT.STEEL) s += 12;
    if (tile.mat === MAT.ICE) s -= 4;

    return s;
  }

  /** Evenly spaced spawn tiles near the rim. */
  spawnPoints(count) {
    const ring = Math.max(1, this.maxRing - 1);
    const cells = hexRing(ring).filter((c) => {
      const t = this.get(c.q, c.r);
      return t && t.state === TILE.SOLID;
    });
    const out = [];
    if (!cells.length) {
      const any = this.list.filter((t) => t.state === TILE.SOLID);
      for (let i = 0; i < count; i++) out.push(any[i % any.length]);
      return out;
    }
    for (let i = 0; i < count; i++) {
      const idx = Math.floor((i / count) * cells.length + cells.length * 0.13) % cells.length;
      out.push(this.get(cells[idx].q, cells[idx].r));
    }
    return out;
  }
}
