# 🤖 Project Intelligence & Context (AI_CONTEXT.md v6.1.0)

> [!IMPORTANT]
> **Mevcut Mimari — Sheets-Primary + D1-Cache (v6.1.0):**
> - **Source of Truth:** **Google Sheets** — tüm kalıcı verinin nihai kaynağı.
> - **Hızlı Cache / Index:** **Cloudflare D1** (SQLite) — SQL sorguları, JOIN, filtre ve agregasyon; tüm read'ler buradan gelir.
> - **KV:** Cloudflare KV yalnızca kısa ömürlü token ve lock key'leri için kullanılır (auth, mutex). Operasyonel veri KV'ye **asla** yazılmaz.
> - **Google Native Exception (değişmez):** Docs, Drive, Calendar, Gmail operasyonları GAS üzerinden çalışır; D1'e taşınamaz.
> - **Bu dosya referanstır:** Her AI oturumu veya geliştirici bu dosyayı okuyarak mimari kararlara uygun kod yazmalıdır.

> [!CAUTION]
> **v5.x KV kalıpları geçersizdir.** `cache:company:{id}`, `cache:getCertificateById:*`, `cacheableActions`, `KV_PRIMARY_MISS` gibi v5.x kavramları yeni geliştirmede kullanılmamalıdır.

> [!NOTE]
> **Saf Tailwind Mimarisi (v5.1.0 — değişmez):** Proje genelinde tüm "glass" efektler ve özel CSS sınıfları (`glass`, `form-input`) kaldırılmıştır. Tüm UI **Pure Tailwind** utility sınıfları ve opak arka planlar (`bg-surface`) ile yönetilmektedir.

---

## 🏗️ Yeni Mimari Genel Bakış

```
┌─────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│   Browser   │────▶│  Cloudflare Worker   │────▶│  Cloudflare D1   │
│  (IndexedDB │     │  (proxy.js)          │     │  (SQLite Cache)  │
│   + UI)     │     │                      │◀────│                  │
└─────────────┘     │  WRITE PATH:         │     └──────────────────┘
                    │  Worker → GAS        │            ▲ sync
                    │  (Sheets write)      │            │
                    │  → D1 güncelle       │     ┌──────────────────┐
                    │                      │────▶│  Google Apps     │
                    │  READ PATH:          │     │  Script (GAS)    │
                    │  Worker → D1 (SQL)   │     │                  │
                    │  miss → GAS → D1     │     │  → Google Sheets │
                    └──────────────────────┘     │    (Source of    │
                                                 │     Truth)       │
                                                 └──────────────────┘
```

### Katmanların Rolleri

| Katman | Rol | Notlar |
| :--- | :--- | :--- |
| **Google Sheets** | **Source of Truth** — tüm kalıcı veri burada yaşar | Felaket kurtarma, denetim izi, backup |
| **Cloudflare D1** | **Hızlı Cache / Index** — SQL ile okuma, filtreleme, arama | TTL veya sync ile Sheets'ten beslenir |
| **Cloudflare Worker** | **Secure API Proxy** — tüm veriyi orkestre eder | `proxy.js`, CORS, secret inject |
| **Cloudflare KV** | **Yalnızca token / lock** — auth token, mutex | Operasyonel veri kesinlikle yazılmaz |
| **Google Apps Script** | **Google-native Engine** — Sheets CRUD + Drive/Calendar/Docs | Source of truth'a erişen tek katman |
| **IndexedDB** | **Browser Cache** — anlık UI render | `idb-keyval`, nanostores |

---

## 📐 Yazma (WRITE) Kuralları

### Kural W1 — Her Yazma Önce Sheets'e Gider

```
Browser → Worker → GAS (Sheets.add/update) → başarılı?
                                            ↓ evet
                   D1'i güncelle (sync) → tarayıcıya dön
                                            ↓ hayır
                   Hata dön (D1'e dokunma — Sheets kazanır)
```

- GAS başarılı → D1 güncellenir. GAS başarısız → D1'e dokunulmaz.
- D1 hiçbir zaman Sheets'ten önce gelmez; D1 türev (cache) veridir.

### Kural W2 — D1 Write-Through (Senkron)

Worker, GAS çağrısı tamamlandıktan hemen sonra D1'i senkron olarak günceller. Asenkron background write **yapılmaz** — tutarsızlık riski yaratır.

```js
// DOĞRU PATTERN
const gasResult = await callGAS('addCompany', payload);
if (gasResult.ok) {
  await env.DB_D1.prepare('INSERT OR REPLACE INTO companies (id, nickname, ...) VALUES (?,?,...)')
    .bind(...).run();
}
return gasResult;
```

### Kural W3 — Google Native Side-Effects (değişmez)

