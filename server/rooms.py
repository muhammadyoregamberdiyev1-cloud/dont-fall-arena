"""Rooms, parties, matchmaking, map-vote and reconnect bookkeeping (V2).

Relay-only: no game rules live here. The server owns room membership, teams,
the map vote, ranked eligibility, session tokens and reward validation.
"""

import asyncio
import logging

import protocol as P

log = logging.getLogger("arena.rooms")

BOT_NAMES = ["Botir", "Zilzila", "Xanjar", "Yulduz", "Qorqmas", "Chaqqon", "Safar", "G'olib"]


class RateLimiter:
    def __init__(self, rate=P.RATE_LIMIT, burst=90):
        self.rate = rate
        self.burst = burst
        self.credits = burst
        self.last = P.now()

    def allow(self):
        t = P.now()
        self.credits = min(self.burst, self.credits + (t - self.last) * self.rate)
        self.last = t
        if self.credits >= 1:
            self.credits -= 1
            return True
        return False


class Player:
    def __init__(self, pid, name, send, token=""):
        self.id = pid
        self.pid = pid  # profile account id (stats key)
        self.name = name
        self.send = send
        self.token = token
        self.room = None
        self.slot = -1
        self.team = None
        self.is_bot = False
        self.party = None
        self.queue = None          # dict(mode/ranked/allowBots/since)
        self.vote = None
        self.last_seen = P.now()
        self.disconnected_at = None
        self.conn = None           # live Connection or None when reserved
        self.limiter = RateLimiter()

    def touch(self):
        self.last_seen = P.now()

    def public(self):
        return {
            "id": self.id,
            "name": self.name,
            "slot": self.slot,
            "team": self.team,
            "bot": self.is_bot,
            "connected": self.disconnected_at is None,
        }


class Party:
    def __init__(self, code, leader):
        self.code = code
        self.leader = leader.id
        self.members = [leader.id]
        leader.party = self

    def add(self, p):
        if len(self.members) >= P.MAX_PARTY:
            return "party_full"
        if p.id in self.members:
            return "party_already"
        self.members.append(p.id)
        p.party = self
        return None

    def remove(self, pid):
        if pid in self.members:
            self.members.remove(pid)
        if self.leader == pid and self.members:
            self.leader = self.members[0]

    def public(self, players):
        return {
            "code": self.code,
            "leader": self.leader,
            "members": [players[m].public() for m in self.members if m in players],
        }


