/**
 * TestService - Handles operations related to the "Testler" sheet.
 */
const TestService = {
  sheetName: "Testler",

  /**
   * Fetches test records for a specific company.
   * @param {string|number} firmaId The ID of the company to filter tests for.
   * @returns {Array<Array>} 2D array of test records.
   */
  getByFirmaId: function(firmaId) {
    try {
      const allRows = BaseService.getRawData(this.sheetName);
      if (!allRows || allRows.length === 0) return [];
      
      // Index 2 is "Firma No"
      return allRows.filter(r => String(r[2]) === String(firmaId));
    } catch (e) {
      BaseService.logError("getByFirmaId", e);
      return [];
    }
  }
};
