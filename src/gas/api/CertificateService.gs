/**
 * 🎖️ CertificateService: Sertifika ve Denetim İş Mantığı
 *
 * Sertifika listeleri, gözetim denetimleri ve takvim güncellemelerini yönetir.
 */

const CertificateService = {
  sheetName: "certificates",

  _valueFromInfo: function(certInfo, aliases, fallback) {
    const list = Array.isArray(aliases) ? aliases : [aliases];
    for (const key of list) {
      if (certInfo[key] !== undefined && certInfo[key] !== null && certInfo[key] !== "") {
        return certInfo[key];
      }
    }
    return fallback !== undefined ? fallback : "";
  },

  _buildRowByHeaders: function(headers, certInfo, idValue) {
    return headers.map(header => {
      const n = BaseService.normalizeHeader(header);

      if (n === "id") return idValue;
      if (n === "firmano") return this._valueFromInfo(certInfo, ["firma_no"]);
      if (n === "standart") return this._valueFromInfo(certInfo, ["standart"]);
      if (n === "denetimtipi") return this._valueFromInfo(certInfo, ["denetim_tipi"]);
      if (n === "sertifikano") return this._valueFromInfo(certInfo, ["sertifika_no"]);
      if (n === "sertifikatarihi") return this._valueFromInfo(certInfo, ["sertifika_tarihi"]);
      if (n === "gozetimtarihi") return this._valueFromInfo(certInfo, ["gozetim_tarihi"]);
      if (n === "tesciltarihi") return this._valueFromInfo(certInfo, ["tescil_tarihi"]);
      if (n === "gecerliliktarihi") return this._valueFromInfo(certInfo, ["gecerlilik_tarihi"]);
      if (n === "kapsam") return this._valueFromInfo(certInfo, ["kapsam"]);
      if (n === "scope") return this._valueFromInfo(certInfo, ["scope"]);
      if (n === "logo") return this._valueFromInfo(certInfo, ["logo"]);
      if (n === "nace") return this._valueFromInfo(certInfo, ["nace"]);
      if (n === "akreditasyon") return this._valueFromInfo(certInfo, ["akreditasyon"]);
      if (n === "akredite") return this._valueFromInfo(certInfo, ["akredite"]);
      if (n === "consultant") return this._valueFromInfo(certInfo, ["consultant"]);
      if (n === "durum") return this._valueFromInfo(certInfo, ["durum"]);
      if (n === "sertifikanot") return this._valueFromInfo(certInfo, ["sertifika_not"]);
      if (n === "gozetimconfirmed") {
        const v = this._valueFromInfo(certInfo, ["gozetim_confirmed"], "FALSE");
        return v === true || String(v).toUpperCase() === "TRUE" || String(v) === "1" ? "TRUE" : "FALSE";
      }
      if (n === "otherstandart") return this._valueFromInfo(certInfo, ["other_standart"]);
      if (n === "calendarid") return this._valueFromInfo(certInfo, ["calendar_id"]);
      if (n === "qr") return this._valueFromInfo(certInfo, ["qr"]);
      if (n === "certlink") return this._valueFromInfo(certInfo, ["cert_link"]);
      if (n === "updatedat") return new Date().getTime();

      return this._valueFromInfo(certInfo, [header], "");
    });
  },

  /**
   * Tüm sertifika listesini döner.
   */
  getAll: function() {
    try {
      return BaseService.getDataAsObjects(this.sheetName);
    } catch (e) {
      BaseService.logError("getAll", e);
      return [];
    }
  },

  /**
   * Belirli bir sertifikayı ID ile getirir.
   * Legacy getCertificateById gibi direkt satır araması yapar —
   * tüm tabloyu belleğe yüklemez.
   */
  getById: function(id) {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName(this.sheetName);
      const lastRow = ws.getLastRow();
      if (lastRow < 2) return null;

      const ids = ws.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
      const rowIndex = ids.findIndex(v => String(v).toLowerCase() === String(id).toLowerCase());
      if (rowIndex === -1) return null;

      const rowNum = rowIndex + 2;
      const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
      const row = ws.getRange(rowNum, 1, 1, ws.getLastColumn()).getDisplayValues()[0];

      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });

      // "gozetim_confirmed" alanını boolean'a dönüştür
      const gc = obj["gozetim_confirmed"];
      obj["gozetim_confirmed"] = String(gc).trim().toLowerCase() === "true" || String(gc) === "1";

      return obj;
    } catch (e) {
      BaseService.logError("getById", e);
      return null;
    }
  },

  /**
   * Gözetim onay durumunu günceller.
   * Sütun adı: "gozetim_confirmed"
   */
  updateGozetim: function(id, status) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const lastRow = ws.getLastRow();

        const ids = ws.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
        const rowIndex = ids.findIndex(v => String(v) === String(id));
        if (rowIndex === -1) throw new Error("Sertifika bulunamadı: " + id);

        const realRow = rowIndex + 2;

        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0];
        const gozetimCol = headers.findIndex(h => String(h).trim() === "gozetim_confirmed") + 1;

        if (gozetimCol < 1) throw new Error('"gozetim_confirmed" sütunu bulunamadı.');

        ws.getRange(realRow, gozetimCol).setValue(status === "TRUE" || status === true ? "TRUE" : "FALSE");
        
        const tsCol = BaseService.findHeaderIndex(headers, ["updated_at"]);
        if (tsCol > 0) ws.getRange(realRow, tsCol).setValue(new Date().getTime());
        
        return { success: true };
      }, 30000, "CertificateService.updateGozetim");
    } catch (e) {
      BaseService.logError("updateGozetim", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Yeni sertifika kaydı ekler (legacy addCertificate).
   */
  add: function(certInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        
        // D1 ID önceliği
        const newId = certInfo.id || certInfo.ID || BaseService.getNextId(this.sheetName);
        
        const newRow = this._buildRowByHeaders(headers, certInfo || {}, newId);
        ws.appendRow(newRow);
        return { success: true, id: newId };
      }, 30000, "CertificateService.add");
    } catch (e) {
      BaseService.logError("add", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Sertifika kaydını tam satır günceller (legacy editCertificateById).
   */
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

        const rowNum = rowIndex + 2;
        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        const fullRow = this._buildRowByHeaders(headers, certInfo || {}, String(id));

        ws.getRange(rowNum, 1, 1, headers.length).setValues([fullRow]);
        return { success: true };
      }, 30000, "CertificateService.update");
    } catch (e) {
      BaseService.logError("update", e, { id: id });
      return { success: false, error: e.message };
    }
  },

  /**
   * Sertifika kaydını siler.
   */
  delete: function(id) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const lastRow = ws.getLastRow();
        if (lastRow < 2) throw new Error("Silinecek sertifika bulunamadı.");

        const idCol = 1;
        const ids = ws.getRange(2, idCol, lastRow - 1, 1).getDisplayValues().flat();
        const rowIndex = ids.findIndex(v => String(v).toLowerCase() === String(id).toLowerCase());
        if (rowIndex === -1) throw new Error("Sertifika bulunamadı: " + id);

        const rowNum = rowIndex + 2;
        ws.deleteRow(rowNum);
        return { success: true };
      }, 30000, "CertificateService.delete");
    } catch (e) {
      BaseService.logError("delete", e, { id: id });
      return { success: false, error: e.message };
    }
  },

  /**
   * Tek bir alanı günceller (legacy editCell).
   */
  updateField: function(id, field, value) {
    try {
      if (!id) throw new Error("ID boş olamaz.");
      if (!field) throw new Error("Alan adı boş olamaz.");
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const lastRow = ws.getLastRow();
        if (lastRow < 2) throw new Error("Sertifika verisi bulunamadı.");

        const lastCol = ws.getLastColumn();
        const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
        const idCol = BaseService.findHeaderIndex(headers, ["ID"]);
        if (idCol < 1) throw new Error("ID sütunu bulunamadı.");

        const ids = ws.getRange(2, idCol, lastRow - 1, 1).getDisplayValues().flat();
        const rowIndex = ids.findIndex(v => String(v).toLowerCase() === String(id).toLowerCase());
        if (rowIndex === -1) throw new Error("Sertifika bulunamadı: " + id);
        const rowNum = rowIndex + 2;

        const fieldCol = BaseService.findHeaderIndex(headers, [field]);
        if (fieldCol < 1) throw new Error("Alan bulunamadı: " + field);

        const normalizedField = BaseService.normalizeHeader(field);
        if (normalizedField === "gozetimconfirmed") {
          const boolVal = value === true || String(value).toLowerCase() === "true" || String(value) === "1";
          ws.getRange(rowNum, fieldCol).setValue(boolVal ? "TRUE" : "FALSE");
        } else {
          ws.getRange(rowNum, fieldCol).setValue(value);
        }

        const tsCol = BaseService.findHeaderIndex(headers, ["updated_at"]);
        if (tsCol > 0) ws.getRange(rowNum, tsCol).setValue(new Date().getTime());

        return { success: true };
      }, 30000, "CertificateService.updateField");
    } catch (e) {
      BaseService.logError("updateField", e, { id: id, field: field });
      return { success: false, error: e.message };
    }
  },

  /**
   * Belirli bir firmaya ait sertifikaları ham satır dizisi olarak döner.
   * Sütun 2 (0-indexed): Firma No.
   */
  getByFirmaId: function(firmaId) {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName(this.sheetName);
      const lastRow = ws.getLastRow();
      if (lastRow < 2) return [];

      const lastCol = ws.getLastColumn();
      const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
      const firmaNoCol = BaseService.findHeaderIndex(headers, ["firma_no", "Firma No"]);
      if (firmaNoCol < 1) throw new Error("Firma No sütunu bulunamadı.");

      const data = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
      return data.filter(r => String(r[firmaNoCol - 1]) === String(firmaId));
    } catch (e) {
      BaseService.logError("getByFirmaId", e);
      return [];
    }
  },

};