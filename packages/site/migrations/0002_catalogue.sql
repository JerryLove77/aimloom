-- The explorer's catalogue (spec 2026-09-22 §5). Written only by `npm run site:publish`.
CREATE TABLE item (
  slug         TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('theme','sound','crosshair')),
  status       TEXT NOT NULL CHECK (status IN ('published','hidden')),
  title_zh     TEXT NOT NULL,
  title_en     TEXT NOT NULL,
  summary_zh   TEXT NOT NULL,
  summary_en   TEXT NOT NULL,
  author       TEXT NOT NULL,
  author_url   TEXT,
  licence      TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  file_key     TEXT NOT NULL UNIQUE,
  bytes        INTEGER NOT NULL CHECK (bytes > 0),
  sha256       TEXT NOT NULL CHECK (length(sha256) = 64),
  code         TEXT CHECK (code IS NULL OR kind = 'crosshair'),
  featured     INTEGER,
  published_at TEXT NOT NULL
);
CREATE INDEX item_browse ON item (kind, status, published_at DESC);
-- One row per item per UTC day. Nothing about who asked is stored (spec §5.3).
CREATE TABLE download_daily (
  slug  TEXT NOT NULL REFERENCES item(slug),
  day   TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (slug, day)
);
