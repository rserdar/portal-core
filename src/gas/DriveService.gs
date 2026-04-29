/**
 * 📂 DriveService: Klasör ve Dosya Yönetimi
 * 
 * Şirket klasörlerinin hiyerarşisini, dosya yükleme ve recursive 
 * tarama işlemlerini yönetir.
 */

const DriveService = {
  _folderMapCache: null,

  /**
   * Harf → Drive klasör ID eşlemesini Script Property'den yükler (instance cache).
   * Property adı: FOLDER_MAP_JSON (JSON string, tenant kurulum scriptiyle set edilir).
   */
  _getFolderMap: function() {
    if (this._folderMapCache) return this._folderMapCache;
    const json = BaseService.getGoogleConfig("drive", "folder_map_json", null)
      || PropertiesService.getScriptProperties().getProperty("FOLDER_MAP_JSON");
    if (!json) throw new Error("FOLDER_MAP_JSON Script Property eksik! Tenant kurulum scriptini çalıştırın.");
    try {
      this._folderMapCache = JSON.parse(json);
      return this._folderMapCache;
    } catch (e) {
      throw new Error("FOLDER_MAP_JSON geçerli JSON değil: " + e.message);
    }
  },
  
  /**
   * Google Drive API'deki "Hizmet hatası: Drive" (Service Error) hatalarına karşı
   * yeniden deneme (retry) mantığı ile klasör nesnesini döndürür.
   */
  _isTransientError: function(msg) {
    const text = String(msg || "");
    // "Drive" appears in service error messages across all locales
    // e.g. TR: "Hizmet hatası: Drive", EN: "Service error: Drive", EL: "Σφάλμα υπηρεσίας: Drive"
    return text.indexOf("Drive") > -1
      || text.indexOf("Internal Error") > -1
      || text.indexOf("Unexpected error") > -1
      || text.indexOf("timeout") > -1
      || text.indexOf("quota") > -1
      || text.indexOf("DRIVE_EMPTY_RESPONSE") > -1;
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

  safeCreateFolder: function(parentFolder, folderName, label = "Alt klasör") {
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
      try {
        if (!parentFolder) throw new Error("Parent klasör nesnesi boş!");
        if (!folderName) throw new Error("Klasör adı boş!");
        return parentFolder.createFolder(folderName);
      } catch (e) {
        lastErr = e;
        if (this._isTransientError(e.message)) { Utilities.sleep(1000 * (i + 1)); continue; }
        throw e;
      }
    }
    throw new Error(`${label} oluşturulamadı. Google Mesajı: ${lastErr.message}`);
  },

  safeCreateFile: function(folder, blob, label = "Dosya") {
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
      try {
        if (!folder) throw new Error("Hedef klasör nesnesi boş!");
        if (!blob) throw new Error("Kaydedilecek blob boş!");
        return folder.createFile(blob);
      } catch (e) {
        lastErr = e;
        if (this._isTransientError(e.message)) { Utilities.sleep(1000 * (i + 1)); continue; }
        throw e;
      }
    }
    throw new Error(`${label} oluşturulamadı. Google Mesajı: ${lastErr.message}`);
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

      const folderMap = this._getFolderMap();
      const rootId = folderMap[char] || null;
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
          if (!res || typeof res !== "object") {
            throw new Error("DRIVE_EMPTY_RESPONSE");
          }
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
        if (String(e && e.message || "").indexOf("DRIVE_EMPTY_RESPONSE") > -1) {
          throw new Error("DRIVE_EMPTY_RESPONSE: Drive listeleme servisi boş yanıt verdi. Lütfen tekrar deneyin.");
        }
        throw e;
      }
    }
    if (String(lastErr && lastErr.message || "").indexOf("DRIVE_EMPTY_RESPONSE") > -1) {
      throw new Error("DRIVE_EMPTY_RESPONSE: Drive listeleme servisi boş yanıt verdi. Lütfen tekrar deneyin.");
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
    const parent = this.safeGetFolder(parentFolderId, "Üst klasör");
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
      try {
        const folders = parent.getFoldersByName(folderName);
        return folders.hasNext() ? folders.next() : this.safeCreateFolder(parent, folderName, "Alt klasör");
      } catch (e) {
        lastErr = e;
        if (this._isTransientError(e.message)) { Utilities.sleep(1000 * (i + 1)); continue; }
        throw e;
      }
    }
    throw new Error(`Alt klasör erişim/oluşturma hatası! Ad: ${folderName}. Google Mesajı: ${lastErr.message}`);
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
      const file = this.safeCreateFile(folder, blob, "Yüklenen dosya");

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