class Room:
    def __init__(self, code, host, mode="solo", ranked=False, allow_bots=True, rng=None):
        self.code = code
        self.rng = rng
        self.host_id = host.id
        self.mode = mode
        self.ranked = ranked
        self.allow_bots = allow_bots and not ranked
        self.players = {}
        self.phase = "lobby"       # lobby → vote → playing → end
        self.votes = {}            # player id → arena id
        self.bot_votes = {}        # bot slot (str) → arena id
        self.vote_ends = 0.0
        self.arena_id = None
        self.cfg = None
        self.created = P.now()
        self.playing = False
        self.bots = []             # reserved bot seats [{id,name,slot,team}]
        self.add(host)

    # -- membership ---------------------------------------------------------
    @property
    def size(self):
        return P.MODE_SIZES[self.mode]

    @property
    def per_team(self):
        return self.size // 2 if self.mode != "solo" else 0

    def add(self, p):
        self.players[p.id] = p
        p.room = self
        if p.slot < 0:
            self.assign_slots()

    def remove(self, pid):
        p = self.players.pop(pid, None)
        if p:
            p.room = None
            p.slot = -1
        return p

    def humans(self):
        return [p for p in self.players.values() if not p.is_bot]

    def assign_slots(self):
        """Balanced teams with party integrity; solo = plain seat order."""
        order = sorted(self.players.values(), key=lambda p: (p.disconnected_at or 0, p.id))
        if self.mode == "solo":
            for i, p in enumerate(order):
                p.slot = i
                p.team = None
            return
        groups = []
        seen = set()
        for p in order:
            if p.id in seen:
                continue
            if p.party and p.party.code in {q.party.code for q in order if q.party}:
                members = [q for q in order if q.party and q.party.code == p.party.code and q.id not in seen]
                groups.append(members)
                seen.update(m.id for m in members)
            else:
                groups.append([p])
                seen.add(p.id)
        teams = [0, 1]
        counts = [0, 0]
        slot_of_team = [0, 0]
        for g in sorted(groups, key=len, reverse=True):
            t = 0 if counts[0] <= counts[1] else 1
            for p in g:
                p.team = t
                p.slot = t * self.per_team + slot_of_team[t]
                slot_of_team[t] += 1
                counts[t] += 1

    def reserve_bots(self):
        """Casual rooms: fill empty seats with server-declared bot seats."""
        self.bots = []
        if self.ranked or not self.allow_bots:
            return
        taken = {p.slot for p in self.players.values()}
        self.assign_slot_plan()
        n = 0
        for slot, team in self.slot_plan:
            if slot in taken:
                continue
            bid = f"bot{slot}"
            self.bots.append(
                {"id": bid, "name": BOT_NAMES[n % len(BOT_NAMES)], "slot": slot, "team": team, "bot": True}
            )
            n += 1

    def assign_slot_plan(self):
        """Full seat list [(slot, team)] for the mode."""
        if self.mode == "solo":
            self.slot_plan = [(i, None) for i in range(self.size)]
        else:
            self.slot_plan = [(i, 0 if i < self.per_team else 1) for i in range(self.size)]

    def roster(self):
        out = [p.public() for p in sorted(self.players.values(), key=lambda x: x.slot if x.slot >= 0 else 99)]
        return out + list(self.bots)

    # -- voting ---------------------------------------------------------------
    def start_vote(self, secs=None):
        secs = P.VOTE_SECONDS if secs is None else secs
        self.phase = "vote"
        self.votes = {}
        self.bot_votes = {}
        self.vote_ends = P.now() + secs
        self.reserve_bots()

    def vote_counts(self):
        counts = {a: 0 for a in P.ARENA_IDS}
        for a in self.votes.values():
            counts[a] = counts.get(a, 0) + 1
        for a in self.bot_votes.values():
            counts[a] = counts.get(a, 0) + 1
        return counts

    def all_voted(self):
        humans = [p for p in self.humans() if p.disconnected_at is None]
        if any(p.vote is None for p in humans):
            return False
        return len(self.bot_votes) >= len(self.bots)

    def resolve_vote(self):
        counts = self.vote_counts()
        best = max(counts.values())
        top = [a for a, c in counts.items() if c == best]
        if best == 0:
            chosen = self.rng.choice(P.ARENA_IDS) if self.rng else P.ARENA_IDS[0]
        elif len(top) == 1:
            chosen = top[0]
        else:
            chosen = self.rng.choice(top) if self.rng else top[0]
        self.arena_id = chosen
        return chosen, counts

    async def broadcast(self, msg, exclude=None):
        for p in list(self.players.values()):
            if exclude and p.id in exclude:
                continue
            if p.send:
                try:
                    await p.send(msg)
                except Exception:
                    log.exception("send failed")

    async def send_to(self, pid, msg):
        p = self.players.get(pid)
        if p and p.send:
            try:
                await p.send(msg)
            except Exception:
                log.exception("send failed")


