-- Medicert Portal — D1 Migration 003: Relational Schema Reset (v6.1.0)
-- 001 + 002 geçici şemalarını tamamen değiştirir.
-- Tüm tablolar drop edilip onaylı relational yapıyla yeniden oluşturulur.
--
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- UYARI: BU DOSYA ASLA "wrangler d1 execute --file" İLE ÇALIŞTIRILMAZ.
-- TÜM TABLOLARI DROP EDER — ÇALIŞTIRILIRSA TÜM VERİ SİLİNİR.
-- Migration uygulamak için SADECE: wrangler d1 migrations apply
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

-- ─────────────────────────────────────────
-- DROP (temizlik)
-- ─────────────────────────────────────────
DROP VIEW  IF EXISTS audits_full;
DROP VIEW  IF EXISTS certificates_full;
DROP TABLE IF EXISTS sysdocs;
DROP TABLE IF EXISTS testdocs;
DROP TABLE IF EXISTS consultants;
DROP TABLE IF EXISTS auditors;
DROP TABLE IF EXISTS standards;
DROP TABLE IF EXISTS proformas;
DROP TABLE IF EXISTS tests;
DROP TABLE IF EXISTS audits;
DROP TABLE IF EXISTS certificates;
DROP TABLE IF EXISTS companies;
DROP TABLE IF EXISTS master_data;

