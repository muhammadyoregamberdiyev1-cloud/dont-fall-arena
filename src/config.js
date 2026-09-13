/**
 * Don't Fall Arena — global tuning constants.
 * Everything is expressed in "world units" (1 unit ≈ 1 px at camera scale 1).
 */

export const TILE = {
  GONE: 0,
  FALLING: 1,
  CRACKED: 2,
  SOLID: 3,
};

export const MAT = {
  NORMAL: 'normal',
  STEEL: 'steel',
  ICE: 'ice',
  CRUMBLE: 'crumble',
};

/** Per-material behaviour table. */
export const MATERIALS = {
  normal: {
    label: 'Oddiy',
    hp: 1.55, // standing-seconds before it cracks
    crackTime: 0.75, // CRACKED -> FALLING
    fallTime: 0.5, // FALLING -> GONE
    friction: 11,
    top: '#39d98a',
    topAlt: '#25b873',
    side: '#12593a',
    edge: '#8dffc9',
  },
  steel: {
    label: "Po'lat",
    hp: 3.4,
    crackTime: 0.95,
    fallTime: 0.62,
    friction: 12,
    top: '#8fa3bf',
    topAlt: '#6d8099',
    side: '#2c3a4d',
    edge: '#d7e6ff',
  },
  ice: {
    label: 'Muz',
    hp: 1.5,
    crackTime: 0.6,
    fallTime: 0.45,
    friction: 2.4, // slippery!
    top: '#7fe9ff',
    topAlt: '#54c9e8',
    side: '#1d5f77',
    edge: '#e2fbff',
  },
  crumble: {
    label: "Mo'rt",
    hp: 0.42,
    crackTime: 0.16,
    fallTime: 0.38,
    friction: 9,
    top: '#ffb057',
    topAlt: '#e08b32',
    side: '#6d3c11',
    edge: '#ffdca8',
  },
};

export const POWERUPS = {
  shatter: {
    key: 'shatter',
    label: 'Zilzila',
    icon: '✷',
    color: '#ff7a45',
    desc: 'Atrofdagi plitalarni darhol yorib yuboradi',
    duration: 0,
    radius: 2,
  },
  freeze: {
    key: 'freeze',
    label: 'Muzlatish',
    icon: '❄',
    color: '#5ad7ff',
    desc: '5 soniya: oyoq ostingizdagi plitalar butun qoladi',
    duration: 5,
    radius: 1,
  },
  speed: {
    key: 'speed',
    label: 'Chaqqonlik',
    icon: '⚡',
    color: '#ffe14d',
    desc: '6 soniya: tezlik + dash tezroq tiklanadi',
    duration: 6,
  },
  phantom: {
    key: 'phantom',
    label: 'Arvoh',
    icon: '✦',
    color: '#c08bff',
    desc: '5 soniya: yorilgan va qulayotgan plitalarda yura olasiz',
    duration: 5,
  },
  star: {
    key: 'star',
    label: 'Yulduz',
    icon: '★',
    color: '#ffd23f',
    desc: '8 soniya: ochkolar ikki barobar + darhol +15',
    duration: 8,
  },
  mirror: {
    key: 'mirror',
    label: 'Oyna',
    icon: '⇄',
    color: '#ff6fe0',
    desc: '4 soniya: boshqaruv teskari (raqiblar uchun emas — faqat siz)',
    duration: 4,
  },
  portal: {
    key: 'portal',
    label: 'Portal',
    icon: '◎',
    color: '#7cf5ff',
    desc: 'Darhol xavfsiz plitaga teleport qiladi',
    duration: 0,
  },
  titan: {
    key: 'titan',
    label: 'Titan',
    icon: '⬢',
    color: '#6dff9e',
    desc: '6 soniya: urilishda raqibni ikki barobar uzoqqa otadi',
    duration: 6,
  },
};

export const PLAYER = {
  radius: 15,
  accel: 1900,
  maxSpeed: 235,
  airControl: 0.55,
  dashSpeed: 800,
  dashTime: 0.22,
  dashCooldown: 1.75,
  saveWindow: 0.3, // after leaving solid ground you can still scramble back
  fallDuration: 0.6, // visual fall before elimination
  bumpRadiusBoost: 1.15,
  bumpImpulse: 260,
  bumpCooldown: 0.18,
  killCreditWindow: 1.3,
};

export const ARENA = {
  radius: 6, // hex rings from the centre
  tileSize: 46,
  depth: 13, // extrusion height for the 2.5D look
  firstQuake: 6,
  quakeInterval: 5,
  quakeBase: 3,
  quakeRamp: 18, // +1 extra cracked tile per this many seconds
  firstCollapse: 14,
  collapseInterval: 9,
  minRing: 0, // 0 = even the centre tile eventually goes (sudden death)
  roundTime: 80,
  powerupMinRing: 2, // no loot once the arena is down to a handful of tiles
  suddenDeathQuake: 2.2,
  mixSpecials: 0.16, // chance a spawned tile is steel/ice/crumble
};

export const MATCH = {
  roundsToWin: 3, // first to N round wins takes the match
  maxRounds: 7,
  countdownTime: 3,
  roundEndTime: 4.2,
  // placement points, index = position from the winner down
  points: [5, 3, 2, 1, 1, 1, 1, 1],
  survivalBonus: 1, // extra point for surviving the time limit
};

