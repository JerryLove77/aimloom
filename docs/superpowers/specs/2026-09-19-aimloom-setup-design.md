# Aimloom Setup — a Windows installer that also installs PowerShell 7

Status: **implemented and released in v0.1.2 (2026-09-20).** Approved by the user on 2026-09-19.
What was and was not observed on Windows:
[verification note](../notes/2026-09-20-setup-windows-verification.md). Added after this spec was
written: the installer refuses the data folder on the directory page's behalf (note §8), and §3.4's
running-App paragraph and §3.5's release rule were corrected from what was observed.

**Amendment, 2026-09-19:** the App becomes bilingual in the same release
([English and Settings spec](2026-09-19-aimloom-english-and-settings-design.md) §8), so the
installer does too: `languages: ["English", "SimpChinese"]`. NSIS picks the Windows UI language
and falls back to the first entry, so a Windows that is neither gets English. The hook's prompt
and fallback texts exist in both languages and are picked at run time by `$LANGUAGE` (Tauri's
template includes the hooks file before it loads the languages, so `LangString` cannot be used
there). The fallbacks equal the App's `PWSH_MISSING` and `PWSH_MISSING_EN`. §3.2 and §3.3 below
read with this change.

## 1. Why

Today a player downloads a ZIP, and then has to:

1. extract it;
2. open the folder and double-click `Aimloom.exe`;
3. get past SmartScreen;
4. if PowerShell 7 is missing, read the App's message, open Terminal, run `winget` and reopen
   the App.

The user asked for a download helper that does this for them, installs PowerShell 7, and
replaces an older version cleanly: "下载做成下载小程序，顺便帮用户把powershell7装了和替换好".

"Replace" here means that a newer Setup upgrades the installed App in place and keeps the
player's backups and Profiles. PowerShell 7 installs **beside** the Windows PowerShell 5.1
that ships with Windows, as Microsoft distributes it; nothing in Windows is replaced.

## 2. Decision

**Use Tauri's own NSIS installer** (approach A), not a custom online downloader (approach B).

- **What it is:** a single `Aimloom-Setup-v0.1.2.exe` of roughly 4–5 MB, with the App inside.
- **What Tauri already provides:**
  - the WebView2 check and bootstrapper;
  - Start-menu and desktop shortcuts;
  - an Apps & Features entry with an uninstaller;
  - in-place upgrade;
  - a "close the running App first" check;
  - Simplified Chinese installer pages (`SimpChinese.nsh` ships with Tauri 2.11.4).
- **What we write ourselves:**
  - one installer hook, for PowerShell 7;
  - a one-line change to the install folder (§3.1).

The ZIP stays as the portable alternative.

## 3. Design

### 3.1 Install location — must not be the data folder

Tauri 2.11.4's NSIS template (`installer.nsi`, upstream SHA-256
`20f4ecc730defb71f1342eaeaec4021df13be3d843abba0effe88ea5835fa079`) installs a `currentUser`
build to `$LOCALAPPDATA\${PRODUCTNAME}`, which is `%LOCALAPPDATA%\Aimloom`. That is exactly
the App's data folder (backups, Profiles, logs). Two things break there:

- **Mixed contents.** Program files and backups would share one folder.
- **Adoption fails.** The data-root rule is: "`Aimloom` wins if it exists; otherwise the old
  `KovaaKConfigInstaller` is adopted by rename". An installer that creates `Aimloom` first
  makes the rename impossible. A player upgrading from 0.1.0 would then silently lose access
  to their old backups.

So the Setup installs to **`%LOCALAPPDATA%\Programs\Aimloom`**, the per-user location Windows
uses for per-user apps.

- **How:** through a custom template, `packages/app/src-tauri/windows/installer.nsi`
  (`bundle.windows.nsis.template`). It is the upstream file with exactly that one line changed.
- **The test:** reads the template, reverts the one line, and compares the result to the
  pinned upstream SHA-256. That makes a CLI upgrade a conscious re-sync, not a silent drift.
  `@tauri-apps/cli` is already pinned to 2.11.4.

**Invariant.** The installer never creates, and the uninstaller never deletes, anything
under `%LOCALAPPDATA%\Aimloom`.
- Tauri's "delete application data" checkbox removes only `%APPDATA%\com.aimloom.app` and
  `%LOCALAPPDATA%\com.aimloom.app` (WebView state).
- Backups survive uninstall on purpose. They are the only way to undo game changes, and a
  player may reinstall. The Guide says where they are and that they can be deleted by hand.

### 3.2 Layout and build

- **Layout.** The installed folder has the ZIP's layout: `Aimloom.exe` beside `scripts\` and
  `VERSION.txt`. The App finds its worker there already (`production_worker_path`), so **no App
  code changes**.
- **Mechanism.** The scripts become `bundle.resources` in map form, each target under
  `scripts/`.
- **Side effect.** Files an installer writes carry no browser-download mark, so
  `unblock_own_scripts` finds nothing to do. It stays for the ZIP.
- **Settings in `tauri.installer.release.conf.json`:**
  - `installMode: currentUser`, so no administrator rights are needed;
  - `languages: ["SimpChinese"]`;
  - `webviewInstallMode: downloadBootstrapper` (silent). The stale `fixedRuntime` entry from
    the 0.1.0 packaging plan goes.
