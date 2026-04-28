# Portal Core

White-label, çok-tenant kurumsal yönetim portalı framework'ü.  
Cloudflare Workers + Google Apps Script + Astro 6.x ile inşa edilmiştir.

> **İki-Repo Modeli:** Bu repo herkese açık çekirdek koddur. Tenant'a özgü yapılandırma (logo, D1/KV ID'leri, GAS şablon ID'leri, CI/CD) her firma için ayrı bir **private** repoda tutulur.

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
