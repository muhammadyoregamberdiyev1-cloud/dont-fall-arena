"""
Persistent stats + server-authoritative rewards (sqlite, zero dependencies).

Clients never compute their own XP/coins/RP for online matches: the host
reports raw per-player stats, this module validates the ranges and derives
the rewards. Offline progression stays in the browser profile.
"""

import os
import sqlite3
import threading
import time

import protocol as P

DEFAULT_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "arena.db")

# validation clamps — anything outside is silently clamped (anti-cheat)
CLAMP = {"wins": (0, 7), "roundWins": (0, 7), "points": (0, 600), "eliminations": (0, 7), "place": (1, 8)}


def _clamp(v, lo, hi):
    try:
        v = int(v)
    except Exception:
        v = 0
    return max(lo, min(hi, v))


class Store:
    def __init__(self, path=None):
        self.path = path or os.environ.get("ARENA_DB", DEFAULT_DB)
        self._lock = threading.Lock()
        self._con = sqlite3.connect(self.path, check_same_thread=False)
        self._con.execute("PRAGMA journal_mode=WAL")
        with self._lock, self._con:
            self._con.execute(
                """CREATE TABLE IF NOT EXISTS players(
                    name TEXT PRIMARY KEY,
                    pid TEXT NOT NULL DEFAULT '',
                    games INTEGER NOT NULL DEFAULT 0,
                    wins INTEGER NOT NULL DEFAULT 0,
                    rounds INTEGER NOT NULL DEFAULT 0,
                    coins INTEGER NOT NULL DEFAULT 0,
                    rp INTEGER NOT NULL DEFAULT 0,
                    last_seen REAL NOT NULL
                )"""
            )
            self._con.execute(
                """CREATE TABLE IF NOT EXISTS games(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    room TEXT NOT NULL,
                    ts REAL NOT NULL,
                    players INTEGER NOT NULL,
                    winner TEXT NOT NULL,
                    mode TEXT NOT NULL DEFAULT 'solo',
                    ranked INTEGER NOT NULL DEFAULT 0,
                    arena TEXT NOT NULL DEFAULT ''
                )"""
            )
            self._migrate()

    def _migrate(self):
        cols = {r[1] for r in self._con.execute("PRAGMA table_info(players)")}
        for col, ddl in (
            ("pid", "ALTER TABLE players ADD COLUMN pid TEXT NOT NULL DEFAULT ''"),
            ("coins", "ALTER TABLE players ADD COLUMN coins INTEGER NOT NULL DEFAULT 0"),
            ("rp", "ALTER TABLE players ADD COLUMN rp INTEGER NOT NULL DEFAULT 0"),
        ):
            if col not in cols:
                self._con.execute(ddl)
        gcols = {r[1] for r in self._con.execute("PRAGMA table_info(games)")}
        for col, ddl in (
            ("mode", "ALTER TABLE games ADD COLUMN mode TEXT NOT NULL DEFAULT 'solo'"),
            ("ranked", "ALTER TABLE games ADD COLUMN ranked INTEGER NOT NULL DEFAULT 0"),
            ("arena", "ALTER TABLE games ADD COLUMN arena TEXT NOT NULL DEFAULT ''"),
        ):
            if col not in gcols:
                self._con.execute(ddl)

    # -- rewards -------------------------------------------------------------
    @staticmethod
    def compute_rewards(results, ranked=False):
        """results: [{pid,name,wins,roundWins,points,eliminations,place,team}]"""
        clean = []
        for r in results[: P.MAX_PLAYERS_PER_ROOM]:
            clean.append(
                {
                    "pid": str(r.get("pid") or "")[:40],
                    "name": str(r.get("name") or "?")[:18],
                    "wins": _clamp(r.get("wins"), *CLAMP["wins"]),
                    "roundWins": _clamp(r.get("roundWins"), *CLAMP["roundWins"]),
                    "points": _clamp(r.get("points"), *CLAMP["points"]),
                    "eliminations": _clamp(r.get("eliminations"), *CLAMP["eliminations"]),
                    "place": _clamp(r.get("place"), *CLAMP["place"]),
                    "team": r.get("team"),
                }
            )
        if not clean:
            return []
        best = max(c["wins"] for c in clean)
        if best > 0:
            winners = [c for c in clean if c["wins"] == best]
        else:
            winners = [c for c in clean if c["place"] == 1][:1]
        win_pids = {id(c) for c in winners}
        mvp = max(clean, key=lambda c: c["points"]) if clean else None
        out = []
        for c in clean:
            won = id(c) in win_pids
            xp = (120 if won else 0) + c["roundWins"] * 40 + c["points"] * 8 + c["eliminations"] * 12
            coins = (40 if won else 10) + c["roundWins"] * 15 + c["points"] // 2 + c["eliminations"] * 5
            is_mvp = mvp is c and won
            rp = 0
            if ranked:
                rp = (P.RP_WIN if won else P.RP_LOSS) + (P.RP_MVP if is_mvp else 0)
            out.append(
                {
                    "pid": c["pid"],
                    "name": c["name"],
                    "won": won,
                    "mvp": is_mvp,
                    "xp": xp,
                    "coins": coins,
                    "rp": rp,
                    "place": c["place"],
                }
            )
        return out

    # -- writes --------------------------------------------------------------
    def record_result(self, room, results, mode="solo", ranked=False, arena=""):
        """Validate, store and return the server-computed reward list."""
        rewards = self.compute_rewards(results, ranked)
        ts = time.time()
        winner = next((r["name"] for r in rewards if r["won"]), "?")
        with self._lock, self._con:
            for r in rewards:
                key = r["pid"] or r["name"]
                self._con.execute(
                    """INSERT INTO players(name, pid, games, wins, rounds, coins, rp, last_seen)
                       VALUES(?,?,1,?,?,?,?,?)
                       ON CONFLICT(name) DO UPDATE SET
                         pid = CASE WHEN excluded.pid != '' THEN excluded.pid ELSE players.pid END,
                         games = games + 1,
                         wins = wins + excluded.wins,
                         rounds = rounds + excluded.rounds,
                         coins = coins + excluded.coins,
                         rp = MAX(0, rp + excluded.rp),
                         last_seen = excluded.last_seen""",
                    (
                        r["name"],
                        r["pid"],
                        1 if r["won"] else 0,
                        r.get("roundWins", 0),
                        r["coins"],
                        r["rp"],
                        ts,
                    ),
                )
            self._con.execute(
                "INSERT INTO games(room, ts, players, winner, mode, ranked, arena) VALUES(?,?,?,?,?,?,?)",
                (room, ts, len(rewards), winner, mode, 1 if ranked else 0, arena),
            )
        return rewards

    # -- reads ---------------------------------------------------------------
    def leaderboard(self, limit=10):
        with self._lock:
            cur = self._con.execute(
                "SELECT name, games, wins, rounds, coins, rp FROM players ORDER BY wins DESC, rounds DESC, games DESC LIMIT ?",
                (limit,),
            )
            return [
                {"name": n, "games": g, "wins": w, "rounds": r, "coins": c, "rp": rp}
                for (n, g, w, r, c, rp) in cur.fetchall()
            ]

    def totals(self):
        with self._lock:
            row = self._con.execute(
                "SELECT COUNT(*), COALESCE(SUM(games),0), COALESCE(SUM(wins),0) FROM players"
            ).fetchone()
            games = self._con.execute("SELECT COUNT(*) FROM games").fetchone()[0]
        return {"players": row[0], "playerGames": row[1], "wins": row[2], "matches": games}

    def close(self):
        with self._lock:
            self._con.close()
