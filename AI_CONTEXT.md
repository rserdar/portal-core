# 🤖 Project Intelligence & Context (AI_CONTEXT.md v7.0.0)

> [!TIP]
> **GAS URL değiştiğinde yapılacaklar:**
> 1. `.dev.vars` → `GAS_API_URL=https://script.google.com/.../exec` güncelle (local)
> 2. Terminalde çalıştır (production):
>    ```
>    npx wrangler secret put GAS_API_URL
>    ```
>    Komut URL'yi interaktif olarak sorar — yapıştır, Enter'a bas.

> [!IMPORTANT]
> **Mevcut Mimari — D1-Primary (v7.0.0):**
> - **Source of Truth:** **Cloudflare D1** — tüm yazma işlemleri doğrudan D1'e gider; GAS yazma yolunda yer almaz.
> - **Backup Store:** **Google Sheets** — mevcut sekmeler GAS zaman tetikleyicisi ile D1 deltasından günlük güncellenir; kaynak değil, görünüm katmanıdır.
> - **KV:** Cloudflare KV yalnızca kısa ömürlü token, lock key ve Google Drive cache'i için kullanılır. Operasyonel veri KV'ye **asla** yazılmaz.
> - **Google Native Exception (değişmez):** Docs, Drive, Calendar, Gmail operasyonları GAS üzerinden çalışır; D1'e taşınamaz.
> - **Bu dosya referanstır:** Her AI oturumu veya geliştirici bu dosyayı okuyarak mimari kararlara uygun kod yazmalıdır.

> [!CAUTION]
> **v5.x KV kalıpları ve v6.x Sheets-Primary kalıpları geçersizdir.** `cache:company:{id}`, `KV_PRIMARY_MISS`, GAS write-through, "Sheets is source of truth" gibi kavramlar yeni geliştirmede kullanılmamalıdır.

> [!NOTE]
> **Saf Tailwind Mimarisi (v5.1.0 — değişmez):** Proje genelinde tüm "glass" efektler ve özel CSS sınıfları (`glass`, `form-input`) kaldırılmıştır. Tüm UI **Pure Tailwind** utility sınıfları ve opak arka planlar (`bg-surface`) ile yönetilmektedir.

---

## 🏗️ Mimari Genel Bakış (v7.0.0 — D1-Primary)

```
┌─────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│   Browser   │────▶│  Cloudflare Worker   │────▶│  Cloudflare D1   │
│  (IndexedDB │     │  (proxy.js)          │◀────│  (Source of      │
│   + UI)     │     │                      │     │   Truth)         │
└─────────────┘     │  WRITE PATH:         │     └──────────────────┘
                    │  Browser → Worker         ▲ delta sync (günlük)
                    │  → D1 (doğrudan)          │
                    │  (GAS yazma yolunda   ┌──────────────────┐
                    │   yer almaz)          │  Google Apps     │
                    │                       │  Script (GAS)    │
                    │  READ PATH:           │                  │
                    │  Worker → D1 (SQL)    │  • Belge üretimi │
                    │                       │  • Drive/Calendar│
                    │  BACKUP PATH:         │  • Sheets backup │
                    │  GAS(time trigger)  ──│  • Manuel sync   │
                    │  → D1 delta           │  → Google Sheets │
                    │  → Sheets upsert      │    (Backup View) │
                    └──────────────────────┘└──────────────────┘
```

### Katmanların Rolleri

| Katman | Rol | Notlar |
| :--- | :--- | :--- |
| **Cloudflare D1** | **Source of Truth** — tüm operasyonel veri buradadır | SQL sorguları, JOIN, filtre, agregasyon |
| **Cloudflare Worker** | **Secure API Proxy** — tüm veriyi orkestre eder | `proxy.js`, CORS, secret inject |
| **Cloudflare KV** | **Yalnızca token / lock / Drive cache** | Operasyonel veri kesinlikle yazılmaz |
| **Google Apps Script** | **Backup + Google-native Engine** | Günlük D1→Sheets backup, belge/Drive/Calendar |
| **Google Sheets** | **Backup View** — D1'den beslenen günlük yedek görünümü | Felaket kurtarma, elle düzenleme; kaynak değil |
| **IndexedDB** | **Browser Cache** — anlık UI render | `idb-keyval`, nanostores |

