# Aimloom workspace design

This file records the shared application visual and interaction foundations. The public
website keeps its separate [design brief](docs/superpowers/specs/2026-09-08-aimloom-website-design.md).

## Profile page delivery — 2026-09-15

The user explicitly approved implementing the Profile page before completing Figma in
this slice, after the Starter MCP quota blocked design authoring. The blank draft exists
in the maintainer's Figma files (links kept privately); it is not a completed design.
Keep Figma completion pending, not retroactively claimed. The current runtime token palette,
font stacks, Button/Dialog/Notice and interaction contract remain canonical.

Five navigation slots distinguish saved combinations (Profile) from current component
settings (four later pages). This slice implements Profile only. Its four component cards
plus Cancel/Save form the six primary editor actions. Library and filename-list layouts
use quiet bordered rows; previews occupy the component view and candidate dialog. Named
resource paths wrap, native audio controls remain visible, and all media is local.

## Shared workspace behavior

The [workspace contract](docs/superpowers/specs/2026-09-13-aimloom-training-profiles-design.md)
and [execution plan](docs/superpowers/plans/2026-09-13-training-profiles.md) own the five
sections and their state boundaries. Profile manages saved combinations; Scheme, Audio,
Crosshair and Enemy manage current configuration. Preview controls can be reused across
contexts, but Profile drafts and current-setting state must remain separate.

Profile has six editor actions: four component buttons plus Cancel/Save. Candidate
Confirm stages a component; component Save choice stages the Profile; final Save writes
its JSON. Profile Cancel never rolls back changes confirmed elsewhere. Whole-Profile
application is future work with a separate entry, not an implicit part of Save.

Future screens and the website retain the Figma-first requirement unless explicitly
waived. The Profile-only exception above is recorded with the actual blank-file status in
[the Figma index](docs/design/figma/README.md). Do not claim pending designs or game acceptance.

## Historical installer visual baseline

The following installer-specific layout and stepper behavior remain the foundation for
the legacy installer/recovery utility. They do not replace the five-section product shell.
Runtime colors, typography and shared controls remain canonical for both contexts.

## MVP simplification — 2026-09-15

Use one Profile selector and four editor sections: scheme, audio, crosshair and enemy.
The Profile persists as one JSON file; previews and replacement feed Save and Apply.
No separate asset-library platform or application-history dashboard is required. Continue
the existing Figma-before-screen workflow and visual foundations below.

## Product-flow amendment — 2026-09-13

Aimloom now centers on **manual training Profiles**: background/theme, sounds, crosshair
and enemy appearance saved as one reusable combination. Design the Profile library,
four-component editor/combined preview, and bundled apply/recovery flow in Figma before
implementation. Saving, previewing, installing assets and actual activation have distinct
states; do not mark an incomplete component switch as success.

The visual/token contracts below remain the existing app foundation. They do not require
every new Profile action to become a four-step installer wizard. Reuse the current safeguards
with a concise combined change review. Website design follows the same new product story;
API-assisted background/audio generation remains a later phase. See the
[Profile product contract](docs/superpowers/specs/2026-09-13-aimloom-training-profiles-design.md).

## Figma workflow amendment — 2026-09-13

The user requires **both the website and software UI to be designed in Figma**. Existing
visual contracts below are the starting point for editable frames, variables and component
variants. Record the actual Figma file/node links and reviewed screenshots before implementing
the corresponding screens; see [ROADMAP.md](ROADMAP.md) and the
[execution plan](docs/superpowers/plans/2026-09-13-docker-crosshair-figma.md).

No Figma file has been authored in this planning task. Figma design ownership does not change
the app's runtime token ownership: `packages/app/src/installer/tokens.css` remains canonical
in code, and any approved visual change must update its mapping and verification together.

## 6. Installer workspace — approved 2026-09-06 evolution

The isolated installer follows the approved [UI design plan](docs/superpowers/specs/2026-09-06-kvk-app-ui-design-plan.md). The installer is a Chinese-language local desktop tool. The product targets Windows only. Mac is a development host for browser preview and tests, not a native App target. Windows filesystem integration is verified separately. Narrow browser views verify reflow, not mobile installation support.

### North star and identity

A quiet **target workbench** makes the intended file changes and recovery path easy to understand. Steam’s KovaaK icon is the primary reference: orange concentric target rings with a directional arrow on dark ground, **not a letter K**. `TargetMark` is an original vector interpretation, not an official client logo. McLaren contributes only a small angled navigation marker and title rule; no racing photographs, decorative telemetry, or secondary teal brand color.

The signature is `StepRail`: four ring segments represent four actual wizard steps. The ring never claims file-copy progress. The rest of the interface stays restrained, with orange reserved for current selections and the primary action. There is no dashboard or account shell.

### Canonical token ownership and mapping

Runtime ownership is Model B: `packages/app/src/installer/tokens.css` → scoped `.kvk-installer` CSS variables → shared components in `components/` and page layout in `styles.css`. This document mirrors the runtime values; the legacy `index.css` is not imported by the installer. No remote fonts or images are required.

**One colour family, two roots (user, 2026-09-20).** Install & restore — the legacy four-step
installer — was dark until v0.1.1. It now carries the workspace's light colours: the second table
below is `tokens.css`, and `packages/app/tests/installer/theme.test.tsx` keeps every colour equal to
the value the five-section workspace declares in `packages/app/src/workspace/workspace.css` (scoped to
`.profiles-app`). The two roots still differ in radius and motion, which stay where they were.
`tokens.css` is still not edited for the workspace: change workspace appearance in `workspace.css`.
Small text and icons use `--ki-accent-text`, because brand orange on white is only about 2.5:1; the
target mark and the progress ring keep `--ki-accent`.
Dialogs render inside `.kvk-installer profiles-app`, so a sheet opened from the workspace inherits the
light values. See the [workspace redesign design](docs/superpowers/specs/2026-09-16-workspace-redesign-design.md).

