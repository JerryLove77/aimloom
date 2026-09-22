# Read-only Profile validation tools

These are diagnostic tools for PF0, not an installer or a Profile application engine.
`capture-profile-snapshot.ps1` reads a known KovaaK installation and writes evidence to a
separate directory. It never applies settings, starts/stops the game or restores files.

## Challenge keyboard helper (live game input pending)

`control-kovaak-challenge.ps1` records the operator's challenge-view mapping: `TogglePause`
sends one Esc stroke, and `Reset` sends one Space stroke. Without an action it only reports
foreground/session context; it cannot detect whether the challenge is paused. This helper
is separate from the read-only snapshot collector and can affect the challenge when an
explicit action is executed.

From this repository on the logged-in Windows desktop:

```powershell
pwsh -NoProfile -File scripts/validation/control-kovaak-challenge.ps1
pwsh -NoProfile -File scripts/validation/control-kovaak-challenge.ps1 -Action TogglePause -DelaySeconds 5
pwsh -NoProfile -File scripts/validation/control-kovaak-challenge.ps1 -Action Reset -DelaySeconds 5
```

For an action, switch back to the KovaaK challenge view during the delay and release Alt,
Ctrl and the requested key. The helper rejects Session 0, a non-game foreground window,
a different session and held modifiers/keys. `-DryRun` checks the action without sending.
It never retries a toggle or claims that successful OS input submission proves game state.
The native adapter rechecks the foreground target immediately before queueing the stroke;
this is not an atomic lock on user focus changes.

The [Windows SendInput contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)
describes queued input and integrity-level restrictions. No automatic elevation, focus
stealing, process launch or Task Scheduler workaround is included. SSH Session 0 cannot
directly operate the interactive game; Mac top-bar control would require an explicitly
configured interactive-session handoff.

Current verification: after explicit upload authorization, all six no-input test groups
passed on Windows PowerShell 7.6.6, including native compilation/layout and empty-target
rejection. A real `Status` call through SSH returned `status-only`, Session 0 and unknown
challenge state. The script/test hashes match the local source. Both are deployed under
`%TEMP%\aimloom-profile-pf0-bjhmo2zk`; no actual game keystroke has been sent. Actual input
delivery and challenge behavior remain **Pending validation**. Codex top-bar actions are
not yet configured because the Mac-remote versus Windows-local execution choice is open.

## Windows setup

Requires PowerShell 7+. The tested Windows copy is under:

```text
%TEMP%\aimloom-profile-pf0-bjhmo2zk\capture-profile-snapshot.ps1
```

The default game root is the previously observed
`D:\SteamLibrary\steamapps\common\FPSAimTrainer`. Override `-GameRoot` for another
installation; do not guess a path. The default evidence root is
`$env:LOCALAPPDATA\AimloomProfileValidation`, independent of the Aimloom program and game.

## Capture and compare in PowerShell

For the current experiment, keep the scenario fixed as **Whisphere Viscose**. Record the
visible game version separately. First enter the scenario without changing settings:

```powershell
$capture = Join-Path $env:TEMP 'aimloom-profile-pf0-bjhmo2zk\capture-profile-snapshot.ps1'
$baseline = & $capture -Label bg-before -Scenario 'Whisphere Viscose'
```

Change only the background theme in the game, return to the scenario and observe the
background and enemy appearance. After the game has saved its settings, capture again:

```powershell
$changed = & $capture -Label bg-after -Scenario 'Whisphere Viscose' -CompareTo $baseline.snapshotPath
```

Exit normally and capture `bg-exited`, then reopen the same scenario and capture
`bg-reloaded`, comparing each to `$baseline.snapshotPath`. Record what is visible after
reload. If the shell was closed, pass the actual baseline `snapshot.json` path with
`-CompareTo`; no variable survives a new PowerShell session. Remote operation can run
these same captures, leaving the player only the in-game actions and observations.

For enemy tests, begin a new `enemy-before` baseline with a fixed background. Change one
appearance setting at a time and use separate labels; do not alter target size, hitboxes,
movement or scenario difficulty. Sound and crosshair observations follow the Profile plan;
crosshair core development and its game kit remain owned by the original task.

## Evidence contents and limitations

Each capture creates a unique timestamp/label directory containing:

- `raw/`: byte-identical copies of Primary settings, weapon settings and UI settings when
  present, plus top-level `Themes/*.json` files. Primary settings are required.
- `snapshot.json`: source paths, sizes, SHA-256 hashes, encodings, relevant field values,
  script SHA-256, timestamps, user-supplied scenario label and observed process state.
- With `-CompareTo`: changed file hashes and before/after candidate field values.

The field summary selects theme/environment, enemy, crosshair and sound-related keys; it
is not an exhaustive model of every game setting. INI sound lists retain order, duplicate
values and case. JSON object property order does not count as a value change. Raw copies
remain the authority for unrelated settings, unknown fields and exact bytes.

Evidence stays on Windows. Raw copies contain personal settings; do not commit them or
publish them as fixtures. A later report can retain minimized, relevant observations.

The script checks source paths and hashes twice and rejects observed changes during the
capture. This does not freeze the game or establish an atomic multi-file save. Wait for
the game's save to settle and retain separate save/exit/reload snapshots.

Malformed or unsupported text retains raw evidence with a parse warning; semantic field
comparison is marked incomplete rather than reporting all fields removed. `fieldComparisonComplete`
means the included files parsed, not that every game behavior or field is understood.
Zero field changes with changed raw hashes may indicate changes outside the summary's scope.

`gameState` is `running`, `closed` or `unknown` based on process observation. The scenario
name is supplied by the operator, not detected from the game. File/field results cannot
prove that a background rendered or a sound played; those observations remain separate.

Limits: 512 file records, 4 MiB per file by default (`-MaxFileBytes` supports up to 16 MiB),
and 64 MiB total. Reparse paths are rejected. On Windows, actual filesystem identities
are compared so an alternate drive spelling cannot place evidence in the game directory;
see Microsoft's [final-path API](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew)
and [metadata-only file handles](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew).
Game and evidence roots may not contain one another. A failed write may leave an
`.incomplete-*` directory; it is not a completed snapshot or a valid baseline.

## Fixture tests

From the repository root on Windows:

```powershell
pwsh -NoProfile -NonInteractive -File scripts/validation/tests/profile-snapshot.test.ps1
```

The suite uses temporary simulated game files. It covers byte/encoding preservation,
candidate-field scope, ordered sound values, comparisons, baseline retention, JSON key
reordering, malformed JSON, missing/oversized/locked files, junctions, short paths and a
temporary drive alias. The drive alias uses a free letter and is removed in `finally`.
An unavailable short-path alias is reported as unverified, not silently counted as a pass.
