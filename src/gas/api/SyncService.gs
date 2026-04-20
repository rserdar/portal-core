  // DEPRECATED: JSON exportBackup removed.,

  /**
   * D1'den gelen son değişiklikleri çekip Sheets'i (Yedek) günceller. (Gece Süpürücüsü)
   */
  reconcileFromD1: function() {
    const props = PropertiesService.getScriptProperties();
    const workerUrl = props.getProperty("WORKER_URL");
    const apiKey = props.getProperty("API_KEY");
    if (!workerUrl) {
      Logger.log("[SyncService] WORKER_URL tanımlanmamış, süpürme yapılamaz.");
      return;
    }

    const lastBackupTs = parseInt(props.getProperty("LAST_BACKUP_TS") || "0");
    const now = new Date().getTime();

    try {
      const payload = {
        action: "getD1Changes",
        apiKey: apiKey,
        params: { 
          // D1 unixepoch() saniye bazlı çalıştığı için ms -> sn dönüşümü yapılır.
          since: lastBackupTs > 0 ? Math.floor(lastBackupTs / 1000) : 0 
        }
      };

      const options = {
        method: "POST",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };

      const res = UrlFetchApp.fetch(workerUrl, options);
      const text = res.getContentText();
      const result = JSON.parse(text);

      if (!result.success || !result.data) {
        Logger.log("[SyncService] D1'den değişim verisi alınamadı: " + (result.error || text));
        return;
      }

      const delta = result.data;
      const stats = this._applyDeltaToSheets(delta);

      props.setProperty("LAST_BACKUP_TS", now.toString());
      Logger.log("[SyncService] Süpürme tamamlandı. İstatistikler: " + JSON.stringify(stats));
    } catch (e) {
      BaseService.logError("reconcileFromD1", e);
    }
  },

  /**
   * Gelen delta paketini (companies, certificates vb.) Sheets'e işler.
   * D1'deki veriyi 'Source of Truth' kabul ederek Sheets'i günceller veya eksikse ekler.
   */
  _applyDeltaToSheets: function(delta) {
    const stats = { companies: 0, certificates: 0, audits: 0, tests: 0, proformas: 0 };
    
    // Yardımcı: Kayıt varsa güncelle, yoksa ekle
    const syncEntity = (list, service, statKey) => {
      if (!Array.isArray(list)) return;
      list.forEach(item => {
        try {
          const id = item.id || item.ID || item.firma_no; // firma_no certificates/audits için bazen id niyetine geçebiliyor ama asıl id'ye bakılmalı
          const res = service.update(id, item);
          if (res && res.success) {
            stats[statKey]++;
          } else {
            const addRes = service.add(item);
            if (addRes && addRes.success) stats[statKey]++;
          }
        } catch (e) {
          // Güncelleme bulunamadığında hata fırlatabilir, add ile devam et
          const addRes = service.add(item);
          if (addRes && addRes.success) stats[statKey]++;
        }
      });
    };

    syncEntity(delta.companies, CompanyService, "companies");
    syncEntity(delta.certificates, CertificateService, "certificates");
    syncEntity(delta.audits, AuditService, "audits");
    syncEntity(delta.tests, TestService, "tests");
    syncEntity(delta.proformas, ProformaService, "proformas");
    
    return stats;
  },

  /**
   * Her gece 03:00 - 04:00 arası çalışacak süpürücü tetikleyicisini kurar.
   */
  setupNightlyTrigger: function() {
    const fnName = "reconcileFromD1";
    const triggers = ScriptApp.getProjectTriggers();
    const exists = triggers.some(t => t.getHandlerFunction() === fnName);
    
    if (!exists) {
      ScriptApp.newTrigger(fnName)
        .timeBased()
        .everyDays(1)
        .atHour(3)
        .create();
      Logger.log("[SyncService] Gece süpürücü tetikleyicisi kuruldu (03:00).");
    } else {
      Logger.log("[SyncService] Tetikleyici zaten mevcut.");
    }
  }
};
