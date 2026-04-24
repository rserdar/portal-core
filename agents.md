# 🤖 Medicert Portal — AI Context (v7.1.0)

> **GAS URL değişirse:** `.dev.vars` → `GAS_API_URL` güncelle, ardından `npx wrangler secret put GAS_API_URL`.

> [!IMPORTANT]
> **Mimari:** D1-Primary. Tüm CRUD D1'e gider. GAS yalnızca backup, belge üretimi ve Google-native işlemler içindir. KV yalnızca token/lock/Drive cache.

> [!CAUTION]
> **v5.x KV kalıpları** (`cache:company:{id}`, `KV_PRIMARY_MISS`) ve **v6.x Sheets-Primary kalıpları** geçersizdir.

> [!NOTE]
> **Saf Tailwind (v5.1.0):** `glass`, `form-input` gibi özel sınıflar kaldırıldı. Tüm UI Pure Tailwind + `bg-surface`.

---

## 🏗️ Mimari

```
Browser → Worker (proxy.js) → D1 (Source of Truth)
                            ↓ ctx.waitUntil
                       syncToBackup → GAS → Sheets (Backup View)
```

| Katman | Rol |
| :--- | :--- |
| **D1** | Source of Truth — SQL, JOIN, filtre |
| **Worker** | Secure API proxy — CORS, secret inject |
| **KV** | Yalnızca token / lock / Drive cache |
| **GAS** | Backup + Google-native (Drive, Calendar, Docs) |
| **Sheets** | Backup View — D1'den günlük beslenir |
| **IndexedDB** | Browser cache — anlık UI render |

---

## 📐 Yazma & Okuma Kuralları

**W1 — Her yazma D1'e gider:**
`Browser → Worker → D1` — GAS yazma yolunda yer almaz. `syncToBackup` arka planda çalışır, response'u bloklamaz. Hata olursa `sync_log` tablosuna yazılır.

**W2 — Google-native side-effect:** Calendar, Drive, Docs gerektiren işlemler (ör. sertifika `calendar_id` güncellemesi): önce D1, ardından GAS side-effect, GAS'tan dönen ID D1'e geri yazılır.

**W3 — Manuel Sheets → D1:** GAS custom menüsü (`ManualSyncService`) → Worker bulk upsert → D1. `sync_meta.last_manual_sync_at` ilerletilir.

**R1 — D1-Primary okuma:** Her read D1'den gelir. D1 boşsa GAS fallback yapılmaz — `bulkSync` çalıştırılır.

**R2 — Google-native okuma:** Drive, Calendar, Docs → GAS. D1'e cache edilmez.

> [!NOTE]
> **Audits Calendar entegrasyonu kaldırıldı (Migration 008).** `audits` tablosunda Calendar/sistem sütunu yoktur. `calendar_id` yalnızca `certificates` tablosundadır.

---

## 🗄️ D1 Şema (v7.1.0)

```sql
-- COMPANIES
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY,
  nickname TEXT NOT NULL, unvan TEXT, adres TEXT, city TEXT, ulke TEXT,
  yazisma TEXT, vergi_dairesi TEXT, vergi_no TEXT, tel TEXT, faks TEXT,
  www TEXT, mail TEXT, yetkili_adi TEXT, yetkili_unvani TEXT, kyt TEXT,
  irtibat_kisi TEXT, irtibat_unvani TEXT, irtibat_tel TEXT, irtibat_mail TEXT,
  yapilan_is TEXT, tcs TEXT, ycs TEXT, ucs TEXT, yzcs TEXT, tascs TEXT, acs TEXT,
  alan TEXT, departman TEXT, vardiya TEXT, logo TEXT, kase TEXT,
  dokuman TEXT, teknik TEXT, tkapsam TEXT, sinif TEXT, firma_not TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- CERTIFICATES
CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY,
  firma_no INTEGER NOT NULL REFERENCES companies(id),
  standart TEXT, denetim_tipi TEXT, sertifika_no TEXT,
  sertifika_tarihi TEXT, gozetim_tarihi TEXT, tescil_tarihi TEXT, gecerlilik_tarihi TEXT,
  kapsam TEXT, scope TEXT, akreditasyon TEXT, akredite INTEGER,
  ea TEXT, nace TEXT, consultant TEXT, other_standart TEXT,
  durum TEXT, sertifika_not TEXT, gozetim_confirmed INTEGER,
  calendar_id TEXT, qr TEXT, cert_link TEXT, logo TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- AUDITS — Migration 008 sonrası (Calendar sütunları kaldırıldı)
CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY,
  firma_no INTEGER NOT NULL REFERENCES companies(id),
  sertifika_id INTEGER REFERENCES certificates(id),
  standart TEXT, denetim_tipi TEXT,
  a1_baslangic TEXT, a1_bitis TEXT, a1_manday REAL,
  a1_bas_denetci TEXT, a1_denetci_2 TEXT, a1_denetci_3 TEXT,
  a2_baslangic TEXT, a2_bitis TEXT, a2_manday REAL,
  a2_bas_denetci TEXT, a2_denetci_2 TEXT, a2_denetci_3 TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- TESTS
CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY,
  firma_no INTEGER REFERENCES companies(id),
  test_adi TEXT, marka TEXT, urun TEXT, urun_kodu TEXT, urun_no TEXT,
  lot TEXT, urun_kabul TEXT, kabul_saat TEXT,
  test_baslangic TEXT, test_bitis TEXT, rapor_tarihi TEXT, rapor_no TEXT,
  numune_sayisi INTEGER, numune_ut TEXT, numune_skt TEXT,
  urun_bilgi TEXT, gorsel1 TEXT, gorsel2 TEXT, detay TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- PROFORMAS
CREATE TABLE IF NOT EXISTS proformas (
  id INTEGER PRIMARY KEY,
  firma_no INTEGER NOT NULL REFERENCES companies(id),
  kdvsiz REAL, kdv_oran INTEGER, kdv REAL, toplam REAL,
  birim TEXT, tarih TEXT, konu TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- STANDARDS
CREATE TABLE IF NOT EXISTS standards (
  kod TEXT PRIMARY KEY, kisaltma TEXT, tam_ad TEXT,
  tanim_tr TEXT, tanim_en TEXT, tema_id_en TEXT, tema_id_tr TEXT
);

-- AUDITORS
CREATE TABLE IF NOT EXISTS auditors (
  id INTEGER PRIMARY KEY, ad TEXT NOT NULL, soyad TEXT, imza TEXT,
  std_9001 INTEGER DEFAULT 0, std_13485 INTEGER DEFAULT 0,
  std_14001 INTEGER DEFAULT 0, std_22000 INTEGER DEFAULT 0,
  std_27001 INTEGER DEFAULT 0, std_45001 INTEGER DEFAULT 0,
  std_50001 INTEGER DEFAULT 0, std_gmp INTEGER DEFAULT 0,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- CONSULTANTS
CREATE TABLE IF NOT EXISTS consultants (
  id INTEGER PRIMARY KEY, ad TEXT, adres TEXT, tel TEXT, mail TEXT,
  yetkili_adi TEXT, yetkili_soyad TEXT, hitabet TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- TESTDOCS
CREATE TABLE IF NOT EXISTS testdocs (
  id INTEGER PRIMARY KEY, kategori TEXT, aciklama TEXT, dokuman_adi TEXT,
  test_adi_tr TEXT, test_adi_en TEXT, standart TEXT,
  tema_tr TEXT, tema_en TEXT, gun_sayisi INTEGER,
  kisaltma TEXT, kisaltma2 TEXT, notlar TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- SYSDOCS
CREATE TABLE IF NOT EXISTS sysdocs (
  id INTEGER PRIMARY KEY, set_adi TEXT, dosya_turu TEXT, klasor_adi TEXT,
  dokuman_kodu TEXT, dokuman_adi TEXT, dokuman_id TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- SYNC META
CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER DEFAULT (unixepoch())
);
-- Önemli key'ler: last_sync, dashboard_stats, last_backup_ts, last_manual_sync_at

-- SYNC LOG (migration 007)
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT, entity_type TEXT, entity_id TEXT,
  status TEXT, error_message TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

-- VIEWS
CREATE VIEW IF NOT EXISTS certificates_full AS
  SELECT c.*, co.nickname, co.unvan, co.city
  FROM certificates c JOIN companies co ON co.id = c.firma_no;

CREATE VIEW IF NOT EXISTS audits_full AS
  SELECT a.*, co.nickname, co.unvan, ce.standart AS cert_standart
  FROM audits a
  JOIN companies co ON co.id = a.firma_no
  LEFT JOIN certificates ce ON ce.id = a.sertifika_id;
```

