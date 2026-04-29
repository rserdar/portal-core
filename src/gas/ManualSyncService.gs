/**
 * 🛠️ ManualSyncService: Bağımsız Script Destekli Servisler
 */
const ManualSyncService = {
  /**
   * Gemini ve diğer Google servisleri için yetkilendirme penceresini tetikler.
   * Editörden "authorizeServices" seçilip çalıştırılmalıdır.
   */
  authorizeServices: function() {
    Logger.log("🔐 Yetkilendirme işlemi başlatıldı...");
    
    // Google'ın onay penceresini zorla tetiklemesi için doğrudan çağırıyoruz
    LanguageApp.translate("onay", "tr", "en");
    UrlFetchApp.fetch("https://www.google.com", { muteHttpExceptions: true });
    DriveApp.getRootFolder().getName();
    GmailApp.getAliases();
    
    Logger.log("✅ Yetkilendirme başarıyla tamamlandı. Tüm servisler kullanıma hazır.");
  },

  /**
   * Gemini'nin çalışıp çalışmadığını test eder ve bir örnek çıktı üretir.
   */
  testGemini: function() {
    Logger.log("🚀 Gemini Testi Başlatıldı...");
    
    try {
      const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
      if (!apiKey) {
        Logger.log("❌ HATA: GEMINI_API_KEY bulunamadı! Proje Ayarları -> Komut Dosyası Özellikleri kısmına ekleyin.");
        return;
      }

      const testPayload = {
        standard: "ISO 9001:2015",
        context: {
          companyName: "Antigravity Teknoloji A.Ş.",
          activity: "Yapay zeka tabanlı yazılım geliştirme ve siber güvenlik."
        }
      };

      Logger.log("📡 Gemini'ye istek gönderiliyor...");
      const result = GeminiService.suggestCertificateClassification(testPayload);

      if (result.success) {
        const data = result.data;
        const suggestion = data.suggestions[0] || {};
        
        Logger.log("✅ GEMİNİ BAĞLANTISI BAŞARILI!");
        Logger.log("🤖 Model: " + data.model);
        Logger.log("📝 Özet: " + data.summary);
        Logger.log("--- Örnek Öneri ---");
        Logger.log("🔹 EA: " + (suggestion.ea || "-"));
        Logger.log("🔹 NACE: " + (suggestion.nace || "-"));
        Logger.log("🔹 Kapsam Taslağı: " + (suggestion.scopeDraft || "-"));
      } else {
        Logger.log("❌ Gemini Hatası: " + result.error);
      }

    } catch (e) {
      Logger.log("❌ Sistem Hatası: " + e.message);
    }
  },

  /**
   * API anahtarının erişebildiği tüm modelleri listeler.
   */
  listModels: function() {
    Logger.log("🔍 Erişilebilir Gemini Modelleri Taranıyor...");
    
    try {
      const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
      if (!apiKey) {
        Logger.log("❌ HATA: GEMINI_API_KEY bulunamadı!");
        return;
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      const res = UrlFetchApp.fetch(endpoint, { muteHttpExceptions: true });
      const data = JSON.parse(res.getContentText());

      if (data.models) {
        const modelNames = data.models.map(m => m.name.replace("models/", ""));
        Logger.log("✅ BULUNAN MODELLER:");
        Logger.log(modelNames.join("\n"));
        Logger.log("-------------------");
        Logger.log("Lütfen yukarıdaki listeden 'gemini-1.5' veya 'gemini-pro' içeren birini GeminiService içindeki varsayılan model adıyla değiştirin.");
      } else {
        Logger.log("❌ Model listesi alınamadı: " + res.getContentText());
      }
    } catch (e) {
      Logger.log("❌ Sistem Hatası: " + e.message);
    }
  }
};

/**
 * Editörden çalıştırılacak giriş noktaları
 */
function authorizeServices() {
  ManualSyncService.authorizeServices();
}

function testGemini() {
  ManualSyncService.testGemini();
}

function listModels() {
  ManualSyncService.listModels();
}
