# VALORANT crosshair code research and parser contract

Research date: 2026-09-13. Scope: offline text decoding for Aimloom crosshair generation. This is a community-documented format, not a Riot-maintained serialization specification. No game client API, credentials, memory inspection, or game modification is needed.

## Primary references and licenses

| Reference | Pinned revision | Use and limitation |
|---|---|---|
| [npmjs-valapi/node-valapi, `@valapi/crosshair`](https://github.com/npmjs-valapi/node-valapi/blob/9b9788db5c4dc7c8f4d59680e7459c9c22b69561/packages/%40valapi/crosshair/src/index.ts) | `9b9788db5c4dc7c8f4d59680e7459c9c22b69561` | Field names, defaults, ranges, and section grammar. MIT, copyright 2022 Ing Project. The repository is discontinued. Its import implementation is not reused: it ignores several nonnumeric field types and rounds decimal values. |
| [genesy/crosshair-codes](https://github.com/genesy/crosshair-codes/tree/ddb7aaae72fae7e3185f6043869e89f5716e5e1e) | `ddb7aaae72fae7e3185f6043869e89f5716e5e1e` | Independent defaults, static geometry and sample codes. MIT, copyright 2023 Gene Sy. The parser is not reused: absent section detection and stored custom-color handling are unsafe. The sample list also includes malformed concatenated codes. |
| [weedeej/ValorantCC](https://github.com/weedeej/ValorantCC/blob/becde75fb986bf3067e4b4e56a7eaa5c6881b355/ValorantCC/src/Crosshair_Parser.cs) | `becde75fb986bf3067e4b4e56a7eaa5c6881b355` | Independent C# check of line placement and the firing-error preview gap. MIT, copyright 2021 weedeej. Archived; no application code is copied. |
| [gwynnnplaine, tankzor's crosshairs](https://gist.github.com/gwynnnplaine/99cb522e4b5830bfb3b2ff0e34a40dc9/fbfa88fc4af837b812779512af6d9bd45da12148) | `fbfa88fc4af837b812779512af6d9bd45da12148` | First-person named-color examples provide an independent check that a stored `u` value does not override the active palette. No software license is declared and no implementation or images are copied; the fixtures use only the factual configuration codes and named-color observations. |

See the repository's third-party notices for retained MIT notices. The parser is a new bounded state machine; it does not vendor the above parsers or their dependencies.

Riot's [patch 4.05](https://playvalorant.com/en-gb/news/game-updates/valorant-patch-notes-4-05/) documents importing and exporting profile codes and checking the settings preview. [Patch 5.04](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-5-04/) documents custom six-digit RGB colors and independently adjustable horizontal and vertical line lengths. These establish the product features, but do not specify the token mapping or exact pixel rasterization.

## Supported input and deliberate validation policy

`parseValorant` accepts a complete semicolon-separated version `0` code with a `P` primary section. Global keys may appear in any order before sections; `P`, `A` and `S` may appear in any order. Section markers are recognized only when a key is expected. The parser returns independently owned primary, ADS and sniper settings plus structured warnings. It validates inactive sections before returning any result.

The raw string is limited to 4096 characters before trimming, with at most 512 tokens. Only surrounding whitespace is trimmed. Empty tokens, trailing semicolons, dangling keys, repeated fields or sections, unknown fields and nonzero versions are rejected. Numbers must use ordinary unsigned decimal syntax, be finite, fit the field range, and be integral for integer settings. Booleans must be exactly `0` or `1`. Scientific notation, signed numbers, units and internal whitespace are rejected. The decoder does not round valid decimal opacity or multiplier values.

These limits and ambiguity checks are Aimloom policy, not a claim about Riot's decoder. This version deliberately requires `P`, so the game's compact default-only code `0` must be supplied as `0;P`. The community `NAME` extension is unsupported. Six-digit hex colors are accepted as a compatibility convenience and normalized to eight-digit uppercase RGBA with `FF` alpha; exported game examples commonly use eight digits. Input keys never become dynamic object-property assignments.

## Fields and defaults

Global keys: `p` copies primary into ADS (default true), `s` enables advanced options (false), and `c` overrides other primary crosshairs (false). The `advanced` flag is retained as metadata. Effective ADS selection follows `p`; the independently decoded `A` settings remain available even when that flag selects primary. If `p=0` and `A` is absent, ADS uses its own defaults and a warning explains the fallback.

Primary and ADS share the following fields. The stored `f` and `s` flags are also accepted in ADS because external complete codes contain them, although the valapi schema lists them only under primary.

| Key | Meaning | Default | Accepted range |
|---|---|---|---|
| `c` | Palette index | 0 | Integer 0–8 |
| `u` | Stored custom color | `FFFFFFFF` | 6 or 8 hex digits |
| `b` | Use custom color | false | Boolean |
| `h` | Outlines | true | Boolean |
| `t` | Outline thickness | 1 | Integer 1–6 |
| `o` | Outline opacity | 0.5 | 0–1 |
| `d` | Center dot | false | Boolean |
| `z` | Dot thickness | 2 | Integer 1–6 |
| `a` | Dot opacity | 1 | 0–1 |
| `f` | Fade on firing error | true | Boolean |
| `s` | Show spectated player's crosshair | true | Boolean |
| `m` | Override firing offset | false | Boolean |

Palette indices 0–7 are `FFFFFF`, `00FF00`, `7FFF00`, `DFFF00`, `FFFF00`, `00FFFF`, `FF00FF`, `FF0000`. Index 8 selects custom color. A present `u` alone never changes the active palette: real named white and cyan examples retain stale black and pink custom values. Either `c=8` or `b=1` activates the custom color. Explicit `c=8;b=0` is rejected as contradictory, regardless of token order. `c=8` without `u` uses the stored default white.

The following line keys have prefix `0` for inner lines and `1` for outer lines:

| Suffix | Meaning | Inner default | Outer default | Accepted range |
|---|---|---|---|---|
| `b` | Enabled | true | true | Boolean |
| `a` | Opacity | 0.8 | 0.35 | 0–1 |
| `l` | Horizontal length | 6 | 2 | Integer inner 0–20, outer 0–10 |
| `v` | Stored vertical length | 6 | 2 | Integer inner 0–20, outer 0–10 |
| `g` | Independent vertical length | false | false | Boolean |
| `t` | Thickness | 2 | 2 | Integer 0–10 |
| `o` | Offset | 3 | 10 | Integer inner 0–20, outer 0–40 |
| `m` | Movement error | false | true | Boolean |
| `f` | Firing error | true | true | Boolean |
| `s` | Movement multiplier | 1 | 1 | 0–3 |
| `e` | Firing multiplier | 1 | 1 | 0–3 |

The effective vertical length is `g ? v : l`; an unselected stored `v` is preserved and not used. Zero line length or thickness is valid.

Sniper fields are validated and preserved: `d` dot enabled (true), `b` custom color enabled (false), `c` palette (7), `t` custom RGBA (white), `s` dot thickness (1, decimal 0–4), and `o` opacity (0.75, 0–1). The custom-color selection policy matches P/A. A supplied `S` section always produces a warning because this version does not render sniper crosshairs.

## Rendering evidence and remaining uncertainty

[The JavaScript geometry](https://github.com/genesy/crosshair-codes/blob/ddb7aaae72fae7e3185f6043869e89f5716e5e1e/src/CrosshairDisplay/CrosshairDisplay.tsx) places lines around `(0,0)` using thickness `T`, gap `G`, horizontal length `H` and effective vertical length `V`:

```text
left   (-G-H, -T/2, H, T)
right  ( G,   -T/2, H, T)
top    (-T/2, -G-V, T, V)
bottom (-T/2,  G,   T, V)
dot    (-Z/2, -Z/2, Z, Z)
```

Both the JavaScript and C# settings-preview renderers add a fixed four-pixel gap when firing error is enabled; the JavaScript reference honors `m` to disable that addition. This is a preview convention, not a validated model of all weapons or movement states. The parser warns about visible dynamic line settings. Exact dynamic behavior requires game data that is outside the offline generator's scope.

[The JavaScript outline renderer](https://github.com/genesy/crosshair-codes/blob/ddb7aaae72fae7e3185f6043869e89f5716e5e1e/src/CrosshairDisplay/CrosshairCanvas.tsx) draws black strips outside the fill rectangle. A solid black rectangle behind a translucent fill would incorrectly darken its interior. Odd line thickness produces half-pixel coordinates, so raster alignment must be a documented rendering policy.

Sniper sources disagree: valapi uses default opacity 0.75 while genesy uses 0.8; the C# dot radius is three times its setting while genesy uses four times. Aimloom retains the valapi metadata and defers sniper rendering rather than claiming a pixel match. No real-game acceptance or pixel-accurate VALORANT comparison was performed during this task.

## Independent fixture evidence

`packages/crosshair/tests/fixtures/valorant.json` records six original external code strings and their source revisions. Four have hand-derived settings/rectangle expectations: a static green cross, a custom pink cross, independently controlled cyan axes, and a separate ADS dot. Two additional first-person examples protect active palette selection when `u` contains a stale color. Geometry expectations were computed from the cited formulas, not from Aimloom's parser or renderer. Fixtures are a source-based regression oracle, not proof of equivalence with the current game.
