"""The pre-commit hook only runs if Git records it as executable.

On 2026-09-22 the public repository's first commit carried `.githooks/pre-commit` as 100644, and
Git silently skipped the hook on every commit until someone noticed. This fails CI instead.
"""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXECUTABLE = [".githooks/pre-commit", "scripts/privacy/sync-denylist.sh"]


class HookModeTest(unittest.TestCase):
    def test_hook_and_sync_script_are_executable_in_git(self):
        for path in EXECUTABLE:
            out = subprocess.run(["git", "ls-files", "-s", "--", path], cwd=ROOT,
                                 capture_output=True, text=True, check=True).stdout.split()
            self.assertTrue(out, f"{path} is not tracked")
            self.assertEqual(out[0], "100755", f"{path} must be tracked as executable (100755), not {out[0]}")


if __name__ == "__main__":
    unittest.main()
