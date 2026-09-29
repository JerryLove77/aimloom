-- Every review decision and every withdrawal: who, when, and what it changed. It is written in the
-- same batch as the change and guarded by the same condition, so a row exists exactly when the
-- change happened. The daily cron deletes rows older than 365 days. The SteamIDs here are never
-- shown publicly; only admins read this table.
CREATE TABLE moderation_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL,        -- the admin's SteamID, or the owner's for 'withdraw'
  action      TEXT NOT NULL CHECK (action IN ('approve','reject','hide','withdraw','trust','untrust')),
  slug        TEXT REFERENCES item(slug),
  creator     TEXT,                 -- the SteamID trusted or untrusted
  from_status TEXT,
  to_status   TEXT,
  reason      TEXT,
  -- An item action names an item; a trust action names a creator; never both.
  CHECK ((slug IS NULL) <> (creator IS NULL)),
  CHECK ((action IN ('trust','untrust')) = (creator IS NOT NULL))
);
CREATE INDEX moderation_log_at ON moderation_log (at);
CREATE INDEX moderation_log_slug ON moderation_log (slug, at);
