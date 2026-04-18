-- Medicert Portal — D1 Initial Schema (v6.0.0)

-- Firmalar
CREATE TABLE IF NOT EXISTS companies (
  id         INTEGER PRIMARY KEY,
  nickname   TEXT NOT NULL,
  unvan      TEXT,
  city       TEXT,
  kapsam     TEXT,
  scope      TEXT,
  email      TEXT,
  phone      TEXT,
  consultant TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_companies_nickname ON companies(nickname);
CREATE INDEX IF NOT EXISTS idx_companies_city     ON companies(city);

-- Sertifikalar
CREATE TABLE IF NOT EXISTS certificates (
  id               INTEGER PRIMARY KEY,
  firma_no         INTEGER NOT NULL,
  nickname         TEXT,
  standart         TEXT,
  denetim_tipi     TEXT,
  durum            TEXT,
  gecerlilik_bitis TEXT,
  gozetim_tarihi   TEXT,
  kapsam           TEXT,
  scope            TEXT,
  consultant       TEXT,
  updated_at       INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_cert_firma    ON certificates(firma_no);
CREATE INDEX IF NOT EXISTS idx_cert_standart ON certificates(standart);
CREATE INDEX IF NOT EXISTS idx_cert_bitis    ON certificates(gecerlilik_bitis);

-- Denetimler
CREATE TABLE IF NOT EXISTS audits (
  id           INTEGER PRIMARY KEY,
  firma_no     INTEGER NOT NULL,
  nickname     TEXT,
  standart     TEXT,
  a1_auditor   TEXT,
  a2_auditor   TEXT,
  a1_baslangic TEXT,
  a1_bitis     TEXT,
  a2_baslangic TEXT,
  a2_bitis     TEXT,
  updated_at   INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_audits_firma ON audits(firma_no);

-- Testler
CREATE TABLE IF NOT EXISTS tests (
  id           INTEGER PRIMARY KEY,
  firma_no     INTEGER,
  nickname     TEXT,
  test_adi     TEXT,
  marka        TEXT,
  urun         TEXT,
  rapor_no     TEXT,
  rapor_tarihi TEXT,
  updated_at   INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_tests_firma ON tests(firma_no);

-- Proformalar
CREATE TABLE IF NOT EXISTS proformas (
  id         INTEGER PRIMARY KEY,
  firma_no   INTEGER NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_proformas_firma ON proformas(firma_no);

-- Master Data (standards, auditors, consultants, testdocs, sysdocs)
CREATE TABLE IF NOT EXISTS master_data (
  type       TEXT NOT NULL,
  key_id     TEXT NOT NULL,
  data_json  TEXT NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (type, key_id)
);
CREATE INDEX IF NOT EXISTS idx_master_type ON master_data(type);

-- Sync meta (son Sheets → D1 sync zamanı ve durum bilgisi)
CREATE TABLE IF NOT EXISTS sync_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);
