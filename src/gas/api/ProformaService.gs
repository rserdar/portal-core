/**
 * 🧾 ProformaService: Proforma Fatura ve Teklif Yönetimi
 */
const ProformaService = {
  sheetName: "Proforma",

  _valueFromInfo: function(proInfo, aliases, fallback) {
    const list = Array.isArray(aliases) ? aliases : [aliases];
    for (const key of list) {
      if (proInfo[key] !== undefined && proInfo[key] !== null && proInfo[key] !== "") {
        return proInfo[key];
      }
    }
    return fallback !== undefined ? fallback : "";
  },

  _buildRowByHeaders: function(headers, proInfo, idValue) {
    return headers.map(header => {
      const n = BaseService.normalizeHeader(header);

      if (n === "id" || n === "faturano") return idValue;
      if (n === "firmaadi" || n === "nick") return this._valueFromInfo(proInfo, ["nick", "nickname", "firmaAdi"]);
      if (n === "firmano" || n === "fno") return this._valueFromInfo(proInfo, ["firmaNo", "fno"]);
      if (n === "kdvsiz") return this._valueFromInfo(proInfo, ["kdvsiz"], 0);
      if (n === "kdvoran") return this._valueFromInfo(proInfo, ["kdvOran"], 20);
      if (n === "kdv") return this._valueFromInfo(proInfo, ["kdv"], 0);
      if (n === "toplam") return this._valueFromInfo(proInfo, ["toplam"], 0);
      if (n === "birim" || n === "lira") return this._valueFromInfo(proInfo, ["birim", "lira"], "TL");
      if (n === "tarih") return this._valueFromInfo(proInfo, ["tarih"]);
      if (n === "konu") return this._valueFromInfo(proInfo, ["konu"]);

      return this._valueFromInfo(proInfo, [header], "");
    });
  },

  /**
   * Belirli bir firmaya ait proformaları döner.
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
   * Proforma kaydını ID ile getirir.
   */
  getById: function(id) {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName(this.sheetName);
      const lastRow = ws.getLastRow();
      if (lastRow < 2) return null;

      const lastCol = ws.getLastColumn();
      const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
      const idCol = BaseService.findHeaderIndex(headers, ["ID", "Fatura No", "FaturaNo"]);
      if (idCol < 1) throw new Error("ID/Fatura No sütunu bulunamadı.");

      const data = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
      return data.find(r => String(r[idCol - 1]) === String(id)) || null;
    } catch (e) {
      BaseService.logError("getById", e);
      return null;
    }
  },

  /**
   * Yeni bir proforma kaydı ekler.
   */
  add: function(proInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        const newId = BaseService.getNextId(this.sheetName);
        const newRow = this._buildRowByHeaders(headers, proInfo || {}, newId);

        ws.appendRow(newRow);
        return { success: true, id: newId };
      }, 30000, "ProformaService.add");
    } catch (e) {
      BaseService.logError("add", e);
      return { success: false, error: e.message };
    }
  }
};
