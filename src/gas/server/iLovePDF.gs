function iLovePDFTest() {
  processDocToFitPdf("1KAXwZNt2CMD4q1zqJ64Fhzfw_TDCJ646dM7Yt96d2nI");
}

// --- Konfigürasyon ---
var LOCAL_CONVERTER_BASE_URL = 'https://pdf.serdar.cc/convert';
var LOCAL_CONVERTER_TOKEN = 'Q8rTx7vN9kWmA2bZ4FgJ5pLuYeHsX3Cd'; // GERÇEK TOKENİNİZ
var LOCAL_CONVERTER_DPI = 600;

var SCRIPT_CACHE = CacheService.getScriptCache();
var ILOVEPDF_TOKEN_CACHE_KEY = 'ILOVEPDF_SESSION_TOKEN_V1';
var ILOVEPDF_TOKEN_EXPIRATION_SECONDS = 55 * 60;
var ILOVEPDF_PUBLIC_KEY = 'project_public_445629acdb077f7202b604b2c5859168_1u4gCa494db1d1a9f50f949698c9eb98fd698'; // GERÇEK PUBLIC KEY'İNİZ
// var ILOVEPDF_SECRET_KEY = 'secret_key_...'; // Bu genellikle sunucudan sunucuya kullanılır.

/**
 * Ana İşlem Fonksiyonu: Google Dokümanını PDF'e dönüştürür.
 * Önce lokal servisi dener, başarısız olursa iLovePDF'i kullanır.
 *
 * @param {string} docId İşlenecek Google Dokümanının ID'si.
 * @return {object} {success: boolean, message: string, method?: string} formatında bir nesne.
 * @throws {Error} Kritik bir hata oluşursa veya yapılandırma eksikse.
 */

