"""Everything the server takes as given: where state lives, what it hides, how much it reads."""
from __future__ import annotations

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent          # server/
STATE_DIR = Path.home() / ".claude" / "claude-ide"
DB_FILE = STATE_DIR / "ide.db"
LEGACY_STATE_FILE = STATE_DIR / "projects.json"      # the first store, imported once

DEFAULT_PORT = 8030
BIND_HOST = "127.0.0.1"

EXCLUDED_DIRS = frozenset({
    ".git", ".venv", "venv", "node_modules", "__pycache__", ".mypy_cache",
    ".pytest_cache", ".ruff_cache", ".cache", "dist", "build", "staticfiles",
    ".idea", ".DS_Store", ".next", ".nuxt", "coverage", ".tox",
})
SECRET_RE = re.compile(r"(^|/)(\.env(\..*)?|.*\.pem|.*\.key)$")
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_FILE_LIST = 30_000
REVIEW_FILE = ".claude/review.json"

STATIC = {
    "/manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json"),
    "/sw.js": ("sw.js", "application/javascript"),
    "/icon.svg": ("icon.svg", "image/svg+xml"),
    "/icon-192.png": ("icon-192.png", "image/png"),
    "/icon-512.png": ("icon-512.png", "image/png"),
}
