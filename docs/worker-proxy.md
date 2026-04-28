# Portal Proxy (Worker) Documentation

Bu doküman, `src/workers/proxy.js` içerisinde yer alan ana handler akışlarını ve portal sayfalarıyla ilişkilerini özetler.

---

## Mimari Özet

Proxy sistemi Dispatcher Pattern kullanır.

- Source of Truth: Cloudflare D1
- Backup Layer: Google Sheets ve Drive
- Caching: KV sadece token, lock ve Drive cache için kullanılır

---

## SyncHandlers

### `bulkSync`

Google Sheets verilerini D1 veritabanına toplu olarak yansıtır.

### `exportData / exportBackup`

D1 verilerini SQL formatında dışa aktarır.

### `importBackup`

Yedekten geri yükleme akışını yönetir.

### `rebuildStats`

Dashboard istatistiklerini D1 üzerinden yeniden hesaplar.

---

## CompanyHandlers

### `getCompanies`

Firma listesini ve özet kapsam bilgisini döner.

### `getCompanyById`

Tekil firma detayını döner.

### `addCompany / updateCompany`

D1-first yazma akışını yürütür, ardından arka planda backup senkronu başlatır.

---

## CertificateHandlers

### `getDashboardSummary`

Aktif ve bekleyen sertifika sayaçlarını ve grafikleri üretir.

### `getCertificateSummaries`

Sertifika özet listesini firma bilgileriyle birleştirir.

### `addCertificate / updateCertificate`

Sertifika CRUD işlemlerini yönetir.

### `updateSurveillance`

Gözetim onay durumlarını toplu günceller.

---

## NotificationHandlers

### `sendSurveillanceEmail`

Tenant bazlı HTML mail şablonunu Worker tarafında üretir ve GAS'a hazır `htmlBody` gönderir.

### `runMonthlyCheck`

D1 üzerinden danışman bazlı gözetim adaylarını toplar ve mail gönderimlerini Worker üzerinden orkestre eder.

---

## DriveHandlers

### `getFolderId`

Firma Drive klasör ID'sini döner.

### `getRecentFiles`

Firma klasöründeki son dosyaları listeler.

### `listDriveContents`

Drive klasör içeriğini MIME tipi filtresiyle getirir.

---

## MasterHandlers

### `getMasterData`

Standartlar, danışmanlar ve diğer sabit veri tablolarını döner.

### `updateMasterData`

Master veriyi D1-first günceller ve backup senkronuna yollar.

---

## Yardımcı Akışlar

### `syncToBackup`

Yazma işlemlerinden sonra `ctx.waitUntil` ile backup senkronunu tetikler ve hataları `sync_log` tablosuna işler.

### `rebuildDashboardStats`

Özet sayaçları yeniden hesaplayıp `sync_meta` içine yazar.
