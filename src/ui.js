/**
 * DOM layer: the lobby (multi-screen menu), HUD and result screens.
 * All copy lives in the I18N table so the whole lobby flips UZ ⇄ EN.
 */

import { POWERUPS, PLAYER, MATCH, SEASON, MISSIONS, ACHIEVEMENTS, RANKS, THEMES, SKINS } from './config.js?v=20260913';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ i18n */

const I18N = {
  uz: {
    tagline: "Tirik qol! Yiqilma! 🕹️",
    wins: "G'alabalar",
    level: 'Daraja',
    season: 'Mavsum',
    endsIn: 'tugaydi',
    playBots: 'BOTLAR BILAN O‘YNASH',
    playTwo: '2 O‘YINCHI · BIR KLAVIATURA',
    gift: 'Taklif',
    daily: 'Kunlik',
    tasks: 'Vazifalar',
    rating: 'Reyting',
    collection: 'Kollektsiya',
    profile: 'Profil',
    skins: 'Skinlar',
    back: 'Orqaga',
    rejim: 'Rejim:',
    difficulty: 'Qiyinlik:',
    botFill: 'Bot to‘ldirish',
    second: '2-o‘yinchi',
    on: 'on',
    off: 'off',
    startBots: 'START (BOTS)',
    startTwo: 'START (2 O‘YINCHI)',
    noteBots: '🤖 Botlar bilan o‘yin — XP, RP va vazifalar baribir hisoblanadi.',
    noteTwo: '👥 Bitta klaviaturada: 1-o‘yinchi WASD+SPACE, 2-o‘yinchi strelkalar+ENTER.',
    howto: 'Qanday o‘ynash?',
    tech: 'HTML5 • Canvas • localStorage • WebAudio',
    claim: 'OLISH',
    claimed: 'OLINDI ✓',
    bonus: 'Kunlik bonus',
    bonusDesc: 'Har kuni +100 XP',
    missionsTitle: 'Kunlik topshiriqlar',
    tasksTitle: 'Vazifalar (umumiy)',
    ratingTitle: 'Reyting jadvali',
    you: 'SIZ',
    youLow: 'siz',
    collectionTitle: 'Arena mavzulari',
    skinsTitle: 'O‘yinchi ranglari',
    locked: 'Daraja {n}da ochiladi',
    selected: 'TANLANGAN',
    select: 'TANLASH',
    profileTitle: 'Profil',
    nameLbl: 'Ism',
    save: 'SAQLASH',
    reset: 'Progressni tozalash',
    resetQ: 'Rostdan tozalansinmi?',
    statsTitle: 'Statistika',
    sWins: 'G‘alabalar',
    sGames: 'O‘yinlar',
    sSurvived: 'Omon raundlar',
    sShoves: 'Urib tushirdi',
    sPowers: 'Kuchlar',
    sFalls: 'Qulashlar',
    sBest: 'Eng uzoq raund',
    sRank: 'Reyting',
    round: 'RAUND',
    alive: 'TIRIK',
    hint1: 'WASD / strelkalar — yurish · SPACE — sakrash · ESC — pauza',
    hint2: '1: WASD + SPACE · 2: strelkalar + ENTER · ESC — pauza',
    warn: '⚠ HALQA QULAYDI — MARKAZGA!',
    roundEnd: 'RAUND TUGADI',
    timeUp: 'VAQT TUGADI',
    winner: 'G‘OLIB',
    survivedTag: 'omon qoldi',
    fellTag: 'quladi',
    nextRound: 'Keyingi raund: {n}',
    finalNext: 'Yakuniy natija…',
    champYou: 'SIZ CHEMPION!',
    champOther: '{name} G‘OLIB',
    subWin: '{n} raund davom etdi. Arena sizniki.',
    subLose: '{n} raund o‘ynaldi. {name} {w} ta raund yutdi.',
    rematch: 'QAYTA O‘YNASH',
    menuBtn: 'MENYU',
    pause: 'PAUZA',
    resume: 'DAVOM ETISH',
    restart: 'QAYTA BOSHLASH',
    quit: 'MENYUGA CHIQISH',
    tip1: 'Sakrash (dash) teshikdan o‘tishning yagona yo‘li — uni tejab ishlatmang.',
    tip2: 'Muzli plitalarda tormoz yo‘q: burilishni oldindan boshlang.',
    tip3: 'Po‘lat plitalar uzoq chidaydi — xavfsiz orol.',
    feedFell: '<b style="color:{c}">{name}</b> qulab tushdi',
    feedYouFell: '<b style="color:{c}">{name}</b> — siz quladingiz',
    feedShove: '<b style="color:{ca}">{a}</b> → <b style="color:{cb}">{b}</b> urib tushirdi',
    feedPower: '<b style="color:{c}">{name}</b> {p} oldi',
    feedRound: 'Raund {n} — {k} o‘yinchi',
    feedCollapse: '<b>Halqa {n}</b> qulab tushdi',
    tQuake: 'ZILZILA!',
    tCollapse: 'HALQA QULADI',
    tFalling: 'QULAYAPSIZ! SAKRANG!',
    tYouFell: 'SIZ QULADINGIZ',
    tShoved: 'URIB TUSHIRDINGIZ!',
    tXp: '+{n} XP',
    tRp: '+{n} RP',
    tLevelUp: '🎉 DARAJA {n}!',
    tUnlock: '🔓 Yangi: {what}',
    mSurvive: '3 ta raundda omon qoling',
    mShove: '2 ta raqibni urib tushiring',
    mPower: '3 ta kuch oling',
    aFirst: 'Birinchi o‘yin',
    aSurvivor: '10 raund omon qolish',
    aBull: '25 ta urib tushirish',
    aCollector: '20 ta kuch olish',
    aChamp: '5 ta match yutish',
    aLegend: 'Dahshat darajasida match yutish',
    d_chill: 'Oson',
    d_normal: 'Normal',
    d_spicy: 'Qiyin',
    d_nightmare: 'Dahshat',
    pw_shatter: 'Zilzila',
    pw_freeze: 'Muzlatish',
    pw_speed: 'Chaqqonlik',
    pw_phantom: 'Arvoh',
    pw_titan: 'Titan',
    how_rules: 'Qoidalar',
    how_rules_body:
      'Plita ustida tursangiz u yoriladi. Halqa torayadi. Oxirgi turgan raundni yutadi; kerakli raundlar sonigacha yutgan — match g‘olibi.',
    how_keys: 'Boshqaruv',
    how_powers: 'Kuchlar',
  },
  en: {
    tagline: 'Stay alive! Don\'t fall! 🕹️',
    wins: 'Wins',
    level: 'Level',
    season: 'Season',
    endsIn: 'ends in',
    playBots: 'PLAY WITH BOTS',
    playTwo: '2 PLAYERS · ONE KEYBOARD',
    gift: 'Gift',
    daily: 'Daily',
    tasks: 'Missions',
    rating: 'Rating',
    collection: 'Collection',
    profile: 'Profile',
    skins: 'Skins',
    back: 'Back',
    rejim: 'Mode:',
    difficulty: 'Difficulty:',
    botFill: 'Fill with bots',
    second: '2nd player',
    on: 'on',
    off: 'off',
    startBots: 'START (BOTS)',
    startTwo: 'START (2 PLAYERS)',
    noteBots: '🤖 Bot matches still earn XP, RP and mission progress.',
    noteTwo: '👥 One keyboard: P1 WASD+SPACE, P2 arrows+ENTER.',
    howto: 'How to play?',
    tech: 'HTML5 • Canvas • localStorage • WebAudio',
    claim: 'CLAIM',
    claimed: 'CLAIMED ✓',
    bonus: 'Daily bonus',
    bonusDesc: '+100 XP every day',
    missionsTitle: 'Daily missions',
    tasksTitle: 'Achievements (lifetime)',
    ratingTitle: 'Leaderboard',
    you: 'YOU',
    youLow: 'you',
    collectionTitle: 'Arena themes',
    skinsTitle: 'Player colours',
    locked: 'Unlocks at level {n}',
    selected: 'SELECTED',
    select: 'SELECT',
    profileTitle: 'Profile',
    nameLbl: 'Name',
    save: 'SAVE',
    reset: 'Reset progress',
    resetQ: 'Really reset?',
    statsTitle: 'Stats',
    sWins: 'Wins',
    sGames: 'Games',
    sSurvived: 'Rounds survived',
    sShoves: 'Shove-offs',
    sPowers: 'Powerups',
    sFalls: 'Falls',
    sBest: 'Longest round',
    sRank: 'Rank',
    round: 'ROUND',
    alive: 'ALIVE',
    hint1: 'WASD / arrows — move · SPACE — dash · ESC — pause',
    hint2: 'P1: WASD + SPACE · P2: arrows + ENTER · ESC — pause',
    warn: '⚠ RING COLLAPSING — GET TO THE CENTER!',
    roundEnd: 'ROUND OVER',
    timeUp: 'TIME UP',
    winner: 'WINNER',
    survivedTag: 'survived',
    fellTag: 'fell',
    nextRound: 'Next round: {n}',
    finalNext: 'Final results…',
    champYou: 'YOU ARE THE CHAMPION!',
    champOther: '{name} WINS',
    subWin: '{n} rounds played. The arena is yours.',
    subLose: '{n} rounds played. {name} took {w} rounds.',
    rematch: 'REMATCH',
    menuBtn: 'MENU',
    pause: 'PAUSED',
    resume: 'RESUME',
    restart: 'RESTART',
    quit: 'QUIT TO MENU',
    tip1: 'Dashing is the only way across gaps — don\'t waste it.',
    tip2: 'Ice tiles have no brakes: start turning early.',
    tip3: 'Steel tiles last longer — safe islands.',
    feedFell: '<b style="color:{c}">{name}</b> fell',
    feedYouFell: '<b style="color:{c}">{name}</b> — you fell',
    feedShove: '<b style="color:{ca}">{a}</b> → shoved <b style="color:{cb}">{b}</b>',
    feedPower: '<b style="color:{c}">{name}</b> grabbed {p}',
    feedRound: 'Round {n} — {k} players',
    feedCollapse: '<b>Ring {n}</b> collapsed',
    tQuake: 'QUAKE!',
    tCollapse: 'RING COLLAPSE',
    tFalling: 'FALLING! DASH!',
    tYouFell: 'YOU FELL',
    tShoved: 'SHOVED OFF!',
    tXp: '+{n} XP',
    tRp: '+{n} RP',
    tLevelUp: '🎉 LEVEL {n}!',
    tUnlock: '🔓 Unlocked: {what}',
    mSurvive: 'Survive 3 rounds',
    mShove: 'Shove off 2 rivals',
    mPower: 'Grab 3 powerups',
    aFirst: 'First game',
    aSurvivor: 'Survive 10 rounds',
    aBull: '25 shove-offs',
    aCollector: 'Grab 20 powerups',
    aChamp: 'Win 5 matches',
    aLegend: 'Win on Nightmare',
    d_chill: 'Easy',
    d_normal: 'Normal',
    d_spicy: 'Hard',
    d_nightmare: 'Nightmare',
    pw_shatter: 'Quake',
    pw_freeze: 'Freeze',
    pw_speed: 'Swift',
    pw_phantom: 'Phantom',
    pw_titan: 'Titan',
    how_rules: 'Rules',
    how_rules_body:
      'Standing on a tile cracks it. The ring shrinks. Last one standing wins the round; first to the target round wins wins the match.',
    how_keys: 'Controls',
    how_powers: 'Powerups',
  },
};

