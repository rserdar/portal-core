/**
 * 🌍 TranslationService: Dil ve Çeviri İşlemleri (Modernize Edilmiş)
 * 
 * Google Apps Script'in LanguageApp özelliğini kullanarak 
 * kapsam/scope metinlerini otomatik olarak çevirir.
 */

const TranslationService = {
  /**
   * Genel çeviri metodu. 
   * @param {string} text Çevrilecek metin
   * @param {string} targetLang Hedef dil ('en', 'tr' vb.)
   * @param {string} sourceLang Kaynak dil (Opsiyonel)
   */
  translate: function(text, targetLang, sourceLang = '') {
    try {
      if (!text || typeof text !== 'string') return "";
      
      const cleanText = text.trim();
      if (!cleanText) return "";

      // LanguageApp.translate(text, source, target)
      // sourceLang boş bırakılırsa Google otomatik algılar.
      return LanguageApp.translate(cleanText, sourceLang, targetLang);
    } catch (e) {
      BaseService.logError(`translate(${targetLang})`, e);
      return text; // Hata durumunda orijinal metni dön
    }
  },

  /**
   * Metni Türkçeden İngilizceye çevirir (Geriye dönük uyumluluk).
   */
  toEn: function(text) {
    return this.translate(text, 'en', 'tr');
  },

  /**
   * Metni İngilizceden Türkçeye çevirir (Geriye dönük uyumluluk).
   */
  toTr: function(text) {
    return this.translate(text, 'tr', 'en');
  }
};
