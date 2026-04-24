/**
 * 🏛️ BaseService: Core Data Access Layer
 *
 * Tüm GAS servislerinin (Company, Certificate, vb.) ortak temelidir.
 * Hata yönetimi, e-tablo bağlantısı ve veri okuma işlemlerini merkezileştirir.
 */

const BaseService = {
  /**
   * Başlık + satır verisinden deterministik bir etag üretir.
   * Çakışma kontrolünde (optimistic concurrency) kullanılır.
   */
  createRowEtag: function(headers, rowValues) {
    const h = Array.isArray(headers) ? headers : [];
    const r = Array.isArray(rowValues) ? rowValues : [];
    const pairs = h.map((header, i) => ({
      h: this.normalizeHeader(header),
      v: String(r[i] !== undefined && r[i] !== null ? r[i] : "")
    }));
    const payload = JSON.stringify(pairs);
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, payload);
    return bytes.map(b => {
      const v = b < 0 ? b + 256 : b;
      return ("0" + v.toString(16)).slice(-2);
    }).join("");
  },

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
   * Sheet adını önce birebir, sonra normalize ederek çözer.
   * Böylece görünmeyen boşluk / case farkları master sync'i kırmaz.
   */
  resolveSheet: function(sheetName) {
    const ss = this.openSS();
    const wanted = String(sheetName || "").trim();
    if (!wanted) throw new Error("Sheet adı boş.");

    const exact = ss.getSheetByName(wanted);
    if (exact) return exact;

    const wantedNorm = this.normalizeHeader(wanted);
    const sheets = ss.getSheets();
    const fallback = sheets.find((sheet) => this.normalizeHeader(sheet.getName()) === wantedNorm);
    if (fallback) return fallback;

    throw new Error(`${sheetName} sayfası bulunamadı.`);
  },

  getDataAsObjects: function(sheetName, offset, limit) {
    const sheet = this.resolveSheet(sheetName);

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
    
    // Paging logic
    const startRow = (typeof offset === "number" ? offset : 0) + 2;
    const maxPossibleRows = lastRow - startRow + 1;
    const numRows = (typeof limit === "number" && limit > 0) ? Math.min(limit, maxPossibleRows) : maxPossibleRows;

    if (numRows <= 0) return [];

    const data = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getDisplayValues();

    return data.map(row => {
      return headers.reduce((obj, header, i) => {
        obj[header] = row[i];
        return obj;
      }, {});
    });
  },

  /**
   * Sayfadaki verileri ham dizi (2D Array) olarak döner (Paging destekli).
   * Başlık satırını atlar. getDisplayValues() kullanır.
   */
  getRawData: function(sheetName, offset, limit) {
    try {
      const sheet = this.resolveSheet(sheetName);

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return [];

      const startRow = (typeof offset === "number" ? offset : 0) + 2;
      const maxPossibleRows = lastRow - startRow + 1;
      const numRows = (typeof limit === "number" && limit > 0) ? Math.min(limit, maxPossibleRows) : maxPossibleRows;

      if (numRows <= 0) return [];

      return sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getDisplayValues();
    } catch (e) {
      this.logError("getRawData", e);
      return [];
    }
  },

  /**
   * Bir sayfadaki toplam veri satırı sayısını döner (Başlık hariç).
   */
  getTotalRows: function(sheetName) {
    try {
      const sheet = this.resolveSheet(sheetName);
      return Math.max(0, sheet.getLastRow() - 1);
    } catch (e) {
      return 0;
    }
  },

  /**
   * Mevcut ID'lerin en büyüğünü bulup bir fazlasını döner.
   * reduce kullanır — spread operatörünün büyük dizilerde
   * call stack limitini aşması riskini ortadan kaldırır.
   */
  getNextId: function(sheetName) {
    const sheet = this.resolveSheet(sheetName);
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
