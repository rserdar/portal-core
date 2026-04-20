/**
 * 🧪 TestService: Laboratuvar ve Test Kayıtları
 */
const TestService = {
  sheetName: "tests",

  _buildRow: function(headers, info, id) {
    return headers.map(h => {
      if (h === "id" || h === "ID") return id;
      if (h === "updated_at") return new Date().getTime();
      return info[h] !== undefined ? info[h] : "";
    });
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

  add: function(testInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        const newId = testInfo.id || testInfo.ID || BaseService.getNextId(this.sheetName);
        ws.appendRow(this._buildRow(headers, testInfo, newId));
        return { success: true, id: newId };
      }, 30000, "TestService.add");
    } catch (e) {
      BaseService.logError("add", e);
      return { success: false, error: e.message };
    }
  },

  update: function(id, testInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const lastRow = ws.getLastRow();
        if (lastRow < 2) throw new Error("Güncellenecek test bulunamadı.");

        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        const idIdx = headers.findIndex(h => h === "id" || h === "ID");
        if (idIdx === -1) throw new Error("ID sütunu bulunamadı.");

        const data = ws.getRange(2, 1, lastRow - 1, ws.getLastColumn()).getDisplayValues();
        const rowIndex = data.findIndex(r => String(r[idIdx]) === String(id));
        if (rowIndex === -1) throw new Error("Test bulunamadı: " + id);

        ws.getRange(rowIndex + 2, 1, 1, headers.length).setValues([this._buildRow(headers, testInfo, String(id))]);
        return { success: true };
      }, 30000, "TestService.update");
    } catch (e) {
      BaseService.logError("update", e, { id: id });
      return { success: false, error: e.message };
    }
  }
};
