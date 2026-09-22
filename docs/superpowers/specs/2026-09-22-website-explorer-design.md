# Website explorer (v0.1.5) — amendment to the 2026-09-17 website design

Date: 2026-09-22. Status: **decisions taken with the user on 2026-09-22; not designed in Figma,
not built.** Roadmap entry: v0.1.5 — the website explorer (EXP).

This document amends [the 2026-09-17 website design](2026-09-17-aimloom-website-and-explore-design.md).
It **replaces** that document's §3 (the explorer), §5 (data layer) and §6 (the ZIP contract and
the App's Import entry), and the parts of §4 and §7 that describe them. Phase 1 (§2.1–§2.3), the
release data rules and the bilingual rules are unchanged. Where the two disagree, this one wins.

## 1. What changed and why

| 2026-09-17 design | Now | Source |
|---|---|---|
| Entries are Profile packs **and** single components | **Single files only:** backgrounds (themes), sounds, crosshairs | user, 2026-09-22 |
| A download is a ZIP with `aimloom-pack.json`; the App gains an Import entry | **A download is the raw file.** The player drags it into the matching Aimloom page, or copies it into the game folder and presses 刷新 — both work since v0.1.1 | roadmap, 2026-09-19 |
| Five kinds, including enemy appearance | Three. Enemy looks are the game's own Skin Browser skins now; nothing to share | enemy decision, 2026-09-21 |
| A Profile pack as an entry | No Profile JSON: it records paths on the author's machine | user, 2026-09-22 |
| Content from the maintainer | **Only content whose author has given permission.** The user asks the authors; the pages and the publish tool are built first, content is listed when permission exists | user, 2026-09-22 |
| Separate `aimloom-catalogue` databases | The site's **existing** D1 database (`DB`, already bound for reports) gains the catalogue tables | this amendment |
| Pages server-rendered through `@astrojs/cloudflare` | The Worker already exists and serves only `/api/*`; the explorer routes are added to it (§4). No adapter | this amendment |
| Download counter with IP + user-agent de-duplication | A plain **download-request** counter, no de-duplication, no identifier of any kind (§5.3) | user chose statistics, 2026-09-22; de-duplication dropped here |
| App: nothing until its own Explore page | App: a link to the explorer, shipped as **`0.1.5-beta.N`** through the beta channel (§7) | user, 2026-09-22 |

Unchanged from 2026-09-17: curated only, no public upload, no sign-in (a verified Steam sign-in
comes only with uploads — user, 2026-09-20); files in **R2** behind `dl.aimloom.dev`; metadata in
**D1**; Figma before code.

## 2. The explorer pages

### 2.1 List — `/zh/explore/`, `/en/explore/`

- Three tabs: **背景 · 音效 · 准星** / **Backgrounds · Sounds · Crosshairs**, each its own URL
  (`?kind=theme|sound|crosshair`), default `theme`. The words follow the App's pages.
- A search box over the title, summary and file name in both languages (FTS5), and a sort:
  **最新 / Newest** always; **近 30 天下载最多 / Most downloaded, 30 days** once any item has
  30 days of counts (§5.3). A manually ordered **精选 / Featured** row may head a tab; it is never
  described as popularity.
- Card: preview (§2.3), title, author, licence badge, file size. 24 per page, server-paginated.
- Empty states say which tab or search gave nothing and offer to clear it. A tab with no content
  at all says so plainly; it does not pretend content is coming.

### 2.2 Detail — `/zh/explore/<slug>/`, `/en/explore/<slug>/`

Top to bottom: the preview; title, author (with the link the author gave, if any), licence,
published date; summary in the page language; the file row — file name, bytes, SHA-256;
**Download** (`/d/<slug>`), size and SHA-256 beside it; **How to use** — drag it onto the
matching page in Aimloom (link to the Download page for anyone without the App), or copy it
into the game's folder (the path per kind) and press 刷新; a report link (a pre-filled GitHub
issue); the licence text or link.

A crosshair also shows its CS2 / VALORANT code when it has one, with a copy button and a link that
opens `/crosshair/` with the code filled in.

