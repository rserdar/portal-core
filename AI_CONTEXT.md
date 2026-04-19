# 🤖 Project Intelligence & Context (AI_CONTEXT.md v6.2.0)

> [!TIP]
> **GAS URL değiştiğinde yapılacaklar:**
> 1. `.dev.vars` → `GAS_API_URL=https://script.google.com/.../exec` güncelle (local)
> 2. Terminalde çalıştır (production):
>    ```
>    npx wrangler secret put GAS_API_URL
>    ```
>    Komut URL'yi interaktif olarak sorar — yapıştır, Enter'a bas.

> [!IMPORTANT]
> **Mevcut Mimari — Sheets-Primary + D1-Cache (v6.2.0):**
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
                    │  miss → boş sonuç    │     │  → Google Sheets │
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

### Kural R1 — D1-Primary Okuma (Self-Healing Yok)

```
Browser → Worker → D1 sorgu → Dön (<10ms)
                   D1 boşsa → boş sonuç / hata dön
                   (self-healing fallback uygulanmaz)
```

D1 boşsa kullanıcıdan `bulkSync` çalıştırması beklenir. Read handler'lar GAS fallback yapmaz; D1 her zaman dolu sayılır. "D1 miss → GAS → refill" yalnızca belgede tarif edilmiş hedef mimari olup fiilen implement edilmemiştir.

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

## 🗄️ D1 Şema — Kesinleşmiş Relational Tablo Yapısı (v6.2.0)

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

## 🗝️ KV Kullanım Sınırı (v6.2.0)

KV **yalnızca** şu amaçlarla kullanılır:

| KV Key | TTL | Amaç |
| :--- | :--- | :--- |
| `cache:getFolderId:{id}` | `CACHE_TTL` | Drive folder ID cache (Google Native exception) |
| `cache:getRecentFiles:{id}` | `CACHE_TTL` | Drive recent files cache (Google Native exception) |
| `token:confirm:{uuid}` | 600s | 2. onay protokolü tokeni *(tanımlı, henüz kullanımda değil)* |
| `lock:write:{entity}:{id}` | 30s | Concurrent write mutex *(tanımlı, henüz kullanımda değil)* |

Operasyonel veri (firma, sertifika, denetim, test, proforma, master data) artık KV'ye **asla** yazılmaz. Eski `cache:*` key'leri `clearCache` ile veya TTL dolunca expire olur.

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
| F1-1 | `bulkSync` action'ının **D1 yazma** kısmı yeniden yazıldı — `env.DB_D1.batch()` | ✅ | Operasyonel tablolar için mass deletion protection geçtikten sonra `DELETE FROM <tablo>` + `INSERT OR REPLACE` akışı; gerçek mirror semantiği sağlar |
| F1-2 | `bulkSync` dışındaki handler'larda `env.DB.get/put` kaldırıldı | ❌ | Yanlış belgelendi. Diğer handler'lar Faz 2-3'te taşındı; Faz 1'de sadece `bulkSync` değişti |
| F1-3 | Mass deletion protection `SELECT COUNT(*)` ile yeniden yazıldı | ✅ | `bulkSync` içinde her tablo için `SELECT COUNT(*) as cnt FROM <table>` kontrolü mevcut |
| F1-4 | `rebuildDashboardStats` D1 JOIN sorgusuyla yeniden yazıldı | ✅ | `certificates c LEFT JOIN companies co ON co.id = c.firma_no` sorgusu mevcut |
| F1-5 | Settings.astro'da sync etiketleri güncellendi | ✅ | Tüm KV atıfları, `export-kv-btn`/`import-kv-btn` ID'leri, ölü const'lar temizlendi; restore akışı `importBackup` çağırıyor |
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
| F3-4 | `updateCertificate` | ✅ | GAS `updateCertificate` → `upsertCertificateD1` + `rebuildDashboardStats` |
| F3-5 | `deleteCertificate` | ✅ | GAS `deleteCertificate` → `DELETE FROM certificates WHERE id=?` |
| F3-6 | `updateSurveillance` | ✅ | GAS `updateSurveillance` → `UPDATE certificates SET gozetim_confirmed=?` |
| F3-7 | `scheduleAudit` | ✅ | GAS `scheduleAudit` → `upsertAuditD1` |
| F3-8 | `updateAudit` | ✅ | GAS `updateAudit` → `upsertAuditD1` |
| F3-9 | `addTest` | ✅ | GAS `addTest` → `upsertTestD1` |
| F3-10 | `updateTest` | ✅ | GAS `updateTest` → `upsertTestD1` |
| F3-11 | `addProforma` | ✅ | GAS `addProforma` → `upsertProformaD1` |
| F3-12 | `updateProforma` | ✅ | GAS `updateProforma` → `upsertProformaD1` |
| F3-13 | `updateMasterData` | ✅ | GAS `updateMasterData` → senkron `getMasterData` + `upsertMasterTypeToD1`; ardından `master_version_<type>` / `master_updated_<type>` sync_meta'ya yazılır; yalnızca değiştirilen tablo yenilenir |
| F3-14 | `deleteTest` | ✅ | GAS `deleteTest` → `DELETE FROM tests WHERE id=?` |
| F3-15 | `deleteProforma` | ✅ | GAS `deleteProforma` → `DELETE FROM proformas WHERE id=?` |
| F3-16 | `updateCertificateField` | ✅ | GAS `updateCertificateField` → `upsertCertificateD1` + `rebuildDashboardStats` |

