/**
 * 🏛️ BaseService: Core Data Access Layer
 * 
 * Tüm GAS servislerinin (Company, Certificate, vb.) ortak temelidir.
 * Hata yönetimi, e-tablo bağlantısı ve veri okuma işlemlerini merkezileştirir.
 */

const SPREADSHEET_ID = "1FXYQ9S5ZnR1g9fkbxa0sCekJWV_cfy-5cPFojtOfRJs";

const BaseService = {
  /**
   * Hedef Spreadsheet'i açar.
   */
  openSS: function() {
    try {
      return SpreadsheetApp.openById(SPREADSHEET_ID);
    } catch (e) {
      this.logError("openSS", e);
      throw new Error("Veri kaynağına erişilemiyor.");
    }
  },

  /**
   * Sayfadaki tüm verileri nesne dizisi olarak döner.
   */
  getDataAsObjects: function(sheetName) {
    const ss = this.openSS();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error(`${sheetName} sayfası bulunamadı.`);

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();

    return data.map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      return obj;
    });
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
