import { api } from './api';
import { DB } from './db';
import { $companies, $certificates, $syncStatus, $lastSyncTime } from './store';

/**
 * 🔄 SyncManager: Akıllı Veri Senkronizasyonu (V2)
 * 
 * GAS Kotalarını korur ve tarayıcıda IndexedDB tabanlı 
 * yüksek performanslı veri yönetimini sağlar.
 */

export const SyncManager = {
  _syncPromise: null as Promise<void> | null,
  /**
   * Uygulama başladığında çalışır. 
   * Veriyi yerelden yükler, sonra arka planda güncel mi diye bakar.
   */
  init: async function() {
    console.log('[Sync] Initializing...');
    
    // 1. Yerel verileri anında yükle (Hızlı UI)
    const [localCompanies, localCerts] = await Promise.all([
      DB.get<any[]>(DB.COMPANIES),
      DB.get<any[]>(DB.CERTIFICATES)
    ]);

    if (localCompanies) $companies.set(localCompanies);
    if (localCerts) $certificates.set(localCerts);

    if (localCompanies || localCerts) {
      console.log('[Sync] Loaded data from IndexedDB.');
    }

    // 2. Senkronizasyonu arka planda başlat (UI bloklanmasın)
    void this.checkAndSync();
  },

  /**
   * Sunucudaki veriyle yerel veriyi karşılaştırır.
   */
  checkAndSync: async function() {
    if (this._syncPromise) return this._syncPromise;

    this._syncPromise = (async () => {
      $syncStatus.set('syncing');
      
      try {
      // 1. Sunucu durumunu kontrol et (Timestamp check)
      const checkResponse = await api.call('syncCheck');
      
      if (!checkResponse.success) {
        $syncStatus.set('error');
        return;
      }

      const { lastUpdate } = checkResponse.data;
      const localLastSync = await DB.get<number>(DB.LAST_SYNC) || 0;

      // 2. Eğer sunucudaki veri daha yeniyse veya yerel depo boşsa
      if (Number(lastUpdate) > Number(localLastSync) || !$companies.get().length) {
        console.log('[Sync] Remote data is newer. Fetching...');
        
        // Paralel olarak çek
        const [compRes, certRes] = await Promise.all([
          api.call('getCompanies'),
          api.call('getCertificates')
        ]);
        
        if (compRes.success && certRes.success) {
          // IndexedDB Güncelle
          await Promise.all([
            DB.save(DB.COMPANIES, compRes.data),
            DB.save(DB.CERTIFICATES, certRes.data),
            DB.save(DB.LAST_SYNC, lastUpdate)
          ]);
          
          // Reaktif Store Güncelle (Gecikmesiz UI update)
          $companies.set(compRes.data);
          $certificates.set(certRes.data);
          $lastSyncTime.set(lastUpdate);
          
          console.log('[Sync] Full synchronization complete.');
        } else {
          throw new Error("One or more fetch requests failed.");
        }
      } else {
        console.log('[Sync] Local data is up to date.');
      }

        $syncStatus.set('idle');
      } catch (e) {
        console.error('[Sync] Sync failed:', e);
        $syncStatus.set('error');
      } finally {
        this._syncPromise = null;
      }
    })();

    return this._syncPromise;
  },

  /**
   * Manuel Yenileme (Zorla güncelleme için)
   */
  forceSync: async function() {
    await DB.clearAll();
    await this.checkAndSync();
  }
};
