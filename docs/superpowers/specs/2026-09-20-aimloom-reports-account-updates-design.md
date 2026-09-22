# Aimloom v0.1.3 — reports from inside the App, a Steam account, and a new-version notice

Status: design agreed in chat with the user on 2026-09-20; this spec awaits their review.
Target release: **v0.1.3**. It is the App's first use of the network.

## 1. Why, and what was decided

v0.1.2 tells a player to "send us" `worker.log` and, inside the App, never says where. The website
gained `feedback@aimloom.dev` on 2026-09-20; the App can only change with a release. The user wants
that release to carry the larger step too: an account, networking and reports sent from the App.

Decisions (user, 2026-09-20):

| Question | Decision |
|---|---|
| How the owner receives reports | **An email notification and a private cloud archive.** No admin page. |
| Where the archive is | **In D1.** R2 is not enabled on the owner's account and would need a payment method; the user chose on 2026-09-20 to keep report bodies in the database (a body is at most 1 MiB; a D1 row may hold 2 MB). |
| Replying to a player | The report form has an **optional** contact field. |
| Is an account needed to report | **No.** The Steam account is optional; an anonymous report is accepted. The server keeps no account table. |
| The new-version notice | **Checked at launch, with a switch to turn it off.** It never downloads or installs. |
| Who talks to the network | **Rust**, to one fixed origin. The WebView's CSP is not opened. |
| Where the backend lives | **A script added to the website's Worker**, under `https://aimloom.dev/api/*`, with D1 and mail. |
| Code signing | **Never** (ROADMAP Boundaries). |

**Steam is the account.** It is made by pasting a Steam profile link (decided 2026-09-19), it is what
a player sees as "my account" in Settings, and it is attached to reports. What v0.1.3 leaves out is
*verification* only.

**The verification rule (user, 2026-09-20):** a verified "Sign in through Steam" is required for
**one thing only — uploading a configuration to the explorer.** Everything else works with the
unverified account: reports now, and later favourites and anything else. Verification is therefore
built with the explorer's upload feature, not before, and no feature may demand it for another
purpose.

## 2. What a player sees

### 2.1 The Settings popover

The popover (adopted layout A, Figma SET-A1/A2) grows from two sections to five, top to bottom:
**Language · Account · Feedback · Updates · version.** It stays a non-modal popover owned by the
workspace root, anchored to the Settings button; Esc and an outside click close it and focus returns
to the button. It is redrawn in Figma before any code (§8), because five sections may no longer fit
the popover's height at the 760 px baseline; the design decides between a taller popover and a
scrolling one.

- **Account.**
  - Empty state: a text field 「粘贴 Steam 个人资料链接」 / "Paste your Steam profile link" and a
    button 「添加」 / "Add".
  - Filled state: the Steam name, the tag 「已连接」 / "Connected", and 「移除」 / "Remove".
    **Amended 2026-09-21 by the user, on seeing it on a real screen:** the tag used to read
    「未验证」 / "Unverified" with a line saying "only signs your reports, no verification". Beside
    a name that had just connected it read as a failure. Nothing in the App mentions verification
    any more; it is said once, on the explorer's upload page, the only place that needs it. The
    payload still records `verified: false` — that is data for the backend, not copy.
  - One sentence says what it is for: it is attached to the reports you send, nothing else.
- **Feedback.**
  - 「上传反馈…」 / "Send a report…" opens the report sheet (§2.2).
  - Under it, the fallback: `feedback@aimloom.dev` as selectable text and 「打开日志文件夹」 /
    "Open log folder" (the SET-A3 / SET-A4 drafts).
- **Updates.**
  - A switch 「启动时检查新版本」 / "Check for a new version at launch", on by default.
  - When a newer version exists: 「有新版本 v0.1.4 · 去下载」 / "v0.1.4 is available · Download",
    which opens the website's download page in the player's browser. The Settings button shows a
    small dot until the popover has been opened once in that session.
  - When the check fails, nothing is shown: a failed check is not the player's problem.

