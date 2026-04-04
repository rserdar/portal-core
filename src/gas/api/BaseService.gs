/**
 * 🏛️ BaseService: Core Data Access Layer
 *
 * Tüm GAS servislerinin (Company, Certificate, vb.) ortak temelidir.
 * Hata yönetimi, e-tablo bağlantısı ve veri okuma işlemlerini merkezileştirir.
 */

const BaseService = {
  /**
   * Başlık/alan metnini karşılaştırma için normalize eder.
   */
  normalizeHeader: function(value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase("tr-TR")
      .replace(/[ıİ]/g, "i")
      .replace(/[ğĞ]/g, "g")
      .replace(/[üÜ]/g, "u")
      .replace(/[şŞ]/g, "s")
      .replace(/[öÖ]/g, "o")
      .replace(/[çÇ]/g, "c")
      .replace(/[^a-z0-9]+/g, "");
  },

  /**
   * Header listesinde alias adaylarından ilk eşleşen kolon indexini döner (1-indexed).
   */
  findHeaderIndex: function(headers, aliases) {
    const headerList = Array.isArray(headers) ? headers : [];
    const aliasList = Array.isArray(aliases) ? aliases : [aliases];
    const normalizedAliases = aliasList.map(a => this.normalizeHeader(a));
    const idx = headerList.findIndex(h => normalizedAliases.includes(this.normalizeHeader(h)));
    return idx === -1 ? -1 : idx + 1;
  },

  /**
   * Hedef Spreadsheet'i açar.
   */
  openSS: function() {
    try {
      const active = SpreadsheetApp.getActiveSpreadsheet();
      if (active) return active;

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
   * getDisplayValues() kullanır — tarih ve boolean alanları Sheets'te göründüğü
   * gibi string olarak döner (ör. "15.01.2024", "TRUE").
   */
  getDataAsObjects: function(sheetName) {
    const ss = this.openSS();
    const sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      throw new Error(`${sheetName} sayfası bulunamadı.`);
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();

    return data.map(row => {
      return headers.reduce((obj, header, i) => {
        obj[header] = row[i];
        return obj;
      }, {});
    });
  },

  /**
   * Sayfadaki tüm verileri ham dizi (2D Array) olarak döner.
   * Başlık satırını atlar. getDisplayValues() kullanır.
   */
  getRawData: function(sheetName) {
    try {
      const ss = this.openSS();
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) throw new Error(`${sheetName} sayfası bulunamadı.`);

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return [];

      return sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
    } catch (e) {
      this.logError("getRawData", e);
      return [];
    }
  },

  /**
   * Mevcut ID'lerin en büyüğünü bulup bir fazlasını döner.
   * reduce kullanır — spread operatörünün büyük dizilerde
   * call stack limitini aşması riskini ortadan kaldırır.
   */
  getNextId: function(sheetName) {
    const ss = this.openSS();
    const sheet = ss.getSheetByName(sheetName);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return 1;

    const maxId = sheet
      .getRange(2, 1, lastRow - 1, 1)
      .getValues()
      .reduce((max, row) => {
        const n = parseInt(row[0]);
        return !isNaN(n) && n > max ? n : max;
      }, 0);

    return maxId + 1;
  },

  /**
   * Yazma operasyonlarını ScriptLock ile seri hale getirir.
   */
  withScriptLock: function(fn, timeoutMs, context) {
    const lock = LockService.getScriptLock();
    const waitMs = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : 30000;
    const ctx = context || "withScriptLock";
    lock.waitLock(waitMs);
    try {
      return fn();
    } catch (e) {
      this.logError(ctx, e);
      throw e;
    } finally {
      try { lock.releaseLock(); } catch (_) {}
    }
  },

  /**
   * Hata loglaması yapar.
   */
  logError: function(context, error, meta) {
    const message = error && error.message ? error.message : String(error || "Bilinmeyen hata");
    const stackLine = error && error.stack ? String(error.stack).split("\n")[0] : "";
    const metaText = meta ? ` | meta=${JSON.stringify(meta)}` : "";
    const stackText = stackLine ? ` | stack=${stackLine}` : "";
    Logger.log(`[BaseService][${context}] Hata: ${message}${stackText}${metaText}`);
  }
};