---

## 🗝️ KV Kullanım Sınırı

| Key | TTL | Amaç |
| :--- | :--- | :--- |
| `cache:getFolderId:{id}` | `CACHE_TTL` | Drive folder ID |
| `cache:getRecentFiles:{id}` | `CACHE_TTL` | Drive recent files |
| `token:confirm:{uuid}` | 600s | 2. onay tokeni |
| `lock:write:{entity}:{id}` | 30s | Write mutex *(henüz impl. edilmedi)* |

---

## 🗺️ Migration Durumu

| Dosya | Durum |
| :--- | :--- |
| `001_initial.sql` | Superseded |
| `002_add_data_json.sql` | Superseded |
| `003_relational_schema.sql` | **Archived/Historical — ASLA yeniden çalıştırılmaz** (DROP + recreate içerir; yalnızca boş DB kurulumu için tarihi referanstır) |
| `004_akredite_to_text.sql` | ✅ Uygulandı |
| `005_audits_full_schema.sql` | ✅ Uygulandı (16 sütun eklendi, 008 ile kaldırıldı) |
| `006_normalize_akredite_text.sql` | ✅ Uygulandı |
| `007_sync_logs.sql` | ✅ Uygulandı |
| `008_drop_audit_calendar_cols.sql` | ✅ Uygulandı — audits Calendar sütunları kaldırıldı |

> [!CAUTION]
> **`003_relational_schema.sql` ASLA yeniden çalıştırılmaz** (DROP + recreate içerir).
> Tek geçerli komut: `wrangler d1 migrations apply medicert-portal --remote`
> `wrangler d1 execute --file` yasaktır.

### Gelecek Migration Rezervasyonu

| Numara | Faz | Kapsam | Durum |
| :--- | :--- | :--- | :--- |
| `009` | G2 | `consultants.email` sütunu + `consultant_firms` junction tablosu | Rezerve |
| `010` | G1 | JWT signing secret için `sync_meta` key veya ayrı yapılandırma gerekirse | Rezerve |
| `011+` | D/E/F | Tenant veya DLC bazlı şema değişiklikleri için açık slot | — |

> Rezerve numaralar yalnızca planlama amaçlıdır; uygulanana kadar dosyası oluşturulmaz. Her yeni migration kendi numarasını `008`'den sonra sıralı alır — numara atlanmaz, değiştirilmez.

---

## 📂 GAS Servisleri

| Servis | Rol |
| :--- | :--- |
| `DailyBackupService.gs` | Günlük 03:00: D1 delta → Sheets + SQL snapshot → Drive |
| `ManualSyncService.gs` | "D1'e Senkronize Et" menüsü — Sheets → D1 bulk upsert |
| `DeltaSyncService.gs` | Sadece `onEdit` timestamp damgalama; webhook/export kaldırıldı |
| `SyncService.gs` | `importBackup` (emergency) + `reconcileFromD1` (Sheets upsert) |
| `AuditService.gs` | Sadece backup okuma (Calendar entegrasyonu kaldırıldı) |
| `CompanyService.gs` / `CertificateService.gs` / `TestService.gs` / `ProformaService.gs` | Sadece backup okuma |
| `MasterDataService.gs` | updateMasterData Sheets senkronizasyonu |
| `DriveService.gs` / `PDFService.gs` / `DocumentService.gs` / `NotificationService.gs` / `TranslationService.gs` | Google-native — dokunulmaz |

---

## 🚫 Yasak Listesi

| Yasak | Gerekçe |
| :--- | :--- |
| KV'ye operasyonel veri yazmak | Yalnızca token/lock/Drive cache |
| GAS'ı yazma yoluna eklemek | D1 source of truth; GAS write latency + güvenilirlik riski |
| D1'i bypass edip GAS okumak | Her read D1'den gelir |
| Sheets'i kaynak olarak kullanmak | Backup görünümü; veri D1'dedir |
| D1'e JSON blob tek sütuna koymak | Relational sütunlar zorunlu |
| `wrangler d1 execute --file` kullanmak | Migration geçmişini kontrol etmez |
| Audits'a Calendar/sistem sütunu eklemek | Migration 008 ile kaldırıldı |
| Mevcut migration dosyalarını düzenlemek | Her değişiklik yeni `00X_*.sql` dosyasıdır |
| `wrangler.toml [vars]`'a secret yazmak | `[vars]` git geçmişine düşer, CF Dashboard'da plaintext görünür; tüm secret'lar Dashboard Secrets veya `.dev.vars` ile yönetilir |
| `bulkSync` action'ını rutin olarak kullanmak | GAS→D1 yönüdür; D1-Primary'de veri kaynağı D1'dir, bu action D1'in üzerine yazar. **Yalnızca D1 verisi yok olduğunda acil kurtarma için** kullanılır — her kullanım öncesi son D1 yedeği alınmalı |

---

## 🔐 Güvenlik & Secret Yönetimi

**Secret akış özeti:** Browser (anahtar yok) → Worker (`API_KEY` enjekte eder) → GAS (doğrular).
`workers.dev` ve Preview URL'leri CF Dashboard'da **Inactive** — Worker yalnızca `portalapi.medicert.com.tr` üzerinden erişilebilir.
**Custom Domain:** `https://portalapi.medicert.com.tr`