- **Build.** One Windows build produces both artifacts from the same `Aimloom.exe`
  (`mainBinaryName: "Aimloom"`):
  - `tauri build --no-bundle` builds the EXE, and `package-test-build.ps1` packages the folder and
    the ZIP as today;
  - a new `package-setup.ps1` passes that folder's `scripts\**` and `VERSION.txt` to
    `tauri bundle --bundles nsis` as resources, so the Setup and the ZIP carry the same script
    bytes, and writes `Aimloom-Setup-v<version>.exe` beside the ZIP. The installed EXE differs
    from the ZIP's only by Tauri's bundle-type marker;
  - the label checks against `tauri.installer.conf.json` and the EXE's ProductVersion apply to
    both artifacts. (Refined in [the plan](../plans/2026-09-19-aimloom-setup.md), Task 4.)

### 3.3 PowerShell 7 (`NSIS_HOOK_POSTINSTALL`)

1. **Detect** the same way the App does:
   - first `$PROGRAMFILES64\PowerShell\7\pwsh.exe`. NSIS is a 32-bit process, so plain
     `$PROGRAMFILES` would point at `Program Files (x86)`;
   - then `pwsh.exe` on `PATH`;
   - a candidate counts only if `pwsh -NoProfile -NonInteractive -Command
     $PSVersionTable.PSVersion.Major` prints 7 or more.
2. **If it is found,** say nothing.
3. **If it is missing,** ask, in Chinese, Yes/No:

   > Aimloom 需要 PowerShell 7。现在用 winget 安装吗？需要联网；Windows 会请求管理员权限。

   The silent default is No: `/S` installs never trigger a download or UAC.
4. **On Yes,** run
   `winget install --id Microsoft.PowerShell --exact --source winget --accept-package-agreements --accept-source-agreements`
   with its output in the installer's details pane, then detect again.
5. **If there is no `winget`, it fails, or PowerShell 7 is still not found,** show the App's
   existing message (install command plus https://aka.ms/powershell). The installer finishes
   either way; the App keeps its own check and message as the backstop.

**Rules.** Aimloom never elevates itself: the UAC prompt belongs to winget and the MSI, and
the player answers it. Nothing touches the execution policy, and nothing is installed without
the Yes.

### 3.4 Upgrade, running App, uninstall

- **Upgrade.** A newer Setup finds the previous install through its registry entry and
  replaces it in place (Tauri's reinstall page). The data folder is untouched, so backups and
  Profiles carry over. A portable-ZIP folder is not found or removed. The download page says
  the old folder can be deleted, and the data is shared.
- **Running App.** This is Tauri's inherited check (`CheckIfAppIsRunning`), not ours.
  - An interactive install or uninstall asks OK / Cancel; OK closes Aimloom, Cancel aborts.
  - A silent (`/S`) or passive install closes Aimloom **without asking**. Observed on
    2026-09-20 ([verification note](../notes/2026-09-20-setup-windows-verification.md)); the
    first draft of this spec said "asks the player to close it", which was wrong.
  - A write batch interrupted by closing is persisted, and on next launch the App forces
    recovery, as today.
- **Uninstall.** Removes the installed files and shortcuts; keeps the data folder (§3.1).

### 3.5 Website and release

- **Download page.** The primary button becomes the Setup, and the ZIP becomes 「便携版」 /
  "Portable ZIP". Figma first: the three Download frames (14:29, 14:93, 14:154).
- **`releases.json`.** Records both artifacts, each with URL, bytes and SHA-256. Both are
  staged into `/files/` by `stage-release.mjs`, and the site tests check both.
- **Other site copy.**
  - Guide "First launch" leads with the Setup.
  - Readme text for the ZIP stays.
  - The FAQ's PowerShell 7 answer says the Setup offers to install it.
- **Release rule.** A release is the exact files the website serves, now two. The GitHub
  release carries both, with matching hashes.
  - **The Setup is not byte-reproducible.** Four bundles of the same source, with an identical
    rendered NSIS script, gave four sizes and hashes, while all 18 packed files were byte-identical
    ([verification note](../notes/2026-09-20-setup-windows-verification.md) §6). So the Setup is
    built once: the file the user accepted is the file that is released. It is never rebuilt
    "identically" for the release.
- **Signing.** Neither artifact is code-signed, so the SmartScreen prompt remains. The Setup
  does not auto-update.

## 4. Verification

**On the Mac:**
- the template test (§3.1);
- the config tests: resource map, `currentUser`, `SimpChinese`, the hook file referenced, no
  `fixedRuntime`;
- the site tests for two artifacts;
- `npm test`, `typecheck`, `cargo test`.

**On the tester's PC, over ssh, from the built Setup:**
- a silent install (`/S`) lands in `%LOCALAPPDATA%\Programs\Aimloom` with the ZIP's layout, and
  creates nothing under `%LOCALAPPDATA%\Aimloom`;
- with only an old `KovaaKConfigInstaller` folder present, the first App start after a Setup
  install still adopts it;
- upgrading 0.1.2 over itself, and over an older Setup build, keeps a planted backup and
  Profile;
- a silent uninstall, even with the app-data option, leaves `%LOCALAPPDATA%\Aimloom` intact;
- the installed App's worker starts (a clean `worker.log` session).

**By the user, on real screens:**
- the Chinese installer pages;
- the PowerShell 7 prompt;
- the shortcut launch.

**Known gap.** The "PowerShell 7 missing" path cannot run on the tester's PC, where PowerShell
7 is installed. It needs Windows Sandbox or a clean machine; until then it is recorded as
unverified, not claimed.

## 5. Out of scope

- Code signing.
- An auto-updater.
- A per-machine (Program Files) install.
- Removing a portable ZIP folder.
- Installing anything other than WebView2 and, with consent, PowerShell 7.