---

## 📐 Yazma (WRITE) Kuralları

### Kural W1 — Her Yazma Doğrudan D1'e Gider

```
Browser → Worker → D1 (INSERT OR REPLACE) → tarayıcıya dön
```

- GAS yazma yolunda **yer almaz**. CRUD işlemleri için Worker GAS çağrısı yapmaz.
- GAS yalnızca Google-native side-effect gerektiren işlemler için çağrılır (Calendar event oluşturma gibi).
- D1 her zaman tek ve nihai veri kaynağıdır.

### Kural W2 — Google Native Side-Effects: GAS Sonrası D1

`scheduleAudit`, `updateSurveillance` gibi Calendar bağımlı işlemler için:
1. Veri D1'e yazılır.
2. GAS, Google Calendar event'ini oluşturur / günceller.
3. GAS'ın döndürdüğü Calendar ID gibi değerler D1'e geri yazılır.

GAS bu akışta **side-effect engine**'dir, veri deposu değil.

### Kural W3 — Sheets'ten D1'e Manuel Sync

Sheets'te elle yapılan değişiklikler için GAS custom menüsü → Worker → D1 akışı kullanılır:
1. GAS, Sheets'ten `updated_at > last_manual_sync_at` olan satırları okur.
2. Worker'a `handleSheetEdit` veya bulk upsert isteği gönderir.
3. Worker D1'i günceller; `sync_meta.last_manual_sync_at` ilerletilir.

---

## 📖 Okuma (READ) Kuralları

### Kural R1 — D1-Primary Okuma

```
Browser → Worker → D1 sorgu → Dön (<10ms)
                   D1 boşsa → boş sonuç / hata dön
                   (self-healing fallback uygulanmaz)
```

D1 boşsa kullanıcıdan `bulkSync` çalıştırması beklenir. Read handler'lar GAS fallback yapmaz; D1 her zaman dolu sayılır.

### Kural R2 — SQL ile Sorgulama

```sql
-- v5.x KV yaklaşımı (YANLIŞ — artık kullanılmaz)
-- env.KV.get('cache:getCertificatesByFirmaId:{"firmaId":"123"}')

-- v7.x D1 yaklaşımı (DOĞRU)
SELECT * FROM certificates WHERE firma_no = 123;
SELECT COUNT(*) FROM certificates WHERE standart = 'ISO 9001';
```

### Kural R3 — Google Native Operasyonlar: Her Zaman GAS

Drive, Calendar, Docs, Gmail çağrıları D1'e cache **edilmez**. Worker doğrudan GAS'a yönlendirir.

---

## 🔄 Backup & Sync Mimarisi (v7.0.0)

### Günlük Otomatik Backup: D1 → Sheets (GAS Zaman Tetikleyicisi)

```
[GAS Time Trigger 03:00]
  → Worker: getDeltaForSheets(since=last_backup_ts)
  → D1: SELECT * FROM <tablo> WHERE updated_at > since
  → GAS: Mevcut Sheets sekmelerini ID bazlı upsert
  → GAS: .sql snapshot oluştur → Drive'a yükle
  → sync_meta.last_backup_ts güncelle
```

- **Yeni Sheets dosyası oluşturulmaz** — mevcut sekmeler (`companies`, `certificates`, `audits` vb.) doğrudan edilir.
- Drive'a her gün `backup_YYYY-MM-DD.sql` adlı dosya yüklenir.
- GAS servisi: `DailyBackupService.gs` (implementasyon: Faz 7-A)

### Manuel Sheets → D1 Sync (Custom Menü)

```
[GAS Custom Menu: "D1'e Senkronize Et"]
  → GAS: Sheets satırları oku (updated_at > last_manual_sync_at)
  → Worker: handleSheetEdit (bulk)
  → D1: upsert
  → sync_meta.last_manual_sync_at güncelle
```

- GAS servisi: `ManualSyncService.gs` veya `DailyBackupService.gs` içinde (implementasyon: Faz 7-C)
- `DeltaSyncService.gs` onEdit webhook kaldırılmış — yerine bu explicit akış geçerli.

