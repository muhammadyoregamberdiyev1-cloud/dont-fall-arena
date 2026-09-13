"""
Don't Fall Arena — online relay server (V2), zero third-party dependencies.

Speaks plain HTTP (/health /rooms /stats) and WebSocket (game relay) on one
port. Server-authoritative for: sessions/tokens, matchmaking, parties, teams,
map vote, ranked rules, rate limits and reward calculation. Gameplay physics
run on the room host and are streamed through this relay.

    python3 server/main.py [--host 0.0.0.0] [--port 8081] [--db path] [--quiet]
"""

import argparse
import asyncio
import base64
import hashlib
import json
import logging
import os
import random
import signal
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import protocol as P  # noqa: E402
from rooms import RoomManager, sweeper_loop  # noqa: E402
from store import Store  # noqa: E402

log = logging.getLogger("arena-server")
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


# ============================================================================
# minimal RFC6455 websocket framing
# ============================================================================


async def read_http_request(reader):
    """Return (method, path, headers) or None on EOF."""
    try:
        line = await reader.readline()
    except (asyncio.IncompleteReadError, ConnectionError):
        return None
    if not line:
        return None
    try:
        method, path, _ = line.decode("latin1").split(" ", 2)
    except ValueError:
        return None
    headers = {}
    while True:
        h = await reader.readline()
        if h in (b"\r\n", b"\n", b""):
            break
        k, _, v = h.decode("latin1").partition(":")
        headers[k.strip().lower()] = v.strip()
    return method, path, headers


async def read_frame(reader):
    head = await reader.readexactly(2)
    opcode = head[0] & 0x0F
    masked = head[1] & 0x80
    length = head[1] & 0x7F
    if length == 126:
        length = int.from_bytes(await reader.readexactly(2), "big")
    elif length == 127:
        length = int.from_bytes(await reader.readexactly(8), "big")
    if length > P.MAX_MESSAGE_BYTES * 2:
        raise ValueError("frame too big")
    mask = await reader.readexactly(4) if masked else None
    payload = await reader.readexactly(length) if length else b""
    if mask:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return opcode, payload


def encode_frame(opcode, payload: bytes) -> bytes:
    out = bytearray([0x80 | opcode])
    n = len(payload)
    if n < 126:
        out.append(n)
    elif n < 65536:
        out.append(126)
        out += n.to_bytes(2, "big")
    else:
        out.append(127)
        out += n.to_bytes(8, "big")
    out += payload
    return bytes(out)


