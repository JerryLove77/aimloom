# Aimloom website — product pages and the configuration explorer

Date: 2026-09-17. Branch: `feature/web`. Status: **design approved in conversation on
2026-09-17, infrastructure settled 2026-09-18; Phase 1 implemented on `feature/web` and not
deployed; Phase 2 planned only.**

> **Amended 2026-09-22.** §3, §5 and §6 (and what §4 and §7 say about them) are replaced by
> [the v0.1.5 explorer amendment](2026-09-22-website-explorer-design.md): single files only
> (backgrounds, sounds, crosshairs), raw-file downloads, no ZIP manifest and no App Import entry.

This document is the single design for the public website. It has two jobs:

1. **Introduce the product and offer the download** — the four bilingual pages from the
   [2026-09-08 website spec](2026-09-08-aimloom-website-design.md) (Home, Download, Guide,
   Changelog). That spec's content order, bilingual rules, visual brief and acceptance list
   still apply; this document changes nothing there except where it says so.
2. **Let people who already have the App explore configurations** — an `/explore` section
   backed by SQL, where a visitor browses curated Training Profile packs and single
   components, downloads a ZIP, and imports it into the App.

It merges and supersedes the
[2026-09-17 catalogue design](2026-09-17-aimloom-catalogue-design.md). That file stays for
history; its schema, verification record and boundary decisions are carried forward here
with the amendments in §5.

## 1. Decisions recorded on 2026-09-17

These were asked and answered one at a time before the design was written.

| Question | Decision |
|---|---|
| Output of this round | A unified design spec. Figma and code follow the repository rules afterwards. |
| When the explorer ships | **Phase 2.** Phase 1 is the four static pages; the explorer and its database come after. Both phases live in this spec. |
| Content source | Maintainer-curated only. No public submission entry in Phase 2. |
| What an explorer entry is | Both: a full Profile pack (background + sounds + crosshair + enemy for one training purpose) **and** a single component. A single component is a pack that references one asset. |
| How a download reaches the App | The site serves a **ZIP** (`aimloom-pack.json` + files). The App gains an **Import** entry that verifies and unpacks it. The App stays offline. |
| Site architecture | **Astro** on one Cloudflare **Worker** (static assets in Phase 1; Phase 2 adds server-rendered `/explore` routes and read-only API endpoints through the Cloudflare adapter), with **D1** (SQLite) for metadata and **R2** for files. Originally "Pages"; changed 2026-09-18 — see §4.1. |
| Audience and edge (2026-09-18) | Mainland China and overseas, but KovaaK players mostly have a VPN: Cloudflare's global network only, **no China mirror**; measure one mainland download after launch before deciding otherwise. |
| Account, domain, budget (2026-09-18) | No Cloudflare account or domain exists yet; everything starts on the **free tier** and `workers.dev`, the domain is bought through Cloudflare Registrar when needed. |
| Primary browsing axis | **By component kind**: full packs, background themes, sounds, crosshairs, enemy appearance — the same five nouns as the App's sections. Training-purpose tags are a filter, not the top level. |

Two earlier decisions stand unchanged: the desktop App gets **no database** (its Profile
storage stays one JSON file each), and the catalogue accepts **no community audio** because
audio is the one asset kind with no content validator.

## 2. Site structure

### 2.1 Workspace and hosting

- New workspace `packages/site` (`@kvk/site`), Astro, deployed as one Cloudflare Worker
  (`aimloom-site`) with a `preview` environment; see §4.1 for the topology.
- Every page exists under `/zh/…` and `/en/…`. Language selection follows the 2026-09-08
  rules: explicit URL first, then the remembered choice, then browser language (Chinese
  browsers → `zh`, everything else → `en`). Switching keeps the current page, anchor and
  query string.
- No remote fonts or tracking scripts. Images are compressed and sized; audio plays only on
  an explicit click.

### 2.2 Phase 1 — the four pages (W1/W2)

| Page | Logical path | Purpose |
|---|---|---|
| Home | `/` | What the product is, real screenshots, capabilities, the install flow, FAQ, closing download block |
| Download | `/download` | The one recommended package: version, date, size, requirements, contents, SHA-256, first step after download |
| Guide | `/guide` | Unpack → choose game folder → check the plan → install → select assets in game → back up and restore; **§2.4 adds an "Import a pack" section** |
| Changelog | `/changelog` | Per released version: date, improvements, fixes, known issues, link to its download |

