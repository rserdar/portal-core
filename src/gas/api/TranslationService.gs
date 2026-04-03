/**
 * 🌍 TranslationService: Dil ve Çeviri İşlemleri
 * 
 * Google Apps Script'in LanguageApp özelliğini kullanarak kapsam/scope çevirisi yapar.
 */

const TranslationService = {
  /**
   * Metni Türkçeden İngilizceye çevirir.
   */
  toEn: function(text) {
    try {
      if (!text) return "";
      return LanguageApp.translate(text, 'tr', 'en');
    } catch (e) {
      BaseService.logError("toEn", e);
      return text;
    }
  },

  /**
   * Metni İngilizceden Türkçeye çevirir.
   */
  toTr: function(text) {
    try {
      if (!text) return "";
      return LanguageApp.translate(text, 'en', 'tr');
    } catch (e) {
      BaseService.logError("toTr", e);
      return text;
    }
  }
};
