import { CONFIG } from './config';

/**
 * 📡 Astro Portal: API Client
 * 
 * Bu utility, Cloudflare Worker Proxy ile iletişim kurar.
 */

interface ApiResponse<T = any> {
  success: boolean;
  data: T | null;
  error: string | null;
  fromCache?: boolean; // Added for cache tracking
  stats?: any; // To support bulk sync stats
}

const DEFAULT_TIMEOUT_MS = 15000;
const LONG_TIMEOUT_MS = 180000; // bulkSync gibi ağır işlemler için 3 dk
const inFlightRequests = new Map<string, Promise<ApiResponse<any>>>();

function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export const api = {
  async call<T = any>(action: string, params: any = {}): Promise<ApiResponse<T>> {
    const requestKey = `${action}:${stableStringify(params)}`;
    const existing = inFlightRequests.get(requestKey);
    if (existing) return existing as Promise<ApiResponse<T>>;

    const controller = new AbortController();
    const timeoutMs = action === "bulkSync" ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const requestPromise = (async (): Promise<ApiResponse<T>> => {
    try {
      const response = await fetch(CONFIG.WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, params }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP Hatası: ${response.status}`);
      return await response.json();
    } catch (error: any) {
      const isAbort = error?.name === 'AbortError';
      console.error("API Çağrı Hatası:", error);
      return { success: false, data: null, error: isAbort ? "İstek zaman aşımına uğradı." : (error.message || "Bilinmeyen hata") };
    } finally {
      clearTimeout(timeoutId);
      inFlightRequests.delete(requestKey);
    }
    })();

    inFlightRequests.set(requestKey, requestPromise);
    return requestPromise;
  },

  async getCompanies() { return this.call("getCompanies"); },
  async getCompanyById(id: string | number) { return this.call("getCompanyById", { id }); },
  async getCertificates() { return this.call("getCertificates"); },
  async getCertificatesByFirmaId(firmaId: string | number) { 
    return this.call("getCertificatesByFirmaId", { firmaId }); 
  },
  async getAuditsByFirmaId(firmaId: string | number) { 
    return this.call("getAuditsByFirmaId", { firmaId }); 
  },
  async getTestsByFirmaId(firmaId: string | number) { 
    return this.call("getTestsByFirmaId", { firmaId }); 
  },

  // 🤖 Otomasyon & Legacy Portları
  async translate(text: string, direction: 'en' | 'tr' = 'en') {
    const action = direction === 'en' ? 'xtranslate' : 'ytranslate';
    return this.call(action, { text });
  },

  async docsToPdf(fileId: string) {
    return this.call("docsToPDF", { fileId });
  },

  // 🏁 Sistem Yönetimi
  async bulkSync() { return this.call("bulkSync"); },
  async clearCache() { return this.call("clearCache"); },
};