`scheduleAudit`, `updateSurveillance` gibi Calendar bağımlı işlemler için:
1. Veri Sheets'e yazılır (GAS).
2. Google Calendar event GAS tarafından oluşturulur.
3. D1 güncellenir.

GAS bu akışta hem data store hem side-effect engine'dir.

---

## 📖 Okuma (READ) Kuralları

### Kural R1 — Read-Through Cache

```
Browser → Worker → D1 hit? → Dön (<10ms)
                  ↓ miss
                  GAS → Sheets oku → D1'e yaz (cache) → Dön
```

D1'de veri yoksa veya TTL dolmuşsa GAS'a düşülür, yanıt D1'e yazılır.

### Kural R2 — SQL ile Sorgulama

D1 SQL desteklediinden KV'deki JSON blob'ların yerini gerçek sorgular alır:

```sql
-- v5.x KV yaklaşımı (YANLIŞ — artık kullanılmaz)
-- env.KV.get('cache:getCertificatesByFirmaId:{"firmaId":"123"}')

-- v6.x D1 yaklaşımı (DOĞRU)
SELECT * FROM certificates WHERE firma_no = 123;
SELECT COUNT(*) FROM certificates WHERE standart = 'ISO 9001';
```

### Kural R3 — Google Native Operasyonlar: Her Zaman GAS

Drive, Calendar, Docs, Gmail çağrıları D1'e cache **edilmez** (kısa-TTL veridir veya side-effect'tir). Worker doğrudan GAS'a yönlendirir.

---

## 🗄️ D1 Şema — Kesinleşmiş Relational Tablo Yapısı (v6.1.0)

> [!IMPORTANT]
> Bu şema onaylanmış son halidir. `master_data` (JSON blob) tablosu kaldırıldı; yerine ayrı normalize tablolar geldi.
> `nickname` sütunu child tablolarda (certificates, audits, tests) yok; JOIN ile companies'dan alınır.
> `data_json` geçici yaklaşımı tamamen kaldırıldı.

### Tablo İlişkileri

```
companies (1) ──< certificates (N)
companies (1) ──< audits (N)
companies (1) ──< tests (N)
companies (1) ──< proformas (N)
audits.sertifika_id ──> certificates (FK, nullable)
```

### SQL Şema