-- ─────────────────────────────────────────
-- 1. COMPANIES
-- ─────────────────────────────────────────
CREATE TABLE companies (
  id               INTEGER PRIMARY KEY,
  nickname         TEXT NOT NULL,
  unvan            TEXT,
  adres            TEXT,
  city             TEXT,
  ulke             TEXT,
  yazisma          TEXT,
  vergi_dairesi    TEXT,
  vergi_no         TEXT,
  tel              TEXT,
  faks             TEXT,
  www              TEXT,
  mail             TEXT,
  yetkili_adi      TEXT,
  yetkili_unvani   TEXT,
  kyt              TEXT,
  irtibat_kisi     TEXT,
  irtibat_unvani   TEXT,
  irtibat_tel      TEXT,
  irtibat_mail     TEXT,
  yapilan_is       TEXT,
  tcs              TEXT,
  ycs              TEXT,
  ucs              TEXT,
  yzcs             TEXT,
  tascs            TEXT,
  acs              TEXT,
  alan             TEXT,
  departman        TEXT,
  vardiya          TEXT,
  logo             TEXT,
  kase             TEXT,
  dokuman          TEXT,
  teknik           TEXT,
  tkapsam          TEXT,
  sinif            TEXT,
  firma_not        TEXT,
  updated_at       INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_companies_nickname ON companies(nickname);
CREATE INDEX idx_companies_city     ON companies(city);

-- ─────────────────────────────────────────
-- 2. CERTIFICATES
-- ─────────────────────────────────────────
CREATE TABLE certificates (
  id                  INTEGER PRIMARY KEY,
  firma_no            INTEGER NOT NULL REFERENCES companies(id),
  standart            TEXT,
  denetim_tipi        TEXT,
  sertifika_no        TEXT,
  sertifika_tarihi    TEXT,
  gozetim_tarihi      TEXT,
  tescil_tarihi       TEXT,
  gecerlilik_tarihi   TEXT,
  kapsam              TEXT,
  scope               TEXT,
  akreditasyon        TEXT,
  akredite            INTEGER,
  ea                  TEXT,
  nace                TEXT,
  consultant          TEXT,
  other_standart      TEXT,
  durum               TEXT,
  sertifika_not       TEXT,
  gozetim_confirmed   INTEGER,
  calendar_id         TEXT,
  qr                  TEXT,
  cert_link           TEXT,
  logo                TEXT,
  updated_at          INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_cert_firma    ON certificates(firma_no);
CREATE INDEX idx_cert_standart ON certificates(standart);
CREATE INDEX idx_cert_bitis    ON certificates(gecerlilik_tarihi);
CREATE INDEX idx_cert_durum    ON certificates(durum);

-- ─────────────────────────────────────────
-- 3. AUDITS
-- ─────────────────────────────────────────
CREATE TABLE audits (
  id              INTEGER PRIMARY KEY,
  firma_no        INTEGER NOT NULL REFERENCES companies(id),
  sertifika_id    INTEGER REFERENCES certificates(id),
  standart        TEXT,
  denetim_tipi    TEXT,
  a1_baslangic    TEXT,
  a1_bitis        TEXT,
  a1_manday       REAL,
  a1_bas_denetci  TEXT,
  a1_denetci_2    TEXT,
  a1_denetci_3    TEXT,
  a2_baslangic    TEXT,
  a2_bitis        TEXT,
  a2_manday       REAL,
  a2_bas_denetci  TEXT,
  a2_denetci_2    TEXT,
  a2_denetci_3    TEXT,
  updated_at      INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_audits_firma ON audits(firma_no);
CREATE INDEX idx_audits_cert  ON audits(sertifika_id);

-- ─────────────────────────────────────────
-- 4. TESTS
-- ─────────────────────────────────────────
CREATE TABLE tests (
  id             INTEGER PRIMARY KEY,
  firma_no       INTEGER REFERENCES companies(id),
  test_adi       TEXT,
  marka          TEXT,
  urun           TEXT,
  urun_kodu      TEXT,
  urun_no        TEXT,
  lot            TEXT,
  urun_kabul     TEXT,
  kabul_saat     TEXT,
  test_baslangic TEXT,
  test_bitis     TEXT,
  rapor_tarihi   TEXT,
  rapor_no       TEXT,
  numune_sayisi  INTEGER,
  numune_ut      TEXT,
  numune_skt     TEXT,
  urun_bilgi     TEXT,
  gorsel1        TEXT,
  gorsel2        TEXT,
  detay          TEXT,
  updated_at     INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_tests_firma ON tests(firma_no);

-- ─────────────────────────────────────────
-- 5. PROFORMAS
-- ─────────────────────────────────────────
CREATE TABLE proformas (
  id         INTEGER PRIMARY KEY,
  firma_no   INTEGER NOT NULL REFERENCES companies(id),
  kdvsiz     REAL,
  kdv_oran   INTEGER,
  kdv        REAL,
  toplam     REAL,
  birim      TEXT,
  tarih      TEXT,
  konu       TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_proformas_firma ON proformas(firma_no);

-- ─────────────────────────────────────────
-- 6. STANDARDS
-- ─────────────────────────────────────────
CREATE TABLE standards (
  kod        TEXT PRIMARY KEY,
  kisaltma   TEXT,
  tam_ad     TEXT,
  tanim_tr   TEXT,
  tanim_en   TEXT,
  tema_id_en TEXT,
  tema_id_tr TEXT
);

-- ─────────────────────────────────────────
-- 7. AUDITORS
-- Yeni standart eklenince: ALTER TABLE auditors ADD COLUMN std_xxxxx INTEGER DEFAULT 0;
-- ─────────────────────────────────────────
CREATE TABLE auditors (
  id         INTEGER PRIMARY KEY,
  ad         TEXT NOT NULL,
  soyad      TEXT,
  imza       TEXT,
  std_9001   INTEGER DEFAULT 0,
  std_13485  INTEGER DEFAULT 0,
  std_14001  INTEGER DEFAULT 0,
  std_22000  INTEGER DEFAULT 0,
  std_27001  INTEGER DEFAULT 0,
  std_45001  INTEGER DEFAULT 0,
  std_50001  INTEGER DEFAULT 0,
  std_gmp    INTEGER DEFAULT 0,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- ─────────────────────────────────────────
-- 8. CONSULTANTS
-- ─────────────────────────────────────────
CREATE TABLE consultants (
  id            INTEGER PRIMARY KEY,
  ad            TEXT,
  adres         TEXT,
  tel           TEXT,
  mail          TEXT,
  yetkili_adi   TEXT,
  yetkili_soyad TEXT,
  hitabet       TEXT,
  updated_at    INTEGER DEFAULT (unixepoch())
);

-- ─────────────────────────────────────────
-- 9. TESTDOCS
-- ─────────────────────────────────────────
CREATE TABLE testdocs (
  id           INTEGER PRIMARY KEY,
  kategori     TEXT,
  aciklama     TEXT,
  dokuman_adi  TEXT,
  test_adi_tr  TEXT,
  test_adi_en  TEXT,
  standart     TEXT,
  tema_tr      TEXT,
  tema_en      TEXT,
  gun_sayisi   INTEGER,
  kisaltma     TEXT,
  kisaltma2    TEXT,
  notlar       TEXT,
  updated_at   INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_testdocs_kategori ON testdocs(kategori);

-- ─────────────────────────────────────────
-- 10. SYSDOCS
-- ─────────────────────────────────────────
CREATE TABLE sysdocs (
  id            INTEGER PRIMARY KEY,
  set_adi       TEXT,
  dosya_turu    TEXT,
  klasor_adi    TEXT,
  dokuman_kodu  TEXT,
  dokuman_adi   TEXT,
  dokuman_id    TEXT,
  updated_at    INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_sysdocs_set ON sysdocs(set_adi);

-- ─────────────────────────────────────────
-- 11. SYNC META (korunuyor)
-- ─────────────────────────────────────────
-- sync_meta tablosu zaten mevcutsa dokunma; yoksa oluştur.
CREATE TABLE IF NOT EXISTS sync_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- ─────────────────────────────────────────
-- VIEWS
-- ─────────────────────────────────────────
CREATE VIEW certificates_full AS
  SELECT c.*, co.nickname, co.unvan, co.city
  FROM certificates c
  JOIN companies co ON co.id = c.firma_no;

CREATE VIEW audits_full AS
  SELECT a.*, co.nickname, co.unvan, ce.standart AS cert_standart
  FROM audits a
  JOIN companies co ON co.id = a.firma_no
  LEFT JOIN certificates ce ON ce.id = a.sertifika_id;
