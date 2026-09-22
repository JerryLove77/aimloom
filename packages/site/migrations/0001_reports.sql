CREATE TABLE reports (
  number TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  day TEXT NOT NULL,
  app_label TEXT NOT NULL,
  lang TEXT NOT NULL,
  windows TEXT NOT NULL,
  has_log INTEGER NOT NULL,
  has_contact INTEGER NOT NULL,
  steam_id TEXT,
  bytes INTEGER NOT NULL,
  mail TEXT NOT NULL DEFAULT 'pending',
  body TEXT NOT NULL
);
CREATE INDEX reports_day ON reports (day);
CREATE INDEX reports_created ON reports (created_at);
CREATE INDEX reports_steam ON reports (steam_id);
