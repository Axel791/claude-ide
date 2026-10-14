"""Line comments for Claude: the project's own .claude/review.json, plus a log in the store.

The file stays the exchange format: Claude reads it without the server, and git ignores it.
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid
from pathlib import Path

from . import config
from .errors import NotFound
from .store import Store

_LOCK = threading.Lock()


def review_path(root: str) -> str:
    return os.path.join(root, config.REVIEW_FILE)


def ensure_gitignore(root: str) -> None:
    gi = os.path.join(root, ".gitignore")
    try:
        text = Path(gi).read_text() if os.path.exists(gi) else ""
        if config.REVIEW_FILE not in text.splitlines():
            with open(gi, "a") as f:
                if text and not text.endswith("\n"):
                    f.write("\n")
                f.write(config.REVIEW_FILE + "\n")
    except OSError:
        pass


def load(root: str) -> list[dict]:
    p = review_path(root)
    if not os.path.exists(p):
        return []
    try:
        return json.loads(Path(p).read_text()).get("comments", [])
    except Exception:
        return []


def save(root: str, comments: list[dict]) -> None:
    p = review_path(root)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    Path(p).write_text(json.dumps({"comments": comments}, indent=2, ensure_ascii=False))


def mtime(root: str) -> float:
    p = review_path(root)
    return os.stat(p).st_mtime if os.path.exists(p) else 0.0


class Comments:
    def __init__(self, store: Store) -> None:
        self.store = store

    def create(self, root: str, body: dict) -> dict:
        c = {
            "id": uuid.uuid4().hex[:8], "path": body["path"], "line": int(body["line"]),
            "endLine": int(body.get("endLine") or body["line"]), "snippet": body.get("snippet", ""),
            "text": body["text"], "status": "open", "createdAt": time.time(), "reply": None,
            "source": body.get("source", "file"),
        }
        with _LOCK:
            cs = load(root)
            cs.append(c)
            save(root, cs)
        self.store.log_comment(root, c["id"], "create", c)
        return c

    def update(self, root: str, cid: str, body: dict) -> dict:
        with _LOCK:
            cs = load(root)
            for c in cs:
                if c["id"] == cid:
                    for k in ("status", "reply", "text", "line", "endLine"):
                        if k in body:
                            c[k] = body[k]
                    if body.get("status") == "resolved":
                        c["resolvedAt"] = time.time()
                    save(root, cs)
                    self.store.log_comment(root, cid, "update", body)
                    return c
        raise NotFound(cid)

    def update_anywhere(self, cid: str, body: dict) -> dict:
        """The mod's review_resolve: the comment is in one of the projects ever opened."""
        for root in self.store.recent():
            if any(c["id"] == cid for c in load(root)):
                return self.update(root, cid, body)
        raise NotFound(cid)

    def delete(self, root: str, cid: str) -> None:
        with _LOCK:
            save(root, [c for c in load(root) if c["id"] != cid])
        self.store.log_comment(root, cid, "delete", {})

    def open_in(self, ws: str | None) -> list[dict]:
        out = []
        for info in self.store.list(ws):
            for c in load(info["path"]):
                if c.get("status") == "open":
                    out.append({**c, "project": info["name"], "projectId": info["id"], "root": info["path"]})
        return out
