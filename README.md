# 🛰️ Medicert Portal (v5.1.0 - Velocity Update)

Bu proje, geleneksel bir Google Apps Script (GAS) altyapısının, **Astro 6.x**, **Tailwind CSS v4** ve **Cloudflare Workers** mimarisiyle yeniden doğuşudur. Yüksek veri yoğunluğu, milisaniyelik yanıt süreleri ve modern bir kurumsal arayüz (WOW Phase) hedeflenerek geliştirilmiştir.

---

## 🏗️ Mimari Tasarım (V5.1.0)

Portal, "Decoupled" (Ayrıştırılmış) bir mimari üzerine kurulu olup, "Cache-Aside" stratejisiyle GAS'ın limitlerini ortadan kaldırır.

### 1. Frontend: Astro 6.x + Saf Tailwind
- **Saf Tailwind (Pure Tailwind):** Tüm UI, Tailwind utility sınıfları ve opak arka planlar (`bg-surface`) ile yönetilir. Glassmorphism efektleri, okunabilirlik ve yüksek kontrast için optimize edilmiştir.
- **Islands Architecture:** Sadece etkileşimli bileşenlerin (Arama, Senkronizasyon, Formlar) istemci tarafında (JS) çalışmasıyla maksimum sayfa hızı sağlanır.
- **State Management:** Veriler **Nanostores** üzerinden reaktif olarak yönetilir ve **IndexedDB**'de (idb-keyval) yerel olarak saklanır.

### 2. Middleware: Cloudflare Worker + KV Cache (0ms Latency)
- **Edge Caching:** Okuma ağırlıklı tüm işlemler (Firma Listesi, Sertifikalar) Cloudflare KV üzerinden servis edilir.
- **Security Proxy:** GAS API anahtarlarını tarayıcıdan saklayarak güvenli bir katman oluşturur.
- **Smart Indexing:** Bulk Sync sırasında firma-sertifika ilişkileri KV üzerinde önceden indekslenir.

### 3. Backend: Modular GAS API V2
Google Apps Script mülkü, servis bazlı modüllere (S.O.L.I.D) ayrılmıştır:
- **`CompanyService.gs`:** Firma yönetimi ve akıllı senkronizasyon verisi hazırlığı.
- **`AuditService.gs`:** Google Takvim entegreli denetim planlama ve otomasyon.
- **`SyncService.gs`:** Toplu veri paketleme ve `LAST_UPDATE` versiyonlama yönetimi.
- **`BaseService.gs`:** Merkezi e-tablo erişimi, hata yönetimi ve logging.

---

## 🚀 Öne Çıkan Özellikler

### 🔍 Akıllı Arama & Sayfalama (V5.1.0)
- **Smart Search (@ Operatörü):** `Firma Adı @ Şehir` (Örn: `Medicert @ İzmir`) yazarak konuma duyarlı filtreleme.
- **Pagination:** 20, 50 veya 100'lük dinamik sayfalama seçenekleri ile binlerce kayıt arasında akıcı gezinti.
- **Indestructible Search:** Firma ünvanı, markası veya ID'si üzerinden anlık arama desteği.

### 🔄 Gelişmiş Senkronizasyon (Smart Sync)
- **Bulk Sync (KV):** Dashboard üzerinden tek tuşla tüm e-tablo verisini CF Edge noktalarına saniyeler içinde taşıma.
- **Automatic Timestamping:** Her senkronizasyon işleminde otomatik güncellenen `LAST_UPDATE` damgasıyla tarayıcı tarafında hatasız güncel veri garantisi.

### 📅 Otorobot & Doküman Motoru
- **Doküman Üretimi:** Google Docs şablonlarını kullanarak toplu ISO sertifika ve denetim raporu hazırlama.
- **Takvim Entegrasyonu:** Denetim tarihlerini otomatik olarak Google Takvim'e işleme ve durum güncellemeleriyle etkinlik taşıma.

---

## 🛠️ Kurulum ve Geliştirme

### Yerel Çalıştırma
```bash
# Bağımlılıkları yükle
npm install

# Geliştirme sunucusunu başlat
npm run dev
```

### Dağıtım (Production)
- **Worker Deployment:** `wrangler deploy` ile CF Worker proxy yayınlanır.
- **UI Deployment:** Astro build çıktısı Cloudflare Pages üzerinden servis edilir.
- **GAS Setup:** `/src/gas/api/` altındaki dosyalar Google Apps Script editörüne kopyalanır ve web uygulaması olarak yayınlanır.

---

## 📊 Veri Stratejisi
- **Single Source of Truth:** Google Sheets.
- **Fast Read:** Cloudflare KV (Workers).
- **Offline-First:** Browser IndexedDB.

---
**Geliştirici:** Antigravity AI  
**Müşteri:** Medicert Ürün ve Sistem Belgelendirme  
**Sürüm:** 5.1.0 (Velocity Phase)
