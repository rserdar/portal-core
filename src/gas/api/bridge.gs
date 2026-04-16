/**
 * 🚀 Astro Portal: Next-Gen API Bridge (V2)
 * 
 * Bu dosya, yeni Google Apps Script projenizin ana giriş noktasıdır.
 * Gelen POST isteklerini akıllı servis katmanlarına yönlendirir.
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
    const systemSecret = PropertiesService.getScriptProperties().getProperty("API_KEY") || "";

    if (!systemSecret) {
      result.error = "Sunucu API_KEY yapılandırması eksik.";
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }

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

      case "getConsultants":
        result.data = CompanyService.getConsultants();
        result.success = true;
        break;

      case "addCompany":
        const addResult = CompanyService.add(params.companyInfo);
        result.data = addResult.id;
        result.success = addResult.success;
        if (!addResult.success) result.error = addResult.error;
        break;

      case "updateCompany":
        const updateCompanyRes = CompanyService.update(params.id, params.companyInfo, params.expectedEtag);
        result.data = updateCompanyRes;
        result.success = updateCompanyRes.success;
        if (!updateCompanyRes.success) result.error = updateCompanyRes.error;
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

      case "getCertificatesByFirmaId":
        result.data = CertificateService.getByFirmaId(params.firmaId || params.id);
        result.success = true;
        break;

      case "addCertificate":
        const addCertRes = CertificateService.add(params.certInfo);
        if (addCertRes.success) {
          result.data = addCertRes.id;
          result.success = true;
        } else {
          result.error = addCertRes.error;
        }
        break;

      case "updateCertificate":
        const updCertRes = CertificateService.update(params.id, params.certInfo);
        result.success = updCertRes.success;
        result.error = updCertRes.error;
        break;

      case "updateGozetim":
        const gozRes = CertificateService.updateGozetim(params.id, params.status);
        result.success = gozRes.success;
        result.error = gozRes.error;
        break;

      case "updateCertificateField":
      case "editCell": {
        const p = params.props || params;
        const fieldRes = CertificateService.updateField(p.id, p.field, p.val !== undefined ? p.val : p.value);
        result.data = fieldRes;
        result.success = fieldRes.success;
        if (!fieldRes.success) result.error = fieldRes.error;
        break;
      }

      // --- TEST SERVİSİ ---
      case "getTestsByFirmaId":
        result.data = TestService.getByFirmaId(params.firmaId || params.id);
        result.success = true;
        break;

      case "addTest":
        const addTestRes = TestService.add(params.testInfo);
        result.data = addTestRes.id;
        result.success = addTestRes.success;
        if (!addTestRes.success) result.error = addTestRes.error;
        break;

      case "updateTest":
        const updTestRes = TestService.update(params.id, params.testInfo);
        result.success = updTestRes.success;
        result.error = updTestRes.error;
        break;

      // --- PROFORMA SERVİSİ ---
      case "getProformasByFirmaId":
      case "getProformaByFirmaId":
      case "gdfProforma":
        result.data = ProformaService.getByFirmaId(params.firmaId || params.id);
        result.success = true;
        break;

      case "getProformaById":
      case "proformaVeri":
        result.data = ProformaService.getById(params.id);
        result.success = true;
        break;

      case "addProforma":
      case "addProInfo":
        const addProRes = ProformaService.add(params.proInfo);
        result.data = addProRes.id;
        result.success = addProRes.success;
        if (!addProRes.success) result.error = addProRes.error;
        break;

      case "generateProforma":
        const proformaDocRes = DocumentService.generateProforma(params.proforma || params.data || params);
        result.data = proformaDocRes;
        result.success = proformaDocRes.success;
        if (!proformaDocRes.success) result.error = proformaDocRes.error;
        break;

      // --- STANDARTLAR ---
      case "getStandardById": {
        result.data = StandardService.getById(params.id);
        result.success = true;
        break;
      }

      // --- MASTER DATA ---
      case "getMasterData":
        result.data = MasterDataService.get(params.type);
        result.success = result.data && result.data.success === false ? false : true;
        if (!result.success) result.error = result.data.error;
        break;

      case "getMasterSyncData":
        result.data = MasterDataService.getForSync();
        result.success = result.data && result.data.success === false ? false : true;
        if (!result.success) result.error = result.data.error;
        break;

      case "updateMasterData":
        const mdRes = MasterDataService.update(params.type, params.data, params.expectedVersion, params.replace, params.options);
        result.data = mdRes;
        result.success = mdRes.success;
        if (!mdRes.success) result.error = mdRes.error;
        break;

      case "returnIso":
        result.data = MasterDataService.getLegacyIso();
        result.success = true;
        break;

      case "getFullSyncData":
        // [UPDATE] Filtreli ve Sayfalı (offset/limit) senkronizasyon için parametreleri aktar
        result.data = SyncService.getFullExport(params.scope, params);
        result.success = true;
        break;

      case "returnAstandards":
        result.data = MasterDataService.getLegacyAuditors();
        result.success = true;
        break;

      // --- ÇEVİRİ SERVİSİ ---
      case "translate":
        const targetLang = params.toEn ? 'en' : 'tr';
        const sourceLang = params.toEn ? 'tr' : 'en';
        result.data = TranslationService.translate(params.text, targetLang, sourceLang);
        result.success = true;
        break;

      // --- DOKÜMAN & DOSYA SERVİSLERİ ---
      case "getFolderId":
        result.data = DriveService.getCompanyFolderId(params.nickname);
        result.success = Boolean(result.data);
        if (!result.success) result.error = "Firma klasörü bulunamadı.";
        break;

      case "getRecentFiles":
        const folderId = DriveService.getCompanyFolderId(params.nickname);
        result.data = DriveService.listRecentFiles(folderId, params.mimeTypes);
        result.success = true;
        break;

      case "uploadFile":
      case "doUpload":
        const uploadRes = DriveService.uploadFile(params.obj || params.fileObj || params.file, params.firmNickName || params.nickname || params.firmNickname);
        result.data = uploadRes;
        result.success = uploadRes.success;
        if (!uploadRes.success) result.error = uploadRes.error;
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

      case "createBatchFolders":
        const batchFolderRes = DocumentService.createBatchFolders(params.nick, params.uniqueSubFolders);
        result.data = batchFolderRes.data;
        result.success = batchFolderRes.success;
        if (!batchFolderRes.success) result.error = batchFolderRes.error;
        break;

      case "generateSingleBatchDoc":
        const singleRes = DocumentService.generateSingleBatchDoc(params.row, params.data, params.folderMap);
        result.data = singleRes;
        result.success = singleRes.success;
        if (!singleRes.success) result.error = singleRes.error;
        break;

      case "generateAppForm":
        const formRes = DocumentService.generateAppForm(params.info, params.folderId);
        result.data = formRes;
        result.success = formRes.success;
        if (!formRes.success) result.error = formRes.error;
        break;

      case "generateDraftCertificate":
      case "draftBas":
        const draftRes = DocumentService.generateDraftCertificate(params.certificate || params.cert || params.data || params);
        result.data = draftRes;
        result.success = draftRes.success;
        if (!draftRes.success) result.error = draftRes.error;
        break;

      case "generateContract":
      case "sozlesme":
        const contractRes = DocumentService.generateContract(params.companyInfo || params.data || params);
        result.data = contractRes;
        result.success = contractRes.success;
        if (!contractRes.success) result.error = contractRes.error;
        break;



      // --- DENETİM & GÖZETİM ---
      case "getAudits":
        result.data = AuditService.getAudits();
        result.success = true;
        break;

      case "getAuditRows":
        result.data = BaseService.getRawData("Denetim");
        result.success = true;
        break;

      case "getAuditsByFirmaId":
        result.data = AuditService.getByFirmaId(params.firmaId || params.id);
        result.success = true;
        break;

      case "getRecentCertificates":
      case "lastTwentyFive":
        result.data = CertificateService.getRecent(params.limit || 25);
        result.success = true;
        break;

      case "scheduleAudit":
        const scheduleRes = AuditService.scheduleAudit(params.data);
        result.data = scheduleRes;
        result.success = scheduleRes.success;
        if (!scheduleRes.success) result.error = scheduleRes.error;
        break;

      case "updateAudit":
        const updateAuditRes = AuditService.updateAudit(params.id, params.data || params.auditInfo || {});
        result.data = updateAuditRes;
        result.success = updateAuditRes.success;
        if (!updateAuditRes.success) result.error = updateAuditRes.error;
        break;

      case "updateSurveillance":
        const survRes = AuditService.updateSurveillance(params.ids, params.status);
        result.data = survRes;
        result.success = survRes.success;
        if (!survRes.success) result.error = survRes.error;
        break;

      // --- BİLDİRİM & E-POSTA ---
      case "sendSurveillanceEmail":
      case "sendSurv":
        const sendSurvRes = NotificationService.sendSurveillanceEmail(
          params.firstName || params.payload,
          params.fullName,
          params.title,
          params.email,
          params.data,
          params.startDate,
          params.endDate
        );
        result.data = sendSurvRes;
        result.success = sendSurvRes.success;
        if (!sendSurvRes.success) result.error = sendSurvRes.error;
        break;

      case "sendReport":
      case "sendEmail":
        const sendReportRes = NotificationService.sendTableReport(params.htmlTable || params.table || params.html, params.recipient);
        result.data = sendReportRes;
        result.success = sendReportRes.success;
        if (!sendReportRes.success) result.error = sendReportRes.error;
        break;

      case "runMonthlyCheck":
      case "monthlyCheck":
        const monthlyRes = NotificationService.runMonthlyCheck();
        result.data = monthlyRes;
        result.success = monthlyRes.success;
        if (!monthlyRes.success) result.error = monthlyRes.error;
        break;

      // --- SENKRONİZASYON ---
      case "syncCheck":
        result.data = {
          lastUpdate: PropertiesService.getScriptProperties().getProperty("LAST_UPDATE") || "0"
        };
        result.success = true;
        break;

      case "getFullSyncData":
        result.data = SyncService.getFullExport();
        result.success = true;
        break;

      case "exportBackup":
        result.data = SyncService.exportBackup();
        result.success = true;
        break;

      case "importBackup":
        const importRes = SyncService.importBackup(params.payload, params.options);
        result.data = importRes;
        result.success = importRes.success;
        if (!importRes.success) result.error = importRes.error;
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
