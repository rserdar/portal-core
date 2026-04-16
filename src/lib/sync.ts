import { api } from './api';
import { DB } from './db';
import { toast } from './toast';
import { $companies, $certificates, $dashboardStats, $syncStatus, $lastSyncTime } from './store';

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
    const [localCompanies, localCerts, localStats, localLastSync] = await Promise.all([
      DB.get<any[]>(DB.COMPANIES),
      DB.get<any[]>(DB.CERTIFICATES),
      DB.get<any>(DB.DASHBOARD_STATS),
      DB.get<number>(DB.LAST_SYNC)
    ]);

    if (localCompanies) $companies.set(localCompanies);
    if (localCerts) $certificates.set(localCerts);
    if (localStats) $dashboardStats.set(localStats);
    if (typeof localLastSync === 'number') $lastSyncTime.set(localLastSync);

    if (localCompanies || localCerts || localStats) {
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
            api.call<any[]>('getCertificateSummaries'),
            api.getDashboardSummary()
          ]);
        };

        const [compRes, certRes, dashRes] = await fetchCore();
        const needsHydration = [compRes, certRes, dashRes].some((r: any) => !r.success && (r.needsHydration || r.error === 'KV_PRIMARY_MISS'));
        const corsBlocked = [compRes, certRes, dashRes].some((r: any) => !r.success && (r.status === 403 || r.error === 'CORS_ORIGIN_NOT_ALLOWED'));

        if (corsBlocked) {
          throw new Error('Worker origin izni reddetti. CORS allowlist veya PUBLIC_WORKER_URL ayarını kontrol edin.');
        }

        if (needsHydration) {
          console.warn('[Sync] KV miss detected. Automatic hydration is disabled; waiting for manual sync.');
          throw new Error('KV verisi hazır değil. Lütfen Ayarlar veya ana ekrandaki senkronizasyonu manuel başlatın.');
        }

        if (!compRes.success || !certRes.success || !dashRes.success) {
          throw new Error(compRes.error || certRes.error || dashRes.error || "One or more fetch requests failed.");
        }

        const masterProbe = await api.getMasterData('standards');
        if (!masterProbe.success && (masterProbe.needsHydration || masterProbe.error === 'KV_PRIMARY_MISS')) {
          console.warn('[Sync] Master KV miss detected. Automatic master hydration is disabled.');
        }

        const localCertCount = ($certificates.get() || []).length;
        const localCompCount = ($companies.get() || []).length;
        const serverCertCount = (certRes.data || []).length;
        const serverCompCount = (compRes.data || []).length;

        // 🛡️ Data Integrity Guard: Don't overwrite if server returns significantly less data than local
        if (localCertCount > 10 && serverCertCount < (localCertCount * 0.5)) {
          console.error(`[Sync] Safety Guard Triggered! Local certs: ${localCertCount}, Server certs: ${serverCertCount}. Potential data loss prevented.`);
          toast.warning(`Veri kaybı önlendi: Sunucudan ${serverCertCount} sertifika geldi, yerelde ${localCertCount} var. Mevcut veriniz korundu.`, { duration: 8000 });
          throw new Error(`Veri bütünlüğü riski: Sertifikalar — sunucu %${Math.round((serverCertCount/localCertCount)*100)} döndürdü. Sheets → KV senkronizasyonunu kontrol edin.`);
        }
        if (localCompCount > 10 && serverCompCount < (localCompCount * 0.5)) {
          console.error(`[Sync] Safety Guard Triggered! Local companies: ${localCompCount}, Server companies: ${serverCompCount}. Potential data loss prevented.`);
          toast.warning(`Veri kaybı önlendi: Sunucudan ${serverCompCount} firma geldi, yerelde ${localCompCount} var. Mevcut veriniz korundu.`, { duration: 8000 });
          throw new Error(`Veri bütünlüğü riski: Firmalar — sunucu %${Math.round((serverCompCount/localCompCount)*100)} döndürdü. Sheets → KV senkronizasyonunu kontrol edin.`);
        }

        const now = Date.now();
        $companies.set(compRes.data || []);
        $certificates.set(certRes.data || []);
        $dashboardStats.set(dashRes.data || null);
        $lastSyncTime.set(now);

        await Promise.all([
          DB.save(DB.COMPANIES, compRes.data || []),
          DB.save(DB.CERTIFICATES, certRes.data || []),
          DB.save(DB.DASHBOARD_STATS, dashRes.data || null),
          DB.save(DB.LAST_SYNC, now)
        ]);
        
        console.log(`[Sync] KV-primary synchronization complete. Firms: ${compRes.data?.length || 0}`);
        
        if (compRes.data?.length === 0) {
          console.warn('[Sync] API returned 0 firms. Check KV indices on Worker.');
        }

        $syncStatus.set('idle');
      } catch (e: any) {
        console.error('[Sync] Sync failed:', e);
        $syncStatus.set('error');
        if (String(e.message).includes('KV verisi hazır değil')) {
           toast.error('Veritabanı (KV) henüz hazır değil. Lütfen "Şablonları Eşitle" işlemini manuel başlatın.', { duration: 10000 });
        } else {
           toast.error(`Senkronizasyon hatası: ${e.message || 'Bilinmeyen hata'}`);
        }
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
        const [compRes, certRes, dashRes] = await Promise.all([
          api.call<any[]>('getCompanies'),
          api.call<any[]>('getCertificateSummaries'),
          api.getDashboardSummary()
        ]);
        if (!compRes.success || !certRes.success || !dashRes.success) {
          throw new Error(compRes.error || certRes.error || dashRes.error || 'KV yeniden okuma başarısız');
        }
        const now = Date.now();
        await Promise.all([
          DB.save(DB.COMPANIES, compRes.data),
          DB.save(DB.CERTIFICATES, certRes.data),
          DB.save(DB.DASHBOARD_STATS, dashRes.data),
          DB.save(DB.LAST_SYNC, now)
        ]);
        $companies.set(compRes.data || []);
        $certificates.set(certRes.data || []);
        $dashboardStats.set(dashRes.data || null);
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
