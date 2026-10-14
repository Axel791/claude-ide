"""Git as the editor shows it: status per file, a file's diff, branches and checkout."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess

from .errors import BadRequest


def is_repo(root: str) -> bool:
    return os.path.isdir(os.path.join(root, ".git"))


def run(root: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", root, *args], capture_output=True, text=True)


def out(root: str, *args: str) -> str:
    return run(root, *args).stdout


def ignored(root: str, rels: list[str]) -> set[str]:
    """Which of the relative paths .gitignore hides."""
    if not rels or not is_repo(root):
        return set()
    r = subprocess.run(["git", "-C", root, "check-ignore", "--stdin"], input="\n".join(rels), capture_output=True, text=True)
    return set(r.stdout.splitlines())


def tracked_files(root: str) -> list[str]:
    return [f for f in out(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0") if f]


def status(root: str) -> list[dict]:
    if not is_repo(root):
        return []
    parts = out(root, "status", "--porcelain=v1", "-z", "--untracked-files=all").split("\0")
    items, i = [], 0
    while i < len(parts):
        p = parts[i]
        i += 1
        if len(p) < 4:
            continue
        code, path = p[:2], p[3:]
        if code[0] in "RC":  # renamed: the next entry is the old path
            i += 1
        items.append({"path": path, "status": code.strip() or "M"})
    return items


def status_hash(root: str) -> str:
    head = out(root, "rev-parse", "--abbrev-ref", "HEAD") if is_repo(root) else ""
    return hashlib.md5((head + json.dumps(status(root))).encode()).hexdigest()


def diff(root: str, rel: str) -> str:
    if not is_repo(root):
        return ""
    tracked = run(root, "ls-files", "--error-unmatch", "--", rel).returncode == 0
    if tracked:
        return out(root, "diff", "HEAD", "--", rel)
    return run(root, "diff", "--no-index", "--", "/dev/null", rel).stdout


def branches(root: str) -> dict:
    if not is_repo(root):
        return {"current": None, "branches": [], "dirty": False, "ahead": 0, "behind": 0}
    current = out(root, "rev-parse", "--abbrev-ref", "HEAD").strip() or None
    listed = []
    for line in out(root, "for-each-ref", "--sort=-committerdate", "--format=%(refname:short)\t%(committerdate:relative)", "refs/heads/").splitlines():
        name, _, when = line.partition("\t")
        if name:
            listed.append({"name": name, "when": when})
    ahead = behind = 0
    ab = out(root, "rev-list", "--left-right", "--count", "HEAD...@{upstream}").split()
    if len(ab) == 2:
        ahead, behind = int(ab[0]), int(ab[1])
    return {"current": current, "branches": listed, "dirty": bool(status(root)), "ahead": ahead, "behind": behind}


def checkout(root: str, branch: str) -> dict:
    if not is_repo(root):
        raise BadRequest("not a git repository")
    if not branch or branch.startswith("-"):
        raise BadRequest("bad branch name")
    r = run(root, "checkout", branch)
    if r.returncode != 0:
        text = (r.stderr or r.stdout).strip()
        raise BadRequest(text.splitlines()[-1] if text else "checkout failed")
    return branches(root)