```sql
-- ─────────────────────────────────────────
-- 1. COMPANIES (Firmalar)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id               INTEGER PRIMARY KEY,
  nickname         TEXT NOT NULL,
  unvan            TEXT,
  adres            TEXT,
  city             TEXT,
  ulke             TEXT,
  yazisma          TEXT,           -- yazışma adresi
  vergi_dairesi    TEXT,
  vergi_no         TEXT,           -- TEXT: boşluk/özel karakter olabilir
  tel              TEXT,           -- TEXT: +90 ile başlar
  faks             TEXT,
  www              TEXT,
  mail             TEXT,
  yetkili_adi      TEXT,
  yetkili_unvani   TEXT,
  kyt              TEXT,           -- kalite yönetim temsilcisi
  irtibat_kisi     TEXT,
  irtibat_unvani   TEXT,
  irtibat_tel      TEXT,
  irtibat_mail     TEXT,
  yapilan_is       TEXT,           -- faaliyet alanı (serbest metin)
  tcs              TEXT,           -- Türkçe kapsam (sertifika)
  ycs              TEXT,           -- yönetim sistemi kapsam
  ucs              TEXT,           -- uluslararası kapsam
  yzcs             TEXT,           -- yönetim yazılım kapsam
  tascs            TEXT,           -- taşıt kapsam
  acs              TEXT,           -- aktivite kapsam
  alan             TEXT,
  departman        TEXT,
  vardiya          TEXT,
  logo             TEXT,           -- URL / Drive ID
  kase             TEXT,           -- URL / Drive ID
  dokuman          TEXT,           -- URL / Drive ID
  teknik           TEXT,
  tkapsam          TEXT,           -- teknik kapsam
  sinif            TEXT,           -- sınıflandırma
  firma_not        TEXT,
  updated_at       INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_companies_nickname ON companies(nickname);
CREATE INDEX IF NOT EXISTS idx_companies_city     ON companies(city);

-- ─────────────────────────────────────────
-- 2. CERTIFICATES (Sertifikalar)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS certificates (
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
  akredite            INTEGER,     -- 0/1 boolean
  ea                  TEXT,        -- EA kodu
  nace                TEXT,        -- NACE kodu
  consultant          TEXT,        -- danışman adı
  other_standart      TEXT,        -- ek/çapraz standart
  durum               TEXT,
  sertifika_not       TEXT,
  gozetim_confirmed   INTEGER,     -- 0/1
  calendar_id         TEXT,
  qr                  TEXT,
  cert_link           TEXT,
  logo                TEXT,
  updated_at          INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_cert_firma    ON certificates(firma_no);
CREATE INDEX IF NOT EXISTS idx_cert_standart ON certificates(standart);
CREATE INDEX IF NOT EXISTS idx_cert_bitis    ON certificates(gecerlilik_tarihi);
CREATE INDEX IF NOT EXISTS idx_cert_durum    ON certificates(durum);

-- ─────────────────────────────────────────
-- 3. AUDITS (Denetimler)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audits (
  id              INTEGER PRIMARY KEY,
  firma_no        INTEGER NOT NULL REFERENCES companies(id),
  sertifika_id    INTEGER REFERENCES certificates(id),  -- nullable FK
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
CREATE INDEX IF NOT EXISTS idx_audits_firma ON audits(firma_no);
CREATE INDEX IF NOT EXISTS idx_audits_cert  ON audits(sertifika_id);

-- ─────────────────────────────────────────
-- 4. TESTS (Testler)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tests (
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
  numune_ut      TEXT,            -- ürün tipi/numune
  numune_skt     TEXT,            -- son kullanma tarihi
  urun_bilgi     TEXT,
  gorsel1        TEXT,            -- URL / Drive ID
  gorsel2        TEXT,
  detay          TEXT,
  updated_at     INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_tests_firma ON tests(firma_no);

-- ─────────────────────────────────────────
-- 5. PROFORMAS (Proformalar)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proformas (
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
CREATE INDEX IF NOT EXISTS idx_proformas_firma ON proformas(firma_no);

-- ─────────────────────────────────────────
-- 6. STANDARDS (Standartlar)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS standards (
  kod        TEXT PRIMARY KEY,    -- örn: "ISO 9001"
  kisaltma   TEXT,
  tam_ad     TEXT,
  tanim_tr   TEXT,
  tanim_en   TEXT,
  tema_id_en TEXT,
  tema_id_tr TEXT
);

-- ─────────────────────────────────────────
-- 7. AUDITORS (Denetçiler)
-- ─────────────────────────────────────────
-- Yeni standart eklenince ALTER TABLE ADD COLUMN yapılır.
CREATE TABLE IF NOT EXISTS auditors (
  id         INTEGER PRIMARY KEY,
  ad         TEXT NOT NULL,
  soyad      TEXT,
  imza       TEXT,               -- URL / Drive ID
  std_9001   INTEGER DEFAULT 0,  -- 0/1 boolean
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
-- 8. CONSULTANTS (Danışmanlar)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consultants (
  id            INTEGER PRIMARY KEY,
  ad            TEXT,             -- firma adı
  adres         TEXT,
  tel           TEXT,
  mail          TEXT,
  yetkili_adi   TEXT,
  yetkili_soyad TEXT,
  hitabet       TEXT,             -- hitap şekli (Sayın vb.)
  updated_at    INTEGER DEFAULT (unixepoch())
);

-- ─────────────────────────────────────────
-- 9. TESTDOCS (Test Dokümanları)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS testdocs (
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
CREATE INDEX IF NOT EXISTS idx_testdocs_kategori ON testdocs(kategori);

-- ─────────────────────────────────────────
-- 10. SYSDOCS (Sistem Dokümanları)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sysdocs (
  id            INTEGER PRIMARY KEY,
  set_adi       TEXT,             -- doküman seti adı
  dosya_turu    TEXT,             -- dosya türü (PDF, DOCX vb.)
  klasor_adi    TEXT,
  dokuman_kodu  TEXT,
  dokuman_adi   TEXT,
  dokuman_id    TEXT,             -- Drive ID
  updated_at    INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_sysdocs_set ON sysdocs(set_adi);

-- ─────────────────────────────────────────
-- 11. SYNC META
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);
```

### SQL VIEW'ler (JOIN Kolaylığı)

```sql
-- Sertifikalar + firma nickname
CREATE VIEW IF NOT EXISTS certificates_full AS
  SELECT c.*, co.nickname, co.unvan, co.city
  FROM certificates c
  JOIN companies co ON co.id = c.firma_no;

-- Denetimler + firma nickname + sertifika standartı
CREATE VIEW IF NOT EXISTS audits_full AS
  SELECT a.*, co.nickname, co.unvan, ce.standart AS cert_standart
  FROM audits a
  JOIN companies co ON co.id = a.firma_no
  LEFT JOIN certificates ce ON ce.id = a.sertifika_id;
```

---

## 🗝️ KV Kullanım Sınırı (v6.0.0)

KV artık **yalnızca** şu iki amaçla kullanılır:

| KV Key | TTL | Amaç |
| :--- | :--- | :--- |
| `token:confirm:{uuid}` | 600s | 2. onay protokolü tokeni |
| `lock:write:{entity}:{id}` | 30s | Concurrent write mutex |