### Cloudflare Workers Secrets

CF Dashboard → Workers → `portal-api` → Settings → Variables → **Secrets** bölümünden yönetilir.
`wrangler.toml`'a kesinlikle yazılmaz — `[vars]` dahil tüm plaintext alanları yasaktır.
`wrangler secret put <KEY>` veya Dashboard UI ile eklenir; `wrangler secret list` ile varlığı doğrulanır.

| Secret Key | `env.*` erişimi | Nerede kullanılır | Durum |
| :--- | :--- | :--- | :--- |
| `API_KEY` | `env.API_KEY` | `fetchFromGas` — her GAS isteğinin body'sine eklenir (GAS bu değeri karşılaştırır) | ✅ Tanımlı |
| `GAS_API_URL` | `env.GAS_API_URL` | `fetchFromGas` ve `fetchFromGasViaGet` — GAS web app URL'si | ✅ Tanımlı |
| `ADMIN_EMAILS` | `env.ADMIN_EMAILS` | Faz G1 — rol belirleme; admin email listesi (virgülle ayrılmış); Worker buradaki emaillerle CF header'ı karşılaştırır | 🔲 Faz G'de tanımlanacak |

> `GAS_API_URL` teknik olarak gizli değil ama Script Properties ile senkron tutmak için Dashboard Secret olarak yönetilir; `.dev.vars`'ta `localhost` için override edilebilir.

### GAS Script Properties

GAS Editor → Project Settings → **Script Properties** bölümünden yönetilir.
Kod içinde `PropertiesService.getScriptProperties().getProperty("KEY")` ile okunur.
GAS kaynak koduna asla yazılmaz — `getProperty` ile her zaman runtime'da çekilir.

| Property Key | Nerede kullanılır | Zorunlu mu |
| :--- | :--- | :--- |
| `API_KEY` | `bridge.gs` — gelen Worker isteklerini doğrular (CF `env.API_KEY` ile aynı değer) | ✅ Zorunlu |
| `WORKER_URL` | `SyncService`, `ManualSyncService`, `DailyBackupService` — Worker'a geri çağrı yapar | ✅ Zorunlu |
| `SPREADSHEET_ID` | `BaseService` — Sheets backup dosyasının ID'si | ✅ Zorunlu |
| `BACKUP_FOLDER_ID` | `DailyBackupService._saveSnapshotToDrive()` — SQL snapshot'ın kaydedileceği Drive klasörü | ✅ Zorunlu |
| `LAST_BACKUP_TS` | `SyncService.reconcileFromD1()` — delta sync için son backup timestamp'i | Opsiyonel (yoksa 0 varsayılır) |
| `LAST_UPDATE` | `bridge.gs syncCheck` action — GAS tarafı timestamp | Opsiyonel |
| `LOCAL_CONVERTER_TOKEN` | `PDFService` — yerel PDF converter | Opsiyonel |
| `ILOVEPDF_PUBLIC_KEY` | `PDFService` — iLovePDF API | Opsiyonel |

> **`API_KEY` çift taraflı:** CF Secret (`env.API_KEY`) ve GAS Script Property (`API_KEY`) değerleri **birebir aynı** olmalıdır. Birini değiştirirken diğerini de güncellemek zorunludur; uyuşmazlık tüm GAS çağrılarını `Yetkisiz Erişim` hatasıyla kırar.

### Dev Ortamı (.dev.vars)

`.dev.vars` — `wrangler dev` için yerel override. Git'e **kesinlikle commit edilmez** (`.gitignore`'da olmalı).
`wrangler.toml`'a yazılmaz; CF Dashboard'a eklenmez.

| `.dev.vars` Key | Amaç |
| :--- | :--- |
| `API_KEY` | Dev GAS ortamının API anahtarı (prod ile aynı olabilir) |
| `GAS_API_URL` | Dev GAS web app URL'si (prod ile aynı olabilir) |
| `DEV_USER_EMAIL` | CF Access header yokken rol bypass'ı — yalnızca Faz G sonrası gerekli |

---

## 🖥️ UI Standartları

**UI:** Astro 6.x + Pure Tailwind. `bg-surface` (opak), `border-border-main`. Glass/şeffaf yasak.
**CompanyPicker:** Tüm modüllerde standart; seçim sonrası bileşen gizlenir.
**Tarih formatı:** Sheets'e gönderilen tüm tarihler `dd.mm.yyyy`.
**Mobil:** Minimum dokunma hedefi 44×44px.

---

## ⏰ Cron Trigger

**Cloudflare schedule:** `0 4 * * SUN` — her Pazar 04:00 UTC'de `scheduled()` handler çalışır.

**Güncel davranış (düzeltildi ✅):** `scheduled()` → `SyncHandlers.triggerDailyBackup()` → GAS `runDailyBackup` action → `DailyBackupService.runDailyBackup()` → `SyncService.reconcileFromD1()` + `_saveSnapshotToDrive()`.
Bu **D1 → Sheets + Drive** yönüdür — D1-Primary mimarisinde doğru yön.

**Eski davranış (kaldırıldı):** `scheduled()` → `SyncHandlers.bulkSync()` → GAS → D1 (yanlış yön; `bulkSync` GAS'tan okuyup D1'e yazıyordu).

**bridge.gs değişikliği:** `runDailyBackup` action eklendi; `DailyBackupService.runDailyBackup()` çağırır.
**proxy.js değişikliği:** `triggerDailyBackup` SyncHandlers'a eklendi; hata durumunda `sync_log`'a FAIL/CRASH yazar. `scheduled()` artık `triggerDailyBackup` çağırıyor.

---

## 🗺️ Geliştirme Yol Haritası

### Bağımlılık Grafiği

```
A ──┐
    ├── C ── D ──┬── E ──┐
B ──┘            └── F   ├── G
                         │
                    D ───┘ (G1–G2 D sonrası başlayabilir)
```

**Okuma kuralları:**
- `A → C`: C (ortak bileşenler), A tamamlanmadan çıkarılamaz — ne genelleştirileceği belli olmaz.
- `C → D`: D (white-label), ortak bileşen sınırları netleşmeden tenant izolasyonu yapılamaz.
- `D → E` ve `D → F`: Her iki DLC de tenant config altyapısına (D1–D5) bağımlıdır.
- **E ve F paralel yürütülebilir** — D tamamlandıktan sonra bağımsız ilerleyebilirler.
- **A ve B paralel yürütülebilir** — birbirine bağımlılıkları yoktur.
- **G, D tamamlandıktan sonra G1–G2 ile başlayabilir**; G3–G6 için E9 (gözetim email) koordineli yürütülmeli ancak bloklayıcı değil.
- **B her zaman araya girebilir** — mevcut herhangi bir fazda kritik stabilite sorunu tespit edilirse B maddeleri öncelik alır.

---

