# Medicert Portal (v6.2.1)

Cloudflare Workers + Google Apps Script + Astro 6.x mimarisiyle çalışan kurumsal ISO belgelendirme yönetim portalı. 1.600+ firma ve 5.000+ sertifika kaydını yönetir.

---

## Mimari

```
Browser (IndexedDB + UI)
    │
    ▼
Cloudflare Worker (proxy.js)   ◄──────────────────────┐
    │  WRITE: Worker → GAS → D1 (senkron write-through) │
    │  READ:  Worker → D1 → miss → boş sonuç dön        │
    ▼                                                  │
Cloudflare D1 (SQLite cache)         Google Sheets (Source of Truth)
                                           ▲
                                    Google Apps Script (GAS)
```

| Katman | Rol |
| :--- | :--- |
| **Google Sheets** | **Source of Truth** — tüm kalıcı veri burada yaşar |
| **Cloudflare D1** | **Hızlı Cache / Index** — SQL sorgusu, JOIN, filtre, agregasyon |
| **Cloudflare Worker** | **Secure API Proxy** — CORS, secret inject, routing |
| **Cloudflare KV** | **Yalnızca token / lock** — auth token, mutex (operasyonel veri yok) |
| **Google Apps Script** | **Google-native Engine** — Sheets CRUD + Drive/Calendar/Docs |
| **IndexedDB** | **Browser Cache** — anlık UI render |

---

## Veri Stratejisi

```
Source of Truth:  Google Sheets   ──► tüm kalıcı veri
Cache / Index:    Cloudflare D1   ──► tüm okuma (<10ms), SQL sorguları
Write Path:       Worker → GAS → D1  (GAS başarısız → D1'e dokunulmaz)
Read Path:        D1 hit → dön; miss → boş sonuç (GAS fallback yok)
Offline Cache:    Browser IndexedDB ──► sıfır gecikmeli UI açılışı
```

- **Sheets write path:** Her CRUD önce GAS üzerinden Sheets'e yazılır. GAS başarısız → D1'e dokunulmaz.
- **Google Native İstisna:** Docs, Drive, Calendar, Gmail GAS üzerinden çalışır; D1'e taşınamaz.
- **KV:** Yalnızca `token:confirm:{uuid}` (600s) ve `lock:write:{entity}:{id}` (30s) için kullanılır.

---

## D1 Veritabanı

- **Database:** `medicert-portal`
- **ID:** `94b188bb-1ea8-4b84-ba00-8f7bf91bb265`
- **Bölge:** EEUR (Milano)
- **Binding:** `env.DB_D1`
- **Tablolar:** `companies`, `certificates`, `audits`, `tests`, `proformas`, `standards`, `auditors`, `consultants`, `testdocs`, `sysdocs`, `sync_meta`
- **Şema:** `src/workers/migrations/003_relational_schema.sql`

---

## Backend: Google Apps Script (`src/gas/`)

| Servis | Rol |
| :--- | :--- |
| `BaseService.gs` | Merkezi spreadsheet erişimi, logging |
| `SyncService.gs` | `bulkSync` — Sheets → D1 toplu aktarım |
| `CompanyService.gs` | Firma CRUD (Sheets) |
| `CertificateService.gs` | Sertifika CRUD (Sheets) |
| `TestService.gs` | Test CRUD (Sheets) |
| `ProformaService.gs` | Proforma CRUD (Sheets) |
| `AuditService.gs` | Denetim Sheets CRUD + Google Calendar side-effect |
| `DocumentService.gs` | ISO/test/form belge üretimi |
| `DriveService.gs` | Klasör/dosya yönetimi |
| `PDFService.gs` | PDF dönüşüm |
| `NotificationService.gs` | Gözetim e-postaları |
| `TranslationService.gs` | ISO kapsam metni TR↔EN |

---

## Frontend: Astro 6.x + Tailwind CSS v4

- **Pure Tailwind:** Özel CSS utility sınıfı (`glass`, `form-input` vb.) kullanılmaz; `bg-surface` opak arka planlar zorunludur.
- **Islands Architecture:** Yalnızca etkileşimli bileşenler client-side JS çalıştırır.
- **State Management:** Nanostores + IndexedDB (`idb-keyval`).

---

## Dizin Yapısı

```
src/
├── gas/
│   ├── api/          # GAS servisleri (production)
│   └── legacy/       # Eski GAS kodu (migrasyon referansı)
├── lib/
│   ├── api.ts        # Worker fetch wrapper
│   ├── sync.ts       # SyncManager
│   ├── db.ts         # IndexedDB wrapper
│   ├── store.ts      # Nanostores global state
│   └── config.ts     # PUBLIC_WORKER_URL
├── workers/
│   ├── proxy.js      # Cloudflare Worker
│   └── migrations/   # D1 SQL migration dosyaları
├── features/
│   └── company-ops/  # Firma operasyon context, form helpers
└── pages/
    ├── index.astro         # Dashboard
    ├── search.astro        # Firma arama
    ├── certificates.astro  # Sertifika grid & gözetim
    ├── audits/             # Denetim planlama
    ├── documents/          # Belge üretimi & Drive explorer
    ├── company/            # Firma CRUD, proforma, sertifika
    └── settings.astro      # Master data & sync paneli
```

---

## Kurulum & Geliştirme

```bash
npm install
npm run dev
```

### Production Dağıtımı

```bash
# Cloudflare Worker
wrangler deploy

# Astro build → Cloudflare Pages
astro build
```

**Pages ortam değişkeni:**
```
PUBLIC_WORKER_URL=https://portalapi.medicert.com.tr
```

**Worker Secrets (`wrangler secret put`):**
- `GAS_API_URL` — GAS exec URL
- `API_KEY` — ⚠️ Henüz `wrangler.toml [vars]`'da düz metin; `wrangler secret put API_KEY` ile secret'a taşınması gerekiyor

**İlk deploy sonrası:** Settings sayfasından "SİSTEMİ SENKRONİZE ET" butonu çalıştırılarak Sheets → D1 aktarımı yapılmalıdır.

---

## Platform Limitleri

| Limit | Değer | Notlar |
| :--- | :--- | :--- |
| D1 row reads/gün (free) | 5M | Güvenli bölgede |
| D1 row writes/gün (free) | 100K | Güvenli bölgede |
| D1 storage (free) | 500MB | Mevcut ~50MB |
| GAS execution süresi | 6 dk (free) / 30 dk (Workspace) | bulkSync için Workspace önerilir |

---

**Geliştirici:** Antigravity AI
**Müşteri:** Medicert Ürün ve Sistem Belgelendirme
**Sürüm:** 6.2.1 — Sheets-Primary + D1-Cache Architecture (Son Güncelleme: 19.04.2026)