function processDocToFitPdf(docId) {
  var originalDriveFile;
  var originalDocName = "BilinmeyenBelge";

  // 1. Giriş ve Temel Konfigürasyon Kontrolleri (Aynı kalır)
  if (!docId || typeof docId !== 'string' || docId.trim() === "") {
    throw new Error("Geçersiz Doküman ID'si. Lütfen bir Google Doküman ID'si sağlayın.");
  }
  try {
    originalDriveFile = DriveApp.getFileById(docId);
    originalDocName = originalDriveFile.getName();
  } catch (e) {
    Logger.log("processDocToFitPdf: Orijinal Google Dokümanı bulunamadı/erişilemedi. ID: " + docId + ", Hata: " + e.message);
    throw new Error("Google Dokümanı (ID: " + docId + ") bulunamadı veya erişilemedi. Detay: " + e.message);
  }
  Logger.log("PDF dönüştürme başlatıldı: '" + originalDocName + "' (ID: " + docId + ")");

  var localServisDenendi = false;
  var localServisHataMesaji = "Lokal servis yapılandırılmamış veya atlandı."; // Varsayılan mesaj

  // 2. Lokal Servis Denemesi
  if (LOCAL_CONVERTER_TOKEN && LOCAL_CONVERTER_TOKEN.trim() !== '') {
    localServisDenendi = true;
    Logger.log("'" + originalDocName + "' için LOKAL dönüştürücü deneniyor...");
    try {
      var localResult = callLocalConverter_(originalDriveFile, originalDocName, docId);
      // callLocalConverter_ başarılı olursa aşağıdaki gibi bir obje döner:
      // { success: true, method: 'local', finalPdfUrl: ..., finalPdfName: ... }
      // ve hata fırlatmaz.
      Logger.log("LOKAL dönüştürücü BAŞARILI oldu.");
      return {
        success: true,
        message: "✅ LOKAL servis kullanıldı ve '" + originalDocName + "' başarıyla PDF'e dönüştürüldü. Dosya Google Drive'a kaydedildi.",
        method: localResult.method // 'local'
      };
    } catch (e) { // callLocalConverter_ bir hata fırlatırsa burası yakalar
      Logger.log("LOKAL dönüştürücü adımında HATA ('" + originalDocName + "'): " + e.toString() + ". iLovePDF (yedek) denenecek.");
      localServisHataMesaji = e.message; // Lokal servisten gelen hata mesajını sakla
    }
  } else {
    Logger.log("Lokal dönüştürücü token'ı ayarlanmamış veya boş. Doğrudan iLovePDF (yedek) denenecek.");
    // localServisHataMesaji zaten "Lokal servis yapılandırılmamış veya atlandı." olarak ayarlı.
  }

  // 3. iLovePDF (Yedek) Denemesi
  if (!ILOVEPDF_PUBLIC_KEY || ILOVEPDF_PUBLIC_KEY.trim() === "" || ILOVEPDF_PUBLIC_KEY.includes("BURAYA")) {
    var iLovePdfConfigError = "iLovePDF (yedek) servisi yapılandırılmamış (Public Key eksik).";
    var fullErrorMessage;
    if (localServisDenendi) { // Eğer lokal denendi ve başarısız olduysa
        fullErrorMessage = "PDF dönüştürme başarısız. Lokal servis: [" + localServisHataMesaji + "]. Ayrıca, " + iLovePdfConfigError;
    } else { // Lokal hiç denenmediyse (token yoktu)
        fullErrorMessage = "PDF dönüştürme başarısız. Lokal servis: [" + localServisHataMesaji + "]. Ayrıca, " + iLovePdfConfigError;
    }
    Logger.log(fullErrorMessage);
    throw new Error(fullErrorMessage);
  }

  Logger.log("'" + originalDocName + "' için iLovePDF (yedek) dönüştürücü deneniyor...");
  try {
    var iLovePdfResultDetails = processDocToFitPdfViaILovePDF(docId); // Bu fonksiyon hata fırlatmazsa başarılıdır.
    Logger.log("iLovePDF (yedek) BAŞARILI oldu.");

    let finalSuccessMessage;
    if (localServisDenendi) { // Eğer lokal servis denendi ve başarısız olduysa
      finalSuccessMessage = "⚠️ Lokal servis kullanılamadı (Sebep: " + localServisHataMesaji + "). Ancak, iLovePDF (yedek) ile '" + originalDocName + "' başarıyla PDF'e dönüştürüldü.";
    } else { // Lokal servis hiç denenmedi (token yoktu vs.)
      finalSuccessMessage = "ℹ️ Lokal servis atlandı/yapılandırılmamıştı. iLovePDF (yedek) ile '" + originalDocName + "' başarıyla PDF'e dönüştürüldü.";
    }

    return {
      success: true, // Genel işlem başarılı çünkü PDF üretildi.
      message: finalSuccessMessage,
      method: 'ilovepdf_fallback' // veya iLovePdfResultDetails.method
    };
  } catch (e_fallback) {
    // Hem lokal hem de iLovePDF başarısız oldu.
    var combinedFailureMessage = "PDF dönüştürme tüm yöntemlerde başarısız. ";
    if (localServisDenendi) {
        combinedFailureMessage += "Lokal servis: [" + localServisHataMesaji + "], ";
    } else {
        combinedFailureMessage += "Lokal servis: [" + localServisHataMesaji + "], "; // "Yapılandırılmamış veya atlandı"
    }
    combinedFailureMessage += "iLovePDF (yedek): [" + e_fallback.message + "]";
    Logger.log("KRİTİK HATA: " + combinedFailureMessage + " ('" + originalDocName + "')");
    throw new Error(combinedFailureMessage);
  }
}

/**
 * Google Dokümanını lokal Flask servisine gönderir.
 * @return {object} {success: boolean, error?: string, method?: string, finalPdfUrl?: string, finalPdfName?: string}
 * @throws {Error} Kritik ağ veya API hatalarında.
 */

