"""Exercise the developer packager against actual temporary files and archives."""

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile


BUILDER = Path(__file__).resolve().parents[1] / "build-release.py"


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.pack = self.root / "source pack"
        self.runtime = self.root / "runtime"
        self.output = self.root / "dist" / "release.zip"
        self.inventory = self.root / "inventory.json"
        self.payload = {
            "Themes/.json": b'{"themeName":""}',
            "Themes/中文 theme.json": b'\xef\xbb\xbf{"themeName":"different"}',
            "sounds/hit sound.ogg": b"OggS\x00original sound",
            "crosshairs/准星.png": b"\x89PNG\r\n\x1a\noriginal image",
            "UI.json": b'{"ui":true}',
            "PrimaryUserSettings.json": b'{"sensitivity":3}',
            "Palette.ini": b"[Palette]\r\ncolor=blue\r\n",
        }
        for name, data in self.payload.items():
            self.put(self.pack / name, data)
        self.runtime_payload = {
            "安装配置.cmd": b'@echo off\r\n',
            "恢复配置.cmd": b'@echo off\r\n',
            "使用说明.txt": "使用说明".encode("utf-8"),
            "kvk-config.ps1": b"\xef\xbb\xbf# CLI\r\n",
            "kvk-engine.ps1": b"\xef\xbb\xbf# Engine\r\n",
            "kvk-paths.ps1": b"\xef\xbb\xbf# Required helper\r\n",
        }
        for name, data in self.runtime_payload.items():
            self.put(self.runtime / name, data)
        self.save_inventory()

    @staticmethod
    def put(path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def save_inventory(self, entries=None):
        if entries is None:
            entries = [{"path": name, "sha256": hashlib.sha256(data).hexdigest(),
                        "size": len(data)} for name, data in self.payload.items()]
        self.inventory.write_text(json.dumps({"schemaVersion": 1, "version": "0.1.0",
                                              "files": entries}), encoding="utf-8")

    def build(self, output=None):
        return subprocess.run([sys.executable, str(BUILDER), "--pack-dir", str(self.pack),
                               "--runtime-dir", str(self.runtime), "--inventory", str(self.inventory),
                               "--output", str(output or self.output)], capture_output=True, text=True)

    def assert_rejected(self, phrase, output=None):
        result = self.build(output)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(phrase, result.stderr.lower())
        self.assertFalse(self.output.exists())

    def test_archive_copies_original_unicode_bytes_and_all_runtime_helpers(self):
        for name in ["sounds/unwanted.sfk", "crosshairs/backup.png~", "nested.zip",
                     "Themes/readme", "Themes/nested/no.json"]:
            self.put(self.pack / name, b"exclude")
        for name in ["tests/private.ps1", "private.test.ps1", "build-release.py", "README.md"]:
            self.put(self.runtime / name, b"exclude")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = {"KVK Settings 2025/" + name: data for name, data in self.payload.items()}
        expected.update({("scripts/" + name if name.endswith(".ps1") else name): data
                         for name, data in self.runtime_payload.items()})
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(set(archive.namelist()), set(expected) | {"release-manifest.json"})
            manifest = json.loads(archive.read("release-manifest.json"))
            self.assertEqual(manifest["status"], "candidate-windows-acceptance-pending")
            self.assertEqual({x["path"] for x in manifest["files"]}, set(expected))
            for entry in manifest["files"]:
                data = archive.read(entry["path"])
                self.assertEqual(data, expected[entry["path"]])
                self.assertEqual(entry["sha256"], hashlib.sha256(data).hexdigest())
                self.assertEqual(entry["size"], len(data))
                self.assertNotIn("\\", entry["path"])
        first = self.output.read_bytes()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.output.read_bytes(), first)

    def test_missing_inventory_asset_aborts_without_archive(self):
        (self.pack / "sounds/hit sound.ogg").unlink()
        self.assert_rejected("missing")

    def test_changed_asset_aborts_preserving_existing_archive(self):
        self.put(self.output, b"previous archive")
        (self.pack / "UI.json").write_bytes(b"changed")
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("mismatch", result.stderr.lower())
        self.assertEqual(self.output.read_bytes(), b"previous archive")

    def test_unlisted_installable_asset_requires_inventory_update(self):
        self.put(self.pack / "sounds/new.ogg", b"new")
        self.assert_rejected("unlisted")

    def test_missing_runtime_engine_aborts(self):
        (self.runtime / "kvk-engine.ps1").unlink()
        self.assert_rejected("missing")

    def test_output_cannot_overwrite_or_be_inside_inputs(self):
        for path in [self.pack / "UI.json", self.pack / "output.zip",
                     self.runtime / "kvk-engine.ps1", self.inventory]:
            before = path.read_bytes() if path.is_file() else None
            self.assert_rejected("output", path)
            self.assertEqual(path.read_bytes() if path.is_file() else None, before)

    def test_case_alias_output_cannot_overwrite_source_asset(self):
        alias = self.root / "SOURCE PACK"
        if not alias.exists():
            self.skipTest("Fixture filesystem is case sensitive")
        result = self.build(alias / "UI.json")
        self.assertEqual((self.pack / "UI.json").read_bytes(), self.payload["UI.json"])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("output", result.stderr.lower())

    def test_case_alias_output_cannot_overwrite_runtime(self):
        alias = self.root / "RUNTIME"
        if not alias.exists():
            self.skipTest("Fixture filesystem is case sensitive")
        result = self.build(alias / "kvk-engine.ps1")
        self.assertEqual((self.runtime / "kvk-engine.ps1").read_bytes(),
                         self.runtime_payload["kvk-engine.ps1"])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("output", result.stderr.lower())

    def test_case_alias_output_cannot_create_new_descendants_in_inputs(self):
        if not (self.root / "SOURCE PACK").exists():
            self.skipTest("Fixture filesystem is case sensitive")
        for alias in [self.root / "SOURCE PACK", self.root / "RUNTIME"]:
            with self.subTest(alias=alias):
                destination = alias / "new" / "deep" / "release.zip"
                result = self.build(destination)
                self.assertFalse((alias / "new").exists())
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("output", result.stderr.lower())

    def test_symlink_parent_cannot_route_output_inside_inputs(self):
        for source in [self.pack, self.runtime]:
            with self.subTest(source=source):
                alias = self.root / (source.name + "-alias")
                alias.symlink_to(source, target_is_directory=True)
                destination = alias / "new" / "release.zip"
                self.assert_rejected("output", destination)
                self.assertFalse((source / "new").exists())

    def test_inventory_case_alias_and_hardlink_are_protected(self):
        before = self.inventory.read_bytes()
        alias = self.root / "INVENTORY.JSON"
        if alias.exists():
            self.assert_rejected("output", alias)
            self.assertEqual(self.inventory.read_bytes(), before)
        import os
        linked = self.root / "inventory-copy.json"
        os.link(self.inventory, linked)
        self.assert_rejected("output", linked)
        self.assertEqual(self.inventory.read_bytes(), before)
        self.assertEqual(linked.read_bytes(), before)

    def test_symlink_input_and_output_rejected(self):
        asset = self.pack / "sounds/hit sound.ogg"
        actual = self.root / "outside.ogg"
        asset.rename(actual)
        asset.symlink_to(actual)
        self.assert_rejected("link")
        asset.unlink()
        asset.write_bytes(actual.read_bytes())
        target = self.root / "untouched.zip"
        target.write_bytes(b"keep")
        linked_output = self.root / "linked.zip"
        linked_output.symlink_to(target)
        self.assert_rejected("link", linked_output)
        self.assertEqual(target.read_bytes(), b"keep")

    def test_case_collisions_rejected(self):
        self.put(self.pack / "sounds/HIT SOUND.OGG", b"collision")
        if len(list((self.pack / "sounds").iterdir())) == 1:
            self.skipTest("Fixture filesystem is case insensitive")
        self.assert_rejected("collision")

    def test_unsafe_inventory_paths_rejected(self):
        digest = hashlib.sha256(b"outside").hexdigest()
        for path in ["../outside.ogg", "/absolute.json", "sounds/../hit.ogg",
                     "sounds\\hit.ogg", "sounds/C:evil.ogg", "sounds/NUL.ogg"]:
            self.save_inventory([{"path": path, "sha256": digest, "size": 7}])
            self.assert_rejected("unsafe")

    def test_duplicate_inventory_paths_rejected(self):
        entry = {"path": "UI.json", "sha256": hashlib.sha256(self.payload["UI.json"]).hexdigest(),
                 "size": len(self.payload["UI.json"])}
        self.save_inventory([entry, entry])
        self.assert_rejected("duplicate")

    def test_inventory_case_collision_rejected_on_any_filesystem(self):
        entries = [{"path": name, "sha256": hashlib.sha256(b"{}").hexdigest(), "size": 2}
                   for name in ["Themes/a.json", "Themes/A.json"]]
        self.save_inventory(entries)
        self.assert_rejected("collision")

    def test_verify_rejects_tampered_zip_payload(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        corrupt = self.root / "tampered.zip"
        with zipfile.ZipFile(self.output) as source, zipfile.ZipFile(corrupt, "w") as dest:
            for name in source.namelist():
                dest.writestr(name, b"tampered" if name == "KVK Settings 2025/UI.json" else source.read(name))
        spec = importlib.util.spec_from_file_location("kvk_release", BUILDER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with self.assertRaisesRegex(ValueError, "mismatch"):
            module.verify_archive(corrupt)


if __name__ == "__main__":
    unittest.main()
