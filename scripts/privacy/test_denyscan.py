"""Tests for scripts/privacy/denyscan.py.

Builds throwaway git repositories as fixtures (never this repository) with a planted
denylist file living OUTSIDE the repo, and checks staged/tree/dir scanning, both text
encodings, PNG text chunks, renames, deletions and the --optional/env-var behaviour.
Run with:

    python3 -m unittest scripts.privacy.test_denyscan -v
"""
from __future__ import annotations

import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
DENYSCAN_PY = THIS_DIR / "denyscan.py"

GIT_ENV = {
    "GIT_AUTHOR_NAME": "Fixture", "GIT_AUTHOR_EMAIL": "fixture@example.com",
    "GIT_COMMITTER_NAME": "Fixture", "GIT_COMMITTER_EMAIL": "fixture@example.com",
    "PATH": os.environ.get("PATH", "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin"),
    "HOME": str(Path.home()),
}


def run_git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, env=GIT_ENV)


def make_png(text_chunk: bytes | None) -> bytes:
    def chunk(ctype: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + ctype + data + struct.pack(">I", zlib.crc32(ctype + data) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = b"\x00\xff\x00\x00"
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    body = sig + ihdr + idat
    if text_chunk is not None:
        body += chunk(b"tEXt", text_chunk)
    return body + iend


class DenyscanTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="denyscan-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        run_git(["init", "-q", "-b", "main"], cwd=self.repo)
        self.deny_file = self.tmp / "deny.txt"
        self.deny_file.write_text("SECRETPERSON\n10\\.192\\.\n", encoding="utf-8")

    def write(self, rel: str, content) -> None:
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, str):
            content = content.encode("utf-8")
        path.write_bytes(content)

    def commit(self, message: str = "init") -> None:
        run_git(["add", "-A"], cwd=self.repo)
        run_git(["commit", "-q", "-m", message], cwd=self.repo, )

    def stage(self) -> None:
        run_git(["add", "-A"], cwd=self.repo)

    def run_denyscan(self, *extra_args: str, env_overrides: dict | None = None) -> subprocess.CompletedProcess:
        env = {**os.environ, "AIMLOOM_DENYLIST": str(self.deny_file)}
        if env_overrides:
            env.update(env_overrides)
        return subprocess.run(
            [sys.executable, str(DENYSCAN_PY), *extra_args],
            cwd=self.repo, capture_output=True, text=True, env=env,
        )

    # --- staged mode ---

    def test_staged_text_hit_fails(self) -> None:
        self.write("a.txt", "hello\n")
        self.commit()
        self.write("b.txt", "contact SECRETPERSON please\n")
        self.stage()
        result = self.run_denyscan("--staged")
        self.assertEqual(result.returncode, 1)
        self.assertIn("b.txt: rule 1", result.stdout)
        self.assertNotIn("SECRETPERSON", result.stdout)
        self.assertNotIn("SECRETPERSON", result.stderr)

    def test_staged_clean_passes(self) -> None:
        self.write("a.txt", "hello\n")
        self.stage()
        result = self.run_denyscan("--staged")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_staged_utf16le_hit_fails(self) -> None:
        self.write("a.txt", "hello\n")
        self.commit()
        self.write("leak.bin", "SECRETPERSON".encode("utf-16-le"))
        self.stage()
        result = self.run_denyscan("--staged")
        self.assertEqual(result.returncode, 1)
        self.assertIn("leak.bin: rule 1", result.stdout)

    def test_staged_png_text_chunk_hit_fails(self) -> None:
        self.write("a.txt", "hello\n")
        self.commit()
        self.write("img.png", make_png(b"Comment\x00SECRETPERSON"))
        self.stage()
        result = self.run_denyscan("--staged")
        self.assertEqual(result.returncode, 1)
        self.assertIn("img.png: rule 1", result.stdout)

    def test_staged_filename_hit_fails(self) -> None:
        self.write("a.txt", "hello\n")
        self.commit()
        self.write("SECRETPERSON-notes.txt", "nothing bad in here\n")
        self.stage()
        result = self.run_denyscan("--staged")
        self.assertEqual(result.returncode, 1)
        self.assertIn("SECRETPERSON-notes.txt: rule 1", result.stdout)

    def test_staged_rename_is_scanned_under_new_name(self) -> None:
        self.write("old-name.txt", "contact SECRETPERSON please, padded so git detects a rename not add/delete " * 3)
        self.commit()
        run_git(["mv", "old-name.txt", "new-name.txt"], cwd=self.repo)
        result = self.run_denyscan("--staged")
        self.assertEqual(result.returncode, 1)
        self.assertIn("new-name.txt: rule 1", result.stdout)
        self.assertNotIn("old-name.txt", result.stdout)

    def test_staged_deleted_file_is_ignored(self) -> None:
        self.write("gone.txt", "contact SECRETPERSON please\n")
        self.commit()
        (self.repo / "gone.txt").unlink()
        run_git(["add", "-A"], cwd=self.repo)
        result = self.run_denyscan("--staged")
        self.assertEqual(result.returncode, 0, result.stderr)

    # --- tree mode ---

    def test_tree_mode_scans_head(self) -> None:
        self.write("a.txt", "hello\n")
        self.write("b.txt", "contact SECRETPERSON please\n")
        self.commit()
        result = self.run_denyscan("--tree")
        self.assertEqual(result.returncode, 1)
        self.assertIn("b.txt: rule 1", result.stdout)

    # --- optional / missing denylist ---

    def test_optional_with_missing_denylist_passes(self) -> None:
        self.write("a.txt", "hello\n")
        self.stage()
        result = self.run_denyscan("--staged", "--optional", env_overrides={"AIMLOOM_DENYLIST": str(self.tmp / "nope.txt")})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("denylist not found", result.stdout)

    def test_without_optional_missing_denylist_fails_with_2(self) -> None:
        self.write("a.txt", "hello\n")
        self.stage()
        result = self.run_denyscan("--staged", env_overrides={"AIMLOOM_DENYLIST": str(self.tmp / "nope.txt")})
        self.assertEqual(result.returncode, 2)

    # --- env-var denylist ---

    # --- exempt paths ---

    def test_exempt_path_is_skipped(self) -> None:
        self.write("a.txt", "hello\n")
        self.commit()
        self.write("config/real-values.json", "contact SECRETPERSON please\n")
        self.stage()
        exempt_file = self.tmp / "exempt.txt"
        exempt_file.write_text("config/**\n", encoding="utf-8")
        result = self.run_denyscan("--staged", "--exempt", str(exempt_file))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_exempt_path_does_not_hide_other_files(self) -> None:
        self.write("a.txt", "hello\n")
        self.commit()
        self.write("config/real-values.json", "contact SECRETPERSON please\n")
        self.write("other/leak.txt", "contact SECRETPERSON please too\n")
        self.stage()
        exempt_file = self.tmp / "exempt.txt"
        exempt_file.write_text("config/**\n", encoding="utf-8")
        result = self.run_denyscan("--staged", "--exempt", str(exempt_file))
        self.assertEqual(result.returncode, 1)
        self.assertIn("other/leak.txt: rule 1", result.stdout)
        self.assertNotIn("config/real-values.json", result.stdout)

    def test_denylist_env_var_works(self) -> None:
        self.write("a.txt", "hello\n")
        self.commit()
        self.write("b.txt", "contact ENVSECRET please\n")
        self.stage()
        result = self.run_denyscan(
            "--staged", "--denylist-env", "MY_DENYLIST",
            env_overrides={"MY_DENYLIST": "ENVSECRET\n"},
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("b.txt: rule 1", result.stdout)
        self.assertNotIn("ENVSECRET", result.stdout)


if __name__ == "__main__":
    unittest.main()