---

### Faz 4 — Admin Araçları + KV Temizliği

| # | Madde | Durum | Neden |
| :- | :--- | :---: | :--- |
| F4-1 | `exportData` D1'den `SELECT *` ile yeniden yazıldı | ✅ | Eski adı `exportKvData`; 5 tablo paralel sorgu; `version: "2.0"`; `api.ts` metodu `exportData` olarak yeniden adlandırıldı |
| F4-2 | `importKvData` deprecated edildi | ✅ | HTTP 410 döner; not: "kullan `bulkSync`" |
| F4-3 | `syncCheck` D1 `sync_meta` okuyacak şekilde güncellendi | ✅ | `SELECT value FROM sync_meta WHERE key='last_sync'` |
| F4-4 | `kvDiagnostic` D1 tablo sayımları + `last_sync` ile yeniden yazıldı | ✅ | 5 tablo COUNT sorgusu + sync_meta |
| F4-5 | `deepRepairIndex` `rebuildDashboardStats()` tetikleyecek şekilde güncellendi | ✅ | KV index rebuild mantığı kaldırıldı; D1-native |
| F4-6 | `clearCache` korundu — eski KV `cache:*` key'lerini temizler | ✅ | Geçiş döneminde eski cache key'lerini silmek için hâlâ gerekli |
| F4-7 | `[[kv_namespaces]]` binding korundu — Drive cache + clearCache | ✅ | Drive handler'ları (`getFolderId`, `getRecentFiles`) KV cache kullanıyor (Google Native exception, F4-9 kararı); `clearCache` geçiş temizliği için KV'e ihtiyaç duyuyor; tüm operasyonel yazma KV'den kaldırıldı |
| F4-8 | Ölü kod temizliği: KV tabanlı 20+ fonksiyon kaldırıldı (~200 satır) | ✅ | `hasUsableAuditDates`, `rebuildAuditsFromIndex`, `rebuildCertificatesFromEntityKeys`, `loadTestNextId/Proforma/Audit`, `getMasterDataset`, `buildStandardsByIdFromDataset`, `buildConsultantsFromDataset`, `extractConsultantNameFromRow`, `unmapCertificateToRow`, `mapRawProformaRow`, `buildCertificatesByFirmaId`, `mergeRecentCertificateIds`, `createCertificateSummary`, `createSearchEntry`, `parseVersionNumber`, `getTestValue`, `listKvKeys`, `purgeCachePrefix`, `indexKeys` |
| F4-9 | `indexKeys` objesi kaldırıldı; `CACHE_TTL` drive cache için korundu | ✅ | `CACHE_TTL` yalnızca DriveHandlers KV cache TTL için kullanılıyor |
| F4-10 | KV namespace ayrıştırması — değerlendirme sonucu gerek yok | ✅ | Tek `env.DB` namespace yeterli; key prefix'leri (`cache:`, `token:`, `lock:`) mantıksal ayrımı zaten sağlıyor; `token:confirm` / `lock:write` henüz implement edilmedi, implement edilince aynı namespace'e eklenecek |

---

### Faz 5 — Backup & Restore

| # | Madde | Durum | Neden |
| :- | :--- | :---: | :--- |
| F5-1 | `exportBackup` — D1'den tam JSON paketi indir | ✅ | Worker handler eklendi; `exportKvData`'yı full scope ile çağırır; GAS `exportBackup` da mevcuttu |
| F5-2 | `importBackup` — GAS → Sheets yaz → `bulkSync` D1 yenile | ✅ | Worker handler eklendi; GAS 2-adım onay protokolünü (token/phrase) GAS Script Cache ile yönetiyor; onay tamamlanınca senkron `bulkSync` ile D1 yenilenir |
| F5-3 | 2. Onay Protokolü KV token'ı (`token:confirm:{uuid}`) — değişmez | ✅ | KV'de kalıyor; D1'e taşınması gerekmiyor |

---

### Faz 6 — IndexedDB & UI Sync

