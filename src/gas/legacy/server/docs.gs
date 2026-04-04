// Ay isimlerini dil desteğiyle döndüren yardımcı fonksiyon
function sertifikaDate(tarih, lang) {
  const nfdate = tarih.split(".");
  const monthNames = {
    EN: ["Jan.", "Feb.", "Mar.", "Apr.", "May.", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."],
    TR: ["Oca.", "Şub.", "Mar.", "Nis.", "May.", "Haz.", "Tem.", "Ağu.", "Eyl.", "Eki.", "Kas.", "Ara."]
  };

  const ayisim = monthNames[lang]?.[parseInt(nfdate[1], 10) - 1] || "Invalid Date";
  return `${ayisim} ${nfdate[0]}, ${nfdate[2]}`;
}

function testTarihString(isoString, format, timeZone) {
  if (!isoString || typeof isoString !== 'string') {
    // console.warn("testTarihString: Geçersiz veya eksik isoString:", isoString);
    return ""; // Veya uygun bir varsayılan değer
  }
  try {
    const date = new Date(isoString);
    // Tarih nesnesinin geçerli olup olmadığını kontrol et
    if (isNaN(date.getTime())) {
      // console.warn("testTarihString: Geçersiz tarih nesnesi oluşturuldu:", isoString);
      return isoString; // Başarısız olursa orijinal string'i döndür
    }
    const tz = timeZone || Session.getScriptTimeZone();
    return Utilities.formatDate(date, tz, format);
  } catch (e) {
    console.error("testTarihString Hata:", e.message, "Giriş Değeri:", isoString, "İstenen Format:", format);
    return isoString; // Hata durumunda orijinal string'i döndür
  }
}

// Yazıyı resimle değiştiren yardımcı fonksiyon
function replaceTextToImage(body, searchText, image, height) {
  try {
    var next = body.findText(searchText);
    if (!next) return `Metin "${searchText}" bulunamadı.`;

    var r = next.getElement();
    if (r.getType() === DocumentApp.ElementType.TEXT) {
      r.asText().setText("");
    }

    // Doğrudan paragraf olarak işlem yapmayı dene
    try {
      var img = r.getParent().asParagraph().insertInlineImage(0, image);
    } catch (error) {
      throw new Error("Metin bir paragrafta bulunmuyor veya görsel eklenemedi.");
    }

    if (height && typeof height == "number") {
      var w = img.getWidth();
      var h = img.getHeight();
      if (w > 0 && h > 0) {
        img.setHeight(height);
        img.setWidth((height * w) / h);
      } else {
        throw new Error("Görselin boyutları geçersiz.");
      }
    }

    return `Metin "${searchText}" görselle değiştirildi.`;
  } catch (error) {
    return `Hata: ${error.message}`;
  }
}

//QR Kod oluşturan yardımcı fonksiyon
function generateAndReplaceQrCode(doc, qrLink) {
  try {
    if (!qrLink) throw new Error("QR kod bağlantısı boş!");

    // Body ve Footer'ı al
    const body = doc.getBody();
    const footer = doc.getFooter();

    if (!body) throw new Error("Belgenin gövde bölümü bulunamadı!");

    let paragraph;
    let isInsideTable = false;

    // **Önce Gövdede `{{QrKod}}` Ara**
    let range = body.findText("{{QrKod}}");

    if (!range && footer) {
      // **Eğer gövdede yoksa, footer içinde `{{QrKod}}` ara**
      range = footer.findText("{{QrKod}}");
    }

    if (range) {
      let element = range.getElement();
      let parent = element.getParent();

      // **Eğer `{{QrKod}}` gövdedeki bir tablo içindeyse, inline ekleyelim**
      if (parent.getType() === DocumentApp.ElementType.TABLE_CELL) {
        let tableCell = parent.asTableCell();
        tableCell.clear(); // `{{QrKod}}` metnini sil
        paragraph = tableCell.appendParagraph(""); // Yeni bir paragraf ekle
        isInsideTable = true;
      } else {
        // **Eğer footer’da veya gövdede normal bir paragraftaysa, direkt işlem yap**
        paragraph = parent;
        element.asText().deleteText(range.getStartOffset(), range.getStartOffset() + "{{QrKod}}".length - 1);
      }
    } else {
      // **Eğer `{{QrKod}}` hem gövdede hem footer’da yoksa hata ver**
      throw new Error("Belgede `{{QrKod}}` bulunamadı!");
    }

    // **QR Kod oluştur**
    const qrCodeBlob = UrlFetchApp.fetch(`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(qrLink)}`).getBlob();
    if (!qrCodeBlob) throw new Error("QR kod oluşturulamadı!");

    if (isInsideTable) {
      // **Eğer QR kod gövdedeki bir tablo içindeyse, inline olarak ekleyelim**
      paragraph.insertInlineImage(0, qrCodeBlob);
    } else {
      // **Eğer footer'da veya gövdede normal bir paragraftaysa, normal hizalama kullan**
      const img = paragraph.addPositionedImage(qrCodeBlob);

      img.setLayout(DocumentApp.PositionedLayout.ABOVE_TEXT)
        .setLeftOffset(509)  // 18 cm sağa kaydır
        .setTopOffset(6)     // 0.2 cm aşağı kaydır
        .setWidth(90)
        .setHeight(90);
    }

  } catch (error) {
    throw new Error(`❌ Hata: ${error.message}`);
  }
}

function isoBas(certificate, folderId) {
  // 1. Destructuring ile tüm alanları al
  const { 
    nick: isim, id, standard, sNo, sTarihi, sGozetimT, sTT, sGT, 
    sKapsam, sScope, logo, nace, akrn: akreditasyon, not, other, 
    unvan, adres, il, ulke, sube, trtema, entema, lang, select, qrLink 
  } = certificate;

  // 2. Yıl Klasörü Yönetimi (Dinamik Arşivleme)
  let targetFolder;
  try {
    const parentFolder = DriveApp.getFolderById(folderId); // ilkKarekter'den gelen ana firma klasörü
    // sTarihi formatı "19.01.2026" ise [2] indeksi 2026'yı verir.
    const yil = (sTarihi && sTarihi.includes(".")) ? sTarihi.split(".")[2] : "Diger";
    
    const yearFolders = parentFolder.getFoldersByName(yil);
    targetFolder = yearFolders.hasNext() ? yearFolders.next() : parentFolder.createFolder(yil);
  } catch (e) {
    // Klasör erişiminde bir sorun olursa ana klasöre güvenli dönüş yap
    targetFolder = DriveApp.getFolderById(folderId);
    console.error("Yıl klasörü oluşturulamadı, ana klasör kullanılıyor: " + e.message);
  }

  // 3. Tarih Formatlama ve Şablon Seçimi
  const xBelgeT = sertifikaDate(sTarihi, lang);
  const xGozT = sertifikaDate(sGozetimT, lang);
  const xDenT = sertifikaDate(sGT, lang);
  const xilkT = sertifikaDate(sTT, lang);

  const tempId = lang === "EN" ? entema : trtema;
  const docTemp = DriveApp.getFileById(tempId);

  // 4. Akreditasyon ve Standart Formatlama
  const akreditasyonFormatted = (akreditasyon === "Non-Acc" || akreditasyon === "NA") ? "" : akreditasyon;
  const standartFormatted = (standard === "Diğer") ? other : standard;

  // 5. Dosya Adı Oluşturma ve Kopyalama
  // Gereksiz boşlukları temizler (trim ve regex ile)
  let fileName = lang === "EN"
    ? `${isim} - ${akreditasyonFormatted} ${standartFormatted} (M${id})`
    : `${isim} - ${akreditasyonFormatted} ${standartFormatted} ${lang} (M${id})`;
  fileName = fileName.replace(/\s+/g, ' ').trim();

  const copy = docTemp.makeCopy(fileName, targetFolder);
  const doc = DocumentApp.openById(copy.getId());
  const body = doc.getBody();

  // 6. Şablon İçeriğini Doldur (Toplu Replace)
  const replacements = {
    "{{Unvan}}": unvan,
    "{{Adres}}": adres,
    "{{Sehir}}": il,
    "{{Ulke}}": ulke,
    "{{Nace}}": nace || "",
    "{{Sno}}": sNo,
    "{{BelgeT}}": xBelgeT,
    "{{GozT}}": xGozT,
    "{{DenT}}": xDenT,
    "{{ilkT}}": xilkT,
    "{{Kapsam}}": sKapsam || "",
    "{{Scope}}": sScope || ""
  };

  for (let key in replacements) {
    body.replaceText(key, replacements[key] || "");
  }

  // Standard "Diğer" kontrolü
  if (standard === "Diğer") {
    body.replaceText("{{Standart}}", other);
    body.replaceText("{{aStandart}}", not);
  }

  // 7. Logo Ekleme
  if (logo) {
    try {
      var file = DriveApp.getFileById(logo);
      var mimeType = file.getMimeType();
      if (mimeType.startsWith("image/")) {
        var imageBlob = file.getBlob();
        replaceTextToImage(body, "{{Logo}}", imageBlob, 57);
      }
    } catch (error) {
      body.replaceText("{{Logo}}", "");
    }
  } else {
    body.replaceText("{{Logo}}", "");
  }

  // 8. İmza Ekleme
  if (select === "S") {
    try {
      var file = DriveApp.getFileById("1gm13q_8COlPybuOrhWGP-H7LXfKIRoF1");
      var imageBlob = file.getBlob();
      replaceTextToImage(body, "{{Sign}}", imageBlob, 48);
    } catch (error) {
      body.replaceText("{{Sign}}", "");
    }
  } else {
    body.replaceText("{{Sign}}", "");
  }

  // 9. QR Kod Ekleme
  if (qrLink) {
    generateAndReplaceQrCode(doc, qrLink);
  }

  // 10. Şube Bilgisi ve Paragraf Temizliği
  if (sube) {
    body.replaceText("{{Sube}}", `Branch: ${sube}`);
  } else {
    let foundElement = body.findText("{{Sube}}");
    while (foundElement != null) {
      const foundText = foundElement.getElement().asText();
      const paragraph = foundText.getParent();
      try {
        paragraph.removeFromParent();
      } catch (err) {
        body.appendParagraph('');
      }
      foundElement = body.findText("{{Sube}}");
    }
  }

  // Değişiklikleri kaydet
  doc.saveAndClose();
}

function testBas(testverisi, folderId) {
  if (typeof testverisi !== 'object' || testverisi === null || !folderId) {
    console.error("testBas Hata: Gerekli parametreler eksik, null veya hatalı tip.", testverisi, folderId);
    throw new Error("Gerekli parametreler eksik, null veya hatalı tip.");
  }

  let {
    fnick = "", fno = "", testadi = "", testname = "", urunkod = "", lang = "TR",
    entema = "", trtema = "", raporno = "", unvan = "", adres = "", sehir = "",
    ulke = "", marka = "", urun = "", lot = "", urunno = "",
    testba = "", testbi = "", kabultarih = "", raportarihi = "", kabulsaat = "",
    numunesay = "", numuneskt = "", numuneut = "",
    urunbilgi = "", detay = "", gorselbir = "", gorseliki = "", testisim = ""
  } = testverisi;

  if (lang !== "TR" && lang !== "EN") {
    console.warn(`[testBas] Geçersiz dil kodu: ${lang}. Varsayılan olarak 'TR' kullanılacak.`);
    lang = "TR";
  }
  console.log("[testBas] Fonksiyon başlatıldı. Dil:", lang, "Gelen raporno:", raporno);

  const targetDateFormat = "dd.MM.yyyy"; // sertifikaDate'in beklediği format
  const targetTimeFormat = "HH:mm";
  const scriptTimeZone = Session.getScriptTimeZone();

  // ISO string'leri dd.MM.yyyy veya HH:mm formatına çevirmek için YENİ ADIYLA testTarihString kullanılıyor
  const formattedTestba = testTarihString(testba, targetDateFormat, scriptTimeZone);
  const formattedTestbi_ddMMyyyy = testTarihString(testbi, targetDateFormat, scriptTimeZone); // <<printdate>> için bu kullanılacak
  const formattedKabultarih = testTarihString(kabultarih, targetDateFormat, scriptTimeZone);
  const formattedRaportarihi = testTarihString(raportarihi, targetDateFormat, scriptTimeZone);
  const formattedNumuneskt = testTarihString(numuneskt, targetDateFormat, scriptTimeZone);
  const formattedNumuneut = testTarihString(numuneut, targetDateFormat, scriptTimeZone);
  const formattedKabulsaat = testTarihString(kabulsaat, targetTimeFormat, scriptTimeZone);
  
  console.log(`[testBas] ISO'dan dd.MM.yyyy'ye çevrilen testbi: ${formattedTestbi_ddMMyyyy}`);

  const tempId = lang === "EN" ? entema : trtema;
  if (!tempId) {
    console.error("testBas Hata: Örnek Test Dosyası (tempId) eksik. Dil:", lang, "EN Tema:", entema, "TR Tema:", trtema);
    throw new Error("Örnek Test Dosyası (tempId) eksik. Geçerli dilde test olmayabilir.");
  }

  try {
    const docTemp = DriveApp.getFileById(tempId);
    const folder = DriveApp.getFolderById(folderId);
    const docName = lang === "EN"
      ? `${fnick} - ${urunkod} - ${testname} EN (M${fno})`
      : `${fnick} - ${urunkod} - ${testadi} (M${fno})`;
    
    const copy = docTemp.makeCopy(docName, folder);
    const doc = DocumentApp.openById(copy.getId());

    const header = doc.getHeader();
    if (header) header.replaceText("<<RaporNo>>", raporno || "");
    const footer = doc.getFooter();
    if (footer) footer.replaceText("<<RaporNo>>", raporno || "");
    
    const body = doc.getBody();
    const replacements = {
      "<<FirmaAdi>>": unvan, "<<Adres>>": adres, "<<Sehir>>": sehir, "<<Ulke>>": ulke,
      "<<Marka>>": marka, "<<Urun>>": urun, "<<Lot>>": lot, "<<UrunNo>>": urunno,
      "<<RaporNo>>": raporno,
      "<<TestBa>>": formattedTestba,
      "<<TestBi>>": formattedTestbi_ddMMyyyy, // Diğer yerlerde dd.MM.yyyy formatı istenebilir
      "<<UrunKabul>>": formattedKabultarih,
      "<<RaporTarih>>": formattedRaportarihi,
      "<<FirmaNick>>": fnick,
      "<<Saat>>": formattedKabulsaat,
      "<<Adet>>": numunesay,
      "<<SKT>>": formattedNumuneskt,
      "<<UT>>": formattedNumuneut,
      "<<UrunBilgi>>": urunbilgi,
      "<<UrunDetay>>": detay
    };

    for (const key in replacements) {
      const valueToReplace = replacements[key] !== null && typeof replacements[key] !== 'undefined' ? String(replacements[key]) : "";
      body.replaceText(key, valueToReplace);
    }

    if (gorselbir) {
      try {
        const imgId = gorselbir.toLowerCase() === "demo" ? "1KPC13vmsRzBt522EQOwNcyIDgMlWZeZd" : gorselbir;
        const image1 = DriveApp.getFileById(imgId).getBlob();
        while (body.findText("<<Görsel1>>")) replaceTextToImage(body, "<<Görsel1>>", image1, 208);
      } catch (e) { console.error("[testBas] Görsel 1 işlenirken hata:", e.message); }
    }

    if (gorseliki) {
      try {
        const imgId = gorseliki.toLowerCase() === "demo" ? "1KPC13vmsRzBt522EQOwNcyIDgMlWZeZd" : gorseliki;
        const image2 = DriveApp.getFileById(imgId).getBlob();
        while (body.findText("<<Görsel2>>")) replaceTextToImage(body, "<<Görsel2>>", image2, 208);
      } catch (e) { console.error("[testBas] Görsel 2 işlenirken hata:", e.message); }
    }

    if (testisim === "LVD Testi") {
      // Sizin sertifikaDate fonksiyonunuz çağrılıyor.
      // Girdi olarak dd.MM.yyyy formatındaki formattedTestbi_ddMMyyyy kullanılıyor.
      const printDateValue = sertifikaDate(formattedTestbi_ddMMyyyy, lang); 
      body.replaceText("<<printdate>>", printDateValue);
      console.log(`[testBas] LVD Testi için <<printdate>> değiştirildi: ${printDateValue} (girdi: ${formattedTestbi_ddMMyyyy}, dil: ${lang})`);
    }
    
    doc.saveAndClose();
    console.log("[testBas] Doküman başarıyla oluşturuldu ve kaydedildi.");

  } catch (error) {
    console.error("[testBas] KRİTİK HATA: Belge oluşturulurken hata oluştu:", error.message, error.stack);
    throw new Error("Belge oluşturulurken bir sunucu hatası oluştu: " + error.message);
  }
}

function basFormu(companyInfo) {
  const isim = companyInfo.nickname;
  const id = companyInfo.id;
  const folderId = ilkKarekter(isim);

  // nbody değerine göre şablon dosyasını seç
  let docTemp;
  if (companyInfo.nbody === "Medicert") {
    docTemp = DriveApp.getFileById("1CYQgtEtpIeQMAZHtw6JmiR2shcBHM1L9wqX-MzyyzLw");
  } else if (companyInfo.nbody === "Inspect") {
    docTemp = DriveApp.getFileById("1-s53ijssKJw9d5rtpm2BmRJOxkXbfWGCx2IjsBT_xdw");
  } else {
    throw new Error("Geçersiz nbody değeri: " + companyInfo.nbody);
  }

  const folder = DriveApp.getFolderById(folderId);
  const copy = docTemp.makeCopy(isim + " - " + companyInfo.nbody + " Başvuru Formu (S" + id + ")", folder);
  const doc = DocumentApp.openById(copy.getId());
  const body = doc.getBody();

  body.replaceText("{{Unvan}}", companyInfo.unvan);
  body.replaceText("{{Adres}}", companyInfo.adres);
  body.replaceText("{{Sehir}}", companyInfo.sehir);
  body.replaceText("{{Ulke}}", companyInfo.ulke);
  body.replaceText("{{Vdaire}}", companyInfo.vergiD);
  body.replaceText("{{Vno}}", companyInfo.vergiN);
  body.replaceText("{{Tel}}", companyInfo.tel);
  body.replaceText("{{Fax}}", companyInfo.faks);
  body.replaceText("{{www}}", companyInfo.www);
  body.replaceText("{{mail}}", companyInfo.mail);
  body.replaceText("{{Yetkili}}", companyInfo.yetA);
  body.replaceText("{{YUnvan}}", companyInfo.yetU);
  body.replaceText("{{KYT}}", companyInfo.kyt);
  body.replaceText("{{irtibat}}", companyInfo.irtA);
  body.replaceText("{{iUnvan}}", companyInfo.irtU);

  var eKapsam = companyInfo.kapsam.toLocaleLowerCase('tr-TR');
  body.replaceText("{{Kapsam}}", eKapsam.replace(/(^|\s)\S/g, l => l.toLocaleUpperCase('tr-TR')));

  var eScope = companyInfo.scope.toLocaleLowerCase('en-EN');
  body.replaceText("{{Scope}}", eScope.replace(/\b\w/g, l => l.toLocaleUpperCase('en-EN')));

  body.replaceText("{{Yapis}}", companyInfo.yapis);
  body.replaceText("{{Calisan}}", companyInfo.calisan);
  body.replaceText("{{Yazisma}}", companyInfo.yazisma);
  body.replaceText("{{qms}}", companyInfo.qms);
  body.replaceText("{{mdd}}", companyInfo.mdd);
  body.replaceText("{{ems}}", companyInfo.ems);
  body.replaceText("{{fsms}}", companyInfo.fsms);
  body.replaceText("{{isms}}", companyInfo.isms);
  body.replaceText("{{ohs}}", companyInfo.ohs);
  body.replaceText("{{eng}}", companyInfo.eng);
  body.replaceText("{{Gmp}}", companyInfo.gmp);
  body.replaceText("{{obi}}", companyInfo.obi);
  body.replaceText("{{Ce}}", companyInfo.ce);
  body.replaceText("{{Oth}}", companyInfo.oth);
  body.replaceText("{{Diger}}", companyInfo.diger);
}

function draftBas(certificate) {
  try {
    const isim = certificate.nickname;
    const id = certificate.id;
    const folderId = ilkKarekter(isim);
    const standard = certificate.standard;
    const tempId = certificate.theme;
    const lang = certificate.lang;
    const logo = certificate.logo;

    if (!tempId) throw new Error("Şablon ID eksik!");
    if (!folderId) throw new Error("Hedef klasör ID eksik!");
    if (!standard) throw new Error("Standard eksik!");

    // 🔹 Şablon dosyayı al
    const docTemp = DriveApp.getFileById(tempId);
    if (!docTemp) throw new Error("Şablon dosyası bulunamadı.");

    // 🔹 Hedef klasörü al
    const folder = DriveApp.getFolderById(folderId);
    if (!folder) throw new Error("Hedef klasör bulunamadı.");

    // 🔹 Kopya oluştur
    const copyName = lang === "EN"
      ? `${isim} - Draft ${standard} (M${id})`
      : `${isim} - Draft ${standard} ${lang} (M${id})`;

    const copy = docTemp.makeCopy(copyName, folder);
    const doc = DocumentApp.openById(copy.getId());
    const body = doc.getBody();
    const footer = doc.getFooter();

    // 🔹 Şablon metinlerini değiştir
    const replacements = {
      "{{Unvan}}": certificate.unvan || "Eksik Unvan",
      "{{Adres}}": certificate.adres || "Eksik Adres",
      "{{Sehir}}": certificate.sehir || "Eksik Şehir",
      "{{Ulke}}": certificate.ulke || "Eksik Ülke",
      "{{Scope}}": certificate.scope || "Eksik Scope",
      "{{Kapsam}}": certificate.kapsam || "Eksik Kapsam",
      "{{Sno}}": "Draft",
      "{{BelgeT}}": "xxx",
      "{{GozT}}": "xxx",
      "{{DenT}}": "xxx",
      "{{ilkT}}": "xxx",
      "{{Sign}}": "",
      "{{QrKod}}": "" // **Hem gövde hem footer için boş string ile değiştirilecek**
    };

    for (let key in replacements) {
      body.replaceText(key, replacements[key]);
      if (footer) {
        footer.replaceText(key, replacements[key]); // **Footer'daki `{{QrKod}}` de siliniyor**
      }
    }

    // Logo ekleme
    if (logo) {
      try {
        var file = DriveApp.getFileById(logo);
        var mimeType = file.getMimeType();
        if (mimeType.startsWith("image/")) {
          var imageBlob = file.getBlob();
          replaceTextToImage(body, "{{Logo}}", imageBlob, 57);
        }
      } catch (error) {
        body.replaceText("{{Logo}}", "");
      }
    } else {
      body.replaceText("{{Logo}}", "");
    }

    // 🔹 Şube bilgisi
    if (certificate.yazisma && certificate.yazisma.trim() !== "") {
      body.replaceText("{{Sube}}", "Branch: " + certificate.yazisma);
    } else {
      var foundElement = body.findText("{{Sube}}");
      if (foundElement) {
        var paragraph = foundElement.getElement().getParent();
        try {
          paragraph.removeFromParent(); // Direkt olarak sil
        } catch (err) {
          body.replaceText("{{Sube}}", "");
        }
      }
    }

    // 🔹 Görsel ekleme işlemi
    const image = DriveApp.getFileById("1A--cr2pFxTBT5iVi5EeoQmMtR4Fgpk6a").getBlob();
    const searchText = lang === "EN" ? "This is to certify that" : "Bu Sertifika";
    const next = body.findText(searchText);

    if (next) {
      const r = next.getElement();
      const img = r.getParent().asParagraph().addPositionedImage(image);

      img.setLayout(DocumentApp.PositionedLayout.ABOVE_TEXT) // **Ön planda olması için**
        .setLeftOffset(20)  // **Sağdan 20 px kaydır**
        .setTopOffset(30)   // **Üstten 30 px kaydır**
        .setWidth(600)      // **18 cm genişlik**
        .setHeight(600);    // **18 cm yükseklik**
    } else {
      throw new Error("Görsel eklenecek yer bulunamadı.");
    }

    return "✅ Draft başarıyla oluşturuldu!";
  } catch (error) {
    throw new Error("❌ Hata: " + error.message);
  }
}

function sozlesme(companyInfo) {
  const isim = companyInfo.nickname;
  const id = companyInfo.id;
  const folderId = ilkKarekter(isim);
  const docTemp = DriveApp.getFileById("1bNlf4GOZFsDTzmYJrhTbmVrfZ17P4U_i8im5Vte2gM8");
  const folder = DriveApp.getFolderById(folderId);
  const copy = docTemp.makeCopy(isim + " - Medicert Sözleşme (M" + id + ")", folder);
  const doc = DocumentApp.openById(copy.getId());
  const body = doc.getBody();

  body.replaceText("{{Unvan}}", companyInfo.unvan);
  body.replaceText("{{Yetkili}}", companyInfo.yetA);
  body.replaceText("{{YUnvan}}", companyInfo.yetU);
  body.replaceText("{{Adres}}", companyInfo.adres);
  body.replaceText("{{Sehir}}", companyInfo.sehir);
  body.replaceText("{{Ulke}}", companyInfo.ulke);
  body.replaceText("{{Tel}}", companyInfo.tel);
  body.replaceText("{{Fax}}", companyInfo.faks);
  body.replaceText("{{Vdaire}}", companyInfo.vergiD);
  body.replaceText("{{Vno}}", companyInfo.vergiN);

  body.replaceText("{{Konu}}", companyInfo.konu);
  body.replaceText("{{Ucret}}", companyInfo.ucret);

  body.replaceText("{{Tarih}}", companyInfo.tarih);
}

function prepareDocumentFolders(data) {
  const allTemplates = returnDocuments();
  const rows = allTemplates.filter(row => row[0] === data.setName && row[5]);

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`"${data.setName}" setine ait geçerli bir belge bulunamadı.`);
  }

  const mesajlar = [];
  const folderId = ilkKarekter(data.nick || "YeniFirma");
  const anaKlasor = DriveApp.getFolderById(folderId);

  const dokumanlarKlasoru = docsGetOrCreateFolder(anaKlasor, "Dokümalar");

  const klasorMap = {};
  const uniqueFolderNames = [...new Set(rows.map(row => row[2]))];

  uniqueFolderNames.forEach(klasorAdi => {
    const klasor = docsGetOrCreateFolder(dokumanlarKlasoru, klasorAdi);
    klasorMap[klasorAdi] = klasor.getId(); // ID olarak kaydediyoruz
  });

  mesajlar.push("📂 Gerekli klasörler oluşturuldu. Doküman yazma işine başlandı.");

  return {
    rows: rows,              // Şablon satırları (Array garantili)
    klasorMap: klasorMap,    // Alt klasör ID'leri
    mesajlar: mesajlar       // Bilgilendirme mesajları
  };
}

