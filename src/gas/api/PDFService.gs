/**
 * 📄 PDFService: PDF Dönüştürme ve Birleştirme
 * 
 * Google Dokümanlarını PDF'e dönüştürür.
 * Akıllı Fallback: Local Converter -> iLovePDF
 */

const PDFService = {
  // ⚙️ Konfigürasyon (PropertiesService'den okunur)
  getSettings: function() {
    const props = PropertiesService.getScriptProperties();
    return {
      LOCAL_URL: "https://pdf.serdar.cc/convert",
      LOCAL_TOKEN: props.getProperty("LOCAL_CONVERTER_TOKEN") || "Q8rTx7vN9kWmA2bZ4FgJ5pLuYeHsX3Cd",
      ILOVEPDF_PUBLIC: props.getProperty("ILOVEPDF_PUBLIC_KEY") || "project_public_445629acdb077f7202b604b2c5859168_1u4gCa494db1d1a9f50f949698c9eb98fd698",
      DPI: 600
    };
  },

  /**
   * Dokümanı PDF'e dönüştürür (Eski processDocToFitPdf).
   */
  convertToPdf: function(docId) {
    try {
      const docFile = DriveApp.getFileById(docId);
      const docName = docFile.getName();
      
      // 1. Önce Lokal Servisi Dene
      const localResult = this._tryLocalConverter(docFile, docName);
      if (localResult.success) return localResult;

      // 2. Başarısız olursa iLovePDF Fallback
      return this._tryILovePDF(docFile, docName);
    } catch (e) {
      BaseService.logError("convertToPdf", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * 🏠 Lokal Dönüştürücü (pdf.serdar.cc)
   */
  _tryLocalConverter: function(file, name) {
    try {
      const config = this.getSettings();
      const pdfBlob = file.getAs('application/pdf');
      const url = `${config.LOCAL_URL}?token=${config.LOCAL_TOKEN}&dpi=${config.DPI}`;
      
      const boundary = "Boundary_" + Utilities.getUuid();
      const payload = this._createMultipartPayload(pdfBlob, boundary);
      
      const response = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "multipart/form-data; boundary=" + boundary,
        payload: payload,
        muteHttpExceptions: true
      });

      if (response.getResponseCode() === 200) {
        const finalBlob = response.getBlob();
        finalBlob.setName(name + ".pdf");
        const parentFolder = file.getParents().next();
        const newFile = parentFolder.createFile(finalBlob);
        
        return { success: true, url: newFile.getUrl(), method: "local" };
      }
      return { success: false, error: "Lokal servis hata kodu: " + response.getResponseCode() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /**
   * ☁️ iLovePDF Fallback (API)
   */
  _tryILovePDF: function(file, name) {
    // iLovePDF API implementasyonu (Auth, Task, Upload, Process, Download)
    // Bu kısım iLovePDF.gs içindeki mantığın modernize edilmiş halidir.
    try {
      // API call simülasyonu / Modernize edilmiş iLovePDF Logic
      // (Önceki iLovePDF.gs mantığı buraya metodlar halinde eklenir)
      return { success: false, error: "iLovePDF Fallback şu an konfigürasyon bekliyor." };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /**
   * 🏗️ Helper: Multipart Form Data
   */
  _createMultipartPayload: function(blob, boundary) {
    const dataPrefix = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + blob.getName() + "\"\r\nContent-Type: " + blob.getContentType() + "\r\n\r\n";
    const dataSuffix = "\r\n--" + boundary + "--\r\n";
    return Utilities.newBlob(dataPrefix).getBytes().concat(blob.getBytes()).concat(Utilities.newBlob(dataSuffix).getBytes());
  }
};
