# Aimloom catalogue — website database design

> **Superseded on 2026-09-17** by the
> [website and explorer design](2026-09-17-aimloom-website-and-explore-design.md), which
> carries this schema forward with four amendments (`pack.kind`, `pack.min_app_version`,
> per-version ZIP columns, and the removal of `submission`/`report` for Phase 2) and settles
> the open questions on bundle format and import placement. Kept for the schema
> verification record and the reasoning below.

Date: 2026-09-17. Branch: `feature/web`. Status: **superseded; see above.**
Scope: the website's curated-configuration catalogue (ROADMAP W1/W2) and the database behind it.

This document decides where a database belongs, what it stores, and how a downloaded
configuration reaches a player's game without weakening any existing rule. It does not
authorize implementation: the website has no code on any branch, and this subsystem is
scheduled after the first release.

## Decision: the database is website-only

**The desktop application gets no database.** Two repository constraints forbid it, and a
third makes it pointless:

- The installer ships PowerShell, not Node. `@kvk/core` is explicitly not a runtime
  dependency of the installer and must not become one. A database engine in the desktop
  build breaks that rule.
- Profile storage is deliberately one JSON file per Profile. The 2026-09-15 scope
  amendment states plainly: start with simple JSON/file storage, and do **not** require a
  managed-asset database, immutable revisions or a migration engine. SQL on the desktop
  reverses that decision.
- The application is offline-first — its CSP forbids remote fonts and images. There is no
  desktop feature that a local relational store would serve.

**The website is where a database earns its place.** The site is already planned as
Cloudflare-hosted, and W1/W2 already include curated configurations. Cloudflare D1 is
SQLite, so it is the path of least new infrastructure.

## What the database stores

Metadata only. **Files never go in SQL**; they live in R2 and the database holds pointers.
That matches the product's existing model, in which a configuration is an ordinary file.

| Stored in D1 | Stored in R2 |
|---|---|
| Catalogue entries, titles, descriptions, authorship | Theme `.json`, crosshair `.png`, enemy `.json`, sound `.wav`/`.ogg` |
| Component kind, tags, search and sort keys | Screenshots and preview images |
| Published versions, checksums, sizes | Downloadable bundles |
| Download counts and trend ranking | — |
| Submission and moderation queue | — |
| Abuse reports and takedown records | — |

## Alignment with the existing Profile format

### The finding that shapes the whole design

`ProfileFileReference` is `{ name, path }`, and `parseFileReference`
(`packages/app/src/profiles/file-reference.ts`) requires `path` to be a **plain local file
path** — it rejects URLs and device paths outright. Every component reference in a
`TrainingProfile` therefore points at a location on its author's own disk.

**A Profile JSON cannot be published as-is.** Its paths are meaningless on another machine.
Anything the catalogue distributes must carry the asset files plus a portable manifest, and
the desktop must build the local `TrainingProfile` at import time.

### The portable manifest is a separate type

The published bundle uses its own schema. `TrainingProfile` does not change, and
`parseTrainingProfile` is not touched.

```jsonc
// aimloom-pack.json — the published form
{
  "schemaVersion": 1,
  "kind": "pack",
  "id": "night-tracking",           // same charset rule as a Profile id
  "name": "夜间跟枪",
  "components": {
    "scheme":    { "sha256": "…", "file": "Blue Hour.json" },
    "crosshair": { "sha256": "…", "file": "dot_small.png" },
    "enemy":     null,               // null keeps the player's current value
    "audio": {
      "kill":  [{ "sha256": "…", "file": "saya_kick_deeper.wav" }],
      "spawn": [{ "sha256": "…", "file": "spawn05.wav" }]
    }
  }
}
```

Import is a pure conversion: download each asset into a local folder the player chooses,
verify its SHA-256, then construct a `TrainingProfile` whose `path` values point at those
local files. `null` still means "keep current", exactly as it does today.

