# Workspace redesign — implementation design

Date: 2026-09-16. Branch: `feature/scheme`. Status: approved direction, implementation pending.
Design source: the maintainer's workspace Figma file, indexed in
[docs/design/figma/README.md](../../design/figma/README.md). The Figma **Notes** page is part
of this design; where this document and Notes differ, this document wins and Notes is updated.

## Goal

The five-section workspace should always answer four questions without the user knowing
the state model:

- Which configuration am I changing?
- Is my choice in effect yet?
- Where does Save write?
- What does Cancel discard?

This is a presentation and interaction change. Engine write rules, the wire contract,
Profile JSON and backup behaviour do not change.

## Non-goals

- Applying a whole Profile in one action. It is deferred until after the first release
  (ROADMAP PF3), and the redesign adds no entry point for it.
- Reading the game's current crosshair selection. That needs in-game verification first.
- Re-theming the legacy "安装与恢复" installer utility. It keeps its dark tokens.
- Persisting drafts across restarts. Quitting with a Profile draft exits without saving
  and without a prompt.

## State model

Five kinds of state stay separate, and every button acts on exactly one of them.

| # | State | Owner | Written by | UI marker |
|---|---|---|---|---|
| 1 | Current game configuration | game files via engine | section Apply only | 当前使用 |
| 2 | Saved Profile JSON | `profiles/<id>.json` | 保存组合 only | library summary |
| 3 | Profile draft | `profiles/editor.ts` | Profile editor | title and nav 未保存, slot 已修改 |
| 4 | Section pending choice | each section controller | that section | 已选，未应用, strip 待应用 |
| 5 | Resource sheet temporary choice | sheet component | the sheet | 暂选 |

## Decisions

These were confirmed by the user in the Figma review.

- **A.** Leaving the section while a Profile resource sheet is open closes the sheet and
  discards the temporary choice. The draft is kept.
- **B.** A section's pending choice survives section switches, with no sidebar marker.
- **C.** Opening another Profile while editing cancels the current edit by default.
- **D.** Closing the app with a draft exits without saving and without a prompt.
- **H.** Whole-Profile application is deferred (see Non-goals).
- **I.** 保存组合 is disabled when the draft equals the loaded JSON. A new, never-saved
  Profile counts as changed.

## Visual foundation

- **Theme scope.** A light theme applies inside the workspace root only. The root class
  `profiles-app` overrides the existing `--ki-*` variables with light values, so the
  shared `Button`, `Dialog` and `Notice` adopt the theme without new component forks. The
  legacy `InstallerApp` root keeps `tokens.css` unchanged.
- **Palette.** The values come from the Figma `Semantic` collection:

  | Role | Value |
  |---|---|
  | Window | `#F7F6F3` |
  | Sidebar | `#EFEDE8` |
  | Surface | `#FFFFFF` |
  | Border | `#DEDAD2` |
  | Primary text | `#111111` |
  | Secondary text | `#6B6B6B` |
  | Accent | `#FF8000`, with `#111111` text |
  | Accent as text or focus | `#A84F00` |
  | Error | `#B3261E` on `#FBEAE8` |
  | Warning | `#7A5200` on `#FFF4D6` |
  | Success | `#1E6B43` on `#E7F3EB` |

- **Fonts.** The existing stacks stay. Figma's Noto Sans SC is a stand-in only.
- **Radii by size.** Tag 4, control 6, tile/card 10, panel/sheet 14.
- **Shadows.** Only a hairline raised shadow, the sheet shadow and the toast shadow.
- **Motion.**
  - Feedback transitions take 150 ms and panel transitions 220 ms ease-out.
  - Switching sections has no entrance animation.
  - `prefers-reduced-motion` removes transitions.
  - No backdrop blur.

## Shell

- The sidebar has two groups: 组合管理 (Profile) and 当前配置 (Scheme, Audio, Crosshair, Enemy).
- The Profile entry shows `未保存` while the draft differs from its JSON.
- The content column has three parts:
  - a header with an eyebrow, a title and a one-line scope sentence
  - a scrolling body
  - a sticky action bar with a scope note on the left and that page's actions on the right
- The brand and the 安装与恢复 utility move into the sidebar. The separate top header is removed.
- A `Toast` shows light success feedback. It is `role="status"`, auto-hides after about
  3 seconds, and never carries the only record of an outcome: the page status also updates.
- Errors remain persistent `Notice`s.

## Section pattern (Scheme, Audio, Crosshair, Enemy)

- **Select → preview → apply.**
  - Clicking an item only selects and previews it.
  - The action bar holds `取消更改` (Secondary) and a section-named primary action:
    `应用背景`, `应用音效`, `应用准星` or `应用外观`.
- **Status strip.** It sits at the top of the body and shows `当前使用 <value>` and `待应用 <value | 无>`.
- **No change → both actions disabled.** Selecting the current item returns the page to no change.
- **While applying:**
  - Controls are locked and the primary action shows loading.
  - Section navigation stays available.
  - This matches the controllers today.
- **Success.**
  - The current marker moves and the pending choice clears.
  - A toast appears. No confirmation dialog.
- **Failure.**
  - The selection and preview are kept.
  - A persistent error `Notice` shows the message.
  - This matches the controllers today, which already keep `selected` on failure.
- **Unknown outcome.**
  - A warning `Notice` appears.
  - The grid is locked and the primary action becomes `核对结果`, which calls `reconcile`.
- **Preview size.** Preview areas have fixed dimensions, so asset size never moves the list or the buttons.

### Scheme

The existing `SchemeController` already models this pattern:

