/**
 * 📅 Denetim & Gözetim Servisi
 * 
 * Google Takvim entegrasyonu, denetim planlama (Aşama 1-2)
 * ve sertifika gözetim durumlarının (Arşiv/Ana Takvim) yönetimi.
 */
const AuditService = {
  // Takvim ID'leri (Sabitler)
  CALENDAR_MAIN: "ukqd4fqmgujdhemc4slhmebgcc@group.calendar.google.com",
  CALENDAR_SOURCE: "d43d3fe59ccf1ff2e9ef23eb1fcbec9e8caf68568b733e3f9e8c8bc53d91c09e@group.calendar.google.com",
  CALENDAR_ARCHIVE: "b5768ed3d388c17023448785350956fd1dbe2987eaaf4362d2e1c7d5f5627746@group.calendar.google.com",

  /**
   * Yaklaşan ve geçmiş denetimleri listeler.
   */
  getAudits: function() {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName("Denetim");
      const lastRow = ws.getLastRow();
      if (lastRow < 2) return [];
      
      const data = ws.getRange(2, 1, lastRow - 1, ws.getLastColumn()).getDisplayValues();
      return data.map(r => ({
        id: r[0],
        nick: r[1],
        firmaNo: r[2],
        standart: r[3],
        denetimTipi: r[4],
        a1Tarih: r[9], // Aşama 1 Başla
        a2Tarih: r[15], // Aşama 2 Başla
        denetci1: r[6],
        denetci2: r[8]
      })).reverse(); // En yeni en üstte
    } catch (e) {
      BaseService.logError("getAudits", e);
      return [];
    }
  },

  /**
   * Yeni bir denetim planlar ve takvime işler.
   */
  scheduleAudit: function(auditInfo) {
    try {
      const cal = CalendarApp.getCalendarById(this.CALENDAR_MAIN);
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName("Denetim");

      // ID Oluştur
      const lastRow = ws.getLastRow();
      const newID = lastRow > 1 ? Number(ws.getRange(lastRow, 1).getValue()) + 1 : 1;

      let a1EventId = null;
      let a2EventId = null;

      // Aşama 1 Takvim Etkinliği
      if (auditInfo.a1kDenet && auditInfo.a1Basla && auditInfo.a1Bitis) {
        const event1 = cal.createEvent(
          auditInfo.a1kDenet,
          new Date(`${auditInfo.a1Basla} 09:00`),
          new Date(`${auditInfo.a1Bitis} 17:00`),
          { description: `${auditInfo.nick} ISO ${auditInfo.standart} - Aşama 1 denetimi. ID: ${newID}` }
        );
        a1EventId = event1.getId();
      }

      // Aşama 2 Takvim Etkinliği
      if (auditInfo.a2kDenet && auditInfo.a2Basla && auditInfo.a2Bitis) {
        const event2 = cal.createEvent(
          auditInfo.a2kDenet,
          new Date(`${auditInfo.a2Basla} 09:00`),
          new Date(`${auditInfo.a2Bitis} 17:00`),
          { description: `${auditInfo.nick} ISO ${auditInfo.standart} - Aşama 2 denetimi. ID: ${newID}` }
        );
        a2EventId = event2.getId();
      }

      // Kaydı Ekle
      ws.appendRow([
        newID, auditInfo.nick, auditInfo.firmano, auditInfo.standart, auditInfo.denetim,
        auditInfo.a1Full, auditInfo.a1Denetci, auditInfo.a2Full, auditInfo.a2Denetci,
        auditInfo.a1Basla, auditInfo.a1Bitis, "", "", "", "", // Md, La, Fa, Sa...
        auditInfo.a2Basla, auditInfo.a2Bitis, "", "", "", "",
        auditInfo.qms, auditInfo.mdd, auditInfo.ems, auditInfo.ohs, auditInfo.fsms, auditInfo.isms, auditInfo.engy,
        auditInfo.gmp || "", auditInfo.a1kDenet || "", auditInfo.a2kDenet || "", a1EventId, a2EventId
      ]);

      return { success: true, id: newID };
    } catch (e) {
      BaseService.logError("scheduleAudit", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Sertifika gözetim durumunu günceller ve takvimler arası taşır.
   */
  updateSurveillance: function(ids, status) {
    try {
      const ss = BaseService.openSS();
      const ws = ss.getSheetByName("Sertifika");
      const data = ws.getRange(2, 1, ws.getLastRow() - 1, 23).getValues();
      const sourceCal = CalendarApp.getCalendarById(this.CALENDAR_SOURCE);
      const archiveCal = CalendarApp.getCalendarById(this.CALENDAR_ARCHIVE);

      ids.forEach(id => {
        const rowIndex = data.findIndex(r => r[0].toString() === id.toString());
        if (rowIndex !== -1) {
          const rowNum = rowIndex + 2;
          const eventId = data[rowIndex][21]; // W Sütunu (22. kolon, 0 indexli: 21)
          
          ws.getRange(rowNum, 20).setValue(status ? "TRUE" : "FALSE");

          if (eventId) {
            this._moveCalendarEvent(eventId, status, sourceCal, archiveCal);
          }
        }
      });

      return { success: true };
    } catch (e) {
      BaseService.logError("updateSurveillance", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Helper: Takvimler arası etkinlik taşıma (Arşiv <-> Ana)
   */
  _moveCalendarEvent: function(eventId, status, sourceCal, archiveCal) {
    try {
      const fromCal = status ? sourceCal : archiveCal;
      const toCal = status ? archiveCal : sourceCal;
      
      const event = fromCal.getEventById(eventId);
      if (!event) return;

      // Yeni takvimde oluştur
      const newEvent = toCal.createEvent(
        event.getTitle(),
        event.getStartTime(),
        event.getEndTime(),
        {
          description: event.getDescription(),
          location: event.getLocation(),
          sendInvites: false
        }
      );

      // Hatırlatıcı Ekle (Eğer Ana Takvime taşıyorsak)
      if (!status) {
        newEvent.addPopupReminder(10080); // 1 Hafta
      }

      // Eskisini sil
      event.deleteEvent();
      
      // Not: Spreadsheet'teki ID güncellenebilir ancak genelde gerek duyulmaz 
      // çünkü createEvent yeni bir ID üretir. Gerekirse rowIndex üzerinden setValue yapılabilir.
    } catch (e) {
      BaseService.logError("_moveCalendarEvent", e);
    }
  }
};
