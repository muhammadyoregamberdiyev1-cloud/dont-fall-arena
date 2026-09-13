/**
 * Match orchestration: rounds, spawns, powerups, scoring, win conditions.
 * The renderer and audio only ever *read* this object or consume its event log.
 */

import { ARENA, MATCH, PLAYER, POWERUPS, PALETTE, BOT_NAMES, TILE } from './config.js?v=20260913';
import { makeRng, clamp } from './rng.js?v=20260913';
import { Arena } from './arena.js?v=20260913';
import { arenaDef, MODES, rollModifier } from './arenas.js?v=20260913';
import { createPlayer, resetPlayerForRound, stepPlayer, resolveCollisions, grantPowerup } from './player.js?v=20260913';
import { botInput } from './bots.js?v=20260913';

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
        humanColors: null,
        arenaId: 'color_grid',
        mode: 'solo',
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
    if (this.opts.netRoster) {
      for (const r of this.opts.netRoster) {
        const p = createPlayer({
          name: r.name,
          color: r.color,
          isBot: !!r.isBot,
          isLocal: !!r.isLocal,
          controls: r.isLocal ? 0 : null,
          difficulty: this.opts.difficulty,
        });
        p.netSlot = r.slot;
        p.team = this.teamMode ? (r.team ?? 0) : null;
        this.players.push(p);
      }
      this.total = this.players.length;
      return;
    }
    const total = this.opts.humans + this.opts.bots;
    this.modeDef = MODES[this.opts.mode] || MODES.solo;
    this.teamMode = this.modeDef.teams === 2;
    const names2 = names;
    let nameIdx = 0;
    for (let i = 0; i < this.opts.humans; i++) {
      const cols = this.opts.humanColors;
      this.players.push(
        createPlayer({
          name: this.opts.humanNames[i] ?? (i === 0 ? 'Siz' : `Oyinchi ${i + 1}`),
          color: cols && cols[i] ? cols[i] : PALETTE[i % PALETTE.length],
          isBot: false,
          isLocal: true,
          controls: i,
        })
      );
      this.players[this.players.length - 1].team = this.teamMode ? (i < total / 2 ? 0 : 1) : null;
    }
    for (let i = 0; i < this.opts.bots; i++) {
      const idx = this.opts.humans + i;
      this.players.push(
        createPlayer({
          name: names2[nameIdx++ % names2.length],
          color: PALETTE[idx % PALETTE.length],
          isBot: true,
          difficulty: this.opts.difficulty,
        })
      );
      this.players[this.players.length - 1].team = this.teamMode ? (idx < total / 2 ? 0 : 1) : null;
    }
    this.total = total;
  }

  /* ----------------------------------------------------------------- round */

  startRound() {
    this.rng = makeRng((this.opts.seed + this.round * 7919) >>> 0);
    this.def = arenaDef(this.opts.arenaId);
    this.arena = new Arena({
      arenaId: this.opts.arenaId,
      radius: this.opts.arenaRadius,
      rng: this.rng,
      mixSpecials: ARENA.mixSpecials + Math.min(0.1, (this.round - 1) * 0.02),
    });
    // --- variety layer: exactly one round modifier
    this.modifier = this.opts.modifier || rollModifier(this.rng);
    this.arena.modCrack = this.modifier === 'fastTiles' ? 0.55 : 1;
    for (const p of this.players) {
      p.dashMax = this.modifier === 'doubleJump' ? 2 : 1;
    }
    this.eventT = (15 + this.rng() * 10) * (this.modifier === 'chaos' ? 0.5 : 1);
    this.iceT = 0;
    this.lowGravT = 0;
    this.darkT = 0;
    this.blackoutT = 0;
    this.tornado = null;
    this.lavaT = 0;
    this.lavaAngle = this.rng() * 6.28;
    this.lavaTick = 0;
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

    this.emit('roundStart', {
      round: this.round,
      players: this.players.map((p) => p.name),
      modifier: this.modifier,
      arenaId: this.opts.arenaId,
    });
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
    this.trackFootwork(dt);
    this.arena.update(dt);
    this.updateEvents(dt);
    this.updatePowerups(dt);

    // eliminations
    for (const p of this.players) {
      if (!p.alive && p.place === 0) {
        p.place = this.players.length - this.elimOrder.length;
        this.elimOrder.push(p);
        this.emit('eliminated', { player: p, place: p.place });
        const killer = this.players.find((o) => o.id === p.bumpedBy);
        const friendly = this.teamMode && killer && p.team === killer.team;
        if (killer && killer.alive && !friendly && this.time - p.bumpedAt < PLAYER.killCreditWindow) {
          killer.stats.eliminations++;
          this.emit('shovedOff', { killer, victim: p });
        }
        this.shake = Math.min(1.2, this.shake + 0.7);
      }
    }

    const alive = this.alivePlayers();
    const teamsLeft = this.teamMode ? new Set(alive.map((p) => p.team)).size : alive.length;
    if (teamsLeft <= 1 || this.roundT <= 0) this.endRound(alive);
  }

  /** Landing combos + near-miss detection (juice layer). */
  trackFootwork(dt) {
    for (const p of this.players) {
      if (!p.alive) continue;
      const air = p.hopT > 0 || p.dashT > 0 || p.falling;
      const t = p.tile;
      const supported = t && (t.state === TILE.SOLID || t.state === TILE.CRACKED);
      if (!air && supported && p.wasAir) {
        p.combo++;
        p.comboT = 2.6;
        this.emit('combo', { player: p, n: p.combo });
        if (p.combo % 3 === 0) this.givePoints(p, 5);
      }
      p.wasAir = air;
      if (t !== p.prevTile) {
        if (
          p.prevTile &&
          (p.prevTile.state === TILE.CRACKED || p.prevTile.state === TILE.FALLING) &&
          this.time - p.prevLeaveT < 0.7
        ) {
          this.emit('nearMiss', { player: p });
          this.givePoints(p, 3);
        }
        p.prevTile = t;
        p.prevLeaveT = this.time;
      }
    }
  }

  givePoints(p, n) {
    p.points += n * (p.starT > 0 ? 2 : 1);
  }

  /** Random event scheduler — the second anti-repetition layer. */
  updateEvents(dt) {
    if (this.state !== ROUND_STATE.PLAYING) return;
    this.iceT = Math.max(0, this.iceT - dt);
    this.lowGravT = Math.max(0, this.lowGravT - dt);
    this.darkT = Math.max(0, this.darkT - dt);
    this.blackoutT = Math.max(0, this.blackoutT - dt);

    if (this.tornado) {
      this.tornado.t -= dt;
      this.tornado.a += dt * 2.4;
      this.tornado.x += Math.cos(this.tornado.a * 0.4) * 60 * dt;
      this.tornado.y += Math.sin(this.tornado.a * 0.3) * 60 * dt;
      for (const p of this.players) {
        if (!p.alive) continue;
        const dx = p.x - this.tornado.x;
        const dy = p.y - this.tornado.y;
        const d = Math.hypot(dx, dy);
        if (d < 260 && d > 1) {
          const pull = (1 - d / 260) * 420;
          p.vx += ((-dy / d) * 0.9 - (dx / d) * 0.55) * pull * dt;
          p.vy += ((dx / d) * 0.9 - (dy / d) * 0.55) * pull * dt;
        }
      }
      if (this.tornado.t <= 0) this.tornado = null;
    }

    if (this.lavaT > 0) {
      this.lavaT -= dt;
      this.lavaAngle += dt * 0.9;
      this.lavaTick -= dt;
      if (this.lavaTick <= 0) {
        this.lavaTick = 0.5;
        const ca = Math.cos(this.lavaAngle);
        const sa = Math.sin(this.lavaAngle);
        for (const t of this.arena.list) {
          if (t.state !== TILE.SOLID) continue;
          const along = Math.abs(t.x * -sa + t.y * ca);
          const dist = Math.hypot(t.x, t.y);
          if (along < this.arena.size * 0.6 && dist < this.arena.worldRadius * 0.8) {
            this.arena.forceCrack(t, 0.8);
          }
        }
      }
    }

    if (this.modifier === 'suddenLava') {
      this.lavaTick2 = (this.lavaTick2 ?? 5) - dt;
      if (this.lavaTick2 <= 0) {
        this.lavaTick2 = 6;
        const solid = this.arena.list.filter((t) => t.state === TILE.SOLID && t.d > 0);
        for (let i = 0; i < 2 && solid.length; i++) {
          const t = solid[Math.floor(this.rng() * solid.length)];
          this.arena.forceCrack(t, 0.7);
          this.emit('lava', { x: t.x, y: t.y });
        }
      }
    }

    this.eventT -= dt;
    if (this.eventT > 0) return;
    this.eventT = (15 + this.rng() * 10) * (this.modifier === 'chaos' ? 0.5 : 1);
    const pool = this.def.eventPool;
    const kind = pool[Math.floor(this.rng() * pool.length)];
    this.triggerEvent(kind);
  }

  triggerEvent(kind) {
    const a = this.arena;
    switch (kind) {
      case 'quake':
        a.quake(ARENA.quakeBase + 1);
        break;
      case 'shockwave':
        for (const p of this.players) {
          if (!p.alive) continue;
          const d = Math.hypot(p.x, p.y) || 1;
          p.vx += (p.x / d) * 380;
          p.vy += (p.y / d) * 380;
        }
        this.shake = Math.min(1.2, this.shake + 0.8);
        break;
      case 'tornado':
        this.tornado = { x: (this.rng() - 0.5) * a.worldRadius, y: (this.rng() - 0.5) * a.worldRadius, a: 0, t: 5 };
        break;
      case 'ice':
        this.iceT = 5;
        break;
      case 'speed':
        for (const p of this.players) if (p.alive) p.speedT = Math.max(p.speedT, 4);
        break;
      case 'blackout':
        this.blackoutT = 3.5;
        break;
      case 'darkness':
        this.darkT = 5;
        break;
      case 'lowGrav':
        this.lowGravT = 6;
        break;
      case 'lavaWave':
        this.lavaT = 5;
        this.lavaTick = 0;
        break;
      case 'collapseWave': {
        const ring = a.list.filter((t) => t.d === a.maxRing - 1 && t.state === TILE.SOLID);
        for (const t of ring.slice(0, 6)) a.forceCrack(t, 0.9);
        this.shake = Math.min(1.2, this.shake + 0.6);
        break;
      }
      default:
        a.quake(ARENA.quakeBase);
        break;
    }
    this.emit('event', { kind });
  }

  frameCtx(dt) {
    const slip =
      (this.modifier === 'slippery' || this.iceT > 0 ? 0.35 : 1) *
      (this.modifier === 'lowGrav' || this.lowGravT > 0 ? 0.55 : 1);
    return {
      time: this.time,
      dt,
      slipMul: slip,
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
      this.nextPowerup = clamp(8 + this.rng() * 6 - (this.round - 1) * 0.4 - (6 - alive) * 0.3, 4, 14);
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
    let winTeam = null;
    if (this.teamMode) {
      const byTeam = [0, 1].map((tm) => alive.filter((p) => p.team === tm));
      winTeam =
        byTeam[0].length && !byTeam[1].length
          ? 0
          : byTeam[1].length && !byTeam[0].length
            ? 1
            : byTeam[0].length === byTeam[1].length
              ? null
              : byTeam[0].length > byTeam[1].length
                ? 0
                : 1;
      if (winTeam === null) {
        const pts = [0, 1].map((tm) => this.players.filter((p) => p.team === tm).reduce((s2, p) => s2 + p.points, 0));
        winTeam = pts[0] === pts[1] ? null : pts[0] > pts[1] ? 0 : 1;
      }
    }
    if (alive.length >= 1) {
      // survivors share the top spot (ties happen when the clock runs out)
      for (const p of alive) {
        p.place = 1;
        p.wins += !this.teamMode && alive.length === 1 ? 1 : this.teamMode && p.team === winTeam ? 1 : 0;
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
    let decided = false;
    if (this.teamMode) {
      const tw = this.teamWins();
      decided = Math.max(tw[0], tw[1]) >= this.opts.roundsToWin || this.round >= this.opts.maxRounds;
      if (decided) this.matchWinner = tw[0] === tw[1] ? null : tw[0] > tw[1] ? { team: 0 } : { team: 1 };
    } else {
      decided = (leader && leader.wins >= this.opts.roundsToWin) || this.round >= this.opts.maxRounds;
      if (decided && leader) {
        this.matchWinner = leader;
        leader.points += 3;
      }
    }

    this.lastRound = {
      round: this.round,
      results,
      timedOut: this.roundT <= 0 && alive.length > 1,
      standings: this.standings(),
      teamWinner: winTeam,
      modifier: this.modifier,
      arenaId: this.opts.arenaId,
    };
    this.emit('roundEnd', this.lastRound);
  }

  teamWins() {
    const tw = [0, 0];
    for (const p of this.players) if (p.team === 0 || p.team === 1) tw[p.team] += p.wins;
    return tw;
  }

  standings() {
    return this.players
      .slice()
      .sort((a, b) => b.wins - a.wins || b.points - a.points || a.name.localeCompare(b.name));
  }

  /** Quick reaction / emote bubble above a player. */
  emote(player, emoji) {
    if (!player || !player.alive) return;
    player.emote = String(emoji).slice(0, 8);
    player.emoteT = 2.2;
    this.emit('emote', { player, emoji: player.emote });
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
