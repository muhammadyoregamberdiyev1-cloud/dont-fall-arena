// tools/check-online.mjs — V2 end-to-end online tekshiruvi.
// Brauzer yo‘li: node → serve.mjs /ws tunnel → python relay (server/main.py).
// Run: node tools/check-online.mjs [tunnelPort] [relayPort]
const tunnelPort = Number(process.argv[2] || 8080);
const relayPort = Number(process.argv[3] || 8081);
const url = `ws://127.0.0.1:${tunnelPort}/ws`;
const log = (...a) => console.log(...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const fails = [];
const ok = (cond, msg) => {
  log(`  ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fails.push(msg);
};

/* ------------------------------------------------------------------ client */
let uid = 0;
function client(name, opts = {}) {
  const c = {
    name,
    msgs: [],
    waiters: [],
    ws: null,
    id: null,
    token: null,
    pid: opts.pid || `pid_${++uid}_${Date.now() % 100000}`,
    closed: false,
  };
  c.ready = new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    c.ws = ws;
    const timer = setTimeout(() => reject(new Error(`${name}: connect timeout → ${url}`)), 8000);
    ws.onopen = () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({ t: 'hello', name, pid: c.pid, token: opts.token || '' }));
    };
    ws.onerror = () => reject(new Error(`${name}: ws error`));
    ws.onclose = () => {
      c.closed = true;
      for (const w of c.waiters) w.reject(new Error('closed'));
      c.waiters = [];
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'welcome') {
        c.id = m.id;
        c.token = m.token || c.token;
        resolve(c);
      }
      const i = c.waiters.findIndex((w) => w.t === m.t || w.t === '*');
      if (i >= 0) c.waiters.splice(i, 1)[0].resolve(m);
      else c.msgs.push(m);
    };
  });
  c.send = (o) => {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o));
  };
  c.expect = (t, timeout = 8000) => {
    const i = c.msgs.findIndex((m) => t === '*' || m.t === t);
    if (i >= 0) return Promise.resolve(c.msgs.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const w = { t, resolve };
      w.reject = reject;
      c.waiters.push(w);
      setTimeout(() => {
        const j = c.waiters.indexOf(w);
        if (j >= 0) c.waiters.splice(j, 1);
        reject(new Error(`${name}: timeout waiting '${t}'`));
      }, timeout);
    });
  };
  c.close = () => {
    try { c.ws.close(); } catch { /* ignore */ }
  };
  return c;
}

const mkPid = (n) => `pid_${n}_${Date.now() % 100000}_${++uid}`;

/* ------------------------------------------------------------------ health */
log('== T0: health ==');
{
  const res = await fetch(`http://127.0.0.1:${relayPort}/health`);
  const h = await res.json();
  ok(res.status === 200 && h.ok === true, `health ok (rooms=${h.rooms})`);
}

/* ------------------------------------------- T1: casual 2v2 + vote + bots */
log('== T1: casual 2v2 → match → vote (botlar) → room_start ==');
{
  const a = client('Ali', { pid: mkPid('a') });
  const b = client('Vali', { pid: mkPid('b') });
  await Promise.all([a.ready, b.ready]);
  ok(!!a.token && !!b.token, 'welcome tokenlari berildi');

  a.send({ t: 'queue', mode: '2v2', ranked: false, allowBots: true });
  await a.expect('queued');
  b.send({ t: 'queue', mode: '2v2', ranked: false, allowBots: true });
  await a.expect('match_found');
  await b.expect('match_found');

  const vs = await a.expect('vote_start');
  await b.expect('vote_start');
  ok(Array.isArray(vs.arenas) && vs.arenas.length >= 2, `vote_start: ${vs.arenas.length} arena, ${vs.secs}s`);
  ok(vs.bots.length === 2, '2 ta bot o‘rindig‘i band qilindi');

  // invalid + duplicate votes
  b.send({ t: 'vote', arena: 'nope' });
  const err = await b.expect('error');
  ok(err.key === 'bad_arena', 'yaroqsiz arena rad etildi');

  const bots = {};
  for (const bt of vs.bots) bots[String(bt.slot)] = 'color_grid';
  a.send({ t: 'vote', arena: 'color_grid', bots });
  a.send({ t: 'vote', arena: 'color_grid', bots }); // duplicate replaces
  const upd = await a.expect('vote_update');
  ok(upd.counts.color_grid === 3, `vote_update counts to‘g‘ri (color_grid=${upd.counts.color_grid})`);

  // guest tries to submit bot votes → ignored (not host)
  b.send({ t: 'vote', arena: 'chaos_core', bots: { '99': 'chaos_core' } });
  const upd2 = await a.expect('vote_update');
  ok(!('99' in (upd2.counts || {})) && upd2.counts.color_grid === 3, 'guest bot ovozlari e‘tiborsiz');

  b.send({ t: 'vote', arena: 'color_grid' });
  const vr = await a.expect('vote_result');
  ok(vr.arena === 'color_grid' && vr.tie === false, `vote_result: ${vr.arena}`);
  const rs = await a.expect('room_start');
  await b.expect('room_start');
  ok(rs.cfg.arenaId === 'color_grid' && rs.cfg.mode === '2v2' && rs.cfg.roundsToWin === 3, 'room_start cfg to‘g‘ri');
  ok(rs.roster.length === 4 && rs.roster.filter((r) => r.bot).length === 2, 'roster: 2 inson + 2 bot');
  ok(rs.roster.filter((r) => r.team === 0).length === 2 && rs.roster.filter((r) => r.team === 1).length === 2, 'jamoalar 2/2');

  // late vote rejected
  a.send({ t: 'vote', arena: 'chaos_core' });
  const late = await a.expect('error');
  ok(late.key === 'voteClosed', 'o‘yin boshlangach ovoz berilmaydi');

  // relay routing: guest input → host; host snap → directed guest; emote → all
  const roomHost = rs.host === a.id ? a : b;
  const guest = rs.host === a.id ? b : a;
  guest.send({ t: 'in', d: { mx: 1, my: 0, dash: false } });
  const rin = await roomHost.expect('in', 4000);
  ok(rin.d.mx === 1, 'guest input hostga yetib bordi');
  roomHost.send({ t: 'snap', d: { st: 1, ps: [[1, 2, 0, 1, 0, 0, 0, 0, 0]] }, to: guest.id });
  const sn = await guest.expect('snap', 4000);
  ok(sn.d.st === 1, 'directed snap faqat manzilga bordi');
  let hostGotSnap = false;
  try { await roomHost.expect('snap', 600); hostGotSnap = true; } catch { /* expected */ }
  ok(!hostGotSnap, 'host o‘z snapini qaytib olmadi (echo yo‘q)');
  guest.send({ t: 'emote', d: { e: 'gg' } });
  const em = await roomHost.expect('emote', 4000);
  ok(em.d.e === 'gg', 'emote relay ishlaydi');

  // rewards: host reports result, server computes rewards
  const roster = rs.roster;
  const hostSeat = roster.find((r) => r.id === roomHost.id);
  const results = roster.map((r, i) => ({
    slot: r.slot,
    name: r.name,
    place: r.id === roomHost.id ? 1 : i + 2,
    wins: r.id === roomHost.id ? 3 : 0,
    roundWins: r.id === roomHost.id ? 3 : 0,
    points: r.id === roomHost.id ? 12 : i,
    eliminations: r.id === roomHost.id ? 2 : 0,
  }));
  ok(!!hostSeat, 'host roster ichida');
  roomHost.send({ t: 'result', results });
  const rw = await roomHost.expect('rewards', 6000);
  ok(rw.rewards.won === true && rw.rewards.mvp === true, `rewards: winner+mvp (xp=${rw.rewards.xp})`);
  ok(rw.rewards.xp >= 120 && rw.rewards.coins > 0, `rewards server hisoblagan: xp=${rw.rewards.xp}, coins=${rw.rewards.coins}`);
  ok(typeof rw.rewards.rp === 'number', `rewards: rp=${rw.rewards.rp} (casual=0)`);
  // guest (non-host) result rejected
  guest.send({ t: 'result', results });
  const gerr = await guest.expect('error', 4000);
  ok(gerr.key === 'notHost', 'guest natija yubora olmaydi');

  a.close(); b.close();
}
await wait(300);

/* ------------------------------------------------------ T2: ranked 2v2 */
log('== T2: ranked 2v2 — faqat haqiqiy o‘yinchilar ==');
{
  const cs = [];
  for (let i = 0; i < 4; i++) {
    const c = client(`Rank${i}`, { pid: mkPid(`r${i}`) });
    await c.ready;
    cs.push(c);
  }
  for (const c of cs) c.send({ t: 'queue', mode: '2v2', ranked: true, allowBots: true });
  for (const c of cs) await c.expect('match_found', 12000);
  const vs = await cs[0].expect('vote_start');
  ok(vs.ranked === true && vs.bots.length === 0, 'ranked: allowBots e‘tiborsiz, bot yo‘q');
  for (const c of cs) c.send({ t: 'vote', arena: 'chaos_core' });
  const rs = await cs[0].expect('room_start', 12000);
  ok(rs.cfg.ranked === true && rs.roster.length === 4 && rs.roster.every((r) => !r.bot), 'ranked room_start: 4 haqiqiy o‘yinchi');
  // solo ranked cannot start with bots
  const solo = client('SoloRank', { pid: mkPid('sr') });
  await solo.ready;
  solo.send({ t: 'queue', mode: '1v1', ranked: true, allowBots: true });
  await solo.expect('queued');
  for (const c of cs) c.close();
  solo.close();
}
await wait(300);

/* ---------------------------------------------------------- T3: party */
log('== T3: party create/join/kick/transfer ==');
{
  const a = client('PartyA', { pid: mkPid('pa') });
  const b = client('PartyB', { pid: mkPid('pb') });
  const c = client('PartyC', { pid: mkPid('pc') });
  await Promise.all([a.ready, b.ready, c.ready]);
  a.send({ t: 'party_create' });
  const pu = await a.expect('party_update');
  ok(pu.party.leader === a.id && pu.party.members.length === 1, 'party yaratildi');
  const code = pu.party.code;
  b.send({ t: 'party_join', code });
  const pu2 = await a.expect('party_update');
  const pu2b = await b.expect('party_update');
  ok(pu2.party.members.length === 2 && pu2b.party.code === code, 'party join');
  c.send({ t: 'party_join', code });
  await c.expect('party_update');
  await a.expect('party_update'); // c join update (a tarafda)
  a.send({ t: 'party_kick', id: b.id });
  let pu3 = await a.expect('party_update');
  for (let i = 0; i < 3 && pu3.party.members.some((m) => m.id === b.id); i++) pu3 = await a.expect('party_update');
  ok(!pu3.party.members.some((m) => m.id === b.id), 'party kick');
  let leader = a.id;
  a.send({ t: 'party_transfer', id: c.id });
  for (let i = 0; i < 4 && leader !== c.id; i++) {
    const m = await a.expect('party_update');
    leader = m.party.leader;
  }
  ok(leader === c.id, 'leader transfer');
  a.close(); b.close(); c.close();
}
await wait(300);

/* ------------------------------------------ T4: reconnect + dup session */
log('== T4: reconnect (token) + dup session kick ==');
{
  const a = client('ReconA', { pid: mkPid('ra') });
  const b = client('ReconB', { pid: mkPid('rb') });
  await Promise.all([a.ready, b.ready]);
  a.send({ t: 'queue', mode: '1v1', ranked: false, allowBots: false });
  b.send({ t: 'queue', mode: '1v1', ranked: false, allowBots: false });
  await a.expect('room_start', 12000);
  await b.expect('room_start', 12000);
  const pidB = b.pid;
  const tokenB = b.token;
  b.close();
  await wait(400);
  const b2 = client('ReconB', { pid: pidB, token: tokenB });
  await b2.ready;
  const joined = await b2.expect('joined', 6000);
  ok(joined.roster.length === 2 && joined.playing === true, 'token bilan xonaga qayta ulandi');
  const pr = await a.expect('peer_rejoined', 6000);
  ok(!!pr.id, 'hamkasb reconnect haqida xabar oldi');
  // duplicate session: same pid, new connection kicks the old one
  const b3 = client('ReconB', { pid: pidB });
  await b3.ready;
  let kicked = false;
  try {
    const e = await b2.expect('error', 3000);
    kicked = e.key === 'dupSession';
  } catch { kicked = b2.closed; }
  ok(kicked || b2.closed, 'dup session: eski ulanish kiklandi');
  a.close(); b2.close(); b3.close();
}
await wait(300);

/* ---------------------------------------------------- T5: rate limiting */
log('== T5: rate limit ==');
{
  const s = client('Spammer', { pid: mkPid('sp') });
  await s.ready;
  for (let i = 0; i < 200; i++) s.send({ t: 'ping' });
  let limited = false;
  try {
    for (let i = 0; i < 250; i++) {
      const m = await s.expect('*', 1500);
      if (m.t === 'error' && m.key === 'rateLimit') { limited = true; break; }
    }
  } catch { limited = s.closed; }
  ok(limited || s.closed, 'spam → rateLimit xatosi yoki uzilish');
  s.close();
}
await wait(300);

/* ------------------------------------------------------- T6: load test */
log('== T6: load — 32 o‘yinchi, 16 xona ==');
{
  const base = await (await fetch(`http://127.0.0.1:${relayPort}/health`)).json();
  const N = 32;
  const cs = [];
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const c = client(`Load${i}`, { pid: mkPid(`l${i}`) });
    cs.push(c);
  }
  await Promise.all(cs.map((c) => c.ready));
  ok(Date.now() - t0 < 10000, `${N} ulanish <10s ichida hello/oldi`);
  for (const c of cs) c.send({ t: 'queue', mode: '1v1', ranked: false, allowBots: false });
  let starts = 0;
  const t1 = Date.now();
  await Promise.all(cs.map(async (c) => {
    try {
      const vs = await c.expect('vote_start', 20000);
      c.send({ t: 'vote', arena: vs.arenas[0] });
      await c.expect('room_start', 20000);
      starts++;
    } catch { /* counted below */ }
  }));
  ok(starts === N, `${N}/${starts} o‘yinchi room_start oldi (${Date.now() - t1}ms)`);
  // snap fanout: every host sends snaps for ~1s
  const t2 = Date.now();
  for (let k = 0; k < 10; k++) {
    for (const c of cs) c.send({ t: 'snap', d: { st: 1, r: 1, ps: [], pu: [] } });
    await wait(60);
  }
  ok(Date.now() - t2 < 5000, 'snap fanout 10 davr <5s');
  await Promise.all(cs.map(async (c) => {
    c.send({ t: 'leave' });
    try { await c.expect('left', 8000); } catch { /* hisoblanadi */ }
  }));
  for (const c of cs) c.close();
  await wait(800);
  const h = await (await fetch(`http://127.0.0.1:${relayPort}/health`)).json();
  ok(h.rooms === base.rooms, `load xonalari tozalandi (rooms=${h.rooms}, boshlang‘ich=${base.rooms})`);
}

/* ------------------------------------------------------------- natija */
await wait(200);
if (fails.length) {
  log(`\n❌ ${fails.length} tekshiruv yiqildi:\n- ` + fails.join('\n- '));
  process.exit(1);
}
log('\n✅ PASS — barcha onlayn tekshiruvlar o‘tdi');
process.exit(0);
