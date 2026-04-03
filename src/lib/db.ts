import { get, set, del, keys } from 'idb-keyval';

/**
 * 🗄️ Database Manager: IndexedDB Wrapper
 * 
 * Tarayıcıda büyük veri setlerini (Binlerce firma/sertifika)
 * saklamak için yüksek performanslı IndexedDB kullanır.
 */

export const DB = {
  // Veri Setleri (Keys)
  COMPANIES: 'portal_companies',
  CERTIFICATES: 'portal_certificates',
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
