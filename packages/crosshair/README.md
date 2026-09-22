# @kvk/crosshair

Independent crosshair-code decoding, static preview pixels, SVG and PNG tooling.
This package does not depend on the parked settings editor or discover game directories.
The CLI writes only to the explicitly requested new output file; it never installs assets
automatically. Export outside the game directory, then use the normal installer workflow.

## Generate files

From the repository root after `npm ci`:

```sh
npm run crosshair -- --code '0;s;1;P;c;1;h;0;f;0;0l;4;0o;2;0a;1;0f;0;1b;0' --output /tmp/aimloom-green.png
npm run crosshair -- --code 'CSGO-Cn37R-YE7vo-pLCAL-aURmZ-z6zkG' --size 256 --scale 4 --output /tmp/aimloom-cs2.svg
npm run crosshair -- --input /tmp/aimloom-green.png --output /tmp/aimloom-green-copy.png
npm run crosshair -- --help
```

Quote the entire code so the shell does not interpret its semicolons. Choose a new
output filename: the command refuses to overwrite an existing file. PNG input preserves
the source image's pixels and dimensions; render size/scale options apply only to codes.

Options: square canvas size 16–512 (default 128), scale 0.25–8 (default 1), and
`--profile primary|ads` for VALORANT. Output formats are `.png` and `.svg`.
SVG is derived from the same RGBA raster as PNG. No background is baked into the image.

The CLI is a development entry point. The software UI still follows the requirement to
design its screens in Figma before implementation; this change does not add a new screen.
An exported PNG must still enter the normal install review/backup/confirmation flow and
be selected in KovaaK. Preview or export does not install or select anything.

## Export a single-crosshair installer pack

```sh
npm run crosshair:pack -- --code 'CSGO-Cn37R-YE7vo-pLCAL-aURmZ-z6zkG' --output /tmp/aimloom-pack
npm run crosshair:pack -- --input /tmp/aimloom-green.png --output /tmp/aimloom-png-pack
```

Both input and output relative paths for this command resolve from the repository root,
including npm workspace execution. It accepts the same code-only size, scale and profile
options as generation. The destination must be a new directory with an existing parent.
Inputs are validated before reserving it; existing files/directories are refused unchanged.

Each pack contains exactly one uniquely named `crosshairs/aimloom_<id>.png`,
`preview.svg`, `manifest.json`, `SHA256SUMS.txt`, UTF-8 BOM Chinese `START_HERE.txt`,
and the full `THIRD_PARTY_NOTICES.md`. The manifest records source kind/code/game,
SHA-256 of the original input bytes (UTF-8 argument for codes), effective rendering options,
warnings, dimensions and artifact hashes; it never records a local source path.
`gameValidation` always starts at `not_run`. The checksum list includes the manifest
and every payload except the checksum list itself; the manifest hashes only the four
payload artifacts, avoiding circular hashes.

Files are built and read back in a private staging subdirectory. Metadata is published
and read back before publishing `crosshairs/` last, because the native installer scans
that directory even without a manifest. A manifest alone is therefore **not** a completion
marker. An interrupted export can leave a reserved directory with metadata/private staging;
it must not be reused as an output. No cleanup recursively deletes that directory.
A successfully published pack can be selected through the existing installer review,
backup and confirmation flow. Export never invokes the installer or selects a game
crosshair. Follow `START_HERE.txt` for installation and source-color comparison guidance.

## APIs

The main entry is browser-safe:

```ts
import { parseCrosshair, renderCrosshair, toSvg } from '@kvk/crosshair';

const parsed = parseCrosshair(code);
const image = renderCrosshair(parsed, { size: 128, scale: 1 });
const svg = toSvg(image);
// image.data is straight-alpha RGBA bytes, with width, height and warnings.
```

Node-only PNG functions are explicitly separate:

```ts
import { decodePng, encodePng } from '@kvk/crosshair/node';

const bytes = encodePng(image);
const imported = decodePng(bytes);
```

`parseCs2`, `parseValorant`, `createScene`, and `renderScene` are also exported for
consumers that need complete source settings or inspectable geometry. Callers display
the returned warnings. Invalid inputs throw `CrosshairError` with a stable `code` and
Chinese message; malformed data is not silently replaced with a default crosshair.

## Supported scope

| Source | Supported | Explicit limits |
|---|---|---|
| CS2 | Version-1 grouped share codes, checksum, complete known fields, dot/T-style/color/outline/alpha | Geometry and preset palette are labelled static product approximations; no exact game-rendering claim, recoil, motion or weapon-gap simulation. Disabled styles are reported. |
| VALORANT | Version-0 P/A/S syntax, full known field validation, custom/preset colors, independent line axes and ADS selection | Static base offsets only; movement/firing spread and fade are not simulated. Sniper fields are stored and validated, but not rendered. |
| PNG files | Non-interlaced 8-bit PNG, transparency, dimensions and CRC checks; new PNG/SVG export | At most 2 MiB and 512×512; animation, interlace and other bit depths rejected. No conversion from arbitrary pixels back into game share codes. |

The renderer uses a bounded 4×4 sample grid, outside-only outline union and explicit
maximum-opacity foreground overlap. This is a documented image-generation policy, not
a promise of identical game rasterization. Oversized geometry is rejected rather than
clipped; an invisible crosshair returns an explicit warning.

Unknown fields, duplicate sections/keys, unsupported versions and invalid values are
rejected conservatively. Some game-accepted extensions may therefore require a later
compatibility update. Wire capacity and actual game setting ranges are not interchangeable.

Research: [CS2](../../docs/research/cs2-crosshair-sources.md),
[VALORANT](../../docs/research/valorant-crosshair-sources.md).
Licenses: [third-party notices](../../THIRD_PARTY_NOTICES.md).
Design: [crosshair contract](../../docs/superpowers/specs/2026-09-13-crosshair-code-files-design.md).

## Verification

The [test-track guide](../../docs/testing/crosshair-tests.md) separates automated checks
from manual KovaaK observations. Prepare a uniquely named six-case, scale-1 PNG kit with
`npm run test:crosshair:prepare`; its result template starts with every game check unexecuted.

```sh
npm run test:crosshair:auto
npm run test:crosshair:prepare
npm run docker:check
npm run docker:build
```

The Docker context includes this workspace and runs its tests with the existing installer
and core suites. Browser/native UI integration and real-game visual calibration are
separate acceptance tasks.

## UI-independent preview and replacement functions

`@kvk/crosshair/service` (Node only) exports `previewCrosshair(input)` for code/PNG
preview and `prepareCrosshairReplacement(input, {outputDirectory, targetFileName})`
for a new, explicitly named single-asset pack. This supports replacing an existing
crosshair rather than always adding a unique new filename. It does not write to a game.
The Windows `scripts/installer/kvk-crosshair.ps1` adapter previews and confirms the
replacement through the existing backup/install/restore engine. See
[function contracts and examples](../../docs/crosshair-functions.md).

For explicit code-type selection, use browser-safe `CROSSHAIR_GAMES` and
`previewCrosshairCode('cs2' | 'valorant', code, options?)`. Both return static
RGBA/SVG plus warnings. A code of the wrong selected game is rejected. Node service
code inputs accept the same `game` field and preserve it through replacement preparation;
omitting it retains legacy auto-detection. No selector screen is included.
