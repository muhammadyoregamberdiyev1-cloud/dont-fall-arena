/**
 * Persistent player profile (localStorage): XP, rank, stats, missions,
 * unlocks. The meta layer the menu shows off.
 */

import { RANKS, MISSIONS, ACHIEVEMENTS, XP_PER_LEVEL, SEASON, THEMES, SKINS } from './config.js?v=20260913';

const KEY = 'dont-fall-arena:profile:v2';

const today = () => new Date().toISOString().slice(0, 10);

export function defaultProfile() {
  return {
    name: 'Siz',
    xp: 0,
    rp: 0,
    wins: 0,
    games: 0,
    time: 0, // seconds played
    // lifetime totals used by achievements
    stats: { survived: 0, eliminations: 0, powerups: 0, falls: 0, nightmareWins: 0 },
    bestRoundTime: 0,
    // daily
    daily: { date: today(), stats: { survived: 0, shove: 0, power: 0 }, claimed: {}, bonusClaimed: false },
    claimed: {}, // achievementKey -> true
    theme: 'classic',
    skin: 'rose',
    lang: 'uz',
    sound: true,
    music: true,
  };
}

export class Profile {
  constructor() {
    this.data = load();
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  reset() {
    this.data = defaultProfile();
    this.save();
  }

  /* ------------------------------------------------------------- derived */

  get level() {
    return 1 + Math.floor(this.data.xp / XP_PER_LEVEL);
  }

  get levelProgress() {
    return (this.data.xp % XP_PER_LEVEL) / XP_PER_LEVEL;
  }

  get rank() {
    let idx = 0;
    for (let i = 0; i < RANKS.length; i++) if (this.data.rp >= RANKS[i].rp) idx = i;
    const cur = RANKS[idx];
    const next = RANKS[idx + 1] || null;
    return {
      index: idx,
      ...cur,
      next,
      into: this.data.rp - cur.rp,
      span: next ? next.rp - cur.rp : 0,
    };
  }

  get seasonDaysLeft() {
    const end = new Date(SEASON.end).getTime();
    return Math.max(0, Math.ceil((end - Date.now()) / 86400000));
  }

  theme() {
    const t = THEMES.find((x) => x.key === this.data.theme);
    return t && this.level >= t.level ? t : THEMES[0];
  }

  skinColor() {
    const s = SKINS.find((x) => x.key === this.data.skin);
    return s && this.level >= s.level ? s.color : SKINS[0].color;
  }

  /* -------------------------------------------------------------- rolling */

  rollDaily() {
    if (this.data.daily.date !== today()) {
      this.data.daily = { date: today(), stats: { survived: 0, shove: 0, power: 0 }, claimed: {}, bonusClaimed: false };
      this.save();
    }
  }

  addXp(n) {
    const before = this.level;
    this.data.xp = Math.max(0, this.data.xp + n);
    const after = this.level;
    return { before, after };
  }

  addRp(n) {
    this.data.rp = Math.max(0, this.data.rp + n);
  }

  /** Feed one finished match's numbers into the meta layer. */
  recordMatch(summary) {
    this.rollDaily();
    const d = this.data;
    d.games += 1;
    d.time += summary.time;
    d.wins += summary.won ? 1 : 0;
    d.stats.survived += summary.survived;
    d.stats.eliminations += summary.eliminations;
    d.stats.powerups += summary.powerups;
    d.stats.falls += summary.falls;
    if (summary.won && summary.difficulty === 'nightmare') d.stats.nightmareWins += 1;
    d.bestRoundTime = Math.max(d.bestRoundTime, summary.bestRoundTime);

    // XP / RP from the match itself
    const xp = summary.won * 120 + summary.roundWins * 40 + summary.points * 8 + summary.eliminations * 12;
    const rp = summary.won * 40 + summary.roundWins * 15 + summary.points * 3;
    const lv = this.addXp(xp);
    this.addRp(rp);

    // daily mission progress
    d.daily.stats.survived += summary.survived;
    d.daily.stats.shove += summary.eliminations;
    d.daily.stats.power += summary.powerups;
    this.save();
    return { xp, rp, ...lv };
  }

  missionState(m) {
    this.rollDaily();
    const cur = Math.min(m.target, this.data.daily.stats[m.key] || 0);
    return { cur, done: cur >= m.target, claimed: !!this.data.daily.claimed[m.key] };
  }

  claimMission(m) {
    const st = this.missionState(m);
    if (!st.done || st.claimed) return null;
    this.data.daily.claimed[m.key] = true;
    const lv = this.addXp(m.xp);
    this.save();
    return { n: m.xp, ...lv };
  }

  get bonusReady() {
    this.rollDaily();
    return !this.data.daily.bonusClaimed;
  }

  claimBonus() {
    if (!this.bonusReady) return null;
    this.data.daily.bonusClaimed = true;
    const lv = this.addXp(100);
    this.save();
    return { n: 100, ...lv };
  }

  achievementState(a) {
    const cur = Math.min(a.target, this.data.stats[a.stat] || 0);
    return { cur, done: cur >= a.target, claimed: !!this.data.claimed[a.key] };
  }

  claimAchievement(a) {
    const st = this.achievementState(a);
    if (!st.done || st.claimed) return null;
    this.data.claimed[a.key] = true;
    const lv = this.addXp(a.xp);
    this.save();
    return { n: a.xp, ...lv };
  }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultProfile();
    const base = defaultProfile();
    const p = { ...base, ...JSON.parse(raw) };
    p.stats = { ...base.stats, ...(p.stats || {}) };
    p.daily = { ...base.daily, ...(p.daily || {}) };
    p.daily.stats = { ...base.daily.stats, ...((p.daily && p.daily.stats) || {}) };
    return p;
  } catch {
    return defaultProfile();
  }
}

export { MISSIONS, ACHIEVEMENTS, RANKS, THEMES, SKINS, SEASON };