| # | Madde | Durum | Neden |
| :- | :--- | :---: | :--- |
| F6-1 | `src/lib/sync.ts` — `KV_PRIMARY_MISS` / `needsHydration` mantığı kaldırıldı | ✅ | `needsHydration` kontrolü, KV miss blokları, KV hata mesajları kaldırıldı; JSDoc "D1-Primary" olarak güncellendi |
| F6-2 | Yeni sync akışı: Worker D1 → IndexedDB → UI | ✅ | `syncFromSheets` doğrudan `api.bulkSync()` çağırıyor; wrapper `api.pullFromSheetsToKv()` kaldırıldı; hata mesajları "D1" referanslı |
| F6-3 | Settings.astro KV referanslı etiket ve açıklamalar güncellendi | ✅ | `KV_PRIMARY_MISS` kontrolü, "KV boş/yedeği/verileri/İndeksleri KV'den Onar" gibi tüm metinler "D1" ile değiştirildi |
| F6-4 | `src/lib/api.ts` — isim ve kavram temizliği | ✅ | `exportKvData()` → `exportData()`; `pullFromSheetsToKv()` → `syncFromSheets()`; `bulkSyncMaster()` → `syncMasterData()`; `importKvData()` wrapper tamamen silindi; `needsHydration` `ApiResponse<T>` arayüzünden kaldırıldı; JSDoc "D1-primary / write-through" olarak güncellendi |
| F6-5 | Settings.astro buton ID'leri ve ölü const temizliği | ✅ | `export-kv-btn` → `export-backup-btn`; `import-kv-btn` → `import-backup-btn`; ölü `syncBtn`, `fullSyncBtn`, `opsSyncBtn`, `exportKvBtn`, `importKvBtn` const'ları kaldırıldı; `api.exportKvData(scope)` → `api.exportData(scope)` |
| F6-6 | Restore akışı kapsam seçiminden arındırıldı | ✅ | Restore butonu `api.importBackup(payload)` çağırıyor (scope parametresi yok); confirm dialog metni "tüm tablolar... Kısmi geri yükleme desteklenmez" olarak güncellendi; statik HTML uyarı metni eşleştirildi |
| F6-7 | `src/lib/db.ts` JSDoc güncellendi | ✅ | "KV-primary mimaride tarayıcı tarafı kısa süreli okuma cache'i" → "D1-primary mimaride tarayıcı tarafı IndexedDB cache katmanı" |
| F6-8 | `src/lib/store.ts` JSDoc güncellendi | ✅ | "IndexedDB (anlık açılış) → KV (arka plan tazeleme)" → "IndexedDB (anlık açılış) → Worker/D1 (arka plan tazeleme)" |
| F6-9 | `src/pages/company/proforma.astro` KV metin temizliği | ✅ | "Cloudflare KV üzerinden yüklenecek/kaydedildi" → "D1 üzerinden yüklenecek / kaydedildi" |
| F6-10 | `src/pages/company/edit.astro` KV miss UI kaldırıldı | ✅ | `isKvMiss` değişkeni ve amber uyarı kutusu + retry butonu + `bulkSync(['companies'])` çağrısı kaldırıldı; yerine sade "Firma bulunamadı (ID: ...)" mesajı |
| F6-11 | `src/pages/certificates/index.astro` `needsHydration` dalı kaldırıldı | ✅ | `res.needsHydration \|\| res.error === 'KV_PRIMARY_MISS'` koşulu; yerine sade `!res.success` log |

---

### Özet

| Faz | Kapsam | Toplam | ✅ | 🔄 | ⚠️/❌ |
| :- | :--- | :---: | :---: | :---: | :---: |
| Faz 0 | D1 kurulumu | 4 | 2 | — | 2 🔵 |
| Faz 1 | bulkSync + rebuildStats | 6 | 5 | — | 1 ❌ |
| Faz 1.5 | Relational şema reset | 6 | 3 | — | 3 🔵 |
| Faz 2 | Read path (26 action) | 26 | 26 | — | — |
| Faz 3 | Write path (16 action) | 16 | 16 | — | — |
| Faz 4 | Admin araçlar + KV temizlik | 10 | 10 | — | — |
| Faz 5 | Backup & restore | 3 | 3 | — | — |
| Faz 6 | IndexedDB/UI + API temizliği | 11 | 11 | — | — |
| **Toplam** | | **82** | **76** | — | **6** |

---

## 📝 Faz Detayları — Teknik Karar Notları

> Bu bölüm her fazda alınan teknik kararların **gerekçelerini** açıklar. Tablodaki "Neden" sütununun genişletilmiş halidir. Yeni bir AI oturumu veya geliştirici bu notları okuyarak neden böyle yapıldığını anlayabilir, alternatif önerebilir veya tutarlı biçimde devam edebilir.

---

### Faz 0 Notları — D1 Kurulumu

**Neden D1?**
v5.x KV mimarisinin üç kritik sorunu vardı: (1) `KV.list()` API'si tek sorguda en fazla 1000 key döndürüyor, büyük veri setlerinde sayfalama gerektiriyordu ve bu da "write storm" riskine yol açıyordu. (2) KV, JSON blob sakladığından SQL ile filtreleme, JOIN veya aggregation yapılamıyordu. (3) Aynı anda çok sayıda CRUD işlemi KV yazma kuyruğunu tıkıyordu. D1 (SQLite), bu sorunların tamamını `SELECT … WHERE`, `JOIN`, `COUNT(*)` gibi standart SQL ile çözüyor.

