# CLAUDE.md

This file guides Claude Code and human contributors working in this repository. A maintainer may
keep an untracked `CLAUDE.local.md` beside it with notes that are not part of the project.

## What this repository is

**Aimloom** is a Windows-only, bilingual (中文 / English) Tauri App for KovaaK's players, served
from https://aimloom.dev. It has five sections — **Profile, Theme, Sounds, Crosshair, Enemy** as a
player sees them — plus a utility page, **Quick import** (「一键拖入」). Every write to the game goes
through the PowerShell engine. What ships next, in order, is in `ROADMAP.md`. Aimloom does not try
to change a running game: KovaaK keeps its settings in memory and rewrites
`PrimaryUserSettings.json` when it exits.

- **Names.** Everything a player sees is named Aimloom: the window title and `productName`, the app
  identifier `com.aimloom.app`, `Aimloom.exe`, and the data folder `%LOCALAPPDATA%\Aimloom`
  (`tests/installer/brand.test.ts` pins these). Do not use the old Chinese name 瞄织 anywhere new.
  **Code identifiers stay `kvk` / `KovaaK`**: file names (`kvk-engine.ps1`), packages
  (`@kvk/app`), CSS roots (`.kvk-installer`) and function prefixes (`Get-Kvk…`). Do **not** do a
  repo-wide rename.
