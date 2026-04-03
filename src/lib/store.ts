import { atom } from 'nanostores';

/**
 * 🔋 Nano Stores: Global Application State
 * 
 * Uygulama çapında reaktif veri depoları. 
 * Reaksiyon hızı milisaniyeler seviyesindedir.
 */

// Firma Listesi (Sync Data: ID, Nickname, Unvan, City)
export const $companies = atom<any[]>([]);

// Sertifika Listesi
export const $certificates = atom<any[]>([]);

// Senkronizasyon Durumu
export const $syncStatus = atom<'idle' | 'syncing' | 'error'>('idle');

// Son Güncelleme Zamanı
export const $lastSyncTime = atom<number | null>(null);