function docsGetOrCreateFolder(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  return folders.hasNext() ? folders.next() : parentFolder.createFolder(folderName);
}

function createSingleDocument(row, data, klasorMap) {
  const [setName, dosyaTuru, klasorAdi, dokKodu, dokAdi, templateId] = row;
  const dosyaAdi = `${dokKodu} ${dokAdi}`.trim();

  const altKlasorId = klasorMap[klasorAdi];
  const altKlasor = DriveApp.getFolderById(altKlasorId);

  const copy = DriveApp.getFileById(templateId).makeCopy(dosyaAdi, altKlasor);

  const replacements = {
    "{{dokKodu}}": dokKodu,
    "{{revNo}}": data.revNo || "00",
    "{{revTar}}": data.revTarihi || "-",
    "{{yayTar}}": data.dokumanTarihi || "",
    "{{unvan}}": data.unvan || "",
    "{{kapsam}}": data.kapsam || "",
    "{{adres}}": data.adresTam || "",
    "{{tel}}": data.tel || "",
    "{{faks}}": data.faks || "",
    "{{mail}}": data.mail || "",
    "{{web}}": data.www || "",
    "{{nick}}": data.nick || "",
    "{{yetkili}}": data.yetkiliAdi || "",
    "{{yetkiliUn}}": data.yetkiliUnvan || "",
    "{{kyt}}": data.kyt || "",
    "{{kalite}}": data.kalite || "",
    "{{kaliteUn}}": data.kaliteUn || "",
    "{{mali}}": data.mali || "",
    "{{maliUn}}": data.maliUn || "",
    "{{uretim}}": data.uretim || "",
    "{{uretimUn}}": data.uretimUn || "",
    "{{depo}}": data.depo || "",
    "{{depoUn}}": data.depoUn || ""
  };

  if (dosyaTuru === "Docs") {
    const doc = DocumentApp.openById(copy.getId());
    try {
      if (data.logo) {
        insertLogoInAllHeaderSections(doc, data.logo);
        insertLogoInBodyAndTables(doc, data.logo);
      }

      const parentDoc = doc.getHeader().getParent();
      for (let i = 0; i < parentDoc.getNumChildren(); i++) {
        const section = parentDoc.getChild(i);
        const type = section.getType();

        if (type === DocumentApp.ElementType.HEADER_SECTION || type === DocumentApp.ElementType.FOOTER_SECTION) {
          const sectionElement = type === DocumentApp.ElementType.HEADER_SECTION
            ? section.asHeaderSection()
            : section.asFooterSection();
          docsReplaceAllPh(sectionElement, replacements);
        }
      }

      docsReplaceAllPh(doc.getBody(), replacements);
      doc.saveAndClose();
    } catch (error) {
      throw new Error(`Docs belge işlenirken hata: ${error.message}`);
    }
  }

  if (dosyaTuru === "Sheet") {
    try {
      const sheets = SpreadsheetApp.openById(copy.getId()).getSheets();

      sheets.forEach(sheet => {
        const range = sheet.getDataRange();
        const values = range.getValues();

        values.forEach((rowArr, rowIndex) => {
          rowArr.forEach((cell, colIndex) => {
            if (typeof cell !== "string") return;

            let newCell = cell;
            Object.entries(replacements).forEach(([key, val]) => {
              newCell = newCell.replaceAll(key, val);
            });

            const cellRange = sheet.getRange(rowIndex + 1, colIndex + 1);

            // Logo yerleştir
            if (newCell.includes("{{logo}}") && data.logo) {
              cellRange.clearContent();

              const logoBlob = DriveApp.getFileById(data.logo).getBlob();
              const image = sheet.insertImage(logoBlob, colIndex + 1, rowIndex + 1);

              // Otomatik boyutlandır (max 160px)
              const maxWidth = 160;
              const originalWidth = image.getWidth();
              const originalHeight = image.getHeight();

              if (originalWidth > maxWidth) {
                const scale = maxWidth / originalWidth;
                image.setWidth(maxWidth);
                image.setHeight(Math.round(originalHeight * scale));
              }
            } else {
              cellRange.setValue(newCell);
            }
          });
        });
      });
    } catch (error) {
      throw new Error(`Sheet belge işlenirken hata: ${error.message}`);
    }
  }
  if (dosyaTuru === "Pdf") {
    try {
      // Sadece PDF dosyasını hedef klasöre taşıdıktan sonra isim veriyoruz
      // copy zaten altKlasör'e kopyalanmış oluyor
    } catch (error) {
      throw new Error(`PDF belge taşınırken hata: ${error.message}`);
    }
  }
}

