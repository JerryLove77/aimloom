#!/bin/sh
# Push the local identifier denylist into a GitHub repository's PRIVACY_DENYLIST Actions
# secret, so the CI privacy job (see .github/workflows/ci.yml) can scan the tracked tree
# against it without the denylist ever living in a repository.
#
# Usage: scripts/privacy/sync-denylist.sh OWNER/REPO
#
# Do not run this against a repository that does not exist yet. Prints only the rule count
# and a SHA-256 of the denylist file -- never its contents.
set -eu

repo="${1:?usage: sync-denylist.sh OWNER/REPO}"
denylist="${AIMLOOM_DENYLIST:-$HOME/.config/aimloom/deny.txt}"

if [ ! -f "$denylist" ]; then
  echo "sync-denylist: denylist not found at $denylist" >&2
  exit 2
fi

rule_count=$(grep -vc -e '^[[:space:]]*$' -e '^[[:space:]]*#' "$denylist" || true)
if command -v sha256sum >/dev/null 2>&1; then
  digest=$(sha256sum "$denylist" | cut -d' ' -f1)
else
  digest=$(shasum -a 256 "$denylist" | cut -d' ' -f1)
fi

gh secret set PRIVACY_DENYLIST --repo "$repo" < "$denylist"

echo "synced $rule_count rule(s) to $repo:PRIVACY_DENYLIST (sha256 $digest)"
