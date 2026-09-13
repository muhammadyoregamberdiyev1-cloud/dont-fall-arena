/**
 * Onlayn o'yin klienti.
 *
 * Model: xona **host**'i simulyatsiyani o'z brauzerida yuritadi va holat
 * snapshot'larini (15 Hz) relay-server orqali mehmonlarga oqizadi; mehmonlar
 * esa faqat o'z inputlarini yuboradi. Server (server/main.py) faqat
 * xonalar/relay/statistika bilan shug'ullanadi.
 */

import { Arena } from './arena.js?v=20260913';
import { createPlayer } from './player.js?v=20260913';
import { makeRng } from './rng.js?v=20260913';
import { POWERUPS, PLAYER, TILE, ARENA } from './config.js?v=20260913';
import { approach } from './rng.js?v=20260913';

export const NET_STATE = { OFF: 'off', CONNECTING: 'connecting', LOBBY: 'lobby', PLAYING: 'playing' };
const SNAP_HZ = 15;
const INPUT_HZ = 25;
const PU_KEYS = Object.keys(POWERUPS);

/**
 * Relay server manzillari (ustunlik tartibida):
 *   1. ?server=... yoki localStorage['arena.server']
 *   2. same-origin  → tools/serve.mjs /ws ni 127.0.0.1:8081 ga tunnel qiladi
 *   3. alohida port → 8081 (e2b preview: 8080-<id> → 8081-<id>)
 */
export function wsUrls() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  try {
    const q = new URLSearchParams(location.search).get('server');
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('arena.server') : null;
    const explicit = q || saved;
    if (explicit) {
      if (q && typeof localStorage !== 'undefined') localStorage.setItem('arena.server', q);
      return [explicit.replace(/^http/, 'ws')];
    }
  } catch {
    /* ignore */
  }
  const out = [];
  if (location.host) out.push(`${proto}://${location.host}/ws`);
  const m = location.hostname.match(/^(\d+)-(.+)$/);
  out.push(m ? `${proto}://8081-${m[2]}/ws` : `${proto}://${location.hostname}:8081/ws`);
  return [...new Set(out)];
}

export function wsUrl() {
  return wsUrls()[0];
}

const STATE_CODE = { countdown: 0, playing: 1, roundEnd: 2, matchEnd: 3 };
const CODE_STATE = ['countdown', 'playing', 'roundEnd', 'matchEnd'];

/* ------------------------------------------------------------------ host */

export class NetHost {
  constructor(net) {
    this.net = net;
    this.tileStates = null;
    this.acc = 0;
    this.inputAcc = 0;
  }

  reset(match) {
    this.tileStates = new Uint8Array(match.arena.list.length);
    for (let i = 0; i < match.arena.list.length; i++) this.tileStates[i] = match.arena.list[i].state;
    this.acc = 0;
  }

  roundMessage(match) {
    return {
      seed: match.opts.seed,
      radius: match.opts.arenaRadius,
      mix: match.arena.mixSpecials,
      round: match.round,
      maxRounds: match.opts.maxRounds,
      roundsToWin: match.opts.roundsToWin,
      roundTime: match.opts.roundTime,
      arenaId: match.opts.arenaId,
      mode: match.opts.mode,
      modifier: match.modifier || 'normal',
    };
  }