class Connection:
    """One websocket client."""

    def __init__(self, reader, writer, server: "Server"):
        self.reader = reader
        self.writer = writer
        self.server = server
        self.player = None
        self._write_lock = asyncio.Lock()
        self._buf = bytearray()
        self._buf_op = 1

    async def send(self, obj: dict):
        data = P.encode(obj).encode("utf-8")
        async with self._write_lock:
            self.writer.write(encode_frame(0x1, data))
            await self.writer.drain()

    async def run(self):
        try:
            if not await self._handshake_or_http():
                return
            await self._loop()
        except (asyncio.IncompleteReadError, ConnectionError, ValueError):
            pass
        except Exception:  # pragma: no cover
            log.exception("session crashed")
        finally:
            await self.server.disconnect(self)

    async def _handshake_or_http(self):
        req = await read_http_request(self.reader)
        if not req:
            return False
        method, path, headers = req
        key = headers.get("sec-websocket-key")
        if headers.get("upgrade", "").lower() != "websocket" or not key:
            await self.server.serve_http(self.writer, method, path)
            return False
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        self.writer.write(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
            ).encode()
        )
        await self.writer.drain()
        return True

    async def _loop(self):
        msg = await asyncio.wait_for(self._next_message(), timeout=15)
        if msg is None or msg.get("t") != P.HELLO:
            await self.send({"t": P.ERROR, "msg": "hello kutildi", "key": "badHello"})
            return
        info, err = P.validate_hello(msg)
        if err:
            await self.send({"t": P.ERROR, "msg": err, "key": err})
            return
        manager = self.server.manager

        # reconnect by token (reserved seat) or duplicate-session protection
        existing = None
        if info["token"]:
            existing = manager.reconnect(info["token"], self.send)
        if existing is None and info["pid"]:
            dup = manager.by_pid.get(info["pid"])
            if dup and dup.disconnected_at is None and dup.conn is not None:
                # same account reconnecting: kick the stale session
                await dup.send({"t": P.ERROR, "msg": "boshqa qurilma ulandi", "key": "dupSession"})
                try:
                    dup.conn.close()
                except Exception:
                    pass
        if existing:
            self.player = existing
            self.player.conn = self
            room = existing.room
            await self.send(
                {
                    "t": P.WELCOME,
                    "id": existing.id,
                    "name": existing.name,
                    "token": existing.token,
                    "version": P.PROTOCOL_VERSION,
                    "rooms": manager.public_rooms(),
                    "stats": self.server.store.leaderboard(5),
                    "reconnect": True,
                }
            )
            if room:
                await self.send(
                    {
                        "t": P.JOINED,
                        "room": room.code,
                        "slot": existing.slot,
                        "team": existing.team,
                        "roster": room.roster(),
                        "host": room.host_id,
                        "phase": room.phase,
                        "mode": room.mode,
                        "ranked": room.ranked,
                        "arena": room.arena_id,
                        "cfg": room.cfg,
                        "playing": room.playing,
                    }
                )
                await room.broadcast(
                    {"t": P.PEER_REJOINED, "id": existing.id, "name": existing.name, "slot": existing.slot, "roster": room.roster()},
                    exclude={existing.id},
                )
        else:
            pid = P.make_player_id()
            token = P.new_token()
            self.player = manager.register(pid, info["name"], self.send, token, info["pid"])
            self.player.conn = self
            await self.send(
                {
                    "t": P.WELCOME,
                    "id": pid,
                    "name": self.player.name,
                    "token": token,
                    "version": P.PROTOCOL_VERSION,
                    "rooms": manager.public_rooms(),
                    "stats": self.server.store.leaderboard(5),
                }
            )

        while True:
            msg = await self._next_message()
            if msg is None:
                return
            await self.server.dispatch(self, msg)

    async def _next_message(self):
        while True:
            opcode, payload = await read_frame(self.reader)
            if opcode is None or opcode == 0x8:
                return None
            if opcode == 0x9:
                async with self._write_lock:
                    self.writer.write(encode_frame(0xA, payload))
                    await self.writer.drain()
                continue
            if opcode == 0xA:
                continue
            if opcode in (0x1, 0x2):
                self._buf = bytearray(payload)
                self._buf_op = opcode
            elif opcode == 0x0:
                self._buf += payload
            else:
                continue
            if self._buf_op in (0x1, 0x2):
                text = bytes(self._buf).decode("utf-8", "replace")
                self._buf = bytearray()
                obj, err = P.decode(text)
                if err:
                    await self.send({"t": P.ERROR, "msg": err, "key": err})
                    continue
                if self.player:
                    self.player.touch()
                return obj

    def close(self):
        try:
            self.writer.close()
        except Exception:
            pass


# ============================================================================
# server
# ============================================================================


