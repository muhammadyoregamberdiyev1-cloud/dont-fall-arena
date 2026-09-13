/**
 * Boot + game loop. Glues the simulation (match.js) to the presentation
 * (render.js, audio.js, ui.js) and owns the app-level state machine.
 */

import { Match, ROUND_STATE } from './match.js';
import { Renderer } from './render.js';
import { Sfx } from './audio.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { ARENA, MATCH, POWERUPS, DIFFICULTY } from './config.js';

const STORE_KEY = 'dont-fall-arena:settings:v1';
const STEP = 1 / 60;
const MAX_STEPS = 5;

const DEFAULT_SETTINGS = {
  name: 'Siz',
  bots: 3,
  difficulty: 'normal',
  arenaRadius: ARENA.radius,
  roundsToWin: MATCH.roundsToWin,
  twoPlayers: false,
  sound: true,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* private mode — fine */
  }
}

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new Renderer(this.canvas);
    this.sfx = new Sfx();
    this.input = new Input(this.canvas);
    this.ui = new UI();
    this.settings = loadSettings();

    this.match = null;
    this.attract = null;
    this.state = 'menu';
    this.acc = 0;
    this.last = performance.now();
    this.sfxThrottle = {};

    this.ui.bindMenu(this.settings);
    this.ui.setSettings(this.settings);
    this.ui.setSoundIcon(this.settings.sound);
    this.sfx.setEnabled(this.settings.sound);

    this.ui.on('start', () => this.startMatch());
    this.ui.on('rematch', () => this.startMatch(true));
    this.ui.on('menu', () => this.toMenu());
    this.ui.on('resume', () => this.resume());
    this.ui.on('restart', () => this.startMatch(true));
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
      saveSettings(this.settings);
    });

    this.input.onAction = (name) => this.handleAction(name);
    window.addEventListener('keydown', () => this.sfx.unlock(), { once: true });

    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    window.addEventListener('pointerdown', () => this.sfx.unlock(), { once: true });

    // attract mode: bots play behind the menu
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
    this.ui.show('menu');
    this.sfx.setTension(0);
  }

  startMatch(keepSettings = false) {
    this.sfx.unlock();
    this.sfx.play('start');
    if (!keepSettings) {
      this.settings.name = document.getElementById('optName').value.trim().slice(0, 12) || 'Siz';
      saveSettings(this.settings);
    }

    const humans = this.settings.twoPlayers ? 2 : 1;
    this.match = new Match({
      seed: Math.floor(Math.random() * 1e9),
      humans,
      bots: this.settings.bots,
      difficulty: this.settings.difficulty,
      arenaRadius: this.settings.arenaRadius,
      roundsToWin: this.settings.roundsToWin,
      maxRounds: Math.max(this.settings.roundsToWin * 2 + 1, 5),
      roundTime: ARENA.roundTime,
      humanNames: humans > 1 ? [this.settings.name, "2-o'yinchi"] : [this.settings.name],
    });
    this.attract = null;
    this.state = 'playing';
    this.ui.buildChips(this.match.players, this.match.opts.roundsToWin);
    this.ui.clearFeed();
    this.ui.show('hud');
    this.ui.el.hint.textContent =
      humans > 1
        ? '1-o‘yinchi: WASD + SPACE · 2-o‘yinchi: ↑↓←→ + ENTER · ESC — pauza'
        : "WASD / ↑↓←→ — yurish · SPACE — sakrash · ESC — pauza";
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
    this.settings.sound = !this.settings.sound;
    this.sfx.unlock();
    this.sfx.setEnabled(this.settings.sound);
    this.ui.setSoundIcon(this.settings.sound);
    if (this.ui.setSound) this.ui.setSound(this.settings.sound);
    saveSettings(this.settings);
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
        if (this.state === 'playing' || this.state === 'paused') this.startMatch(true);
        break;
      case 'confirm':
        if (this.state === 'menu') this.startMatch();
        else if (this.state === 'over') this.startMatch(true);
        break;
      case 'help':
        if (this.state === 'playing') this.pause();
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
    // The match keeps ticking through round-end / match-end interludes; it
    // gates its own simulation. Only a real pause freezes it.
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
    } else {
      // paused / result screens: keep visuals alive, freeze the sim
      inputs.forEach((v) => (v.dash = false));
    }

    // tension for the ambient drone
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

  handleEvents(events) {
    const match = this.match;
    this.renderer.consume(events, match.arena);

    for (const e of events) {
      switch (e.type) {
        case 'roundStart':
          this.state = 'playing';
          this.ui.show('hud');
          this.ui.buildChips(match.players, match.opts.roundsToWin);
          this.ui.clearFeed();
          this.ui.setMsg(`RAUND ${e.round}`);
          this.ui.feed(`Raund ${e.round} — ${match.players.length} o'yinchi`);
          break;
        case 'count':
          this.ui.setMsg(String(e.n));
          this.sfx.play('count');
          break;
        case 'go':
          this.ui.setMsg('BOSHLANDI!');
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
          this.ui.toast('ZILZILA!', '#ff9f45', 1200);
          break;
        case 'collapse':
          this.sfx.play('collapse');
          this.ui.setMsg('HALQA QULADI');
          this.ui.feed(`<b>Halqa ${e.ring}</b> qulab tushdi`);
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
            this.ui.toast('QULAYAPSIZ! SAKRANG!', '#ff5d73', 900);
          }
          break;
        case 'scramble':
          if (this.isHuman(e.player)) this.sfx.play('scramble');
          break;
        case 'fell': {
          this.sfx.play('fell');
          const human = this.isHuman(e.player);
          this.ui.feed(
            `<b style="color:${e.player.color}">${esc(e.player.name)}</b> ${human ? '— siz quladingiz' : 'qulab tushdi'}`
          );
          if (human) this.ui.toast('SIZ QULADINGIZ', '#ff5d73', 2200);
          break;
        }
        case 'shovedOff': {
          const k = e.killer;
          const v = e.victim;
          this.sfx.play('shovedOff');
          this.ui.feed(
            `<b style="color:${k.color}">${esc(k.name)}</b> → <b style="color:${v.color}">${esc(v.name)}</b> urib tushirdi`
          );
          if (this.isHuman(k)) this.ui.toast("URIB TUSHIRDINGIZ!", '#ffd23f', 1400);
          break;
        }
        case 'powerup': {
          this.sfx.play('powerup');
          const def = POWERUPS[e.type] || e.def;
          if (this.isHuman(e.player)) {
            this.ui.toast(`${def.icon} ${def.label.toUpperCase()}!`, def.color, 1400);
          } else {
            this.ui.feed(
              `<b style="color:${e.player.color}">${esc(e.player.name)}</b> ${def.label} oldi`
            );
          }
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
          this.ui.showMatchEnd(match);
          this.state = 'over';
          break;
        }
        default:
          break;
      }
    }
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* boot once the DOM is ready */
function boot() {
  const game = new Game();
  // handy hook for debugging in the console (and for the headless harness)
  try {
    window.__game = game;
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

export { Game, DIFFICULTY, ROUND_STATE };
