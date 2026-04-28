# Portal Core

White-label, çok-tenant kurumsal yönetim portalı framework'ü.  
Cloudflare Workers + Google Apps Script + Astro 6.x ile inşa edilmiştir.

> **İki-Repo Modeli:** Bu repo herkese açık çekirdek koddur. Tenant'a özgü yapılandırma (logo, D1/KV ID'leri, GAS şablon ID'leri, CI/CD) her firma için ayrı bir **private** repoda tutulur.

---

## Ürünleme Modeli

Portal Core, entegrasyonları müşteri gözüyle iki ana DLC olarak konumlandırır:

- **Google DLC**: Google ekosistemini kullanan müşteriler için Drive, Gmail, Calendar, Docs ve Gemini tabanlı yetenekleri açar
- **Microsoft DLC**: Microsoft ekosistemini kullanan müşteriler için OneDrive, Outlook, Teams ve SharePoint tabanlı yetenekleri açar

Bu iki DLC birbirinden bağımsızdır. Müşteri:

- yalnızca **Google DLC**
- yalnızca **Microsoft DLC**
- veya ikisini birlikte kullanabilir

Bu üçüncü durum sistem içinde **Hybrid** kullanım modeli olarak ele alınır. Hybrid bir tenant, aynı anda hem Google hem Microsoft entegrasyonlarını aktif çalıştırabilir.

### Ticari Model ve Teknik Model Arasındaki Ayrım

Ürün dili ile teknik mimari bilinçli olarak ayrılmıştır:

- **Ticari katman** müşteriye yalnızca iki ana paket gösterir: `Google DLC` ve `Microsoft DLC`
- **Teknik katman** ise bu paketlerin içindeki servisleri ayrı feature flag'lerle yönetir

Örnek:

- Müşteriye satılan paket: `Google DLC`
- İçeride açılan teknik flag'ler: `feature:google_dlc`, `feature:google_drive_backup`, `feature:google_calendar`, `feature:google_gmail`, `feature:google_gemini`

Aynı mantık Microsoft için de geçerlidir:

- `feature:microsoft_dlc`
- `feature:microsoft_onedrive_backup`
- `feature:microsoft_sharepoint`
- `feature:microsoft_outlook`
- `feature:microsoft_teams`

Bu yaklaşım şu avantajları sağlar:

- müşteriye sade ve anlaşılır ürün sunumu yapılır
- içeride servis bazlı esneklik korunur
- aynı tenant için hibrit senaryolar desteklenir
- yeni provider eklemek gerekirse çekirdek mimari bozulmaz

### Entegrasyon Konfigürasyonu

Google ve Microsoft için non-secret entegrasyon değerleri tek bir provider-agnostic yapı ile yönetilir. Çekirdek yaklaşım:

- provider'a ait klasör ID'leri
- şablon / template ID'leri
- sender identity bilgileri
- site / list / webhook metadata

gibi değerleri tek bir entegrasyon konfigürasyon modeli altında toplar.

Bu modelin amacı şudur:

- Google ve Microsoft entegrasyonları aynı desenle çalışsın
- tenant'a özel sabitler koda gömülmesin
- admin panelinden yönetilebilsin

Kural:

- **non-secret** entegrasyon değerleri veritabanında tutulabilir
- **secret** değerler (`API_KEY`, OAuth client secret, provider private keys vb.) veritabanında tutulmaz
- secret'lar Cloudflare Secrets, GAS Script Properties veya ilgili provider'ın secret mekanizmasında kalır

---

## Mimari (D1-Primary, v7.0)

```
Browser (IndexedDB + UI)
    │
    ▼
Cloudflare Worker (proxy.js)
    │  WRITE: Worker → D1  ──► ctx.waitUntil → GAS (Sheets backup, non-blocking)
    │  READ:  Worker → D1 SQL
    ▼
Cloudflare D1 (SQLite — Source of Truth)
                    ▲
            GAS bulkSync / DailyBackup
                    │
            Google Sheets (Yedek / Raporlama)
```

| Katman | Rol |
| :--- | :--- |
| **Cloudflare D1** | **Source of Truth** — tüm operasyonel veri |
| **Cloudflare Worker** | Secure API proxy — CORS, secret inject, routing |
| **Cloudflare KV** | Yalnızca token / lock / Drive cache |
| **Google Sheets** | Yedek & raporlama — GAS bulkSync ile senkronize |
| **Google Apps Script** | Google-native engine — Sheets CRUD + Drive/Calendar/Docs/Gmail |
| **IndexedDB** | Browser cache — sıfır gecikmeli UI açılışı |

---

## Veri Akışı

```
Write:   Worker → D1 (sync)  +  ctx.waitUntil → GAS → Sheets (async backup)
Read:    D1 hit → dön;  miss → boş sonuç  (GAS fallback yok)
Bulk:    GAS bulkSync → D1 tam yenileme  (Settings sayfası veya zamanlanmış tetikleyici)
```

---

## Backend: Google Apps Script (`src/gas/`)

| Servis | Rol |
| :--- | :--- |
| `BaseService.gs` | Merkezi spreadsheet erişimi, logging |
| `SyncService.gs` | `bulkSync` — Sheets → D1 toplu aktarım |
| `ManualSyncService.gs` | El ile senkronizasyon yardımcıları |
| `CompanyService.gs` | Firma CRUD (Sheets) |
| `CertificateService.gs` | Sertifika CRUD (Sheets) |
| `TestService.gs` | Test CRUD (Sheets) |
| `ProformaService.gs` | Proforma CRUD (Sheets) |
| `AuditService.gs` | Denetim CRUD + Google Calendar |
| `DocumentService.gs` | ISO/test/form belge üretimi |
| `DriveService.gs` | Klasör/dosya yönetimi; `FOLDER_MAP_JSON` Script Property'den okunur |
| `PDFService.gs` | PDF dönüşüm |
| `NotificationService.gs` | Gözetim e-postaları |
| `DailyBackupService.gs` | Gece D1 → Sheets yedekleme + Drive SQL snapshot |
| `bridge.gs` | GAS web app entry point (doAction dispatcher) |

