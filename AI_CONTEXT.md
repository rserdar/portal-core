# 🤖 Project Intelligence & Context (AI_CONTEXT.md v5.8.5)

> [!IMPORTANT]
> **Granular KV Architecture (v5.7.1):** Bu proje hem okuma hem yazma için **Cloudflare KV**'yi birincil veri tabanı olarak kullanır. Cloudflare Worker (`src/workers/proxy.js`) tüm veri operasyonlarını yönetir.
> - **KV Binding:** `env.DB` (linked to Namespace ID: `8eb0dc6ffe2947729b29f0db1c84fd52`).
> - **Strategy:** KV-primary for ALL operational reads AND writes. Google Sheets is backup / restore ONLY — operational database değildir.
> - **Google Native Exception:** Docs, Drive, Calendar, Gmail operasyonları GAS üzerinden çalışır (KV bypass). Bu servisler hiçbir zaman KV'ye taşınamaz.
> - **Bulk Hydration:** "SİSTEMİ SENKRONİZE ET" butonu GAS → KV → IndexedDB tam hydration'ı tetikler. Deploy sonrası **bir kez** çalıştırılması zorunludur.
> - **Performance Manifesto:** `bulkSync` / `importBackup` dışındaki hiçbir write path full dataset rebuild yapamaz. Günlük write operasyonları yalnızca etkilenen KV key'lerini incremental günceller.
> - **Granular Key Rule:** Firma verisi `cache:company:{id}` + `cache:index:companies:search`, sertifika verisi `cache:getCertificateById:{stableKey}` + `cache:getCertificatesByFirmaId:{stableKey}` + `cache:index:certificates:recent` üzerinden yönetilir. Monolitik `cache:index:companiesById`, `cache:index:certificateById`, `cache:index:certificatesByFirmaId` key'leri **kaldırılmıştır** — bu isimleri kullanan hiçbir kod yazılmamalıdır.
> - **Refactor Status:** Tüm operasyonel entity'ler (company, certificate, test, audit, proforma, standard, consultant, auditor, sysdoc, testdoc) granüler KV mimarisine geçirilmiştir. `saveProformaState`, `saveAuditState`, `loadXIndexes`, `saveXIndexes`, `buildXsByFirmaId`, `buildXsById` ve türev monolitik helper'lar temizlenmiştir. Detaylar için bkz. **📖 Granüler KV Entity Mimarisi El Kitabı**.
> - **New Hard Rule:** Doküman üretimi için gereken operasyonel payload'lar Google Sheets'ten okunamaz; Worker bunları KV indexlerinden kurar ve GAS'e hazır veri gönderir.
> - **Operational Status:** `buildCertPayload` ve `buildTestPayload` operasyonel path'te Worker/KV tarafından üretilir; GAS tarafındaki sheet-backed helper'lar yalnızca legacy/fallback referansıdır.

> [!CAUTION]
> **Mimari Karar — KV-First (v5.3.0):** Hem mevcut hem de henüz migration yapılmamış TÜM fonksiyonlar için geliştirme stratejisi aşağıdaki kurallara göre yapılmalıdır. Bunun tek istisnası Google'ın native servislerini (Docs, Drive, Calendar, Gmail) doğrudan kullanan operasyonlardır — bunlar GAS'tan hiçbir zaman çıkarılamaz.

> [!CAUTION]
> **Saf Tailwind Mimarisi (v5.1.0):** Proje genelinde tüm "glass" (şeffaf) efektler ve özel CSS sınıfları (`glass`, `form-input`) kaldırılmıştır. Tüm UI artık **Saf Tailwind (Pure Tailwind)** utility sınıfları ve opak arka planlar (`bg-surface`) ile yönetilmektedir.

---

## 🏗️ Core Architecture & Data Strategy

### 1. Database & Persistence Layer
- **Primary Database:** **Cloudflare KV** — hem okuma hem yazma için tek ve birincil veri deposu.
- **Backup / Recovery Store:** **Google Sheets** — yalnızca manuel backup ve restore kaynağı. Otomatik write-back yoktur, hiçbir zaman olmayacaktır.
- **Write Kuralı:** Google'ın native servislerine (Calendar, Docs, Drive, Gmail) bağımlı olmayan **TÜM yazma operasyonları doğrudan KV'ye yazılır**. Sheets'e otomatik yazma yapılmaz.
- **Google Native Side Effects:** `scheduleAudit`, `updateSurveillance` gibi Calendar bağımlı operasyonlarda **veri yine KV'ye yazılır**; Calendar event / Drive dosya oluşturma için ek GAS çağrısı yapılır. GAS burada yalnızca side-effect engine'i olarak kullanılır, authoritative data store değil.
- **Backend Engine:** **Modular Google Apps Script** (GAS) in `src/gas/api/`.
- **Migration In Progress:** Legacy GAS files are preserved in `src/gas/legacy/` as migration reference. Original paths (`src/gas/server/`, `src/gas/client/`) have been removed to avoid confusion.
- **Client Cache:** **IndexedDB** (`medicert-portal-db`) + **Nanostores**.
- **Sync Strategy (v5.4):**
  1. `KV_PRIMARY_MISS` contract: Cacheable read miss durumunda worker `503 + needsHydration=true` döner.
  2. `bulkSync`: Manual/Full hydration for KV and local IndexedDB. Handles 1600+ companies and 5000+ certificates in minutes.
  3. `Zero-Latency Render`: UI local IndexedDB'den açılır, ardından KV tazelemesi arka planda yapılır.
  4. `SyncManager.checkAndSync`: KV miss algılarsa otomatik `bulkSync` çalıştırıp tekrar dener.

### 1.1 Backup & Restore (Bidirectional)
- **Export:** `exportBackup` action'ı `SyncService.exportBackup()` üzerinden tüm kritik dataset'leri tek pakette dışa aktarır.
- **Restore:** `importBackup` action'ı `SyncService.importBackup(payload, { replace: true })` ile Sheets'e geri yükler.
- **KV Consistency:** Worker `importBackup` sonrası `cache:` prefix altındaki KV key'lerini temizler; sonraki okuma döngüsü taze hydration ile devam eder.
- **Safety Guard:** Restore yalnızca `options.replace=true` ile çalışır (yanlışlıkla import riskini azaltır).
- **2nd Confirmation Protocol (KV → Sheets):**
  1. İlk çağrı (`replace=true`) sadece `requiresConfirmation=true` + `confirmation.token` döner, yazma yapmaz.
  2. İkinci çağrıda `confirm=true`, `confirmText="GOOGLE_SHEETS_BACKUP_ONAY"` ve geçerli `confirmToken` gönderilmeden restore başlamaz.

### 1.2 Worker Manifestosu
- **KV-authoritative:** Browser tarafındaki operasyonel veri için tek otorite Cloudflare KV'dir. Sheets yalnızca backup / recovery kaynağıdır.
- **Sheets is not a database:** Yeni eklenen veya KV'de güncellenen operasyonel kayıtları bulmak için Sheets'e gidilmesi mimari ihlaldir.
- **Payloads come from KV:** `buildCertPayload`, `buildTestPayload`, benzeri üretim payload'ları Worker/KV tarafında kurulmalı; GAS bu payload'ları yalnızca consume etmelidir.
- **No operational Sheet reads:** Firma/sertifika/test/denetim/proforma/standart verisini doküman üretmek, listelemek, tek kayıt bulmak veya işlem yapmak için Sheets'ten okumak yasaktır.
- **Allowed Sheet usage only:** `bulkSync`, `bulkSyncMaster`, `exportBackup`, `importBackup`, ve gerçekten şablon/master veri kaynağı olarak korunması gereken nadir Google-native senaryolar.
- **Incremental write zorunluluğu:** `add/update` operasyonları tek kayıt değişimi için tüm dataset'i `JSON.parse`/`JSON.stringify` yapamaz.
- **Granular-first tasarım:** Her firma `cache:company:{id}` (tam kayıt, ~1KB) ve `cache:index:companies:search` (hafif 6-alan index) üzerinden yönetilir. Her sertifika `cache:getCertificateById:{stableKey}` (tam kayıt), `cache:getCertificatesByFirmaId:{stableKey}` (firma sertifika listesi) ve `cache:index:certificates:recent` (son ID listesi) üzerinden yönetilir. Monolitik "hepsini tek JSON'a koy" yaklaşımı kesinlikle yasaktır — 10MB KV limiti ve write-amplification riski taşır.
- **Aggregate cache politikası:** `cache:getCompanies:{}`, `cache:getCertificates:{}`, `cache:getAudits:{}`, `cache:getConsultants:{}` gibi toplu cache'ler write anında yeniden üretilmez; invalidate edilir ve gerekirse indexten rebuild edilir. `cache:getCompanies:{}` şu an **lightweight search array** döner (id, nickname, unvan, city, kapsam, scope); tam firma detayı her zaman `cache:company:{id}`'den alınır.
- **bulkSync istisnası:** Full dataset rebuild yalnızca `bulkSync`, `bulkSyncMaster`, `importBackup` gibi açıkça toplu veri senaryolarında serbesttir.
- **KV/GAS kota ekonomisi:** Bir write path tek kayıt için gereksiz KV `get/list/put/delete` zinciri kuramaz; GAS'a ancak Google-native side-effect veya açık backup/sync ihtiyacı varsa gidilir.
- **CORS disiplini:** Worker yalnızca allowlist origin'leri kabul eder. `Origin` header'ı olan ama allowlist dışında kalan browser istekleri 403 ile reddedilir. `OPTIONS` cevapları ile `POST` cevapları aynı policy'yi taşır.
- **Sync güvenliği:** “SİSTEMİ SENKRONİZE ET (KV)” ana bulk hydration kapısıdır; bu akış korunmalı, hızlandırılabilir ama incremental write mantığıyla karıştırılmamalıdır.

### 🏗️ Legacy Infrastructure Context (The "Gold Standard")
- **Frontend:** Bootstrap 5.3 + Tabulator v6.3 (Professional Data Grid).
- **Libraries:** Luxon (Date handling), SheetJS (Excel Exports).
- **Design Philosophy:** Data-dense, high-precision, utility-first management interface.
- **CRITICAL:** Modern Astro UI must match or exceed the information density and professional feel of this legacy Bootstrap/Tabulator implementation. Avoid "over-designed" airiness where it sacrifices data visibility.

### 🎨 Modern UI Standards (Saf Tailwind v5.1.0)
- **Framework:** Astro 6.x + **Tailwind CSS (Pure Tailwind)**.
- **Philosophy:** NO CUSTOM CSS UTILITIES. Tüm tasarım doğrudan Tailwind utility sınıfları ile HTML/Astro içinde yönetilir.
- **Opaque Surfaces:** Kurumsal okunabilirlik için şeffaf (glass) arka planlar yasaklanmıştır. Tüm kartlar ve menüler `bg-surface` (solid) ve `border-border-main` kullanır.
- **Data Density:** Sıkı boşluklar (`p-2`, `leading-tight`) ve yüksek kontrastlı tipografi ile veri yoğunluğu maksimize edilir.

### 2. Middleware & Security (Cloudflare Worker)
- **Role:** Secure API Proxy & Secret Injector.
- **Security Flow:** **Browser (No Key)** -> **Cloudflare Worker (Injects Secret API_KEY)** -> **GAS Bridge**.
- **Worker Secrets:** `API_KEY` (Auth), `GAS_API_URL` (Official: `https://portalapi.medicert.com.tr`). Forwarding to GAS Exec: `https://script.google.com/macros/s/AKfycby...LL4/exec`

---

## ⚡ KV-First Mimari Stratejisi (v5.3.0 — Kesin Kural)

> [!CAUTION]
> Bu bölüm, geliştirilen veya migration yapılan **her fonksiyon** için uyulması zorunlu mimari kararı tanımlar.
> **Özetle:** Google'ın native servislerine (Docs, Drive, Calendar, Gmail, LanguageApp) doğrudan bağımlı olmayan **her okuma ve yazma operasyonu KV üzerinden çözülür**. GAS yalnızca Google Native side-effect engine'i olarak vardır — authoritative data store değil. Sheets manuel backup kaynağıdır.

### 2.1 Operational Data vs Backup Boundary

