import { api } from './api';
import { DB } from './db';
import { $companies, $certificates, $syncStatus, $lastSyncTime } from './store';

/**
 * 🔄 SyncManager: KV-Primary Senkronizasyon Yöneticisi
 *
 * Akış:
 * 1) İlk açılışta IndexedDB'den anında render
 * 2) Arka planda KV tazeleme
 * 3) KV miss olursa yalnızca manuel hydration beklenir (otomatik GAS fallback yok)
 * 4) bulkSync, günlük CRUD akışından ayrı tutulur
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
            api.call<any[]>('getCertificateSummaries')
          ]);
        };

        const [compRes, certRes] = await fetchCore();
        const needsHydration = [compRes, certRes].some((r: any) => !r.success && (r.needsHydration || r.error === 'KV_PRIMARY_MISS'));
        const corsBlocked = [compRes, certRes].some((r: any) => !r.success && (r.status === 403 || r.error === 'CORS_ORIGIN_NOT_ALLOWED'));

        if (corsBlocked) {
          throw new Error('Worker origin izni reddetti. CORS allowlist veya PUBLIC_WORKER_URL ayarını kontrol edin.');
        }

        if (needsHydration) {
          console.warn('[Sync] KV miss detected. Automatic hydration is disabled; waiting for manual sync.');
          throw new Error('KV verisi hazır değil. Lütfen Ayarlar veya ana ekrandaki senkronizasyonu manuel başlatın.');
        }

        if (!compRes.success || !certRes.success) {
          throw new Error(compRes.error || certRes.error || "One or more fetch requests failed.");
        }

        const masterProbe = await api.getMasterData('standards');
        if (!masterProbe.success && (masterProbe.needsHydration || masterProbe.error === 'KV_PRIMARY_MISS')) {
          console.warn('[Sync] Master KV miss detected. Automatic master hydration is disabled.');
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
          api.call<any[]>('getCertificateSummaries')
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
