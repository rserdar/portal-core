/**
 * 📦 DailyBackupService: D1 → Sheets & Drive Otomatik Yedekleme (Faz 7-A)
 * 
 * Bu servis her gece 03:00'te çalışarak D1'deki son değişiklikleri Sheets'e işler
 * ve bir yedeği Drive'a kaydeder.
 */
const DailyBackupService = {

  /**
   * Ana yedekleme ve süpürme akışı.
   */
  runDailyBackup: function() {
    Logger.log("[DailyBackup] Günlük yedekleme başladı...");
    
    // 1. D1'den son değişiklikleri çek (Sweeper mantığıyla aynı)
    const stats = SyncService.reconcileFromD1();
    
    // 2. Mevcut Sheets verisini tam paket olarak Drive'a yedekle
    this._saveSnapshotToDrive();
    
    Logger.log("[DailyBackup] Günlük yedekleme tamamlandı.");
    return stats;
  },

  /**
   * D1 verisini SQL olarak çeker ve Drive'a yedekler.
   */
  _saveSnapshotToDrive: function() {
    try {
      const props = PropertiesService.getScriptProperties();
      const folderId = props.getProperty("BACKUP_FOLDER_ID");
      const workerUrl = props.getProperty("WORKER_URL");
      const apiKey = props.getProperty("API_KEY");

      if (!folderId || !workerUrl) {
        Logger.log("[DailyBackup] BACKUP_FOLDER_ID veya WORKER_URL eksik, Drive yedeği atlanıyor.");
        return;
      }

      // 1. Worker'dan SQL Export al
      const options = {
        method: "POST",
        contentType: "application/json",
        payload: JSON.stringify({
          action: "exportBackup",
          apiKey: apiKey,
          params: {}
        }),
        muteHttpExceptions: true
      };

      const res = UrlFetchApp.fetch(workerUrl, options);
      const result = JSON.parse(res.getContentText());

      if (!result.success || !result.sql) {
        Logger.log("[DailyBackup] SQL export başarısız: " + (result.error || "Bilinmeyen hata"));
        return;
      }

      // 2. Drive'a .sql olarak kaydet
      const dateStr = Utilities.formatDate(new Date(), "GMT+3", "yyyy-MM-dd_HH-mm");
      const tenantId = props.getProperty("TENANT_ID") || "tenant";
      const fileName = `${tenantId}_db_backup_${dateStr}.sql`;
      
      const folder = DriveApp.getFolderById(folderId);
      folder.createFile(fileName, result.sql, MimeType.PLAIN_TEXT);
      
      Logger.log("[DailyBackup] Drive SQL yedeği oluşturuldu: " + fileName);
    } catch (e) {
      Logger.log("[DailyBackup] Drive yedekleme hatası: " + e.message);
    }
  },

  /**
   * Zaman bazlı tetikleyiciyi kurar (Her gece 03:00).
   */
  setupTrigger: function() {
    const fnName = "runDailyBackup";
    const triggers = ScriptApp.getProjectTriggers();
    const exists = triggers.some(t => t.getHandlerFunction() === fnName);
    
    if (!exists) {
      ScriptApp.newTrigger(fnName)
        .timeBased()
        .everyDays(1)
        .atHour(3)
        .create();
      Logger.log("[DailyBackup] Tetikleyici kuruldu (03:00).");
    } else {
      Logger.log("[DailyBackup] Tetikleyici zaten mevcut.");
    }
  }
};

/**
 * Entry point for GAS Trigger
 */
function runDailyBackup() {
  DailyBackupService.runDailyBackup();
}