  /** Call every frame on the host; streams deltas + snapshots. */
  tick(match, dt, events) {
    const net = this.net;
    if (!net.connected || net.guestCount() === 0) return;

    // tile deltas
    const td = [];
    const list = match.arena.list;
    for (let i = 0; i < list.length; i++) {
      const st = list[i].state;
      if (st !== this.tileStates[i]) {
        this.tileStates[i] = st;
        const item = [i, st];
        if (st === TILE.CRACKED) item.push(Math.round(list[i].timer * 20));
        td.push(item);
      }
    }
    if (td.length) net.send({ t: 'ev', d: { td } });

    // events worth mirroring
    const ev = [];
    for (const e of events) {
      switch (e.type) {
        case 'crack':
        case 'fall':
        case 'stabilize':
          ev.push([e.type, Math.round(e.x), Math.round(e.y), e.mat || '']);
          break;
        case 'dash':
        case 'slip':
        case 'scramble':
        case 'doomed':
          ev.push([e.type, slotOf(match, e.player), 0, '']);
          break;
        case 'bump':
          ev.push(['bump', Math.round(e.x), Math.round(e.y), '']);
          break;
        case 'fell':
          ev.push(['fell', slotOf(match, e.player), 0, '']);
          break;
        case 'shovedOff':
          ev.push(['shovedOff', slotOf(match, e.killer), slotOf(match, e.victim), '']);
          break;
        case 'powerup':
          ev.push(['powerup', slotOf(match, e.player), PU_KEYS.indexOf(e.kind), '']);
          break;
        case 'powerupSpawn':
          ev.push(['powerupSpawn', e.q, e.r, e.type]);
          break;
        case 'quake':
        case 'collapse':
        case 'go':
          ev.push([e.type, 0, 0, '']);
          break;
        case 'count':
          ev.push(['count', e.n, 0, '']);
          break;
        default:
          break;
      }
    }
    if (ev.length) net.send({ t: 'ev', d: { ev } });

    // snapshots at SNAP_HZ
    this.acc += dt;
    if (this.acc < 1 / SNAP_HZ) return;
    this.acc = 0;

    const ps = match.players.map((p) => [
      Math.round(p.x * 4) / 4,
      Math.round(p.y * 4) / 4,
      Math.round(p.facing * 64) / 64,
      p.alive ? 1 : 0,
      Math.round(p.fallT * 50) / 50,
      flagsOf(p),
      Math.round((p.dashCd / PLAYER.dashCooldown) * 50) / 50,
      p.wins,
      p.points,
    ]);
    const pu = match.powerups.map((x) => [x.q, x.r, PU_KEYS.indexOf(x.type), Math.round(x.life)]);
    const snap = {
      st: STATE_CODE[match.state] ?? 1,
      r: match.round,
      rt: Math.round(match.roundT * 4) / 4,
      cd: Math.round(match.stateT * 4) / 4,
      ring: match.arena.maxRing,
      warn: Math.round(match.arena.collapseWarn * 10) / 10,
      sh: Math.round(match.shake * 50) / 50,
      ps,
      pu,
    };
    if (match.state === 'roundEnd' && match.lastRound) {
      snap.res = match.lastRound.results.map((r) => [slotOf(match, r.player), r.place, r.winner ? 1 : 0]);
      snap.stand = match.lastRound.standings.map((p) => [slotOf(match, p), p.wins, p.points]);
      snap.to = match.lastRound.timedOut ? 1 : 0;
    }
    if (match.state === 'matchEnd') {
      snap.stand = match.standings().map((p) => [slotOf(match, p), p.wins, p.points]);
      snap.win = match.matchWinner ? slotOf(match, match.matchWinner) : -1;
    }
    net.send({ t: 'snap', d: snap });
  }
}

function slotOf(match, player) {
  return player ? player.netSlot ?? 0 : 0;
}

function flagsOf(p) {
  let f = 0;
  if (p.falling) f |= 1;
  if (p.doomed) f |= 2;
  if (p.phantomT > 0) f |= 4;
  if (p.freezeT > 0) f |= 8;
  if (p.speedT > 0) f |= 16;
  if (p.titanT > 0) f |= 32;
  if (p.hopT > 0) f |= 64;
  if (p.dashT > 0) f |= 128;
  return f;
}

/* ----------------------------------------------------------------- guest */

export function buildGuestView(cfg, roster, mySlot) {
  const rng = makeRng((cfg.seed + cfg.round * 7919) >>> 0);
  const arena = new Arena({
    arenaId: cfg.arenaId || 'color_grid',
    radius: cfg.radius,
    rng,
    mixSpecials: cfg.mix ?? ARENA.mixSpecials,
  });
  arena.modCrack = cfg.modifier === 'fastTiles' ? 0.55 : 1;
  const players = roster.map((r) => {
    const p = createPlayer({
      id: 1000 + r.slot,
      name: r.name,
      color: r.color,
      isBot: false,
      isLocal: r.slot === mySlot,
    });
    p.netSlot = r.slot;
    p.team = cfg && cfg.mode && cfg.mode !== 'solo' ? (r.team ?? 0) : null;
    p.wins = 0;
    p.points = 0;
    return p;
  });
  const spawns = arena.spawnPoints(players.length);
  players.forEach((p, i) => {
    const t = spawns[i % spawns.length];
    p.x = p.tx = t.x;
    p.y = p.ty = t.y;
    p.facing = Math.atan2(-t.y, -t.x);
    p.tile = t;
  });
  return {
    arena,
    players,
    powerups: [],
    shake: 0,
    state: 'countdown',
    stateT: 3,
    round: cfg.round,
    roundT: cfg.roundTime ?? ARENA.roundTime,
    opts: { maxRounds: cfg.maxRounds ?? 7, roundsToWin: cfg.roundsToWin ?? 3, arenaRadius: cfg.radius },
    lastRound: null,
    matchWinner: null,
    paused: false,
    isGuestView: true,
  };
}

