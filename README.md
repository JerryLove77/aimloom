# Aimloom

A Windows app for [KovaaK's](https://store.steampowered.com/app/824270/) players: put a CS2 or
VALORANT crosshair code into the game, manage its themes, sounds, crosshairs and enemy skins in one
place, and save combinations you like as Profiles. Free, bilingual (中文 / English).

**Download:** [aimloom.dev](https://aimloom.dev) — the Setup or the portable ZIP, with their
SHA-256. The current release is **v0.1.3**.

> 给 KovaaK 玩家的 Windows 工具：把 CS2 / VALORANT 准星代码放进游戏，集中管理主题、音效、准星和
> 敌人皮肤，把喜欢的组合存成 Profile。免费，中英双语。下载请到 [aimloom.dev](https://aimloom.dev)。

## What it does

- **Crosshair** — paste a CS2 or VALORANT share code and get a PNG crosshair in the game's
  folder, or add a PNG of your own. You pick it in the game's settings.
- **Theme, Sounds** — see the themes and sounds installed in the game, preview them, and apply
  one. Add new ones from your computer by picking or dragging a file.
- **Enemy** — choose the game's own enemy skins per shape, as its Skin Browser does.
- **Profile** — save a theme and a set of sounds as one named combination, and apply it in one
  step.
- **Quick import** — bring a whole pack of files into the game at once.

Every change is backed up before it is written and can be undone. Aimloom never touches your
sensitivity, DPI or FOV, and it only changes the game while the game is closed: KovaaK rewrites its
settings when it exits, so a change made while it runs would be lost.

## Requirements

- Windows 10 or 11, x64.
- **PowerShell 7** — the Setup offers to install it through winget if it is missing.
- WebView2, which Windows 10/11 normally has.

Aimloom is not code-signed, so Windows SmartScreen may warn on first run: choose *More info* →
*Run anyway*. The download page gives each file's SHA-256 so you can check what you got.

## Status

- **Released:** v0.1.3 (2026-09-22) — in-App problem reports, an optional Steam account, a
  launch update check, applying Profiles and enemy skins. What follows is in
  [ROADMAP.md](ROADMAP.md).
- v0.1.1 and v0.1.2 are withdrawn: their `Aimloom.exe` carried the build machine's Windows user
  name in embedded source paths. From v0.1.3 the build remaps those paths and the packagers refuse
  an EXE that still contains one.
- What has and has not been observed on a real PC and in the real game is recorded, feature by
  feature, in verification notes the maintainer keeps privately. A test passing is not claimed
  as "works in the game".

## Repository

| Path | What it is |
|---|---|
| `packages/app` | The App: React front end, Tauri (Rust) shell |
| `scripts/installer` | The PowerShell engine — every write to the game goes through it |
| `packages/crosshair` | CS2 / VALORANT crosshair code parser and PNG renderer |
| `packages/core` | TypeScript settings library (parked) |
| `packages/site` | The aimloom.dev website and its Cloudflare Worker |
| `docs/` | Design documents (`superpowers/specs/`), research, the UI interaction contract |

`CLAUDE.md` is the contributor guide: the request stack, the invariants the tests enforce, and
every command. `DESIGN.md` is the visual contract.

### Develop

The App targets Windows; a Mac or Linux machine runs the browser demo and the tests.

```sh
npm ci
npm test                                  # Vitest: App, @kvk/core, crosshair
npm run typecheck
npm run dev:installer -w @kvk/app         # browser demo at http://127.0.0.1:5173/installer.html; touches no files
cargo test --manifest-path packages/app/src-tauri/Cargo.toml --features installer-ui
```

The PowerShell suites need PowerShell 7 and run on Windows (CI runs all sixteen on every push):

```powershell
pwsh -NoProfile -File scripts/installer/tests/engine.test.ps1
```

The release packages cannot be built from a Git checkout: the sound and crosshair assets they
ship are not in the repository, and `scripts/installer/release-inventory.json` stops a build that
lacks any of them.

Enable the privacy pre-commit hook once per checkout (it scans staged changes for known
identifiers and secrets before every commit; see `.githooks/pre-commit`):

```sh
git config core.hooksPath .githooks
```

## License

[GNU AGPL-3.0](LICENSE). Third-party code and its licences are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). KovaaK's is a trademark of its owners; Aimloom
is not affiliated with it.