Başka hiçbir veri KV'ye yazılmaz. Eski `cache:*` key'leri TTL dolunca expire olur — silinmesi gerekmez.

---

## 🗺️ Migration Yol Haritası (v5.x → v6.x)

> **Durum açıklaması:**
> - ✅ **Tamamlandı** — Kod incelenerek doğrulandı
> - 🔵 **Altyapı** — Komut çıktısından/deploy log'undan doğrulandı; kod üzerinde doğrulanamaz
> - ⚠️ **Kısmi** — Yapıldı ama eksik/hatalı kısım var
> - 🔄 **Bekliyor** — Henüz yapılmadı
> - ❌ **Yanlış belgelenmiş** — Daha önce tamamlandı diye işaretlendi ama doğru değildi

---

### Faz 0 — D1 Kurulumu

| # | Madde | Durum | Neden |
| :- | :--- | :---: | :--- |
| F0-1 | `wrangler.toml`'a `[[d1_databases]]` bloğu eklendi, binding: `DB_D1` | ✅ | `wrangler.toml` içinde mevcut ve `wrangler deploy` çıktısında `env.DB_D1 (medicert-portal)` görünüyor |
| F0-2 | D1 veritabanı provision edildi — ID: `94b188bb-...`, bölge: EEUR (Milano) | 🔵 | `wrangler d1 create` komutu çalıştırıldı; `wrangler deploy` binding çıktısıyla doğrulandı |
| F0-3 | İlk geçici şema SQL dosyası oluşturuldu (`001_initial.sql`) | ✅ | Dosya `src/workers/migrations/` altında mevcut; Faz 1.5'te `003` ile değiştirildi |
| F0-4 | `wrangler.toml`'a `migrations_dir` eklendi | ✅ | `wrangler.toml` satırı: `migrations_dir = "src/workers/migrations"` |

---

### Faz 1 — bulkSync D1 Yazma Geçişi

| # | Madde | Durum | Neden |
| :- | :--- | :---: | :--- |
| F1-1 | `bulkSync` action'ının **D1 yazma** kısmı yeniden yazıldı — `env.DB_D1.batch()` | ✅ | `proxy.js` içinde `bulkSync` handler'ı D1 INSERT OR REPLACE kullanıyor |
| F1-2 | `bulkSync` dışındaki handler'larda `env.DB.get/put` kaldırıldı | ❌ | Yanlış belgelendi. Diğer handler'lar Faz 2-3'te taşındı; Faz 1'de sadece `bulkSync` değişti |
| F1-3 | Mass deletion protection `SELECT COUNT(*)` ile yeniden yazıldı | ✅ | `bulkSync` içinde her tablo için `SELECT COUNT(*) as cnt FROM <table>` kontrolü mevcut |
| F1-4 | `rebuildDashboardStats` D1 JOIN sorgusuyla yeniden yazıldı | ✅ | `certificates c LEFT JOIN companies co ON co.id = c.firma_no` sorgusu mevcut |
| F1-5 | Settings.astro'da sync etiketleri güncellendi | ⚠️ | Bazı "D1" etiketleri eklendi ama sayfada hâlâ KV'ye atıflar ve eski açıklamalar var |
| F1-6 | Worker deploy edildi — `env.DB_D1 (medicert-portal)` binding aktif | 🔵 | Her deploy'da `wrangler deploy` çıktısında binding listesinde görünüyor |

---

### Faz 1.5 — D1 Relational Şema Reset

| # | Madde | Durum | Neden |
| :- | :--- | :---: | :--- |
| F1.5-1 | Eski D1 tabloları drop edildi (`companies`, `certificates`, `master_data` vb.) | 🔵 | `wrangler d1 execute --remote --file=003_relational_schema.sql` ile uygulandı; DROP IF EXISTS içeriyor |
| F1.5-2 | `003_relational_schema.sql` yazıldı — 11 tablo + 2 VIEW | ✅ | `src/workers/migrations/003_relational_schema.sql` mevcut ve incelendi |
| F1.5-3 | `bulkSync` mapper'ları tam relational sütunlarla yeniden yazıldı (`data_json` kaldırıldı) | ✅ | Her tablo için `INSERT OR REPLACE INTO <table> (sütunlar...) VALUES (...)` biçiminde |
| F1.5-4 | `master_data` blob tablosu kaldırıldı; 5 ayrı normalize tablo kullanılıyor | ✅ | `standards`, `auditors`, `consultants`, `testdocs`, `sysdocs` — her biri ayrı INSERT bloğu |
| F1.5-5 | `GAS_API_URL` Worker secret olarak set edildi | 🔵 | `wrangler secret put GAS_API_URL` çalıştırıldı; `bulkSync` başarısı bunu doğruluyor |
| F1.5-6 | `bulkSync` başarıyla çalıştı — tüm Sheets verisi D1'e aktarıldı | 🔵 | Browser'dan onay alındı; D1 tablo sayımları (companies, certs vb.) dolu |

