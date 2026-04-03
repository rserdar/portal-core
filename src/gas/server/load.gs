/**
*  ,---,---,---,---,---,---,---,---,---,---,---,---,---,-------,                         \||/
*  |1/2| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 0 | + | ' | <-    |                         |  @___oo
*  |---'-,-'-,-'-,-'-,-'-,-'-,-'-,-'-,-'-,-'-,-'-,-'-,-'-,-----|               /\  /\   / (__,,,,|
*  | ->| | Q | W | E | R | T | Y | U | I | O | P | ] | ^ |     |              ) /^\) ^\/ _)
*  |-----',--',--',--',--',--',--',--',--',--',--',--',--'|    |              )   /^\/   _)
*  | Caps | A | S | D | F | G | H | J | K | L | \ | [ | * |    |              )   _ /  / _)
*  |----,-'-,-'-,-'-,-'-,-'-,-'-,-'-,-'-,-'-,-'-,-'-,-'---'----|          /\  )/\/ ||  | )_)
*  |    | < | Z | X | C | V | B | N | M | , | . | - |          |         <  >      |(,,) )__)
*  |----'-,-',--'--,'---'---'---'---'---'---'-,-'---',--,------|          ||      /    \)___)\
*  | ctrl |  | alt |                          |altgr |  | ctrl |          | \____(      )___) )___
*  '------'  '-----'--------------------------'------'  '------'           \______(_______;;; __;;;
*
* 🎯 Drive Dosyası ID: 1nWI7JukJNKmcz9RDsnVbS438S2R1DkBROfiZTM9DM_w
*
* 🗓️  Denetim Takvimi: ukqd4fqmgujdhemc4slhmebgcc@group.calendar.google.com
* 🗓️  Gözetim Takvimi: d43d3fe59ccf1ff2e9ef23eb1fcbec9e8caf68568b733e3f9e8c8bc53d91c09e@group.calendar.google.com
* 🗓️    Arşiv Takvimi: b5768ed3d388c17023448785350956fd1dbe2987eaaf4362d2e1c7d5f5627746@group.calendar.google.com
*/


function doGet() {                                                            
  const userEmail = Session.getEffectiveUser().getEmail(); // Kullanıcının e-posta adresini al
  return serveHtml(userEmail); // HTML içeriğini döndüren fonksiyonu çağır
}

function serveHtml(email) {
  const authorizedEmails = ["r.serdar@gmail.com", "medicertbelge@gmail.com"]; // Yetkili kullanıcıların e-posta adresleri
  const templateFile = authorizedEmails.includes(email) ? "main" : "other"; // Kullanıcı yetkisine göre HTML dosyasını seç

  const htmlService = HtmlService.createTemplateFromFile(templateFile)
    .evaluate()
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0"); // Meta etiketi ekle

  return htmlService; // HTML içeriğini döndür
}

