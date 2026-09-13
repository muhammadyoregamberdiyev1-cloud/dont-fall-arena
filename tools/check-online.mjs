// tools/check-online.mjs — end-to-end: browser → serve.mjs /ws tunnel → python relay.
// Run: node tools/check-online.mjs [port]
const port = Number(process.argv[2] || 8080);
const url = `ws://127.0.0.1:${port}/ws`;
const log = (...a) => console.log(...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  const c = { name, msgs: [], ws: null, code: null, id: null, hostId: null, roster: [] };
  c.ready = new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    c.ws = ws;
    const timer = setTimeout(() => reject(new Error(`${name}: connect timeout → ${url}`)), 5000);
    ws.onopen = () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({ t: 'hello', name }));
    };
    ws.onerror = (e) => reject(new Error(`${name}: ws error ${e.message || ''}`));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      c.msgs.push(m);
      if (m.t === 'welcome') {
        c.id = m.id;
        resolve(c);
      }
      if (m.t === 'created' || m.t === 'joined') {
        c.code = m.room;
        c.roster = m.roster || [];
        c.hostId = m.host;
      }
      if (m.t === 'peer_joined' || m.t === 'peer_left') c.roster = m.roster || c.roster;
    };
  });
  c.send = (o) => c.ws.send(JSON.stringify(o));
  c.take = (t) => {
    const i = c.msgs.findIndex((m) => m.t === t);
    return i >= 0 ? c.msgs.splice(i, 1)[0] : null;
  };
  return c;
}

const fails = [];
const ok = (cond, msg) => {
  log(`  ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fails.push(msg);
};

const host = client('HostAli');
const guest = client('GuestVali');
await Promise.all([host.ready, guest.ready]);
ok(host.id && guest.id, `both clients reached the relay through the /ws tunnel (${url})`);

host.send({ t: 'create' });
await wait(250);
const created = host.take('created');
const code = created ? created.room : '';
ok(!!created && /^[A-Z2-9]{4}$/.test(code), `room created: ${code || '?'}`);

guest.send({ t: 'join', room: code });
await wait(250);
const joined = guest.take('joined');
ok(!!joined, 'guest joined by code');
ok((host.take('peer_joined') || {}).t === 'peer_joined', 'host notified about the new peer');
ok(joined && joined.roster.length === 2, `roster has 2 players (slots ${joined ? joined.roster.map((r) => r.slot).join(',') : ''})`);
ok(joined && joined.roster[1].id === guest.id, 'guest got slot 1');

guest.send({ t: 'in', d: { mx: 0.5, my: -0.25, dash: true } });
await wait(200);
const inp = host.take('in');
ok(!!inp && inp.d.mx === 0.5 && inp.d.dash === true, 'guest input relayed to the host only');

host.send({ t: 'start', cfg: { seed: 99, arenaRadius: 6, roundsToWin: 3, difficulty: 'hard' } });
await wait(200);
const started = guest.take('room_start');
ok(!!started && started.cfg.seed === 99 && started.cfg.arenaRadius === 6, 'host start broadcast to guests with cfg');
ok(!!started && started.roster.length === 2, 'start carries the final roster');

host.send({ t: 'snap', d: { st: 1, r: 1, ps: [[10, 20, 0, 1, 0, 0, 0, 0, 0]] } });
await wait(200);
const snap = guest.take('snap');
ok(!!snap && snap.d.ps[0][0] === 10, 'snapshot relayed host → guests');
ok(!host.take('snap'), 'snapshots never echo back to the host');

guest.send({ t: 'chat', text: 'salom!' });
await wait(200);
ok((host.take('room_chat') || {}).text === 'salom!', 'chat relayed');

guest.send({ t: 'result_probe' }); // unknown type must not crash the relay
await wait(120);
ok(host.ws.readyState === 1, 'relay survives an unknown message type');

guest.send({ t: 'leave' });
await wait(250);
ok((host.take('peer_left') || {}).t === 'peer_left', 'host notified when a guest leaves');

host.ws.close();
guest.ws.close();
await wait(150);
const rooms = await fetch(`http://127.0.0.1:8081/rooms`).then((r) => r.json());
ok(Array.isArray(rooms.rooms), `HTTP /rooms reports ${rooms.rooms.length} open room(s)`);

if (fails.length) {
  console.error(`\n❌ ${fails.length} muammo:\n- ` + fails.join('\n- '));
  process.exit(1);
}
log('\n✅ Onlayn tunnel testi o‘tdi');
process.exit(0);
