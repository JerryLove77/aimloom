# Aimloom five-section workspace and Profile contract

Updated 2026-09-15. This is the shared product contract for all active repository plans.
It incorporates the user's one-file-per-Profile format and five-section navigation decision.
Older installer-only navigation, embedded Profile settings and managed-asset proposals do
not define new product work. Existing game-write safety and recovery requirements remain.

## Five sections and ownership

| Section | What it owns | Effect of a confirmed edit |
|---|---|---|
| Profile | A saved combination and its editing draft | Final Save updates that Profile JSON only |
| Scheme | Current background/environment configuration | Updates the current scheme through its component workflow |
| Audio | Current audio configuration | Updates the relevant current sound events |
| Crosshair | Current crosshair configuration | Updates the current crosshair through its component workflow |
| Enemy | Current enemy appearance | Updates supported current enemy appearance fields |

The four current-configuration pages are independent of the Profile editor. They must not
implicitly rewrite any saved Profile JSON. Profile Cancel discards only the Profile draft;
it never rolls back changes already confirmed in another section. Switching sections keeps
the Profile draft available. A current-setting change must not discard that draft either.

Example: change the current scheme to blue in Scheme, edit profile1, then cancel profile1.
The current scheme remains blue and profile1.json retains its previous saved combination.
Reading or previewing a saved Profile does not make it the current game configuration.

## One JSON file per Profile

profile1.json is one combination; profile2.json is another. List ordinary files in the
native profiles directory; no separate index database or asset ownership system is needed.
The existing application also records schemaVersion, a safe stable id and a display name.

```json
{
  "schemaVersion": 1,
  "id": "profile1",
  "name": "Profile 1",
  "scheme": { "name": "XXX", "path": "D:/KovaaK/Themes/XXX.json" },
  "audio": {
    "kill": [{ "name": "Hit", "path": "D:/KovaaK/Sounds/hit.wav" }]
  },
  "crosshair": { "name": "Dot", "path": "D:/KovaaK/Crosshairs/dot.png" },
  "enemy": { "name": "Blue", "path": "D:/KovaaK/Enemies/blue.json" }
}
```

- Store selected names and addresses, not scheme contents, enemy parameters, crosshair
  source codes or media bytes. The selected files remain the source of those details.
- Scheme and enemy reference JSON files; crosshair references a PNG. Audio uses ordered
  name/path records per event: kill, spawn, mbsGood, mbsOkay, mbsBad and mbsChangeNow.
- All four component keys are present. null keeps the whole current component. For audio,
  an omitted event keeps its binding; an empty list explicitly selects no files. Native
  empty-list behavior must be verified before application. Order and duplicates survive.
- Relative resource paths resolve from the owning Profile JSON directory. Names are labels;
  the path selects the file. Do not assume a filename or label proves game activation.
- A Profile is a reference collection, not an immutable copy. If another explicit operation
  replaces a referenced file, future reads see that file's new contents. Cancelling Profile
  editing does not undo that external operation or restore resource bytes.
- Rename changes the Profile display name; duplicate creates a new id/JSON. Delete removes
  only that Profile JSON, never its referenced files or existing backups.
- Save atomically. Invalid records produce per-file errors and are never silently replaced
  or migrated. An unsupported format is an error, not an empty/default Profile.

## Profile page: six primary editor actions

The editor has Scheme, Audio, Crosshair, Enemy, Cancel and Save. Library-level new, edit,
duplicate, delete, search and pagination are separate from these six editor actions.

1. A component button opens a preview of this Profile's selected component.
2. Modify opens a list of existing files of the corresponding type.
3. Selecting a file opens a candidate preview with Cancel and Confirm.
4. Candidate Cancel returns to the file list without changing the component choice.
   Confirm stages the candidate in the component editor only.
5. Component Save choice merges that staged selection into the Profile draft and returns.
   Back/close discards component-local edits not yet saved to the Profile draft.