**Bölge seçimi — EEUR (Milano):**
Cloudflare D1 veritabanı Milano bölgesinde oluşturuldu. Türkiye'deki kullanıcılara en yakın Cloudflare edge lokasyonu olduğundan tercih edildi; ayrıca GDPR uyum açısından AB veri merkezinde tutulması avantaj sağlıyor.

**`migrations_dir` kararı:**
`wrangler.toml`'a `migrations_dir = "src/workers/migrations"` eklenerek şema değişiklikleri sürümlü SQL dosyalarında tutulmaktadır. `wrangler d1 migrations apply` komutu hangi migration'ların uygulandığını `d1_migrations` tablosuyla takip eder; elle SQL çalıştırma yerine bu akış tercih edildi.

---

### Faz 1 Notları — bulkSync D1 Yazma

**`env.DB_D1.batch()` neden kullanıldı?**
`batch()` ile 100'erli chunk'larda toplu yazma yapılıyor. Tek tek `run()` yerine `batch()` tercih edilmesinin iki nedeni var: (1) Her `run()` ayrı bir HTTP round-trip açar; `batch()` tümünü tek istek olarak gönderir. (2) `batch()` içindeki statement'lar atomik değil ama sıralı çalıştığından D1 write limit'ini daha verimli kullanır. 100'erlik chunk sınırı D1'in tek batch başına kabul ettiği statement sayısından kaynaklanıyor.

**Mass Deletion Protection — %20 eşiği:**
`bulkSync` sırasında gelen veri mevcut D1 kaydının %20'sinden azsa yazma işlemi engelleniyor ve `MASS_DELETION_PROTECTION` hatası dönüyor. Bu koruma şu senaryoya karşı: GAS'tan eksik/kırık bir sayfalama yanıtı gelirse tüm tabloyu silip sadece birkaç satır yazılmasın. %20 eşiği, meşru veri azalmasına (firma silme) izin verirken kazara toplu silme'yi engelleyecek kadar düşük tutuldu. Sadece 10'dan fazla kayıt varken aktif — küçük tablolarda false positive vermemesi için.

**`rebuildDashboardStats` — neden SQL JOIN?**
v5.x'te dashboard istatistikleri KV index'lerini birleştirerek hesaplanıyordu. v6'da `certificates c LEFT JOIN companies co ON co.id = c.firma_no` sorgusuyla tek SQL'de tüm hesaplama yapılıyor. Sonuç `sync_meta` tablosuna `key='dashboard_stats'` olarak JSON string şeklinde yazılıyor; okuma anında `SELECT value FROM sync_meta WHERE key='dashboard_stats'` yeterli — her istekte JOIN maliyeti yok.

**F1-2 neden ❌?**
"bulkSync dışındaki handler'larda `env.DB.get/put` kaldırıldı" maddesi yanlış belgelendi. Diğer handler'lar (read path, write path) Faz 2 ve Faz 3'te ayrı ayrı taşındı; Faz 1'de sadece `bulkSync`'in D1 yazma kısmı değiştirildi. ❌ işareti "yanlış yapıldı" değil "yanlış aşamaya atfedildi" anlamında.

---

### Faz 1.5 Notları — Relational Şema Reset

**`data_json` anti-pattern neden kaldırıldı?**
İlk geçiş denemesinde tüm Sheets satırları tek bir `data_json TEXT` sütununa JSON olarak yazılıyordu. Bu yaklaşım D1'in SQL avantajını sıfırlıyordu: `WHERE data_json LIKE '%ISO 9001%'` gibi sorgular index kullanamaz, JOIN yapılamaz. `003_relational_schema.sql` ile her alan kendi sütununa ayrıldı ve tüm index'ler (`idx_cert_standart`, `idx_cert_bitis` vb.) bu sütunlar üzerine tanımlandı.

**`auditors` tablosu tasarım kararı:**
Denetçi-standart ilişkisi için junction table (auditor_standards) yerine `std_9001 INTEGER DEFAULT 0`, `std_13485 INTEGER DEFAULT 0` … şeklinde boolean sütunlar tercih edildi. Gerekçe: standart sayısı azdır (≤10) ve hemen hiç değişmez; junction table ekstra JOIN maliyeti getirir; `WHERE std_9001=1` sorgusu junction table yerine doğrudan index kullanır. Yeni standart eklenince `ALTER TABLE ADD COLUMN` yeterli.

**`sync_meta` tablosu:**
`key-value` çifti tutan bu tablo şu anda iki değer saklar: `last_sync` (ISO timestamp) ve `dashboard_stats` (JSON string). KV'deki `meta:lastSync` ve `cache:getDashboardSummary:{}` key'lerinin D1 karşılığı. `sync_meta` hem `syncCheck` hem `getDashboardSummary` action'ları tarafından okunur.

**VIEW'ler neden eklendi?**
`certificates_full` ve `audits_full` VIEW'leri tekrarlayan JOIN sorgularını kısaltmak için eklendi. Kod içinde de kullanılabilir ancak şu an proxy.js handler'ları inline JOIN kullanıyor — VIEW'ler ilerideki sorgular için hazır.

