# Engine parity: the frozen goldens of the PowerShell engine

The Rust engine (`packages/app/src-tauri/src/engine/`) was written as a second implementation of
the PowerShell engine that 0.1.5 and earlier ran. The PowerShell engine ran every case here and
wrote what it observed to `goldens/`; the Rust test `tests/engine_parity.rs` runs the same cases
through the Rust engine and must observe the same thing.

```sh
cargo test --manifest-path packages/app/src-tauri/Cargo.toml --features installer-ui --test engine_parity
```

**The goldens are frozen.** The PowerShell engine and its harness (`parity.test.ps1`,
`cross.test.ps1`) were removed in 0.1.6-beta.2 and are kept in the history before it. Nothing
regenerates a golden: a difference is a change in the Rust engine's behaviour. Either it is a bug,
or it is intended, and then the case's golden is edited by hand in the same commit, with the
reason in that commit and, if it departs from the old engine, a row in `DIVERGENCES.md`. A new
behaviour is tested with Rust tests (`src/engine/tests.rs`, `tests/rust_worker.rs`), not new cases
here.

Four cases were retired with the operations they exercised, `planInstall` and `catalog`, when
Quick import became `planImport` (0.1.6-beta.2): `install-pack`, `install-pack-invalid-json`,
`install-case-variant` and `reads-catalog`. What they pinned for the install transaction (a
multi-file install, a damaged theme, a name differing only in case) is covered by the Rust tests
in `src/engine/import_tests.rs`. 48 cases remain.

## A case

`cases/<name>.json` holds the settings file the game folder starts with (`fixture`, a file in
`fixtures/`, copied byte for byte), optionally more files for the game folder (`gameFiles`), for a
pack folder (`packFiles`), for the local data folder (`localFiles`) and for the case's root folder
(`rootFiles`, where `<root>` in a file's text is that folder), each a map from a relative path to `{"text": …}` (written as
UTF-8), `{"fixture": …}` or `{"dir": true}`, and the steps, run in order in one worker session:

| Step | Meaning |
|---|---|
| `{"request": op, "args": {…}}` | One request, sent as a JSON line the way the App sends it. A string starting with `<game>`, `<pack>` or `<root>` starts with that folder instead; `<plan>` and `<batch>` are the `planId` and `batchId` of the last reply that carried one. `"compare": "code"` keeps only `ok` and the error code (the message is the operating system's). |
| `{"raw": value}` | A request line that is exactly `value` (malformed envelopes). |
| `{"line": text}` | A request line that is exactly `text`, for what JSON values cannot express (a repeated key). |
| `{"setPrimary": file}` / `{"appendPrimary": text}` | Replace the settings file with a fixture, or append text to it. |
| `{"gameRunningFrom": n}` | The game appears in the process list from the n-th listing on (1 is the next one); `null` ends it. Every game check and every `gameState` is one listing. |
| `"machine"` (case field) | What discovery reads from the machine: `steamRoots` (Steam's registry entries), `drives` (file system drive roots) and `env` (`ProgramFiles`, `ProgramFiles(x86)`, unset unless given). |
| `{"fault": name}` / `{"clearFaults": true}` | Make a named step throw `Injected failure at <name>` (`file-change`: `Invoke-KvkFileChange`; `snapshot`: `Copy-KvkSnapshot`). |
| `{"holdLock": true}` / `{"releaseLock": true}` | Hold `locks/palette.lock` open exclusively, as another instance would. |

Each case starts from a fresh temporary root holding `游戏 with spaces/FPSAimTrainer` (with
`sounds/`) and an empty `Local Data`.

## What is recorded

For each request step: the reply line and the progress lines, as the worker would write them
(`ConvertTo-Json -Depth 32 -Compress`). After the last step: every file under the game folder and
under the local data folder, by relative path. A `manifest.json` and a Profile (`Aimloom/profiles/`) are recorded as
their exact text, since they hold absolute paths; any other file as its size and SHA-256.

## Normalization (in this order, on the JSON text)

1. The game, local data, pack and case folders and the repository, as they appear in JSON text
   (backslashes doubled) and as they are, become `<game>`, `<local>`, `<pack>`, `<root>` and
   `<repo>`.
2. The SHA-256 of the lowercased game folder (the backup and lock folder name) becomes `<gamehash>`.
3. An escaped backslash (`\\` in JSON text) becomes `/`.
4. The 64-hex name of each first-protection backup (`pristine/files/<hex>.bin`, a hash of a random
   GUID) becomes `<pristine#n>`, numbered in path order.
5. Each 32-hex run not inside a longer hex run (a GUID in `N` form) becomes `<guid#n>`, numbered by
   first appearance: request steps first, then files. Files are ordered by their path with the
   step GUIDs already replaced and any other GUID read as `<guid>`.
6. An ISO 8601 UTC timestamp (`yyyy-MM-ddTHH:mm:ss`, optional fraction of 1–7 digits, `Z`)
   becomes `<time>`.

## PowerShell fixes the goldens include

Where PowerShell was wrong, or behaved differently with the player's Windows language, it is
fixed first and Rust copies the fixed behaviour (user decision, 2026-09-30). Each is its own
commit:

1. Names are ordered ordinal, ignoring case (`Sort-Object` and `@{}` compared with the current
   culture before), so a list no longer depends on the Windows display language.
2. `ConvertFrom-Json` uses `-DateKind String` for requests, themes and settings values, so a name
   that looks like a date stays a string.
3. Name, id and hash checks end with `\z` instead of `$`, so a trailing newline is refused.

Known, accepted differences are listed in `DIVERGENCES.md`.
