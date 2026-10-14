"""Unit tests for the server package: run with `python3 -m unittest discover -s server/tests` from the repo."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ide import comments as review, files, git  # noqa: E402
from ide.comments import Comments  # noqa: E402
from ide.errors import BadRequest, Conflict, NotFound  # noqa: E402
from ide.store import Store, project_id  # noqa: E402


class Temp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self.tmp.name)
        self.store = Store(Path(self.root) / "ide.db", Path(self.root) / "nope.json")

    def tearDown(self):
        self.tmp.cleanup()

    def project(self, name="proj", git_init=False) -> str:
        p = os.path.join(self.root, name)
        os.makedirs(os.path.join(p, "src"))
        Path(p, "src", "a.py").write_text("print(1)\n")
        Path(p, ".env").write_text("SECRET=1\n")
        if git_init:
            subprocess.run(["git", "init", "-q", "-b", "main", p], check=True)
            subprocess.run(["git", "-C", p, "-c", "user.email=t@t", "-c", "user.name=t", "add", "."], check=True)
            subprocess.run(["git", "-C", p, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], check=True)
        return p


class StoreTests(Temp):
    def test_workspaces_are_separate_and_seeded(self):
        a, b = self.project("a"), self.project("b")
        self.assertEqual([p["name"] for p in self.store.list("sess-1", seed=a)], ["a"])
        self.store.add(b, "sess-1")
        self.assertEqual([p["name"] for p in self.store.list("sess-1")], ["a", "b"])
        self.assertEqual([p["name"] for p in self.store.list("sess-2", seed=b)], ["b"])
        self.store.remove(project_id(a), "sess-1")
        self.assertEqual([p["name"] for p in self.store.list("sess-1")], ["b"])
        self.assertEqual(set(self.store.recent()), {a, b})

    def test_folder_keys_still_work(self):
        a = self.project("a")
        self.assertEqual(self.store.ws_key(a), a)
        self.assertEqual([p["path"] for p in self.store.list(a)], [a])

    def test_state_focus_inbox(self):
        self.store.set_state("s", {"tabs": [1]})
        self.assertEqual(self.store.get_state("s"), {"tabs": [1]})
        self.assertEqual(self.store.get_state("other"), {})
        self.store.set_focus("s", {"path": "/x"})
        self.assertEqual(self.store.get_focus("s")["path"], "/x")
        self.store.push_inbox("s", {"open": 1})
        self.assertEqual(self.store.pop_inbox("s"), [{"open": 1}])
        self.assertEqual(self.store.pop_inbox("s"), [])

    def test_bad_project(self):
        with self.assertRaises(BadRequest):
            self.store.add("/definitely/not/here")
        with self.assertRaises(NotFound):
            self.store.root("nope")


class FilesTests(Temp):
    def test_tree_hides_secrets_and_escapes(self):
        p = self.project()
        names = [e["name"] for e in files.list_dir(p, "")]
        self.assertIn("src", names)
        self.assertNotIn(".env", names)
        with self.assertRaises(BadRequest):
            files.safe_path(p, "../outside")
        with self.assertRaises(BadRequest):
            files.read(p, ".env")

    def test_read_write_conflict(self):
        p = self.project()
        f = files.read(p, "src/a.py")
        self.assertEqual(f["content"], "print(1)\n")
        w = files.write(p, "src/a.py", "print(2)\n", f["mtime"])
        self.assertEqual(files.read(p, "src/a.py")["content"], "print(2)\n")
        with self.assertRaises(Conflict):
            files.write(p, "src/a.py", "print(3)\n", f["mtime"] - 10)
        files.write(p, "src/a.py", "print(3)\n", w["mtime"])

    def test_browse(self):
        p = self.project()
        b = files.browse(self.root, {p})
        self.assertEqual([d["name"] for d in b["dirs"]], ["proj"])
        self.assertTrue(b["dirs"][0]["project"] is False)
        self.assertIn(p, b["recent"])


class GitTests(Temp):
    def test_status_branches_diff(self):
        p = self.project(git_init=True)
        self.assertEqual(git.status(p), [])
        Path(p, "src", "a.py").write_text("print(2)\n")
        self.assertEqual(git.status(p), [{"path": "src/a.py", "status": "M"}])
        self.assertIn("-print(1)", git.diff(p, "src/a.py"))
        b = git.branches(p)
        self.assertEqual(b["current"], "main")
        self.assertTrue(b["dirty"])
        with self.assertRaises(BadRequest):
            git.checkout(p, "nope")
        with self.assertRaises(BadRequest):
            git.checkout(p, "-x")

    def test_no_repo(self):
        p = self.project()
        self.assertEqual(git.status(p), [])
        self.assertEqual(git.branches(p)["current"], None)


class CommentsTests(Temp):
    def test_lifecycle_and_open_in_workspace(self):
        p = self.project()
        self.store.add(p, "s")
        cs = Comments(self.store)
        c = cs.create(p, {"path": "src/a.py", "line": 1, "text": "почему?", "snippet": "print(1)"})
        self.assertEqual(c["status"], "open")
        self.assertEqual([x["id"] for x in cs.open_in("s")], [c["id"]])
        self.assertEqual(cs.open_in("other"), [])
        done = cs.update_anywhere(c["id"], {"status": "resolved", "reply": "ок"})
        self.assertEqual(done["reply"], "ок")
        self.assertIn("resolvedAt", done)
        self.assertEqual(cs.open_in("s"), [])
        with self.assertRaises(NotFound):
            cs.update(p, "nope", {})
        cs.delete(p, c["id"])
        self.assertEqual(review.load(p), [])
        events = [e["event"] for e in self.store.comment_history(p)]
        self.assertEqual(events, ["delete", "update", "create"])
        self.assertEqual(json.loads(Path(p, ".claude", "review.json").read_text()), {"comments": []})

    def test_gitignore_line(self):
        p = self.project()
        review.ensure_gitignore(p)
        review.ensure_gitignore(p)
        self.assertEqual(Path(p, ".gitignore").read_text().count(".claude/review.json"), 1)


if __name__ == "__main__":
    unittest.main()