---

### Faz 2 Notları — Read Path

**D1 cache miss durumu:**
v6'da "D1 miss" olması için D1'in tamamen boş olması gerekir (hiç `bulkSync` çalışmamış). Normal operasyonda bu durum oluşmaz. Bu yüzden "D1 miss → GAS fallback" mekanizması intentionally implement edilmedi; miss durumunda Worker doğrudan hata döner ve kullanıcıdan `bulkSync` çalıştırması beklenir.

**`buildCertificatePayloadFromD1` / `buildTestPayloadFromD1` / `buildProformaPayloadFromD1`:**
Bu üç fonksiyon sertifika, test ve proforma PDF/Doküman üretimi için GAS'a gönderilecek payload'ı D1'den derler. v5.x'te GAS direkt Sheets'i okuyarak payload kuruyordu; v6'da Worker D1'den okuyup GAS'a hazır payload yolluyor, GAS sadece belgeyi üretmekle sorumlu. Bu ayrım GAS execution süresini kısalttı.

**`getDashboardSummary` — pre-computed cache:**
Dashboard istatistikleri her sertifika ekleme/güncelleme sonrasında `rebuildDashboardStats()` ile yeniden hesaplanıp `sync_meta` tablosuna yazılıyor. `getDashboardSummary` action'ı sadece `SELECT value FROM sync_meta WHERE key='dashboard_stats'` yapıyor — canlı JOIN yok. Böylece dashboard render'ı `<10ms` latency ile çalışıyor.

**`getMasterData` — iki mod:**
`type` parametresi verilirse tek tablo sorgulanır (`SELECT * FROM standards`), verilmezse 5 tablo `Promise.all` ile paralel sorgulanır. Bu desen hem settings sayfasının bireysel tablo düzenleme akışına hem de tam master data yükleme ihtiyacına aynı action ile hizmet verir.

---

### Faz 3 Notları — Write Path

**Senkron D1 write-through (Kural W2):**
Her write action'ında GAS başarılı döndükten sonra D1 **await ile senkron** güncelleniyor. `ctx.waitUntil` (fire-and-forget) kasıtlı olarak kullanılmıyor çünkü: istek döndükten hemen sonra gelen okuma isteği D1'den eski veriyi görürdü. Tek istisna `importBackup` (Faz 5) — full restore sonrası `bulkSync` await ile çalıştırılıyor.

**`upsertXxxD1` helper pattern:**
Her entity tipi için ayrı bir `upsertCompanyD1`, `upsertCertificateD1`, `upsertAuditD1`, `upsertTestD1`, `upsertProformaD1` fonksiyonu var. Bu fonksiyonlar GAS'tan dönen canonical objeyi D1 `INSERT OR REPLACE` statement'ına bağlayıp `run()` çağırır. `INSERT OR REPLACE` semantiği: aynı `id`'ye sahip kayıt varsa güncelle, yoksa ekle. Bu sayede `add` ve `update` action'ları aynı upsert helper'ı paylaşıyor.

**`addCertificate` / `updateCertificate` sonrası `rebuildDashboardStats`:**
Sertifika sayısı ve durum değişimlerini dashboard'un yansıtması için her iki action'da da `rebuildDashboardStats()` tetikleniyor. `ctx.waitUntil` ile arka planda çalışıyor — yanıt beklemeden client'a dönülüyor ama Worker canlı kalıp stats'ı tamamlıyor.

**`updateMasterData` — neden sadece değiştirilen tablo yenileniyor?**
v5.x'te `updateMasterData` yalnızca KV yazıyordu (GAS yoktu). v6 geçişinde ilk implementasyonda `ctx.waitUntil(bulkSync({ scope: ["master"] }))` kullanıldı; bu tüm 5 master tabloyu GAS'tan yeniden okuyup D1'e yazıyordu — hem async (Kural W2 ihlali) hem gereksiz yük. Son implementasyonda: GAS `updateMasterData` Sheets'e yazar → senkron `getMasterData` ile sadece o tip okunur → `upsertMasterTypeToD1` ile yalnızca o tablo D1'de güncellenir. 5 tablo yerine 1 tablo; async yerine sync.

**`deleteCertificate` — D1'de gerçek silme:**
`DELETE FROM certificates WHERE id=?` komutu çalıştırılıyor. KV'de silme karmaşıktı (index key'leri de temizlenmeliydi); D1'de bir SQL satırı yeterli. GAS tarafı Sheets'ten satırı siler, Worker D1'den siler.

---

### Faz 4 Notları — Admin Araçları + KV Temizliği

**`exportData` — eski `exportKvData`:**
Action ve api.ts metodu Faz 6'da `exportKvData` → `exportData` olarak yeniden adlandırıldı. Settings.astro çağrıları güncellendi (`api.exportData(scope)`). `exportBackup` (Faz 5) ayrımı korundu: `exportData` scope seçilebilir kısmi export, `exportBackup` tam export aliası.

