"""
Don't Fall Arena — online relay server (asyncio, ZERO third-party deps).

Speaks both plain HTTP (health / rooms / stats) and WebSocket (game relay) on
one port. The browser host runs the simulation and streams snapshots; guests
stream inputs; this server only routes, tracks rooms and stores stats.

    python3 server/main.py                 # 0.0.0.0:8081
    python3 server/main.py --port 9000
"""

import argparse
import asyncio
import base64
import hashlib
import json
import logging
import signal
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import protocol as P
from rooms import RoomManager, sweeper_loop
from store import Store

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
    """Return (opcode, payload_bytes) or (None, b'') on EOF."""
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
            if not await self._handshake_or_hello():
                return
            await self._loop()
        except (asyncio.IncompleteReadError, ConnectionError, ValueError):
            pass
        except Exception:  # pragma: no cover
            log.exception("session crashed")
        finally:
            await self.server.disconnect(self)

    async def _handshake_or_hello(self):
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
        # hello must arrive quickly
        msg = await asyncio.wait_for(self._next_message(), timeout=15)
        if msg is None or msg.get("t") != P.HELLO:
            await self.send({"t": P.ERROR, "msg": "hello kutildi"})
            return
        pid = P.make_player_id()
        self.player = self.server.manager.register(pid, msg.get("name") or "O'yinchi", self.send)
        await self.send(
            {
                "t": P.WELCOME,
                "id": pid,
                "name": self.player.name,
                "version": P.PROTOCOL_VERSION,
                "rooms": self.server.manager.public_rooms(),
                "stats": self.server.store.leaderboard(5),
            }
        )
        while True:
            msg = await self._next_message()
            if msg is None:
                return
            await self.server.dispatch(self, msg)

    async def _next_message(self):
        """Assemble text messages (handles continuation + control frames)."""
        while True:
            opcode, payload = await read_frame(self.reader)
            if opcode is None or opcode == 0x8:
                return None
            if opcode == 0x9:  # ping -> pong
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
            fin = True  # we only get FIN frames from browsers in practice
            if fin and self._buf_op in (0x1, 0x2):
                text = bytes(self._buf).decode("utf-8", "replace")
                self._buf = bytearray()
                obj, err = P.decode(text)
                if err:
                    await self.send({"t": P.ERROR, "msg": err})
                    continue
                if self.player:
                    self.player.touch()
                return obj


# ============================================================================
# server
# ============================================================================


class Server:
    def __init__(self, host, port, db_path=None):
        self.host = host
        self.port = port
        self.manager = RoomManager()
        self.store = Store(db_path)
        self._server = None

    async def start(self):
        self._server = await asyncio.start_server(self._on_connect, self.host, self.port)
        self.port = self._server.sockets[0].getsockname()[1]
        asyncio.create_task(sweeper_loop(self.manager, self._on_drop))
        addrs = ", ".join(str(s.getsockname()) for s in self._server.sockets)
        log.info("listening on %s", addrs)
        return self._server

    async def stop(self):
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
                "name": "dont-fall-arena online relay",
                "ws": "connect with a websocket to /ws",
                "http": ["/health", "/rooms", "/stats"],
            }
        else:
            payload = b"404"
            writer.write(
                b"HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: 3\r\n"
                b"Access-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n" + payload
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
        t = msg["t"]

        if t == P.PING:
            await conn.send({"t": P.PONG, "ts": P.now()})
            return

        if t == P.CREATE:
            if p.room:
                m.leave(p)
            room, err = m.create(p)
            if err:
                await conn.send({"t": P.ERROR, "msg": err})
                return
            await conn.send({"t": P.CREATED, "room": room.code, "roster": room.roster(), "host": p.id})
            return

        if t == P.JOIN:
            room, err = m.join(p, msg.get("room", ""))
            if err:
                await conn.send({"t": P.ERROR, "msg": err})
                return
            await conn.send(
                {
                    "t": P.JOINED,
                    "room": room.code,
                    "slot": p.slot,
                    "roster": room.roster(),
                    "host": room.host_id,
                    "playing": room.playing,
                }
            )
            await room.broadcast({"t": P.PEER_JOINED, "peer": p.public(), "roster": room.roster()}, exclude=p.id)
            return

        if t == P.LEAVE:
            room = m.leave(p)
            if room:
                await room.broadcast({"t": P.PEER_LEFT, "id": p.id, "name": p.name, "roster": room.roster(), "host": room.host_id})
            await conn.send({"t": P.LEFT})
            return

        if t == P.ROOMS:
            await conn.send({"t": P.ROOMS, "rooms": m.public_rooms()})
            return

        room = m.room_of(p)
        if not room:
            await conn.send({"t": P.ERROR, "msg": "avval xonaga kiring"})
            return

        if t == P.CHAT:
            text = str(msg.get("text", ""))[:140]
            await room.broadcast({"t": P.ROOM_CHAT, "name": p.name, "text": text})
            return

        if t == P.START:
            if p.id != room.host_id:
                await conn.send({"t": P.ERROR, "msg": "faqat host boshlaydi"})
                return
            cfg = msg.get("cfg") if isinstance(msg.get("cfg"), dict) else {}
            room.playing = True
            await room.broadcast(
                {
                    "t": P.ROOM_START,
                    "host": room.host_id,
                    "roster": room.roster(),
                    "cfg": {
                        "seed": int(cfg.get("seed", 0)) or 0,
                        "arenaRadius": int(cfg.get("arenaRadius", 6)),
                        "roundsToWin": int(cfg.get("roundsToWin", 3)),
                        "difficulty": str(cfg.get("difficulty", "normal"))[:12],
                    },
                }
            )
            return

        if t == P.RESULT:
            if p.id == room.host_id and isinstance(msg.get("results"), list):
                try:
                    self.store.record_result(room.code, msg["results"][: P.MAX_PLAYERS_PER_ROOM])
                except Exception:
                    log.exception("store failed")
            return

        # ---- relay ----
        if t in P.RELAY_TYPES:
            payload = msg.get("d")
            if payload is None:
                return
            blob = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
            if len(blob) > P.MAX_MESSAGE_BYTES:
                return
            if t == P.RELAY_IN:
                if p.id == room.host_id:
                    return  # host inputs never travel
                await room.send_to(room.host_id, {"t": P.RELAY_IN, "from": p.id, "slot": p.slot, "d": payload})
            else:
                if p.id != room.host_id:
                    return  # only the host streams world state
                await room.broadcast({"t": t, "from": p.id, "d": payload}, exclude=p.id)
            return

    # -- drops -------------------------------------------------------------------
    async def disconnect(self, conn: Connection):
        p = conn.player
        if not p:
            return
        room = self.manager.leave(p)
        self.manager.players.pop(p.id, None)
        if room:
            await room.broadcast(
                {"t": P.PEER_LEFT, "id": p.id, "name": p.name, "roster": room.roster(), "host": room.host_id}
            )
        try:
            conn.writer.close()
        except Exception:
            pass

    async def _on_drop(self, player, room):
        log.info("dropping idle player %s", player.name)
        if room:
            await room.broadcast(
                {"t": P.PEER_LEFT, "id": player.id, "name": player.name, "roster": room.roster(), "host": room.host_id}
            )


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
    print(f"Don't Fall Arena online relay → ws://{args.host}:{args.port}/ws", flush=True)

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