---

### Faz 2 — Read Path Geçişi (KV → D1)

| # | Madde | Durum | Neden |
| :- | :--- | :---: | :--- |
| F2-1 | `getCompanies` | ✅ | D1 JOIN sorgusu — kapsam için son sertifika LEFT JOIN |
| F2-2 | `getCompanyById` | ✅ | `SELECT * FROM companies WHERE id=?` |
| F2-3 | `getCertificates` | ✅ | `SELECT * FROM certificates ORDER BY id DESC` |
| F2-4 | `getCertificateById` | ✅ | `SELECT * FROM certificates WHERE id=?` |
| F2-5 | `getCertificatesByFirmaId` | ✅ | `SELECT * FROM certificates WHERE firma_no=?` |
| F2-6 | `getCertificateSummaries` | ✅ | certificates + companies JOIN, özet sütunlar |
| F2-7 | `getRecentCertificates` | ✅ | `ORDER BY id DESC LIMIT ?` |
| F2-8 | `getDashboardSummary` | ✅ | `SELECT value FROM sync_meta WHERE key='dashboard_stats'` |
| F2-9 | `getAudits` | ✅ | audits + companies JOIN, `a1_baslangic DESC` sıralamalı |
| F2-10 | `getAuditsByFirmaId` | ✅ | `SELECT * FROM audits WHERE firma_no=?` |
| F2-11 | `getAuditById` | ✅ | `SELECT * FROM audits WHERE id=?` |
| F2-12 | `getTests` | ✅ | `SELECT * FROM tests ORDER BY id DESC` |
| F2-13 | `getTestsByFirmaId` | ✅ | `SELECT * FROM tests WHERE firma_no=?` |
| F2-14 | `getProformasByFirmaId` | ✅ | `SELECT * FROM proformas WHERE firma_no=?` |
| F2-15 | `getProformaById` | ✅ | `SELECT * FROM proformas WHERE id=?` |
| F2-16 | `getConsultants` | ✅ | `SELECT * FROM consultants ORDER BY ad` |
| F2-17 | `getConsultantById` | ✅ | `SELECT * FROM consultants WHERE id=?` |
| F2-18 | `getAuditorById` | ✅ | `SELECT * FROM auditors WHERE id=?` |
| F2-19 | `getStandardById` | ✅ | `SELECT * FROM standards WHERE kod=?` |
| F2-20 | `getMasterData` | ✅ | Type verilirse o tablonun tümü; verilmezse 5 tablo paralel sorgu |
| F2-21 | `getAvailableSets` | ✅ | `SELECT DISTINCT set_adi FROM sysdocs` |
| F2-22 | `getSysDocsBySetName` | ✅ | `SELECT * FROM sysdocs WHERE set_adi=?` |
| F2-23 | `getTestDocByName` | ✅ | `SELECT * FROM testdocs WHERE LOWER(test_adi_tr)=LOWER(?) OR LOWER(dokuman_adi)=LOWER(?)` |
| F2-24 | `buildCertPayload` | ✅ | D1: `certificates` + `companies` + `standards`; fn adı `buildCertificatePayloadFromD1` |
| F2-25 | `buildTestPayload` | ✅ | D1: `tests` + `companies` + `testdocs`; fn adı `buildTestPayloadFromD1` |
| F2-26 | `buildProformaPayload` | ✅ | D1: `proformas` + `companies`; fn adı `buildProformaPayloadFromD1` |

---

### Faz 3 — Write Path Geçişi (KV → GAS + D1)

> Write pattern: `fetchFromGas(action)` → başarılıysa `upsertXxxD1(canonical)` → `return gasResult`

| # | Madde | Durum | Neden |
| :- | :--- | :---: | :--- |
| F3-1 | `addCompany` | ✅ | GAS `addCompany` → `upsertCompanyD1`; KV PUT kaldırıldı |
| F3-2 | `updateCompany` | ✅ | GAS `updateCompany` → `upsertCompanyD1`; KV PUT kaldırıldı |
| F3-3 | `addCertificate` | ✅ | GAS `addCertificate` → `upsertCertificateD1` + `rebuildDashboardStats` |
| F3-4 | `updateCertificate` | ✅ | GAS `updateCertificate` → `upsertCertificateD1` |
| F3-5 | `deleteCertificate` | ✅ | GAS `deleteCertificate` → `DELETE FROM certificates WHERE id=?` |
| F3-6 | `updateSurveillance` | ✅ | GAS `updateSurveillance` → `UPDATE certificates SET gozetim_confirmed=?` |
| F3-7 | `scheduleAudit` | ✅ | GAS `scheduleAudit` → `upsertAuditD1` |
| F3-8 | `updateAudit` | ✅ | GAS `updateAudit` → `upsertAuditD1` |
| F3-9 | `addTest` | ✅ | GAS `addTest` → `upsertTestD1` |
| F3-10 | `updateTest` | ✅ | GAS `updateTest` → `upsertTestD1` |
| F3-11 | `addProforma` | ✅ | GAS `addProforma` → `upsertProformaD1` |
| F3-12 | `updateProforma` | ✅ | GAS `updateProforma` → `upsertProformaD1` |
| F3-13 | `updateMasterData` | 🔄 | Hâlâ KV yazıyor; GAS tarafında master data write action'ı gerekiyor |

