"""End-to-end tests for the V2 relay server (no third-party deps).

Covers: T0 health, T1 solo+bot, T2 real multiplayer, T3-T6 team modes,
T7 map voting (abuse rules), T8 arena sync, T9 party, T10 ranked rules,
T11 reconnect, T12 duplicate sessions, T13 stats, T14 reward integrity,
T15 rate limits + a small load section.

    python3 tests/test_server.py
"""

import asyncio
import base64
import json
import os
import struct
import sys
import unittest
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))

import protocol as P  # noqa: E402

# fast tests (patch before importing the server so defaults bind to test values)
P.QUEUE_CASUAL_GRACE = 1.5
P.QUEUE_RANKED_TIMEOUT = 3.0
P.VOTE_SECONDS = 0.8
P.RECONNECT_GRACE = 3.0

from main import Server  # noqa: E402


class WS:
    """Minimal masked websocket client (client→server frames must be masked)."""

    def __init__(self, reader, writer):
        self.r, self.w = reader, writer
        self.buf = b""
        self.closed = False

    @classmethod
    async def connect(cls, port):
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        key = base64.b64encode(uuid.uuid4().bytes).decode()
        writer.write(
            (
                f"GET /ws HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\n"
                f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        await writer.drain()
        line = await reader.readline()
        assert b"101" in line, line
        while True:
            h = await reader.readline()
            if h in (b"\r\n", b"\n", b""):
                break
        return cls(reader, writer)

    async def send(self, obj):
        data = json.dumps(obj).encode()
        mask = os.urandom(4)
        header = bytearray([0x81])
        n = len(data)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        header += mask
        self.w.write(bytes(header) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
        await self.w.drain()

    async def recv(self, timeout=4):
        while True:
            msg = await self._next(timeout)
            if msg is not None:
                return msg

    async def _next(self, timeout):
        head = await asyncio.wait_for(self.r.readexactly(2), timeout)
        opcode = head[0] & 0x0F
        length = head[1] & 0x7F
        if length == 126:
            length = struct.unpack(">H", await self.r.readexactly(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", await self.r.readexactly(8))[0]
        payload = await self.r.readexactly(length) if length else b""
        if opcode == 0x8:
            self.closed = True
            return None
        if opcode != 0x1:
            return None
        return json.loads(payload.decode())

    async def expect(self, t, timeout=4):
        while True:
            m = await self.recv(timeout)
            if m is None:
                raise AssertionError(f"connection closed while waiting for {t}")
            if m.get("t") == t:
                return m

    async def drain(self, secs=0.35):
        out = []
        try:
            while True:
                m = await self.recv(secs)
                if m is None:
                    break
                out.append(m)
        except (asyncio.TimeoutError, AssertionError, ConnectionError, asyncio.IncompleteReadError, OSError):
            pass
        return out

    def close(self):
        try:
            self.w.close()
        except Exception:
            pass


class RelayTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.loop = asyncio.new_event_loop()
        cls.server = cls.loop.run_until_complete(cls._start())
        cls.port = cls.server.bound_port

    @classmethod
    async def _start(cls):
        srv = Server("127.0.0.1", 0, db_path=os.path.join(os.path.dirname(__file__), "tmp_arena.db"))
        return await srv.start()

    @classmethod
    def tearDownClass(cls):
        cls.loop.run_until_complete(cls.server.stop())
        cls.loop.close()
        try:
            os.remove(os.path.join(os.path.dirname(__file__), "tmp_arena.db"))
        except OSError:
            pass

    def run_async(self, coro):
        return self.loop.run_until_complete(coro)

    async def client(self, name, pid=None, token=""):
        ws = await WS.connect(self.port)
        await ws.send({"t": "hello", "name": name, "pid": pid or uuid.uuid4().hex, "token": token})
        w = await ws.expect("welcome")
        return ws, w

    # ------------------------------------------------------------------ T0
    def test_t0_health(self):
        async def go():
            r, w = await asyncio.open_connection("127.0.0.1", self.port)
            w.write(b"GET /health HTTP/1.1\r\nHost: x\r\n\r\n")
            await w.drain()
            data = await asyncio.wait_for(r.read(4096), 4)
            w.close()
            return data.decode()
        out = self.run_async(go())
        self.assertIn("200 OK", out)
        self.assertIn('"ok": true', out)

    # ------------------------------------------------- T1/T2 + voting (T7)
    def test_t1_t2_t7_t8_vote_and_modes(self):
        async def go():
            a, wa = await self.client("Ali")
            b, wb = await self.client("Vali")
            await a.send({"t": "queue", "mode": "2v2", "ranked": False, "allowBots": True})
            await a.expect("queued")
            await b.send({"t": "queue", "mode": "2v2", "ranked": False, "allowBots": True})
            mf_a = await a.expect("match_found")
            mf_b = await b.expect("match_found")
            self.assertEqual(mf_a["room"], mf_b["room"])
            self.assertEqual(len(mf_a["roster"]), 4)  # 2 humans + 2 bots
            vs_a = await a.expect("vote_start")
            await b.expect("vote_start")
            self.assertEqual(vs_a["arenas"], ["color_grid", "chaos_core"])
            self.assertEqual(len(vs_a["bots"]), 2)

            # one vote each; duplicate replaces, never adds
            bot_slots = [str(b["slot"]) for b in vs_a["bots"]]
            bots_vote = {k: "color_grid" for k in bot_slots}
            await a.send({"t": "vote", "arena": "color_grid", "bots": bots_vote})
            await a.send({"t": "vote", "arena": "color_grid", "bots": bots_vote})
            upd = await a.expect("vote_update")
            self.assertEqual(upd["counts"].get("color_grid"), 3)  # 1 human + 2 bots
            # invalid arena rejected
            await b.send({"t": "vote", "arena": "nope"})
            err = await b.expect("error")
            self.assertEqual(err["key"], "bad_arena")
            # vote after deadline rejected
            await asyncio.sleep(P.VOTE_SECONDS + 0.4)
            got_a = []
            rs_a = None
            for _ in range(40):
                for m in await a.drain(0.2):
                    got_a.append(m)
                    if m["t"] == "room_start":
                        rs_a = m
                if rs_a:
                    break
            self.assertTrue(rs_a, f"room_start never arrived; saw {[m['t'] for m in got_a]}")
            rs_b = await b.expect("room_start", timeout=6)
            self.assertIn(rs_a["cfg"]["arenaId"], P.ARENA_IDS)
            self.assertEqual(rs_a["cfg"]["arenaId"], rs_b["cfg"]["arenaId"])
            self.assertEqual(rs_a["cfg"]["mode"], "2v2")
            # late vote now rejected
            await a.send({"t": "vote", "arena": "chaos_core"})
            e2 = await a.expect("error")
            self.assertEqual(e2["key"], "voteClosed")
            teams = {r["team"] for r in rs_a["roster"]}
            self.assertEqual(teams, {0, 1})
            a.close()
            b.close()
        self.run_async(go())

    def test_t7_tie_and_bot_votes(self):
        async def go():
            a, _ = await self.client("TieA")
            b, _ = await self.client("TieB")
            for ws in (a, b):
                await ws.send({"t": "queue", "mode": "1v1", "ranked": False, "allowBots": False})
            await a.expect("vote_start")
            await b.expect("vote_start")
            await a.send({"t": "vote", "arena": "color_grid"})
            await b.send({"t": "vote", "arena": "chaos_core"})
            ra = await a.expect("vote_result", timeout=6)
            rb = await b.expect("vote_result", timeout=6)
            self.assertEqual(ra["arena"], rb["arena"])
            self.assertTrue(ra["tie"])
            await a.expect("room_start")
            a.close()
            b.close()
        self.run_async(go())

    # ------------------------------------------------------- T3..T6 sizes
    def test_t3_t6_team_sizes(self):
        async def go():
            for mode, size in (("1v1", 2), ("3v3", 6), ("4v4", 8)):
                clients = []
                for i in range(2):
                    ws, _ = await self.client(f"{mode}-{i}")
                    clients.append(ws)
                    await ws.send({"t": "queue", "mode": mode, "ranked": False, "allowBots": True})
                vs = await clients[0].expect("vote_start", timeout=6)
                self.assertEqual(len(vs["roster"]), size, mode)
                humans = [r for r in vs["roster"] if not r["bot"]]
                bots = [r for r in vs["roster"] if r["bot"]]
                self.assertEqual(len(humans), 2)
                self.assertEqual(len(bots), size - 2)
                for ws in clients:
                    ws.close()
                await asyncio.sleep(0.05)
        self.run_async(go())

    # ------------------------------------------------------------ T9 party
    def test_t9_party(self):
        async def go():
            a, wa = await self.client("Leader")
            b, wb = await self.client("Friend")
            c, wc = await self.client("Third")
            await a.send({"t": "party_create"})
            up = await a.expect("party_update")
            code = up["party"]["code"]
            self.assertEqual(up["party"]["leader"], wa["id"])
            await b.send({"t": "party_join", "code": code})
            await a.expect("party_update")
            up2 = await b.expect("party_update")
            self.assertEqual(len(up2["party"]["members"]), 2)
            await c.send({"t": "party_join", "code": code})
            up3 = await a.expect("party_update")
            self.assertEqual(len(up3["party"]["members"]), 3)
            # kick
            await a.send({"t": "party_kick", "id": wc["id"]})
            up4 = await a.expect("party_update")
            self.assertEqual(len(up4["party"]["members"]), 2)
            # transfer
            await b.drain(0.3)
            await a.send({"t": "party_transfer", "id": wb["id"]})
            up5 = await b.expect("party_update", timeout=4)
            while up5["party"]["leader"] != wb["id"]:
                up5 = await b.expect("party_update", timeout=4)
            self.assertEqual(up5["party"]["leader"], wb["id"])
            # party queues together, same team in 2v2
            await b.send({"t": "queue", "mode": "2v2", "ranked": False, "allowBots": True})
            vs = await b.expect("vote_start", timeout=6)
            vs2 = await a.expect("vote_start", timeout=6)
            teams = {r["id"]: r["team"] for r in vs["roster"]}
            self.assertEqual(teams[wa["id"]], teams[wb["id"]])
            # party too big for 1v1
            await c.send({"t": "party_join", "code": code})
            await c.expect("party_update")
            d, wd = await self.client("Fourth")
            await a.send({"t": "party_kick", "id": wc["id"]})
            await a.drain(0.2)
            await d.send({"t": "party_join", "code": code})
            await d.expect("party_update")
            await b.send({"t": "leave"})
            await b.drain(0.3)
            await b.send({"t": "queue", "mode": "1v1", "ranked": False, "allowBots": False})
            err = await b.expect("error")
            self.assertEqual(err["key"], "party_too_big")
            for ws in (a, b, c, d):
                ws.close()
        self.run_async(go())

    # ------------------------------------------------- T10 ranked no bots
    def test_t10_ranked(self):
        async def go():
            a, _ = await self.client("Rank1")
            await a.send({"t": "queue", "mode": "1v1", "ranked": True, "allowBots": True})
            await a.expect("queued")
            await asyncio.sleep(1.0)
            msgs = await a.drain(0.2)
            self.assertNotIn("vote_start", [m["t"] for m in msgs])
            b, _ = await self.client("Rank2")
            await b.send({"t": "queue", "mode": "1v1", "ranked": True, "allowBots": True})
            vs = await a.expect("vote_start", timeout=6)
            self.assertTrue(vs["ranked"])
            self.assertEqual(len(vs["roster"]), 2)
            self.assertEqual([r for r in vs["roster"] if r["bot"]], [])
            a.close()
            b.close()
        self.run_async(go())

    def test_t10_ranked_timeout(self):
        async def go():
            a, _ = await self.client("Lonely")
            await a.send({"t": "queue", "mode": "4v4", "ranked": True, "allowBots": False})
            fail = await a.expect("queue_fail", timeout=6)
            self.assertEqual(fail["reason"], "mm_timeout")
            a.close()
        self.run_async(go())

    # --------------------------------------- T11 reconnect + T12 duplicate
    def test_t11_t12_reconnect_and_dup(self):
        async def go():
            pid = uuid.uuid4().hex
            a, wa = await self.client("Recon", pid=pid)
            token = wa["token"]
            b, wb = await self.client("Host2")
            await b.send({"t": "create", "mode": "solo", "ranked": False, "allowBots": True})
            cr = await b.expect("created")
            await a.send({"t": "join", "room": cr["room"]})
            jd = await a.expect("joined")
            slot = jd["slot"]
            # duplicate session: same pid, new connection kicks the old one
            a2, wa2 = await self.client("Recon", pid=pid)
            dead = False
            try:
                m = await a.recv(1.5)
                dead = m is None or m.get("key") == "dupSession"
            except (asyncio.IncompleteReadError, ConnectionError, OSError):
                dead = True
            self.assertTrue(dead, "stale duplicate session must be kicked")
            # disconnect a2, then reconnect with the token
            a2.close()
            await asyncio.sleep(0.3)
            a3 = await WS.connect(self.port)
            await a3.send({"t": "hello", "name": "Recon", "pid": pid, "token": token})
            w3 = await a3.expect("welcome")
            self.assertTrue(w3.get("reconnect"))
            jd3 = await a3.expect("joined")
            self.assertEqual(jd3["slot"], slot)
            self.assertEqual(jd3["room"], cr["room"])
            for ws in (a, a2, a3, b):
                ws.close()
        self.run_async(go())

    # ------------------------------------- T13/T14 stats + reward integrity
    def test_t13_t14_rewards(self):
        async def go():
            a, wa = await self.client("StatA")
            b, wb = await self.client("StatB")
            for ws in (a, b):
                await ws.send({"t": "queue", "mode": "1v1", "ranked": True, "allowBots": False})
            await a.expect("vote_start")
            await b.expect("vote_start")
            await a.send({"t": "vote", "arena": "color_grid"})
            await b.send({"t": "vote", "arena": "color_grid"})
            rs = await a.expect("room_start", timeout=6)
            await b.expect("room_start", timeout=6)
            host_ws = a if rs["host"] == wa["id"] else b
            host_id = rs["host"]
            slots = [r["slot"] for r in rs["roster"]]
            results = [
                {"slot": slots[0], "wins": 3, "roundWins": 3, "points": 120, "eliminations": 4, "place": 1},
                {"slot": slots[1], "wins": 1, "roundWins": 1, "points": 60, "eliminations": 1, "place": 2},
            ]
            await host_ws.send({"t": "result", "results": results})
            rw_a = await a.expect("rewards", timeout=6)
            rw_b = await b.expect("rewards", timeout=6)
            wins = [rw_a["rewards"], rw_b["rewards"]]
            winner = next(w for w in wins if w["won"])
            loser = next(w for w in wins if not w["won"])
            self.assertEqual(winner["rp"], P.RP_WIN + P.RP_MVP)  # mvp = most points among winners
            self.assertEqual(loser["rp"], P.RP_LOSS)
            self.assertGreater(winner["xp"], loser["xp"])
            self.assertGreater(winner["coins"], 0)
            # guest cannot submit results
            guest_ws = b if host_ws is a else a
            await guest_ws.send({"t": "result", "results": results})
            err = await guest_ws.expect("error")
            self.assertEqual(err["key"], "notHost")
            a.close()
            b.close()
        self.run_async(go())

    # ------------------------------------------------------- T15 rate limit
    def test_t15_rate_limit(self):
        async def go():
            a, _ = await self.client("Spam")
            for _ in range(160):
                await a.send({"t": "ping"})
            msgs = await a.drain(1.2)
            kinds = [m["t"] for m in msgs]
            self.assertIn("error", kinds)
            self.assertIn("rateLimit", [m.get("key") for m in msgs])
            a.close()
        self.run_async(go())

    # ------------------------------------------------------------- relay
    def test_relay_routing(self):
        async def go():
            a, wa = await self.client("H")
            b, wb = await self.client("G")
            await a.send({"t": "create", "mode": "solo", "ranked": False, "allowBots": False})
            cr = await a.expect("created")
            await b.send({"t": "join", "room": cr["room"]})
            await b.expect("joined")
            await a.expect("peer_joined")
            await a.send({"t": "start"})
            await a.expect("vote_start")
            await b.expect("vote_start")
            await a.send({"t": "vote", "arena": "chaos_core"})
            await b.send({"t": "vote", "arena": "chaos_core"})
            await a.expect("room_start", timeout=6)
            await b.expect("room_start", timeout=6)
            await b.send({"t": "in", "d": {"mx": 0.5, "my": 0, "dash": False}})
            inp = await a.expect("in")
            self.assertEqual(inp["d"]["mx"], 0.5)
            await a.send({"t": "snap", "d": {"st": 1, "r": 1, "ps": []}})
            snap = await b.expect("snap")
            self.assertEqual(snap["d"]["st"], 1)
            self.assertEqual(await a.drain(0.2), [])  # no echo to host
            await a.send({"t": "emote", "d": "🔥"})
            em = await b.expect("emote")
            self.assertEqual(em["d"], "🔥")
            # directed relay (reconnect resync)
            await a.send({"t": "rstart", "d": {"round": 2}, "to": wb["id"]})
            rr = await b.expect("rstart")
            self.assertEqual(rr["d"]["round"], 2)
            a.close()
            b.close()
        self.run_async(go())

    # -------------------------------------------------------------- load
    def test_load_rooms_and_votes(self):
        async def go():
            clients = []
            for i in range(24):
                ws, _ = await self.client(f"Load{i}")
                clients.append(ws)
            # 12 rooms of 1v1 casual via queues
            for ws in clients:
                await ws.send({"t": "queue", "mode": "1v1", "ranked": False, "allowBots": False})
            starts = 0
            for ws in clients:
                try:
                    await ws.expect("vote_start", timeout=6)
                    starts += 1
                except Exception:
                    pass
            self.assertEqual(starts, 24)
            for ws in clients:
                await ws.send({"t": "vote", "arena": "color_grid"})
            for ws in clients:
                try:
                    await ws.expect("room_start", timeout=8)
                except Exception:
                    pass
            # snapshot traffic flows in every room
            hosts = clients[::2]
            guests = clients[1::2]
            for h in hosts:
                await h.send({"t": "snap", "d": {"st": 1, "r": 1, "ps": [[0, 0, 0, 1, 0, 0, 0, 0, 0]]}})
            got = 0
            for g in guests:
                try:
                    await g.expect("snap", timeout=3)
                    got += 1
                except Exception:
                    pass
            self.assertEqual(got, len(guests))
            # teardown
            for ws in clients:
                await ws.send({"t": "leave"})
            await asyncio.sleep(0.2)
            for ws in clients:
                ws.close()
            r, w = await asyncio.open_connection("127.0.0.1", self.port)
            w.write(b"GET /health HTTP/1.1\r\nHost: x\r\n\r\n")
            await w.drain()
            data = (await asyncio.wait_for(r.read(4096), 4)).decode()
            w.close()
            self.assertIn('"rooms": 0', data)
        self.run_async(go())


if __name__ == "__main__":
    unittest.main(verbosity=2)