### Vocabulary shared with the code

The database reuses the application's own strings verbatim, so no translation layer exists
to drift:

| Column | Values | Source of truth |
|---|---|---|
| `asset.kind` | `scheme`, `audio`, `crosshair`, `enemy` | `AssetKind` in `packages/app/src/profiles/assets.ts` |
| `pack_asset.audio_event` | `kill`, `spawn`, `mbsGood`, `mbsOkay`, `mbsBad`, `mbsChangeNow` | `AUDIO_EVENTS` in `packages/app/src/profiles/audio/model.ts` |
| `asset.ext` | `.json` (scheme, enemy), `.png` (crosshair), `.wav`/`.ogg` (audio) | `extensions` in `assets.ts`, and `parseTrainingProfile` |
| `pack.slug` | `^[a-z0-9][a-z0-9_-]{0,63}$` | `validateProfileId` in `packages/app/src/profiles/model.ts` |

Existing limits become database constraints: a crosshair is at most 512×512 and 2 MiB
(`MAX_DIMENSION`, `MAX_PNG_BYTES` in `packages/crosshair/src/png.ts`); an audio event holds
at most 64 files (`MAX_AUDIO_FILES`); a manifest is at most 256 KiB.

## Schema

SQLite/D1. Times are Unix seconds. Every asset is content-addressed by SHA-256, so the same
file uploaded twice is stored once.

