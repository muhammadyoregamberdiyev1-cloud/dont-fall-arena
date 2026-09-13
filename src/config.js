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