### 2.2 The report sheet

A sheet owned by the workspace root and rendered through the shell's `overlays` slot, like every
other sheet; `docs/installer-ui-interactions.md` gains its entry. It can be opened while a section
is locked (it writes nothing to the game), but not while another sheet is open.

1. **Form.**
   - 「发生了什么？」 / "What happened?" — optional, up to 2,000 characters.
   - 「联系方式（选填）」 / "Contact (optional)" — up to 200 characters; the hint says an email
     address, Discord or QQ, used only to reply about this report.
   - A checkbox 「附上日志」 / "Attach the log", on by default.
   - The account line: "Sent as PlayerOne" or "Sent without an account" (amended 2026-09-21: no
     "(unverified)", for the reason given in §2.1).
2. **Preview.** 「查看将要发送的内容」 / "See exactly what will be sent" expands the literal text
   of the payload (§3), log included, in a scrolling read-only box.
3. **Send.** One primary button. While it runs the sheet is busy and cannot be closed.
4. **Result.**
   - Success: the report number, e.g. `AL-260921-7K3F`, with 「复制」 / "Copy", and a sentence
     that the number is what to quote if they write to `feedback@aimloom.dev`.
   - Failure: the reason in the player's language, then the fallback — the address and
     "Open log folder". Nothing is retried automatically.

### 2.3 Elsewhere

- Every App message that names `worker.log` (`WORKER_EXITED` / `WORKER_EXITED_EN`, the UI's
  untranslated-engine-error line) gains the way out: "Send a report from Settings, or write to
  feedback@aimloom.dev."
- Install & restore has no Settings button. Its Help page aside gains the same Feedback block
  (send a report, the address, open the log folder).
- The Help aside's two promises are rewritten truthfully (§3.4).

## 3. What is sent, and privacy

### 3.1 The payload

One JSON document, built by Rust:

| Field | Content |
|---|---|
| `app` | the three lines of `VERSION.txt`: label (e.g. `0.1.3` or `0.1.3-test.2`), build commit, build time |
| `system` | Windows version and build; the Windows display language; the App's language choice and resolved language; the PowerShell 7 version the App found, or that none was found |
| `game` | whether a game folder is known: `true` / `false`. **Never the path.** |
| `account` | `{ steamId, name, verified: false }` or `null` |
| `description`, `contact` | what the player typed, trimmed; empty strings become `null` |
| `log` | the tail of `worker.log` — at most 512 KiB, cut at a line start — or `null` when the box is unticked or no log exists |

**Never sent:** game files, settings files, themes, sounds, crosshairs, Profiles, backups, any full
path, the machine name, the IP address as data (§5.4).

### 3.2 Scrubbing

Before the payload exists, the log text is scrubbed:

- the Windows user name, wherever it appears, case-insensitively → `<user>`;
- `C:\Users\<anything>\` (any drive) → `C:\Users\<user>\`;
- the machine name → `<pc>`.

A Steam library path keeps its drive and folders: it is the player's game location, which support
needs, and it names no person once the rules above have run.

### 3.3 What is previewed is what is sent

- `report_preview` builds the payload once, keeps it in the native session, and returns its text and
  SHA-256.
- `report_send` takes that SHA-256. Rust sends the bytes it kept; if the hash does not match a
  payload it built in this session, it refuses with `PLAN_STALE`. The UI cannot alter a byte.
- Editing the form invalidates the preview; the sheet asks for a new one before Send is enabled.

This is the same ownership rule as `planFileAdd`.

### 3.4 Promises, reworded

The App stops saying it never touches the network and says what is true instead, in the Help aside,
the website FAQ, and a new website page **Privacy** (中文 / English, linked from every footer):

- Aimloom contacts `aimloom.dev` only when you send a report, when you add a Steam link, and — unless
  you turn it off — once at launch to ask whether a newer version exists.
- The launch check sends nothing about you: it downloads one small public file.
- It never uploads game files, settings, Profiles or backups.
- Reports are kept for 180 days, then deleted. No IP address is stored.
- The contact you give is used only to reply about that report.

### 3.5 Retention

A report is one database row. Rows older than 180 days are deleted whenever a new report arrives,
before anything is counted, and independently once a day by a Cron Trigger (`17 4 * * *`, UTC), so
the Privacy page's promise holds even in a week with no reports at all. The owner may delete a
report earlier on request.

## 4. Inside the App

### 4.1 A network module in Rust

`packages/app/src-tauri/src/installer/net.rs`:

- **One origin.** `https://aimloom.dev` is a constant. No command takes a URL from the UI. Redirects
  to another origin are refused. A different origin can be compiled in only under `#[cfg(test)]`.