function callLocalConverter_(originalDriveFile, originalDocName, docId) {
  var targetFolder = DriveApp.getRootFolder();
  try {
    var originalDocParents = originalDriveFile.getParents();
    if (originalDocParents.hasNext()) { targetFolder = originalDocParents.next(); }

    var pdfBlobFromDoc = originalDriveFile.getAs('application/pdf');
    pdfBlobFromDoc.setName(originalDocName + '_local_input.pdf');

    var token = LOCAL_CONVERTER_TOKEN;
    var fullUrl = LOCAL_CONVERTER_BASE_URL + '?token=' + encodeURIComponent(token) + '&dpi=' + LOCAL_CONVERTER_DPI;

    var boundary = 'Boundary_' + Utilities.getUuid();
    var dataPrefix = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + encodeURIComponent(pdfBlobFromDoc.getName()) + "\"\r\nContent-Type: " + pdfBlobFromDoc.getContentType() + "\r\n\r\n";
    var dataSuffix = "\r\n--" + boundary + "--\r\n";
    var payloadBytes = Utilities.newBlob(dataPrefix).getBytes().concat(pdfBlobFromDoc.getBytes()).concat(Utilities.newBlob(dataSuffix).getBytes());

    var options = {
      'method': 'post', 'contentType': 'multipart/form-data; boundary=' + boundary,
      'payload': payloadBytes, 'muteHttpExceptions': true,
      'validateHttpsCertificates': true, 'timeoutMilliseconds': 180000
    };

    var response = UrlFetchApp.fetch(fullUrl, options);
    var responseCode = response.getResponseCode();
    var responseBody = response.getContentText();

    Logger.log("Lokal servis yanıtı (" + originalDocName + "): Kod=" + responseCode + ", URL=" + fullUrl.split('?')[0] + "..."); // Token'ı loglama

    if (responseCode === 200) {
      var finalPdfBlob = response.getBlob();
      if (finalPdfBlob && finalPdfBlob.getContentType() === 'application/pdf') {
        var finalPdfName = originalDocName + ".pdf";
        finalPdfBlob.setName(finalPdfName);
        var finalSavedPdf = targetFolder.createFile(finalPdfBlob);
        return {
          success: true, method: 'local',
          finalPdfUrl: finalSavedPdf.getUrl(), finalPdfName: finalSavedPdf.getName()
        };
      } else {
        throw new Error("Lokal servis geçerli PDF dönmedi (Kod 200). Dönen Tip: " + (finalPdfBlob ? finalPdfBlob.getContentType() : 'null') + ". Yanıt: " + responseBody.substring(0, 200));
      }
    } else {
      throw new Error("Lokal servis başarısız. Kod: " + responseCode + ". Yanıt: " + responseBody.substring(0, 500));
    }
  } catch (e) {
    Logger.log("KRİTİK HATA (callLocalConverter_ - '" + originalDocName + "'): " + e.toString());
    // Bu hatayı yukarı fırlat ki processDocToFitPdf yakalasın ve fallback denesin
    throw new Error("Lokal dönüştürücü içinde hata: " + e.message);
  }
}

/**
 * iLovePDF Yedek İşlem Fonksiyonu
 * @return {object} {success: boolean, error?: string, method?: string, finalPdfUrl?: string, finalPdfName?: string}
 * @throws {Error} Kritik ağ veya API hatalarında.
 */

function processDocToFitPdfViaILovePDF(docId) {
  var originalDriveFile = DriveApp.getFileById(docId); // Ana fonksiyonda zaten kontrol edildi
  var originalDocName = originalDriveFile.getName();

  var targetFolder = DriveApp.getRootFolder();
  var originalDocParents = originalDriveFile.getParents();
  if (originalDocParents.hasNext()) { targetFolder = originalDocParents.next(); }

  var pdfBlobFromDoc = originalDriveFile.getAs('application/pdf');
  pdfBlobFromDoc.setName(originalDocName + '_temp_for_ilovepdf.pdf');

  var sessionToken = getIlovepdfSessionToken_(); // Hata fırlatabilir

  // PDF -> JPG
  var taskDetailsPdfToJpg = startIlovepdfTask_(sessionToken, 'pdfjpg');
  var taskIdPdfToJpg = taskDetailsPdfToJpg.task;
  var serverHostnamePdfToJpg = taskDetailsPdfToJpg.server;
  var uploadedPdfForJpg = uploadToIlovepdf_(sessionToken, taskIdPdfToJpg, serverHostnamePdfToJpg, pdfBlobFromDoc);
  var serverFilenamePdf = uploadedPdfForJpg.server_filename;
  var processResultPdfToJpg = processIlovepdfFile_(sessionToken, taskIdPdfToJpg, serverHostnamePdfToJpg, serverFilenamePdf, pdfBlobFromDoc.getName(), "pdfjpg");
  if (processResultPdfToJpg.status !== 'TaskSuccess') {
    throw new Error("iLovePDF 'pdfjpg' işlemi başarısız. Durum: " + processResultPdfToJpg.status + ", Yanıt: " + JSON.stringify(processResultPdfToJpg).substring(0, 200));
  }
  var downloadedJpgBlob = downloadFromIlovepdf_(sessionToken, taskIdPdfToJpg, serverHostnamePdfToJpg);
  downloadedJpgBlob.setName(processResultPdfToJpg.download_filename || (originalDocName + ".jpg"));

  // JPG -> PDF
  var taskDetailsImgToPdf = startIlovepdfTask_(sessionToken, 'imagepdf');
  var taskIdImgToPdf = taskDetailsImgToPdf.task;
  var serverHostnameImgToPdf = taskDetailsImgToPdf.server;
  var uploadedJpgForPdf = uploadToIlovepdf_(sessionToken, taskIdImgToPdf, serverHostnameImgToPdf, downloadedJpgBlob);
  var serverFilenameJpg = uploadedJpgForPdf.server_filename;
  var imagetopdfOptions = { 'pagesize': 'fit', 'margin': 0, 'orientation': 'portrait', 'merge_after': true };
  var processResultImgToPdf = processIlovepdfFile_(sessionToken, taskIdImgToPdf, serverHostnameImgToPdf, serverFilenameJpg, downloadedJpgBlob.getName(), "imagepdf", imagetopdfOptions);
  if (processResultImgToPdf.status !== 'TaskSuccess') {
    throw new Error("iLovePDF 'imagepdf' işlemi başarısız. Durum: " + processResultImgToPdf.status + ", Yanıt: " + JSON.stringify(processResultImgToPdf).substring(0, 200));
  }
  var finalPdfBlob = downloadFromIlovepdf_(sessionToken, taskIdImgToPdf, serverHostnameImgToPdf);

  var finalPdfName = originalDocName + ".pdf"; // İsimde "(iLovePDF)" olmadan, orijinal isim.
  finalPdfBlob.setName(finalPdfName);
  var finalSavedPdf = targetFolder.createFile(finalPdfBlob);

  return {
    success: true, method: 'ilovepdf_fallback',
    finalPdfUrl: finalSavedPdf.getUrl(), finalPdfName: finalSavedPdf.getName()
  };
  // Bu fonksiyondaki try-catch bloğunu kaldırdım, hatalar doğrudan processDocToFitPdf'e gidecek.
}

