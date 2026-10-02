CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  received_at TEXT NOT NULL,
  consent_version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_events_received_at
  ON activity_events(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_events_installation_time
  ON activity_events(installation_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_events_domain_time
  ON activity_events(domain, received_at DESC);
