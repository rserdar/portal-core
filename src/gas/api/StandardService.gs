/**
 * 📚 StandardService: Standart veri işlemleri
 */
const StandardService = {
  sheetName: "Standarts",

  /**
   * Standart kaydını ID ile getirir (legacy getStandardById).
   */
  getById: function(id) {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName(this.sheetName);
      if (!ws) return null;

      const lastRow = ws.getLastRow();
      if (lastRow < 2) return null;

      const ids = ws.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat().map(v => String(v).toLowerCase());
      const idx = ids.indexOf(String(id || "").toLowerCase());
      if (idx === -1) return null;

      const row = ws.getRange(idx + 2, 1, 1, 7).getDisplayValues()[0];
      return {
        standard: row[0],
        abbr: row[1],
        full: row[2],
        tanim: row[3],
        define: row[4],
        themeid: row[5],
        temaid: row[6]
      };
    } catch (e) {
      BaseService.logError("StandardService.getById", e, { id: id });
      return null;
    }
  }
};
