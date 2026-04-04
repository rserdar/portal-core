# 🤖 Project Intelligence & Context (AI_CONTEXT.md v5.2.0)

> [!IMPORTANT]
> **High-Performance Architecture (v4.0.0):** This project now utilizes **Cloudflare KV** as a primary cache layer. The Cloudflare Worker (`src/workers/proxy.js`) implements a Cache-Aside pattern for high-read actions.
> - **KV Binding:** `env.DB` (linked to Namespace ID: `8eb0dc6ffe2947729b29f0db1c84fd52`).
> - **Strategy:** KV first for reads (0ms latent), GAS for writes.
> - **Bulk Hydration:** A "SİSTEMİ SENKRONİZE ET" button triggers a bulk export from GAS to KV and local IndexedDB.

> [!CAUTION]
> **Mimari Karar — KV-First (v5.3.0):** Hem mevcut hem de henüz migration yapılmamış TÜM fonksiyonlar için geliştirme stratejisi aşağıdaki kurallara göre yapılmalıdır. Bunun tek istisnası Google'ın native servislerini (Docs, Drive, Calendar, Gmail) doğrudan kullanan operasyonlardır — bunlar GAS'tan hiçbir zaman çıkarılamaz.

> [!CAUTION]
> **Saf Tailwind Mimarisi (v5.1.0):** Proje genelinde tüm "glass" (şeffaf) efektler ve özel CSS sınıfları (`glass`, `form-input`) kaldırılmıştır. Tüm UI artık **Saf Tailwind (Pure Tailwind)** utility sınıfları ve opak arka planlar (`bg-surface`) ile yönetilmektedir.

---

## 🏗️ Core Architecture & Data Strategy

### 1. Database & Persistence Layer
- **Primary Database:** **Google Sheets** (Single Source of Truth).
- **Backend Engine:** **Modular Google Apps Script** (GAS) in `src/gas/api/`.
- **Migration In Progress:** Legacy GAS files are preserved in `src/gas/legacy/` as migration reference. Original paths (`src/gas/server/`, `src/gas/client/`) have been removed to avoid confusion.
- **Client Cache:** **IndexedDB** (`medicert-portal-db`) + **Nanostores**.
- **Sync Strategy (v4.0):** 
  1. `syncCheck`: Heartbeat to check for updates.
  2. `bulkSync`: Manual/Full hydration for KV and local IndexedDB. Handles 1600+ companies and 5000+ certificates in minutes.
  3. `Zero-Latency Render`: UI renders local cached data (0ms) while fetching full details from KV/GAS in the background.

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
> **Özetle:** Google'ın native servislerine (Docs, Drive, Calendar, Gmail, LanguageApp) doğrudan bağımlı olmayan her şey KV üzerinden çözülecek. GAS yalnızca bu native servisler için vardır.

### Kural 1 — Okuma (READ) Operasyonları: Her Zaman KV-First

Tüm liste ve tekil kayıt okuma işlemleri `proxy.js` içindeki `cacheableActions` listesine eklenmeli ve Cache-Aside pattern'i ile çalışmalıdır:

```
Browser → CF Worker → KV hit? → Dön (0ms)
                     ↓ miss
                     GAS çağrısı → Sonucu KV'ye yaz (TTL: 7 gün) → Dön
```

**Mevcut `cacheableActions` listesi** (`proxy.js` satır 61-70) — yeni eklenen her READ action buraya eklenmelidir:
| Action | KV Cache Key Formatı | Notlar |
| :--- | :--- | :--- |
| `getCompanies` | `cache:getCompanies:{}` | bulkSync ile hydrate edilir |
| `getCompanyById` | `cache:getCompanyById:{"id":"X"}` | index: `cache:index:companiesById` |
| `getCertificates` | `cache:getCertificates:{}` | bulkSync ile hydrate edilir |
| `getCertificatesByFirmaId` | `cache:getCertificatesByFirmaId:{"firmaId":"X"}` | index: `cache:index:certificatesByFirmaId` |
| `getTestsByFirmaId` | `cache:getTestsByFirmaId:{"firmaId":"X"}` | index: `cache:index:testsByFirmaId` |
| `getAuditsByFirmaId` | `cache:getAuditsByFirmaId:{"firmaId":"X"}` | index: `cache:index:auditsByFirmaId` |
| `getFolderId` | `cache:getFolderId:{"nickname":"X"}` | Drive klasör ID'si değişmez |
| `getRecentFiles` | `cache:getRecentFiles:{"nickname":"X",...}` | Kısa TTL düşünülebilir |
| `getConsultants` | `cache:getConsultants:{}` | **Eklenecek** |
| `getStandardById` | `cache:getStandardById:{"id":"X"}` | **Eklenecek** |
| `getRecentCertificates` | `cache:getRecentCertificates:{"limit":25}` | **Eklenecek** |
| `getProformaByFirmaId` | `cache:getProformaByFirmaId:{"firmaId":"X"}` | **Eklenecek** |
| `getProformaById` | `cache:getProformaById:{"id":"X"}` | **Eklenecek** |
| `getAvailableSets` | `cache:getAvailableSets:{}` | **Eklenecek** |

