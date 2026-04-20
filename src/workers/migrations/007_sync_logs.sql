-- D1 Migration 004: Sync Logs (Self-Healing Backup Tracking)
-- Arkaplanda (ctx.waitUntil) GAS'a yapılan yedekleme işlemlerinin sonuçlarını izlemek için kullanılır.

CREATE TABLE IF NOT EXISTS sync_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  action        TEXT NOT NULL,    -- addCompany, updateAudit vb.
  entity_type   TEXT,             -- companies, audits vb.
  entity_id     INTEGER,          -- D1 tarafındaki ID
  status        TEXT DEFAULT 'PENDING', -- PENDING, SUCCESS, ERROR
  error_message TEXT,
  retry_count   INTEGER DEFAULT 0,
  created_at    INTEGER DEFAULT (unixepoch()),
  updated_at    INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_sync_log_status ON sync_log(status);
CREATE INDEX idx_sync_log_entity ON sync_log(entity_type, entity_id);