- **Client.** A small blocking HTTPS client — the candidate is `ureq` with `rustls`. The plan's first
  Rust task confirms it builds on Windows, measures the EXE's growth and keeps `cargo test --offline`
  working once the crates are fetched.
- **Limits.** Connect and read timeouts; a response cap of 64 KiB; a request cap of 1 MiB.
- **Proxy.** Many players reach the internet through a system proxy. When Windows' per-user proxy is
  enabled (`Internet Settings` → `ProxyEnable` / `ProxyServer`), the client uses it; otherwise it
  connects directly. PAC scripts are out of scope.
- **Never blocks the App.** Every command runs off the UI thread; the launch check starts after the
  window is shown and its failure is silent.

### 4.2 Commands

New Tauri commands beside the existing eight. None goes through the PowerShell worker, none touches
the game, and the JSONL wire contract (its four mirrors) does not change.

| Command | Does |
|---|---|
| `installer_report_preview` | takes what only the UI knows — `{ description, contact, attachLog, account, langChoice, lang }` — validates it, builds and keeps the payload (§3), returns `{ text, sha256, bytes }` |
| `installer_report_send` | sends the kept payload; returns `{ number }` or an `Issue` |
| `installer_account_resolve` | sends a Steam link to the backend; returns `{ steamId, name }` |
| `installer_update_check` | reads `latest.json`; returns `{ latest, newer: bool }` |
| `installer_open_logs` | opens `<data folder>\logs` in Explorer; creates nothing; a bilingual issue when it does not exist yet |
| `installer_open_download` | opens `https://aimloom.dev/<lang>/download/` in the default browser; the only parameter is the language |

`contracts.ts` and `bridge.ts` gain the methods; `demo-bridge.ts` fakes them without any network
(a demo report returns `AL-DEMO-0000`). Issues carry both languages, as every native issue does.
The data folder comes from the existing resolver (`data_root`), never from a joined name.

### 4.3 The log becomes UTF-8 (ROADMAP LOG)

Rust copies the worker's stderr into `worker.log` byte for byte, and PowerShell writes it in the
console code page — GBK on a Chinese Windows. `kvk-gui-worker.ps1` sets UTF-8 for its error stream at
start-up, so new log lines are UTF-8. Rust reads the log lossily, so an older GBK part cannot break a
report. This changes a shipped script: all sixteen PowerShell suites run again on Windows.

### 4.4 Where the choices are kept

The account (`{ steamId, name }`) and the update switch live in the App's WebView storage under
`aimloom.account` and `aimloom.updates`, like `aimloom.lang`: read and written inside `try/catch`, a
missing value meaning "no account" and "on". The Setup's "delete application data" option clears
them; the player pastes the link again. No new file format, nothing in the data folder.

### 4.5 Two small fixes that make reports useful (ROADMAP UNK)

The two plain `throw`s in `Invoke-KvkInstall` (a lock failure, an unfinished batch) become
`Throw-KvkFailure` with a code and both texts, so they stop surfacing as `unknown`.

## 5. The backend: `https://aimloom.dev/api/*`

### 5.1 Shape

- `packages/site/src/worker.ts` becomes the Worker's `main`. `assets.run_worker_first` lists only
  `/api/*`: every page and every file under `/files/` is still served as a static asset, without
  running the script.
