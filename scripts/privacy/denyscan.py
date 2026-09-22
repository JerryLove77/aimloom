#!/usr/bin/env python3
"""denyscan.py -- the one identifier scanner for this repository.

Scans a set of files (staged content, the tracked tree at HEAD, or a plain directory) and
their paths against a denylist of case-insensitive regexes, one per line. A hit prints only
the file path and the rule's line number -- never the matched text -- and the scan exits 1.

The denylist itself lives OUTSIDE any repository, by design: `~/.config/aimloom/deny.txt`
(or the path in $AIMLOOM_DENYLIST), or via --denylist-env for a CI secret. Never print, log
or commit its contents.

Usage:
    denyscan.py --staged [--optional] [--denylist PATH | --denylist-env VAR]
    denyscan.py --tree   [--optional] [--denylist PATH | --denylist-env VAR]
    denyscan.py --dir DIR [--optional] [--denylist PATH | --denylist-env VAR]

Exit codes:
    0   clean (or denylist missing and --optional was given)
    1   a rule matched
    2   denylist missing and --optional was not given (or no mode / bad usage)
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_DENYLIST_ENV = "AIMLOOM_DENYLIST"
DEFAULT_DENYLIST_PATH = Path.home() / ".config" / "aimloom" / "deny.txt"


# --------------------------------------------------------------------------------------
# exempt paths -- files that legitimately, permanently hold a value that also appears on
# the denylist (an operational id substituted only at export time, or a path already
# excluded from every export by scripts/public/allow.txt) and would otherwise block every
# future commit that touches them. See scripts/privacy/scan-exempt.txt for the actual list
# and why each entry is there. --dir scans (reviewing arbitrary/export output) never take
# an exempt list: nothing there should be exempt.
# --------------------------------------------------------------------------------------

def _exempt_glob_to_regex(pattern: str) -> "re.Pattern[str]":
    i, n = 0, len(pattern)
    out = ["^"]
    while i < n:
        c = pattern[i]
        if pattern[i : i + 3] == "**/":
            out.append("(?:.*/)?")
            i += 3
            continue
        if pattern[i : i + 2] == "**":
            out.append(".*")
            i += 2
            continue
        if c == "*":
            out.append("[^/]*")
            i += 1
            continue
        out.append(re.escape(c))
        i += 1
    out.append("$")
    return re.compile("".join(out))


def load_exempt_patterns(path: Path) -> list["re.Pattern[str]"]:
    patterns: list[re.Pattern[str]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        patterns.append(_exempt_glob_to_regex(line))
    return patterns


def is_exempt(rel_path: str, patterns: list["re.Pattern[str]"]) -> bool:
    return any(p.match(rel_path) for p in patterns)


class DenyHit(RuntimeError):
    def __init__(self, path: str, line_no: int):
        super().__init__(f"{path}: rule {line_no}")
        self.path = path
        self.line_no = line_no


def compile_rules(text: str) -> list[tuple[int, "re.Pattern[bytes]"]]:
    rules: list[tuple[int, re.Pattern[bytes]]] = []
    line_no = 0
    for raw_line in text.splitlines():
        line_no += 1
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        rules.append((line_no, re.compile(line.encode("utf-8"), re.IGNORECASE)))
    return rules


def load_rules_from_file(path: Path) -> list[tuple[int, "re.Pattern[bytes]"]]:
    return compile_rules(path.read_text(encoding="utf-8"))


def load_rules_from_env(var: str) -> list[tuple[int, "re.Pattern[bytes]"]]:
    value = os.environ.get(var, "")
    return compile_rules(value)


# --------------------------------------------------------------------------------------
# scanning
# --------------------------------------------------------------------------------------

def content_views(content: bytes) -> list[bytes]:
    """UTF-8/Latin-1 byte view plus a UTF-16LE-decoded view, so a hidden UTF-16 identifier
    is caught the same as a plain one. Regexes are ASCII-safe and match raw bytes directly,
    which already covers a UTF-8 (and therefore Latin-1-superset-safe) view."""
    views = [content]
    try:
        views.append(content.decode("utf-16-le", errors="ignore").encode("utf-8"))
    except Exception:
        pass
    return views


def scan_one(rel_path: str, content: bytes, rules: list[tuple[int, "re.Pattern[bytes]"]]) -> None:
    path_bytes = rel_path.encode("utf-8")
    for line_no, rule in rules:
        if rule.search(path_bytes):
            raise DenyHit(rel_path, line_no)
    for view in content_views(content):
        for line_no, rule in rules:
            if rule.search(view):
                raise DenyHit(rel_path, line_no)


def scan_files(files: dict[str, bytes], rules: list[tuple[int, "re.Pattern[bytes]"]]) -> list[DenyHit]:
    hits: list[DenyHit] = []
    for rel_path, content in files.items():
        try:
            scan_one(rel_path, content, rules)
        except DenyHit as hit:
            hits.append(hit)
    return hits


# --------------------------------------------------------------------------------------
# file collection
# --------------------------------------------------------------------------------------

def run_git(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], check=True, capture_output=True)


def collect_staged() -> dict[str, bytes]:
    """Every staged file's full staged content, by its staged path -- including renames.
    Deleted files are skipped (there is nothing staged to scan)."""
    proc = run_git(["diff", "--cached", "--name-status", "-z"])
    raw = proc.stdout.decode("utf-8", errors="replace")
    parts = [p for p in raw.split("\0") if p != ""]
    files: dict[str, bytes] = {}
    i = 0
    while i < len(parts):
        status = parts[i]
        i += 1
        if status.startswith("R") or status.startswith("C"):
            # rename/copy: old path, new path
            _old_path = parts[i]
            i += 1
            new_path = parts[i]
            i += 1
            path = new_path
        else:
            path = parts[i]
            i += 1
        if status.startswith("D"):
            continue
        content = subprocess.run(
            ["git", "show", f":{path}"], check=True, capture_output=True,
        ).stdout
        files[path] = content
    return files


def collect_tree() -> dict[str, bytes]:
    """Every file of `git ls-files` at HEAD, content via `git show HEAD:path`."""
    proc = run_git(["ls-files", "-z"])
    raw = proc.stdout.decode("utf-8", errors="replace")
    paths = [p for p in raw.split("\0") if p != ""]
    files: dict[str, bytes] = {}
    for path in paths:
        content = subprocess.run(
            ["git", "show", f"HEAD:{path}"], check=True, capture_output=True,
        ).stdout
        files[path] = content
    return files


def collect_dir(dir_path: Path) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for p in sorted(dir_path.rglob("*")):
        if p.is_file():
            rel = str(p.relative_to(dir_path)).replace("\\", "/")
            files[rel] = p.read_bytes()
    return files


# --------------------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------------------

def load_rules(args: argparse.Namespace) -> list[tuple[int, "re.Pattern[bytes]"]] | None:
    """Returns None if the denylist source was absent and that is acceptable (--optional)."""
    if args.denylist_env:
        return load_rules_from_env(args.denylist_env)

    denylist_path = Path(args.denylist) if args.denylist else None
    if denylist_path is None:
        env_path = os.environ.get(DEFAULT_DENYLIST_ENV)
        denylist_path = Path(env_path) if env_path else DEFAULT_DENYLIST_PATH

    if not denylist_path.is_file():
        if args.optional:
            print("denylist not found; skipping identifier scan")
            return None
        print(f"denylist not found at {denylist_path}", file=sys.stderr)
        sys.exit(2)

    return load_rules_from_file(denylist_path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--staged", action="store_true", help="scan staged files (full staged content)")
    mode.add_argument("--tree", action="store_true", help="scan every tracked file at HEAD")
    mode.add_argument("--dir", metavar="DIR", help="scan every file under DIR")
    parser.add_argument("--denylist", help=f"denylist file path (default: ${DEFAULT_DENYLIST_ENV} or {DEFAULT_DENYLIST_PATH})")
    parser.add_argument("--denylist-env", help="read denylist rules from this environment variable instead of a file")
    parser.add_argument("--optional", action="store_true", help="exit 0 (not 2) when the denylist file is missing")
    parser.add_argument(
        "--exempt", metavar="PATH",
        help="a file of path globs (one per line, '#' comments) to skip in --staged/--tree mode; "
        "ignored with --dir",
    )
    args = parser.parse_args()

    rules = load_rules(args)
    if rules is None:
        return 0

    if args.staged:
        files = collect_staged()
    elif args.tree:
        files = collect_tree()
    else:
        dir_path = Path(args.dir)
        if not dir_path.is_dir():
            print(f"--dir {dir_path} is not a directory", file=sys.stderr)
            return 2
        files = collect_dir(dir_path)

    if args.exempt and not args.dir:
        exempt_path = Path(args.exempt)
        if exempt_path.is_file():
            patterns = load_exempt_patterns(exempt_path)
            files = {p: c for p, c in files.items() if not is_exempt(p, patterns)}

    hits = scan_files(files, rules)
    if hits:
        for hit in hits:
            print(f"{hit.path}: rule {hit.line_no}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
