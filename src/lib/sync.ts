import { api } from './api';
import { DB } from './db';
import { toast } from './toast';
import { $companies, $certificates, $tests, $dashboardStats, $syncStatus, $lastSyncTime } from './store';

/**
 * 🔄 SyncManager: D1-Primary Senkronizasyon Yöneticisi
 *
 * Akış:
 * 1) İlk açılışta IndexedDB'den anında render
 * 2) Arka planda Worker → D1 üzerinden tazeleme
 * 3) bulkSync, günlük CRUD akışından ayrı tutulur (Ayarlar → Sistemi Senkronize Et)
 */

export const SyncManager = {
  _syncPromise: null as Promise<void> | null,
  _initPromise: null as Promise<void> | null,
  _refreshIntervalMs: 5 * 60 * 1000,

  init: async function() {
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      const [localCompanies, localCerts, localTests, localStats, localLastSync] = await Promise.all([
        DB.get<any[]>(DB.COMPANIES),
        DB.get<any[]>(DB.CERTIFICATES),
        DB.get<any[]>(DB.TESTS),
        DB.get<any>(DB.DASHBOARD_STATS),
        DB.get<number>(DB.LAST_SYNC)
      ]);

      if (localCompanies) $companies.set(localCompanies);
      if (localCerts) $certificates.set(localCerts);
      if (localTests) $tests.set(localTests);
      if (localStats) $dashboardStats.set(localStats);
      if (typeof localLastSync === 'number') $lastSyncTime.set(localLastSync);

      void this.checkAndSync();
    })();

    return this._initPromise;
  },

  /**
   * Sunucudaki veriyle yerel veriyi karşılaştırır ve IndexedDB'yi günceller.
   */
  checkAndSync: async function(options: { force?: boolean } = {}) {
    if (this._syncPromise) return this._syncPromise;
    const force = options.force === true;

    if (!force) {
      const lastSync = $lastSyncTime.get();
      const hasWarmCache =
        (($companies.get() || []).length > 0) ||
        (($certificates.get() || []).length > 0) ||
        (($tests.get() || []).length > 0) ||
        Boolean($dashboardStats.get());

      if (hasWarmCache && typeof lastSync === 'number' && (Date.now() - lastSync) < this._refreshIntervalMs) {
        return Promise.resolve();
      }
    }

    this._syncPromise = (async () => {
      $syncStatus.set('syncing');

      try {
        const [compRes, certRes, testRes, dashRes] = await Promise.all([
          api.call<any[]>('getCompanies'),
          api.call<any[]>('getCertificateSummaries'),
          api.getTests(),
          api.getDashboardSummary()
        ]);

        const corsBlocked = [compRes, certRes, testRes, dashRes].some((r: any) => !r.success && (r.status === 403 || r.error === 'CORS_ORIGIN_NOT_ALLOWED'));
        if (corsBlocked) {
          throw new Error('Worker origin izni reddetti. CORS allowlist veya PUBLIC_WORKER_URL ayarını kontrol edin.');
        }

        if (!compRes.success || !certRes.success || !testRes.success || !dashRes.success) {
          throw new Error(compRes.error || certRes.error || testRes.error || dashRes.error || 'Bir veya daha fazla istek başarısız oldu.');
        }

        const localCertCount = ($certificates.get() || []).length;
        const localCompCount = ($companies.get() || []).length;
        const serverCertCount = (certRes.data || []).length;
        const serverCompCount = (compRes.data || []).length;

        // 🛡️ Data Integrity Guard: Don't overwrite if server returns significantly less data than local
        if (localCertCount > 10 && serverCertCount < (localCertCount * 0.5)) {
          console.error(`[Sync] Safety Guard Triggered! Local certs: ${localCertCount}, Server certs: ${serverCertCount}. Potential data loss prevented.`);
          toast.warning(`Veri kaybı önlendi: Sunucudan ${serverCertCount} sertifika geldi, yerelde ${localCertCount} var. Mevcut veriniz korundu.`, { duration: 8000 });
          throw new Error(`Veri bütünlüğü riski: Sertifikalar — sunucu %${Math.round((serverCertCount/localCertCount)*100)} döndürdü. Sheets → D1 senkronizasyonunu kontrol edin.`);
        }
        if (localCompCount > 10 && serverCompCount < (localCompCount * 0.5)) {
          console.error(`[Sync] Safety Guard Triggered! Local companies: ${localCompCount}, Server companies: ${serverCompCount}. Potential data loss prevented.`);
          toast.warning(`Veri kaybı önlendi: Sunucudan ${serverCompCount} firma geldi, yerelde ${localCompCount} var. Mevcut veriniz korundu.`, { duration: 8000 });
          throw new Error(`Veri bütünlüğü riski: Firmalar — sunucu %${Math.round((serverCompCount/localCompCount)*100)} döndürdü. Sheets → D1 senkronizasyonunu kontrol edin.`);
        }

        const now = Date.now();
        $companies.set(compRes.data || []);
        $certificates.set(certRes.data || []);
        $tests.set(testRes.data || []);
        $dashboardStats.set(dashRes.data || null);
        $lastSyncTime.set(now);

        await Promise.all([
          DB.save(DB.COMPANIES, compRes.data || []),
          DB.save(DB.CERTIFICATES, certRes.data || []),
          DB.save(DB.TESTS, testRes.data || []),
          DB.save(DB.DASHBOARD_STATS, dashRes.data || null),
          DB.save(DB.LAST_SYNC, now)
        ]);

        if (compRes.data?.length === 0) {
          console.warn('[Sync] API returned 0 firms. Check D1 sync on Worker.');
        }

        $syncStatus.set('idle');
      } catch (e: any) {
        console.error('[Sync] Sync failed:', e);
        $syncStatus.set('error');
        toast.error(`Senkronizasyon hatası: ${e.message || 'Bilinmeyen hata'}`);
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
    await this.checkAndSync({ force: true });
  },

  /**
   * Sheets → D1 → IndexedDB tam senkronizasyon:
   * bulkSync ile Sheets verisi D1'e aktarılır, ardından local cache yenilenir.
   */
  syncFromSheets: async function() {
    if (this._syncPromise) return this._syncPromise;
    this._syncPromise = (async () => {
      $syncStatus.set('syncing');
      try {
        const res = await api.bulkSync();
        if (!res.success) throw new Error(res.error || 'Sheets → D1 sync başarısız');
        await DB.clearAll();
        const [compRes, certRes, testRes, dashRes] = await Promise.all([
          api.call<any[]>('getCompanies'),
          api.call<any[]>('getCertificateSummaries'),
          api.getTests(),
          api.getDashboardSummary()
        ]);
        if (!compRes.success || !certRes.success || !testRes.success || !dashRes.success) {
          throw new Error(compRes.error || certRes.error || testRes.error || dashRes.error || 'D1 yeniden okuma başarısız');
        }
        const now = Date.now();
        await Promise.all([
          DB.save(DB.COMPANIES, compRes.data),
          DB.save(DB.CERTIFICATES, certRes.data),
          DB.save(DB.TESTS, testRes.data),
          DB.save(DB.DASHBOARD_STATS, dashRes.data),
          DB.save(DB.LAST_SYNC, now)
        ]);
        $companies.set(compRes.data || []);
        $certificates.set(certRes.data || []);
        $tests.set(testRes.data || []);
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
