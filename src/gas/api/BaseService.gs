/**
 * 🏛️ BaseService: Core Data Access Layer
 * 
 * Tüm GAS servislerinin (Company, Certificate, vb.) ortak temelidir.
 * Hata yönetimi, e-tablo bağlantısı ve veri okuma işlemlerini merkezileştirir.
 */

const BaseService = {
  /**
   * Hedef Spreadsheet'i açar.
   */
  openSS: function() {
    try {
      // 1. Önce aktif bağlı tabloyu dene (En güvenli yol)
      const active = SpreadsheetApp.getActiveSpreadsheet();
      if (active) return active;

      // 2. Proje ayarlarındaki ID'yi dene
      const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
      if (id) return SpreadsheetApp.openById(id);

      throw new Error("Aktif spreadsheet bulunamadı ve SPREADSHEET_ID tanımlanmamış.");
    } catch (e) {
      this.logError("openSS", e);
      throw new Error("Veri kaynağına erişilemiyor: " + e.message);
    }
  },

  /**
   * Sayfadaki tüm verileri nesne dizisi olarak döner.
   */
  getDataAsObjects: function(sheetName) {
    const ss = this.openSS();
    const sheet = ss.getSheetByName(sheetName);
    
    // 🕵️ DEDEKTİF LOGLARI
    Logger.log(`--- DEDEKTİF MODU ---`);
    Logger.log(`Bağlanılan Tablo: ${ss.getName()}`);
    Logger.log(`Aranan Sayfa: ${sheetName}`);
    
    if (!sheet) {
      Logger.log(`HATA: ${sheetName} sayfası bulunamadı!`);
      throw new Error(`${sheetName} sayfası bulunamadı.`);
    }
    
    const lastRow = sheet.getLastRow();
    Logger.log(`Bulunan Son Satır: ${lastRow}`);

    if (lastRow < 2) return [];

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

    return data.map(row => {
      return headers.reduce((obj, header, i) => {
        obj[header] = row[i];
        return obj;
      }, {});
    });
  },

  /**
   * Sayfadaki tüm verileri ham dizi (2D Array) olarak döner.
   * Başlık satırını atlar.
   */
  getRawData: function(sheetName) {
    try {
      const ss = this.openSS();
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) throw new Error(`${sheetName} sayfası bulunamadı.`);

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return [];

      // Sadece verileri al (başlık hariç) - Hız için getValues kullan
      return sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    } catch (e) {
      this.logError("getRawData", e);
      return [];
    }
  },

  /**
   * Teklif edilen ID'lerin en büyüğünü bulup bir fazlasını döner.
   */
  getNextId: function(sheetName) {
    const ss = this.openSS();
    const sheet = ss.getSheetByName(sheetName);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return 1;

    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat().map(id => parseInt(id)).filter(id => !isNaN(id));
    return ids.length > 0 ? Math.max(...ids) + 1 : 1;
  },

  /**
   * Hata loglaması yapar.
   */
  logError: function(context, error) {
    Logger.log(`[BaseService][${context}] Hata: ${error.message}`);
  }
};