### Faz A — Sertifika Listesi Tamamlama ✅
> **Çıktı:** `certificates/index.astro` legacy paritesine ulaşır; tüm filtre ve görsel uyarı özellikleri çalışır.
> **Başarı ölçütü:** A1–A6 maddeleri tamamlandığında bu sayfayı `tableCertificate.html`'e ihtiyaç kalmadan kullanmak mümkün olmalıdır.

| # | Madde | Done Criteria |
| :- | :--- | :--- |
| ✅ A1 | **Tarih aralığı filtresi** — tarih sütunu seçici (`sertifika_tarihi` / `gozetim_tarihi`) + başlangıç/bitiş `<input type="date">` | Seçili sütun + tarih aralığına göre `getFilteredData` filtreler; iki alan boşken filtre devre dışı |
| ✅ A2 | **Durum filtresi DOM fix** — `statusFilter` JS'de referans alınıyor ama HTML elementi yok (sessiz bug); Tümü / Aktif / Bekliyor `<select>` ekle | Element yokken konsol hatası kaybolur; dropdown seçimi `filters.status` değiştirir ve tabloyu yeniler |
| ✅ A3 | **Danışman filtresi** — yüklü sertifika datasından benzersiz `consultant` değerleri toplanır → `<select>` dropdown | Seçim yapıldığında yalnızca o danışmana ait sertifikalar listelenir; veri yüklenmeden önce dropdown boş/devre dışı |
| ✅ A4 | **Gecikme renk kodu** — **Kural:** `gozetim_tarihi` bugünden geçmişse → `border-l-2 border-rose-500` (kırmızı), 30 gün içindeyse → `border-l-2 border-amber-400` (sarı), normal → renk yok. Gecikmiş satırlar sıralamada öne çıkar (mevcut `getSortableTimestamp` üzerine bindirme) | Kırmızı/sarı/varsayılan satırlar doğru renk alır; gecikmiş satırlar tablonun başında görünür |
| ✅ A5 | **Detay satırında Düzenle butonu** — mevcut detay row'una `/certificates/add?edit={id}` linki | Butona tıklandığında doğru ID ile edit sayfası açılır; ID yoksa buton gizlenir |
| ✅ A6 | **Yazdır butonu** — `window.print()` + `@media print` CSS: sayfalama gizle, tablo tam genişlik, arka plan renklerini koru | Yazdır/PDF kaydet işleminde tablo okunabilir çıktı verir; filtre paneli ve butonlar baskıda görünmez |

---

### Faz B — Stabilite, Zayıflık Tespiti ve Kota Optimizasyonu ✅
> **Çıktı:** Sistemin güvenlik açıkları, kota riskleri ve hata yönetimi eksiklikleri raporlanır ve kritik olanlar giderilir.
> **Başarı ölçütü:** B1 raporu teslim edilmiş; B5 tamamlanmış; B6 proxy.js'de aktif. Geri kalan maddeler B1 raporundan öncelik sırası alır.

