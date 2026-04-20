/**
 * 🧾 ProformaService: Proforma Fatura ve Teklif Yönetimi
 */
const ProformaService = {
  sheetName: "proformas",

  _buildRow: function(headers, info, id) {
    return headers.map(h => {
      if (h === "id" || h === "ID") return id;
      if (h === "updated_at") return new Date().getTime();
      return info[h] !== undefined ? info[h] : "";
    });
  },

  add: function(proInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        const newId = proInfo.id || proInfo.ID || BaseService.getNextId(this.sheetName);
        ws.appendRow(this._buildRow(headers, proInfo, newId));
        return { success: true, id: newId };
      }, 30000, "ProformaService.add");
    } catch (e) {
      BaseService.logError("add", e);
      return { success: false, error: e.message };
    }
  }
};
