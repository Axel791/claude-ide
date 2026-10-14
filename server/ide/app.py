"""Wiring and the entry point: build the store and the services, serve on localhost."""
from __future__ import annotations

import argparse

from . import config
from .comments import Comments, ensure_gitignore
from .http import Services, serve
from .store import Store


def build() -> Services:
    store = Store()
    return Services(store, Comments(store))


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="claude-ide: the local server behind the editor page")
    ap.add_argument("--port", type=int, default=config.DEFAULT_PORT)
    ap.add_argument("--root", action="append", default=[], help="a project to open in its own workspace")
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args(argv)
    services = build()
    for r in a.root:
        ensure_gitignore(services.store.add(r, r)["path"])
    srv = serve(services, config.BIND_HOST, a.port)
    print(f"claude-ide on http://{config.BIND_HOST}:{a.port}  projects={len(services.store.recent())}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