```sql
CREATE TABLE author (
  id            INTEGER PRIMARY KEY,
  handle        TEXT NOT NULL UNIQUE,          -- display name shown on the site
  contact       TEXT,                          -- private; never returned by the public API
  created_at    INTEGER NOT NULL
);

CREATE TABLE asset (
  sha256        TEXT PRIMARY KEY,              -- content address; also the R2 object key
  kind          TEXT NOT NULL CHECK (kind IN ('scheme','audio','crosshair','enemy')),
  ext           TEXT NOT NULL,                 -- '.json' | '.png' | '.wav' | '.ogg'
  bytes         INTEGER NOT NULL,
  width         INTEGER,                       -- crosshair only
  height        INTEGER,                       -- crosshair only
  duration_ms   INTEGER,                       -- audio only
  validated_by  TEXT NOT NULL,                 -- the validator version that accepted it
  created_at    INTEGER NOT NULL,
  CHECK (kind <> 'crosshair' OR (width <= 512 AND height <= 512 AND bytes <= 2097152))
);

CREATE TABLE pack (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,          -- Profile id charset
  title_zh      TEXT NOT NULL,
  title_en      TEXT NOT NULL,
  summary_zh    TEXT,
  summary_en    TEXT,
  author_id     INTEGER NOT NULL REFERENCES author(id),
  license       TEXT NOT NULL,                 -- required; see Licensing
  status        TEXT NOT NULL CHECK (status IN ('draft','in_review','published','hidden','removed')),
  published_at  INTEGER,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE pack_version (
  id            INTEGER PRIMARY KEY,
  pack_id       INTEGER NOT NULL REFERENCES pack(id),
  version       INTEGER NOT NULL,              -- 1, 2, 3 …
  manifest_json TEXT NOT NULL,                 -- the aimloom-pack.json above, verbatim
  manifest_sha  TEXT NOT NULL,
  notes_zh      TEXT,
  notes_en      TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE (pack_id, version)
);

-- One row per file a version references. Role mirrors the Profile component model.
CREATE TABLE pack_asset (
  version_id    INTEGER NOT NULL REFERENCES pack_version(id),
  role          TEXT NOT NULL CHECK (role IN ('scheme','crosshair','enemy','audio')),
  -- '-' for the three single-file roles. NOT NULL on purpose: SQLite permits NULLs in a
  -- non-INTEGER primary key, so a nullable column here would let one version carry two
  -- schemes, which the Profile model forbids.
  audio_event   TEXT NOT NULL DEFAULT '-'
                CHECK (audio_event IN ('-','kill','spawn','mbsGood','mbsOkay','mbsBad','mbsChangeNow')),
  position      INTEGER NOT NULL DEFAULT 0,    -- order within an audio event
  asset_sha     TEXT NOT NULL REFERENCES asset(sha256),
  file_name     TEXT NOT NULL,                 -- the name written to disk on import
  PRIMARY KEY (version_id, role, audio_event, position),
  CHECK ((role = 'audio') = (audio_event <> '-')),
  CHECK (role = 'audio' OR position = 0)       -- one scheme, one crosshair, one enemy
);

CREATE TABLE tag (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  label_zh      TEXT NOT NULL,
  label_en      TEXT NOT NULL
);
CREATE TABLE pack_tag (
  pack_id       INTEGER NOT NULL REFERENCES pack(id),
  tag_id        INTEGER NOT NULL REFERENCES tag(id),
  PRIMARY KEY (pack_id, tag_id)
);

CREATE TABLE media (
  id            INTEGER PRIMARY KEY,
  pack_id       INTEGER NOT NULL REFERENCES pack(id),
  r2_key        TEXT NOT NULL,
  alt_zh        TEXT NOT NULL,                 -- required: the site is accessibility-checked
  alt_en        TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0
);

-- Aggregated per day, not per request: no per-visitor rows, no identifiers.
CREATE TABLE download_daily (
  pack_id       INTEGER NOT NULL REFERENCES pack(id),
  day           TEXT NOT NULL,                 -- 'YYYY-MM-DD'
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pack_id, day)
);

CREATE TABLE submission (
  id            INTEGER PRIMARY KEY,
  pack_id       INTEGER REFERENCES pack(id),   -- null for a first submission
  payload_json  TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN ('queued','validating','needs_changes','approved','rejected')),
  reviewer_note TEXT,
  created_at    INTEGER NOT NULL,
  decided_at    INTEGER
);

CREATE TABLE report (
  id            INTEGER PRIMARY KEY,
  pack_id       INTEGER NOT NULL REFERENCES pack(id),
  reason        TEXT NOT NULL,
  detail        TEXT,
  state         TEXT NOT NULL CHECK (state IN ('open','actioned','dismissed')),
  created_at    INTEGER NOT NULL
);

CREATE INDEX pack_browse ON pack (status, published_at DESC);
CREATE INDEX pack_by_author ON pack (author_id, status);
CREATE INDEX asset_by_kind ON asset (kind);
CREATE INDEX version_by_pack ON pack_version (pack_id, version DESC);
CREATE INDEX downloads_by_day ON download_daily (day, count DESC);
```

A single-component listing needs no special case: it is a `pack` whose version references
one asset.

Full-text search uses a separate FTS5 table over the four title/summary columns, rebuilt on
publish. Trend ranking reads `download_daily`; it is a query, not a stored column.

### Schema verification

The schema above was executed against real SQLite on 2026-09-17, not just written:

- It creates cleanly, with no syntax or constraint errors.
- A second `scheme` row on one version is rejected by the primary key. The first draft got
  this wrong: `audio_event` was nullable, and SQLite permits NULLs in a non-INTEGER primary
  key, so two schemes were accepted. The sentinel `'-'` is what closes it.
- An ordered two-file `kill` list inserts and reads back in order.
- A 1024×1024 crosshair is rejected by the size CHECK.

Not verified: behaviour on Cloudflare D1 specifically, and query performance at any scale.

## Boundaries this design must not cross

These follow existing repository rules and the PRV precedent, under which generated outputs
become ordinary validated files inside the local workflow rather than a parallel system.

- **A download produces ordinary local files.** They enter the existing asset/Profile
  workflow. The catalogue introduces no second representation of a configuration.
- **The desktop application never requires the network.** Downloading is an action the
  player starts. It is never a startup dependency, and every existing section keeps working
  with no connectivity.
