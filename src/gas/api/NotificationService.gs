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
      const certWs = ss.getSheetByName("Sertifika");
      const consWs = ss.getSheetByName("Consultants");
      if (!certWs) throw new Error("Sertifika sayfası bulunamadı.");
      if (!consWs) throw new Error("Consultants sayfası bulunamadı.");

      const today = new Date();
      const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const endDate = new Date(today.getFullYear(), today.getMonth() + 2, 1);

      // Consultants
      const consLastRow = consWs.getLastRow();
      const consLastCol = consWs.getLastColumn();
      if (consLastRow < 2) return { success: true, sent: 0, matchedRows: 0 };

      const consHeaders = consWs.getRange(1, 1, 1, consLastCol).getDisplayValues()[0].map(h => String(h).trim());
      const consRows = consWs.getRange(2, 1, consLastRow - 1, consLastCol).getDisplayValues();

      const cNameCol = BaseService.findHeaderIndex(consHeaders, ["Danışman", "Danisman", "Name", "Ad Soyad"]);
      const cEmailCol = BaseService.findHeaderIndex(consHeaders, ["Email", "E-mail", "Mail"]);
      const cFirstNameCol = BaseService.findHeaderIndex(consHeaders, ["Ad", "First Name", "İsim"]);
      const cLastNameCol = BaseService.findHeaderIndex(consHeaders, ["Soyad", "Last Name"]);
      const cTitleCol = BaseService.findHeaderIndex(consHeaders, ["Ünvan", "Unvan", "Title"]);

      const consultantsData = {};
      consRows.forEach(row => {
        const name = cNameCol > 0 ? row[cNameCol - 1] : row[0];
        if (!name) return;
        const firstName = cFirstNameCol > 0 ? row[cFirstNameCol - 1] : row[4];
        const lastName = cLastNameCol > 0 ? row[cLastNameCol - 1] : row[5];
        const title = cTitleCol > 0 ? row[cTitleCol - 1] : row[6];
        const email = (cEmailCol > 0 ? row[cEmailCol - 1] : row[3]) || this.DEFAULT_REPORT_RECIPIENT;
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

      const firmCol = BaseService.findHeaderIndex(certHeaders, ["Nickname", "Nick", "Firma Adı"]);
      const stdCol = BaseService.findHeaderIndex(certHeaders, ["Standart", "Standard"]);
      const certNoCol = BaseService.findHeaderIndex(certHeaders, ["Sno", "SNo", "Sertifika No"]);
      const survDateCol = BaseService.findHeaderIndex(certHeaders, ["GOZ", "Sertifika Gözetim Tarihi"]);
      const accreditationCol = BaseService.findHeaderIndex(certHeaders, ["Akreditasyon"]);
      const consultantCol = BaseService.findHeaderIndex(certHeaders, ["Danışman", "Danisman", "Dan"]);
      const checkboxCol = BaseService.findHeaderIndex(certHeaders, ["Gözetim Conf.", "Gözetim"]);
      const otherStdCol = BaseService.findHeaderIndex(certHeaders, ["Other", "Diğer", "Diger"]);

      let matchCount = 0;
      certRows.forEach(row => {
        const dateValue = survDateCol > 0 ? row[survDateCol - 1] : "";
        const parsed = this._parseSheetDate(dateValue);
        if (!parsed) return;
        if (!(parsed >= startDate && parsed < endDate)) return;

        const consultant = consultantCol > 0 ? row[consultantCol - 1] : "";
        if (!consultantsData[consultant]) return;

        const checkedRaw = checkboxCol > 0 ? row[checkboxCol - 1] : "";
        const checked = String(checkedRaw).toLowerCase() === "true";
        if (checked) return;

        const stdRaw = stdCol > 0 ? row[stdCol - 1] : "";
        const standard = String(stdRaw) === "Other" && otherStdCol > 0 ? row[otherStdCol - 1] : stdRaw;

        consultantsData[consultant].data.push({
          date: this._formatDateDots(parsed),
          firm: firmCol > 0 ? row[firmCol - 1] : "",
          consultant: consultantsData[consultant].fullName,
          firstName: consultantsData[consultant].firstName,
          title: consultantsData[consultant].title,
          standard: standard || "",
          certificateNo: certNoCol > 0 ? row[certNoCol - 1] : "",
          accreditation: accreditationCol > 0 ? row[accreditationCol - 1] : ""
        });
        matchCount++;
      });

      let sent = 0;
      Object.values(consultantsData).forEach(rec => {
        if (!rec.data || rec.data.length === 0) return;
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

      return { success: true, sent: sent, matchedRows: matchCount };
    } catch (e) {
      BaseService.logError("runMonthlyCheck", e);
      return { success: false, error: e.message };
    }
  }
};
