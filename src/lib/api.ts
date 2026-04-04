import { CONFIG } from './config';

/**
 * 📡 Astro Portal: API Client
 *
 * Yeni mimaride tüm istekler Cloudflare Worker üzerinden gider.
 * - Okuma: KV-primary (miss durumunda needsHydration dönebilir)
 * - Yazma: Action tipine göre GAS write + KV invalidation veya KV-primary
 */

interface ApiResponse<T = any> {
  success: boolean;
  data: T | null;
  error: string | null;
  fromCache?: boolean;
  stats?: any;
  needsHydration?: boolean;
  requiresConfirmation?: boolean;
  confirmation?: {
    token: string;
    expiresInSec: number;
    phrase: string;
    message: string;
  };
}

const DEFAULT_TIMEOUT_MS = 15000;
const LONG_TIMEOUT_MS = 180000; // bulkSync/import-export gibi ağır işlemler için 3 dk
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
    const longRunningActions = new Set(["bulkSync", "bulkSyncMaster", "importBackup", "exportBackup"]);
    const timeoutMs = longRunningActions.has(action) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const requestPromise = (async (): Promise<ApiResponse<T>> => {
    try {
      const response = await fetch(CONFIG.WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, params }),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (payload && typeof payload === 'object') {
          return payload as ApiResponse<T>;
        }
        throw new Error(`HTTP Hatası: ${response.status}`);
      }
      return (payload || { success: false, data: null, error: "Geçersiz yanıt" }) as ApiResponse<T>;
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
  async updateCompany(id: string | number, companyInfo: any) { return this.call("updateCompany", { id, companyInfo }); },
  async getCertificates() { return this.call("getCertificates"); },
  async addCertificate(certInfo: any) { return this.call("addCertificate", { certInfo }); },
  async updateCertificate(id: string | number, certInfo: any) { return this.call("updateCertificate", { id, certInfo }); },
  async updateCertificateField(id: string | number, field: string, value: any) {
    return this.call("updateCertificateField", { id, field, value });
  },
  async getCertificatesByFirmaId(firmaId: string | number) { 
    return this.call("getCertificatesByFirmaId", { firmaId }); 
  },
  async getRecentCertificates(limit: number = 25) {
    return this.call("getRecentCertificates", { limit });
  },
  async getAuditsByFirmaId(firmaId: string | number) { 
    return this.call("getAuditsByFirmaId", { firmaId }); 
  },
  async updateAudit(id: string | number, data: any) {
    return this.call("updateAudit", { id, data });
  },
  async getTestsByFirmaId(firmaId: string | number) { 
    return this.call("getTestsByFirmaId", { firmaId }); 
  },

  // 🌍 Çeviri (ISO Kapsam)
  async translate(text: string, toEn: boolean = true) {
    return this.call("translate", { text, toEn });
  },

  async docsToPdf(docId: string) {
    return this.call("convertToPdf", { docId });
  },

  async getStandardById(id: string | number) {
    return this.call("getStandardById", { id });
  },
  async getMasterData(type?: "standards" | "auditors" | "consultants" | "testdocs" | "sysdocs") {
    return this.call("getMasterData", type ? { type } : {});
  },
  async updateMasterData(
    type: "standards" | "auditors" | "consultants" | "testdocs" | "sysdocs",
    data: { rows: any[][] },
    expectedVersion?: string | number,
    options: { allowEmptyReplace?: boolean } = {}
  ) {
    return this.call("updateMasterData", { type, data, expectedVersion, replace: true, options });
  },

  async uploadFile(obj: any, firmNickName: string) {
    return this.call("uploadFile", { obj, firmNickName });
  },

  async buildCertPayload(id: string | number, lang: string = "TR", select: string = "") {
    return this.call("buildCertPayload", { id, lang, select });
  },

  async buildTestPayload(id: string | number, lang: string = "TR") {
    return this.call("buildTestPayload", { id, lang });
  },

  async generateDraftCertificate(certificate: any) {
    return this.call("generateDraftCertificate", { certificate });
  },

  async generateContract(companyInfo: any) {
    return this.call("generateContract", { companyInfo });
  },

  async sendSurveillanceEmail(payload: any) {
    return this.call("sendSurveillanceEmail", payload);
  },

  async sendReport(htmlTable: string, recipient?: string) {
    return this.call("sendReport", { htmlTable, recipient });
  },

  async runMonthlyCheck() {
    return this.call("runMonthlyCheck");
  },

  // 🏁 Sistem Yönetimi
  async bulkSync() { return this.call("bulkSync"); },
  async bulkSyncMaster() { return this.call("bulkSyncMaster"); },
  async pullFromSheetsToKv() {
    const core = await this.bulkSync();
    if (!core.success) return core;
    const master = await this.bulkSyncMaster();
    if (!master.success) return master;
    return { success: true, data: { core: core.data, master: master.data }, error: null };
  },
  async exportBackup() { return this.call("exportBackup"); },
  async importBackup(payload: any, options: any = { replace: true }) {
    return this.call("importBackup", { payload, options });
  },
  async importBackupPreflight(payload: any) {
    return this.call("importBackup", { payload, options: { replace: true } });
  },
  async importBackupConfirmed(payload: any, confirmToken: string) {
    return this.call("importBackup", {
      payload,
      options: {
        replace: true,
        confirm: true,
        confirmText: "GOOGLE_SHEETS_BACKUP_ONAY",
        confirmToken
      }
    });
  },
  async clearCache() { return this.call("clearCache"); },
};
