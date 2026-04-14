import { get, set, del, keys } from 'idb-keyval';

/**
 * 🗄️ Database Manager: IndexedDB Wrapper
 *
 * KV-primary mimaride tarayıcı tarafı kısa süreli okuma cache'i.
 * Bu katman kalıcı ana veri kaynağı değil, hızlandırma katmanıdır.
 */

export const DB = {
  // Veri Setleri (Keys)
  COMPANIES: 'portal_companies',
  CERTIFICATES: 'portal_certificates', // dashboard/search için hafif sertifika summary listesi
  LAST_SYNC: 'portal_last_sync_time',

  /**
   * Belirli bir anahtardan veri çeker.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      return (await get(key)) as T;
    } catch (e) {
      console.error(`[DB] Get error: ${key}`, e);
      return null;
    }
  },

  /**
   * Belirli bir anahtara veri kaydeder.
   */
  async save(key: string, data: any): Promise<void> {
    try {
      await set(key, data);
    } catch (e) {
      console.error(`[DB] Save error: ${key}`, e);
    }
  },

  /**
   * Tüm yerel verileri temizler (Cache Reset).
   */
  async clearAll(): Promise<void> {
    const allKeys = await keys();
    for (const key of allKeys) {
      if (typeof key === 'string' && key.startsWith('portal_')) {
        await del(key);
      }
    }
    console.log('[DB] Cache cleared.');
  }
};