- Bindings: one D1 database, the mail binding, two rate-limit bindings. There is no R2 bucket.
- **No credentials.** One private setting exists: the owner's mailbox that notifications go to. It is
  a Worker secret, so it never enters git.
- `env.preview` declares its own database (bindings are not inherited) and keeps
  `"routes": []`. `tests/deploy-config.test.ts` pins both.

### 5.2 `POST /api/reports`

1. Accept only `application/json`, at most 1 MiB, from a client that names itself
   `Aimloom/<version>`.
2. Validate strictly: unknown keys are refused; `description` ≤ 2,000 characters; `contact` ≤ 200;
   `log` ≤ 512 KiB; `steamId` is 17 digits.
3. Rate limits, outermost first:
   - **3 requests per 60 seconds per address** through the rate-limit binding. The binding is loose by
     design — the spike on 2026-09-20 saw four pass before the fifth was refused, and again seconds
     later — so it damps a flood and nothing more. **Here it fails open:** if the binding itself
     errors, the report is let through, because the ceilings below are what actually protect the
     archive, and a warning without any address is logged. (A client cannot make the binding
     fail: the key is the address Cloudflare sets.) The Steam route, which has no ceiling behind
     it, fails **closed** (§5.3);
   - **300 reports per UTC day**, counted from the table: the hard ceiling;
   - **64 MiB per UTC day** (`DAILY_LIMIT`, `DAILY_BYTES_CEILING`): the two ceilings above are counted
     in different units — 300 reports × 1 MiB could otherwise reach 300 MiB in a single day against a
     400 MiB archive — so a daily *byte* total closes that gap, answered from the same indexed query
     as the daily count above at no extra cost;
   - **no new report once the archive holds 400 MiB** (`STORAGE_FULL`): D1's free database is 500 MB and
     nobody may fill it. The App answers all three limit codes with "write to feedback@aimloom.dev".
   All four checks (rate limit, daily count, daily bytes, archive total) run in that order, cheapest
   first: the daily total is read from an indexed `WHERE day = ?` query, and the full-table archive
   total is only read once the daily checks pass, so a flood being refused never pays for a full scan.
   Rows older than 180 days are deleted before anything is counted, so a full archive frees itself.
4. Number: `AL-YYMMDD-XXXX` (the UTC date, then four random Crockford base-32 characters).
5. **One insert reserves and stores.** The number is the row's primary key and the whole report is its
   `body` column, so a collision changes nothing and is retried with a new number, and there is no
   half-stored report. The other columns are the index: number, time, App label, language, Windows
   version, whether it has a log, a contact, an account; the SteamID when given; size; mail status.
   The description, the contact and the log live only in `body` and in the notification; list
   queries never select `body`.
6. **Notify, best effort.** A mail to the owner: subject with the number, version, language and the
   description's first words; the summary as text; the log as an attachment; `Reply-To` set when the
   contact is an email address. A mail failure is recorded in the index row and **does not fail the
   report**.
7. Answer `{ "number": "AL-…" }`. Errors are `{ "code": "…" }`; the App owns the wording.

### 5.3 `POST /api/steam/resolve`

Accepts `{ "url": "…" }`. Only `https://steamcommunity.com/id/<name>` and
`https://steamcommunity.com/profiles/<17 digits>` pass, with or without a trailing slash or query.
The Worker fetches the profile's public XML view, which needs no API key (checked on 2026-09-20: it
returns `steamID64`, the name and `privacyState`, and a clear error for an unknown profile), and
answers `{ steamId, name }`. A private profile still yields its id and name. When Steam cannot be
reached and the link is the numeric form, the App keeps the id with an empty name. Limit: 10 requests
per 60 seconds per address. **This limiter fails closed:** the route is an outbound fetch with no
database ceiling behind it, so when the binding errors the answer is `RATE_LIMITED`; the cost is that
a Steam link cannot be resolved during such an outage, which the numeric form already tolerates.