// Yer tutucuların topluca değiştirilmesi
function docsReplaceAllPh(target, replacements) {
  for (const [key, value] of Object.entries(replacements)) {
    target.replaceText(key, value);
  }
}

// Logo Ekleme
function insertLogoInAllHeaderSections(doc, logoId) {
  const header = doc.getHeader();
  if (!header) return; // Header yoksa çık

  const parent = header.getParent();
  const labelVariants = ["<<logo>>", "{{logo}}"];
  const maxWidthPx = 100; // 3 cm ≈ 85 px

  for (let i = 0; i < parent.getNumChildren(); i++) {
    const section = parent.getChild(i);
    if (section.getType() !== DocumentApp.ElementType.HEADER_SECTION) continue;

    const headerSection = section.asHeaderSection();

    for (let j = 0; j < headerSection.getNumChildren(); j++) {
      const element = headerSection.getChild(j);
      if (element.getType() !== DocumentApp.ElementType.TABLE) continue;

      const table = element.asTable();
      for (let r = 0; r < table.getNumRows(); r++) {
        for (let c = 0; c < table.getRow(r).getNumCells(); c++) {
          const cell = table.getCell(r, c);
          const cellText = cell.getText();

          for (const label of labelVariants) {
            if (cellText.toLowerCase().includes(label.toLowerCase())) {
              cell.clear(); // metni sil
              const blob = DriveApp.getFileById(logoId).getBlob();
              const paragraph = cell.appendParagraph("");
              const img = paragraph.insertInlineImage(0, blob);

              // Otomatik boyutlandır (max 3 cm genişlik)
              const originalWidth = img.getWidth();
              const originalHeight = img.getHeight();

              if (originalWidth > maxWidthPx) {
                const scale = maxWidthPx / originalWidth;
                img.setWidth(maxWidthPx);
                img.setHeight(Math.round(originalHeight * scale));
              }

              break;
            }
          }
        }
      }
    }
  }
}