class Server:
    def __init__(self, host, port, db_path=None):
        self.host = host
        self.port = port
        self.store = Store(db_path)
        self.manager = RoomManager(rng=random.Random())
        self._server = None
        self._sweeper = None

    async def start(self):
        self._server = await asyncio.start_server(self._on_connect, self.host, self.port)
        self.bound_port = self._server.sockets[0].getsockname()[1] if self._server.sockets else self.port
        self._sweeper = asyncio.create_task(sweeper_loop(self.manager))
        return self

    async def stop(self):
        if self._sweeper:
            self._sweeper.cancel()
        if self._server:
            self._server.close()
            await self._server.wait_closed()
        self.store.close()

    async def _on_connect(self, reader, writer):
        conn = Connection(reader, writer, self)
        asyncio.create_task(conn.run())

    # -- http -----------------------------------------------------------------
    async def serve_http(self, writer, method, path):
        path = path.split("?", 1)[0]
        if path == "/health":
            body = {"ok": True, "version": P.PROTOCOL_VERSION, "rooms": len(self.manager.rooms)}
        elif path == "/rooms":
            body = {"rooms": self.manager.public_rooms()}
        elif path == "/stats":
            body = {"leaderboard": self.store.leaderboard(10), "totals": self.store.totals()}
        elif path == "/":
            body = {
                "name": "dont-fall-arena online relay v2",
                "ws": "connect with a websocket to /ws",
                "http": ["/health", "/rooms", "/stats"],
            }
        else:
            writer.write(
                b"HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: 3\r\n"
                b"Access-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n404"
            )
            await writer.drain()
            writer.close()
            return
        data = json.dumps(body).encode()
        writer.write(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n"
            b"Access-Control-Allow-Origin: *\r\nCache-Control: no-store\r\n"
            b"Content-Length: " + str(len(data)).encode() + b"\r\nConnection: close\r\n\r\n" + data
        )
        await writer.drain()
        writer.close()

    # -- game dispatch ----------------------------------------------------------
    async def dispatch(self, conn: Connection, msg: dict):
        m = self.manager
        p = conn.player
        if not p:
            return
        if not p.limiter.allow():
            await conn.send({"t": P.ERROR, "msg": "juda tez", "key": "rateLimit"})
            return
        t = msg.get("t")

        if t == P.PING:
            await conn.send({"t": P.PONG, "ts": P.now()})
            return

        if t == P.QUEUE:
            info, err = P.validate_queue(msg)
            if err:
                await conn.send({"t": P.ERROR, "msg": err, "key": err})
                return
            err = m.queue(p, info["mode"], info["ranked"], info["allowBots"])
            if err:
                await conn.send({"t": P.ERROR, "msg": err, "key": err})
                return
            m.tick_queues()
            await conn.send({"t": "queued", "mode": info["mode"], "ranked": info["ranked"]})
            return

        if t == P.UNQUEUE:
            m.unqueue(p)
            await conn.send({"t": "unqueued"})
            return

        if t == P.CREATE:
            mode = str(msg.get("mode") or "solo")
            if mode not in P.VALID_MODES:
                await conn.send({"t": P.ERROR, "msg": "bad_mode", "key": "badMode"})
                return
            ranked = bool(msg.get("ranked"))
            if p.room:
                m.leave(p)
            room = m.create_room([p], mode, ranked, bool(msg.get("allowBots", True)))
            await conn.send({"t": P.CREATED, "room": room.code, "roster": room.roster(), "host": p.id, "mode": mode, "ranked": ranked})
            return

        if t == P.JOIN:
            room, err = m.join_room(p, str(msg.get("room") or ""))
            if err:
                await conn.send({"t": P.ERROR, "msg": err, "key": err})
                return
            await conn.send(
                {
                    "t": P.JOINED,
                    "room": room.code,
                    "slot": p.slot,
                    "team": p.team,
                    "roster": room.roster(),
                    "host": room.host_id,
                    "phase": room.phase,
                    "mode": room.mode,
                    "ranked": room.ranked,
                    "playing": room.playing,
                }
            )
            await room.broadcast({"t": P.PEER_JOINED, "peer": p.public(), "roster": room.roster()}, exclude={p.id})
            return

        if t == P.LEAVE:
            m.unqueue(p)
            room = m.leave(p)
            if room:
                await room.broadcast({"t": P.PEER_LEFT, "id": p.id, "name": p.name, "roster": room.roster(), "host": room.host_id})
            await conn.send({"t": P.LEFT})
            return

        if t == P.ROOMS:
            await conn.send({"t": P.ROOMS, "rooms": m.public_rooms()})
            return

        # ---- parties ---------------------------------------------------------
        if t == P.PARTY_CREATE:
            party, err = m.party_create(p)
            if err:
                await conn.send({"t": P.ERROR, "msg": err, "key": err})
                return
            await conn.send({"t": P.PARTY_UPDATE, "party": party.public(m.players)})
            return
        if t == P.PARTY_JOIN:
            party, err = m.party_join(p, str(msg.get("code") or ""))
            if err:
                await conn.send({"t": P.ERROR, "msg": err, "key": err})
                return
            await self._party_sync(party)
            return
        if t == P.PARTY_LEAVE:
            party = m.party_leave(p)
            if party:
                await self._party_sync(party)
            await conn.send({"t": P.PARTY_UPDATE, "party": None})
            return
        if t == P.PARTY_KICK:
            err = m.party_kick(p, str(msg.get("id") or ""))
            if err:
                await conn.send({"t": P.ERROR, "msg": err, "key": err})
            elif p.party:
                await self._party_sync(p.party)
            return
        if t == P.PARTY_TRANSFER:
            err = m.party_transfer(p, str(msg.get("id") or ""))
            if err:
                await conn.send({"t": P.ERROR, "msg": err, "key": err})
            elif p.party:
                await self._party_sync(p.party)
            return

        room = m.room_of(p)
        if not room:
            await conn.send({"t": P.ERROR, "msg": "avval xonaga kiring", "key": "noRoom"})
            return

        if t == "chat":
            text = str(msg.get("text") or "")[:140]
            await room.broadcast({"t": P.ROOM_CHAT, "name": p.name, "text": text})
            return

        if t == P.VOTE:
            if room.phase != "vote":
                await conn.send({"t": P.ERROR, "msg": "vote_closed", "key": "voteClosed"})
                return
            info, err = P.validate_vote(msg)
            if err:
                await conn.send({"t": P.ERROR, "msg": err, "key": err})
                return
            p.vote = info["arena"]  # duplicate votes replace, never add
            room.votes[p.id] = info["arena"]
            # host may submit exactly one vote per reserved bot seat
            if info["bots"] and p.id == room.host_id and not room.ranked:
                seats = {str(b["slot"]) for b in room.bots}
                for k, v in list(info["bots"].items())[: len(seats)]:
                    if str(k) in seats and v in P.ARENA_IDS:
                        room.bot_votes[str(k)] = v
            await room.broadcast({"t": P.VOTE_UPDATE, "counts": room.vote_counts(), "voted": sum(1 for q in room.humans() if q.vote)})
            return

        if t == P.START:
            # host asks to begin: server runs the vote phase first
            if p.id != room.host_id:
                await conn.send({"t": P.ERROR, "msg": "faqat host boshlaydi", "key": "notHost"})
                return
            if room.phase != "lobby":
                return
            await room.broadcast(
                {
                    "t": P.VOTE_START,
                    "arenas": P.ARENA_IDS,
                    "secs": P.VOTE_SECONDS,
                    "mode": room.mode,
                    "ranked": room.ranked,
                    "roster": room.roster(),
                    "bots": room.bots,
                }
            )
            room.start_vote()
            return

        if t == P.RESULT:
            if p.id != room.host_id or not isinstance(msg.get("results"), list):
                await conn.send({"t": P.ERROR, "msg": "natijani faqat host yuboradi", "key": "notHost"})
                return
            enriched = []
            roster = {r["slot"]: r for r in room.roster()}
            for r in msg["results"][: P.MAX_PLAYERS_PER_ROOM]:
                seat = roster.get(r.get("slot"))
                enriched.append(
                    {
                        **r,
                        "pid": "",
                        "name": (seat or {}).get("name") or r.get("name") or "?",
                        "team": (seat or {}).get("team"),
                    }
                )
            # pids: server-side session ids of humans in this room
            pid_by_slot = {q.slot: q.pid for q in room.players.values()}
            for r in enriched:
                if not r.get("pid"):
                    r["pid"] = pid_by_slot.get(r.get("slot"), "")
            rewards = self.store.record_result(
                room.code,
                enriched,
                mode=room.mode,
                ranked=room.ranked,
                arena=room.arena_id or "",
            )
            for rw in rewards:
                target = next((q for q in room.players.values() if (q.pid or q.id) == rw["pid"] or q.name == rw["name"]), None)
                if target:
                    await target.send({"t": P.REWARDS, "rewards": rw})
            room.phase = "end"
            room.playing = False
            return

        # ---- relay (host streams world state, guests stream inputs) ---------
        if t in P.RELAY_TYPES:
            payload = msg.get("d")
            if payload is None:
                return
            blob = P.encode(payload)
            if len(blob) > P.MAX_MESSAGE_BYTES:
                return
            to = msg.get("to")
            if t == P.RELAY_IN:
                if p.id == room.host_id:
                    return
                await room.send_to(room.host_id, {"t": P.RELAY_IN, "from": p.id, "slot": p.slot, "d": payload})
            elif t == P.RELAY_EMOTE:
                await room.broadcast({"t": P.RELAY_EMOTE, "from": p.id, "slot": p.slot, "d": payload}, exclude={p.id})
            else:
                if p.id != room.host_id:
                    return
                if to:
                    await room.send_to(to, {"t": t, "from": p.id, "d": payload})
                else:
                    await room.broadcast({"t": t, "from": p.id, "d": payload}, exclude={p.id})
            return

    async def _party_sync(self, party):
        m = self.manager
        data = {"t": P.PARTY_UPDATE, "party": party.public(m.players)}
        for mid in party.members:
            q = m.players.get(mid)
            if q and q.send:
                try:
                    await q.send(data)
                except Exception:
                    log.exception("party send")

    async def disconnect(self, conn: Connection):
        p = conn.player
        if not p:
            return
        if p.conn is conn:
            p.conn = None
            p.send = None
        room = p.room
        if room:
            p.disconnected_at = P.now()
            await room.broadcast(
                {"t": P.PEER_LEFT, "id": p.id, "name": p.name, "roster": room.roster(), "host": room.host_id, "gone": False}
            )
        else:
            self.manager.drop(p.id)
        try:
            conn.writer.close()
        except Exception:
            pass


async def amain():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=int(os.environ.get("ARENA_PORT", 8081)))
    ap.add_argument("--db", default=None)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.WARNING if args.quiet else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    srv = Server(args.host, args.port, args.db)
    await srv.start()
    print(f"Don't Fall Arena online relay v2 → ws://{args.host}:{srv.bound_port}/ws", flush=True)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # pragma: no cover (windows)
            pass
    await stop.wait()
    await srv.stop()


if __name__ == "__main__":
    asyncio.run(amain())