### getDeltaForSheets Worker Endpoint

Worker'a yeni action eklenir:
```js
case "getDeltaForSheets":
  // SELECT * FROM <tablo> WHERE updated_at > ?
  // Her tablo için ayrı sorgu, sonuçları paket halinde döner
```

---

## 🗄️ D1 Şema — Kesinleşmiş Relational Tablo Yapısı (v7.0.0)

> [!IMPORTANT]
> Bu şema onaylanmış son halidir. Migration 005 (`005_audits_full_schema.sql`) ile `audits` tablosuna 16 yeni sütun eklenmiştir.
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
CREATE INDEX IF NOT EXISTS idx_cert_firma    ON certificates(firma_no);
CREATE INDEX IF NOT EXISTS idx_cert_standart ON certificates(standart);
CREATE INDEX IF NOT EXISTS idx_cert_bitis    ON certificates(gecerlilik_tarihi);
CREATE INDEX IF NOT EXISTS idx_cert_durum    ON certificates(durum);

-- ─────────────────────────────────────────
-- 3. AUDITS (Denetimler) — Migration 005 ile genişletildi
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audits (
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
  a1_kapsam       TEXT,   -- Migration 005
  a1_event_id     TEXT,   -- Migration 005
  a1_auditor      TEXT,   -- Migration 005
  a1_lead         TEXT,   -- Migration 005
  a2_baslangic    TEXT,
  a2_bitis        TEXT,
  a2_manday       REAL,
  a2_bas_denetci  TEXT,
  a2_denetci_2    TEXT,
  a2_denetci_3    TEXT,
  a2_kapsam       TEXT,   -- Migration 005
  a2_event_id     TEXT,   -- Migration 005
  a2_auditor      TEXT,   -- Migration 005
  a2_lead         TEXT,   -- Migration 005
  qms             TEXT,   -- Migration 005
  mdd             TEXT,   -- Migration 005
  ems             TEXT,   -- Migration 005
  ohs             TEXT,   -- Migration 005
  fsms            TEXT,   -- Migration 005
  isms            TEXT,   -- Migration 005
  engy            TEXT,   -- Migration 005
  gmp             TEXT,   -- Migration 005
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
  numune_ut      TEXT,
  numune_skt     TEXT,
  urun_bilgi     TEXT,
  gorsel1        TEXT,
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
  kod        TEXT PRIMARY KEY,
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
CREATE TABLE IF NOT EXISTS auditors (
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
-- 8. CONSULTANTS (Danışmanlar)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consultants (
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
  set_adi       TEXT,
  dosya_turu    TEXT,
  klasor_adi    TEXT,
  dokuman_kodu  TEXT,
  dokuman_adi   TEXT,
  dokuman_id    TEXT,
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
-- Önemli sync_meta key'leri:
-- last_sync           : son bulkSync zamanı (ISO)
-- dashboard_stats     : pre-computed dashboard JSON
-- last_backup_ts      : GAS'ın son D1→Sheets backup zamanı (unix ms)
-- last_manual_sync_at : son Sheets→D1 manuel sync zamanı (unix ms)
```

### SQL VIEW'ler (JOIN Kolaylığı)

```sql
CREATE VIEW IF NOT EXISTS certificates_full AS
  SELECT c.*, co.nickname, co.unvan, co.city
  FROM certificates c
  JOIN companies co ON co.id = c.firma_no;

CREATE VIEW IF NOT EXISTS audits_full AS
  SELECT a.*, co.nickname, co.unvan, ce.standart AS cert_standart
  FROM audits a
  JOIN companies co ON co.id = a.firma_no
  LEFT JOIN certificates ce ON ce.id = a.sertifika_id;
```

---

## 🗝️ KV Kullanım Sınırı (v7.0.0)

KV **yalnızca** şu amaçlarla kullanılır:

| KV Key | TTL | Amaç |
| :--- | :--- | :--- |
| `cache:getFolderId:{id}` | `CACHE_TTL` | Drive folder ID cache (Google Native exception) |
| `cache:getRecentFiles:{id}` | `CACHE_TTL` | Drive recent files cache (Google Native exception) |
| `token:confirm:{uuid}` | 600s | 2. onay protokolü tokeni |
| `lock:write:{entity}:{id}` | 30s | Concurrent write mutex *(henüz implement edilmedi)* |

Operasyonel veri (firma, sertifika, denetim, test, proforma, master data) KV'ye **asla** yazılmaz.

---

## 🗺️ Migration Yol Haritası

### Faz 0–6 — Tamamlandı ✅

| Faz | Kapsam | Sonuç |
| :- | :--- | :--- |
| **Faz 0** | D1 kurulumu, `DB_D1` binding, EEUR Milano, `migrations_dir` | ✅ |
| **Faz 1** | `bulkSync` D1 batch yazma, mass deletion protection (%20 eşik), `rebuildDashboardStats` SQL JOIN | ✅ |
| **Faz 1.5** | Relational şema reset (`003_relational_schema.sql`), `data_json` kaldırıldı, 11 tablo + 2 VIEW | ✅ |
| **Faz 2** | 26 read action KV → D1 SQL; `buildCertPayload` / `buildTestPayload` / `buildProformaPayload` D1'den | ✅ |
| **Faz 3** | 16 write action GAS write-through + D1 upsert (`upsertXxxD1` helpers); **geçici — Faz 7-B'de GAS kaldırılacak** | ✅ |
| **Faz 4** | Admin araçları D1'e taşındı; KV tabanlı ~200 satır ölü kod temizlendi; Drive cache KV'de kaldı | ✅ |
| **Faz 5** | `exportBackup` / `importBackup` 2-adım onay protokolü (GAS Script Cache token) | ✅ |
| **Faz 6** | `KV_PRIMARY_MISS` / `needsHydration` kaldırıldı; `api.ts` metot adları temizlendi; UI KV atıfları kaldırıldı | ✅ |

---

### Faz 7 — D1-Primary Geçişi (Bekliyor)

> Bu faz GAS'ı yazma yolundan tamamen çıkarır ve tam D1-primary mimariye geçiş tamamlar.

#### Faz 7-A: Günlük Otomatik Backup (GAS → Sheets + Drive)

| # | Madde | Durum |
| :- | :--- | :---: |
| F7-A1 | Worker: `getDeltaForSheets` action — `updated_at > since` filtreyle tüm tablolar | 🔄 |
| F7-A2 | GAS: `DailyBackupService.gs` — zaman tetikleyici (03:00), getDeltaForSheets çağrısı | 🔄 |
| F7-A3 | GAS: Mevcut Sheets sekmelerini ID bazlı upsert (yeni dosya oluşturulmaz) | 🔄 |
| F7-A4 | GAS: `.sql` snapshot oluştur ve Drive'a `backup_YYYY-MM-DD.sql` olarak yükle | 🔄 |
| F7-A5 | `sync_meta.last_backup_ts` güncelleme | 🔄 |

#### Faz 7-B: Write Path GAS Kaldırma

| # | Madde | Durum |
| :- | :--- | :---: |
| F7-B1 | `addCompany` / `updateCompany`: `fetchFromGas` kaldır, doğrudan D1 yaz | 🔄 |
| F7-B2 | `addCertificate` / `updateCertificate` / `deleteCertificate`: GAS kaldır | 🔄 |
| F7-B3 | `addTest` / `updateTest` / `deleteTest`: GAS kaldır | 🔄 |
| F7-B4 | `addProforma` / `updateProforma` / `deleteProforma`: GAS kaldır | 🔄 |
| F7-B5 | `scheduleAudit` / `updateAudit`: GAS korunur (Calendar side-effect); sadece Sheets yazma kaldırılır | 🔄 |
| F7-B6 | `updateMasterData`: GAS korunur (Sheets backup); D1 write zaten mevcut | 🔄 |
| F7-B7 | `005_audits_full_schema.sql` migration uygulanır (`wrangler d1 migrations apply`) | 🔄 |
| F7-B8 | `bulkSync` ile audits tablosu 16 yeni sütunla yeniden doldurulur | 🔄 |

#### Faz 7-C: Manuel Sheets → D1 Sync (GAS Custom Menü)

| # | Madde | Durum |
| :- | :--- | :---: |
| F7-C1 | GAS custom menüsü: "D1'e Senkronize Et" menü öğesi | 🔄 |
| F7-C2 | GAS: `updated_at > last_manual_sync_at` olan Sheets satırlarını toplar | 🔄 |
| F7-C3 | Worker: bulk upsert endpoint veya mevcut `handleSheetEdit` genişletmesi | 🔄 |
| F7-C4 | `sync_meta.last_manual_sync_at` güncelleme | 🔄 |

#### Faz 7-D: DeltaSyncService.gs Yeniden Yazma

| # | Madde | Durum |
| :- | :--- | :---: |
| F7-D1 | `DeltaSyncService.getDeltaExport` kaldır (Sheets→D1 yönü kaldırıldı) | 🔄 |
| F7-D2 | `DeltaSyncService.handleEdit` ve `onEdit` webhook kaldır | 🔄 |
| F7-D3 | `DeltaSyncService.setupTrigger` kaldır | 🔄 |
| F7-D4 | `DeltaSyncService.reconcileFromD1(delta)` ekle — D1 delta paketini Sheets'e uygular | 🔄 |

---

### Özet

| Faz | Kapsam | Durum |
| :- | :--- | :---: |
| Faz 0–6 | D1 kurulumu, şema, read/write path, admin araçlar, backup, UI sync | ✅ (82 madde) |
| **Faz 7** | **D1-Primary geçiş — GAS yazma yolundan çıkar, günlük backup, manuel sync** | 🔄 (18 madde) |

---

## 📝 Teknik Karar Notları

### D1-Primary Kararı (v7.0.0)

**Neden GAS yazma yolundan çıkarıldı?**

v6.x Sheets-Primary mimarisinin iki kritik sorunu vardı:
1. **Gecikme:** Her CRUD işlemi GAS execution süresi (1-3s) harcıyordu. GAS cold start + Sheets API round-trip = kullanıcı hissedilen gecikme.
2. **Güvenilirlik:** GAS URL değiştiğinde veya GAS execution limiti dolduğunda tüm yazma yolu çöküyordu. D1 bu bağımlılığı ortadan kaldırır.

**Sheets'in rolü neden değişti?**

Sheets tamamen kaldırılmayacak çünkü:
- GAS üzerinden belge üretimi (ISO sertifikası, sözleşme, proforma) Sheets verisiyle çalışıyor.
- Manuel düzenleme için Sheets arayüzü hâlâ pratik.
- Felaket kurtarma için günlük .sql snapshot yeterli ama görsel backup da isteniliyor.

Bu yüzden Sheets "backup view" olarak korunuyor — kaynak değil, yansıma.

**onEdit webhook neden kaldırıldı?**

GAS `onEdit` tetikleyicisi güvenilmez: çakışma riski, execution limiti, URL değişimi. Manuel "D1'e Senkronize Et" butonu daha güvenilir ve explicit.

---

### Faz 3 Write-Through Pattern (Geçici)

`upsertXxxD1` helper pattern:
- GAS'tan dönen canonical objeyi D1 `INSERT OR REPLACE` statement'ına bağlar.
- `add` ve `update` action'ları aynı upsert helper'ı paylaşır.
- Faz 7-B'de GAS adımı kaldırılacak, D1 yazma doğrudan yapılacak.

**`upsertAuditD1` batch pattern:**
- Fonksiyon `.run()` çağrısı yapmadan prepared statement döner.
- `batch()` içinde kullanılabilir; write-through çağrılar `.run()` ekler.

---

### Migration 005 — Audits Tam Şema

`005_audits_full_schema.sql` ile `audits` tablosuna 16 sütun eklendi:
`a1_kapsam`, `a1_event_id`, `a1_auditor`, `a1_lead`, `a2_kapsam`, `a2_event_id`, `a2_auditor`, `a2_lead`, `qms`, `mdd`, `ems`, `ohs`, `fsms`, `isms`, `engy`, `gmp`.

Bu sütunlar denetim formu düzenlemesinde gerekli. Eksik olduğunda form kaydederken Calendar event title ve ID'leri boş yazılıyordu.

**Uygulama komutu (Faz 7-B7):**
```bash
wrangler d1 migrations apply medicert-portal --remote
```

---

## ⚡ Platform Limitleri (v7.0.0)

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

> [!NOTE]
> **D1-Primary mimaride GAS yalnızca backup, belge üretimi ve Calendar side-effect için çalışır.** Her CRUD işleminde GAS execution süresi harcanmaz. Yalnızca günlük backup trigger'ı ve manuel sync butonu GAS execution kullanır — bu kullanım günlük limitlerin çok altında kalır.

### Cloudflare KV (Minimal)

KV yalnızca token/lock ve Drive cache için kalır. Free tier limitleri bu kullanım için yeterlidir.

---

## 📂 Teknik Dizin Matrisi (v7.0.0)

### `/src/workers/proxy.js` (Cloudflare Worker)

**Aktif binding (`wrangler.toml`):**
```toml
[[d1_databases]]
binding = "DB_D1"
database_name = "medicert-portal"
database_id = "94b188bb-1ea8-4b84-ba00-8f7bf91bb265"
migrations_dir = "src/workers/migrations"
```

**Write pattern (Faz 7-B sonrası):**
```js
// Doğrudan D1'e yaz (GAS yok)
const canonical = createCanonicalCompany(payload);
await upsertCompanyD1(canonical, env).run();
return { success: true, data: canonical };
```

### `/src/workers/migrations/`

| Dosya | Durum | Açıklama |
| :--- | :--- | :--- |
| `001_initial.sql` | Superseded | İlk geçici tablo yapısı |
| `002_add_data_json.sql` | Superseded | Geçici data_json sütunları |
| `003_relational_schema.sql` | **Aktif şema** | 11 tablo + 2 VIEW |
| `004_sync_logs.sql` | Yeni | Sync log tablosu |
| `005_audits_full_schema.sql` | **Uygulanmayı bekliyor** | 16 yeni audit sütunu |

> [!CAUTION]
> **`003_relational_schema.sql` ASLA yeniden çalıştırılmaz.** Tüm tabloları DROP edip sıfırdan oluşturur.
> **`wrangler d1 execute --file <migration>.sql` yasaktır** — migration geçmişini kontrol etmez.
> **Tek doğru komut:** `wrangler d1 migrations apply`

### `/src/gas/api/` (Google Apps Script Servisleri)

| Servis | v7.0.0 Rolü |
| :--- | :--- |
| `CompanyService.gs` | Sadece backup için okuma; CRUD GAS'a gitmiyor |
| `CertificateService.gs` | Sadece backup için okuma; CRUD GAS'a gitmiyor |
| `TestService.gs` | Sadece backup için okuma; CRUD GAS'a gitmiyor |
| `ProformaService.gs` | Sadece backup için okuma; CRUD GAS'a gitmiyor |
| `AuditService.gs` | Calendar side-effect (scheduleAudit, updateSurveillance) + backup okuma |
| `SyncService.gs` | importBackup (emergency restore) + exportBackup |
| `DeltaSyncService.gs` | Faz 7-D'de yeniden yazılacak — sadece D1→Sheets reconcile |
| `MasterDataService.gs` | updateMasterData için GAS korunuyor (Sheets backup senkronizasyonu) |
| `BaseService.gs` | Yardımcı (değişmez) |

**Google-native, dokunulmaz servisler:**
- `DriveService.gs`, `PDFService.gs`, `DocumentService.gs`, `NotificationService.gs`, `TranslationService.gs`

**Faz 7'de eklenecek servisler:**
- `DailyBackupService.gs` — D1→Sheets günlük backup + .sql to Drive

### `/src/lib/` (Frontend Core)

- `api.ts`: `exportData`, `syncFromSheets`, `syncMasterData` güncel metot adları.
- `sync.ts`: D1-primary sync akışı; `KV_PRIMARY_MISS`/`needsHydration` kaldırıldı.
- `db.ts`, `store.ts`: değişmez.

---

## 🚫 v7.x'te Kesinlikle Yapılmayacaklar

| Yasak | Gerekçe |
| :--- | :--- |
| KV'ye operasyonel veri yazmak | KV yalnızca token/lock/Drive cache içindir |
| GAS'ı yazma yoluna eklemek | D1 source of truth'tur; GAS write latency ve güvenilirlik riski yaratır |
| D1'i bypass edip doğrudan GAS okumak | Her read D1'den gelir; GAS fallback uygulanmaz |
| Sheets'i kaynak olarak kullanmak | Sheets backup görünümüdür; veriye D1'den erişilir |
| D1'e JSON blob tek sütuna koymak | Relational sütunlar zorunlu; `data_json` pattern kaldırıldı |
| `wrangler d1 execute --file` kullanmak | Migration geçmişini kontrol etmez; `wrangler d1 migrations apply` kullanılır |
| Mevcut migration dosyalarını düzenlemek | Her şema değişikliği yeni bir `00X_*.sql` dosyasıdır |

---

## 📖 Reddedilen Öneriler

#### ❌ "D1 yerine KV'de devam edelim"
`list()` 1000 key limiti, write storm ve JSON blob sorgulanamama sorunları geçişi zorunlu kıldı.

#### ❌ "Sheets doğrudan browser'dan okunabilir (Google Sheets API)"
API key browser'da görünür, rate limit kontrolü olmaz, Worker bypass edilir.

#### ❌ "D1 yerine R2 kullanalım"
R2 obje deposudur; SQL sorgulaması yapmaz.

#### ❌ "onEdit webhook ile Sheets→D1 sync yapalım"
`onEdit` tetikleyicisi güvenilmez (çakışma, execution limit, URL değişimi). Manuel "D1'e Senkronize Et" butonu tercih edildi.

#### ❌ "Günlük backup için yeni Sheets dosyası oluşturalım"
Mevcut sekmeler doğrudan güncellenir (upsert); yeni dosya oluşturulmaz.

---

## 🔮 İlerideki Hedefler (Ürünleşme Vizyonu)

> [!CAUTION]
> **Bu hedefler Faz 7 tamamlanmadan başlanmayacak.**

#### Aşama 1 — Auth & RBAC
Admin / Danışman / Firma Yetkilisi rol ayrımı; Worker JWT doğrulaması; `API_KEY` → `wrangler secret`.

#### Aşama 2 — Tenant Config Merkezi
Logo, domain, sheet-id, feature flag merkezi yönetimi; Data Siloing.

#### Aşama 3 — Schema Contract Resmileştirme
D1↔Sheets 1:1 kolon sözleşmesi; versioned migration disiplini; şema uyumsuzluk doğrulama.

#### Aşama 4 — Provisioning Otomasyonu
Yeni müşteri kurulum süresi maksimum 2 güne indirilmesi; GAS Library çekirdeği.

#### Aşama 5 — Platform Adaptörleri
`api.ts` Adapter Pattern; MySQL/PHP veya Node.js runtime için ikinci adaptör.

---

## 🔐 Güvenlik & Middleware (değişmez)

- **Security Flow:** Browser (no key) → Cloudflare Worker (injects `API_KEY`) → GAS Bridge (yalnızca Google-native işlemler için)
- **CORS:** Yalnızca allowlist origin'leri geçer.
- **Worker Secrets:** `API_KEY`, `GAS_API_URL` — Dashboard'dan yönetilir. ⚠️ `API_KEY` hâlâ `wrangler.toml [vars]`'da düz metin — `wrangler secret put API_KEY` ile taşınması gerekiyor.
- **GAS URL:** `https://script.google.com/macros/s/AKfycby...LL4/exec`
- **Custom Domain:** `https://portalapi.medicert.com.tr`

---

## 🎨 UI Standartları (değişmez)

- **Framework:** Astro 6.x + **Tailwind CSS (Pure Tailwind)**
- **Opaque Surfaces:** `bg-surface` (solid) + `border-border-main`; glass/şeffaf yasak.
- **Data Density:** `p-2`, `leading-tight`, yüksek kontrast.
- **Legacy Reference:** Bootstrap 5.3 + Tabulator v6.3 seviyesinde bilgi yoğunluğu.
- **Mobil Tasarım:** Apple HIG + Material Design; minimum dokunma hedefi **44×44px**.
