/**
 * 🎖️ CertificateService: Sertifika ve Denetim İş Mantığı
 *
 * Sertifika listeleri, gözetim denetimleri ve takvim güncellemelerini yönetir.
 */

const CertificateService = {
  sheetName: "Sertifika",

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
      if (n === "nickname" || n === "nick") return this._valueFromInfo(certInfo, ["nick", "nickname"]);
      if (n === "firmano") return this._valueFromInfo(certInfo, ["firmano", "firmaNo"]);
      if (n === "standart" || n === "standard") return this._valueFromInfo(certInfo, ["standart", "standard"]);
      if (n === "denetimtipi" || n === "denetim") return this._valueFromInfo(certInfo, ["denetim"]);
      if (n === "sno" || n === "sertifikano") return this._valueFromInfo(certInfo, ["sno", "sNo"]);
      if (n === "gst" || n === "sertifikatarihi") return this._valueFromInfo(certInfo, ["gst", "sTarihi"]);
      if (n === "goz" || n === "sertifikagozetimtarihi") return this._valueFromInfo(certInfo, ["goz", "sGozetimT"]);
      if (n === "stt" || n === "sontetkiktarihi") return this._valueFromInfo(certInfo, ["stt", "sTT"]);
      if (n === "sgt" || n === "sertifikagecerliliktarihi") return this._valueFromInfo(certInfo, ["sgt", "sGT"]);
      if (n === "kapsam") return this._valueFromInfo(certInfo, ["kapsam"]);
      if (n === "scope") return this._valueFromInfo(certInfo, ["scope"]);
      if (n === "logo") return this._valueFromInfo(certInfo, ["logo"]);
      if (n === "kod") return this._valueFromInfo(certInfo, ["kod"]);
      if (n === "akreditasyon" || n === "akrn") return this._valueFromInfo(certInfo, ["akreditasyon", "akrn"]);
      if (n === "akredite") return this._valueFromInfo(certInfo, ["akredite"]);
      if (n === "danisman" || n === "dan") return this._valueFromInfo(certInfo, ["dan"]);
      if (n === "durum") return this._valueFromInfo(certInfo, ["durum"]);
      if (n === "not") return this._valueFromInfo(certInfo, ["not"]);
      if (n === "gozetimconf") {
        const v = this._valueFromInfo(certInfo, ["gdurum", "gozetimConfirmed"], "FALSE");
        return v === true || String(v).toUpperCase() === "TRUE" ? "TRUE" : "FALSE";
      }
      if (n === "other" || n === "diger") return this._valueFromInfo(certInfo, ["other"]);
      if (n === "calendarid" || n === "eventid") return this._valueFromInfo(certInfo, ["cal", "calendar", "eventId"]);
      if (n === "qrcode" || n === "qr") return this._valueFromInfo(certInfo, ["qr"]);
      if (n === "certlink" || n === "certilink") return this._valueFromInfo(certInfo, ["certLink", "certiLink"]);
      if (n === "_updated_at") return new Date().getTime();

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

      // "Gözetim Conf." alanını boolean'a dönüştür (legacy ile uyumlu)
      const gc = obj["Gözetim Conf."];
      obj["gozetimConfirmed"] = String(gc).trim().toLowerCase() === "true";

      return obj;
    } catch (e) {
      BaseService.logError("getById", e);
      return null;
    }
  },

  /**
   * Gözetim onay durumunu günceller.
   * Sütun adı: "Gözetim Conf." (schema indeks 19, T sütunu).
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
        const gozetimCol = headers.findIndex(h => String(h).trim() === "Gözetim Conf.") + 1;

        if (gozetimCol < 1) throw new Error('"Gözetim Conf." sütunu bulunamadı.');

        ws.getRange(realRow, gozetimCol).setValue(status === "TRUE" || status === true ? "TRUE" : "FALSE");
        
        const tsCol = BaseService.findHeaderIndex(headers, ["_updated_at"]);
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
        const newId = BaseService.getNextId(this.sheetName);
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
        if (normalizedField === "gozetim" || normalizedField === "gozetimconf") {
          const boolVal = value === true || String(value).toLowerCase() === "true" || String(value) === "1";
          ws.getRange(rowNum, fieldCol).setValue(boolVal ? "TRUE" : "FALSE");
        } else {
          ws.getRange(rowNum, fieldCol).setValue(value);
        }

        const tsCol = BaseService.findHeaderIndex(headers, ["_updated_at"]);
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
      const firmaNoCol = BaseService.findHeaderIndex(headers, ["Firma No", "FirmaNo", "FNo", "firmano"]);
      if (firmaNoCol < 1) throw new Error("Firma No sütunu bulunamadı.");

      const data = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
      return data.filter(r => String(r[firmaNoCol - 1]) === String(firmaId));
    } catch (e) {
      BaseService.logError("getByFirmaId", e);
      return [];
    }
  },

  /**
   * Son N sertifika kaydını döner (legacy lastTwentyFive).
   * Legacy uyumu için ilk 7 sütun döndürülür.
   */
  getRecent: function(limit) {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName(this.sheetName);
      const lastRow = ws.getLastRow();
      if (lastRow < 2) return [];

      const requested = parseInt(limit, 10);
      const take = !isNaN(requested) && requested > 0 ? requested : 25;
      let startRow = lastRow - take + 1;
      if (startRow < 2) startRow = 2;

      const numRows = lastRow - startRow + 1;
      const colCount = Math.min(7, ws.getLastColumn());
      return ws.getRange(startRow, 1, numRows, colCount).getDisplayValues();
    } catch (e) {
      BaseService.logError("getRecent", e, { limit: limit });
      return [];
    }
  }
};
