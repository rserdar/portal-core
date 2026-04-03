/**
 * 🏢 CompanyService: Firma İş Mantığı Katmanı
 * 
 * Firma ekleme, düzenleme ve arama verilerini yönetir.
 */

const CompanyService = {
  sheetName: "Firmalar",

  /**
   * Tüm firma listesini (Hafif Veri) döner.
   * Search Sync için optimize edilmiştir.
   */
  getAllForSync: function() {
    try {
      return BaseService.getDataAsObjects(this.sheetName);
    } catch (e) {
      BaseService.logError("getAllForSync", e);
      return [];
    }
  },

  /**
   * Belirtilen ID'ye sahip firmayı tüm detaylarıyla getirir.
   */
  getById: function(id) {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName(this.sheetName);
      const lastRow = ws.getLastRow();
      if (lastRow < 2) return null;

      // 1. ID Sütununda ara (Zeki Arama)
      const ids = ws.getRange(2, 1, lastRow - 1, 1).getValues().flat();
      const rowIndex = ids.findIndex(rowId => String(rowId) === String(id));
      
      if (rowIndex === -1) return null;

      // 2. Sadece o satırı getir (Performans)
      const dataRow = ws.getRange(rowIndex + 2, 1, 1, ws.getLastColumn()).getDisplayValues()[0];
      const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0].map(h => String(h).trim());

      const obj = {};
      headers.forEach((h, i) => obj[h] = dataRow[i]);
      return obj;
    } catch (e) {
      BaseService.logError("getById", e);
      return null;
    }
  },

  /**
   * Yeni bir firma ekler.
   */
  add: function(companyInfo) {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName(this.sheetName);
      const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const newId = BaseService.getNextId(this.sheetName);

      // Firma Info'daki verileri başlıklarla eşleştir (Mapping)
      const newRow = headers.map(header => {
        switch (header) {
          case "Firma No": return newId;
          case "Firma Adı": return companyInfo.nickname || '';
          case "Unvan": return companyInfo.unvan || '';
          case "İl": return companyInfo.sehir || '';
          case "Adres": return companyInfo.adres || '';
          case "Ülke": return companyInfo.ulke || 'TÜRKİYE';
          case "Telefon": return companyInfo.tel || '';
          case "Mail": return companyInfo.mail || '';
          case "İnternet": return companyInfo.www || '';
          case "Vergi Dairesi": return companyInfo.vergiD || '';
          case "Vergi Numarası": return companyInfo.vergiN || '';
          case "Sertifika Kapsamı (TR)": return companyInfo.kapsam || '';
          case "Sertifika Kapsamı (EN)": return companyInfo.scope || '';
          case "Yapılan İş": return companyInfo.yapis || '';
          case "Toplam Çalışan": return companyInfo.tcs || 0;
          case "EA": return companyInfo.ea || '';
          case "NACE": return companyInfo.nace || '';
          case "Firma Not": return companyInfo.not || '';
          default: return companyInfo[header] || '';
        }
      });

      ws.appendRow(newRow);
      return { success: true, id: newId };
    } catch (e) {
      BaseService.logError("add", e);
      return { success: false, error: e.message };
    }
  }
};
