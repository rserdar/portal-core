/**
 * 🧾 ProformaService: Proforma Fatura ve Teklif Yönetimi
 */
const ProformaService = {
  sheetName: "proformas",

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

      if (n === "id") return idValue;
      if (n === "firmano") return this._valueFromInfo(proInfo, ["firma_no", "firmano"]);
      if (n === "kdvsiz") return this._valueFromInfo(proInfo, ["kdvsiz"], 0);
      if (n === "kdvoran") return this._valueFromInfo(proInfo, ["kdv_oran", "kdvoran"], 20);
      if (n === "kdv") return this._valueFromInfo(proInfo, ["kdv"], 0);
      if (n === "toplam") return this._valueFromInfo(proInfo, ["toplam"], 0);
      if (n === "birim") return this._valueFromInfo(proInfo, ["birim"], "TL");
      if (n === "tarih") return this._valueFromInfo(proInfo, ["tarih"]);
      if (n === "konu") return this._valueFromInfo(proInfo, ["konu"]);
      if (n === "updatedat") return new Date().getTime();

      return this._valueFromInfo(proInfo, [header], "");
    });
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
