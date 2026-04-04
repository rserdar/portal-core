function ilkKarekter(isim) {
  const folderMap = {
    "0": "18tPSDNY92vRpqdCE3EUgDYLw3iWlNxZz",
    "A": "1WT05qLhSQC-QsN-SMN8bn5WMHsz8VHXU",
    "B": "1VW37S54ITzxUsL5ILqU6p_Vrlc5T8PQ9",
    "C": "1I4uHyY7hG6DIdkNKH61IAn-jBxvlsDbT",
    "Ç": "1I4uHyY7hG6DIdkNKH61IAn-jBxvlsDbT",
    "D": "1gqVlDixmhcjvk1OWAcDZ99zo9m6P_awX",
    "E": "1wzrRdlN6Dy3BRIa4oSPFvdOLhlf-vZry",
    "F": "1PlUSHBex0JXmUQOt-QTcJnQNHSBTz6dZ",
    "G": "1nvUpw-ne6spKO1LKXkPL_voA5AqwhpOx",
    "H": "1EkRfO29IwoINernfTBkbzRjka0REK33M",
    "I": "1iuZiOxO_rlH8PQmZKRI43jqUrR70ZsF_",
    "İ": "1iuZiOxO_rlH8PQmZKRI43jqUrR70ZsF_",
    "J": "16yuuuwTBFT8HwR0CYhyWd2yeWIgwgGKY",
    "K": "1-RDKBGl7ZeCwO8RQOFcVvd6JWmjI0KZD",
    "L": "1KG6Z3lJfIRarolxVZ2osKdMnNllQ8Mvc",
    "M": "1DMovuyZoIk_8neYapoDJU2OClMKIwFF_",
    "N": "18buF8FQDqKBNuVHO4O7HI6ZmaRgRT7Fi",
    "O": "1wx6O6fLMLEZ30QiOUIkitZpQKhfx5bLW",
    "Ö": "1wx6O6fLMLEZ30QiOUIkitZpQKhfx5bLW",
    "Q": "1wx6O6fLMLEZ30QiOUIkitZpQKhfx5bLW",
    "P": "1RKieWaPNDTjUrIhbdlYPaYSeGoz5yWe6",
    "R": "1TcnaTVPZVhXm0hJgXmGE2pANohBeMZF5",
    "S": "19S4WByIy9GPLOTH0zYNaOGZxAbVxzTZ4",
    "Ş": "19S4WByIy9GPLOTH0zYNaOGZxAbVxzTZ4",
    "T": "1NcNl_nJecvdbwfRc7Ef8lLQsGHVRI7pZ",
    "U": "1fxN-QbZxTZxPagMOfD4C4DX19LdOOhh1",
    "Ü": "1fxN-QbZxTZxPagMOfD4C4DX19LdOOhh1",
    "V": "1lK5X2bCFRm2FFo6rDi1GUILdbMFr-n9m",
    "W": "1lK5X2bCFRm2FFo6rDi1GUILdbMFr-n9m",
    "X": "1EosnZR4JxOGdTbIl46BpDZOXL9MExcnO",
    "Y": "1I2-EIKQUjVt5_6Ho2d1ODz1KEjHpLbmK",
    "Z": "1EosnZR4JxOGdTbIl46BpDZOXL9MExcnO"
  };

  let iharf = isim.charAt(0);
  iharf = !isNaN(parseInt(iharf)) ? "0" : iharf.toLocaleUpperCase('tr-TR');

  const rootFolderId = folderMap[iharf] || null;
  if (!rootFolderId) throw new Error(`Geçersiz harf: ${iharf}`);

  const rootFolder = DriveApp.getFolderById(rootFolderId);
  let existingFolder = rootFolder.getFoldersByName(isim);

  return existingFolder.hasNext() ? existingFolder.next().getId() : rootFolder.createFolder(isim).getId();
}

/**
 * Belirtilen klasör ID'sinden ve tüm alt klasörlerinden,
 * istenen MIME türlerine uyan dosyaları alır,
 * oluşturulma tarihine göre yeniden eskiye sıralar ve sadece en yeni 20 sonucu döndürür.
 *
 * @param {string} folderId Taranacak ana klasörün ID'si.
 * @param {string} fileTypesString Aranacak dosya MIME türleri (virgülle ayrılmış).
 * @return {Array<Object>} En yeni 20 dosyayı içeren dizi. Her obje {name, id, url, mimeType, dateCreated, totalMatches (opsiyonel)} içerir.
 * @customfunction
 */
