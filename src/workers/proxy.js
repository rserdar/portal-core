/**
 * 🛰️ Medicert Portal: Cloudflare Worker Proxy (v5.4 / Phase 3.5)
 *
 * Mimari özeti:
 * - KV-primary read (miss => needsHydration)
 * - Core write'lar GAS üzerinden, ardından KV invalidation
 * - Master data write'lar KV-primary (Sheets write-back devre dışı)
 *
 * Gereksinimler:
 * - KV namespace binding: env.DB
 * - Worker secrets: env.API_KEY, env.GAS_API_URL
 */

export default {
  async fetch(request, env, ctx) {
    const purgeCachePrefix = async (prefix) => {
      let cursor = undefined;
      do {
        const page = await env.DB.list({ prefix, cursor });
        if (page.keys && page.keys.length) {
          await Promise.all(page.keys.map((entry) => env.DB.delete(entry.name)));
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
    };

    const stableStringify = (value) => {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
      const keys = Object.keys(value).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    };
    const mapLegacyAuditRow = (row) => {
      const r = Array.isArray(row) ? row : [];
      return {
        id: r[0] ?? "",
        nick: r[1] ?? "",
        firmaNo: r[2] ?? "",
        standart: r[3] ?? "",
        denetimTipi: r[4] ?? "",
        a1Full: r[5] ?? "",
        a1Auditor: r[6] ?? "",
        a2Full: r[7] ?? "",
        a2Auditor: r[8] ?? "",
        a1Basla: r[9] ?? "",
        a1Bitis: r[10] ?? "",
        a1Md: r[11] ?? "",
        a1La: r[12] ?? "",
        a1Fa: r[13] ?? "",
        a1Sa: r[14] ?? "",
        a2Basla: r[15] ?? "",
        a2Bitis: r[16] ?? "",
        a2Md: r[17] ?? "",
        a2La: r[18] ?? "",
        a2Fa: r[19] ?? "",
        a2Sa: r[20] ?? "",
        qms: r[21] ?? "",
        mdd: r[22] ?? "",
        ems: r[23] ?? "",
        ohs: r[24] ?? "",
        fsms: r[25] ?? "",
        isms: r[26] ?? "",
        engy: r[27] ?? "",
        gmp: r[28] ?? "",
        a1kDenet: r[29] ?? "",
        a2kDenet: r[30] ?? "",
        a1EventId: r[31] ?? "",
        a2EventId: r[32] ?? "",
      };
    };
    const hasUsableAuditDates = (audits) => Array.isArray(audits) && audits.some((audit) =>
      audit && typeof audit === "object" && String(audit.a1Basla || audit.a1Bitis || audit.a2Basla || audit.a2Bitis || "").trim()
    );
    const rebuildAuditsFromIndex = async () => {
      if (!env.DB) return null;
      const indexedRaw = await env.DB.get(indexKeys.auditsByFirmaId);
      if (!indexedRaw) return null;
      const indexed = JSON.parse(indexedRaw);
      const rows = Object.values(indexed || {}).flatMap((value) => Array.isArray(value) ? value : []);
      if (!rows.length) return [];
      return rows.map(mapLegacyAuditRow).reverse();
    };
    const parseVersionNumber = (raw) => {
      const n = parseInt(String(raw ?? "0"), 10);
      return isNaN(n) ? 0 : n;
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
      auditsByFirmaId: "cache:index:auditsByFirmaId",
      proformasByFirmaId: "cache:index:proformasByFirmaId",
      proformasById: "cache:index:proformasById",
      standardsById: "cache:index:standardsById"
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
        const kvPrimaryReads = String(env.KV_PRIMARY_READS || "1") === "1";
        const resolveFirmaId = (value) => {
          if (value === undefined || value === null || value === "") return null;
          return String(value);
        };

        // ⚡ YOĞUN OKUMA AKSİYONLARI (Cacheable)
        const cacheableActions = [
          "getCompanies",
          "getCompanyById",
          "getCertificates",
          "getCertificatesByFirmaId",
          "getRecentCertificates",
          "getAudits",
          "getTestsByFirmaId",
          "getAuditsByFirmaId",
          "getConsultants",
          "getStandardById",
          "getProformaByFirmaId",
          "getProformaById",
          "getMasterData",
          "getFolderId",
          "getRecentFiles"
        ];
        const writeActions = [
          "addCompany",
          "updateCompany",
          "addCertificate",
          "updateCertificate",
          "updateCertificateField",
          "editCell",
          "updateGozetim",
          "updateSurveillance",
          "addTest",
          "updateTest",
          "scheduleAudit",
          "updateAudit",
          "addProforma",
          "addProInfo",
          "updateMasterData",
          "importBackup"
        ];

        // 🔑 KV Cache Key
        const cacheKey = `cache:${action}:${stableStringify(params)}`;

        // 1. KV'den Kontrol Et (Eğer DB binding varsa)
        if (env.DB && cacheableActions.includes(action)) {
          const cached = await env.DB.get(cacheKey);
          if (cached) {
            const data = JSON.parse(cached);
            if (action === "getAudits" && !hasUsableAuditDates(data)) {
              const rebuilt = await rebuildAuditsFromIndex();
              if (rebuilt && rebuilt.length) {
                ctx.waitUntil(env.DB.put(cacheKey, JSON.stringify(rebuilt), { expirationTtl: CACHE_TTL }));
                return jsonResponse({ success: true, data: rebuilt, fromCache: true, rebuiltFromIndex: true });
              }
            }
            return jsonResponse({ success: true, data, fromCache: true });
          }

          if (action === "getAudits") {
            const rebuilt = await rebuildAuditsFromIndex();
            if (rebuilt) {
              ctx.waitUntil(env.DB.put(cacheKey, JSON.stringify(rebuilt), { expirationTtl: CACHE_TTL }));
              return jsonResponse({ success: true, data: rebuilt, fromCache: true, rebuiltFromIndex: true });
            }
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
            } else if (action === "getProformaByFirmaId") {
              indexCacheKey = indexKeys.proformasByFirmaId;
              emptyValue = [];
            } else if (action === "getProformaById") {
              indexCacheKey = indexKeys.proformasById;
              emptyValue = null;
            } else if (action === "getStandardById") {
              indexCacheKey = indexKeys.standardsById;
              emptyValue = null;
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

          // Phase 3.5: KV primary read. Miss durumunda GAS fallback yerine hydration sinyali döner.
          if (kvPrimaryReads) {
            return jsonResponse({
              success: false,
              data: null,
              error: "KV_PRIMARY_MISS",
              needsHydration: true,
              action,
              params
            }, 503);
          }
        }

        // 2. Cache Temizleme Aksiyonu (Özel)
        if (action === "clearCache") {
          if (!env.DB) {
            return jsonResponse({ success: false, error: "Cloudflare KV Bağı (DB) bulunamadı!" }, 500);
          }
          await purgeCachePrefix("cache:");
          return jsonResponse({ success: true, data: "Cache temizlendi." });
        }

        // 2.1 KV Primary Write (Master Data) - Sheets backup devre dışı
        if (action === "updateMasterData") {
          if (!env.DB) {
            return jsonResponse({ success: false, error: "Cloudflare KV Bağı (DB) bulunamadı!" }, 500);
          }

          const type = String(params?.type || "").trim().toLowerCase();
          const validTypes = new Set(["standards", "auditors", "consultants", "testdocs", "sysdocs"]);
          if (!validTypes.has(type)) {
            return jsonResponse({ success: false, error: "Geçersiz master data tipi." }, 400);
          }

          let payload = null;
          const allKey = "cache:getMasterData:{}";
          const currentRaw = await env.DB.get(allKey);
          if (currentRaw) {
            payload = JSON.parse(currentRaw);
          } else {
            // KV boşsa Sheets'ten tek sefer hydrate et
            const syncRes = await fetch(env.GAS_API_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "getMasterSyncData", apiKey: env.API_KEY })
            });
            const fetched = await syncRes.json().catch(() => null);
            if (!fetched || !fetched.success || !fetched.data) {
              return jsonResponse({ success: false, error: "Master data KV boş ve GAS sync başarısız." }, 503);
            }
            payload = fetched.data;
          }

          payload.datasets = payload.datasets && typeof payload.datasets === "object" ? payload.datasets : {};
          const ds = payload.datasets[type];
          if (!ds || !Array.isArray(ds.headers)) {
            return jsonResponse({ success: false, error: `Master dataset bulunamadı: ${type}` }, 404);
          }

          const expectedVersion = params?.expectedVersion;
          const currentVersion = String(payload.version ?? "1");
          if (expectedVersion !== undefined && expectedVersion !== null && String(expectedVersion) !== currentVersion) {
            return jsonResponse({ success: false, error: "MASTER_VERSION_CONFLICT", currentVersion }, 409);
          }

          const rows = Array.isArray(params?.data?.rows) ? params.data.rows : [];
          const replace = params?.replace !== false;
          const allowEmptyReplace = params?.options?.allowEmptyReplace === true;
          if (replace && rows.length === 0 && !allowEmptyReplace) {
            return jsonResponse({ success: false, error: "MASTER_EMPTY_REPLACE_BLOCKED" }, 400);
          }

          const headerLen = ds.headers.length;
          const normalizedRows = rows.map((row) => {
            const arr = Array.isArray(row) ? row.slice(0, headerLen) : [];
            while (arr.length < headerLen) arr.push("");
            return arr;
          });

          ds.rows = replace ? normalizedRows : [...(Array.isArray(ds.rows) ? ds.rows : []), ...normalizedRows];
          payload.datasets[type] = ds;

          const nextVersionNum = parseVersionNumber(payload.version) + 1;
          payload.version = String(nextVersionNum);
          payload.updatedAt = new Date().toISOString();

          const typeKey = `cache:getMasterData:${stableStringify({ type })}`;
          const typePayload = { version: payload.version, updatedAt: payload.updatedAt, dataset: ds };

          await Promise.all([
            env.DB.put(allKey, JSON.stringify(payload), { expirationTtl: CACHE_TTL }),
            env.DB.put(typeKey, JSON.stringify(typePayload), { expirationTtl: CACHE_TTL })
          ]);

          return jsonResponse({
            success: true,
            data: {
              success: true,
              type,
              rowCount: ds.rows.length,
              version: payload.version,
              updatedAt: payload.updatedAt,
              kvPrimaryWrite: true,
              sheetsBackup: false
            }
          });
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
              const auditObjects = Array.isArray(d.auditObjects) ? d.auditObjects : [];
              const proformas = Array.isArray(d.proformas) ? d.proformas : [];
              const consultants = Array.isArray(d.consultants) ? d.consultants : [];
              const standards = Array.isArray(d.standards) ? d.standards : [];

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

              const proformasByFirmaId = {};
              const proformasById = {};
              for (const row of proformas) {
                if (!Array.isArray(row)) continue;
                const proformaId = row[0];
                const firmaNo = row[2];
                const idKey = String(proformaId ?? "");
                const firmaKey = String(firmaNo ?? "");
                if (idKey) proformasById[idKey] = row;
                if (!firmaKey) continue;
                if (!proformasByFirmaId[firmaKey]) proformasByFirmaId[firmaKey] = [];
                proformasByFirmaId[firmaKey].push(row);
              }

              const standardsById = {};
              for (const standard of standards) {
                if (!standard || typeof standard !== "object") continue;
                const standardId = standard["ID"] ?? standard.id ?? standard["Standart ID"] ?? standard["Standart No"];
                if (standardId === undefined || standardId === null) continue;
                standardsById[String(standardId)] = standard;
              }

              await Promise.all([
                env.DB.put(`cache:getCompanies:{}`, JSON.stringify(companies), { expirationTtl: CACHE_TTL }),
                env.DB.put(`cache:getCertificates:{}`, JSON.stringify(certificates), { expirationTtl: CACHE_TTL }),
                env.DB.put(`cache:getAudits:{}`, JSON.stringify(auditObjects), { expirationTtl: CACHE_TTL }),
                env.DB.put(`cache:getConsultants:{}`, JSON.stringify(consultants), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.companyById, JSON.stringify(companiesById), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.certsByFirmaId, JSON.stringify(certsByFirmaId), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.testsByFirmaId, JSON.stringify(testsByFirmaId), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.auditsByFirmaId, JSON.stringify(auditsByFirmaId), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.proformasByFirmaId, JSON.stringify(proformasByFirmaId), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.proformasById, JSON.stringify(proformasById), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.standardsById, JSON.stringify(standardsById), { expirationTtl: CACHE_TTL }),
              ]);

              return jsonResponse({
                success: true, 
                message: "Senkronizasyon başarılı!", 
                stats: {
                  companies: companies.length,
                  certs: certificates.length,
                  certRows: certificateRows.length,
                  tests: tests.length,
                  audits: audits.length,
                  auditObjects: auditObjects.length,
                  proformas: proformas.length,
                  consultants: consultants.length,
                  standards: standards.length
                }
              });
            } else {
              return jsonResponse(fullData);
            }
          } catch (error) {
            return jsonResponse({ success: false, error: "Worker -> GAS Bağlantı Hatası: " + error.message });
          }
        }

        // 3.1 🚀 MASTER DATA SENKRONİZASYON (Bulk Sync Master)
        if (action === "bulkSyncMaster") {
          if (!env.DB) {
            return new Response(JSON.stringify({ success: false, error: "Cloudflare KV Bağı (DB) bulunamadı!" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          try {
            const syncRes = await fetch(env.GAS_API_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "getMasterSyncData", apiKey: env.API_KEY })
            });

            const text = await syncRes.text();
            let masterData;
            try {
              masterData = JSON.parse(text);
            } catch (e) {
              return new Response(JSON.stringify({
                success: false,
                error: "GAS tarafından geçersiz master veri döndü.",
                details: text.substring(0, 200)
              }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            if (!masterData.success) {
              return jsonResponse(masterData);
            }

            const payload = masterData.data || {};
            const datasets = payload.datasets && typeof payload.datasets === "object" ? payload.datasets : {};

            const writes = [
              env.DB.put(`cache:getMasterData:{}`, JSON.stringify(payload), { expirationTtl: CACHE_TTL })
            ];

            Object.keys(datasets).forEach((type) => {
              const key = `cache:getMasterData:${stableStringify({ type })}`;
              const value = {
                version: payload.version || null,
                updatedAt: payload.updatedAt || null,
                dataset: datasets[type]
              };
              writes.push(env.DB.put(key, JSON.stringify(value), { expirationTtl: CACHE_TTL }));
            });

            await Promise.all(writes);
            return jsonResponse({
              success: true,
              message: "Master data senkronizasyonu başarılı!",
              stats: Object.keys(datasets).reduce((acc, type) => {
                const rows = Array.isArray(datasets[type]?.rows) ? datasets[type].rows.length : 0;
                acc[type] = rows;
                return acc;
              }, {})
            });
          } catch (error) {
            return jsonResponse({ success: false, error: "Worker -> GAS Master Sync Hatası: " + error.message });
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

        // 🧹 Yazma sonrası ilgili KV key'lerini temizle (Cache Invalidation)
        if (env.DB && result.success && writeActions.includes(action)) {
          if (action === "importBackup") {
            ctx.waitUntil(purgeCachePrefix("cache:"));
            return jsonResponse(result);
          }
          if (action === "updateMasterData") {
            ctx.waitUntil(purgeCachePrefix("cache:getMasterData:"));
          }

          const invalidateKeys = new Set();

          if (action === "addCompany" || action === "updateCompany") {
            invalidateKeys.add("cache:getCompanies:{}");
            invalidateKeys.add("cache:getConsultants:{}");
            invalidateKeys.add(indexKeys.companyById);

            const companyId = params?.id ?? result?.data?.id ?? result?.data;
            if (companyId !== undefined && companyId !== null && companyId !== "") {
              invalidateKeys.add(`cache:getCompanyById:${stableStringify({ id: companyId })}`);
            }
          }

          if (action === "addCertificate" || action === "updateCertificate" || action === "updateCertificateField" || action === "editCell" || action === "updateGozetim" || action === "updateSurveillance") {
            invalidateKeys.add("cache:getCertificates:{}");
            invalidateKeys.add(`cache:getRecentCertificates:${stableStringify({ limit: 25 })}`);
            invalidateKeys.add("cache:getRecentCertificates:{}");
            invalidateKeys.add(indexKeys.certsByFirmaId);

            const p = params?.props || params;
            const certFirmaId = resolveFirmaId(
              p?.firmaId ??
              p?.certInfo?.firmano ??
              p?.certInfo?.firmaNo ??
              p?.certInfo?.fno
            );
            if (certFirmaId) {
              invalidateKeys.add(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: certFirmaId })}`);
            } else {
              // Firma ID bilinmeyen sertifika güncellemelerinde (örn. bulk update/edit alias),
              // firma bazlı tüm cache key'leri temizlenir.
              ctx.waitUntil(purgeCachePrefix("cache:getCertificatesByFirmaId:"));
            }
          }

          if (action === "addTest" || action === "updateTest") {
            invalidateKeys.add(indexKeys.testsByFirmaId);
            const testFirmaId = resolveFirmaId(
              params?.firmaId ??
              params?.testInfo?.firmaNo ??
              params?.testInfo?.firmano ??
              params?.testInfo?.fno
            );
            if (testFirmaId) {
              invalidateKeys.add(`cache:getTestsByFirmaId:${stableStringify({ firmaId: testFirmaId })}`);
            }
          }

          if (action === "scheduleAudit" || action === "updateAudit") {
            invalidateKeys.add("cache:getAudits:{}");
            invalidateKeys.add(indexKeys.auditsByFirmaId);
            const auditFirmaId = resolveFirmaId(
              params?.firmaId ??
              params?.data?.firmaNo ??
              params?.data?.firmano
            );
            if (auditFirmaId) {
              invalidateKeys.add(`cache:getAuditsByFirmaId:${stableStringify({ firmaId: auditFirmaId })}`);
            }
          }

          if (action === "addProforma" || action === "addProInfo") {
            invalidateKeys.add(indexKeys.proformasByFirmaId);
            invalidateKeys.add(indexKeys.proformasById);
            const proformaFirmaId = resolveFirmaId(
              params?.firmaId ??
              params?.proInfo?.firmaNo ??
              params?.proInfo?.firmano ??
              params?.proInfo?.fno
            );
            if (proformaFirmaId) {
              invalidateKeys.add(`cache:getProformaByFirmaId:${stableStringify({ firmaId: proformaFirmaId })}`);
            }
          }

          if (invalidateKeys.size > 0) {
            ctx.waitUntil(Promise.all([...invalidateKeys].map((key) => env.DB.delete(key))));
          }
        }

        return jsonResponse(result);

      } catch (err) {
        return jsonResponse({ success: false, error: "Proxy Hatası: " + err.message }, 500);
      }
    }

    return new Response("🚀 Medicert Cloudflare Proxy (v5.4) Active", {
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  },
};
