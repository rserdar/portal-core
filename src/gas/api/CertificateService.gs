/**
 * 🎖️ CertificateService: Sertifika ve Denetim İş Mantığı
 * 
 * Sertifika listeleri, gözetim denetimleri ve takvim güncellemelerini yönetir.
 */

const CertificateService = {
  sheetName: "Sertifika",

  /**
   * Tüm sertifika listesini döner.
   * Tabulator veya Astro Search modülleri için optimize edilmiştir.
   */
  getAll: function() {
    try {
      return BaseService.getDataAsObjects(this.sheetName);
    } catch (e) {
      BaseService.logError("getAll", e);
      return [];
    }
  },

  /**
   * Belirli bir sertifikayı ID ile getirir.
   */
  getById: function(id) {
    try {
      const data = BaseService.getDataAsObjects(this.sheetName);
      return data.find(item => String(item["ID"]) === String(id)) || null;
    } catch (e) {
      BaseService.logError("getById", e);
      return null;
    }
  },

  /**
   * Gözetim durumunu günceller ve gerekirse takvim işlemleri yapar.
   */
  updateGozetim: function(id, status) {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName(this.sheetName);
      const lastRow = ws.getLastRow();
      const ids = ws.getRange(2, 1, lastRow - 1, 1).getValues().flat().map(v => String(v));
      const rowIndex = ids.indexOf(String(id));

      if (rowIndex === -1) throw new Error("Sertifika bulunamadı: " + id);
      
      const realRow = rowIndex + 2;
      // Gözetim sütunu (Örn: 20. sütun) - Sheet yapısına göre kontrol edilmelidir.
      // Sütun başlığı "Gözetim" olan sütunu dinamik bulmak daha profesyoneldir:
      const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
      const gozetimCol = headers.indexOf("Gözetim") + 1;

      if (gozetimCol > 0) {
        ws.getRange(realRow, gozetimCol).setValue(status === "TRUE" || status === true);
        return { success: true };
      }
      
      return { success: false, error: "Gözetim sütunu bulunamadı." };
    } catch (e) {
      BaseService.logError("updateGozetim", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Belirli bir firmaya ait sertifikaları dizi olarak döner.
   * edit.astro içindeki indeksleme (row[0], row[3] vb.) ile uyumludur.
   */
  getByFirmaId: function(firmaId) {
    try {
      const allRows = BaseService.getRawData(this.sheetName);
      if (!allRows || allRows.length === 0) return [];

      // Sütun 2: Firma No (AI_CONTEXT-v3.1.0'a göre)
      const filtered = allRows.filter(r => String(r[2]) === String(firmaId));
      return filtered;
    } catch (e) {
      BaseService.logError("getByFirmaId", e);
      return [];
    }
  }
};
