/**
 * 🧾 ProformaService: Proforma Fatura ve Teklif Yönetimi
 */
const ProformaService = {
  sheetName: "proformas",

  _buildRow: function(headers, info, id) {
    return headers.map(h => {
      if (h === "id" || h === "ID") return id;
      if (h === "updated_at") return new Date().getTime();
      if (info[h] === undefined) Logger.log("[ProformaService._buildRow] Eşleşmeyen header: " + h);
      return info[h] !== undefined ? info[h] : "";
    });
  },

  getAll: function() {
    try {
      return BaseService.getDataAsObjects(this.sheetName);
    } catch (e) {
      BaseService.logError("getAll", e);
      return [];
    }
  },

  getById: function(id) {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName(this.sheetName);
      const lastRow = ws.getLastRow();
      if (lastRow < 2) return null;

      const ids = ws.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
      const rowIndex = ids.findIndex(v => String(v) === String(id));
      if (rowIndex === -1) return null;

      const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
      const row = ws.getRange(rowIndex + 2, 1, 1, ws.getLastColumn()).getDisplayValues()[0];
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    } catch (e) {
      BaseService.logError("getById", e);
      return null;
    }
  },

  getByFirmaId: function(firmaId) {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName(this.sheetName);
      const lastRow = ws.getLastRow();
      if (lastRow < 2) return [];

      const lastCol = ws.getLastColumn();
      const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
      const firmaNoIdx = headers.findIndex(h => h === "firma_no");
      if (firmaNoIdx === -1) throw new Error("firma_no sütunu bulunamadı.");

      const data = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
      return data.filter(r => String(r[firmaNoIdx]) === String(firmaId));
    } catch (e) {
      BaseService.logError("getByFirmaId", e);
      return [];
    }
  },

  add: function(proInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        const newId = proInfo.id || proInfo.ID || BaseService.getNextId(this.sheetName);
        ws.appendRow(this._buildRow(headers, proInfo || {}, newId));
        return { success: true, id: newId };
      }, 30000, "ProformaService.add");
    } catch (e) {
      BaseService.logError("add", e);
      return { success: false, error: e.message };
    }
  },

  update: function(id, proInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const lastRow = ws.getLastRow();
        if (lastRow < 2) throw new Error("Güncellenecek proforma bulunamadı.");

        const ids = ws.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
        const rowIndex = ids.findIndex(v => String(v) === String(id));
        if (rowIndex === -1) throw new Error("Proforma bulunamadı: " + id);

        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        ws.getRange(rowIndex + 2, 1, 1, headers.length).setValues([this._buildRow(headers, proInfo, String(id))]);
        return { success: true };
      }, 30000, "ProformaService.update");
    } catch (e) {
      BaseService.logError("update", e, { id: id });
      return { success: false, error: e.message };
    }
  }
};
