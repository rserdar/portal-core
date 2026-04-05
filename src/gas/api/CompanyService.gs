/**
 * 🏢 CompanyService: Firma İş Mantığı Katmanı
 * 
 * Firma ekleme, düzenleme ve arama verilerini yönetir.
 */

const CompanyService = {
  sheetName: "Firmalar",

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

      if (n === "firmano") return idValue;
      if (n === "firmaadi") return this._valueFromInfo(companyInfo, ["nickname", "nick"]);
      if (n === "unvan") return this._valueFromInfo(companyInfo, ["unvan"]);
      if (n === "adres") return this._valueFromInfo(companyInfo, ["adres"]);
      if (n === "il" || n === "sehir") return this._valueFromInfo(companyInfo, ["sehir", "il"]);
      if (n === "ulke") return this._valueFromInfo(companyInfo, ["ulke"], "TÜRKİYE");
      if (n === "yazismaadresi") return this._valueFromInfo(companyInfo, ["yazisma"]);
      if (n === "vergidairesi") return this._valueFromInfo(companyInfo, ["vergiD"]);
      if (n === "verginumarasi") return this._valueFromInfo(companyInfo, ["vergiN"]);
      if (n === "telefon") return this._valueFromInfo(companyInfo, ["tel"]);
      if (n === "faks") return this._valueFromInfo(companyInfo, ["faks"]);
      if (n === "internet") return this._valueFromInfo(companyInfo, ["www"]);
      if (n === "mail") return this._valueFromInfo(companyInfo, ["mail"]);
      if (n === "yetkiliadi") return this._valueFromInfo(companyInfo, ["yetA"]);
      if (n === "yetkiliunvani") return this._valueFromInfo(companyInfo, ["yetU"]);
      if (n === "kyt" || n === "kaliteyonetimtemsilcisi") return this._valueFromInfo(companyInfo, ["kyt"]);
      if (n === "irtibatkisi") return this._valueFromInfo(companyInfo, ["irtA"]);
      if (n === "irtibatunvani" || n === "irtibatkisiunvani") return this._valueFromInfo(companyInfo, ["irtU"]);
      if (n === "irtibattel" || n === "irtibatkisinumarasi") return this._valueFromInfo(companyInfo, ["irtN"]);
      if (n === "irtibatmail" || n === "irtibatkisismail") return this._valueFromInfo(companyInfo, ["irtM"]);
      if (n === "turkcekapsam" || n === "sertifikakapsamitr") return this._valueFromInfo(companyInfo, ["kapsam"]);
      if (n === "ingilizcekapsam" || n === "sertifikakapsamien") return this._valueFromInfo(companyInfo, ["scope"]);
      if (n === "yapilanis") return this._valueFromInfo(companyInfo, ["yapis"]);
      if (n === "tcs" || n === "toplamcalisan" || n === "toplamcalisansayisi") return this._valueFromInfo(companyInfo, ["tcs"], 0);
      if (n === "ycs" || n === "yonetimcalisan" || n === "yonetimcalisansayisi") return this._valueFromInfo(companyInfo, ["ycs"], 0);
      if (n === "ucs" || n === "uretimcalisan" || n === "uretimcalisansayisi") return this._valueFromInfo(companyInfo, ["ucs"], 0);
      if (n === "acs" || n === "ayniscalisan" || n === "ayniscalisansayisi") return this._valueFromInfo(companyInfo, ["acs"], 0);
      if (n === "yzcs" || n === "yarizamanlicalisan" || n === "yarizamanlicalisansayisi") return this._valueFromInfo(companyInfo, ["yzcs"], 0);
      if (n === "tascs" || n === "taseroncalisan" || n === "taseroncalisansayisi") return this._valueFromInfo(companyInfo, ["tascs"], 0);
      if (n === "alan") return this._valueFromInfo(companyInfo, ["alan"]);
      if (n === "departman") return this._valueFromInfo(companyInfo, ["dept", "departman"]);
      if (n === "vardiya") return this._valueFromInfo(companyInfo, ["vardiya"], 1);
      if (n === "logokase" || n === "firmalogosu" || n === "kaseimza") return this._valueFromInfo(companyInfo, ["logoK", "logo", "kase"]);
      if (n === "danisman") return this._valueFromInfo(companyInfo, ["dan", "danisman"]);
      if (n === "ea") return this._valueFromInfo(companyInfo, ["ea"]);
      if (n === "nace") return this._valueFromInfo(companyInfo, ["nace"]);
      if (n === "firmanot") return this._valueFromInfo(companyInfo, ["not"]);

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

  /**
   * Benzersiz danışman isimlerini döner (Firma ekleme formu için).
   */
  getConsultants: function() {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName(this.sheetName);
      const lastRow = ws.getLastRow();
      if (lastRow < 2) return [];

      const lastCol = ws.getLastColumn();
      const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
      const consultantCol = BaseService.findHeaderIndex(headers, ["Danışman", "Danisman", "dan"]);
      if (consultantCol < 1) throw new Error("Danışman sütunu bulunamadı.");

      const values = ws.getRange(2, consultantCol, lastRow - 1, 1).getDisplayValues().flat();
      return [...new Set(values.filter(v => v && String(v).trim()))].sort();
    } catch (e) {
      BaseService.logError("getConsultants", e);
      return [];
    }
  }
};
