import { CONFIG } from './config';

/**
 * 📡 Astro Portal: API Client
 * 
 * Bu utility, Cloudflare Worker Proxy ile iletişim kurar.
 * Her isteğe bir "action" ve isteğe bağlı "params" gönderir.
 */

interface ApiResponse<T = any> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export const api = {
  /**
   * GAS Bridge üzerindeki bir eylemi çağırır.
   * @param action GAS doPost içindeki switch case adı (örn: "getCompanies")
   * @param params Gönderilecek parametreler
   */
  async call<T = any>(action: string, params: any = {}): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(CONFIG.WORKER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Gerekirse burada Auth header ekleyebilirsiniz
          // "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ 
          action, 
          params,
          // apiKey: Removed for Security (Now handled by CF Worker)
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP Hatası: ${response.status}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error("API Çağrı Hatası:", error);
      return {
        success: false,
        data: null,
        error: error.message || "Bilinmeyen bir hata oluştu",
      };
    }
  },

  // Yardımcı metodlar (Sık kullanılan eylemler için)
  async getCompanies() {
    return this.call("getCompanies");
  },

  async getCompanyById(id: string | number) {
    return this.call("getCompanyById", { id });
  },

  async getCertificates() {
    return this.call("getCertificates");
  },
};
