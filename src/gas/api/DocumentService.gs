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
    APP_FORM_MEDICERT: "1CYQgtEtpIeQMAZHtw6JmiR2shcBHM1L9wqX-MzyyzLw",
    APP_FORM_INSPECT:  "1-s53ijssKJw9d5rtpm2BmRJOxkXbfWGCx2IjsBT_xdw",
    CONTRACT_TEMP:     "1bNlf4GOZFsDTzmYJrhTbmVrfZ17P4U_i8im5Vte2gM8",
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
      const targetFolder = DriveService.getOrCreateSubFolder(parentFolderId, year);

      const tempId = lang === "EN" ? entema : trtema;
      const docTemp = DriveApp.getFileById(tempId);

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
        this._insertLogoInHeaders(doc, logo);
        this._insertLogoInBody(doc, logo);
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

      if (!logo) body.replaceText("{{Logo}}", "");

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
      const copyName = lang === "EN"
        ? `${isim} - Draft ${standard} (M${id})`
        : `${isim} - Draft ${standard} ${lang} (M${id})`;

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

      // Legacy ile uyumlu draft arkaplan görseli
      const bgImage = DriveApp.getFileById(this._cfg("DRAFT_BG_ID")).getBlob();
      const searchText = lang === "EN" ? "This is to certify that" : "Bu Sertifika";
      const marker = body.findText(searchText);
      if (marker) {
        const el = marker.getElement();
        el.getParent().asParagraph().addPositionedImage(bgImage)
          .setLayout(DocumentApp.PositionedLayout.ABOVE_TEXT)
          .setLeftOffset(20)
          .setTopOffset(30)
          .setWidth(600)
          .setHeight(600);
      }

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
        "{{Diger}}":   info.diger   || ""
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
      const parent = element.getParent();

      const img = parent.asParagraph().insertInlineImage(0, blob);
      element.asText().setText("");

      const w = img.getWidth();
      const h = img.getHeight();
      img.setHeight(height);
      img.setWidth((height * w) / h);
    } catch (e) {
      BaseService.logError("_replaceImage", e);
      body.replaceText(placeholder, "");
    }
  },

  /**
   * Legacy isim uyumu: insertLogoInAllHeaderSections -> _insertLogoInHeaders
   */
  _insertLogoInHeaders: function(doc, logoId) {
    return this._insertLogoInAllHeaderSections(doc, logoId);
  },

  /**
   * Legacy isim uyumu: insertLogoInBodyAndTables -> _insertLogoInBody
   */
  _insertLogoInBody: function(doc, logoId) {
    return this._insertLogoInBodyAndTables(doc, logoId);
  },

  _insertLogoInAllHeaderSections: function(doc, logoId) {
    try {
      const header = doc.getHeader();
      if (!header) return;

      const parent = header.getParent();
      const blob = DriveApp.getFileById(logoId).getBlob();
      const labelVariants = ["<<logo>>", "{{logo}}", "{{Logo}}"];
      const maxWidthPx = 100;

      for (let i = 0; i < parent.getNumChildren(); i++) {
        const section = parent.getChild(i);
        if (section.getType() !== DocumentApp.ElementType.HEADER_SECTION) continue;

        const headerSection = section.asHeaderSection();
        for (let j = 0; j < headerSection.getNumChildren(); j++) {
          const element = headerSection.getChild(j);
          const type = element.getType();

          if (type === DocumentApp.ElementType.TABLE) {
            const table = element.asTable();
            for (let r = 0; r < table.getNumRows(); r++) {
              const row = table.getRow(r);
              for (let c = 0; c < row.getNumCells(); c++) {
                const cell = row.getCell(c);
                if (!this._containsAnyLabel(cell.getText(), labelVariants)) continue;
                cell.clear();
                const paragraph = cell.appendParagraph("");
                const img = paragraph.insertInlineImage(0, blob);
                this._fitImageToMaxWidth(img, maxWidthPx);
              }
            }
          } else if (type === DocumentApp.ElementType.PARAGRAPH) {
            const paragraph = element.asParagraph();
            if (!this._containsAnyLabel(paragraph.getText(), labelVariants)) continue;
            paragraph.clear();
            const img = paragraph.insertInlineImage(0, blob);
            this._fitImageToMaxWidth(img, maxWidthPx);
          }
        }
      }
    } catch (e) {
      BaseService.logError("_insertLogoInAllHeaderSections", e);
    }
  },

  _insertLogoInBodyAndTables: function(doc, logoId) {
    try {
      const body = doc.getBody();
      const labelVariants = ["{{logo}}", "<<logo>>", "{{Logo}}"];
      const maxWidthPx = 100;
      const blob = DriveApp.getFileById(logoId).getBlob();

      const childCount = body.getNumChildren();
      for (let i = 0; i < childCount; i++) {
        const element = body.getChild(i);
        const type = element.getType();

        if (type === DocumentApp.ElementType.PARAGRAPH) {
          const paragraph = element.asParagraph();
          if (!this._containsAnyLabel(paragraph.getText(), labelVariants)) continue;
          paragraph.clear();
          const img = paragraph.insertInlineImage(0, blob);
          this._fitImageToMaxWidth(img, maxWidthPx);
        } else if (type === DocumentApp.ElementType.TABLE) {
          const table = element.asTable();
          for (let r = 0; r < table.getNumRows(); r++) {
            const row = table.getRow(r);
            for (let c = 0; c < row.getNumCells(); c++) {
              const cell = row.getCell(c);
              if (!this._containsAnyLabel(cell.getText(), labelVariants)) continue;
              cell.clear();
              const paragraph = cell.appendParagraph("");
              const img = paragraph.insertInlineImage(0, blob);
              this._fitImageToMaxWidth(img, maxWidthPx);
            }
          }
        }
      }
    } catch (e) {
      BaseService.logError("_insertLogoInBodyAndTables", e);
    }
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

      const body = doc.getBody();
      const footer = doc.getFooter();
      const range = body.findText("{{QrKod}}") || (footer ? footer.findText("{{QrKod}}") : null);
      if (!range) return;

      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(link)}`;
      const blob = UrlFetchApp.fetch(qrUrl).getBlob();

      const element = range.getElement();
      const parent = element.getParent();

      // Placeholder tablo hücresindeyse inline yerleştir (sabit offset yok).
      if (parent.getType() === DocumentApp.ElementType.TABLE_CELL) {
        const cell = parent.asTableCell();
        cell.clear();
        const paragraph = cell.appendParagraph("");
        const inlineImg = paragraph.insertInlineImage(0, blob);
        inlineImg.setWidth(90).setHeight(90);
        return;
      }

      const textEl = element.asText();
      const start = range.getStartOffset();
      if (start !== -1) {
        textEl.deleteText(start, start + "{{QrKod}}".length - 1);
      } else {
        textEl.replaceText("{{QrKod}}", "");
      }

      const paragraph = textEl.getParent().asParagraph();
      const inlineImg = paragraph.insertInlineImage(0, blob);
      inlineImg.setWidth(90).setHeight(90);
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
