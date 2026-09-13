/**
 * Match orchestration: rounds, spawns, powerups, scoring, win conditions.
 * The renderer and audio only ever *read* this object or consume its event log.
 */

import { ARENA, MATCH, PLAYER, POWERUPS, PALETTE, BOT_NAMES, TILE } from './config.js';
import { makeRng, clamp } from './rng.js';
import { Arena } from './arena.js';
import { createPlayer, resetPlayerForRound, stepPlayer, resolveCollisions, grantPowerup } from './player.js';
import { botInput } from './bots.js';

export const ROUND_STATE = {
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  ROUND_END: 'roundEnd',
  MATCH_END: 'matchEnd',
};

export class Match {
  constructor(opts = {}) {
    this.opts = Object.assign(
      {
        seed: Math.floor(Math.random() * 1e9),
        humans: 1,
        bots: 3,
        difficulty: 'normal',
        arenaRadius: ARENA.radius,
        roundsToWin: MATCH.roundsToWin,
        maxRounds: MATCH.maxRounds,
        roundTime: ARENA.roundTime,
        humanNames: ['Siz'],
      },
      opts
    );

    this.rng = makeRng(this.opts.seed);
    this.events = [];
    this.players = [];
    this.powerups = [];
    this.round = 1;
    this.state = ROUND_STATE.COUNTDOWN;
    this.stateT = MATCH.countdownTime;
    this.roundT = this.opts.roundTime;
    this.elimOrder = [];
    this.matchWinner = null;
    this.lastRound = null;
    this.time = 0;
    this.paused = false;

    this.buildRoster();
    this.startRound();
  }

  /* ---------------------------------------------------------------- roster */

  buildRoster() {
    const names = this.rng.shuffle(BOT_NAMES.slice());
    const total = this.opts.humans + this.opts.bots;
    let nameIdx = 0;
    for (let i = 0; i < this.opts.humans; i++) {
      this.players.push(
        createPlayer({
          name: this.opts.humanNames[i] ?? (i === 0 ? 'Siz' : `Oyinchi ${i + 1}`),
          color: PALETTE[i % PALETTE.length],
          isBot: false,
          isLocal: true,
          controls: i,
        })
      );
    }
    for (let i = 0; i < this.opts.bots; i++) {
      const idx = this.opts.humans + i;
      this.players.push(
        createPlayer({
          name: names[nameIdx++ % names.length],
          color: PALETTE[idx % PALETTE.length],
          isBot: true,
          difficulty: this.opts.difficulty,
        })
      );
    }
    this.total = total;
  }

  /* ----------------------------------------------------------------- round */

  startRound() {
    this.rng = makeRng((this.opts.seed + this.round * 7919) >>> 0);
    this.arena = new Arena({
      radius: this.opts.arenaRadius,
      rng: this.rng,
      mixSpecials: ARENA.mixSpecials + Math.min(0.1, (this.round - 1) * 0.02),
    });
    this.powerups = [];
    this.elimOrder = [];
    this.roundT = this.opts.roundTime;
    this.state = ROUND_STATE.COUNTDOWN;
    this.stateT = MATCH.countdownTime;
    this.nextPowerup = 5.5;
    this.shake = 0;
    this.lastCount = null;

    const spawns = this.arena.spawnPoints(this.players.length);
    this.players.forEach((p, i) => {
      const tile = spawns[i % spawns.length];
      resetPlayerForRound(p, tile, Math.atan2(-tile.y, -tile.x));
    });

    this.emit('roundStart', { round: this.round, players: this.players.map((p) => p.name) });
  }

  emit(type, data = {}) {
    this.events.push({ type, t: this.time, ...data });
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  alivePlayers() {
    return this.players.filter((p) => p.alive);
  }

  /* ---------------------------------------------------------------- update */

  update(dt, inputs = new Map()) {
    if (this.paused) return;
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 2.6);

    // fold arena-generated events into ours
    for (const e of this.arena.drainEvents()) {
      this.emit(e.type, e);
      if (e.type === 'fall') this.shake = Math.min(1, this.shake + 0.16);
      if (e.type === 'collapse') this.shake = 1;
      if (e.type === 'quake') this.shake = Math.min(1, this.shake + 0.45);
    }

    if (this.state === ROUND_STATE.COUNTDOWN) {
      this.stateT -= dt;
      const before = Math.ceil(this.stateT);
      if (this.stateT <= 0) {
        this.state = ROUND_STATE.PLAYING;
        this.emit('go', {});
      } else if (before !== this.lastCount) {
        this.lastCount = before;
        this.emit('count', { n: before });
      }
      this.arena.update(dt * 0.35);
      return;
    }

    if (this.state === ROUND_STATE.ROUND_END) {
      this.stateT -= dt;
      this.arena.update(dt);
      for (const p of this.players) if (!p.alive) stepPlayer(p, this.arena, dt, { mx: 0, my: 0 }, this.frameCtx(dt));
      if (this.stateT <= 0) {
        if (this.matchWinner) {
          this.state = ROUND_STATE.MATCH_END;
          this.stateT = 0;
          this.emit('matchEnd', { winner: this.matchWinner, standings: this.standings() });
        } else {
          this.round++;
          this.startRound();
        }
      }
      return;
    }

    if (this.state === ROUND_STATE.MATCH_END) return;

    /* ---- playing ---- */
    this.roundT -= dt;
    this.arena.clearOccupancy();

    const ctx = this.frameCtx(dt);

    // inputs
    for (const p of this.players) {
      if (!p.alive) {
        stepPlayer(p, this.arena, dt, { mx: 0, my: 0 }, ctx);
        continue;
      }
      let input;
      if (p.isBot) {
        input = botInput(p, this.arena, { players: this.players }, dt, this.rng);
      } else {
        const raw = inputs.get(p.id) || inputs.get(p.controls) || { mx: 0, my: 0, dash: false };
        input = { mx: raw.mx || 0, my: raw.my || 0, dash: !!raw.dash };
      }
      stepPlayer(p, this.arena, dt, input, ctx);
    }

    resolveCollisions(this.players, ctx);
    this.arena.update(dt);
    this.updatePowerups(dt);

    // eliminations
    for (const p of this.players) {
      if (!p.alive && p.place === 0) {
        p.place = this.players.length - this.elimOrder.length;
        this.elimOrder.push(p);
        this.emit('eliminated', { player: p, place: p.place });
        const killer = this.players.find((o) => o.id === p.bumpedBy);
        if (killer && killer.alive && this.time - p.bumpedAt < PLAYER.killCreditWindow) {
          killer.stats.eliminations++;
          this.emit('shovedOff', { killer, victim: p });
        }
        this.shake = Math.min(1.2, this.shake + 0.7);
      }
    }

    const alive = this.alivePlayers();
    if (alive.length <= 1 || this.roundT <= 0) this.endRound(alive);
  }

