# Crosshair codes and files: portable core

## Workspace alignment — 2026-09-15

The [shared workspace design](2026-09-13-aimloom-training-profiles-design.md) owns integration.
The independent Crosshair page edits current configuration; the Profile selector saves only
its selected name and PNG path. Code, mode and rendering metadata stay with the resource,
not inside Profile JSON. Profile Cancel never undoes a confirmed current replacement.
This core/codec design remains applicable; the current page and its game bindings are
separate UI/acceptance work, not implied by a passing parser or exported PNG.

Date: 2026-09-13. User authorized implementation on `feature/crosshair-codes`.

## Deliverable

Implement the C0/C1 workstream: strict CS2 and VALORANT code decoding, deterministic
static preview pixels/SVG, bounded PNG import/export, and a local generation CLI.
The software UI still requires editable Figma designs before implementation; this
core does not add an application screen or change native install/restore behavior.

## Sources and fidelity

- CS2 decoder/fixtures: MIT `akiver/csgo-sharecode`, revision
  `753f16fe97f9bbb121fb56675b40f035ad403d05`. It is a community implementation,
  not evidence that the CS2 game's renderer is open source.
- VALORANT field definitions: MIT `npmjs-valapi/node-valapi`, revision
  `9b9788db5c4dc7c8f4d59680e7459c9c22b69561`. Geometry and external sample codes:
  MIT `genesy/crosshair-codes`, revision `ddb7aaae72fae7e3185f6043869e89f5716e5e1e`.
- Source-specific research records and fixture provenance live under `docs/research/`
  and `packages/crosshair/tests/fixtures/`. Retain full third-party license notices.
- Upstream snippets are not trusted input validators. CS2 alphabet, size, checksum,
  format version and reserved fields are validated locally. VALORANT validates all
  sections, even those not rendered; duplicate/unknown fields are rejected.
- CS2 rendering is an **explicit product approximation**, not a source-game pixel
  fidelity claim. At scale 1, line length is `length * 2`, thickness is
  `max(1, thickness * 2)`, gap is `max(0, gap + 4)`, and outline is the decoded
  thickness. T-style removes the top arm; the dot uses line thickness. Preset colors
  use the documented preview palette red/green/yellow/blue/cyan; custom RGB is exact.
  Preserve disabled-style, recoil, weapon-gap and dynamic flags in diagnostics.
- VALORANT uses the decoded base offsets and line geometry; movement/firing spread,
  weapon-dependent offsets and fade are not simulated. `u` alone never activates a
  custom color. ADS uses primary when global `p=1`. Sniper fields are preserved and
  validated but sniper rendering is deferred because inspected sources disagree.

## Module boundaries

`packages/crosshair` is independent of `@kvk/core` and the Windows worker.

| File | Responsibility |
|---|---|
| `src/errors.ts` | Stable errors and warnings, Chinese user-facing messages |
| `src/cs2.ts`, `src/valorant.ts` | Game-specific typed settings and strict parsers |
| `src/render-types.ts`, `src/render.ts` | Source settings to rectangles, RGBA raster and safe SVG |
| `src/index.ts` | Browser-safe public API, format detection and exports |
| `src/node.ts` | Node-only bounded PNG decoding/encoding using pinned `pngjs` |
| `cli/generate.ts` | Explicit local generation/export, no game writes |

`parseCs2` and `parseValorant` return the original trimmed code, complete typed settings,
and warnings. `parseCrosshair` detects the format and delegates. Rendering returns
`{width, height, data: Uint8Array, warnings}`; SVG is generated from those same pixels
so the vector preview and PNG represent the same raster policy.

## Rendering policy and limits

Default square canvas: 128 pixels. Canvas size is an integer from 16 through 512;
scale is finite from 0.25 through 8. Reject geometry that does not fit rather than
silently clipping. Primary and ADS are selectable; an ADS request on CS2 is rejected.

For a line group with offset G, thickness T, horizontal length H and vertical length V:
left `[-G-H,-T/2,H,T]`, right `[G,-T/2,H,T]`, top `[-T/2,-G-V,T,V]`,
bottom `[-T/2,G,T,V]`. Center dots are centered squares. A zero-length/thickness arm is
not drawn. VALORANT unlocked axes use the independent vertical length.

The rasterizer uses a fixed 4 × 4 sample grid per affected pixel, retains fractional
coordinates, and composites the union of the foreground at its maximum applicable
opacity. Black outline occupies the exterior union ring only, not the interior of
translucent fills. Samples are accumulated in premultiplied alpha and returned as
straight RGBA bytes. Empty output is returned with an explicit warning.

No untrusted code, file name, or text is interpolated into SVG markup. SVG is formed
only from bounded dimensions, pixel coordinates, and numeric RGBA values.

## PNG and CLI

- Input files are limited to 2 MiB and dimensions 1–512 in each direction before
  decompression. Validate PNG signature/IHDR, every chunk CRC, palette/transparency
  structure and ordering, and the complete Adler-checked zlib stream. Independently
  cap inflated bytes at the declared scanline length and reject trailing compressed data.
- Initial input scope is non-interlaced, 8-bit PNG. Interlaced input is rejected before
  `pngjs` because its synchronous interlace path uses an unbounded inflate operation.
  Animation is rejected rather than silently returning the first APNG frame.
- `pngjs` is imported only by the Node subpath; browser parsing/rendering has no Node
  dependency. PNG encoding strips ancillary input metadata when creating a new file.
- CLI accepts exactly one of `--code <code>` or `--input <png>` and requires
  `--output <new.png|new.svg>`. Code rendering accepts `--size`, `--scale` and
  `--profile primary|ads`; image import preserves dimensions and pixels.
- Export creates a new file exclusively; existing output files are never overwritten.
  Invalid inputs must leave no output. Errors have stable codes and a nonzero exit.
- Export writes only the explicitly requested new output path. Generation and import do
  not discover or call the game, worker or installer. Installing an exported
  PNG remains the existing explicit review/backup/confirmation workflow, integrated in U2.

## Acceptance

Both decoders pass external literal fixtures and malformed-input tests. Hand-derived
rectangle/pixel cases cover colors, custom-color alpha, outlines, odd thickness, dots,
unlocked axes, T-style, blank output and render bounds. PNG tests use real encoded files
and malicious/truncated variants. CLI tests exercise real subprocesses, outputs and
refusal to overwrite. The full existing 204-test baseline, typecheck and installer build
remain green. Actual game appearance and Figma/UI integration remain separately tracked.
