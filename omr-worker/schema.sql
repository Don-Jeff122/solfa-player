CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value BLOB,
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS kv_store_expires_at ON kv_store(expires_at);
