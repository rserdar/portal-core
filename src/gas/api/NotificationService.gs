/**
 * 📬 NotificationService: E-posta ve trigger tabanlı bildirim işlemleri
 */
const NotificationService = {
  DEFAULT_FROM: "serdaryavuz@medicert.com.tr",
  DEFAULT_FROM_NAME: "Serdar YAVUZ",
  DEFAULT_REPORT_RECIPIENT: "info@medicert.com.tr",

  _formatDateDots: function(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return "";
    const dd = ("0" + date.getDate()).slice(-2);
    const mm = ("0" + (date.getMonth() + 1)).slice(-2);
    const yyyy = date.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  },

  _parseSheetDate: function(value) {
    if (!value) return null;
    if (value instanceof Date && !isNaN(value.getTime())) return value;
    if (typeof value === "string" && value.includes(".")) {
      const parts = value.split(".").map(Number);
      if (parts.length === 3 && parts.every(n => !isNaN(n))) {
        const d = new Date(parts[2], parts[1] - 1, parts[0]);
        return isNaN(d.getTime()) ? null : d;
      }
    }
    return null;
  },

  _cell: function(row, idx, fallback) {
    if (!idx || idx < 1) return fallback !== undefined ? fallback : "";
    return row[idx - 1];
  },

  _buildSurveillanceHtml: function(firstName, title, rows, startDate, endDate) {
    const safeFirstName = firstName || "Merhaba";
    const safeTitle = title || "";
    const tableRows = (rows || []).map(row => `
      <tr>
        <td>${row.date || ""}</td>
        <td>${row.firm || ""}</td>
        <td>${row.consultant || ""}</td>
        <td>${row.standard || ""}</td>
        <td>${row.certificateNo || ""}</td>
        <td>${row.accreditation || ""}</td>
      </tr>
    `).join("");

    return `
      <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">
        <p>Sayın ${safeTitle} ${safeFirstName},</p>
        <p>${startDate} - ${endDate} tarih aralığındaki gözetim kayıtlarınız aşağıdadır.</p>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
          <thead>
            <tr style="background:#f5f5f5">
              <th>Tarih</th>
              <th>Firma</th>
              <th>Danışman</th>
              <th>Standart</th>
              <th>Sertifika No</th>
              <th>Akreditasyon</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;
  },

  /**
   * Legacy sendSurv karşılığı.
   * Hem object param hem legacy positional arg ile çalışır.
   */
  sendSurveillanceEmail: function(firstNameOrPayload, fullName, title, email, data, startDate, endDate) {
    try {
      const payload = (typeof firstNameOrPayload === "object" && firstNameOrPayload !== null)
        ? firstNameOrPayload
        : {
            firstName: firstNameOrPayload,
            fullName: fullName,
            title: title,
            email: email,
            data: data,
            startDate: startDate,
            endDate: endDate
          };

      const recipient = payload.email || this.DEFAULT_REPORT_RECIPIENT;
      const htmlBody = this._buildSurveillanceHtml(
        payload.firstName,
        payload.title,
        payload.data || [],
        payload.startDate || "",
        payload.endDate || ""
      );

      GmailApp.sendEmail(recipient, "Gözetim Bilgileri", "", {
        from: this.DEFAULT_FROM,
        name: this.DEFAULT_FROM_NAME,
        htmlBody: htmlBody
      });

      return { success: true };
    } catch (e) {
      BaseService.logError("sendSurveillanceEmail", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Legacy sendEmail karşılığı.
   */
  sendTableReport: function(htmlTable, recipient) {
    try {
      const to = recipient || this.DEFAULT_REPORT_RECIPIENT;
      const body = "Merhaba, aşağıda filtrelenmiş tabloyu bulabilirsiniz:<br><br>" + (htmlTable || "");
      GmailApp.sendEmail(to, "Gözetim Belgeleriniz", "", {
        from: this.DEFAULT_FROM,
        name: this.DEFAULT_FROM_NAME,
        htmlBody: body
      });
      return { success: true };
    } catch (e) {
      BaseService.logError("sendTableReport", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * Legacy monthlyCheck karşılığı.
   * Danışman bazlı gözetim e-postalarını gönderir.
   */
  runMonthlyCheck: function() {
    try {
      const ss = BaseService.openSS();
      const certWs = ss.getSheetByName("certificates");
      const consWs = ss.getSheetByName("consultants");
      if (!certWs) throw new Error("certificates sayfası bulunamadı.");
      if (!consWs) throw new Error("consultants sayfası bulunamadı.");

      const today = new Date();
      // Aralık/Ocak geçişlerinde de net davranış için: [geçen ayın 1'i, +2 ayın 1'i)
      const firstDayCurrentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const startDate = new Date(firstDayCurrentMonth);
      startDate.setMonth(startDate.getMonth() - 1);
      const endDate = new Date(firstDayCurrentMonth);
      endDate.setMonth(endDate.getMonth() + 2);

      // Consultants
      const consLastRow = consWs.getLastRow();
      const consLastCol = consWs.getLastColumn();
      if (consLastRow < 2) return { success: true, sent: 0, matchedRows: 0 };

      const consHeaders = consWs.getRange(1, 1, 1, consLastCol).getDisplayValues()[0].map(h => String(h).trim());
      const consRows = consWs.getRange(2, 1, consLastRow - 1, consLastCol).getDisplayValues();

      const cNameCol = BaseService.findHeaderIndex(consHeaders, ["ad", "Danışman", "Danisman", "Name", "Ad Soyad"]);
      const cEmailCol = BaseService.findHeaderIndex(consHeaders, ["mail", "Email", "E-mail", "Mail"]);
      const cFirstNameCol = BaseService.findHeaderIndex(consHeaders, ["yetkili_adi", "Ad", "First Name", "İsim"]);
      const cLastNameCol = BaseService.findHeaderIndex(consHeaders, ["yetkili_soyad", "Soyad", "Last Name"]);
      const cTitleCol = BaseService.findHeaderIndex(consHeaders, ["hitabet", "Ünvan", "Unvan", "Title"]);

      const consultantsData = {};
      consRows.forEach(row => {
        const name = this._cell(row, cNameCol, row[0] || "");
        if (!name) return;
        const firstName = this._cell(row, cFirstNameCol, "");
        const lastName = this._cell(row, cLastNameCol, "");
        const title = this._cell(row, cTitleCol, "");
        const email = this._cell(row, cEmailCol, this.DEFAULT_REPORT_RECIPIENT) || this.DEFAULT_REPORT_RECIPIENT;
        consultantsData[String(name)] = {
          firstName: firstName || "",
          fullName: `${firstName || ""} ${lastName || ""}`.trim(),
          title: title || "",
          email: email,
          data: []
        };
      });

      // Certificates
      const certLastRow = certWs.getLastRow();
      const certLastCol = certWs.getLastColumn();
      if (certLastRow < 2) return { success: true, sent: 0, matchedRows: 0 };

      const certHeaders = certWs.getRange(1, 1, 1, certLastCol).getDisplayValues()[0].map(h => String(h).trim());
      const certRows = certWs.getRange(2, 1, certLastRow - 1, certLastCol).getDisplayValues();

      const firmCol = BaseService.findHeaderIndex(certHeaders, ["nickname", "Nickname", "Nick", "Firma Adı"]);
      const stdCol = BaseService.findHeaderIndex(certHeaders, ["standart", "Standart", "Standard"]);
      const certNoCol = BaseService.findHeaderIndex(certHeaders, ["sertifika_no", "Sno", "SNo", "Sertifika No"]);
      const survDateCol = BaseService.findHeaderIndex(certHeaders, ["gozetim_tarihi", "GOZ", "Sertifika Gözetim Tarihi"]);
      const accreditationCol = BaseService.findHeaderIndex(certHeaders, ["akreditasyon", "Akreditasyon"]);
      const consultantCol = BaseService.findHeaderIndex(certHeaders, ["consultant", "Danışman", "Danisman", "Dan"]);
      const checkboxCol = BaseService.findHeaderIndex(certHeaders, ["gozetim_confirmed", "Gözetim Conf.", "Gözetim"]);
      const otherStdCol = BaseService.findHeaderIndex(certHeaders, ["other_standart", "Other", "Diğer", "Diger"]);

      let matchCount = 0;
      certRows.forEach(row => {
        const dateValue = this._cell(row, survDateCol, "");
        const parsed = this._parseSheetDate(dateValue);
        if (!parsed) return;
        if (!(parsed >= startDate && parsed < endDate)) return;

        const consultant = this._cell(row, consultantCol, "");
        if (!consultantsData[consultant]) return;

        const checkedRaw = this._cell(row, checkboxCol, "");
        const checked = checkedRaw === true || String(checkedRaw).toLowerCase() === "true" || String(checkedRaw) === "1";
        if (checked) return;

        const stdRaw = this._cell(row, stdCol, "");
        const standard = String(stdRaw) === "Other" && otherStdCol > 0 ? row[otherStdCol - 1] : stdRaw;

        consultantsData[consultant].data.push({
          date: this._formatDateDots(parsed),
          firm: this._cell(row, firmCol, ""),
          consultant: consultantsData[consultant].fullName,
          firstName: consultantsData[consultant].firstName,
          title: consultantsData[consultant].title,
          standard: standard || "",
          certificateNo: this._cell(row, certNoCol, ""),
          accreditation: this._cell(row, accreditationCol, "")
        });
        matchCount++;
      });

      const recipients = Object.values(consultantsData).filter(rec => rec.data && rec.data.length > 0);
      const quotaRemaining = MailApp.getRemainingDailyQuota();
      const reserve = 2; // manuel/operasyonel mail ihtiyaçları için güvenlik payı
      const maxSend = Math.max(0, quotaRemaining - reserve);

      let sent = 0;
      let skippedByQuota = 0;
      recipients.forEach((rec, idx) => {
        if (idx >= maxSend) {
          skippedByQuota++;
          return;
        }
        const res = this.sendSurveillanceEmail({
          firstName: rec.firstName,
          fullName: rec.fullName,
          title: rec.title,
          email: rec.email,
          data: rec.data,
          startDate: this._formatDateDots(startDate),
          endDate: this._formatDateDots(endDate)
        });
        if (res.success) sent++;
      });

      return {
        success: true,
        sent: sent,
        matchedRows: matchCount,
        quotaRemaining: quotaRemaining,
        skippedByQuota: skippedByQuota
      };
    } catch (e) {
      BaseService.logError("runMonthlyCheck", e);
      return { success: false, error: e.message };
    }
  }
};