**`importKvData` — neden 410 (Gone) döndürüyor?**
Tamamen silmek yerine 410 döndürüyor çünkü: (1) Eski client'ların/script'lerin bu action'ı çağırması durumunda anlamlı bir hata mesajı görmesi gerekiyor. (2) 404 "bulunamadı" değil, 410 "kasıtlı olarak kaldırıldı" anlamına gelir — bu semantik daha doğru.

**`clearCache` neden korundu?**
v5.x döneminde KV'ye yazılan `cache:*` key'leri TTL süresi geçene kadar KV'de duruyor. `clearCache` bu key'leri temizlemeye yarıyor. TTL dolunca bunlar expire olacak; bu action geçiş dönemi temizliği için tutuldu.

**Drive handler'ları neden KV'de kaldı?**
`getFolderId` ve `getRecentFiles` handler'ları Drive klasör ID'lerini ve dosya listelerini KV'de cache'liyor. Bu "Google Native Exception" kapsamında: Drive operasyonları GAS üzerinden çalışıyor ve GAS execution süresi pahalı. Her Drive isteğinde GAS'ı çağırmak yerine sonucu `CACHE_TTL` süreyle KV'de tutmak bu yükü azaltıyor. D1'e taşımak ise semantik olarak yanlış — Drive data operational D1 verisinden farklı, Google sisteminden gelen geçici referans.

**`deepRepairIndex` — ne yapar?**
v5.x'te KV index'lerini `rebuildAuditsFromIndex`, `rebuildCertificatesFromEntityKeys` gibi fonksiyonlarla yeniden kuruyordu. v6'da bu fonksiyonlar kaldırıldı; `deepRepairIndex` artık sadece `rebuildDashboardStats()` tetikliyor. Dashboard stats bozulduğunda kullanılır.

**F4-10 — namespace ayrıştırması neden yapılmadı?**
`token:confirm:{uuid}` ve `lock:write:{entity}:{id}` key'leri KV kullanım sınırlarına dahil edildi ama kodda hiç implement edilmedi. Ayrı namespace açmak Cloudflare Dashboard'da yeni bir namespace ID'si, `wrangler.toml`'da yeni binding ve Worker'da ikinci `env.DB2` değişkeni anlamına gelir. Key prefix'leri (`cache:`, `token:`, `lock:`) zaten mantıksal ayrımı sağladığından fiziksel namespace ayrışması gereksiz bulundu.

---

### Faz 5 Notları — Backup & Restore

**`exportBackup` = `exportKvData` full scope:**
`exportBackup` action'ı sadece `exportKvData`'yı tüm scope'larla çağırıyor. Ayrı bir implementasyon yerine alias yapılmasının nedeni: D1 zaten Sheets'in mirror'ı, bu yüzden D1'den export = Sheets'ten export (normal operasyonda). GAS `SyncService.exportBackup()` de mevcuttu ama Sheets okuma GAS execution süresi tüketir; D1'den okumak daha hızlı.

**`importBackup` — 2-adım onay protokolü:**
GAS `SyncService.importBackup()` dahili olarak 2-adım onay uyguluyor:
- **1. adım:** `options.replace=true` ile çağrı yapılır; `confirm=false` veya `confirmText` eksikse GAS Script Cache'e UUID token yazar ve `{ requiresConfirmation: true, confirmation: { token, phrase, expiresInSec } }` döner.
- **2. adım:** Client aynı token + `confirmText: "GOOGLE_SHEETS_BACKUP_ONAY"` + `confirm: true` ile tekrar çağrır; GAS token'ı Script Cache'den tüketerek Sheets'e yazar.

Bu protokol GAS Script Cache'te (`CacheService.getScriptCache()`) yönetiliyor — Worker KV'inde değil. F5-3'teki "KV token" planından farklı; orada KV kullanılacaktı ama GAS tarafında zaten daha sağlam bir mekanizma vardı.

**`importBackup` sonrası `bulkSync` neden senkron (`await`)?**
Restore operasyonu tüm Sheets verisini değiştiriyor. Eğer `bulkSync` async (fire-and-forget) çalışırsa response dönmeden önce D1 güncellenmemiş olur; hemen ardından gelen read isteği eski veriyi görür. Kullanıcı "restore başarılı" mesajını görür ama uygulama eski veriyle çalışmaya devam eder. Bu tutarsızlığı önlemek için `await` zorunlu. `bulkSync` yavaş olsa da restore sonrası beklemek makul.

---

### Faz 6 Notları — IndexedDB & UI Sync

**`KV_PRIMARY_MISS` neden tamamen kaldırıldı?**
Bu hata kodu v5.x'te KV'de veri olmadığında Worker'ın döndürdüğü custom error'dı; `checkAndSync` bu kodu yakalayıp kullanıcıya "manuel hydration" uyarısı veriyordu. v6'da D1 her zaman dolu (boşsa `bulkSync` çalıştırılmamış demektir) ve Worker bu kodu artık üretmiyor. Dolayısıyla kontrol gereksiz — kaldırılmadığında false negative oluşturabilirdi (response içinde başka bir `needsHydration` key'i olsa yakalanırdı).