### Kural 2 — Yazma (WRITE) Operasyonları: GAS Yaz + KV Geçersiz Kıl

Sadece Google Sheets'e veri yazan operasyonlar (Calendar, Docs, Drive **olmadan**) şu pattern'i izler:

```
Browser → CF Worker → GAS (Sheets'e yaz) → Başarılı?
                                            ↓ evet
                      İlgili KV key(ler)ini sil (invalidate) → Dön
```

KV invalidation, `ctx.waitUntil(env.DB.delete(key))` ile worker içinde yapılır. Böylece bir sonraki okumada taze veri GAS'tan çekilip KV'ye yazılır.

| Action | GAS'ta Ne Yapıyor | Sonrasında Silinmesi Gereken KV Key(ler) |
| :--- | :--- | :--- |
| `addCompany` | Sheets'e satır ekler | `cache:getCompanies:{}`, `cache:index:companiesById` |
| `updateCompany` | Sheets'te satır günceller | `cache:getCompanies:{}`, `cache:index:companiesById`, `cache:getCompanyById:{"id":"X"}` |
| `addCertificate` | Sheets'e ekler + Calendar event | `cache:getCertificates:{}`, `cache:index:certificatesByFirmaId`, `cache:getCertificatesByFirmaId:{"firmaId":"X"}` |
| `updateCertificate` | Sheets günceller + Calendar event | Aynı sertifika keyleri |
| `updateCertificateField` | Sheets tek hücre günceller | `cache:getCertificatesByFirmaId:{"firmaId":"X"}`, ilgili cert key |
| `updateSurveillance` | Sheets günceller + Calendar arşiv | İlgili firma cert keyleri |
| `addTest` | Sheets'e ekler | `cache:index:testsByFirmaId`, `cache:getTestsByFirmaId:{"firmaId":"X"}` |
| `scheduleAudit` | Sheets'e ekler + Calendar event | `cache:index:auditsByFirmaId`, `cache:getAuditsByFirmaId:{"firmaId":"X"}` |
| `addProforma` | Sheets'e ekler | `cache:getProformaByFirmaId:{"firmaId":"X"}` |

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