function convertFilesToPdfPro() {
  // --- AYARLAR ---
  const FOLDER_ID = "1_6as2_hTMx7LZ6mpICmVEt5fGQowGXyR"; 
  const PDF_FOLDER_NAME = "PDF";
  // ----------------
  
  const stats = { created: 0, updated: 0, skipped: 0, errors: 0 };

  try {
    const sourceFolder = DriveApp.getFolderById(FOLDER_ID);
    
    // PDF klasörünü bul veya oluştur
    let pdfFolder;
    const folderIter = sourceFolder.getFoldersByName(PDF_FOLDER_NAME);
    pdfFolder = folderIter.hasNext() ? folderIter.next() : sourceFolder.createFolder(PDF_FOLDER_NAME);

    // Mevcut PDF'leri hafızaya al (Dosya Adı -> Dosya Objesi eşleşmesi)
    // Bu sayede her seferinde tekrar tekrar arama yapmayız (Performans artışı)
    const existingPdfs = {};
    const pdfFiles = pdfFolder.getFiles();
    while (pdfFiles.hasNext()) {
      const p = pdfFiles.next();
      existingPdfs[p.getName()] = p;
    }

    const files = sourceFolder.getFiles();

    while (files.hasNext()) {
      const file = files.next();
      
      // Çöp kutusundaki dosyaları atla
      if (file.isTrashed()) continue;

      const fileName = file.getName();
      const pdfName = fileName + ".pdf";
      const mimeType = file.getMimeType();

      // Sadece desteklenen formatlar
      if (mimeType === MimeType.GOOGLE_DOCS || 
          mimeType === MimeType.GOOGLE_SHEETS || 
          mimeType === MimeType.GOOGLE_SLIDES) {

        try {
          // KONTROL: Bu dosyanın PDF'i zaten var mı?
          if (existingPdfs[pdfName]) {
            const existingPdf = existingPdfs[pdfName];
            
            // Tarih Kontrolü: Kaynak dosya, mevcut PDF'ten daha mı yeni?
            const sourceLastUpdated = file.getLastUpdated().getTime();
            const pdfLastCreated = existingPdf.getLastUpdated().getTime(); // Created yerine Updated kullanıyoruz ki manuel değişiklikleri de görelim

            if (sourceLastUpdated > pdfLastCreated) {
              // Kaynak daha yeni, PDF'i güncelle (Eskisini sil, yenisini koy)
              existingPdf.setTrashed(true); // Eskiyi çöpe at
              const newPdf = file.getAs(MimeType.PDF).setName(pdfName);
              pdfFolder.createFile(newPdf);
              console.log(`[GÜNCELLENDİ] ${fileName}`);
              stats.updated++;
            } else {
              // Değişiklik yok, pas geç
              // console.log(`[ATLANDI] ${fileName} (Güncel)`); // Konsolu kirletmemek için kapalı
              stats.skipped++;
            }
          } else {
            // PDF hiç yok, yeni oluştur
            const newPdf = file.getAs(MimeType.PDF).setName(pdfName);
            pdfFolder.createFile(newPdf);
            console.log(`[OLUŞTURULDU] ${fileName}`);
            stats.created++;
          }

        } catch (err) {
          // Döngü içi hata yakalama (Tek bir dosya bozuksa diğerlerini etkilemesin)
          console.error(`[HATA] ${fileName} dönüştürülemedi: ${err.message}`);
          stats.errors++;
        }
      }
    }

    // SONUÇ RAPORU
    console.log(`
    --------------------------------
    İŞLEM ÖZETİ:
    ✅ Yeni Oluşturulan : ${stats.created}
    🔄 Güncellenen      : ${stats.updated}
    ⏭️  Atlanan (Güncel) : ${stats.skipped}
    ❌ Hatalı           : ${stats.errors}
    --------------------------------
    `);

  } catch (e) {
    console.error("Ana klasör hatası: " + e.toString());
  }
}

