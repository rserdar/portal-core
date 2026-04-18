/**
 * 🔄 DeltaSyncService: Satır Düzeyinde Değişiklik Takibi
 *
 * onEdit trigger ile değişen satırlara _updated_at damgası basar.
 * getDeltaExport(since) yalnızca değişen satırları döner — D1 yazma kotasını korur.
 *
 * Kurulum (bir kez GAS editöründen çalıştır):
 *   DeltaSyncService.setupTrigger()
 */

const DeltaSyncService = {
  TRACKED_SHEETS: ["Sertifika", "Firmalar", "Denetim", "Testler", "Proforma"],
  TS_HEADER: "_updated_at",

  /**
   * Bir sayfada _updated_at kolon indexini bulur, yoksa sonuna ekler.
   * @returns {number} 1-indexed kolon numarası
   */
  _ensureTsColumn: function(sheet) {
    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) return -1;

    const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
    const idx = headers.indexOf(this.TS_HEADER);
    if (idx !== -1) return idx + 1;

    // Kolon yoksa ekle
    const newCol = lastCol + 1;
    sheet.getRange(1, newCol).setValue(this.TS_HEADER);
    return newCol;
  },

  /**
   * onEdit simple trigger — değişen satıra _updated_at damgası basar.
   * GAS editöründe otomatik tetiklenir (installable trigger gerekli değil).
   */
  handleEdit: function(e) {
    try {
      if (!e || !e.range) return;
      const sheet = e.range.getSheet();
      if (!this.TRACKED_SHEETS.includes(sheet.getName())) return;

      const row = e.range.getRow();
      if (row <= 1) return; // Başlık satırı

      const tsCol = this._ensureTsColumn(sheet);
      if (tsCol === -1) return;

      sheet.getRange(row, tsCol).setValue(new Date().getTime());
    } catch (err) {
      // onEdit hataları sessizce geçmeli — kullanıcı iş akışını kesmez
      Logger.log("[DeltaSync] onEdit hata: " + err.message);
    }
  },

  /**
   * since (ms) tarihinden sonra değişen satırları döner.
   * _updated_at kolonu yoksa veya since null ise o sayfanın tüm verisi döner (güvenli fallback).
   *
   * @param {number} since - Unix ms timestamp
   * @returns {{ certificates, companies, audits, tests, proformas, isDelta, since, lastUpdate }}
   */
  getDeltaExport: function(since) {
    const sinceMs = since ? parseInt(since) : 0;
    const now = new Date().getTime();

    // 30 günden eskiyse tam sync yap
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    if (!sinceMs || (now - sinceMs) > thirtyDaysMs) {
      const full = SyncService.getFullExport();
      full.isDelta = false;
      full.fallback = true;
      return full;
    }

    const ss = BaseService.openSS();
    const result = {
      isDelta: true,
      since: sinceMs,
      lastUpdate: now.toString(),
      companies: [],
      certificates: [],
      audits: [],
      tests: [],
      proformas: []
    };

    const sheetMap = [
      { key: "companies",    name: "Firmalar",  type: "objects" },
      { key: "certificates", name: "Sertifika", type: "objects" },
      { key: "audits",       name: "Denetim",   type: "raw"     },
      { key: "tests",        name: "Testler",   type: "raw"     },
      { key: "proformas",    name: "Proforma",  type: "objects" }
    ];

    sheetMap.forEach(function(def) {
      try {
        const sheet = ss.getSheetByName(def.name);
        if (!sheet || sheet.getLastRow() < 2) return;

        const lastCol = sheet.getLastColumn();
        const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
        const tsColIdx = headers.indexOf(DeltaSyncService.TS_HEADER); // 0-indexed

        const totalRows = sheet.getLastRow() - 1;
        const allData = sheet.getRange(2, 1, totalRows, lastCol).getDisplayValues();

        const filtered = allData.filter(function(row) {
          if (tsColIdx === -1) return true; // kolon yok → hepsini al
          const ts = parseInt(row[tsColIdx] || "0");
          return ts > sinceMs;
        });

        if (def.type === "objects") {
          result[def.key] = filtered.map(function(row) {
            return headers.reduce(function(obj, h, i) {
              if (h && h !== DeltaSyncService.TS_HEADER) obj[h] = row[i];
              return obj;
            }, {});
          });
        } else {
          // raw: _updated_at kolonunu çıkar
          const keepIndices = headers.reduce(function(arr, h, i) {
            if (h !== DeltaSyncService.TS_HEADER) arr.push(i);
            return arr;
          }, []);
          result[def.key] = filtered.map(function(row) {
            return keepIndices.map(function(i) { return row[i]; });
          });
        }
      } catch (err) {
        Logger.log("[DeltaSync] " + def.name + " okuma hatası: " + err.message);
      }
    });

    return result;
  },

  /**
   * GAS'ta installable trigger kurar (bir kez çalıştır).
   * Simple trigger (onEdit) yeterli olduğu için genellikle gerekmez.
   */
  setupTrigger: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const existing = ScriptApp.getUserTriggers(ss);
    const alreadySet = existing.some(function(t) {
      return t.getHandlerFunction() === "onSheetEdit";
    });
    if (!alreadySet) {
      ScriptApp.newTrigger("onSheetEdit")
        .forSpreadsheet(ss)
        .onEdit()
        .create();
      Logger.log("[DeltaSync] Trigger kuruldu: onSheetEdit");
    } else {
      Logger.log("[DeltaSync] Trigger zaten mevcut.");
    }
  }
};

/**
 * GAS installable trigger entry point.
 * Eğer simple trigger (onEdit) çakışıyorsa bu isim kullanılır.
 */
function onSheetEdit(e) {
  DeltaSyncService.handleEdit(e);
}

/**
 * Simple trigger — GAS otomatik çağırır, ek kurulum gerekmez.
 */
function onEdit(e) {
  DeltaSyncService.handleEdit(e);
}
