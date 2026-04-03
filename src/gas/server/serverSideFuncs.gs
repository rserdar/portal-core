const SPREADSHEET_ID = "1FXYQ9S5ZnR1g9fkbxa0sCekJWV_cfy-5cPFojtOfRJs";

// ---- YARDIMCI FONKSİYON ----
/**
 * Verilen sheet nesnesindeki verileri, başlıklarla eşleştirilmiş bir nesne dizisine dönüştürür.
 * E-tablonun ilk satırının başlık satırı olduğu varsayılır.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet İşlem yapılacak Google Sheet nesnesi.
 * @return {Array<Object>} Başlıklarla eşleştirilmiş veri nesneleri dizisi. Her nesne bir satırı temsil eder.
 */

function getSheetDataAsObjects(sheet) {
  if (!sheet) {
    Logger.log("getSheetDataAsObjects: Geçersiz sayfa nesnesi sağlandı.");
    return [];
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log("getSheetDataAsObjects: Sayfada veri satırı bulunmuyor. Sayfa: " + sheet.getName());
    return [];
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(header => String(header).trim());
  const dataRows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();

  return dataRows.map(row => {
    const rowObject = {};
    headers.forEach((header, index) => {
      rowObject[header] = row[index];
    });
    return rowObject;
  });
}

// ---- HEDEF SPREADSHEET'İ AÇMAK İÇİN YARDIMCI (Opsiyonel ama önerilir) ----
function openTargetSpreadsheet() {
  try {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (e) {
    Logger.log("Hedef Spreadsheet açılamadı. ID: " + SPREADSHEET_ID + ", Hata: " + e.message);
    throw new Error("Veri kaynağına ulaşılamıyor. Lütfen daha sonra tekrar deneyin.");
  }
}

// ************************************
// ** Firma Bilgileri ile İşlemler  **
// ************************************

/**
 * Verilen ID'ye sahip firma bilgilerini "Firmalar" sayfasından getirir.
 * @param {string|number} id Aranacak firma ID'si.
 * @return {Object|null} Firma bilgilerini içeren bir nesne veya bulunamazsa null.
 */

function getCompanyById(id) {
  const ss = openTargetSpreadsheet(); // Veya doğrudan SpreadsheetApp.openById(SPREADSHEET_ID);
  const ws = ss.getSheetByName("Firmalar");

  if (!ws) {
    Logger.log("Firmalar" + " sayfası bulunamadı.");
    throw new Error("Firmalar" + " sayfası bulunamadı."); // Veya null döndürebilirsiniz
  }

  const firmalarListesi = getSheetDataAsObjects(ws);
  const arananIdStr = String(id).toLowerCase();
  const companyObject = firmalarListesi.find(firma => String(firma["Firma No"]).toLowerCase() === arananIdStr);

  // Eğer firma bulunamazsa null döndür
  if (!companyObject) {
    return null;
  }

  // Firma bilgilerini orijinal fonksiyonunuzdaki gibi bir nesne yapısına dönüştür.
  return {
    firmId: companyObject["Firma No"],        
    nickname: companyObject["Firma Adı"],  
    unvan: companyObject["Unvan"],       
    adres: companyObject["Adres"],       
    sehir: companyObject["İl"],      
    ulke: companyObject["Ülke"],       
    yazisma: companyObject["Yazışma Adresi"], 
    vergiD: companyObject["Vergi Dairesi"],
    vergiN: companyObject["Vergi Numarası"],    
    tel: companyObject["Telefon"],      
    faks: companyObject["Faks"],        
    www: companyObject["İnternet"],      
    mail: companyObject["Mail"],     
    yetA: companyObject["Yetkili Adı"],  
    yetU: companyObject["Yetkili Unvanı"],
    kyt: companyObject["Kalite Yönetim Temsilcisi"], 
    irtA: companyObject["İrtibat Kişisi"],  
    irtU: companyObject["İrtibat Kişisi Unvanı"],
    irtN: companyObject["İrtibat Kişisi Numarası"],   
    irtM: companyObject["İrtibat Kişisi Mail"], 
    kapsam: companyObject["Türkçe Kapsam"],
    scope: companyObject["İngilizce Kapsam"], 
    yapis: companyObject["Yapılan İş"],
    tcs: companyObject["Toplam Çalışan Sayısı"],
    ycs: companyObject["Yönetim Çalışan Sayısı"],
    ucs: companyObject["Üretim Çalışan Sayısı"],
    acs: companyObject["Aynı İş Çalışan Sayısı"],
    yzcs: companyObject["Yarı Zamanlı Çalışan Sayısı"],
    tascs: companyObject["Taşeron Çalışan Sayısı"],
    alan: companyObject["Alan"],
    departman: companyObject["Departman"],
    vardiya: companyObject["Vardiya"],
    logo: companyObject["Firma Logosu"],     
    kase: companyObject["Kaşe İmza"],     
    danisman: companyObject["Danışman"],   
    dokuman: companyObject["Doküman"], 
    teknik: companyObject["Teknik Dosya"],   
    tkapsam: companyObject["Teknik Dosya Kaspamı"],
    sinif: companyObject["Firma Sınıfı"],
    not: companyObject["Firma Not"],
    ea: companyObject["EA"],
    nace: companyObject["NACE"],
    medikal: companyObject["Medikal Sektör"], 
    gida: companyObject["Gıda Sektörü"]  
    // Diğer 43 özelliğin tamamı için e-tablonuzdaki başlıklarla eşleştirmeyi yapın.
    // Eğer bir başlık adı JavaScript için geçerli bir property adı değilse
    // (örn. "Vergi Dairesi" gibi boşluk içeriyorsa), companyObject["Vergi Dairesi"] şeklinde erişirsiniz, bu doğrudur.
  };
}

function addCompany(companyInfo) {
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("Firmalar");

  // Mevcut ID'leri al (Bu kısım ID üretimi için)
  let maxNum = 0;
  const lastDataRow = ws.getLastRow();
  if (lastDataRow >= 2) { // Veri satırı varsa ID'leri kontrol et
    const uniqueIDs = ws.getRange(2, 1, lastDataRow - 1, 1).getValues()
      .flat()
      .map(id => parseInt(id)) // Sayıya çevir
      .filter(id => !isNaN(id)); // Sadece geçerli sayıları al

    if (uniqueIDs.length > 0) {
      maxNum = Math.max(0, ...uniqueIDs);
    }
  }
  const newID = maxNum + 1;

  // E-tablodaki başlıkları al
  const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0].map(h => String(h).trim());

  // companyInfo'daki anahtarları e-tablo başlıklarına göre sıralayarak yeni satır verisini oluştur
  // Bu eşleme (mapping), getCompanyById'daki return objesindekine benzer olmalı
  const newRowValues = headers.map(header => {
    // Not: Aşağıdaki case'lerdeki stringler sizin "Firmalar" e-tablonuzdaki GERÇEK BAŞLIKLAR olmalıdır.
    switch (header) {
      case "Firma No": return newID;
      case "Firma Adı": return companyInfo.nickname || '';
      case "Unvan": return companyInfo.unvan || '';
      case "Adres": return companyInfo.adres || '';
      case "İl": return companyInfo.sehir || '';
      case "Ülke": return companyInfo.ulke || '';
      case "Yazışma Adresi": return companyInfo.yazisma || '';
      case "Vergi Dairesi": return companyInfo.vergiD || '';
      case "Vergi Numarası": return companyInfo.vergiN || '';
      case "Telefon": return companyInfo.tel || '';
      case "Faks": return companyInfo.faks || '';
      case "İnternet": return companyInfo.www || '';
      case "Mail": return companyInfo.mail || '';
      case "Yetkili Adı": return companyInfo.yetA || '';
      case "Yetkili Unvanı": return companyInfo.yetU || '';
      case "Kalite Yönetim Temsilcisi": return companyInfo.kyt || '';
      case "İrtibat Kişisi": return companyInfo.irtA || '';
      case "İrtibat Kişisi Unvanı": return companyInfo.irtU || '';
      case "İrtibat Kişisi Numarası": return companyInfo.irtN || '';
      case "İrtibat Kişisi Mail": return companyInfo.irtM || '';
      case "Türkçe Kapsam": return companyInfo.kapsam || '';
      case "İngilizce Kapsam": return companyInfo.scope || '';
      case "Yapılan İş": return companyInfo.yapis || '';
      case "Toplam Çalışan Sayısı": return companyInfo.tcs || '';
      case "Yönetim Çalışan Sayısı": return companyInfo.ycs || '';
      case "Üretim Çalışan Sayısı": return companyInfo.ucs || '';
      case "Aynı İş Çalışan Sayısı": return companyInfo.acs || '';
      case "Yarı Zamanlı Çalışan Sayısı": return companyInfo.yzcs || '';
      case "Taşeron Çalışan Sayısı": return companyInfo.tascs || '';
      case "Alan": return companyInfo.alan || '';
      case "Departman": return companyInfo.departman || '';
      case "Vardiya": return companyInfo.vardiya || '';
      case "Firma Logosu": return companyInfo.logo || ""; // Orijinal kodunuzda "" vardı
      case "Kaşe İmza": return companyInfo.kase || "";   // Orijinal kodunuzda "" vardı
      case "Danışman": return companyInfo.danisman || '';
      case "Doküman": return companyInfo.dokuman === true || String(companyInfo.dokuman).toLowerCase() === 'true'; // Boolean için
      case "Teknik Dosya": return companyInfo.teknik === true || String(companyInfo.teknik).toLowerCase() === 'true'; // Boolean için
      case "Teknik Dosya Kapsamı": return companyInfo.tkapsam || ''; // "Kaspamı" yerine "Kapsamı" olabilir
      case "Firma Sınıfı": return companyInfo.sinif || '';
      case "Firma Not": return companyInfo.not || '';
      case "EA": return companyInfo.ea || '';
      case "NACE": return companyInfo.nace || '';
      case "Medikal Sektör": return companyInfo.medikal === true || String(companyInfo.medikal).toLowerCase() === 'true'; // Boolean için
      case "Gıda Sektörü": return companyInfo.gida === true || String(companyInfo.gida).toLowerCase() === 'true'; // Boolean için
      default:
        Logger.log(`addCompany: Bilinmeyen başlık "${header}" veya companyInfo'da karşılığı yok.`);
        return ''; // Bilinmeyen başlıklar için boş değer
    }
  });

  ws.appendRow(newRowValues);
  Logger.log(newID + " ID'li yeni firma eklendi: " + companyInfo.unvan);
  // İsterseniz yeni eklenen firmayı veya ID'yi döndürebilirsiniz.
  // return newID; veya getCompanyById(newID);
}

function editCompanyById(id, companyInfo) {
  try {
    const ss = openTargetSpreadsheet();
    const ws = ss.getSheetByName("Firmalar");

    // Satır numarasını bulmak için mevcut yönteminiz (ID sütununu okuyup index bulma)
    // Büyük tablolarda TextFinder daha performanslı olabilir, ama bu da çalışır.
    const lastDataRow = ws.getLastRow();
    let posIndex = -1;
    if (lastDataRow >= 2) {
        const comIds = ws.getRange(2, 1, lastDataRow - 1, 1).getValues()
                         .map(r => String(r[0]).toLowerCase());
        posIndex = comIds.indexOf(String(id).toLowerCase());
    }

    if (posIndex === -1) {
      throw new Error("Girilen ID (" + id + ") hiçbir şirketle eşleşmiyor.");
    }
    const rowNumber = posIndex + 2; // Satır numarası

    // E-tablodaki başlıkları al (ID sütunu hariç, çünkü onu güncellemiyoruz)
    // getRange(1, 2, ...) ile 2. sütundan başlatabiliriz veya tüm başlıkları alıp ID'yi atlayabiliriz.
    const allHeaders = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const headersToUpdate = allHeaders.slice(1); // İlk başlığı (ID) çıkar

    // companyInfo'daki anahtarları e-tablo başlıklarına göre sıralayarak güncellenecek değerleri oluştur
    const newRowValues = headersToUpdate.map(header => {
      // Not: Aşağıdaki case'lerdeki stringler sizin "Firmalar" e-tablonuzdaki GERÇEK BAŞLIKLAR olmalıdır.
      switch (header) {
        // ID sütunu (allHeaders[0]) zaten atlandığı için burada "Firma No" case'i olmaz.
        case "Firma Adı": return companyInfo.nick || ''; // Orijinalde nick -> Firma Adı eşleşmesi vardı
        case "Unvan": return companyInfo.unvan || '';
        case "Adres": return companyInfo.adres || '';
        case "İl": return companyInfo.sehir || '';
        case "Ülke": return companyInfo.ulke || '';
        case "Yazışma Adresi": return companyInfo.yazisma || '';
        case "Vergi Dairesi": return companyInfo.vergiD || '';
        case "Vergi Numarası": return companyInfo.vergiN || '';
        case "Telefon": return companyInfo.tel || '';
        case "Faks": return companyInfo.faks || '';
        case "İnternet": return companyInfo.www || '';
        case "Mail": return companyInfo.mail || '';
        case "Yetkili Adı": return companyInfo.yetA || '';
        case "Yetkili Unvanı": return companyInfo.yetU || '';
        case "Kalite Yönetim Temsilcisi": return companyInfo.kyt || '';
        case "İrtibat Kişisi": return companyInfo.irtA || '';
        case "İrtibat Kişisi Unvanı": return companyInfo.irtU || '';
        case "İrtibat Kişisi Numarası": return companyInfo.irtN || '';
        case "İrtibat Kişisi Mail": return companyInfo.irtM || '';
        case "Türkçe Kapsam": return companyInfo.kapsam || '';
        case "İngilizce Kapsam": return companyInfo.scope || '';
        case "Yapılan İş": return companyInfo.yapis || '';
        case "Toplam Çalışan Sayısı": return companyInfo.tcs || '';
        case "Yönetim Çalışan Sayısı": return companyInfo.ycs || '';
        case "Üretim Çalışan Sayısı": return companyInfo.ucs || '';
        case "Aynı İş Çalışan Sayısı": return companyInfo.acs || '';
        case "Yarı Zamanlı Çalışan Sayısı": return companyInfo.yzcs || '';
        case "Taşeron Çalışan Sayısı": return companyInfo.tascs || '';
        case "Alan": return companyInfo.alan || '';
        case "Departman": return companyInfo.departman || '';
        case "Vardiya": return companyInfo.vardiya || '';
        case "Firma Logosu": return companyInfo.logo || '';
        case "Kaşe İmza": return companyInfo.kase || '';
        case "Danışman": return companyInfo.danisman || '';
        case "Doküman": return companyInfo.dokuman === true || String(companyInfo.dokuman).toLowerCase() === 'true' || companyInfo.dokuman === false ? companyInfo.dokuman : ''; // boolean veya boş
        case "Teknik Dosya": return companyInfo.teknik === true || String(companyInfo.teknik).toLowerCase() === 'true' || companyInfo.teknik === false ? companyInfo.teknik : ''; // boolean veya boş
        case "Teknik Dosya Kapsamı": return companyInfo.tkapsam || ''; // "Kaspamı" yerine "Kapsamı" olabilir
        case "Firma Sınıfı": return companyInfo.sinif || '';
        case "Firma Not": return companyInfo.not || '';
        case "EA": return companyInfo.ea || '';
        case "NACE": return companyInfo.nace || '';
        case "Medikal Sektör": return companyInfo.medikal === true || String(companyInfo.medikal).toLowerCase() === 'true' || companyInfo.medikal === false ? companyInfo.medikal : ''; // boolean veya boş
        case "Gıda Sektörü": return companyInfo.gida === true || String(companyInfo.gida).toLowerCase() === 'true' || companyInfo.gida === false ? companyInfo.gida : ''; // boolean veya boş
        default:
          Logger.log(`editCompanyById: Bilinmeyen başlık "${header}" veya companyInfo'da karşılığı yok.`);
          return ''; // Bilinmeyen başlıklar için boş değer
      }
    });

    // ID sütunu hariç diğer sütunları güncelle (2. sütundan başlar)
    ws.getRange(rowNumber, 2, 1, headersToUpdate.length).setValues([newRowValues]);

    Logger.log("Şirket güncellendi: ID -> " + id + ", Unvan -> " + companyInfo.unvan);
    return true;

  } catch (error) {
    Logger.log("Hata oluştu: " + error.message);
    // İstemciye hatayı iletmek için: throw error; veya return { success: false, message: error.message };
    return false;
  }
}

function getDataForSearch() {
  const ss = openTargetSpreadsheet(); // Veya doğrudan SpreadsheetApp.openById(SPREADSHEET_ID);
  const ws = ss.getSheetByName("Firmalar");
  
  // Sayfa boş mu veya veriler yok mu kontrol et
  const lastRow = ws.getLastRow();
  if (lastRow < 2) {
    return []; // Eğer sayfada veri yoksa boş bir dizi döndür
  }

  // Verileri al
  const data = ws.getRange(2, 1, lastRow - 1, 5).getValues();
  return data;
}

function getDataForTable() {
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("Sertifika");
  const dataRange = ws.getRange("A1").getDataRegion();
  const data = dataRange.getDisplayValues();

  const headers = data.shift();

  // TRUE/FALSE verilerini 1/0'a dönüştüren yapı
  const jsData = data.map(r => {
    const tempObject = {};
    headers.forEach((header, i) => {
      let value = r[i];

      // Eğer Gözetim sütunuysa, TRUE/FALSE verilerini 1/0 olarak dönüştür
      if (header === "Gözetim") {
        value = value === "TRUE" ? 1 : 0; // Google Sheets'den gelen TRUE/FALSE'u kontrol et
      }

      tempObject[header] = value;
    });
    return tempObject;
  });

  return jsData;
}

function editCell(props) {
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("Sertifika");

  // ID ve alan boş ise hata döndür
  if (!props.id || !props.field) {
    throw new Error("ID veya Alan boş olamaz");
  }

  // ID ve Alanların doğruluğunu kontrol et
  const idCellMatched = ws.getRange("A2:A").createTextFinder(props.id).matchEntireCell(true).matchCase(true).findNext();
  const columnCellMatched = ws.getRange("1:1").createTextFinder(props.field).matchEntireCell(true).matchCase(true).findNext();

  // Hata durumu: ID veya alan bulunamazsa hata fırlat
  if (idCellMatched === null) throw new Error("Kayıt Bulunamadı");
  if (columnCellMatched === null) throw new Error("Yanlış Alan - Başlık Hatası");

  // Hücre koordinatlarını al
  const recordRowNumber = idCellMatched.getRow();
  const recordColumnNumber = columnCellMatched.getColumn();

  // Değer kontrolü
  const isNotlarField = props.field === "Notlar";
  if (!isNotlarField && (props.val === undefined || props.val === null || (typeof props.val === 'string' && props.val.trim() === ""))) {
    throw new Error(`Boş veya geçersiz değer girilemez. Alan: ${props.field}, ID: ${props.id}`);
  }

  // Eğer Gözetim alanı ise, boolean değerleri TRUE/FALSE olarak Google Sheets'e yaz
  if (props.field === "Gözetim") {
    const booleanValue = (props.val === true || props.val === "true" || props.val === 1);
    ws.getRange(recordRowNumber, recordColumnNumber).setValue(booleanValue);
  } else {
    // Diğer alanlar için değeri normal şekilde yaz
    ws.getRange(recordRowNumber, recordColumnNumber).setValue(props.val);
  }
}

function sendEmail(htmlTable) {
  const recipient = "info@medicert.com.tr";  // Alıcının e-posta adresi
  const subject = "Gözetim Belgeleriniz";
  const body = "Merhaba, aşağıda filtrelenmiş tabloyu bulabilirsiniz:<br><br>" + htmlTable;
  const fromAlias = "serdaryavuz@medicert.com.tr";  // Alternatif gönderici adresiniz

  GmailApp.sendEmail(recipient, subject, '', {
    htmlBody: body,
    from: fromAlias
  });
}

/**
****************************
*****  Denetim Ekleme  *****
****************************
*/

function addAuditInfo(auditInfo) {
  const cal = CalendarApp.getCalendarById("ukqd4fqmgujdhemc4slhmebgcc@group.calendar.google.com");
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("Denetim");

  // Benzersiz ID oluştur
  const uniqueIDs = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues();
  const maxNum = uniqueIDs.reduce((max, r) => Math.max(max, r[0]), 0);
  const newID = maxNum + 1;

  // Calendar etkinlik ID'lerini saklamak için değişkenler
  let a1EventId = null;
  let a2EventId = null;

  // Aşama 1 etkinliği oluştur ve ID'yi al
  if (auditInfo.a1kDenet) {
    const event1 = cal.createEvent(
      auditInfo.a1kDenet,
      new Date(`${auditInfo.a1Baslav2} 09:00`),
      new Date(`${auditInfo.a1Bitisv2} 17:00`),
      {
        description: `${auditInfo.nick} ISO ${auditInfo.standart} - Aşama 1 denetimi, Denetim Tipi: ${auditInfo.denetim}, Denetim ID: ${newID}`
      }
    );
    a1EventId = event1.getId(); // Etkinlik ID'sini al
  }

  // Aşama 2 etkinliği oluştur ve ID'yi al
  if (auditInfo.a2kDenet) {
    const event2 = cal.createEvent(
      auditInfo.a2kDenet,
      new Date(`${auditInfo.a2Baslav2} 09:00`),
      new Date(`${auditInfo.a2Bitisv2} 17:00`),
      {
        description: `${auditInfo.nick} ISO ${auditInfo.standart} - Aşama 2 denetimi, Denetim Tipi: ${auditInfo.denetim}, Denetim ID: ${newID}`
      }
    );
    a2EventId = event2.getId(); // Etkinlik ID'sini al
  }

  // Yeni denetim kaydı ekle
  ws.appendRow([
    newID, auditInfo.nick, auditInfo.firmano, auditInfo.standart, auditInfo.denetim,
    auditInfo.a1Full, auditInfo.a1Denetci, auditInfo.a2Full, auditInfo.a2Denetci,
    auditInfo.a1Basla, auditInfo.a1Bitis, auditInfo.a1Md, auditInfo.a1La, auditInfo.a1Fa, auditInfo.a1Sa,
    auditInfo.a2Basla, auditInfo.a2Bitis, auditInfo.a2Md, auditInfo.a2La, auditInfo.a2Fa, auditInfo.a2Sa,
    auditInfo.qms, auditInfo.mdd, auditInfo.ems, auditInfo.ohs, auditInfo.fsms, auditInfo.isms, auditInfo.engy,
    auditInfo.gmp,auditInfo.a1kDenet,auditInfo.a2kDenet, a1EventId, a2EventId // Calendar etkinlik ID'lerini kaydediyoruz
  ]);
}

/**
**********************************************************************
*****  Sertifika (Çağırma - Ekleme - Düzenleme - Silme - Arama)  *****
**********************************************************************
*/

function gdfCertificate() {
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("Sertifika");
  return ws.getRange(2,1, ws.getLastRow()-1,21).getDisplayValues();
}

function getCertificateById(id) {
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("Sertifika");
  const lastRow = ws.getLastRow();
  const idRange = ws.getRange(2, 1, lastRow - 1, 1).getValues();
  const comIds = idRange.map(r => r[0].toString().toLowerCase());
  
  const posIndex = comIds.indexOf(id.toString().toLowerCase());
  
  if (posIndex === -1) {
    Logger.log("ID bulunamadı: " + id);
    return null; // ID bulunamadığında null döndürülüyor
  }

  const rowNumber = posIndex + 2; // Satır numarasını hesapla
  const certificateInfo = ws.getRange(rowNumber, 1, 1, 25).getDisplayValues()[0];

  // Gözetim (19. sütun) değerini kontrol et ve dönüştür
  const gozetimValue = certificateInfo[19]?.trim().toLowerCase(); // Null ve boşlukları kontrol et
  const gozetim = gozetimValue === "true"; // String "true" ise true olarak dönüştür

  return {
    certId: certificateInfo[0], 
    isim: certificateInfo[1], 
    firmaNo: certificateInfo[2], 
    standart: certificateInfo[3],
    denetim: certificateInfo[4],
    sNo: certificateInfo[5], 
    sTarihi: certificateInfo[6],
    sGozetimT: certificateInfo[7],
    sTT: certificateInfo[8],
    sGT: certificateInfo[9],
    kapsam: certificateInfo[10],
    scope: certificateInfo[11],
    logo: certificateInfo[12],
    nace: certificateInfo[13], 
    akreditasyon: certificateInfo[14],
    akredite: certificateInfo[15],
    dan: certificateInfo[16], 
    durum: certificateInfo[17], 
    not: certificateInfo[18],
    gozetim: gozetim, // Boolean olarak dönüştürüldü
    other: certificateInfo[20] || "",
    calendar: certificateInfo[21] || "",
    search: certificateInfo[22] || "",
    certiLink: certificateInfo[23] || ""
  };
}

function editSurvMultiple(ids, crtInfo) {
    const ss = openTargetSpreadsheet();
    const ws = ss.getSheetByName("Sertifika");
    const comIds = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues().map(r => r[0].toString().toLowerCase());

    const sourceCalendar = CalendarApp.getCalendarById("d43d3fe59ccf1ff2e9ef23eb1fcbec9e8caf68568b733e3f9e8c8bc53d91c09e@group.calendar.google.com");
    const archiveCalendar = CalendarApp.getCalendarById("b5768ed3d388c17023448785350956fd1dbe2987eaaf4362d2e1c7d5f5627746@group.calendar.google.com");

    ids.forEach(id => {
        const posIndex = comIds.indexOf(id.toString().toLowerCase());
        if (posIndex !== -1) {
            const rowNumber = posIndex + 2;

            // Row 20: TRUE/FALSE değerini güncelle
            ws.getRange(rowNumber, 20).setValue(crtInfo);

            // Row 22: Google Takvim etkinlik ID'sini al
            const eventId = ws.getRange(rowNumber, 22).getValue();

            if (!eventId) {
                // Etkinlik ID'si yoksa fonksiyondan çık
                return;
            }

            try {
                if (crtInfo === "TRUE") {
                    // Etkinliği kaynak takvimde bul
                    const event = sourceCalendar.getEventById(eventId);

                    if (!event) {
                        // Etkinlik bulunamadıysa fonksiyondan çık
                        return;
                    }

                    // Hatırlatıcıları kaldır
                    event.clearReminders();

                    // Etkinliği "Arşiv" takvimine taşı
                    const newEvent = archiveCalendar.createEvent(
                        event.getTitle(),
                        event.getStartTime(),
                        event.getEndTime(),
                        {
                            description: event.getDescription(),
                            location: event.getLocation(),
                            guests: event.getGuestList().map(guest => guest.getEmail()).join(","),
                            sendInvites: false
                        }
                    );

                    // Kaynak takvimden etkinliği sil
                    event.deleteEvent();

                    // Yeni etkinlik ID'sini güncelle (opsiyonel)
                    ws.getRange(rowNumber, 22).setValue(newEvent.getId());
                } else if (crtInfo === "FALSE") {
                    // Etkinliği arşiv takvimde bul
                    const event = archiveCalendar.getEventById(eventId);

                    if (!event) {
                        // Etkinlik bulunamadıysa fonksiyondan çık
                        return;
                    }

                    // Hatırlatıcıları kaldır
                    event.clearReminders();

                    // Etkinliği "Kaynak" takvimine taşı
                    const newEvent = sourceCalendar.createEvent(
                        event.getTitle(),
                        event.getStartTime(),
                        event.getEndTime(),
                        {
                            description: event.getDescription(),
                            location: event.getLocation(),
                            guests: event.getGuestList().map(guest => guest.getEmail()).join(","),
                            sendInvites: false
                        }
                    );

                    // Yeni etkinliğe 1 hafta önce hatırlatıcı ekle
                    newEvent.addPopupReminder(10080); // 10080 dakika = 1 hafta

                    // Arşiv takviminden etkinliği sil
                    event.deleteEvent();

                    // Yeni etkinlik ID'sini güncelle (opsiyonel)
                    ws.getRange(rowNumber, 22).setValue(newEvent.getId());
                }
            } catch (error) {
                console.error(`Etkinlik ID'si işlenirken hata oluştu: ${eventId}`, error);
            }
        }
    });

    return true;
}

function addCertificate(crtInfo) {
  try {
    const ss = openTargetSpreadsheet();
    const ws = ss.getSheetByName("Sertifika");

    if (!ws) {
      throw new Error("Sertifika sayfası bulunamadı.");
    }

    // ID sütunundaki mevcut değerleri alıyoruz ve maksimum ID'yi buluyoruz
    const uniqueIDs = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues();
    let maxNum = 0;

    uniqueIDs.forEach(r => {
      const id = parseInt(r[0], 10);
      if (!isNaN(id)) {
        maxNum = id > maxNum ? id : maxNum;
      }
    });

    const newID = maxNum + 1;

    // Tarihi dönüştürme
    if (!crtInfo.goz || !crtInfo.goz.includes(".")) {
      throw new Error("Gözetim Tarihi (crtInfo.goz) geçersiz veya eksik.");
    }
    const [day, month, year] = crtInfo.goz.split(".");
    const eventDate = new Date(`${year}-${month}-${day}T09:00:00`); // Tarihi 09:00 olarak ayarla

    // Takvim etkinliği oluştur
    const cal = CalendarApp.getCalendarById("d43d3fe59ccf1ff2e9ef23eb1fcbec9e8caf68568b733e3f9e8c8bc53d91c09e@group.calendar.google.com");
    if (!cal) {
      throw new Error("Takvim bulunamadı. Lütfen Calendar ID'sini kontrol edin.");
    }

    // Başlık ve açıklama
    const eventTitle = `${crtInfo.nick} - ${crtInfo.standart}`;
    const eventDescription = crtInfo.standart === "Diğer"
      ? `${crtInfo.nick} firmasına ait ${crtInfo.other.trim()} belgesi. Firmanın Danışmanı: ${crtInfo.dan}`
      : `${crtInfo.nick} firmasına ait ${crtInfo.standart} belgesi. Firmanın Danışmanı: ${crtInfo.dan}`;

    Logger.log(`Etkinlik Başlığı: ${eventTitle}`);
    Logger.log(`Etkinlik Açıklaması: ${eventDescription}`);

    let event = null; // Event değişkenini tanımlıyoruz
    try {
      event = cal.createEvent(eventTitle, eventDate, new Date(eventDate.getTime() + 60 * 60 * 1000), {
        description: eventDescription
      });
      Logger.log(`Etkinlik oluşturuldu: ${event.getId()}`);
    } catch (error) {
      Logger.log(`Etkinlik oluşturulurken bir hata oluştu: ${error.message}`);
    }

    // Hatırlatıcılar ekle
    if (event) {
      event.addPopupReminder(10080); // 1 hafta öncesi hatırlatıcı
    }

    // Etkinlik ID'sini al
    const eventId = event ? event.getId() : "";

    // Yeni satırı ekle ve etkinlik ID'sini Calendar ID sütununa yaz
    ws.appendRow([
      newID,                 // ID
      crtInfo.nick,          // Nickname
      crtInfo.firmano,       // Firma No
      crtInfo.standart,      // Standart
      crtInfo.denetim,       // Denetim
      crtInfo.sno,           // Sertifika No
      crtInfo.gst,           // Geçerlilik Tarihi
      crtInfo.goz,           // Gözetim Tarihi
      crtInfo.stt,           // Son Tarih
      crtInfo.sgt,           // Sertifika Geçerlilik Tarihi
      crtInfo.kapsam,        // Kapsam
      crtInfo.scope,         // Scope
      crtInfo.logo,          // Logo
      crtInfo.kod,           // Kod
      crtInfo.akreditasyon,  // Akreditasyon
      crtInfo.akredite,      // Akredite
      crtInfo.dan,           // Danışman
      crtInfo.durum,         // Durum
      crtInfo.not,           // Not
      "FALSE",               // Gözetim Onayını işaretsiz yap
      crtInfo.other,         // Diğer Standart
      eventId,               // Calendar ID
      crtInfo.qr,            // QR Kod alanı
      ""                     // Sertifika Link şimdilik boş
    ]);

    Logger.log(`Yeni sertifika başarıyla eklendi: ${newID}`);
  } catch (error) {
    Logger.log(`Sertifika eklenirken hata oluştu: ${error.message}`);
    throw new Error(`Sertifika eklenirken bir hata oluştu: ${error.message}`);
  }
}

function editCertificateById(id, crtInfo) {
    try {
        const ss = openTargetSpreadsheet();
        const ws = ss.getSheetByName("Sertifika");

        const comIds = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues().map(r => r[0].toString().toLowerCase());
        const posIndex = comIds.indexOf(id.toString().toLowerCase());
        const rowNumber = posIndex === -1 ? 0 : posIndex + 2;

        if (rowNumber === 0) {
            throw new Error('Belirtilen ID ile eşleşen bir sertifika bulunamadı.');
        }

        const cal = CalendarApp.getCalendarById("d43d3fe59ccf1ff2e9ef23eb1fcbec9e8caf68568b733e3f9e8c8bc53d91c09e@group.calendar.google.com");
        const eventId = crtInfo.cal;

        const [day, month, year] = crtInfo.goz.split(".");
        const eventDate = new Date(`${year}-${month}-${day}T09:00:00`);

        const eventTitle = `${crtInfo.nick} - ${crtInfo.standart}`;
        const eventDescription = crtInfo.standart === "Diğer"
            ? `${crtInfo.nick} firmasına ait ${crtInfo.other.trim()} belgesi. Firmanın Danışmanı: ${crtInfo.dan}`
            : `${crtInfo.nick} firmasına ait ${crtInfo.standart} belgesi. Firmanın Danışmanı: ${crtInfo.dan}`;

        Logger.log(`Etkinlik Başlığı: ${eventTitle}`);
        Logger.log(`Etkinlik Açıklaması: ${eventDescription}`);

        let event = eventId ? cal.getEventById(eventId) : null;
        if (event) {
            event.setTitle(eventTitle);
            event.setDescription(eventDescription);
            event.setTime(eventDate, new Date(eventDate.getTime() + 60 * 60 * 1000));
        } else {
            event = cal.createEvent(eventTitle, eventDate, new Date(eventDate.getTime() + 60 * 60 * 1000), {
                description: eventDescription
            });
            crtInfo.cal = event.getId();
        }

        event.addPopupReminder(10080); // 1 hafta öncesi hatırlatıcı

        ws.getRange(rowNumber, 2, 1, 23).setValues([[ // Güncellenen bilgileri kaydet
            crtInfo.nick,
            crtInfo.firmano,
            crtInfo.standart,
            crtInfo.denetim,
            crtInfo.sno,
            crtInfo.gst,
            crtInfo.goz,
            crtInfo.stt,
            crtInfo.sgt,
            crtInfo.kapsam,
            crtInfo.scope,
            crtInfo.logo,
            crtInfo.kod,
            crtInfo.akreditasyon,
            crtInfo.akredite,
            crtInfo.dan,
            crtInfo.durum,
            crtInfo.not,
            crtInfo.gdurum,
            crtInfo.other,
            crtInfo.cal,
            crtInfo.qr,
            ""
        ]]);

        return true;
    } catch (error) {
        Logger.log(`Sertifika düzenleme sırasında bir hata oluştu: ${error.message}`);
        throw new Error(`Sertifika düzenleme sırasında bir hata oluştu: ${error.message}`);
    }
}

// ***********************************************************
// **  Test (Çağırma - Ekleme - Düzenleme - Silme - Arama)  **
// ***********************************************************

function gdfTest() {
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("Testler");
  return ws.getRange(2,1, ws.getLastRow()-1,22).getDisplayValues();
}

function addTest(testInfo) {
  try {
    const ss = openTargetSpreadsheet(); // Bu fonksiyon daha önce tanımlı
    const ws = ss.getSheetByName("Testler");

    if (!ws) throw new Error("Testler sayfası bulunamadı.");

    // ID üretimi için mevcut ID'leri kontrol et
    const existingIds = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues().flat();
    const numericIds = existingIds.map(id => parseInt(id)).filter(id => !isNaN(id));
    const newId = numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;

    // Eklenecek satır
    const newRow = [
      newId,
      testInfo.firmaAdi,
      testInfo.firmaNo,
      testInfo.testAdi,
      testInfo.marka,
      testInfo.urun,
      testInfo.urunKodu,
      testInfo.urunNo,
      testInfo.lot,
      testInfo.urunKabul,
      testInfo.kabulSaat,
      testInfo.testBaslangic,
      testInfo.testBitis,
      testInfo.raporTarihi,
      testInfo.raporNo,
      testInfo.numuneSayisi,
      testInfo.numuneUT,
      testInfo.numuneSKT,
      testInfo.urunBilgi,
      testInfo.gorsel1,
      testInfo.gorsel2,
      testInfo.detay
    ];

    ws.appendRow(newRow);
    Logger.log(`✅ Test kaydı eklendi. ID: ${newId}`);
  } catch (err) {
    Logger.log(`❌ Test ekleme hatası: ${err.message}`);
    throw new Error(`Test eklenemedi: ${err.message}`);
  }
}

// **************************
// **  Proforma Ekranları  **
// **************************

function gdfProforma(firmId) {
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("Proforma");

  const firmIds = ws.getRange(2, 3, ws.getLastRow() - 1, 1).getValues().map(r => r[0].toString().toLowerCase());
  const indexes = firmIds
    .map((val, index) => (val === firmId.toString().toLowerCase() ? index + 2 : -1))
    .filter(index => index !== -1);

  if (indexes.length === 0) {
    return []; // Eğer firma ID bulunamazsa boş array döndür
  }

  // Seçili satırları al
  const results = indexes.map(row => ws.getRange(row, 1, 1, 10).getDisplayValues()[0]);

  return results; // Yalnızca ilgili firmaya ait satırları döndür
}

function addProInfo(proInfo) { 
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("Proforma");
  
  // En yüksek ID'yi al
  const uniqueIDs = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues();
  const maxNum = uniqueIDs.reduce((max, row) => Math.max(max, row[0] || 0), 0);
  const newID = maxNum + 1;

  // Yeni satırı ekle
  ws.appendRow([
    newID,
    proInfo.nick,
    proInfo.firmano,
    proInfo.haric,
    proInfo.oran,
    proInfo.tutar,
    proInfo.toplam,
    proInfo.birim,
    proInfo.tarih,
    proInfo.konu,
  ]);

  // Yeni eklenen ID ile proforma bilgisi al ve belge oluştur
  return proformaVeri(newID);
}

function proformaVeri(id) {
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("Proforma");
  
  // Proforma verisini bul
  const proformaData = ws.getDataRange().getDisplayValues();
  const header = proformaData[0]; // Başlık satırı
  const data = proformaData.slice(1); // Veri kısmı
  
  const proformaInfo = data.find(row => row[0].toString() === id.toString());
  if (!proformaInfo) throw new Error("Proforma kaydı bulunamadı.");

  const firmID = proformaInfo[2];

  // Firma bilgilerini al
  const wst = ss.getSheetByName("Firmalar");
  const firmData = wst.getDataRange().getValues();
  const companyInfo = firmData.find(row => row[0].toString() === firmID.toString());

  if (!companyInfo) throw new Error("Firma kaydı bulunamadı.");

  // Tüm verileri birleştir
  const proforma = proformaInfo.concat(companyInfo);

  // **Doküman oluşturma işlemi**
  const isim = proforma[1];
  const fano = proforma[0];
  const muno = proforma[2];
  const folderId = ilkKarekter(isim);

  const docTemp = DriveApp.getFileById("1mgAgm0T52UwFpeE1VDgCNWgVi7_tOmn60f5lCQUsRcU");
  const folder = DriveApp.getFolderById(folderId);
  const copy = docTemp.makeCopy(`${isim} - Proforma Fatura M${fano}T(${muno})`, folder);
  const doc = DocumentApp.openById(copy.getId());
  const body = doc.getBody();

  // **Değiştirilecek alanlar**
  const replacements = {
    "{{Firma}}": proforma[12],
    "{{Adres}}": proforma[13],
    "{{il}}": proforma[14],
    "{{Ulke}}": proforma[15],
    "{{Tel}}": proforma[19],
    "{{VDairesi}}": proforma[17],
    "{{VNo}}": proforma[18],
    "{{Yetkili}}": proforma[23],
    "{{FaturaNo}}": proforma[0],
    "{{FirmaNo}}": proforma[2],
    "{{Tarih}}": proforma[8],
    "{{Konu}}": proforma[9],
    "{{Kdvsiz}}": proforma[3],
    "{{Lira}}": proforma[7],
    "{{KdvOran}}": proforma[4],
    "{{KDV}}": proforma[5],
    "{{Toplam}}": proforma[6]
  };

  // **Tüm metinleri değiştir**
  for (let key in replacements) {
    body.replaceText(key, replacements[key]);
  }

  return `✅ ${isim} için Proforma Fatura oluşturuldu!`;
}

  function deleteProformaById(id) {
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("Proforma");
  const comIds = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues().map(r => r[0].toString().toLowerCase());
  const posIndex = comIds.indexOf(id.toString().toLowerCase());
  const rowNumber = posIndex === -1 ? 0 : posIndex + 2;
  ws.deleteRow(rowNumber);
}

// ************************************
// **  Standart Ekranı Geri Çağırma  **
// ************************************

function getStandardById(id) {
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("Standarts");
  const comIds = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues().map(r => r[0].toString().toLowerCase());
  const posIndex = comIds.indexOf(id.toString().toLowerCase());
  const rowNumber = posIndex === -1 ? 0 : posIndex + 2;
  const standardInfo = ws.getRange(rowNumber, 1, 1, 7).getDisplayValues()[0];
  return { standard: standardInfo[0], 
           abbr: standardInfo[1], 
           full: standardInfo[2],
           tanim: standardInfo[3],  
           define: standardInfo[4],
           themeid: standardInfo[5],
           temaid: standardInfo[6]
          };
}

// ****************************************************
// **  Açılır Menü ve Otomatik Doldurma için Kodlar  **
// ****************************************************

function returnIso(){
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("Standarts");
  return ws.getRange(2,1,ws.getLastRow()-1,3).getValues();
}

function returnDanisman(){
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("Consultants");
  return ws.getRange(2,1,ws.getLastRow()-1,1).getValues();
}

function xtranslate(metin) {
  return LanguageApp.translate(metin, 'tr', 'en');
}

function ytranslate(metin) {
  return LanguageApp.translate(metin, 'en', 'tr');
}

function returnAstandards(){
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("Auditors");
  return ws.getRange(2,1,ws.getLastRow()-1,5).getValues();
}

function returnTest() {
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("TestDoc");

  const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  const headerMap = {};
  headers.forEach((h, i) => headerMap[String(h).trim()] = i);

  const requiredHeaders = ["Kategori", "Testin Açıklaması", "Doküman Adı", "Gün Sayısı"];
  const optionalHeaders = ["Kısaltma", "Kısaltma 2"];

  for (const header of requiredHeaders) {
    if (!(header in headerMap)) {
      throw new Error(`"${header}" başlığı bulunamadı. Lütfen "TestDoc" sayfasını kontrol edin.`);
    }
  }

  const lastRow = ws.getLastRow();
  if (lastRow < 2) return {};

  const data = ws.getRange(2, 1, lastRow - 1, ws.getLastColumn()).getValues();
  const dropdownMap = {};

  data.forEach(row => {
    const kategori = row[headerMap["Kategori"]];
    const test = row[headerMap["Testin Açıklaması"]];
    const dokuman = row[headerMap["Doküman Adı"]];
    const gun = row[headerMap["Gün Sayısı"]];

    if (!kategori || !test || !dokuman) return;

    if (!dropdownMap[kategori]) dropdownMap[kategori] = {};
    if (!dropdownMap[kategori][test]) dropdownMap[kategori][test] = [];

    const kisaltma = headerMap["Kısaltma"] !== undefined ? row[headerMap["Kısaltma"]] : "";
    const kisaltma2 = headerMap["Kısaltma 2"] !== undefined ? row[headerMap["Kısaltma 2"]] : "";

    dropdownMap[kategori][test].push({
      dokuman: dokuman,
      gun: gun,
      kisaltma: kisaltma || "",
      kisaltma2: kisaltma2 || ""
    });
  });

  return dropdownMap;
}

// *******************************
// **  Birleştirilmiş Bilgiler  **
// *******************************

function sertifikaVeri(id, lang, select) {
  const ss = openTargetSpreadsheet();
  
  const getRowData = (sheetName, searchValue, columnIndex, rangeColumns) => {
  const ws = ss.getSheetByName(sheetName);
  const ids = ws.getRange(2, columnIndex, ws.getLastRow() - 1, 1).getDisplayValues().map(r => r[0].toString().toLowerCase());
  const posIndex = ids.indexOf(searchValue.toString().toLowerCase());

  if (posIndex === -1) {
    throw new Error(`Aranan değer '${searchValue}' tablosunda bulunamadı.`);
  }

  return ws.getRange(posIndex + 2, 1, 1, rangeColumns).getDisplayValues()[0];
  };

  const certificateInfo = getRowData("Sertifika", id, 1, 24);
  if (!certificateInfo) {
    throw new Error("Certificate not found.");
  }

  const firmID = certificateInfo[2];
  const companyInfo = getRowData("Firmalar", firmID, 1, 44);

  const standardID = certificateInfo[3];
  const standartInfo = getRowData("Standarts", standardID, 1, 7);

  if (!companyInfo || !standartInfo) {
    throw new Error("Company or Standard data not found.");
  }

  const sertifika = certificateInfo.concat(companyInfo).concat(standartInfo);

  return {
    nick: sertifika[1],
    id: sertifika[2],
    standard: sertifika[3],
    sNo: sertifika[5],
    sTarihi: sertifika[6],
    sGozetimT: sertifika[7],
    sTT: sertifika[8],
    sGT: sertifika[9],
    sKapsam: sertifika[10],
    sScope: sertifika[11],
    logo: sertifika[12],
    nace: sertifika[13],
    akrn: sertifika[14],
    not: sertifika[18],
    other: sertifika[20],
    qrLink: sertifika[22],
    unvan: sertifika[26],
    adres: sertifika[27],
    il: sertifika[28],
    ulke: sertifika[29],
    sube: sertifika[30],
    trtema: sertifika[74],
    entema: sertifika[73],
    lang: lang,
    select: select,
  };
}

function testVeri(id, lang) {
  try {
    const ss = openTargetSpreadsheet();
    if (!ss) {
      console.error("[Sunucu testVeri] HATA: openTargetSpreadsheet() fonksiyonu bir e-tablo döndürmedi.");
      throw new Error("E-tablo açılamadı veya bulunamadı.");
    }

    const testSheetName = "Testler";
    const testDocSheetName = "TestDoc";
    const firmaSheetName = "Firmalar";

    const testSheet = ss.getSheetByName(testSheetName);
    const testDocSheet = ss.getSheetByName(testDocSheetName);
    const firmaSheet = ss.getSheetByName(firmaSheetName);

    if (!testSheet) {
      console.error(`[Sunucu testVeri] HATA: '${testSheetName}' adlı sayfa bulunamadı.`);
      throw new Error(`'${testSheetName}' sayfası bulunamadı.`);
    }
    if (!testDocSheet) {
      console.error(`[Sunucu testVeri] HATA: '${testDocSheetName}' adlı sayfa bulunamadı.`);
      throw new Error(`'${testDocSheetName}' sayfası bulunamadı.`);
    }
    if (!firmaSheet) {
      console.error(`[Sunucu testVeri] HATA: '${firmaSheetName}' adlı sayfa bulunamadı.`);
      throw new Error(`'${firmaSheetName}' sayfası bulunamadı.`);
    }

    const testData = testSheet.getDataRange().getValues();
    const testHeaders = testData.length > 0 ? testData[0].map(h => String(h).trim()) : [];
    if (testData.length === 0 || testHeaders.length === 0) {
      console.error(`[Sunucu testVeri] HATA: '${testSheetName}' sayfası boş veya başlık satırı yok.`);
      throw new Error(`'${testSheetName}' sayfası boş veya başlıkları okunamadı.`);
    }
    const testHeaderMap = Object.fromEntries(testHeaders.map((h, i) => [h, i]));

    // Sütun adları (E-tablonuzdakiyle birebir aynı olmalı)
    const colTestNo_Testler = "Test No";
    const colTestAdi_Testler = "Testin Adı";
    const colFirmaNo_Testler = "Firma No";
    const colFirmaAdi_Testler = "Firma Adı";
    const colMarka_Testler = "Marka";
    const colUrun_Testler = "Ürün";
    const colUrunKisaKodu_Testler = "Ürün Kısa Kodu";
    const colUrunNo_Testler = "Ürün No";
    const colLot_Testler = "Lot";
    const colUrunKabul_Testler = "Ürün Kabul";
    const colKabulSaat_Testler = "Kabul Saat";
    const colTestBaslangic_Testler = "Test Başlangıç";
    const colTestBitis_Testler = "Test Bitiş";
    const colRaporTarihi_Testler = "Rapor Tarihi";
    const colRaporNo_Testler = "Rapor No";
    const colNumuneSayisi_Testler = "Numune Sayısı";
    const colNumuneUT_Testler = "Numune ÜT";
    const colNumuneSKT_Testler = "Numune SKT";
    const colUrunBilgi_Testler = "Ürün Bilgi";
    const colGorsel1_Testler = "Görsel 1";
    const colGorsel2_Testler = "Görsel 2";
    const colDetay_Testler = "Detay";

    // Gerekli başlıkların varlığını kontrol etme fonksiyonu (iç içe tanımlanabilir veya dışarıda olabilir)
    function checkHeaders(headerMap, headers, sheetName, requiredCols) {
      for (const colName of requiredCols) {
        if (!(colName in headerMap)) {
          const errMsg = `'${sheetName}' sayfasında '${colName}' başlığı bulunamadı! Mevcut başlıklar: ${headers.join(", ")}`;
          console.error(`[Sunucu testVeri] HATA: ${errMsg}`);
          throw new Error(`'${sheetName}' sayfasında '${colName}' başlığı eksik.`);
        }
      }
    }
    // Kontrol edilecek temel başlıkları buraya ekleyin
    const requiredTestlerCols = [
        colTestNo_Testler, colTestAdi_Testler, colFirmaNo_Testler, colFirmaAdi_Testler,
        colMarka_Testler, colUrun_Testler, colUrunKisaKodu_Testler, colUrunNo_Testler,
        colLot_Testler, colUrunKabul_Testler, colKabulSaat_Testler, colTestBaslangic_Testler,
        colTestBitis_Testler, colRaporTarihi_Testler, colRaporNo_Testler, colNumuneSayisi_Testler,
        colNumuneUT_Testler, colNumuneSKT_Testler, colUrunBilgi_Testler, colGorsel1_Testler,
        colGorsel2_Testler, colDetay_Testler
    ];
    checkHeaders(testHeaderMap, testHeaders, testSheetName, requiredTestlerCols);

    const row = testData.find(r => {
      const noInSheet = r[testHeaderMap[colTestNo_Testler]];
      const valFromSheet = String(noInSheet).trim().replace(/\.0$/, "");
      const targetVal = String(id).trim().replace(/\.0$/, "");
      return valFromSheet === targetVal;
    });

    if (!row) {
      console.error(`[Sunucu testVeri] HATA: '${testSheetName}' sayfasında '${colTestNo_Testler}' değeri '${id}' olan satır bulunamadı.`);
      throw new Error(`'${testSheetName}' sayfasında test (ID: ${id}) bulunamadı.`);
    }

    const testisim = row[testHeaderMap[colTestAdi_Testler]] || "";

    const testDocData = testDocSheet.getDataRange().getValues();
    const testDocHeaders = testDocData.length > 0 ? testDocData[0].map(h => String(h).trim()) : [];
    if (testDocData.length === 0 || testDocHeaders.length === 0) {
      console.error(`[Sunucu testVeri] HATA: '${testDocSheetName}' sayfası boş veya başlık satırı yok.`);
      throw new Error(`'${testDocSheetName}' sayfası boş veya başlıkları okunamadı.`);
    }
    const testDocHeaderMap = Object.fromEntries(testDocHeaders.map((h, i) => [h, i]));

    const colDokumanAdi_TestDoc = "Doküman Adı";
    const colTurkceTestAdi_TestDoc = "Türkçe Test Adı";
    const colIngilizceTestAdi_TestDoc = "İngilizce Test Adı";
    const colTurkceTema_TestDoc = "Türkçe Tema";
    const colIngilizceTema_TestDoc = "İngilizce Tema";
    const colGunSayisi_TestDoc = "Gün Sayısı";
    const colKisaltma_TestDoc = "Kısaltma";
    const colKisaltma2_TestDoc = "Kısaltma 2";
    const requiredTestDocCols = [
        colDokumanAdi_TestDoc, colTurkceTestAdi_TestDoc, colIngilizceTestAdi_TestDoc,
        colTurkceTema_TestDoc, colIngilizceTema_TestDoc, colGunSayisi_TestDoc,
        colKisaltma_TestDoc, colKisaltma2_TestDoc
    ];
    checkHeaders(testDocHeaderMap, testDocHeaders, testDocSheetName, requiredTestDocCols);

    const docRow = testDocData.find(r => (r[testDocHeaderMap[colDokumanAdi_TestDoc]] || "").toString().trim() === testisim.toString().trim());
    
    if (!docRow) {
      console.error(`[Sunucu testVeri] HATA: '${testDocSheetName}' sayfasında '${colDokumanAdi_TestDoc}' değeri '${testisim}' olan eşleşen test bulunamadı.`);
      throw new Error(`'${testDocSheetName}' sayfasında doküman ('${testisim}') bulunamadı.`);
    }

    const firmaData = firmaSheet.getDataRange().getValues();
    const firmaHeaders = firmaData.length > 0 ? firmaData[0].map(h => String(h).trim()) : [];
    if (firmaData.length === 0 || firmaHeaders.length === 0) {
      console.error(`[Sunucu testVeri] HATA: '${firmaSheetName}' sayfası boş veya başlık satırı yok.`);
      throw new Error(`'${firmaSheetName}' sayfası boş veya başlıkları okunamadı.`);
    }
    const firmaHeaderMap = Object.fromEntries(firmaHeaders.map((h, i) => [h, i]));

    const colFirmaNo_Firmalar = "Firma No";
    const colUnvan_Firmalar = "Unvan";
    const colAdres_Firmalar = "Adres";
    const colIl_Firmalar = "İl";
    const colUlke_Firmalar = "Ülke";
    const requiredFirmalarCols = [
        colFirmaNo_Firmalar, colUnvan_Firmalar, colAdres_Firmalar,
        colIl_Firmalar, colUlke_Firmalar
    ];
    checkHeaders(firmaHeaderMap, firmaHeaders, firmaSheetName, requiredFirmalarCols);

    const firmaNoRaw = row[testHeaderMap[colFirmaNo_Testler]];
    const firmaSatiri = firmaData.find(r => {
      const noInSheet = r[firmaHeaderMap[colFirmaNo_Firmalar]];
      const valFromSheet = String(noInSheet).trim().replace(/\.0$/, "");
      const targetVal = String(firmaNoRaw).trim().replace(/\.0$/, "");
      return valFromSheet === targetVal;
    });

    if (!firmaSatiri) {
      console.error(`[Sunucu testVeri] HATA: '${firmaSheetName}' sayfasında '${colFirmaNo_Firmalar}' değeri '${firmaNoRaw}' için veri bulunamadı.`);
      throw new Error(`'${firmaSheetName}' sayfasında firma (No: '${firmaNoRaw}') bulunamadı.`);
    }

    const firmaInfo = {
      unvan: firmaSatiri[firmaHeaderMap[colUnvan_Firmalar]] || "",
      adres: firmaSatiri[firmaHeaderMap[colAdres_Firmalar]] || "",
      sehir: firmaSatiri[firmaHeaderMap[colIl_Firmalar]] || "",
      ulke: firmaSatiri[firmaHeaderMap[colUlke_Firmalar]] || ""
    };

    const testverisi = {
      testno: row[testHeaderMap[colTestNo_Testler]],
      fnick: row[testHeaderMap[colFirmaAdi_Testler]],
      fno: row[testHeaderMap[colFirmaNo_Testler]],
      testisim,
      testadi: docRow[testDocHeaderMap[colTurkceTestAdi_TestDoc]] || "",
      testname: docRow[testDocHeaderMap[colIngilizceTestAdi_TestDoc]] || "",
      trtema: docRow[testDocHeaderMap[colTurkceTema_TestDoc]] || "",
      entema: docRow[testDocHeaderMap[colIngilizceTema_TestDoc]] || "",
      gunsay: docRow[testDocHeaderMap[colGunSayisi_TestDoc]] || "",
      kisabir: docRow[testDocHeaderMap[colKisaltma_TestDoc]] || "",
      kisaiki: docRow[testDocHeaderMap[colKisaltma2_TestDoc]] || "",
      marka: row[testHeaderMap[colMarka_Testler]] || "",
      urun: row[testHeaderMap[colUrun_Testler]] || "",
      urunkod: row[testHeaderMap[colUrunKisaKodu_Testler]] || "",
      urunno: row[testHeaderMap[colUrunNo_Testler]] || "",
      lot: row[testHeaderMap[colLot_Testler]] || "",
      kabultarih: row[testHeaderMap[colUrunKabul_Testler]] || "",
      kabulsaat: row[testHeaderMap[colKabulSaat_Testler]] || "",
      testba: row[testHeaderMap[colTestBaslangic_Testler]] || "",
      testbi: row[testHeaderMap[colTestBitis_Testler]] || "",
      raportarihi: row[testHeaderMap[colRaporTarihi_Testler]] || "",
      raporno: row[testHeaderMap[colRaporNo_Testler]] || "",
      numunesay: row[testHeaderMap[colNumuneSayisi_Testler]] || "",
      numuneut: row[testHeaderMap[colNumuneUT_Testler]] || "",
      numuneskt: row[testHeaderMap[colNumuneSKT_Testler]] || "",
      urunbilgi: row[testHeaderMap[colUrunBilgi_Testler]] || "",
      gorselbir: row[testHeaderMap[colGorsel1_Testler]] || "",
      gorseliki: row[testHeaderMap[colGorsel2_Testler]] || "",
      detay: row[testHeaderMap[colDetay_Testler]] || "",
      lang,
      ...firmaInfo
    };

    const dateFields = ["kabultarih", "kabulsaat", "testba", "testbi", "raportarihi", "numuneut", "numuneskt"];
    for (const field of dateFields) {
      if (testverisi[field] && testverisi[field] instanceof Date) {
        try {
          if (isNaN(testverisi[field].getTime())) {
            console.warn(`[Sunucu testVeri] UYARI: '${field}' alanı geçersiz bir tarih içeriyor: ${testverisi[field]}. Olduğu gibi bırakılıyor.`);
            testverisi[field] = testverisi[field].toString(); 
          } else {
            testverisi[field] = testverisi[field].toISOString();
          }
        } catch (dateError) {
          console.error(`[Sunucu testVeri] HATA: Tarih alanı '${field}' ISOString'e dönüştürülürken hata. Değer: ${testverisi[field]}. Hata: ${dateError.message}`);
          testverisi[field] = "Tarih Dönüştürme Hatası";
        }
      }
      // else if (testverisi[field]) {
      //  Eğer alan Date nesnesi değilse ama yine de işlem gerekirse burası kullanılabilir.
      // }
    }
    
    if (!testverisi) {
      console.warn("[Sunucu testVeri] UYARI: 'testverisi' nesnesi null veya undefined olarak sonuçlandı (bu beklenmemeli).");
      return null; 
    }

    return testverisi;

  } catch (e) {
    console.error(`[Sunucu testVeri] KRİTİK HATA: ${e.message}`, e.stack);
    throw e; 
  }
}

// ********************************************
// **  Sertifika Sorgulama Tablosunu Doldur  **
// ********************************************

function veriCekVeYaz() {
  try {
    // Kaynak ve hedef çalışma sayfalarının tanımlanması
    var kaynakSheetID = '1FXYQ9S5ZnR1g9fkbxa0sCekJWV_cfy-5cPFojtOfRJs';
    var kaynakSayfaAdi = 'Sertifika';
    var firmalarSayfaAdi = 'Firmalar';
    var standartsSayfaAdi = 'Standarts';

    var kaynakSheet = SpreadsheetApp.openById(kaynakSheetID);
    var veriSheet = kaynakSheet.getSheetByName(kaynakSayfaAdi);
    var firmalarSheet = kaynakSheet.getSheetByName(firmalarSayfaAdi);
    var standartsSheet = kaynakSheet.getSheetByName(standartsSayfaAdi);

    var sonSatir = veriSheet.getLastRow();
    var sonSutun = veriSheet.getLastColumn(); // Dinamik sütun sayısı

    var veriAraligi = veriSheet.getRange(1, 1, sonSatir, sonSutun);
    var veri = veriAraligi.getValues();

    var firmalarSonSatir = firmalarSheet.getLastRow();
    var firmalarSonSutun = 6; // İlk 6 sütunu al
    var firmalarVeriAraligi = firmalarSheet.getRange(1, 1, firmalarSonSatir, firmalarSonSutun);
    
    // B sütununu (index 1) çıkarmak için filtreleme
    var firmalarVeri = firmalarVeriAraligi.getValues().map(row => {
      return row.filter((_, index) => index !== 1); // B sütununu atla
    });

    var standartsSonSatir = standartsSheet.getLastRow();
    var standartsSonSutun = 3;
    var standartsVeriAraligi = standartsSheet.getRange(1, 1, standartsSonSatir, standartsSonSutun);
    var standartsVeri = standartsVeriAraligi.getValues();

    var istenmeyenSutunlar = [0, 1, 4, 8, 9, 12, 13, 16, 17, 18, 21, 22];

    var filtrelenmisVeri = veri.map(function(row) {
      return row.filter(function(_, columnIndex) {
        return !istenmeyenSutunlar.includes(columnIndex);
      });
    });

    var filtrelenmisVeriSon = filtrelenmisVeri.filter(function(row) {
      return row[9] !== true;
    });

    var bugun = new Date();

    filtrelenmisVeriSon = filtrelenmisVeriSon.filter(function(row) {
      var tarih = new Date(row[4]);
      return !isNaN(tarih) && tarih >= bugun;
    });

    filtrelenmisVeriSon.sort(function(a, b) {
      var tarihA = new Date(a[4]);
      var tarihB = new Date(b[4]);
      return tarihA - tarihB;
    });

    var firmalarMap = {};
    firmalarVeri.forEach(function(row) {
      var firmaAnahtari = row[0]; // A sütunu
      var kalanVeri = row.slice(1); // B sütunu çıkarıldı
      firmalarMap[firmaAnahtari] = kalanVeri;
    });

    filtrelenmisVeriSon = filtrelenmisVeriSon.map(function(row) {
      var firmaAnahtari = row[0];
      if (firmalarMap[firmaAnahtari]) {
        return row.concat(firmalarMap[firmaAnahtari]);
      } else {
        return row.concat(new Array(firmalarSonSutun - 2).fill('')); // B sütunu çıkarıldığı için -2
      }
    });

    var standartsMap = {};
    standartsVeri.forEach(function(row) {
      standartsMap[row[0]] = row[2];
    });

    filtrelenmisVeriSon = filtrelenmisVeriSon.map(function(row) {
      var anahtarDeger = row[1];
      if (standartsMap[anahtarDeger]) {
        return row.concat(standartsMap[anahtarDeger]);
      } else {
        return row.concat(['']);
      }
    });

    // İlk iki sütunu kaldırmak için slice(2) kullanıyoruz
    filtrelenmisVeriSon = filtrelenmisVeriSon.map(function(row) {
      return row.slice(2);
    });

    var ss = SpreadsheetApp.openById("1YL55VbWBSOL0WPicN67QAtww-Bm_JgGkUS2etpgJeSY");
    var ws = ss.getSheetByName("Sertifikalar");
    var aktifSonSatir = ws.getLastRow();
    if (aktifSonSatir > 0) {
      ws.getRange(1, 1, aktifSonSatir, ws.getLastColumn()).clear();
    }

    if (filtrelenmisVeriSon.length > 0) {
      var hedefHucresi = ws.getRange(1, 1, filtrelenmisVeriSon.length, filtrelenmisVeriSon[0].length);
      hedefHucresi.setValues(filtrelenmisVeriSon);
    }

    return "success";
  } catch (error) {
    throw new Error("Veri işleme hatası: " + (error.message || "Bilinmeyen hata"));
  }
}

function lastTwentyFive(){
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("Sertifika");
  const lastRow = ws.getLastRow();
  
  // Son 25 satırı alabilmek için başlangıç satırını hesapla
  let startRow = lastRow - 25 + 1;
  if(startRow < 2){  // Eğer toplam veri satırı 25'ten az ise, header hariç tüm verileri alıyoruz
    startRow = 2;
  }
  
  const numRows = lastRow - startRow + 1;
  const values = ws.getRange(startRow, 1, numRows, 7).getDisplayValues();
  
  return values;
}

/**
 * 'Testler' sayfasından veri çeker, 'Firmalar' verileriyle birleştirir ve hedefe yazar.
 * 1. N sütunundaki tarih boşsa VEYA 5 yıldan eskiyse W sütununu TRUE olarak günceller. (Tarih formatı sorunları giderildi)
 * 2. W sütununda kutucuk işaretli (TRUE) olan satırları işleme almaz.
 * 3. Çıktının ilk sütununa birleştirme anahtarı olan Firma No'yu ekler.
 */
function testleriCekVeYaz() {
  // --- AYARLAR ---
  const KAYNAK_SHEET_ID = '1FXYQ9S5ZnR1g9fkbxa0sCekJWV_cfy-5cPFojtOfRJs';
  const HEDEF_SHEET_ID = '1m07W0oo7l2Gk6t-p4Q1XEPy92qrWjys6EtlPFlHWL7A';
  
  const KAYNAK_SAYFA_ADI = 'Testler';
  const FIRMALAR_SAYFA_ADI = 'Firmalar';
  const HEDEF_SAYFA_ADI = 'Sayfa1'; 
  // --------------------------------------------------------------------

  try {
    const kaynakSheet = SpreadsheetApp.openById(KAYNAK_SHEET_ID);
    const hedefSheet = SpreadsheetApp.openById(HEDEF_SHEET_ID);

    const veriSheet = kaynakSheet.getSheetByName(KAYNAK_SAYFA_ADI);
    const firmalarSheet = kaynakSheet.getSheetByName(FIRMALAR_SAYFA_ADI);
    const ws = hedefSheet.getSheetByName(HEDEF_SAYFA_ADI);

    const veri = veriSheet.getDataRange().getValues();

    const baslikSatiri = veri[0];
    let veriIcerik = veri.slice(1);
    
    const bugun = new Date();
    const besYilOnce = new Date(bugun.getFullYear() - 5, bugun.getMonth(), bugun.getDate());

    let wSutunuGuncellendi = false;
    veriIcerik.forEach(function(row) {
      let isaretle = false;
      let tarih = null; // Tarih nesnesini tutmak için boş bir değişken
      const hucreDegeri = row[13]; // N sütunundaki ham değer

      // --- DÜZELTME BURADA: Hücredeki değerin türünü kontrol et ---
      if (!hucreDegeri) {
        isaretle = true; // 1. Durum: Hücre boşsa işaretle
      } else if (hucreDegeri instanceof Date) {
        tarih = hucreDegeri; // 2. Durum: Değer zaten bir Tarih Nesnesi ise doğrudan kullan
      } else if (typeof hucreDegeri === 'string' && hucreDegeri.match(/\d{2}\.\d{2}\.\d{4}/)) {
        // 3. Durum: Değer metin ise, Tarih Nesnesi'ne çevir
        const parcalar = hucreDegeri.split('.');
        tarih = new Date(parcalar[2], parcalar[1] - 1, parcalar[0]);
      }
      
      // Eğer geçerli bir tarih nesnesi elde ettiysek, 5 yıl kontrolünü yap
      if (tarih && !isNaN(tarih) && tarih < besYilOnce) {
        isaretle = true;
      }
      // --- DÜZELTME SONU ---
      
      if (isaretle && row[22] !== true) {
        row[22] = true;
        wSutunuGuncellendi = true;
      }
    });

    if (wSutunuGuncellendi) {
      const wSutunuGuncelDegerler = veriIcerik.map(row => [row[22] || false]);
      veriSheet.getRange(2, 23, wSutunuGuncelDegerler.length, 1).setValues(wSutunuGuncelDegerler);
    }
    
    veriIcerik = veriIcerik.filter(row => row[22] !== true);

    const firmalarVeriAraligi = firmalarSheet.getRange(1, 1, firmalarSheet.getLastRow(), 6);
    const firmalarVeri = firmalarVeriAraligi.getValues().map(row => row.filter((_, index) => index !== 1));
    const firmalarMap = {};
    firmalarVeri.slice(1).forEach(row => { firmalarMap[row[0]] = row.slice(1); });

    const istenenSutunIndexleri = [2, 4, 5, 8, 9, 10, 11, 12, 13, 14];
    const filtrelenmisBasliklar = istenenSutunIndexleri.map(index => baslikSatiri[index]);
    
    let filtrelenmisVeri = veriIcerik.map(row => istenenSutunIndexleri.map(index => row[index]));

    let birlesmisVeri = filtrelenmisVeri.map(function(row) {
      const firmaAnahtari = row[0];
      const firmaEkBilgisi = firmalarMap[firmaAnahtari] || new Array(4).fill('');
      return row.concat(firmaEkBilgisi);
    });

    let sonVeri = birlesmisVeri;
    const tamBaslikSatiri = filtrelenmisBasliklar.concat(firmalarVeri[0].slice(1));
    sonVeri.unshift(tamBaslikSatiri);

    ws.clear();
    if (sonVeri.length > 1) {
      ws.getRange(1, 1, sonVeri.length, sonVeri[0].length).setValues(sonVeri);
    }
    
    Logger.log("İşlem başarıyla tamamlandı. Süresi dolan veya tarihi boş olan kayıtlar filtrelendi.");

  } catch (error) {
    Logger.log("Veri işleme hatası: " + error.toString() + "\nSatır: " + error.lineNumber + "\nStack: " + error.stack);
    throw new Error("Veri işleme hatası: " + (error.message || "Bilinmeyen hata"));
  }
}

// *********************************
// **  Trigger için Fonksiyonlar  **
// *********************************

function monthlyCheck() {
  const ss = openTargetSpreadsheet();
  const wsSertifika = ss.getSheetByName("Sertifika");
  const wsConsultants = ss.getSheetByName("Consultants");

  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endDate = new Date(today.getFullYear(), today.getMonth() + 2, 1);

  function parseDate(dateString) {
    const parts = dateString.split(".").map(Number);
    return new Date(parts[2], parts[1] - 1, parts[0]);
  }

  function formatDateToDots(date) {
    return date instanceof Date
      ? ("0" + date.getDate()).slice(-2) + "." + ("0" + (date.getMonth() + 1)).slice(-2) + "." + date.getFullYear()
      : date;
  }

  const consultantsData = {};
  const consultants = wsConsultants.getRange("A2:H" + wsConsultants.getLastRow()).getValues();

  consultants.forEach(row => {
    const name = row[0];
    const firstName = row[4]; // E sütunu - Danışmanın adı
    const fullName = row[4] + ' ' + row[5]; // E sütunu + boşluk + F sütunu
    const title = row[6];
    const email = row[3] || "info@medicert.com.tr";

    if (name) {
      consultantsData[name] = { firstName, fullName, title, email, data: [] };
    }
  });

  const colB = wsSertifika.getRange("B2:B" + wsSertifika.getLastRow()).getValues();
  const colD = wsSertifika.getRange("D2:D" + wsSertifika.getLastRow()).getValues();
  const colF = wsSertifika.getRange("F2:F" + wsSertifika.getLastRow()).getValues();
  const colH = wsSertifika.getRange("H2:H" + wsSertifika.getLastRow()).getValues();
  const colO = wsSertifika.getRange("O2:O" + wsSertifika.getLastRow()).getValues();
  const colQ = wsSertifika.getRange("Q2:Q" + wsSertifika.getLastRow()).getValues();
  const colU = wsSertifika.getRange("U2:U" + wsSertifika.getLastRow()).getValues();
  const colT = wsSertifika.getRange("T2:T" + wsSertifika.getLastRow()).getValues();

  let matchCount = 0;

  for (let i = 0; i < colH.length; i++) {
    const dateStr = colH[i][0];
    const firm = colB[i][0];
    const standard = colD[i][0] === "Other" ? colU[i][0] : colD[i][0];
    const certificateNo = colF[i][0];
    const accreditation = colO[i][0];
    const consultant = colQ[i][0];
    const checkbox = colT[i][0];

    if (dateStr) {
      const date = dateStr instanceof Date ? dateStr : parseDate(dateStr);

      if (date >= startDate && date < endDate && checkbox !== true && consultantsData.hasOwnProperty(consultant)) {
        matchCount++;

        consultantsData[consultant].data.push({
          date: formatDateToDots(date),
          firm: firm,
          consultant: consultantsData[consultant].fullName,
          firstName: consultantsData[consultant].firstName,
          title: consultantsData[consultant].title,
          standard: standard,
          certificateNo: certificateNo,
          accreditation: accreditation
        });
      }
    }
  }

  Logger.log(`Toplam eşleşen satır sayısı: ${matchCount}`);

  Object.values(consultantsData).forEach(({ firstName, fullName, title, email, data }) => {
    if (data.length > 0) {
      sendSurv(firstName, fullName, title, email, data, formatDateToDots(startDate), formatDateToDots(endDate));
      Logger.log(`E-posta gönderildi: ${fullName} (${email}) - Toplam: ${data.length}`);
    }
  });

  Logger.log("İşlem tamamlandı.");
}

function sendSurv(firstName, fullName, title, email, data, startDate, endDate) {
  const template = HtmlService.createHtmlOutputFromFile('sendSurv').getContent();

  let tableRows = "";
  data.forEach(row => {
    tableRows += `<tr>
      <td>${row.date}</td>
      <td>${row.firm}</td>
      <td>${row.consultant}</td>
      <td>${row.standard}</td>
      <td>${row.certificateNo}</td>
      <td>${row.accreditation}</td>
    </tr>`;
  });

  const emailBody = template
    .replace("{{firstName}}", firstName)
    .replace("{{title}}", title)
    .replace("{{startDate}}", startDate)
    .replace("{{endDate}}", endDate)
    .replace("{{tableRows}}", tableRows);

  GmailApp.sendEmail(email, "Gözetim Bilgileri", "", {
    from: "serdaryavuz@medicert.com.tr", // Gönderici adresini belirtiyoruz
    name: "Serdar YAVUZ", // Gönderenin ismi
    htmlBody: emailBody
  });
}

// ********************************
// **  KEK Yazdırma Çalışmaları  **
// ********************************

function returnDocuments(){ 
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("SysDoc");
  return ws.getRange(2,1,ws.getLastRow()-1,6).getValues(); 
}

function returnDocSelect() {
  const ss = openTargetSpreadsheet();
  const ws = ss.getSheetByName("SysDoc");

  const rawValues = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues();
  const uniqueValues = [...new Set(rawValues.flat())];

  return uniqueValues; // örn: ["Deneme", "Makine"]
}

function createDocumentSetProgressive(data) {
  const allTemplates = returnDocuments();
  const filteredRows = allTemplates.filter(row => row[0] === data.setName && row[5]);

  if (filteredRows.length === 0) {
    throw new Error(`"${data.setName}" setine ait geçerli bir belge bulunamadı.`);
  }

  // 🔧 Klasörler tek seferde oluşturulsun
  prepareDocumentFolders(filteredRows, data.nick);

  return filteredRows; // Geriye sade liste dön, createSingleDocument bunları işlesin
}