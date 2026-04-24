/**
 * 🔄 DeltaSyncService: Satır Düzeyinde Damgalama (Faz 7-D)
 *
 * onEdit trigger ile değişen satırlara updated_at damgası basar.
 * Bu damgalar ManuelSyncService ("D1'e Senkronize Et") tarafından kullanılır.
 * 
 * v7.0.0: Webhook ve Otomatik Delta Export kaldırıldı. Sadece damgalama korunuyor.
 */
const DeltaSyncService = {
  TRACKED_SHEETS: ["certificates", "companies", "audits", "tests", "proformas"],
  TS_HEADER: "updated_at",

  /**
   * onEdit simple trigger — değişen satıra updated_at damgası basar.
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

      // Sadece damgalama yapılır; Worker'a otomatik webhook (v7.x'te) gönderilmez.
      sheet.getRange(row, tsCol).setValue(new Date().getTime());
    } catch (err) {
      Logger.log("[DeltaSync] onEdit hata: " + err.message);
    }
  },

  /**
   * Bir sayfada updated_at kolon indexini bulur, yoksa sonuna ekler.
   */
  _ensureTsColumn: function(sheet) {
    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) return -1;

    const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
    const idx = headers.indexOf(this.TS_HEADER);
    if (idx !== -1) return idx + 1;

    const newCol = lastCol + 1;
    sheet.getRange(1, newCol).setValue(this.TS_HEADER);
    return newCol;
  },

  /**
   * Tüm sayfalardaki damgaları başlatır.
   */
  initializeAllTimestamps: function() {
    const ss = BaseService.openSS();
    const now = new Date().getTime();
    this.TRACKED_SHEETS.forEach(sheetName => {
      try {
        const sheet = ss.getSheetByName(sheetName);
        if (!sheet || sheet.getLastRow() < 2) return;
        const tsCol = this._ensureTsColumn(sheet);
        if (tsCol === -1) return;
        const rowCount = sheet.getLastRow() - 1;
        const values = Array(rowCount).fill([now]);
        sheet.getRange(2, tsCol, rowCount, 1).setValues(values);
        Logger.log("[DeltaSync] " + sheetName + " damgalandı.");
      } catch (e) {
        Logger.log("[DeltaSync] Hata: " + e.message);
      }
    });
  }
};

/**
 * Simple trigger — GAS otomatik çağırır.
 */
function onEdit(e) {
  DeltaSyncService.handleEdit(e);
}