  frameCtx(dt) {
    return {
      time: this.time,
      dt,
      emit: (type, data) => {
        this.emit(type, data);
        if (type === 'bump') this.shake = Math.min(1, this.shake + 0.3);
      },
    };
  }

  /* -------------------------------------------------------------- powerups */

  updatePowerups(dt) {
    this.nextPowerup -= dt;
    const alive = this.alivePlayers().length;
    if (this.nextPowerup <= 0 && this.powerups.length < 4) {
      this.nextPowerup = clamp(7.5 - (this.round - 1) * 0.4 - (6 - alive) * 0.3, 3.2, 8);
      this.spawnPowerup();
    }
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pu = this.powerups[i];
      pu.t += dt;
      pu.life -= dt;
      const tile = this.arena.get(pu.q, pu.r);
      if (!tile || tile.state < TILE.CRACKED || pu.life <= 0) {
        this.powerups.splice(i, 1);
        if (tile) tile.powerup = null;
        if (pu.life <= 0) this.emit('powerupFade', { x: pu.x, y: pu.y, type: pu.type });
        continue;
      }
      for (const p of this.players) {
        if (!p.alive || p.falling) continue;
        const d = Math.hypot(p.x - pu.x, p.y - pu.y);
        if (d < this.arena.size * 0.62) {
          grantPowerup(p, pu.type, this.arena, (type, data) => this.emit(type, data));
          tile.powerup = null;
          this.powerups.splice(i, 1);
          p.glow = 1;
          break;
        }
      }
    }
  }

  spawnPowerup() {
    const types = Object.keys(POWERUPS);
    if (this.arena.maxRing < ARENA.powerupMinRing) return;
    const cells = this.arena.list.filter(
      (t) => t.state === TILE.SOLID && !t.powerup && t.occupants === 0 && t.d <= this.arena.maxRing - 1 && t.d > 0
    );
    if (!cells.length) return;
    const tile = cells[Math.floor(this.rng() * cells.length)];
    const type = types[Math.floor(this.rng() * types.length)];
    const pu = {
      type,
      q: tile.q,
      r: tile.r,
      x: tile.x,
      y: tile.y,
      t: 0,
      life: 16,
      def: POWERUPS[type],
    };
    tile.powerup = pu;
    this.powerups.push(pu);
    this.emit('powerupSpawn', { ...pu });
  }

  /* ----------------------------------------------------------------- ends */

  endRound(alive) {
    this.state = ROUND_STATE.ROUND_END;
    this.stateT = MATCH.roundEndTime;

    const results = [];
    if (alive.length >= 1) {
      // survivors share the top spot (ties happen when the clock runs out)
      for (const p of alive) {
        p.place = 1;
        p.wins += alive.length === 1 ? 1 : 0;
        p.points += MATCH.points[0] + (this.roundT <= 0 ? MATCH.survivalBonus : 0);
        p.stats.survived++;
        p.stats.bestTime = Math.max(p.stats.bestTime, this.opts.roundTime - Math.max(0, this.roundT));
        results.push({ player: p, place: 1, winner: alive.length === 1 });
      }
    }
    // eliminated players, best (latest eliminated) first
    for (let i = this.elimOrder.length - 1; i >= 0; i--) {
      const p = this.elimOrder[i];
      const place = alive.length + (this.elimOrder.length - i);
      p.place = place;
      p.points += MATCH.points[Math.min(place - 1, MATCH.points.length - 1)];
      results.push({ player: p, place, winner: false });
    }
    results.sort((a, b) => a.place - b.place || b.player.points - a.player.points);

    const leader = this.standings()[0];
    const decided =
      (leader && leader.wins >= this.opts.roundsToWin) || this.round >= this.opts.maxRounds;
    if (decided && leader) {
      this.matchWinner = leader;
      leader.points += 3;
    }

    this.lastRound = {
      round: this.round,
      results,
      timedOut: this.roundT <= 0 && alive.length > 1,
      standings: this.standings(),
    };
    this.emit('roundEnd', this.lastRound);
  }

  standings() {
    return this.players
      .slice()
      .sort((a, b) => b.wins - a.wins || b.points - a.points || a.name.localeCompare(b.name));
  }

  /** Sudden-death style rematch without rebuilding the roster. */
  restart() {
    for (const p of this.players) {
      p.wins = 0;
      p.points = 0;
      p.place = 0;
      p.stats = { falls: 0, bumps: 0, eliminations: 0, powerups: 0, survived: 0, bestTime: 0 };
    }
    this.round = 1;
    this.matchWinner = null;
    this.lastRound = null;
    this.time = 0;
    this.startRound();
  }
}