export const DIFFICULTY = {
  chill: {
    label: 'Oson',
    skill: 0.55,
    reaction: 0.34,
    lookahead: 2,
    dashSkill: 0.5,
    greed: 0.4,
    jitter: 26,
  },
  normal: {
    label: "O'rta",
    skill: 0.75,
    reaction: 0.2,
    lookahead: 3,
    dashSkill: 0.72,
    greed: 0.7,
    jitter: 15,
  },
  spicy: {
    label: 'Qiyin',
    skill: 0.9,
    reaction: 0.11,
    lookahead: 4,
    dashSkill: 0.9,
    greed: 0.95,
    jitter: 8,
  },
  nightmare: {
    label: 'Dahshat',
    skill: 0.98,
    reaction: 0.05,
    lookahead: 5,
    dashSkill: 1,
    greed: 1,
    jitter: 3,
  },
};

export const PALETTE = [
  '#ff5d73', // you (rose)
  '#4dd0ff',
  '#ffd23f',
  '#b47cff',
  '#5dffa8',
  '#ff9f45',
  '#ff6fe0',
  '#e8ff5d',
];

export const BOT_NAMES = [
  'Zilzila',
  'Bo\'ri',
  'Qora Quyosh',
  'Samar',
  'Temur',
  'Yulduz',
  'Xanjar',
  'Qumri',
  'Barlos',
  'Sahro',
  'Muzlak',
  'Alpomish',
];

/* ==========================================================================
   Meta layer: season, ranks, themes, skins, missions, achievements
   ========================================================================== */

export const SEASON = {
  number: 1,
  name: 'SURVIVAL',
  end: '2026-10-01T00:00:00Z',
};

/** RP thresholds; index 0 = Bronze III. */
export const RANKS = [
  { rp: 0, name: 'BRONZE III', icon: '🥉' },
  { rp: 100, name: 'BRONZE II', icon: '🥉' },
  { rp: 250, name: 'BRONZE I', icon: '🥉' },
  { rp: 450, name: 'KUMUSH III', icon: '🥈' },
  { rp: 700, name: 'KUMUSH II', icon: '🥈' },
  { rp: 1000, name: 'KUMUSH I', icon: '🥈' },
  { rp: 1400, name: 'OLTIN III', icon: '🥇' },
  { rp: 1900, name: 'OLTIN II', icon: '🥇' },
  { rp: 2500, name: 'OLTIN I', icon: '🥇' },
  { rp: 3200, name: 'PLATINA', icon: '💎' },
  { rp: 4200, name: 'AFSONA', icon: '👑' },
];

/** Arena palettes (Kollektsiya). Unlocked by player level. */
export const THEMES = [
  {
    key: 'classic',
    level: 1,
    name: 'Klassik',
    top: '#39d98a',
    topAlt: '#25b873',
    side: '#12593a',
    edge: '#8dffc9',
  },
  {
    key: 'glacier',
    level: 2,
    name: 'Muzlik',
    top: '#63c9f0',
    topAlt: '#3fa8d8',
    side: '#175a78',
    edge: '#d8f6ff',
  },
  {
    key: 'sunset',
    level: 3,
    name: 'Quyosh',
    top: '#ff9d5c',
    topAlt: '#f0763c',
    side: '#7a3413',
    edge: '#ffd9ae',
  },
  {
    key: 'neon',
    level: 4,
    name: 'Neon',
    top: '#b06bff',
    topAlt: '#8b46e0',
    side: '#3c1a70',
    edge: '#e6ccff',
  },
  {
    key: 'gold',
    level: 5,
    name: 'Oltin',
    top: '#ffd23f',
    topAlt: '#e0ac1e',
    side: '#6d5205',
    edge: '#fff3c4',
  },
];

/** Player colours (Skinlar). Unlocked by player level. */
export const SKINS = [
  { key: 'rose', level: 1, name: 'Atirgul', color: '#ff5d73' },
  { key: 'cyan', level: 1, name: 'Muzko\'k', color: '#4dd0ff' },
  { key: 'sun', level: 1, name: 'Quyosh', color: '#ffd23f' },
  { key: 'violet', level: 2, name: 'Binafsha', color: '#b47cff' },
  { key: 'mint', level: 2, name: 'Yalpiz', color: '#5dffa8' },
  { key: 'ember', level: 3, name: "Cho'g'", color: '#ff9f45' },
  { key: 'candy', level: 3, name: 'Konfet', color: '#ff6fe0' },
  { key: 'lime', level: 4, name: 'Laym', color: '#e8ff5d' },
];

/** Daily missions; progress lives in profile.daily. */
export const MISSIONS = [
  { key: 'survive', target: 3, xp: 60, icon: '🛟' },
  { key: 'shove', target: 2, xp: 80, icon: '💥' },
  { key: 'power', target: 3, xp: 40, icon: '✨' },
];

/** Lifetime achievements (Vazifalar). */
export const ACHIEVEMENTS = [
  { key: 'first', target: 1, xp: 50, icon: '🎬', stat: 'games' },
  { key: 'survivor', target: 10, xp: 100, icon: '🛟', stat: 'survived' },
  { key: 'bull', target: 25, xp: 150, icon: '💥', stat: 'eliminations' },
  { key: 'collector', target: 20, xp: 100, icon: '✨', stat: 'powerups' },
  { key: 'champ', target: 5, xp: 250, icon: '🏆', stat: 'wins' },
  { key: 'legend', target: 1, xp: 400, icon: '👑', stat: 'nightmareWins' },
];

export const XP_PER_LEVEL = 300;
