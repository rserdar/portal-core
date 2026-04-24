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
   * Firmaya ait ana klasör ID'sini döner. Yoksa oluşturur.
   */
  getCompanyFolderId: function(nickname) {
    try {
      if (!nickname) throw new Error("Nickname boş olamaz.");
      
      let char = nickname.charAt(0).toLocaleUpperCase('tr-TR');
      char = !isNaN(parseInt(char)) ? "0" : char;

      const rootId = this.FOLDER_MAP[char] || null;
      if (!rootId) throw new Error(`Geçersiz başlangıç harfi: ${char}`);

      const rootFolder = DriveApp.getFolderById(rootId);
      const folders = rootFolder.getFoldersByName(nickname);

      return folders.hasNext() ? folders.next().getId() : rootFolder.createFolder(nickname).getId();
    } catch (e) {
      BaseService.logError("getCompanyFolderId", e);
      throw e;
    }
  },

  /**
   * Klasör içinde recursive olarak en yeni 20 dosyayı döner.
   */
  listRecentFiles: function(folderId, mimeTypes = []) {
    try {
      const folder = DriveApp.getFolderById(folderId);
      const fileList = this._scanRecursive(folder, mimeTypes);
      
      // Yeniden eskiye sırala
      fileList.sort((a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime());
      
      return fileList.slice(0, 20);
    } catch (e) {
      BaseService.logError("listRecentFiles", e);
      return [];
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
   * Base64 dosyayı firma klasörüne yükler (legacy doUpload).
   */
  uploadFile: function(fileObj, firmNickName) {
    try {
      if (!firmNickName) throw new Error("Firma kısa adı boş.");
      if (!fileObj || !fileObj.data) throw new Error("Yüklenecek dosya verisi eksik.");

      const folderId = this.getCompanyFolderId(firmNickName);
      const folder = DriveApp.getFolderById(folderId);

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
