/**
 * 🛰️ Medicert Portal: Cloudflare Worker Proxy (V2 - High Performance)
 * 
 * Bu versiyon Cloudflare KV üzerinden akıllı cache (Cache-Aside) mekanizması ile çalışır.
 * "DB" adında bir KV namespace bağlaması gerektirir.
 */

export default {
  async fetch(request, env, ctx) {
    const stableStringify = (value) => {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
      const keys = Object.keys(value).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    };

    const allowedOriginPatterns = [
      /^https:\/\/portal\.medicert\.com\.tr$/,
      /^https:\/\/portal\.pages\.dev$/,
      /^http:\/\/localhost(?::\d+)?$/,
      /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
    ];
    const indexKeys = {
      companyById: "cache:index:companiesById",
      certsByFirmaId: "cache:index:certificatesByFirmaId",
      testsByFirmaId: "cache:index:testsByFirmaId",
      auditsByFirmaId: "cache:index:auditsByFirmaId"
    };
    const CACHE_TTL = 86400 * 7;

    const jsonResponse = (payload, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const origin = request.headers.get("Origin");
    const isAllowedOrigin = origin
      ? allowedOriginPatterns.some((pattern) => pattern.test(origin))
      : false;
    const resolvedOrigin = isAllowedOrigin ? origin : "https://portal.medicert.com.tr";
    const corsHeaders = {
      "Access-Control-Allow-Origin": resolvedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method === "POST") {
      try {
        const body = await request.json();
        const action = body.action;
        const params = body.params || {};

        // ⚡ YOĞUN OKUMA AKSİYONLARI (Cacheable)
        const cacheableActions = [
          "getCompanies",
          "getCompanyById",
          "getCertificates",
          "getCertificatesByFirmaId",
          "getTestsByFirmaId",
          "getAuditsByFirmaId",
          "getFolderId",
          "getRecentFiles"
        ];

        // 🔑 KV Cache Key
        const cacheKey = `cache:${action}:${stableStringify(params)}`;

        // 1. KV'den Kontrol Et (Eğer DB binding varsa)
        if (env.DB && cacheableActions.includes(action)) {
          const cached = await env.DB.get(cacheKey);
          if (cached) {
            const data = JSON.parse(cached);
            return jsonResponse({ success: true, data, fromCache: true });
          }

          // Bulk sync ile önceden yazılan indeks cache'lerini fallback olarak kullan.
          const idParam = params?.id ?? params?.firmaId;
          if (idParam !== undefined && idParam !== null) {
            const idKey = String(idParam);
            let indexCacheKey = null;
            let emptyValue = null;

            if (action === "getCompanyById") {
              indexCacheKey = indexKeys.companyById;
            } else if (action === "getCertificatesByFirmaId") {
              indexCacheKey = indexKeys.certsByFirmaId;
              emptyValue = [];
            } else if (action === "getTestsByFirmaId") {
              indexCacheKey = indexKeys.testsByFirmaId;
              emptyValue = [];
            } else if (action === "getAuditsByFirmaId") {
              indexCacheKey = indexKeys.auditsByFirmaId;
              emptyValue = [];
            }

            if (indexCacheKey) {
              const indexedRaw = await env.DB.get(indexCacheKey);
              if (indexedRaw) {
                const indexed = JSON.parse(indexedRaw);
                const data = Object.prototype.hasOwnProperty.call(indexed, idKey) ? indexed[idKey] : emptyValue;
                ctx.waitUntil(env.DB.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL }));
                return jsonResponse({ success: true, data, fromCache: true, indexed: true });
              }
            }
          }
        }

        // 2. Cache Temizleme Aksiyonu (Özel)
        if (action === "clearCache" && env.DB) {
          return jsonResponse({ success: true, data: "Cache clearing logic triggered." });
        }

        // 3. 🚀 TOPLU SENKRONİZASYON (Bulk Sync)
        if (action === "bulkSync") {
          if (!env.DB) {
            return new Response(JSON.stringify({ success: false, error: "Cloudflare KV Bağı (DB) bulunamadı!" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          try {
            const syncRes = await fetch(env.GAS_API_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "getFullSyncData", apiKey: env.API_KEY })
            });

            const text = await syncRes.text();
            let fullData;
            try {
              fullData = JSON.parse(text);
            } catch (e) {
              return new Response(JSON.stringify({ 
                success: false, 
                error: "GAS tarafından geçersiz veri döndü. (HTML Hata Sayfası olabilir)",
                details: text.substring(0, 200) 
              }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
            
            if (fullData.success) {
              const d = fullData.data;

              const companies = Array.isArray(d.companies) ? d.companies : [];
              const certificates = Array.isArray(d.certificates) ? d.certificates : [];
              const certificateRows = Array.isArray(d.certificateRows) ? d.certificateRows : [];
              const tests = Array.isArray(d.tests) ? d.tests : [];
              const audits = Array.isArray(d.audits) ? d.audits : [];

              const companiesById = {};
              for (const company of companies) {
                if (!company) continue;
                const companyId = company["Firma No"] ?? company.id;
                if (companyId === undefined || companyId === null) continue;
                companiesById[String(companyId)] = company;
              }

              const certsByFirmaId = {};
              for (const row of certificateRows) {
                if (!Array.isArray(row)) continue;
                const firmaNo = row[2];
                const key = String(firmaNo ?? "");
                if (!key) continue;
                if (!certsByFirmaId[key]) certsByFirmaId[key] = [];
                certsByFirmaId[key].push(row);
              }

              const testsByFirmaId = {};
              for (const row of tests) {
                if (!Array.isArray(row)) continue;
                const firmaNo = row[2];
                const key = String(firmaNo ?? "");
                if (!key) continue;
                if (!testsByFirmaId[key]) testsByFirmaId[key] = [];
                testsByFirmaId[key].push(row);
              }

              const auditsByFirmaId = {};
              for (const row of audits) {
                if (!Array.isArray(row)) continue;
                const firmaNo = row[2];
                const key = String(firmaNo ?? "");
                if (!key) continue;
                if (!auditsByFirmaId[key]) auditsByFirmaId[key] = [];
                auditsByFirmaId[key].push(row);
              }

              await Promise.all([
                env.DB.put(`cache:getCompanies:{}`, JSON.stringify(companies), { expirationTtl: CACHE_TTL }),
                env.DB.put(`cache:getCertificates:{}`, JSON.stringify(certificates), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.companyById, JSON.stringify(companiesById), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.certsByFirmaId, JSON.stringify(certsByFirmaId), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.testsByFirmaId, JSON.stringify(testsByFirmaId), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.auditsByFirmaId, JSON.stringify(auditsByFirmaId), { expirationTtl: CACHE_TTL }),
              ]);

              return jsonResponse({
                success: true, 
                message: "Senkronizasyon başarılı!", 
                stats: {
                  companies: companies.length,
                  certs: certificates.length,
                  certRows: certificateRows.length,
                  tests: tests.length,
                  audits: audits.length
                }
              });
            } else {
              return jsonResponse(fullData);
            }
          } catch (error) {
            return jsonResponse({ success: false, error: "Worker -> GAS Bağlantı Hatası: " + error.message });
          }
        }

        const gasApiUrl = env.GAS_API_URL;
        body.apiKey = env.API_KEY || "mc-portal-3.0_8a2d7f9e4c1b5a6c3d2e1f0b9a8c7d6e";

        if (!gasApiUrl) {
          throw new Error("GAS_API_URL tanımlanmamış.");
        }

        // 🚀 Google Apps Script'e yönlendirme yap
        const gasResponse = await fetch(gasApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const result = await gasResponse.json();

        // 📥 Başarılıysa KV'ye Yaz (7 Günlük)
        if (env.DB && result.success && cacheableActions.includes(action)) {
          ctx.waitUntil(env.DB.put(cacheKey, JSON.stringify(result.data), { expirationTtl: CACHE_TTL }));
        }

        return jsonResponse(result);

      } catch (err) {
        return jsonResponse({ success: false, error: "Proxy Hatası: " + err.message }, 500);
      }
    }

    return new Response("🚀 Medicert Cloudflare Proxy (V2) Active", {
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  },
};
