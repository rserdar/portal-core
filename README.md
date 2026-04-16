# Medicert Portal (v5.8.0)

Geleneksel bir Google Apps Script (GAS) altyapısının **Astro 6.x**, **Tailwind CSS v4** ve **Cloudflare Workers** mimarisiyle yeniden doğuşu. 1.600+ firma ve 5.000+ sertifika kaydını milisaniye gecikmeyle yöneten, offline çalışabilen kurumsal bir yönetim portalı.

---

## Mimari

### 1. Frontend: Astro 6.x + Tailwind CSS v4

- **Pure Tailwind:** Tüm UI, Tailwind utility sınıfları ve opak arka planlar (`bg-surface`) ile yönetilir. Özel CSS utility sınıfı (`glass`, `form-input` vb.) kullanılmaz.
- **Islands Architecture:** Sadece etkileşimli bileşenler (Arama, Senkronizasyon, Formlar) client-side JS çalıştırır; maksimum sayfa hızı sağlanır.
- **State Management:** Veriler **Nanostores** üzerinden reaktif yönetilir, **IndexedDB** (`idb-keyval`) ile offline saklanır.
- **PWA:** Service Worker ile offline çalışma ve uygulama kurulumu. Cloudflare Access internal path'leri (`/cdn-cgi/`) SW kapsamı dışında tutulur.

### 2. Middleware: Cloudflare Worker (`src/workers/proxy.js`)

- **KV-Primary Database:** Hem okuma hem yazma için birincil veri deposu Cloudflare KV (`env.DB`).
- **Security Proxy:** GAS API anahtarını tarayıcıdan saklayan güvenli katman.
- **CORS Allowlist:** Yalnızca whitelist origin'ler kabul edilir; dışındaki browser istekleri 403 ile reddedilir.
- **Incremental Write:** `bulkSync`/`importBackup` dışındaki write path'ler yalnızca etkilenen KV key'lerini günceller — full dataset rebuild yasaktır.

### 3. Backend: Modüler Google Apps Script (`src/gas/api/`)

GAS artık **Google-native side-effect motoru** rolündedir; authoritative data store değildir:

| Servis | Rol |
| :--- | :--- |
| `BaseService.gs` | Merkezi spreadsheet erişimi, logging — yalnızca backup/hydration |
| `SyncService.gs` | `bulkSync` / `exportBackup` / `importBackup` — KV hydration ve yedekleme |
| `AuditService.gs` | Google Calendar entegrasyonu — side-effect olarak çalışır |
| `DocumentService.gs` | ISO/test/form belge üretimi — hazır payload consume eder |
| `DriveService.gs` | Klasör/dosya yönetimi |
| `PDFService.gs` | Birincil: `pdf.serdar.cc`, yedek: iLovePDF |
| `NotificationService.gs` | Gözetim e-postaları, aylık kontrol |
| `TranslationService.gs` | ISO kapsam metni TR↔EN (`LanguageApp`) |

---

## Veri Stratejisi

```
Birincil DB:   Cloudflare KV  ──►  tüm operasyonel okuma/yazma
Yedek/Restore: Google Sheets  ──►  yalnızca bulkSync, exportBackup, importBackup
Offline Cache: Browser IndexedDB  ──►  sıfır gecikmeli UI açılışı
```

- **Google Native İstisna:** Docs, Drive, Calendar, Gmail operasyonları GAS üzerinden çalışır; bunlar hiçbir zaman KV'ye taşınamaz.
- **KV Granüler Yapısı:** Her firma `cache:company:{id}` + `cache:index:companies:search`; her sertifika `cache:getCertificateById:{stableKey}` + `cache:getCertificatesByFirmaId:{stableKey}` üzerinden yönetilir. Monolitik key'ler (`cache:index:companiesById` vb.) kaldırılmıştır.
- **Sync Akışı:** KV miss → Worker `503 + needsHydration=true` → `SyncManager` otomatik `bulkSync` → tekrar okuma.

---

## Öne Çıkan Özellikler

### Arama & Sayfalama
- **@ Operatörü:** `Firma @ Şehir` yazarak konuma duyarlı filtreleme (örn: `Medicert @ İzmir`).
- **Dinamik Sayfalama:** 20 / 50 / 100'lük seçenekler, anlık ünvan/marka/ID araması.

### Senkronizasyon
- **Bulk Sync (KV):** Dashboard'dan tek tuşla tüm veriyi CF edge noktalarına yazar (~8.000–10.000 KV write/çalıştırma).
- **Bidirectional Backup:** `exportBackup` ile JSON paketi dışa aktarma; `importBackup` ile Sheets'e geri yükleme (iki aşamalı onay protokolü).

### Belge & Takvim
- **Batch Belge Üretimi:** Google Docs şablonlarından toplu ISO sertifikası, denetim raporu, başvuru formu üretimi.
- **Calendar Entegrasyonu:** Denetim tarihleri Google Takvim'e yazılır (şu an geçici devre dışı — KV altyapısı tamamlandıktan sonra devreye alınacak).

### Ayarlar Paneli
- **Master Data Yönetimi:** Standartlar, denetçiler, danışmanlar KV üzerinden okunur ve güncellenir.
- **Manuel Sync Butonları:** Sheets → KV tetikleyicileri.

---

## Dizin Yapısı

```
src/
├── gas/
│   ├── api/          # Modern GAS servisleri (production)
│   └── legacy/       # Eski GAS kodu (migrasyon referansı — silinmemeli)
├── lib/
│   ├── api.ts        # CF Worker fetch wrapper
│   ├── sync.ts       # SyncManager — incremental background sync
│   ├── db.ts         # IndexedDB wrapper (idb-keyval)
│   ├── store.ts      # Nanostores global state
│   └── config.ts     # PUBLIC_WORKER_URL ortam değişkeni
├── workers/
│   └── proxy.js      # Cloudflare Worker (deploy: wrangler deploy)
├── features/
│   └── company-ops/  # Firma operasyon context, form helpers
└── pages/
    ├── index.astro         # Dashboard
    ├── search.astro        # Firma arama
    ├── certificates.astro  # Sertifika grid & toplu gözetim
    ├── audits/             # Denetim planlama
    ├── documents/          # Belge üretimi & Drive explorer
    ├── company/            # Firma CRUD, proforma, sertifika, draft, sözleşme
    └── settings.astro      # Master data & sync paneli
```

---

## Kurulum & Geliştirme

```bash
# Bağımlılıkları yükle
npm install

# Geliştirme sunucusu
npm run dev

# PWA ikonlarını üret
npm run generate-pwa-assets
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
- `API_KEY` — GAS kimlik doğrulama
- `GAS_API_URL` — GAS exec URL

**İlk deploy sonrası:** Dashboard'dan "SİSTEMİ SENKRONİZE ET (KV)" butonu **bir kez** çalıştırılmalıdır.

---

## Platform Limitleri (Özet)

| Limit | Değer | Notlar |
| :--- | :--- | :--- |
| KV max değer boyutu | 25 MiB/key | Granüler tasarım güvenli bölgede |
| KV free write | 1.000/gün | `bulkSync` ~8-10K write → **Workers Paid gerekli** |
| GAS execution süresi | 6 dk (free) / 30 dk (Workspace) | `bulkSync` için Workspace hesabı önerilir |
| GAS e-posta | 100/gün (free) / 1.500/gün (Workspace) | `runMonthlyCheck` Workspace gerektirebilir |

---

**Geliştirici:** Antigravity AI
**Müşteri:** Medicert Ürün ve Sistem Belgelendirme
**Sürüm:** 5.8.0 — Granular KV Architecture
