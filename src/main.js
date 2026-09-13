/**
 * Boot + game loop. Glues the simulation (match.js) to the presentation
 * (render.js, audio.js, ui.js) and owns the app-level state machine.
 */

import { Match, ROUND_STATE } from './match.js?v=20260913';
import { Renderer } from './render.js?v=20260913';
import { Sfx } from './audio.js?v=20260913';
import { Input } from './input.js?v=20260913';
import { UI } from './ui.js?v=20260913';
import { Profile } from './profile.js?v=20260913';
import { ARENA, POWERUPS, THEMES, SKINS, PALETTE } from './config.js?v=20260913';
import { Net, NET_STATE } from './net.js?v=20260913';

const STEP = 1 / 60;
const MAX_STEPS = 5;

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new Renderer(this.canvas);
    this.sfx = new Sfx();
    this.input = new Input(this.canvas);
    this.profile = new Profile();
    this.ui = new UI(this.profile);
    this.net = new Net();
    this.ui.netRef = this.net;
    this.netRoomsList = [];
    this.netEvents = [];
    this.hitStop = 0;
    this.matchStartedAt = 0;

    this.match = null;
    this.attract = null;
    this.state = 'menu';
    this.acc = 0;
    this.last = performance.now();
    this.sfxThrottle = {};

    document.documentElement.lang = this.profile.data.lang;
    this.sfx.setEnabled(this.profile.data.sound);
    this.sfx.setMusicEnabled(this.profile.data.music);
    this.ui.setSoundIcon(this.profile.data.sound);
    this.renderer.setTheme(this.profile.theme());

    this.ui.on('start', () => this.startMatch());
    this.ui.on('rematch', () => {
      const role = this.netRole();
      if (role === 'host') {
        // xona ichida qayta o'yin: server room_start ni hammaga (host'ga ham) qaytaradi
        this.net.startMatch({ ...(this.onlineCfg || {}), seed: (Math.random() * 1e9) | 0 });
      } else if (role === 'guest') {
        this.ui.toast(this.ui.t('waitHost'), '#ffd23f', 2200);
      } else {
        this.startMatch();
      }
    });
    this.ui.on('menu', () => this.toMenu());
    this.ui.on('resume', () => this.resume());
    this.ui.on('restart', () => this.startMatch());
    this.ui.on('pause', () => this.togglePause());
    this.ui.on('mute', () => this.toggleSound());
    this.ui.on('click', () => {
      this.sfx.unlock();
      this.sfx.play('click');
    });
    this.ui.on('sound', (v) => {
      this.sfx.unlock();
      this.sfx.setEnabled(v);
      this.ui.setSoundIcon(v);
    });
    this.ui.on('music', (v) => this.sfx.setMusicEnabled(v));
    this.ui.on('theme', (th) => this.renderer.setTheme(th));
    this.ui.on('xp', (g) => this.onXp(g));
    this.bindNet();

    this.ui.on('net-connect', () => {
      this.sfx.unlock();
      this.net.connect(this.profile.data.name);
    });
    this.ui.on('net-create', () => this.net.create());
    this.ui.on('net-join', (code) => this.net.join(code));
    this.ui.on('net-leave', () => {
      if (this.state === 'playing' || this.state === 'roundEnd' || this.state === 'over') {
        this.match = null;
        this.state = 'menu';
      }
      this.net.leaveRoom();
      this.ui.goto('online');
    });
    this.ui.on('net-start', () => {
      const seats = this.net.roster.length;
      this.net.startMatch({
        seed: Math.floor(Math.random() * 1e9),
        arenaRadius: seats <= 2 ? 5 : seats <= 4 ? 6 : 7,
        roundsToWin: 3,
        difficulty: 'normal',
      });
    });
    this.ui.on('net-chat', (text) => this.net.chatSend(text));
    this.ui.on('net-refresh', () => this.net.refreshRooms());
    this.ui.on('net-disconnect', () => this.net.disconnect());

    this.ui.on('reset', () => {
      this.renderer.setTheme(this.profile.theme());
      this.sfx.setEnabled(this.profile.data.sound);
      this.sfx.setMusicEnabled(this.profile.data.music);
      this.ui.setSoundIcon(this.profile.data.sound);
      this.ui.goto('home');
    });

    this.input.onAction = (name) => this.handleAction(name);
    window.addEventListener('keydown', () => this.sfx.unlock(), { once: true });

    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    window.addEventListener('pointerdown', () => this.sfx.unlock(), { once: true });

    this.startAttract();
    this.ui.show('menu');
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  /* ------------------------------------------------------------ online io */

  bindNet() {
    const net = this.net;
    net.on('status', () => this.ui.setNet(net));
    net.on('rooms', (rooms) => this.ui.setNetRooms(rooms));
    net.on('roster', () => this.ui.setNetRoster(net.roster, net.mySlot, net.role));
    net.on('chat', (m) => this.ui.netChatLine(m));
    net.on('error', (msg) => this.ui.toast('⚠ ' + msg, '#ff8a94', 2200));
    net.on('hostleft', () => {
      this.match = null;
      this.state = 'menu';
      this.net.leaveRoom();
      this.ui.toast(this.ui.t('hostLeft'), '#ff8a94', 3200);
      this.ui.goto('online');
    });
    net.on('peer', () => this.sfx.play('hover'));
    net.on('rstart', (cfg) => this.beginOnline(cfg));
    net.on('start', (msg) => this.beginOnline(msg.cfg, msg.roster));
    net.on('snap', (d) => {
      if (this.netRole() !== 'guest') return;
      for (const e of this.net.guest.applySnap(d)) this.netEvents.push(e);
    });
    net.on('ev', (d) => {
      if (this.netRole() !== 'guest') return;
      for (const e of this.net.guest.applyEv(d)) this.netEvents.push(e);
    });
  }

  netRole() {
    return this.net.state === NET_STATE.PLAYING ? this.net.role : null;
  }

  onlineRoster() {
    return this.net.roster.map((r) => ({ ...r, color: PALETTE[r.slot % PALETTE.length] }));
  }

  /** Both sides: (re)build the online match. Host runs the sim, guest renders a view. */
  beginOnline(cfg, rosterOverride) {
    this.onlineCfg = cfg;
    const roster = rosterOverride ? rosterOverride.map((r) => ({ ...r, color: PALETTE[r.slot % PALETTE.length] })) : this.onlineRoster();
    this.matchStartedAt = performance.now();
    if (this.net.role === 'host') {
      this.match = new Match({
        seed: cfg.seed || 1,
        humans: roster.length,
        bots: 0,
        difficulty: cfg.difficulty || 'normal',
        arenaRadius: cfg.arenaRadius || 6,
        roundsToWin: cfg.roundsToWin || 3,
        maxRounds: (cfg.roundsToWin || 3) * 2 + 1,
        roundTime: ARENA.roundTime,
        netRoster: roster.map((r) => ({ name: r.name, color: r.color, slot: r.slot, isLocal: r.id === this.net.id })),
      });
      this.net.host.reset(this.match);
    } else {
      this.match = this.net.guest.startRound(cfg, roster, this.net.mySlot);
    }
    this.attract = null;
    this.state = 'playing';
    this.netEvents.length = 0;
    this.ui.buildChips(this.match.players, this.match.opts.roundsToWin);
    this.ui.clearFeed();
    this.ui.show('hud');
    this.ui.el.hint.textContent = this.ui.t('hint1');
  }

  handleNetEvents(list) {
    for (const e of list) {
      if (e.type === 'roundEnd') {
        this.sfx.play('roundEnd');
        this.ui.showRoundEnd(e.data, this.match);
        this.state = 'roundEnd';
        continue;
      }
      if (e.type === 'matchEnd') {
        this.sfx.play('matchEnd');
        this.renderer.spawnConfetti();
        this.guestFinish();
        continue;
      }
      this.handleEvents([e]);
    }
  }

  guestFinish() {
    const v = this.match;
    const me = v.players.find((p) => p.isLocal);
    const won = !!v.matchWinner && me && v.matchWinner.netSlot === me.netSlot;
    const gains = this.profile.recordMatch({
      won,
      roundWins: me ? me.wins : 0,
      points: me ? me.points : 0,
      eliminations: 0,
      powerups: 0,
      falls: 0,
      survived: won ? 1 : 0,
      bestRoundTime: 0,
      time: Math.round((performance.now() - this.matchStartedAt) / 1000),
      difficulty: 'online',
    });
    this.state = 'over';
    this.ui.showMatchEnd(v, gains);
    if (gains.after > gains.before) this.announceLevel(gains.before, gains.after);
  }

  /* ---------------------------------------------------------------- modes */

  startAttract() {
    this.attract = new Match({
      seed: Math.floor(Math.random() * 1e9),
      humans: 0,
      bots: 5,
      difficulty: 'spicy',
      arenaRadius: 6,
      roundsToWin: 99,
      maxRounds: 999,
    });
  }

  toMenu() {
    this.state = 'menu';
    this.match = null;
    if (this.net.state === NET_STATE.PLAYING) this.net.leaveRoom();
    if (!this.attract || this.attract.state === ROUND_STATE.MATCH_END) this.startAttract();
    this.ui.goto('home');
    this.ui.show('menu');
    this.sfx.setTension(0);
  }

  startMatch() {
    this.sfx.unlock();
    this.sfx.play('start');

    const o = this.ui.opts;
    const humans = o.two ? 2 : 1;
    const bots = o.botFill ? Math.max(0, o.seats - humans) : 0;
    const skin = this.profile.skinColor();

    this.match = new Match({
      seed: Math.floor(Math.random() * 1e9),
      humans,
      bots,
      difficulty: o.difficulty,
      arenaRadius: o.seats <= 2 ? 5 : o.seats <= 4 ? 6 : 7,
      roundsToWin: 3,
      maxRounds: 7,
      roundTime: ARENA.roundTime,
      humanNames: humans > 1 ? [this.profile.data.name, this.profile.data.lang === 'uz' ? "2-o'yinchi" : 'Player 2'] : [this.profile.data.name],
      humanColors: humans > 1 ? [skin, '#4dd0ff'] : [skin],
    });
    this.attract = null;
    this.state = 'playing';
    this.ui.buildChips(this.match.players, this.match.opts.roundsToWin);
    this.ui.clearFeed();
    this.ui.show('hud');
    this.ui.el.hint.textContent = humans > 1 ? this.ui.t('hint2') : this.ui.t('hint1');
    document.body.classList.toggle('touch', this.input.isTouchDevice);
  }

  pause() {
    if (this.state !== 'playing' || !this.match) return;
    this.match.paused = true;
    this.state = 'paused';
    this.ui.show('pause');
    this.sfx.setTension(0);
  }

  resume() {
    if (!this.match) return;
    this.match.paused = false;
    this.state = 'playing';
    this.ui.show('hud');
  }

  togglePause() {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  toggleSound() {
    const p = this.profile;
    p.data.sound = !p.data.sound;
    p.save();
    this.sfx.unlock();
    this.sfx.setEnabled(p.data.sound);
    this.ui.setSoundIcon(p.data.sound);
    if (this.ui.current === 'menu') this.ui.renderMenu();
  }

  /** XP gained from the lobby (bonus / missions / achievements). */
  onXp(g) {
    this.sfx.play('powerup');
    if (g && g.after > g.before) this.announceLevel(g.before, g.after);
  }

  announceLevel(before, after) {
    this.ui.toast(this.ui.t('tLevelUp', { n: after }), '#ffe6a3', 2400);
    this.sfx.play('matchEnd');
    for (const th of THEMES) if (th.level > before && th.level <= after) this.ui.toast(this.ui.t('tUnlock', { what: th.name }), th.top, 2600);
    for (const sk of SKINS) if (sk.level > before && sk.level <= after) this.ui.toast(this.ui.t('tUnlock', { what: sk.name }), sk.color, 2600);
  }

  handleAction(name) {
    switch (name) {
      case 'pause':
        if (this.state === 'playing' || this.state === 'paused') this.togglePause();
        break;
      case 'mute':
        this.toggleSound();
        break;
      case 'restart':
        if (this.state === 'playing' || this.state === 'paused') this.startMatch();
        break;
      case 'confirm':
        if (this.state === 'menu' && this.ui.screen === 'setup') this.startMatch();
        else if (this.state === 'over') this.startMatch();
        break;
      default:
        break;
    }
  }

  /* ----------------------------------------------------------------- loop */

  loop(now) {
    requestAnimationFrame(this.loop);
    const rawDt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (rawDt <= 0) return;
    this.ui.frameMs = this.ui.frameMs * 0.9 + rawDt * 1000 * 0.1;

    if (this.state === 'menu' && this.attract) {
      this.acc += rawDt;
      let steps = 0;
      while (this.acc >= STEP && steps < MAX_STEPS) {
        this.attract.update(STEP, new Map());
        this.acc -= STEP;
        steps++;
        if (this.attract.state === ROUND_STATE.MATCH_END) this.startAttract();
      }
      if (steps >= MAX_STEPS) this.acc = 0;
      this.renderer.consume(this.attract.drainEvents(), this.attract.arena);
      this.renderer.draw(this.attract, rawDt, { focus: null });
      return;
    }

    if (!this.match) return;

    const inputs = this.input.sample(rawDt);
    const live = this.state !== 'paused';
    const role = this.netRole();

    // ---- online guest: no local simulation, just interpolate + send input
    if (role === 'guest' && this.match) {
      if (live) {
        const local = inputs.get(0) || { mx: 0, my: 0, dash: false };
        this.net.sendInput(local, rawDt);
        this.net.guest.interpolate(rawDt);
        if (this.netEvents.length) {
          const list = this.netEvents;
          this.netEvents = [];
          this.handleNetEvents(list);
        }
      }
      const meG = this.match.players.find((p) => p.isLocal);
      this.renderer.draw(this.match, rawDt, { focus: meG && meG.alive ? meG : null });
      if (this.state === 'playing') this.ui.updateHud(this.match, rawDt);
      this.updateTouchStick();
      return;
    }

    if (live) {
      if (this.hitStop > 0) {
        this.hitStop -= rawDt;
        this.renderer.draw(this.match, rawDt, { focus: this.match.players.find((p) => !p.isBot) });
        return;
      }
      this.acc += rawDt;
      let steps = 0;
      while (this.acc >= STEP && steps < MAX_STEPS) {
        const map = new Map();
        for (const p of this.match.players) {
          if (p.isBot) continue;
          let raw;
          if (p.isLocal) raw = inputs.get(p.controls) || { mx: 0, my: 0, dash: false };
          else raw = this.net.inputFor(p.netSlot);
          map.set(p.id, steps === 0 ? raw : { mx: raw.mx, my: raw.my, dash: false });
        }
        this.match.update(STEP, map);
        this.acc -= STEP;
        steps++;
        const evs = this.match.drainEvents();
        this.handleEvents(evs);
        if (role === 'host') this.pendingHostEvents = (this.pendingHostEvents || []).concat(evs);
      }
      if (steps >= MAX_STEPS) this.acc = 0;
      if (role === 'host') {
        // remote players' inputs
        this.net.host.tick(this.match, steps * STEP, this.pendingHostEvents || []);
        this.pendingHostEvents = [];
      }
    }

    const ring = this.match.arena.maxRing / Math.max(1, this.match.opts.arenaRadius);
    this.sfx.setTension(live ? Math.pow(1 - ring, 1.4) : 0.15);

    const me = this.match.players.find((p) => !p.isBot);
    this.renderer.draw(this.match, rawDt, { focus: me && me.alive ? me : null });
    if (this.state === 'playing') this.ui.updateHud(this.match, rawDt);
    this.updateTouchStick();
  }

  updateTouchStick() {
    if (!this.input.isTouchDevice) return;
    const t = this.input.touchStick;
    const stick = this.ui.el.touchStick;
    const knob = this.ui.el.touchKnob;
    if (!stick) return;
    if (t.active) {
      const rect = this.canvas.getBoundingClientRect();
      stick.style.left = `${t.ox - rect.left - 58}px`;
      stick.style.bottom = 'auto';
      stick.style.top = `${t.oy - rect.top - 58}px`;
      const dx = t.x - t.ox;
      const dy = t.y - t.oy;
      const len = Math.hypot(dx, dy);
      const k = len > 58 ? 58 / len : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    } else {
      knob.style.transform = 'translate(0,0)';
    }
  }

  /* --------------------------------------------------------------- events */

  sfxOnce(key, perSecond = 6) {
    const now = performance.now();
    const last = this.sfxThrottle[key] || 0;
    if (now - last < 1000 / perSecond) return false;
    this.sfxThrottle[key] = now;
    return true;
  }

  isHuman(p) {
    return p && !p.isBot;
  }

  esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  handleEvents(events) {
    const match = this.match;
    const t = (k, p) => this.ui.t(k, p);
    this.renderer.consume(events, match.arena);

    for (const e of events) {
      switch (e.type) {
        case 'roundStart':
          this.state = 'playing';
          if (this.netRole() === 'host') {
            this.net.host.reset(match);
            this.net.send({ t: 'rstart', d: this.net.host.roundMessage(match) });
          }
          this.ui.show('hud');
          this.ui.buildChips(match.players, match.opts.roundsToWin);
          this.ui.clearFeed();
          this.ui.setMsg(`${t('round')} ${e.round}`);
          this.ui.feed(t('feedRound', { n: e.round, k: match.players.length }));
          break;
        case 'count':
          this.ui.setMsg(String(e.n));
          this.sfx.play('count');
          break;
        case 'go':
          this.ui.setMsg('GO!');
          this.sfx.play('go');
          break;
        case 'crack':
          if (this.sfxOnce('crack', 8)) this.sfx.play('crack');
          break;
        case 'fall':
          if (this.sfxOnce('fall', 7)) this.sfx.play('fall');
          break;
        case 'quake':
          this.sfx.play('quake');
          this.ui.toast(t('tQuake'), '#ff9f45', 1200);
          break;
        case 'collapse':
          this.sfx.play('collapse');
          this.ui.setMsg(t('tCollapse'));
          this.ui.feed(t('feedCollapse', { n: e.ring }));
          break;
        case 'dash':
          if (this.isHuman(e.player)) this.sfx.play('dash');
          break;
        case 'bump':
          this.sfx.play('bump');
          this.hitStop = Math.max(this.hitStop, 0.045);
          break;
        case 'slip':
          if (this.isHuman(e.player)) this.sfx.play('slip');
          break;
        case 'doomed':
          if (this.isHuman(e.player)) {
            this.sfx.play('doomed');
            this.ui.toast(t('tFalling'), '#ff5d73', 900);
          }
          break;
        case 'scramble':
          if (this.isHuman(e.player)) this.sfx.play('scramble');
          break;
        case 'fell': {
          this.sfx.play('fell');
          this.hitStop = Math.max(this.hitStop, 0.07);
          const human = this.isHuman(e.player);
          this.ui.feed(human ? t('feedYouFell', { name: this.esc(e.player.name), c: e.player.color }) : t('feedFell', { name: this.esc(e.player.name), c: e.player.color }));
          if (human) this.ui.toast(t('tYouFell'), '#ff5d73', 2200);
          break;
        }
        case 'shovedOff': {
          const k = e.killer;
          const v = e.victim;
          this.sfx.play('shovedOff');
          this.ui.feed(t('feedShove', { a: this.esc(k.name), b: this.esc(v.name), ca: k.color, cb: v.color }));
          if (this.isHuman(k)) this.ui.toast(t('tShoved'), '#ffd23f', 1400);
          break;
        }
        case 'powerup': {
          this.sfx.play('powerup');
          const key = e.kind || e.type;
          const def = POWERUPS[key] || e.def;
          const label = this.ui.pwName(key);
          if (this.isHuman(e.player)) this.ui.toast(`${def.icon} ${label.toUpperCase()}!`, def.color, 1400);
          else this.ui.feed(t('feedPower', { name: this.esc(e.player.name), c: e.player.color, p: label }));
          break;
        }
        case 'powerupSpawn':
          if (this.sfxOnce('spawn', 3)) this.sfx.play('powerupSpawn');
          break;
        case 'powerupFade':
          this.sfx.play('powerupFade');
          break;
        case 'roundEnd': {
          const human = match.players.find((p) => !p.isBot);
          const won = human && e.results.some((r) => r.player.id === human.id && r.place === 1);
          this.sfx.play(won ? 'roundEnd' : 'lose');
          this.ui.showRoundEnd(e, match);
          this.state = 'roundEnd';
          break;
        }
        case 'matchEnd': {
          this.sfx.play('matchEnd');
          this.finishMatch(match);
          break;
        }
        default:
          break;
      }
    }
  }

  /** Persist the match into the meta layer and show the results. */
  finishMatch(match) {
    this.renderer.spawnConfetti();
    if (this.netRole() === 'host') {
      this.net.reportResult(
        match.standings().map((p, i) => ({ name: p.name, wins: p.wins, place: i + 1, roundWins: p.wins }))
      );
    }
    const humans = match.players.filter((p) => !p.isBot);
    const sum = (f) => humans.reduce((a, p) => a + f(p), 0);
    const summary = {
      won: !!match.matchWinner && humans.some((h) => h.id === match.matchWinner.id),
      roundWins: sum((p) => p.wins),
      points: sum((p) => p.points),
      eliminations: sum((p) => p.stats.eliminations),
      powerups: sum((p) => p.stats.powerups),
      falls: sum((p) => p.stats.falls),
      survived: sum((p) => p.stats.survived),
      bestRoundTime: humans.reduce((a, p) => Math.max(a, p.stats.bestTime), 0),
      time: Math.round(match.time),
      difficulty: match.opts.difficulty,
    };
    const gains = this.profile.recordMatch(summary);
    this.state = 'over';
    this.ui.showMatchEnd(match, gains);
    if (gains.after > gains.before) this.announceLevel(gains.before, gains.after);
  }
}

/* boot once the DOM is ready */
function boot() {
  let game = null;
  try {
    game = new Game();
    window.__game = game; // debug / test hook
  } catch (err) {
    // Never leave the user with a blank page: surface the failure.
    try {
      (window.__bootErrors ||= []).push('boot: ' + (err && err.message ? err.message : err));
      window.__showBootError && window.__showBootError();
    } catch {
      console.error(err);
    }
  }
  return game;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

export { Game, ROUND_STATE };