- **Installation still goes through the engine.** `kvk-engine.ps1` remains the only writer:
  first-protection backup, the game-closed check, a recoverable transaction and honest
  outcome reporting. The catalogue adds no write path and no bypass.
- **No accounts, no analytics in the app.** Download counts are aggregated server-side per
  day. The desktop sends nothing.
- **Publication claims stay honest.** The catalogue does not imply a configuration was
  tested in-game unless that was actually observed, exactly as the download page states real
  release status today.

## Validators become a security boundary

Today's parsers exist so the tool reads files *correctly*. The moment files arrive from
strangers and are written into someone else's game directory, those same parsers are what
stands between a stranger and that directory. That change of purpose has to be deliberate.

| Component | Validator today | Status as a boundary |
|---|---|---|
| Scheme | `parseScheme` (`packages/core/src/scheme/document.ts`) | Structural; needs review against hostile input |
| Crosshair | `canonicalPngIssue`, ≤512px, ≤2 MiB (`packages/crosshair/src/png.ts`) | Strongest of the four — re-encodes to canonical RGBA |
| Enemy | 20-field allowlist (`ENEMY_THEME_FIELDS` in `packages/app/src/enemy/theme.ts`) | An allowlist, which is the right shape |
| Profile manifest | `parseTrainingProfile`, ≤256 KiB, unknown fields rejected | Strict; the new manifest type needs an equally strict parser |
| **Audio** | **Extension only — `.wav`/`.ogg`, no content validation** | **Gap.** Nothing inspects the bytes |

**Decided 2026-09-17: the catalogue accepts no community audio.** Sound is the one asset
kind with no content validation, so it stays out rather than shipping behind a validator
that does not exist. Curated audio published by the project itself is still allowed,
because its provenance is known. Accepting community audio later requires server-side
validation and re-encoding at submission, and that is a separate decision.

Every asset must additionally be verified by SHA-256 after download, and file names must be
checked against the existing safe-name rules before anything is written.

## Licensing and provenance

Decided at design time, not during implementation:

- `pack.license` is **required**. A submission without one is not accepted.
- Every listing shows its author and license before download.
- Submitters assert they have the right to publish the files.
- A takedown path exists, and `report` plus the `removed` status support it.
- Themes and sounds redistributed from other packs need their own permission; the
  repository's own `KVK Settings 2025/` assets are not automatically republishable.

## Scheduling

This is a new subsystem, so it follows the repository rule of its own spec before
implementation. It is also **post-release**, alongside PF3 (whole-Profile application):

1. A2, Windows acceptance and a real release, so the product installs and works.
2. W1/W2 — the website's own first version: the four pages, bilingual, static, no database.
3. This catalogue, once there is a product to distribute configurations for.

Building a distribution system before the thing being distributed has been verified on
Windows would invert the risk. The site's first version stays static; the spec's existing
statement that the first version needs no database or login remains correct for W1/W2.

## Open questions

1. ~~Audio validation~~ — **decided**: no community audio in the catalogue (see the
   validator table).
2. **Submission identity** — publishing needs some author identity, which conflicts with
   "no accounts". Likely resolution: submissions arrive through GitHub, so GitHub carries
   the identity and the site keeps none.
3. **Import UI placement** — the desktop has no download entry today. Whether it belongs in
   the workspace or in the installer utility is a UI design question, and the redesign
   deliberately adds no entry for it.
4. **Bundle format on the wire** — a ZIP containing `aimloom-pack.json` plus the files, or
   the manifest alone with assets fetched individually.
5. **Moderation capacity** — a review queue needs a reviewer. Without one, the first version
   should carry curated-only content, with no public submissions.

## No implementation plan yet

This spec intentionally stops short of a task-by-task plan. A plan names files and test
commands, and the website has no code on any branch — there is nothing for those steps to
reference. The plan follows W1/W2, once the site exists and this design has been approved.