const DIFF_EMOJI = { chill: '😊', normal: '😐', spicy: '😈', nightmare: '💀' };
const RANK_EN = [
  'BRONZE III', 'BRONZE II', 'BRONZE I', 'SILVER III', 'SILVER II', 'SILVER I',
  'GOLD III', 'GOLD II', 'GOLD I', 'PLATINUM', 'LEGEND',
];

/* fake-but-stable ladder rivals for the local leaderboard */
const RIVALS = [
  { name: 'ZilzilaPro', xp: 2450 },
  { name: 'HexMaster', xp: 1780 },
  { name: 'QoraQuyosh', xp: 1240 },
  { name: 'TileRunner', xp: 860 },
  { name: 'Sahro', xp: 540 },
  { name: 'Muzlak', xp: 320 },
  { name: 'YangiOyinchi', xp: 60 },
];

function fmtTime(sec) {
  const s = Math.floor(sec);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function fill(str, params) {
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (params && params[k] !== undefined ? params[k] : `{${k}}`));
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ==================================================================== UI */

export class UI {
  constructor(profile) {
    this.profile = profile;
    this.el = {
      hud: $('hud'),
      menu: $('menu'),
      menuRoot: $('menuRoot'),
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
      meXp: $('meXp'),
      meStandings: $('meStandings'),
      meStats: $('meStats'),
      meCrown: $('meCrown'),
      btnRematch: $('btnRematch'),
      btnMenu: $('btnMenu'),
      btnResume: $('btnResume'),
      btnRestart: $('btnRestart'),
      btnQuit: $('btnQuit'),
      pauseTitle: $('pauseTitle'),
      touchStick: $('touchStick'),
      touchKnob: $('touchKnob'),
    };

    const missing = Object.entries(this.el).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
      throw new Error('index.html eskirgan (element topilmadi): ' + missing.join(', '));
    }

    this.screen = 'home'; // lobby sub-screen
    this.current = 'menu'; // app-level screen
    this.frameMs = 16;
    this.opts = { seats: 4, difficulty: 'normal', botFill: true, two: false, entry: 'bots' };
    this.chips = new Map();
    this.effKeys = '';
    this.lastTimerText = '';
    this.resetArmed = false;

    this.el.menuRoot.addEventListener('click', (e) => this.onMenuClick(e));
    this.el.btnRematch.addEventListener('click', () => this.fire('rematch'));
    this.el.btnMenu.addEventListener('click', () => this.fire('menu'));
    this.el.btnResume.addEventListener('click', () => this.fire('resume'));
    this.el.btnRestart.addEventListener('click', () => this.fire('restart'));
    this.el.btnQuit.addEventListener('click', () => this.fire('menu'));
    this.el.btnPause.addEventListener('click', () => this.fire('pause'));
    this.el.btnSound.addEventListener('click', () => this.fire('mute'));
  }

  /* ------------------------------------------------------------- plumbing */

  on(name, fn) {
    (this.handlers ||= {})[name] ||= [];
    this.handlers[name].push(fn);
  }

  fire(name, data) {
    for (const fn of (this.handlers || {})[name] || []) fn(data);
  }

  t(key, params) {
    const lang = this.profile.data.lang === 'en' ? 'en' : 'uz';
    const raw = (I18N[lang] && I18N[lang][key]) ?? I18N.uz[key] ?? key;
    return fill(raw, params);
  }

  pwName(type) {
    return this.t('pw_' + type);
  }

  rankName(idx) {
    return this.profile.data.lang === 'en' ? RANK_EN[idx] ?? RANKS[idx].name : RANKS[idx].name;
  }

  /* ------------------------------------------------------- screen showing */

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
      this.renderMenu();
    }
    if (screen === 'pause') this.renderPauseTexts();
  }

  goto(screen) {
    this.screen = screen;
    this.renderMenu();
  }

  renderPauseTexts() {
    this.el.pauseTitle.textContent = this.t('pause');
    this.el.btnResume.textContent = this.t('resume');
    this.el.btnRestart.textContent = this.t('restart');
    this.el.btnQuit.textContent = this.t('quit');
    for (const li of this.el.pause.querySelectorAll('[data-i18n]')) {
      li.textContent = this.t(li.dataset.i18n);
    }
  }

  /* ------------------------------------------------------------ menu bits */

  statRow() {
    const p = this.profile;
    return `
      <div class="stat-row">
        <span class="stat-pill"><span class="em">🪙</span>${p.data.xp}</span>
        <span class="stat-pill"><span class="em">🏆</span>${p.data.wins} ${escapeHtml(this.t('wins'))}</span>
        <span class="stat-pill">${escapeHtml(this.t('level'))} ${p.level}</span>
        <span class="stat-pill"><span class="em">⏱</span>${fmtTime(p.data.time)}</span>
        <span class="stat-pill"><span class="em">🎮</span>${p.data.games}</span>
      </div>
      <div class="rank-pill"><span>${p.rank.icon}</span>${escapeHtml(this.rankName(p.rank.index))}</div>
      <div class="season"><span>🎮</span>${escapeHtml(this.t('season'))} ${SEASON.number} • ${SEASON.name} • ${escapeHtml(this.t('endsIn'))}: ${p.seasonDaysLeft}d</div>`;
  }

  footRow() {
    const p = this.profile.data;
    return `
      <div class="foot-row">
        <button class="foot-pill" data-act="lang">UZ <b>${p.lang.toUpperCase()}</b></button>
        <button class="foot-pill ${p.sound ? '' : 'off'}" data-act="sound"><span>🔊</span><span>♪</span></button>
        <button class="foot-pill ${p.music ? '' : 'off'}" data-act="music"><span>🎵</span></button>
      </div>`;
  }

  howToBody() {
    const powers = Object.values(POWERUPS)
      .map((pw) => `<li><b style="color:${pw.color}">${pw.icon} ${escapeHtml(this.pwName(pw.key))}</b> — ${escapeHtml(pw.desc)}</li>`)
      .join('');
    return `
      <div class="acc-body">
        <h4>${escapeHtml(this.t('how_rules'))}</h4>
        <p>${escapeHtml(this.t('how_rules_body'))}</p>
        <h4>${escapeHtml(this.t('how_keys'))}</h4>
        <ul class="keys">
          <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / <kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> — ${this.profile.data.lang === 'uz' ? 'yurish' : 'move'}</li>
          <li><kbd>SPACE</kbd> / <kbd>SHIFT</kbd> — ${this.profile.data.lang === 'uz' ? 'sakrash (dash)' : 'dash'}</li>
          <li>${this.profile.data.lang === 'uz' ? '2-o‘yinchi' : 'P2'}: <kbd>↑↓←→</kbd> + <kbd>ENTER</kbd></li>
          <li><kbd>ESC</kbd> ${this.profile.data.lang === 'uz' ? 'pauza' : 'pause'} · <kbd>M</kbd> ${this.profile.data.lang === 'uz' ? 'ovoz' : 'sound'} · <kbd>R</kbd> ${this.profile.data.lang === 'uz' ? 'qayta' : 'restart'}</li>
        </ul>
        <h4>${escapeHtml(this.t('how_powers'))}</h4>
        <ul>${powers}</ul>
      </div>`;
  }

  renderMenu() {
    const p = this.profile;
    let body = '';

    if (this.screen === 'home') {
      const bonusReady = p.bonusReady;
      const missionsOpen = MISSIONS.some((m) => {
        const st = p.missionState(m);
        return st.done && !st.claimed;
      });
      body = `
        <h1 class="m-title">DON'T FALL!</h1>
        <p class="m-sub">${escapeHtml(this.t('tagline'))}</p>
        ${this.statRow()}
        <button class="big-btn green" data-act="setup-bots"><span>🌐</span>${escapeHtml(this.t('playBots'))}</button>
        <button class="big-btn blue" data-act="setup-two"><span>👥</span>${escapeHtml(this.t('playTwo'))}</button>
        <div class="card-row four">
          <button class="card c-green ${bonusReady ? '' : 'done'}" data-act="claim-bonus">
            <span class="em">🎁</span>${escapeHtml(this.t('gift'))}<span class="sub">+100 XP</span>
          </button>
          <button class="card c-magenta" data-act="goto-daily">
            ${missionsOpen || bonusReady ? '<i class="dot-badge"></i>' : ''}
            <span class="em">🎁</span>${escapeHtml(this.t('daily'))}
          </button>
          <button class="card c-steel" data-act="goto-tasks"><span class="em">📜</span>${escapeHtml(this.t('tasks'))}</button>
          <button class="card c-olive" data-act="goto-rating"><span class="em">🏆</span>${escapeHtml(this.t('rating'))}</button>
        </div>
        <div class="card-row three">
          <button class="card c-brown" data-act="goto-themes"><span class="em">🎨</span>${escapeHtml(this.t('collection'))}</button>
          <button class="card c-purple" data-act="goto-profile"><span class="em">👤</span>${escapeHtml(this.t('profile'))}</button>
          <button class="card c-violet" data-act="goto-skins"><span class="em">👕</span>${escapeHtml(this.t('skins'))}</button>
        </div>
        ${this.footRow()}`;
    } else if (this.screen === 'setup') {
      const o = this.opts;
      const seats = [2, 4, 6, 8];
      const diffs = ['chill', 'normal', 'spicy', 'nightmare'];
      body = `
        ${this.statRow()}
        <button class="back-btn" data-act="back">◀ ${escapeHtml(this.t('back'))}</button>
        <div class="rank-strip">
          <span>${p.rank.icon}</span>${escapeHtml(this.rankName(p.rank.index))}
          <span class="rp">${p.rank.into} RP / ${p.rank.next ? p.rank.span : '∞'} •</span>
          <span class="ping">📊 ${Math.max(1, Math.round(this.frameMs))}ms</span>
        </div>
        <div class="row-line">
          <span class="lbl">${escapeHtml(this.t('rejim'))}</span>
          <div class="seg2" data-seg="seats">
            ${seats.map((s) => `<button data-v="${s}" class="${o.seats === s ? 'on' : ''}">${s / 2}v${s / 2}</button>`).join('')}
          </div>
        </div>
        <div class="row-line">
          <span class="lbl">${escapeHtml(this.t('difficulty'))}</span>
          <div class="seg2" data-seg="difficulty">
            ${diffs.map((d) => `<button data-v="${d}" class="${o.difficulty === d ? 'on' : ''}">${DIFF_EMOJI[d]} ${escapeHtml(this.t('d_' + d))}</button>`).join('')}
          </div>
        </div>
        <button class="pill-toggle green-line" data-act="botfill">🤖 ${escapeHtml(this.t('botFill'))}: ${o.botFill ? this.t('on') : this.t('off')}</button>
        <button class="pill-toggle ${o.two ? 'blue-line' : 'gray-line'}" data-act="two">👥 ${escapeHtml(this.t('second'))}: ${o.two ? this.t('on') : this.t('off')}</button>
        <button class="big-btn ${o.entry === 'two' ? 'blue' : 'green'}" data-act="start">
          <span>${o.entry === 'two' ? '👥' : '🤖'}</span>${escapeHtml(o.entry === 'two' ? this.t('startTwo') : this.t('startBots'))}
        </button>
        <p class="note">${escapeHtml(o.entry === 'two' ? this.t('noteTwo') : this.t('noteBots'))}</p>
        ${this.footRow()}
        <div class="acc"><details><summary>${escapeHtml(this.t('howto'))}</summary>${this.howToBody()}</details></div>
        <p class="tech">${this.t('tech')}</p>`;
    } else if (this.screen === 'daily') {
      body = `
        ${this.statRow()}
        <button class="back-btn" data-act="back">◀ ${escapeHtml(this.t('back'))}</button>
        <div class="list">
          <div class="list-row">
            <div class="ico">🎁</div>
            <div class="body">
              <div class="t1">${escapeHtml(this.t('bonus'))}</div>
              <div class="t2">${escapeHtml(this.t('bonusDesc'))}</div>
            </div>
            <button class="mini-btn gold" data-act="claim-bonus" ${p.bonusReady ? '' : 'disabled'}>
              ${p.bonusReady ? escapeHtml(this.t('claim')) : escapeHtml(this.t('claimed'))}
            </button>
          </div>
        </div>
        <h4 style="color:var(--gold);font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin:12px 2px 4px">${escapeHtml(this.t('missionsTitle'))}</h4>
        <div class="list">
          ${MISSIONS.map((m) => {
            const st = p.missionState(m);
            return `
            <div class="list-row">
              <div class="ico">${m.icon}</div>
              <div class="body">
                <div class="t1">${escapeHtml(this.t('m' + m.key[0].toUpperCase() + m.key.slice(1)))}</div>
                <div class="t2">${st.cur}/${m.target} • +${m.xp} XP</div>
                <div class="bar"><i style="width:${(st.cur / m.target) * 100}%"></i></div>
              </div>
              <button class="mini-btn" data-act="claim-mission:${m.key}" ${st.done && !st.claimed ? '' : 'disabled'}>
                ${st.claimed ? escapeHtml(this.t('claimed')) : st.done ? escapeHtml(this.t('claim')) : `${st.cur}/${m.target}`}
              </button>
            </div>`;
          }).join('')}
        </div>
        ${this.footRow()}`;
    } else if (this.screen === 'tasks') {
      body = `
        ${this.statRow()}
        <button class="back-btn" data-act="back">◀ ${escapeHtml(this.t('back'))}</button>
        <h4 style="color:var(--gold);font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin:2px 2px 4px">${escapeHtml(this.t('tasksTitle'))}</h4>
        <div class="list">
          ${ACHIEVEMENTS.map((a) => {
            const st = p.achievementState(a);
            return `
            <div class="list-row">
              <div class="ico">${a.icon}</div>
              <div class="body">
                <div class="t1">${escapeHtml(this.t('a' + a.key[0].toUpperCase() + a.key.slice(1)))}</div>
                <div class="t2">${st.cur}/${a.target} • +${a.xp} XP</div>
                <div class="bar"><i style="width:${(st.cur / a.target) * 100}%"></i></div>
              </div>
              <button class="mini-btn" data-act="claim-ach:${a.key}" ${st.done && !st.claimed ? '' : 'disabled'}>
                ${st.claimed ? escapeHtml(this.t('claimed')) : st.done ? escapeHtml(this.t('claim')) : `${st.cur}/${a.target}`}
              </button>
            </div>`;
          }).join('')}
        </div>
        ${this.footRow()}`;
    } else if (this.screen === 'rating') {
      const rows = [...RIVALS.map((r) => ({ ...r, me: false })), { name: p.data.name, xp: p.data.xp, me: true }]
        .sort((a, b) => b.xp - a.xp);
      body = `
        ${this.statRow()}
        <button class="back-btn" data-act="back">◀ ${escapeHtml(this.t('back'))}</button>
        <h4 style="color:var(--gold);font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin:2px 2px 4px">${escapeHtml(this.t('ratingTitle'))}</h4>
        <div class="list">
          ${rows
            .map(
              (r, i) => `
            <div class="list-row" style="${r.me ? 'border-color:rgba(242,193,78,.5);background:rgba(242,193,78,.08)' : ''}">
              <div class="ico" style="font:900 14px var(--mono);color:${i === 0 ? 'var(--gold)' : 'var(--dim)'}">${i + 1}</div>
              <div class="body">
                <div class="t1">${escapeHtml(r.name)}${r.me ? ` <span style="color:var(--gold)">(${escapeHtml(this.t('you'))})</span>` : ''}</div>
                <div class="t2">${r.xp} XP</div>
              </div>
              <div class="ico">${i === 0 ? '👑' : i < 3 ? '🏅' : ''}</div>
            </div>`
            )
            .join('')}
        </div>
        ${this.footRow()}`;
    } else if (this.screen === 'themes') {
      body = `
        ${this.statRow()}
        <button class="back-btn" data-act="back">◀ ${escapeHtml(this.t('back'))}</button>
        <h4 style="color:var(--gold);font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin:2px 2px 4px">${escapeHtml(this.t('collectionTitle'))}</h4>
        <div class="skin-grid">
          ${THEMES.map((th) => {
            const locked = p.level < th.level;
            const on = p.data.theme === th.key;
            return `
            <button class="skin ${on ? 'on' : ''} ${locked ? 'locked' : ''}" data-act="theme:${th.key}" style="color:${th.top}">
              ${locked ? '<span class="lock">🔒</span>' : ''}
              <span class="swatch" style="background:linear-gradient(140deg,${th.top},${th.topAlt})"></span>
              <span>${escapeHtml(th.name)}</span>
              <span class="sub" style="font-size:10px;color:${on ? 'var(--gold)' : 'var(--dim)'}">${locked ? escapeHtml(this.t('locked', { n: th.level })) : on ? escapeHtml(this.t('selected')) : escapeHtml(this.t('select'))}</span>
            </button>`;
          }).join('')}
        </div>
        ${this.footRow()}`;
    } else if (this.screen === 'skins') {
      body = `
        ${this.statRow()}
        <button class="back-btn" data-act="back">◀ ${escapeHtml(this.t('back'))}</button>
        <h4 style="color:var(--gold);font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin:2px 2px 4px">${escapeHtml(this.t('skinsTitle'))}</h4>
        <div class="skin-grid">
          ${SKINS.map((sk) => {
            const locked = p.level < sk.level;
            const on = p.data.skin === sk.key;
            return `
            <button class="skin ${on ? 'on' : ''} ${locked ? 'locked' : ''}" data-act="skin:${sk.key}" style="color:${sk.color}">
              ${locked ? '<span class="lock">🔒</span>' : ''}
              <span class="swatch" style="background:${sk.color}"></span>
              <span>${escapeHtml(sk.name)}</span>
              <span class="sub" style="font-size:10px;color:${on ? 'var(--gold)' : 'var(--dim)'}">${locked ? escapeHtml(this.t('locked', { n: sk.level })) : on ? escapeHtml(this.t('selected')) : escapeHtml(this.t('select'))}</span>
            </button>`;
          }).join('')}
        </div>
        ${this.footRow()}`;
    } else if (this.screen === 'profile') {
      const s = p.data.stats;
      body = `
        ${this.statRow()}
        <button class="back-btn" data-act="back">◀ ${escapeHtml(this.t('back'))}</button>
        <div class="field">
          <input id="pfName" maxlength="12" value="${escapeHtml(p.data.name)}" placeholder="${escapeHtml(this.t('nameLbl'))}" />
          <button class="mini-btn" data-act="save-name">${escapeHtml(this.t('save'))}</button>
        </div>
        <h4 style="color:var(--gold);font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin:8px 2px 4px">${escapeHtml(this.t('statsTitle'))}</h4>
        <div class="me-stats" style="margin-bottom:10px">
          ${[
            ['sWins', p.data.wins],
            ['sGames', p.data.games],
            ['sSurvived', s.survived],
            ['sShoves', s.eliminations],
            ['sPowers', s.powerups],
            ['sFalls', s.falls],
          ]
            .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${escapeHtml(this.t(k))}</span></div>`)
            .join('')}
          <div class="stat"><b>${p.data.bestRoundTime.toFixed(0)}s</b><span>${escapeHtml(this.t('sBest'))}</span></div>
          <div class="stat"><b>${p.data.rp}</b><span>RP</span></div>
        </div>
        <button class="danger-btn" data-act="reset">${this.resetArmed ? escapeHtml(this.t('resetQ')) : escapeHtml(this.t('reset'))}</button>
        ${this.footRow()}`;
    }

    this.el.menuRoot.innerHTML = body;
  }

  onMenuClick(e) {
    const seg = e.target.closest('[data-seg] button');
    if (seg) {
      const group = seg.closest('[data-seg]').dataset.seg;
      this.opts[group] = group === 'seats' ? parseInt(seg.dataset.v, 10) : seg.dataset.v;
      this.fire('click');
      this.renderMenu();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const [name, arg] = act.dataset.act.split(':');
    this.fire('click');
    const p = this.profile;
    switch (name) {
      case 'setup-bots':
        this.opts.entry = 'bots';
        this.opts.two = false;
        this.goto('setup');
        break;
      case 'setup-two':
        this.opts.entry = 'two';
        this.opts.two = true;
        this.goto('setup');
        break;
      case 'back':
        this.resetArmed = false;
        this.goto('home');
        break;
      case 'goto-daily':
        this.goto('daily');
        break;
      case 'goto-tasks':
        this.goto('tasks');
        break;
      case 'goto-rating':
        this.goto('rating');
        break;
      case 'goto-themes':
        this.goto('themes');
        break;
      case 'goto-skins':
        this.goto('skins');
        break;
      case 'goto-profile':
        this.goto('profile');
        break;
      case 'claim-bonus': {
        const g = p.claimBonus();
        if (g) {
          this.fire('xp', g);
          this.toast(this.t('tXp', { n: g.n }), '#a9f0b6');
        }
        this.renderMenu();
        break;
      }
      case 'claim-mission': {
        const m = MISSIONS.find((x) => x.key === arg);
        const g = m ? p.claimMission(m) : null;
        if (g) {
          this.fire('xp', g);
          this.toast(this.t('tXp', { n: g.n }), '#a9f0b6');
        }
        this.renderMenu();
        break;
      }
      case 'claim-ach': {
        const a = ACHIEVEMENTS.find((x) => x.key === arg);
        const g = a ? p.claimAchievement(a) : null;
        if (g) {
          this.fire('xp', g);
          this.toast(this.t('tXp', { n: g.n }), '#ffe6a3');
        }
        this.renderMenu();
        break;
      }
      case 'theme': {
        const th = THEMES.find((x) => x.key === arg);
        if (th && p.level >= th.level) {
          p.data.theme = th.key;
          p.save();
          this.fire('theme', th);
        } else if (th) {
          this.toast(this.t('locked', { n: th.level }), '#9aa7c7');
        }
        this.renderMenu();
        break;
      }
      case 'skin': {
        const sk = SKINS.find((x) => x.key === arg);
        if (sk && p.level >= sk.level) {
          p.data.skin = sk.key;
          p.save();
        } else if (sk) {
          this.toast(this.t('locked', { n: sk.level }), '#9aa7c7');
        }
        this.renderMenu();
        break;
      }
      case 'botfill':
        this.opts.botFill = !this.opts.botFill;
        this.renderMenu();
        break;
      case 'two':
        this.opts.two = !this.opts.two;
        this.renderMenu();
        break;
      case 'start':
        this.fire('start');
        break;
      case 'lang':
        p.data.lang = p.data.lang === 'uz' ? 'en' : 'uz';
        p.save();
        document.documentElement.lang = p.data.lang;
        this.renderMenu();
        if (this.current === 'pause') this.renderPauseTexts();
        break;
      case 'sound':
        p.data.sound = !p.data.sound;
        p.save();
        this.fire('sound', p.data.sound);
        this.renderMenu();
        break;
      case 'music':
        p.data.music = !p.data.music;
        p.save();
        this.fire('music', p.data.music);
        this.renderMenu();
        break;
      case 'save-name': {
        const input = this.el.menuRoot.querySelector('#pfName');
        if (input) {
          p.data.name = input.value.trim().slice(0, 12) || 'Siz';
          p.save();
        }
        this.renderMenu();
        break;
      }
      case 'reset':
        if (this.resetArmed) {
          p.reset();
          this.resetArmed = false;
          this.fire('reset');
        } else {
          this.resetArmed = true;
        }
        this.renderMenu();
        break;
      default:
        break;
    }
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
    this.el.round.textContent = `${this.t('round')} ${match.round}/${match.opts.maxRounds}`;

    const t = Math.max(0, match.roundT);
    const text = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    if (text !== this.lastTimerText) {
      this.el.timer.textContent = text;
      this.lastTimerText = text;
      this.el.timer.classList.toggle('danger', t <= 15);
    }

    this.el.alive.textContent = `${players.filter((p) => p.alive).length} ${this.t('alive')}`;

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

    const me = players.find((p) => !p.isBot && p.alive) || players.find((p) => !p.isBot);
    if (me && this.el.dashRing) {
      const cd = PLAYER.dashCooldown * (me.speedT > 0 ? 0.6 : 1);
      const k = me.dashCd <= 0 ? 1 : 1 - me.dashCd / cd;
      this.el.dashRing.style.strokeDashoffset = String(113 * (1 - k));
      this.el.dashMeter.classList.toggle('ready', me.dashCd <= 0);
      this.el.dashMeter.style.opacity = me.alive ? '1' : '0.35';
    }

    if (me) {
      const effs = [];
      if (me.speedT > 0) effs.push(['speed', me.speedT]);
      if (me.phantomT > 0) effs.push(['phantom', me.phantomT]);
      if (me.freezeT > 0) effs.push(['freeze', me.freezeT]);
      if (me.titanT > 0) effs.push(['titan', me.titanT]);
      const key = effs.map((x) => x[0] + Math.ceil(x[1])).join('|');
      if (key !== this.effKeys) {
        this.effKeys = key;
        this.el.effects.innerHTML = effs
          .map(([k2, t2]) => {
            const d = POWERUPS[k2];
            return `<span class="eff" style="background:${d.color}">${d.icon} ${escapeHtml(this.pwName(k2))} ${t2.toFixed(1)}s</span>`;
          })
          .join('');
      }
    }

    const warn = match.arena.collapseWarn > 0 && match.state === 'playing';
    this.setSubMsg(warn ? this.t('warn') : '');
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
    void this.el.msg.offsetWidth;
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
    this.el.reTitle.textContent = data.timedOut ? this.t('timeUp') : this.t('roundEnd');
    const winners = data.results.filter((x) => x.place === 1).length;
    this.el.reResults.innerHTML = data.results
      .slice(0, 6)
      .map(
        (r, i) => `
      <div class="res-row ${r.place === 1 ? 'win' : ''}" style="animation-delay:${i * 60}ms">
        <div class="res-place">${r.place}</div>
        <div class="res-name" style="color:${r.player.color}">${escapeHtml(r.player.name)}</div>
        <div class="res-tag">${r.winner && winners === 1 ? this.t('winner') : r.place === 1 ? this.t('survivedTag') : this.t('fellTag')}</div>
        <div class="res-pts">+${MATCH_POINTS(r.place, data.timedOut && r.place === 1)}</div>
      </div>`
      )
      .join('');
    this.el.reStandings.innerHTML = this.standingsHtml(data.standings, match);
    this.el.reNext.textContent = match.matchWinner ? this.t('finalNext') : this.t('nextRound', { n: match.round + 1 });
    this.show('roundEnd');
  }

  showMatchEnd(match, gains) {
    const w = match.matchWinner;
    const human = match.players.find((p) => !p.isBot);
    const iWon = human && w && human.id === w.id;
    this.el.meCrown.textContent = iWon ? '👑' : '💀';
    this.el.meTitle.textContent = iWon ? this.t('champYou') : this.t('champOther', { name: w ? w.name.toUpperCase() : '—' });
    this.el.meTitle.style.color = iWon ? 'var(--gold)' : w ? w.color : 'var(--rose)';
    this.el.meSub.textContent = iWon
      ? this.t('subWin', { n: match.round })
      : this.t('subLose', { n: match.round, name: w ? w.name : '—', w: w ? w.wins : 0 });
    this.el.meXp.innerHTML = gains
      ? `<span class="xp-chip">🪙 ${this.t('tXp', { n: gains.xp })}</span><span class="xp-chip rp">🏅 ${this.t('tRp', { n: gains.rp })}</span>`
      : '';
    this.el.meStandings.innerHTML = this.standingsHtml(match.standings(), match);

    const who = human || w;
    const s = who.stats;
    this.el.meStats.innerHTML = [
      [this.t('sWins'), who.wins],
      ['XP', who.points * 8 + who.wins * 120],
      [this.t('sShoves'), s.eliminations],
      [this.t('sFalls'), s.falls],
      [this.t('sPowers'), s.powerups],
      [this.t('sBest'), s.bestTime.toFixed(0) + 's'],
    ]
      .map(([label, val]) => `<div class="stat"><b>${val}</b><span>${escapeHtml(label)}</span></div>`)
      .join('');
    this.el.btnRematch.textContent = this.t('rematch');
    this.el.btnMenu.textContent = this.t('menuBtn');
    this.show('matchEnd');
  }

  standingsHtml(standings, match) {
    return standings
      .map(
        (p, i) => `
      <div class="st-row ${i === 0 ? 'leader' : ''} ${!p.isBot ? 'me' : ''}">
        <div class="st-pos">${i + 1}</div>
        <div class="st-name"><span style="width:9px;height:9px;border-radius:50%;background:${p.color};display:inline-block;box-shadow:0 0 8px ${p.color}"></span>${escapeHtml(p.name)}${!p.isBot ? ` <span style="color:var(--dim);font-weight:600">(${escapeHtml(this.t('youLow'))})</span>` : ''}</div>
        <div class="st-wins">★ ${p.wins}/${match.opts.roundsToWin}</div>
        <div class="st-pts">${p.points}</div>
      </div>`
      )
      .join('');
  }
}

function MATCH_POINTS(place, survivedTimeout) {
  const table = MATCH.points;
  return table[Math.min(place - 1, table.length - 1)] + (survivedTimeout ? MATCH.survivalBonus : 0);
}
