/**
 * Boot + game loop. Glues the simulation (match.js) to the presentation
 * (render.js, audio.js, ui.js) and owns the app-level state machine.
 */

import { Match, ROUND_STATE } from './match.js';
import { Renderer } from './render.js';
import { Sfx } from './audio.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Profile } from './profile.js';
import { ARENA, POWERUPS, THEMES, SKINS } from './config.js';

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
    this.ui.on('rematch', () => this.startMatch());
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

    if (live) {
      this.acc += rawDt;
      let steps = 0;
      while (this.acc >= STEP && steps < MAX_STEPS) {
        const map = new Map();
        for (const p of this.match.players) {
          if (p.isBot) continue;
          const raw = inputs.get(p.controls) || { mx: 0, my: 0, dash: false };
          map.set(p.id, steps === 0 ? raw : { mx: raw.mx, my: raw.my, dash: false });
        }
        this.match.update(STEP, map);
        this.acc -= STEP;
        steps++;
        this.handleEvents(this.match.drainEvents());
      }
      if (steps >= MAX_STEPS) this.acc = 0;
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
          const def = POWERUPS[e.type] || e.def;
          const label = this.ui.pwName(e.type);
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
  const game = new Game();
  try {
    window.__game = game; // debug / test hook
  } catch {
    /* ignore */
  }
  return game;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

export { Game, ROUND_STATE };
