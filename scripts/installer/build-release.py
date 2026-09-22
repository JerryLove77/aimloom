#!/usr/bin/env python3
"""Build a verified offline candidate; requires only Python's standard library."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import zipfile


VERSION = "0.1.0"
STATUS = "candidate-windows-acceptance-pending"
MANIFEST = "release-manifest.json"
PACK_NAME = "KVK Settings 2025"
HERE = Path(__file__).resolve().parent
ROOT_FILES = ("安装配置.cmd", "恢复配置.cmd", "使用说明.txt")
REQUIRED_SCRIPTS = ("kvk-config.ps1", "kvk-engine.ps1")
ASSET_EXTENSIONS = {"Themes": {".json"}, "sounds": {".ogg", ".wav"},
                    "crosshairs": {".png"}}
SETTINGS = {"PrimaryUserSettings.json", "UI.json", "Palette.ini"}


def safe_path(name):
    """Require portable relative names before using any persisted path."""
    if not isinstance(name, str) or not name:
        raise ValueError("Unsafe empty or non-string path")
    parts = name.split("/")
    for part in parts:
        if (part in ("", ".", "..") or part.endswith((".", " "))
                or any(ord(c) < 32 or c in '<>:"\\|?*' for c in part)
                or re.match(r"^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)",
                            part, re.IGNORECASE)):
            raise ValueError("Unsafe path: " + name)
    return name


def no_link(path):
    info = path.lstat()
    if (stat.S_ISLNK(info.st_mode)
            or getattr(info, "st_file_attributes", 0) & 0x400
            or (stat.S_ISREG(info.st_mode) and info.st_nlink > 1)):
        raise ValueError("Link/reparse point is not permitted: " + str(path))
    if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
        raise ValueError("Not a regular file or directory: " + str(path))


def validate_tree(root):
    if not root.is_dir():
        raise ValueError("Missing source directory: " + str(root))
    no_link(root)
    names = {}
    for parent, directories, files in os.walk(root, followlinks=False):
        for name in directories + files:
            path = Path(parent) / name
            no_link(path)
            relative = path.relative_to(root).as_posix()
            safe_path(relative)
            key = relative.casefold()
            if key in names:
                raise ValueError("Case collision: " + relative + " / " + names[key])
            names[key] = relative


def is_asset(name):
    parts = name.split("/")
    return (name in SETTINGS or (len(parts) == 2 and parts[0] in ASSET_EXTENSIONS
                                and any(parts[1].lower().endswith(extension)
                                        for extension in ASSET_EXTENSIONS[parts[0]])))


def read_entries(document):
    if (not isinstance(document, dict) or document.get("schemaVersion") != 1
            or document.get("version") != VERSION or not isinstance(document.get("files"), list)
            or not document["files"]):
        raise ValueError("Invalid or empty inventory/manifest")
    result = {}
    keys = set()
    for entry in document["files"]:
        if not isinstance(entry, dict):
            raise ValueError("Invalid inventory entry")
        name = safe_path(entry.get("path"))
        if name.casefold() in keys:
            raise ValueError("Duplicate/case collision in inventory: " + name)
        keys.add(name.casefold())
        if (not isinstance(entry.get("sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"])
                or type(entry.get("size")) is not int or entry["size"] < 0):
            raise ValueError("Invalid size or SHA-256: " + name)
        result[name] = entry
    return result


def check_bytes(name, data, entry):
    if len(data) != entry["size"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
        raise ValueError("Size/SHA-256 mismatch: " + name)


def verify_archive(path):
    """Read back every ZIP member and reject missing, extra or altered bytes."""
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(name.casefold() for name in names)):
            raise ValueError("Duplicate/case collision in archive")
        for name in names:
            safe_path(name)
        if MANIFEST not in names:
            raise ValueError("Missing release manifest")
        document = json.loads(archive.read(MANIFEST).decode("utf-8"))
        entries = read_entries(document)
        if document.get("status") != STATUS:
            raise ValueError("Invalid candidate status")
        if set(names) != set(entries) | {MANIFEST} or MANIFEST in entries:
            raise ValueError("Archive inventory mismatch")
        for name, entry in entries.items():
            check_bytes(name, archive.read(name), entry)
    return document


def validate_output(output, pack, runtime, inventory):
    if output.is_symlink():
        raise ValueError("Output link is not permitted: " + str(output))
    resolved = output.resolve()
    for source_dir in (pack.resolve(), runtime.resolve()):
        # resolve() follows links but does not canonicalize capitalization on
        # case-insensitive POSIX volumes. Compare existing ancestor identities
        # as well: even a not-yet-created destination has an existing ancestor
        # that identifies the protected source directory through case aliases.
        aliases_source = source_dir.exists() and any(
            ancestor.exists() and os.path.samefile(ancestor, source_dir)
            for ancestor in (resolved,) + tuple(resolved.parents)
        )
        if resolved == source_dir or source_dir in resolved.parents or aliases_source:
            raise ValueError("Output must be outside source directories: " + str(output))
    for source_file in (inventory.resolve(), Path(__file__).resolve()):
        if resolved == source_file or (output.exists() and os.path.samefile(output, source_file)):
            raise ValueError("Output cannot overwrite source input: " + str(output))
    if output.exists():
        no_link(output)
        if not output.is_file():
            raise ValueError("Output is not a regular file: " + str(output))


def build_release(pack, runtime, inventory, output):
    validate_output(output, pack, runtime, inventory)
    validate_tree(pack)
    validate_tree(runtime)
    no_link(inventory)
    entries = read_entries(json.loads(inventory.read_text(encoding="utf-8-sig")))
    for name in entries:
        if not is_asset(name):
            raise ValueError("Inventory contains non-distributable asset: " + name)
    actual = {p.relative_to(pack).as_posix() for p in pack.rglob("*")
              if p.is_file() and is_asset(p.relative_to(pack).as_posix())}
    missing, extra = set(entries) - actual, actual - set(entries)
    if missing:
        raise ValueError("Missing required assets: " + ", ".join(sorted(missing)))
    if extra:
        raise ValueError("Unlisted installable assets; review inventory: " + ", ".join(sorted(extra)))

    # Stage immutable bytes in memory. The release is small; later source edits
    # cannot replace the exact bytes already checked against the pinned inventory.
    payload = {}
    for name, entry in entries.items():
        source = pack / name
        no_link(source)
        data = source.read_bytes()
        check_bytes(name, data, entry)
        payload[PACK_NAME + "/" + name] = data
    for name in ROOT_FILES + REQUIRED_SCRIPTS:
        if not (runtime / name).is_file():
            raise ValueError("Missing required runtime file: " + name)
    runtime_files = [runtime / name for name in ROOT_FILES]
    runtime_files += [p for p in runtime.iterdir() if p.is_file()
                      and p.suffix.lower() == ".ps1"
                      and not p.name.lower().endswith((".test.ps1", ".tests.ps1"))]
    for source in runtime_files:
        no_link(source)
        name = source.name if source.name in ROOT_FILES else "scripts/" + source.name
        payload[name] = source.read_bytes()
    document = {"schemaVersion": 1, "version": VERSION, "status": STATUS,
                "hashScope": "All payload files; this manifest excludes itself to avoid a circular hash.",
                "files": [{"path": name, "size": len(data),
                           "sha256": hashlib.sha256(data).hexdigest()}
                          for name, data in sorted(payload.items())]}
    payload[MANIFEST] = (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".kvk-release-", suffix=".zip", dir=output.parent,
                                         delete=False) as handle:
            temporary = Path(handle.name)
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, data in sorted(payload.items()):
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        verified = verify_archive(temporary)
        if verified != document:
            raise ValueError("Written manifest mismatch")
        # Check output once more before replacing a previous candidate.
        validate_output(output, pack, runtime, inventory)
        os.replace(temporary, output)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    return len(document["files"]), digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack-dir", type=Path, default=HERE.parents[1] / PACK_NAME)
    parser.add_argument("--runtime-dir", type=Path, default=HERE)
    parser.add_argument("--inventory", type=Path, default=HERE / "release-inventory.json")
    parser.add_argument("--output", type=Path, default=HERE.parents[1] / "dist" / ("KovaaK-Config-v" + VERSION + ".zip"))
    args = parser.parse_args()
    try:
        count, digest = build_release(args.pack_dir, args.runtime_dir, args.inventory, args.output)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print("Build failed: " + str(error), file=sys.stderr)
        return 1
    print("Candidate built and ZIP bytes verified: " + str(args.output.resolve()))
    print("Payload files: " + str(count) + "; SHA-256: " + digest)
    print("Windows acceptance pending; nothing uploaded or published.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