Şu an `getFullExport` şunları döner: `companies`, `certificates`, `certificateRows`, `tests`, `audits`.  
**Eklenecekler:** `proformas`, `consultants` (companies'ten çıkarılabilir), `standards`.

---

## 📂 Technical Directory Matrix

### `/src/gas/api/` (Modern Services)
- `BaseService.gs`: Shared spreadsheet access, logging, and `LAST_UPDATE` management.
- `CompanyService.gs`: Specialized logic for the `Firmalar` sheet. Methods: `getAllForSync`, `getById`, `add`, `getConsultants`.
- `CertificateService.gs`: Specialized logic for the `Sertifika` sheet. Methods: `getAll`, `getById`, `getByFirmaId`, `updateGozetim`.
- `AuditService.gs`: Calendar Integration & Surveillance Archiving. Methods: `getAudits`, `getByFirmaId`, `scheduleAudit`, `updateSurveillance`.
- `DriveService.gs`: Recursive folder scanning and hierarchy management. Methods: `getCompanyFolderId`, `listRecentFiles`, `getOrCreateSubFolder`, `_scanRecursive`.
- `DocumentService.gs`: Batch generation engine for ISO/test/form documents. Methods: `generateIsoCertificate`, `generateTestReport`, `generateAppForm`, `getAvailableSets`, `prepareBatchFolders`, `generateSingleBatchDoc`.
- `PDFService.gs`: **Primary Converter:** Local `pdf.serdar.cc` (with Token). **Fallback:** iLovePDF. Methods: `convertToPdf`, `_tryLocalConverter`, `_tryILovePDF`.
- `TestService.gs`: Specialized logic for the `Testler` sheet. Methods: `getByFirmaId`.
- `SyncService.gs`: Full data export for Cloudflare KV bulk hydration. Methods: `getFullExport`.
- `TranslationService.gs`: Specialized automated translation for ISO scope text (TR↔EN) via GAS `LanguageApp`. Methods: `translate`, `toEn`, `toTr`. **Note:** Operational tool for data entry, not UI localization.

### `/src/lib/` (Core Logic)
- `api.ts`: Fetch wrapper for CF Worker.
- `sync.ts`: **The Brain.** Implements the decision tree for incremental background synchronization.
- `db.ts`: `idb-keyval` wrapper for structured IndexedDB access.
- `store.ts`: Defines shared global stores (`$companies`, `$certificates`, `$syncStatus`, `$lastSyncTime`).
- `config.ts`: Central config. Reads `PUBLIC_WORKER_URL` from env, exposes `CONFIG.WORKER_URL`.

### `/src/workers/` (Cloudflare Worker)
- `proxy.js`: **The deployed Cloudflare Worker.** Handles CORS, injects `API_KEY` secret into every request body before forwarding to GAS. Copy-paste this file into the Cloudflare Worker dashboard or deploy via `wrangler deploy`.

### `/src/pages/` (UI Modules)
- `index.astro`: Reactive Dashboard.
- `search.astro`: Cached company lookup.
- `company/add.astro`: Registration & Property Mapping.
- `certificates.astro`: Grid view & Bulk Surveillance updates.
- `documents/add.astro`: Batch document production.
- `documents/view.astro`: Recursive Drive Explorer & PDF conversion management.
- `audits/index.astro`: Audit timeline & Calendar overview.
- `audits/add.astro`: New audit scheduling form (Stage 1/2 calendar integration).

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
| `serverSideFuncs.gs#editCompanyById` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#returnDanisman` | `CompanyService.getConsultants` | `getConsultants` | Renamed/Refactored |
| `serverSideFuncs.gs#getDataForSearch` | `CompanyService.getAllForSync` | `getCompanies` | Renamed/Refactored |
| `serverSideFuncs.gs#getDataForTable` | `CertificateService.getAll` | `getCertificates` | Renamed/Refactored |
| `serverSideFuncs.gs#gdfCertificate` | `CertificateService.getAll` | `getCertificates` | Renamed/Refactored |
| `serverSideFuncs.gs#getCertificateById` | `CertificateService.getById` | `getCertificateById` | Exact |
| `serverSideFuncs.gs#getCertificatesByFirmaId` | `CertificateService.getByFirmaId` | `getCertificatesByFirmaId` | Renamed/Refactored |
| `serverSideFuncs.gs#addCertificate` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#editCertificateById` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#editSurvMultiple` | `AuditService.updateSurveillance` | `updateSurveillance` | Renamed/Refactored |
| `serverSideFuncs.gs#addAuditInfo` | `AuditService.scheduleAudit` | `scheduleAudit` | Renamed/Refactored |
| `serverSideFuncs.gs#gdfTest` | `TestService.getByFirmaId` | `getTestsByFirmaId` | Renamed/Refactored |
| `serverSideFuncs.gs#addTest` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#returnTest` | `TestService.getByFirmaId` | `getTestsByFirmaId` | Renamed/Refactored |
| `serverSideFuncs.gs#xtranslate` | `TranslationService.toEn` | `translate` (`toEn=true`) | Renamed/Refactored |
| `serverSideFuncs.gs#ytranslate` | `TranslationService.toTr` | `translate` (`toEn=false`) | Renamed/Refactored |
| `serverSideFuncs.gs#monthlyCheck` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#sendSurv` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#editCell` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#sendEmail` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#gdfProforma` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#addProInfo` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#proformaVeri` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#getStandardById` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#returnIso` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#returnAstandards` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#sertifikaVeri` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#testVeri` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#veriCekVeYaz` | `SyncService.getFullExport` | `getFullSyncData` | Renamed/Refactored |
| `serverSideFuncs.gs#testleriCekVeYaz` | `SyncService.getFullExport` | `getFullSyncData` | Renamed/Refactored |
| `serverSideFuncs.gs#lastTwentyFive` | ❌ Karşılığı yok | — | **Pending** |
| `serverSideFuncs.gs#returnDocSelect` | `DocumentService.getAvailableSets` | `getAvailableSets` | Renamed/Refactored |
| `serverSideFuncs.gs#returnDocuments` | `DocumentService.getAvailableSets` | `getAvailableSets` | Renamed/Refactored |
| `serverSideFuncs.gs#createDocumentSetProgressive` | `DocumentService.prepareBatchFolders` + `generateSingleBatchDoc` | `prepareBatchFolders` + `generateSingleBatchDoc` | Renamed/Refactored |

### 2) Drive & Document Migration
| Legacy Function (`src/gas/legacy/server`) | Modern Function (`src/gas/api`) | Bridge Action | Status |
| :--- | :--- | :--- | :--- |
| `drive.gs#ilkKarekter` | `DriveService.getCompanyFolderId` | `getFolderId` / internal | Renamed/Refactored |
| `drive.gs#getFilesFromFolder` | `DriveService.listRecentFiles` | `getRecentFiles` | Renamed/Refactored |
| `drive.gs#getFilesFromFolderRecursiveHelper` | `DriveService._scanRecursive` | Internal | Renamed/Refactored |
| `drive.gs#doUpload` | ❌ Karşılığı yok | — | **Pending** |
| `docs.gs#isoBas` | `DocumentService.generateIsoCertificate` | `generateIso` | Renamed/Refactored |
| `docs.gs#testBas` | `DocumentService.generateTestReport` | — (bridge pending) | Renamed/Refactored |
| `docs.gs#basFormu` | `DocumentService.generateAppForm` | — (bridge pending) | Renamed/Refactored |
| `docs.gs#draftBas` | ❌ Karşılığı yok | — | **Pending** |
| `docs.gs#sozlesme` | ❌ Karşılığı yok | — | **Pending** |
| `docs.gs#sertifikaDate` | `DocumentService._formatDate` | Internal | Renamed/Refactored |
| `docs.gs#testTarihString` | ❌ Karşılığı yok | — | **Pending** |
| `docs.gs#replaceTextToImage` | `DocumentService._replaceImage` | Internal | Renamed/Refactored |
| `docs.gs#generateAndReplaceQrCode` | `DocumentService._generateQr` | Internal | Renamed/Refactored |
| `docs.gs#prepareDocumentFolders` | `DocumentService.prepareBatchFolders` | `prepareBatchFolders` | Renamed/Refactored |
| `docs.gs#createSingleDocument` | `DocumentService.generateSingleBatchDoc` | `generateSingleBatchDoc` | Renamed/Refactored |
| `docs.gs#docsReplaceAllPh` | `DocumentService._processReplacements` | Internal | Renamed/Refactored |
| `docs.gs#docsGetOrCreateFolder` | `DriveService.getOrCreateSubFolder` | Internal | Renamed/Refactored |
| `docs.gs#insertLogoInAllHeaderSections` | ❌ Karşılığı yok | — | **Pending** |
| `docs.gs#insertLogoInBodyAndTables` | ❌ Karşılığı yok | — | **Pending** |

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
| `serverSideFuncs.gs` | `editCompanyById`, `addCertificate`, `editCertificateById`, `addTest`, `editCell`, `sendEmail`, `monthlyCheck`, `sendSurv`, `gdfProforma`, `addProInfo`, `proformaVeri`, `getStandardById`, `returnIso`, `returnAstandards`, `sertifikaVeri`, `testVeri`, `lastTwentyFive` | **Pending** — modern servislerde karşılığı henüz yazılmamış |
| `docs.gs` | `draftBas`, `sozlesme`, `testTarihString`, `insertLogoInAllHeaderSections`, `insertLogoInBodyAndTables` | **Pending** — DocumentService'e henüz taşınmadı |
| `drive.gs` | `doUpload` | **Pending** — DriveService'e henüz taşınmadı |

### 5) Legacy Client HTML -> Astro Route Migration (src/gas/legacy/client/)
> **NOT:** Bu dosyalar `src/gas/legacy/client/` klasöründe referans olarak korunmaktadır. Migrasyon tamamlanmadıkça silinmemelidir.

| Legacy Client File | Modern Astro Route | Status | Notes |
| :--- | :--- | :--- | :--- |
| `src/gas/legacy/client/companyinfo.html` | `src/pages/company/edit.astro` | Migrated | Legacy monolith replaced by modern Astro modules. |
| `src/gas/legacy/client/other.html` | `src/pages/other.astro` | Migrated | Modern unauthorized-access page. |
| `src/gas/legacy/client/main.html` | `src/pages/index.astro` | Pending | Dashboard — needs review and comparison. |
| `src/gas/legacy/client/search.html` | `src/pages/search.astro` | Pending | Company search — needs feature parity check. |
| `src/gas/legacy/client/addcompany.html` | `src/pages/company/add.astro` | Pending | Company registration form — needs field mapping validation. |
| `src/gas/legacy/client/tableCertificate.html` | `src/pages/certificates.astro` | Pending | Certificate grid — needs Tabulator parity check. |
| `src/gas/legacy/client/addDocs.html` | `src/pages/documents/add.astro` | Pending | Batch document production form. |
| `src/gas/legacy/client/sendSurv.html` | (Not yet created) | Pending | Surveillance email template — no modern route yet. |

### 6) 🐛 Mevcut Modern Servislerin Kalite Analizi (Source-Validated)

> Bu bölüm `src/gas/api/` altındaki her servisin legacy kodu ile karşılaştırılarak tespit edilen **aktif hatalar, eksikler ve geliştirme noktalarını** listeler. Kod yazılmadan önce bu notlar mutlaka okunmalıdır.

#### BaseService.gs

| # | Sorun | Etki | Çözüm |
| :- | :--- | :--- | :--- |
| 1 | `getDataAsObjects` içinde `Logger.log("--- DEDEKTİF MODU ---")` debug logları production kodda kaldı. Her çağrıda GAS loguna yazar, maliyetli. | Her `getCompanies`, `getCertificates` çağrısında gereksiz log. | Tüm `Logger.log` satırlarını kaldır. |
| 2 | `getNextId`'de `Math.max(...ids)` spread operatörü kullanılıyor. 1600+ firma gibi büyük dizilerde JavaScript call stack sınırını aşar ve crash'e neden olur. | `addCompany` veya büyük tablolarda ID üretimi patlar. | `ids.reduce((max, v) => v > max ? v : max, 0)` ile değiştir. |
| 3 | `getDataAsObjects` `getValues()` kullanıyor, `getDisplayValues()` değil. Sheets'teki tarih sütunları (`dd.MM.yyyy`) JavaScript `Date` object olarak döner, string olarak değil. | `gst`, `goz`, `stt`, `sgt` alanları string değil Date object döner; `dd.MM.yyyy` formatı bozulur. | `getValues()` → `getDisplayValues()` yap. |

#### CertificateService.gs

| # | Sorun | Etki | Çözüm |
| :- | :--- | :--- | :--- |
| 4 | `getById` tüm sertifika listesini yükleyip JS'de filtreler. Legacy `getCertificateById` direkt sheet'te satır arar. | 5000+ sertifikada her tekil sorguda tablo tamamen okunur → yavaş ve GAS kotası tüketir. | Legacy gibi doğrudan ID sütunu taraması yap. |
| 5 | `updateGozetim` header adı olarak `"Gözetim"` arıyor. Gerçek sheet başlığı `"Gözetim Conf."` (AI_CONTEXT şema, indeks 19). | Sütun hiçbir zaman bulunamaz, her çağrı `"Gözetim sütunu bulunamadı"` döner. **Aktif bug.** | Header aramasını `"Gözetim Conf."` olarak düzelt veya sabit sütun indeksi (20) kullan. |
| 6 | `getById` legacy'den farklı: legacy `getDisplayValues()` ile okuyor ve `gozetim` alanını `boolean`'a dönüştürüyor. Modern sadece ham obje döndürüyor. | Downstream kod `gozetim: true/false` beklerken string `"TRUE"/"FALSE"` alır. | Legacy mantığıyla `gozetimConfirmed` alanını `boolean`'a çevir. |

#### AuditService.gs

| # | Sorun | Etki | Çözüm |
| :- | :--- | :--- | :--- |
| 7 | `updateSurveillance`'da takvim etkinliği taşındıktan sonra oluşan **yeni event ID sheet'e geri yazılmıyor**. Legacy `editSurvMultiple` kesinlikle `ws.getRange(rowNumber, 22).setValue(newEvent.getId())` yapıyor. Modern serviste bu satır eksik — yorum olarak not düşülmüş: `"Not: ID güncellenebilir ancak genelde gerek duyulmaz"`. | Bir sonraki `updateSurveillance` çağrısında eski (silinmiş) event ID kullanılır → etkinlik bulunamaz, takvim senkronu kalıcı olarak bozulur. **Aktif bug.** | `event.deleteEvent()` sonrası `ws.getRange(rowNum, 22).setValue(newEventId)` ekle. |
| 8 | `updateSurveillance`'da `event.getGuestList()` kopyalanmıyor. Legacy bunu yapıyor: `guests: event.getGuestList().map(g => g.getEmail()).join(",")`. | Taşınan etkinliğin davetlileri kaybolur. | `createEvent` options'ına `guests` ekle. |
| 9 | `scheduleAudit`'te ID üretimi `ws.getRange(lastRow, 1).getValue() + 1` ile yapılıyor. Boş satır varsa veya son satır ID değilse yanlış ID üretilir. | Duplicate veya yanlış ID riski. | `BaseService.getNextId("Denetim")` kullan. |
| 10 | `getAudits` dönüş objesi çok sınırlı (sadece 8 alan). Legacy `addAuditInfo`'nun yazdığı 33 kolonun büyük kısmı eksik: MD alanları, LA/FA/SA, tüm flag'lar (QMS, EMS...), coverage alanları. | Denetim listesi sayfası eksik veri gösterir. | Dönüş objesine eksik alanları ekle. |

#### DocumentService.gs

| # | Sorun | Etki | Çözüm |
| :- | :--- | :--- | :--- |
| 11 | `generateAppForm` **stub implementasyon**: Sadece dosyayı kopyalıyor, placeholder'ları doldurmıyor. Yorumda `// Form doldurma mantığı buraya eklenir...` yazıyor. | Oluşturulan başvuru formu boş template, firma bilgileri yok. | Legacy `basFormu` fonksiyonundan field mapping'i al ve `_processReplacements` ile doldur. |
| 12 | `getAvailableSets` ve `prepareBatchFolders` sheet adı olarak `"DokümanŞablonları"` veya `"Templates"` arıyor. Legacy'de gerçek sheet adı **`"SysDoc"`**. | Her iki fonksiyon her zaman boş döner / crash alır. **Aktif bug.** | Sheet adını `"SysDoc"` olarak düzelt. |
| 13 | `generateIsoCertificate`'de logo sadece body'e (`_replaceImage`) ekleniyor. Legacy `isoBas` ayrıca `insertLogoInAllHeaderSections` çağırarak header'daki logoyu da değiştiriyor. | Header bölümündeki `<<logo>>` placeholder'ları boş kalır. | `insertLogoInAllHeaderSections` / `insertLogoInBodyAndTables` modern servisler yazılana kadar eksik. |
| 14 | `_generateQr` `addPositionedImage` (float) kullanıyor. Legacy `generateAndReplaceQrCode` inline image yerleştiriyor ve tablo içi kontrolü var. Offset'ler hardcoded (509, 6) — şablona göre değişebilir. | QR kodu yanlış konumda veya şablona göre bozuk görünebilir. | Legacy QR mantığını incele, tablo/footer kontrolü ekle. |

#### PDFService.gs

| # | Sorun | Etki | Çözüm |
| :- | :--- | :--- | :--- |
| 15 | `_tryILovePDF` **hiç implement edilmemiş**: `return { success: false, error: "iLovePDF Fallback şu an konfigürasyon bekliyor." }` döndürüyor. Legacy `iLovePDF.gs`'de tam çalışan Auth→Task→Upload→Process→Download zinciri var. | Local converter (`pdf.serdar.cc`) başarısız olduğunda PDF dönüştürme tamamen çalışmaz. **Kritik fallback eksik.** | `iLovePDF.gs`'deki tüm zinciri `_tryILovePDF` içine taşı. |

#### SyncService.gs

| # | Sorun | Etki | Çözüm |
| :- | :--- | :--- | :--- |
| 16 | Her sheet okuma ayrı `try/catch` ile korunmuyor. Bir sheet başarısız olursa (örn. "Testler" sayfası yoksa) tüm export başarısız olur. | Kısmi hata tüm `bulkSync`'i patlatır. | Her veri kaynağını ayrı `try/catch` ile sar, hata durumunda `[]` döndür. |
| 17 | KV-First Kural 4'e göre `getFullExport` proformas, consultants, standards verilerini içermiyor. Cold-start'ta bu veriler cache'siz kalır. | İlk açılışta bu veriler GAS'tan çekilmek zorunda kalır. | Kural 4 uygulandığında `SyncService.getFullExport`'a bu sheet'leri ekle. |

---

### 7) 🔧 Çevrilmesi Gereken Ama Henüz Çevrilmemiş Fonksiyonlar

> Bu fonksiyonlar production'da aktif olarak kullanılan iş mantıkları içeriyor. Modern `src/gas/api/` servislerine eklenmesi ve `bridge.gs`'de action olarak tanımlanması gerekiyor.

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
| `loadCompanyInfoView` | `loadPartials.gs` | `companyinfo.html` partial'ını yükler → `src/pages/company/edit.astro` ile değiştirildi. |
| `loadDocsView` | `loadPartials.gs` | `addDocs.html` partial'ını yükler → `src/pages/documents/add.astro` ile değiştirildi. |

#### Kategori B: `google.script.run` İletişim Katmanı
Eski mimaride client HTML, `google.script.run.fonksiyonAdi()` ile GAS fonksiyonlarını doğrudan çağırıyordu. Bu GAS'a özgü bir mekanizma. Artık iletişim `fetch()` → Cloudflare Worker → `bridge.gs doPost()` üzerinden yapılıyor.

| Fonksiyon | Dosya | Neden Gerekmiyor |
| :--- | :--- | :--- |
| `returnDanisman` | `serverSideFuncs.gs` | `google.script.run` ile çağrılıyordu → `getConsultants` bridge action olarak `CompanyService.getConsultants()` ile değiştirildi. |
| `returnIso` | `serverSideFuncs.gs` | `google.script.run` ile ISO standart listesi döndürüyordu → Standart listesi Astro'da statik olarak tanımlanıyor. |
| `returnAstandards` | `serverSideFuncs.gs` | `google.script.run` ile denetim standartlarını döndürüyordu → Astro'da statik tanım ile değiştirilecek. |
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
**Status:** Secured, Code-Verified & Complete.
**Architecture Version:** 4.0.0 (The Velocity Update)

---

## 🚀 v5.0.0 Architecture & Performance Addendum

### ⚡ True Zero Latency (CF KV Indexing)
Achieved through manual optimization and WOW Phase redesign:
- **Indexing:** During `bulkSync`, the Worker builds firm-specific lookup maps in KV: `companiesById`, `certsByFirmaId`, `testsByFirmaId`, `auditsByFirmaId`.
- **Deduplication:** `api.ts` implements `inFlightRequests` Map to prevent redundant concurrent calls.
- **Stable Keys:** Implements `stableStringify` for consistent KV hits.
- **Cache Policy:** 7-Day TTL with background refreshing.

### 🎨 Modern UI Standards (v5.0.0)
- **Framework:** Astro 6.x + Tailwind CSS (Premium Glassmorphism).
- **Iconography:** **Lucide-Astro**.
- **Monitoring:** Real-time Health Panel for KV Backend and GAS Gateway connectivity.
- **Dashboard:** Animated stat cards, Sync Pulse visual indicators, and high-density typography.

---
**Status:** Secured, Legacy-Preserved & Velocity-Optimized.
**Architecture Version:** 5.0.0 (The Velocity Update)
