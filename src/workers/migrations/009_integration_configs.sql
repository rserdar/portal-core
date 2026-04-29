-- Migration 009: Google/Microsoft provider non-secret config registry
-- Faz E/F ortak omurgası: tenant bazlı non-secret entegrasyon anahtarları

CREATE TABLE IF NOT EXISTS integration_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  service TEXT NOT NULL,
  config_key TEXT NOT NULL,
  config_value TEXT,
  tenant_scope TEXT NOT NULL DEFAULT 'global',
  updated_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(provider, service, config_key, tenant_scope)
);
