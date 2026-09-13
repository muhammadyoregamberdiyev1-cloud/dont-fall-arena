"""
Don't Fall Arena — onlayn server protocol.

Message format: single-line JSON objects with a `t` (type) field.
This module owns the vocabulary, validation and room-code generation so the
server and any future client share one source of truth.
"""

import json
import random
import string
import time

PROTOCOL_VERSION = 1
MAX_MESSAGE_BYTES = 64 * 1024
MAX_PLAYERS_PER_ROOM = 8
IDLE_TIMEOUT = 20.0  # seconds without any message -> dropped
ROOM_TTL_EMPTY = 60.0  # empty rooms are reaped after this

# client -> server
HELLO = "hello"
CREATE = "create"
JOIN = "join"
LEAVE = "leave"
START = "start"
CHAT = "chat"
PING = "ping"
RESULT = "result"
# relayed game traffic (opaque payloads routed by the server)
RELAY_IN = "in"  # guest -> host: input
RELAY_SNAP = "snap"  # host -> guests: state snapshot
RELAY_EV = "ev"  # host -> guests: events
RELAY_ROUND = "rstart"  # host -> guests: round setup

# server -> client
WELCOME = "welcome"
CREATED = "created"
JOINED = "joined"
LEFT = "left"
PEER_JOINED = "peer_joined"
PEER_LEFT = "peer_left"
ROOM_START = "room_start"
ROOM_CHAT = "room_chat"
PONG = "pong"
ROOMS = "rooms"
ERROR = "error"

RELAY_TYPES = {RELAY_IN, RELAY_SNAP, RELAY_EV, RELAY_ROUND}
CLIENT_TYPES = {HELLO, CREATE, JOIN, LEAVE, START, CHAT, PING, RESULT} | RELAY_TYPES

CODE_ALPHABET = "".join(sorted(set(string.ascii_uppercase + string.digits) - set("O0I1L5S2Z")))


def make_room_code(rng=None) -> str:
    rng = rng or random.SystemRandom()
    return "".join(rng.choice(CODE_ALPHABET) for _ in range(4))


def make_player_id(rng=None) -> str:
    rng = rng or random.SystemRandom()
    return "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(10))


def encode(obj: dict) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def decode(text: str):
    """Return (dict, None) or (None, error_string)."""
    if len(text) > MAX_MESSAGE_BYTES:
        return None, "message too large"
    try:
        obj = json.loads(text)
    except (ValueError, TypeError):
        return None, "bad json"
    if not isinstance(obj, dict):
        return None, "expected object"
    t = obj.get("t")
    if not isinstance(t, str) or t not in CLIENT_TYPES:
        return None, "unknown type"
    name = obj.get("name")
    if name is not None:
        if not isinstance(name, str):
            return None, "bad name"
        obj["name"] = name.strip()[:12] or "O'yinchi"
    code = obj.get("room")
    if code is not None:
        if not isinstance(code, str):
            return None, "bad room"
        obj["room"] = code.strip().upper()[:8]
    return obj, None


def now() -> float:
    return time.time()
