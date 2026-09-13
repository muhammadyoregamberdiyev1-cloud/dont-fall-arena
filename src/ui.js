/**
 * DOM layer: menus, HUD, result screens. The simulation never touches this.
 */

import { POWERUPS, DIFFICULTY, PLAYER, MATCH } from './config.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {
      app: $('app'),
      hud: $('hud'),
      menu: $('menu'),
      roundEnd: $('roundEnd'),
      matchEnd: $('matchEnd'),
      pause: $('pause'),
      touchUi: $('touchUi'),
      round: $('hudRound'),
      timer: $('hudTimer'),
      alive: $('hudAlive'),
      scores: $('hudScores'),
      msg: $('hudMsg'),
      subMsg: $('hudSubMsg'),
      dashMeter: $('dashMeter'),
      dashRing: $('dashRing'),
      effects: $('hudEffects'),
      hint: $('hudHint'),
      killfeed: $('killfeed'),
      toasts: $('toasts'),
      btnPause: $('btnPause'),
      btnSound: $('btnSound'),
      reTitle: $('reTitle'),
      reResults: $('reResults'),
      reStandings: $('reStandings'),
      reNext: $('reNext'),
      meTitle: $('meTitle'),
      meSub: $('meSub'),
      meStandings: $('meStandings'),
      meStats: $('meStats'),
      meCrown: $('meCrown'),
      powerList: $('powerList'),
      // menu controls
      optName: $('optName'),
      optBots: $('optBots'),
      optDiff: $('optDiff'),
      optArena: $('optArena'),
      optRounds: $('optRounds'),
      optTwo: $('optTwo'),
      optSound: $('optSound'),
      btnStart: $('btnStart'),
      btnRematch: $('btnRematch'),
      btnMenu: $('btnMenu'),
      btnResume: $('btnResume'),
      btnRestart: $('btnRestart'),
      btnQuit: $('btnQuit'),
      touchStick: $('touchStick'),
      touchKnob: $('touchKnob'),
    };

    this.current = 'menu';
    this.chips = new Map();
    this.effKeys = '';
    this.subMsgT = 0;
    this.lastTimerText = '';
    this.renderPowerList();
  }

  /* ------------------------------------------------------------- plumbing */

  on(name, fn) {
    this.handlers = this.handlers || {};
    (this.handlers[name] = this.handlers[name] || []).push(fn);
  }

  fire(name, data) {
    for (const fn of (this.handlers || {})[name] || []) fn(data);
  }

  show(screen) {
    this.current = screen;
    this.el.menu.classList.toggle('hidden', screen !== 'menu');
    this.el.hud.classList.toggle('hidden', screen === 'menu');
    this.el.roundEnd.classList.toggle('hidden', screen !== 'roundEnd');
    this.el.matchEnd.classList.toggle('hidden', screen !== 'matchEnd');
    this.el.pause.classList.toggle('hidden', screen !== 'pause');
    this.el.touchUi.classList.toggle('hidden', screen === 'menu' || screen === 'matchEnd');
    if (screen === 'menu') {
      this.el.killfeed.innerHTML = '';
      this.el.toasts.innerHTML = '';
      this.el.scores.innerHTML = '';
      this.chips.clear();
      this.setMsg('');
      this.setSubMsg('');
    }
  }

  /* ------------------------------------------------------------ menu bits */

  renderPowerList() {
    this.el.powerList.innerHTML = Object.values(POWERUPS)
      .map(
        (p) =>
          `<li><span class="pw-ico" style="background:${p.color}">${p.icon}</span>
           <span><span class="pw-name">${p.label}</span> — ${p.desc}</span></li>`
      )
      .join('');
  }

  bindSegment(node, onChange) {
    const apply = (v) => {
      node.dataset.value = String(v);
      for (const b of node.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === String(v));
    };
    node.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      apply(b.dataset.v);
      this.fire('click');
      onChange(b.dataset.v);
    });
    apply(node.dataset.value);
    return apply;
  }

  bindToggle(node, initial, onChange) {
    let v = initial;
    const apply = () => {
      node.classList.toggle('on', v);
      node.setAttribute('aria-checked', String(v));
    };
    node.addEventListener('click', () => {
      v = !v;
      apply();
      this.fire('click');
      onChange(v);
    });
    apply();
    return (nv) => {
      v = nv;
      apply();
    };
  }

  /** Wire every menu control; `settings` is mutated in place. */
  bindMenu(settings) {
    this.el.optName.value = settings.name;
    this.el.optName.addEventListener('input', () => {
      settings.name = this.el.optName.value.trim().slice(0, 12) || 'Siz';
    });
    this.el.optName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.fire('start');
      e.stopPropagation();
    });

    this.bindSegment(this.el.optBots, (v) => (settings.bots = parseInt(v, 10)));
    this.bindSegment(this.el.optDiff, (v) => (settings.difficulty = v));
    this.bindSegment(this.el.optArena, (v) => (settings.arenaRadius = parseInt(v, 10)));
    this.bindSegment(this.el.optRounds, (v) => (settings.roundsToWin = parseInt(v, 10)));
    this.setTwo = this.bindToggle(this.el.optTwo, settings.twoPlayers, (v) => (settings.twoPlayers = v));
    this.setSound = this.bindToggle(this.el.optSound, settings.sound, (v) => {
      settings.sound = v;
      this.fire('sound', v);
    });

    this.el.btnStart.addEventListener('click', () => this.fire('start'));
    this.el.btnRematch.addEventListener('click', () => this.fire('rematch'));
    this.el.btnMenu.addEventListener('click', () => this.fire('menu'));
    this.el.btnResume.addEventListener('click', () => this.fire('resume'));
    this.el.btnRestart.addEventListener('click', () => this.fire('restart'));
    this.el.btnQuit.addEventListener('click', () => this.fire('menu'));
    this.el.btnPause.addEventListener('click', () => this.fire('pause'));
    this.el.btnSound.addEventListener('click', () => this.fire('mute'));
  }

  setSettings(settings) {
    this.el.optName.value = settings.name;
    this.el.optBots.dataset.value = String(settings.bots);
    this.el.optDiff.dataset.value = settings.difficulty;
    this.el.optArena.dataset.value = String(settings.arenaRadius);
    this.el.optRounds.dataset.value = String(settings.roundsToWin);
    for (const node of [this.el.optBots, this.el.optDiff, this.el.optArena, this.el.optRounds]) {
      for (const b of node.querySelectorAll('button')) {
        b.classList.toggle('on', b.dataset.v === node.dataset.value);
      }
    }
    if (this.setTwo) this.setTwo(settings.twoPlayers);
    if (this.setSound) this.setSound(settings.sound);
  }

  setSoundIcon(on) {
    this.el.btnSound.textContent = on ? '🔊' : '🔇';
  }

  /* ------------------------------------------------------------------ HUD */

  buildChips(players, roundsToWin) {
    this.el.scores.innerHTML = '';
    this.chips.clear();
    for (const p of players) {
      const chip = document.createElement('div');
      chip.className = 'chip' + (p.isLocal && !p.isBot ? ' me' : '');
      chip.innerHTML =
        `<span class="dot" style="background:${p.color};color:${p.color}"></span>` +
        `<span class="nm">${escapeHtml(p.name)}</span>` +
        `<span class="wins">${'<i></i>'.repeat(roundsToWin)}</span>`;
      this.el.scores.appendChild(chip);
      this.chips.set(p.id, { node: chip, wins: chip.querySelectorAll('.wins i'), dead: false });
    }
  }

  updateHud(match, dt) {
    const players = match.players;
    this.el.round.textContent = `RAUND ${match.round}/${match.opts.maxRounds}`;

    const t = Math.max(0, match.roundT);
    const text = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    if (text !== this.lastTimerText) {
      this.el.timer.textContent = text;
      this.lastTimerText = text;
      this.el.timer.classList.toggle('danger', t <= 15);
    }

    const alive = players.filter((p) => p.alive).length;
    this.el.alive.textContent = `${alive} TIRIK`;

    for (const p of players) {
      const c = this.chips.get(p.id);
      if (!c) continue;
      c.wins.forEach((n, i) => n.classList.toggle('on', i < p.wins));
      const dead = !p.alive;
      if (dead !== c.dead) {
        c.dead = dead;
        c.node.classList.toggle('dead', dead);
      }
    }

    // dash meter for the first local human
    const me = players.find((p) => !p.isBot && p.alive) || players.find((p) => !p.isBot);
    if (me && this.el.dashRing) {
      const cd = PLAYER.dashCooldown * (me.speedT > 0 ? 0.6 : 1);
      const k = me.dashCd <= 0 ? 1 : 1 - me.dashCd / cd;
      this.el.dashRing.style.strokeDashoffset = String(113 * (1 - k));
      this.el.dashMeter.classList.toggle('ready', me.dashCd <= 0);
      this.el.dashMeter.style.opacity = me.alive ? '1' : '0.35';
    }

    // effect pills
    if (me) {
      const effs = [];
      if (me.speedT > 0) effs.push(['speed', me.speedT]);
      if (me.phantomT > 0) effs.push(['phantom', me.phantomT]);
      if (me.freezeT > 0) effs.push(['freeze', me.freezeT]);
      if (me.titanT > 0) effs.push(['titan', me.titanT]);
      const key = effs.map((e) => e[0] + Math.ceil(e[1])).join('|');
      if (key !== this.effKeys) {
        this.effKeys = key;
        this.el.effects.innerHTML = effs
          .map(([k, t2]) => {
            const d = POWERUPS[k];
            return `<span class="eff" style="background:${d.color}">${d.icon} ${d.label} ${t2.toFixed(1)}s</span>`;
          })
          .join('');
      }
    }

    // ring warning
    const warn = match.arena.collapseWarn > 0 && match.state === 'playing';
    this.setSubMsg(warn ? '⚠ HALQA QULAYDI — MARKAZGA!' : '');

    this.subMsgT = Math.max(0, this.subMsgT - dt);
  }

  setMsg(text) {
    const span = this.el.msg.querySelector('span');
    if (!text) {
      this.el.msg.classList.remove('show');
      span.textContent = '';
      return;
    }
    span.textContent = text;
    this.el.msg.classList.remove('show');
    void this.el.msg.offsetWidth; // restart animation
    this.el.msg.classList.add('show');
  }

  setSubMsg(text) {
    const span = this.el.subMsg.querySelector('span');
    if (!text) {
      if (span.textContent) {
        span.textContent = '';
        this.el.subMsg.classList.remove('show');
      }
      return;
    }
    if (span.textContent !== text) {
      span.textContent = text;
      this.el.subMsg.classList.add('show');
    }
  }

  toast(text, color = '#5ad7ff', life = 1800) {
    const n = document.createElement('div');
    n.className = 'toast';
    n.style.color = color;
    n.style.borderColor = color + '66';
    n.textContent = text;
    this.el.toasts.appendChild(n);
    setTimeout(() => {
      n.classList.add('out');
      setTimeout(() => n.remove(), 400);
    }, life);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  feed(html, life = 4200) {
    const n = document.createElement('div');
    n.className = 'kf';
    n.innerHTML = html;
    this.el.killfeed.appendChild(n);
    setTimeout(() => {
      n.classList.add('out');
      setTimeout(() => n.remove(), 420);
    }, life);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.firstChild.remove();
  }

  clearFeed() {
    this.el.killfeed.innerHTML = '';
    this.el.toasts.innerHTML = '';
  }

  /* -------------------------------------------------------- result screens */

  showRoundEnd(data, match) {
    const timedOut = data.timedOut;
    this.el.reTitle.textContent = timedOut ? 'VAQT TUGADI' : 'RAUND TUGADI';
    this.el.reResults.innerHTML = data.results
      .slice(0, 6)
      .map(
        (r, i) => `
      <div class="res-row ${r.place === 1 ? 'win' : ''}" style="animation-delay:${i * 60}ms">
        <div class="res-place">${r.place}</div>
        <div class="res-name" style="color:${r.player.color}">${escapeHtml(r.player.name)}</div>
        <div class="res-tag">${
          r.winner ? (r.place === 1 && data.results.filter((x) => x.place === 1).length === 1 ? 'G‘OLIB' : 'Omon qoldi') : 'quladi'
        }</div>
        <div class="res-pts">+${MATCH_POINTS(r.place, timedOut && r.place === 1)}</div>
      </div>`
      )
      .join('');
    this.el.reStandings.innerHTML = standingsHtml(data.standings, match);
    this.el.reNext.textContent = match.matchWinner ? 'Yakuniy natija…' : `Keyingi raund: ${match.round + 1}`;
    this.show('roundEnd');
  }

  showMatchEnd(match) {
    const w = match.matchWinner;
    const human = match.players.find((p) => !p.isBot);
    const iWon = human && w && human.id === w.id;
    this.el.meCrown.textContent = iWon ? '👑' : '💀';
    this.el.meTitle.textContent = iWon ? 'SIZ CHEMPION!' : `${w ? w.name.toUpperCase() : 'HECH KIM'} G‘OLIB`;
    this.el.meTitle.style.color = iWon ? '#ffd23f' : w ? w.color : '#ff5d73';
    this.el.meSub.textContent = iWon
      ? `${match.round} raund davom etdi. Arena sizniki.`
      : human
        ? `${match.round} raund o‘ynaldi. ${w ? w.name : 'Raqib'} ${w ? w.wins : 0} ta raund yutdi.`
        : '';
    this.el.meStandings.innerHTML = standingsHtml(match.standings(), match);

    const s = (human || w).stats;
    this.el.meStats.innerHTML = [
      ['G‘alaba', (human || w).wins],
      ['Ochko', (human || w).points],
      ['Urib tushirdi', s.eliminations],
      ['Yiqildi', s.falls],
      ['Kuch oldi', s.powerups],
      ['Eng uzoq', s.bestTime.toFixed(0) + 's'],
    ]
      .map(([label, val]) => `<div class="stat"><b>${val}</b><span>${label}</span></div>`)
      .join('');
    this.show('matchEnd');
  }
}

function MATCH_POINTS(place, survivedTimeout) {
  const table = MATCH.points;
  return table[Math.min(place - 1, table.length - 1)] + (survivedTimeout ? MATCH.survivalBonus : 0);
}

function standingsHtml(standings, match) {
  return standings
    .map(
      (p, i) => `
    <div class="st-row ${i === 0 ? 'leader' : ''}">
      <div class="st-pos">${i + 1}</div>
      <div class="st-name"><span class="dot" style="width:9px;height:9px;border-radius:50%;background:${p.color};display:inline-block;box-shadow:0 0 8px ${p.color}"></span>${escapeHtml(p.name)}${
        !p.isBot ? ' <span style="color:#93a4c4;font-weight:600">(siz)</span>' : ''
      }</div>
      <div class="st-wins">★ ${p.wins}/${match.opts.roundsToWin}</div>
      <div class="st-pts">${p.points} ochko</div>
    </div>`
    )
    .join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { DIFFICULTY };
