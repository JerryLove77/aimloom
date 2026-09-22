# Beta channel — design

Date: 2026-09-22. Roadmap item BETA, the first item of v0.1.4. Status: approved by the user, not
built.

## Why

Beta testers and release users must be told apart (user, 2026-09-22): who is running what, which
reports come from a beta, and who is offered which update. Everything later in v0.1.4 reaches
testers through this channel as `0.1.4-beta.N` before it is released.

## Decisions (the user's, 2026-09-22)

- **Opt in from Settings, as on Steam.** A 「参与 Beta 测试」 / "Join the beta" switch decides which line
  the update check follows. The App has no auto-update; installing stays a manual download.
- **The switch defaults on in a beta build and off in a stable build.** A stable player is never
  offered a beta unless they turn it on.
- **The regular line is called 正式版 / Stable** from now on; only the beta line is 测试版 / Beta. The
  site's current release (0.1.3) moves from `beta` to `stable` status.
- **The Beta mark is shown in the window title and in Settings.**
- **One App, one data folder.** Same app identifier, same `%LOCALAPPDATA%\Aimloom`; beta and stable
  share Profiles and backups, and a Setup of either installs over the other.
- **The site's Download page lists the beta as a secondary section**; there is no separate beta page.

## 1. What a build knows about itself

A build's channel is read from the label in its `VERSION.txt`, which the packager writes:

| Label | Channel |
|---|---|
| `0.1.4` | `stable` |
| `0.1.4-beta.3` | `beta` |
| `0.1.4-test.2` (internal test builds, as today) | `test` |
| unreadable or missing `VERSION.txt` | the compiled version, `stable` |

The program version inside the EXE stays the plain `0.1.4` for every channel (Tauri and NSIS need
it numeric), exactly as test builds do today. Only the label carries the channel.

**New native command `installer_app_info`** returns `{ label, channel }` from the resolved
`VERSION.txt` (`version.rs`). It never touches the engine or the network, and it never fails: on
any doubt it answers the compiled version and `stable`. Settings shows this label instead of the
compile-time `__APP_VERSION__`, which also fixes test builds showing a bare `0.1.3`.

**Window title:** at startup, Rust sets the title to `Aimloom Beta` when the channel is `beta`, and
to `Aimloom Test` when it is `test`. Otherwise it stays `Aimloom`.

## 2. Ordering versions

`is_newer(latest, current)` follows semver precedence: the numbers first; then a release outranks
any prerelease of the same numbers; then prerelease identifiers compare left to right, numeric
parts numerically. So `0.1.3 < 0.1.4-beta.1 < 0.1.4-beta.2 < 0.1.4`. A test build `0.1.4-test.2` is
therefore older than `0.1.4`, and it is offered the release once it exists.

The old rule, "a prerelease is never newer", is removed. Its job moves to where it belongs: a
prerelease is offered only from the `beta` field, and only when the player has opted in (§3).

## 3. `latest.json` and the update check

`https://aimloom.dev/latest.json` becomes:

```json
{ "version": "0.1.4", "beta": "0.1.5-beta.1" }
```

- `version` is the recommended stable release. Its meaning is unchanged, so v0.1.3 installs keep
  reading it as before.
- `beta` is the current beta label, or `null` when there is none. The site writes `null` whenever
  the beta is not newer than `version`, so a finished beta disappears on its own.

`installer_update_check` takes `{ beta: boolean }`, the switch's value:

- It considers `version`, and `beta` too when the switch is on. It offers the newest candidate
  that is newer than the running label, or nothing.
- It answers `{ latest, newer, channel }`, where `channel` (`stable` | `beta`) says which line the
  offered version belongs to, so the notice can say "Beta 0.1.5-beta.1" and open the right place.
- A beta player who turns the switch off keeps their beta until a stable newer than it exists,
  then is offered that stable. This is the way back.
- Failures stay silent, as today: no network, a non-200 or a malformed body means "no update known".

