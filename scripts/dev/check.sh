#!/usr/bin/env bash
# Run the local checks with Node 24 and cargo on PATH, from the repository root, and print only
# each step's summary (the output tail when a step fails), then a PASS/FAIL table.
#
#   scripts/dev/check.sh ts                          # npm run typecheck, npm test (all vitest projects)
#   scripts/dev/check.sh ts --project installer controller   # that vitest filter, then typecheck
#   scripts/dev/check.sh rust [cargo test filter]    # cargo test --features installer-ui
#   scripts/dev/check.sh site                        # npm run test:site (Node + workerd suites)
#   scripts/dev/check.sh py                          # the installer and privacy unittest suites
#   scripts/dev/check.sh privacy                     # denyscan --tree and gitleaks, as CI runs them
#   scripts/dev/check.sh all                         # ts rust site py privacy
#
# Steps combine (`check.sh ts rust`); words after a step are that step's arguments. The
# PowerShell suites need Windows and are not run here. Exit status is non-zero if any step fails.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
. "$here/env.sh"
root="$(git -C "$here" rev-parse --show-toplevel)" || exit 2
cd "$root" || exit 2

logs="$(mktemp -d)"
trap 'rm -rf "$logs"' EXIT

results=()
failed=0

# run <label> <summary-regex> <command...>
run() {
  local label="$1" pattern="$2"
  shift 2
  local log="$logs/${#results[@]}.log"
  local started=$SECONDS
  printf '== %s: %s\n' "$label" "$*"
  "$@" >"$log" 2>&1
  local code=$?
  local took=$((SECONDS - started))
  if [ "$code" -eq 0 ]; then
    if [ -n "$pattern" ]; then
      perl -pe 's/\e\[[0-9;]*m//g' "$log" | grep -E "$pattern" | tail -n 8
    fi
    results+=("PASS  ${took}s  $label")
  else
    perl -pe 's/\e\[[0-9;]*m//g' "$log" | tail -n 40
    results+=("FAIL  ${took}s  $label (exit $code)")
    failed=1
  fi
}

step_ts() {
  if [ "$#" -gt 0 ]; then
    run "vitest $*" 'Test Files|Tests ' npx vitest run "$@"
    run "typecheck" '' npm run typecheck
  else
    run "typecheck" '' npm run typecheck
    run "npm test" 'Test Files|Tests ' npm test
  fi
}

step_rust() {
  run "cargo test${1:+ $*}" 'test result:' \
    cargo test --manifest-path packages/app/src-tauri/Cargo.toml --features installer-ui "$@"
}

step_site() {
  run "test:site" 'Test Files|Tests ' npm run test:site
}

step_py() {
  run "py installer" '^Ran |^OK|^FAILED' \
    python3 -m unittest discover -s scripts/installer/tests -p 'test_*.py'
  run "py privacy" '^Ran |^OK|^FAILED' \
    python3 -m unittest discover -s scripts/privacy -p 'test_*.py'
}

step_privacy() {
  run "denyscan --tree" '' python3 scripts/privacy/denyscan.py --tree --optional \
    --exempt scripts/privacy/scan-exempt.txt
  if command -v gitleaks >/dev/null 2>&1; then
    run "gitleaks history" 'leaks found|no leaks' gitleaks git --redact --no-banner --exit-code 1
  else
    results+=("FAIL  0s  gitleaks (not installed; brew install gitleaks)")
    failed=1
  fi
}

is_step() {
  case "$1" in ts|rust|site|py|privacy|all) return 0 ;; *) return 1 ;; esac
}

if [ "$#" -eq 0 ]; then
  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 2
fi

while [ "$#" -gt 0 ]; do
  name="$1"
  shift
  if ! is_step "$name"; then
    echo "check.sh: unknown step '$name' (ts, rust, site, py, privacy, all)" >&2
    exit 2
  fi
  args=()
  while [ "$#" -gt 0 ] && ! is_step "$1"; do
    args+=("$1")
    shift
  done
  if [ "$name" = all ]; then
    step_ts; step_rust; step_site; step_py; step_privacy
  else
    "step_$name" ${args[@]+"${args[@]}"}
  fi
done

echo
printf '%s\n' "${results[@]}"
exit "$failed"
