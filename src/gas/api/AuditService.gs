/**
 * 📅 Denetim & Gözetim Servisi
 *
 * Google Takvim entegrasyonu, denetim planlama (Aşama 1-2)
 * ve sertifika gözetim durumlarının (Arşiv/Ana Takvim) yönetimi.
 */
const AuditService = {
  sheetName: "audits",
  CALENDAR_MAIN:    "ukqd4fqmgujdhemc4slhmebgcc@group.calendar.google.com",
  CALENDAR_SOURCE:  "d43d3fe59ccf1ff2e9ef23eb1fcbec9e8caf68568b733e3f9e8c8bc53d91c09e@group.calendar.google.com",
  CALENDAR_ARCHIVE: "b5768ed3d388c17023448785350956fd1dbe2987eaaf4362d2e1c7d5f5627746@group.calendar.google.com",

  _calendarId: function(key) {
    const prop = PropertiesService.getScriptProperties().getProperty(key);
    if (prop && String(prop).trim()) return String(prop).trim();
    if (key === "CALENDAR_MAIN") return this.CALENDAR_MAIN;
    if (key === "CALENDAR_SOURCE") return this.CALENDAR_SOURCE;
    if (key === "CALENDAR_ARCHIVE") return this.CALENDAR_ARCHIVE;
    return "";
  },

  _valueFromInfo: function(auditInfo, aliases, fallback) {
    const list = Array.isArray(aliases) ? aliases : [aliases];
    for (const key of list) {
      if (auditInfo[key] !== undefined && auditInfo[key] !== null && auditInfo[key] !== "") {
        return auditInfo[key];
      }
    }
    return fallback !== undefined ? fallback : "";
  },

  _buildRowByHeaders: function(headers, auditInfo, idValue, a1EventId, a2EventId) {
    return headers.map(header => {
      const n = BaseService.normalizeHeader(header);

      if (n === "id") return idValue;
      if (n === "nickname" || n === "nick") return this._valueFromInfo(auditInfo, ["nickname", "nick"]);
      if (n === "firmano") return this._valueFromInfo(auditInfo, ["firma_no", "firmaNo", "firmano"]);
      if (n === "sertifikaid") return this._valueFromInfo(auditInfo, ["sertifika_id", "sertifikaId", "certId"]);
      if (n === "standart") return this._valueFromInfo(auditInfo, ["standart"]);
      if (n === "denetimtipi") return this._valueFromInfo(auditInfo, ["denetim_tipi", "denetimTipi", "denetim"]);

      // Aşama 1
      if (n === "a1auditor") return this._valueFromInfo(auditInfo, ["a1_auditor", "a1Auditor", "a1Denetci"]);
      if (n === "a1lead") return this._valueFromInfo(auditInfo, ["a1_lead", "a1Lead", "a1Basdenetci"]);
      if (n === "a1baslangic") return this._valueFromInfo(auditInfo, ["a1_baslangic", "a1Basla"]);
      if (n === "a1bitis") return this._valueFromInfo(auditInfo, ["a1_bitis", "a1Bitis"]);
      if (n === "a1manday") return this._valueFromInfo(auditInfo, ["a1_manday", "a1Md"], "");
      if (n === "a1basdenetci") return this._valueFromInfo(auditInfo, ["a1_bas_denetci", "a1La"], "");
      if (n === "a1denetci2") return this._valueFromInfo(auditInfo, ["a1_denetci_2", "a1Fa"], "");
      if (n === "a1denetci3") return this._valueFromInfo(auditInfo, ["a1_denetci_3", "a1Sa"], "");

      // Aşama 2
      if (n === "a2auditor") return this._valueFromInfo(auditInfo, ["a2_auditor", "a2Auditor", "a2Denetci"]);
      if (n === "a2lead") return this._valueFromInfo(auditInfo, ["a2_lead", "a2Lead", "a2Basdenetci"]);
      if (n === "a2baslangic") return this._valueFromInfo(auditInfo, ["a2_baslangic", "a2Basla"]);
      if (n === "a2bitis") return this._valueFromInfo(auditInfo, ["a2_bitis", "a2Bitis"]);
      if (n === "a2manday") return this._valueFromInfo(auditInfo, ["a2_manday", "a2Md"], "");
      if (n === "a2basdenetci") return this._valueFromInfo(auditInfo, ["a2_bas_denetci", "a2La"], "");
      if (n === "a2denetci2") return this._valueFromInfo(auditInfo, ["a2_denetci_2", "a2Fa"], "");
      if (n === "a2denetci3") return this._valueFromInfo(auditInfo, ["a2_denetci_3", "a2Sa"], "");

      // Standartlar
      if (n === "qms") return this._valueFromInfo(auditInfo, ["qms"], "");
      if (n === "mdd") return this._valueFromInfo(auditInfo, ["mdd"], "");
      if (n === "ems") return this._valueFromInfo(auditInfo, ["ems"], "");
      if (n === "ohs") return this._valueFromInfo(auditInfo, ["ohs"], "");
      if (n === "fsms") return this._valueFromInfo(auditInfo, ["fsms"], "");
      if (n === "isms") return this._valueFromInfo(auditInfo, ["isms"], "");
      if (n === "engy") return this._valueFromInfo(auditInfo, ["engy"], "");
      if (n === "gmp") return this._valueFromInfo(auditInfo, ["gmp"], "");

      // Kapsam / Event
      if (n === "a1kapsam") return this._valueFromInfo(auditInfo, ["a1_kapsam", "a1kDenet"], "");
      if (n === "a2kapsam") return this._valueFromInfo(auditInfo, ["a2_kapsam", "a2kDenet"], "");
      if (n === "a1eventid") return a1EventId || "";
      if (n === "a2eventid") return a2EventId || "";
      if (n === "updatedat") return new Date().getTime();

      return this._valueFromInfo(auditInfo, [header], "");
    });
  },

  _pickCell: function(row, idx, fallback) {
    if (!idx || idx < 1) return fallback !== undefined ? fallback : "";
    return row[idx - 1];
  },

  _parseDateTime: function(value, hhmm) {
    if (!value) return null;
    if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
      const cloned = new Date(value.getTime());
      const t = String(hhmm || "").trim();
      const tm = t.match(/^(\d{1,2}):(\d{2})$/);
      if (tm) {
        cloned.setHours(parseInt(tm[1], 10), parseInt(tm[2], 10), 0, 0);
      }
      return cloned;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    const dmy = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (dmy) {
      const day = parseInt(dmy[1], 10);
      const month = parseInt(dmy[2], 10) - 1;
      const year = parseInt(dmy[3], 10);
      const t = String(hhmm || "00:00").trim();
      const tm = t.match(/^(\d{1,2}):(\d{2})$/);
      const hour = tm ? parseInt(tm[1], 10) : 0;
      const minute = tm ? parseInt(tm[2], 10) : 0;
      return new Date(year, month, day, hour, minute, 0, 0);
    }

    const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (ymd) {
      const year = parseInt(ymd[1], 10);
      const month = parseInt(ymd[2], 10) - 1;
      const day = parseInt(ymd[3], 10);
      const t = String(hhmm || "00:00").trim();
      const tm = t.match(/^(\d{1,2}):(\d{2})$/);
      const hour = tm ? parseInt(tm[1], 10) : 0;
      const minute = tm ? parseInt(tm[2], 10) : 0;
      return new Date(year, month, day, hour, minute, 0, 0);
    }

    const parsed = new Date(raw);
    return isNaN(parsed.getTime()) ? null : parsed;
  },

  _upsertCalendarEvent: function(cal, eventId, title, startDate, endDate, description) {
    if (!cal || !title || !startDate || !endDate) return eventId || "";
    try {
      if (eventId) {
        const existing = cal.getEventById(eventId);
        if (existing) {
          existing.setTitle(title);
          existing.setTime(startDate, endDate);
          if (description !== undefined) existing.setDescription(description || "");
          return existing.getId();
        }
      }
      const created = cal.createEvent(title, startDate, endDate, { description: description || "" });
      return created.getId();
    } catch (e) {
      BaseService.logError("_upsertCalendarEvent", e, { eventId: eventId });
      return eventId || "";
    }
  },

  _extractAuditInfoFromRow: function(headers, row) {
    const info = {};
    headers.forEach((header, idx) => {
      const n = BaseService.normalizeHeader(header);
      const val = row[idx];
      if (n === "nickname" || n === "nick") info.nickname = val;
      else if (n === "firmano") {
        info.firma_no = val;
        info.firmano = val;
      }
      else if (n === "sertifikaid") {
        info.sertifika_id = val;
        info.sertifikaId = val;
      }
      else if (n === "standart") info.standart = val;
      else if (n === "denetimtipi") {
        info.denetim = val;
        info.denetim_tipi = val;
      }
      else if (n === "a1auditor") info.a1Denetci = val;
      else if (n === "a1lead") info.a1Lead = val;
      else if (n === "a1baslangic") {
        info.a1Basla = val;
        info.a1_baslangic = val;
      }
      else if (n === "a1bitis") {
        info.a1Bitis = val;
        info.a1_bitis = val;
      }
      else if (n === "a1manday") {
        info.a1Md = val;
        info.a1_manday = val;
      }
      else if (n === "a1basdenetci") {
        info.a1La = val;
        info.a1_bas_denetci = val;
      }
      else if (n === "a1denetci2") {
        info.a1Fa = val;
        info.a1_denetci_2 = val;
      }
      else if (n === "a1denetci3") {
        info.a1Sa = val;
        info.a1_denetci_3 = val;
      }
      else if (n === "a2auditor") info.a2Denetci = val;
      else if (n === "a2lead") info.a2Lead = val;
      else if (n === "a2baslangic") {
        info.a2Basla = val;
        info.a2_baslangic = val;
      }
      else if (n === "a2bitis") {
        info.a2Bitis = val;
        info.a2_bitis = val;
      }
      else if (n === "a2manday") {
        info.a2Md = val;
        info.a2_manday = val;
      }
      else if (n === "a2basdenetci") {
        info.a2La = val;
        info.a2_bas_denetci = val;
      }
      else if (n === "a2denetci2") {
        info.a2Fa = val;
        info.a2_denetci_2 = val;
      }
      else if (n === "a2denetci3") {
        info.a2Sa = val;
        info.a2_denetci_3 = val;
      }
      else if (n === "qms") info.qms = val;
      else if (n === "mdd") info.mdd = val;
      else if (n === "ems") info.ems = val;
      else if (n === "ohs") info.ohs = val;
      else if (n === "fsms") info.fsms = val;
      else if (n === "isms") info.isms = val;
      else if (n === "engy") info.engy = val;
      else if (n === "gmp") info.gmp = val;
      else if (n === "a1kapsam") {
        info.a1kDenet = val;
        info.a1_kapsam = val;
      }
      else if (n === "a2kapsam") {
        info.a2kDenet = val;
        info.a2_kapsam = val;
      }
      else if (n === "a1eventid") info.a1EventId = val;
      else if (n === "a2eventid") info.a2EventId = val;
    });
    return info;
  },

  /**
   * Yaklaşan ve geçmiş denetimleri listeler.
   * Tüm alan haritası AI_CONTEXT Denetim şemasına uygun.
   */
  getAudits: function() {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName(this.sheetName);
      const lastRow = ws.getLastRow();
      if (lastRow < 2) return [];

      const lastCol = ws.getLastColumn();
      const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
      const data = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();

      const cols = {
        id: BaseService.findHeaderIndex(headers, ["id", "ID"]),
        nick: BaseService.findHeaderIndex(headers, ["nick", "nickname", "Nickname", "Nick", "Firma Adı"]),
        firmaNo: BaseService.findHeaderIndex(headers, ["firma_no", "Firma No", "FirmaNo"]),
        standart: BaseService.findHeaderIndex(headers, ["standart", "Standart", "Standard"]),
        denetimTipi: BaseService.findHeaderIndex(headers, ["denetim_tipi", "Denetim Tipi", "Denetim"]),
        a1Auditor: BaseService.findHeaderIndex(headers, ["a1_auditor", "A1 Auditors", "A1 Denetçi"]),
        a1Lead: BaseService.findHeaderIndex(headers, ["a1_lead", "A1 Lead", "A1 Başdenetçi"]),
        a1Basla: BaseService.findHeaderIndex(headers, ["a1_baslangic", "A1 Başla"]),
        a1Bitis: BaseService.findHeaderIndex(headers, ["a1_bitis", "A1 Bitiş"]),
        a1Md: BaseService.findHeaderIndex(headers, ["a1_manday", "A1 MD", "A1 Adam/Gün"]),
        a1La: BaseService.findHeaderIndex(headers, ["a1_bas_denetci", "A1 LA"]),
        a1Fa: BaseService.findHeaderIndex(headers, ["a1_denetci_2", "A1 FA"]),
        a1Sa: BaseService.findHeaderIndex(headers, ["a1_denetci_3", "A1 SA"]),
        a2Auditor: BaseService.findHeaderIndex(headers, ["a2_auditor", "A2 Auditors", "A2 Denetçi"]),
        a2Lead: BaseService.findHeaderIndex(headers, ["a2_lead", "A2 Lead", "A2 Başdenetçi"]),
        a2Basla: BaseService.findHeaderIndex(headers, ["a2_baslangic", "A2 Başla"]),
        a2Bitis: BaseService.findHeaderIndex(headers, ["a2_bitis", "A2 Bitiş"]),
        a2Md: BaseService.findHeaderIndex(headers, ["a2_manday", "A2 MD", "A2 Adam/Gün"]),
        a2La: BaseService.findHeaderIndex(headers, ["a2_bas_denetci", "A2 LA"]),
        a2Fa: BaseService.findHeaderIndex(headers, ["a2_denetci_2", "A2 FA"]),
        a2Sa: BaseService.findHeaderIndex(headers, ["a2_denetci_3", "A2 SA"]),
        qms: BaseService.findHeaderIndex(headers, ["qms", "QMS"]),
        mdd: BaseService.findHeaderIndex(headers, ["mdd", "MDD"]),
        ems: BaseService.findHeaderIndex(headers, ["ems", "EMS"]),
        ohs: BaseService.findHeaderIndex(headers, ["ohs", "OHS"]),
        fsms: BaseService.findHeaderIndex(headers, ["fsms", "FSMS"]),
        isms: BaseService.findHeaderIndex(headers, ["isms", "ISMS"]),
        engy: BaseService.findHeaderIndex(headers, ["engy", "ENGY", "ENGY."]),
        gmp: BaseService.findHeaderIndex(headers, ["gmp", "GMP"]),
        a1kDenet: BaseService.findHeaderIndex(headers, ["a1_kapsam", "A1 KDenet", "A1 Kapsam"]),
        a2kDenet: BaseService.findHeaderIndex(headers, ["a2_kapsam", "A2 KDenet", "A2 Kapsam"]),
        a1EventId: BaseService.findHeaderIndex(headers, ["a1_event_id", "A1 Event ID"]),
        a2EventId: BaseService.findHeaderIndex(headers, ["a2_event_id", "A2 Event ID"])
      };

      return data.map(r => ({
        id:         this._pickCell(r, cols.id, ""),
        nick:       this._pickCell(r, cols.nick, ""),
        firmaNo:    this._pickCell(r, cols.firmaNo, ""),
        standart:   this._pickCell(r, cols.standart, ""),
        denetimTipi: this._pickCell(r, cols.denetimTipi, ""),
        a1Auditor:  this._pickCell(r, cols.a1Auditor, ""),
        a1Lead:     this._pickCell(r, cols.a1Lead, ""),
        a1Basla:    this._pickCell(r, cols.a1Basla, ""),
        a1Bitis:    this._pickCell(r, cols.a1Bitis, ""),
        a1Md:       this._pickCell(r, cols.a1Md, ""),
        a1La:       this._pickCell(r, cols.a1La, ""),
        a1Fa:       this._pickCell(r, cols.a1Fa, ""),
        a1Sa:       this._pickCell(r, cols.a1Sa, ""),
        a2Auditor:  this._pickCell(r, cols.a2Auditor, ""),
        a2Lead:     this._pickCell(r, cols.a2Lead, ""),
        a2Basla:    this._pickCell(r, cols.a2Basla, ""),
        a2Bitis:    this._pickCell(r, cols.a2Bitis, ""),
        a2Md:       this._pickCell(r, cols.a2Md, ""),
        a2La:       this._pickCell(r, cols.a2La, ""),
        a2Fa:       this._pickCell(r, cols.a2Fa, ""),
        a2Sa:       this._pickCell(r, cols.a2Sa, ""),
        qms:        this._pickCell(r, cols.qms, ""),
        mdd:        this._pickCell(r, cols.mdd, ""),
        ems:        this._pickCell(r, cols.ems, ""),
        ohs:        this._pickCell(r, cols.ohs, ""),
        fsms:       this._pickCell(r, cols.fsms, ""),
        isms:       this._pickCell(r, cols.isms, ""),
        engy:       this._pickCell(r, cols.engy, ""),
        gmp:        this._pickCell(r, cols.gmp, ""),
        a1kDenet:   this._pickCell(r, cols.a1kDenet, ""),
        a2kDenet:   this._pickCell(r, cols.a2kDenet, ""),
        a1EventId:  this._pickCell(r, cols.a1EventId, ""),
        a2EventId:  this._pickCell(r, cols.a2EventId, "")
      })).reverse();
    } catch (e) {
      BaseService.logError("getAudits", e);
      return [];
    }
  },

  /**
   * Yeni bir denetim planlar ve takvime işler.
   * ID üretimi için BaseService.getNextId kullanılır.
   */
  scheduleAudit: function(auditInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        const newID = BaseService.getNextId(this.sheetName);

        let a1EventId = null;
        let a2EventId = null;

        try {
          const cal = CalendarApp.getCalendarById(this._calendarId("CALENDAR_MAIN"));
          if (cal) {
            if (auditInfo.a1kDenet && auditInfo.a1Basla && auditInfo.a1Bitis) {
              const a1Start = this._parseDateTime(auditInfo.a1Basla, "09:00");
              const a1End = this._parseDateTime(auditInfo.a1Bitis, "17:00");
              if (a1Start && a1End) {
                const event1 = cal.createEvent(
                  auditInfo.a1kDenet,
                  a1Start,
                  a1End,
                  { description: `${auditInfo.nick} ISO ${auditInfo.standart} - Aşama 1 denetimi. ID: ${newID}` }
                );
                a1EventId = event1.getId();
              }
            }

            if (auditInfo.a2kDenet && auditInfo.a2Basla && auditInfo.a2Bitis) {
              const a2Start = this._parseDateTime(auditInfo.a2Basla, "09:00");
              const a2End = this._parseDateTime(auditInfo.a2Bitis, "17:00");
              if (a2Start && a2End) {
                const event2 = cal.createEvent(
                  auditInfo.a2kDenet,
                  a2Start,
                  a2End,
                  { description: `${auditInfo.nick} ISO ${auditInfo.standart} - Aşama 2 denetimi. ID: ${newID}` }
                );
                a2EventId = event2.getId();
              }
            }
          }
        } catch (calErr) {
          BaseService.logError("scheduleAudit:Calendar", calErr);
        }

        const newRow = this._buildRowByHeaders(headers, auditInfo || {}, newID, a1EventId, a2EventId);
        ws.appendRow(newRow);

        return { success: true, id: newID };
      }, 30000, "AuditService.scheduleAudit");
    } catch (e) {
      BaseService.logError("scheduleAudit", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Mevcut denetim kaydını günceller ve varsa ilgili Calendar event'lerini
   * create yerine update ederek duplicate riskini engeller.
   */
  updateAudit: function(id, auditInfo) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName(this.sheetName);
        const lastRow = ws.getLastRow();
        if (lastRow < 2) throw new Error("Güncellenecek denetim bulunamadı.");

        const lastCol = ws.getLastColumn();
        const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
        const idCol = BaseService.findHeaderIndex(headers, ["ID"]);
        if (idCol < 1) throw new Error("ID sütunu bulunamadı.");

        const rows = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
        const rowIndex = rows.findIndex(r => String(r[idCol - 1]) === String(id));
        if (rowIndex === -1) throw new Error("Denetim bulunamadı: " + id);

        const rowNum = rowIndex + 2;
        const currentRow = rows[rowIndex];
        const currentInfo = this._extractAuditInfoFromRow(headers, currentRow);
        const merged = Object.assign({}, currentInfo, auditInfo || {});

        const cal = CalendarApp.getCalendarById(this._calendarId("CALENDAR_MAIN"));

        const a1Start = this._parseDateTime(merged.a1Basla, "09:00");
        const a1End = this._parseDateTime(merged.a1Bitis, "17:00");
        const a2Start = this._parseDateTime(merged.a2Basla, "09:00");
        const a2End = this._parseDateTime(merged.a2Bitis, "17:00");
        const desc1 = `${merged.nick || ""} ISO ${merged.standart || ""} - Aşama 1 denetimi. ID: ${id}`;
        const desc2 = `${merged.nick || ""} ISO ${merged.standart || ""} - Aşama 2 denetimi. ID: ${id}`;

        const a1EventId = this._upsertCalendarEvent(cal, merged.a1EventId || "", merged.a1kDenet, a1Start, a1End, desc1);
        const a2EventId = this._upsertCalendarEvent(cal, merged.a2EventId || "", merged.a2kDenet, a2Start, a2End, desc2);

        const fullRow = this._buildRowByHeaders(headers, merged, String(id), a1EventId, a2EventId);
        ws.getRange(rowNum, 1, 1, headers.length).setValues([fullRow]);
        return { success: true };
      }, 30000, "AuditService.updateAudit");
    } catch (e) {
      BaseService.logError("updateAudit", e, { id: id });
      return { success: false, error: e.message };
    }
  },

  /**
   * Sertifika gözetim durumunu günceller ve takvimler arası taşır.
   * Yeni oluşturulan event ID sheet'e geri yazılır (legacy ile birebir uyumlu).
   * Davetliler (guests) yeni etkinliğe kopyalanır.
   */
  updateSurveillance: function(ids, status) {
    try {
      return BaseService.withScriptLock(() => {
        const ss = BaseService.openSS();
        const ws = ss.getSheetByName("certificates");
        const lastRow = ws.getLastRow();
        if (lastRow < 2) return { success: true };

        const lastCol = ws.getLastColumn();
        const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
        const idCol = BaseService.findHeaderIndex(headers, ["ID"]);
        const gozetimCol = BaseService.findHeaderIndex(headers, ["gozetim_confirmed", "Gözetim Conf.", "Gözetim"]);
        const eventCol = BaseService.findHeaderIndex(headers, ["calendar_id", "Calendar ID", "Event ID"]);
        const tsCol = BaseService.findHeaderIndex(headers, ["updated_at"]);

        if (idCol < 1) throw new Error("ID sütunu bulunamadı.");
        if (gozetimCol < 1) throw new Error("gozetim_confirmed sütunu bulunamadı.");

        const data = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
        const sourceCal  = CalendarApp.getCalendarById(this._calendarId("CALENDAR_SOURCE"));
        const archiveCal = CalendarApp.getCalendarById(this._calendarId("CALENDAR_ARCHIVE"));

        ids.forEach(id => {
          const rowIndex = data.findIndex(r => String(r[idCol - 1]) === String(id));
          if (rowIndex === -1) return;

          const rowNum = rowIndex + 2;
          const eventId = eventCol > 0 ? data[rowIndex][eventCol - 1] : "";

          ws.getRange(rowNum, gozetimCol).setValue(status ? "TRUE" : "FALSE");
          if (tsCol > 0) ws.getRange(rowNum, tsCol).setValue(new Date().getTime());

          if (eventId && eventCol > 0) {
            const newEventId = this._moveCalendarEvent(eventId, status, sourceCal, archiveCal);
            if (newEventId) {
              ws.getRange(rowNum, eventCol).setValue(newEventId);
            }
          }
        });

        return { success: true };
      }, 30000, "AuditService.updateSurveillance");
    } catch (e) {
      BaseService.logError("updateSurveillance", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Helper: Takvimler arası etkinlik taşıma.
   * Davetlileri, açıklamayı ve konumu kopyalar.
   * Yeni event ID'yi döner — çağıran bunu sheet'e yazmalıdır.
   */
  _moveCalendarEvent: function(eventId, status, sourceCal, archiveCal) {
    let newEvent = null;
    try {
      const fromCal = status ? sourceCal : archiveCal;
      const toCal   = status ? archiveCal : sourceCal;

      const event = fromCal.getEventById(eventId);
      if (!event) return null;

      const guests = event.getGuestList().map(g => g.getEmail()).join(",");

      newEvent = toCal.createEvent(
        event.getTitle(),
        event.getStartTime(),
        event.getEndTime(),
        {
          description: event.getDescription(),
          location:    event.getLocation(),
          guests:      guests,
          sendInvites: false
        }
      );

      // Ana takvime (FALSE → aktif gözetim) taşınıyorsa 1 hafta hatırlatıcı ekle
      if (!status) {
        newEvent.addPopupReminder(10080);
      }

      try {
        event.deleteEvent();
      } catch (deleteErr) {
        // Eski event silinemezse duplicate bırakmamak için yeni event'i geri al.
        try { if (newEvent) newEvent.deleteEvent(); } catch (_) {}
        BaseService.logError("_moveCalendarEvent:deleteOriginalFailed", deleteErr, { eventId: eventId });
        return eventId;
      }
      return newEvent.getId();
    } catch (e) {
      BaseService.logError("_moveCalendarEvent", e);
      return null;
    }
  }
};
