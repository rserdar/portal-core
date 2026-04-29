/**
 * GeminiService
 *
 * Sertifika siniflandirma onerilerini mevcut local referans adaylariyla birlikte
 * Gemini'ye gonderir ve duzenlenebilir JSON cikisi dondurur.
 */

const GeminiService = {
  _getScriptProperty: function(key, fallback) {
    return PropertiesService.getScriptProperties().getProperty(key) || fallback || "";
  },

  _getConfig: function(key, fallback) {
    const normalized = String(key || "").trim().toLowerCase();
    const scriptKeyMap = {
      model: "GEMINI_MODEL",
      temperature: "GEMINI_TEMPERATURE",
      max_output_tokens: "GEMINI_MAX_OUTPUT_TOKENS",
    };
    const scriptKey = scriptKeyMap[normalized] || String(key || "").trim().toUpperCase();
    return BaseService.getGoogleConfig("gemini", normalized, this._getScriptProperty(scriptKey, fallback));
  },

  _parseNumber: function(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  },

  _cleanJsonText: function(raw) {
    const text = String(raw || "").trim();
    if (!text) return "";
    if (text.startsWith("```")) {
      return text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    }
    return text;
  },

  _sanitizeSuggestion: function(item, fallbackScore) {
    const raw = item && typeof item === "object" ? item : {};
    const kapsamLines = Array.isArray(raw.kapsamLines)
      ? raw.kapsamLines
          .map(function(line) { return String(line || "").trim(); })
          .filter(Boolean)
          .slice(0, 5)
      : [];
    const reasons = Array.isArray(raw.reasons)
      ? raw.reasons
          .map(function(line) { return String(line || "").trim(); })
          .filter(Boolean)
          .slice(0, 4)
      : [];

    return {
      ea: String(raw.ea || "").trim(),
      nace: String(raw.nace || "").trim(),
      label: String(raw.label || raw.title || "").trim(),
      score: Math.max(1, Math.min(100, Math.round(this._parseNumber(raw.score, fallbackScore)))),
      reasons: reasons.length ? reasons : ["Gemini baglam analizi"],
      keywordMatches: Array.isArray(raw.keywordMatches)
        ? raw.keywordMatches.map(function(token) { return String(token || "").trim(); }).filter(Boolean).slice(0, 6)
        : [],
      kapsamLines: kapsamLines,
      scopeDraft: String(raw.scopeDraft || raw.scope || "").trim(),
      source: "gemini",
    };
  },

  _buildPrompt: function(payload) {
    const standard = String(payload.standard || "").trim();
    const context = payload.context && typeof payload.context === "object" ? payload.context : {};
    const localSuggestions = Array.isArray(payload.localSuggestions) ? payload.localSuggestions : [];

    const lines = [
      "Sen bir ISO sertifikasyon operasyon uzmani gibi davran.",
      "Gorevin, sirket baglamina gore en uygun sertifika siniflandirma onerilerini uretmek.",
      "Mevcut local referans adaylarini kullan ama onlarla sinirli kalma; daha iyi bir kapsama ulaşırsan duzelt.",
      "Ciktin yalnizca gecerli JSON olmali.",
      "",
      "Donus sekli:",
      "{",
      '  "summary": "kisa ozet",',
      '  "suggestions": [',
      "    {",
      '      "ea": "EA kodu",',
      '      "nace": "NACE veya ilgili kod",',
      '      "label": "kisa etiket",',
      '      "score": 0-100,',
      '      "reasons": ["neden 1", "neden 2"],',
      '      "kapsamLines": ["madde 1", "madde 2"],',
      '      "scopeDraft": "Ingilizce scope taslagi"',
      "    }",
      "  ]",
      "}",
      "",
      "Kurallar:",
      "- En fazla 4 onerı don.",
      "- kapsamLines maddeleri kisa ve uygulanabilir olsun.",
      "- scopeDraft, kapsamLines ile uyumlu profesyonel Ingilizce scope olsun.",
      "- score daha yuksek = daha guclu uyum.",
      "- Eger emin degilsen local onerilere yakin kal.",
      "",
      "Standart:",
      standard || "-",
      "",
      "Sirket baglami:",
      JSON.stringify(context, null, 2),
      "",
      "Local referans adaylari:",
      JSON.stringify(localSuggestions, null, 2),
    ];

    return lines.join("\n");
  },

  _extractTextResponse: function(apiResponse) {
    const candidates = apiResponse && Array.isArray(apiResponse.candidates) ? apiResponse.candidates : [];
    const first = candidates[0] || {};
    const parts = first.content && Array.isArray(first.content.parts) ? first.content.parts : [];
    const textPart = parts.find(function(part) {
      return part && typeof part.text === "string";
    });
    return textPart ? String(textPart.text || "") : "";
  },

  suggestCertificateClassification: function(payload) {
    try {
      const apiKey = this._getScriptProperty("GEMINI_API_KEY", "");
      if (!apiKey) {
        return { success: false, error: "GEMINI_API_KEY_MISSING" };
      }

      const model = this._getConfig("model", "gemini-flash-latest");
      const temperature = this._parseNumber(this._getConfig("temperature", "0.25"), 0.25);
      const maxOutputTokens = Math.max(
        512,
        Math.min(4096, Math.round(this._parseNumber(this._getConfig("max_output_tokens", "2048"), 2048)))
      );
      const prompt = this._buildPrompt(payload || {});

      const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent";
      const requestBody = {
        systemInstruction: {
          parts: [{
            text: "JSON harici hicbir sey dondurme. Onerileri sertifika operasyonunda kullanilabilecek kadar somut yaz."
          }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: temperature,
          maxOutputTokens: maxOutputTokens,
          responseMimeType: "application/json"
        }
      };

      const response = UrlFetchApp.fetch(endpoint, {
        method: "post",
        contentType: "application/json",
        headers: {
          "x-goog-api-key": apiKey
        },
        muteHttpExceptions: true,
        payload: JSON.stringify(requestBody)
      });

      const statusCode = response.getResponseCode();
      const responseText = response.getContentText();
      if (statusCode < 200 || statusCode >= 300) {
        BaseService.logError("GeminiService.suggestCertificateClassification", new Error("Gemini HTTP " + statusCode), {
          body: responseText.slice(0, 400)
        });
        return { success: false, error: "GEMINI_HTTP_" + statusCode };
      }

      const parsedApi = JSON.parse(responseText || "{}");
      const modelText = this._extractTextResponse(parsedApi);
      const cleanedText = this._cleanJsonText(modelText);
      const parsedJson = JSON.parse(cleanedText || "{}");
      const suggestions = Array.isArray(parsedJson.suggestions) ? parsedJson.suggestions : [];

      const sanitized = suggestions
        .map(function(item, index) {
          return GeminiService._sanitizeSuggestion(item, 90 - index * 8);
        })
        .filter(function(item) {
          return item.nace || item.ea || item.kapsamLines.length > 0;
        })
        .slice(0, 4);

      return {
        success: true,
        data: {
          model: model,
          summary: String(parsedJson.summary || "").trim(),
          suggestions: sanitized,
        }
      };
    } catch (error) {
      BaseService.logError("GeminiService.suggestCertificateClassification", error);
      return { success: false, error: error && error.message ? error.message : "GEMINI_UNKNOWN_ERROR" };
    }
  }
};