function pdfRaspiToplu() {
  // --- AYARLAR ---
  const FOLDER_ID = "1cASVMvYQK16GGMT3ezBqjUvfiWPgcIz8"; 
  const PDF_FOLDER_NAME = "PDF"; 
  
  // YENİ AYARLAR
  const MOLA_HER_KAÇ_DOSYADA = 5;  // Her 5 dosyada bir...
  const MOLA_SÜRESİ = 10000;       // ...10 saniye bekle (milisaniye)
  const TOPLAM_İŞLEM_LİMİTİ = 25;  // Tek seferde en fazla kaç dosya yapsın? (6 dk süresine sığması için 25 ideal)
  // ----------------

  let processedCount = 0;

  try {
    const sourceFolder = DriveApp.getFolderById(FOLDER_ID);
    
    // PDF klasörünü ayarla
    let pdfFolder;
    const folderIter = sourceFolder.getFoldersByName(PDF_FOLDER_NAME);
    pdfFolder = folderIter.hasNext() ? folderIter.next() : sourceFolder.createFolder(PDF_FOLDER_NAME);

    // Mevcutları hafızaya al
    const existingPdfs = {};
    const pdfFiles = pdfFolder.getFiles();
    while (pdfFiles.hasNext()) {
      existingPdfs[pdfFiles.next().getName()] = true;
    }

    const files = sourceFolder.getFiles();
    
    console.log(`🚀 Yönetici çalıştı. Bu turda Hedef: ${TOPLAM_İŞLEM_LİMİTİ} dosya.`);

    while (files.hasNext()) {
      // Toplam güvenli limite ulaştıysak dur (Script zaman aşımına uğramasın)
      if (processedCount >= TOPLAM_İŞLEM_LİMİTİ) {
        console.log(`🛑 Bu turluk yeterli (${processedCount} adet yapıldı). Kalanlar bir sonraki tetiklemede.`);
        break;
      }

      const file = files.next();
      
      if (file.isTrashed() || file.getMimeType() !== MimeType.GOOGLE_DOCS) continue;

      const docName = file.getName();
      const targetPdfName = docName + ".pdf";

      // Zaten varsa atla
      if (existingPdfs[targetPdfName]) continue; 

      try {
        console.log(`Processing (${processedCount + 1}/${TOPLAM_İŞLEM_LİMİTİ}): ${docName}`);
        
        // --- İŞÇİYİ ÇAĞIR ---
        const result = processDocToFitPdf(file.getId());

        if (result.success) {
          // PDF klasörüne taşı
          const createdFiles = sourceFolder.getFilesByName(targetPdfName);
          if (createdFiles.hasNext()) {
            createdFiles.next().moveTo(pdfFolder);
          }
          
          processedCount++;

          // --- MOLA MANTIĞI ---
          // Eğer işlenen sayı 5'in katıysa (5, 10, 15, 20...)
          if (processedCount % MOLA_HER_KAÇ_DOSYADA === 0) {
             console.log(`☕ ${MOLA_HER_KAÇ_DOSYADA} dosya tamamlandı. ${MOLA_SÜRESİ/1000} saniye mola veriliyor...`);
             Utilities.sleep(MOLA_SÜRESİ); // 10 Saniye bekle
          } else {
             // Normal aralık (Her dosya arası 1 saniye)
             Utilities.sleep(1000); 
          }
        }

      } catch (err) {
        console.error(`❌ HATA: ${docName} - ${err.message}`);
      }
    }

    if (processedCount === 0) {
      console.log("✅ İşlenecek yeni dosya yok.");
    } else {
      console.log(`🏁 Tur bitti. Toplam ${processedCount} dosya işlendi.`);
    }

  } catch (e) {
    console.error("Yönetici Hatası: " + e.toString());
  }
}

function testMySQLConnection() {
  const conn = Jdbc.getConnection(
    'jdbc:mysql://85.95.231.46:3306/elvanink_deneme',
    'elvanink__LMa3FNVwgfJuD6_D6sBNVw',
    '7d8yCqRJ2Sy8pkWc9WGp'  // eğer güncel şifren buysa
  );

  try {
    const stmt = conn.createStatement();
    const rs = stmt.executeQuery("SELECT NOW() AS zaman");

    while (rs.next()) {
      Logger.log("✅ Bağlantı başarılı! Sunucu zamanı: " + rs.getString("zaman"));
    }

    rs.close();
    stmt.close();
    conn.close();
  } catch (e) {
    Logger.log("❌ Hata oluştu: " + e.message);
  }
}

function triggerHomeAssistant() {
  var url = "https://ev.serdar.cc/api/webhook/-MJoN237LLEuJrxth0Zrq39i0"; // Webhook URL
  
  var options = {
    "method": "post", // POST isteği yap
    "muteHttpExceptions": true // Hataları sessizce geç
  };
  
  var response = UrlFetchApp.fetch(url, options);
  Logger.log(response.getContentText()); // Yanıtı konsola yazdır
}

function logTestVeri(testId = "905", lang = "TR", folderId = "1Zs8mf2mNsZojHN0hMy7oVsGKZd0tYhZ9") {
   try {
        Logger.log(`📢 Test ID: ${testId} için veri çekiliyor...`);
        
        // testVeri fonksiyonunu çağır ve sonucu al
        const testData = testVeri(testId, lang);

        if (!testData) {
            Logger.log("❌ HATA: testVeri() geçersiz veri döndürdü!");
            return;
        }

        Logger.log("✅ Test Verisi Başarıyla Alındı:");
        Logger.log(JSON.stringify(testData, null, 2)); // JSON formatında güzel log
        
        if (typeof testBas === "undefined") {
            Logger.log("❌ HATA: testBas() TANIMLANMAMIŞ!");
            return;
        }

        Logger.log(`🎯 Test verisi başarıyla alındı, testBas() fonksiyonuna gönderiliyor...`);
        
        // **testBas fonksiyonuna testData'yı STRING olarak gönderiyoruz**
        testBas(JSON.stringify(testData), folderId);

    } catch (error) {
        Logger.log(`❌ Hata oluştu: ${error.message}`);
    }
}