---

### Faz 4 — Admin Araçları + KV Temizliği

| # | Madde | Durum | Neden |
| :- | :--- | :---: | :--- |
| F4-1 | `exportKvData` D1'den `SELECT *` ile yeniden yazıldı | ✅ | 5 tablo paralel sorgu; `version: "2.0"` |
| F4-2 | `importKvData` deprecated edildi | ✅ | HTTP 410 döner; not: "kullan `bulkSync`" |
| F4-3 | `syncCheck` D1 `sync_meta` okuyacak şekilde güncellendi | ✅ | `SELECT value FROM sync_meta WHERE key='last_sync'` |
| F4-4 | `kvDiagnostic` D1 tablo sayımları + `last_sync` ile yeniden yazıldı | ✅ | 5 tablo COUNT sorgusu + sync_meta |
| F4-5 | `deepRepairIndex` `rebuildDashboardStats()` tetikleyecek şekilde güncellendi | ✅ | KV index rebuild mantığı kaldırıldı; D1-native |
| F4-6 | `clearCache` korundu — eski KV `cache:*` key'lerini temizler | ✅ | Geçiş döneminde eski cache key'lerini silmek için hâlâ gerekli |
| F4-7 | `wrangler.toml`'dan `[[kv_namespaces]]` bloğu kaldırıldı | 🔄 | `updateMasterData` ve `clearCache` hâlâ `env.DB` kullandığı için bekliyor |
| F4-8 | Ölü kod temizliği: KV tabanlı 20+ fonksiyon kaldırıldı (~200 satır) | ✅ | `hasUsableAuditDates`, `rebuildAuditsFromIndex`, `rebuildCertificatesFromEntityKeys`, `loadTestNextId/Proforma/Audit`, `getMasterDataset`, `buildStandardsByIdFromDataset`, `buildConsultantsFromDataset`, `extractConsultantNameFromRow`, `unmapCertificateToRow`, `mapRawProformaRow`, `buildCertificatesByFirmaId`, `mergeRecentCertificateIds`, `createCertificateSummary`, `createSearchEntry`, `parseVersionNumber`, `getTestValue`, `listKvKeys`, `purgeCachePrefix`, `indexKeys` |
| F4-9 | `indexKeys` objesi kaldırıldı; `CACHE_TTL` drive cache için korundu | ✅ | `CACHE_TTL` yalnızca DriveHandlers KV cache TTL için kullanılıyor |
| F4-10 | KV: yalnızca `token:confirm:{uuid}` ve `lock:write:*` key'leri için ayrı namespace | 🔄 | Faz 4-7/8/9 bitince değerlendirilebilir |

---

### Faz 5 — Backup & Restore

| # | Madde | Durum | Neden |
| :- | :--- | :---: | :--- |
| F5-1 | `exportBackup` — D1'den JSON paketi indir | 🔄 | `exportKvData` artık D1 tabanlı; tam backup endpoint henüz ayrı değil |
| F5-2 | `importBackup` — JSON → GAS → Sheets → `bulkSync` | 🔄 | GAS tarafında `importBackup()` action gerekiyor |
| F5-3 | 2. Onay Protokolü KV token'ı (`token:confirm:{uuid}`) — değişmez | ✅ | KV'de kalıyor; D1'e taşınması gerekmiyor |

---

### Faz 6 — IndexedDB & UI Sync

| # | Madde | Durum | Neden |
| :- | :--- | :---: | :--- |
| F6-1 | `src/lib/sync.ts` — `KV_PRIMARY_MISS` / `needsHydration` mantığı kaldırıldı | 🔄 | Şu an Worker D1'den okuyor ama sync.ts içi hâlâ eski KV akışına göre yazılmış olabilir |
| F6-2 | Yeni sync akışı: Worker D1 → IndexedDB → UI | 🔄 | Faz 6-1 tamamlandıktan sonra |
| F6-3 | Settings "Sistemi Senkronize Et" akışı güncellendi | ⚠️ | Buton çalışıyor; ama settings.astro'da hâlâ KV referanslı etiket ve açıklamalar var |