---

## DLC ve Provider Mantığı

Portal Core entegrasyon katmanını **provider tabanlı** tasarlar.

Bugünkü provider'lar:

- `google`
- `microsoft`

Her provider kendi DLC'si ile açılır:

- `Google DLC`
- `Microsoft DLC`

Ancak provider içindeki servisler teknik olarak ayrı ayrı kontrol edilebilir. Bu tasarım kasıtlıdır:

- satış ve paketleme düzeyinde iki ana DLC vardır
- operasyon ve implementasyon düzeyinde alt servis flag'leri bulunur

Bu sayede:

- müşteriye sade paket yapısı sunulur
- proje ekibi servis bazlı aç/kapat ve bakım esnekliği kazanır

Örnek hibrit senaryo:

- backup için `Google Drive`
- e-posta için `Outlook`
- uyarı/işbirliği için `Teams`

Bu kullanım desteklenen ve hedeflenen bir senaryodur; sistem Google ve Microsoft'u birbirini dışlayan yapılar olarak değil, gerektiğinde paralel çalışabilen iki provider olarak ele alır.

---

## Frontend: Astro 6.x + Tailwind CSS v4

- **Tenant alias:** `@tenant/config` → `src/tenant/{TENANT_ID}/config.ts` (build-time env)
- **State:** Nanostores + IndexedDB (`idb-keyval`)
- **PWA:** Service Worker (SW) — sadece statik varlıklar cache'lenir; navigasyon NetworkOnly

---

## Dizin Yapısı

```
src/
├── gas/              # GAS servisleri (tenant-agnostik çekirdek)
├── lib/
│   ├── api.ts        # Worker fetch wrapper
│   ├── sync.ts       # SyncManager
│   ├── db.ts         # IndexedDB wrapper
│   ├── store.ts      # Nanostores global state
│   └── config.ts     # PUBLIC_WORKER_URL + tenant fallback
├── workers/
│   ├── proxy.js      # Cloudflare Worker (D1-Primary)
│   └── migrations/   # D1 SQL migration dosyaları
├── tenant/
│   └── default/      # Boş şablon — tenant reposundaki dosyalar CI'da üstüne kopyalanır
├── features/         # Domain-specific form/context yardımcıları
└── pages/
    ├── index.astro         # Dashboard
    ├── search.astro        # Firma arama
    ├── certificates/       # Sertifika grid & gözetim
    ├── audits/             # Denetim planlama
    ├── documents/          # Belge üretimi & Drive explorer
    ├── company/            # Firma CRUD, proforma, sözleşme
    └── settings.astro      # Master data & sync paneli
```

---

## GAS Script Properties (Tenant Kurulumunda Girilmesi Gerekenler)

| Property | Açıklama |
| :--- | :--- |
| `API_KEY` | CF Worker `API_KEY` ile birebir aynı |
| `WORKER_URL` | Tenant'ın CF Worker URL'si |
| `SPREADSHEET_ID` | Ana Sheets dosyasının ID'si |
| `BACKUP_FOLDER_ID` | Drive SQL snapshot klasörünün ID'si |
| `TENANT_ID` | Tenant kısa adı (örn: `medicert`) |
| `FOLDER_MAP_JSON` | Harf → Drive klasör ID JSON'u |
| `SIGNATURE_ID` | İmza doküman şablonu ID |
| `DRAFT_BG_ID` | Taslak arkaplan ID |
| `APP_FORM_MEDICERT` | Başvuru formu şablon ID |
| `CONTRACT_TEMP` | Sözleşme şablon ID |
| `PROFORMA_TEMP` | Proforma şablon ID |

> Tenant-specific değerler `gas/TenantSetup.gs` scriptiyle tek seferlik atanır.

---

## Tenant ve DLC İlişkisi

Bir tenant için aşağıdaki kombinasyonlardan herhangi biri geçerli olabilir:

1. **D1-only**
Google DLC ve Microsoft DLC kapalıdır. Sistem yalnızca çekirdek veri yönetimi modunda çalışır.

2. **Google tenant**
`Google DLC` açıktır. Google servisleri aktif, Microsoft servisleri pasiftir.

3. **Microsoft tenant**
`Microsoft DLC` açıktır. Microsoft servisleri aktif, Google servisleri pasiftir.

4. **Hybrid tenant**
Hem `Google DLC` hem `Microsoft DLC` açıktır. İki provider aynı tenant içinde paralel çalışabilir.

Bu model ürün seviyesinde nettir:

- tenant bir provider'a mecbur değildir
- provider seçimi tenant bazında yapılır
- ihtiyaç değişirse aynı tenant sonradan hibrit moda geçirilebilir

---

## Yeni Tenant Ekleme

1. Yeni bir **private** repo oluştur (örn: `firma-portal`) — mevcut bir tenant reposunu şablon olarak kullan
2. `src/tenant/{firma}/config.ts` — marka, navigasyon, worker URL'si
3. `wrangler.{firma}.toml` — CF D1, KV binding ID'leri, custom domain
4. CF Dashboard'da D1 ve KV kaynaklarını oluştur
5. GitHub Secrets ekle: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
6. `main`'e push et — CI otomatik devreye girer

---

## Geliştirme

```bash
npm install
npm run dev   # TENANT_ID=medicert otomatik varsayılan
```

```bash
TENANT_ID=firma npm run dev   # Farklı tenant ile lokal test
```