class RoomManager:
    def __init__(self, rng=None):
        self.rooms = {}
        self.players = {}          # connection player id → Player
        self.by_token = {}         # reconnect token → Player
        self.by_pid = {}           # profile pid → Player (duplicate sessions)
        self.parties = {}
        self.queues = {}           # (mode, ranked) → [player id]
        self.rng = rng
        self._sweeper = None

    # -- lifecycle -----------------------------------------------------------
    def register(self, pid, name, send, token="", profile_pid=""):
        p = Player(pid, name, send, token)
        if profile_pid:
            p.pid = profile_pid
        self.players[pid] = p
        if token:
            self.by_token[token] = p
        if p.pid:
            self.by_pid[p.pid] = p
        return p

    def reconnect(self, token, send):
        p = self.by_token.get(token)
        if not p or p.disconnected_at is None:
            return None
        if P.now() - p.disconnected_at > P.RECONNECT_GRACE:
            return None
        p.send = send
        p.disconnected_at = None
        p.last_seen = P.now()
        return p

    def drop(self, pid):
        p = self.players.pop(pid, None)
        if not p:
            return None
        self.by_token.pop(p.token, None)
        if p.party:
            party = p.party
            party.remove(pid)
            if not party.members:
                self.parties.pop(party.code, None)
        self.unqueue(p)
        room = p.room
        if room:
            p.disconnected_at = P.now()
            p.send = None
            return room
        self.by_pid.pop(p.pid, None)
        return None

    def room_of(self, p):
        return p.room if p else None

    # -- queues / matchmaking ---------------------------------------------------
    def queue(self, p, mode, ranked, allow_bots):
        self.unqueue(p)
        if p.room:
            return "in_room"
        if p.party:
            per = P.MODE_SIZES[mode] // 2 if mode != "solo" else P.MODE_SIZES[mode]
            if mode != "solo" and len(p.party.members) > per:
                return "party_too_big"
        p.queue = {"mode": mode, "ranked": ranked, "allowBots": allow_bots, "since": P.now()}
        key = (mode, ranked)
        self.queues.setdefault(key, [])
        for member_id in (p.party.members if p.party else [p.id]):
            m = self.players.get(member_id)
            if m and m.queue is None and m.id != p.id:
                m.queue = dict(p.queue)
                self.queues[key].append(m.id)
        self.queues[key].append(p.id)
        return None

    def unqueue(self, p):
        if not p.queue:
            return
        key = (p.queue["mode"], p.queue["ranked"])
        ids = [i for i in self.queues.get(key, []) if i != p.id]
        if p.party:
            ids = [i for i in ids if i not in p.party.members]
        self.queues[key] = ids
        if p.party:
            for m in p.party.members:
                mp = self.players.get(m)
                if mp:
                    mp.queue = None
        p.queue = None

    def tick_queues(self):
        """Form rooms when the mode's requirements are met."""
        formed = []
        for key, ids in list(self.queues.items()):
            mode, ranked = key
            ids = [i for i in ids if i in self.players and self.players[i].queue]
            self.queues[key] = ids
            size = P.MODE_SIZES[mode]
            now = P.now()
            if ranked:
                if len(ids) >= size:
                    formed.append((key, ids[:size]))
                elif ids and now - min(self.players[i].queue["since"] for i in ids) > P.QUEUE_RANKED_TIMEOUT:
                    for i in ids:
                        formed.append((("fail", ranked), [i]))
                    self.queues[key] = []
            else:
                waited = ids and now - min(self.players[i].queue["since"] for i in ids) > P.QUEUE_CASUAL_GRACE
                if len(ids) >= size or (len(ids) >= 2) or (waited and len(ids) >= 1 and self.players[ids[0]].queue["allowBots"]):
                    formed.append((key, ids[: min(size, max(2, len(ids)))]))
        for key, ids in formed:
            if key[0] == "fail":
                p = self.players.get(ids[0])
                if p:
                    asyncio.create_task(p.send({"t": P.QUEUE_FAIL, "reason": "mm_timeout"}))
                    self.unqueue(p)
                continue
            mode, ranked = key
            members = [self.players[i] for i in ids if i in self.players]
            if not members:
                continue
            room = self.create_room(members, mode, ranked, members[0].queue["allowBots"] if members[0].queue else True)
            for m in members:
                self.unqueue(m)
            room.start_vote()
            asyncio.create_task(self.announce_match(room))
        return formed

    async def announce_match(self, room):
        await room.broadcast(
            {
                "t": P.MATCH_FOUND,
                "room": room.code,
                "mode": room.mode,
                "ranked": room.ranked,
                "roster": room.roster(),
            }
        )
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

    def create_room(self, members, mode="solo", ranked=False, allow_bots=True):
        code = P.new_code(self.rng)
        while code in self.rooms:
            code = P.new_code(self.rng)
        room = Room(code, members[0], mode, ranked, allow_bots, self.rng)
        for m in members[1:]:
            room.add(m)
        room.assign_slots()
        self.rooms[code] = room
        return room

    def join_room(self, p, code):
        room = self.rooms.get(code.upper())
        if not room:
            return None, "no_room"
        if room.phase != "lobby":
            return None, "room_playing"
        if len(room.players) >= room.size:
            return None, "room_full"
        if p.room:
            self.leave(p)
        room.add(p)
        return room, None

    def leave(self, p):
        room = p.room
        if not room:
            return None
        room.remove(p.id)
        p.vote = None
        if not room.players:
            self.rooms.pop(room.code, None)
        elif room.host_id == p.id:
            alive = [q for q in room.players.values() if q.disconnected_at is None]
            room.host_id = alive[0].id if alive else next(iter(room.players.values())).id
        return room

    # -- parties ---------------------------------------------------------------
    def party_create(self, p):
        if p.party:
            return None, "party_already"
        code = P.new_code(self.rng)
        while code in self.parties:
            code = P.new_code(self.rng)
        party = Party(code, p)
        self.parties[code] = party
        return party, None

    def party_join(self, p, code):
        party = self.parties.get((code or "").upper())
        if not party:
            return None, "no_party"
        err = party.add(p)
        if err:
            return None, err
        return party, None

    def party_leave(self, p):
        party = p.party
        if not party:
            return None
        party.remove(p.id)
        p.party = None
        if not party.members:
            self.parties.pop(party.code, None)
        return party

    def party_kick(self, leader, pid):
        party = leader.party
        if not party or party.leader != leader.id:
            return "not_leader"
        if pid == leader.id:
            return "kick_self"
        if pid not in party.members:
            return "not_member"
        target = self.players.get(pid)
        party.remove(pid)
        if target:
            target.party = None
        return None

    def party_transfer(self, leader, pid):
        party = leader.party
        if not party or party.leader != leader.id or pid not in party.members:
            return "not_leader"
        party.leader = pid
        return None

    # -- room tick: votes, reconnect grace, idle rooms ---------------------------
    async def tick_rooms(self):
        for room in list(self.rooms.values()):
            try:
                await self._tick_room(room)
            except Exception:
                log.exception("room tick failed (%s)", room.code)

    async def _tick_room(self, room):
        if True:
            if room.phase == "vote":
                if P.now() >= room.vote_ends or room.all_voted():
                    chosen, counts = room.resolve_vote()
                    room.phase = "playing"
                    room.playing = True
                    room.cfg = {
                        "seed": int(self.rng.random() * 1e9) if self.rng else 12345,
                        "arenaId": chosen,
                        "mode": room.mode,
                        "ranked": room.ranked,
                        "roundsToWin": 3,
                    }
                    await room.broadcast(
                        {"t": P.VOTE_RESULT, "arena": chosen, "counts": counts, "tie": len([c for c in counts.values() if c == max(counts.values())]) > 1}
                    )
                    await room.broadcast(
                        {"t": P.ROOM_START, "host": room.host_id, "roster": room.roster(), "cfg": room.cfg}
                    )
            elif room.phase in ("lobby", "playing"):
                # reconnect grace → casual seats become bots, ranked seats idle
                for p in list(room.players.values()):
                    if p.disconnected_at and P.now() - p.disconnected_at > P.RECONNECT_GRACE:
                        if not room.ranked and room.phase == "playing":
                            seat = {"id": p.id, "name": p.name, "slot": p.slot, "team": p.team, "bot": True}
                            room.bots = [b for b in room.bots if b["slot"] != p.slot] + [seat]
                            room.remove(p.id)
                            await room.broadcast({"t": P.PEER_LEFT, "id": p.id, "name": p.name, "roster": room.roster(), "host": room.host_id, "botified": True})
                        elif room.ranked:
                            room.remove(p.id)
                            await room.broadcast({"t": P.PEER_LEFT, "id": p.id, "name": p.name, "roster": room.roster(), "host": room.host_id})
                if not room.players:
                    self.rooms.pop(room.code, None)

    def public_rooms(self):
        out = []
        for room in self.rooms.values():
            out.append(
                {
                    "code": room.code,
                    "players": len(room.players),
                    "max": room.size,
                    "playing": room.phase != "lobby",
                    "mode": room.mode,
                    "ranked": room.ranked,
                    "host": room.players.get(room.host_id).name if room.players.get(room.host_id) else "?",
                }
            )
        out.sort(key=lambda r: (-r["players"], r["code"]))
        return out


async def sweeper_loop(manager, interval=1.0):
    while True:
        await asyncio.sleep(interval)
        try:
            manager.tick_queues()
            await manager.tick_rooms()
        except Exception:
            log.exception("sweeper")