- **Sections.** Code, folders (`src/scheme`, `src/audio`), dictionary keys, CSS classes, wire ops
  and Profile JSON fields say `scheme` / `audio`, while the player sees Theme / Sounds. The Chinese
  page titles 「背景」 and 「音效」 and the sentences about what a page changes (应用背景 / "Apply
  background") keep their wording. Code, routes and file names for Quick import say `installer`.
- **Profile** owns saved combinations (a Theme and Sounds) and its draft. The other sections own the
  game's current configuration. Each Profile JSON stores {name, path} records, and audio keeps
  ordered records per event. Profile Save writes JSON only; 应用 applies the saved JSON as one
  batch. Profile Cancel discards only its draft and never reverses another section's confirmed
  change. Current-page edits never rewrite Profile JSON. A legacy `crosshair` or `enemy` field in
  a Profile is read and dropped, never written, and ignored by Apply, in all three layers.
- **Enemy** changes only what the game's own Skin Browser changes:
  `characterModelOverride.{Cylindrical,Cuboid,Spheroid}` in `PrimaryUserSettings.json`, two strings
  per shape, from the game's 15 built-in skins (`docs/research/kovaak-skin-browser.md`).
- **Protect** sensitivity, DPI, FOV and unrelated settings. Background and enemy skins live in the
  same settings file, and each writer changes only its own keys.
- **The network.** The App's only origin is `aimloom.dev` (`net.rs`), used for in-App reports, the
  optional Steam account and the launch update check. `aimloom.dev/api/*` is a Worker script with
  D1 and mail (`packages/site/src/worker/`), pinned by `tests/deploy-config.test.ts`. Three tests
  read **both** sides of the App–Worker seam and must keep doing so:
  `tests/installer/report/backend-paths.test.ts` (paths), `command-shapes.test.ts` (what each
  command answers) and `backend-codes.test.ts` (failure codes). A fake standing where the real
  counterpart should be compared once shipped three defects.
- **`@kvk/core`** (parked) is not an installer runtime dependency. Its browser-safe scheme leaf
  modules are reused for previews; keep Node adapters and stores out of the front end, and never
  require a player to have Node. **`@kvk/crosshair`** stays independent of `@kvk/core`: its
  browser-safe entry exports parsers, geometry, RGBA and SVG, and `@kvk/crosshair/node` holds the
  Node-only PNG functions. Decoder provenance and limitations are in `docs/research/`; keep
  `THIRD_PARTY_NOTICES.md`, including inside images.
- **Releases** are exactly the files the website serves: a Setup
  (`Aimloom-Setup-v<version>.exe`, Tauri's NSIS installer with our hooks) and the portable ZIP.
- **A Mac or Linux machine is a development host only.** Browser preview and tests run there; the
  App target is Windows. `npm run build:installer:windows` deliberately exits 2 elsewhere, and the
  Rust `installer::run()` refuses to start off Windows.

## Privacy — write as if every file will be published

This repository is public. **Anything written to a tracked file, a commit, a release file, the
website or a report is public.** The test for whether a value may be written is not "is it a
secret?" but "does it identify a person, their machine or their account?". If it might, it is not
written.

- **Test data is fake, always.** Use the fixed fake identity: SteamID `76561198000000042`, Steam
  name `PlayerOne`, Windows user `Player1`, PC `DESKTOP-TEST01`, path `C:\Users\Player1\…`, and
  report numbers `AL-YYMMDD-TST1`. Never copy a real account, name, path, machine, IP, ID or report
  number into code, tests or fixtures, even when it is "just the output I observed".
- **Real evidence stays out of this repository.** Verification records, work logs and
  implementation plans are kept privately by the maintainer (in an untracked `private/` folder,
  which the pre-commit hook refuses to commit). Nothing tracked links into it. When a public
  document needs an observation, write it with `<user>`, `<pc>`, `<ip>`, `<steamid>`, `<email>`
  and `<account>` in place of the real values.
- **Never write account identifiers:** emails (other than the project's `feedback@aimloom.dev`),
  Cloudflare account ids, subdomains or database ids, dashboard URLs, Figma file keys, API tokens.
  The site's real Cloudflare ids live in an untracked local file that the deploy scripts read
  (`packages/site/README.md`); the tracked `wrangler.jsonc` carries placeholders.
- **Shipped binaries are checked.** Build the release EXE only through
  `scripts/installer/test-build/build-exe.ps1`, which remaps local paths. The packagers refuse an
  EXE containing the build machine's user name, PC name or `C:\Users\`. Do not bypass either.
- **Every commit is gated.** `.githooks/pre-commit` (enable once with
  `git config core.hooksPath .githooks`) runs `scripts/privacy/denyscan.py` against a denylist kept
  outside any repository (`~/.config/aimloom/deny.txt` or `$AIMLOOM_DENYLIST`, never printed or
  committed) when the machine has one, and gitleaks always. CI runs gitleaks over the history and
  the denylist, from an encrypted secret, over the tree. Never bypass with `--no-verify`; if a
  scan stops you, change the content. A maintainer adds each new identifier (a new account,
  machine or tester) to the denylist and syncs the secret (`scripts/privacy/sync-denylist.sh`).
- **Commits** carry the author's GitHub noreply address, never a personal or host-name email, and
  no session trailers.

## Commands

```sh
npm test                      # vitest, all three projects: installer, @kvk/core and crosshair
npm run typecheck             # tsc --noEmit in all workspaces
npx vitest run --project installer controller       # one project + filename filter
npx vitest run packages/core/tests/parse.test.ts    # one file
npm run verify -- <game-or-simulated-dir>           # @kvk/core e2e; does REAL writes — copy first
npm run test:site                                   # the website: Node suite + the Worker's D1/mail suite in workerd
python3 -m unittest discover -s scripts/privacy -p 'test_*.py'   # the privacy scanner
```

Installer frontend (`-w @kvk/app`):

```sh
npm run dev:installer -w @kvk/app     # http://127.0.0.1:5173/installer.html — browser demo, touches no files
npm run build:installer -w @kvk/app   # -> packages/app/dist-installer
npm run build:installer:windows -w @kvk/app   # Windows only, by design
```

Docker development (repository root; [details](docs/docker-development.md)):

```sh
npm run docker:config          # validate Compose without starting containers
npm run docker:dev             # build + live installer preview on 127.0.0.1:5173
npm run docker:check           # rebuild source snapshot; Vitest + typecheck in Linux
npm run docker:build           # frontend files -> dist/docker-installer, not a Windows EXE
npm run docker:down            # remove only this project's containers/network/dependency volumes
```

The dev service mounts only selected browser source inputs read-only; dependencies are Linux-only
anonymous volumes renewed at startup. Tests and builds use rebuilt image snapshots. Update the
Dockerfile manifest copies and `.dockerignore` when adding workspaces.

Native + packaging (each layer has its own suite; `npm test` covers none of them):

```sh
cargo test --manifest-path packages/app/src-tauri/Cargo.toml --features installer-ui
python3 -m unittest discover -s scripts/installer/tests -p 'test_*.py'

pwsh -NoProfile -File scripts/installer/tests/engine.test.ps1
pwsh -NoProfile -File scripts/installer/tests/engine.test.ps1 -CaseFilter '<substring>'   # single case
```

CI (`.github/workflows/ci.yml`) runs all of the above except Docker, plus the sixteen PowerShell
suites on Windows. `distribution`, `windows-entrypoints` and `gui-distribution` need an extracted
release ZIP and are not in CI. If `cargo` is missing from a non-interactive shell,
`export PATH="$HOME/.cargo/bin:$PATH"`.

## Request stack

```
React  packages/app/src/installer/
  controller.ts   single owner of every state transition; pages/ are presentation only
  bridge.ts       @tauri-apps/api invoke      demo-bridge.ts   browser fake, no filesystem
        │  8 engine commands: installer_read / _profile / _execute / _job / _reconcile / _pick_folder / _pick_file / _open_backup
        │  + 6 that never touch the engine: _report_preview / _report_send / _account_resolve / _update_check / _open_logs / _open_download
Rust   packages/app/src-tauri/src/installer/
  commands.rs     validates every op in AND out; owns plan→gameRoot ownership and operationId idempotency
  worker.rs       spawns ONE pwsh 7 child; JSONL over stdin/stdout, v=1, 16 MiB line cap
  jobs.rs         job state machine: running / finished / failed / unknown / reconciled
        │  JSONL
PowerShell 7  scripts/installer/gui/
  kvk-gui-worker.ps1    read-line loop     kvk-gui-service.ps1   typed boundary + DTO shaping
        │  dot-source
scripts/installer/kvk-engine.ps1   the transaction engine — every filesystem write happens here
```

`kvk-config.ps1` (the console wizard behind `安装配置.cmd` / `恢复配置.cmd`) drives the *same*
engine. The GUI adds no write rules of its own; fix write behaviour in the engine, not in a shell.

**The wire contract is mirrored in four places and must change in lockstep:** `contracts.ts` (TS)
→ `protocol.rs` (serde + `validate_read`) → `gui/protocol.schema.json` (request schema) →
`gui/kvk-gui-service.ps1` (producer). camelCase on the wire; Rust renames. `PROTOCOL_VERSION = 1`.

**Both languages travel on the wire.** An `Issue` carries `messageEn` beside `message`, an
execution report carries `errorsEn` beside `errors`, and a Profile list error row carries its own
`messageEn`. Rust rejects a worker issue whose `messageEn` is empty or is not **English-safe**, so
PowerShell always derives a valid English text (`Get-KvkEnglishText`) rather than echoing the
Chinese one. English-safe means **no CJK outside double-quoted spans** — a span is `"…"`, ASCII
double quotes, no nesting, and an odd number of quotes leaves the unclosed tail outside. Game
content (a file name, a theme name, a Profile name, a path) is never translated, so an English
message wraps every such value in quotes and a Chinese name then reaches an English player; an
untranslated Chinese sentence is still refused. One definition per layer, kept identical by a
shared eight-case parity table: `Test-KvkEnglishSafe` (`kvk-engine.ps1`), `is_english`
(`protocol.rs`), `isEnglishText` (`src/i18n/index.ts`), asserted in `engine.test.ps1`,
`protocol.rs` and `tests/installer/i18n/english-text.test.ts`.
`tests/installer/i18n/engine-messages.test.ts` fails a PowerShell English literal that
interpolates a name or path outside quotes; counts, limits, JSON keys and codes stay unquoted.

## Invariants that the tests enforce

- **Plan ownership.** A `planId` is executable only if the native session recorded it from a
  validated preview; `gameRoot` at execute time is recovered from that record, never from the UI
  request. `operationId` is the idempotency key — an exact repeat returns the cached job, a changed
  repeat is `PLAN_STALE`.
- **`unknown` is never success.** `installer_reconcile` is the only exit, and only once the old
  worker process has exited. The UI stays locked until then.
- **Unowned files are a hard stop**, even with conflict permission. Install operations can never
  set `allowConflicts`.
- **Original bytes.** Copy as-is: no renaming, no JSON re-serialization, no re-encoding, no
  auto-suffixing. A theme's internal `themeName` differing from its filename is not a reason to
  rewrite anything.
- **Backups** live in `%LOCALAPPDATA%\Aimloom\backups\<install id>\`, independent of the game dir
  and of `@kvk/core`'s backup format. Two record kinds: per-path *first-protection* (permanent,
  never rewritten) and per-batch install backup. Call it 首次保护状态, never "factory settings".
- **One data folder, never two.** The folder was `KovaaKConfigInstaller` before the rename.
  `Get-KvkDataRoot` (engine) and `data_root` (Rust `worker.rs`) implement the same rule and must
  stay in step: `Aimloom` wins if it exists; otherwise an existing old folder is adopted by a single
  same-volume rename; if that fails, the old folder is used unchanged for the whole session, which
  holds a file open in it so no other process renames it away. Every path under the data folder
  comes from the resolver — never join the folder name by hand. Rust resolves at each worker spawn
  because it opens `worker.log` before the worker starts and would otherwise create `Aimloom` first
  and strand the old data.
- **Batch status is persisted** (`prepared`/`applying`/`completed`/`rolled-back`/
  `recovery-required`); an unfinished batch forces recovery before any new install.
- **Adding an outside file is a plan like any other.** `planFileAdd` (`kvk-import.ps1`) copies one
  theme or sound into the game byte for byte: the source is named by path and re-read by the
  worker, the UI sends the SHA-256 of what it previewed (a mismatch is `PLAN_STALE`), the bytes are
  staged at plan time, and the recorded preview must be exactly one `create` row. It refuses an
  existing target, a sound stem already present under the other extension, and a `themeName` that
  is already installed. A code-generated crosshair goes into the game the same way, through
  `planCrosshairAdd`.
- **One write bypasses the plan path, deliberately.** `Export-KvkFile` is the secondary "save a
  copy elsewhere" for a code-generated PNG: it writes to a user-chosen folder. It must stay
  `CreateNew` (never overwrite), refuse any target inside the game directory, enforce safe names
  and a size ceiling, and create no backup batch. Anything that changes the game still goes through
  a plan.
- **The game must be closed** — the engine checks `FPSAimTrainer` /
  `FPSAimTrainer-Win64-Shipping` before and during writes. Detection failure means stop; never
  force-close, never auto-elevate, never touch execution policy. (The App does remove the
  browser-download mark — the `Zone.Identifier` stream — from the files in **its own** `scripts\`
  folder at startup, as Properties → Unblock would; without that, RemoteSigned refuses the worker
  in every browser download. Nothing outside that folder, and never the policy.) The exceptions are
  the writes that only place files — Crosshair replace/add and the theme/sound add (`planFileAdd`)
  — which pass `-AllowRunningGame`; installer and restore callers must not use that switch.
  **Anything that writes `PrimaryUserSettings.json` (Theme, Sounds, Enemy, Profile apply) requires
  the game closed, at preview and at write:** the game rewrites the whole file when it exits, so a
  write made while it runs is lost.

## Release packaging

The sound and crosshair assets a release ships are not in the repository, so **a Git checkout
cannot build a real release ZIP.** `release-inventory.json` pins the installable files by size and
SHA-256; any missing, changed or extra file stops the build. Never trim the inventory to make an
incomplete checkout "succeed". The tracked `KVK Settings 2025/` is a synthetic sample corpus for
the tests.

ZIP builds are byte-reproducible (fixed timestamps, permissions, ordering) and self-verified by
reading the ZIP back before replacing the previous output. **The Setup is not reproducible:** NSIS
gives a different file on every bundle of identical inputs, so it is built once, and the file that
was accepted is the file that is released — never rebuild it "identically". On Windows,
`scripts/installer/test-build/package-test-build.ps1` packages the folder and the ZIP, and
`package-setup.ps1 -Folder <that folder>` bundles the same `scripts\**` and `VERSION.txt` into the
Setup. The installer's behaviour lives in `packages/app/src-tauri/windows/` (`installer.nsi` is
Tauri 2.11.4's template with one line changed, pinned by SHA-256; `hooks.nsh` refuses the data
folder before install and offers PowerShell 7 after it) and is pinned by
`tests/installer/setup-installer.test.ts`. A preview deploy must never move `aimloom.dev`: every
wrangler environment other than production declares `"routes": []`
(`packages/site/tests/deploy-config.test.ts`).

**Build `Aimloom.exe` through `pwsh -NoProfile -File scripts\installer\test-build\build-exe.ps1`,
never `tauri build` by hand.** rustc embeds every dependency's source path into panic locations,
so a bare build ships the compiling machine's `C:\Users\<name>\...` in the binary. `build-exe.ps1`
sets `RUSTFLAGS`'s `--remap-path-prefix` for `$env:USERPROFILE` (and `$env:CARGO_HOME` when it
sits outside the profile) and the repository root, computed at run time and appended after any
`RUSTFLAGS` already set. It then runs `node node_modules/@tauri-apps/cli/tauri.js build --features
installer-ui --config src-tauri/tauri.installer.conf.json --no-bundle --target
x86_64-pc-windows-msvc` from `packages/app` and prints the EXE path. As a second, independent
layer, `package-test-build.ps1` and `package-setup.ps1` refuse (via the shared
`assert-no-local-paths.ps1`) any EXE whose bytes still contain the builder's user name, user
profile, computer name or a literal `C:\Users\`, checked case-insensitively as ASCII/UTF-8 and
UTF-16LE. The refusal prints only the rule and a hit count, never the matched text.

## Conventions

- **UI:** `packages/app/src/installer/tokens.css` owns the Quick import page's tokens (DESIGN.md
  §6 mirrors the values; legacy `index.css` is not imported). They are light and carry the
  workspace's colours: `tests/installer/theme.test.tsx` fails if a colour differs between the two
  roots, so change a colour in both files. The **workspace** redeclares the same `--ki-*` names in
  `packages/app/src/workspace/workspace.css` scoped to `.profiles-app`, and adds the `--ws-*`
  palette and the `--ws-radius-*` scale — change workspace appearance there, never in
  `tokens.css`. `docs/installer-ui-interactions.md` is the binding interaction contract — the five
  kinds of state, who owns dialogs and sheets, focus, search, pagination and conflict consent.
  Read it before touching a workspace or installer component. No remote fonts or images; the CSP
  forbids them.
- **Design:** new website and App screens are designed in Figma before they are built. The
  implemented pages are functional but have not had that design pass; do not describe them as
  designed, and do not count a written spec as a finished design.
- **Language:** the App is bilingual (中文 / English). UI strings live in `packages/app/src/i18n/` —
  `zh.ts` is the source and `en.ts` must carry the same keys; no Chinese literal belongs in UI code
  outside that folder. Engine, Rust and package messages carry both texts at the source:
  `Throw-KvkFailure <code> <zh> <en>` and `Throw-KvkGuiIssue` in PowerShell,
  `Issue::new(code, zh, en)` in Rust, `LocalizedError` in `@kvk/core`, `CrosshairError` in
  `@kvk/crosshair`. The console wizard (`kvk-config.ps1`) and the crosshair CLI stay Chinese. Five
  guards hold this: `packages/app/tests/installer/i18n/no-chinese-in-ui.test.ts`,
  `packages/app/tests/installer/i18n/core.test.tsx` (dictionary parity, and no CJK in `en`),
  `packages/app/tests/installer/i18n/engine-messages.test.ts`,
  `packages/core/tests/i18n-messages.test.ts` and `packages/crosshair/tests/messages.test.ts`. The
  language choice is `aimloom.lang` in WebView storage (`'system' | 'zh' | 'en'`), set from the
  Settings popover; on first launch `'system'` follows the Windows display language. Commit
  messages are English conventional commits (`feat:`, `docs:`, `chore:`). **Documents are written
  in English.** The Chinese specs dated 2026-09-08 and earlier are history; don't translate them.
- **Strict mode:** the worker runs `Set-StrictMode -Version 3.0`, so every PowerShell suite and
  every dot-sourced test helper runs at 3.0 too (`tests/installer/strict-mode.test.ts` enforces
  it). A suite at 2.0 once hid a thrown error behind a silent `$null`.
- **Encoding:** any `.ps1` containing non-ASCII must be saved UTF-8 **with BOM**. Everything targets
  `#Requires -Version 7.0`; PowerShell 5.1 results in old documents are history, not a target.
- **Line endings:** release packages carry LF (they are built from `git archive`), and the
  PowerShell suites' embedded fixtures assume it; CI checks out with `core.autocrlf false`.
- **TypeScript:** every workspace enables `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` — indexed reads are `T | undefined`, including on TypedArrays.
- **Dependencies are pinned to exact versions on purpose.** vite 7.3.6 / @vitejs/plugin-react 5.2.0
  / vitest 3.2.7 form one chain: Vite 8 forces plugin-react 6, which forces vitest 5, which moves
  the core test suite. Don't casually upgrade.

## Docs and claim discipline

`docs/superpowers/specs/` holds approved designs, `docs/research/` technical findings, and
`docs/v0.1.x-design.md` the original product scope. `DESIGN.md` is the installer's visual and token
contract, and `ROADMAP.md` is the schedule.

This project is strict about evidence: a claim separates what was *actually observed* from what is
still pending, and the README never advertises unshipped capability. "Fixture tests pass" is not
"works in the real game"; "installed the file" is not "the game displays or plays it".