| Workspace override | Value | Role |
|---|---|---|
| `--ki-bg` | `#F7F6F3` | Window ground |
| `--ki-surface` / `--ki-raised` | `#FFFFFF` | Panels, tiles, dialogs |
| `--ki-text` | `#111111` | Primary text |
| `--ki-secondary` / `--ki-muted` | `#6B6B6B` | Descriptions and paths |
| `--ki-line` | `#DEDAD2` | Separators and tile borders |
| `--ki-control` | `#C4C0B8` | Interactive borders |
| `--ki-accent` | `#FF8000` | Selection and primary action |
| `--ki-on-accent` | `#111111` | Text on the orange button |
| `--ki-focus` / `--ws-accent-text` | `#A84F00` | Keyboard focus, accent text on light |
| `--ki-success` / `--ki-warning` / `--ki-error` | `#1E6B43` / `#7A5200` / `#B3261E` | State text |
| `--ws-sidebar` | `#EFEDE8` | Sidebar and inset paths |
| `--ws-hover` / `--ws-selected` | `#E8E5DF` / `#FFF1E0` | Row hover, selected tile |
| `--ws-inverse` | `#1E1E1E` | 当前使用 tag and toast |
| `--ws-success-bg` / `--ws-warning-bg` / `--ws-error-bg` | `#E7F3EB` / `#FFF4D6` / `#FBEAE8` | Tag grounds |

Radii are a named scale rather than loose values, so nesting reads as a hierarchy:
`--ws-radius-pill` 999px (tags, badges, toast), `--ws-radius-row` 10px (buttons, inputs, list rows,
thumbnails), `--ws-radius-tile` 16px (tiles, slots, status strip, previews), `--ws-radius-panel` 20px
(side panels, sheets, dialogs). `--ki-control-radius` is 10px and `--ki-radius` 20px inside the
workspace. The sidebar and the action bar stay square on purpose: both are full-bleed against the
window edges, where a radius would expose the ground behind them. Motion is 150ms for feedback and
220ms ease-out for a sheet.

| Runtime token | Value | Role |
|---|---|---|
| `--ki-bg` | `#F7F6F3` | Application and navigation ground |
| `--ki-surface` | `#FFFFFF` | Panels |
| `--ki-raised` | `#FFFFFF` | Controls and dialogs |
| `--ki-text` | `#111111` | Primary text |
| `--ki-secondary` | `#6B6B6B` | Descriptions |
| `--ki-muted` | `#6B6B6B` | Supporting labels |
| `--ki-line` | `#DEDAD2` | Panel separators |
| `--ki-control` | `#C4C0B8` | Interactive borders and scrollbars |
| `--ki-accent` | `#FF8000` | Selection and primary action |
| `--ki-accent-hover` | `#EB7600` | Primary hover |
| `--ki-accent-text` | `#A84F00` | Accent-coloured small text and icons |
| `--ki-on-accent` | `#111111` | Orange-button text |
| `--ki-focus` | `#A84F00` | Keyboard focus |
| `--ki-success` | `#1E6B43` | Confirmed successful state |
| `--ki-warning` | `#7A5200` | Recoverable caution |
| `--ki-error` | `#B3261E` | Error and blocked operation |

Body typography is Microsoft YaHei UI → Microsoft YaHei → PingFang SC → system sans serif. Latin identity and sequence numbers use Bahnschrift → Segoe UI → system sans serif. Paths use Cascadia Mono → Consolas → system monospace. Page headings are 28/36; supporting labels intentionally use a compact desktop scale. Chinese sentences have normal tracking. Full paths wrap in review and can be selected/copied without hovering.

### Layout, shapes, and motion

- Baseline viewport: 1120 × 760. The desktop header is 88px, rail 200px, content padding 32px. At 900–1099px, the rail narrows to 176px and review summary moves above the table. Below 900px, navigation moves to the top and document flow becomes natural.
- Desktop main content owns vertical scrolling. Shared file review owns a bounded inner scroll area. The wizard footer stays visible without removing its normal-flow space. Step navigation resets content scroll and focuses the heading without moving the application header.
- Panels use 12px radii, controls 8px, tags 4px. Shadows are reserved for dialog separation, plus a flat background-colored footer separation band.
- Line icons use 20px geometry and 1.75px strokes. Target identity and step rings are code-native vectors. No animated background.
- Hover transitions use 130ms. Reduced-motion preferences disable transitions and animations. Forced colors keep focus and selection visible.

### Canonical components and interaction evidence

Shared behavior owners and verification are maintained in [installer UI interactions](docs/installer-ui-interactions.md). `Button`, `PathField`, `CategoryCard`, `Dialog`, `Notice`, `FileTable`, `BackupList`, and `StepRail` are installer-scoped because the old editor has incompatible snapshot/write semantics. Installation and restoration reuse these owners rather than duplicating controls.

Visual evidence and live-prototype coverage are tracked in [installer design evidence](docs/design/kvk-installer/README.md). Rendered screenshots, browser keyboard checks, and tests support claims separately; a passing static audit does not establish native Windows correctness.
