/**
 * 🔄 SyncService: Toplu Veri Senkronizasyonu
 * 
 * Tüm önemli Sheet verilerini tek bir paket olarak Cloudflare KV'ye aktarmak için kullanılır.
 */

const SyncService = {
  /**
   * Tüm sistem verilerini dışa aktarır.
   * @returns {Object} { companies: [], certificates: [], certificateRows: [], tests: [], audits: [], lastUpdate: string }
   */
  getFullExport: function() {
    const start = new Date().getTime();
    try {
      const now = new Date().getTime().toString();
      PropertiesService.getScriptProperties().setProperty("LAST_UPDATE", now);
      
      const data = {
        companies: BaseService.getDataAsObjects("Firmalar") || [],
        // getCertificates endpoint'i object döndürüyor; cache formatını birebir korumak için object tutulur.
        certificates: BaseService.getDataAsObjects("Sertifika") || [],
        // getCertificatesByFirmaId endpoint'i 2D raw row döndürdüğü için ayrıca raw tutulur.
        certificateRows: BaseService.getRawData("Sertifika") || [],
        // Şirket detay ekranı için firma bazlı listeler
        tests: BaseService.getRawData("Testler") || [],
        audits: BaseService.getRawData("Denetim") || [],
        lastUpdate: now
      };
      
      const end = new Date().getTime();
      Logger.log(`[SyncService] Full Export took ${end - start}ms`);
      return data;
    } catch (e) {
      BaseService.logError("getFullExport", e);
      return { success: false, error: e.message };
    }
  }
};