| Controller | Meaning |
|---|---|
| `selected` | pending choice |
| `current` | in-effect theme name |
| `close()` | `取消更改` |

The dialog is replaced by an inline two-column layout: a theme grid (`ResourceTile`) and a
fixed preview panel using `SchemePreview`. Duplicate-name and unreadable themes stay
disabled with their reasons.

### Enemy

- **Same layout as Scheme.** A persistent info notice says only the 20 enemy fields change.
- **Current look.** The game does not record the source theme, so tiles never show
  `当前使用`. The strip shows 游戏设置里的当前外观.
- **Previews.** The preview panel renders the selected theme over current values using the
  existing `useEnemyLook`.
- **Missing fields.** Fields the theme lacks are listed before applying.

### Audio

- **Layout.** A left column of six `EventRow`s shows each event's current binding and a
  `待应用` tag when that event has a draft. The right editor shows:
  - the ordered draft list: add, move, remove and clear for kill/spawn; a single choice for MBS
  - the game `sounds/` list, with explicit audition play/stop and disabled ambiguous names
- **Controller change.** `AudioController` keeps one draft per event (`drafts:
  Partial<Record<AudioEvent, string[]>>`) instead of a single `draft`, so decision B holds
  across event and section switches.
- **Apply scope.** Apply writes only the selected event, because the engine plans one event
  per operation. `取消更改` discards only the selected event's draft.
- **Audition.** The audition stops on event change, section change and unmount, as today.

### Crosshair

- **Page label.** The page is titled 准星文件 and permanently warns that the game's selected
  crosshair is not read and that files, not the selection, change.
- **Replace.**
  1. Select a tile.
  2. Choose a PNG (`换一张 PNG…`).
  3. The preview panel shows the original and the new image side by side.
  4. `应用准星` replaces the file. The file name is unchanged.
- **Add and export.** `新增准星文件` and `准星代码转 PNG` open sheets:
  - Add uses controller mode `add`.
  - Export uses `CodeExportDialog`'s controller.
  - Both rules are unchanged: add never overwrites, and export never writes inside the game directory.

## Profile

- **Library.** Search, 刷新 and 新建组合 sit on one toolbar. Each row has 编辑, 复制 and 删除.
- **Editor.** The editor stays in the main content area:
  - name field
  - JSON location in monospace, with 查看完整路径
  - a two-column grid of four `ComponentSlot`s, each showing the draft reference, a preview
    thumbnail and one of the states 已修改, 保持当前 or 文件缺失
  - action bar: `取消编辑` and `保存组合`. Saving is disabled when unchanged (decision I).
- **Dirty tracking.** `ProfileEditor` keeps the loaded profile as `baseline` and exposes
  `dirty`. It is true for a never-saved profile, and otherwise whenever the serialized
  draft differs from the baseline.
- **Resource sheet.** It replaces today's two-level staging (candidate Confirm → component
  Save choice) with one right-side sheet:
  - **Title:** `为 <name> 选择<组件>`. The scope line: 只更新草稿 · 不保存 JSON · 不改变当前配置.
  - **Body:**
    1. fixed preview
    2. source folder and 选择文件夹
    3. search
    4. radio list, whose first row is 不记录（保持当前）
    5. an `组合当前引用` marker on the draft's value
    6. invalid files shown but not selectable
  - **Buttons:** `取消` and `用于此组合`. The latter is disabled when the temporary choice
    equals the draft or its preview is not ready.
  - **Confirm** writes the reference into the draft via `editor.setComponent`.
  - **Cancel, Escape or ✕** discards only the temporary choice. Focus returns to the slot.
- **Audio sheet.** Figma coverage is pending: it must be drawn before implementation. The
  sheet keeps today's audio semantics:
  - an event selector
  - per-event keep-current (`undefined`), none (`[]`) or an ordered list of up to 64 files
  - add, replace, move and remove
- **Sheet modality.** The sheet is rendered through `Dialog` (modal, focus trap, Escape,
  focus restore). This deviates from the Figma mock, where the sidebar looked reachable:
  while a sheet is open the sidebar is inert. Decision A still covers section changes made
  while a sheet is mounted.
- **Missing or invalid references.** They show a persistent notice and the slot's
  `文件缺失` state. A reference is never silently replaced.
- **Save failure.** The draft and editor stay open, with the error and a retry.

## Accessibility and keyboard

- **Status in text.** Every status marker is text plus a glyph, never colour alone.
- **Contrast.** Orange buttons use dark text (7.5:1). Orange text and focus rings use
  `#A84F00` (4.6:1 on the window background).
- **Headings.** Page headings take focus on section change, as today. The sheet title is the
  dialog's accessible name.
- **Audition.** Audition buttons expose `aria-pressed` and names such as `试听 Bell5` and `停止 Bell5`.

## Testing

- **Component tests.** Existing page tests are updated to the new structure and labels. The
  scope rules are asserted directly:
  - apply is disabled without change
  - cancel discards only the local scope
  - failure keeps the selection
  - unknown locks and offers 核对结果
- **Workspace tests** encode the three acceptance flows from the Figma prototype:
  - Profile cancel does not undo other sections
  - sheet cancel keeps the draft
  - save does not apply
- **Existing test preserved.** The "dialogs stay inside the token wrapper" test is kept.
- **Controller unit tests.**
  - Audio per-event drafts
  - Profile `dirty`
- **Real-browser pass.** A headless Chrome run against the browser demo checks light-theme
  rendering, sheets, toasts and focus return. Screenshots are compared with the Figma frames.
- **Unverified here.** Windows, WebView2 and in-game behaviour remain unverified by this work.