Navigation: 功能介绍 (home anchor) · 使用帮助 · 更新记录 · **下载** (the orange primary
button) · 中文 / EN. Mobile keeps every entry and a visible download button.

Home content order and the visual direction follow the 2026-09-08 spec: the fifth-round
concept (translucent Gulf-blue ground, black and orange foreground, KovaaK training scene)
is the starting point, with the copy re-centred on Training Profiles as the 2026-09-13
positioning amendment requires. Nothing on the site describes Profile Save as applying to
the game, and nothing advertises a capability the released package does not have.

### 2.3 Release data is one file

`packages/site/src/data/releases.json` is the only place a version is described:

```jsonc
{
  "schemaVersion": 1,
  "recommended": "0.1.0",              // must match one entry's version, or be null
  "releases": [
    {
      "version": "0.1.0",
      "status": "preparing",           // "preparing" | "beta" | "stable"
      "date": null,                    // "YYYY-MM-DD" once released
      "platform": "Windows 10/11 x64",
      "requires": ["PowerShell 7.0+"],
      "bytes": null,
      "sha256": null,
      "primaryUrl": null,              // R2 download subdomain
      "mirrorUrl": null,               // GitHub Releases asset
      "contents": ["…"],
      "notes": { "zh": "…", "en": "…" },
      "knownIssues": { "zh": ["…"], "en": ["…"] }
    }
  ]
}
```

Rules, enforced by a schema test:

- `status: "preparing"` requires `bytes`, `sha256`, `primaryUrl` and `mirrorUrl` to be
  `null`, and the site renders **no download link** for it — only the guide and changelog
  entries, exactly as the 2026-09-08 spec's "准备中" state describes.
- `beta` and `stable` require `bytes`, `sha256` and `primaryUrl`. The page shows the beta label
  and its known issues; a mirror, when present, must serve the same bytes as the primary URL.
- *Amended 2026-09-19.* `mirrorUrl` may be `null` (the GitHub repository is private, so there
  is no public Releases asset yet); the page then shows one link. `primaryUrl` is an `https://`
  URL or `/files/<name>.zip`, a ZIP the site serves itself, staged into `dist/files/` at
  deploy time by `scripts/stage-release.mjs` after its size and SHA-256 are checked against
  this file. R2 and `dl.<domain>` take over when the explorer's infrastructure exists.
- Home, Download and Changelog all read this file; none carries a hand-typed version.

### 2.4 Phase 2 — the explorer joins the site

- Navigation gains **探索 / Explore** only when Phase 2 ships. Until then there is no
  "coming soon" placeholder, because the repository does not advertise unshipped work.
- The Guide gains a section "导入配置包 / Import a pack" describing the App's Import entry
  (§6). It is written when that entry exists, not before.

## 3. The explorer

### 3.1 List — `/explore`

- Five tabs, in this order: **完整包 · 背景主题 · 音效 · 准星 · 敌人外观** (full packs,
  background themes, sounds, crosshairs, enemy appearance). Default tab: full packs. Each
  tab is a URL (`/explore?kind=pack` … `kind=enemy`) so it can be linked and shared.
- Below the tabs: a search box (FTS over titles and summaries in both languages), a
  training-purpose filter (tags such as 静态点击 / 跟枪 / 甩枪 / 切换目标, from the `tag`
  table), and a sort control. Sort offers **最新** always, and **近 30 天热门** only once
  download statistics exist (§5.5). The manually ordered block at the top of a tab is titled
  **精选配置 / Featured configs** and is never described as popularity.
- Card contents: preview, title, author handle, license badge, ZIP size. A full-pack card
  also shows small icons for the components it contains. Previews per kind: theme
  screenshot; crosshair PNG rendered on both a dark and a light swatch; enemy appearance
  preview; audio as a waveform with a play button; pack as a composite of its parts.
- Pagination is server-side, 24 per page; the empty state says which filter produced no
  result and offers to clear it.

