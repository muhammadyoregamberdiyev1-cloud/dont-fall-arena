"""
Onlayn server uchun test: haqiqiy WebSocket handshake + xona/relay/stats.

    python3 tests/test_server.py
"""

import asyncio
import base64
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))

import protocol as P  # noqa: E402
from main import Server  # noqa: E402

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def frame(obj):
    payload = json.dumps(obj).encode()
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    out = bytearray([0x81])
    n = len(payload)
    if n < 126:
        out.append(0x80 | n)
    elif n < 65536:
        out.append(0x80 | 126)
        out += n.to_bytes(2, "big")
    else:
        out.append(0x80 | 127)
        out += n.to_bytes(8, "big")
    out += mask + masked
    return bytes(out)


async def read_msg(reader, timeout=2.0):
    async def _one():
        while True:
            head = await reader.readexactly(2)
            op = head[0] & 0x0F
            ln = head[1] & 0x7F
            if ln == 126:
                ln = int.from_bytes(await reader.readexactly(2), "big")
            elif ln == 127:
                ln = int.from_bytes(await reader.readexactly(8), "big")
            payload = await reader.readexactly(ln) if ln else b""
            if op == 0x1:
                return json.loads(payload.decode())
            if op == 0x8:
                return None

    return await asyncio.wait_for(_one(), timeout)


class Client:
    def __init__(self):
        self.reader = None
        self.writer = None
        self.id = None

    async def connect(self, port):
        self.reader, self.writer = await asyncio.open_connection("127.0.0.1", port)
        key = base64.b64encode(os.urandom(16)).decode()
        self.writer.write(
            (
                f"GET /ws HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\n"
                f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        await self.writer.drain()
        status = await self.reader.readline()
        assert b"101" in status, status
        while True:
            line = await self.reader.readline()
            if line in (b"\r\n", b"\n"):
                break
        return self

    async def send(self, obj):
        self.writer.write(frame(obj))
        await self.writer.drain()

    async def recv(self, timeout=2.0):
        return await read_msg(self.reader, timeout)

    async def expect(self, t, timeout=2.0):
        msg = await self.recv(timeout)
        assert msg is not None, f"{t} kutilgandi, lekin ulanish yopildi"
        assert msg["t"] == t, f"{t} kutilgandi, keldi: {msg}"
        return msg

    async def hello(self, name):
        await self.send({"t": P.HELLO, "name": name})
        w = await self.expect(P.WELCOME)
        self.id = w["id"]
        return w

    async def close(self):
        try:
            self.writer.close()
        except Exception:
            pass


async def http_get(port, path):
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(f"GET {path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n".encode())
    await writer.drain()
    data = await reader.read()
    writer.close()
    body = data.split(b"\r\n\r\n", 1)[1]
    return json.loads(body.decode())


class ServerTest(unittest.TestCase):
    def test_full_flow(self):
        async def run():
            tmp = tempfile.mkdtemp()
            srv = Server("127.0.0.1", 0, os.path.join(tmp, "t.db"))
            await srv.start()
            port = srv.port
            try:
                a, b = Client(), Client()
                await a.connect(port)
                await b.connect(port)
                await a.hello("Ali")
                await b.hello("Vali")

                # create + join
                await a.send({"t": P.CREATE})
                created = await a.expect(P.CREATED)
                code = created["room"]
                self.assertEqual(len(code), 4)
                await b.send({"t": P.JOIN, "room": code.lower()})
                joined = await b.expect(P.JOINED)
                self.assertEqual(joined["slot"], 1)
                self.assertEqual(joined["host"], a.id)
                pj = await a.expect(P.PEER_JOINED)
                self.assertEqual(pj["peer"]["name"], "Vali")

                # join unknown room -> error
                await b.send({"t": P.JOIN, "room": "QQQQ"})
                err = await b.expect(P.ERROR)
                self.assertTrue(err["msg"])

                # relay: guest input -> host only
                await b.send({"t": P.RELAY_IN, "d": {"mx": 0.5, "my": -1, "dash": True}})
                rin = await a.expect(P.RELAY_IN)
                self.assertEqual(rin["slot"], 1)
                self.assertTrue(rin["d"]["dash"])

                # relay: host snapshot -> guests only
                await a.send({"t": P.RELAY_SNAP, "d": {"ps": [[1, 2, 0, 1]]}})
                snap = await b.expect(P.RELAY_SNAP)
                self.assertEqual(snap["d"]["ps"][0][0], 1)

                # guest must NOT be able to stream world state
                await b.send({"t": P.RELAY_SNAP, "d": {"hack": 1}})
                with self.assertRaises(asyncio.TimeoutError):
                    await a.recv(0.4)

                # start + result + stats
                await a.send({"t": P.START, "cfg": {"seed": 42, "arenaRadius": 6}})
                st = await b.expect(P.ROOM_START)
                await a.expect(P.ROOM_START)  # host ham oladi
                self.assertEqual(st["cfg"]["seed"], 42)
                await a.send(
                    {
                        "t": P.RESULT,
                        "results": [
                            {"name": "Ali", "wins": 3, "place": 1, "roundWins": 3},
                            {"name": "Vali", "wins": 1, "place": 2, "roundWins": 1},
                        ],
                    }
                )
                await asyncio.sleep(0.15)
                stats = await http_get(port, "/stats")
                names = [r["name"] for r in stats["leaderboard"]]
                self.assertIn("Ali", names)
                self.assertEqual(stats["totals"]["matches"], 1)

                rooms = await http_get(port, "/rooms")
                self.assertTrue(any(r["code"] == code for r in rooms["rooms"]))

                # leave notifies the peer
                await b.send({"t": P.LEAVE})
                pl = await a.expect(P.PEER_LEFT)
                self.assertEqual(pl["name"], "Vali")

                await a.close()
                await b.close()
            finally:
                await srv.stop()

        asyncio.run(run())

    def test_protocol_validation(self):
        obj, err = P.decode('{"t":"ping"}')
        self.assertIsNone(err)
        self.assertEqual(obj["t"], "ping")
        obj, err = P.decode('{"t":"nope"}')
        self.assertIsNotNone(err)
        obj, err = P.decode('{"t":"hello","name":"  xulmat  "}')
        self.assertEqual(obj["name"], "xulmat")
        obj, err = P.decode("not json")
        self.assertIsNotNone(err)
        self.assertEqual(len(P.make_room_code()), 4)


if __name__ == "__main__":
    unittest.main(verbosity=2)
