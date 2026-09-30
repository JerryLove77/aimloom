# Aimloom roadmap

Updated 2026-10-01. This is the repository-wide scheduling entry point.
[Shared workspace design](docs/superpowers/specs/2026-09-13-aimloom-training-profiles-design.md)
is the product authority. The website is designed in
[the website and explorer spec](docs/superpowers/specs/2026-09-17-aimloom-website-and-explore-design.md),
with the explorer as [amended for v0.1.5](docs/superpowers/specs/2026-09-22-website-explorer-design.md).

## Product position (user, 2026-09-22)

Aimloom's core is three things: **pasting CS2 / VALORANT crosshair codes into KovaaK, managing
the game's files more directly than the game does, and combining them into Profiles.** Each has a
known weakness today, and the versions below are ordered by them: no crosshair tuning; no search
on Theme and Sounds; and nothing can switch while the game runs.

The last one is a boundary, not a defect. The game reads `PrimaryUserSettings.json` when it
starts, keeps the settings in memory, and **rewrites the whole file when it exits** (seen on the
tester's PC on 2026-09-21: a skin applied while the game ran was gone after it quit). Only the game
can change what is in its memory, so Aimloom will never switch a theme, sound or skin as fast as
the game's own menus. **Aimloom changes the game before it starts, and does what the game cannot.**
It does not try to change a running game. Consequences:

- Theme, Sounds, Enemy and Profile apply require the game closed, at preview and at write.
- Crosshair and file adds may run while the game is open: they only place files.
- The way to change a whole setup quickly is to launch the game from a Profile (PF-LAUNCH).

The App has five sections, named **Profile, Theme, Sounds, Crosshair, Enemy** where a player sees
them (Enemy look in English) while the code keeps `scheme` / `audio`. Profile manages reusable
combinations (Theme and Sounds); each other section manages one part of the game's current
configuration. Quick import (一键拖入; code and routes keep `installer`) stays a utility outside
the five.

- **Profiles.** One JSON file per Profile holding {name, path} records; audio keeps records per
  event. Profile Save writes JSON, never the game; 应用 applies the saved JSON as one batch.
- **Game writes.** Every game write goes through the engine (Rust from v0.1.6, PowerShell before):
  backup first, a recoverable transaction, never overwriting unowned files.
- **Adding files.** Files can be added from outside the App (picker or drag-and-drop) and are
  copied byte for byte.

## Released

- **v0.1.1** (2026-09-19): the first Aimloom App — soft-launch note (private record).
- **v0.1.2** (2026-09-20): the App in English with a Settings popover, and the Setup —
  English App note (private record),
  Setup note (private record).

## Released: v0.1.3 — reports, a Steam account, Profile apply, enemy skins (2026-09-22)

Spec: [reports, account, updates](docs/superpowers/specs/2026-09-20-aimloom-reports-account-updates-design.md).
Built once from `ff2426f` with the path-remapping build and accepted on the tester's PC; served by
aimloom.dev and attached to the GitHub release `v0.1.3`.

- in-App problem reports with a preview of exactly what is sent (REPORT, FEEDBACK-APP), an
  optional Steam account (ACCOUNT), and a launch update check — the App's first network use, one
  origin;
- **applying a saved Profile** (PF3), and 「保持当前 · name」 showing what is kept;
- **Enemy = the game's Skin Browser** (CUR-E2), and Profile no longer manages the enemy;
- **the game-closed rule for settings writes**, and Apply about ten times faster;
- the installer page renamed 一键拖入 / Quick import; Steam-aware game discovery; older themes
  apply (CUR-S1 closed).

**v0.1.1 and v0.1.2 are withdrawn** from the site (kept in the changelog): their `Aimloom.exe`
embedded the build machine's Windows user name in dependency source paths. Copies already
downloaded cannot be recalled.

The update notice has not been seen end to end; the first chance is the next release.

## Released: v0.1.4 — the App core (2026-09-22)

Released 2026-09-22 from `54668f4` (GitHub release `v0.1.4`; aimloom.dev recommends it and still
serves 0.1.3). Accepted on `0.1.4-beta.2`; the release build itself was not opened on the tester's
PC. Not yet seen: a 0.1.3 App offered 0.1.4 by its launch check, and a real beta release through
the Settings switch.

| ID | Deliverable | Status / next evidence |
|---|---|---|
| BETA | **A beta channel**, so beta testers and release users are told apart (user, 2026-09-22). Versions like `0.1.4-beta.1`; a channel-aware update check (a beta build is offered beta updates, a release build never is); a visible Beta mark in the title and Settings; reports tagged with the channel so beta feedback is separable; **the player opts in from Settings, as on Steam** (user, 2026-09-22): a 「参与 Beta 测试」 switch makes the update check follow the beta line and its download button open the beta package; off, it follows the release line and offers the way back once a newer release exists. The App has no auto-update, so installing stays a manual download either way. The build itself carries its channel (`VERSION.txt`), and the Beta mark and report tag follow the build, not the switch. The site's Download page lists the beta package as a secondary link; no separate beta page. Same app id, same data folder: beta and release share Profiles and backups, and a beta install upgrades to the release in place. What exists already: `package-test-build.ps1 -Channel test`, `VERSION.txt` shown in Settings, `latest.json`, the version label on reports | **Built** (2026-09-22): [the beta channel design](docs/superpowers/specs/2026-09-22-aimloom-beta-channel-design.md). `latest.json` = `{version, beta}`; `installer_app_info`; semver precedence; the Settings switch; `-Channel beta`; the site's Beta section and 正式版 / Stable. Not yet seen on a real screen or through a real beta release |
| SEARCH | Search boxes on Theme and Sounds (Crosshair and Profile already have one; the `pr-search` pattern in `packages/app/src/crosshair/CrosshairPage.tsx`) | **Built** (2026-09-22) on Theme; Sounds already had it. The three search boxes share `workspace/SearchBox.tsx`. Profile's Theme and Sounds sheets got the same box on 2026-09-22 (user: 「profile里面的theme和sounds要做搜索」); the Theme sheet's grid had none, the Sounds sheet had none at all |
| PF-ADD | Profile's 「更改」 sheet gets "add from my computer", reusing `planFileAdd` (HANDOFF (private record) Entry 2b) | **Built** (2026-09-22): the add sheet opens over the Profile sheet, and an `unknown` result is reconciled inside it (`docs/installer-ui-interactions.md`) |
| PF-LAUNCH | **「用这个 Profile 启动游戏」 / "Start the game with this Profile".** Game closed → apply the Profile (the existing `planProfileApply`) → start KovaaK through Steam (`steam://rungameid/824270`). Game open → says to quit first. Steam not running → applies and tells the player to start the game | **Built** (2026-09-22): a second action in the apply dialog runs the same apply, then `installer_launch_game` opens `steam://rungameid/824270` (built in Rust, no UI-supplied target). The launch is best effort and never changes the apply's result; the status says so. Not yet seen starting a real game |
| CUR-C2 | **Crosshair tuner.** Paste a CS2 / VALORANT code → sliders for what that game exposes (length, thickness, gap, outline, colour, centre dot, alpha) → live preview on a dark and a light swatch → save as a new PNG through the existing add path. **No export back to a code, no drawing from a blank canvas** (user, 2026-09-22). See the notes after this table | **Built 2026-09-22:** `packages/crosshair/src/tuning.ts` (`tune`/`getTuningParams`/`readTuningValue`, 18 tests) plus the fine-tune section in `CodeExportDialog.tsx` and `export-controller.ts` (13 + 22 App tests). Verified by the full suite (1412 tests), typecheck, `build:installer`, and a playwright pass pasting one CS2 and one VALORANT code in zh and en with no console errors — not yet checked against the real game or Figma. |
| PF-CARDS | Profile cards in the Crosshair X layout: a corner chip naming the card, the preview filling the card's body, the name on a bottom line, an orange outline marking a card the Profile records (as opposed to one that keeps the current game setting), and a single muted sentence for the empty state. Two cards now (Theme, Sounds); Profile no longer manages the enemy or the crosshair | **Built** (2026-09-22): `ProfilesApp.tsx`'s `Slot` renders the chip/preview/name layout, reusing `AssetPreview` for Theme and a per-event list for Sounds; verified by `npm test`, `npm run typecheck`, `npm run build:installer -w @kvk/app` and a playwright pass in zh and en. Not yet seen against Figma |
| WEB-CROSSHAIR | **A crosshair code tool on aimloom.dev** (`/zh/crosshair`, `/en/crosshair`): paste a CS2 or VALORANT code, preview it on a dark and a light swatch, fine-tune it with the App's controls, download the PNG for KovaaK. Runs in the browser on `@kvk/crosshair`'s browser-safe entry; nothing is uploaded and no network call is added | **Built** (2026-09-22): `packages/site/src/pages/[lang]/crosshair.astro` and `scripts/crosshair-tool.client.ts`, pinned by `tests/crosshair-tool.test.ts` and `build.test.ts`. Deployed with v0.1.4 (2026-09-22). Not yet seen against Figma |
| LOG | `worker.log` kept the worker's stderr in the console code page (GBK on a Chinese Windows) | **Closed:** fixed 2026-09-20 (the worker pins stderr to UTF-8); re-verified 2026-09-22 on the tester's PC in the App's launch shape — without the pin, code page 936 and invalid UTF-8; with it, readable |
| UNK | Two plain `throw`s in `Invoke-KvkInstall` (a lock failure, an unfinished batch) surfaced as `unknown` | **Closed:** fixed 2026-09-20 — they carry `BUSY` and `RECOVERY_REQUIRED`, pinned by the engine suite |
| PF4 | A → B → A → undo acceptance pass across Theme, Sounds, Enemy and Profile on the real game | **Passed** (2026-09-22) on `0.1.4-beta.2` from `856fb40`, by the user on the tester's PC: A → B → A on all four, the Beta mark, the tuner, 应用并启动游戏 and the Profile sheets' search (「都对」). The going-back path is re-applying the earlier choice; the page button that drops an unapplied choice is renamed 退出 / Cancel (user: it always meant leaving, not undo) |

Order inside 0.1.4 (the user moved the tuner ahead of PF-LAUNCH on 2026-09-22): ~~BETA~~ →
~~SEARCH + PF-ADD~~ (LOG and UNK were already closed) → ~~CUR-C2~~ → ~~PF-LAUNCH~~ → ~~PF-CARDS~~ (and
WEB-CROSSHAIR on the site) → ~~PF4~~ →
release, then the site is deployed once for all of it.

**CUR-C2 — how it can be built:**
- `packages/crosshair` already parses both games' codes into a model and renders a PNG. The
  tuner exposes that model as controls with a live preview, then 添加到游戏 through the existing
  add path, so a tuned crosshair is an ordinary PNG in `crosshairs\`.
- Each game gets its own parameter set, named as that game names them; a VALORANT code and a
  CS2 code do not share a panel.
- Out of scope: exporting the result as a code, and starting without a code.
- To settle in design: how closely the render matches each game, and what "reset to the pasted
  code" does.

## Released: v0.1.5 — the website explorer, PowerShell 7 inside (2026-09-30)

Curated backgrounds, sounds and crosshairs to download from aimloom.dev, plus a link to them from
the App. Moved behind the App core on 2026-09-22 (user: 「网页探索页放在0.1.5」). Decided with the
user on 2026-09-22 and written down in
[the explorer amendment](docs/superpowers/specs/2026-09-22-website-explorer-design.md):

- **Three kinds, single files:** backgrounds, sounds, crosshairs (with the CS2 / VALORANT code
  when there is one). A download is the raw file; the player drags it into the matching Aimloom
  page, or copies it into the game folder and presses 刷新. No ZIP manifest, no Import entry, no
  Profile JSON.
- **Only content whose author has given permission.** The user asks the authors; the pages and
  the publish command come first, content when permission exists.
- **D1 for metadata** (the site's existing database), **R2 for files** behind `dl.aimloom.dev`,
  published only by a maintainer command. Routes are added to the existing Worker.
- **Download requests are counted** per file per day, with nothing about the requester; the
  Privacy page says so.
- **Sign-in and uploads are in** (user, 2026-09-22 evening, reversing the morning's decision): Steam
  OpenID sign-in, needed for uploading only; trusted creators go live at once, others are reviewed.
- **The App gains a link** to the explorer on Theme, Sounds and Crosshair, released as
  **`0.1.5-beta.N` through the beta channel**; the stable release stays 0.1.4 (user, 2026-09-22).
  On 2026-09-30 the user chose to release 0.1.5 as the stable release instead.

| Step | Status |
|---|---|
| Amend the spec | **Done** 2026-09-22; §10 records what changed while building |
| Figma: list and detail, zh/en × desktop/phone | **Drawn** 2026-09-22 (round 1); the user moved on to code |
| Worker routes, pages, migration, publish command | **Live** 2026-09-23: built 2026-09-22 (site suites, node and workerd; axe at 1280/390 on a local Worker with fake sample items), deployed with PR #15 |
| **Sign-in through Steam and uploads** (spec §11; user, 2026-09-22 evening: 「做登录和允许上传」): anyone signed in may upload, a trusted creator's file goes live at once, others wait for the admin's review; a creator sees and withdraws their own | **Live** 2026-09-23 (PR #15): `auth.ts`, `uploads.ts`, migration 0003, workerd tests. The user signed in and uploaded for real |
| **Safer, simpler uploads** (PR #16): a three-field form, the display name picked once at `/explore/welcome/`, a Turnstile check on every upload, strict media checks (PNGs re-encoded, WAV and Ogg fully accounted for) on upload, approval and publish, and `site:backup` | **Live** 2026-09-23. An upload through Turnstile on the real site, and the rotated Turnstile secret, reported done by the user on 2026-09-23. Backups: D1 Time Travel (7 days) plus `site:backup` about weekly. Preview deployments keep uploads closed by design |
| App link on Theme, Sounds, Crosshair (`installer_open_explore`) | **Built** 2026-09-22: Rust and App tests, checked in the browser demo; reported seen on Windows by the user on 2026-09-23 |
| Provision R2 `aimloom-files` + `dl.aimloom.dev`, the private bucket, the admin secret; apply the migrations | **Done** 2026-09-23 on the maintainer's Cloudflare account (site README, "The explorer") |
| Content with permission | **Open** — the user asks the authors; the explorer has little curated content until then |
| `0.1.5-beta.1` on GitHub | **Done** 2026-09-22 (pre-release only; the site's beta field is not set) |
| Deploy the site | **Done** 2026-09-23 (PRs #15 and #16; the READMEs followed in #17) |
| Release | **Stable 0.1.5**, 2026-09-30, built once from `fe2a80e` (no `beta.2`): the Setup (80,782,712 bytes) on dl.aimloom.dev, the Setup and the portable ZIP (114,017,809 bytes) on the GitHub release. The user installed the Setup in a clean Windows Sandbox and opened the App: it started without asking for PowerShell |
| **PowerShell 7 in every release** (user, 2026-09-24: a tester in China, with a proxy, saw the Setup's winget step stall with no progress; 「不行就把powershell 7直接打进aimloom」): the official 7.6.6 ZIP, pinned, in `pwsh\`, tried first by the App and the Setup; the winget offer kept as a fallback, Store first and in a visible window | **Built** 2026-09-24 on `feat/bundled-pwsh`: suites on the tester's PC, the engine suites run under the bundled copy, a real `0.1.5-test.99` Setup (77 MB) and ZIP (109 MB). **Released in 0.1.5**; its Setup was installed in a clean Windows Sandbox on 2026-09-30 |
| **Releases over 25 MiB on R2**; the site offers **only the Setup**, the portable ZIP stays on GitHub (user, 2026-09-24) | **Built** 2026-09-24 (`release:upload`, the deploy's live check, the Download page) |
| **Feedback tickets on the site**: a side panel from a fixed button and the footer; the changelog moves to the footer (user, 2026-09-24) | **Built** 2026-09-24: `/api/tickets`, migration 0004, workerd tests, checked in a browser with Turnstile's test key. Ships with 0.1.5. Not designed in Figma |

## Next: v0.1.6 — APP-NAV and the Rust engine

Set by the user on 2026-09-30 (「v016就先做app-nav和rust。瘦身，一键拖入和later都后面再说」): v0.1.6 is the
new App shell and Rust's first release. **Rust takes over** (user, 2026-09-30: 「接管是指只有rust」):
the App runs only the Rust engine and the download no longer carries PowerShell 7. It ships as
0.1.6-beta.1 first, on the website, then stable. The code slim-down's second step, the Quick import
redesign and everything under Later wait.

| ID | Deliverable | Status |
|---|---|---|
| APP-NAV | **The App becomes two big pages, and Quick import moves into Explore** — see the notes after this table | Decided by the user 2026-09-21; in v0.1.6 (user, 2026-09-30); Figma drawn and approved 2026-10-01; **built** on `feat/app-nav` and checked on the test PC (test builds 0.1.6-test.1–3); ships as 0.1.6-beta.1 first (user, 2026-09-30) |
| ENGINE-RUST 1–4 | **The engine in Rust takes over:** the spike, the whole engine with PowerShell goldens, then the App running only Rust with no PowerShell in the download — see the notes after this table | Steps 1–2 **merged** 2026-10-01 (PR #24); step 3 (a Settings switch) built and then replaced by the takeover (user, 2026-09-30); step 4 in progress on `feat/app-nav` |

**APP-NAV — the shell the user described (2026-09-21):**
- The App's sidebar becomes **two top-level pages** instead of one flat list: **更改配置** (what
  a player changes about their own game) and **探索 / Explore** (what a player gets from
  elsewhere).
- **Quick import moves onto the Explore page.** It belongs with getting content from outside, not
  beside the editors. In v0.1.6 it moves as it is; its redesign (INSTALL-REDESIGN) comes after
  v0.1.6 (user, 2026-09-30).
- **The website's explorer ships first.** The App's Explore page follows its design, so the
  catalog and its shape are settled on the web before the App renders them.
- **Decided 2026-10-01 (user):** in v0.1.6 the App's Explore page holds Quick import (as it is)
  and a way into the website's explorer, which opens the site; browsing the catalog and
  downloading inside the App come after v0.1.6 (APP-EXPLORE, below). **Profile (组合管理) sits
  under 更改配置**, first: a Profile is also a change to the player's own game.
- **Decided 2026-10-01 (user):** English calls 更改配置 "Customize"; its five sections are listed
  only while one of them is open; a config pack folder dropped on Explore opens Quick import with
  it (Quick import reads folders only, so a ZIP is refused with "unzip it first").
- CLAUDE.md, the interaction contract and the 2026-09-13 workspace spec describe the new shell.

**Also in v0.1.6 (user, 2026-09-30):**
- **A Profile is a complete snapshot** (「profile里的保持当前没有意义」): format v2 records the
  theme and all six sound events, a new Profile starts as the game is, and 当前使用 marks the
  Profile the game holds (grey = in use, bright = can be applied). Version 1 Profiles are refused;
  the testers recreate theirs (no data migration).
- **Version 0.1.6 on the branch**, so its test builds (0.1.6-test.N) no longer sort below the
  released 0.1.5 and Settings stops offering 0.1.5 as an update.
- **A mainland-China download**: the maintainer puts the same Setup on a network drive and links
  it from the promotion posts (Bilibili, Xiaohongshu, Xiaoheihe), with its SHA-256. The website
  does not link it for now. Why a drive: dl.aimloom.dev and GitHub are often slow there, object
  storage bills every download to the owner, and an ICP filing is out of reach for `.dev`.

**ENGINE-RUST — the engine in Rust:**

Added to the near-term plan by the user on 2026-09-29
(「把rust改版加到最近的计划里，可以平缓过度，比如安装包里有两个选项，powershell 7和rust」), ordered
after the bundled-PowerShell release (v0.1.5). The goal is a release of a few MB without
PowerShell. The first plan was a gradual transition (both engines in every release, a Settings
switch); on 2026-09-30 the user chose a takeover instead:

- **v0.1.6 runs only Rust.** The App always starts `Aimloom.exe --worker` and never PowerShell; the
  Setup and the portable ZIP carry `Aimloom.exe`, its readmes and `VERSION.txt` only (a few MB),
  and the Setup no longer looks for or offers PowerShell 7. There is no engine switch.
- **PowerShell stays in the repository until Rust has proven itself** (「认为没问题发rust版本后再删掉
  powershell的痕迹」): the PowerShell engine, its 17 suites, the parity goldens and CI's pinned
  PowerShell remain, as the reference Rust is held to. Until then an engine change is still one PR:
  PowerShell, the regenerated goldens and Rust.
- **The fallback is a branch, not a switch.** `backup/0.1.6-powershell-default` (kept on the
  maintainer's machine) holds the dual-engine build with PowerShell as the default.
- **Either engine reads what the other wrote.** Backups, first-protection records, Profiles, and an
  unfinished (`recovery-required`) batch left by PowerShell (0.1.5) are recovered by Rust, and the
  other way round; `cross.test.ps1` tests both.
- **An upgrade may leave the old `pwsh\` and `scripts\` folders** (a silent install, or declining the
  uninstall step). They are unused and harmless; the Setup keeps its rule of never deleting
  anything (user, 2026-09-30), and the beta's known issues say so.
- **Before the beta:** every real write done once through Rust on the test PC and seen in the game
  (a checklist the user clicks through while Claude checks each step remotely). **Deploy the site
  first:** the live Worker refuses unknown report keys, so a 0.1.6 report (it carries
  `system.engine`) is refused until the site from this branch is deployed; 0.1.5 reports keep
  working either way.
- **Before stable:** a Profile saved by 0.1.5 or earlier (format v1) must not stay an unexplained
  "couldn't be read" row: the message says it was made by an older Aimloom and must be created
  again, the row offers 删除, and the release readme and notes say so (both engines, with
  regenerated goldens). Also re-check every writer's refusal when the game's settings file lacks
  one of the six sound keys (a Profile now writes all six).
- **The Setup now stops the engine too.** Its running-app check ends every `Aimloom.exe`, the
  worker included, so running the Setup while a write is in progress leaves that batch for
  recovery (the engine's recovery path handles it; it is on the test checklist).

| Step | Deliverable | Status |
|---|---|---|
| 1 | **Spike**: the write core plus Enemy in Rust, compared with PowerShell goldens, and cross-restores in both directions; a go/no-go report with measured numbers | **Done** 2026-10-01 (PR #24), folded into step 2 |
| 2 | **The whole engine in Rust**: every operation the App sends (discover, locate, catalog, backups, every list and plan, execute for install and restore, export, Profiles), each pinned by PowerShell goldens | **Merged** 2026-10-01 (PR #24): all 26 operations; 52 parity cases match PowerShell on the Mac and on Windows; the cross-engine test passes 6/6; CI runs both |
| 3 | **Choosing the engine** in Settings | Built on `feat/app-nav` and used on the test PC, then **replaced by step 4** (user, 2026-09-30); it survives on `backup/0.1.6-powershell-default` |
| 4 | **Rust takes over (v0.1.6)**: the App runs only Rust; no PowerShell in the Setup or ZIP; the Setup's PowerShell detection and winget offer go; reports send `engine: "rust"` and no PowerShell version; 0.1.6-beta.1 first, then stable | In progress on `feat/app-nav` |
| 5 | **PowerShell removed from the repository**, once the Rust release has proven itself: the PowerShell engine and its 17 suites, CI's pinned PowerShell and the pin, the goldens frozen into Rust's own regression tests (the one-PR rule retires), the console wizard (`安装配置.cmd` / `恢复配置.cmd`: delete, or a command-line mode of `Aimloom.exe`), and every remaining mention | After 0.1.6 stable; before THEME-RENAME, so the rename touches one engine |

## After v0.1.6

| ID | Deliverable | Status |
|---|---|---|
| INSTALL-REDESIGN | **Quick import redesigned** — see the notes after this table | Decided by the user 2026-09-21; moved after v0.1.6 (user, 2026-09-30); not designed |
| ENGINE-RUST 5 | PowerShell removed from the repository (see step 5 above) | After 0.1.6 stable |
| THEME-RENAME | **Every `scheme` in the code becomes `theme`** (user, 2026-09-30: 「把所有schema都改成theme」): folders, wire ops (`schemeList`, `planScheme`), dictionary keys, CSS and the Rust engine, across the wire mirrors. The Profile JSON already says `theme` (format v2). Players see no change | After v0.1.6 and after ENGINE-RUST step 5 (user, 2026-09-30) |
| APP-EXPLORE | **The App's Explore page reads the website's catalog and downloads in place**, adding a file through the existing add-file plan | Decided by the user 2026-10-01 (「先入口，下一版再做 App 内下载」): after v0.1.6; not designed |
| SLIM-2 | **The code slim-down, step 2: features and interaction** — fewer and simpler pages, buttons and flows; the behaviour differences step 1 recorded (for example, a job still running after 60 s locks the file-add flow but not a section apply); and **Profile apply speed** (user, 2026-09-29: 「profile 应用速度有点慢」), measured phase by phase on the tester's PC before anything changes, without weakening a safety check | Step 1 (code only, no behaviour change) shipped in v0.1.5; step 2 after v0.1.6 (user, 2026-09-30) |

**INSTALL-REDESIGN — Quick import gets redesigned (user, 2026-09-21):**
- The user's direction, verbatim: 「安装与恢复要改个名，叫一键加载之类的，而且不要让用户选择很多就是
  拖文件进来，然后我们提前设好备份，不让用户选来选去很麻烦」.
- **Renamed on 2026-09-21: 一键拖入 / "Quick import".** The user's reason: 安装与恢复 read as
  installing and restoring *Aimloom itself*. The Chinese is the user's; the English is a first
  choice that nobody has reviewed. The page behind the name is still the old wizard — the
  drag-in redesign below has not started — so for now the name promises more than the page does.
  The website keeps 安装与恢复 until v0.1.3 is released, because it describes v0.1.2.
- **Drag files in; stop asking.** Today the page makes the player find a pack folder, read a
  catalog of categories with counts, tick the ones they want, then review a preview. The new
  shape is: drop the files, we work out what they are, done.
- **The backup is arranged ahead of time, and never a question.** The engine already does this —
  per-path first-protection (首次保护状态, permanent) plus a per-batch install backup — so this
  is about removing it from the player's attention, not about building it.
- **A dropped file whose target already exists is NOT added, and the player is told** (user,
  2026-09-21). This is what `planFileAdd` already does, so no invariant has to give: nothing is
  overwritten, nothing is auto-renamed, and the player finds out rather than wondering. The
  design work is the wording and where the notice sits, not the rule.
- **Restore becomes its own one-click action** (user, 2026-09-21): 一件恢复, with each backup
  shown under a time-stamped name, and **the player picks which one**. Restore keeps a choice
  precisely because it is the one thing in the App that deletes files — the engine's rules for
  it are untouched, including the game-closed requirement and the unowned-file hard stop.
- Still to answer when it is designed: *many files at once.* Dropping a folder means many plans
  or one new multi-file plan; the engine's batch is all-or-nothing, which is the right default
  but has to be stated.
- What must survive any redesign, because the engine and the tests enforce it: unowned files are
  a hard stop even with conflict permission; install operations can never set `allowConflicts`;
  an unfinished batch forces recovery before a new install; `unknown` is never success and
  `installer_reconcile` is the only exit; and the game-closed requirement applies here (the
  `-AllowRunningGame` exception is for file placements on the current-configuration pages,
  never for install or restore).

## Later

| ID | Deliverable | Status |
|---|---|---|
| CUR-S2 | **AI-generated scenes for Theme** — describe the room you want and get a background theme | Not designed. See the notes after this table |
| RESTART | 「应用并重启游戏」: with the game open, ask it to close normally (never a kill), wait for it to exit and write its settings, apply, then start it through Steam. Give up and write nothing if it has not exited in about 15 s | Designed in outline on 2026-09-22, then set aside for PF-LAUNCH the same day: a restart is not faster than switching in the game. **Before building:** the user must approve changing the rule "never force-close" to "a normal close request the player confirmed, never a kill". Do RELOAD-CHECK first |
| RELOAD-CHECK | Does KovaaK re-read the settings file while it runs (e.g. when the Skin Browser opens)? If it does, some changes need no restart | Not tested; believed not |
| CUSTOM-SKINS | Enemy skins from the player's own images | **Impossible unless the game is shown to load a skin from outside the pak.** See the notes after this table |
| LOGO | A logo and wordmark that carry the name's weaving meaning: interlaced lines, or a crosshair drawn as woven threads | The user's direction, 2026-09-19; Figma first. The site footer already explains the name ("Aim + loom: …") |
| PUB | Public source release | Deferred on 2026-09-19. The plan is AGPL-3.0, a clean history (no session links, a noreply author), CI and a secret scan. The method is chosen when it happens |
| CHINA | Reaching players in mainland China | Answered 2026-09-21, nothing to build yet. See the notes after this table |
| LW0–LW2 | Windows local-browser launcher and transport | Superseded in practice by the Tauri App; kept only for its delivery plan (private record)'s access-control notes |

**CUR-S2 — the boundary to settle first:**
- The App is offline except for its three v0.1.3 calls to `aimloom.dev`, so where the model runs
  is the first decision. The options:
  - generation on the website, producing a theme `.json` the player drags in — the App stays as
    it is;
  - the App calling an AI service with the player's own key;
  - a local model.
- Whatever generates it, the output is an ordinary theme file that must pass `parseScheme` and
  include the fields 应用背景 needs. It enters the game through the existing `planFileAdd`
  path, with its duplicate-name refusal.
- Needs a brainstorm and a spec before a plan.

**CUSTOM-SKINS — what the surveys found ([research note](docs/research/kovaak-skin-browser.md)):**
- 2026-09-19: the enemy settings hold colours, glow, outline and material only; no image folder
  besides `crosshairs\`; scenarios reference built-in textures only.
- 2026-09-21: the game's Skin Browser (Esc menu) offers per-shape skins. The choice is stored in
  `PrimaryUserSettings.json` → `characterModelOverride.{Cylindrical,Cuboid,Spheroid}` →
  `{characterModel, characterSkin}`. The skins themselves exist only inside the 6.9 GB pak: 15
  rows in the DataTable `CharacterSkinPreviewViewModelDataTable`, 3 for every shape and 12
  humanoid-only. No skin image is anywhere on disk. This is what CUR-E2 (done) chooses among.
- The next evidence, if ever wanted: the game loading a texture or mesh from outside the pak
  (a Workshop item, the map editor). Until then, nothing to build.

**CHINA — answered 2026-09-21, nothing to build yet:**
- The user asked whether Supabase or Vercel would help reach players in mainland China. **No.**
  Supabase is AWS-hosted and reported unreachable from there; Vercel has no mainland point of
  presence and `*.vercel.app` is DNS-poisoned with SNI blocking. Both converge on the same gate
  as Cloudflare — an ICP filing plus an in-China delivery layer — so switching costs a migration
  and buys nothing.
- The App is offline-first and all three of its network calls degrade gracefully, and Steam
  resolution is **server-side**, so a China player never needs `steamcommunity.com` (which is
  blocked there) — only `aimloom.dev`. What a China player actually cannot do is **download
  the App in the first place**, and later browse the explorer.
- The order, when it is wanted: measure from a real China connection first (free), then mirror
  the download with its SHA-256 published, then a fallback origin in the App (`ORIGIN` is one
  const in `net.rs`), and only then an in-China deployment.
- Full reasoning and verification steps: mainland-China access (private record).

## Done

| ID | Deliverable |
|---|---|
| PF1 / PF2 | Profiles: one JSON per Profile, library and editor with file previews |
| PF3 | Applying a saved Profile: one batch, any missing file refuses everything (v0.1.3) |
| KEEP-NAMES | 「保持当前 · name」: the library, the editor and the apply dialog name what is kept (v0.1.3) |
| CUR-S / CUR-A / CUR-C / CUR-E | The four current-configuration pages. Audio picks by row, with event tabs; Crosshair is built around adding a code or a PNG |
| CUR-S1 | Older themes that lack ceiling or ramp fields apply the fields they have (v0.1.3; 29 of 31 themes accepted, from 14) |
| CUR-E2 | Enemy = the game's Skin Browser, per shape, from the game's own 15 skins; the colour feature and Profile's enemy slot removed (v0.1.3) |
| GAME-CLOSED | Every writer of `PrimaryUserSettings.json` requires the game closed, at preview and at write; reading the backups went from 12 s to 2.4 s (v0.1.3) |
| STEAM-DISCOVERY | The game is found through Steam's library list (registry + `libraryfolders.vdf`, app id 824270), not by guessing folders (v0.1.3) |
| IMP | Adding themes, sounds and crosshairs from outside the app: picker and drag-and-drop, byte-for-byte, undoable |
| NAME | The product is named Aimloom (the Chinese name was dropped on 2026-09-19); the data folder moved to `%LOCALAPPDATA%\Aimloom` without splitting data |
| W1 / W2 | The bilingual product website, designed in Figma, serving the release |
| A2 / release | v0.1.1: built on Windows from `main`, browser-download gate passed, released 2026-09-19 |
| I18N | The App in English, with a Settings popover (Follow Windows / 中文 / English); engine, native and package messages carry both languages. Released in v0.1.2 |
| SETUP | `Aimloom-Setup-v0.1.2.exe`: per-user install, refuses the data folder, offers PowerShell 7 with consent, upgrades in place; the ZIP stays as the portable download. Released in v0.1.2, 2026-09-20 |

## Boundaries

- Reuse the existing component implementations and the engine's backup/restore; no second
  writer.
- Preserve sensitivity, DPI, FOV, gameplay, unrelated components and original source assets.
- Preview is read-only. Every game write keeps its checks, stale-source protection,
  confirmation and honest recovery status.
- **Aimloom does not try to change a running game.** Every writer of `PrimaryUserSettings.json`
  requires the game closed; the running-game waiver (`-AllowRunningGame`) is only for writes that
  place files — crosshair replace/add and theme/sound adds — and never for install or restore.
- The App talks to one origin, `aimloom.dev`, for reports, the Steam account and the update
  check, and degrades without it; anything beyond that is a visible design decision (see CUR-S2).
- **No code-signing certificate** (user, 2026-09-20): Aimloom will not buy one. The SmartScreen prompt stays a
  known issue, explained on the Download page and in the Guide; do not propose signing again.
- Windows is the player target. Mac and the browser are development and preview hosts.
  Players need no WSL or Node.