### 3.2 Detail — `/explore/<slug>`

Top to bottom:

1. Gallery (the `media` rows, with required alt text in both languages).
2. Title, author, license, published date, version.
3. Summary in the current language.
4. **Component list** — one row per file: role (and audio event for sounds), file name,
   bytes, SHA-256. Roles the pack leaves untouched are shown as "保持当前设置 / keeps your
   current setting".
5. **Requirement notice**: "需要 Aimloom App ≥ vX" from `pack.min_app_version`, with a link
   to the Download page.
6. **Download ZIP** button (`/d/<slug>/<version>.zip`), showing size and SHA-256 next to it.
7. **How to import** — three steps, linking to the Guide's import section.
8. Version history (`pack_version` rows with notes), a report link (a pre-filled GitHub
   issue URL; no form on the site), and the licence text.

Nothing on a detail page claims in-game verification unless a maintainer observed it; the
same evidence discipline as the rest of the repository applies to catalogue copy.

### 3.3 Audio on the site

Only project-curated audio appears (no community audio, per the standing decision). It
plays on click, never automatically, and the player exposes a stop control and respects
`prefers-reduced-motion` for its waveform animation.

### 3.4 Who the explorer is for

Visitors need no account. "Users who already downloaded the App" is served by the
requirement notice and the import steps on every detail page, not by any identity check.

## 4. Rendering and deployment shape

- Phase 1 pages are **prerendered** static HTML, served as Worker static assets.
- Phase 2 `/explore` and `/explore/<slug>` are **server-rendered on request** through
  `@astrojs/cloudflare`, so shared links carry real HTML. The list page may hydrate a small
  island for the filter controls; the detail page needs no client JavaScript beyond the
  audio player.
- API endpoints live in the same Astro project as server endpoints; D1 is bound in
  `wrangler.jsonc`. **R2 has no binding**: the Worker never reads file bytes — a download is a
  counted `302` to the public file origin (`FILES_ORIGIN`) — and only the publish command
  writes to R2, through the maintainer's `wrangler login`. There is no separate worker package.

### 4.1 Infrastructure (researched 2026-09-18)

**Why not Pages.** `@astrojs/cloudflare` removed Pages support in v13 and deploys to Workers
only; `pages.dev` is not reachable from mainland China; and Pages has no path to on-demand
routes without Functions. One Worker serves both phases without a migration.

| | Phase 1 | Phase 2 |
|---|---|---|
| Worker `aimloom-site` | static assets only: `wrangler.jsonc` with `assets.directory = ./dist`, no `main`, no adapter | same Worker plus the adapter (`main: @astrojs/cloudflare/entrypoints/server`); `output: 'static'` with `export const prerender = false` on `/explore*`, `/api/*`, `/d/*` |
| Dev server | `astro dev` on Vite | `astro dev` on workerd through the adapter; bindings via `import { env } from 'cloudflare:workers'` |
| Free-tier cost | static asset requests are free and unlimited | 100 000 dynamic requests/day, 10 ms CPU each, ≤ 50 D1 queries per request; an explore view is one request |
| Preview | `wrangler deploy --env preview` → Worker `aimloom-site-preview` on `*.workers.dev` | same, with its own D1 and bucket |

