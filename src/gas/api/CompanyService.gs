/**
 * 🏢 CompanyService: Firma İş Mantığı Katmanı
 */
const CompanyService = {
  sheetName: "companies",

  _buildRow: function(headers, info, id) {
    return headers.map(h => {
      if (h === "id" || h === "ID") return id;
      if (h === "updated_at") return new Date().getTime();
      return info[h] !== undefined ? info[h] : "";
    });
  },

  getAllForSync: function() {
    try {
      return BaseService.getDataAsObjects(this.sheetName);
    } catch (e) {
      BaseService.logError("getAllForSync", e);
      return [];
    }
  },

  getById: function(id) {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName(this.sheetName);
      const lastRow = ws.getLastRow();
      if (lastRow < 2) return null;

      const ids = ws.getRange(2, 1, lastRow - 1, 1).getValues().flat();
      const rowIndex = ids.findIndex(rowId => String(rowId) === String(id));
      if (rowIndex === -1) return null;

      const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const dataRow = ws.getRange(rowIndex + 2, 1, 1, ws.getLastColumn()).getDisplayValues()[0];

      const obj = {};
      headers.forEach((h, i) => obj[h] = dataRow[i]);
      obj.__etag = BaseService.createRowEtag(headers, dataRow);
      return obj;
    } catch (e) {
      BaseService.logError("getById", e);
      return null;
    }
  },

  add: function(companyInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        const newId = companyInfo.id || companyInfo.ID || BaseService.getNextId(this.sheetName);
        ws.appendRow(this._buildRow(headers, companyInfo, newId));
        return { success: true, id: newId };
      }, 30000, "CompanyService.add");
    } catch (e) {
      BaseService.logError("add", e);
      return { success: false, error: e.message };
    }
  },

  update: function(id, companyInfo, expectedEtag) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const lastRow = ws.getLastRow();
        if (lastRow < 2) throw new Error("Güncellenecek firma bulunamadı.");

        const ids = ws.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
        const rowIndex = ids.findIndex(v => String(v) === String(id));
        if (rowIndex === -1) throw new Error("Firma bulunamadı: " + id);

        const rowNum = rowIndex + 2;
        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());

        if (expectedEtag && String(expectedEtag).trim()) {
          const currentRow = ws.getRange(rowNum, 1, 1, headers.length).getDisplayValues()[0];
          const currentEtag = BaseService.createRowEtag(headers, currentRow);
          if (String(expectedEtag) !== currentEtag) {
            return { success: false, error: "CONFLICT", code: "CONFLICT",
                     message: "Kayıt başka bir kullanıcı tarafından güncellenmiş.", currentEtag };
          }
        }

        const fullRow = this._buildRow(headers, companyInfo, String(id));
        ws.getRange(rowNum, 1, 1, headers.length).setValues([fullRow]);
        return { success: true, etag: BaseService.createRowEtag(headers, fullRow) };
      }, 30000, "CompanyService.update");
    } catch (e) {
      BaseService.logError("update", e, { id: id });
      return { success: false, error: e.message };
    }
  }
};
