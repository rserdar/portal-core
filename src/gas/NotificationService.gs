/**
 * 📬 NotificationService: E-posta ve trigger tabanlı bildirim işlemleri
 */
const NotificationService = {
  DEFAULT_FROM: "noreply@example.com",
  DEFAULT_FROM_NAME: "Portal",
  DEFAULT_REPORT_RECIPIENT: "info@example.com",
  _cfg: function(key, fallback) {
    const runtimeKeyMap = {
      NOTIFICATION_FROM: { service: "gmail", key: "sender_email" },
      NOTIFICATION_FROM_NAME: { service: "gmail", key: "sender_name" },
      NOTIFICATION_REPORT_RECIPIENT: { service: "gmail", key: "report_recipient" },
    };
    const runtimeMeta = runtimeKeyMap[key];
    if (runtimeMeta) {
      const runtimeValue = BaseService.getGoogleConfig(runtimeMeta.service, runtimeMeta.key, "");
      if (runtimeValue) return runtimeValue;
    }
    const value = PropertiesService.getScriptProperties().getProperty(key);
    if (value && String(value).trim()) return String(value).trim();
    return fallback;
  },
  _defaultFrom: function() {
    return this._cfg("NOTIFICATION_FROM", this.DEFAULT_FROM);
  },
  _defaultFromName: function() {
    return this._cfg("NOTIFICATION_FROM_NAME", this.DEFAULT_FROM_NAME);
  },
  _defaultRecipient: function() {
    return this._cfg("NOTIFICATION_REPORT_RECIPIENT", this.DEFAULT_REPORT_RECIPIENT);
  },

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

  sendHtmlEmail: function(payload) {
    try {
      const message = payload || {};
      const recipient = message.email || this._defaultRecipient();
      const subject = message.subject || "Gozetim Bilgileri";
      const htmlBody = message.htmlBody || "";
      const from = message.from || this._defaultFrom();
      const fromName = message.fromName || this._defaultFromName();

      if (!htmlBody) {
        throw new Error("HTML_BODY_REQUIRED");
      }

      GmailApp.sendEmail(recipient, subject, "", {
        from: from,
        name: fromName,
        htmlBody: htmlBody
      });

      return { success: true };
    } catch (e) {
      BaseService.logError("sendHtmlEmail", e);
      return { success: false, error: e.message };
    }
  },

  /**
   * GAS tarafında email render eder ve gönderir.
   * Worker artık sadece payload gönderiyor, render burada yapılıyor.
   */
  sendSurveillanceEmail: function(payload) {
    if (!payload || typeof payload !== "object") {
      return { success: false, error: "INVALID_PAYLOAD" };
    }

    // Eğer htmlBody gelmemişse (Worker render etmediyse) burada oluştur
    if (!payload.htmlBody) {
      payload.htmlBody = this._renderSurveillanceHtml(payload);
    }

    return this.sendHtmlEmail(payload);
  },

  /**
   * Medicert/Default email şablonunu render eder.
   */
  _renderSurveillanceHtml: function(p) {
    const firstName = p.firstName || "Merhaba";
    const title = p.title || "";
    const rows = Array.isArray(p.data) ? p.data : (Array.isArray(p.rows) ? p.rows : []);
    const startDate = p.startDate || "";
    const endDate = p.endDate || "";
    const brandName = p.appName || "Medicert";
    
    const greeting = [title, firstName].filter(Boolean).join(" ").trim() || "Merhaba";
    
    const escape = function(v) { 
      return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); 
    };

    let tableRows = "";
    rows.forEach(function(row) {
      tableRows += '<tr>' +
        '<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;">' + escape(row.date || row.Tarih || "") + '</td>' +
        '<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;">' + escape(row.firm || row.Firma || "") + '</td>' +
        '<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;">' + escape(row.consultant || row.Danisman || "") + '</td>' +
        '<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;">' + escape(row.standard || row.Standart || "") + '</td>' +
        '<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;">' + escape(row.certificateNo || row.Sno || "") + '</td>' +
        '<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;">' + escape(row.accreditation || row.Akrn || "") + '</td>' +
      '</tr>';
    });

    return '<div style="margin:0;background:#eef2ff;padding:32px 16px;font-family:Arial,sans-serif;color:#172033;">' +
      '<div style="max-width:920px;margin:0 auto;background:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #c7d2fe;box-shadow:0 24px 48px rgba(15,23,42,0.08);">' +
        '<div style="padding:28px 32px;background:linear-gradient(135deg,#1e1b4b 0%,#312e81 55%,#4338ca 100%);color:#ffffff;">' +
          '<div style="font-size:12px;letter-spacing:0.24em;text-transform:uppercase;opacity:0.8;margin-bottom:10px;">' + escape(brandName) + '</div>' +
          '<div style="font-size:28px;font-weight:700;line-height:1.15;">Gözetim Bilgileri</div>' +
          '<div style="margin-top:10px;font-size:14px;opacity:0.88;">Sertifika gözetim planlaması için güncel bildirim özeti</div>' +
        '</div>' +
        '<div style="padding:32px;">' +
          '<p style="margin:0 0 14px;font-size:15px;">Sayın ' + escape(greeting) + ',</p>' +
          '<p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#475569;">' +
            escape(startDate) + ' - ' + escape(endDate) + ' tarih aralığındaki gözetim kayıtlarınız aşağıda listelenmiştir.' +
          '</p>' +
          '<table style="width:100%;border-collapse:separate;border-spacing:0;font-size:13px;overflow:hidden;border:1px solid #e2e8f0;border-radius:18px;">' +
            '<thead>' +
              '<tr style="background:#f8fafc;text-align:left;color:#334155;">' +
                '<th style="padding:14px;">Tarih</th>' +
                '<th style="padding:14px;">Firma</th>' +
                '<th style="padding:14px;">Danışman</th>' +
                '<th style="padding:14px;">Standart</th>' +
                '<th style="padding:14px;">Sertifika No</th>' +
                '<th style="padding:14px;">Akreditasyon</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + tableRows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +
    '</div>';
  },

  sendTableReport: function(htmlTable, recipient) {
    try {
      const to = recipient || this._defaultRecipient();
      const body = "Merhaba, aşağıda filtrelenmiş tabloyu bulabilirsiniz:<br><br>" + (htmlTable || "");
      GmailApp.sendEmail(to, "Gözetim Belgeleriniz", "", {
        from: this._defaultFrom(),
        name: this._defaultFromName(),
        htmlBody: body
      });
      return { success: true };
    } catch (e) {
      BaseService.logError("sendTableReport", e);
      return { success: false, error: e.message };
    }
  },

  runMonthlyCheck: function(params) {
    try {
      const props = PropertiesService.getScriptProperties();
      const workerUrl = props.getProperty("WORKER_URL");
      const apiKey = props.getProperty("API_KEY");
      if (!workerUrl) throw new Error("WORKER_URL Script Property eksik.");

      const res = UrlFetchApp.fetch(workerUrl, {
        method: "POST",
        contentType: "application/json",
        payload: JSON.stringify({ action: "runMonthlyCheck", apiKey: apiKey, params: params || {} }),
        muteHttpExceptions: true
      });

      return JSON.parse(res.getContentText());
    } catch (e) {
      BaseService.logError("runMonthlyCheck", e);
      return { success: false, error: e.message };
    }
  }
};
