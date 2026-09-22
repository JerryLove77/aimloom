# Aimloom in English — a Settings panel and a bilingual App

Status: design agreed in chat with the user on 2026-09-19; this spec awaits their review.
Target release: **v0.1.2**, together with the Setup
([Setup spec](2026-09-19-aimloom-setup-design.md), whose installer becomes bilingual; see §8).

## 1. Decisions (user, 2026-09-19)

- **Entry point.** A 「设置」 / "Settings" entry at the bottom left of the App opens a panel
  where the language is switched.
- **First launch** follows the Windows display language.
- **The panel** holds three language options — follow the system / 中文 / English — and shows
  the App version at the bottom. The panel grows in v0.1.3: an Account section (Steam) and a
  Diagnostics section (logs and one-click reports). Both are separate specs, out of scope here.
- **Everything is translated,** including messages from the PowerShell engine, the Rust layer
  and the TypeScript packages. An English player never sees Chinese.
- **Mechanism.** The UI uses key dictionaries, the same approach as the website (`t(key)`,
  `zh.ts` / `en.ts`).
- **Release grouping.**
  - v0.1.2: this spec and the Setup.
  - v0.1.3: the diagnostics reports and the Steam account.

## 2. Which language is shown

- **The stored choice** is `'system' | 'zh' | 'en'`, kept in the App's own WebView storage
  under `aimloom.lang`.
  - Every read and write is wrapped in `try/catch`.
  - A missing or unreadable value means `'system'`.
  - The choice lives apart from the data folder; the Setup's "delete application data" option
    may clear it, and that is acceptable.
- **`'system'` resolves** from `navigator.languages`, which WebView2 takes from the Windows
  display language: any `zh*` (including `zh-TW`) is `zh`; everything else is `en`. This is
  the website's `pickLang` rule, minus the saved-choice step.
- **Resolved before the first render,** so no screen flashes in the wrong language. The
  resolved language sets `<html lang>` to `zh-CN` or `en`. Screen readers then use the right
  voice, and CSS picks the right font (§6).
- **Switching is immediate** and needs no restart. Text already on screen is re-rendered in the
  new language, including notices and results, because controllers keep messages as keys or
  bilingual pairs, never as finished strings (§3, §4).

## 3. The Settings panel

- **Entry.** The sidebar's bottom row, today 「安装与恢复」 and the local/demo note, gains a
  「设置」 / "Settings" button.
  - It stays enabled while the workspace is locked; switching language writes nothing.
- **Ownership.** The panel is a dialog owned by the workspace root, not by a section.
  - It renders through the shell's `overlays` slot, so it stays inside the token wrapper.
  - Closing it returns focus to the Settings button, and Esc closes it, as the interaction
    contract requires for every dialog.
  - `docs/installer-ui-interactions.md` gains a Settings entry.
- **Contents:**
  - title 「设置」 / "Settings";
  - a 「语言」 / "Language" radio group:
    - 「跟随系统（当前：中文）」 / "Follow Windows (now: English)";
    - 「中文」;
    - 「English」.
  - a small footer 「Aimloom v0.1.2」, from a build-time constant read from
    `tauri.installer.conf.json`. It also works in the browser demo.
- **Layout: A, the popover** beside the sidebar, bottom-aligned with the Settings button. The
  user chose it on 2026-09-19 from two Figma drafts (§7; frames SET-A1/A2).
- **Structure.** Sectioned, so v0.1.3 can add Account and Diagnostics without redesigning it.

## 4. Where the words live

### 4.1 The React UI

- **Files.** `packages/app/src/i18n/`:
  - `zh.ts` is the source dictionary;
  - `en.ts` is typed `Record<keyof typeof zh, string>`;
  - `index.ts` holds `resolveLang`, the provider, `useT()` and `t(lang, key, params)`.
- **Keys** are namespaced by area: `common.*`, `shell.*`, `settings.*`, `profile.*`,
  `scheme.*`, `audio.*`, `crosshair.*`, `enemy.*`, `import.*`, `installer.*`.
- **Parameters** are named placeholders, e.g. `{name}`, `{count}`. English plurals are
  handled by choosing between two keys where a count appears; no plural library.
- **Controllers** (`*/controller.ts`) stop producing finished strings. A user-facing message
  is one of two things, which pages render with the current language:
  - `{ key, params }`;
  - a bilingual pair from the backend (§4.2).
- **The browser demo** (`demo-bridge.ts`) is translated the same way.

### 4.2 Messages from outside the UI: bilingual at the source

Engine and native messages are built with runtime values (file names, counts, versions). So
they are written in both languages where they are produced, not keyed:

- **The wire (JSONL, `PROTOCOL_VERSION` stays 1; the App and its scripts ship together).**
  - `Issue` gains `messageEn: string` beside `message`.
  - Any other response field that carries player-facing Chinese text gets an `…En` twin; the
    plan lists them.
  - Changed in lockstep in the four mirrored places: `contracts.ts` → `protocol.rs` →
    `gui/protocol.schema.json` → `gui/kvk-gui-service.ps1`.
- **PowerShell:**
  - `Throw-KvkGuiIssue <code> <zh> <en>`;
  - engine failures use one helper that throws with both texts, the English in the
    exception's data. The service shapes both into the `Issue`.
  - The console wizard (`kvk-config.ps1`) keeps printing Chinese.
