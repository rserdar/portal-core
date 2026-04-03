/**
 * 📄 DocumentService: Doküman Üretim ve Şablon Motoru
 * 
 * ISO Sertifikaları, Test Raporları ve Başvuru Formlarının 
 * şablonlardan üretilmesini yönetir.
 */

const DocumentService = {
  // ⚙️ Sabit ID'ler ve Konfigürasyon
  CONFIG: {
    SIGNATURE_ID: "1gm13q_8COlPybuOrhWGP-H7LXfKIRoF1",
    DRAFT_BG_ID: "1A--cr2pFxTBT5iVi5EeoQmMtR4Fgpk6a",
    APP_FORM_MEDICERT: "1CYQgtEtpIeQMAZHtw6JmiR2shcBHM1L9wqX-MzyyzLw",
    APP_FORM_INSPECT: "1-s53ijssKJw9d5rtpm2BmRJOxkXbfWGCx2IjsBT_xdw",
    CONTRACT_TEMP: "1bNlf4GOZFsDTzmYJrhTbmVrfZ17P4U_i8im5Vte2gM8",
    DEMO_IMAGE: "1KPC13vmsRzBt522EQOwNcyIDgMlWZeZd"
  },

  /**
   * ISO Sertifikası Üretir (Eski isoBas).
   */
  generateIsoCertificate: function(cert, parentFolderId) {
    try {
      const { sTarihi, lang, trtema, entema, unvan, sNo, nickname } = cert;
      
      // 1. Hedef Klasörü Belirle (Yıl Klasörü)
      const year = sTarihi && sTarihi.includes(".") ? sTarihi.split(".")[2] : "Diger";
      const targetFolder = DriveService.getOrCreateSubFolder(parentFolderId, year);

      // 2. Şablonu Kopyala
      const tempId = lang === "EN" ? entema : trtema;
      const docTemp = DriveApp.getFileById(tempId);
      const fileName = `${nickname} - ${sNo} (${lang})`;
      const copy = docTemp.makeCopy(fileName, targetFolder);
      const doc = DocumentApp.openById(copy.getId());
      const body = doc.getBody();

      // 3. Yer Tutucuları Değiştir (Replacements)
      this._processReplacements(body, {
        "{{Unvan}}": unvan,
        "{{Adres}}": cert.adres,
        "{{Sehir}}": cert.il,
        "{{Ulke}}": cert.ulke,
        "{{Nace}}": cert.nace || "",
        "{{Sno}}": sNo,
        "{{BelgeT}}": this._formatDate(sTarihi, lang),
        "{{GozT}}": this._formatDate(cert.sGozetimT, lang),
        "{{Kapsam}}": cert.sKapsam || "",
        "{{Scope}}": cert.sScope || ""
      });

      // 4. Logo ve İmza İşlemleri
      if (cert.logo) this._replaceImage(body, "{{Logo}}", cert.logo, 57);
      if (cert.select === "S") this._replaceImage(body, "{{Sign}}", this.CONFIG.SIGNATURE_ID, 48);

      // 5. QR Kod Üretimi
      if (cert.qrLink) this._generateQr(doc, cert.qrLink);

      doc.saveAndClose();
      return { success: true, url: copy.getUrl(), id: copy.getId() };
    } catch (e) {
      BaseService.logError("generateIsoCertificate", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Test Raporu Üretir (Eski testBas).
   */
  generateTestReport: function(data, folderId) {
    try {
      const { fnick, fno, testadi, urunkod, lang, entema, trtema, raporno } = data;
      const targetFolder = DriveApp.getFolderById(folderId);
      const tempId = lang === "EN" ? entema : trtema;
      const docTemp = DriveApp.getFileById(tempId);
      const docName = lang === "EN" ? `${fnick} - ${urunkod} - EN (${fno})` : `${fnick} - ${urunkod} - ${testadi} (${fno})`;
      
      const copy = docTemp.makeCopy(docName, targetFolder);
      const doc = DocumentApp.openById(copy.getId());
      const body = doc.getBody();

      // Rapor No'yu Üst Bilgi ve Alt Bilgide Değiştir
      [doc.getHeader(), doc.getFooter()].forEach(sec => {
        if (sec) sec.replaceText("<<RaporNo>>", raporno || "");
      });

      // Detayı Doldur
      this._processReplacements(body, {
        "<<FirmaAdi>>": data.unvan,
        "<<Adres>>": data.adres,
        "<<RaporNo>>": raporno,
        "<<Marka>>": data.marka,
        "<<Urun>>": data.urun,
        "<<Lot>>": data.lot,
        "<<TestBa>>": data.testba,
        "<<TestBi>>": data.testbi
      });

      // Görselleri Yerleştir
      if (data.gorselbir) this._replaceImage(body, "<<Görsel1>>", data.gorselbir === "demo" ? this.CONFIG.DEMO_IMAGE : data.gorselbir, 208);
      if (data.gorseliki) this._replaceImage(body, "<<Görsel2>>", data.gorseliki === "demo" ? this.CONFIG.DEMO_IMAGE : data.gorseliki, 208);

      doc.saveAndClose();
      return { success: true, id: copy.getId() };
    } catch (e) {
      BaseService.logError("generateTestReport", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Başvuru Formu Üretir (Eski basFormu).
   */
  generateAppForm: function(info, folderId) {
    try {
      const tempId = info.nbody === "Medicert" ? this.CONFIG.APP_FORM_MEDICERT : this.CONFIG.APP_FORM_INSPECT;
      const folder = DriveApp.getFolderById(folderId);
      const fileName = `${info.nickname} - ${info.nbody} Başvuru Formu (S${info.id})`;
      const copy = DriveApp.getFileById(tempId).makeCopy(fileName, folder);
      
      // Form doldurma mantığı buraya eklenir...
      return { success: true, id: copy.getId() };
    } catch (e) {
      BaseService.logError("generateAppForm", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Kullanılabilir doküman setlerini (9001, 14001 vb.) döner.
   */
  getAvailableSets: function() {
    try {
      // returnDocuments() veya ilgili e-tablo sayfasından veri çeker
      const ss = BaseService.openSS();
      const sheet = ss.getSheetByName("DokümanŞablonları") || ss.getSheetByName("Templates");
      if (!sheet) return [];
      
      const data = sheet.getDataRange().getValues();
      const sets = [...new Set(data.slice(1).map(row => row[0]))]; // İlk kolon: Set Adı
      return sets.filter(s => s);
    } catch (e) {
      BaseService.logError("getAvailableSets", e);
      return [];
    }
  },

  /**
   * Toplu üretim öncesi klasörleri hazırlar.
   */
  prepareBatchFolders: function(data) {
    try {
      const parentFolderId = DriveService.getCompanyFolderId(data.nick);
      const docsFolder = DriveService.getOrCreateSubFolder(parentFolderId, "Dokümanlar");
      
      // Şablon listesini al
      const ss = BaseService.openSS();
      const sheet = ss.getSheetByName("DokümanŞablonları") || ss.getSheetByName("Templates");
      const rows = sheet.getDataRange().getValues().slice(1)
                        .filter(row => row[0] === data.setName && row[5]); // row[5] = Template ID

      const folderMap = {};
      const uniqueSubFolders = [...new Set(rows.map(row => row[2]))]; // row[2] = Alt Klasör Adı
      
      uniqueSubFolders.forEach(name => {
        const folder = DriveService.getOrCreateSubFolder(docsFolder.getId(), name);
        folderMap[name] = folder.getId();
      });

      return { success: true, rows: rows, folderMap: folderMap };
    } catch (e) {
      BaseService.logError("prepareBatchFolders", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Tek bir dokümanı set içinden üretir.
   */
  generateSingleBatchDoc: function(row, data, folderMap) {
    try {
      const [setName, type, subFolder, code, name, tempId] = row;
      const fileName = `${code} ${name}`.trim();
      const targetFolderId = folderMap[subFolder];
      const targetFolder = DriveApp.getFolderById(targetFolderId);
      
      const copy = DriveApp.getFileById(tempId).makeCopy(fileName, targetFolder);
      
      if (type === "Docs") {
        const doc = DocumentApp.openById(copy.getId());
        const body = doc.getBody();
        // Placeholder'ları değiştir
        this._processReplacements(body, {
          "{{dokKodu}}": code,
          "{{revNo}}": data.revNo || "00",
          "{{unvan}}": data.unvan || ""
        });
        doc.saveAndClose();
      }
      
      return { success: true, id: copy.getId(), name: fileName };
    } catch (e) {
      BaseService.logError("generateSingleBatchDoc", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * 🛠️ Helper: Yer Tutucu Değiştirici
   */
  _processReplacements: function(container, map) {
    for (let key in map) {
      container.replaceText(key, map[key] || "");
    }
  },

  /**
   * 🖼️ Helper: Görsel Yerleştirici
   */
  _replaceImage: function(body, placeholder, fileId, height = 50) {
    try {
      const range = body.findText(placeholder);
      if (!range) return;

      const blob = DriveApp.getFileById(fileId).getBlob();
      const element = range.getElement();
      const parent = element.getParent();
      
      const img = parent.asParagraph().insertInlineImage(0, blob);
      element.asText().setText(""); // Metni sil

      const w = img.getWidth();
      const h = img.getHeight();
      img.setHeight(height);
      img.setWidth((height * w) / h);
    } catch (e) {
      BaseService.logError("replaceImage", e);
      body.replaceText(placeholder, "");
    }
  },

  /**
   * 📱 Helper: QR Kod Üretici (api.qrserver.com)
   */
  _generateQr: function(doc, link) {
    try {
      const body = doc.getBody();
      const footer = doc.getFooter();
      let range = body.findText("{{QrKod}}") || (footer ? footer.findText("{{QrKod}}") : null);

      if (!range) return;

      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(link)}`;
      const blob = UrlFetchApp.fetch(qrUrl).getBlob();
      
      const element = range.getElement();
      const paragraph = element.getParent();
      element.asText().replaceText("{{QrKod}}", "");

      // Footer veya Tablo içi kontrolü yapılabilir (Basitleştirilmiş Hali)
      const img = paragraph.addPositionedImage(blob);
      img.setLayout(DocumentApp.PositionedLayout.ABOVE_TEXT)
         .setLeftOffset(509).setTopOffset(6).setWidth(90).setHeight(90);

    } catch (e) {
      BaseService.logError("generateQr", e);
    }
  },

  /**
   * 📅 Helper: Tarih Formatlayıcı
   */
  _formatDate: function(dateStr, lang) {
    if (!dateStr || !dateStr.includes(".")) return dateStr;
    const months = {
      TR: ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"],
      EN: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    };
    const parts = dateStr.split(".");
    const mIndex = parseInt(parts[1]) - 1;
    const month = months[lang] ? months[lang][mIndex] : months["TR"][mIndex];
    return `${month} ${parts[0]}, ${parts[2]}`;
  }
};
