/**
 * 🛠️ ManualSyncService: Sheets → D1 Manuel Senkronizasyon (Faz 7-C)
 * 
 * Sheets üzerinde yapılan manuel değişiklikleri D1'e göndermek için kullanılır.
 */
const ManualSyncService = {

  /**
   * Özel menü ekleme.
   */
  addMenu: function() {
    try {
      const ui = SpreadsheetApp.getUi();
      ui.createMenu("🛡️ Medicert Portal")
        .addItem("D1'e Senkronize Et (Sadece Bu Sayfa)", "syncCurrentSheetToD1")
        .addSeparator()
        .addItem("Gece Süpürmesini Çalıştır (D1 → Sheets)", "runDailyBackup")
        .addToUi();
    } catch (e) {
      Logger.log("Menu error (could be permission): " + e);
    }
  },

  /**
   * Aktif sayfadaki tüm veriyi D1'e gönderir (Basit yaklaşım).
   * İleride sadece değişenleri bulmak için last_manual_sync_at kullanılabilir.
   */
  syncCurrentSheetToD1: function() {
    const sheet = SpreadsheetApp.getActiveSheet();
    const sheetName = sheet.getName();
    
    // Sadece desteklenen tabloları senkronize et
    const validSheets = ["companies", "certificates", "audits", "tests", "proformas"];
    if (!validSheets.includes(sheetName)) {
      SpreadsheetApp.getUi().alert("Bu sayfa otomatik senkronizasyon için desteklenmiyor.");
      return;
    }

    const ui = SpreadsheetApp.getUi();
    const response = ui.alert("Senkronizasyon", `${sheetName} sayfasındaki veriler Cloudflare D1 üzerine yazılacak. Emin misiniz?`, ui.ButtonSet.YES_NO);
    
    if (response !== ui.Button.YES) return;

    try {
      const data = BaseService.getDataAsObjects(sheetName);
      if (!data || data.length === 0) {
        ui.alert("Gönderilecek veri bulunamadı.");
        return;
      }

      // Worker'a toplu gönderim
      // Not: handleSheetEdit genelde tekil çalışır ama biz burada toplu gönderim yapacağız.
      // Basitlik için her satırı tek tek veya Worker'da bir bulkSync endpoint'i ile güncelleyebiliriz.
      // Şimdilik bulkSync mantığına benzer bir payload hazırlayalım.
      
      const props = PropertiesService.getScriptProperties();
      const workerUrl = props.getProperty("WORKER_URL");
      const apiKey = props.getProperty("API_KEY");

      const payload = {
        action: "bulkSync", // Mevcut bulkSync D1'e yazar
        apiKey: apiKey,
        params: {
          scope: [sheetName],
          payload: {
            [sheetName]: data
          }
        }
      };

      const res = UrlFetchApp.fetch(workerUrl, {
        method: "POST",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      const result = JSON.parse(res.getContentText());
      if (result.success) {
        ui.alert("Başarılı", `${data.length} kayıt D1 ile eşitlendi.`, ui.Button.OK);
      } else {
        ui.alert("Hata", "D1 güncellenemedi: " + (result.error || "Bilinmeyen hata"), ui.Button.OK);
      }

    } catch (e) {
      BaseService.logError("syncCurrentSheetToD1", e);
      ui.alert("Sistem Hatası: " + e.message);
    }
  }
};

/**
 * Entry points for UI
 */
function onOpen() {
  ManualSyncService.addMenu();
}

function syncCurrentSheetToD1() {
  ManualSyncService.syncCurrentSheetToD1();
}
