# Engine parity: PowerShell goldens for the Rust engine

The Rust engine (`packages/app/src-tauri/src/engine/`) is a second implementation of this
folder's PowerShell engine. This suite pins the two together: PowerShell runs every case and
writes what it observed to `goldens/`; the Rust test `tests/engine_parity.rs` runs the same
cases through the Rust engine and must observe the same thing.

```sh
pwsh -NoProfile -File scripts/installer/tests/parity/parity.test.ps1            # regenerate, fail on any diff
pwsh -NoProfile -File scripts/installer/tests/parity/parity.test.ps1 -Write     # rewrite goldens/
pwsh -NoProfile -File scripts/installer/tests/parity/parity.test.ps1 -CaseFilter enemy-apply
cargo test --manifest-path packages/app/src-tauri/Cargo.toml --features installer-ui --test engine_parity
```

Goldens come from PowerShell on Windows only. A change to the engine's behaviour lands in one
PR as: the PowerShell change, the regenerated goldens, and the Rust change.

## A case

`cases/<name>.json` holds the settings file the game folder starts with (`fixture`, a file in
`fixtures/`, copied byte for byte) and the steps, run in order in one worker session:

| Step | Meaning |
|---|---|
| `{"request": op, "args": {…}}` | One request, sent as a JSON line the way the App sends it. `<game>` is the game folder, `<plan>` the last `planId` a reply returned. `"compare": "code"` keeps only `ok` and the error code (the message is the operating system's). |
| `{"raw": value}` | A request line that is exactly `value` (malformed envelopes). |
| `{"setPrimary": file}` / `{"appendPrimary": text}` | Replace the settings file with a fixture, or append text to it. |
| `{"gameRunningFrom": n}` | The game appears in the process list from the n-th listing on (1 is the next one); `null` ends it. Every game check and every `gameState` is one listing. |
| `{"fault": name}` / `{"clearFaults": true}` | Make a named step throw `Injected failure at <name>` (`file-change`: `Invoke-KvkFileChange`; `snapshot`: `Copy-KvkSnapshot`). |
| `{"holdLock": true}` / `{"releaseLock": true}` | Hold `locks/palette.lock` open exclusively, as another instance would. |

Each case starts from a fresh temporary root holding `游戏 with spaces/FPSAimTrainer` (with
`sounds/`) and an empty `Local Data`. On the test PC, pass `-TempRoot` to keep it out of the user
profile.

## What is recorded

For each request step: the reply line and the progress lines, as the worker would write them
(`ConvertTo-Json -Depth 32 -Compress`). After the last step: every file under the game folder and
under the local data folder, by relative path. A `manifest.json` is recorded as its exact text; any
other file as its size and SHA-256.

## Normalization (both harnesses, in this order, on the JSON text)

1. The game folder and the local data folder, as they appear in JSON text (backslashes doubled),
   become `<game>` and `<local>`.
2. The SHA-256 of the lowercased game folder (the backup and lock folder name) becomes `<gamehash>`.
3. An escaped backslash (`\\` in JSON text) becomes `/`.
4. The 64-hex name of each first-protection backup (`pristine/files/<hex>.bin`, a hash of a random
   GUID) becomes `<pristine#n>`, numbered in path order.
5. Each 32-hex run not inside a longer hex run (a GUID in `N` form) becomes `<guid#n>`, numbered by
   first appearance: request steps first, then files. Files are ordered by their path with the
   step GUIDs already replaced and any other GUID read as `<guid>`.
6. An ISO 8601 UTC timestamp (`yyyy-MM-ddTHH:mm:ss`, optional fraction of 1–7 digits, `Z`)
   becomes `<time>`.

## PowerShell fixes this suite assumes

Where PowerShell was wrong, or behaved differently with the player's Windows language, it is
fixed first and Rust copies the fixed behaviour (user decision, 2026-09-30). Each is its own
commit:

1. Names are ordered ordinal, ignoring case (`Sort-Object` and `@{}` compared with the current
   culture before), so a list no longer depends on the Windows display language.
2. `ConvertFrom-Json` uses `-DateKind String` for requests, themes and settings values, so a name
   that looks like a date stays a string.
3. Name, id and hash checks end with `\z` instead of `$`, so a trailing newline is refused.

Known, accepted differences are listed in `DIVERGENCES.md`.
