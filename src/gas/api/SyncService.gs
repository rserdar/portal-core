/**
 * 🔄 SyncService: Toplu Veri Senkronizasyonu
 * 
 * Tüm önemli Sheet verilerini tek bir paket olarak Cloudflare KV'ye aktarmak için kullanılır.
 */

const SyncService = {
  _backupConfirm: {
    cachePrefix: "backup_confirm:",
    ttlSec: 600,
    phrase: "GOOGLE_SHEETS_BACKUP_ONAY"
  },

  _newConfirmationToken: function() {
    const raw = Utilities.getUuid().replace(/-/g, "") + "_" + new Date().getTime();
    return raw;
  },

  _issueBackupConfirmation: function(reason) {
    const token = this._newConfirmationToken();
    const cfg = this._backupConfirm;
    CacheService.getScriptCache().put(cfg.cachePrefix + token, "1", cfg.ttlSec);
    return {
      success: false,
      requiresConfirmation: true,
      error: reason || "CONFIRMATION_REQUIRED",
      confirmation: {
        token: token,
        expiresInSec: cfg.ttlSec,
        phrase: cfg.phrase,
        message: "Google Sheets'e yedek geri yükleme işlemini onaylamak için aynı token ve phrase ile isteği tekrar gönderin."
      }
    };
  },

  _consumeBackupConfirmation: function(token) {
    if (!token) return false;
    const cfg = this._backupConfirm;
    const cache = CacheService.getScriptCache();
    const key = cfg.cachePrefix + token;
    const exists = cache.get(key);
    if (!exists) return false;
    cache.remove(key);
    return true;
  },

  _safeRead: function(syncWarnings, label, reader) {
    try {
      return reader() || [];
    } catch (err) {
      BaseService.logError(`getFullExport:${label}`, err);
      syncWarnings.push({ source: label, error: String(err.message || err) });
      return [];
    }
  },

  _getSheetAndHeaders: function(sheetName) {
    const ss = BaseService.openSS();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error(`${sheetName} sayfası bulunamadı.`);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
    return { sheet: sheet, headers: headers };
  },

  _clearDataRows: function(sheet) {
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }
  },

  _writeObjects: function(sheetName, objects, replace) {
    const rows = Array.isArray(objects) ? objects : [];
    const sh = this._getSheetAndHeaders(sheetName);
    const sheet = sh.sheet;
    const headers = sh.headers;

    if (replace) this._clearDataRows(sheet);
    if (!rows.length) return 0;

    const values = rows.map(obj => {
      const src = obj && typeof obj === "object" ? obj : {};
      return headers.map(h => (src[h] !== undefined && src[h] !== null) ? src[h] : "");
    });
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
    return values.length;
  },

  _writeRawRows: function(sheetName, dataRows, replace) {
    const rows = Array.isArray(dataRows) ? dataRows : [];
    const sh = this._getSheetAndHeaders(sheetName);
    const sheet = sh.sheet;
    const headers = sh.headers;

    if (replace) this._clearDataRows(sheet);
    if (!rows.length) return 0;

    const normalized = rows.map(row => {
      const arr = Array.isArray(row) ? row.slice(0, headers.length) : [];
      while (arr.length < headers.length) arr.push("");
      return arr;
    });
    sheet.getRange(2, 1, normalized.length, headers.length).setValues(normalized);
    return normalized.length;
  },

  _mapAuditRows: function(rows) {
    const list = Array.isArray(rows) ? rows : [];
    return list.map(function(row) {
      const r = Array.isArray(row) ? row : [];
      return {
        id: r[0] || "",
        nick: r[1] || "",
        firmaNo: r[2] || "",
        standart: r[3] || "",
        denetimTipi: r[4] || "",
        a1Full: r[5] || "",
        a1Auditor: r[6] || "",
        a2Full: r[7] || "",
        a2Auditor: r[8] || "",
        a1Basla: r[9] || "",
        a1Bitis: r[10] || "",
        a1Md: r[11] || "",
        a1La: r[12] || "",
        a1Fa: r[13] || "",
        a1Sa: r[14] || "",
        a2Basla: r[15] || "",
        a2Bitis: r[16] || "",
        a2Md: r[17] || "",
        a2La: r[18] || "",
        a2Fa: r[19] || "",
        a2Sa: r[20] || "",
        qms: r[21] || "",
        mdd: r[22] || "",
        ems: r[23] || "",
        ohs: r[24] || "",
        fsms: r[25] || "",
        isms: r[26] || "",
        engy: r[27] || "",
        gmp: r[28] || "",
        a1kDenet: r[29] || "",
        a2kDenet: r[30] || "",
        a1EventId: r[31] || "",
        a2EventId: r[32] || ""
      };
    });
  },

  /**
   * Tüm sistem verilerini (veya seçili kapsamı) dışa aktarır.
   * @param {string[]} scope - İsteğe bağlı kapsam dizisi (örn: ["certificates", "companies"])
   * @param {Object} params - Paging parametreleri {offset, limit}
   */
  getFullExport: function(scope, params) {
    const start = new Date().getTime();
    const p = params || {};
    const offset = p.offset;
    const limit = p.limit;

    try {
      const syncWarnings = [];
      const data = { lastUpdate: new Date().getTime().toString(), syncWarnings, totalCount: 0 };
      
      const has = function(s) { 
        return !scope || (Array.isArray(scope) && scope.includes(s)); 
      };

      if (has("companies")) {
        data.companies = BaseService.getDataAsObjects("Firmalar", offset, limit);
        data.totalCount = BaseService.getTotalRows("Firmalar");
      }
      if (has("certificates")) {
        data.certificates = BaseService.getDataAsObjects("Sertifika", offset, limit);
        data.totalCount = BaseService.getTotalRows("Sertifika");
      }
      if (has("tests")) {
        data.tests = BaseService.getRawData("Testler", offset, limit);
        data.totalCount = BaseService.getTotalRows("Testler");
      }
      if (has("audits")) {
        const audits = BaseService.getRawData("Denetim", offset, limit);
        data.audits = audits;
        data.auditObjects = this._mapAuditRows(audits);
        data.totalCount = BaseService.getTotalRows("Denetim");
      }
      if (has("proformas")) {
        data.proformas = BaseService.getRawData("Proforma", offset, limit);
        data.totalCount = BaseService.getTotalRows("Proforma");
      }
      if (has("master")) {
        data.consultants = CompanyService.getConsultants();
        data.standards = BaseService.getDataAsObjects("Standarts");
        data.auditors = BaseService.getDataAsObjects("Auditors");
        data.testdocs = BaseService.getRawData("TestDoc");
        data.sysdocs = BaseService.getRawData("SysDoc");
        data.totalCount = 1; // Master data genellikle paging gerektirmez
      }

      PropertiesService.getScriptProperties().setProperty("LAST_UPDATE", data.lastUpdate);
      const end = new Date().getTime();
      Logger.log(`[SyncService] Chunked Export (${scope || 'ALL'}) took ${end - start}ms`);
      return data;
    } catch (e) {
      BaseService.logError("getFullExport", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Tam yedek paketi üretir (export).
   * @returns {{version:string,createdAt:string,data:Object}}
   */
  exportBackup: function() {
    const data = this.getFullExport();
    if (data && data.success === false) return data;
    const masterData = MasterDataService.getForSync();
    if (masterData && masterData.success === false) {
      return { success: false, error: "Master data export başarısız: " + masterData.error };
    }
    return {
      version: "v1",
      createdAt: new Date().toISOString(),
      data: data,
      masterData: masterData
    };
  },

  /**
   * Yedek paketinden geri yükleme yapar (replace mode).
   * Güvenlik için options.replace=true zorunludur.
   */
  importBackup: function(payload, options) {
    try {
      return BaseService.withScriptLock(() => {
        const opts = options || {};
        const replace = opts.replace === true;
        if (!replace) {
          throw new Error("Güvenlik için importBackup yalnızca options.replace=true ile çalışır.");
        }

        // 2. doğrulama protokolü:
        // 1) İlk çağrı token üretir (requiresConfirmation=true)
        // 2) İkinci çağrı aynı token + phrase + confirm=true ile devam eder
        const hasConfirm = opts.confirm === true;
        const hasPhrase = String(opts.confirmText || "").trim() === this._backupConfirm.phrase;
        const token = String(opts.confirmToken || "").trim();
        if (!hasConfirm || !hasPhrase) {
          return this._issueBackupConfirmation("CONFIRMATION_REQUIRED");
        }
        if (!this._consumeBackupConfirmation(token)) {
          return this._issueBackupConfirmation("CONFIRMATION_TOKEN_INVALID_OR_EXPIRED");
        }

        const backup = payload && payload.data ? payload.data : payload;
        if (!backup || typeof backup !== "object") {
          throw new Error("Geçersiz backup payload.");
        }

      const companies = Array.isArray(backup.companies) ? backup.companies : [];
      const certificates = Array.isArray(backup.certificates) ? backup.certificates : [];
      const certificateRows = Array.isArray(backup.certificateRows) ? backup.certificateRows : [];
      const tests = Array.isArray(backup.tests) ? backup.tests : [];
      const audits = Array.isArray(backup.audits) ? backup.audits : [];
      const proformas = Array.isArray(backup.proformas) ? backup.proformas : [];
      const standards = Array.isArray(backup.standards) ? backup.standards : [];
      const masterData = backup.masterData && backup.masterData.datasets ? backup.masterData : null;
      const masterSets = masterData ? masterData.datasets : {};
      const masterStandardsRows = Array.isArray(masterSets.standards && masterSets.standards.rows) ? masterSets.standards.rows : [];
      const masterAuditorsRows = Array.isArray(masterSets.auditors && masterSets.auditors.rows) ? masterSets.auditors.rows : (Array.isArray(backup.auditors) ? backup.auditors : []);
      const masterConsultantsRows = Array.isArray(masterSets.consultants && masterSets.consultants.rows) ? masterSets.consultants.rows : (Array.isArray(backup.consultantsRows) ? backup.consultantsRows : []);
      const masterTestDocsRows = Array.isArray(masterSets.testdocs && masterSets.testdocs.rows) ? masterSets.testdocs.rows : (Array.isArray(backup.testdocs) ? backup.testdocs : []);
      const masterSysDocsRows = Array.isArray(masterSets.sysdocs && masterSets.sysdocs.rows) ? masterSets.sysdocs.rows : (Array.isArray(backup.sysdocs) ? backup.sysdocs : []);

      const stats = {};
      stats.companies = this._writeObjects("Firmalar", companies, replace);
      if (certificates.length > 0) {
        stats.certificates = this._writeObjects("Sertifika", certificates, replace);
      } else {
        stats.certificates = this._writeRawRows("Sertifika", certificateRows, replace);
      }
      stats.tests = this._writeRawRows("Testler", tests, replace);
      stats.audits = this._writeRawRows("Denetim", audits, replace);
      stats.proformas = this._writeRawRows("Proforma", proformas, replace);
      if (masterStandardsRows.length > 0) {
        stats.standards = this._writeRawRows("Standarts", masterStandardsRows, replace);
      } else {
        stats.standards = this._writeObjects("Standarts", standards, replace);
      }
      stats.auditors = this._writeRawRows("Auditors", masterAuditorsRows, replace);
      stats.consultantsRows = this._writeRawRows("Consultants", masterConsultantsRows, replace);
      stats.testdocs = this._writeRawRows("TestDoc", masterTestDocsRows, replace);
      stats.sysdocs = this._writeRawRows("SysDoc", masterSysDocsRows, replace);

        const now = new Date().getTime().toString();
        const props = PropertiesService.getScriptProperties();
        props.setProperty("LAST_UPDATE", now);
        // Master data versiyonunu da geri yükleme sonrası ilerlet.
        const currentMasterVersion = parseInt(props.getProperty("MASTER_DATA_VERSION") || "1", 10);
        props.setProperty("MASTER_DATA_VERSION", (isNaN(currentMasterVersion) ? 1 : currentMasterVersion + 1).toString());
        props.setProperty("MASTER_DATA_UPDATED_AT", new Date().toISOString());
        return { success: true, stats: stats, lastUpdate: now };
      }, 60000, "SyncService.importBackup");
    } catch (e) {
      BaseService.logError("importBackup", e);
      return { success: false, error: e.message };
    }
  }
};