No page claims the file was checked in the game unless the maintainer saw it there.

### 2.3 Previews

- **Background:** the App's approximate colour preview, rendered in the browser from the theme's
  JSON by the same browser-safe code the App uses, with the App's "approximate" caption.
- **Crosshair:** the PNG on a dark and a light swatch, as the crosshair tool shows it.
- **Sound:** a play / stop button; nothing plays without a click.

### 2.4 Navigation

The site nav gains **探索 / Explore** in the same deploy that makes the explorer reachable. No
"coming soon" before that.

## 3. Content and permission

- Every item records **author**, **licence** (an SPDX id, or `permission` for "used with the
  author's permission"), and optionally the author's link. The publish command refuses an item
  without them.
- The evidence of permission (the author's message) is kept in the maintainer's private records,
  never in the public repository or the database. The public page shows only what the author
  agreed to show.
- The private "KVK Settings 2025" corpus is a third-party pack; nothing from it is published
  without its author's permission.
- Audio is accepted from permitted authors only — audio has no content validator, so the permission
  and the format checks in §6 are the whole gate.

## 4. Routes on the existing Worker

The Worker (`packages/site/src/worker/`) keeps `/api/*` and adds, via `run_worker_first`:

| Route | What it does |
|---|---|
| `/zh/explore/*`, `/en/explore/*` | Reads D1 and renders the list or detail page: it fetches the prerendered Astro shell for that page from `ASSETS` and fills it with `HTMLRewriter`, so a shared link carries real HTML and the site keeps one layout |
| `/api/explore/items?kind=&q=&sort=&page=` | The same data as JSON, for the list's search box without a full reload |
| `/d/<slug>` | Adds one to today's count for that item, then `302` to `https://dl.aimloom.dev/<key>`. Never proxies bytes. Unknown or unpublished slug: `404` |

All `GET`, read-only, cacheable except `/d/`. There is no public write route. The rate limiters and
the report retention cron are unchanged. `dl.aimloom.dev` is an R2 custom domain on the bucket
`aimloom-files` (`aimloom-files-preview` for preview, no domain); the Worker has no R2 binding.
CSP gains `img-src` and `media-src` for `https://dl.aimloom.dev`.

## 5. Data

### 5.1 Tables (a new migration on the existing database)

```sql
CREATE TABLE item (
  slug        TEXT PRIMARY KEY,                 -- Profile id charset (validateProfileId)
  kind        TEXT NOT NULL CHECK (kind IN ('theme','sound','crosshair')),
  status      TEXT NOT NULL CHECK (status IN ('published','hidden')),
  title_zh    TEXT NOT NULL, title_en   TEXT NOT NULL,
  summary_zh  TEXT NOT NULL, summary_en TEXT NOT NULL,
  author      TEXT NOT NULL, author_url TEXT,
  licence     TEXT NOT NULL,                    -- SPDX id or 'permission'
  file_name   TEXT NOT NULL,                    -- the name the game will see; the App's add rules (§6)
  file_key    TEXT NOT NULL UNIQUE,             -- R2 key: files/<sha256>/<file_name>
  bytes       INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  code        TEXT,                             -- crosshair only: the CS2/VALORANT code
  featured    INTEGER,                          -- position in the Featured row, or NULL
  published_at TEXT NOT NULL
);
CREATE INDEX item_browse ON item (kind, status, published_at DESC);
CREATE VIRTUAL TABLE item_fts USING fts5 (slug UNINDEXED, title_zh, title_en, summary_zh, summary_en, file_name);
CREATE TABLE download_daily (
  slug  TEXT NOT NULL REFERENCES item(slug),
  day   TEXT NOT NULL,                          -- UTC YYYY-MM-DD
  count INTEGER NOT NULL,
  PRIMARY KEY (slug, day)
);
```

Kinds use the App's own words for its sections in code (`scheme`/`audio` there; the catalogue uses
`theme`/`sound` because it names files, not sections — the mapping is one table in the publish
command). `code` is `NULL` except for crosshairs.

### 5.2 Changing a published file

A file is never replaced under the same key: a new version is a new SHA-256, a new `file_key` and
an updated row. Old R2 objects stay (a browser may hold a link); they are listed for cleanup by the
publish command, never deleted by it.

### 5.3 Download statistics

- `/d/<slug>` runs `INSERT … ON CONFLICT(slug, day) DO UPDATE SET count = count + 1`. Nothing about
  the requester is read, hashed or stored.
- The site calls it **下载请求数 / download requests** — a request is not a finished download, and
  repeated clicks count twice. The number is shown as "近 30 天 / last 30 days".
- The Privacy page gains one sentence saying this counter exists and what it holds (item, day,
  count). No other change to what the site stores.

## 6. Publishing is a maintainer command

`npm run site:publish -- <folder> [--env production]` on the maintainer's machine is the only
writer. Preview is the default. The folder holds `item.json` (slug, kind, both titles, both
summaries, author, author_url, licence, code) and the one file. It:

1. Parses `item.json` strictly (small size cap, unknown fields rejected).
2. Validates the file for its kind: a theme with `parseScheme` (`@kvk/core`'s browser-safe leaf); a
   crosshair with `canonicalPngIssue` and, when `code` is present, the crosshair parsers; a sound by
   extension (`.wav` / `.ogg`), a RIFF/WAVE or OggS header check and a 5 MiB cap set by the
   command (the App's add path has no size cap of its own). File names follow the App's add rules
   (`Assert-KvkImportFileName` in `kvk-import.ps1`: ≤ 128 characters, no `\ / : * ? " < > |`,
   no `;` in a sound's stem), so a downloaded file can always be dropped into the App.
3. Requires author and licence; refuses anything missing.
4. Uploads to R2 (`files/<sha256>/<file_name>`, `Content-Disposition: attachment`, immutable cache)
   through the maintainer's `wrangler login`, then writes the rows and the FTS entry in one D1 batch.
5. Writes nothing before every check passes, and prints the reason for any refusal.

It exports the database to a gitignored `backups/` before each production publish.

## 7. The App part — shipped as a beta

- Theme, Sounds and Crosshair gain a quiet **在 aimloom.dev 找更多 / Find more on aimloom.dev**
  link that opens the explorer on the matching tab in the App's language.
- The URL is built in Rust from a fixed kind and language — never from a string the UI sends — and
  opened like `installer_open_download`. The only origin stays `aimloom.dev` (`net.rs` is
  unchanged: the App does not fetch the catalogue).
- Released as **`0.1.5-beta.N`** (`releases.json` status `beta`, top-level `beta` naming it); the
  stable recommendation stays **0.1.4**. Only players with 「参与 Beta 测试」 on are offered it.
- The link ships only after the explorer is live on aimloom.dev.

## 8. Design, tests, acceptance

- **Figma first:** the list (three tabs, search, sort, featured row, empty states) and one detail
  page per kind, in zh and en, desktop and phone. Code starts after the user reviews them.
- **Tests:** migration and queries in the workerd suite (kinds, FTS, pagination, the 30-day sort
  appearing only with 30 days of data, `/d/` counting and redirecting, 404s); the publish
  command's refusals (oversize crosshair, a theme `parseScheme` rejects, an unknown `item.json`
  field, a missing licence) and one accepted fixture per kind; build-output checks for both
  languages and the nav entry; axe and links as for every page; the App link's URL building in
  Rust and its button in the App suite.
- **Acceptance:** list and detail render in both languages for each kind with real, permitted
  content; a file downloaded from the site matches the SHA-256 shown; the downloaded file dropped
  onto the matching App page installs it (observed on Windows); the counter moves on a download;
  the App link opens the right tab from a `0.1.5-beta.1` build.

## 9. Open

- **Tags** (training purpose) are left out of 0.1.5; single files rarely have one purpose.
- **Community uploads** remain the roadmap's UPLOAD item, with the Steam sign-in and moderation.
- Whether the App's own Explore page (APP-NAV) reads this same API is decided when it is designed.
