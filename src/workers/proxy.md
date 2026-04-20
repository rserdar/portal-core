# Medicert Portal Proxy (Worker) Documentation

Bu doküman, `src/workers/proxy.js` içerisinde yer alan tüm fonksiyonların (handler) teknik detaylarını ve portal içerisindeki sayfa/bileşen bağlantılarını içerir.

---

## 🏗️ Mimari Özet
Proxy sistemi **Dispatcher Pattern** (O(1) Domain Logic) kullanır.
- **Source of Truth (Ana Kaynak):** Cloudflare D1.
- **Backup Layer (Yedekleme):** Google Sheets (Asenkron `syncToBackup` ile güncellenir).
- **Caching:** KV (Cloudflare Key-Value) Drive klasörleri ve dosya listeleri için kullanılır.

---

## 🛰️ SyncHandlers (Sistem ve Senkronizasyon)

### `bulkSync`
*   **Detay:** Google Sheets'teki tüm verileri (Firma, Sertifika, Denetim vb.) D1 veritabanına toplu olarak yansıtır.
*   **Bağlantılar:** 
    - `/settings.astro` (Tam Senkronizasyon Butonu)
    - `proxy.js` internal `scheduled` (Haftalık otomatik bulk sync)

### `exportData / exportBackup`
*   **Detay:** D1 veritabanındaki verileri SQL formatında dışa aktarır.
*   **Bağlantılar:** `/settings.astro` (Yedek Al Butonu), `DailyBackupService.gs`.

### `importBackup`
*   **Detay:** SQL yedeğini önce D1 (Sheets) tarafına, sonra D1'e işler.
*   **Bağlantılar:** `/settings.astro` (Yedek Yükle).

### `syncCheck`
*   **Detay:** D1 bağlantısını ve senkronizasyon meta verilerini doğrular.
*   **Bağlantılar:** Footer / Stats bileşenleri.

### `rebuildStats`
*   **Detay:** Dashboard istatistiklerini D1 üzerinden yeniden hesaplar.
*   **Bağlantılar:** `index.astro` (Ana Sayfa), `update/add` handlerları.

---

## 🏢 CompanyHandlers (Firma Yönetimi)

### `getCompanies`
*   **Detay:** Firmaları ve en son sertifika kapsamlarını `LEFT JOIN` ile çeker.
*   **Bağlantılar:** `/companies/index.astro`.

### `getCompanyById`
*   **Detay:** ID bazlı firma detayı D1'den getirir.
*   **Bağlantılar:** `/companies/[id]/edit.astro`, `/companies/[id]/view.astro`.

### `addCompany`
*   **Detay:** Yeni firma ekler (D1 First -> Async Backup).
*   **Bağlantılar:** `/companies/add.astro`.

### `updateCompany`
*   **Detay:** Firma bilgilerini günceller (D1 First -> Async Backup).
*   **Bağlantılar:** `/companies/[id]/edit.astro`.

---

## 🎖️ CertificateHandlers (Sertifika Yönetimi)

### `getDashboardSummary`
*   **Detay:** Aktif/Bekleyen sertifika sayılarını ve grafikleri döner.
*   **Bağlantılar:** `index.astro`.

### `getCertificateSummaries`
*   **Detay:** Sertifika özet listesini firma bilgileriyle birleştirir.
*   **Bağlantılar:** `/certificates/index.astro`.

### `addCertificate / updateCertificate`
*   **Detay:** Sertifika CRUD işlemleri (D1 First -> Async Backup).
*   **Bağlantılar:** `/certificates/add.astro`, `/certificates/edit.astro`.

### `updateSurveillance`
*   **Detay:** Gözetim onay durumlarını toplu günceller.
*   **Bağlantılar:** `/certificates/index.astro`.

### `updateCertificateField`
*   **Detay:** Sertifikadaki tek bir alanı D1'e ve Sheets'e asenkron yansıtır.
*   **Bağlantılar:** Detay düzenleme pencereleri.

---

## 🧪 EntityHandlers (Denetim, Test ve Proforma)

### `getAudits / getAuditsByFirmaId`
*   **Detay:** Denetim kayıtlarını listeler.
*   **Bağlantılar:** `/audits/index.astro`, `/companies/[id]/view.astro`.

### `getTests / getTestsByFirmaId`
*   **Detay:** Ürün test kayıtlarını listeler.
*   **Bağlantılar:** `/tests/index.astro`.

### `generateProforma / generateContract`
*   **Detay:** GAS API üzerinden doküman şablonu doldurur.
*   **Bağlantılar:** `/proformas/view.astro`, `/audits/view.astro`.

---

## 📂 DriveHandlers (Google Drive Entegrasyonu)

### `getFolderId`
*   **Detay:** Firma Drive klasör ID'sini çeker (KV Cache destekli).
*   **Bağlantılar:** Firma detay sayfaları "Arşiv" bölümü.

### `getRecentFiles`
*   **Detay:** Klasör içindeki dosyaları MIME type filtresiyle listeler.
*   **Bağlantılar:** Firma detay sayfaları "Dosyalar" bölümü.

---

## 📚 MasterHandlers (Sabit Veri)

### `getMasterData`
*   **Detay:** Standartlar, Denetçiler vb. listeleri döner.
*   **Bağlantılar:** Tüm formlardaki seçim kutuları.

### `updateMasterData`
*   **Detay:** Sabit verileri GAS üzerinden günceller ve D1'e yansıtır.
*   **Bağlantılar:** `/settings.astro`.

---

## ⚠️ Kritik Yardımıcılar

### `syncToBackup`
*   **Detay:** Yazma işlemlerinden sonra `ctx.waitUntil` ile GAS senkronizasyonunu arkaplanda başlatır. Hataları `sync_log` tablosuna işler.

### `rebuildDashboardStats`
*   **Detay:** Veritabanındaki sayaçları (`COUNT`) güncelleyerek `sync_meta` içine olarak yazar.