---

### Özet

| Faz | Kapsam | Toplam | ✅ | 🔄 | ⚠️/❌ |
| :- | :--- | :---: | :---: | :---: | :---: |
| Faz 0 | D1 kurulumu | 4 | 2 | — | 2 🔵 |
| Faz 1 | bulkSync + rebuildStats | 6 | 4 | — | 1 ⚠️, 1 ❌ |
| Faz 1.5 | Relational şema reset | 6 | 2 | — | 4 🔵 |
| Faz 2 | Read path (26 action) | 26 | 26 | — | — |
| Faz 3 | Write path (13 action) | 13 | 12 | 1 | — |
| Faz 4 | Admin araçlar + KV temizlik | 10 | 6 | 4 | — |
| Faz 5 | Backup & restore | 3 | 1 | 2 | — |
| Faz 6 | IndexedDB/UI sync | 3 | — | 2 | 1 ⚠️ |
| **Toplam** | | **71** | **53** | **9** | **9** |

---

## ⚡ Platform Limitleri (v6.0.0)

### Cloudflare D1

| Limit | Değer | Risk |
| :--- | :--- | :--- |
| **Free tier — Row reads/gün** | 5M | 1600 firma × 100 view = güvenli |
| **Free tier — Row writes/gün** | 100K | 100 CRUD/gün = güvenli |
| **Free tier — Storage** | 500MB | Mevcut veri ~50MB = güvenli |
| **Query latency** | <10ms (edge) | KV'den daha tutarlı |
| **Max DB size** | 2GB (paid) | Yıllar içinde izle |

### Google Apps Script

| Limit | Consumer | Google Workspace |
| :--- | :--- | :--- |
| **Execution süresi** | 6 dk | 30 dk |
| **Günlük toplam** | 90 dk | 6 saat |
| **URL Fetch** | 20K/gün | 100K/gün |
| **Sheets maks. hücre** | 10M | 10M |

> [!CAUTION]
> **Write path GAS üzerinden geçtiğinden her CRUD işlemi GAS execution süresi harcar.** Toplu işlemler (batch import, surveillance update) için GAS `executionTime` izlenmeli; gerekirse işlemler chunk'lara bölünmelidir.

### Cloudflare KV (Artık Minimal)

KV yalnızca token/lock için kalır. Free tier limitleri bu kullanım için yeterlidir (günde birkaç onlarca token).

---

## 🔄 Mevcut D1 Sync Stratejisi

### Anlık Sync (Write-Through)

Her CRUD operasyonundan sonra ilgili D1 satırı güncellenir. Bu, D1'i gerçek zamanlıya yakın tutar.

### Periyodik Full Refresh (Opsiyonel)

Tutarsızlık riski yüksek hissedilirse veya GAS dışından (manuel Sheets edit) veri girdiyse:

```
"D1'i Yenile" butonu → Worker → GAS.getFullExport() → D1 TRUNCATE + bulk INSERT
```

Bu `bulkSync`'in D1 versiyonudur. Farkı: artık D1'e yazıyor, KV'ye değil.

---

## 📂 Teknik Dizin Matrisi (v6.0.0)

### `/src/workers/proxy.js` (Cloudflare Worker)

Proje boyunca tek deploy edilen Worker. Tüm action routing, CORS, secret inject ve D1 operasyonları burada.

**Aktif binding (`wrangler.toml`):**
```toml
[[d1_databases]]
binding = "DB_D1"
database_name = "medicert-portal"
database_id = "94b188bb-1ea8-4b84-ba00-8f7bf91bb265"
migrations_dir = "src/workers/migrations"
```

**Kodda kullanım:**
```js
// Okuma
const row = await env.DB_D1.prepare('SELECT * FROM companies WHERE id = ?').bind(id).first();
// Yazma
await env.DB_D1.prepare('INSERT OR REPLACE INTO companies (id, nickname, ...) VALUES (?,?,...)').bind(...).run();
// Toplu yazma
const stmt = env.DB_D1.prepare('INSERT OR REPLACE INTO companies VALUES (?,?,?,?)');
await env.DB_D1.batch(rows.map(r => stmt.bind(r.id, r.nickname, r.unvan, r.city)));
```

### `/src/workers/migrations/`

D1 schema migration SQL dosyaları. Her şema değişikliği yeni bir migration dosyasıdır:
- `001_initial.sql` — İlk geçici tablo yapısı (superseded)
- `002_add_data_json.sql` — Geçici data_json sütunları (superseded)
- `003_relational_schema.sql` — **Aktif şema** — 11 tablo + 2 VIEW

### `/src/gas/api/` (Google Apps Script Servisleri)

**v6.0.0'da rolü değişen servisler:**

