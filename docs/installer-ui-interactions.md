# Installer UI interaction contract

Scope: Profile workspace and legacy React installer utility; Chinese (`zh-CN`), offline desktop tool. The shared workspace product contract owns section/state boundaries. Installer contracts live in `contracts.ts`, `state.ts`, and `controller.ts`; Profile contracts live in `profiles/model.ts`, `bridge.ts`, and `editor.ts`. Visual intent and exact runtime token ownership are in [DESIGN.md](../DESIGN.md#6-installer-workspace--approved-2026-09-06-evolution).

## Canonical UI map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| CRUD | `controller.ts`, `profiles/editor.ts` and PowerShell worker | v0.1.x file-operation design and shared DTO | Preview / confirmed installation / confirmed recovery; no row-level edits or implicit deletion | Controller, GUI protocol and full distribution fixtures |
| Form | `components/PathField.tsx` | This interaction contract and UI design spec | Native labelled text field, direct edit plus native folder picker; invalid text linked with `aria-describedby`, first invalid field focused; cancel preserves path | Root flow tests, `LocationPage` |
| Select/Listbox | Native `<select>` in Profile audio component editor | Profile workspace section below | Six fixed audio events; OS-owned popup; real label and keyboard semantics | `page.test.tsx` and browser audio-event checks |
| Selection | `components/CategoryCard.tsx` | This interaction contract and UI design spec | Native checkbox over whole card; empty categories disabled; no implicit Primary opt-in | `components.test.tsx`, `views.test.tsx` |
| Search and table | `components/FileTable.tsx`, `file-query.ts` | This interaction contract and UI design spec | Local immediate substring search, clear returns focus, 30 rows/page, overwrite-first sorting, full paths accessible; filter changes view, not plan | `file-query.test.tsx` |
| Dialog | `components/Dialog.tsx` | This interaction contract and UI design spec | App-owned modal, safe initial focus, Tab/Shift-Tab wrap, Escape closes, focus returns to trigger | `components.test.tsx` |
| Conflict | `components/ConflictDialog.tsx` | This interaction contract and UI design spec | Explicit separate permission, no remembered checkbox; unowned files never offer overwrite | `components.test.tsx` |
| Feedback | `components/Notice.tsx`, `pages/ExecutionPage.tsx` | This interaction contract and UI design spec | Persistent inline notices with icon/text; final outcomes from execution result; no critical toast-only state | `views.test.tsx` |
| Scrollbar | `styles.css` | This interaction contract and UI design spec | Global installer baseline; main scroll owner on desktop, bounded table scroll, natural narrow document flow | Browser desktop/narrow inspection |
| Navigation | `ProfilesApp.tsx`, `InstallerApp.tsx`, `components/StepRail.tsx` | This interaction contract and UI design spec | Five product sections (Profile implemented); legacy utility retains three routes and four install steps; heading focus on transition; preserve choices; running/unknown locks navigation | Root flow tests and browser |
| Window lifecycle | `window-lifecycle.ts`, native shell | This interaction contract and UI design spec | Running/unknown block departure; browser final unload guard; native blocked-close event opens app-owned dialog; reconciliation uses bridge | `window-lifecycle.test.tsx`, native tests |

## Operations and states

Location → validate game/backup ownership → validate pack → choose content. No writes occur on discovery, folder selection, navigation, or preview. Changing game, pack, or categories invalidates the plan. Discovery with multiple candidates requires an explicit radio choice.

Themes, sounds, and crosshairs are independently selected. UI, palette, and Primary are explicit opt-ins. Primary shows its sensitivity/DPI/FOV replacement warning at selection and review. Pack counts and skipped files come from the catalog.

Preview displays the full engine plan and aggregate counts. Search, filtering, and pagination are local session state, not URL state, because local paths are private and the app is not a shareable browser workflow. Native text input preserves IME composition; there is no Enter-to-execute shortcut.

Install confirmation sends the reviewed plan once. Stale plans preserve input and require new review. Running operations show named real stages, and numeric progress only when both completed and total are reported. The controller prevents duplicate execution and keeps uncertain completion locked until reconciliation. React StrictMode effect replay cannot permanently dispose the live controller; actual unmount disposes subscriptions and polling after a microtask remount check, without terminating a worker.

Recovery is independent of the configuration pack. Records are newest first with interrupted batches first, 30 records per page. The first-protection entry means each recorded file’s state before its first tool modification. Empty, missing first-protection, damaged-backup, conflict, and unowned-file states have distinct guidance. Recovery results return to the backup route; the result batch ID remains available for the new restore record.

Conflict confirmation shows the exact affected paths. “返回核对” and Escape preserve the preview and never execute. “另存当前文件并继续恢复” is the only explicit allow-conflicts trigger. Unowned paths are blocked even with conflict permission.

Outcome labels distinguish completed install, completed restore, no change, rollback, remaining recovery, unknown execution, and preflight rejection. No simulated ETA, percentage, or automatic game launch. A demo badge and demo-result label remain visible in browser-only development preview.

## Close and accessibility contract

The native shell owns actual close prevention for active/unknown jobs and emits `installer-close-blocked`; the entry converts that to `kvk-close-blocked` for the app dialog. A browser `beforeunload` guard is only the final navigation lifecycle safeguard. No normal action uses browser `confirm`, `alert`, or `prompt`.

The semantic keyboard baseline includes visible focus, native checkbox/radio behavior, real buttons, labelled search, focus restoration, persistent errors, and reduced-motion/forced-color styles. 390px browser testing verifies reflow only. Full Windows scaling and native worker behavior require their own verification.

## Workspace — 2026-09-17

Supersedes "Profile workspace — 2026-09-15". All five sections are implemented: Profile owns
saved combinations, and Scheme / Audio / Crosshair / Enemy each own one part of the game's
current configuration. **2026-09-19:** a player sees those four named Theme, Sounds, Crosshair
and Enemy (Enemy look in English), after the game's own words; this document keeps the code
names Scheme and Audio, which are also the folder, key and wire names. The legacy installer is reachable from the utility action; its return
action is blocked during unresolved operations.

### The five kinds of state

Every button touches exactly one, and its label and note say which:

1. **The game's current configuration** — changed only by a section's own primary action
   (应用背景 / 应用音效 / 应用外观, and on Crosshair 添加到游戏 / 替换 inside its sheets), which
   goes through the engine.
2. **A saved Profile JSON** — changed only by 保存组合.
3. **A Profile draft** — changed by the name field and by a sheet's 用于此组合; discarded by
   取消编辑; never written to disk on its own.
4. **A section's pending choice** — a selected tile or an edited audio list, shown as
   「已选，未应用」; discarded by 退出 / "Cancel" (leaving the choice, never an undo of an applied change).
5. **A sheet's temporary choice** — lives only while the sheet is open.

`StatusStrip` states 1 and 4 side by side on every game-side section. Tags carry a glyph and
words, never colour alone.

### Sheets

Scheme, crosshair, enemy and audio choices for a Profile open a `Dialog variant="sheet"` — modal,
with the same focus trap, Escape handling and focus restore as any dialog, presented sliding in
from the right. The crosshair section additionally uses sheets for 粘贴准星代码, 添加准星图片
and each installed file. A Profile sheet writes nothing on its own: 用于此组合 hands the value to the draft,
取消 and Escape discard only the sheet's own choice. 用于此组合 stays disabled until the choice
differs from the draft's current value, and for a file choice until its preview has decoded.

### Adding a file from outside the app — 2026-09-18

Scheme and Enemy (主题 `.json`), Audio (音效 `.wav` / `.ogg`) and Crosshair (`.png`) can take a
file that is not in the game yet. There are two routes to the same confirmation sheet, and the
sheet is the only thing that writes:

- **The button** — 「添加主题…」 on Scheme and Enemy, 「添加音效…」 on Audio, the 「拖入或选择 PNG」
  card on Crosshair. It opens the native file picker, filtered to that kind. This
  is the keyboard and screen-reader route.
- **Drag and drop from Explorer.** Tauri intercepts the drop and hands over a real path; HTML5
  drop events never fire in the Windows app, so `dragDropEnabled` must stay `true`. One listener
  serves the whole window (`workspace/file-drop.ts`).

Rules:

- **Only the active section reacts.** A file of another section's kind is refused with a toast
  that names the section that takes it; more than one file, or an unsupported type, is refused
  the same way. Profile and the legacy installer never take a file. While a section is applying
  or unresolved, a drop is refused rather than queued.
- **While the file hovers**, a decorative overlay (`.ws-drop-overlay`, `aria-hidden`, no pointer
  events, no animation under reduced motion) says whether the drop will be accepted.
- **The sheet** (`workspace/ImportSheet.tsx`) shows the section's preview of the outside file,
  来源, 写入位置 and an editable file name with a fixed extension. The destination is the game's
  own folder and is never chosen by the player. 取消 and Escape write nothing; Escape is blocked
  while the add is running.
- **Only 添加到游戏 writes**, through the engine's `planFileAdd`: a byte-for-byte copy that never
  overwrites, is backed up as a batch and can be undone from 安装与恢复. The sheet sends the
  SHA-256 of the bytes it previewed, and a source that changed since is refused.
- **Refusals are shown before anything is sent** where the UI can know them: a taken file name
  (case-insensitive), a sound whose name exists under the other extension, a theme whose
  internal `themeName` is already installed (the message names the installed file), and a file
  that is not a theme. The engine checks all of them again and is the authority. A file that
  cannot be read blocks the add; a preview that cannot be rendered does not.
- **Adding changes which files are installed, never what is in effect** (state 1 is untouched).
  Scheme and Enemy select the new theme as the pending choice (state 4), so 应用背景 / 应用外观
  is still required; Enemy selects it only when it has enemy settings. Audio marks the new row
  「新添加」 and keeps every pending draft. Crosshair opens its existing add sheet with the name
  taken from the file.
- An elevated app receives no Explorer drops (Windows UIPI). The button is the fallback.

### Audio picking and the crosshair selection — 2026-09-19

- **Audio: the row is the control.** Clicking a sound's row means "use this one": it replaces
  the event's draft with that single sound (state 4), exactly as clicking a tile does on
  Scheme. The row is a button with `aria-pressed`; ▶试听 is a separate button beside it and
  never selects. 应用音效 is still what writes. Rows carry 「当前使用」 and 「已选，未应用」 tags.
- **One sound is the default model.** 击杀音效 and 生成音效 can hold several sounds, but that
  editor (加入列表, ↑ ↓ 移除, 清空) sits under the disclosure 「高级：绑定多个音效」, folded by
  default. It opens by itself over a list of several sounds and cannot be folded while the
  draft holds more than one, so a list is never hidden. While it is open, rows stop being pick
  buttons and offer 「加入列表」 instead, so one click cannot wipe a list being built. List events
  also get a first row 「不使用音效」; the four MBS events hold exactly one sound and have neither.
- **Events are a row of tabs** above a full-width editor (2026-09-19, the user's choice between
  two mock-ups): 击杀音效, 生成音效 and the four MBS events, as `aria-pressed` buttons in a group
  named 音效事件. The selected event's current value is in the `StatusStrip`; each tab keeps its
  value and any pending edit in its accessible name, and a pending edit also shows a dot. The
  editor head says whether the event takes a list or one sound.
- **Search** filters the sounds by name or file name as the player types, with a clear button,
  in memory only. Adding a sound from outside clears it so the new row is visible.
- History: the tester could not tell how to replace a sound when appending was the only action
  (test.3), and asked for something simpler than two buttons per row (test.4).
- **Crosshair.** Which crosshair the game uses is chosen in the game, not here. The page says
  so in its scope line, the add sheets say 添加后请到游戏里选中它, and the success toast for an
  added file repeats it. The app still does not read or write the game's selection.
- **Crosshair is built around adding (2026-09-19, the user's choice between two layouts).**
  - Two large cards lead the page: 「粘贴准星代码」 opens the code sheet, and 「拖入或选择 PNG」
    opens the native dialog (PNG only) and then the 添加准星图片 sheet. A dropped PNG does the
    same.
  - Below them is 「游戏里已有的准星 · N 个」, with search and 刷新. It is for browsing: opening
    a tile opens that file's sheet, where 「换成别的图案…」 shows old and new side by side and
    「替换」 writes. Replacing stays because it is the one way to change what a player sees
    without reopening game settings, when the file is the one selected in game.
  - There is no status strip, preview panel or action bar. **Every Crosshair write happens in
    a sheet with its own primary button**, and the page holds nothing pending.
  - An unknown result closes the sheet and locks the page with a 核对结果 notice. Reconciling
    clears the choice, so no sheet reopens.

### Decisions

- **A.** Leaving a section closes its sheet and discards only that sheet's temporary choice.
- **B.** A section's pending choice survives switching sections, with no sidebar marker. Audio
  keeps one pending draft per event, so applying one event leaves the others pending; the action
  note names them.
- **C.** Opening another Profile replaces the current draft. Library rows are not reachable while
  editing, so no extra guard exists.
- **D.** Quitting with a draft exits with no save and no prompt. There is deliberately no
  `beforeunload` guard.
- **I.** 保存组合 is disabled while the draft equals its saved JSON. A never-saved Profile counts
  as changed. The Profile sidebar entry reads `Profile（未保存）` while a draft differs.
- **Apply (2026-09-21).** Each library row has 应用 beside 复制 and 删除, disabled with a reason
  when all three components keep current. It opens a modal (through the `overlays` slot) that
  summarises the **saved** Profile, then plan → 确认应用 → job, as the sections do; an `unknown`
  job locks the dialog and the rows until 核对结果. A refusal is shown inside the dialog with no
  confirm button. A failed execute re-plans, because the worker spends a plan on every execute.

### Feedback

A completed action shows a toast (`role="status"`, `aria-label="操作结果"`, 3s). A refused drop
uses the same toast with the `info` tone: no tick, 5s. The name is
required because a page can hold several live regions, such as a preview's 正在生成预览…. A
`Notice` carries conditions that persist: unresolved results, errors, and the fields a theme will
leave unchanged. An unknown result locks the section until 核对结果, as before.

### Controls and reads

Canonical controls remain Button, Dialog and Notice. Forms use labelled inputs, custom validation
and noValidate; failed name validation focuses the field. Audio's six fixed events use the native
select and OS-owned popup. Local search is immediate with a clear button; private paths and
queries stay in memory rather than URLs. Library pagination is 12 rows, game themes 12 tiles, and
resource listings are nonrecursive and limited to 1000 candidates.

AssetPreview owns blob and media cleanup and decode readiness. No audio autoplay anywhere:
auditioning is started explicitly by ▶试听 and stopped by leaving the event or the section.
Scheme, enemy and crosshair previews disclose that they are approximations. Native reads are
bounded, read-only, and separate from current settings and from the game plan. Browser mode is
explicitly a demo with browser-only Profile persistence and sample resource bytes; native mode
does not fall back to it on errors.

The crosshair section cannot read which crosshair the game has selected — no parsed file records
it. It replaces or adds files in the crosshairs folder and says so on the page.

### Settings — 2026-09-19, extended 2026-09-21 (Account, Feedback, Updates)

The Settings popover is owned by `Workspace`, not by any section: `SettingsState` (from
`WorkspaceShell.tsx`) holds the anchor button, the account/update bridge access and the account
and update-check storage, and is provided once, above every mounted section. Because only the
active section's `WorkspaceShell` is ever mounted, exactly one Settings button exists at a time;
whichever shell's button opened the popover renders `SettingsPopover` itself, inside its own
`.kvk-installer.profiles-app` token wrapper, so the popover reads the same tokens as everything
else on that page.

It is non-modal, not a dialog sheet: it has `role="dialog"` for assistive tech, but nothing traps
focus or blocks the rest of the page, and Tab moves on normally past it. On open, focus moves to
the currently checked language radio. Esc, or a pointer-down outside both the popover and the
Settings button, closes it and returns focus to the button. The Settings button keeps
`aria-haspopup="dialog"` and `aria-expanded`, and stays enabled while the workspace is locked — an
in-progress apply does not block reading the version or switching language. It grows upward from
a bottom anchor and does not scroll.

It has five sections top to bottom: Language · Account · Feedback · Updates · version.

A language choice applies immediately (no separate confirm) and only writes to the WebView's
`localStorage` under `aimloom.lang`; it never touches the game or the Profile draft, and it is
unrelated to Profile Cancel or any section's confirmed change.

**Account.** Empty state is a text field and a Connect button. Connect first runs
`looksLikeSteamUrl` locally; a link that fails it never calls the bridge — the popover shows the
bad-link message and nothing else happens. A link that passes calls `accountResolve`, disables
the field and the button, and shows a "looking it up" label while it is pending. A rejection
shows the error in the player's language (`errorMsg` + `useMsg()`) and stores nothing. A resolved
account is written to `aimloom.account` and the popover switches to the filled view: the Steam
name, a muted 「未验证」/"Unverified" tag, and a Remove button — deliberately no verified/connected
indicator, since nothing here is checked against anything. **If the popover unmounts while a
resolve is pending — Esc, an outside click, or switching sections closes it before
`accountResolve` settles — the eventual result is discarded: nothing is written to storage and no
component state is set.** `SettingsPopover` holds a mounted ref, set false in its unmount cleanup,
and both the resolve and the reject branch check it before touching storage or state. The
Connect button is disabled while a request is in flight, so repeated clicks while resolving
still produce exactly one call.

**Feedback.** 「发送问题报告…」/"Send a report…" closes the popover and calls `openReport()`,
which opens the report sheet (below). 「打开日志文件夹」/"Open log folder" calls the bridge
directly and does not close the popover. Under both, `feedback@aimloom.dev` is rendered as
plain text — not a button, not a link, and not `user-select: none` — so it can be selected and
copied like any other text on the page.

**Updates.** A switch, on by default, persisted through `writeUpdatesEnabled`/read through
`readUpdatesEnabled`; flipping it takes effect on the *next* launch, since the check itself only
ever runs once, from `Workspace`, on mount. Below the switch, what the launch check found: when
it is disabled, or the check has not yet answered, or it answered but could not trust a latest
version, nothing is shown — a failed or disabled check is silent, never an error the player has
to dismiss. When the installed version is current, one sentence says so. When a newer version
exists, the sentence names it and a Download button opens the website's download page in the
player's language (the *current* UI language, not a stored preference). The Settings button shows
a small dot next to its label, and its accessible name gains the same "a newer version is
available" sentence, whenever a newer version is known **and the popover has not yet been opened
in this session** — opening it once clears the dot (and the extra wording) for the rest of the
session, even after the popover closes again; it returns on the next launch if the version is
still newer, since nothing about having seen it is persisted.

### The report sheet — 2026-09-21

`packages/app/src/workspace/ReportSheet.tsx` (`report-controller.ts` owns its state) — send a bug
report from inside the App (spec §2.2). It is a `Dialog variant="sheet"`, same focus trap, Escape
and close rules as every other sheet, opened from Settings' 「发送问题报告…」.

**Where it renders, and why it is not `overlays`.** Every page mounts its own `WorkspaceShell`,
and only the active page's shell is ever mounted, so the workspace root has no single `overlays`
prop to hand this sheet to (a page's own sheets pass through *that* page's `overlays`, which the
report sheet is not part of). Instead `Workspace` owns the sheet's open/closed state, builds the
`<ReportSheet>` element, and publishes it through `SettingsState.rootOverlay` (default `null`);
`WorkspaceShell` renders `{settings.rootOverlay}` right beside `{overlays}`, so it still sits
inside the same `.kvk-installer` token wrapper as every other sheet, whichever page is active.

**A second render location: Install & restore.** While that legacy installer is open
(`Workspace`'s `installer` flag is true), every section page's `isActive` is false and each
returns `null` before mounting its own `WorkspaceShell` — so `settings.rootOverlay` has nowhere
to render there either. `Workspace` passes the same `rootOverlay` element straight into
`InstallerApp`'s `overlays` prop instead, rendered inside its own `.kvk-installer` root (task 12,
spec §2.3). The two paths never run at once: `rootOverlay` is one element built once by
`Workspace`, and only one of "a `WorkspaceShell` is mounted" or "`InstallerApp` is mounted" is
ever true, so it is never rendered twice. `InstallerApp` also takes `onSendReport` /
`onOpenLogs` for its Help page's Feedback block (Install & restore has no Settings button to
hang the sheet off of) — both are optional and the block omits what it cannot do when they are
absent, so `InstallerApp` keeps rendering correctly standalone (tests, or any future caller that
does not wire them).

**Opening: locked yes, another sheet no.** It can open while a section is locked — it writes
nothing to the game. It refuses to open while another sheet is open: every sheet in the app is a
`Dialog`, so `Dialog.tsx` keeps one small external counter of currently-open dialogs
(`isAnyDialogOpen()` / `useAnyDialogOpen()`) — the smallest signal that lets `WorkspaceShell` know
"some page's own sheet is open" without every page threading that fact upward by hand.
`WorkspaceShell` disables the Settings button whenever that counter is nonzero (unrelated to
`locked`, which never disables it), and `Workspace.openReport()` checks the same counter itself
before opening, as a second, defensive guard independent of the button being reachable.

**Form → preview → send → result.** 「发生了什么？」 and 「联系方式」 are capped at 2,000 / 200
UTF-16 units in the field itself (the same way the backend counts them), never after a refusal;
the description shows a running `{count} / {max}`. 「附上日志」 is on by default. The account line
reads the account once when the sheet opens (`readAccount(storage)`), same as `langChoice` /
`lang` (`useLang()`) and whether a game folder is known (`readGameRoot(storage) !== null`).
「查看将要发送的内容」 expands a read-only, scrolling, monospace box showing *exactly* the text
`reportPreview` returned — never an editable field, and Send is disabled while it is loading (it
is reachable through nothing else). Editing description, contact or the log checkbox after a
preview collapses the box (mirrors `planFileAdd`'s ownership rule, spec §3.3): the native layer
keeps one built report per session, and `reportSend(sha256)` only accepts the hash of what it
still holds. Send always ends up asking for a valid preview of the *current* input first —
building one silently if the player never expanded the box, or if an edit changed it — then sends
that preview's hash; it can never send a stale one.

`report-controller.ts` keeps that promise with two distinct guards, not one, because a mutation
test showed the obvious one (nulling the kept preview on every keystroke) is dead weight next to
the other:

- **What to reuse** — `kept.key`, the JSON of the exact input a built preview came from. An edit
  produces a different key, so a stale `kept` is simply never matched; no separate "invalidate"
  step is needed for this on its own.
- **Whether a request still resolving is allowed to write `kept` at all** — a `generation`
  counter, bumped whenever `send()` starts or the sheet closes (`closeSheet()`). This is the
  guard the key comparison cannot provide: a Retry after a failed send, or a reopen after Cancel,
  very often has the exact SAME key (nothing was edited), so a preview request that was still in
  flight at that moment — impossible to cancel — could otherwise resolve late and quietly
  repopulate `kept` with bytes the native layer has already moved past, so an untouched Retry (or
  an untouched reopen) would resend a hash that comes back `PLAN_STALE` right after the sheet told
  the player their text was safe. `ensurePreview` also de-duplicates by key, so Send while a
  preview is already loading awaits that one request instead of starting a redundant second call.

**While sending**, the sheet cannot be closed: Esc, the scrim (already inert on every `Dialog` —
nothing wires a click handler to the backdrop) and Cancel all do nothing, and Send is disabled so
a second click cannot start a second request.

**Closing keeps the draft; the controller does not.** `report-controller.ts` is created once by
`Workspace` and lives for the whole session — NOT per mount of `ReportSheet` — because this
repository's rule is that a draft survives ("every page stays mounted so drafts and pending
choices survive switching"), and a fresh controller per open would silently destroy a typed
report on an Esc or a mis-click. `closeSheet()` (Cancel, Esc) keeps
`description`/`contact`/`attachLog` untouched but always resets the *display* to `form` and drops
any kept preview (bumping `generation`, per above) — so reopening never shows a stale
`sent`/`failed` screen, and a kept preview never survives a close: reopening rebuilds one on
demand rather than risking a hash built from a session the player has already left. **Leaving the
sent screen clears the draft, however the player leaves it:** 「完成」 calls `finishSent()`, and so
does `closeSheet()` when the phase is `sent`. Once a report has gone out its text is no longer a
draft, and keeping it because the player pressed Esc rather than 「完成」 would put an
already-sent report back in front of them, one click from a duplicate.

**Result.** Success shows the report number with 「复制」 (guarded: `navigator.clipboard` does not
exist in every environment, and a missing one just leaves the button inert) and the sentence to
quote it when writing to `feedback@aimloom.dev`; 「完成」 closes the sheet. Failure shows the
reason in the player's language, that what they typed is still there, the address as selectable
text, and 「打开日志文件夹」. **Nothing retries automatically** — a failed send consumes the kept
native report, so 「重试」 only returns to the form with everything intact; the next Send builds a
genuinely new preview (the log tail may have moved).

### Adding a file from a Profile sheet — 2026-09-22

Theme's «更改» and Sounds' sheet (`ResourceSheet.tsx`, `AudioSheet.tsx`) can now add an outside
file too, through the same `planFileAdd` chain the Theme and Sounds pages use (§ "Adding a file
from outside the app", 2026-09-18) — reused unchanged, never a second write path.

**The add sheet stacks on top of the Profile sheet, as a second, simultaneously-open `Dialog`,
instead of hiding or closing the Profile sheet underneath it.** `Dialog.tsx`'s open-sheet signal
(`isAnyDialogOpen`) is a *counter*, not a boolean, precisely because more than one sheet can be
open at once; each `Dialog` instance scopes its own focus trap, Escape and Tab handling to its
own subtree, so two open dialogs do not contend for focus. The alternative — toggling the
Profile sheet's own `open` prop off while the add sheet is up — would re-run its
opening `useEffect` on the way back and silently reset the player's in-progress choice (in
particular AudioSheet's multi-event `temp` draft, which can hold edits to several events at
once); that is exactly the state loss "A Profile sheet writes nothing on its own" (above) exists
to prevent. The Profile sheet stays open, visible behind the add sheet's own backdrop, for the
whole add.

**`unknown` is reconciled inside the Profile sheet, not the add sheet.** An add whose result
comes back `unknown` closes the nested add sheet — mirroring the page's own rule that an
unresolved add closes its sheet — and the Profile sheet itself shows the page's own wording and
its own 「核对结果」/"Check result" button, disabling choosing, 用于此组合/Cancel and further adds
until reconciled. Reconciling calls `reconcile(operationId)` for the very operation that came
back unresolved (kept by `ProfilesApp`, since only one Profile sheet is ever open) and then
refreshes the same way a normal add does: Theme re-reads the game's installed list, Sounds
re-reads its own folder. Nothing distinguishes "added" from "not added" beyond that refresh — the
same as Theme and Sounds themselves, which never say which one it was, only show the list as it
now stands. While unresolved, the whole Profile page locks too (`Save`/`取消编辑`/navigation),
the same as an unresolved section page locks itself.
