import { CONFIG } from './config';

/**
 * 📡 Astro Portal: API Client
 *
 * Tüm istekler Cloudflare Worker üzerinden gider.
 * - Okuma: D1-primary (Worker → D1)
 * - Yazma: write-through (Worker → GAS → Sheets → D1 sync)
 * - Bulk sync: Sheets → D1 tam yenileme (SyncManager üzerinden)
 */

interface ApiResponse<T = any> {
  success: boolean;
  data: T | null;
  error: string | null;
  status?: number;
  fromCache?: boolean;
  stats?: any;
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

function hasUsableAuditDates(audits: any[]): boolean {
  return audits.some((audit) => {
    if (!audit || typeof audit !== "object") return false;
    return Boolean(
      String(audit.a1_baslangic || audit.a1_bitis || audit.a2_baslangic || audit.a2_bitis || "").trim()
    );
  });
}

function mapLegacyTestRow(row: any[]): any {
  const r = Array.isArray(row) ? row : [];
  return {
    id: r[0] ?? "",
    firmaAdi: r[1] ?? "",
    firmaNo: r[2] ?? "",
    testAdi: r[3] ?? "",
    marka: r[4] ?? "",
    urun: r[5] ?? "",
    urunKodu: r[6] ?? "",
    urunNo: r[7] ?? "",
    lot: r[8] ?? "",
    urunKabul: r[9] ?? "",
    kabulSaat: r[10] ?? "",
    testBaslangic: r[11] ?? "",
    testBitis: r[12] ?? "",
    raporTarihi: r[13] ?? "",
    raporNo: r[14] ?? "",
    numuneSayisi: r[15] ?? "",
    numuneUT: r[16] ?? "",
    numuneSKT: r[17] ?? "",
    urunBilgi: r[18] ?? "",
    gorsel1: r[19] ?? "",
    gorsel2: r[20] ?? "",
    detay: r[21] ?? "",
  };
}

function normalizeTestList(data: any): any[] {
  if (!Array.isArray(data)) return [];
  if (data.length === 0) return [];

  if (Array.isArray(data[0])) {
    return data.map((row) => mapLegacyTestRow(row));
  }

  return data;
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
      "getAuditById",
      "getAuditCalendar",
      "getAuditsByFirmaId",
      "getTestsByFirmaId",
      "getConsultants",
      "getAuditors",
      "getStandardById",
      "getProformasByFirmaId",
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
      "smartSync",
      "importBackup",
      "exportBackup",
      "translate",
      "generateIso",
      "generateDraftCertificate",
      "generateContract",
      "generateAppForm",
      "generateSingleBatchDoc",
      "convertToPdf",
      "uploadFile",
      "deepRepairIndex",
      "generateProforma",
      "getFolderId",
      "getRecentFiles",
    ]);
    const timeoutMs = longRunningActions.has(action) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort('timeout'), timeoutMs);

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
      const isTimeout = error?.name === 'AbortError' && controller.signal.reason === 'timeout';
      const isOtherAbort = error?.name === 'AbortError' && !isTimeout;
      
      console.error(`[API] Call Error (${action}):`, error);

      let errorMsg = error.message || "Bilinmeyen hata";
      if (isTimeout) errorMsg = "İstek zaman aşımına uğradı (Timeout).";
      if (isOtherAbort) errorMsg = "İstek iptal edildi (Aborted).";

      return { success: false, data: null, error: errorMsg };
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
  async addCompany(companyInfo: any) { return this.call("addCompany", { companyInfo }); },
  async updateCompany(
    id: string | number,
    companyInfo: any,
    options: { expected_updated_at?: string | number; expectedEtag?: string } = {}
  ) {
    return this.call("updateCompany", { id, companyInfo, ...options });
  },
  async getDashboardSummary() { return this.call("getDashboardSummary"); },
  async getCertificateSummaries() { return this.call("getCertificateSummaries"); },
  async getCertificates() { return this.call("getCertificates"); },
  async getCertificateById(id: string | number) { return this.call("getCertificateById", { id }); },
  async addCertificate(certInfo: any) { return this.call("addCertificate", { certInfo }); },
  async updateCertificate(
    id: string | number,
    certInfo: any,
    options: { expected_updated_at?: string | number } = {}
  ) {
    return this.call("updateCertificate", { id, certInfo, ...options });
  },
  async deleteCertificate(id: string | number) { return this.call("deleteCertificate", { id }); },
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
    return result;
  },
  async getAuditById(id: string | number) {
    return this.call("getAuditById", { id });
  },
  async getAuditCalendar(year: number, month: number) {
    return this.call("getAuditCalendar", { year, month });
  },
  async getTests() {
    let result = await this.call("getTests");
    if (result.success) {
      result = { ...result, data: normalizeTestList(result.data) };
    }
    return result;
  },
  async getAuditsByFirmaId(firmaId: string | number) { 
    const result = await this.call("getAuditsByFirmaId", { firmaId });
    return result; 
  },
  async scheduleAudit(data: any) { return this.call("scheduleAudit", { data }); },
  async updateAudit(
    id: string | number,
    data: any,
    options: { expected_updated_at?: string | number } = {}
  ) {
    return this.call("updateAudit", { id, data, ...options });
  },
  async getTestsByFirmaId(firmaId: string | number) { 
    return this.call("getTestsByFirmaId", { firmaId }); 
  },
  async getAuditors() { return this.call("getAuditors"); },
  async getProformasByFirmaId(firmaId: string | number) {
    return this.call("getProformasByFirmaId", { firmaId });
  },
  async getProformaById(id: string | number) {
    return this.call("getProformaById", { id });
  },
  async addProforma(proInfo: any) {
    return this.call("addProforma", { proInfo });
  },
  async updateProforma(
    id: string | number,
    proInfo: any,
    options: { expected_updated_at?: string | number } = {}
  ) {
    return this.call("updateProforma", { id, proInfo, ...options });
  },
  async deleteProforma(id: string | number) {
    return this.call("deleteProforma", { id });
  },
  async addTest(testInfo: any) { return this.call("addTest", { testInfo }); },
  async updateTest(
    id: string | number,
    testInfo: any,
    options: { expected_updated_at?: string | number } = {}
  ) {
    return this.call("updateTest", { id, testInfo, ...options });
  },
  async deleteTest(id: string | number) { return this.call("deleteTest", { id }); },
  async updateSurveillance(ids: (string | number)[], status: boolean | string, firmaId?: string | number) {
    return this.call("updateSurveillance", { ids, status, ...(firmaId !== undefined ? { firmaId } : {}) });
  },
  async getConsultants() { return this.call("getConsultants"); },
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

  async generateContract(params: any) {
    return this.call("generateContract", params);
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
  async bulkSync(params?: {
    scope?: string[],
    offset?: number,
    limit?: number,
    masterTypes?: Array<"standards" | "auditors" | "consultants" | "testdocs" | "sysdocs">,
    forceLargeSync?: boolean
  }) {
    return this.call("bulkSync", params || {});
  },
  async syncMasterData(masterTypes?: Array<"standards" | "auditors" | "consultants" | "testdocs" | "sysdocs">) {
    return this.bulkSync(masterTypes?.length ? { scope: ["master"], masterTypes } : { scope: ["master"] });
  },
  async syncFromSheets(scope?: string[]) {
    return this.bulkSync(scope ? { scope } : undefined);
  },
  async smartSync() { return this.call("smartSync"); },
  async exportBackup() { return this.call("exportBackup"); },
  async getSyncLog(limit: number = 20, status?: string) {
    return this.call("getSyncLog", status ? { limit, status } : { limit });
  },
  async exportData(
    scope: string[],
    masterTypes?: Array<"standards" | "auditors" | "consultants" | "testdocs" | "sysdocs">
  ) {
    return this.call("exportData", masterTypes?.length ? { scope, masterTypes } : { scope });
  },
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
  async deepRepairIndex() { return this.call("deepRepairIndex"); },
};
