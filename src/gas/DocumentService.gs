/**
 * 📄 DocumentService: Doküman Üretim ve Şablon Motoru
 *
 * ISO Sertifikaları, Test Raporları ve Başvuru Formlarının
 * şablonlardan üretilmesini yönetir.
 */

const DocumentService = {
  CONFIG: {
    SIGNATURE_ID:      "1gm13q_8COlPybuOrhWGP-H7LXfKIRoF1",
    DRAFT_BG_ID:       "1A--cr2pFxTBT5iVi5EeoQmMtR4Fgpk6a",
    APP_FORM_MEDICERT: "1_Tg5xCBjB3Mo7wpi8gBLVgz5Ilaov9uFIPUPiGHtEUo",
    APP_FORM_INSPECT:  "1-s53ijssKJw9d5rtpm2BmRJOxkXbfWGCx2IjsBT_xdw",
    CONTRACT_TEMP:     "1bNlf4GOZFsDTzmYJrhTbmVrfZ17P4U_i8im5Vte2gM8",
    PROFORMA_TEMP:     "1mgAgm0T52UwFpeE1VDgCNWgVi7_tOmn60f5lCQUsRcU",
    DEMO_IMAGE:        "1KPC13vmsRzBt522EQOwNcyIDgMlWZeZd"
  },
  _cfg: function(key) {
    const props = PropertiesService.getScriptProperties();
    const override = props.getProperty(key);
    return override && String(override).trim() ? String(override).trim() : this.CONFIG[key];
  },

  /**
   * ISO Sertifikası Üretir (eski isoBas).
   */
  generateIsoCertificate: function(cert, parentFolderId) {
    try {
      const {
        nick: isim, id, standard, sNo, sTarihi, sGozetimT, sTT, sGT,
        sKapsam, sScope, logo, nace, akrn: akreditasyon, not, other,
        unvan, adres, il, ulke, sube, trtema, entema, lang, select, qrLink
      } = cert;

      const year = sTarihi && sTarihi.includes(".") ? sTarihi.split(".")[2] : "Diger";
      let targetFolder;
      try {
        targetFolder = DriveService.getOrCreateSubFolder(parentFolderId, year);
      } catch(e) {
        throw new Error(`Firma klasörü veya yılına ait klasör oluşturulamadı. Drive hatası: ${e.message}`);
      }

      const tempId = lang === "EN" ? entema : trtema;
      if (!tempId) throw new Error(`Şablon eksik: '${standard}' standardı için ${lang} dilinde bir tema ID'si (tempId) bulunamadı.`);
      
      let docTemp;
      try {
        docTemp = DriveApp.getFileById(tempId);
      } catch(e) {
        throw new Error(`Şablon dosyasına erişilemedi. ID (${tempId}) hatalı veya silinmiş olabilir. Drive hatası: ${e.message}`);
      }

      // File name: matches legacy isoBas format
      const akreditasyonFormatted = (akreditasyon === "Non-Acc" || akreditasyon === "NA") ? "" : (akreditasyon || "");
      const standartFormatted = (standard === "Diğer") ? (other || "") : (standard || "");
      let fileName = lang === "EN"
        ? `${isim} - ${akreditasyonFormatted} ${standartFormatted} (M${id})`
        : `${isim} - ${akreditasyonFormatted} ${standartFormatted} ${lang} (M${id})`;
      fileName = fileName.replace(/\s+/g, " ").trim();

      const copy = docTemp.makeCopy(fileName, targetFolder);
      const doc = DocumentApp.openById(copy.getId());
      const body = doc.getBody();

      // Legacy isoBas ile uyum: logo hem header/table hem body placeholder alanlarına uygulanır.
      if (logo) {
        const extractedLogoId = (String(logo).match(/[-\w]{25,}/) || [logo])[0];
        let logoBlob = null;
        try {
          logoBlob = DriveApp.getFileById(extractedLogoId).getBlob();
        } catch(e) {
          const errMsg = "LOGO HATA (ID: " + extractedLogoId + "): " + e.message;
          body.replaceText("{{Logo}}", errMsg);
          body.replaceText("{{logo}}", errMsg);
          body.replaceText("<<logo>>", errMsg);
        }
        
        if (logoBlob) {
          this._insertLogoInHeaders(doc, logoBlob);
          this._insertLogoInBody(doc, logoBlob);
        }
      }

      this._processReplacements(body, {
        "{{Unvan}}":  unvan,
        "{{Adres}}":  adres,
        "{{Sehir}}":  il,
        "{{Ulke}}":   ulke,
        "{{Nace}}":   nace   || "",
        "{{Sno}}":    sNo,
        "{{BelgeT}}": this._formatDate(sTarihi, lang),
        "{{GozT}}":   this._formatDate(sGozetimT, lang),
        "{{DenT}}":   this._formatDate(sGT, lang),
        "{{ilkT}}":   this._formatDate(sTT, lang),
        "{{Kapsam}}": sKapsam || "",
        "{{Scope}}":  sScope  || ""
      });

      // "Diğer" standard: replace Standart/aStandart placeholders
      if (standard === "Diğer") {
        body.replaceText("{{Standart}}", other || "");
        body.replaceText("{{aStandart}}", not || "");
      }

      // Branch: replace with "Branch: X" or remove entire paragraph if empty
      if (sube) {
        body.replaceText("{{Sube}}", `Branch: ${sube}`);
      } else {
        let found = body.findText("{{Sube}}");
        while (found) {
          const para = found.getElement().getParent();
          try { para.removeFromParent(); } catch (_) { body.replaceText("{{Sube}}", ""); }
          found = body.findText("{{Sube}}");
        }
      }

      if (!logo) {
        const labelVariants = ["{{logo}}", "<<logo>>", "{{Logo}}"];
        const removeRowIfFound = (container) => {
          if (!container) return;
          labelVariants.forEach(label => {
            let found = container.findText(label);
            while (found) {
              let elem = found.getElement();
              let parent = elem.getParent();
              let removed = false;
              while (parent) {
                if (parent.getType() === DocumentApp.ElementType.TABLE_ROW) {
                  try { parent.removeFromParent(); removed = true; } catch(e) {}
                  break;
                }
                parent = parent.getParent();
              }
              if (!removed) {
                container.replaceText(label, "");
              }
              found = container.findText(label);
            }
          });
        };
        removeRowIfFound(body);
        removeRowIfFound(doc.getHeader());
        removeRowIfFound(doc.getFooter());
      }

      if (select === "S") this._replaceImage(body, "{{Sign}}", this._cfg("SIGNATURE_ID"), 48);
      else body.replaceText("{{Sign}}", "");

      if (qrLink) this._generateQr(doc, qrLink);

      doc.saveAndClose();
      return { success: true, url: copy.getUrl(), id: copy.getId() };
    } catch (e) {
      BaseService.logError("generateIsoCertificate", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Test Raporu Üretir (eski testBas).
   */
  generateTestReport: function(data, folderId) {
    try {
      const {
        fnick = "", fno = "", testadi = "", testname = "", urunkod = "", lang = "TR",
        entema = "", trtema = "", raporno = "", unvan = "", adres = "", sehir = "",
        ulke = "", marka = "", urun = "", lot = "", urunno = "",
        testba = "", testbi = "", kabultarih = "", raportarihi = "", kabulsaat = "",
        numunesay = "", numuneskt = "", numuneut = "",
        urunbilgi = "", detay = "", gorselbir = "", gorseliki = "", testisim = ""
      } = data;

      const fmtTestba   = this._formatTestDate(testba, "dd.MM.yyyy");
      const fmtTestbi   = this._formatTestDate(testbi, "dd.MM.yyyy");
      const fmtKabul    = this._formatTestDate(kabultarih, "dd.MM.yyyy");
      const fmtRapor    = this._formatTestDate(raportarihi, "dd.MM.yyyy");
      const fmtSkt      = this._formatTestDate(numuneskt, "dd.MM.yyyy");
      const fmtUt       = this._formatTestDate(numuneut, "dd.MM.yyyy");
      const fmtSaat     = this._formatTestDate(kabulsaat, "HH:mm");

      const tempId = lang === "EN" ? entema : trtema;
      if (!tempId) throw new Error("Örnek Test Dosyası (tempId) eksik. Dil: " + lang);

      const targetFolder = DriveApp.getFolderById(folderId);
      const docTemp = DriveApp.getFileById(tempId);
      const docName = lang === "EN"
        ? `${fnick} - ${urunkod} - ${testname} EN (M${fno})`
        : `${fnick} - ${urunkod} - ${testadi} (M${fno})`;

      const copy = docTemp.makeCopy(docName, targetFolder);
      const doc = DocumentApp.openById(copy.getId());

      [doc.getHeader(), doc.getFooter()].forEach(sec => {
        if (sec) sec.replaceText("<<RaporNo>>", raporno || "");
      });

      const body = doc.getBody();
      this._processReplacements(body, {
        "<<FirmaAdi>>":  unvan,
        "<<Adres>>":     adres,
        "<<Sehir>>":     sehir,
        "<<Ulke>>":      ulke,
        "<<RaporNo>>":   raporno,
        "<<Marka>>":     marka,
        "<<Urun>>":      urun,
        "<<Lot>>":       lot,
        "<<UrunNo>>":    urunno,
        "<<TestBa>>":    fmtTestba,
        "<<TestBi>>":    fmtTestbi,
        "<<UrunKabul>>": fmtKabul,
        "<<RaporTarih>>":fmtRapor,
        "<<FirmaNick>>": fnick,
        "<<Saat>>":      fmtSaat,
        "<<Adet>>":      numunesay,
        "<<SKT>>":       fmtSkt,
        "<<UT>>":        fmtUt,
        "<<UrunBilgi>>": urunbilgi,
        "<<UrunDetay>>": detay
      });

      // LVD Testi: <<printdate>> placeholder
      if (testisim === "LVD Testi") {
        const printDateValue = this._formatDate(fmtTestbi, lang);
        body.replaceText("<<printdate>>", printDateValue);
      }

      if (gorselbir) this._replaceImage(body, "<<Görsel1>>", gorselbir === "demo" ? this._cfg("DEMO_IMAGE") : gorselbir, 208);
      if (gorseliki) this._replaceImage(body, "<<Görsel2>>", gorseliki === "demo" ? this._cfg("DEMO_IMAGE") : gorseliki, 208);

      doc.saveAndClose();
      return { success: true, id: copy.getId() };
    } catch (e) {
      BaseService.logError("generateTestReport", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Taslak sertifika üretir (legacy draftBas).
   */
  generateDraftCertificate: function(certificate) {
    try {
      const isim = certificate.nickname || certificate.nick;
      const id = certificate.id || certificate.firmaNo || certificate.fno;
      const standard = certificate.standard || certificate.standart;
      const other = certificate.other || certificate.otherStandard || "";
      const aStandart = certificate.aStandart || certificate.not || "";
      const tempId = certificate.theme || certificate.tema || certificate.tempId;
      const lang = certificate.lang || "TR";
      const logo = certificate.logo || "";

      if (!isim) throw new Error("Firma adı eksik.");
      if (!id) throw new Error("Firma ID eksik.");
      if (!standard) throw new Error("Standart eksik.");
      if (!tempId) throw new Error("Şablon ID eksik.");

      const folderId = DriveService.getCompanyFolderId(isim);
      const docTemp = DriveApp.getFileById(tempId);
      const folder = DriveApp.getFolderById(folderId);
      const standardDisplay = standard === "Diğer" ? (other || standard) : standard;
      const copyName = lang === "EN"
        ? `${isim} - Draft ${standardDisplay} (M${id})`
        : `${isim} - Draft ${standardDisplay} ${lang} (M${id})`;

      const copy = docTemp.makeCopy(copyName, folder);
      const doc = DocumentApp.openById(copy.getId());
      const body = doc.getBody();
      const footer = doc.getFooter();

      const replacements = {
        "{{Unvan}}": certificate.unvan || "",
        "{{Adres}}": certificate.adres || "",
        "{{Sehir}}": certificate.sehir || certificate.il || "",
        "{{Ulke}}": certificate.ulke || "",
        "{{Scope}}": certificate.scope || "",
        "{{Kapsam}}": certificate.kapsam || "",
        "{{Sno}}": "Draft",
        "{{BelgeT}}": "xxx",
        "{{GozT}}": "xxx",
        "{{DenT}}": "xxx",
        "{{ilkT}}": "xxx",
        "{{Standart}}": standard === "Diğer" ? (other || "") : "",
        "{{aStandart}}": standard === "Diğer" ? (aStandart || "") : "",
        "{{Sign}}": "",
        "{{QrKod}}": ""
      };
      this._processReplacements(body, replacements);
      if (footer) this._processReplacements(footer, replacements);

      if (logo) {
        this._insertLogoInHeaders(doc, logo);
        this._insertLogoInBody(doc, logo);
      } else {
        body.replaceText("{{Logo}}", "");
      }

      const sube = certificate.yazisma || certificate.sube || "";
      if (sube && String(sube).trim()) {
        body.replaceText("{{Sube}}", `Branch: ${sube}`);
      } else {
        const found = body.findText("{{Sube}}");
        if (found) {
          const paragraph = found.getElement().getParent();
          try { paragraph.removeFromParent(); } catch (_) { body.replaceText("{{Sube}}", ""); }
        }
      }

      // Legacy ile uyumlu draft arkaplan görselini Header'a ekleyerek "Metnin Arkasında" kalmasını sağlıyoruz
      const bgImageId = this._cfg("DRAFT_BG_ID");
      const bgImage = DriveApp.getFileById(bgImageId).getBlob();
      
      let header = doc.getHeader();
      if (!header) {
        header = doc.addHeader();
      }
      
      // Header'a gizli bir paragraf ekleyerek resmi ona tutturuyoruz
      const p = header.appendParagraph("");
      
      // A4 = ~595 x 842 pt
      // 550x550 resim için => left = (595 - 550)/2 = ~22, top = (842 - 550)/2 = ~146
      // Header offsetini (~36pt) hesaba katarak topOffset'i ayarlıyoruz. 
      // Sola kayma durumunu önlemek için leftOffset'i eski body marginine uygun (yaklaşık +75) ayarladık.
      p.addPositionedImage(bgImage)
        .setLayout(DocumentApp.PositionedLayout.ABOVE_TEXT) // Header içinde overlay fakat Body'nin arkasında
        .setWidth(600)
        .setHeight(600)
        .setLeftOffset(65)
        .setTopOffset(110);


      doc.saveAndClose();
      return { success: true, id: copy.getId(), url: copy.getUrl() };
    } catch (e) {
      BaseService.logError("generateDraftCertificate", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Sözleşme üretir (legacy sozlesme).
   */
  generateContract: function(companyInfo) {
    try {
      const isim = companyInfo.nickname || companyInfo.nick;
      const id = companyInfo.id || companyInfo.firmId || companyInfo.fno;
      if (!isim) throw new Error("Firma adı eksik.");
      if (!id) throw new Error("Firma ID eksik.");

      const folderId = DriveService.getCompanyFolderId(isim);
      const docTemp = DriveApp.getFileById(this._cfg("CONTRACT_TEMP"));
      const folder = DriveApp.getFolderById(folderId);
      const copy = docTemp.makeCopy(`${isim} - Medicert Sözleşme (M${id})`, folder);
      const doc = DocumentApp.openById(copy.getId());
      const body = doc.getBody();

      this._processReplacements(body, {
        "{{Unvan}}": companyInfo.unvan || "",
        "{{Yetkili}}": companyInfo.yetA || "",
        "{{YUnvan}}": companyInfo.yetU || "",
        "{{Adres}}": companyInfo.adres || "",
        "{{Sehir}}": companyInfo.sehir || "",
        "{{Ulke}}": companyInfo.ulke || "",
        "{{Tel}}": companyInfo.tel || "",
        "{{Fax}}": companyInfo.faks || "",
        "{{Vdaire}}": companyInfo.vergiD || "",
        "{{Vno}}": companyInfo.vergiN || "",
        "{{Konu}}": companyInfo.konu || "",
        "{{Ucret}}": companyInfo.ucret || "",
        "{{Tarih}}": companyInfo.tarih || ""
      });

      doc.saveAndClose();
      return { success: true, id: copy.getId(), url: copy.getUrl() };
    } catch (e) {
      BaseService.logError("generateContract", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Proforma dokumani uretir (legacy proformaVeri).
   */
  generateProforma: function(proformaInfo) {
    try {
      const isim = proformaInfo.nick || proformaInfo.nickname || proformaInfo.firmaAdi || "";
      const faturaNo = proformaInfo.faturaNo || proformaInfo.id || "";
      const firmaNo = proformaInfo.firmaNo || proformaInfo.fno || "";
      if (!isim) throw new Error("Firma kisa adi eksik.");
      if (!faturaNo) throw new Error("Proforma numarasi eksik.");
      if (!firmaNo) throw new Error("Firma numarasi eksik.");

      const folderId = DriveService.getCompanyFolderId(isim);
      const docTemp = DriveApp.getFileById(this._cfg("PROFORMA_TEMP"));
      const folder = DriveApp.getFolderById(folderId);
      const copy = docTemp.makeCopy(`${isim} - Proforma Fatura M${faturaNo}T(${firmaNo})`, folder);
      const doc = DocumentApp.openById(copy.getId());
      const body = doc.getBody();

      this._processReplacements(body, {
        "{{Firma}}": proformaInfo.unvan || isim,
        "{{Adres}}": proformaInfo.adres || "",
        "{{il}}": proformaInfo.il || proformaInfo.sehir || "",
        "{{Ulke}}": proformaInfo.ulke || "",
        "{{Tel}}": proformaInfo.tel || "",
        "{{VDairesi}}": proformaInfo.vergiD || "",
        "{{VNo}}": proformaInfo.vergiN || "",
        "{{Yetkili}}": proformaInfo.yetkili || proformaInfo.yetA || "",
        "{{FaturaNo}}": String(faturaNo),
        "{{FirmaNo}}": String(firmaNo),
        "{{Tarih}}": proformaInfo.tarih || "",
        "{{Konu}}": proformaInfo.konu || "",
        "{{Kdvsiz}}": proformaInfo.kdvsiz || "",
        "{{Lira}}": proformaInfo.birim || "TL",
        "{{KdvOran}}": proformaInfo.kdvOran || "20",
        "{{KDV}}": proformaInfo.kdv || "",
        "{{Toplam}}": proformaInfo.toplam || ""
      });

      doc.saveAndClose();
      return { success: true, id: copy.getId(), url: copy.getUrl() };
    } catch (e) {
      BaseService.logError("generateProforma", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Başvuru Formu Üretir (eski basFormu).
   * Tüm placeholder'lar legacy basFormu ile birebir uyumlu.
   */
  generateAppForm: function(info, folderId) {
    try {
      if (info.nbody !== "Medicert" && info.nbody !== "Inspect") {
        throw new Error("Geçersiz nbody değeri: " + info.nbody);
      }

      const tempId = info.nbody === "Medicert"
        ? this._cfg("APP_FORM_MEDICERT")
        : this._cfg("APP_FORM_INSPECT");

      const folder = DriveApp.getFolderById(folderId);
      const fileName = `${info.nickname} - ${info.nbody} Başvuru Formu (S${info.id})`;
      const copy = DriveApp.getFileById(tempId).makeCopy(fileName, folder);
      const doc = DocumentApp.openById(copy.getId());
      const body = doc.getBody();

      // Kapsam: title case (Türkçe)
      const kapsamTitleCase = (info.kapsam || "")
        .toLocaleLowerCase("tr-TR")
        .replace(/(^|\s)\S/g, l => l.toLocaleUpperCase("tr-TR"));

      // Scope: title case (İngilizce)
      const scopeTitleCase = (info.scope || "")
        .toLocaleLowerCase("en-US")
        .replace(/\b\w/g, l => l.toLocaleUpperCase("en-US"));

      this._processReplacements(body, {
        "{{Unvan}}":   info.unvan   || "",
        "{{Adres}}":   info.adres   || "",
        "{{Sehir}}":   info.sehir   || "",
        "{{Ulke}}":    info.ulke    || "",
        "{{Vdaire}}":  info.vergiD  || "",
        "{{Vno}}":     info.vergiN  || "",
        "{{Tel}}":     info.tel     || "",
        "{{Fax}}":     info.faks    || "",
        "{{www}}":     info.www     || "",
        "{{mail}}":    info.mail    || "",
        "{{Yetkili}}": info.yetA    || "",
        "{{YUnvan}}":  info.yetU    || "",
        "{{KYT}}":     info.kyt     || "",
        "{{irtibat}}": info.irtA    || "",
        "{{iUnvan}}":  info.irtU    || "",
        "{{Kapsam}}":  kapsamTitleCase,
        "{{Scope}}":   scopeTitleCase,
        "{{Yapis}}":   info.yapis   || "",
        "{{Calisan}}": info.tcs     || "",
        "{{Yazisma}}": info.yazisma || "",
        "{{qms}}":     info.qms     || "",
        "{{mdd}}":     info.mdd     || "",
        "{{ems}}":     info.ems     || "",
        "{{fsms}}":    info.fsms    || "",
        "{{isms}}":    info.isms    || "",
        "{{ohs}}":     info.ohs     || "",
        "{{eng}}":     info.eng     || "",
        "{{Gmp}}":     info.gmp     || "",
        "{{obi}}":     info.obi     || "",
        "{{Ce}}":      info.ce      || "",
        "{{Oth}}":     info.oth     || "",
        "{{Diger}}":   info.diger   || "",
        "{{OthKapsam}}": info.diger || ""
      });

      doc.saveAndClose();
      return { success: true, id: copy.getId(), url: copy.getUrl() };
    } catch (e) {
      BaseService.logError("generateAppForm", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Worker tarafından yönlendirilen klasör oluşturma side-effect isteğini işler.
   */
  createBatchFolders: function(nick, uniqueSubFolders) {
    try {
      const parentFolderId = DriveService.getCompanyFolderId(nick);
      const docsFolder = DriveService.getOrCreateSubFolder(parentFolderId, "Dokümanlar");
      
      const folderMap = {};
      uniqueSubFolders.forEach(name => {
        const folder = DriveService.getOrCreateSubFolder(docsFolder.getId(), String(name));
        folderMap[name] = folder.getId();
      });
      
      return { success: true, data: folderMap };
    } catch (e) {
      BaseService.logError("createBatchFolders", e);
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
      const targetFolder = DriveApp.getFolderById(folderMap[subFolder]);

      const copy = DriveApp.getFileById(tempId).makeCopy(fileName, targetFolder);

      if (type === "Docs") {
        const doc = DocumentApp.openById(copy.getId());
        if (data.logo) {
          this._insertLogoInHeaders(doc, data.logo);
          this._insertLogoInBody(doc, data.logo);
        }

        const header = doc.getHeader();
        if (header) {
          this._processReplacements(header, {
            "{{dokKodu}}": code,
            "{{revNo}}":   data.revNo  || "00",
            "{{unvan}}":   data.unvan  || ""
          });
        }

        const footer = doc.getFooter();
        if (footer) {
          this._processReplacements(footer, {
            "{{dokKodu}}": code,
            "{{revNo}}":   data.revNo  || "00",
            "{{unvan}}":   data.unvan  || ""
          });
        }

        this._processReplacements(doc.getBody(), {
          "{{dokKodu}}": code,
          "{{revNo}}":   data.revNo  || "00",
          "{{unvan}}":   data.unvan  || ""
        });
        doc.saveAndClose();
      }

      return { success: true, id: copy.getId(), name: fileName };
    } catch (e) {
      BaseService.logError("generateSingleBatchDoc", e);
      return { success: false, error: e.message };
    }
  },

  // ─── Private Helpers ────────────────────────────────────────────────────────

  _processReplacements: function(container, map) {
    for (const key in map) {
      container.replaceText(key, map[key] || "");
    }
  },

  _replaceImage: function(body, placeholder, fileId, height = 50) {
    try {
      const range = body.findText(placeholder);
      if (!range) return;

      const blob = DriveApp.getFileById(fileId).getBlob();
      const element = range.getElement();
      const parentParagraph = element.getParent().asParagraph();

      // Clear the placeholder text
      element.asText().setText("");

      // Add as PositionedImage (Above Text)
      const posImg = parentParagraph.addPositionedImage(blob)
        .setLayout(DocumentApp.PositionedLayout.ABOVE_TEXT);
      
      const w = posImg.getWidth(); // Capture original dimensions
      const h = posImg.getHeight();
      
      posImg.setHeight(height);
      posImg.setWidth(Math.round((height * w) / h));

    } catch (e) {
      BaseService.logError("_replaceImage", e);
      body.replaceText(placeholder, "");
    }
  },

  /**
   * Legacy isim uyumu: insertLogoInAllHeaderSections -> _insertLogoInHeaders
   */
  _insertLogoInHeaders: function(doc, logoBlob) {
    return this._insertLogoInAllHeaderSections(doc, logoBlob);
  },

  /**
   * Legacy isim uyumu: insertLogoInBodyAndTables -> _insertLogoInBody
   */
  _insertLogoInBody: function(doc, logoBlob) {
    return this._insertLogoInBodyAndTables(doc, logoBlob);
  },

  _insertLogoInAllHeaderSections: function(doc, logoBlob) {
    try {
      const header = doc.getHeader();
      if (!header) return;

      const labelVariants = ["{{logo}}", "<<logo>>", "{{Logo}}"];
      const targetHeightPts = 28.35; // 1 cm = 28.35 points

      labelVariants.forEach(label => {
        let found = header.findText(label);
        while (found) {
          const elem = found.getElement();
          const parent = elem.getParent();
          let targetParagraph = null;

          if (parent.getType() === DocumentApp.ElementType.TABLE_CELL) {
            targetParagraph = parent.asTableCell().getChild(0).asParagraph();
          } else if (parent.getType() === DocumentApp.ElementType.PARAGRAPH) {
            targetParagraph = parent.asParagraph();
          }

          if (targetParagraph) {
            this._clearLabels(targetParagraph, [label]);
            this._addInlineImage(targetParagraph, logoBlob, targetHeightPts);
          } else {
             header.replaceText(label, "");
          }
          found = header.findText(label);
        }
      });
    } catch (e) {
      BaseService.logError("_insertLogoInAllHeaderSections", e);
    }
  },

  _insertLogoInBodyAndTables: function(doc, logoBlob) {
    try {
      const body = doc.getBody();
      const labelVariants = ["{{logo}}", "<<logo>>", "{{Logo}}"];
      const targetHeightPts = 28.35; // 1 cm

      labelVariants.forEach(label => {
        let found = body.findText(label);
        while (found) {
          const elem = found.getElement();
          const parent = elem.getParent();
          let targetParagraph = null;

          if (parent.getType() === DocumentApp.ElementType.TABLE_CELL) {
            targetParagraph = parent.asTableCell().getChild(0).asParagraph();
          } else if (parent.getType() === DocumentApp.ElementType.PARAGRAPH) {
            targetParagraph = parent.asParagraph();
          }

          if (targetParagraph) {
            this._clearLabels(targetParagraph, [label]);
            this._addInlineImage(targetParagraph, logoBlob, targetHeightPts);
          } else {
             body.replaceText(label, "");
          }
          found = body.findText(label);
        }
      });
    } catch (e) {
      BaseService.logError("_insertLogoInBodyAndTables", e);
    }
  },

  _addInlineImage: function(paragraph, blob, targetHeight) {
    try {
      const img = paragraph.appendInlineImage(blob);
      const ratio = targetHeight / img.getHeight();
      img.setHeight(targetHeight);
      img.setWidth(img.getWidth() * ratio);
      
      // Üst satır ile logoyu ayırmak için paragraf öncesi boşluk (12 pt)
      paragraph.setSpacingBefore(12);
    } catch (e) {
      BaseService.logError("_addInlineImage", e);
      paragraph.appendText("RESİM EKLENEMEDİ: " + e.message);
    }
  },

  /**
   * Eski yöntem, sadece Sign vb. için korunmuştur.
   */
  _addFloatingImage: function(paragraph, blob, width, isCentered) {
    try {
      const posImg = paragraph.addPositionedImage(blob)
        .setLayout(DocumentApp.PositionedLayout.ABOVE_TEXT)
        .setWidth(width);
      
      const ratio = width / posImg.getWidth();
      posImg.setHeight(posImg.getHeight() * ratio);

      if (isCentered) {
        const pageWidth = 595; // A4 Standard
        const leftOffset = (pageWidth - width) / 2 - 72; // 72 is typical margin fallback
        posImg.setLeftOffset(Math.max(0, leftOffset));
      }
    } catch (e) {
      BaseService.logError("_addFloatingImage", e);
    }
  },

  _clearLabels: function(container, labels) {
    labels.forEach(label => container.replaceText(label, ""));
  },

  _containsAnyLabel: function(text, labels) {
    const lowerText = String(text || "").toLowerCase();
    return labels.some(label => lowerText.includes(String(label).toLowerCase()));
  },

  _fitImageToMaxWidth: function(img, maxWidthPx) {
    const width = img.getWidth();
    const height = img.getHeight();
    if (width <= 0 || height <= 0 || width <= maxWidthPx) return;
    const ratio = maxWidthPx / width;
    img.setWidth(maxWidthPx);
    img.setHeight(Math.round(height * ratio));
  },

  _generateQr: function(doc, link) {
    try {
      if (!link) return;

      const footer = doc.getFooter();
      if (!footer) return;

      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(link)}`;
      const blob = UrlFetchApp.fetch(qrUrl).getBlob();

      // Footer'daki ilk paragrafa sabit konumlu olarak ekle
      // Kullanıcı talebi: x:18 y:27
      const paragraph = footer.getChild(0).asParagraph();
      
      // Varsa eski QrKod yer tutucusunu temizle
      footer.replaceText("{{QrKod}}", "");

      paragraph.addPositionedImage(blob)
        .setLayout(DocumentApp.PositionedLayout.ABOVE_TEXT)
        .setLeftOffset(510)
        .setTopOffset(3)
        .setWidth(90)
        .setHeight(90);

    } catch (e) {
      BaseService.logError("_generateQr", e);
    }
  },

  /**
   * Legacy testTarihString karşılığı.
   */
  _parseFlexibleDate: function(value) {
    if (!value) return null;
    if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
      return new Date(value.getTime());
    }
    const raw = String(value).trim();
    if (!raw) return null;

    const dmyDate = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (dmyDate) {
      return new Date(parseInt(dmyDate[3], 10), parseInt(dmyDate[2], 10) - 1, parseInt(dmyDate[1], 10), 0, 0, 0, 0);
    }

    const dmyDateTime = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (dmyDateTime) {
      return new Date(
        parseInt(dmyDateTime[3], 10),
        parseInt(dmyDateTime[2], 10) - 1,
        parseInt(dmyDateTime[1], 10),
        parseInt(dmyDateTime[4], 10),
        parseInt(dmyDateTime[5], 10),
        0,
        0
      );
    }

    const parsed = new Date(raw);
    return isNaN(parsed.getTime()) ? null : parsed;
  },

  _formatTestDate: function(isoString, format, timeZone) {
    if (!isoString) return "";
    try {
      const date = this._parseFlexibleDate(isoString);
      if (!date || isNaN(date.getTime())) return String(isoString);
      const tz = timeZone || Session.getScriptTimeZone();
      return Utilities.formatDate(date, tz, format || "dd.MM.yyyy");
    } catch (_) {
      return String(isoString);
    }
  },

  _formatDate: function(dateStr, lang) {
    if (!dateStr || !dateStr.includes(".")) return dateStr || "";
    const months = {
      TR: ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"],
      EN: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    };
    const parts = dateStr.split(".");
    const mIndex = parseInt(parts[1]) - 1;
    const monthList = months[lang] || months["TR"];
    return `${monthList[mIndex]} ${parts[0]}, ${parts[2]}`;
  }
};
