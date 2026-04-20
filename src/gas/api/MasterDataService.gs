/**
 * 🧠 MasterDataService: Kemik (reference) veri yönetimi
 *
 * Standarts, Auditors, Consultants, TestDoc, SysDoc gibi nadir değişen
 * sistem verilerini tek merkezden yönetir.
 */
const MasterDataService = {
  _versionKey: "MASTER_DATA_VERSION",
  _updatedAtKey: "MASTER_DATA_UPDATED_AT",

  _datasets: {
    standards: "standards",
    auditors: "auditors",
    consultants: "consultants",
    testdocs: "testdocs",
    sysdocs: "sysdocs"
  },

  _sheetMatrix: function(sheetName) {
    const ws = BaseService.resolveSheet(sheetName);

    const lastCol = ws.getLastColumn();
    const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
    const lastRow = ws.getLastRow();
    const rows = lastRow < 2 ? [] : ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
    return { headers: headers, rows: rows };
  },

  _normalizeRows: function(headers, rows) {
    const targetLen = headers.length;
    const list = Array.isArray(rows) ? rows : [];
    return list.map((row) => {
      const arr = Array.isArray(row) ? row.slice(0, targetLen) : [];
      while (arr.length < targetLen) arr.push("");
      return arr;
    });
  },

  _getVersion: function() {
    const props = PropertiesService.getScriptProperties();
    return props.getProperty(this._versionKey) || "1";
  },

  _bumpVersion: function() {
    const props = PropertiesService.getScriptProperties();
    const current = parseInt(this._getVersion(), 10);
    const next = (isNaN(current) ? 1 : current + 1).toString();
    const nowIso = new Date().toISOString();
    props.setProperty(this._versionKey, next);
    props.setProperty(this._updatedAtKey, nowIso);
    props.setProperty("LAST_UPDATE", new Date().getTime().toString());
    return { version: next, updatedAt: nowIso };
  },

  _resolveType: function(type) {
    const key = String(type || "").trim().toLowerCase();
    if (!key || !this._datasets[key]) return null;
    return key;
  },

  _readByType: function(type) {
    const key = this._resolveType(type);
    if (!key) throw new Error(`Geçersiz master data tipi: ${type}`);
    const sheetName = this._datasets[key];
    const matrix = this._sheetMatrix(sheetName);
    return {
      type: key,
      sheetName: sheetName,
      headers: matrix.headers,
      rows: matrix.rows
    };
  },

  /**
   * Tek dataset veya tüm master datasetleri döner.
   */
  get: function(type) {
    try {
      const version = this._getVersion();
      const updatedAt = PropertiesService.getScriptProperties().getProperty(this._updatedAtKey) || null;
      if (type) {
        return {
          version: version,
          updatedAt: updatedAt,
          dataset: this._readByType(type)
        };
      }

      const datasets = {};
      Object.keys(this._datasets).forEach((key) => {
        datasets[key] = this._readByType(key);
      });
      return { version: version, updatedAt: updatedAt, datasets: datasets };
    } catch (e) {
      BaseService.logError("MasterDataService.get", e, { type: type });
      return { success: false, error: e.message };
    }
  },

  /**
   * bulkSyncMaster için optimize toplu export.
   */
  getForSync: function() {
    return this.get();
  },

  /**
   * Settings üzerinden master dataset günceller.
   */
  update: function(type, data, expectedVersion, replace, options) {
    try {
      return BaseService.withScriptLock(() => {
        const key = this._resolveType(type);
        if (!key) throw new Error(`Geçersiz master data tipi: ${type}`);

        const currentVersion = this._getVersion();
        if (expectedVersion !== undefined && expectedVersion !== null && String(expectedVersion) !== String(currentVersion)) {
          return { success: false, error: "MASTER_VERSION_CONFLICT", currentVersion: currentVersion };
        }

        const sheetName = this._datasets[key];
        const ws = BaseService.resolveSheet(sheetName);

        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        const rows = this._normalizeRows(headers, (data && data.rows) || []);
        const doReplace = replace !== false;
        const opts = options || {};

        // Güvenlik: yanlışlıkla "boş veriyle tüm master tabloyu silme"yi engelle.
        if (doReplace && rows.length === 0 && opts.allowEmptyReplace !== true) {
          return { success: false, error: "MASTER_EMPTY_REPLACE_BLOCKED" };
        }

        if (doReplace) {
          const lastRow = ws.getLastRow();
          if (lastRow > 1) ws.deleteRows(2, lastRow - 1);
        }

        if (rows.length > 0) {
          ws.getRange(2, 1, rows.length, headers.length).setValues(rows);
        }

        const meta = this._bumpVersion();
        return {
          success: true,
          type: key,
          rowCount: rows.length,
          version: meta.version,
          updatedAt: meta.updatedAt
        };
      }, 30000, "MasterDataService.update");
    } catch (e) {
      BaseService.logError("MasterDataService.update", e, { type: type });
      return { success: false, error: e.message };
    }
  },

  /**
   * Legacy uyumluluğu: returnIso()
   */
  getLegacyIso: function() {
    try {
      const dataset = this._readByType("standards");
      return dataset.rows.map(r => [r[0] || "", r[1] || "", r[2] || ""]);
    } catch (e) {
      BaseService.logError("MasterDataService.getLegacyIso", e);
      return [];
    }
  },

  /**
   * Legacy uyumluluğu: returnAstandards()
   */
  getLegacyAuditors: function() {
    try {
      const dataset = this._readByType("auditors");
      return dataset.rows.map(r => [r[0] || "", r[1] || "", r[2] || "", r[3] || "", r[4] || ""]);
    } catch (e) {
      BaseService.logError("MasterDataService.getLegacyAuditors", e);
      return [];
    }
  }
};