| Servis | v5.x Rolü | v6.x Rolü |
| :--- | :--- | :--- |
| `CompanyService.gs` | Backup/hydration only | **Operasyonel CRUD** (add, update, getById) |
| `CertificateService.gs` | Backup/hydration only | **Operasyonel CRUD** |
| `TestService.gs` | Backup/hydration only | **Operasyonel CRUD** |
| `ProformaService.gs` | Backup/hydration only | **Operasyonel CRUD** |
| `AuditService.gs` | KV + Calendar side-effect | **Sheets CRUD + Calendar side-effect** |
| `SyncService.gs` | KV bulk hydration | **D1 bulk refresh + backup/restore** |
| `BaseService.gs` | Yardımcı | **Yardımcı (değişmez)** |

**Rolü değişmeyen servisler (Google-native, dokunulmaz):**

- `DriveService.gs` — Folder/file yönetimi
- `PDFService.gs` — PDF dönüşüm
- `DocumentService.gs` — Doküman üretim motoru
- `NotificationService.gs` — Mail iş akışları
- `TranslationService.gs` — TR↔EN çeviri

### `/src/lib/` (Frontend Core)

- `api.ts`: Worker fetch wrapper — değişmez.
- `sync.ts`: **Güncellenmesi gerekiyor** — `KV_PRIMARY_MISS` / `bulkSync` mantığı kaldırılacak.
- `db.ts`: IndexedDB wrapper — değişmez.
- `store.ts`: Global nanostores — değişmez.
- `config.ts`: `PUBLIC_WORKER_URL` — değişmez.

### `/src/features/company-ops/` (Operasyon Modülleri)

`definitions.ts`, `context.ts`, `certificate-form.ts` — değişmez; veri kaynağı backend'dedir.

### `/src/pages/` (UI Modülleri)

Tüm sayfalar değişmez; veri kaynağı Worker üzerinden D1'e yönlendirilecek.

---

## 🚫 v6.x'te Kesinlikle Yapılmayacaklar

| Yasak | Gerekçe |
| :--- | :--- |
| KV'ye operasyonel veri yazmak | KV yalnızca token/lock içindir |
| D1'e GAS'tan önce yazmak | Sheets source of truth'tur; D1 türev veridir |
| D1'i bypass edip doğrudan GAS okumak | Her normal read D1'den gelmeli; GAS yalnızca cache miss'te |
| Sheets'i okuyarak doküman payload'ı kurmak | Worker D1'den payload kurar; GAS sadece belgeyi üretir |
| D1'e JSON blob tek sütuna koymak | Her tablo için ayrı relational sütunlar zorunludur; `data_json` pattern kaldırıldı |

---

## 📖 Bir Kez Reddedilen Öneriler

#### ❌ "D1 yerine KV'de devam edelim, şema değiştirmeyelim"
**Gerekçe:** KV `list()` 1000 key limiti, write storm ve JSON blob sorgulanamama sorunları bu geçişi zorunlu kıldı. KV'nin yetersiz kaldığı noktalar belgelenmiştir.

#### ❌ "Sheets doğrudan browser'dan okunabilir (Google Sheets API)"
**Gerekçe:** API key browser'da görünür, rate limit kontrolü olmaz, Worker bypass edilir. Tüm trafik Worker üzerinden geçmek zorundadır.

#### ❌ "D1 yerine Cloudflare R2 (object storage) kullanalım"
**Gerekçe:** R2 obje deposudur; SQL sorgulaması yapmaz. D1, KV'nin yerini tablo yapısıyla doldurur ve bu proje için doğru seçimdir.

---

## 🎨 UI Standartları (değişmez)

- **Framework:** Astro 6.x + **Tailwind CSS (Pure Tailwind)**
- **Opaque Surfaces:** Şeffaf (glass) arka planlar yasaktır. `bg-surface` (solid) + `border-border-main`.
- **Data Density:** `p-2`, `leading-tight`, yüksek kontrast — veri yoğunluğu maksimize edilir.
- **Legacy Reference:** Bootstrap 5.3 + Tabulator v6.3 seviyesinde bilgi yoğunluğu hedeflenir.

---

## 🔐 Güvenlik & Middleware (değişmez)

- **Security Flow:** Browser (no key) → Cloudflare Worker (injects `API_KEY`) → GAS Bridge
- **CORS:** Yalnızca allowlist origin'leri geçer; `OPTIONS` ve `POST` aynı policy'yi taşır.
- **Worker Secrets:** `API_KEY`, `GAS_API_URL` — Dashboard'dan yönetilir, `wrangler.toml`'a yazılmaz.
- **GAS URL:** `https://script.google.com/macros/s/AKfycby...LL4/exec`
- **Custom Domain:** `https://portalapi.medicert.com.tr`
