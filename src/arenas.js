/**
 * Data-driven arena definitions (V2: "ArenaDefinition").
 *
 * The simulation (arena.js / match.js / player.js) reads everything from these
 * configs — there is exactly ONE physics code path for both maps. Only data
 * differs: grid shape, tile palette, timings, hazard patterns, event pool and
 * the visual theme the renderer picks up.
 */

import { MAT } from './config.js?v=20260913';

/* ------------------------------------------------------------------ modes */

/** Queue modes. `teams` = players per team (0 → free-for-all). */
export const MODES = {
  solo: { id: 'solo', teams: 0, perTeam: 1, size: 8, minSize: 2, descKey: 'modeSoloDesc', label: 'SOLO' },
  '1v1': { id: '1v1', teams: 2, perTeam: 1, size: 2, minSize: 2, descKey: 'mode1v1Desc', label: '1v1' },
  '2v2': { id: '2v2', teams: 2, perTeam: 2, size: 4, minSize: 4, descKey: 'mode2v2Desc', label: '2v2' },
  '3v3': { id: '3v3', teams: 2, perTeam: 3, size: 6, minSize: 6, descKey: 'mode3v3Desc', label: '3v3' },
  '4v4': { id: '4v4', teams: 2, perTeam: 4, size: 8, minSize: 8, descKey: 'mode4v4Desc', label: '4v4' },
};

export const MODE_IDS = Object.keys(MODES);

/* --------------------------------------------------------------- arenas */

export const ARENAS = {
  /**
   * Arena #1 — COLOR GRID: bright 8x8 board of big rounded square tiles,
   * arcade palette, very readable danger states (reference-style, original art).
   */
  color_grid: {
    id: 'color_grid',
    nameKey: 'arenaColorGrid',
    gridType: 'square',
    n: 8,
    cell: 84,
    minRing: 1,
    style: 'bright_arcade',
    palette: ['#ff5d73', '#ffb03a', '#ffe14d', '#5dffa8', '#4dd0ff', '#b47cff'],
    specialChance: 0.1,
    crackMul: 1.0,
    quakeInterval: 15,
    firstQuake: 11,
    collapseInterval: 21,
    firstCollapse: 26,
    eventPool: ['shockwave', 'ice', 'speed', 'blackout', 'lavaWave', 'quake', 'tornado', 'darkness', 'lowGrav', 'collapseWave'],
    theme: {
      bg0: '#101a33',
      bg1: '#1b2b52',
      edge: 'rgba(255,255,255,0.16)',
      shadow: 'rgba(6,10,24,0.45)',
    },
  },

  /**
   * Arena #2 — CHAOS CORE: the original hexagonal volcano board, dark theme,
   * faster collapses, more quakes, lava veins. Completely different rhythm.
   */
  chaos_core: {
    id: 'chaos_core',
    nameKey: 'arenaChaosCore',
    gridType: 'hex',
    radius: 6,
    cell: 46,
    minRing: 1,
    style: 'chaos_arcade',
    palette: null, // uses MATERIALS colours
    specialChance: 0.16,
    crackMul: 0.9,
    quakeInterval: 13,
    firstQuake: 9,
    collapseInterval: 18,
    firstCollapse: 22,
    eventPool: ['quake', 'collapseWave', 'lavaWave', 'shockwave', 'tornado', 'darkness', 'ice', 'speed', 'blackout', 'lowGrav'],
    theme: {
      bg0: '#0d1322',
      bg1: '#151d33',
      edge: 'rgba(255,255,255,0.08)',
      shadow: 'rgba(0,0,0,0.5)',
    },
  },
};

export const ARENA_IDS = Object.keys(ARENAS);

export function arenaDef(id) {
  return ARENAS[id] || ARENAS.chaos_core;
}

/* ------------------------------------------------------------ modifiers */

/** One round modifier per round — the main anti-repetition layer. */
export const MODIFIERS = {
  normal: { id: 'normal', key: 'modNormal', weight: 26 },
  chaos: { id: 'chaos', key: 'modChaos', weight: 12 },
  fastTiles: { id: 'fastTiles', key: 'modFastTiles', weight: 12 },
  slippery: { id: 'slippery', key: 'modSlippery', weight: 12 },
  lowGrav: { id: 'lowGrav', key: 'modLowGrav', weight: 10 },
  doubleJump: { id: 'doubleJump', key: 'modDoubleJump', weight: 10 },
  tinyTiles: { id: 'tinyTiles', key: 'modTinyTiles', weight: 9 },
  suddenLava: { id: 'suddenLava', key: 'modSuddenLava', weight: 9 },
};

export const MODIFIER_IDS = Object.keys(MODIFIERS);

export function rollModifier(rng) {
  let total = 0;
  for (const id of MODIFIER_IDS) total += MODIFIERS[id].weight;
  let roll = rng() * total;
  for (const id of MODIFIER_IDS) {
    roll -= MODIFIERS[id].weight;
    if (roll <= 0) return id;
  }
  return 'normal';
}

/* ---------------------------------------------------------------- emotes */

export const EMOTES = ['👋', '', '😱', '🔥', '💀', '🫡', '❤️', '🏆'];

/* ------------------------------------------------------------ map vote */

export const VOTE_SECONDS = 9;