**Data Integrity Guard — `checkAndSync`:**
Sunucudan gelen sertifika veya firma sayısı yereldekinin %50'sinden azsa güncelleme engelleniyor ve uyarı toast gösteriliyor. Bu guard v5.x'te de vardı ve korundu; D1 migration sonrasında `bulkSync` henüz çalışmadan `checkAndSync` tetiklenirse boş D1 yanıtı IndexedDB'yi silmesin diye.

**`syncFromSheets` — `pullFromSheetsToKv` wrapper kaldırıldı:**
v5.x'te `syncFromSheets` → `api.pullFromSheetsToKv()` → GAS'a özel bir action çağırıyordu. v6'da `api.pullFromSheetsToKv()` zaten `api.bulkSync()` + `api.bulkSyncMaster()` kombinasyonu olarak yeniden yazılmıştı (api.ts'de wrapper kaldı). `sync.ts` artık doğrudan `api.bulkSync()` çağırıyor — wrapper'a ihtiyaç yok.

**`api.pullFromSheetsToKv` → `api.syncFromSheets`:**
Faz 6'da KV terminolojisi kaldırılırken bu wrapper da `syncFromSheets` olarak yeniden adlandırıldı; iç implementasyonu `bulkSync` çağırıyor. Benzer şekilde `api.bulkSyncMaster()` → `api.syncMasterData()`; `api.importKvData()` wrapper tamamen silindi (Worker tarafı zaten 410 döndürüyor).

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

## 📂 Teknik Dizin Matrisi (v6.2.0)

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

- `api.ts`: Worker fetch wrapper — Faz 6'da KV isimlendirme kalıntıları temizlendi; `exportData`, `syncFromSheets`, `syncMasterData` güncel metot adları.
- `sync.ts`: D1-primary sync akışı — `KV_PRIMARY_MISS`/`needsHydration` kaldırıldı; Faz 6'da güncellendi.
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

## ⚠️ D1 Migration Kuralları (değişmez — ihlali tüm veriyi siler)

> [!CAUTION]
> **Bu kurallar daha önce tüm production verisinin silinmesine yol açan bir olaydan sonra eklenmiştir.**

- **`003_relational_schema.sql` ASLA yeniden çalıştırılmaz.** Bu dosya tüm tabloları DROP edip sıfırdan oluşturur. `wrangler d1 execute --file` ile doğrudan çalıştırılması tüm veriyi siler.
- **Schema değişikliği = yeni migration dosyası.** Mevcut migration dosyaları (001, 002, 003...) düzenlenmez; her değişiklik için sıradaki numarayla yeni bir `00X_açıklama.sql` dosyası oluşturulur.
- **Migration uygulamak için tek komut:** `wrangler d1 migrations apply` — bu komut hangi migration'ların zaten uygulandığını takip eder ve sadece yenileri çalıştırır.
- **`wrangler d1 execute --file <migration>.sql` yasaktır** — bu komut migration geçmişini kontrol etmez, her çalıştırmada dosyayı tekrar uygular.
- **Schema değişikliği öncesi:** Mevcut verileri `Seçili Verileri .json Olarak Yedekle` ile yedekle.
- **Yeni migration sadece `ALTER TABLE`, `CREATE INDEX`, `CREATE TABLE IF NOT EXISTS` içerebilir** — `DROP TABLE` veya `DELETE FROM` içeren migration yazılmaz.

---

## 🎨 UI Standartları (değişmez)

- **Framework:** Astro 6.x + **Tailwind CSS (Pure Tailwind)**
- **Opaque Surfaces:** Şeffaf (glass) arka planlar yasaktır. `bg-surface` (solid) + `border-border-main`.
- **Data Density:** `p-2`, `leading-tight`, yüksek kontrast — veri yoğunluğu maksimize edilir.
- **Legacy Reference:** Bootstrap 5.3 + Tabulator v6.3 seviyesinde bilgi yoğunluğu hedeflenir.
- **Mobil Tasarım Standartları:** Tüm mobil UI bileşenleri Apple Human Interface Guidelines ve Google Material Design standartlarına uygun olacaktır. Dokunma hedefleri minimum **44×44px** olmalıdır (`h-6 w-6` ikon + `p-2.5` padding = 44px). Daha küçük dokunma alanı kullanılmaz.

---

## 🔐 Güvenlik & Middleware (değişmez)

- **Security Flow:** Browser (no key) → Cloudflare Worker (injects `API_KEY`) → GAS Bridge
- **CORS:** Yalnızca allowlist origin'leri geçer; `OPTIONS` ve `POST` aynı policy'yi taşır.
- **Worker Secrets:** `API_KEY`, `GAS_API_URL` — Dashboard'dan yönetilir, `wrangler.toml`'a yazılmaz. ⚠️ `API_KEY` hâlâ `wrangler.toml [vars]` içinde düz metin olarak duruyor — `wrangler secret put API_KEY` ile secret'a taşınması ve `wrangler.toml`'dan kaldırılması gerekiyor.
- **GAS URL:** `https://script.google.com/macros/s/AKfycby...LL4/exec`
- **Custom Domain:** `https://portalapi.medicert.com.tr`