export class NetGuest {
  constructor(net) {
    this.net = net;
    this.view = null;
    this.acc = 0;
    this.events = [];
  }

  startRound(cfg, roster, mySlot) {
    this.view = buildGuestView(cfg, roster, mySlot);
    return this.view;
  }

  /** Apply a snapshot; returns list of ui/audio events for main.js. */
  applySnap(d) {
    const v = this.view;
    if (!v) return [];
    const out = [];
    v.state = CODE_STATE[d.st] ?? 'playing';
    v.round = d.r;
    v.roundT = d.rt;
    v.stateT = d.cd;
    v.arena.maxRing = d.ring;
    v.arena.collapseWarn = d.warn;
    v.shake = d.sh;

    d.ps.forEach((row, i) => {
      const p = v.players[i];
      if (!p) return;
      p.tx = row[0];
      p.ty = row[1];
      p.tf = row[2];
      p.alive = !!row[3];
      p.fallT = row[4];
      const f = row[5];
      p.falling = !!(f & 1);
      p.doomed = !!(f & 2);
      p.phantomT = f & 4 ? 1 : 0;
      p.freezeT = f & 8 ? 1 : 0;
      p.speedT = f & 16 ? 1 : 0;
      p.titanT = f & 32 ? 1 : 0;
      p.hopT = f & 64 ? 0.1 : 0;
      p.dashT = f & 128 ? 0.1 : 0;
      p.dashCd = row[6] * PLAYER.dashCooldown;
      p.wins = row[7];
      p.points = row[8];
    });

    // powerups
    v.powerups = (d.pu || []).map(([q, r, ti, life]) => {
      const tile = v.arena.get(q, r);
      const type = PU_KEYS[ti] || 'speed';
      return { type, q, r, x: tile ? tile.x : 0, y: tile ? tile.y : 0, t: 0, life, def: POWERUPS[type] };
    });

    if (d.res) {
      v.lastRound = {
        results: d.res.map(([slot, place, winner]) => ({
          player: v.players.find((p) => p.netSlot === slot) || v.players[0],
          place,
          winner: !!winner,
        })),
        standings: (d.stand || []).map(([slot, wins, points]) => {
          const p = v.players.find((x) => x.netSlot === slot) || v.players[0];
          p.wins = wins;
          p.points = points;
          return p;
        }),
        timedOut: !!d.to,
      };
      out.push({ type: 'roundEnd', data: v.lastRound });
    }
    if (d.st === 3 && d.stand) {
      v.matchWinner = v.players.find((p) => p.netSlot === d.win) || null;
      out.push({ type: 'matchEnd' });
    }
    return out;
  }

  applyEv(d) {
    const v = this.view;
    if (!v) return [];
    const out = [];
    if (d.td) {
      for (const [i, st, t10] of d.td) {
        const tile = v.arena.list[i];
        if (!tile) continue;
        tile.state = st;
        if (st === TILE.CRACKED) tile.timer = (t10 || 0) / 20;
        if (st === TILE.FALLING) tile.fallT = 0;
      }
    }
    for (const e of d.ev || []) {
      const [type, a, b, s] = e;
      const player = typeof a === 'number' && a < 100 ? v.players.find((p) => p.netSlot === a) : null;
      const other = typeof b === 'number' && b < 100 ? v.players.find((p) => p.netSlot === b) : null;
      switch (type) {
        case 'crack':
        case 'fall':
        case 'stabilize':
          out.push({ type, x: a, y: b, mat: s || 'normal' });
          break;
        case 'dash':
        case 'slip':
        case 'scramble':
        case 'doomed':
          if (player) out.push({ type, player, x: player.x, y: player.y });
          break;
        case 'bump':
          out.push({ type, x: a, y: b, power: player });
          break;
        case 'fell':
          if (player) out.push({ type, player, x: player.x, y: player.y });
          break;
        case 'shovedOff':
          if (player && other) out.push({ type, killer: player, victim: other });
          break;
        case 'powerup':
          if (player) out.push({ type, player, kind: PU_KEYS[b], x: player.x, y: player.y, def: POWERUPS[PU_KEYS[b]] });
          break;
        case 'quake':
        case 'collapse':
        case 'go':
          out.push({ type });
          break;
        case 'count':
          out.push({ type, n: a });
          break;
        default:
          break;
      }
    }
    return out;
  }

