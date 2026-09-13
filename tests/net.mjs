// tests/net.mjs — host/guest relay pipeline without sockets: identical seeds +
// snapshot stream must keep every guest in step with the host simulation.
import { Match } from '../src/match.js?v=20260913';
import { NetHost, NetGuest, buildGuestView } from '../src/net.js?v=20260913';
import { PALETTE } from '../src/config.js?v=20260913';

const fails = [];
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fails.push(msg);
};

const roster = [
  { id: 'A', name: 'Ali', slot: 0 },
  { id: 'B', name: 'Vali', slot: 1 },
  { id: 'C', name: 'Salim', slot: 2 },
].map((r) => ({ ...r, color: PALETTE[r.slot] }));
const cfg = { seed: 4242, radius: 6, roundsToWin: 3, difficulty: 'normal', round: 1, maxRounds: 7, arenaId: 'color_grid' };

const wire = [];                       // host → guests
const hostNet = { connected: true, guestCount: () => 2, send: (o) => wire.push(o), id: 'A', role: 'host' };
const guestNet = { connected: true, guestCount: () => 0, send: () => {}, id: 'B', role: 'guest', mySlot: 1 };

console.log('host side');
const match = new Match({
  seed: cfg.seed,
  humans: 3,
  bots: 0,
  difficulty: cfg.difficulty,
  arenaRadius: cfg.radius,
  roundsToWin: cfg.roundsToWin,
  maxRounds: cfg.maxRounds,
  netRoster: roster.map((r, i) => ({ ...r, isLocal: i === 0 })),
});
const host = new NetHost(hostNet);
host.reset(match);
ok(match.players.length === 3, 'netRoster built 3 seats');
ok(match.players[1].controls === null && match.players[0].controls === 0, 'only the local seat has controls');
ok(match.players[2].netSlot === 2, 'netSlot assigned');

console.log('guest side');
const guest = new NetGuest(guestNet);
const view = guest.startRound({ ...cfg, ...host.roundMessage(match) }, roster, 1);
ok(view.players.length === 3, 'guest view has the full roster');
ok(view.players.find((p) => p.isLocal).netSlot === 1, 'guest local player is my slot');
ok(view.players.every((p, i) => p.color === match.players[i].color), 'guest colours match host colours');
ok(
  view.arena.list.length === match.arena.list.length &&
    view.arena.list.every((t, i) => t.material === match.arena.list[i].material),
  'guest arena is identical (same seed)'
);

// relay loop: host ticks → guest applies whatever the wire carried
const pump = () => {
  while (wire.length) {
    const msg = wire.shift();
    if (msg.t === 'snap') {
      for (const e of guest.applySnap(msg.d)) {
        if (e.type === 'roundEnd') guest.startRound({ ...cfg, ...host.roundMessage(match) }, roster, 1);
      }
    } else if (msg.t === 'ev') {
      guest.applyEv(msg.d);
    }
  }
};
host.tick(match, 1 / 60, match.drainEvents());
pump();
ok(
  view.players.every((p, i) => Math.abs(p.x - match.players[i].x) < 0.01),
  'first snapshot places guests exactly on host positions'
);
ok(view.arena.list.every((t, i) => t.state === match.arena.list[i].state), 'snapshot syncs tile states');

console.log('180 steps with steady remote input');
let bytes = 0;
const realSend = hostNet.send;
hostNet.send = (o) => {
  bytes += JSON.stringify(o).length;
  realSend(o);
};
for (let i = 0; i < 180; i++) {
  const map = new Map();
  map.set(match.players[0].id, { mx: 0.2, my: 0, dash: i === 40 });
  map.set(match.players[1].id, { mx: 0.6, my: -0.4, dash: false });
  map.set(match.players[2].id, { mx: -0.5, my: 0.5, dash: false });
  match.update(1 / 60, map);
  host.tick(match, 1 / 60, match.drainEvents());
  pump();
}
const drift = Math.max(...guest.view.players.map((p, i) => Math.hypot(p.x - match.players[i].x, p.y - match.players[i].y)));
ok(drift < 4, `guest drift stays small after 3s (${drift.toFixed(2)}px)`);
ok(
  guest.view.players.map((p) => p.wins).join() === match.players.map((p) => p.wins).join(),
  'round wins stay in sync'
);
ok(
  guest.view.arena.list.every((t, i) => t.state === match.arena.list[i].state),
  'tile states stay in sync (delta stream)'
);
ok(bytes / 180 < 700, `wire traffic is light (${(bytes / 180).toFixed(0)} B/step avg)`);
ok(wire.length === 0, 'every relayed message was consumed');

console.log('snapshots correct a desynced guest');
guest.view.players[0].x += 60;
guest.view.players[0].y -= 40;
for (let i = 0; i < 12; i++) {
  const map = new Map();
  map.set(match.players[0].id, { mx: 0, my: 0, dash: false });
  map.set(match.players[1].id, { mx: 0, my: 0, dash: false });
  map.set(match.players[2].id, { mx: 0, y: 0, my: 0, dash: false });
  match.update(1 / 60, map);
  host.tick(match, 1 / 60, match.drainEvents());
  pump();
  guest.interpolate(1 / 60);
}
const drift2 = Math.hypot(guest.view.players[0].x - match.players[0].x, guest.view.players[0].y - match.players[0].y);
ok(drift2 < 2, `guest snaps back to the host position (${drift2.toFixed(2)}px)`);

console.log('V2: teams, arenaId va modifier guest view ga o‘tadi');
{
  const tRoster = [
    { id: 'A', name: 'Ali', slot: 0, color: PALETTE[0], team: 0 },
    { id: 'B', name: 'Vali', slot: 1, color: PALETTE[1], team: 1 },
    { id: 'C', name: 'Salim', slot: 2, color: PALETTE[2], team: 0 },
    { id: 'D', name: 'Hasan', slot: 3, color: PALETTE[3], team: 1 },
  ];
  const tMatch = new Match({
    seed: 777, humans: 4, bots: 0, mode: '2v2', arenaId: 'chaos_core',
    modifier: 'fastTiles', netRoster: tRoster.map((r, i) => ({ ...r, isLocal: i === 0 })),
  });
  const tHost = new NetHost({ connected: true, guestCount: () => 3, send: () => {}, id: 'A', role: 'host' });
  tHost.reset(tMatch);
  const rm = tHost.roundMessage(tMatch);
  ok(rm.arenaId === 'chaos_core' && rm.mode === '2v2' && rm.modifier === 'fastTiles', 'roundMessage carries V2 cfg');
  const tView = buildGuestView({ ...rm }, tRoster, 2);
  ok(tView.players.filter((p) => p.team === 0).length === 2, 'guest view splits teams 2v2');
  ok(tView.players.find((p) => p.isLocal).netSlot === 2, 'guest view local seat correct');
  ok(
    tView.arena.list.length === tMatch.arena.list.length &&
      tView.arena.list.every((t, i) => t.material === tMatch.arena.list[i].material),
    'chaos_core arena identical on host and guest'
  );
  ok(tView.arena.modCrack === 0.55, 'fastTiles modifier synced to guest');
}

if (fails.length) {
  console.error(`\n❌ ${fails.length} test yiqildi:\n- ` + fails.join('\n- '));
  process.exit(1);
}
console.log('\n✅ Net testlari o‘tdi');
