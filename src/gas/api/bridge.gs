/**
 * 🚀 Astro Portal: Next-Gen API Bridge (V2)
 * 
 * Bu dosya, yeni Google Apps Script projenizin ana giriş noktasıdır.
 * Gelen POST isteklerini akıllı servis katmanlarına yönlendirir.
 * "Kopyala-Yapıştır" yapıldığında api klasörü altındaki diğer .gs dosyalarına ihtiyaç duyar.
 */

function doPost(e) {
  const result = {
    success: false,
    data: null,
    error: null
  };

  try {
    const requestData = JSON.parse(e.postData.contents);
    const apiSecret = requestData.apiKey || ""; // Cloudflare Worker will send this
    const systemSecret = PropertiesService.getScriptProperties().getProperty("API_KEY") || "mc-portal-3.0_8a2d7f9e4c1b5a6c3d2e1f0b9a8c7d6e";

    if (apiSecret !== systemSecret) {
      result.error = "Yetkisiz Erişim (Invalid API Key)";
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }

    const action = requestData.action;
    const params = requestData.params || {};

    switch (action) {
      // --- FİRMA SERVİSİ ---
      case "getCompanies":
        result.data = CompanyService.getAllForSync(); 
        result.success = true;
        break;

      case "getCompanyById":
        result.data = CompanyService.getById(params.id);
        result.success = true;
        break;

      case "addCompany":
        const addResult = CompanyService.add(params.companyInfo);
        result.data = addResult.id;
        result.success = addResult.success;
        if (!addResult.success) result.error = addResult.error;
        break;

      // --- SERTİFİKA SERVİSİ ---
      case "getCertificates":
        result.data = CertificateService.getAll();
        result.success = true;
        break;

      case "getCertificateById":
        result.data = CertificateService.getById(params.id);
        result.success = true;
        break;

      case "updateGozetim":
        const updRes = CertificateService.updateGozetim(params.id, params.status);
        result.success = updRes.success;
        result.error = updRes.error;
        break;

      // --- ÇEVİRİ SERVİSİ ---
      case "translate":
        result.data = params.toEn ? TranslationService.toEn(params.text) : TranslationService.toTr(params.text);
        result.success = true;
        break;

      // --- DOKÜMAN & DOSYA SERVİSLERİ ---
      case "getFolderId":
        result.data = DriveService.getCompanyFolderId(params.nickname);
        result.success = true;
        break;

      case "getRecentFiles":
        const folderId = DriveService.getCompanyFolderId(params.nickname);
        result.data = DriveService.listRecentFiles(folderId, params.mimeTypes);
        result.success = true;
        break;

      case "generateIso":
        const isoRes = DocumentService.generateIsoCertificate(params.cert, params.folderId);
        result.data = isoRes;
        result.success = isoRes.success;
        break;

      case "convertToPdf":
        const pdfRes = PDFService.convertToPdf(params.docId);
        result.data = pdfRes;
        result.success = pdfRes.success;
        break;

      case "getAvailableSets":
        result.data = DocumentService.getAvailableSets();
        result.success = true;
        break;

      case "prepareBatchFolders":
        const batchRes = DocumentService.prepareBatchFolders(params.data);
        result.data = batchRes;
        result.success = batchRes.success;
        if (!batchRes.success) result.error = batchRes.error;
        break;

      case "generateSingleBatchDoc":
        const singleRes = DocumentService.generateSingleBatchDoc(params.row, params.data, params.folderMap);
        result.data = singleRes;
        result.success = singleRes.success;
        if (!singleRes.success) result.error = singleRes.error;
        break;

      // --- DENETİM & GÖZETİM ---
      case "getAudits":
        result.data = AuditService.getAudits();
        result.success = true;
        break;

      case "scheduleAudit":
        const scheduleRes = AuditService.scheduleAudit(params.data);
        result.data = scheduleRes;
        result.success = scheduleRes.success;
        if (!scheduleRes.success) result.error = scheduleRes.error;
        break;

      case "updateSurveillance":
        const survRes = AuditService.updateSurveillance(params.ids, params.status);
        result.data = survRes;
        result.success = survRes.success;
        if (!survRes.success) result.error = survRes.error;
        break;

      // --- SENKRONİZASYON ---
      case "syncCheck":
        result.data = {
          lastUpdate: PropertiesService.getScriptProperties().getProperty("LAST_UPDATE") || "0"
        };
        result.success = true;
        break;

      default:
        throw new Error("Geçersiz eylem (Action): " + action);
    }

  } catch (error) {
    result.success = false;
    result.error = error.message;
    BaseService.logError("doPost", error);
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput("🚀 Astro Portal API Bridge (V2) is online.")
    .setMimeType(ContentService.MimeType.TEXT);
}
