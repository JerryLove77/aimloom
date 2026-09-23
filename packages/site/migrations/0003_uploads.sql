-- Sign-in and uploads (spec 2026-09-22 §11). SQLite cannot change a CHECK, so `item` is rebuilt
-- with the wider status set and the upload columns; rows are copied as they are. download_daily
-- references item, so it is rebuilt against the new table before the old one goes.
CREATE TABLE item_new (
  slug          TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('theme','sound','crosshair')),
  status        TEXT NOT NULL CHECK (status IN ('published','hidden','pending','rejected','withdrawn')),
  title_zh      TEXT NOT NULL,
  title_en      TEXT NOT NULL,
  summary_zh    TEXT NOT NULL,
  summary_en    TEXT NOT NULL,
  author        TEXT NOT NULL,
  author_url    TEXT,
  licence       TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  file_key      TEXT NOT NULL UNIQUE,
  bytes         INTEGER NOT NULL CHECK (bytes > 0),
  sha256        TEXT NOT NULL CHECK (length(sha256) = 64),
  code          TEXT CHECK (code IS NULL OR kind = 'crosshair'),
  featured      INTEGER,
  published_at  TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'maintainer' CHECK (source IN ('maintainer','upload')),
  uploader      TEXT,                 -- SteamID64 of the uploader; NULL for the maintainer's items. Never shown.
  uploaded_at   TEXT,
  reject_reason TEXT
);
INSERT INTO item_new (slug, kind, status, title_zh, title_en, summary_zh, summary_en, author, author_url, licence, file_name, file_key, bytes, sha256, code, featured, published_at)
  SELECT slug, kind, status, title_zh, title_en, summary_zh, summary_en, author, author_url, licence, file_name, file_key, bytes, sha256, code, featured, published_at FROM item;
CREATE TABLE download_daily_new (
  slug  TEXT NOT NULL REFERENCES item_new(slug),
  day   TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (slug, day)
);
INSERT INTO download_daily_new (slug, day, count) SELECT slug, day, count FROM download_daily;
DROP TABLE download_daily;
DROP TABLE item;
ALTER TABLE item_new RENAME TO item;
ALTER TABLE download_daily_new RENAME TO download_daily;
CREATE INDEX item_browse ON item (kind, status, published_at DESC);
CREATE INDEX item_uploader ON item (uploader, uploaded_at DESC);
-- A signed-in browser. Only the token's SHA-256 is stored.
CREATE TABLE session (
  token_hash TEXT PRIMARY KEY,
  steam_id   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX session_expires ON session (expires_at);
-- One row per SteamID that has uploaded or been trusted. display_name and author_url only prefill the form.
CREATE TABLE creator (
  steam_id     TEXT PRIMARY KEY,
  trusted      INTEGER NOT NULL DEFAULT 0,
  display_name TEXT,
  author_url   TEXT,
  first_seen   TEXT NOT NULL
);
