-- Download requests per file per month. The daily cron moves each day older than 90 days out of
-- download_daily into this table in one batch, so every request is counted in exactly one of the two.
CREATE TABLE download_monthly (
  slug  TEXT NOT NULL REFERENCES item(slug),
  month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (slug, month)
);