  /** Interpolate toward the latest snapshot. */
  interpolate(dt) {
    const v = this.view;
    if (!v) return;
    for (const p of v.players) {
      p.x = approach(p.x, p.tx ?? p.x, 18, dt);
      p.y = approach(p.y, p.ty ?? p.y, 18, dt);
      if (p.tf !== undefined) {
        let diff = p.tf - p.facing;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        p.facing += diff * Math.min(1, dt * 14);
      }
      p.tile = v.arena.tileAt(p.x, p.y);
      p.trail.push({ x: p.x, y: p.y, t: 0 });
      if (p.trail.length > 18) p.trail.shift();
      for (const t of p.trail) t.t += dt;
      if (p.dashT > 0) p.dashTrail.push({ x: p.x, y: p.y, life: 0.35 });
      for (let i = p.dashTrail.length - 1; i >= 0; i--) {
        p.dashTrail[i].life -= dt;
        if (p.dashTrail[i].life <= 0) p.dashTrail.splice(i, 1);
      }
      // keep falling tiles animating locally
    }
    for (const t of v.arena.list) {
      if (t.state === TILE.FALLING) {
        t.fallT += dt;
        if (t.fallT > 0.6) t.state = TILE.GONE;
      } else if (t.state === TILE.CRACKED) {
        t.timer -= dt;
        if (t.timer <= 0) {
          t.state = TILE.FALLING;
          t.fallT = 0;
        }
      }
      t.wobbleT += dt * 3;
      t.flash *= Math.exp(-8 * dt);
    }
    for (const pu of v.powerups) pu.t += dt;
  }
}

/* ------------------------------------------------------------ connection */

export class Net {
  constructor() {
    this.ws = null;
    this.state = NET_STATE.OFF;
    this.id = null;
    this.name = 'O\'yinchi';
    this.room = null;
    this.roster = [];
    this.hostId = null;
    this.mySlot = -1;
    this.role = null; // 'host' | 'guest'
    this.chat = [];
    this.error = null;
    this.token = null;
    this.queue = null;         // {mode, ranked, allowBots}
    this.vote = null;          // {arenas, secs, endsAt, counts, myVote, bots}
    this.party = null;
    this.rewards = null;
    this.handlers = {};
    this.host = new NetHost(this);
    this.guest = new NetGuest(this);
    this.inputAcc = 0;
    this.lastInput = null;
    this.remoteInputs = new Map();
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  emit(name, data) {
    if (this.handlers[name]) this.handlers[name](data);
  }

  get connected() {
    return !!this.ws && this.ws.readyState === 1;
  }

  guestCount() {
    return this.roster.length - 1;
  }

  connect(name, pid) {
    if (this.connected || this.state === NET_STATE.CONNECTING) return;
    this.name = name || this.name;
    this.pid = pid || this.pid || '';
    this.reconnectToken = this.loadToken();
    this.error = null;
    this.gotWelcome = false;
    this.candidates = wsUrls();
    this.tryIndex = 0;
    this.state = NET_STATE.CONNECTING;
    this.emit('status');
    this.tryNext();
  }

  /** Nomzod manzillarni ketma-ket sinab ko'radi (same-origin → 8081). */
  tryNext() {
    if (this.state !== NET_STATE.CONNECTING) return;
    const url = this.candidates[this.tryIndex];
    if (!url) {
      this.fail(this.error || 'relay server topilmadi');
      return;
    }
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      this.tryIndex++;
      setTimeout(() => this.tryNext(), 60);
      return;
    }
    this.ws = ws;
    ws.onopen = () =>
      this.send({
        t: 'hello',
        name: this.name,
        pid: this.pid || '',
        token: this.state === NET_STATE.CONNECTING && this.reconnectToken ? this.reconnectToken : '',
      });
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      this.receive(msg);
    };
    ws.onerror = () => {
      if (!this.gotWelcome) this.error = 'relay javob bermadi: ' + url.replace(/^wss?:\/\//, '');
    };
    ws.onclose = () => {
      this.ws = null;
      if (!this.gotWelcome && this.state === NET_STATE.CONNECTING && this.tryIndex + 1 < this.candidates.length) {
        this.tryIndex++;
        setTimeout(() => this.tryNext(), 90);
        return;
      }
      const was = this.state;
      this.state = NET_STATE.OFF;
      this.room = null;
      this.roster = [];
      this.role = null;
      if (was !== NET_STATE.OFF) this.fail(this.gotWelcome ? 'ulanish uzildi' : this.error || 'relay server topilmadi');
      this.emit('status');
    };
  }