| # | Madde | Done Criteria |
| :- | :--- | :--- |
| ✅ B1 | **Zayıflık raporu** — `proxy.js` action'larında hata yönetimi eksikleri, edge case'ler, timeout riskleri; mevcut `sync_log` FAIL/CRASH kayıtları analiz edilir | Bulgular öncelik sırasıyla belgelenmiş ve her bulgu için "kritik / orta / düşük" etiketi atanmış |
| ✅ B2 | **D1 yazma kotası koruması** — batch write'larda tek seferde yazılabilecek max satır sınırı; UI'da çift onay mekanizması. ⚠️ **Tartışma başlangıcı:** max eşik değeri (öneri: 500 satır/istek) D1 batch limit testiyle belirlenir; hard rule değil | Eşik aşıldığında Worker 400 döner; UI kullanıcıyı uyarır ve devam onayı ister |
| ✅ B3 | **D1 okuma kotası koruması** — `stale-while-revalidate` pattern; **davranış:** (a) store/IndexedDB'de veri varsa → önce oradan render, arka planda D1 fetch; (b) cache boşsa (ilk ziyaret veya temizlenmiş) → D1'den fetch, ardından render. Her iki durumda da D1 fetch sonucu store'u günceller | Cache doluyken açılışta anında render görülür; cache boşken yükleme spinner gösterilir; yenileme aralığı: 5 dakika veya kullanıcı tetiklemesi |
| ✅ B4 | **`getSyncLog` Worker action + sync_log izleme UI** — `sync_log` tablosu şu an yalnızca yazılıyor; hiçbir yerde okunmuyor. Önce `proxy.js`'e `getSyncLog` action'ı eklenir (son N kayıt, opsiyonel status filtresi); ardından `settings.astro`'ya panel eklenir | `getSyncLog` action son 20 kaydı döner; FAIL/CRASH kayıtları UI'da kırmızı gösterilir; "Manuel Sync" butonu bu panelin yanında konumlandırılmış |
| ✅ B5 | **API_KEY güvenliği** — CF Dashboard Workers Secrets'ta şifreli kayıt mevcut; `wrangler.toml`'da düz metin yok | `wrangler.toml`'da `API_KEY` satırı yok; CF Dashboard → Settings → Variables → Secrets'ta doğrulanmış |
| ✅ B6 | **Worker timeout koruması** — `fetchFromGas` çağrılarına `AbortController` + 10 saniye timeout. ⚠️ **Kural:** 10s eşiği sabit; GAS'ın yavaş çalıştığı durumda retry yapılmaz, `sync_log`'a CRASH yazılır | Timeout tetiklendiğinde Worker 504 yerine JSON `{ success: false, error: "GAS_TIMEOUT" }` döner |
| ✅ B7 | **Export backup rate-limit** — `exportBackup` action'ı için günlük limit. ⚠️ **Tartışma başlangıcı:** limit değeri (öneri: günde 3 istek) belirlenir. **Faz D öncesi:** KV key `ratelimit:exportBackup:{ip}:{tarih}` (IP bazlı). **Faz D sonrası (multi-tenant):** key `ratelimit:exportBackup:{tenant_id}:{ip}:{tarih}` olarak güncellenir — kurumsal NAT arkasındaki birden fazla kullanıcının birbirini bloklaması önlenir | Limit aşıldığında Worker 429 döner; key formatı Faz D ile değişir, implementasyon buna hazır olmalı |
| ✅ B8 | **Sync Recovery — başarısız backup retry** — `sync_log` FAIL/CRASH kayıtları şu an birikip kalıyor; recovery yolu yok. `settings.astro`'daki B4 paneline "Başarısız Sync'leri Yeniden Dene" butonu eklenir; Worker seçili `sync_log` kayıtlarını `syncToBackup`'a iletir | Buton tıklandığında seçili FAIL kayıtları sırayla retry edilir; başarılı olanlar `sync_log`'da güncellenir (yeni `status = 'RECOVERED'` değeri) |
| ✅ B10 | **Legacy GAS denetimi ve temizleme** — `src/gas/legacy/server/` altındaki 6 dosyanın tamamı ölü koddur; aktif `api/` servislerinden çağrılan fonksiyon yoktur. Ancak iki dosya plaintext token içermektedir: `otorobot.gs` → hardcoded CloudConvert JWT bearer token; `iLovePDF.gs` → `LOCAL_CONVERTER_TOKEN` ve `ILOVEPDF_PUBLIC_KEY` (PDFService bunları doğru biçimde Script Properties'ten okusa da bu değerler GAS runtime'ında global variable olarak bulunmaya devam eder). Diğer riskler: `serverSideFuncs.gs` → hardcoded `SPREADSHEET_ID`; `load.gs` → hardcoded email listesi ve 3 Calendar ID. **Yapılacaklar:** (1) `otorobot.gs`'deki CloudConvert token iptal edilir; (2) tüm 6 dosya silinir; (3) `DriveService.gs`'deki `ilkKarekter` yorum satırı temizlenir | `src/gas/legacy/` dizini yok; `otorobot.gs` tokenı iptal edilmiş; PDFService Script Properties'ten okumaya devam ediyor (hardcoded fallback yok) |
| ✅ B9 | **Optimistic Locking — eşzamanlı yazma koruması** — şu an iki admin aynı kaydı aynı anda düzenlerse son yazan kazanır, önceki değişiklik sessizce kaybolur. Her write action'a `expected_updated_at` parametresi eklenir; Worker D1'deki `updated_at` ile karşılaştırır; uyuşmazsa 409 döner. **Etkilenen formlar (hepsi düzenleme modunda `updated_at` alıp submit'e eklemek zorunda):** `certificates/add.astro` (edit modu), `company/edit.astro`, `company/form.astro`, `audits/add.astro` (edit modu), `tests/add.astro` (edit modu), `company/proforma.astro`. Yeni kayıt oluşturma formları (`?edit` parametresi olmayan akış) bu kapsamın dışındadır. | Write isteğinde `expected_updated_at` gönderilmezse istek geçer (geriye dönük uyumluluk); gönderilir ve uyuşmazsa 409 + "Kayıt başkası tarafından değiştirildi" hatası döner; UI'da çakışma uyarısı gösterilir |

---

### Faz C — Ortak Bileşenler ve Astro/Tailwind Derinleştirme ✅
> **Çıktı:** Liste sayfaları arasındaki tekrar eden kod bileşenlere taşınmış; Tailwind tutarlılığı sağlanmış.
> **Başarı ölçütü:** `certificates`, `audits`, `tests`, `company` liste sayfaları `DataTable.astro` kullanıyor; her sayfanın satır içi `registerCleanup/runCleanups/astro:page-load` bloğu `useCleanup.ts`'e taşınmış.

| # | Madde | Done Criteria |
| :- | :--- | :--- |
| ✅ C1 | **`DataTable.astro` bileşeni** — tablo iskelet, sayfalama, yükleme/boş durum, bulk-actions; slot tabanlı (thead ve tbody row'u dışarıdan verilir) | `certificates/index.astro`, `audits/index.astro`, `tests/index.astro` bu bileşeni kullanıyor; ortak tablo iskeleti sayfa içine gömülü değil |
| ✅ C2 | **`FilterBar.astro` bileşeni** — arama input, dropdown filtreler, tarih aralığı; prop ile hangi filtrelerin görüneceği belirlenir | Sertifika filtre paneli bu bileşene taşınmış; audits ve tests liste ekranları da aynı bileşeni kullanıyor |
| ✅ C3 | **`PageShell.astro` birleştirme** — mevcut `OperationPageShell.astro` ile birleştirilir veya genişletilir; başlık + aksiyon butonları standart prop'larla yapılandırılır | `OperationPageShell.astro` ve `PageShell.astro` tek bileşen; eski bileşen silinmiş |
| ✅ C4 | **`useCleanup.ts` composable'ı** — `registerCleanup / runCleanups` + `astro:page-load` / `astro:before-preparation` listener kurma tek fonksiyona çekilir | Liste ekranlarında cleanup pattern `useCleanup.ts` üzerinden yönetiliyor; `initPage` bağlama işi `initPageCleanup` ile standartlaştırılmış |
| ✅ C5 | **`useTableFilter.ts` composable'ı** — `getFilteredData`, `setTableState`, `renderTable` döngüsü; sayfa kendi filtre mantığını `FilterFn` callback olarak geçer | Sertifika, denetim ve test liste ekranları filtreleme/sayfalamayı bu composable üzerinden yürütüyor; duplicate sayfalama akışı kaldırılmış |
| ◐ C6 | **Astro Content Collections** — standartlar, EA kodları, NACE kodları `src/content/` altına taşınır; Zod şeması ile type-safe | `src/content/` altında type-safe referans koleksiyonları kuruldu; standart fallback akışı bunları kullanıyor. Tüm sabit liste erişimlerinin content query'ye taşınması sonraki adım olarak kalır |
| ✅ C7 | **Tailwind `@layer components`** — `btn-primary`, `card-surface`, `badge-status` gibi sık tekrarlanan utility grupları tanımlanır | Proje genelinde aynı utility kombinasyonu birden fazla yerde tekrar etmiyor |

---

### Faz D — White-Label Çekirdek / Tenant Ayrımı ⬜
> **Çıktı:** Proje çekirdeği Medicert'e özgü hiçbir değer içermez; yeni tenant için yalnızca env + tenant dizini yeterlidir.
> **Başarı ölçütü:** `src/lib/config.ts` ve tüm `src/` altında `"Medicert"`, `"medicert.com.tr"`, `"Serdar"` string'leri kalmamış; `src/tenant/default/` kopyalanarak yeni tenant deploy edilebilir.

#### Tenant Çözümleme Akışı

```
Build-time                       Runtime (Worker)
──────────────────────────────   ──────────────────────────
TENANT_ID env var                TENANT_ID env var
    ↓                                ↓
Vite alias:                      wrangler.<tenant>.toml
  @tenant → src/tenant/${TENANT_ID}/   → DB_D1, KV, GAS_API_URL
    ↓                                ↓
src/tenant/medicert/config.ts    Worker context.env.*
(veya default/)
    ↓
Core: import config from '@tenant/config'
(doğrudan src/tenant/* import etmez)
```

**Kural:** Çekirdek her zaman `@tenant/config` path alias'ını kullanır. Tenant klasörünü (`src/tenant/medicert/`) doğrudan import eden satır çekirdekte olamaz — bu CI lint kuralıyla zorunlu kılınır.

| # | Madde | Done Criteria |
| :- | :--- | :--- |
| D1 | **`src/lib/config.ts` tenant katmanı** — `APP_NAME`, `WORKER_URL`, `BRAND_*` değerleri `PUBLIC_BRAND_*` env'e çıkarılır | `config.ts`'de hardcoded Medicert/URL string'i yok; her değer `import.meta.env.*` okur |
| D2 | **`src/tenant/medicert/`** dizini — logo, imza, disclaimer, renk paleti, email sabitleri buraya taşınır | `src/tenant/medicert/config.ts` tek export noktası; başka dosya çekirdekte Medicert string'i içermiyor |
| D3 | **`src/tenant/default/`** dizini — placeholder değerler; `TENANT_ID=default` ile deploy edilebilir, hata vermez | `default/config.ts` tüm zorunlu key'leri boş string veya fallback ile doldurmuş |
| D4 | **Email template Worker'a taşınır** — `sendSurv.html` şu an GAS tarafında duruyor; her yeni tenant için GAS kodu değişikliği gerektirir. Template `src/tenant/{id}/email/surv.html` konumuna taşınır; Worker `BRAND_*` değişkenlerini inject ederek HTML render eder ve GAS'a "hazır HTML" olarak gönderir. GAS yalnızca `UrlFetchApp` ile email gönderir, template'i bilmez | GAS'ta template string'i yok; Worker'dan gelen hazır HTML doğrudan gönderilir; yeni tenant için yalnızca tenant dizinindeki template değişir, GAS kodu dokunulmaz |
| D5 | **`wrangler.<tenant>.toml` şablonu** — tek Worker kodu, farklı binding'ler; `wrangler.medicert.toml` mevcut `wrangler.toml`'dan ayrıştırılır | `wrangler.toml` jenerik iskelet; Medicert değerleri `wrangler.medicert.toml`'da |
| D6 | **Tenant onboarding checklist** — env ayarla, tenant dizini oluştur, D1 migration çalıştır, GAS Script Properties doldur | Checklist bir markdown dosyası olarak `docs/onboarding.md`'de; adım adım doğrulanabilir |

> **GAS tenant özelleştirme kuralı:** Her tenant kendi bağımsız GAS projesini oluşturur. `DocumentService.gs CONFIG` (şablon dosya ID'leri: `SIGNATURE_ID`, `DRAFT_BG_ID`, `CONTRACT_TEMP` vb.) ve `DriveService.gs FOLDER_MAP` (harf → klasör ID haritası) **GAS kodu içinde hardcoded kalır** — bu değerler o tenanta ait Drive yapısını yansıtır ve Script Properties'e taşınmaz. Taşınması gereken tek operasyonel değer `PDFService.gs`'deki `LOCAL_URL` (`https://pdf.serdar.cc/convert`) gibi sunucu adresleridir; bu tür URL'ler Script Properties'e alınır veya tenant config'e girer. Kural: Drive dosya/klasör ID'si → hardcoded; sunucu URL'si veya API anahtarı → Script Properties.

---

### Faz E — Google DLC ⬜
> **Çıktı:** Google servisleri `settings.astro`'dan aç/kapat yönetilebilir; Gemini destekli form önerileri aktif; aylık gözetim email'i çalışır.
> **Başarı ölçütü:** Google DLC kapalıyken sistem tamamen D1-only modunda çalışır, hata vermez. GAS bağlı ama kapalı → `syncToBackup` no-op.

#### Feature Flag Kapsamı

```
Feature flag'ler: sync_meta tablosuna yazılır (key: "feature:google_dlc", "feature:google_calendar" vb.)
Kapsam: DEPLOYMENT bazlı — her tenant ayrı D1 veritabanına sahip (D5).
Sonuç: sync_meta içindeki flag otomatik olarak tenant-özel olur; ayrı tenant-ID lookup gerekmez.
Birden fazla tenant aynı D1'i paylaşmaz — bu mimari D5 ile güvence altına alınmış.
```

**Kural:** Feature flag'ler `sync_meta` tablosuna yazılır, Worker env'e değil — böylece admin `settings.astro`'dan runtime'da değiştirebilir; deploy gerektirmez.

| # | Madde | Done Criteria |
| :- | :--- | :--- |
| E1 | **Google DLC feature flag** — `sync_meta`'ya `feature:google_dlc = "1"\|"0"` key'i eklenir. **Not:** Bu key şu an `sync_meta`'da mevcut değil; DLC ilk kez etkinleştirildiğinde `settings.astro` toggle'ı `INSERT OR REPLACE` ile yazar. Yokken Worker `"0"` varsayar (GAS çağrısı yapılmaz) | Flag `"0"` veya yokken Worker hiçbir GAS isteği göndermez; `settings.astro`'da toggle "Kapalı" gösterilir |
| E2 | **`settings.astro` Google paneli** — DLC toggle + GAS URL ping testi + son backup zamanı + sync_log FAIL sayısı | Toggle değiştirildiğinde `sync_meta` güncellenir; sayfa yenilemeye gerek kalmaz |
| E3 | **Graceful degradation** — `syncToBackup` flag `"0"` ise no-op döner; Calendar side-effect'ler skip edilir | Google DLC kapalıyken CRUD işlemleri hata vermeden tamamlanır; sync_log'a kayıt yazılmaz |
| E4 | **Drive backup sub-toggle** — `feature:google_drive_backup`; Sheets backup açık iken Drive snapshot kapatılabilir | Sub-toggle kapalıyken `DailyBackupService._saveSnapshotToDrive()` çağrılmaz |
| E5 | **Calendar sub-toggle** — `feature:google_calendar`; DLC açık olsa da Calendar event oluşturma devre dışı bırakılabilir | Sub-toggle kapalıyken `scheduleAudit` Calendar çağrısı skip eder, D1 yazma tamamlanır |
| E6 | **Gmail / Notification sub-toggle** — `feature:google_gmail`; E9 mail gönderimi bu flag'e bağlı | Sub-toggle kapalıyken E9 trigger'ı çalışmaz; `settings.astro`'da uyarı gösterilir |
| E7 | **GAS Gemini entegrasyonu** — `GeminiService.gs`; `certificates/add.astro` sertifika formuna "NACE Öner" ve "EA Öner" butonları eklenir; firma `yapilan_is` + `standart` alanından prompt oluşturulur | Buton tıklandığında GAS → Gemini API → öneri JSON döner; form alanlarına yazar; kullanıcı düzenleyebilir |
| E8 | **Gemini kapsam önerisi** — `certificates/add.astro` formunda `kapsam` (TR) ve `scope` (EN) alanları için Gemini önerisi; düzenlenebilir preview modal | "Kapsam Öner" butonu; öneri modal'da gösterilir; "Uygula" ile forma yazılır |
| E9 | **Gözetim email sistemi** — aylık GAS time trigger (her ayın 1'i 09:00); danışman bazlı `certificates WHERE gozetim_tarihi BETWEEN ay_baslangic AND ay_bitis` sorgusu; `sendSurv.html` tenant config ile parametrize; `settings.astro`'dan manuel tetikleme | Manuel tetiklemede test email gönderilir; otomatik trigger'da her aktif danışmana email düşer; gönderim `sync_log`'a kaydedilir |

---

### Faz F — Microsoft DLC ⬜
> **Çıktı:** Microsoft altyapılı tenantlar Google DLC yerine veya yanı sıra OneDrive/Outlook/Teams kullanabilir.
> **Başarı ölçütü:** `feature:microsoft_dlc = "1"` ile OneDrive'a günlük backup gönderilir; Outlook üzerinden gözetim email'i gönderilebilir.

**Not:** F, E ile paralel yürütülebilir. İkisi de D tamamlandıktan sonra bağımsız geliştirilir. Feature flag kapsamı E ile aynı: `sync_meta` içinde, deployment bazlı.

| # | Madde | Done Criteria |
| :- | :--- | :--- |
| F1 | **Microsoft DLC feature flag** — `feature:microsoft_dlc`; Google DLC ile aynı anda `"1"` olabilir; sub-service'ler ayrı flag alır | Her iki flag aynı anda açıkken sistem hem Google hem Microsoft servislerini çalıştırır |
| F2 | **`settings.astro` Microsoft paneli** — DLC toggle + Azure app credentials alanı + Graph API ping testi | Credentials kaydedildiğinde ping testi geçer; başarısız ping'de toggle aktive edilemez |
| F3 | **OneDrive backup** — Worker → `src/lib/msGraph.ts` → Graph API → OneDrive `.sql` snapshot; `DailyBackupService` adaptör: Google DLC açıksa Drive'a, Microsoft DLC açıksa OneDrive'a, ikisi de açıksa her ikisine yazar | Her iki DLC aynı anda açıkken backup iki hedefe gönderilir; biri başarısız olursa diğeri devam eder |
| F4 | **SharePoint list sync** — `feature:microsoft_sharepoint` sub-toggle; D1 delta → SharePoint liste upsert | Sub-toggle kapalıyken SharePoint çağrısı yapılmaz; açıkken günlük sync gerçekleşir |
| F5 | **Outlook gözetim email** — E9'un Outlook karşılığı; `feature:microsoft_outlook` sub-toggle; aynı `sendSurv.html` template kullanılır; Graph API `/sendMail` endpoint | E9 (`feature:google_gmail`) açıkken Outlook sub-toggle'ı da açılabilir; her ikisi de gönderilebilir veya sadece biri |
| F6 | **Teams webhook bildirimi** — `feature:microsoft_teams`; CRUD başarı/hata bildirimleri Teams kanalına; özellikle `sync_log` FAIL → Teams alert | Webhook URL `sync_meta`'ya kaydedilir; FAIL kaydında Worker `ctx.waitUntil` içinde Teams'e POST gönderir |
| F7 | **Birleşik DLC settings paneli** — her servis için kaynak seçimi: backup için `Google Drive \| OneDrive \| İkisi`, email için `Gmail \| Outlook \| İkisi` | Kullanıcı servis bazında tercih yapar; tercih `sync_meta`'ya kaydedilir; sayfada çakışma uyarıları gösterilir |

---

### Faz G — Danışman Portalı ⬜
> **Çıktı:** Danışmanlar portala girer; yalnızca kendi firmalarının sertifika ve test durumunu görür; CRUD yapamaz.
> **Başarı ölçütü:** Danışman emailiyle giriş yapıldığında admin butonları (Ekle, Düzenle, Sil, Toplu Güncelle) hiçbir sayfada render edilmez; başka danışmanın firmaları hiçbir sorguda dönmez.

#### İki Katmanlı Auth Mimarisi

```
Katman 1 — Cloudflare Access (zaten çalışıyor, biz yönetmiyoruz):
  ┌─────────────────────────────────────────────────────────┐
  │  Email allowlist kontrolü                               │
  │  Listede var  → isteği geçir + header enjekte et        │
  │  Listede yok  → 403, portal görünmez                    │
  │                                                         │
  │  Enjekte edilen header:                                 │
  │    CF-Access-Authenticated-User-Email: user@example.com │
  │  Gmail login ise ek claim: ad, soyad, profil resmi      │
  │  CF-native login: yalnızca email                        │
  └─────────────────────────────────────────────────────────┘
                          ↓ geçti

Katman 2 — Rol belirleme (bizim yapacağımız):
  Worker reads CF-Access-Authenticated-User-Email header
    → email, ADMIN_EMAILS env var'ında mı?  → role = "admin"
    → email, D1 consultants.email'de mi?    → role = "consultant"
    → hiçbiri                               → 403 (CF Access yanlış yapılandırılmış)

  role + consultant_id bilgisi her API yanıtına eklenir
  veya /whoami endpoint'inden çekilir
```

**Kural:** Biz JWT üretmeyiz, CF JWT'yi doğrulamayız — `CF-Access-Authenticated-User-Email` header'ına güveniriz. Bu güven yalnızca Worker origin'in CF Access arkasında kalmasına bağlıdır (Worker URL'si public internetten doğrudan erişilebilir olmamalı; CF Access bypass olursa header spoof edilebilir). Worker env'de `ADMIN_EMAILS` listesi; danışman emailler D1'de.

**Dev ortamı kuralı:** `wrangler dev` veya yerel Astro geliştirmesinde CF Access header'ı enjekte edilmez. Worker, `DEV_USER_EMAIL` env var'ı tanımlıysa bunu CF header yerine kullanır. `DEV_USER_EMAIL` üç kural:
1. Yalnızca `.dev.vars` dosyasında tanımlanır — production ortamına sızmaz.
2. `wrangler.toml`'a **kesinlikle** yazılmaz — git geçmişine düşer, production deploy'a taşınabilir.
3. `.dev.vars` dosyası `.gitignore`'a eklenmiş olmalıdır — commit edilmez.
`DEV_USER_EMAIL` boşken header da yoksa → 403 (production davranışı korunur).

#### Danışman Veri Modeli (Migration 009)

```sql
-- consultants tablosuna eklenen sütunlar:
ALTER TABLE consultants ADD COLUMN email TEXT UNIQUE;
-- login kimliği; CF Access'teki email ile eşleşir

ALTER TABLE consultants ADD COLUMN cf_access_confirmed INTEGER DEFAULT 0;
-- 0 = D1'e kayıtlı ama CF Access allowlist'e henüz eklenmemiş (pasif)
-- 1 = her iki adım tamamlandı (aktif); Worker yalnızca bu danışmanlara izin verir

-- Yeni junction tablosu:
CREATE TABLE IF NOT EXISTS consultant_firms (
  consultant_id INTEGER NOT NULL REFERENCES consultants(id),
  firma_no      INTEGER NOT NULL REFERENCES companies(id),
  PRIMARY KEY (consultant_id, firma_no)
);
```

**"Aktif danışman" tanımı:** `consultants.cf_access_confirmed = 1` olan kayıtlar. Worker, rol belirleme sırasında `SELECT id FROM consultants WHERE email = ? AND cf_access_confirmed = 1` sorgusunu çalıştırır. Kayıt varsa `role=consultant`; yoksa (0 veya NULL) `role=unknown` → 403. Böylece D1'e kaydedilmiş ama CF Access'e henüz eklenmemiş bir danışman portal erişimi alamaz.

**Kural:** Danışman erişimi `certificates.consultant` TEXT alanıyla eşleştirme ile yapılmaz — isim değişirse erişim bozulur. `consultant_firms` junction tablosu tek doğru yöntemdir.

#### Sayfa Yönlendirme Akışı

```
Kullanıcı portala girer (CF Access geçti)
  ↓
/whoami → Worker: CF header'dan email oku → D1/env'den role belirle
  ↓
role = "admin"      → mevcut dashboard (değişiklik yok)
role = "consultant" → /consultant/ sayfasına yönlendir
role = "unknown"    → 403 sayfası (CF Access allowlist hatalı)
```

#### Danışman Onboarding (UUID token yok)

Admin bir danışman eklemek istediğinde iki adım yapar — ikisi de `settings.astro`'dan:

```
Adım 1 — D1'e kaydet:
  consultants tablosuna email + ad + firma listesi yaz
  (consultant_firms junction'ı doldur)

Adım 2 — CF Access'e ekle (manuel, Cloudflare Dashboard):
  CF Access policy → Email allowlist → danışman emailini ekle
  (Bu adım otomatikleştirilemez; CF API ile yapılabilir ama Faz G kapsamı dışı)

settings.astro bu iki adımı yan yana gösterir:
  [ ] D1'e kaydedildi  ✓ (otomatik)
  [ ] CF Access'e eklendi  (admin onay checkbox'u)
```

| # | Madde | Done Criteria |
| :- | :--- | :--- |
| G1 | **Rol belirleme + write guard — Worker middleware** — `CF-Access-Authenticated-User-Email` header'ı okunur; `ADMIN_EMAILS` env var ile admin kontrolü; `consultants.email` D1 sorgusuyla consultant kontrolü. **Write guard:** `addCompany`, `updateCertificate`, `deleteAudit` vb. tüm write action'lar role kontrolünden geçer; `role=consultant` ise 403 döner — sadece SELECT action'ları izin verilir | Header yok **ve** `DEV_USER_EMAIL` da yoksa → 403; `DEV_USER_EMAIL` varsa header yerine kullanılır (dev only); consultant rolüyle write action'a istek → 403 `{ error: "WRITE_FORBIDDEN" }`; admin email → tüm action'lar serbest |
| G2 | **Migration 009** — `consultants.email UNIQUE` sütunu + `consultants.cf_access_confirmed INTEGER DEFAULT 0` sütunu + `consultant_firms` junction tablosu | `wrangler d1 migrations apply` uygulanmış; mevcut `consultants` satırları `email=NULL, cf_access_confirmed=0` ile bozulmadan korunmuş; üç değişikliğin tamamı tek migration dosyasında |
| G3 | **`/consultant/index.astro`** — `/whoami` role=consultant ise erişilebilir; role=admin ise dashboard'a yönlendir; kendi firmalarının sertifika + test özet kartları | Doğrudan URL yazılarak da erişim rol kontrolünden geçer; admin bu sayfayı göremez |
| G4 | **Danışman sertifika listesi** — Worker erişim kontrolünü subquery ile uygular. **Gerçek sorgu deseni** (pseudo-SQL değil): `SELECT * FROM certificates WHERE firma_no IN (SELECT firma_no FROM consultant_firms WHERE consultant_id = ?)` — tek `?` ile çalışır, placeholder expansion gerekmez | Subquery boş set dönerse sertifika listesi boş döner (403 değil); `consultant = ad` TEXT filtresi kullanılmıyor |
| G5 | **Admin onboarding UI** — `settings.astro`'da danışman ekle formu; D1'e yazar (`cf_access_confirmed=0`); CF Access adımı için kopyalanabilir email gösterir; admin CF Access'e ekledikten sonra "Onayla" butonuna basar → D1'de `cf_access_confirmed=1` olur. **Not:** Worker Cloudflare allowlist'i doğrulamaz; `cf_access_confirmed=1` operasyonel bir admin onayıdır, sistem doğrulaması değildir — CF Access'e eklenmeden "Onayla" basılırsa danışman D1'de aktif ama giriş yapamaz | D1 kaydı sonrası danışman "Pasif" görünür; "Onayla" sonrası "Aktif" olur; Worker `cf_access_confirmed=0` olanı reddeder |
| G6 | **Admin firma atama UI** — `consultant_firms` yönetimi; firma ekleme/çıkarma; danışman başına atanmış firma sayısı göstergesi | Değişiklikler anında D1'e yansır; danışman portalı bir sonraki requestte güncel listeyi görür |
| G7 | **Mevcut sayfalarda rol bazlı UI gizleme** — G1 backend'de 403 döner ama butonlar hâlâ render edilir; frontend da `/whoami` rolüne göre yönetilmeli. **Etkilenen sayfalar ve gizlenecek öğeler:** `certificates/index.astro` → Ekle, Düzenle, Sil, Toplu Güncelle butonları; `audits/index.astro` → Ekle, Düzenle butonları; `tests/index.astro` → Ekle, Düzenle, Sil butonları; `company/index.astro` → Ekle butonu, şirket düzenleme linkleri. **Danışmana tamamen kapalı sayfalar** (yönlendirme): `company/add.astro`, `company/edit.astro`, `company/form.astro`, `company/proforma.astro`, `company/contract.astro`, `documents/add.astro` — role=consultant ile bu URL'lere gidilirse `/consultant/` sayfasına yönlendirilir. | `certificates/index.astro` danışman rolüyle açıldığında hiçbir yazar butonu DOM'da yok; `company/add.astro`'ya giden danışman `/consultant/`'a yönlendirilmiş; rol kontrolü `/whoami` çağrısından alınan token/state ile yapılır, her sayfa ayrı API çağrısı yapmaz |

---

### Öncelik ve Bağımlılık Özeti

| Öncelik | Faz | Kapsam | Bloklayan bağımlılık | Paralel yürütülebilir |
| :---: | :--- | :--- | :--- | :--- |
| 1 | **A** | Sertifika listesi tamamlama | — | B ile |
| 1 | **B** | Stabilite + zayıflık + kota | — | A ile |
| 2 | **C** | Ortak bileşenler | A tamamlanmış | — |
| 3 | **D** | White-label / tenant ayrımı | C tamamlanmış | — |
| 4 | **E** | Google DLC | D tamamlanmış | F ile |
| 4 | **F** | Microsoft DLC | D tamamlanmış | E ile |
| 5 | **G** | Danışman portalı | D tamamlanmış (G1–G2); E9 koordineli ama bloklayıcı değil | — |

**B istisnası:** B kritik bir sorun tespit edildiğinde diğer fazların herhangi bir noktasında öncelik alabilir. Bu bir "her zaman araya girebilir" kuralı, yoksa sıradaki faz değil.