- **Cloudflare KV:** Operasyonel veri tabanı. UI, Worker, payload üretimi, CRUD, dashboard ve şirket/sertifika/test/denetim/proforma akışları buradan beslenir.
- **Google Apps Script:** Google-native işlem motoru. Drive/Docs/Calendar/Gmail/PDF gibi side-effect işleri yapar; veri kaynağı rolü üstlenmez.
- **Google Sheets:** Yalnızca backup, restore, bulk hydration ve istisnai master/template kaynakları için kullanılır.
- **Kesin sınır:** "Veriyi bulmak için Sheets'e gidelim" yaklaşımı yasaktır. Doğru akış "KV'den hazır payload kur, GAS ile işlemi yap" olmalıdır.
- **Yanlış örnek:** `DocumentService.buildCertPayload()` içinde `CertificateService.getById()` / `CompanyService.getById()` / `Standarts` sheet okuması.
- **Doğru örnek:** Worker `certificateById + companyById + standardsById` indexlerinden payload kurar, GAS `generateIso` ile sadece belgeyi üretir.

### Kural 1 — Okuma (READ) Operasyonları: Her Zaman KV-First

Tüm liste ve tekil kayıt okuma işlemleri `proxy.js` içindeki `cacheableActions` listesine eklenmeli ve Cache-Aside pattern'i ile çalışmalıdır:

```
Browser → CF Worker → KV hit? → Dön (0ms)
                     ↓ miss
                     `KV_PRIMARY_MISS` (503) → SyncManager `bulkSync` → tekrar oku
```

**Mevcut `cacheableActions` listesi** (`proxy.js` satır 61-70) — yeni eklenen her READ action buraya eklenmelidir:
| Action | KV Cache Key Formatı | Notlar |
| :--- | :--- | :--- |
| `getCompanies` | `cache:getCompanies:{}` | bulkSync ile hydrate edilir |
| `getCompanyById` | `cache:getCompanyById:{"id":"X"}` | fallback: `cache:company:{id}` (granular) |
| `getCertificates` | `cache:getCertificates:{}` | bulkSync ile hydrate edilir |
| `getCertificatesByFirmaId` | `cache:getCertificatesByFirmaId:{"firmaId":"X"}` | granüler firma sertifika listesi |
| `getTestsByFirmaId` | `cache:getTestsByFirmaId:{"firmaId":"X"}` | granüler firma test listesi |
| `getAuditsByFirmaId` | `cache:getAuditsByFirmaId:{"firmaId":"X"}` | granüler firma denetim listesi |
| `getFolderId` | `cache:getFolderId:{"nickname":"X"}` | Drive klasör ID'si değişmez |
| `getRecentFiles` | `cache:getRecentFiles:{"nickname":"X",...}` | Kısa TTL düşünülebilir |
| `getConsultants` | `cache:getConsultants:{}` | ✅ Aktif |
| `getStandardById` | `cache:getStandardById:{"id":"X"}` | ✅ Aktif |
| `getRecentCertificates` | `cache:getRecentCertificates:{"limit":25}` | source of truth: `cache:index:certificates:recent` + per-cert key'ler |
| `getProformaByFirmaId` | `cache:getProformaByFirmaId:{"firmaId":"X"}` | ✅ Aktif |
| `getProformaById` | `cache:getProformaById:{"id":"X"}` | ✅ Aktif |
| `getMasterData` | `cache:getMasterData:{"type":"X"}` | ✅ Aktif (`standards/auditors/consultants/testdocs/sysdocs`) |
| `getAvailableSets` | `cache:getAvailableSets:{}` | Planlı (henüz cacheableActions listesinde değil) |

### Kural 2 — Yazma (WRITE) Operasyonları: Her Zaman KV-Primary + Incremental

Google'ın native servislerine bağımlı olmayan **TÜM yazma operasyonları doğrudan KV'ye yazılır**. Sheets'e otomatik write-back yapılmaz, yapılmamalıdır.

```
Browser → CF Worker → KV'ye yaz (primary) → Başarılı?
                                            ↓ evet
                      Dön  (Sheets'e yazılmaz)
```

> [!CAUTION]
> **Sheets'e write-back kesinlikle yapılmaz.** `addCompany`, `addTest`, `addProforma`, `scheduleAudit` dahil tüm operasyonlar için authoritative store KV'dir. Sheets yalnızca "SİSTEMİ SENKRONİZE ET" veya manuel backup akışlarıyla güncellenir.

> [!IMPORTANT]
> **Full rebuild yasağı:** `bulkSync` / `importBackup` dışındaki write operasyonları `cache:get*:{}` aggregate listelerini yeniden üretmez. Bu operasyonlar yalnızca:
> - ilgili `cache:index:*` anahtarını,
> - tekil `cache:get...ById:*` / `cache:get...ByFirmaId:*` anahtarlarını,
> - gerekiyorsa `cache:meta:*NextId` sayaçlarını
> günceller veya invalidate eder.

> [!NOTE]
> **Google Native side-effect içeren operasyonlar** (`scheduleAudit`, `updateSurveillance`): **Veri KV'ye yazılır.** Calendar event / Drive dosya oluşturma için ek bir GAS çağrısı yapılır. GAS bu akışta yalnızca side-effect engine'i olarak kullanılır.

> [!IMPORTANT]
> **Doküman üretim payload kuralı:** `buildCertPayload`, `buildTestPayload` gibi helper'lar operasyonel path'te Sheets okuyamaz. Bunlar ya Worker/KV tarafına taşınmalı ya da GAS içinde sadece hazır payload doğrulama/consume görevinde kalmalıdır.

> [!WARNING]
> **Geçici Devre Dışı — Google Calendar Side-Effects:** KV-primary altyapısı tamamlanana kadar, Ekleme ve Düzenleme operasyonlarındaki (`scheduleAudit`, `updateSurveillance`) **Google Calendar GAS çağrıları geçici olarak devre dışı bırakılmıştır.** Bu operasyonlar şu an yalnızca KV'ye yazar; Calendar event oluşturma/güncelleme atlanır. İlerleyen aşamalarda Calendar entegrasyonu yeniden devreye alınacaktır.

| Action | Yazma Hedefi | Etkilenen KV Key(ler) |
| :--- | :--- | :--- |
| `addCompany` | **KV-primary** | `cache:company:{newId}` yazılır, `cache:index:companies:search` güncellenir, `cache:meta:companyNextId` artırılır; aggregate cache invalidate edilir |
| `updateCompany` | **KV-primary** | `cache:company:{id}` (1KB) güncellenir, `cache:index:companies:search` içindeki ilgili entry güncellenir; aggregate cache invalidate edilir |
| `addCertificate` | **KV-primary** | `cache:getCertificateById:{stableKey}` yazılır, `cache:getCertificatesByFirmaId:{firmaId}` append edilir, `cache:meta:certificateNextId` artırılır; aggregate cache invalidate edilir |
| `updateCertificate` | **KV-primary** | `cache:getCertificateById:{stableKey}` güncellenir, yalnızca etkilenen eski/yeni firma listeleri patch edilir; aggregate cache invalidate edilir |
| `updateCertificateField` | **KV-primary** | `cache:getCertificateById:{stableKey}` güncellenir, yalnızca etkilenen firma listesi patch edilir; aggregate cache invalidate edilir |
| `updateSurveillance` | **KV-primary** + Calendar GAS side-effect | Etkilenen sertifikalar ve firma listeleri paralel yüklenir, in-place güncellenir; full rebuild yapılmaz |
| `addTest` | **KV-primary** | `cache:getTestById:{stableKey}` yazılır, `cache:getTestsByFirmaId:{firmaId}` append edilir, `cache:meta:testNextId` artırılır; aggregate cache invalidate edilir |
| `scheduleAudit` | **KV-primary** + Calendar GAS side-effect | `cache:getAuditById:{stableKey}` yazılır, `cache:getAuditsByFirmaId:{firmaId}` append edilir, `cache:meta:auditNextId` artırılır; `cache:getAudits:{}` invalidate edilir |
| `addProforma` | **KV-primary** | `cache:index:proformasById`, `cache:index:proformasByFirmaId`, `cache:meta:proformaNextId`, ilgili firma cache'i güncellenir |
| `updateMasterData` | **KV-primary** | `cache:getMasterData:*` güncellenir |

### Kural 3 — Google Native Servis Operasyonları: Her Zaman GAS, KV Bypass

Bu operasyonlar için KV cache uygulanamaz ve uygulanmamalıdır. Worker doğrudan GAS'a yönlendirir, cacheableActions listesine eklenmez.

| Kategori | Action'lar | Neden KV Olamaz |
| :--- | :--- | :--- |
| **Google Docs** | `generateIso`, `generateTestReport`, `generateAppForm`, `generateDraftCertificate`, `generateContract`, `prepareBatchFolders`, `generateSingleBatchDoc` | Her çağrı yeni bir Drive dosyası oluşturur, sonuç tekrar edilemez |
| **Google Drive** | `getRecentFiles`* , `uploadFile`, `convertToPdf` | Dosya durumu anlık değişir. `getRecentFiles` kısa TTL ile cache'lenebilir ama dikkatli olunmalı |
| **Google Calendar** | `scheduleAudit`, `updateSurveillance` (Calendar kısmı) | Calendar event ID'leri GAS'tan döner, Sheets'e geri yazılması gerekir |
| **Gmail / Email** | `sendSurveillanceEmail`, `sendReport` | Side-effect operasyon, önbelleğe alınamaz |
| **LanguageApp** | `translate` | Gerçek zamanlı çeviri, sonuç parametreye bağlı, cache'lenebilir ama TTL kısa tutulmalı |

> `translate` için opsiyonel optimizasyon: `cache:translate:{"text":"X","toEn":true}` key'i ile KV cache eklenebilir. Aynı metin tekrar çevrilmeyecektir.

### Kural 4 — bulkSync Hydration Zorunluluğu

