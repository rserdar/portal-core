# 🚀 Medicert Portal: Modernization Project

Bu proje, geleneksel bir Google Apps Script (GAS) portalının, yüksek performanslı ve modern bir **Astro 6.x**, **Tailwind CSS** ve **Cloudflare Workers** mimarisine dönüştürülmesini kapsar.

## 🏗️ Mimari Tasarım (Architectural Overview)

Portal, "Decoupled" (Ayrıştırılmış) bir mimari üzerine kurulmuştur. Bu sayede frontend hızı ile GAS'ın kurumsal yetenekleri en verimli şekilde birleştirilmiştir.

### 1. Frontend: Astro + Tailwind CSS
- **Hız:** Statik site oluşturma (SSG) ve adaya dayalı (Islands) mimari ile milisaniyelik sayfa geçişleri.
- **Tasarım:** Modern "Glassmorphism" ve "Dark Mode" odaklı premium kullanıcı deneyimi.
- **State Management:** Veriler **Nano Stores** üzerinden reaktif olarak yönetilir ve **IndexedDB**'de (idb-keyval) yerel olarak saklanır.

### 2. Middleware: Cloudflare Worker Proxy
- **Güvenlik:** GAS API anahtarlarını gizleyerek güvenli bir köprü (proxy) görevi görür.
- **Performans:** İstekleri optimize eder ve CORS sorunlarını ortadan kaldırır.

### 3. Backend: Modular GAS API
Monolitik `.gs` dosyaları, S.O.L.I.D prensiplerine uygun olarak servis bazlı modüllere ayrılmıştır:
- **`BaseService.gs`:** Merkezi e-tablo erişimi ve hata yönetimi.
- **`CompanyService.gs`:** Firma CRUD ve akıllı senkronizasyon verisi hazırlığı.
- **`CertificateService.gs`:** Sertifika sorgulama ve durum yönetimi.
- **`AuditService.gs`:** Google Takvim entegreli denetim planlama ve otomasyon.
- **`DocumentService.gs`:** Toplu doküman üretim motoru (Batch Processing).
- **`PDFService.gs`:** Akıllı PDF dönüştürme ve iLovePDF fallback desteği.

---

## 🎖️ Temel Modüller ve Yetenekler

### 📊 Dinamik Dashboard
- Sisteme kayıtlı firma ve aktif sertifika sayılarını canlı olarak gösterir.
- Son başarılı senkronizasyon zamanını ve sistem sağlığını (Status) takip eder.

### 🎖️ Akıllı Sertifika Yönetimi
- **Instant Search:** Binlerce sertifika arasında sıfır gecikme ile arama.
- **Bulk Action:** Birden fazla sertifikayı seçip toplu "Gözetim Yapıldı" güncellemesi yapma.
- **Calendar Sync:** Gözetim durumuna göre etkinliklerin otomatik olarak "Arşiv" veya "Ana" takvimler arasında taşınması.

### 📝 Doküman Üretim Motoru
- **Batch UI:** 10+ dokümanı aynı anda üretirken süreci bir progres bar (ilerleme çubuğu) üzerinden izleme.
- **Template Engine:** Departman sorumlularının isimlerini şablonlara (Google Doc) otomatik gömme.

### 📅 Denetim ve Planlama (Otorobot v2)
- **Phase 1 & 2:** Denetimleri planlarken otomatik Google Takvim etkinlikleri oluşturma.
- **Timeline:** Yaklaşan tüm denetimleri görsel bir listede takip etme.

---

## 🔄 Senkronizasyon Stratejisi (Smart Sync)

Portal, **IndexedDB** kullanarak "Offline-First" yaklaşımını benimser:
1. **İlklendirme:** Sayfa açıldığında yerel hafızadaki veriler yüklenir.
2. **Arka Plan Sync:** `SyncManager`, GAS tarafındaki `syncCheck` servisini sorgular; veri değişikliği varsa sadece değişen kısımları (incremental load) günceller.
3. **Manuel Boost:** "Verileri Eşitle" butonu ile her zaman en taze veriye erişilebilir.

---

## 🛠️ Kurulum ve Geliştirme

### Yerel Çalıştırma
```bash
npm install
npm run dev
```

### Dağıtım (Deployment)
- **Frontend:** Cloudflare Pages veya Vercel üzerine otomatik dağıtılır.
- **Backend (GAS):** Servis dosyaları `.gs` uzantısıyla Google Apps Script editörüne kopyalanarak yayınlanır.

---

## 📈 Gelecek Yol Haritası (Future Roadmap)
- [ ] **AI Search:** Firma verilerini doğal dille sorgulayabilen asistan entegrasyonu.
- [ ] **Mobile App:** PWA (Progressive Web App) desteği ile mobil uygulama deneyimi.
- [ ] **Advanced Reporting:** PDF formatında aylık performans ve denetim raporu üretimi.

---
**Geliştirici:** Antigravity AI
**Firma:** Medicert Ürün ve Sistem Belgelendirme
