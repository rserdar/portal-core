import { atom } from 'nanostores';

/**
 * 🔋 Nano Stores: Global Application State
 *
 * Uygulama çapında reaktif state.
 * Veri kaynağı önceliği: IndexedDB (anlık açılış) -> KV (arka plan tazeleme).
 */

// Firma Listesi (Sync Data: ID, Nickname, Unvan, City)
export const $companies = atom<any[]>([]);

// Sertifika Summary Listesi
export const $certificates = atom<any[]>([]);

// Senkronizasyon Durumu
export const $syncStatus = atom<'idle' | 'syncing' | 'error'>('idle');

// Son Güncelleme Zamanı
export const $lastSyncTime = atom<number | null>(null);