6. Final Profile Cancel discards the Profile draft and exits. Final Save writes the JSON
   and exits only after success; failure keeps input and shows a recoverable error.

Preview, candidate confirmation and component Save choice do not write the Profile file
or change current settings. Final Profile Save also does not apply anything to the game.
Audio selection is by event; editing one event preserves other events and list order.
Invalid/undecodable candidate files cannot be confirmed. Older asynchronous loads cannot
replace a newer preview. Audio never autoplays and stops when its preview is left.

## Current-configuration pages

Each page reads current state through its relevant adapter, previews a proposed change,
and uses an explicit confirmation/replacement action for that current component. Missing
or unverified native bindings stay visible; do not infer current state from the last
opened Profile or the existence of a copied file. These pages reuse the completed component
functions rather than implementing a second renderer, codec or game-write engine.

The existing PowerShell engine owns game writes, game-closed checks, stale-source checks,
backups, rollback and restore. Preserve sensitivity, DPI, FOV, gameplay and unrelated
components. All previews remain read-only. Profile draft state and current-setting state
must have separate owners, even when they reuse the same preview controls.

Scheme and enemy share underlying settings. Use environment-only scheme composition,
then explicit enemy overrides; unspecified enemy values and teammate settings remain
current. The legacy whole-theme writer must not be used for the combined workflow.

## Applying a saved combination

**Built 2026-09-21** ([plan](../plans/2026-09-21-profile-apply.md)): an 应用 / "Apply" action on
each library row applies the **saved** JSON as one plan, one backup batch and one rollback
(`planProfileApply`). Any reference not found in the game refuses the whole application; an
empty sound list keeps that binding; the game may be running. Not yet observed in the game.

The original constraints, which the build keeps: the entry point must not replace Save or add
an implicit seventh editor action.
Resolve file references, review supported changes, then use one existing-style recoverable
operation. Profile JSON is not the before-state backup. Report observed activation
separately from files/settings written. No automatic scenario switching or game restart.

## Status and design workflow

On feature/profile, component functions are integrated, the file-record contract was fixed
in 153d7d9, and the Profile page was implemented in e102e11. Only Profile is open; the four
current-configuration pages remain deferred. Native readonly resource interfaces and
browser-demo interactions are implemented. Windows UI/live-filesystem and game acceptance,
complete Profile application, launcher/browser transport and release packaging remain open.

**Design workflow — 2026-09-16:** Starter MCP quota stopped the first screen-authoring
call, and no editable Figma file exists yet. The user decided the implementation of the
five-section workspace proceeds first and a single design pass follows, covering the shell,
all five sections and the website together. The earlier per-page wording above is
superseded: this deferral covers the workspace pages, not only Profile. It is **not** a
waiver of the design requirement — the frames stay pending and their absence must not be
reported as a completed design. Existing runtime tokens and shared controls remain
authoritative.

Deferring the design pass has one accepted cost to state plainly: the three implemented
pages reuse the Profile page's visual pattern rather than being designed, so they are
functional but not designed. The catch-up pass is expected to redesign rather than trace
them.

## Shared acceptance

- Profile Save/reopen retains selected names, paths, nulls, audio order and duplicates.
- Candidate Cancel, component Back and final Profile Cancel discard only their own draft.
- A confirmed current-setting edit survives subsequent Profile Cancel, and does not silently
  save into any Profile. Switching sections preserves the outstanding Profile draft.
- Failed saves and preview errors preserve recoverable input; stale results are ignored.
- Current component writes preserve unrelated settings and use existing backup/recovery.
- Future complete application passes A → B → A → undo with the required game observations.

Defer asset databases, immutable revisions, migration engines, continuous drift/history,
cloud sync and external generation providers. Browser delivery remains a separate workstream.

See the [execution plan](../plans/2026-09-13-training-profiles.md),
[page verification](../notes/2026-09-15-profile-page-verification.md),
[example JSON](../../examples/profiles/profile1.json), and
[historical activation evidence](../notes/2026-09-13-profile-activation-evidence.md).
