/**
 * 📅 Denetim & Gözetim Servisi
 *
 * Google Takvim entegrasyonu, denetim planlama (Aşama 1-2)
 * ve sertifika gözetim durumlarının (Arşiv/Ana Takvim) yönetimi.
 */
const AuditService = {
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
      if (n === "nickname" || n === "nick") return this._valueFromInfo(auditInfo, ["nick", "nickname"]);
      if (n === "firmano") return this._valueFromInfo(auditInfo, ["firmano", "firmaNo"]);
      if (n === "standart") return this._valueFromInfo(auditInfo, ["standart"]);
      if (n === "denetimtipi" || n === "denetim") return this._valueFromInfo(auditInfo, ["denetim"]);
      
      // Aşama 1
      if (n === "a1auditors" || n === "a1denetci") return this._valueFromInfo(auditInfo, ["a1Denetci", "a1Full"]);
      if (n === "a1lead" || n === "a1basdenetci") return this._valueFromInfo(auditInfo, ["a1Lead", "a1Denetci"]);
      if (n === "a1basla") return this._valueFromInfo(auditInfo, ["a1Basla", "a1Baslav2"]);
      if (n === "a1bitis") return this._valueFromInfo(auditInfo, ["a1Bitis", "a1Bitisv2"]);
      if (n === "a1md" || n === "a1adamgun") return this._valueFromInfo(auditInfo, ["a1Md"], "");
      if (n === "a1la") return this._valueFromInfo(auditInfo, ["a1La"], "");
      if (n === "a1fa") return this._valueFromInfo(auditInfo, ["a1Fa"], "");
      if (n === "a1sa") return this._valueFromInfo(auditInfo, ["a1Sa"], "");

      // Aşama 2
      if (n === "a2auditors" || n === "a2denetci") return this._valueFromInfo(auditInfo, ["a2Denetci", "a2Full"]);
      if (n === "a2lead" || n === "a2basdenetci") return this._valueFromInfo(auditInfo, ["a2Lead", "a2Denetci"]);
      if (n === "a2basla") return this._valueFromInfo(auditInfo, ["a2Basla", "a2Baslav2"]);
      if (n === "a2bitis") return this._valueFromInfo(auditInfo, ["a2Bitis", "a2Bitisv2"]);
      if (n === "a2md" || n === "a2adamgun") return this._valueFromInfo(auditInfo, ["a2Md"], "");
      if (n === "a2la") return this._valueFromInfo(auditInfo, ["a2La"], "");
      if (n === "a2fa") return this._valueFromInfo(auditInfo, ["a2Fa"], "");
      if (n === "a2sa") return this._valueFromInfo(auditInfo, ["a2Sa"], "");

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
      if (n === "a1kdenet" || n === "a1kapsam") return this._valueFromInfo(auditInfo, ["a1kDenet"], "");
      if (n === "a2kdenet" || n === "a2kapsam") return this._valueFromInfo(auditInfo, ["a2kDenet"], "");
      if (n === "a1eventid") return a1EventId || "";
      if (n === "a2eventid") return a2EventId || "";

      return this._valueFromInfo(auditInfo, [header], "");
    });
  },

  _pickCell: function(row, idx, fallback) {
    if (!idx || idx < 1) return fallback !== undefined ? fallback : "";
    return row[idx - 1];
  },

  _pickCellWithFallback: function(row, idx, legacyIndex, fallback) {
    const headerValue = this._pickCell(row, idx, null);
    if (headerValue !== undefined && headerValue !== null && headerValue !== "") {
      return headerValue;
    }
    if (legacyIndex !== undefined && legacyIndex !== null && legacyIndex >= 0) {
      const legacyValue = row[legacyIndex];
      if (legacyValue !== undefined && legacyValue !== null && legacyValue !== "") {
        return legacyValue;
      }
    }
    return fallback !== undefined ? fallback : "";
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
      if (n === "nickname" || n === "nick") info.nick = val;
      else if (n === "firmano") info.firmaNo = val;
      else if (n === "standart") info.standart = val;
      else if (n === "denetimtipi" || n === "denetim") info.denetim = val;
      else if (n === "a1auditors" || n === "a1denetci") info.a1Denetci = val;
      else if (n === "a1lead" || n === "a1basdenetci") info.a1Lead = val;
      else if (n === "a1basla") info.a1Basla = val;
      else if (n === "a1bitis") info.a1Bitis = val;
      else if (n === "a1md" || n === "a1adamgun") info.a1Md = val;
      else if (n === "a1la") info.a1La = val;
      else if (n === "a1fa") info.a1Fa = val;
      else if (n === "a1sa") info.a1Sa = val;
      else if (n === "a2auditors" || n === "a2denetci") info.a2Denetci = val;
      else if (n === "a2lead" || n === "a2basdenetci") info.a2Lead = val;
      else if (n === "a2basla") info.a2Basla = val;
      else if (n === "a2bitis") info.a2Bitis = val;
      else if (n === "a2md" || n === "a2adamgun") info.a2Md = val;
      else if (n === "a2la") info.a2La = val;
      else if (n === "a2fa") info.a2Fa = val;
      else if (n === "a2sa") info.a2Sa = val;
      else if (n === "qms") info.qms = val;
      else if (n === "mdd") info.mdd = val;
      else if (n === "ems") info.ems = val;
      else if (n === "ohs") info.ohs = val;
      else if (n === "fsms") info.fsms = val;
      else if (n === "isms") info.isms = val;
      else if (n === "engy") info.engy = val;
      else if (n === "gmp") info.gmp = val;
      else if (n === "a1kdenet" || n === "a1kapsam") info.a1kDenet = val;
      else if (n === "a2kdenet" || n === "a2kapsam") info.a2kDenet = val;
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
      const ws = ss.getSheetByName("Denetim");
      const lastRow = ws.getLastRow();
      if (lastRow < 2) return [];

      const lastCol = ws.getLastColumn();
      const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
      const data = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();

      const cols = {
        id: BaseService.findHeaderIndex(headers, ["ID"]),
        nick: BaseService.findHeaderIndex(headers, ["Nickname", "Nick", "Firma Adı"]),
        firmaNo: BaseService.findHeaderIndex(headers, ["Firma No", "FirmaNo"]),
        standart: BaseService.findHeaderIndex(headers, ["Standart", "Standard"]),
        denetimTipi: BaseService.findHeaderIndex(headers, ["Denetim Tipi", "Denetim"]),
        a1Auditor: BaseService.findHeaderIndex(headers, ["A1 Auditors", "A1 Denetçi"]),
        a1Lead: BaseService.findHeaderIndex(headers, ["A1 Lead", "A1 Başdenetçi"]),
        a1Basla: BaseService.findHeaderIndex(headers, ["A1 Başla"]),
        a1Bitis: BaseService.findHeaderIndex(headers, ["A1 Bitiş"]),
        a1Md: BaseService.findHeaderIndex(headers, ["A1 MD", "A1 Adam/Gün"]),
        a1La: BaseService.findHeaderIndex(headers, ["A1 LA"]),
        a1Fa: BaseService.findHeaderIndex(headers, ["A1 FA"]),
        a1Sa: BaseService.findHeaderIndex(headers, ["A1 SA"]),
        a2Auditor: BaseService.findHeaderIndex(headers, ["A2 Auditors", "A2 Denetçi"]),
        a2Lead: BaseService.findHeaderIndex(headers, ["A2 Lead", "A2 Başdenetçi"]),
        a2Basla: BaseService.findHeaderIndex(headers, ["A2 Başla"]),
        a2Bitis: BaseService.findHeaderIndex(headers, ["A2 Bitiş"]),
        a2Md: BaseService.findHeaderIndex(headers, ["A2 MD", "A2 Adam/Gün"]),
        a2La: BaseService.findHeaderIndex(headers, ["A2 LA"]),
        a2Fa: BaseService.findHeaderIndex(headers, ["A2 FA"]),
        a2Sa: BaseService.findHeaderIndex(headers, ["A2 SA"]),
        qms: BaseService.findHeaderIndex(headers, ["QMS"]),
        mdd: BaseService.findHeaderIndex(headers, ["MDD"]),
        ems: BaseService.findHeaderIndex(headers, ["EMS"]),
        ohs: BaseService.findHeaderIndex(headers, ["OHS"]),
        fsms: BaseService.findHeaderIndex(headers, ["FSMS"]),
        isms: BaseService.findHeaderIndex(headers, ["ISMS"]),
        engy: BaseService.findHeaderIndex(headers, ["ENGY", "ENGY."]),
        gmp: BaseService.findHeaderIndex(headers, ["GMP"]),
        a1kDenet: BaseService.findHeaderIndex(headers, ["A1 KDenet", "A1 Kapsam"]),
        a2kDenet: BaseService.findHeaderIndex(headers, ["A2 KDenet", "A2 Kapsam"]),
        a1EventId: BaseService.findHeaderIndex(headers, ["A1 Event ID"]),
        a2EventId: BaseService.findHeaderIndex(headers, ["A2 Event ID"])
      };

      return data.map(r => ({
        id: this._pickCellWithFallback(r, cols.id, 0, ""),
        nick: this._pickCellWithFallback(r, cols.nick, 1, ""),
        firmaNo: this._pickCellWithFallback(r, cols.firmaNo, 2, ""),
        standart: this._pickCellWithFallback(r, cols.standart, 3, ""),
        denetimTipi: this._pickCellWithFallback(r, cols.denetimTipi, 4, ""),
        a1Auditor: this._pickCellWithFallback(r, cols.a1Auditor, 6, ""),
        a1Lead: this._pickCellWithFallback(r, cols.a1Lead, 12, ""),
        a1Basla: this._pickCellWithFallback(r, cols.a1Basla, 9, ""),
        a1Bitis: this._pickCellWithFallback(r, cols.a1Bitis, 10, ""),
        a1Md: this._pickCellWithFallback(r, cols.a1Md, 11, ""),
        a1La: this._pickCellWithFallback(r, cols.a1La, 12, ""),
        a1Fa: this._pickCellWithFallback(r, cols.a1Fa, 13, ""),
        a1Sa: this._pickCellWithFallback(r, cols.a1Sa, 14, ""),
        a2Auditor: this._pickCellWithFallback(r, cols.a2Auditor, 8, ""),
        a2Lead: this._pickCellWithFallback(r, cols.a2Lead, 18, ""),
        a2Basla: this._pickCellWithFallback(r, cols.a2Basla, 15, ""),
        a2Bitis: this._pickCellWithFallback(r, cols.a2Bitis, 16, ""),
        a2Md: this._pickCellWithFallback(r, cols.a2Md, 17, ""),
        a2La: this._pickCellWithFallback(r, cols.a2La, 18, ""),
        a2Fa: this._pickCellWithFallback(r, cols.a2Fa, 19, ""),
        a2Sa: this._pickCellWithFallback(r, cols.a2Sa, 20, ""),
        qms: this._pickCellWithFallback(r, cols.qms, 21, ""),
        mdd: this._pickCellWithFallback(r, cols.mdd, 22, ""),
        ems: this._pickCellWithFallback(r, cols.ems, 23, ""),
        ohs: this._pickCellWithFallback(r, cols.ohs, 24, ""),
        fsms: this._pickCellWithFallback(r, cols.fsms, 25, ""),
        isms: this._pickCellWithFallback(r, cols.isms, 26, ""),
        engy: this._pickCellWithFallback(r, cols.engy, 27, ""),
        gmp: this._pickCellWithFallback(r, cols.gmp, 28, ""),
        a1kDenet: this._pickCellWithFallback(r, cols.a1kDenet, 29, ""),
        a2kDenet: this._pickCellWithFallback(r, cols.a2kDenet, 30, ""),
        a1EventId: this._pickCellWithFallback(r, cols.a1EventId, 31, ""),
        a2EventId: this._pickCellWithFallback(r, cols.a2EventId, 32, "")
      })).reverse();
    } catch (e) {
      BaseService.logError("getAudits", e);
      return [];
    }
  },

  /**
   * Belirli bir firmaya ait denetim kayıtlarını ham satır olarak döner.
   */
  getByFirmaId: function(firmaId) {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName("Denetim");
      const lastRow = ws.getLastRow();
      if (lastRow < 2) return [];

      const lastCol = ws.getLastColumn();
      const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
      const firmaNoCol = BaseService.findHeaderIndex(headers, ["Firma No", "FirmaNo"]);
      if (firmaNoCol < 1) throw new Error("Firma No sütunu bulunamadı.");

      const data = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
      return data.filter(r => String(r[firmaNoCol - 1]) === String(firmaId));
    } catch (e) {
      BaseService.logError("getByFirmaId", e);
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
        const ws = ss.getSheetByName("Denetim");
        const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
        const newID = BaseService.getNextId("Denetim");

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
        const ws = ss.getSheetByName("Denetim");
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
        const ws = ss.getSheetByName("Sertifika");
        const lastRow = ws.getLastRow();
        if (lastRow < 2) return { success: true };

        const lastCol = ws.getLastColumn();
        const headers = ws.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
        const idCol = BaseService.findHeaderIndex(headers, ["ID"]);
        const gozetimCol = BaseService.findHeaderIndex(headers, ["Gözetim Conf.", "Gözetim"]);
        const eventCol = BaseService.findHeaderIndex(headers, ["Calendar ID", "Event ID"]);

        if (idCol < 1) throw new Error("ID sütunu bulunamadı.");
        if (gozetimCol < 1) throw new Error("Gözetim sütunu bulunamadı.");

        const data = ws.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
        const sourceCal  = CalendarApp.getCalendarById(this._calendarId("CALENDAR_SOURCE"));
        const archiveCal = CalendarApp.getCalendarById(this._calendarId("CALENDAR_ARCHIVE"));

        ids.forEach(id => {
          const rowIndex = data.findIndex(r => String(r[idCol - 1]) === String(id));
          if (rowIndex === -1) return;

          const rowNum = rowIndex + 2;
          const eventId = eventCol > 0 ? data[rowIndex][eventCol - 1] : "";

          ws.getRange(rowNum, gozetimCol).setValue(status ? "TRUE" : "FALSE");

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
