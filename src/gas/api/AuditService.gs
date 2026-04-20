/**
 * 📋 Denetim Servisi (v7.0 — Calendar entegrasyonu kaldırıldı)
 *
 * Sadece Sheets backup okuma/yazma. CRUD D1-primary'e taşındı.
 * Google Calendar entegrasyonu artık kullanılmıyor.
 */
const AuditService = {
  sheetName: "audits",

  _valueFromInfo: function(auditInfo, aliases, fallback) {
    const list = Array.isArray(aliases) ? aliases : [aliases];
    for (const key of list) {
      if (auditInfo[key] !== undefined && auditInfo[key] !== null && auditInfo[key] !== "") {
        return auditInfo[key];
      }
    }
    return fallback !== undefined ? fallback : "";
  },

  _buildRowByHeaders: function(headers, auditInfo, idValue) {
    return headers.map(header => {
      const n = BaseService.normalizeHeader(header);

      if (n === "id") return idValue;
      if (n === "nickname" || n === "nick") return this._valueFromInfo(auditInfo, ["nickname", "nick"]);
      if (n === "firmano") return this._valueFromInfo(auditInfo, ["firma_no", "firmaNo", "firmano"]);
      if (n === "sertifikaid") return this._valueFromInfo(auditInfo, ["sertifika_id", "sertifikaId", "certId"]);
      if (n === "standart") return this._valueFromInfo(auditInfo, ["standart"]);
      if (n === "denetimtipi") return this._valueFromInfo(auditInfo, ["denetim_tipi", "denetimTipi", "denetim"]);

      if (n === "a1baslangic") return this._valueFromInfo(auditInfo, ["a1_baslangic", "a1Basla"]);
      if (n === "a1bitis") return this._valueFromInfo(auditInfo, ["a1_bitis", "a1Bitis"]);
      if (n === "a1manday") return this._valueFromInfo(auditInfo, ["a1_manday", "a1Md"], "");
      if (n === "a1basdenetci") return this._valueFromInfo(auditInfo, ["a1_bas_denetci", "a1La"], "");
      if (n === "a1denetci2") return this._valueFromInfo(auditInfo, ["a1_denetci_2", "a1Fa"], "");
      if (n === "a1denetci3") return this._valueFromInfo(auditInfo, ["a1_denetci_3", "a1Sa"], "");

      if (n === "a2baslangic") return this._valueFromInfo(auditInfo, ["a2_baslangic", "a2Basla"]);
      if (n === "a2bitis") return this._valueFromInfo(auditInfo, ["a2_bitis", "a2Bitis"]);
      if (n === "a2manday") return this._valueFromInfo(auditInfo, ["a2_manday", "a2Md"], "");
      if (n === "a2basdenetci") return this._valueFromInfo(auditInfo, ["a2_bas_denetci", "a2La"], "");
      if (n === "a2denetci2") return this._valueFromInfo(auditInfo, ["a2_denetci_2", "a2Fa"], "");
      if (n === "a2denetci3") return this._valueFromInfo(auditInfo, ["a2_denetci_3", "a2Sa"], "");

      if (n === "updatedat") return new Date().getTime();

      return this._valueFromInfo(auditInfo, [header], "");
    });
  },

  _pickCell: function(row, idx, fallback) {
    if (!idx || idx < 1) return fallback !== undefined ? fallback : "";
    return row[idx - 1];
  },

  getAudits: function() {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName(this.sheetName);
      const lastRow = ws.getLastRow();
      if (lastRow < 2) return [];

      const lastCol = ws.getLastColumn();
      const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
      const data = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();

      const cols = {
        id:          BaseService.findHeaderIndex(headers, ["id", "ID"]),
        nick:        BaseService.findHeaderIndex(headers, ["nick", "nickname", "Firma Adı"]),
        firmaNo:     BaseService.findHeaderIndex(headers, ["firma_no", "Firma No"]),
        standart:    BaseService.findHeaderIndex(headers, ["standart", "Standart"]),
        denetimTipi: BaseService.findHeaderIndex(headers, ["denetim_tipi", "Denetim Tipi"]),
        a1Basla:     BaseService.findHeaderIndex(headers, ["a1_baslangic", "A1 Başla"]),
        a1Bitis:     BaseService.findHeaderIndex(headers, ["a1_bitis", "A1 Bitiş"]),
        a1Md:        BaseService.findHeaderIndex(headers, ["a1_manday", "A1 MD"]),
        a1La:        BaseService.findHeaderIndex(headers, ["a1_bas_denetci", "A1 LA"]),
        a1Fa:        BaseService.findHeaderIndex(headers, ["a1_denetci_2", "A1 FA"]),
        a1Sa:        BaseService.findHeaderIndex(headers, ["a1_denetci_3", "A1 SA"]),
        a2Basla:     BaseService.findHeaderIndex(headers, ["a2_baslangic", "A2 Başla"]),
        a2Bitis:     BaseService.findHeaderIndex(headers, ["a2_bitis", "A2 Bitiş"]),
        a2Md:        BaseService.findHeaderIndex(headers, ["a2_manday", "A2 MD"]),
        a2La:        BaseService.findHeaderIndex(headers, ["a2_bas_denetci", "A2 LA"]),
        a2Fa:        BaseService.findHeaderIndex(headers, ["a2_denetci_2", "A2 FA"]),
        a2Sa:        BaseService.findHeaderIndex(headers, ["a2_denetci_3", "A2 SA"]),
      };

      return data.map(r => ({
        id:          this._pickCell(r, cols.id, ""),
        nick:        this._pickCell(r, cols.nick, ""),
        firmaNo:     this._pickCell(r, cols.firmaNo, ""),
        standart:    this._pickCell(r, cols.standart, ""),
        denetimTipi: this._pickCell(r, cols.denetimTipi, ""),
        a1Basla:     this._pickCell(r, cols.a1Basla, ""),
        a1Bitis:     this._pickCell(r, cols.a1Bitis, ""),
        a1Md:        this._pickCell(r, cols.a1Md, ""),
        a1La:        this._pickCell(r, cols.a1La, ""),
        a1Fa:        this._pickCell(r, cols.a1Fa, ""),
        a1Sa:        this._pickCell(r, cols.a1Sa, ""),
        a2Basla:     this._pickCell(r, cols.a2Basla, ""),
        a2Bitis:     this._pickCell(r, cols.a2Bitis, ""),
        a2Md:        this._pickCell(r, cols.a2Md, ""),
        a2La:        this._pickCell(r, cols.a2La, ""),
        a2Fa:        this._pickCell(r, cols.a2Fa, ""),
        a2Sa:        this._pickCell(r, cols.a2Sa, ""),
      })).reverse();
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
        const newRow = this._buildRowByHeaders(headers, auditInfo || {}, newID);
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
        const idCol = BaseService.findHeaderIndex(headers, ["ID"]);
        if (idCol < 1) throw new Error("ID sütunu bulunamadı.");

        const rows = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
        const rowIndex = rows.findIndex(r => String(r[idCol - 1]) === String(id));
        if (rowIndex === -1) throw new Error("Denetim bulunamadı: " + id);

        const rowNum = rowIndex + 2;
        const fullRow = this._buildRowByHeaders(headers, auditInfo || {}, String(id));
        ws.getRange(rowNum, 1, 1, headers.length).setValues([fullRow]);
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
        const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
        const idCol = BaseService.findHeaderIndex(headers, ["ID"]);
        const gozetimCol = BaseService.findHeaderIndex(headers, ["gozetim_confirmed", "Gözetim Conf."]);
        const tsCol = BaseService.findHeaderIndex(headers, ["updated_at"]);

        if (idCol < 1) throw new Error("ID sütunu bulunamadı.");
        if (gozetimCol < 1) throw new Error("gozetim_confirmed sütunu bulunamadı.");

        const data = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();

        ids.forEach(id => {
          const rowIndex = data.findIndex(r => String(r[idCol - 1]) === String(id));
          if (rowIndex === -1) return;
          const rowNum = rowIndex + 2;
          ws.getRange(rowNum, gozetimCol).setValue(status ? "TRUE" : "FALSE");
          if (tsCol > 0) ws.getRange(rowNum, tsCol).setValue(new Date().getTime());
        });

        return { success: true };
      }, 30000, "AuditService.updateSurveillance");
    } catch (e) {
      BaseService.logError("updateSurveillance", e);
      return { success: false, error: e.message };
    }
  }
};
