"""
Persistent stats for the online server (sqlite, zero dependencies).

Every finished online match reports its results; we keep per-player totals and
expose a global leaderboard over HTTP (`GET /stats`).
"""

import os
import sqlite3
import threading
import time

DEFAULT_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "arena.db")


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
                    games INTEGER NOT NULL DEFAULT 0,
                    wins INTEGER NOT NULL DEFAULT 0,
                    rounds INTEGER NOT NULL DEFAULT 0,
                    last_seen REAL NOT NULL
                )"""
            )
            self._con.execute(
                """CREATE TABLE IF NOT EXISTS games(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    room TEXT NOT NULL,
                    ts REAL NOT NULL,
                    players INTEGER NOT NULL,
                    winner TEXT NOT NULL
                )"""
            )

    # -- writes --------------------------------------------------------------
    def record_result(self, room, results):
        """results: list of dicts {name, wins, place}."""
        ts = time.time()
        winner = ""
        with self._lock, self._con:
            for r in results:
                name = str(r.get("name", "?"))[:12] or "?"
                wins = int(r.get("wins", 0) or 0)
                rounds = int(r.get("roundWins", 0) or 0)
                if not winner and r.get("place") == 1 and wins:
                    winner = name
                self._con.execute(
                    """INSERT INTO players(name, games, wins, rounds, last_seen)
                       VALUES(?,1,?,?,?)
                       ON CONFLICT(name) DO UPDATE SET
                         games = games + 1,
                         wins = wins + excluded.wins,
                         rounds = rounds + excluded.rounds,
                         last_seen = excluded.last_seen""",
                    (name, wins, rounds, ts),
                )
            self._con.execute(
                "INSERT INTO games(room, ts, players, winner) VALUES(?,?,?,?)",
                (room, ts, len(results), winner or "?"),
            )

    # -- reads ---------------------------------------------------------------
    def leaderboard(self, limit=10):
        with self._lock:
            cur = self._con.execute(
                "SELECT name, games, wins, rounds FROM players ORDER BY wins DESC, rounds DESC, games DESC LIMIT ?",
                (limit,),
            )
            return [
                {"name": n, "games": g, "wins": w, "rounds": r} for (n, g, w, r) in cur.fetchall()
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
