-- Deploy the compatible Worker BEFORE this migration: D1 meta.changes includes trigger writes.
-- It reads SQL changes() instead, and falls back to SUM(bytes) until this table exists.
CREATE TABLE report_storage (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  bytes INTEGER NOT NULL CHECK (bytes >= 0)
);
INSERT INTO report_storage SELECT 1, COALESCE(SUM(bytes), 0) FROM reports;

-- Accounting lives in the same transaction as every insert, byte edit, and retention deletion.
CREATE TRIGGER reports_storage_insert AFTER INSERT ON reports BEGIN
  UPDATE report_storage SET bytes = bytes + NEW.bytes WHERE id = 1;
END;
CREATE TRIGGER reports_storage_update AFTER UPDATE OF bytes ON reports BEGIN
  UPDATE report_storage SET bytes = bytes + NEW.bytes - OLD.bytes WHERE id = 1;
END;
CREATE TRIGGER reports_storage_delete AFTER DELETE ON reports BEGIN
  UPDATE report_storage SET bytes = bytes - OLD.bytes WHERE id = 1;
END;