`installer_open_download` takes `{ lang, channel }`. For `beta` it opens the download page at its
`#beta` section; the URL is still built in Rust and never taken from the UI.

## 4. Settings

In the Updates section, below 「启动时检查更新」:

- a switch 「参与 Beta 测试」 / "Join the beta", with a one-line explanation: 「打开后会提示测试版更新；
  测试版可能不稳定，可以随时关掉回到正式版。」 / "When on, you are offered beta versions too. A beta can
  be rough; turn this off at any time to go back to stable releases.";
- the switch is stored as `aimloom.beta` (`'on'` / `'off'`) in WebView storage. When nothing is
  stored, the default follows the build's channel (on for `beta`, off otherwise). Every read and
  write is guarded, as `updates.ts` does;
- changing it re-runs the update check immediately;
- the version line shows the real label and, for a beta build, a small `Beta` tag.

## 5. Packaging

- `package-test-build.ps1 -Channel beta -Version 0.1.4-beta.N` accepts exactly
  `<app version>-beta.<N>`, and only that. `channels/beta/` holds a README.txt and a 使用说明.txt in
  both languages, saying this is a beta, how to report and how to go back.
- Output names follow the label: `Aimloom-v0.1.4-beta.1.zip` and
  `Aimloom-Setup-v0.1.4-beta.1.exe`.
- The rest is unchanged: `build-exe.ps1` only, and the local-path refusal. A beta Setup is built
  once and the accepted file is the file that is released, as for stable.

## 6. The site

- `releases.json` gains a top-level `"beta": "<version>" | null`, naming an entry whose status is
  `beta`. That entry must be newer than `recommended`, and `recommended` must be `stable`. The
  current 0.1.3 entry becomes `stable`. Betas are listed in the changelog like any release, with
  their notes and 测试版 / Beta.
- The Download page keeps the stable release as the main offer. Below it, when `beta` is set, a
  section `id="beta"` titled 「测试版（Beta）」 / "Beta" shows that release's Setup, ZIP, hashes and
  known issues, with one sentence: what a beta is, and that it shares Profiles and backups with the
  stable App.
- `latest.json` is generated from the two fields as in §3.
- The staging and the withdrawn rule are unchanged; betas are staged like any served release.

## 7. The wire and the seams

`installer_app_info` is a new command, and `installer_update_check` and `installer_open_download`
gain arguments. `contracts.ts`, `bridge.ts` and `demo-bridge.ts` change with Rust, and
`tests/installer/report/command-shapes.test.ts` keeps comparing both sides of every command's
answer. `backend-paths.test.ts` gains the `beta` field of `latest.json`, read from the site's real
generator and from Rust's parser.

## 8. Tests

- Rust: precedence (`0.1.3 < 0.1.4-beta.1 < 0.1.4-beta.2 < 0.1.4`, test labels, garbage); the
  update check with and without `beta`, a missing `beta` field (the 0.1.3 site), `beta: null`, and
  a beta player going back to stable; the channel from each label shape; the title per channel;
  the download URL per channel, with a UI-supplied channel outside the two refused.
- TS: the switch's default per channel, the stored value winning, storage that throws; the check
  re-running on a change; Settings showing the label and the Beta tag; the notice naming the line.
- Site: `releases.json` rules (`beta` names a `beta` entry newer than a `stable` `recommended`);
  `latest.json` with and without a beta; the Download page's beta section in both languages;
  changelog labels.
- Packaging: `-Channel beta` accepts `0.1.4-beta.3`, refuses `0.1.4-beta`, `0.1.3-beta.1` and
  `0.1.4-test.1`; the beta readmes exist and are bilingual.

## 9. Not in scope

Auto-update; a separate data folder or app id; beta-only features or flags; a separate beta page;
invitations or keys (anyone may take the beta from the Download page).

## 10. Design

This adds a switch row to the Settings popover and a section to the Download page. Both reuse the
existing components (the Updates switch, the release facts block). There is no new screen; both are
drawn in the pending Figma pass for the App and the site.