Static assets also carry `public/_headers` (CSP `default-src 'self'; img-src 'self' data:;
media-src 'self' https://dl.<domain>`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`) and `html_handling: "auto-trailing-slash"`,
`not_found_handling: "404-page"`.

**Domain and DNS, from zero.** Create the free account and enable a `workers.dev` subdomain —
previews work at once. Register the domain through Cloudflare Registrar (at cost; nothing in
code depends on the name — `SITE_ORIGIN` is a build-time variable). Routes are Worker and R2
custom domains, not hand-written records: `<domain>` → `aimloom-site`
(`routes: [{ pattern, custom_domain: true }]`), `dl.<domain>` → bucket `aimloom-files`.
`r2.dev` stays off; preview has no domain.

**Storage.** One public bucket `aimloom-files` (plus `aimloom-files-preview`); anything private
never enters it. Keys: `releases/<version>/<file>.zip`, `packs/<slug>/v<n>.zip`
(= `pack_version.zip_key`), `assets/<sha256><ext>`, `media/<slug>/<n>.<ext>`. ZIPs are
uploaded with `Cache-Control: public, max-age=31536000, immutable`. Uploads happen only from
the maintainer's machine through `wrangler r2 object put` under an interactive `wrangler login`
— no API token in the repository, no CI upload. Free tier: 10 GB, egress free.

**Database.** `aimloom-catalogue` (production, binding `DB`) and `aimloom-catalogue-preview`
(`env.preview`); wrangler bindings are not inherited, so both are declared. Free tier: 500 MB
per database, 5 M row reads and 100 k row writes per day, FTS5 supported, 2 MB max row —
the catalogue is metadata of a few MB and one download is one write. Migrations live in
`packages/site/migrations/` (the first is the verified schema in
`notes/2026-09-17-website-schema.sql` plus the FTS5 table) and are applied with
`wrangler d1 migrations apply <db> --local | --remote | --env preview --remote`; local state in
`.wrangler/state` is gitignored. Tests run in workerd through `@cloudflare/vitest-plugin`
(peer `vitest ^4.1.0`; the site pins 4.1.11) from a second config, applying the migrations with
`readD1Migrations` / `applyD1Migrations`; the node config keeps the pure-TS and build tests.
Backups: Time Travel keeps 7 days on the free plan (30 on Paid); `npm run db:export` writes a
SQL dump into a gitignored `backups/` before every publish, and the maintainer's pack source
folders can rebuild the database by re-running the publish command.

**Environments, secrets, publishing.** Top level of `wrangler.jsonc` is production,
`env.preview` is preview; `wrangler types` generates the binding types. **No secrets exist**:
every public route is read-only, publishing and uploads use the maintainer's OAuth login, and
reports go to a GitHub issue link. The publish command targets preview by default and needs an
explicit `--env production`. Deployment is `wrangler deploy` from the maintainer's machine;
Workers Builds (git-connected previews) is optional and added only after the domain exists.

**Costs.** Free within quotas; free-tier overage **blocks** rather than bills. Domain at cost
(around $10/year for common TLDs). Upgrade to Workers Paid ($5/month) when the explorer nears
80 000 dynamic requests a day or 30-day Time Travel is wanted. Re-check the Workers, D1 and R2
pricing pages when provisioning.

**China.** No mirror. Installer ZIP primary on `dl.<domain>`, mirror on GitHub Releases. One
measured download from a mainland connection is recorded after launch before deciding on a
mirror.
- Astro ships its own Vite (Astro 7.3.3 depends on `vite ^8`). A lockfile-only dry run on
  2026-09-17 showed npm **nesting** Astro's Vite 8 under `node_modules/astro/` while the
  root's pinned `vite 7.3.6 / @vitejs/plugin-react 5.2.0 / vitest 3.2.7` chain stayed in
  place (see the [verification note](../notes/2026-09-17-website-spec-verification.md)).
  The site is therefore an ordinary workspace. The first implementation task still has to
  confirm this with a real install, `astro build` and the Docker image; if a real install
  ever hoists Vite 8, the site moves to its own lockfile rather than the pin moving.

## 5. Data layer

### 5.1 Placement

Metadata in **D1**; files in **R2**; the App has no database. Nothing here changes
`TrainingProfile`, `parseTrainingProfile` or `parseFileReference`
(`packages/app/src/profiles/…`, on the App branches). The App's Profile still points at
local paths only; the catalogue distributes a portable manifest (§6) and the App builds the
local Profile at import time.

### 5.2 Schema — the catalogue schema with four amendments

The base schema is the one in the catalogue design, which was executed against real SQLite
on 2026-09-17 (creates cleanly; a second `scheme` on one version is rejected by the primary
key thanks to the `'-'` sentinel in `audio_event`; ordered audio lists round-trip; an
oversize crosshair is rejected by the CHECK). There is no deployed database yet, so the
amendments go into the `CREATE TABLE` statements of the first migration rather than into
`ALTER TABLE` steps. (SQLite accepts `ADD COLUMN … NOT NULL` without a default only while
a table is empty and refuses it once rows exist — observed on 3.43.2 — so the amended
schema was re-verified as a whole; see the
[verification note](../notes/2026-09-17-website-spec-verification.md), which also records
the kind-consistency query and the `zip_key` uniqueness test.)

```sql
-- 1. The browsing axis, added to `pack`.
  kind            TEXT NOT NULL CHECK (kind IN ('pack','scheme','audio','crosshair','enemy')),
-- 3. The requirement notice on the detail page, added to `pack`.
  min_app_version TEXT NOT NULL,

-- 2. One immutable ZIP per version, added to `pack_version`. A new version gets a new key;
--    keys are never reused.
  zip_key         TEXT NOT NULL UNIQUE,
  zip_bytes       INTEGER NOT NULL,
  zip_sha256      TEXT NOT NULL,

CREATE INDEX pack_browse_kind ON pack (kind, status, published_at DESC);

-- 4. Removed for Phase 2: the `submission` and `report` tables. There is no public
--    submission entry, and reports go to a GitHub issue link. They return, with their
--    own review, when a submission entry is designed.
```

`pack.kind` must agree with the version's `pack_asset` rows: `kind = 'pack'` means two or
more roles are present; any single kind means exactly one role, and it is that role. SQL
cannot express this across tables, so the publish command (§5.4) enforces it and a
verification query in the test suite checks the live database for violations.

Vocabulary stays verbatim from the App code so nothing drifts: `asset.kind` and the single
pack kinds come from `AssetKind` (`packages/app/src/profiles/assets.ts`); `audio_event`
values from `AUDIO_EVENTS` and the 64-file cap from `MAX_AUDIO_FILES`
(`packages/app/src/profiles/audio/model.ts`); `pack.slug` follows `validateProfileId`
(`packages/app/src/profiles/model.ts`); crosshair limits are `MAX_DIMENSION` and
`MAX_PNG_BYTES` (`packages/crosshair/src/png.ts`).

Full-text search is an FTS5 table over `title_zh, title_en, summary_zh, summary_en`,
rebuilt on publish.

### 5.3 Read-only API

All endpoints are `GET`, public, cacheable, and return only published packs. There is no
public write endpoint of any kind.

| Endpoint | Returns |
|---|---|
| `/api/packs?kind=&tag=&q=&sort=&page=` | A page of list cards for one kind; `sort` is `new` or, when statistics exist, `trending` |
| `/api/packs/:slug` | The detail record: current version, components, media, version history |
| `/d/:slug/:version.zip` | Increments the daily counter, then `302` to the R2 object; the response never proxies file bytes |

`author.contact` is never returned. Responses include `Cache-Control`; list pages for a few
minutes, detail records until republished, the ZIP redirect not at all.

### 5.4 Publishing is a maintainer command

`npm run site:publish -- <folder>` runs on the maintainer's machine and is the **only**
writer to D1 and R2. Given a folder holding `aimloom-pack.json` plus the files, it:

1. Parses the manifest with a strict parser (≤ 256 KiB, unknown fields rejected — the same
   posture as `parseTrainingProfile`).
2. Validates every file with the existing validators: `canonicalPngIssue` for crosshairs,
   the 20-field allowlist `ENEMY_THEME_FIELDS` (`packages/app/src/enemy/theme.ts`) for
   enemy themes, `parseScheme` (`packages/core/src/scheme/document.ts`) for backgrounds.
   Audio is accepted only from the project's own curated set, listed by SHA-256.
3. Checks the `kind` rule from §5.2, safe file names, per-kind size limits and the licence
   field being present.
4. Builds the ZIP (§6.1), computes its SHA-256, uploads assets and the ZIP to R2 under
   content-addressed and version keys, then inserts the rows in one D1 batch.
5. Refuses to publish on any failure, with the reason printed. Nothing is uploaded before
   validation completes.

Because `@kvk/core` and the App validators live in other workspaces, the command imports
their browser-safe leaf modules directly; it does not make `@kvk/core` a runtime dependency
of anything that ships to players.

### 5.5 Download statistics

- The counter records **download requests**, and the site labels it that way:
  "下载请求数 · 近 30 天". A request is not a completed download and is never described as
  one.
- `download_daily` stores one row per pack per day
  (`INSERT … ON CONFLICT(pack_id, day) DO UPDATE SET count = count + 1`); no per-visitor rows
  and no identifiers. Short-window de-duplication uses the Workers Cache API: a synthetic URL
  `https://dedupe.invalid/<slug>/<sha256(ip + user-agent)>` cached for an hour; a hit skips
  the write. The cache is per location and best effort, which is exactly why the label says
  "requests". The rate-limiting binding is not used (free-plan availability unconfirmed).
- "Trending" is a query over the last 30 days, computed when requested and cached for an
  hour; it is not a stored column. Until a pack has at least 30 days of data the sort is
  hidden and the featured block stands in.

## 6. The ZIP contract and the App's Import entry

This spec fixes the wire format and the App-side boundaries. The App's own spec designs the
UI placement and the native implementation; it must not change anything below without
updating this document.

### 6.1 ZIP layout

```
<slug>-v<version>.zip
├── aimloom-pack.json
└── files/
    ├── Blue Hour.json
    ├── dot_small.png
    └── spawn05.wav
```

`aimloom-pack.json` is the catalogue manifest with two additions:

```jsonc
{
  "schemaVersion": 1,
  "kind": "pack",                       // or one of the four single kinds
  "id": "night-tracking",               // = pack.slug, Profile id charset
  "name": "夜间跟枪",
  "minAppVersion": "0.2.0",
  "source": { "slug": "night-tracking", "version": 3 },
  "components": {
    "scheme":    { "sha256": "…", "file": "Blue Hour.json" },
    "crosshair": { "sha256": "…", "file": "dot_small.png" },
    "enemy":     null,                  // keeps the player's current value
    "audio":     { "spawn": [{ "sha256": "…", "file": "spawn05.wav" }] }
  }
}
```

`file` names are exactly the `pack_asset.file_name` values, flat under `files/`, and must
pass the App's safe-name rules. A single-component ZIP uses the same layout with one entry.

### 6.2 What the App does with it

- A new **导入配置包… / Import a pack…** entry (placement decided in the App spec; the
  Profile page is the expected home) opens a file picker for `.zip`.
- The App parses the manifest strictly, then verifies each file's SHA-256, size and kind
  validator **before writing anything**. A mismatch aborts the whole import with a message
  naming the file.
- Files are written to a local asset folder the player chooses, **outside the game
  directory**. This write follows the `Export-KvkFile` rules in `kvk-engine.ps1`:
  `CreateNew` (never overwrite), refuse any path inside the game root, safe names, a size
  ceiling, and no backup batch — because nothing in the game changes.
- A full pack becomes a **Profile draft** whose `{name, path}` records point at the written
  files; the player saves it through the existing Profile flow. A single component simply
  appears in its section's picker.
- **Applying to the game still goes through the engine and a plan**, with the game-closed
  check, first-protection backup and recoverable transaction unchanged. Import adds no
  write path into the game.
- The App never contacts the network. Import works from any ZIP on disk, whatever its
  origin, which is also why the validators — not the download source — are the security
  boundary.

## 7. Design workflow, testing and acceptance

### 7.1 Figma first, per phase

Website screens require editable Figma designs before implementation (2026-09-13 workflow
amendment). Phase 1 covers the four pages in zh/en × desktop/mobile; Phase 2 covers the
explorer list (all five tabs, empty state) and the detail page. File and node links,
reviewed screenshots and token mappings are recorded in `docs/design/figma/README.md` as
they are authored. This document is not a Figma design and does not count as one.

### 7.2 Tests

| Area | What is tested | How |
|---|---|---|
| Release data | `releases.json` schema; `preparing` renders no link; `beta`/`stable` render size, SHA and both URLs | Vitest in `packages/site` |
| i18n | Every page exists in both languages; switching preserves path, anchor and query; `<html lang>` and meta follow the language | Build-output assertions |
| Explorer queries | Migrations apply; the five kind queries, tag filter, FTS, pagination; the `kind` consistency query finds a seeded violation | Wrangler local D1 |
| Download endpoint | Counter increments once per de-dup window; response is a `302` to R2; unknown slug is `404` | Wrangler local runtime |
| Publish command | Rejects an oversize crosshair, an enemy theme with a 21st field, a manifest with an unknown key, a `kind` mismatch; accepts the fixture pack | Repository fixtures (`KVK Settings 2025/Themes`, crosshair test PNGs) |
| Accessibility and links | axe on every built page; no broken internal link | CI |

Vitest for the site runs from its own workspace (`npm test -w @kvk/site`) with a
site-local Vitest 4.1 (the version `@cloudflare/vitest-plugin` peers on; see the verification note §0), which the dry run in §4 showed nesting under `packages/site/` without
moving the root's 3.2.7. It does **not** join the root project list: the root Vitest cannot
load Astro's Vite 8 configuration. The root `npm test` therefore stays as it is, and CI
runs the site suite as a separate step.

### 7.3 Acceptance

Phase 1 uses the 2026-09-08 acceptance list unchanged. Phase 2 adds:

- Both languages of the list and detail pages render for every seeded kind.
- A ZIP downloaded from the site matches the SHA-256 shown beside the button.
- The App's Import round-trip — ZIP → verified files → Profile draft → saved Profile — is
  observed on Windows, with the game-directory refusal exercised. Until observed, the site
  describes Import only as far as the released App supports it.
- The statistics label states its definition and period; hiding the trending sort before
  30 days of data is observed.

### 7.4 Repository impact

- New workspace `packages/site`; `Dockerfile` manifest copies and `.dockerignore` gain it
  (CLAUDE.md: a new workspace is not automatically containerised).
- `ROADMAP.md` (on the App branches, not yet on `feature/web`) W1/W2 remain Phase 1; a
  W3 line for the explorer is added when the branches merge.
- Cloudflare resources (account, Worker, two D1 databases, two R2 buckets, domain) are
  created at provisioning time by the runbook in the Phase 2 plan; this document does not
  claim any exist.

## 8. Scheduling

1. Windows acceptance and a real v0.1.x release, so the download page has a real file.
2. Phase 1: Figma for the four pages → implementation → launch with `releases.json`
   reflecting the actual release status.
3. Phase 2: Figma for the explorer → D1/R2 provisioning → publish command → explorer routes
   → launch with curated packs only. The App's Import entry is planned alongside so the
   detail page's requirement notice points at a version that exists.

Building the distribution channel before the product is verified on Windows would invert
the risk; the order above keeps the site honest at every step.

**Hard prerequisite for Phase 2 code.** The publish command imports validators from
`packages/crosshair`, `packages/app/src/enemy`, `packages/app/src/profiles` and
`packages/core`, none of which exist on `feature/web` (it is `main` plus documents). Phase 2
code starts only after the App branches (`feature/enemy`, or a `main` that contains it) are
merged into `feature/web`. Phase 1 has no such dependency.

## 9. Open questions

1. **Import entry placement** in the App (Profile page vs. a top-level action) — owned by
   the App spec.
2. **Whether Phase 2 needs `author` at all** while every pack is project-curated. Kept for
   now so credits on redistributed themes are possible; may collapse to a text column.
3. **Community submissions** — deliberately absent. Reintroducing them brings back the
   `submission`/`report` tables, an identity decision (GitHub-carried is the likely answer)
   and moderation capacity, as the catalogue design recorded.

## 10. Implementation status

Phase 1 is implemented in `packages/site` and has never been deployed; Phase 2 is planned only.

- Phase 1 — the four static pages: [`plans/2026-09-17-website-phase-1.md`](../plans/2026-09-17-website-phase-1.md);
  designed in Figma first (`docs/design/figma/README.md`); what was observed is in §3 of the
  verification note.
- Phase 2 — the explorer, D1, the publish command and the provisioning runbook:
  [`plans/2026-09-18-website-phase-2.md`](../plans/2026-09-18-website-phase-2.md). Its
  prerequisites are Phase 1, the App-branch merge (§8) and the explorer's Figma frames.
- What has actually been observed is in
  [`notes/2026-09-17-website-spec-verification.md`](../notes/2026-09-17-website-spec-verification.md).

Nothing in this document reports a page as designed beyond the frames recorded in
`docs/design/figma/README.md`, or a capability as shipped.