/**
 * iLovePDF API için Yardımcı Fonksiyonlar 
 * (Hata Fırlatacak Şekilde Düzenlendi)
 */

function getIlovepdfSessionToken_() {
  var cachedToken = SCRIPT_CACHE.get(ILOVEPDF_TOKEN_CACHE_KEY);
  if (cachedToken) return cachedToken;

  var publicKey = ILOVEPDF_PUBLIC_KEY;
  if (!publicKey || publicKey.trim() === "" || publicKey.includes("BURAYA")) { // Daha iyi kontrol
    throw new Error("iLovePDF yapılandırma hatası: Public Key eksik veya geçersiz.");
  }

  var url = 'https://api.ilovepdf.com/v1/auth';
  var payload = { 'public_key': publicKey };
  var options = { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(payload), 'muteHttpExceptions': true };
  var response = UrlFetchApp.fetch(url, options);
  var responseCode = response.getResponseCode();
  var responseBody = response.getContentText();

  if (responseCode === 200) {
    var jsonResponse = JSON.parse(responseBody);
    var newToken = jsonResponse.token;
    if (newToken) {
      SCRIPT_CACHE.put(ILOVEPDF_TOKEN_CACHE_KEY, newToken, ILOVEPDF_TOKEN_EXPIRATION_SECONDS);
      return newToken;
    } else {
      throw new Error("iLovePDF API'den token alınamadı (geçerli token yok). Yanıt: " + responseBody.substring(0, 200));
    }
  } else {
    throw new Error("iLovePDF oturum token'ı alınamadı. Kod: " + responseCode + ", Yanıt: " + responseBody.substring(0, 200));
  }
}

function startIlovepdfTask_(sessionToken, toolName) {
  var url = 'https://api.ilovepdf.com/v1/start/' + toolName;
  var options = { 'method': 'get', 'headers': { 'Authorization': 'Bearer ' + sessionToken }, 'muteHttpExceptions': true };
  var response = UrlFetchApp.fetch(url, options);
  var responseCode = response.getResponseCode();
  var responseBody = response.getContentText();
  if (responseCode === 200) {
    var taskData = JSON.parse(responseBody);
    if (taskData && taskData.task && taskData.server) {
      return taskData;
    }
    throw new Error("iLovePDF görevi ('" + toolName + "') başlatıldı ancak yanıt eksik bilgi içeriyor. Yanıt: " + responseBody.substring(0, 200));
  } else {
    throw new Error("iLovePDF görevi ('" + toolName + "') başlatılamadı. Kod: " + responseCode + ", Yanıt: " + responseBody.substring(0, 200));
  }
}

