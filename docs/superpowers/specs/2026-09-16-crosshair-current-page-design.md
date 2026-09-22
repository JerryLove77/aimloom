# Crosshair current-configuration page — design

Approved 2026-09-16. This is the biggest of the four current-configuration pages, so it is
written down before implementation and built in slices.

## What the page is, and what it is not

The page manages the **crosshair files the game offers**. It replaces the image of a chosen
slot, and it can add a new one. It cannot choose which crosshair the game has selected.

That limit is a fact, not a choice: the game records no crosshair selection in any file this
tool can read. `UI.json` and `PrimaryUserSettings.json` contain no crosshair or reticle key,
and the repository's own pending check V04 ("What selects a code-generated or imported
crosshair in the game?") has never been answered. The existing native adapter says the same
thing in its own metadata: `gameSelectionChanged: false`. The page must state this rather
than imply that confirming a replacement changes the in-game selection.

## Confirmed decisions

- **Sources are PNG files only.** A crosshair code is a way to *produce* a PNG file on the
  user's disk; it is never applied directly.
- **Both replace and add** are in scope.
- **Code → PNG export** is in scope, as an entry on this page. It writes an ordinary local
  file and does not touch the game.
- A replacement changes image bytes only. Game selection, TINT, scale and sensitivity are
  not edited.
- The 512×512 and 2 MiB bounds already enforced by the component are kept.
- A change is allowed while KovaaK runs, matching Scheme and Audio, through the same
  engine `-AllowRunningGame` switch.
- Figma remains deferred with the rest of the workspace.

## The one new subsystem: a browser-safe PNG pipeline

The existing PNG encoder and decoder live in `@kvk/crosshair/node` and use `pngjs`,
`node:zlib` and `Buffer`. They cannot ship in the installer, which has no Node runtime. The
page therefore needs a PNG pipeline that runs in the shipping browser.

The split keeps reusable code pure and puts the DOM in the app:

| Layer | Where | Responsibility |
|---|---|---|
| Encode and inspect | `packages/crosshair/src/png.ts` (browser-safe entry) | RGBA → canonical PNG; canonical-header inspection; SHA-256 hex. No DOM, no Node. |
| Decode | `packages/app/src/crosshair/png.ts` | Any PNG bytes → RGBA through `createImageBitmap` + `OffscreenCanvas`, behind an injectable interface so tests need no canvas. |

`encodePng` emits what the replacement adapter accepts and what the game's own decoder reads:
8-bit RGBA, colour type 6, no interlace, a single IDAT.

**Deflate is emitted as stored blocks, not compressed.** Three reasons, in order: it needs no
`CompressionStream` (whose presence in WebView2 we would otherwise have to verify), it is
byte-reproducible, and it keeps the code small. The cost is size: 512×512 RGBA is about
1.05 MiB against the adapter's 2 MiB ceiling.

## Slices

Each slice is independently testable and leaves the tree green.

1. **PNG pipeline.** `encodePng`, canonical inspection and hashing, with a round-trip
   cross-check against the independent Node decoder. No UI.
2. **Replace a slot's image.** List `crosshairs/*.png`; choose a slot and a PNG file; write
   the replacement pack and its metadata; apply through the existing `kvk-crosshair.ps1`
   **unchanged**. Undo through the existing restore path.
3. **Add a crosshair.** A pack holding only a new `crosshairs/<name>.png`, applied through
   the engine's ordinary create path. Requires a name check and must never overwrite an
   existing file.
4. **Code → PNG export.** Paste a CS2/VALORANT code, preview it, save the PNG into a folder
   the user chooses. Requires one new native operation, because nothing today can write a
   file outside the Profile store.

## Failure behaviour

| Situation | Required result |
|---|---|
| The chosen PNG cannot be decoded | Refuse with the reason; nothing is written |
| The image exceeds 512×512 or 2 MiB | Refuse; the limits are stated |
| The slot file changed after the preview | Reject as stale; write nothing |
| The new name already exists when adding | Refuse; never overwrite through the add path |
| The export target exists | Refuse; never overwrite |
| The export target is inside the game directory | Refuse |
| The result is unknown | Lock the page until reconciliation; never report success |

## Not claimed

No in-game observation exists for any of this. That a file was replaced is not evidence that
the game renders it, and this design does not claim otherwise.
