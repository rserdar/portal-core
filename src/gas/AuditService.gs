/**
 * 📋 Denetim Servisi (v7.0 — Calendar entegrasyonu kaldırıldı)
 *
 * Sadece Sheets backup okuma/yazma. CRUD D1-primary'e taşındı.
 */
const AuditService = {
  sheetName: "audits",

  getAudits: function() {
    try {
      return BaseService.getDataAsObjects(this.sheetName).reverse();
    } catch (e) {
      BaseService.logError("getAudits", e);
      return [];
    }
  },

  scheduleAudit: function(auditInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const lastCol = ws.getLastColumn();
        const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());

        const newID = auditInfo.id || auditInfo.ID || BaseService.getNextId(this.sheetName);
        const newRow = headers.map(h => {
          if (h === "id" || h === "ID") return newID;
          if (h === "updated_at") return new Date().getTime();
          if (auditInfo[h] === undefined) Logger.log("[AuditService.scheduleAudit] Eşleşmeyen header: " + h);
          return auditInfo[h] !== undefined ? auditInfo[h] : "";
        });
        ws.appendRow(newRow);

        return { success: true, id: newID };
      }, 30000, "AuditService.scheduleAudit");
    } catch (e) {
      BaseService.logError("scheduleAudit", e);
      return { success: false, error: e.message };
    }
  },

  updateAudit: function(id, auditInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const lastRow = ws.getLastRow();
        if (lastRow < 2) throw new Error("Güncellenecek denetim bulunamadı.");

        const lastCol = ws.getLastColumn();
        const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
        const idColIdx = headers.findIndex(h => h === "id" || h === "ID");
        if (idColIdx === -1) throw new Error("ID sütunu bulunamadı.");

        const rows = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
        const rowIndex = rows.findIndex(r => String(r[idColIdx]) === String(id));
        if (rowIndex === -1) throw new Error("Denetim bulunamadı: " + id);

        const fullRow = headers.map(h => {
          if (h === "id" || h === "ID") return String(id);
          if (h === "updated_at") return new Date().getTime();
          if (auditInfo[h] === undefined) Logger.log("[AuditService.updateAudit] Eşleşmeyen header: " + h);
          return auditInfo[h] !== undefined ? auditInfo[h] : rows[rowIndex][headers.indexOf(h)];
        });
        ws.getRange(rowIndex + 2, 1, 1, headers.length).setValues([fullRow]);
        return { success: true };
      }, 30000, "AuditService.updateAudit");
    } catch (e) {
      BaseService.logError("updateAudit", e, { id: id });
      return { success: false, error: e.message };
    }
  },

  updateSurveillance: function(ids, status) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName("certificates");
        const lastRow = ws.getLastRow();
        if (lastRow < 2) return { success: true };

        const lastCol = ws.getLastColumn();
        const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
        const idColIdx = headers.findIndex(h => h === "id" || h === "ID");
        const gozetimColIdx = headers.findIndex(h => h === "gozetim_confirmed");
        const tsColIdx = headers.findIndex(h => h === "updated_at");

        if (idColIdx === -1) throw new Error("ID sütunu bulunamadı.");
        if (gozetimColIdx === -1) throw new Error("gozetim_confirmed sütunu bulunamadı.");

        const data = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();

        ids.forEach(id => {
          const rowIndex = data.findIndex(r => String(r[idColIdx]) === String(id));
          if (rowIndex === -1) return;
          const rowNum = rowIndex + 2;
          ws.getRange(rowNum, gozetimColIdx + 1).setValue(status ? "TRUE" : "FALSE");
          if (tsColIdx !== -1) ws.getRange(rowNum, tsColIdx + 1).setValue(new Date().getTime());
        });

        return { success: true };
      }, 30000, "AuditService.updateSurveillance");
    } catch (e) {
      BaseService.logError("updateSurveillance", e);
      return { success: false, error: e.message };
    }
  }
};
