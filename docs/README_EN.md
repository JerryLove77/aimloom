<div align="center">

# Aimloom

[![CI](https://github.com/JerryLove77/aimloom/actions/workflows/ci.yml/badge.svg)](https://github.com/JerryLove77/aimloom/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/JerryLove77/aimloom?label=release)](https://github.com/JerryLove77/aimloom/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](../LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4)](https://aimloom.dev)

> A Windows app for [KovaaK's](https://store.steampowered.com/app/824270/) players: put a CS2 or VALORANT
> crosshair code into the game, manage its themes, sounds, crosshairs and enemy skins in one place, and
> save combinations you like as Profiles. On the website's Explore page, players download backgrounds,
> sounds and crosshairs others shared, and upload their own. Free, bilingual (中文 / English).

[**Download**](https://aimloom.dev/en/download/) · [**Explore**](https://aimloom.dev/en/explore/) · [**Features**](#features) · [**Requirements**](#requirements) · [**Develop**](#develop) · [**Roadmap**](../ROADMAP.md)

[简体中文](../README.md) | English

</div>

## Download

Get the Setup from [aimloom.dev](https://aimloom.dev/en/download/), which lists its SHA-256. The
Setup and the portable ZIP are both attached to the
[GitHub release](https://github.com/JerryLove77/aimloom/releases/latest). The current release is
**v0.1.4**.

## Features

- **Crosshair** — paste a CS2 or VALORANT share code, fine-tune its length, thickness, gap,
  outline, colour, centre dot and alpha, and get a PNG crosshair in the game's folder, or add a PNG
  of your own. You pick it in the game's settings.
- **Theme, Sounds** — see the themes and sounds installed in the game, preview them, and apply
  one. Add new ones from your computer by picking or dragging a file.
- **Enemy** — choose one of the game's own skins for each shape (humanoid, cube, sphere), as the
  game's Skin Browser does.
- **Profile** — save a theme and a set of sounds as one named combination, apply it in one
  step, or apply it and start the game through Steam.
- **Quick import** — bring a whole pack of files into the game at once.

Every change is backed up before it is written and can be undone. Aimloom never touches your
sensitivity, DPI or FOV, and it only changes the game while the game is closed: KovaaK rewrites its
settings when it exits, so a change made while it runs would be lost.

## The website, aimloom.dev

- **[Explore](https://aimloom.dev/en/explore/)** — browse, listen to and download backgrounds, sounds
  and crosshairs other players shared. A download is the file itself: drag it onto the matching
  page in Aimloom.
  - **Upload** — sign in through Steam (Aimloom gets your SteamID, never your password), pick a
    display name once, and choose a file; every upload also passes a Cloudflare Turnstile human check.
  - Uploads are checked strictly: only theme `.json`, sound `.wav` / `.ogg` and crosshair `.png`,
    every byte must fit the format, and crosshair images are re-encoded. A new creator's upload is
    reviewed before it goes public, and creators can withdraw their own files at any time.
- **Feedback** — the Feedback button at the bottom right of every page sends a ticket, no account
  needed; leave an email to get a reply.
- **[Crosshair code tool](https://aimloom.dev/en/crosshair/)** — no install: paste a CS2 or VALORANT
  code in the browser, preview it, fine-tune it and download the PNG. Nothing is uploaded.

## Requirements

- Windows 10 or 11, x64.
- **PowerShell 7** — included in Aimloom (its `pwsh` folder): nothing to install, and the
  PowerShell on your system is left alone.
- WebView2, which Windows 10/11 normally has.

Aimloom is not code-signed, so Windows SmartScreen may warn on first run: choose *More info* →
*Run anyway*. The download page gives each file's SHA-256 so you can check what you got.

## Status

- **In progress:** v0.1.5 — the website's Explore page is live, with Steam sign-in, uploads and
  review (the maintainer has signed in and uploaded on the live site). The App's "Find more on
  aimloom.dev" link is in [v0.1.5-beta.1](https://github.com/JerryLove77/aimloom/releases/tag/v0.1.5-beta.1),
  a GitHub pre-release only for now; the App's update check does not offer it yet.
- **Released:** v0.1.4 (2026-09-22) — fine-tuning a pasted CS2 / VALORANT crosshair code, "Apply
  and start the game" for a Profile, search and add-from-computer when choosing a Profile's
  background and sounds, search on the Theme page, and a "Join the beta" switch in Settings.
  v0.1.3 brought in-App problem reports, an optional Steam account, a launch update check,
  applying Profiles and enemy skins. What follows is in
  [ROADMAP.md](../ROADMAP.md).
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
| `packages/site` | The aimloom.dev website and its Cloudflare Worker (reports, Explore, sign-in and uploads) |
| `docs/` | Design documents (`superpowers/specs/`), research, the UI interaction contract |

[`CLAUDE.md`](../CLAUDE.md) is the contributor guide: the request stack, the invariants the tests
enforce, and every command. [`DESIGN.md`](../DESIGN.md) is the visual contract.

## Develop

The App targets Windows; a Mac or Linux machine runs the browser demo and the tests.

```sh
npm ci
npm test                                  # Vitest: App, @kvk/core, crosshair
npm run typecheck
npm run dev:installer -w @kvk/app         # browser demo at http://127.0.0.1:5173/installer.html; touches no files
cargo test --manifest-path packages/app/src-tauri/Cargo.toml --features installer-ui
npm run test:site                         # the website: page build + the Worker (D1, R2, sign-in, uploads)
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

[GNU AGPL-3.0](../LICENSE). Third-party code and its licences are listed in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). KovaaK's is a trademark of its owners; Aimloom
is not affiliated with it.