Yeni bir READ action eklendiğinde, eğer verisi `SyncService.getFullExport()` tarafından döndürülen yapıya dahil edilebiliyorsa (Sheets'ten bulk okunabilir), `bulkSync` sırasında da o verinin KV'ye yazılması sağlanmalıdır. Bu, cold-start (hiç cache olmayan) durumunda ilk yüklenişin de hızlı olmasını garanti eder.

Şu an `getFullExport` şunları döner: `companies`, `certificates`, `certificateRows`, `tests`, `audits`, `proformas`, `consultants`, `standards`, `syncWarnings`, `lastUpdate`.

---

## 🗝️ KV Key Kataloğu (v5.7.0 — Canonical)

> [!CAUTION]
> Bu katalog proxy.js'teki gerçek key şemasıdır. Yeni kod yazarken, mevcut kodu okurken veya KV'ye manuel müdahale ederken bu listeyi referans al. Katalogda olmayan monolitik key'ler (`cache:index:companiesById`, `cache:index:certificateById`, `cache:index:certificatesByFirmaId`) **kaldırılmıştır** — bu isimleri asla kullanma.

### Firma (Company) Key'leri

| KV Key | Boyut | İçerik | Kim yazar |
| :--- | :--- | :--- | :--- |
| `cache:company:{id}` | ~1KB/firma | Tam canonical firma objesi (tüm alanlar) | `addCompany`, `updateCompany`, `bulkSync` |
| `cache:index:companies:search` | ~160KB toplam | `{id: {id, nickname, unvan, city, kapsam, scope}}` map — yalnızca 6 alan | `addCompany`, `updateCompany`, `bulkSync` |
| `cache:meta:companyNextId` | <20B | Son atanan firma ID'sinin bir fazlası (string) | `addCompany`, `bulkSync` |
| `cache:getCompanies:{}` | ~160KB | Lightweight company array (search alanları) — aggregate/list cache | `bulkSync`; yazma sırasında **invalidate** edilir |
| `cache:getCompanyById:{stableKey}` | ~1KB | Tek firma cached lookup — aggregate cache | `getCompanyById` miss fallback yazar; yazma sırasında invalidate edilir |

> **`getCompanies` neden lightweight döner?** Firma listesi (1600+ kayıt) tam alanlarla ~10MB'a yaklaşır — KV single-key 10MB limitini zorlar ve her browser sync'inde ağır download yaratır. List görünümü ve arama için yalnızca 6 alan yeterlidir; detay sayfaları `getCompanyById` ile `cache:company:{id}`'den tam kaydı alır.

### Sertifika (Certificate) Key'leri

| KV Key | Boyut | İçerik | Kim yazar |
| :--- | :--- | :--- | :--- |
| `cache:getCertificateById:{stableKey}` | ~1KB/sert. | Tam canonical sertifika objesi | `addCertificate`, `updateCertificate`, `updateCertificateField`, `updateGozetim`, `updateSurveillance`, `bulkSync` |
| `cache:getCertificatesByFirmaId:{stableKey}` | ~10KB/firma | Firma'ya ait tüm sertifikaların canonical array'i | `addCertificate`, `updateCertificate`, `updateCertificateField`, `updateGozetim`, `updateSurveillance`, `bulkSync` |
| `cache:meta:certificateNextId` | <20B | Son atanan sertifika ID'sinin bir fazlası (string) | `addCertificate`, `bulkSync` |
| `cache:index:certificates:recent` | küçük array | Son sertifika ID'leri desc sırada tutulur; `getRecentCertificates` bundan rebuild edilir | `bulkSync`, sertifika write path'leri |
| `cache:getCertificates:{}` | değişken | Tüm sertifikalar aggregate list cache | `bulkSync`; yazma sırasında **invalidate** edilir |

> **`stableKey` formatı:** `stableStringify({id})` → örnek: `{"id":"1234"}`. Bu fonksiyon alan sıralamasını deterministik yapar; aynı parametreler her zaman aynı key'i üretir.

### Diğer Aktif Key'ler

| KV Key | İçerik |
| :--- | :--- |
| `cache:getTestById:{stableKey}` | Tam canonical test objesi (~1KB/test) — `addTest`, `updateTest`, `bulkSync` yazar |
| `cache:getTestsByFirmaId:{stableKey}` | Firma test listesi (canonical obje array'i) — `addTest`, `updateTest`, `bulkSync` yazar |
| `cache:meta:testNextId` | Test ID sayacı |
| `cache:full:tests` | Tüm test objeleri düz array — **yalnızca** `exportKvData`/`importKvData` için |
| `cache:getAuditById:{stableKey}` | Tam canonical denetim objesi — `scheduleAudit`, `updateAudit`, `bulkSync` yazar |
| `cache:getAuditsByFirmaId:{stableKey}` | Firma denetim listesi (canonical obje array'i) — `scheduleAudit`, `updateAudit`, `bulkSync` yazar |
| `cache:meta:auditNextId` | Denetim ID sayacı |
| `cache:full:audits` | Tüm denetim objeleri düz array — **yalnızca** `exportKvData`/`importKvData` için |
| `cache:getProformaById:{stableKey}` | Tam canonical proforma objesi — `addProforma`, `updateProforma`, `bulkSync` yazar | ✅ Aktif |
| `cache:getProformasByFirmaId:{stableKey}` | Firma proforma listesi (canonical obje array'i) — `addProforma`, `updateProforma`, `deleteProforma`, `bulkSync` yazar | ✅ Aktif |
| `cache:meta:proformaNextId` | Proforma ID sayacı | ✅ Aktif |
| `cache:full:proformas` | Tüm proforma objeleri düz array — **yalnızca** `exportKvData`/`importKvData` için | ✅ Aktif |
| `cache:getMasterData:{stableKey}` | standards/auditors/consultants/testdocs/sysdocs | ✅ Aktif |
| `cache:getStandardById:{stableKey}` | Tekil standart — `updateMasterData` (type=standards) ve `bulkSync` (scope=master) yazar | ✅ Aktif |
| `cache:getAuditorById:{stableKey}` | Tekil denetçi — `updateMasterData` (type=auditors) ve `bulkSync` (scope=master) yazar | ✅ Aktif |
| `cache:getConsultantById:{stableKey}` | Tekil danışman — `updateMasterData` (type=consultants) ve `bulkSync` (scope=master) yazar | ✅ Aktif |
| `cache:getConsultants:{}` | Danışman listesi — aggregate uyumluluk katmanı | ✅ Aktif |
| `cache:getTestDocByName:{stableKey}` | Tekil test parametre dokümanı | ✅ Aktif |
| `cache:getSysDocsBySetName:{stableKey}` | Bir sete ait sistem dokümanları listesi (klasörler/şablonlar) | ✅ Aktif |
| `cache:index:sysdocSets` | Kullanılabilir sistem doküman setleri listesi (index) | ✅ Aktif |
| `cache:getRecentCertificates:{stableKey}` | `certificate:recent` indexinden rebuild edilen son sertifikalar listesi |
| `cache:getFolderId:{stableKey}` | Drive klasör ID cache'i |
| `cache:getRecentFiles:{stableKey}` | Drive son dosyalar cache'i |

### Kaldırılmış (Deprecated) Key'ler — Asla Kullanılmamalı

| Eski KV Key | Neden kaldırıldı | Yerine |
| :--- | :--- | :--- |
| `cache:index:companiesById` | ~10MB monolith — KV limitini zorluyor, her write'ta full rebuild gerekiyordu | `cache:company:{id}` + `cache:index:companies:search` |
| `cache:index:certificateById` | ~2-3MB monolith | `cache:getCertificateById:{stableKey}` |
| `cache:index:certificatesByFirmaId` | ~2-3MB monolith | `cache:getCertificatesByFirmaId:{stableKey}` |
| `cache:index:testsByFirmaId` | Tüm testleri tek JSON'da + dizi formatında saklıyordu — write-amplification, pozisyonel erişim kırılganlığı | `cache:getTestById:{stableKey}` + `cache:getTestsByFirmaId:{stableKey}` |
| `cache:index:auditsByFirmaId` | Tüm denetimleri tek monolitik JSON'da saklıyordu | `cache:getAuditById:{stableKey}` + `cache:getAuditsByFirmaId:{stableKey}` |
| `index:auditsByFirmaId:{firmaId}` | Eski per-firma prefix formatı (yanlış namespace) | `cache:getAuditsByFirmaId:{stableKey}` |
| `cache:audit:{id}` | Eski tekil denetim key formatı | `cache:getAuditById:{stableKey}` |
| `cache:index:standardsById` | Monolitik standart indeksi (tüm standartlar tek JSON'da) | `cache:getStandardById:{stableKey}` |

> Bu key'ler `bulkSync` çalıştırılmadan önce KV'de hâlâ bulunabilir — yeni Worker kodu bunları okumaz, yeni değer yazmaz. TTL dolunca otomatik expire olurlar.

### Refactor Notları

- `cache:index:companiesById` kaldırıldı; company read/write path'i artık `cache:company:{id}` + `cache:index:companies:search` üzerinden ilerler.
- `cache:index:certificateById` kaldırıldı; sertifika read/write path'i artık per-certificate key üzerinden ilerler.
- `updateSurveillance` çoklu sertifika güncellemesini paralel `get` / paralel `put` modeliyle yapar; bu davranış performans için korunmalıdır.
- `saveProformaState`, `saveAuditState` ve benzeri full-state helper'lar dead code olarak temizlenmiştir; tekrar eklenmemelidir.
- `cache:index:standardsById` monolitik indeksi yerine `cache:getStandardById:{stableKey}` kullanılmaktadır; `updateMasterData` ve `bulkSync` bu anahtarları otomatik senkronize eder.
- Danışman verileri `cache:getConsultantById:{stableKey}` üzerinden granüler erişime açılmıştır; `cache:getConsultants:{}` aggregate listesi uyumluluk için korunmaktadır.
- Denetçi (Auditor) verileri `cache:getAuditorById:{stableKey}` üzerinden granüler erişime açılmıştır; `bulkSync` ve `updateMasterData` bu anahtarları otomatik senkronize eder.
- Test ve Sistem Dokümanları (`testdocs`, `sysdocs`) granüler key-value modeline taşınmıştır. Toplu dataset taramaları (scan) yerine doğrudan key lookup yapılmaktadır.
- `cache:index:auditsByFirmaId` / `index:auditsByFirmaId:{firmaId}` / `cache:audit:{id}` kaldırıldı; denetim read/write path'i artık `cache:getAuditById:{stableKey}` + `cache:getAuditsByFirmaId:{stableKey}` üzerinden ilerler.
- `bulkSync` denetimleri için GAS'ın gönderdiği `d.audits` (ham 2D array) artık kullanılmaz; `d.auditObjects` (GAS tarafında `_mapAuditRows` ile dönüştürülmüş canonical objeler) kullanılır.

---

## 📖 Granüler KV Entity Mimarisi El Kitabı

Bu el kitabı, projedeki test / denetim / proforma ve benzeri entity tiplerine uygulanacak KV mimarisini tanımlar. Her yeni AI oturumu ve her geliştirici bu kuralları baz almalıdır. Kurallar kod tabanında uygulanmış kararların özetidir; yeniden tartışmaya açılmamalıdır.

---

### 1. Temel İlke: Her Entity Granüler Olarak Saklanır

Her entity tipi için **üç** KV key şablonu zorunludur:

| Şablon | Format | Amaç |
| :--- | :--- | :--- |
| **Entity key** | `cache:get{X}ById:{stableStringify({id})}` | Tek kaydın tüm alanlarını barındıran canonical obje |
| **Firma-bazlı liste key** | `cache:get{X}sByFirmaId:{stableStringify({firmaId})}` | Bir firmaya ait tüm entity'lerin canonical obje array'i |
| **Full aggregate key** | `cache:full:{entities}` | Tüm entity'lerin düz array'i — **yalnızca** `exportKvData` / `importKvData` için |

`{X}` = entity adının Pascal-case tekili (Test, Audit, Proforma, ...).  
`{entities}` = küçük harf çoğul (tests, audits, proformas, ...).

**`stableKey` formatı:** `stableStringify({id: "123"})` → `{"id":"123"}`. Parametreleri deterministik sıralar; aynı parametreler her zaman aynı key'i üretir.

---

### 2. Canonical Object Formatı — Array Yasaktır

Her entity KV'de **named field'lara sahip plain object** olarak saklanır. Pozisyonel array (`[id, nick, firmaNo, ...]`) kullanımı **kesinlikle yasaktır**.

**Neden?**

1. `getPicker(input)` fonksiyonu objenin string key'lerini arar. Array'in key'leri `"0"`, `"1"`, `"2"`'dir. `pick(["id"])` bir array'de **her zaman boş döner** — bu sessiz bir veri kaybıdır.
2. Array'de pozisyona bakılır, isme bakılmaz. Sütun sırası değişirse tüm okumalar sessizce yanlış değer döner.
3. Okunabilirlik: `audit.a1Auditor` vs `audit[6]` — hangisi debug edilebilir?

**Doğru `createCanonical{X}Row` şablonu:**

```js
const createCanonicalTestRow = (source, options = {}) => {
  const input = source && typeof source === "object" ? source : {};
  const pick = getPicker(input);
  const id = String(options.id ?? pick(["ID", "id"]) ?? "").trim();
  return {
    id,
    fieldA: pick(["fieldA", "aliasA"], "defaultA"),
    fieldB: pick(["fieldB", "aliasB"], "defaultB"),
    // ...
  };
};
```

**GAS raw array → obje dönüşümü için ayrı mapper** yazılır (bkz. `mapRawProformaRow`, `_mapAuditRows`). Bu mapper `createCanonical...`'dan ayrı tutulur; canonical fonksiyon her zaman obje alır.

---

### 3. CRUD Handler Deseni — Slim Granüler Yazma

Her CRUD handler şu deseni izler; monolith yüklemez, tam state tutmaz:

**Add (Ekle):**
```
nextId = loadXNextId()                        // Yalnızca sayacı oku
created = createCanonicalXRow(params, {id})   // Canonical obje yarat
writes:
  put entity key → created
  get firma key → parse → append created → put firma key
  put nextId key → nextId + 1
```

**Update (Güncelle):**
```
existing = get entity key → parse            // Yalnızca bu kaydı oku
updated  = createCanonicalXRow({...existing, ...params.updates}, {id})
prevFirma ≠ nextFirma?
  put prevFirma key → filtered (eski kaydı çıkar)
  put nextFirma key → appended (yeni firmaya ekle)
  else:
  put firma key → mapped (kaydı yerinde güncelle)
put entity key → updated
```

**Delete (Sil):**
```
existing = get entity key → parse
delete entity key
put firma key → filtered (kaydı çıkar)
```

**Kural:** Hiçbir handler `JSON.parse(tüm veri seti)` yapamaz. Yalnızca etkilenen entity key'i ve ilgili firma list key'i okunur.

---

### 4. Kesinlikle Kullanılmayacak Fonksiyon Kalıpları

Aşağıdaki fonksiyon kalıpları monolitik mimarinin belirtisidir. Adı ne olursa olsun bu kalıpları gören kod yeniden yazılmalıdır:

| Yasak Kalıp | Neden Yasak | Yerine Ne Kullanılır |
| :--- | :--- | :--- |
| `loadXState()` | Tüm entity dataset'ini tek bir monolith key'den yükler | `get entity key` — yalnızca ihtiyaç duyulan kayıt |
| `loadXIndexes()` | Monolith + fallback scan — her CRUD öncesi tam yük | `loadXNextId()` — sadece sayaç |
| `saveXIndexes(state)` | Tüm state'i monolith olarak geri yazar + per-firma loop | Per-entity put + per-firma put |
| `buildXsByFirmaId(rows)` | Tüm kayıtları `{firmaId: [...]}` hash'ine dönüştürür | Gerekmiyor; her firma key zaten ayrı saklanıyor |
| `buildXsById(rows)` | Tüm kayıtları `{id: {...}}` hash'ine dönüştürür | `get entity key` ile tekil lookup |
| `rebuildXFromIndex()` | Tüm key'leri tarayıp monolith yeniden kurar | `cache:full:X` aggregate'ten rebuild |
| `Array.isArray(row)` dalı `getXId/FirmaId` içinde | Array desteği = eski format hâlâ hayatta | Sadece object field erişimi; array geliyorsa önce mapper çalıştır |

---

### 5. `cache:full:X` Key'inin Amacı ve Sınırları

`cache:full:tests`, `cache:full:audits`, `cache:full:proformas` key'leri **yalnızca iki senaryo** için vardır:

1. **`exportKvData`:** Tüm entity'leri tek pakette dışa aktarır (backup / KV → Sheets sync).
2. **`importKvData`:** Paketi alıp tüm granüler key'leri yeniden kurar.

Bu key'ler **operasyonel read path'te kullanılmaz.** Firma sayfası, liste görünümü, CRUD handler bunlara dokunmaz. Amacı dışında kullanan kod mimari ihlaldir.

---

### 6. bulkSync'te GAS Verisi — Array mı, Object mi?

GAS `SyncService.getFullExport()` bazı entity'leri iki formatta gönderir:

| Alan | Format | Kullanılabilir mi? |
| :--- | :--- | :--- |
| `d.audits` | Ham 2D array (`getRawData`) | **Hayır** — `getPicker` array'den okuyamaz |
| `d.auditObjects` | `_mapAuditRows()` ile dönüştürülmüş obje array | **Evet** — canonical dönüşüme doğrudan verilir |
| `d.proformas` | Ham 2D array | **Evet** ama önce `mapRawProformaRow()` ile objeleştirilmeli |
| `d.companies`, `d.certificates` | `getDataAsObjects` — zaten obje | **Evet** |

**Kural:** `bulkSync` handler'ında ham array (2D) alınan her entity için önce `mapRaw{X}Row()` çağrılır, ardından `createCanonical{X}Row()` çağrılır.

---

### 7. Key İsimlendirme Standartı — Kesin Kurallar

**Doğru format:**
- Tekil: `cache:get{X}ById:{stableKey}` → `cache:getTestById:{"id":"42"}`
- Firma-bazlı: `cache:get{X}sByFirmaId:{stableKey}` → `cache:getTestsByFirmaId:{"firmaId":"100"}`
- Aggregate: `cache:full:{entities}` → `cache:full:tests`
- Sayaç: `cache:meta:{entity}NextId` → `cache:meta:testNextId`

**Yasak formatlar — asla kullanılmaz:**
- `cache:index:{entity}sByFirmaId` — monolith, kaldırıldı
- `index:{entity}sByFirmaId:{id}` — yanlış namespace, kaldırıldı
- `cache:{entity}:{id}` — kısa format, tutarsız (örn: `cache:proforma:42`, `cache:audit:42`)
- `{entity}:{id}` — prefix yok, collision riski

**Neden `get{X}ById` formatı?** Bu format cacheable action adlarıyla (`getTestById`, `getAuditById`) birebir eşleşir. Aynı parametreler hem action cacheKey hem entity key üretir — tutarlılık ve hata ayıklama kolaylığı sağlar.

**Kasıtlı eski format toleransı — `cache:company:{id}`:**  
Firma entity key'i `cache:company:{id}` (düz string) formatını korur. Bu `cache:get{X}ById:{stableKey}` kuralından önce tasarlandı ve geçiş maliyeti yüksek olduğu için değiştirilmedi. Bu bir hata değil, bilinçli karardır. `cache:company:` key'ini `cache:getCompanyById:` formatına çevirmek kapsam dışındadır — dokunulmamalıdır. **Yeni entity tiplerine** bu tolerans uygulanmaz; stableStringify zorunludur.

---

### 8. Bir Kez Reddedilen Önerilerin Kayıtları

Aşağıdaki öneriler değerlendirilerek reddedilmiştir. Aynı öneri farklı bağlamlarda tekrar gelse bile bu kayıt gerekçesiyle birlikte sunulmalıdır:

#### ❌ "Self-healing / `loadTestState` gibi fonksiyon ekleyelim"
**Gerekçe:** `loadXState` monolitik index döneminin kalıntısıdır. Var olma sebebi monolith bozulunca prefix scan yaparak veriyi kurtarmaktı. Granüler mimaride her entity kendi key'inde durur — bozulacak merkezi bir monolith yoktur. Kurtarma senaryosu için `cache:full:X` aggregate key zaten mevcuttur; `importKvData` bu key'i okuyarak tüm granüler key'leri yeniden kurar. `loadXState` eklemek eski mimariye bilinçli geri adımdır.

#### ❌ "`index:testsByFirmaId:{id}` gibi index namespace kullanımı"
**Gerekçe:** `index:` prefix'i kullanılan eski monolitik dönemin (`cache:index:auditsByFirmaId`, `index:auditsByFirmaId:{id}`) namespace'idir ve deprecated listesindedir. Canonical format `cache:get{X}sByFirmaId:{stableKey}`'dir. Bu format action adlarıyla eşleşir, collision riski yoktur, `stableStringify` deterministik key üretir.

#### ❌ "Her entity için `buildXsByFirmaId` / `buildXsById` yardımcı fonksiyon ekleyelim"
**Gerekçe:** Bu fonksiyonlar tüm dataset'i belleğe alıp iki farklı hash yapısına dönüştürür. Granüler mimaride tüm dataset'e gerek yoktur; operasyonlar yalnızca ilgili entity key'ini ve ilgili firma list key'ini okur. Bu fonksiyonlar eklenmesi gereksiz bellek/işlem yükü ve eski mimariye çekim kuvvetidir.

#### ❌ "`bulkSync`'te yazma işlemlerini 50'şerli chunk'a bölün (henüz yapılmamış)"
**Gerekçe:** `bulkSync` handler'ında tüm `writes.push()` çağrıları toplandıktan sonra en sonda `for (let i = 0; i < writes.length; i += 50) { await Promise.all(writes.slice(i, i + 50)); }` döngüsü çalışır. Bu mekanizma halihazırda mevcuttur. Öneri mevcut kodu okumadan yazılmıştır.

#### ❌ "Proforma/Audit CRUD'unda monolith state yükleyip tek seferde kaydedin (tutarlılık için)"
**Gerekçe:** Monolith yükleme tutarlılık değil write-amplification üretir. 1600 firmanın tüm proformalarını tek bir key'de tutmak ve her CRUD'da parse/stringify yapmak hem KV write kotasını zorlar hem de race condition yaratır. Doğru tutarlılık stratejisi: yalnızca etkilenen entity key'i ve firma list key'i okunur, değiştirilir, geri yazılır.

---

### ⚠️ KV'deki Karma Veri Formatı (Migration Dönemi)

`bulkSync` yapılmamış veya eski sync'ten kalan KV key'leri iki farklı sertifika formatı içerebilir:

| Format | ID field | Örnek |
| :--- | :--- | :--- |
| **Eski (legacy)** | `"CertNo"` | `{ "CertNo": "4763", "Firma Adı": "...", "Gözetim": "TRUE", ... }` |
| **Yeni (canonical)** | `"ID"`, `"id"`, `"certId"` | `{ "ID": "4763", "id": "4763", "certId": "4763", "firmaNo": "...", ... }` |

`getCertificateId()` her iki formatı da tanır (`["ID", "id", "certId", "CertNo"]`). KV'ye yeni yazılan kayıtlar her zaman canonical formattadır; eski kayıtlar `bulkSync` çalıştırılana kadar legacy formatta kalmaya devam edebilir. `getCertificatesByFirmaId` listelerinde her iki format aynı anda bulunabilir — ID extraction yapan her kod bunu gözetmelidir.

---

## ⚠️ Platform Limitleri & Risk Analizi

> [!CAUTION]
> Bu bölüm Cloudflare KV ve Google Apps Script limitlerini derler; mevcut işlemlerin bu limitlere yakınlığını analiz eder. Yeni write path veya feature tasarlanırken bu tabloya başvurulmalıdır.

### Cloudflare Workers KV Limitleri

| Limit | Değer | Notlar |
| :--- | :--- | :--- |
| **Maksimum değer boyutu** | **25 MiB / key** | ai_context.md'nin bazı yerlerinde "10MB" yazıyor — doğrusu 25 MiB. Deprecated monolitik key'ler (~10MB) bu limitin altındaydı; yeni granüler tasarım zaten güvenli bölgede. |
| **Maksimum anahtar boyutu** | **512 byte** | `stableStringify` key'leri (ör. `{"firmaId":"1234"}`) bu limitin çok altında; ancak uzun parametreli key'ler oluşturulurken dikkat edilmeli. |
| **Metadata boyutu** | **1,024 byte / key** | |
| **List başına max key** | **1,000 key / çağrı** | Namespace'de 109 key mevcut — güvenli. |
| **Eventual consistency penceresi** | ~**60 saniye** | Bir key yazıldıktan sonra tüm datacenter'lara yayılması ~60sn sürebilir. Aynı anda birden fazla Worker instance varsa stale veri görülebilir. |
| **Free tier — Reads** | **100,000 / gün** | Nisan: 10.25k okuma (tüm ay) — güvenli. |
| **Free tier — Writes** | **1,000 / gün** | Nisan: 2.26k yazma (tüm ay) ≈ ~75/gün ortalama — güvenli. **bulkSync tek çalıştırmada ~8-10K write üretir; free tier'da günlük limiti anında aşar.** |
| **Free tier — Deletes** | **1,000 / gün** | Nisan: 150 silme (tüm ay) — güvenli. |
| **Free tier — Lists** | **1,000 / gün** | Nisan: 50 listeleme — güvenli. |
| **Workers Paid — Reads** | 10M / ay ücretsiz, sonrası $0.50 / 1M | |
| **Workers Paid — Writes** | 1M / ay ücretsiz, sonrası $5.00 / 1M | bulkSync başına ~10K write → ayda 100 bulkSync = 1M write. Aylık 1M ücretsiz kotayı zorlayabilir. |
| **Maksimum namespace key sayısı** | 1 milyar | |

> [!IMPORTANT]
> **bulkSync, Free tier write limitini tek çalıştırmada aşar.** Proje Workers Paid plan'da çalışmalıdır. Ücretsiz plan kullanılıyorsa bulkSync kesinlikle çalıştırılamaz.

### Google Apps Script (GAS) Limitleri

| Limit | Consumer (Free) | Google Workspace |
| :--- | :--- | :--- |
| **Script çalışma süresi** | **6 dakika / çalıştırma** | **30 dakika / çalıştırma** |
| **Günlük toplam çalışma süresi** | 90 dakika / gün | 6 saat / gün |
| **URL Fetch çağrısı** | 20,000 / gün | 100,000 / gün |
| **URL Fetch maks. yanıt boyutu** | **50 MB** | **50 MB** |
| **E-posta gönderimi** | 100 / gün | 1,500 / gün |
| **Trigger sayısı** | 20 / kullanıcı | 20 / kullanıcı |
| **Properties Service toplam** | 500 KB | 500 KB |
| **Properties Service / değer** | 9,000 byte | 9,000 byte |
| **Spreadsheet maks. hücre** | 10M hücre / dosya | 10M hücre / dosya |
| **Eş zamanlı çalışma** | 30 eş zamanlı çalışma / kullanıcı | 30 eş zamanlı çalışma / kullanıcı |

### 🔴 Mevcut Risk Noktaları

#### 1. `bulkSync` — GAS 6 Dakika Execution Limiti `[YÜksek Risk]`
`SyncService.getFullExport()` tek bir GAS çalıştırmasında 1,600+ firma + 5,000+ sertifika + testler + denetimler + proformalar + standartlar okur. Spreadsheet okuma yavaştır; bu işlem Consumer hesapta 6 dakika sınırına yaklaşabilir, zaman zaman timeout alabilir.
- **Mevcut durum:** ai_context.md "dakikalar içinde tamamlanıyor" diyor — Google Workspace hesabı kullanılıyorsa 30dk limiti güvenli.
- **Risk:** Consumer GAS hesabında timeout olasılığı yüksektir.
- **Öneri:** `bulkSyncMaster` ve ana `bulkSync` akışları zaten ayrılmış. Veri büyüdükçe firma/sertifika akışını sayfalara bölmek (`page=1,2,3`) gerekebilir.

#### 2. `bulkSync` — KV Write Storm `[Orta Risk]`
Tek bir `bulkSync` oluşturduğu tahmini yazma işlemi:
- ~1,600 × `cache:company:{id}` PUT
- ~1,600 × `cache:getCertificatesByFirmaId:{id}` PUT
- ~5,000 × `cache:getCertificateById:{id}` PUT
- Index key'ler + aggregate invalidation

**Toplam: ~8,000–10,000 KV PUT / bulkSync çalıştırması.**

Workers Paid'de aylık 1M write ücretsiz. Ayda 100 kez `bulkSync` yapılırsa ücretli kotanın tamamı tükenir.
- **Mevcut durum:** Nisan 2.26K write (tüm ay) — çok güvenli. Deploy-sonrası tek seferlik kural korunuyor.
- **Öneri:** `bulkSync`'in deploy sonrası **bir kez** çalıştırılması zorunluluğunu ve incremental write kuralını ihlal etmeyin.

#### 3. `cache:index:companies:search` — Boyut Büyümesi `[Düşük Risk]`
Mevcut ~160KB (1,600+ firma, 6 alan). Firma sayısı 3,000'e ulaşırsa ~300KB olur. 25 MiB KV limitinin çok uzağında; ancak her `getCompanies` isteğinde browser'a indirilen veri boyutu izlenmelidir.

#### 4. `cache:getCertificates:{}` — Belirsiz Boyut `[Orta Risk]`
"Değişken" olarak tanımlanan aggregate sertifika cache. Eğer 5,000+ sertifika tam alanlarıyla tek key'de tutulursa 5–10 MB'a ulaşabilir; 25 MiB limitine yaklaşabilir.
- **Öneri:** Firma listesinde yapıldığı gibi aggregate sertifika cache'i sadece özet alanlar içermeli. Tam kayıt her zaman `cache:getCertificateById:{id}` üzerinden alınmalı. Bu aggregate key yalnızca invalidate edilmeli, rebuild edilmemeli.

#### 5. Deprecated Key'lerin KV'de Varlığı `[Bilgi]`
`cache:index:companiesById` (~10MB), `cache:index:certificateById`, `cache:index:certificatesByFirmaId` monolitik key'leri KV'de hâlâ bulunabilir. Yeni kod bunları okumaz/yazmaz; TTL dolunca expire olurlar. Storage 55.17 MB olduğuna göre (Nisan) deprecated key'ler hâlâ aktif olabilir. Bir sonraki `bulkSync` çalıştırıldığında bunlar doğal yoldan temizlenir.

#### 6. `getFullExport()` GAS Yanıt Boyutu `[Düşük Risk]`
Tüm tabloların JSON çıktısı tahminen 5–15 MB. GAS URL Fetch 50 MB limitinin altında; ancak veri büyüdükçe izlenmelidir.

#### 7. `runMonthlyCheck` — E-posta Limiti `[Düşük Risk — Consumer Hesapta Orta]`
Otomatik gözetim e-postası time trigger ile çalışır. Consumer GAS hesabında 100 e-posta/gün limiti, 1,600 firma/çok danışman senaryosunda aynı gün aşılabilir. Google Workspace'te 1,500 e-posta/gün yeterlidir.

---

## 📂 Technical Directory Matrix

### `/src/gas/api/` (Modern Services)
- `BaseService.gs`: Shared spreadsheet access, logging, and `LAST_UPDATE` management. Backup/hydration katmanı için korunur; operasyonel KV path'inde kullanılmamalıdır.
- `CompanyService.gs`: Legacy/compat spreadsheet service for the `Firmalar` sheet. Backup/hydration dışında operasyonel path'ten çıkarılmalıdır.
- `CertificateService.gs`: Legacy/compat spreadsheet service for the `Sertifika` sheet. Backup/hydration dışında operasyonel path'ten çıkarılmalıdır.
- `AuditService.gs`: Calendar Integration & Surveillance Archiving. Methods: `getAudits`, `getByFirmaId`, `scheduleAudit`, `updateSurveillance`.
- `DriveService.gs`: Recursive folder scanning and hierarchy management. Methods: `getCompanyFolderId`, `listRecentFiles`, `uploadFile`, `getOrCreateSubFolder`, `_scanRecursive`.
- `DocumentService.gs`: Batch generation engine for ISO/test/form documents. Hedef durum: yalnızca hazır payload consume eder; sheet-backed `buildCertPayload` / `buildTestPayload` helper'ları operasyonel path'ten çıkarılmalıdır.
- `PDFService.gs`: **Primary Converter:** Local `pdf.serdar.cc` (with Token). **Fallback:** iLovePDF. Methods: `convertToPdf`, `_tryLocalConverter`, `_tryILovePDF`.
- `TestService.gs`: Legacy/compat spreadsheet service for the `Testler` sheet. Backup/hydration dışında operasyonel path'ten çıkarılmalıdır.
- `SyncService.gs`: Full data export/import for KV and backup operations. Methods: `getFullExport`, `exportBackup`, `importBackup`.
- `ProformaService.gs`: Legacy/compat spreadsheet service. Backup/hydration dışında operasyonel path'ten çıkarılmalıdır.
- `StandardService.gs`: Legacy/compat spreadsheet lookup. Standart verisi operasyonel path'te KV master data üzerinden çözülmelidir.
- `MasterDataService.gs`: Reference/master dataset management. Methods: `get`, `getForSync`, `update`, `getLegacyIso`, `getLegacyAuditors`.
- `NotificationService.gs`: Mail workflows and scheduled checks. Methods: `sendSurveillanceEmail`, `sendTableReport`, `runMonthlyCheck`.
- `TranslationService.gs`: Specialized automated translation for ISO scope text (TR↔EN) via GAS `LanguageApp`. Methods: `translate`, `toEn`, `toTr`. **Note:** Operational tool for data entry, not UI localization.

### `/src/gas/api/` Current Dependency Audit
- **Operationally acceptable:** `DriveService.gs`, `PDFService.gs`, Google-native kısımlarıyla `NotificationService.gs`, Calendar side-effect kısımlarıyla `AuditService.gs`.
- **Backup/Hydration only kalmalı:** `CompanyService.gs`, `CertificateService.gs`, `TestService.gs`, `ProformaService.gs`, `StandardService.gs`, `BaseService.gs` spreadsheet helpersi.
- **Refactor target:** `DocumentService.gs` içindeki payload builder helper'ları KV/Worker tarafına taşınmalı.
- **Allowed Sheets reads:** `SyncService.gs` ve `MasterDataService.gs` backup/hydration/master-template senaryolarında kalabilir.

### `/src/lib/` (Core Logic)
- `api.ts`: Fetch wrapper for CF Worker.
- `sync.ts`: **The Brain.** Implements the decision tree for incremental background synchronization.
- `db.ts`: `idb-keyval` wrapper for structured IndexedDB access.
- `store.ts`: Defines shared global stores (`$companies`, `$certificates`, `$syncStatus`, `$lastSyncTime`).
- `config.ts`: Central config. Reads `PUBLIC_WORKER_URL` from env, exposes `CONFIG.WORKER_URL`.

### `/src/features/company-ops/` (Company Operation Modules)
- `definitions.ts`: Firma operasyon ekranlari icin ortak route/label metadata kaynagi.
- `context.ts`: `company/form`, `company/proforma`, `company/draft`, `company/contract` sayfalari icin normalize edilmis ortak firma operasyon context'i uretir.
- `certificate-form.ts`: Legacy sertifika ekleme kartindan tasinan standart/tarih/QR/sNo onerisi helper'larini barindirir.

### `/src/workers/` (Cloudflare Worker)
- `proxy.js`: **The deployed Cloudflare Worker.** Handles strict CORS allowlist, injects `API_KEY` secret into every request body before forwarding to GAS, and applies incremental KV write rules.
  - `bulkSyncMaster`: Standarts/Auditors/Consultants/TestDoc/SysDoc verilerini GAS'tan KV'ye hydrate eder.

### `/src/pages/` (UI Modules)
- `index.astro`: Reactive Dashboard.
- `search.astro`: Cached company lookup.
- `company/add.astro`: Registration & Property Mapping.
- `company/form.astro`: Mobil uyumlu basvuru formu operasyon sayfasi (iskelet + ortak company context).
- `company/proforma.astro`: Proforma operasyon sayfasi (liste/form iskeleti + ortak company context).
- `company/draft.astro`: Draft belge operasyon sayfasi (standart/dil secimi + ortak company context).
- `company/contract.astro`: Sozlesme operasyon sayfasi (ucret/konu formu + ortak company context).
- `company/certificate.astro`: Legacy sertifika ekleme carousel kartinin mobil uyumlu Astro karsiligi; `addCertificate` aksiyonuna baglidir.
- `certificates.astro`: Grid view & Bulk Surveillance updates.
- `documents/add.astro`: Batch document production.
- `documents/view.astro`: Recursive Drive Explorer & PDF conversion management.
- `audits/index.astro`: Audit timeline & Calendar overview.
- `addaudit.astro`: Firma ekleme akisindan bagimsiz yeni denetim planlama sayfasi.
- `audits/add.astro`: Legacy/transition audit scheduling route (eski baglantilar icin korunuyor).
- `settings.astro`: Master data yönetim paneli (KV read + KV-primary update, version conflict kontrolü, manuel `Sheets -> KV` sync butonları).

---

## 🗺️ Legacy -> Modern Function Migration Matrix (Source-Validated)

> [!IMPORTANT]
> This section is the function-level migration map between `src/gas/legacy/server/*.gs` and `src/gas/api/*.gs`.
> Status legend:
> - **Exact**: same responsibility preserved.
> - **Renamed/Refactored**: logic moved with new naming/shape.
> - **Deprecated**: no production path in v2 bridge flow.

### 1) Core Data & CRUD Migration
| Legacy Function (`src/gas/legacy/server`) | Modern Function (`src/gas/api`) | Bridge Action | Status |
| :--- | :--- | :--- | :--- |
| `serverSideFuncs.gs#getSheetDataAsObjects` | `BaseService.getDataAsObjects` | Internal | Renamed/Refactored |
| `serverSideFuncs.gs#openTargetSpreadsheet` | `BaseService.openSS` | Internal | Renamed/Refactored |
| `serverSideFuncs.gs#getCompanyById` | `CompanyService.getById` | `getCompanyById` | Exact |
| `serverSideFuncs.gs#addCompany` | `CompanyService.add` | `addCompany` | Exact |
| `serverSideFuncs.gs#editCompanyById` | `CompanyService.update` | `updateCompany` | Exact |
| `serverSideFuncs.gs#returnDanisman` | `CompanyService.getConsultants` | `getConsultants` | Renamed/Refactored |
| `serverSideFuncs.gs#getDataForSearch` | `CompanyService.getAllForSync` | `getCompanies` | Renamed/Refactored |
| `serverSideFuncs.gs#getDataForTable` | `CertificateService.getAll` | `getCertificates` | Renamed/Refactored |
| `serverSideFuncs.gs#gdfCertificate` | `CertificateService.getAll` | `getCertificates` | Renamed/Refactored |
| `serverSideFuncs.gs#getCertificateById` | `CertificateService.getById` | `getCertificateById` | Exact |
| `serverSideFuncs.gs#getCertificatesByFirmaId` | `CertificateService.getByFirmaId` | `getCertificatesByFirmaId` | Renamed/Refactored |
| `serverSideFuncs.gs#addCertificate` | `CertificateService.add` | `addCertificate` | Exact |
| `serverSideFuncs.gs#editCertificateById` | `CertificateService.update` | `updateCertificate` | Exact |
| `serverSideFuncs.gs#editSurvMultiple` | `AuditService.updateSurveillance` | `updateSurveillance` | Renamed/Refactored |
| `serverSideFuncs.gs#addAuditInfo` | `AuditService.scheduleAudit` | `scheduleAudit` | Renamed/Refactored |
| `serverSideFuncs.gs#gdfTest` | `TestService.getByFirmaId` | `getTestsByFirmaId` | Renamed/Refactored |
| `serverSideFuncs.gs#addTest` | `TestService.add` | `addTest` | Exact |
| `serverSideFuncs.gs#returnTest` | `TestService.getByFirmaId` | `getTestsByFirmaId` | Renamed/Refactored |
| `serverSideFuncs.gs#xtranslate` | `TranslationService.toEn` | `translate` (`toEn=true`) | Renamed/Refactored |
| `serverSideFuncs.gs#ytranslate` | `TranslationService.toTr` | `translate` (`toEn=false`) | Renamed/Refactored |
| `serverSideFuncs.gs#monthlyCheck` | `NotificationService.runMonthlyCheck` | `runMonthlyCheck` | Renamed/Refactored |
| `serverSideFuncs.gs#sendSurv` | `NotificationService.sendSurveillanceEmail` | `sendSurv` / `sendSurveillanceEmail` | Renamed/Refactored |
| `serverSideFuncs.gs#editCell` | `CertificateService.updateField` | `editCell` / `updateCertificateField` | Renamed/Refactored |
| `serverSideFuncs.gs#sendEmail` | `NotificationService.sendTableReport` | `sendEmail` / `sendReport` | Renamed/Refactored |
| `serverSideFuncs.gs#gdfProforma` | `ProformaService.getByFirmaId` | `gdfProforma` / `getProformaByFirmaId` | Renamed/Refactored |
| `serverSideFuncs.gs#addProInfo` | `ProformaService.add` | `addProInfo` / `addProforma` | Renamed/Refactored |
| `serverSideFuncs.gs#proformaVeri` | `ProformaService.getById` | `proformaVeri` / `getProformaById` | Renamed/Refactored |
| `serverSideFuncs.gs#getStandardById` | `StandardService.getById` | `getStandardById` | Renamed/Refactored |
| `serverSideFuncs.gs#returnIso` | `MasterDataService.getLegacyIso` | `returnIso` | Renamed/Refactored |
| `serverSideFuncs.gs#returnAstandards` | `MasterDataService.getLegacyAuditors` | `returnAstandards` | Renamed/Refactored |
| `serverSideFuncs.gs#sertifikaVeri` | `DocumentService.buildCertPayload` | `sertifikaVeri` / `buildCertPayload` | Renamed/Refactored |
| `serverSideFuncs.gs#testVeri` | `DocumentService.buildTestPayload` | `testVeri` / `buildTestPayload` | Renamed/Refactored |
| `serverSideFuncs.gs#veriCekVeYaz` | `SyncService.getFullExport` | `getFullSyncData` | Renamed/Refactored |
| `serverSideFuncs.gs#testleriCekVeYaz` | `SyncService.getFullExport` | `getFullSyncData` | Renamed/Refactored |
| `serverSideFuncs.gs#lastTwentyFive` | `CertificateService.getRecent` | `lastTwentyFive` / `getRecentCertificates` | Renamed/Refactored |
| `serverSideFuncs.gs#returnDocSelect` | `DocumentService.getAvailableSets` | `getAvailableSets` | Renamed/Refactored |
| `serverSideFuncs.gs#returnDocuments` | `DocumentService.getAvailableSets` | `getAvailableSets` | Renamed/Refactored |
| `serverSideFuncs.gs#createDocumentSetProgressive` | `DocumentService.prepareBatchFolders` + `generateSingleBatchDoc` | `prepareBatchFolders` + `generateSingleBatchDoc` | Renamed/Refactored |

### 2) Drive & Document Migration
| Legacy Function (`src/gas/legacy/server`) | Modern Function (`src/gas/api`) | Bridge Action | Status |
| :--- | :--- | :--- | :--- |
| `drive.gs#ilkKarekter` | `DriveService.getCompanyFolderId` | `getFolderId` / internal | Renamed/Refactored |
| `drive.gs#getFilesFromFolder` | `DriveService.listRecentFiles` | `getRecentFiles` | Renamed/Refactored |
| `drive.gs#getFilesFromFolderRecursiveHelper` | `DriveService._scanRecursive` | Internal | Renamed/Refactored |
| `drive.gs#doUpload` | `DriveService.uploadFile` | `doUpload` / `uploadFile` | Renamed/Refactored |
| `docs.gs#isoBas` | `DocumentService.generateIsoCertificate` | `generateIso` | Renamed/Refactored |
| `docs.gs#testBas` | `DocumentService.generateTestReport` | — (bridge pending) | Renamed/Refactored |
| `docs.gs#basFormu` | `DocumentService.generateAppForm` | `generateAppForm` | Renamed/Refactored |
| `docs.gs#draftBas` | `DocumentService.generateDraftCertificate` | `draftBas` / `generateDraftCertificate` | Renamed/Refactored |
| `docs.gs#sozlesme` | `DocumentService.generateContract` | `sozlesme` / `generateContract` | Renamed/Refactored |
| `docs.gs#sertifikaDate` | `DocumentService._formatDate` | Internal | Renamed/Refactored |
| `docs.gs#testTarihString` | `DocumentService._formatTestDate` | Internal | Renamed/Refactored |
| `docs.gs#replaceTextToImage` | `DocumentService._replaceImage` | Internal | Renamed/Refactored |
| `docs.gs#generateAndReplaceQrCode` | `DocumentService._generateQr` | Internal | Renamed/Refactored |
| `docs.gs#prepareDocumentFolders` | `DocumentService.prepareBatchFolders` | `prepareBatchFolders` | Renamed/Refactored |
| `docs.gs#createSingleDocument` | `DocumentService.generateSingleBatchDoc` | `generateSingleBatchDoc` | Renamed/Refactored |
| `docs.gs#docsReplaceAllPh` | `DocumentService._processReplacements` | Internal | Renamed/Refactored |
| `docs.gs#docsGetOrCreateFolder` | `DriveService.getOrCreateSubFolder` | Internal | Renamed/Refactored |
| `docs.gs#insertLogoInAllHeaderSections` | `DocumentService._insertLogoInHeaders` | Internal | Renamed/Refactored |
| `docs.gs#insertLogoInBodyAndTables` | `DocumentService._insertLogoInBody` | Internal | Renamed/Refactored |

### 3) PDF Migration
| Legacy Function (`src/gas/legacy/server`) | Modern Function (`src/gas/api`) | Bridge Action | Status |
| :--- | :--- | :--- | :--- |
| `iLovePDF.gs#processDocToFitPdf` | `PDFService.convertToPdf` | `convertToPdf` | Renamed/Refactored |
| `iLovePDF.gs#callLocalConverter_` | `PDFService._tryLocalConverter` | Internal | Renamed/Refactored |
| `iLovePDF.gs#processDocToFitPdfViaILovePDF` | `PDFService._tryILovePDF` | Internal | Renamed/Refactored |
| `iLovePDF.gs#getIlovepdfSessionToken_` + task helper zinciri | `PDFService._tryILovePDF` (consolidated) | Internal | Renamed/Refactored |

### 4) Legacy-Only / Pending Migration (src/gas/legacy/server/)
> **NOT:** Bu dosyalar `src/gas/legacy/server/` klasöründe referans olarak korunmaktadır. Migrasyon tamamlanmadıkça silinmemelidir.

| Legacy File | Pending Functions | Current Status |
| :--- | :--- | :--- |
| `load.gs` | `doGet`, `serveHtml` | **Deprecated** — GAS WebApp giriş noktası. Astro routing ile tamamen değiştirildi. (Bkz. Bölüm 6) |
| `load.gs` | `convertFilesToPdfPro`, `pdfRaspiToplu` | **Deprecated** — Drive toplu batch scriptleri. Portal UI üzerinden yapılıyor. (Bkz. Bölüm 6) |
| `load.gs` | Tüm `test*`, `debug*`, `normalizeyitest`, `testdeneme`, `triggerHomeAssistant`, `testMySQLConnection`, `tetikleSertifika` | **Deprecated** — Geliştirici debug/test scriptleri, production'da yeri yok. (Bkz. Bölüm 6) |
| `loadPartials.gs` | `loadPartialHTML_`, `include`, `loadSearchView`, `loadAddCompanyView`, `loadTableCertificateView`, `loadCompanyInfoView`, `loadDocsView` | **Deprecated** — GAS HTML partial renderer. Astro component sistemi ile değiştirildi. (Bkz. Bölüm 6) |
| `otorobot.gs` | `convertGoogleDocToPDF`, `convertPDFtoPNG`, `insertPNGintoGoogleSlidesAndExportToPDF`, `fullProcess` | **Deprecated** — Deneysel Doc→PDF→PNG→Slides pipeline. PDFService ile değiştirildi. (Bkz. Bölüm 6) |
| `serverSideFuncs.gs` | — | **Migrated** — `returnIso` ve `returnAstandards` dahil reference helper'ların modern karşılıkları eklendi. |
| `docs.gs` | — | **Migrated** — `draftBas`, `sozlesme`, `testTarihString`, logo helper'ları modern `DocumentService` içinde mevcut. |
| `drive.gs` | — | **Migrated** — `doUpload` modern `DriveService.uploadFile` + bridge alias ile aktif. |

### 5) Legacy Client HTML -> Astro Route Migration (src/gas/legacy/client/)
> **NOT:** Bu dosyalar `src/gas/legacy/client/` klasöründe referans olarak korunmaktadır. Migrasyon tamamlanmadıkça silinmemelidir.

| Legacy Client File | Modern Astro Route | Status | Notes |
| :--- | :--- | :--- | :--- |
| `src/gas/legacy/client/companyinfo.html` | `src/pages/company/index.astro` + `src/pages/company/edit.astro` | Migrated | Profil görünümü `/company?id=...`, düzenleme `/company/edit?id=...` olarak ayrıştırıldı. |
| `src/gas/legacy/client/other.html` | `src/pages/other.astro` | Migrated | Modern unauthorized-access page. |
| `src/gas/legacy/client/main.html` | `src/pages/index.astro` | Pending | Dashboard — needs review and comparison. |
| `src/gas/legacy/client/search.html` | `src/pages/search.astro` | Pending | Company search — needs feature parity check. |
| `src/gas/legacy/client/addcompany.html` | `src/pages/company/add.astro` | Pending | Company registration form — needs field mapping validation. |
| `src/gas/legacy/client/tableCertificate.html` | `src/pages/certificates.astro` | Pending | Certificate grid — needs Tabulator parity check. |
| `src/gas/legacy/client/addDocs.html` | `src/pages/documents/add.astro` | Pending | Batch document production form. |
| `src/gas/legacy/client/sendSurv.html` | (Not yet created) | Pending | Surveillance email template — no modern route yet. |

### 6) 🐛 Modern Servis Kalite Durumu (Source-Validated)

> Bu bölümdeki 1-17 maddelerin tamamı yeniden doğrulanmış ve mevcut kodla uyumlu **kapanış durumuna** çevrilmiştir.

| # | Servis | Konu | Durum |
| :- | :--- | :--- | :--- |
| 1 | BaseService | Debug logları | ✅ Düzeltildi |
| 2 | BaseService | `Math.max(...ids)` stack overflow riski | ✅ Düzeltildi |
| 3 | BaseService | `getValues` -> `getDisplayValues` | ✅ Düzeltildi |
| 4 | CertificateService | `getById` performans modeli | ✅ Düzeltildi |
| 5 | CertificateService | `updateGozetim` sütun adı (`Gözetim Conf.`) | ✅ Düzeltildi |
| 6 | CertificateService | `gozetimConfirmed` boolean dönüşümü | ✅ Düzeltildi |
| 7 | AuditService | Yeni event ID'nin sheet'e geri yazılması | ✅ Düzeltildi |
| 8 | AuditService | Guest listesinin taşınması | ✅ Düzeltildi |
| 9 | AuditService | Kırılgan ID üretimi | ✅ Düzeltildi |
| 10 | AuditService | `getAudits` eksik alan problemi | ✅ Düzeltildi |
| 11 | DocumentService | `generateAppForm` stub problemi | ✅ Düzeltildi |
| 12 | DocumentService | Yanlış SysDoc sheet adı | ✅ Düzeltildi |
| 13 | DocumentService | Logo'nun header/body'ye eklenmesi | ✅ Düzeltildi |
| 14 | DocumentService | QR positioning hardcoded sorunu | ✅ Düzeltildi |
| 15 | PDFService | `_tryILovePDF` fallback implementasyonu | ✅ Düzeltildi |
| 16 | SyncService | Per-sheet try/catch izolasyonu | ✅ Düzeltildi |
| 17 | SyncService | `bulkSync` eksik dataset'ler (`proformas/consultants/standards`) | ✅ Düzeltildi |

---

### 7) 🔧 Migration Durumu (Güncel)

> Aşağıdaki grupların büyük bölümü modern servis katmanına taşındı ve bridge action'ları ile kullanılabilir durumda.

#### Grup 1: Firma & Sertifika CRUD (Öncelik: YÜksek)
| Legacy Fonksiyon | Dosya | Ne Yapıyor | Hedef Modern Konum |
| :--- | :--- | :--- | :--- |
| `editCompanyById` | `serverSideFuncs.gs` | Firma ID'si ile `Firmalar` sayfasındaki satırı bulup tüm alanları günceller. | `CompanyService.update(id, companyInfo)` + bridge action `updateCompany` |
| `addCertificate` | `serverSideFuncs.gs` | Yeni sertifika ekler, otomatik ID üretir, Google Calendar'a gözetim etkinliği oluşturur. | `CertificateService.add(crtInfo)` + bridge action `addCertificate` |
| `editCertificateById` | `serverSideFuncs.gs` | Sertifika satırını günceller, varsa Calendar etkinliğini de günceller, yoksa yeni oluşturur. | `CertificateService.update(id, crtInfo)` + bridge action `updateCertificate` |
| `editCell` | `serverSideFuncs.gs` | `Sertifika` sayfasında tek bir hücreyi (id + field) günceller. Hızlı inline düzenleme için. | `CertificateService.updateField(id, field, value)` + bridge action `updateCertificateField` |

#### Grup 2: Test Kayıtları (Öncelik: Orta)
| Legacy Fonksiyon | Dosya | Ne Yapıyor | Hedef Modern Konum |
| :--- | :--- | :--- | :--- |
| `addTest` | `serverSideFuncs.gs` | `Testler` sayfasına yeni test kaydı ekler (firma adı, marka, ürün, lot, tarih, rapor no vb. ~20 alan). | `TestService.add(testInfo)` + bridge action `addTest` |

#### Grup 3: Belge Üretim Verileri — `sertifikaVeri` / `testVeri` (Öncelik: Yüksek)
Bu iki fonksiyon, belge oluşturma motorunun (DocumentService) ihtiyacı olan hazır veri paketini üretiyor. Firma + Sertifika/Test verilerini birleştirip placeholder map'e dönüştürüyorlar.
| Legacy Fonksiyon | Dosya | Ne Yapıyor | Hedef Modern Konum |
| :--- | :--- | :--- | :--- |
| `sertifikaVeri` | `serverSideFuncs.gs` | Belirtilen sertifika ID'si için firma + sertifika verilerini çekerek belge şablonu için hazır placeholder map oluşturur. | `DocumentService.buildCertPayload(id, lang, select)` — internal helper |
| `testVeri` | `serverSideFuncs.gs` | Test ID'si için firma + test verilerini çekerek `testBas` (generateTestReport) fonksiyonunun ihtiyaç duyduğu veriyi hazırlar. | `DocumentService.buildTestPayload(id, lang)` — internal helper |

#### Grup 4: Doküman Şablonu Üretimi (Öncelik: Orta)
| Legacy Fonksiyon | Dosya | Ne Yapıyor | Hedef Modern Konum |
| :--- | :--- | :--- | :--- |
| `draftBas` | `docs.gs` | Belirtilen sertifika için "taslak/draft" sertifika belgesi oluşturur. `isoBas`'a benzer ama farklı şablon kullanır. | `DocumentService.generateDraftCertificate(cert, folderId)` + bridge action `generateDraft` |
| `sozlesme` | `docs.gs` | Firma bilgilerini kullanarak standart Medicert sözleşme şablonundan (`CONTRACT_TEMP`) kopya oluşturur ve placeholder'ları doldurur. | `DocumentService.generateContract(companyInfo)` + bridge action `generateContract` |

#### Grup 5: Logo Ekleme Helper'ları (Öncelik: Orta — DocumentService'e dahil edilmeli)
| Legacy Fonksiyon | Dosya | Ne Yapıyor | Hedef Modern Konum |
| :--- | :--- | :--- | :--- |
| `insertLogoInAllHeaderSections` | `docs.gs` | Belge header bölümündeki `<<logo>>` / `{{logo}}` placeholder'larını gerçek logo görseli ile değiştirir. | `DocumentService._insertLogoInHeaders(doc, logoId)` — internal |
| `insertLogoInBodyAndTables` | `docs.gs` | Belge gövdesindeki ve tablolardaki logo placeholder'larını görsel ile değiştirir. | `DocumentService._insertLogoInBody(doc, logoId)` — internal |
| `testTarihString` | `docs.gs` | ISO string formatındaki tarihi (ör. `2024-01-15T00:00:00`) okunabilir formata çevirir. Test belgeleri için `_formatDate`'in kardeş fonksiyonu. | `DocumentService._formatTestDate(isoString, format, tz)` — internal |

#### Grup 6: Dosya Yükleme (Öncelik: Düşük)
| Legacy Fonksiyon | Dosya | Ne Yapıyor | Hedef Modern Konum |
| :--- | :--- | :--- | :--- |
| `doUpload` | `drive.gs` | Base64 encode edilmiş dosyayı decode ederek firma klasörüne yükler. | `DriveService.uploadFile(firmNickname, fileObj)` + bridge action `uploadFile` |

#### Grup 7: Proforma (Öncelik: Düşük)
| Legacy Fonksiyon | Dosya | Ne Yapıyor | Hedef Modern Konum |
| :--- | :--- | :--- | :--- |
| `gdfProforma` | `serverSideFuncs.gs` | `Proforma` sayfasından belirli bir firmaya ait tüm proforma kayıtlarını getirir. | `ProformaService.getByFirmaId(firmId)` + bridge action `getProformaByFirmaId` |
| `addProInfo` | `serverSideFuncs.gs` | `Proforma` sayfasına yeni proforma kaydı ekler. | `ProformaService.add(proInfo)` + bridge action `addProforma` |
| `proformaVeri` | `serverSideFuncs.gs` | Tek bir proforma kaydını header-value map olarak getirir (belge oluşturma için). | `ProformaService.getById(id)` + bridge action `getProformaById` |

#### Grup 8: Gözetim E-Postası (Öncelik: Orta)
| Legacy Fonksiyon | Dosya | Ne Yapıyor | Hedef Modern Konum |
| :--- | :--- | :--- | :--- |
| `sendSurv` | `serverSideFuncs.gs` | `sendSurv.html` şablonunu kullanarak gözetim dönemi bildirimi e-postası gönderir (kişi adı, firma, standart, sertifika no, tarih aralığı). | `NotificationService.sendSurveillanceEmail(params)` + bridge action `sendSurveillanceEmail`. `sendSurv.html` de Astro'ya migration bekliyor. |
| `sendEmail` | `serverSideFuncs.gs` | Filtrelenmiş sertifika tablosunu HTML olarak `info@medicert.com.tr`'ye gönderir. | `NotificationService.sendTableReport(htmlTable)` + bridge action `sendReport` |
| `monthlyCheck` | `serverSideFuncs.gs` | `Sertifika` sayfasını tarayarak süresi yaklaşan belgeleri bulur, danışman bazında gruplar ve `sendSurv` ile e-posta gönderir. GAS Time-Based Trigger ile otomatik çalışıyor. | `NotificationService.runMonthlyCheck()` — GAS **time trigger** olarak kalabilir, bridge action gerekmeyebilir. |

#### Grup 9: Yardımcı Sorgular (Öncelik: Düşük)
| Legacy Fonksiyon | Dosya | Ne Yapıyor | Hedef Modern Konum |
| :--- | :--- | :--- | :--- |
| `getStandardById` | `serverSideFuncs.gs` | `Standarts` sayfasından standart ID'sine göre standart adı, kısaltma ve diğer alanları getirir. | `StandardService.getById(id)` + bridge action `getStandardById` |
| `lastTwentyFive` | `serverSideFuncs.gs` | `Sertifika` sayfasının son 25 satırını döner. Dashboard'daki "son aktiviteler" widget'ı için kullanılıyor. | `CertificateService.getRecent(limit)` + bridge action `getRecentCertificates` |

---

### 8) 🗑️ Astro Geçişi Nedeniyle İhtiyaç Kalmayan Fonksiyonlar

> Bu fonksiyonlar **hiçbir zaman migration yapılmamalıdır.** Varlık sebebi Astro ile tamamen ortadan kalkmıştır.

#### Kategori A: GAS WebApp HTML Sunumu (`doGet` / HtmlService)
Eski mimaride GAS hem backend hem frontend'di. `doGet()` ile tarayıcıya HTML döndürülüyordu. Astro bu rolü tamamen devraldığı için bu katmana gerek kalmadı.

| Fonksiyon | Dosya | Neden Gerekmiyor |
| :--- | :--- | :--- |
| `doGet` | `load.gs` | GAS WebApp HTTP giriş noktası. Astro'da routing `src/pages/*.astro` dosyaları ile yapılıyor. |
| `serveHtml` | `load.gs` | `HtmlService` ile HTML render + email tabanlı yetkilendirme. Astro layout (`DashboardLayout.astro`) ve middleware bu rolü üstlendi. |
| `loadPartialHTML_` | `loadPartials.gs` | GAS `HtmlService.createTemplateFromFile()` ile partial HTML yükleme. Astro component sistemi (`src/components/`) bu görevi yapıyor. |
| `include` | `loadPartials.gs` | GAS template `<?= include('dosya') ?>` helper'ı. Astro'da `<Component />` sözdizimi ile değiştirildi. |
| `loadSearchView` | `loadPartials.gs` | `search.html` partial'ını yükler → `src/pages/search.astro` ile değiştirildi. |
| `loadAddCompanyView` | `loadPartials.gs` | `addcompany.html` partial'ını yükler → `src/pages/company/add.astro` ile değiştirildi. |
| `loadTableCertificateView` | `loadPartials.gs` | `tableCertificate.html` partial'ını yükler → `src/pages/certificates.astro` ile değiştirildi. |
| `loadCompanyInfoView` | `loadPartials.gs` | `companyinfo.html` partial'ını yükler → `src/pages/company/index.astro` (profil) + `src/pages/company/edit.astro` (düzenleme) ile değiştirildi. |
| `loadDocsView` | `loadPartials.gs` | `addDocs.html` partial'ını yükler → `src/pages/documents/add.astro` ile değiştirildi. |

#### Kategori B: `google.script.run` İletişim Katmanı
Eski mimaride client HTML, `google.script.run.fonksiyonAdi()` ile GAS fonksiyonlarını doğrudan çağırıyordu. Bu GAS'a özgü bir mekanizma. Artık iletişim `fetch()` → Cloudflare Worker → `bridge.gs doPost()` üzerinden yapılıyor.

| Fonksiyon | Dosya | Neden Gerekmiyor |
| :--- | :--- | :--- |
| `returnDanisman` | `serverSideFuncs.gs` | `google.script.run` ile çağrılıyordu → `getConsultants` bridge action olarak `CompanyService.getConsultants()` ile değiştirildi. |
| `returnIso` | `serverSideFuncs.gs` | ISO standart açılır menü verisini döndürür. Modern karşılık: `MasterDataService.getLegacyIso` + bridge `returnIso`. |
| `returnAstandards` | `serverSideFuncs.gs` | Denetim standart/auditor açılır veri setini döndürür. Modern karşılık: `MasterDataService.getLegacyAuditors` + bridge `returnAstandards`. |
| `returnDocuments` | `serverSideFuncs.gs` | `google.script.run` ile doküman şablon listesi döndürüyordu → `getAvailableSets` bridge action ile değiştirildi. |
| `getDataForSearch` | `serverSideFuncs.gs` | `google.script.run` ile search listesi döndürüyordu → `getCompanies` bridge action + IndexedDB/KV cache ile değiştirildi. |
| `getDataForTable` | `serverSideFuncs.gs` | `google.script.run` ile sertifika tablosunu döndürüyordu → `getCertificates` bridge action ile değiştirildi. |

#### Kategori C: GAS Editor'dan Manuel Çalıştırılan Debug / Test Fonksiyonları
Bu fonksiyonlar hiçbir zaman API endpoint'i olmadı. Sadece GAS script editöründen el ile tetikleniyordu. Astro'ya taşınacak bir iş mantıkları yok.

| Fonksiyon | Dosya | Neden Gerekmiyor |
| :--- | :--- | :--- |
| `testEditCertificateById` | `load.gs` | `editCertificateById`'yi test eden geliştirici scripti. |
| `normalizeyitest` | `load.gs` | `normalizeString` fonksiyonunu test eden tek satırlık script. |
| `testdeneme` | `load.gs` | `testVeri` çıktısını loglamak için yazılmış geçici script. |
| `testImageAccess` | `load.gs` | Drive'daki bir görsele erişimi test eden debug scripti. |
| `testGetCompanyById` | `load.gs` | `getCompanyById` çıktısını loglamak için yazılmış debug scripti. |
| `debugRowById` | `load.gs` | Belirli bir satır verisini ham olarak loglamak için debug scripti. |
| `logTestVeri` | `load.gs` | `testVeri` + `testBas` zincirleme debug çağrısı. |
| `testSertifikaVePDF` | `load.gs` | Sertifika + PDF pipeline'ını test eden toplu debug scripti. |
| `tetikleSertifika` | `load.gs` | Batch sertifika trigger scripti — manuel GAS tetikleyicisi. |
| `testMySQLConnection` | `load.gs` | Harici MySQL bağlantı testi (eski altyapı, portal ile ilgisi yok). |
| `triggerHomeAssistant` | `load.gs` | Ev otomasyonu webhook tetikleyicisi (portal ile ilgisi yok). |
| `iLovePDFTest` | `iLovePDF.gs` | iLovePDF API'sini test eden geliştirici scripti. |

#### Kategori D: Tek Seferlik / Deneysel Drive Batch Scriptleri
Bu fonksiyonlar GAS editöründen toplu veri işleme için yazıldı. API endpoint değiller ve mevcut `PDFService` ile örtüşüyorlar.

| Fonksiyon | Dosya | Neden Gerekmiyor |
| :--- | :--- | :--- |
| `convertFilesToPdfPro` | `load.gs` | Drive klasöründeki tüm Google Docs'ları toplu PDF'e çevirir. Bireysel dönüşüm `PDFService.convertToPdf` ile yapılıyor; toplu işlem portal UI'sında `documents/view.astro` üzerinden yürütülüyor. |
| `pdfRaspiToplu` | `load.gs` | `convertFilesToPdfPro`'nun throttle'lı (Utilities.sleep) versiyonu. Aynı nedenle gerekmiyor. |
| `convertGoogleDocToPDF` | `otorobot.gs` | Tek bir hardcoded Doc ID'sini PDF'e çeviriyor. `PDFService._tryLocalConverter` ile değiştirildi. |
| `convertPDFtoPNG` | `otorobot.gs` | PDF'i CloudConvert API üzerinden PNG'ye çeviriyor. Portal'ın ihtiyaçlarına dahil değil. |
| `insertPNGintoGoogleSlidesAndExportToPDF` | `otorobot.gs` | PNG'yi Google Slides'a ekleyip PDF'e aktarıyor. Deneysel pipeline, kullanımda değil. |
| `fullProcess` | `otorobot.gs` | Yukarıdaki 3 fonksiyonu sırayla çağıran zincir. Tüm bağımlılıkları gereksiz olduğundan o da gereksiz. |

---

## 📊 Data Schema & Property Mapping (Definitive)

> [!IMPORTANT]
> **Data Formats:**
> - **Dates:** All dates are stored as **Strings** in the `dd.MM.yyyy` format.
> - **Boolean:** Status flags are represented by **TRUE/FALSE** strings.

### 🏢 Companies (Sheet: `Firmalar`)
| Index | Col | Name | Ref (crtInfo) | Role |
| :--- | :--- | :--- | :--- | :--- |
| **0** | **A** | **Firma No** | `newID` | Primary Key. |
| **1** | **B** | **Firma Adı** | `nickname` | Mnemonic short name for file pathing. |
| **2** | **C** | **Unvan** | `unvan` | Official corporate title. |
| **3** | **D** | **Adres** | `adres` | Physical address. |
| **4** | **E** | **İl** | `sehir` | City. |
| **5** | **F** | **Ülke** | `ulke` | Country (Defaults to TÜRKİYE). |
| **6** | **G** | **Yazışma Adresi** | `yazisma` | Specific mailing address. |
| **7** | **H** | **Vergi Dairesi** | `vergiD` | Tax office name. |
| **8** | **I** | **Vergi Numarası** | `vergiN` | Tax registration number. |
| **9** | **J** | **Telefon** | `tel` | Phone. |
| **10** | **K** | **Faks** | `faks` | Fax. |
| **11** | **L** | **İnternet** | `www` | Website URL. |
| **12** | **M** | **Mail** | `mail` | Contact email. |
| **13** | **N** | **Yetkili Adı** | `yetA` | Signatory name. |
| **14** | **O** | **Yetkili Unvanı** | `yetU` | Signatory title. |
| **15** | **P** | **KYT** | `kyt` | Quality Management Representative. |
| **16** | **Q** | **İrtibat Kişisi** | `irtA` | Contact Person. |
| **17** | **R** | **İrtibat Unvanı** | `irtU` | Contact Title. |
| **18** | **S** | **İrtibat Tel** | `irtN` | Contact Phone. |
| **19** | **T** | **İrtibat Mail** | `irtM` | Contact Mail. |
| **20** | **U** | **Türkçe Kapsam**| `kapsam` | ISO Scope (TR). |
| **21** | **V** | **İngilizce Kapsam**| `scope` | ISO Scope (EN). |
| **22** | **W** | **Yapılan İş** | `yapis` | Nature of business. |
| **23** | **X** | **TCS** | `tcs` | Total Employee Count. |
| **24** | **Y** | **YCS** | `ycs` | Management System Standard Flag. |
| **25** | **Z** | **UCS** | `ucs` | Quality System Standard Flag. |
| **26** | **AA** | **ACS** | `acs` | Environmental System Standard Flag. |
| **27** | **AB** | **YZCS** | `yzcs" | Software System Standard Flag (Yazılım). |
| **28** | **AC** | **TASCS** | `tascs` | Design System Standard Flag (Tasarım). |
| **29** | **AD** | **Alan** | `alan` | Workspace Area Calculation. |
| **30** | **AE** | **Departman** | `dept` | Department listing. |
| **31** | **AF** | **Vardiya** | `vardiya`| Shift Details. |
| **32** | **AG** | **Logo/Kase** | `logoK` | Path to stamps/logos. |
| **33** | **AH** | **Danışman** | `dan` | Company Consultant. |
| **34** | **AI** | **EA** | `ea` | EA Certification Code. |
| **35** | **AJ** | **NACE** | `nace` | Industry Sector Code. |

### 🎖️ Certificates (Sheet: `Sertifika`)
| Index | Col | Name | Ref (crtInfo) | Role |
| :--- | :--- | :--- | :--- | :--- |
| **0** | **A** | **ID** | `newID` | Primary Key. |
| **1** | **B** | **Nickname** | `nick` | Alias. |
| **2** | **C** | **Firma No** | `firmano`| ID Link. |
| **3** | **D** | **Standart** | `standart`| e.g., ISO 9001. |
| **4** | **E** | **Denetim Tipi**| `denetim`| Certification type. |
| **5** | **F** | **sNo** | `sno` | Certificate Number. |
| **6** | **G** | **gst** | `gst` | Cert Date (dd.MM.yyyy). |
| **7** | **H** | **goz** | `goz` | Next Surveillance (dd.MM.yyyy). |
| **8** | **I** | **stt** | `stt` | Last Audit (dd.MM.yyyy). |
| **9** | **J** | **sgt** | `sgt` | Validity Date (dd.MM.yyyy). |
| **10** | **K** | **Kapsam** | `kapsam` | Audit Scope (TR). |
| **11** | **L** | **Scope** | `scope` | Audit Scope (EN). |
| **12** | **M** | **Logo** | `logo` | Logo Path. |
| **13** | **N** | **Kod** | `kod` | NACE Code. |
| **14** | **O** | **Akreditasyon**| `akreditasyon`| Body name. |
| **15** | **P** | **Akredite** | `akredite`| Body status. |
| **16** | **Q** | **Danışman** | `dan` | Consultant name. |
| **17** | **R** | **Durum** | `durum` | Active/Expired. |
| **18** | **S** | **Not** | `not` | General Notes. |
| **19** | **T** | **Gözetim Conf.**| `gozetimConfirmed`| **TRUE/FALSE** status. |
| **20** | **U** | **Other** | `other` | Custom Standard (only if Standart == "Diğer"). |
| **21** | **V** | **Calendar ID**| `eventId` | Google Calendar Event ID. |
| **22** | **W** | **QR Code** | `qr` | QR Metadata/Link. |
| **23** | **X** | **Cert Link** | `certLink` | Direct link to Drive doc. |

### 📅 Audits (Sheet: `Denetim`)

**Terminology:**
- **MD:** Man-Days (Adam/Gün) | **LA:** Lead Auditor (Başdenetçi)
- **FA:** Auditor (Tetkikçi) | **SA:** Sector Expert (Sektör Uzmanı)

| Index | Col | Name | Role |
| :--- | :--- | :--- | :--- |
| **0** | **A** | **ID** | Audit Record ID. |
| **1** | **B** | **Nickname** | Link to Company name. |
| **2** | **C** | **Firma No** | Link to Company ID. |
| **3** | **D** | **Standart** | ISO Standard. |
| **4** | **E** | **Denetim Tipi**| Certification Type. |
| **5-6** | **F-G** | **A1 Auditors** | Auditor (F), Lead Auditor (G). |
| **7-8** | **H-I** | **A2 Auditors** | Auditor (H), Lead Auditor (I). |
| **9-14** | **J-O** | **Stage 1 (A1)** | Dates (J-K), MD (L), LA (M), FA (N), SA (O). |
| **15-20**| **P-U** | **Stage 2 (A2)** | Dates (P-Q), MD (R), LA (S), FA (T), SA (U). |

**Flag Mapping (V-AC Checkboxes):**
- **V (21): QMS** (ISO 9001) | **W (22): MDD** (ISO 13485) | **X (23): EMS** (ISO 14001) | **Y (24): OHS** (ISO 45001)
- **Z (25): FSMS** (ISO 22000) | **AA (26): ISMS** (ISO 27001) | **AB (27): ENGY** (ISO 50001) | **AC (28): GMP** (Good Manufacturing)

**Coverage & Management (AD-AG):**
- **AD-AE (29-30): Coverage** | String description of audit scope (used as Calendar title).
- **AF-AG (31-32): Events** | Stage 1 Event ID (AF), Stage 2 Event ID (AG).

---

## 🔄 Synchronization & Performance Algorithms (v4.0)

### 1. Zero Latency Methodology (Non-Blocking UI)
Used in `edit.astro` and `search.astro`:
- **Step 1:** Instant search in `$companies` (local Nanostore).
- **Step 2:** Render basic info (Unvan, ID, city) immediately (**0ms**).
- **Step 3:** Kick off background `getCompanyById` from KV/GAS.
- **Step 4:** Silently update UI fields as data arrives without blocking user interaction.

### 2. Bulk Sync Procedure
- **Trigger:** Frontend "SİSTEMİ SENKRONİZE ET" button.
- **Flow:** Worker calls `SyncService.getFullSyncData()` -> Fetches thousands of rows -> Saves chunks to **Cloudflare KV** -> Returns success.
- **Result:** Subsequent reads for any specific company or list are served from KV instead of slow GAS.

---

## ⚙️ GAS Script Properties (The "Vault")
- `API_KEY`: `mc-portal-3.0_8a2d7f9e4c1b5a6c3d2e1f0b9a8c7d6e` (Secret used to authenticate POST requests).
- `LAST_UPDATE`: Numeric timestamp (Incremental Sync brain).
- `SPREADSHEET_ID`: Unique ID for the target Google Sheet.
- `GAS_API_URL`: `https://script.google.com/macros/s/AKfycbyc2TdGEAsfO5y_UPSFo748wpTim3b3wfTCoRFK3M_sHUQBYzQY9UzKk6fqvAuO2LL4/exec` (Backend Endpoint).
- `ILOVEPDF_PUBLIC_KEY`: Fallback PDF converter.
- `LOCAL_CONVERTER_TOKEN`: Primary converter (pdf.serdar.cc).

---

## 🔌 API Gateway & Contract (Formal Specification)

### 1. JSON Contract
**Request (POST):**
*(Worker appends `apiKey` internally before forwarding to GAS)*
```json
{
  "action": "string",
  "params": { "id": "integer", "data": "object" },
  "apiKey": "string" 
}
```

**Response (JSON):**
```json
{
  "success": boolean,
  "data": "any | null",
  "error": "string | null"
}
```

---

## 🚀 Production Deployment Workflow
- **Backend (GAS):** Deploy EXE URL (New Version). Set Script Properties.
- **Core (Worker):** `wrangler deploy`. Set `API_KEY` and `GAS_API_URL` secrets.
- **UI (Astro):** `npm run build` -> CF Pages. **CRITICAL:** Set `PUBLIC_WORKER_URL` to `https://portalapi.medicert.com.tr` in Pages Settings. Production UI: `https://portal.medicert.com.tr`.

## 💻 Local Development Guide
1. **Middleware (Worker):** Run `npx wrangler dev`. Ensure local secrets match GAS.
2. **Frontend (Astro):** Run `npm run dev`. Ensure `PUBLIC_WORKER_URL` in `.env` points to local Worker.
3. **GAS Backend:** Ensure `API_KEY` script property is set to `mc-portal-3.0_8a2d7f9e4c1b5a6c3d2e1f0b9a8c7d6e` for local proxy calls.

---
**Status:** Secured, Source-Validated & KV-Primary-Read/Write Active.
**Architecture Version:** 5.5.0
**Current Phase:** 3.6 (KV-primary reads + incremental KV writes + strict CORS allowlist + bulkSync-preserved + Sheets-dependency removal in progress)
