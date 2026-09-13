"""
Room bookkeeping for the Don't Fall Arena online server.

The server is a relay: the room *host* runs the simulation in the browser and
streams snapshots; guests stream inputs back. This module only routes messages
and tracks slots — no game rules live here.
"""

import asyncio

from protocol import (
    IDLE_TIMEOUT,
    MAX_PLAYERS_PER_ROOM,
    ROOM_TTL_EMPTY,
    make_room_code,
    now,
)


class Player:
    __slots__ = ("id", "name", "send", "slot", "last_seen", "room")

    def __init__(self, pid, name, send):
        self.id = pid
        self.name = name
        self.send = send  # async callable: send(dict)
        self.slot = -1
        self.last_seen = now()
        self.room = None

    def touch(self):
        self.last_seen = now()

    @property
    def idle_for(self):
        return now() - self.last_seen

    def public(self):
        return {"id": self.id, "name": self.name, "slot": self.slot}


class Room:
    def __init__(self, code, host: Player):
        self.code = code
        self.players: "dict[str, Player]" = {}
        self.host_id = host.id
        self.created = now()
        self.playing = False
        self.add(host)

    # -- membership ---------------------------------------------------------
    @property
    def host(self):
        return self.players.get(self.host_id)

    def full(self):
        return len(self.players) >= MAX_PLAYERS_PER_ROOM

    def add(self, p: Player):
        used = {x.slot for x in self.players.values()}
        slot = 0
        while slot in used:
            slot += 1
        p.slot = slot
        p.room = self.code
        self.players[p.id] = p

    def remove(self, pid):
        p = self.players.pop(pid, None)
        if p:
            p.room = None
            p.slot = -1
        return p

    # -- messaging ----------------------------------------------------------
    async def broadcast(self, payload, exclude=None):
        for p in list(self.players.values()):
            if exclude and p.id == exclude:
                continue
            try:
                await p.send(payload)
            except Exception:
                pass

    async def send_to(self, pid, payload):
        p = self.players.get(pid)
        if p:
            try:
                await p.send(payload)
                return True
            except Exception:
                return False
        return False

    def roster(self):
        return [p.public() for p in sorted(self.players.values(), key=lambda x: x.slot)]


class RoomManager:
    def __init__(self, rng=None):
        self.rooms: "dict[str, Room]" = {}
        self.players: "dict[str, Player]" = {}
        self.rng = rng

    # -- lifecycle ----------------------------------------------------------
    def register(self, pid, name, send) -> Player:
        p = Player(pid, name, send)
        self.players[pid] = p
        return p

    def create(self, player: Player):
        for _ in range(50):
            code = make_room_code(self.rng)
            if code not in self.rooms:
                break
        else:
            return None, "room codes exhausted"
        room = Room(code, player)
        self.rooms[code] = room
        return room, None

    def join(self, player: Player, code: str):
        room = self.rooms.get(code)
        if not room:
            return None, "xona topilmadi"
        if room.full():
            return None, "xona to'lgan"
        if player.room:
            self.leave(player)
        room.add(player)
        return room, None

    def leave(self, player: Player):
        room = self.rooms.get(player.room) if player.room else None
        if not room:
            return None
        room.remove(player.id)
        if not room.players:
            self.rooms.pop(room.code, None)
            return room
        # host migration: earliest remaining player takes over
        if room.host_id == player.id:
            nxt = sorted(room.players.values(), key=lambda p: p.slot)[0]
            room.host_id = nxt.id
        return room

    def room_of(self, player: Player):
        return self.rooms.get(player.room) if player.room else None

    # -- maintenance --------------------------------------------------------
    def sweep(self):
        """Drop idle players and stale empty rooms. Returns list of (player, room)."""
        dropped = []
        t = now()
        for pid, p in list(self.players.items()):
            if p.idle_for > IDLE_TIMEOUT:
                room = self.leave(p)
                dropped.append((p, room))
                self.players.pop(pid, None)
        for code, room in list(self.rooms.items()):
            if not room.players and t - room.created > ROOM_TTL_EMPTY:
                self.rooms.pop(code, None)
        return dropped

    def public_rooms(self):
        out = []
        for room in self.rooms.values():
            out.append(
                {
                    "code": room.code,
                    "players": len(room.players),
                    "max": MAX_PLAYERS_PER_ROOM,
                    "playing": room.playing,
                    "host": room.host.name if room.host else "?",
                }
            )
        out.sort(key=lambda r: (-r["players"], r["code"]))
        return out


async def sweeper_loop(manager: RoomManager, on_drop, interval=5.0):
    while True:
        await asyncio.sleep(interval)
        for player, room in manager.sweep():
            await on_drop(player, room)
