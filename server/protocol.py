"""Wire protocol for the Don't Fall Arena relay (V2).

The server is authoritative for: rooms, matchmaking, teams, map vote, ranked
eligibility, reconnect/session tokens, rate limits and reward calculation.
Gameplay physics stay on the room host (documented architecture decision);
the host streams snapshots and the server validates + stores results.
"""

import json
import random
import string
import time

PROTOCOL_VERSION = 2

# --- limits -----------------------------------------------------------------
MAX_MESSAGE_BYTES = 64 * 1024
MAX_PLAYERS_PER_ROOM = 8
MAX_PARTY = 4
IDLE_TIMEOUT = 25.0          # seconds without any message → dropped
VOTE_SECONDS = 9.0           # map vote window
QUEUE_CASUAL_GRACE = 12.0    # casual: fill with bots after this wait
QUEUE_RANKED_TIMEOUT = 60.0  # ranked: fail matchmaking after this wait
RATE_LIMIT = 45.0            # messages / second (burst 90)
RECONNECT_GRACE = 30.0       # slot reserved after disconnect

# ranked RP rules
RP_WIN = 25
RP_LOSS = -10
RP_MVP = 5

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/I/L

# --- message types ----------------------------------------------------------
HELLO = "hello"
WELCOME = "welcome"
PING = "ping"
PONG = "pong"

QUEUE = "queue"
UNQUEUE = "unqueue"
MATCH_FOUND = "match_found"
QUEUE_FAIL = "queue_fail"

CREATE = "create"
JOIN = "join"
LEAVE = "leave"
LEFT = "left"
ROOMS = "rooms"

VOTE_START = "vote_start"
VOTE = "vote"
VOTE_UPDATE = "vote_update"
VOTE_RESULT = "vote_result"

START = "start"
ROOM_START = "room_start"
ROOM_CHAT = "room_chat"
PEER_JOINED = "peer_joined"
PEER_LEFT = "peer_left"
PEER_REJOINED = "peer_rejoined"
CREATED = "created"
JOINED = "joined"

PARTY_CREATE = "party_create"
PARTY_JOIN = "party_join"
PARTY_LEAVE = "party_leave"
PARTY_KICK = "party_kick"
PARTY_TRANSFER = "party_transfer"
PARTY_UPDATE = "party_update"

RESULT = "result"
REWARDS = "rewards"

ERROR = "error"

# relay (payload wrapped in {"t": ..., "d": ...}; optional "to": player id)
RELAY_IN = "in"
RELAY_SNAP = "snap"
RELAY_EV = "ev"
RELAY_ROUND = "rstart"
RELAY_EMOTE = "emote"
RELAY_TYPES = {RELAY_IN, RELAY_SNAP, RELAY_EV, RELAY_ROUND, RELAY_EMOTE}

VALID_MODES = {"solo", "1v1", "2v2", "3v3", "4v4"}
MODE_SIZES = {"solo": 8, "1v1": 2, "2v2": 4, "3v3": 6, "4v4": 8}
MODE_MIN = {"solo": 2, "1v1": 2, "2v2": 2, "3v3": 2, "4v4": 2}
ARENA_IDS = ["color_grid", "chaos_core"]


def now():
    return time.time()


def encode(obj) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def decode(text):
    try:
        obj = json.loads(text)
        if not isinstance(obj, dict):
            return None, "not_object"
        return obj, None
    except Exception:
        return None, "bad_json"


def new_id(rng=None):
    rng = rng or random
    return "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(10))


make_player_id = new_id


def new_code(rng=None):
    rng = rng or random
    return "".join(rng.choice(CODE_ALPHABET) for _ in range(4))


def new_token(rng=None):
    rng = rng or random
    return "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(24))


def clean_name(name):
    name = str(name or "").strip()
    if not name:
        return "O'yinchi"
    return name[:18]


def validate_hello(msg):
    if not isinstance(msg, dict) or msg.get("t") != HELLO:
        return None, "bad_hello"
    name = clean_name(msg.get("name"))
    pid = str(msg.get("pid") or "")[:40]
    token = str(msg.get("token") or "")[:40]
    return {"name": name, "pid": pid, "token": token}, None


def validate_queue(msg):
    mode = str(msg.get("mode") or "solo")
    if mode not in VALID_MODES:
        return None, "bad_mode"
    ranked = bool(msg.get("ranked"))
    allow_bots = bool(msg.get("allowBots")) and not ranked
    return {"mode": mode, "ranked": ranked, "allowBots": allow_bots}, None


def validate_vote(msg):
    arena = str(msg.get("arena") or "")
    if arena not in ARENA_IDS:
        return None, "bad_arena"
    bots = msg.get("bots")
    if bots is not None and not isinstance(bots, dict):
        bots = None
    return {"arena": arena, "bots": bots}, None
