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
      const data = BaseService.getDataAsObjects(this.sheetName);
      // Sadece senkronizasyon için gerekli sütunları filtrele (ID, Kısa Ad, Unvan, İl)
      return data.map(item => ({
        id: item["Firma No"],
        nickname: item["Firma Adı"],
        unvan: item["Unvan"],
        city: item["İl"]
      }));
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
      const data = BaseService.getDataAsObjects(this.sheetName);
      return data.find(item => String(item["Firma No"]) === String(id)) || null;
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
