/**
 * 🧪 TestService: Laboratuvar ve Test Kayıtları
 */
const TestService = {
  sheetName: "Testler",

  _valueFromInfo: function(testInfo, aliases, fallback) {
    const list = Array.isArray(aliases) ? aliases : [aliases];
    for (const key of list) {
      if (testInfo[key] !== undefined && testInfo[key] !== null && testInfo[key] !== "") {
        return testInfo[key];
      }
    }
    return fallback !== undefined ? fallback : "";
  },

  _buildRowByHeaders: function(headers, testInfo, idValue) {
    return headers.map(header => {
      const n = BaseService.normalizeHeader(header);

      if (n === "id") return idValue;
      if (n === "firmaadi" || n === "fname") return this._valueFromInfo(testInfo, ["firmaAdi", "fname", "nick"]);
      if (n === "firmano" || n === "fno") return this._valueFromInfo(testInfo, ["firmaNo", "fno"]);
      if (n === "testadi") return this._valueFromInfo(testInfo, ["testAdi"]);
      if (n === "marka") return this._valueFromInfo(testInfo, ["marka"]);
      if (n === "urun") return this._valueFromInfo(testInfo, ["urun"]);
      if (n === "urunkodu") return this._valueFromInfo(testInfo, ["urunKodu"]);
      if (n === "urunno") return this._valueFromInfo(testInfo, ["urunNo"]);
      if (n === "lot") return this._valueFromInfo(testInfo, ["lot"]);
      if (n === "urunkabul") return this._valueFromInfo(testInfo, ["urunKabul"]);
      if (n === "kabulsaat") return this._valueFromInfo(testInfo, ["kabulSaat"]);
      if (n === "testbaslangic") return this._valueFromInfo(testInfo, ["testBaslangic"]);
      if (n === "testbitis") return this._valueFromInfo(testInfo, ["testBitis"]);
      if (n === "raportarihi") return this._valueFromInfo(testInfo, ["raporTarihi"]);
      if (n === "raporno") return this._valueFromInfo(testInfo, ["raporNo"]);
      if (n === "numunesayisi") return this._valueFromInfo(testInfo, ["numuneSayisi"]);
      if (n === "numuneut") return this._valueFromInfo(testInfo, ["numuneUT"]);
      if (n === "numuneskt") return this._valueFromInfo(testInfo, ["numuneSKT"]);
      if (n === "urunbilgi") return this._valueFromInfo(testInfo, ["urunBilgi"]);
      if (n === "gorsel1") return this._valueFromInfo(testInfo, ["gorsel1"]);
      if (n === "gorsel2") return this._valueFromInfo(testInfo, ["gorsel2"]);
      if (n === "detay") return this._valueFromInfo(testInfo, ["detay"]);
      if (n === "_updated_at") return new Date().getTime();

      return this._valueFromInfo(testInfo, [header], "");
    });
  },

  /**
   * Belirli bir firmaya ait test kayıtlarını döner.
   */
  getByFirmaId: function(firmaId) {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName(this.sheetName);
      const lastRow = ws.getLastRow();
      if (lastRow < 2) return [];

      const lastCol = ws.getLastColumn();
      const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
      const firmaNoCol = BaseService.findHeaderIndex(headers, ["Firma No", "FirmaNo", "FNo", "fno"]);
      if (firmaNoCol < 1) throw new Error("Firma No sütunu bulunamadı.");

      const data = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
      return data.filter(r => String(r[firmaNoCol - 1]) === String(firmaId));
    } catch (e) {
      BaseService.logError("getByFirmaId", e);
      return [];
    }
  },

  /**
   * Yeni bir test kaydı ekler.
   */
  add: function(testInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        const newId = BaseService.getNextId(this.sheetName);
        const newRow = this._buildRowByHeaders(headers, testInfo || {}, newId);

        ws.appendRow(newRow);
        return { success: true, id: newId };
      }, 30000, "TestService.add");
    } catch (e) {
      BaseService.logError("add", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Test kaydını günceller.
   */
  update: function(id, testInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const lastRow = ws.getLastRow();
        if (lastRow < 2) throw new Error("Güncellenecek test bulunamadı.");

        const lastCol = ws.getLastColumn();
        const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
        const idCol = BaseService.findHeaderIndex(headers, ["ID"]);
        if (idCol < 1) throw new Error("ID sütunu bulunamadı.");

        const data = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
        const rowIndex = data.findIndex(r => String(r[idCol - 1]) === String(id));
        if (rowIndex === -1) throw new Error("Test bulunamadı: " + id);

        const rowNum = rowIndex + 2;
        const fullRow = this._buildRowByHeaders(headers, testInfo || {}, String(id));

        ws.getRange(rowNum, 1, 1, headers.length).setValues([fullRow]);
        return { success: true };
      }, 30000, "TestService.update");
    } catch (e) {
      BaseService.logError("update", e, { id: id });
      return { success: false, error: e.message };
    }
  }
};
