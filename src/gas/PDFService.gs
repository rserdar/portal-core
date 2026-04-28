/**
 * 📄 PDFService: PDF Dönüştürme
 *
 * Google Dokümanlarını PDF'e dönüştürür.
 * Akıllı Fallback: Local Converter (LOCAL_CONVERTER_URL Script Property) → iLovePDF
 */

const PDFService = {
  getSettings: function() {
    const props = PropertiesService.getScriptProperties();
    return {
      LOCAL_URL:       props.getProperty("LOCAL_CONVERTER_URL")    || "",
      LOCAL_TOKEN:     props.getProperty("LOCAL_CONVERTER_TOKEN")  || "",
      ILOVEPDF_PUBLIC: props.getProperty("ILOVEPDF_PUBLIC_KEY")    || "",
      DPI: 600
    };
  },

  /**
   * Dokümanı PDF'e dönüştürür.
   * Önce lokal servisi dener, başarısız olursa iLovePDF'e geçer.
   */
  convertToPdf: function(docId, options) {
    try {
      const docFile = DriveService.safeGetFile(docId, "PDF'e çevrilecek doküman");
      const docName = docFile.getName();
      const targetFolder = this._resolveTargetFolder(docFile, options || {});

      const localResult = this._tryLocalConverter(docFile, docName, targetFolder);
      if (localResult.success) return localResult;

      return this._tryILovePDF(docFile, docName, targetFolder);
    } catch (e) {
      BaseService.logError("convertToPdf", e);
      return { success: false, error: e.message };
    }
  },

  _buildSavedFilePayload: function(saved, method) {
    return {
      success: true,
      url: saved.getUrl(),
      method: method,
      fileId: saved.getId(),
      fileName: saved.getName(),
      mimeType: saved.getMimeType(),
      dateCreated: saved.getDateCreated().toISOString()
    };
  },

  // ─── Local Converter ────────────────────────────────────────────────────────

  _resolveTargetFolder: function(file, options) {
    const parentFolder = file.getParents().hasNext() ? file.getParents().next() : DriveApp.getRootFolder();
    const targetFolderId = String(options.targetFolderId || "").trim();
    const targetSubfolderName = String(options.targetSubfolderName || "").trim();

    if (targetFolderId && targetSubfolderName) {
      return DriveService.getOrCreateSubFolder(targetFolderId, targetSubfolderName);
    }

    if (targetFolderId) {
      return DriveService.safeGetFolder(targetFolderId, "PDF hedef klasörü");
    }

    if (targetSubfolderName) {
      return DriveService.getOrCreateSubFolder(parentFolder.getId(), targetSubfolderName);
    }

    return parentFolder;
  },

  _tryLocalConverter: function(file, name, targetFolder) {
    try {
      const config = this.getSettings();
      if (!config.LOCAL_URL) {
        return { success: false, error: "LOCAL_CONVERTER_URL tanımlı değil." };
      }
      if (!config.LOCAL_TOKEN) {
        return { success: false, error: "LOCAL_CONVERTER_TOKEN tanımlı değil." };
      }
      const pdfBlob = file.getAs("application/pdf");
      pdfBlob.setName(name + "_local_input.pdf");

      const url = `${config.LOCAL_URL}?token=${encodeURIComponent(config.LOCAL_TOKEN)}&dpi=${config.DPI}`;
      const boundary = "Boundary_" + Utilities.getUuid();
      const payload = this._buildMultipart(pdfBlob, boundary);

      const response = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "multipart/form-data; boundary=" + boundary,
        payload: payload,
        muteHttpExceptions: true,
        timeoutMilliseconds: 180000
      });

      if (response.getResponseCode() !== 200) {
        return { success: false, error: "Lokal servis hata kodu: " + response.getResponseCode() };
      }

      const finalBlob = response.getBlob();
      if (!finalBlob || finalBlob.getContentType() !== "application/pdf") {
        return { success: false, error: "Lokal servis geçerli PDF dönmedi." };
      }

      finalBlob.setName(name + ".pdf");
      const saved = DriveService.safeCreateFile(targetFolder, finalBlob, "PDF çıktısı");
      return this._buildSavedFilePayload(saved, "local");
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  // ─── iLovePDF Fallback ──────────────────────────────────────────────────────

  _tryILovePDF: function(file, name, targetFolder) {
    try {
      const pdfBlob = file.getAs("application/pdf");
      pdfBlob.setName(name + "_temp_for_ilovepdf.pdf");
      const sessionToken = this._ilovepdfGetToken();

      // Adım 1: PDF → JPG
      const pdfToJpgTask = this._ilovepdfStartTask(sessionToken, "pdfjpg");
      const uploadedPdf = this._ilovepdfUpload(sessionToken, pdfToJpgTask.task, pdfToJpgTask.server, pdfBlob);
      const jpgResult = this._ilovepdfProcess(
        sessionToken, pdfToJpgTask.task, pdfToJpgTask.server,
        uploadedPdf.server_filename, pdfBlob.getName(), "pdfjpg"
      );
      if (jpgResult.status !== "TaskSuccess") {
        throw new Error("iLovePDF pdfjpg başarısız: " + jpgResult.status);
      }
      const jpgBlob = this._ilovepdfDownload(sessionToken, pdfToJpgTask.task, pdfToJpgTask.server);
      jpgBlob.setName(jpgResult.download_filename || (name + ".jpg"));

      // Adım 2: JPG → PDF
      const imgToPdfTask = this._ilovepdfStartTask(sessionToken, "imagepdf");
      const uploadedJpg = this._ilovepdfUpload(sessionToken, imgToPdfTask.task, imgToPdfTask.server, jpgBlob);
      const pdfResult = this._ilovepdfProcess(
        sessionToken, imgToPdfTask.task, imgToPdfTask.server,
        uploadedJpg.server_filename, jpgBlob.getName(), "imagepdf",
        { pagesize: "fit", margin: 0, orientation: "portrait", merge_after: true }
      );
      if (pdfResult.status !== "TaskSuccess") {
        throw new Error("iLovePDF imagepdf başarısız: " + pdfResult.status);
      }
      const finalBlob = this._ilovepdfDownload(sessionToken, imgToPdfTask.task, imgToPdfTask.server);
      finalBlob.setName(name + ".pdf");

      const saved = DriveService.safeCreateFile(targetFolder, finalBlob, "PDF çıktısı");
      return this._buildSavedFilePayload(saved, "ilovepdf");
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  // ─── iLovePDF API Helpers ───────────────────────────────────────────────────

  _ilovepdfGetToken: function() {
    const cache = CacheService.getScriptCache();
    const cacheKey = "ILOVEPDF_SESSION_TOKEN_V1";
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const config = this.getSettings();
    if (!config.ILOVEPDF_PUBLIC) {
      throw new Error("ILOVEPDF_PUBLIC_KEY tanımlı değil.");
    }
    const response = UrlFetchApp.fetch("https://api.ilovepdf.com/v1/auth", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ public_key: config.ILOVEPDF_PUBLIC }),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      throw new Error("iLovePDF token alınamadı. Kod: " + response.getResponseCode());
    }

    const token = JSON.parse(response.getContentText()).token;
    if (!token) throw new Error("iLovePDF token yanıtta bulunamadı.");

    cache.put(cacheKey, token, 55 * 60);
    return token;
  },

  _ilovepdfStartTask: function(token, toolName) {
    const response = UrlFetchApp.fetch("https://api.ilovepdf.com/v1/start/" + toolName, {
      method: "get",
      headers: { Authorization: "Bearer " + token },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      throw new Error(`iLovePDF '${toolName}' görevi başlatılamadı. Kod: ` + response.getResponseCode());
    }
    const data = JSON.parse(response.getContentText());
    if (!data.task || !data.server) throw new Error(`iLovePDF '${toolName}' yanıtı eksik.`);
    return data;
  },

  _ilovepdfUpload: function(token, taskId, server, blob) {
    const boundary = "Boundary_" + Utilities.getUuid();
    const filename = blob.getName() || "file.pdf";
    const prefix =
      "--" + boundary + "\r\nContent-Disposition: form-data; name=\"task\"\r\n\r\n" + taskId + "\r\n" +
      "--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" +
      encodeURIComponent(filename) + "\"\r\nContent-Type: " + (blob.getContentType() || "application/octet-stream") + "\r\n\r\n";
    const suffix = "\r\n--" + boundary + "--\r\n";
    const payload = Utilities.newBlob(prefix).getBytes().concat(blob.getBytes()).concat(Utilities.newBlob(suffix).getBytes());

    const response = UrlFetchApp.fetch("https://" + server + "/v1/upload", {
      method: "post",
      contentType: "multipart/form-data; boundary=" + boundary,
      payload: payload,
      headers: { Authorization: "Bearer " + token },
      muteHttpExceptions: true,
      timeoutMilliseconds: 180000
    });
    if (response.getResponseCode() !== 200) {
      throw new Error("iLovePDF yükleme başarısız. Kod: " + response.getResponseCode());
    }
    const data = JSON.parse(response.getContentText());
    if (!data.server_filename) throw new Error("iLovePDF yükleme yanıtı eksik.");
    return data;
  },

  _ilovepdfProcess: function(token, taskId, server, serverFilename, outputName, toolName, options) {
    const payload = Object.assign(
      { task: taskId, tool: toolName, files: [{ server_filename: serverFilename, filename: outputName }] },
      options || {}
    );
    const response = UrlFetchApp.fetch("https://" + server + "/v1/process", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      headers: { Authorization: "Bearer " + token },
      muteHttpExceptions: true,
      timeoutMilliseconds: 180000
    });
    if (response.getResponseCode() !== 200) {
      throw new Error(`iLovePDF işlem (${toolName}) başarısız. Kod: ` + response.getResponseCode());
    }
    return JSON.parse(response.getContentText());
  },

  _ilovepdfDownload: function(token, taskId, server) {
    const response = UrlFetchApp.fetch("https://" + server + "/v1/download/" + taskId, {
      method: "get",
      headers: { Authorization: "Bearer " + token },
      muteHttpExceptions: true,
      timeoutMilliseconds: 180000
    });
    if (response.getResponseCode() !== 200) {
      throw new Error("iLovePDF indirme başarısız. Kod: " + response.getResponseCode());
    }
    const blob = response.getBlob();
    // Content-Disposition header'dan dosya adını al
    const disposition = response.getHeaders()["Content-Disposition"] || "";
    const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i);
    if (match) {
      try { blob.setName(decodeURIComponent(match[1] || match[2])); } catch (_) {}
    }
    return blob;
  },

  // ─── Multipart Helper ───────────────────────────────────────────────────────

  _buildMultipart: function(blob, boundary) {
    const prefix = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" +
      encodeURIComponent(blob.getName()) + "\"\r\nContent-Type: " + blob.getContentType() + "\r\n\r\n";
    const suffix = "\r\n--" + boundary + "--\r\n";
    return Utilities.newBlob(prefix).getBytes().concat(blob.getBytes()).concat(Utilities.newBlob(suffix).getBytes());
  }
};
