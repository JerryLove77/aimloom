-- The rules the upload path used to check only in code now hold in the database too, so two
-- requests racing each other cannot both get through.
-- One live or waiting file per kind and name, ignoring case: the set fileNameTaken() checks. A
-- rejected or withdrawn item frees its name. On a database with data, first check that no two such
-- items already share a name (README, "Migrations"): this CREATE fails if they do.
CREATE UNIQUE INDEX item_live_name ON item (kind, file_name COLLATE NOCASE) WHERE status IN ('published','pending','hidden');
-- Lookups by day (the oldest counted day, and the rollup deleting the days it has moved) search
-- this index instead of scanning the table.
CREATE INDEX download_daily_day ON download_daily (day);