  loadToken() {
    try {
      return sessionStorage.getItem('arena.token') || '';
    } catch {
      return '';
    }
  }

  saveToken(tok) {
    this.token = tok;
    try {
      sessionStorage.setItem('arena.token', tok);
    } catch {
      /* ignore */
    }
  }

  fail(msg) {
    this.error = msg;
    this.state = NET_STATE.OFF;
    this.emit('status');
    this.emit('error', msg);
  }

  send(obj) {
    if (this.connected) this.ws.send(JSON.stringify(obj));
  }

  disconnect() {
    if (this.ws) {
      try {
        this.send({ t: 'leave' });
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
    this.state = NET_STATE.OFF;
    this.room = null;
    this.role = null;
    this.roster = [];
    this.emit('status');
  }

  receive(msg) {
    switch (msg.t) {
      case 'welcome':
        this.gotWelcome = true;
        this.id = msg.id;
        this.state = NET_STATE.LOBBY;
        this.error = null;
        if (msg.token) this.saveToken(msg.token);
        this.emit('status');
        this.emit('rooms', msg.rooms || []);
        if (msg.reconnect) this.emit('reconnect', msg);
        break;
      case 'queued':
        this.queue = { mode: msg.mode, ranked: msg.ranked };
        this.emit('queue', msg);
        break;
      case 'unqueued':
        this.queue = null;
        this.emit('queue', null);
        break;
      case 'queue_fail':
        this.queue = null;
        this.emit('queuefail', msg);
        break;
      case 'match_found':
        this.queue = null;
        this.roster = msg.roster || [];
        this.emit('matchfound', msg);
        break;
      case 'vote_start':
        this.vote = {
          arenas: msg.arenas || [],
          secs: msg.secs || 9,
          startedAt: Date.now(),
          counts: {},
          myVote: null,
          bots: msg.bots || [],
          roster: msg.roster || this.roster,
        };
        if (msg.roster) this.roster = msg.roster;
        this.emit('votestart', this.vote);
        break;
      case 'vote_update':
        if (this.vote) {
          this.vote.counts = msg.counts || {};
          this.vote.voted = msg.voted;
        }
        this.emit('voteupdate', this.vote);
        break;
      case 'vote_result':
        if (this.vote) this.vote.result = msg.arena;
        this.emit('voteresult', msg);
        break;
      case 'party_update':
        this.party = msg.party || null;
        this.emit('party', this.party);
        break;
      case 'rewards':
        this.rewards = msg.rewards;
        this.emit('rewards', msg.rewards);
        break;
      case 'peer_rejoined':
        this.roster = msg.roster || this.roster;
        this.emit('roster');
        this.emit('rejoined', msg);
        break;
      case 'created':
      case 'joined': {
        this.room = msg.room;
        this.roster = msg.roster || [];
        this.hostId = msg.host;
        this.mySlot = msg.slot ?? this.roster.findIndex((r) => r.id === this.id);
        this.myTeam = msg.team ?? null;
        this.roomMode = msg.mode || 'solo';
        this.roomRanked = !!msg.ranked;
        this.roomPhase = msg.phase || 'lobby';
        this.role = this.hostId === this.id ? 'host' : 'guest';
        this.state = NET_STATE.LOBBY;
        this.emit('roster');
        this.emit('status');
        if (msg.phase === 'vote') this.emit('needvote');
        if (msg.phase === 'playing' && msg.cfg) this.emit('start', { cfg: msg.cfg, roster: this.roster, host: msg.host });
        break;
      }
      case 'peer_joined':
      case 'peer_left': {
        const hostLeft = msg.t === 'peer_left' && msg.id === this.hostId && msg.id !== this.id;
        this.roster = msg.roster || this.roster;
        if (msg.host) this.hostId = msg.host;
        this.role = this.hostId === this.id ? 'host' : 'guest';
        this.emit('roster');
        this.emit('peer', msg);
        if (hostLeft && this.state === NET_STATE.PLAYING) this.emit('hostleft', msg);
        break;
      }
      case 'room_chat':
        this.chat.push({ name: msg.name, text: msg.text });
        if (this.chat.length > 40) this.chat.shift();
        this.emit('chat', msg);
        break;
      case 'room_start': {
        this.roster = msg.roster || this.roster;
        this.roomPhase = 'playing';
        this.state = NET_STATE.PLAYING;
        this.vote = null;
        this.emit('start', msg);
        break;
      }
      case 'in':
        this.remoteInputs.set(msg.slot, msg.d);
        break;
      case 'rstart':
        this.emit('rstart', msg.d);
        break;
      case 'snap':
        this.emit('snap', msg.d);
        break;
      case 'ev':
        this.emit('ev', msg.d);
        break;
      case 'emote':
        this.emit('emote', { slot: msg.slot, e: msg.d });
        break;
      case 'rooms':
        this.emit('rooms', msg.rooms || []);
        break;
      case 'pong':
        break;
      case 'error':
        this.error = msg.msg;
        this.emit('error', msg.msg);
        break;
      default:
        break;
    }
  }

  /* lobby actions */
  create(mode = 'solo', ranked = false, allowBots = true) {
    this.send({ t: 'create', mode, ranked, allowBots });
  }

  queue(mode, ranked, allowBots) {
    this.send({ t: 'queue', mode, ranked, allowBots });
  }

  unqueue() {
    this.send({ t: 'unqueue' });
  }

  vote(arena, botVotes) {
    if (this.vote) this.vote.myVote = arena;
    this.send({ t: 'vote', arena, bots: botVotes || undefined });
  }

  emote(e) {
    this.send({ t: 'emote', d: String(e).slice(0, 8) });
  }

  partyCreate() {
    this.send({ t: 'party_create' });
  }

  partyJoin(code) {
    this.send({ t: 'party_join', code });
  }

  partyLeave() {
    this.send({ t: 'party_leave' });
  }

  partyKick(id) {
    this.send({ t: 'party_kick', id });
  }

  partyTransfer(id) {
    this.send({ t: 'party_transfer', id });
  }

  join(code) {
    this.send({ t: 'join', room: code });
  }

  leaveRoom() {
    this.send({ t: 'leave' });
    this.room = null;
    this.roster = [];
    this.role = null;
    this.state = this.connected ? NET_STATE.LOBBY : NET_STATE.OFF;
    this.emit('roster');
    this.emit('status');
  }

  refreshRooms() {
    this.send({ t: 'rooms' });
  }

  chatSend(text) {
    this.send({ t: 'chat', text });
  }

  startMatch(cfg) {
    this.send({ t: 'start', cfg });
  }

  reportResult(results) {
    this.send({ t: 'result', results });
  }

  /** host: submit bot votes together with own vote (casual only) */

  /* in-game */
  sendInput(input, dt) {
    this.inputAcc += dt;
    const changed =
      !this.lastInput ||
      Math.abs(input.mx - this.lastInput.mx) > 0.02 ||
      Math.abs(input.my - this.lastInput.my) > 0.02 ||
      input.dash !== this.lastInput.dash;
    if (this.inputAcc < 1 / INPUT_HZ && !input.dash) return;
    if (!changed && !input.dash) return;
    this.inputAcc = 0;
    this.lastInput = { ...input };
    this.send({ t: 'in', d: { mx: Math.round(input.mx * 100) / 100, my: Math.round(input.my * 100) / 100, dash: !!input.dash } });
  }

  inputFor(slot) {
    return this.remoteInputs.get(slot) || { mx: 0, my: 0, dash: false };
  }
}
