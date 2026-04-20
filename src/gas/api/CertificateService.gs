/**
 * 🎖️ CertificateService: Sertifika İş Mantığı
 */
const CertificateService = {
  sheetName: "certificates",

  _buildRow: function(headers, info, id) {
    return headers.map(h => {
      if (h === "id" || h === "ID") return id;
      if (h === "updated_at") return new Date().getTime();
      if (h === "gozetim_confirmed") {
        const v = info[h];
        return (v === true || String(v).toLowerCase() === "true" || String(v) === "1") ? "TRUE" : "FALSE";
      }
      if (info[h] === undefined) Logger.log("[CertificateService._buildRow] Eşleşmeyen header: " + h);
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
      const rowIndex = ids.findIndex(v => String(v).toLowerCase() === String(id).toLowerCase());
      if (rowIndex === -1) return null;

      const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
      const row = ws.getRange(rowIndex + 2, 1, 1, ws.getLastColumn()).getDisplayValues()[0];

      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      const gc = obj["gozetim_confirmed"];
      obj["gozetim_confirmed"] = String(gc).trim().toLowerCase() === "true" || String(gc) === "1";
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

  updateGozetim: function(id, status) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const lastRow = ws.getLastRow();

        const ids = ws.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
        const rowIndex = ids.findIndex(v => String(v) === String(id));
        if (rowIndex === -1) throw new Error("Sertifika bulunamadı: " + id);

        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        const gozetimIdx = headers.findIndex(h => h === "gozetim_confirmed");
        if (gozetimIdx === -1) throw new Error('"gozetim_confirmed" sütunu bulunamadı.');

        const rowNum = rowIndex + 2;
        ws.getRange(rowNum, gozetimIdx + 1).setValue(status === "TRUE" || status === true ? "TRUE" : "FALSE");

        const tsIdx = headers.findIndex(h => h === "updated_at");
        if (tsIdx !== -1) ws.getRange(rowNum, tsIdx + 1).setValue(new Date().getTime());

        return { success: true };
      }, 30000, "CertificateService.updateGozetim");
    } catch (e) {
      BaseService.logError("updateGozetim", e);
      return { success: false, error: e.message };
    }
  },

  add: function(certInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        const newId = certInfo.id || certInfo.ID || BaseService.getNextId(this.sheetName);
        ws.appendRow(this._buildRow(headers, certInfo, newId));
        return { success: true, id: newId };
      }, 30000, "CertificateService.add");
    } catch (e) {
      BaseService.logError("add", e);
      return { success: false, error: e.message };
    }
  },

  update: function(id, certInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const lastRow = ws.getLastRow();
        if (lastRow < 2) throw new Error("Güncellenecek sertifika bulunamadı.");

        const ids = ws.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
        const rowIndex = ids.findIndex(v => String(v).toLowerCase() === String(id).toLowerCase());
        if (rowIndex === -1) throw new Error("Sertifika bulunamadı: " + id);

        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        ws.getRange(rowIndex + 2, 1, 1, headers.length).setValues([this._buildRow(headers, certInfo, String(id))]);
        return { success: true };
      }, 30000, "CertificateService.update");
    } catch (e) {
      BaseService.logError("update", e, { id: id });
      return { success: false, error: e.message };
    }
  },

  delete: function(id) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const lastRow = ws.getLastRow();
        if (lastRow < 2) throw new Error("Silinecek sertifika bulunamadı.");

        const ids = ws.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
        const rowIndex = ids.findIndex(v => String(v).toLowerCase() === String(id).toLowerCase());
        if (rowIndex === -1) throw new Error("Sertifika bulunamadı: " + id);

        ws.deleteRow(rowIndex + 2);
        return { success: true };
      }, 30000, "CertificateService.delete");
    } catch (e) {
      BaseService.logError("delete", e, { id: id });
      return { success: false, error: e.message };
    }
  },

  updateField: function(id, field, value) {
    try {
      if (!id) throw new Error("ID boş olamaz.");
      if (!field) throw new Error("Alan adı boş olamaz.");
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const lastRow = ws.getLastRow();
        if (lastRow < 2) throw new Error("Sertifika verisi bulunamadı.");

        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        const ids = ws.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
        const rowIndex = ids.findIndex(v => String(v).toLowerCase() === String(id).toLowerCase());
        if (rowIndex === -1) throw new Error("Sertifika bulunamadı: " + id);

        const fieldIdx = headers.findIndex(h => h === field);
        if (fieldIdx === -1) throw new Error("Alan bulunamadı: " + field);

        const rowNum = rowIndex + 2;
        if (field === "gozetim_confirmed") {
          ws.getRange(rowNum, fieldIdx + 1).setValue(
            (value === true || String(value).toLowerCase() === "true" || String(value) === "1") ? "TRUE" : "FALSE"
          );
        } else {
          ws.getRange(rowNum, fieldIdx + 1).setValue(value);
        }

        const tsIdx = headers.findIndex(h => h === "updated_at");
        if (tsIdx !== -1) ws.getRange(rowNum, tsIdx + 1).setValue(new Date().getTime());

        return { success: true };
      }, 30000, "CertificateService.updateField");
    } catch (e) {
      BaseService.logError("updateField", e, { id: id, field: field });
      return { success: false, error: e.message };
    }
  }
};
