// tests/i18n.mjs — UZ/EN kalitlar pariteti (V2 talabi: automated parity test)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'src', 'ui.js'), 'utf8');

function grab(startMark, endMark) {
  const start = src.indexOf(startMark);
  if (start < 0) throw new Error('marker topilmadi: ' + startMark);
  const end = src.indexOf(endMark, start + startMark.length);
  const block = src.slice(start, end < 0 ? undefined : end);
  const keys = new Set();
  for (const m of block.matchAll(/^\s{4}([a-zA-Z0-9_]+)\s*:/gm)) keys.add(m[1]);
  return keys;
}

const uz = grab('\n  uz: {', '\n  en: {');
const en = grab('\n  en: {', '\n};');
const missingEn = [...uz].filter((k) => !en.has(k));
const missingUz = [...en].filter((k) => !uz.has(k));

console.log(`uz: ${uz.size} kalit, en: ${en.size} kalit`);
if (missingEn.length || missingUz.length) {
  console.error('EN da yo\'q:', missingEn.join(', '));
  console.error('UZ da yo\'q:', missingUz.join(', '));
  process.exit(1);
}

// yangi V2 kalitlari mavjudligi
const required = [
  'play', 'casual', 'ranked', 'allowBots', 'mmFail', 'mapVote', 'votes', 'mapSelected',
  'arenaColorGrid', 'arenaChaosCore', 'teamA', 'teamB', 'party', 'modChaos', 'modFastTiles',
  'modeSoloDesc', 'modeTeamDesc',
];
const miss = required.filter((k) => !uz.has(k) || !en.has(k));
if (miss.length) {
  console.error('V2 kalitlari yo\'q:', miss.join(', '));
  process.exit(1);
}
console.log('✅ i18n paritet testi o‘tdi');