function testEditCertificateById() {
  // Test verileri
  const testCrtInfo = {
    nick: "5s Otomotiv",
    other: "İSOT 900153",
    standart: "Diğer",
    dan: "Yusuf Aslan",
    goz: "22.01.2025",
    cal: null // İlk başta null (ID boş)
  };

  // Test edilecek ID
  const testId = 1;

  try {
    // editCertificateById fonksiyonunu çağır
    const result = editCertificateById(testId, testCrtInfo);

    // Başarıyla tamamlandıysa sonuçları kontrol et
    if (result) {
      Logger.log("Test başarılı: Sertifika başarıyla düzenlendi.");
    } else {
      Logger.log("Test başarısız: Sertifika düzenleme işlemi beklenmedik şekilde tamamlanamadı.");
    }
  } catch (error) {
    // Hata durumunda log kaydı
    Logger.log(`Test sırasında hata oluştu: ${error.message}`);
  }
}

function normalizeyitest (){
  const serdar = normalizeString("Diğer")
  Logger.log(serdar)
}

function testdeneme (){
Logger.log(testVeri("959", "TR"));
}

function testImageAccess() {
  try {
    var file = DriveApp.getFileById("1ax55_p21F3abrRUhfEvqLU8Le-vKuSSv"); // Buraya hata aldığınız görsel ID'sini girin
    Logger.log("✅ Görsel dosya adı: " + file.getName());
  } catch (error) {
    Logger.log("❌ Hata: " + error.message);
  }
}

function testGetCompanyById() {
    const testId = 1557; // Hata veren ID
    const result = getCompanyById(testId);

    Logger.log("Test edilen ID: " + testId);
    if (result === null) {
        Logger.log("HATA: ID bulunamadı!");
    } else {
        Logger.log("Sonuç: " + JSON.stringify(result, null, 2));
    }
}


function debugRowById() {
    const id = 1557; // ✅ BURAYA HATA VEREN ID'Yİ YAZ
    const ss = SpreadsheetApp.openById("1nWI7JukJNKmcz9RDsnVbS438S2R1DkBROfiZTM9DM_w");
    const ws = ss.getSheetByName("Firmalar");

    const lastRow = ws.getLastRow();
    Logger.log("🔍 Son Satır: " + lastRow);

    const comIds = ws.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < comIds.length; i++) {
        const cellValue = comIds[i][0];
        Logger.log(`Row ${i + 2}: "${cellValue}" (${typeof cellValue})`);

        if (cellValue && cellValue.toString().toLowerCase() === id.toString().toLowerCase()) {
            Logger.log("✅ Eşleşme bulundu: Satır " + (i + 2));
            const companyInfo = ws.getRange(i + 2, 1, 1, 40).getValues()[0];
            Logger.log("🟢 Satır Verisi: " + JSON.stringify(companyInfo));
            return companyInfo;
        }
    }

    Logger.log("❌ Eşleşme bulunamadı!");
    return null;
}

function tetikleSertifika() {
  const basTar = "01.01.2025";
  const bitTar = "24.02.2025";
  const dan = "erol";

  testSertifikaVePDF(basTar, bitTar, dan);
}