function uploadToIlovepdf_(sessionToken, taskId, serverHostname, fileBlob) {
  var uploadUrl = 'https://' + serverHostname + '/v1/upload';
  var boundary = 'Boundary_' + Utilities.getUuid();
  var filename = fileBlob.getName() || "file.pdf"; // İsimsiz blob için varsayılan
  var dataPrefix = "--" + boundary + "\r\n" +
    "Content-Disposition: form-data; name=\"task\"\r\n\r\n" + taskId + "\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Disposition: form-data; name=\"file\"; filename=\"" + encodeURIComponent(filename) + "\"\r\n" +
    "Content-Type: " + (fileBlob.getContentType() || 'application/octet-stream') + "\r\n\r\n";
  var dataSuffix = "\r\n--" + boundary + "--\r\n";
  var payloadBytes = Utilities.newBlob(dataPrefix).getBytes().concat(fileBlob.getBytes()).concat(Utilities.newBlob(dataSuffix).getBytes());
  var options = {
    'method': 'post', 'contentType': 'multipart/form-data; boundary=' + boundary,
    'payload': payloadBytes, 'headers': { 'Authorization': 'Bearer ' + sessionToken },
    'muteHttpExceptions': true, 'timeoutMilliseconds': 180000 // 3 dk
  };
  var response = UrlFetchApp.fetch(uploadUrl, options);
  var responseCode = response.getResponseCode();
  var responseBody = response.getContentText();
  if (responseCode === 200) {
    var uploadData = JSON.parse(responseBody);
    if (uploadData && uploadData.server_filename) {
      return uploadData;
    }
    throw new Error("iLovePDF'e dosya yüklendi ancak yanıt eksik bilgi içeriyor. Yanıt: " + responseBody.substring(0, 200));
  } else {
    throw new Error("iLovePDF'e dosya yüklenemedi. Dosya: " + filename + ", Kod: " + responseCode + ", Yanıt: " + responseBody.substring(0, 200));
  }
}

function processIlovepdfFile_(sessionToken, taskId, serverHostname, serverFilename, outputFilenameForTool, toolName, toolOptions) {
  var processUrl = 'https://' + serverHostname + '/v1/process';
  var payload = {
    'task': taskId, 'tool': toolName,
    'files': [{ 'server_filename': serverFilename, 'filename': outputFilenameForTool }]
  };
  if (toolOptions) { Object.assign(payload, toolOptions); }

  var options = {
    'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(payload),
    'headers': { 'Authorization': 'Bearer ' + sessionToken }, 'muteHttpExceptions': true, 'timeoutMilliseconds': 180000 // 3 dk
  };
  var response = UrlFetchApp.fetch(processUrl, options);
  var responseCode = response.getResponseCode();
  var responseBody = response.getContentText();
  if (responseCode === 200) {
    try {
      return JSON.parse(responseBody); // Bu direkt processResultPdfToJpg vs. olacak
    } catch (e) {
      throw new Error("iLovePDF işlem yanıtı ('" + toolName + "') JSON parse edilemedi. Yanıt: " + responseBody.substring(0, 200));
    }
  } else {
    throw new Error("iLovePDF API hatası ('" + toolName + "'). Kod: " + responseCode + ", Yanıt: " + responseBody.substring(0, 200));
  }
}

function downloadFromIlovepdf_(sessionToken, taskId, serverHostname) {
  var downloadUrl = 'https://' + serverHostname + '/v1/download/' + taskId;
  var options = {
    'method': 'get', 'headers': { 'Authorization': 'Bearer ' + sessionToken },
    'muteHttpExceptions': true, 'timeoutMilliseconds': 180000 // 3 dk
  };
  var response = UrlFetchApp.fetch(downloadUrl, options);
  var responseCode = response.getResponseCode();
  if (responseCode === 200) {
    var blob = response.getBlob();
    var disposition = response.getHeaders()['Content-Disposition'];
    var filename = "ilovepdf_result_" + taskId + ".pdf"; // Varsayılan
    if (disposition) {
      var match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i); // Case-insensitive 'i'
      if (match) {
        try {
          filename = decodeURIComponent(match[1] || match[2]);
        } catch (e) { /* Varsayılan kullanılır */ }
      }
    }
    blob.setName(filename);
    return blob;
  } else {
    throw new Error("iLovePDF'ten dosya indirilemedi. Kod: " + responseCode + ", Yanıt: " + response.getContentText().substring(0, 200));
  }
}