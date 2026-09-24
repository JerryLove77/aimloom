-- Tickets sent from the website's feedback panel (/api/tickets). Kept apart from `reports`, which
-- are the App's: a ticket carries no App, system or log facts. The number has the reports' format.
-- Like a report, a ticket is deleted after 180 days (the daily cron and each arrival).
CREATE TABLE tickets (
  number TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  lang TEXT NOT NULL,
  has_contact INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  mail TEXT NOT NULL DEFAULT 'pending',
  body TEXT NOT NULL
);
CREATE INDEX tickets_day ON tickets (day);
CREATE INDEX tickets_created ON tickets (created_at);