- **Rust** (`commands.rs`, `worker.rs`, `profiles.rs`, `protocol.rs`):
  - Rust-made issues carry both texts. For example, `PWSH_MISSING` gains an English twin.
  - The folder and file dialogs take the UI language, so their titles and filter names follow
    it.
- **`@kvk/crosshair` and `@kvk/core`.** User-facing messages (code parse errors, preview
  problems) become `{ zh, en }` pairs.
  - Each package declares its own pair type, so neither depends on the App or on the other.
  - The crosshair CLI keeps printing Chinese.

## 5. Tests that keep it complete

- **Dictionaries:**
  - `zh` and `en` have identical key sets and no empty values;
  - each key uses the same placeholder names in both;
  - `en` contains no CJK characters, and no curly quotes (same rule as the site).
- **No stray Chinese in the UI.** A scan built on the TypeScript compiler API reads every
  string literal, template part and JSX text in `packages/app/src/**` and fails on CJK outside
  `src/i18n/zh.ts`. Comments are ignored.
- **The four protocol mirrors** agree on `messageEn`.
- **Backend messages:**
  - every `Throw-KvkGuiIssue` and engine-error call site passes an English text with no CJK
    (PowerShell suite and a static scan);
  - every Rust-made issue carries an English text (Rust tests);
  - every package message pair has a non-empty `en` with no CJK (package tests).
- **Language resolution,** unit-tested:
  - saved choice wins;
  - `'system'` follows `zh-CN` → zh, `zh-TW` → zh, `en-US` → en, `fr` → en;
  - unreadable storage → system.
- **The Settings dialog,** jsdom:
  - it opens from the sidebar;
  - focus moves in and returns to the button;
  - Esc closes it;
  - choosing English re-renders the open section in English;
  - the choice persists;
  - the version shows.

## 6. Fonts and glossary

- **Fonts.** English UI uses the Windows system face: `"Segoe UI Variable Text", "Segoe UI",
  system-ui, sans-serif`, under `:lang(en)`. The Chinese stack is unchanged. No remote fonts,
  as the CSP forbids them.
- **Glossary.** Shared with the website's English copy:

| 中文 | English |
|---|---|
| 组合管理 / 当前配置 | Combinations / Current setup |
| Profile | Profile |
| Theme（背景）· Sounds（音效）· 准星 · 敌人外观 | Theme · Sounds · Crosshair · Enemy look |
| 应用 / 应用背景 | Apply / Apply background |
| 添加到游戏 · 替换 · 刷新 | Add to game · Replace · Refresh |
| 安装与恢复 | Install & restore |
| 首次保护状态 | first-protection state |
| 设置 · 语言 · 跟随系统 | Settings · Language · Follow Windows |
| 未保存 | Unsaved |

2026-09-19, user correction after test.1: the section is named Theme (not Scheme /
Background) and Sounds (not Audio), after the game's own words. The section names are the
same English words in both languages; the Chinese page titles 「背景」 and 「音效」 and every
sentence about what a page changes keep their own wording, as does the button Apply
background. Code identifiers, folders, dictionary keys, wire ops and Profile JSON fields
stay `scheme` / `audio`.

Game content is never translated: theme names, sound and crosshair file names, and KovaaK's
own terms stay as the game has them.

## 7. Figma first

In the workspace Figma file, before any UI code:

- **The Settings panel** in two layouts, each in Chinese and English, for the user to choose
  from:
  - a popover anchored to the bottom-left button;
  - a centred dialog.
- **English versions of the densest screens,** where English runs longer:
  - the sidebar;
  - Audio's row of six event tabs;
  - Crosshair's two entry cards;
  - the import sheet.

  Any overflow found there is fixed in the design before the code copies it.
- Recorded in `docs/design/figma/README.md` with node ids and reviewed screenshots.

## 8. Other surfaces in v0.1.2

- **The ZIP** gains an English `README.txt` beside `使用说明.txt`, in both the release and test
  channels, with the same facts. The packager and the brand test cover it.
- **The Setup** (resuming its paused plan) becomes bilingual:
  - `languages: ["SimpChinese", "English"]`; NSIS picks by the Windows UI language;
  - the hook's prompt and fallback texts become `LangString`s;
  - the English fallback equals Rust's English `PWSH_MISSING`.

  The Setup spec and plan get this amendment before their execution resumes.
- **The website,** at release:
  - the English pages stop saying the interface is Chinese;
  - they name the App's English labels instead of describing buttons by position;
  - the FAQ says the App follows the Windows language and switches in Settings.

## 9. Verification

- **Mac:**
  - `npm test` (all projects);
  - `npm run typecheck`;
  - `cargo test`;
  - `npm run build:installer -w @kvk/app`;
  - the browser demo in both languages.
- **The tester's PC over ssh:**
  - every PowerShell suite (the message changes touch the engine);
  - the Rust suite;
  - a packaged ZIP whose worker answers `discover` with both texts on an induced error.
- **The user, on real screens:**
  - first launch follows Windows;
  - switching both ways;
  - English layouts not crowded;
  - an error shown in English;
  - the version in Settings.

## 10. Out of scope

- The Account (Steam) and Diagnostics sections: v0.1.3, own specs.
- Languages beyond Chinese and English. The design admits a third dictionary, but none is
  planned.
- The console wizard and the crosshair CLI, which stay Chinese.
- Translating game content.
