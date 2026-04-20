/**
 * 🏢 CompanyService: Firma İş Mantığı Katmanı
 * 
 * Firma ekleme, düzenleme ve arama verilerini yönetir.
 */

const CompanyService = {
  sheetName: "companies",

  _valueFromInfo: function(companyInfo, aliases, fallback) {
    const list = Array.isArray(aliases) ? aliases : [aliases];
    for (const key of list) {
      if (companyInfo[key] !== undefined && companyInfo[key] !== null && companyInfo[key] !== "") {
        return companyInfo[key];
      }
    }
    return fallback !== undefined ? fallback : "";
  },

  _buildRowByHeaders: function(headers, companyInfo, idValue) {
    return headers.map(header => {
      const n = BaseService.normalizeHeader(header);

      if (n === "id")           return idValue;
      if (n === "nickname")     return this._valueFromInfo(companyInfo, ["nickname"]);
      if (n === "unvan")        return this._valueFromInfo(companyInfo, ["unvan"]);
      if (n === "adres")        return this._valueFromInfo(companyInfo, ["adres"]);
      if (n === "city")         return this._valueFromInfo(companyInfo, ["city"]);
      if (n === "ulke")         return this._valueFromInfo(companyInfo, ["ulke"], "TÜRKİYE");
      if (n === "yazisma")      return this._valueFromInfo(companyInfo, ["yazisma"]);
      if (n === "vergidairesi") return this._valueFromInfo(companyInfo, ["vergi_dairesi"]);
      if (n === "vergino")      return this._valueFromInfo(companyInfo, ["vergi_no"]);
      if (n === "tel")          return this._valueFromInfo(companyInfo, ["tel"]);
      if (n === "faks")         return this._valueFromInfo(companyInfo, ["faks"]);
      if (n === "www")          return this._valueFromInfo(companyInfo, ["www"]);
      if (n === "mail")         return this._valueFromInfo(companyInfo, ["mail"]);
      if (n === "yetkiliadi")   return this._valueFromInfo(companyInfo, ["yetkili_adi"]);
      if (n === "yetkiliunvani")return this._valueFromInfo(companyInfo, ["yetkili_unvani"]);
      if (n === "kyt")          return this._valueFromInfo(companyInfo, ["kyt"]);
      if (n === "irtibatkisi")  return this._valueFromInfo(companyInfo, ["irtibat_kisi"]);
      if (n === "irtibatunvani")return this._valueFromInfo(companyInfo, ["irtibat_unvani"]);
      if (n === "irtibattel")   return this._valueFromInfo(companyInfo, ["irtibat_tel"]);
      if (n === "irtibatmail")  return this._valueFromInfo(companyInfo, ["irtibat_mail"]);
      if (n === "yapilanis")    return this._valueFromInfo(companyInfo, ["yapilan_is"]);
      if (n === "tcs")          return this._valueFromInfo(companyInfo, ["tcs"], 0);
      if (n === "ycs")          return this._valueFromInfo(companyInfo, ["ycs"], 0);
      if (n === "ucs")          return this._valueFromInfo(companyInfo, ["ucs"], 0);
      if (n === "acs")          return this._valueFromInfo(companyInfo, ["acs"], 0);
      if (n === "yzcs")         return this._valueFromInfo(companyInfo, ["yzcs"], 0);
      if (n === "tascs")        return this._valueFromInfo(companyInfo, ["tascs"], 0);
      if (n === "alan")         return this._valueFromInfo(companyInfo, ["alan"]);
      if (n === "departman")    return this._valueFromInfo(companyInfo, ["departman"]);
      if (n === "vardiya")      return this._valueFromInfo(companyInfo, ["vardiya"], 1);
      if (n === "logo")         return this._valueFromInfo(companyInfo, ["logo"]);
      if (n === "kase")         return this._valueFromInfo(companyInfo, ["kase"]);
      if (n === "dokuman")      return this._valueFromInfo(companyInfo, ["dokuman"]);
      if (n === "teknik")       return this._valueFromInfo(companyInfo, ["teknik"]);
      if (n === "tkapsam")      return this._valueFromInfo(companyInfo, ["tkapsam"]);
      if (n === "sinif")        return this._valueFromInfo(companyInfo, ["sinif"]);
      if (n === "firmanot")     return this._valueFromInfo(companyInfo, ["firma_not"]);
      if (n === "updatedat")    return new Date().getTime();

      return this._valueFromInfo(companyInfo, [header], "");
    });
  },

  /**
   * Tüm firma listesini (Hafif Veri) döner.
   * Search Sync için optimize edilmiştir.
   */
  getAllForSync: function() {
    try {
      return BaseService.getDataAsObjects(this.sheetName);
    } catch (e) {
      BaseService.logError("getAllForSync", e);
      return [];
    }
  },

  /**
   * Belirtilen ID'ye sahip firmayı tüm detaylarıyla getirir.
   */
  getById: function(id) {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName(this.sheetName);
      const lastRow = ws.getLastRow();
      if (lastRow < 2) return null;

      // 1. ID Sütununda ara (Zeki Arama)
      const ids = ws.getRange(2, 1, lastRow - 1, 1).getValues().flat();
      const rowIndex = ids.findIndex(rowId => String(rowId) === String(id));
      
      if (rowIndex === -1) return null;

      // 2. Sadece o satırı getir (Performans)
      const dataRow = ws.getRange(rowIndex + 2, 1, 1, ws.getLastColumn()).getDisplayValues()[0];
      const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0].map(h => String(h).trim());

      const obj = {};
      headers.forEach((h, i) => obj[h] = dataRow[i]);
      obj.__etag = BaseService.createRowEtag(headers, dataRow);
      return obj;
    } catch (e) {
      BaseService.logError("getById", e);
      return null;
    }
  },

  /**
   * Yeni bir firma ekler.
   */
  add: function(companyInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        const newId = BaseService.getNextId(this.sheetName);
        const newRow = this._buildRowByHeaders(headers, companyInfo || {}, newId);
        ws.appendRow(newRow);
        return { success: true, id: newId };
      }, 30000, "CompanyService.add");
    } catch (e) {
      BaseService.logError("add", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Mevcut bir firmayı tam satır güncellemesi ile günceller (legacy editCompanyById).
   */
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
        const currentRow = ws.getRange(rowNum, 1, 1, headers.length).getDisplayValues()[0];
        const currentEtag = BaseService.createRowEtag(headers, currentRow);
        if (expectedEtag && String(expectedEtag).trim() && String(expectedEtag) !== currentEtag) {
          return {
            success: false,
            error: "CONFLICT",
            code: "CONFLICT",
            message: "Kayıt başka bir kullanıcı tarafından güncellenmiş.",
            currentEtag: currentEtag
          };
        }
        const fullRow = this._buildRowByHeaders(headers, companyInfo || {}, String(id));

        ws.getRange(rowNum, 1, 1, headers.length).setValues([fullRow]);
        return { success: true, etag: BaseService.createRowEtag(headers, fullRow) };
      }, 30000, "CompanyService.update");
    } catch (e) {
      BaseService.logError("update", e, { id: id });
      return { success: false, error: e.message };
    }
  },

};
