"""The router: one handler class, a table of routes, JSON in and out. No logic of its own."""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import comments as review, config, files, git
from .comments import Comments
from .errors import BadRequest, Conflict, NotFound
from .store import Store


class Services:
    """What the routes reach: built once by app.py, shared by every request."""

    def __init__(self, store: Store, comments: Comments) -> None:
        self.store = store
        self.comments = comments


def make_handler(services: Services) -> type[BaseHTTPRequestHandler]:
    store, comments = services.store, services.comments

    class Handler(BaseHTTPRequestHandler):
        server_version = "claude-ide/0.2"

        def log_message(self, fmt, *args):
            if "--verbose" in sys.argv:
                super().log_message(fmt, *args)

        # ---------------------------------------------------------- replies
        def send_json(self, obj, status=200) -> None:
            self.send_bytes(json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8", status)

        def send_text(self, text: str, ctype="text/plain; charset=utf-8", status=200) -> None:
            self.send_bytes(text.encode(), ctype, status)

        def send_bytes(self, data: bytes, ctype: str, status=200, extra: dict | None = None) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

        def body(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}") if n else {}

        # ---------------------------------------------------------- dispatch
        def do_GET(self): self.route("GET")
        def do_POST(self): self.route("POST")
        def do_PUT(self): self.route("PUT")
        def do_PATCH(self): self.route("PATCH")
        def do_DELETE(self): self.route("DELETE")

        def route(self, method: str) -> None:
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            try:
                if not self.dispatch(method, u.path, q):
                    self.send_json({"error": "no such route"}, 404)
            except NotFound as e:
                self.send_json({"error": f"not found: {e}"}, 404)
            except Conflict as e:
                self.send_json({"error": str(e)}, 409)
            except BadRequest as e:
                self.send_json({"error": str(e)}, 400)
            except FileNotFoundError:
                self.send_json({"error": "file not found"}, 404)
            except Exception as e:  # noqa: BLE001
                self.send_json({"error": f"{type(e).__name__}: {e}"}, 500)

        def dispatch(self, m: str, path: str, q: dict) -> bool:
            ws = q.get("ws") or None

            # ---- the page and its PWA files
            if m == "GET" and path in ("/", "/index.html"):
                self.send_text((config.HERE / "index.html").read_text(), "text/html; charset=utf-8")
                return True
            if m == "GET" and path in config.STATIC:
                name, ctype = config.STATIC[path]
                extra = {"Service-Worker-Allowed": "/"} if path == "/sw.js" else None
                self.send_bytes((config.HERE / name).read_bytes(), ctype, extra=extra)
                return True
            if m == "GET" and path == "/api/health":
                self.send_json({"ok": True, "pid": os.getpid()})
                return True

            # ---- workspace: projects, UI state, focus, inbox
            if path == "/api/projects" and m == "GET":
                self.send_json(store.list(ws, q.get("seed") or None)); return True
            if path == "/api/projects" and m == "POST":
                info = store.add(self.body()["path"], ws)
                review.ensure_gitignore(info["path"])
                self.send_json(info); return True
            if path.startswith("/api/projects/") and m == "DELETE":
                store.remove(path.rsplit("/", 1)[1], ws)
                self.send_json({"ok": True}); return True
            if path == "/api/state":
                if m == "GET": self.send_json(store.get_state(ws)); return True
                if m == "PUT": store.set_state(ws, self.body()); self.send_json({"ok": True}); return True
            if path == "/api/focus":
                if m == "GET": self.send_json(store.get_focus(ws)); return True
                if m == "PUT": store.set_focus(ws, self.body()); self.send_json({"ok": True}); return True
            if path == "/api/inbox":
                if m == "GET": self.send_json(store.pop_inbox(ws)); return True
                if m == "POST": store.push_inbox(ws, self.body()); self.send_json({"ok": True}); return True
            if m == "GET" and path == "/api/history":
                self.send_json(store.comment_history(q.get("root") or None)); return True
            if m == "GET" and path == "/api/browse":
                self.send_json(files.browse(q.get("path") or os.path.expanduser("~"), set(store.recent()))); return True

            # ---- comments across the workspace
            if m == "GET" and path == "/api/comments/open":
                self.send_json(comments.open_in(ws)); return True
            if m == "PATCH" and path.startswith("/api/comments/") and not q.get("p"):
                self.send_json(comments.update_anywhere(path.rsplit("/", 1)[1], self.body())); return True

            # ---- everything below needs a project
            root = store.root(q.get("p", ""))
            if m == "GET" and path == "/api/tree":
                self.send_json(files.list_dir(root, q.get("dir", ""))); return True
            if m == "GET" and path == "/api/files":
                self.send_json(files.all_files(root)); return True
            if path == "/api/file":
                if m == "GET": self.send_json(files.read(root, q["path"])); return True
                if m == "PUT":
                    b = self.body()
                    self.send_json(files.write(root, q["path"], b["content"], b.get("mtime"))); return True
            if m == "GET" and path == "/api/status":
                self.send_json(git.status(root)); return True
            if m == "GET" and path == "/api/diff":
                self.send_text(git.diff(root, q["path"])); return True
            if m == "GET" and path == "/api/branches":
                self.send_json(git.branches(root)); return True
            if m == "POST" and path == "/api/checkout":
                self.send_json(git.checkout(root, self.body().get("branch", ""))); return True
            if m == "GET" and path == "/api/poll":
                out = {"commentsMtime": review.mtime(root), "statusHash": git.status_hash(root)}
                if q.get("path"):
                    out["fileMtime"] = files.mtime(root, q["path"])
                self.send_json(out); return True
            if path == "/api/comments":
                if m == "GET": self.send_json(review.load(root)); return True
                if m == "POST": self.send_json(comments.create(root, self.body())); return True
            if path.startswith("/api/comments/"):
                cid = path.rsplit("/", 1)[1]
                if m == "PATCH": self.send_json(comments.update(root, cid, self.body())); return True
                if m == "DELETE": comments.delete(root, cid); self.send_json({"ok": True}); return True
            return False

    return Handler


def serve(services: Services, host: str, port: int) -> ThreadingHTTPServer:
    srv = ThreadingHTTPServer((host, port), make_handler(services))
    srv.daemon_threads = True
    return srv
