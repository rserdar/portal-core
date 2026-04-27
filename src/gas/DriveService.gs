/**
 * 📂 DriveService: Klasör ve Dosya Yönetimi
 * 
 * Şirket klasörlerinin hiyerarşisini, dosya yükleme ve recursive 
 * tarama işlemlerini yönetir.
 */

const DriveService = {
  // 🗺️ Harf-Klasör Eşlemesi (Modernize Edilmiş)
  FOLDER_MAP: {
    "0": "18tPSDNY92vRpqdCE3EUgDYLw3iWlNxZz", "A": "1WT05qLhSQC-QsN-SMN8bn5WMHsz8VHXU",
    "B": "1VW37S54ITzxUsL5ILqU6p_Vrlc5T8PQ9", "C": "1I4uHyY7hG6DIdkNKH61IAn-jBxvlsDbT",
    "Ç": "1I4uHyY7hG6DIdkNKH61IAn-jBxvlsDbT", "D": "1gqVlDixmhcjvk1OWAcDZ99zo9m6P_awX",
    "E": "1wzrRdlN6Dy3BRIa4oSPFvdOLhlf-vZry", "F": "1PlUSHBex0JXmUQOt-QTcJnQNHSBTz6dZ",
    "G": "1nvUpw-ne6spKO1LKXkPL_voA5AqwhpOx", "H": "1EkRfO29IwoINernfTBkbzRjka0REK33M",
    "I": "1iuZiOxO_rlH8PQmZKRI43jqUrR70ZsF_", "İ": "1iuZiOxO_rlH8PQmZKRI43jqUrR70ZsF_",
    "J": "16yuuuwTBFT8HwR0CYhyWd2yeWIgwgGKY", "K": "1-RDKBGl7ZeCwO8RQOFcVvd6JWmjI0KZD",
    "L": "1KG6Z3lJfIRarolxVZ2osKdMnNllQ8Mvc", "M": "1DMovuyZoIk_8neYapoDJU2OClMKIwFF_",
    "N": "18buF8FQDqKBNuVHO4O7HI6ZmaRgRT7Fi", "O": "1wx6O6fLMLEZ30QiOUIkitZpQKhfx5bLW",
    "Ö": "1wx6O6fLMLEZ30QiOUIkitZpQKhfx5bLW", "Q": "1wx6O6fLMLEZ30QiOUIkitZpQKhfx5bLW",
    "P": "1RKieWaPNDTjUrIhbdlYPaYSeGoz5yWe6", "R": "1TcnaTVPZVhXm0hJgXmGE2pANohBeMZF5",
    "S": "19S4WByIy9GPLOTH0zYNaOGZxAbVxzTZ4", "Ş": "19S4WByIy9GPLOTH0zYNaOGZxAbVxzTZ4",
    "T": "1NcNl_nJecvdbwfRc7Ef8lLQsGHVRI7pZ", "U": "1fxN-QbZxTZxPagMOfD4C4DX19LdOOhh1",
    "Ü": "1fxN-QbZxTZxPagMOfD4C4DX19LdOOhh1", "V": "1lK5X2bCFRm2FFo6rDi1GUILdbMFr-n9m",
    "W": "1lK5X2bCFRm2FFo6rDi1GUILdbMFr-n9m", "X": "1EosnZR4JxOGdTbIl46BpDZOXL9MExcnO",
    "Y": "1I2-EIKQUjVt5_6Ho2d1ODz1KEjHpLbmK", "Z": "1EosnZR4JxOGdTbIl46BpDZOXL9MExcnO"
  },
  
  /**
   * Google Drive API'deki "Hizmet hatası: Drive" (Service Error) hatalarına karşı
   * yeniden deneme (retry) mantığı ile klasör nesnesini döndürür.
   */
  _isTransientError: function(msg) {
    // "Drive" appears in service error messages across all locales
    // e.g. TR: "Hizmet hatası: Drive", EN: "Service error: Drive", EL: "Σφάλμα υπηρεσίας: Drive"
    return msg.indexOf("Drive") > -1
      || msg.indexOf("Internal Error") > -1
      || msg.indexOf("Unexpected error") > -1
      || msg.indexOf("timeout") > -1
      || msg.indexOf("quota") > -1;
  },

  safeGetFolder: function(id, label = "Klasör") {
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
      try {
        if (!id) throw new Error("Klasör ID'si boş!");
        return DriveApp.getFolderById(id);
      } catch (e) {
        lastErr = e;
        if (this._isTransientError(e.message)) { Utilities.sleep(1000 * (i + 1)); continue; }
        throw e;
      }
    }
    throw new Error(`${label} erişim hatası! ID: ${id}. Google Mesajı: ${lastErr.message}`);
  },

  /**
   * Dosya nesnesi için güvenli get (retry ile).
   */
  safeGetFile: function(id, label = "Dosya") {
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
      try {
        if (!id) throw new Error("Dosya ID'si boş!");
        return DriveApp.getFileById(id);
      } catch (e) {
        lastErr = e;
        if (this._isTransientError(e.message)) { Utilities.sleep(1000 * (i + 1)); continue; }
        throw e;
      }
    }
    throw new Error(`${label} erişim hatası! ID: ${id}. Google Mesajı: ${lastErr.message}`);
  },

  /**
   * Firmaya ait ana klasör ID'sini döner. Yoksa oluşturur.
   */
  getCompanyFolderId: function(nickname) {
    try {
      if (!nickname) throw new Error("Firma nickname (kısa adı) boş! Context yüklenememiş olabilir.");
      nickname = String(nickname).trim();
      
      let char = nickname.charAt(0).toLocaleUpperCase('tr-TR');
      char = !isNaN(parseInt(char)) ? "0" : char;

      const rootId = this.FOLDER_MAP[char] || null;
      if (!rootId) throw new Error(`FOLDER_MAP içinde "${char}" harfi için tanımlı bir kök klasör bulunamadı. (Nickname: ${nickname})`);

      const rootFolder = this.safeGetFolder(rootId, `Kök klasör (Harf: ${char})`);

      const folders = rootFolder.getFoldersByName(nickname);
      if (folders.hasNext()) {
        return folders.next().getId();
      } else {
        console.log(`Yeni klasör oluşturuluyor: ${nickname} (Kök: ${char})`);
        const newFolder = rootFolder.createFolder(nickname);
        return newFolder.getId();
      }
    } catch (e) {
      BaseService.logError("getCompanyFolderId", e, { nickname: nickname });
      throw e;
    }
  },

  /**
   * Klasör içindeki klasör ve dosyaları listeler. (Navigasyon için)
   */
  listDriveContents: function(folderId, mimeTypes = []) {
    if (!folderId) throw new Error("listDriveContents: folderId boş!");
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const typeSet = new Set(mimeTypes);
        const folders = [];
        const files = [];
        let pageToken = null;

        do {
          const query = {
            q: `'${folderId}' in parents and trashed = false`,
            fields: "nextPageToken, files(id, name, mimeType, webViewLink, createdTime)",
            pageSize: 100,
            orderBy: "name"
          };
          if (pageToken) query.pageToken = pageToken;

          const res = Drive.Files.list(query);
          (res.files || []).forEach(function(f) {
            if (f.mimeType === "application/vnd.google-apps.folder") {
              folders.push({ id: f.id, name: f.name, mimeType: f.mimeType, dateCreated: f.createdTime });
            } else if (typeSet.size === 0 || typeSet.has(f.mimeType)) {
              files.push({ id: f.id, name: f.name, mimeType: f.mimeType, url: f.webViewLink, dateCreated: f.createdTime });
            }
          });
          pageToken = res.nextPageToken || null;
        } while (pageToken);

        return { folders, files };
      } catch (e) {
        lastErr = e;
        if (attempt < 2 && this._isTransientError(e.message)) {
          Utilities.sleep(1500 * (attempt + 1));
          continue;
        }
        BaseService.logError("listDriveContents", e, { folderId: folderId });
        throw e;
      }
    }
    throw lastErr;
  },

  /**
   * Klasör içinde recursive olarak en yeni 20 dosyayı döner.
   */
  listRecentFiles: function(folderId, mimeTypes = []) {
    try {
      if (!folderId) throw new Error("listRecentFiles: folderId boş!");
      
      const folder = this.safeGetFolder(folderId, "Firma klasörü");
      const fileList = this._scanRecursive(folder, mimeTypes);
      
      // Yeniden eskiye sırala
      fileList.sort((a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime());
      
      return fileList.slice(0, 20);
    } catch (e) {
      BaseService.logError("listRecentFiles", e, { folderId: folderId });
      throw e;
    }
  },

  /**
   * Belirtilen isimdeki klasörü bulur veya oluşturur (Helper).
   */
  getOrCreateSubFolder: function(parentFolderId, folderName) {
    const parent = DriveApp.getFolderById(parentFolderId);
    const folders = parent.getFoldersByName(folderName);
    return folders.hasNext() ? folders.next() : parent.createFolder(folderName);
  },

  /**
   * Base64 dosyayı firma klasörüne yükler.
   */
  uploadFile: function(fileObj, firmNickName) {
    try {
      if (!firmNickName) throw new Error("Firma kısa adı boş.");
      if (!fileObj || !fileObj.data) throw new Error("Yüklenecek dosya verisi eksik.");

      const folderId = this.getCompanyFolderId(firmNickName);
      const folder = this.safeGetFolder(folderId, "Firma klasörü");

      const fileName = fileObj.fileName || fileObj.name || "upload.bin";
      const mimeType = fileObj.mimeType || "application/octet-stream";
      const rawData = String(fileObj.data || "");
      const base64Data = rawData.includes(",") ? rawData.split(",").pop() : rawData;
      const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
      const file = folder.createFile(blob);

      return {
        success: true,
        fileName: file.getName(),
        fileId: file.getId(),
        url: file.getUrl()
      };
    } catch (e) {
      BaseService.logError("uploadFile", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Recursive Tarama (Private Helper)
   */
  _scanRecursive: function(folder, mimeTypes) {
    let results = [];
    const files = folder.getFiles();

    while (files.hasNext()) {
      const file = files.next();
      const type = file.getMimeType();
      
      if (mimeTypes.length === 0 || mimeTypes.includes(type)) {
        results.push({
          id: file.getId(),
          name: file.getName(),
          url: file.getUrl(),
          mimeType: type,
          dateCreated: file.getDateCreated().toISOString()
        });
      }
    }

    const subFolders = folder.getFolders();
    while (subFolders.hasNext()) {
      results = results.concat(this._scanRecursive(subFolders.next(), mimeTypes));
    }

    return results;
  }
};