---

## 🔮 İlerideki Hedefler (Ürünleşme Vizyonu)

> [!CAUTION]
> **Bu hedefler ana proje tamamlanmadan başlanmayacak.** Ana projenin tamamlanması; tüm v6.x migration maddelerinin ✅ durumuna gelmesi, mevcut Medicert portalının kararlı ve operasyonel çalışması anlamına gelir. Aşağıdaki hiçbir madde aktif geliştirme kapsamında değildir.

Bu vizyon, Medicert portalının tamamlanmasının ardından sistemin **"Platform Bağımsız, Tekrar Kullanılabilir Bir Ürün Çekirdeği"** haline getirilmesini hedefler. Sıralama kasıtlıdır — her adım bir sonrakinin ön koşuludur.

---

### Öncelik Sırası

#### Aşama 1 — Auth & RBAC (Temel Güvenlik)

**Neden önce bu?** Şu an sistemde kullanıcı kimlik doğrulama yoktur; `API_KEY` bile `wrangler.toml`'da düz metin durmaktadır. Güvenlik altyapısı kurulmadan hiçbir ürünleştirme adımı anlamlı değildir — çok kiracılı (multi-tenant) bir sisteme güvensiz bir temel üzerine inşa edilemez.

- Admin / Danışman / Firma Yetkilisi rol ayrımı (RBAC)
- Worker katmanında JWT veya session token doğrulaması
- `API_KEY` → `wrangler secret` geçişi (zaten ⚠️ bekliyor)
- Veri erişim sınırları: her rol yalnızca yetkili veriye erişebilir
- GAS ve Worker katmanlarında işlem logları (audit trail)

#### Aşama 2 — Tenant Config Merkezi (Whitelabel Altyapısı)

**Neden ikinci?** RBAC olmadan kiracı (tenant) kavramı güvenli kurulamaz. Tenant yapısı kurulmadan Whitelabel, Data Siloing ve "2-Day Launch" hedefleri hepsi havada kalır — birbirinin ön koşuludur.

- Logo, marka adı, domain, sheet-id, db bilgisi, feature flag ve tema ayarlarının tek merkezden yönetimi
- Her kiracının kendi konfigürasyonunun izole tutulması (Data Siloing)
- Konfigürasyonun koddan değil, merkezi bir yapıdan okunması (whitelabel)
- `Medicert` ismi kodun derinliklerinden temizlenerek marka-bağımsız hale getirilmesi

#### Aşama 3 — Schema Contract Resmileştirme

**Neden üçüncü?** Zaten inşa edilmiş olan şeyin (D1 şema + Sheets kolon yapısı) korunmasını garanti eden guardrail'lar kurulmadan, çok kiracılı sisteme ölçeklenmek şema kaymasına (schema drift) yol açar.

- D1 tabloları ile Sheets sayfaları arasında 1:1 kolon sözleşmesi belgelenmesi
- Versioned migration disiplini: her şema değişikliği için migration dosyası zorunlu
- Tip ve zorunlu alan kurallarının uygulama detayı olmaktan çıkarılıp resmi contract haline getirilmesi
- Şema uyumsuzluklarını erken yakalayan doğrulama katmanı

#### Aşama 4 — Provisioning Otomasyonu ("2-Day Launch")

**Neden dördüncü?** Auth, tenant config ve schema contract olmadan yeni müşteri kurulumu tekrar eden manuel iş demektir. Yukarıdaki üç aşama tamamlandığında provisioning otomasyonu anlam kazanır.

- Yeni müşteri açılışında: başlangıç verisi, roller, branding, env ayarları ve gerekli kaynakların tek akışla kurulması
- GAS Library çekirdeği: backend servislerinin farklı firmalar tarafından referans alınabilen paylaşımlı bir kütüphane olarak yönetilmesi
- Hedef: yeni müşteri kurulum süresi maksimum 2 güne indirilmesi

#### Aşama 5 — Platform Adaptörleri (Zero Lock-in)

**Neden en son?** Worker içinde birikmiş iş mantığı önceden temizlenmezse adaptör katmanı yeni bir lock-in üretir. Bu aşama en uzun vadeli hedeftir; ilk dört aşamanın olgunlaşmasına bağlıdır.

- `api.ts` Adapter Pattern: ortama göre `fetch` (Cloudflare) veya `google.script.run` (GAS) kullanımı
- MySQL/PHP veya Node.js runtime için ikinci adaptör — mevcut çekirdek sözleşmeleri bozulmadan
- Cloudflare'e özgü iş mantığının Worker'dan soyutlanması
- Hedef: platform değişiminin uygulama katmanında hissedilmemesi
