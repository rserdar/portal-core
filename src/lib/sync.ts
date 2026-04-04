import { api } from './api';
import { DB } from './db';
import { $companies, $certificates, $syncStatus, $lastSyncTime } from './store';

/**
 * 🔄 SyncManager: KV-Primary Senkronizasyon Yöneticisi
 *
 * Akış:
 * 1) İlk açılışta IndexedDB'den anında render
 * 2) Arka planda KV tazeleme
 * 3) KV miss olursa bulk hydration (GAS -> KV)
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
    const [localCompanies, localCerts, localLastSync] = await Promise.all([
      DB.get<any[]>(DB.COMPANIES),
      DB.get<any[]>(DB.CERTIFICATES),
      DB.get<number>(DB.LAST_SYNC)
    ]);

    if (localCompanies) $companies.set(localCompanies);
    if (localCerts) $certificates.set(localCerts);
    if (typeof localLastSync === 'number') $lastSyncTime.set(localLastSync);

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
        const fetchCore = async () => {
          return Promise.all([
            api.call<any[]>('getCompanies'),
            api.call<any[]>('getCertificates')
          ]);
        };

        let [compRes, certRes] = await fetchCore();
        const needsHydration = [compRes, certRes].some((r: any) => !r.success && (r.needsHydration || r.error === 'KV_PRIMARY_MISS'));

        // Faz 2: KV miss durumunda tek sefer bulk hydrate ve tekrar dene.
        if (needsHydration) {
          console.log('[Sync] KV miss detected. Running bulkSync hydration...');
          const bulkRes = await api.bulkSync();
          if (!bulkRes.success) throw new Error(bulkRes.error || 'bulkSync failed');
          [compRes, certRes] = await fetchCore();
        }

        if (!compRes.success || !certRes.success) {
          throw new Error(compRes.error || certRes.error || "One or more fetch requests failed.");
        }

        // Master/reference datalar için de hydration kontrolü yap.
        const masterProbe = await api.getMasterData('standards');
        if (!masterProbe.success && (masterProbe.needsHydration || masterProbe.error === 'KV_PRIMARY_MISS')) {
          console.log('[Sync] Master KV miss detected. Running bulkSyncMaster hydration...');
          const masterSyncRes = await api.bulkSyncMaster();
          if (!masterSyncRes.success) {
            console.warn('[Sync] bulkSyncMaster failed:', masterSyncRes.error);
          }
        }

        const now = Date.now();
        await Promise.all([
          DB.save(DB.COMPANIES, compRes.data),
          DB.save(DB.CERTIFICATES, certRes.data),
          DB.save(DB.LAST_SYNC, now)
        ]);
        
        $companies.set(compRes.data || []);
        $certificates.set(certRes.data || []);
        $lastSyncTime.set(now);
        
        console.log('[Sync] KV-primary synchronization complete.');

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
  },

  /**
   * Operasyonel tam yenileme:
   * Sheets -> KV hydration tetikler, ardından local cache'i yeniden doldurur.
   */
  syncFromSheets: async function() {
    if (this._syncPromise) return this._syncPromise;
    this._syncPromise = (async () => {
      $syncStatus.set('syncing');
      try {
        const res = await api.pullFromSheetsToKv();
        if (!res.success) throw new Error(res.error || 'Sheets -> KV sync başarısız');
        await DB.clearAll();
        const [compRes, certRes] = await Promise.all([
          api.call<any[]>('getCompanies'),
          api.call<any[]>('getCertificates')
        ]);
        if (!compRes.success || !certRes.success) {
          throw new Error(compRes.error || certRes.error || 'KV yeniden okuma başarısız');
        }
        const now = Date.now();
        await Promise.all([
          DB.save(DB.COMPANIES, compRes.data),
          DB.save(DB.CERTIFICATES, certRes.data),
          DB.save(DB.LAST_SYNC, now)
        ]);
        $companies.set(compRes.data || []);
        $certificates.set(certRes.data || []);
        $lastSyncTime.set(now);
        $syncStatus.set('idle');
      } catch (e) {
        console.error('[Sync] syncFromSheets failed:', e);
        $syncStatus.set('error');
      } finally {
        this._syncPromise = null;
      }
    })();
    return this._syncPromise;
  }
};