function getFilesFromFolder(folderId, fileTypesString) {
  const MAX_RESULTS = 20; // Gösterilecek maksimum sonuç sayısı

  try {
    const folder = DriveApp.getFolderById(folderId);
    const filesIterator = folder.getFiles();
    const fileList = []; // Tüm eşleşen dosyalar önce burada toplanacak
    let targetMimeTypes = [];

    // Logger.log(`Taranan Klasör: ${folder.getName()} (ID: ${folderId}), Aranan Türler: ${fileTypesString || 'Belirtilmemiş'}`);

    if (fileTypesString && typeof fileTypesString === 'string' && fileTypesString.trim() !== '') {
      targetMimeTypes = fileTypesString.split(',').map(type => type.trim().toLowerCase());
    }

    // Ana klasördeki dosyaları listele ve filtrele
    while (filesIterator.hasNext()) {
      const file = filesIterator.next();
      const currentFileMimeType = file.getMimeType().toLowerCase();

      let match = false;
      if (targetMimeTypes.length > 0) {
        if (targetMimeTypes.includes(currentFileMimeType)) {
          match = true;
        }
      } else {
        // Filtre yoksa davranış (bu senaryoda genellikle her zaman bir tür beklenir)
      }

      if (match) {
        fileList.push({
          name: file.getName(),
          id: file.getId(),
          url: file.getUrl(),
          mimeType: file.getMimeType(),
          dateCreated: file.getDateCreated().toISOString() 
        });
      }
    }

    // Alt klasörlerdeki dosyaları listele
    const subFolders = folder.getFolders();
    while (subFolders.hasNext()) {
      const subFolder = subFolders.next();
      const subFiles = getFilesFromFolderRecursiveHelper(subFolder.getId(), targetMimeTypes); // Yardımcı fonksiyona targetMimeTypes verilir
      if (subFiles && subFiles.length > 0) {
        fileList.push(...subFiles);
      }
    }

    // TÜM DOSYALAR TOPLANDIKTAN SONRA LİSTEYİ OLUŞTURULMA TARİHİNE GÖRE SIRALA (YENİDEN ESKİYE)
    fileList.sort((a, b) => {
      const dateA = new Date(a.dateCreated);
      const dateB = new Date(b.dateCreated);
      return dateB.getTime() - dateA.getTime();
    });
    
    // İstemciye toplam eşleşen dosya sayısını da gönderebiliriz (opsiyonel)
    // const totalMatchingFiles = fileList.length;

    // Sadece en yeni MAX_RESULTS kadarını al
    const limitedResults = fileList.slice(0, MAX_RESULTS);

    // Eğer istemciye toplam dosya sayısını ve gösterilen sayıyı bildirmek isterseniz,
    // döndürülen yapıyı biraz değiştirebilirsiniz. Örneğin:
    // return {
    //   files: limitedResults,
    //   totalFound: totalMatchingFiles,
    //   showing: limitedResults.length
    // };
    // Şimdilik sadece dosya listesini döndürüyoruz.

    return limitedResults;

  } catch (e) {
    Logger.log(`getFilesFromFolder HATA: folderId=${folderId}, fileTypes=${fileTypesString}, Hata Mesajı=${e.toString()}, Stack=${e.stack}`);
    throw new Error(`Sunucuda dosyalar alınırken bir hata oluştu. Detay: ${e.message}`);
  }
}
/**
 * getFilesFromFolder için recursive yardımcı fonksiyon.
 * Bu, ana fonksiyondaki sıralama ve limitlemenin sadece en üst seviyede yapılmasını sağlar.
 */
function getFilesFromFolderRecursiveHelper(folderId, targetMimeTypes) {
  const folder = DriveApp.getFolderById(folderId);
  const filesIterator = folder.getFiles();
  const fileList = [];

  while (filesIterator.hasNext()) {
    const file = filesIterator.next();
    const currentFileMimeType = file.getMimeType().toLowerCase();
    let match = false;
    if (targetMimeTypes.length > 0) {
      if (targetMimeTypes.includes(currentFileMimeType)) {
        match = true;
      }
    } else {
      // Davranış
    }
    if (match) {
      fileList.push({
        name: file.getName(),
        id: file.getId(),
        url: file.getUrl(),
        mimeType: file.getMimeType(),
        dateCreated: file.getDateCreated().toISOString()
      });
    }
  }

  const subFolders = folder.getFolders();
  while (subFolders.hasNext()) {
    const subFolder = subFolders.next();
    const subFiles = getFilesFromFolderRecursiveHelper(subFolder.getId(), targetMimeTypes);
    if (subFiles && subFiles.length > 0) {
      fileList.push(...subFiles);
    }
  }
  return fileList;
}

function doUpload(obj, firmNickName) {
  if (!firmNickName) {
    return { status: false, message: "Firma kısa adı boş!" };
  }

  const folderId = ilkKarekter(firmNickName); // Zaten tanımlı fonksiyon
  const folder = DriveApp.getFolderById(folderId);

  const blob = Utilities.newBlob(Utilities.base64Decode(obj.data), obj.mimeType, obj.fileName);
  const file = folder.createFile(blob);

  return {
    fileName: file.getName(),
    fileId: file.getId(),
    url: file.getUrl(),
    status: true
  };
}