function insertLogoInBodyAndTables(doc, logoId) {
  const body = doc.getBody();
  const labelVariants = ["{{logo}}", "<<logo>>"];
  const fullText = body.getText().toLowerCase();

  // Ön kontrol: logo etiketi içeriyor mu?
  const containsLogo = labelVariants.some(label => fullText.includes(label.toLowerCase()));
  if (!containsLogo) return;

  const maxWidthPx = 100;
  const blob = DriveApp.getFileById(logoId).getBlob();

  const numChildren = body.getNumChildren();

  for (let i = 0; i < numChildren; i++) {
    const element = body.getChild(i);
    const type = element.getType();

    // 1. Paragraflar
    if (type === DocumentApp.ElementType.PARAGRAPH) {
      const paragraph = element.asParagraph();
      const text = paragraph.getText();

      if (labelVariants.some(label => text.toLowerCase().includes(label.toLowerCase()))) {
        paragraph.clear();
        const img = paragraph.insertInlineImage(0, blob);

        const originalWidth = img.getWidth();
        const originalHeight = img.getHeight();

        if (originalWidth > maxWidthPx) {
          const scale = maxWidthPx / originalWidth;
          img.setWidth(maxWidthPx);
          img.setHeight(Math.round(originalHeight * scale));
        }
      }
    }

    // 2. Tablolar
    else if (type === DocumentApp.ElementType.TABLE) {
      const table = element.asTable();

      for (let r = 0; r < table.getNumRows(); r++) {
        const row = table.getRow(r);
        for (let c = 0; c < row.getNumCells(); c++) {
          const cell = row.getCell(c);
          const text = cell.getText();

          if (labelVariants.some(label => text.toLowerCase().includes(label.toLowerCase()))) {
            cell.clear(); // içeriği temizle
            const paragraph = cell.appendParagraph("");
            const img = paragraph.insertInlineImage(0, blob);

            const originalWidth = img.getWidth();
            const originalHeight = img.getHeight();

            if (originalWidth > maxWidthPx) {
              const scale = maxWidthPx / originalWidth;
              img.setWidth(maxWidthPx);
              img.setHeight(Math.round(originalHeight * scale));
            }
          }
        }
      }
    }
  }
}