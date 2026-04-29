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
   * Worker tarafından render edilmiş htmlBody ile email gönderir.
   * GAS template oluşturmaz; htmlBody Worker'dan gelir.
   */
  sendSurveillanceEmail: function(payload) {
    if (!payload || typeof payload !== "object") {
      return { success: false, error: "INVALID_PAYLOAD" };
    }
    return this.sendHtmlEmail(payload);
  },

  /**
   * Legacy sendEmail karşılığı.
   */
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

  /**
   * Aylık gözetim email tetikleyici.
   * D1 sorgusu ve HTML render Worker'da yapılır; GAS yalnızca bu isteği iletir.
   * Worker → sendSurveillanceEmail → sendHtmlEmail akışıyla tamamlanır.
   */
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