### 5.4 Addresses

The rate-limit binding counts by client address inside Cloudflare; the Worker writes no address to
D1 or mail.

### 5.5 `GET /latest.json`

A static file written at build time from `releases.json`: `{ "version": "<recommended>" }`. No
script runs. The App compares it with its own version by semver; pre-release labels never count as
newer.

### 5.6 Reading a report

`npm run report -w @kvk/site -- AL-260921-7K3F` prints the stored JSON (it wraps `wrangler d1
execute`; the number is checked against its exact shape before it reaches SQL). `npm run reports -w
@kvk/site` lists the latest rows without their bodies.

## 6. Tests that keep it honest

- **Rust:** the payload builder (every field, the caps, the scrubbing rules with Chinese user names,
  the tail cut at a line start); preview-then-send ownership and `PLAN_STALE`; the origin constant
  and refused redirects; the proxy reader; `installer_open_logs` creates nothing; semver comparison.
  HTTP is tested against a local server under `#[cfg(test)]`.
- **UI (jsdom):** the five popover sections in both languages; the account's empty, filled and error
  states; the sheet's form, preview, busy, success and failure states; the update dot; the switch
  persists; focus returns to the Settings button. The dictionary guards already require parity and no
  Chinese in `en`.
- **PowerShell:** the log is UTF-8 on a GBK console; the two new coded failures; all sixteen suites.
- **Worker (workerd, through the site's Vitest 4.1):** validation, the three limits, the number format, one
  insert per report, retention before counting, mail failure not failing the report, the Steam URL
  filter, no address stored.
- **Static:** `run_worker_first` lists only `/api/*`; every environment declares `"routes": []` and
  its own bindings; `latest.json` equals `releases.json`'s recommended version.

## 7. Order, and how it reaches players

Two implementation plans follow this spec, because the first must be live before the second can be
accepted: **(a) the backend and the website**, then **(b) the App**.

1. **A spike before the plan is final.** On the free plan: can the Worker mail the owner's verified
   mailbox with an attachment; are R2, D1 and the rate-limit binding available. (Observed on 2026-09-20:
   D1 yes; the rate limit yes but loose; R2 no — hence §5's D1-only archive.) If mail is not, the
   notification becomes a daily digest or is dropped; the archive does not depend on it.
2. **The backend goes to production before the App is accepted.** The Setup is not byte-reproducible,
   so the file the user accepts must already talk to the real origin. The endpoints are invisible
   until a released App uses them. The backend is developed against workerd and the preview Worker.
   Production deploys, as always, only on the user's explicit word, with the whole output read and
   https://aimloom.dev checked afterwards.
3. **The App:** Figma, then code, then a test package, then one candidate (Setup and ZIP), then the
   user's acceptance. Reports sent during acceptance are real reports and are deleted afterwards.
4. **The website** gains the Privacy page and the reworded promises with the release.
5. **Debts from v0.1.2 closed in this release:** the PowerShell 7 prompt on a PC without it, the
   data-folder refusal's message box on a screen, whether a browser warns about the Setup, the two
   installer minors (`$R9` unsaved; the `winget.exe` alias check).

The new-version notice can be observed end to end only when the release after this one exists;
until then it is covered by tests and by reading the live `latest.json`.

## 8. Figma first

Workspace Figma file: the five-section popover (中文 / English, starting from
SET-A3 / SET-A4); the report sheet's form, expanded preview, success and failure; the update dot.
Website Figma file: the Privacy page and its footer link. Recorded in
`docs/design/figma/README.md` with node ids and reviewed screenshots; the user approves before UI
code.

## 9. Out of scope

- A verified Steam sign-in: needed only for uploading to the explorer, and built with that feature.
- Server-side account records; favourites; uploads.
- An admin page for reports.
- Downloading or installing an update.
- CUR-S1 (themes that lack ceiling or ramp fields), the explorer, the crosshair editor, AI scenes.
- PAC proxy scripts.
- Code signing.