function testSertifikaVePDF(basTar, bitTar, dan) {
  const ss = SpreadsheetApp.openById("1nWI7JukJNKmcz9RDsnVbS438S2R1DkBROfiZTM9DM_w");
  const wsSertifika = ss.getSheetByName("Sertifika");
  const wsConsultants = ss.getSheetByName("Consultants");

  // ➡️ Tarihleri Date objesine dönüştürme
  function parseDate(dateString) {
    const parts = dateString.split(".").map(Number);
    return new Date(parts[2], parts[1] - 1, parts[0]);
  }

  const startDate = parseDate(basTar);
  const endDate = parseDate(bitTar);

  function formatDateToDots(date) {
    return date instanceof Date
      ? ("0" + date.getDate()).slice(-2) + "." + ("0" + (date.getMonth() + 1)).slice(-2) + "." + date.getFullYear()
      : date;
  }

  // ➡️ Danışmanı bulma (Row 7'de Dan değerini arar, Row 0'dan tam adını alır)
  const consultants = wsConsultants.getRange("A2:H" + wsConsultants.getLastRow()).getValues();
  let consultantData = {
    firstName: "",
    fullName: "",
    title: "",
    data: []
  };

  for (let row of consultants) {
    if (row[7] && row[7].toString().toLowerCase() === dan.toLowerCase()) {
      consultantData.firstName = row[4];
      consultantData.fullName = row[0];
      consultantData.title = row[6];
      break;
    }
  }

  if (!consultantData.fullName) {
    Logger.log(`Danışman '${dan}' bulunamadı.`);
    return null;
  } else {
    Logger.log(`Danışman bulundu: ${consultantData.fullName}`);
  }

  // ➡️ Sertifikaları Arama
  const colB = wsSertifika.getRange("B2:B" + wsSertifika.getLastRow()).getValues(); // Firma
  const colD = wsSertifika.getRange("D2:D" + wsSertifika.getLastRow()).getValues(); // Standart
  const colF = wsSertifika.getRange("F2:F" + wsSertifika.getLastRow()).getValues(); // Sertifika No
  const colH = wsSertifika.getRange("H2:H" + wsSertifika.getLastRow()).getValues(); // Tarih
  const colQ = wsSertifika.getRange("Q2:Q" + wsSertifika.getLastRow()).getValues(); // Danışman adı

  for (let i = 0; i < colH.length; i++) {
    const dateStr = colH[i][0];
    const firm = colB[i][0];
    const standard = colD[i][0];
    const certificateNo = colF[i][0];
    const consultant = colQ[i][0];

    if (dateStr && consultant === consultantData.fullName) {
      const date = dateStr instanceof Date ? dateStr : parseDate(dateStr);

      if (date >= startDate && date <= endDate) {
        consultantData.data.push({
          date: formatDateToDots(date),
          firm: firm,
          consultant: consultant,
          standard: standard,
          certificateNo: certificateNo,
          accreditation: "-"
        });
      }
    }
  }

  // ➡️ PDF Oluşturma ve Kaydetme
  if (consultantData.data.length > 0) {
    const pdfUrl = createPDF(consultantData, basTar, bitTar);
    Logger.log(`PDF oluşturuldu ve kaydedildi: ${pdfUrl}`);
  } else {
    Logger.log("Veri bulunamadı, PDF oluşturulmadı.");
  }
}

function createPDF(data, startDate, endDate) {
  const template = HtmlService.createHtmlOutputFromFile('sertTablo').getContent();

  let tableRows = "";
  data.data.forEach(row => {
    tableRows += `<tr>
      <td>${row.date}</td>
      <td>${row.firm}</td>
      <td>${row.consultant}</td>
      <td>${row.standard}</td>
      <td>${row.certificateNo}</td>
      <td>${row.accreditation}</td>
    </tr>`;
  });

  const htmlContent = template
    .replace("{{firstName}}", data.firstName)
    .replace("{{title}}", data.title)
    .replace("{{startDate}}", startDate)
    .replace("{{endDate}}", endDate)
    .replace("{{tableRows}}", tableRows);

  const htmlOutput = HtmlService.createHtmlOutput(htmlContent);
  const blob = htmlOutput.getBlob().getAs('application/pdf').setName(`Sertifika_Raporu_${data.firstName}.pdf`);

  // PDF'i Google Drive'a kaydet
  const folder = DriveApp.getFolderById("1SS_iLeoXzPYVPni-agYGr0RmrdNAg0mb");
  const file = folder.createFile(blob);

  return file.getUrl();
}