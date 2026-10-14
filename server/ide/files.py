"""The project tree and file contents, never outside the project root, never a secret."""
from __future__ import annotations

import os
from pathlib import Path

from . import config, git
from .errors import BadRequest, Conflict


def safe_path(root: str, rel: str) -> str:
    """The absolute path of `rel` inside `root`, or BadRequest."""
    rel = rel.lstrip("/")
    full = os.path.realpath(os.path.join(root, rel))
    if full != root and not full.startswith(root + os.sep):
        raise BadRequest("path escapes project root")
    if config.SECRET_RE.search(rel):
        raise BadRequest("file is protected")
    return full


def list_dir(root: str, rel: str) -> list[dict]:
    full = safe_path(root, rel) if rel else root
    try:
        names = sorted(os.listdir(full), key=str.lower)
    except OSError:
        return []
    rels = [os.path.join(rel, n) if rel else n for n in names]
    hidden = git.ignored(root, rels)
    entries = []
    for name, r in zip(names, rels):
        if name in config.EXCLUDED_DIRS or r in hidden or config.SECRET_RE.search(r):
            continue
        p = os.path.join(full, name)
        if os.path.islink(p) and not os.path.realpath(p).startswith(root):
            continue
        entries.append({"name": name, "path": r, "type": "dir" if os.path.isdir(p) else "file"})
    entries.sort(key=lambda e: (e["type"] != "dir", e["name"].lower()))
    return entries


def all_files(root: str) -> list[str]:
    """Every file for the fuzzy finder: git's list in a repo, a walk elsewhere."""
    if git.is_repo(root):
        files = [f for f in git.tracked_files(root) if not config.SECRET_RE.search(f) and not any(part in config.EXCLUDED_DIRS for part in f.split("/"))]
        return files[: config.MAX_FILE_LIST]
    files: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in config.EXCLUDED_DIRS]
        for fn in filenames:
            r = os.path.relpath(os.path.join(dirpath, fn), root)
            if not config.SECRET_RE.search(r):
                files.append(r)
            if len(files) >= config.MAX_FILE_LIST:
                return files
    return files


def read(root: str, rel: str) -> dict:
    full = safe_path(root, rel)
    st = os.stat(full)
    if st.st_size > config.MAX_FILE_BYTES:
        raise BadRequest("file too large")
    data = Path(full).read_bytes()
    if b"\0" in data[:8000]:
        return {"path": rel, "binary": True, "size": st.st_size, "mtime": st.st_mtime}
    return {"path": rel, "content": data.decode("utf-8", "replace"), "size": st.st_size, "mtime": st.st_mtime}


def write(root: str, rel: str, content: str, expect_mtime: float | None) -> dict:
    full = safe_path(root, rel)
    if expect_mtime is not None and os.path.exists(full) and abs(os.stat(full).st_mtime - expect_mtime) > 1e-6:
        raise Conflict("file changed on disk")
    os.makedirs(os.path.dirname(full), exist_ok=True)
    Path(full).write_text(content, encoding="utf-8")
    return {"path": rel, "mtime": os.stat(full).st_mtime}


def mtime(root: str, rel: str) -> float | None:
    try:
        return os.stat(safe_path(root, rel)).st_mtime
    except (OSError, BadRequest):
        return None


def browse(path: str, known: set[str]) -> dict:
    """Folders under `path` for the project picker; hidden and noisy ones left out."""
    real = os.path.realpath(os.path.expanduser(path))
    if not os.path.isdir(real):
        raise BadRequest(f"not a directory: {path}")
    dirs = []
    try:
        for name in sorted(os.listdir(real), key=str.lower):
            if name.startswith(".") or name in config.EXCLUDED_DIRS:
                continue
            full = os.path.join(real, name)
            if os.path.isdir(full) and not os.path.islink(full):
                is_git = os.path.isdir(os.path.join(full, ".git"))
                is_project = is_git or any(os.path.exists(os.path.join(full, m)) for m in ("pyproject.toml", "package.json"))
                dirs.append({"name": name, "path": full, "git": is_git, "project": is_project})
    except PermissionError:
        pass
    return {
        "path": real, "parent": os.path.dirname(real) if real != "/" else None, "home": str(Path.home()),
        "dirs": dirs, "quick": sorted({os.path.dirname(p) for p in known}), "recent": sorted(known),
        "isGit": os.path.isdir(os.path.join(real, ".git")), "open": real in known,
    }
