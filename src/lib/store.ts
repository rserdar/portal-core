import { atom } from 'nanostores';

/**
 * 🔋 Nano Stores: Global Application State
 *
 * Uygulama çapında reaktif state.
 * Veri kaynağı önceliği: IndexedDB (anlık açılış) → Worker/D1 (arka plan tazeleme).
 */

// Firma Listesi (Sync Data: ID, Nickname, Unvan, City)
export const $companies = atom<any[]>([]);

// Sertifika Summary Listesi
export const $certificates = atom<any[]>([]);

// Test Listesi
export const $tests = atom<any[]>([]);

// Dashboard Aggregated Stats
export const $dashboardStats = atom<any>(null);

// Senkronizasyon Durumu
export const $syncStatus = atom<'idle' | 'syncing' | 'error'>('idle');

// Son Güncelleme Zamanı
export const $lastSyncTime = atom<number | null>(null);
