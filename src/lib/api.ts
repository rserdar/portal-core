import { CONFIG } from './config';

/**
 * 📡 Astro Portal: API Client
 *
 * Yeni mimaride tüm istekler Cloudflare Worker üzerinden gider.
 * - Okuma: KV-primary (miss durumunda needsHydration dönebilir)
 * - Yazma: KV-primary (Google native side-effect'ler haric)
 * - İstemci tarafı full rebuild tetiklemez; bulk hydration yalnızca sync akışında yapılır
 */

interface ApiResponse<T = any> {
  success: boolean;
  data: T | null;
  error: string | null;
  status?: number;
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

function mapLegacyAuditRow(row: any[]): any {
  const r = Array.isArray(row) ? row : [];
  return {
    id: r[0] ?? "",
    nick: r[1] ?? "",
    firmaNo: r[2] ?? "",
    standart: r[3] ?? "",
    denetimTipi: r[4] ?? "",
    a1Full: r[5] ?? "",
    a1Auditor: r[6] ?? "",
    a2Full: r[7] ?? "",
    a2Auditor: r[8] ?? "",
    a1Basla: r[9] ?? "",
    a1Bitis: r[10] ?? "",
    a1Md: r[11] ?? "",
    a1La: r[12] ?? "",
    a1Fa: r[13] ?? "",
    a1Sa: r[14] ?? "",
    a2Basla: r[15] ?? "",
    a2Bitis: r[16] ?? "",
    a2Md: r[17] ?? "",
    a2La: r[18] ?? "",
    a2Fa: r[19] ?? "",
    a2Sa: r[20] ?? "",
    qms: r[21] ?? "",
    mdd: r[22] ?? "",
    ems: r[23] ?? "",
    ohs: r[24] ?? "",
    fsms: r[25] ?? "",
    isms: r[26] ?? "",
    engy: r[27] ?? "",
    gmp: r[28] ?? "",
    a1kDenet: r[29] ?? "",
    a2kDenet: r[30] ?? "",
    a1EventId: r[31] ?? "",
    a2EventId: r[32] ?? "",
  };
}

function normalizeAuditList(data: any): any[] {
  if (!Array.isArray(data)) return [];
  if (data.length === 0) return [];

  if (Array.isArray(data[0])) {
    return data.map((row) => mapLegacyAuditRow(row));
  }

  return data;
}

function hasUsableAuditDates(audits: any[]): boolean {
  return audits.some((audit) => {
    if (!audit || typeof audit !== "object") return false;
    return Boolean(
      String(audit.a1Basla || audit.a1Bitis || audit.a2Basla || audit.a2Bitis || "").trim()
    );
  });
}

function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export const api = {
  async call<T = any>(action: string, params: any = {}): Promise<ApiResponse<T>> {
    const dedupeableActions = new Set([
      "getCompanies",
      "getCompanyById",
      "getCertificateSummaries",
      "getCertificates",
      "getCertificateById",
      "getCertificatesByFirmaId",
      "getRecentCertificates",
      "getAudits",
      "getAuditsByFirmaId",
      "getTestsByFirmaId",
      "getConsultants",
      "getStandardById",
      "getProformaByFirmaId",
      "getProformaById",
      "getMasterData",
      "getFolderId",
      "getRecentFiles",
    ]);
    const requestKey = dedupeableActions.has(action)
      ? `${action}:${stableStringify(params)}`
      : null;
    const existing = requestKey ? inFlightRequests.get(requestKey) : null;
    if (existing) return existing as Promise<ApiResponse<T>>;

    const controller = new AbortController();
    const longRunningActions = new Set([
      "bulkSync",
      "bulkSyncMaster",
      "importBackup",
      "exportBackup",
      "generateIso",
      "generateDraftCertificate",
      "generateContract",
      "generateAppForm",
      "generateSingleBatchDoc",
      "convertToPdf",
      "uploadFile",
      "deepRepairIndex",
    ]);
    const timeoutMs = longRunningActions.has(action) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const requestPromise = (async (): Promise<ApiResponse<T>> => {
    try {
      const response = await fetch(CONFIG.WORKER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({ action, params }),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (payload && typeof payload === 'object') {
          console.error(`[API] ${action} failed with ${response.status}:`, payload);
          return { status: response.status, ...(payload as ApiResponse<T>) };
        }
        const errorMsg = response.status === 403 ? "CORS veya origin izni reddedildi." : `HTTP Hatası: ${response.status}`;
        console.error(`[API] ${action} critical failure:`, errorMsg);
        throw new Error(errorMsg);
      }
      return { status: response.status, ...((payload || { success: false, data: null, error: "Geçersiz yanıt" }) as ApiResponse<T>) };
    } catch (error: any) {
      const isAbort = error?.name === 'AbortError';
      console.error("API Çağrı Hatası:", error);
      return { success: false, data: null, error: isAbort ? "İstek zaman aşımına uğradı." : (error.message || "Bilinmeyen hata") };
    } finally {
      clearTimeout(timeoutId);
      if (requestKey) {
        inFlightRequests.delete(requestKey);
      }
    }
    })();

    if (requestKey) {
      inFlightRequests.set(requestKey, requestPromise);
    }
    return requestPromise;
  },

  async getCompanies() { return this.call("getCompanies"); },
  async getCompanyById(id: string | number) { return this.call("getCompanyById", { id }); },
  async updateCompany(id: string | number, companyInfo: any) { return this.call("updateCompany", { id, companyInfo }); },
  async getDashboardSummary() { return this.call("getDashboardSummary"); },
  async getCertificateSummaries() { return this.call("getCertificateSummaries"); },
  async getCertificates() { return this.call("getCertificates"); },
  async getCertificateById(id: string | number) { return this.call("getCertificateById", { id }); },
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
  async getAudits() {
    let result = await this.call("getAudits");
    if (result.success) {
      result = { ...result, data: normalizeAuditList(result.data) };
    }
    return result;
  },
  async getAuditsByFirmaId(firmaId: string | number) { 
    const result = await this.call("getAuditsByFirmaId", { firmaId });
    return result; 
  },
  async updateAudit(id: string | number, data: any) {
    return this.call("updateAudit", { id, data });
  },
  async getTestsByFirmaId(firmaId: string | number) { 
    return this.call("getTestsByFirmaId", { firmaId }); 
  },
  async getProformaByFirmaId(firmaId: string | number) {
    return this.call("getProformaByFirmaId", { firmaId });
  },
  async getProformaById(id: string | number) {
    return this.call("getProformaById", { id });
  },
  async addProforma(proInfo: any) {
    return this.call("addProforma", { proInfo });
  },
  async updateProforma(id: string | number, proInfo: any) {
    return this.call("updateProforma", { id, proInfo });
  },
  async deleteProforma(id: string | number) {
    return this.call("deleteProforma", { id });
  },
  async generateProforma(id: string | number) {
    return this.call("generateProforma", { id });
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
  async bulkSync(scope?: string[]) { 
    return this.call("bulkSync", scope ? { scope } : {}); 
  },
  async bulkSyncMaster() { return this.call("bulkSyncMaster"); },
  async pullFromSheetsToKv(scope?: string[]) {
    const core = await this.bulkSync(scope);
    if (!core.success) return core;
    // Eğer master kapsamda varsa veya scope belirtilmemişse master da çekilmeli
    if (!scope || scope.includes("master")) {
      const master = await this.bulkSyncMaster();
      if (!master.success) return master;
      return { success: true, data: { core: core.data, master: master.data }, error: null };
    }
    return core;
  },
  async exportBackup() { return this.call("exportBackup"); },
  async exportKvData(scope: string[]) {
    return this.call("exportKvData", { scope });
  },
  async importBackup(payload: any, options: any = { replace: true }) {
    return this.call("importBackup", { payload, options });
  },
  async importKvData(exportData: any, scope: string[]) {
    return this.call("importKvData", { exportData, scope });
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
  async deepRepairIndex() { return this.call("deepRepairIndex"); },
};
