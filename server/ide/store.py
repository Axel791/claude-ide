"""SQLite under ~/.claude/claude-ide/ide.db: projects, per-workspace lists, UI state, focus, inbox, comment log.

Several server instances may run at once (one per Claude session that started it), so every
call opens its own connection and the database is the only truth.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from pathlib import Path

from . import config
from .errors import BadRequest, NotFound


def project_id(path: str) -> str:
    return hashlib.sha1(path.encode()).hexdigest()[:10]


class Store:
    def __init__(self, db_file: Path = config.DB_FILE, legacy_file: Path = config.LEGACY_STATE_FILE) -> None:
        self.db_file = db_file
        db_file.parent.mkdir(parents=True, exist_ok=True)
        with self.db() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, opened_at REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS workspaces (ws TEXT NOT NULL, path TEXT NOT NULL, pos INTEGER NOT NULL, PRIMARY KEY (ws, path));
                CREATE TABLE IF NOT EXISTS ui_state (ws TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS comment_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at REAL NOT NULL, root TEXT NOT NULL,
                    comment_id TEXT NOT NULL, event TEXT NOT NULL, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS focus (ws TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, ws TEXT NOT NULL, data TEXT NOT NULL, at REAL NOT NULL);
            """)
        self._import_legacy(legacy_file)

    def db(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.db_file, timeout=5)
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA busy_timeout=5000")
        return c

    def _import_legacy(self, legacy: Path) -> None:
        if not legacy.exists():
            return
        try:
            data = json.loads(legacy.read_text())
        except Exception:
            return
        if isinstance(data, list):
            data = {"roots": data, "workspaces": {"default": data}}
        with self.db() as c:
            for r in data.get("roots", []):
                if os.path.isdir(r):
                    c.execute("INSERT OR IGNORE INTO projects (id, path, opened_at) VALUES (?, ?, ?)", (project_id(r), r, time.time()))
            for ws, lst in data.get("workspaces", {}).items():
                for i, r in enumerate(lst):
                    if os.path.isdir(r):
                        c.execute("INSERT OR IGNORE INTO workspaces (ws, path, pos) VALUES (?, ?, ?)", (ws, r, i))
        legacy.rename(legacy.with_suffix(".json.imported"))

    # ---------------------------------------------------------------- workspaces and projects

    @staticmethod
    def ws_key(ws: str | None) -> str:
        """A session id, or a folder for the old links; "default" for none."""
        if not ws:
            return "default"
        return os.path.realpath(os.path.expanduser(ws)) if ws.startswith(("/", "~")) else ws

    def add(self, path: str, ws: str | None = None) -> dict:
        real = os.path.realpath(os.path.expanduser(path))
        if not os.path.isdir(real):
            raise BadRequest(f"not a directory: {path}")
        pid = project_id(real)
        key = self.ws_key(ws)
        with self.db() as c:
            c.execute("INSERT OR IGNORE INTO projects (id, path, opened_at) VALUES (?, ?, ?)", (pid, real, time.time()))
            c.execute("UPDATE projects SET opened_at = ? WHERE id = ?", (time.time(), pid))
            pos = c.execute("SELECT COALESCE(MAX(pos), -1) + 1 FROM workspaces WHERE ws = ?", (key,)).fetchone()[0]
            c.execute("INSERT OR IGNORE INTO workspaces (ws, path, pos) VALUES (?, ?, ?)", (key, real, pos))
        return self.info(pid)

    def remove(self, pid: str, ws: str | None = None) -> None:
        with self.db() as c:
            row = c.execute("SELECT path FROM projects WHERE id = ?", (pid,)).fetchone()
            if row:
                c.execute("DELETE FROM workspaces WHERE ws = ? AND path = ?", (self.ws_key(ws), row[0]))

    def info(self, pid: str) -> dict:
        root = self.root(pid)
        return {"id": pid, "name": os.path.basename(root), "path": root, "git": os.path.isdir(os.path.join(root, ".git"))}

    def list(self, ws: str | None = None, seed: str | None = None) -> list[dict]:
        key = self.ws_key(ws)
        with self.db() as c:
            rows = [r[0] for r in c.execute("SELECT path FROM workspaces WHERE ws = ? ORDER BY pos", (key,))]
            known = c.execute("SELECT COUNT(*) FROM workspaces WHERE ws = ?", (key,)).fetchone()[0]
        if not known and key != "default":
            # a fresh workspace shows the folder it was opened from
            first = seed if seed and os.path.isdir(os.path.expanduser(seed)) else (key if os.path.isdir(key) else None)
            if first:
                self.add(first, ws)
                rows = [os.path.realpath(os.path.expanduser(first))]
        return [self.info(project_id(r)) for r in rows if os.path.isdir(r)]

    def recent(self) -> list[str]:
        with self.db() as c:
            return [r[0] for r in c.execute("SELECT path FROM projects ORDER BY opened_at DESC") if os.path.isdir(r[0])]

    def root(self, pid: str) -> str:
        with self.db() as c:
            row = c.execute("SELECT path FROM projects WHERE id = ?", (pid,)).fetchone()
        if not row:
            raise NotFound(pid)
        return row[0]

    # ---------------------------------------------------------------- per-workspace state

    def get_state(self, ws: str | None) -> dict:
        with self.db() as c:
            row = c.execute("SELECT state FROM ui_state WHERE ws = ?", (self.ws_key(ws),)).fetchone()
        return json.loads(row[0]) if row else {}

    def set_state(self, ws: str | None, state: dict) -> None:
        self._upsert("ui_state", "state", ws, state)

    def get_focus(self, ws: str | None) -> dict | None:
        with self.db() as c:
            row = c.execute("SELECT data, updated_at FROM focus WHERE ws = ?", (self.ws_key(ws),)).fetchone()
        return {**json.loads(row[0]), "updatedAt": row[1]} if row else None

    def set_focus(self, ws: str | None, data: dict) -> None:
        self._upsert("focus", "data", ws, data)

    def _upsert(self, table: str, column: str, ws: str | None, value: dict) -> None:
        with self.db() as c:
            c.execute(
                f"INSERT INTO {table} (ws, {column}, updated_at) VALUES (?, ?, ?) "
                f"ON CONFLICT(ws) DO UPDATE SET {column} = excluded.{column}, updated_at = excluded.updated_at",
                (self.ws_key(ws), json.dumps(value, ensure_ascii=False), time.time()),
            )

    # ---------------------------------------------------------------- inbox: commands from the mod to the page

    def push_inbox(self, ws: str | None, data: dict) -> None:
        with self.db() as c:
            c.execute("INSERT INTO inbox (ws, data, at) VALUES (?, ?, ?)", (self.ws_key(ws), json.dumps(data, ensure_ascii=False), time.time()))

    def pop_inbox(self, ws: str | None) -> list[dict]:
        key = self.ws_key(ws)
        with self.db() as c:
            rows = c.execute("SELECT id, data FROM inbox WHERE ws = ? ORDER BY id", (key,)).fetchall()
            if rows:
                c.execute("DELETE FROM inbox WHERE ws = ?", (key,))
        return [json.loads(d) for _, d in rows]

    # ---------------------------------------------------------------- comment log

    def log_comment(self, root: str, cid: str, event: str, data: dict) -> None:
        with self.db() as c:
            c.execute("INSERT INTO comment_log (at, root, comment_id, event, data) VALUES (?, ?, ?, ?, ?)",
                      (time.time(), root, cid, event, json.dumps(data, ensure_ascii=False)))

    def comment_history(self, root: str | None = None, limit: int = 200) -> list[dict]:
        with self.db() as c:
            q = "SELECT at, root, comment_id, event, data FROM comment_log" + (" WHERE root = ?" if root else "") + " ORDER BY id DESC LIMIT ?"
            rows = c.execute(q, ((root, limit) if root else (limit,))).fetchall()
        return [{"at": a, "root": r, "id": cid, "event": ev, "data": json.loads(d)} for a, r, cid, ev, d in rows]
