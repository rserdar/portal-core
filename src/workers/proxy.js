/**
 * 🛰️ Medicert Portal: Cloudflare Worker Proxy (v5.5.2 / Phase 3.7)
 *
 * Mimari özeti:
 * - KV-primary read (miss => needsHydration)
 * - KV-primary write (Sheets write-back devre dışı)
 * - bulkSync dışında full-dataset rebuild yasak
 * - günlük write path'leri yalnızca etkilenen index/key üzerinde incremental çalışır
 * - Google-native side-effect'ler geçici olarak kapalı
 *
 * Gereksinimler:
 * - KV namespace binding: env.DB
 * - Worker secrets: env.API_KEY, env.GAS_API_URL
 */

export default {
  async fetch(request, env, ctx) {
    const allowedOriginPatterns = [
      /^https:\/\/portal\.medicert\.com\.tr$/,
      /^https:\/\/portal\.pages\.dev$/,
      /^http:\/\/localhost(?::\d+)?$/,
      /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
    ];

    const origin = request.headers.get("Origin");
    const isAllowedOrigin = origin
      ? allowedOriginPatterns.some((pattern) => pattern.test(origin))
      : false;
    const resolvedOrigin = isAllowedOrigin ? origin : "https://portal.medicert.com.tr";

    const corsHeaders = {
      "Access-Control-Allow-Origin": resolvedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };

    const jsonResponse = (payload, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const jsonResponseWithRawData = (rawData, extra = {}, status = 200) => {
      const extraEntries = Object.entries(extra);
      const extraSuffix = extraEntries.length
        ? `,${extraEntries.map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`).join(",")}`
        : "";
      return new Response(`{"success":true,"data":${rawData}${extraSuffix}}`, {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    };

    if (origin && !isAllowedOrigin) {
      return jsonResponse({ success: false, error: "CORS_ORIGIN_NOT_ALLOWED" }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const indexKeys = {
      companySearch: "cache:index:companies:search", // Lightweight search index: { id: {id,nickname,unvan,city,kapsam,scope} }
      companyNextId: "cache:meta:companyNextId",
      certificateNextId: "cache:index:certificates:nextId",
      certificateSummary: "cache:index:certificates:summary", // Lightweight cert index: { id: {id,firmaNo,nickname,standart,...} }
      certificateRecent: "cache:index:certificates:recent", // Son 50 sertifika ID dizisi (desc)
      dashboardStats: "cache:index:dashboard:stats",
      fullCertificates: "cache:index:certificates:full",
      testNextId: "cache:meta:testNextId",
      fullTests: "cache:full:tests",
      auditNextId: "cache:meta:auditNextId",
      fullAudits: "cache:full:audits",
      proformaNextId: "cache:meta:proformaNextId",
      fullProformas: "cache:full:proformas",
      standardsById: "cache:index:standardsById",
      auditorsById: "cache:index:auditorsById",
      // [YEDEKLEME İÇİN] Tüm verileri içeren "Full" anahtarlar
      fullCompanies: "cache:full:companies",
    };
    const CACHE_TTL = 86400 * 365; // 1 year (Primary Data Persistence)

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
    const listKvKeys = async (prefix) => {
      if (!env.DB) return [];
      const keys = [];
      let cursor = undefined;
      do {
        const page = await env.DB.list({ prefix, cursor });
        if (page.keys && page.keys.length) {
          keys.push(...page.keys.map((entry) => entry.name));
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return keys;
    };
    const purgeStaleKvKeys = async (prefix, keepKeys) => {
      if (!env.DB) return;
      const keep = keepKeys instanceof Set ? keepKeys : new Set(Array.isArray(keepKeys) ? keepKeys : []);
      let cursor = undefined;
      do {
        const page = await env.DB.list({ prefix, cursor });
        if (page.keys && page.keys.length) {
          const staleKeys = page.keys
            .map((entry) => entry.name)
            .filter((name) => !keep.has(name));
          if (staleKeys.length) {
            await Promise.all(staleKeys.map((name) => env.DB.delete(name)));
          }
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
    const mapLegacyCompanyRow = (row) => {
      const r = Array.isArray(row) ? row : [];
      return {
        "Firma No": String(r[0] ?? "").trim(),
        "Firma Adı": String(r[1] ?? "").trim(),
        Unvan: String(r[2] ?? "").trim(),
        Adres: String(r[3] ?? "").trim(),
        "İl": String(r[4] ?? "").trim(),
        "Ülke": String(r[5] ?? "").trim(),
        "Yazışma Adresi": String(r[6] ?? "").trim(),
        "Vergi Dairesi": String(r[7] ?? "").trim(),
        "Vergi Numarası": String(r[8] ?? "").trim(),
        Telefon: String(r[9] ?? "").trim(),
        Faks: String(r[10] ?? "").trim(),
        "İnternet": String(r[11] ?? "").trim(),
        Mail: String(r[12] ?? "").trim(),
        "Yetkili Adı": String(r[13] ?? "").trim(),
        "Yetkili Ünvanı": String(r[14] ?? "").trim(),
        KYT: String(r[15] ?? "").trim(),
        "İrtibat Kişisi": String(r[16] ?? "").trim(),
        "İrtibat Ünvanı": String(r[17] ?? "").trim(),
        "İrtibat Tel": String(r[18] ?? "").trim(),
        "İrtibat Mail": String(r[19] ?? "").trim(),
        "Türkçe Kapsam": String(r[20] ?? "").trim(),
        "İngilizce Kapsam": String(r[21] ?? "").trim(),
        "Yapılan İş": String(r[22] ?? "").trim(),
        "Toplam Çalışan Sayısı": String(r[23] ?? "0").trim(),
        "Yönetim Çalışan Sayısı": String(r[24] ?? "0").trim(),
        "Üretim Çalışan Sayısı": String(r[25] ?? "0").trim(),
        "Aynı İş Çalışan Sayısı": String(r[26] ?? "0").trim(),
        "Yarı Zamanlı Çalışan Sayısı": String(r[27] ?? "0").trim(),
        "Taşeron Çalışan Sayısı": String(r[28] ?? "0").trim(),
        Alan: String(r[29] ?? "").trim(),
        Departman: String(r[30] ?? "").trim(),
        Vardiya: String(r[31] ?? "1").trim(),
        "Firma Logosu": String(r[32] ?? "").trim(),
        "Kaşe İmza": String(r[33] ?? "").trim(),
        "Danışman": String(r[34] ?? "").trim(),
        "Doküman": String(r[35] ?? "").trim(),
        "Teknik Dosya": String(r[36] ?? "").trim(),
        "Teknik Dosya Kapsamı": String(r[37] ?? "").trim(),
        "Firma Sınıfı": String(r[38] ?? "").trim(),
        "Firma Not": String(r[39] ?? "").trim(),
        EA: String(r[40] ?? "").trim(),
        NACE: String(r[41] ?? "").trim(),
        "Medikal Sektör": String(r[42] ?? "").trim(),
        "Gıda Sektörü": String(r[43] ?? "").trim(),
      };
    };
    const hasUsableAuditDates = (audits) => Array.isArray(audits) && audits.some((audit) =>
      audit && typeof audit === "object" && String(audit.a1Basla || audit.a1Bitis || audit.a2Basla || audit.a2Bitis || "").trim()
    );
    const rebuildAuditsFromIndex = async () => {
      if (!env.DB) return null;
      // fullAudits aggregate'ten yükle (canonical objeler, ters sıralı)
      const fullRaw = await env.DB.get(indexKeys.fullAudits);
      if (fullRaw) {
        const all = JSON.parse(fullRaw);
        return Array.isArray(all) ? [...all].reverse() : [];
      }
      // Fallback: per-firma key'lerden topla
      const keys = await listKvKeys("cache:getAuditsByFirmaId:");
      if (keys.length === 0) return null;
      const chunks = [];
      for (let i = 0; i < keys.length; i += 25) {
        chunks.push(Promise.all(keys.slice(i, i + 25).map(k => env.DB.get(k))));
      }
      const results = await Promise.all(chunks);
      const rows = results.flat().filter(Boolean).flatMap(raw => {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      });
      return rows.length ? rows.reverse() : null;
    };
    const parseVersionNumber = (raw) => {
      const n = parseInt(String(raw ?? "0"), 10);
      return isNaN(n) ? 0 : n;
    };
    const headerCache = new Map();
    const normalizeHeader = (value) => {
      const s = String(value || "");
      if (headerCache.has(s)) return headerCache.get(s);
      const res = s
        .trim()
        .toLocaleLowerCase("tr-TR")
        .replace(/[ıİ]/g, "i")
        .replace(/[ğĞ]/g, "g")
        .replace(/[üÜ]/g, "u")
        .replace(/[şŞ]/g, "s")
        .replace(/[öÖ]/g, "o")
        .replace(/[çÇ]/g, "c")
        .replace(/[^a-z0-9]+/g, "");
      headerCache.set(s, res);
      return res;
    };

    const getPicker = (record, explicitValues = null) => {
      const src = record && typeof record === "object" ? record : {};
      let normalizedMap = null;

      return (aliases, fallback = "") => {
        // Explicit override: allows empty strings (user intentionally cleared a field)
        if (explicitValues) {
          for (const alias of aliases) {
            if (Object.prototype.hasOwnProperty.call(explicitValues, alias)) {
              const v = explicitValues[alias];
              return (v !== undefined && v !== null) ? String(v).trim() : fallback;
            }
          }
        }

        // Fast path: exact key match (skip empty — not an explicit override)
        for (const alias of aliases) {
          const val = src[alias];
          if (val !== undefined && val !== null && String(val).trim() !== "") return String(val).trim();
        }

        // Lazy initialization
        if (!normalizedMap) {
          normalizedMap = new Map();
          for (const [key, value] of Object.entries(src)) {
            if (value !== undefined && value !== null && String(value).trim() !== "") {
              normalizedMap.set(normalizeHeader(key), String(value).trim());
            }
          }
        }

        // Normalized checking
        for (const alias of aliases) {
          const norm = normalizeHeader(alias);
          if (normalizedMap.has(norm)) return normalizedMap.get(norm);
        }
        return fallback;
      };
    };

    const pickObjectValue = (record, aliases, fallback = "") => {
      const src = record && typeof record === "object" ? record : {};
      for (const alias of aliases) {
        const val = src[alias];
        if (val !== undefined && val !== null && String(val).trim() !== "") return String(val).trim();
      }
      for (const alias of aliases) {
        const norm = normalizeHeader(alias);
        for (const [key, value] of Object.entries(src)) {
          if (value !== undefined && value !== null && String(value).trim() !== "") {
            if (normalizeHeader(key) === norm) return String(value).trim();
          }
        }
      }
      return fallback;
    };
    const findValueCaseInsensitive = (obj, searchKeys) => {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
      const kv = Object.entries(obj);
      for (const s of searchKeys) {
        const normSearch = s.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const [k, v] of kv) {
          const normKey = k.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (normKey === normSearch) return v;
        }
      }
      return null;
    };

    const getCertificateId = (record) => {
      if (Array.isArray(record)) return String(record[0] ?? "").trim();
      const val = findValueCaseInsensitive(record, ["ID", "certId", "CertNo", "Sertifika No", "Belge No", "sno", "sertifikano"]);
      return val ? String(val).trim() : null;
    };

    const getCertificateFirmaId = (record) => {
      if (Array.isArray(record)) return String(record[2] ?? "").trim();
      const val = findValueCaseInsensitive(record, ["firmaNo", "Firma No", "firmano", "fno", "cid"]);
      return val ? String(val).trim() : null;
    };
    const buildCertificatesByFirmaId = (certificates) => {
      const grouped = {};
      for (const certificate of Array.isArray(certificates) ? certificates : []) {
        const firmaId = getCertificateFirmaId(certificate);
        if (!firmaId) continue;
        if (!grouped[firmaId]) grouped[firmaId] = [];
        grouped[firmaId].push(certificate);
      }
      return grouped;
    };
    const buildCertificatesById = (certificates) => {
      const indexed = {};
      for (const certificate of Array.isArray(certificates) ? certificates : []) {
        const id = getCertificateId(certificate);
        if (!id) continue;
        indexed[id] = certificate;
      }
      return indexed;
    };
    const sortCertificatesByIdDesc = (certificates) =>
      [...(Array.isArray(certificates) ? certificates : [])].sort((a, b) => {
        const aId = parseInt(getCertificateId(a), 10);
        const bId = parseInt(getCertificateId(b), 10);
        return (isNaN(bId) ? 0 : bId) - (isNaN(aId) ? 0 : aId);
      });
    const mergeRecentCertificateIds = (existingIds, incomingIds, limit = 50) => {
      const seen = new Set();
      const merged = [];
      for (const rawId of [...(incomingIds || []), ...(existingIds || [])]) {
        const id = String(rawId || "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        merged.push(id);
        if (merged.length >= limit) break;
      }
      return merged;
    };
    const rebuildCertificatesFromEntityKeys = async () => {
      if (!env.DB) return null;

      // Try rebuilding from full index first (Fast & Reliable)
      const fullRaw = await env.DB.get(indexKeys.fullCertificates);
      if (fullRaw) {
        const fullList = JSON.parse(fullRaw);
        return sortCertificatesByIdDesc(fullList);
      }

      // Fallback: list individual entity keys (Slow, legacy method)
      const entityKeys = await listKvKeys("cache:getCertificateById:");
      if (!entityKeys.length) return [];
      const certRaws = await Promise.all(entityKeys.map((key) => env.DB.get(key)));
      const certificates = certRaws
        .filter(Boolean)
        .map((raw) => {
          try {
            return createCanonicalCertificate(JSON.parse(raw));
          } catch (_) {
            return null;
          }
        })
        .filter((certificate) => certificate && getCertificateId(certificate));
      const certById = buildCertificatesById(certificates);
      return sortCertificatesByIdDesc(Object.values(certById));
    };
    const mapLegacyCertificateRow = (row) => {
      const r = Array.isArray(row) ? row : [];
      return {
        ID: String(r[0] ?? "").trim(),
        "Firma Adı": String(r[1] ?? "").trim(),
        "Firma No": String(r[2] ?? "").trim(),
        Standart: String(r[3] ?? "").trim(),
        "Denetim Tipi": String(r[4] ?? "").trim(),
        "Sertifika No": String(r[5] ?? "").trim(),
        "Sertifika Tarihi": String(r[6] ?? "").trim(),
        "Gözetim Tarihi": String(r[7] ?? "").trim(),
        "Tescil Tarihi": String(r[8] ?? "").trim(),
        "Sertifika Geçerlilik Tarihi": String(r[9] ?? "").trim(),
        Kapsam: String(r[10] ?? "").trim(),
        Scope: String(r[11] ?? "").trim(),
        Logo: String(r[12] ?? "").trim(),
        Kod: String(r[13] ?? "").trim(),
        Akreditasyon: String(r[14] ?? "").trim(),
        Akredite: String(r[15] ?? "").trim(),
        "Danışman": String(r[16] ?? "").trim(),
        Durum: String(r[17] ?? "").trim(),
        Not: String(r[18] ?? "").trim(),
        "Gözetim Conf.": String(r[19] ?? "").trim(),
        "Other Standard": String(r[20] ?? "").trim(),
        "Calendar ID": String(r[21] ?? "").trim(),
        "QR Code": String(r[22] ?? "").trim(),
        "Cert Link": String(r[23] ?? "").trim(),
      };
    };
    const unmapCertificateToRow = (c) => {
      const row = new Array(24).fill("");
      row[0] = String(c.ID ?? c.id ?? "");
      row[1] = String(c["Firma Adı"] ?? c.Nickname ?? c.nick ?? "");
      row[2] = String(c["Firma No"] ?? c.firmaNo ?? c.firmano ?? "");
      row[3] = String(c.Standart ?? c.standart ?? "");
      row[4] = String(c["Denetim Tipi"] ?? c.denetim ?? "");
      row[5] = String(c["Sertifika No"] ?? c.sno ?? c.sNo ?? "");
      row[6] = String(c["Sertifika Tarihi"] ?? c.gst ?? c.sTarihi ?? "");
      row[7] = String(c["Gözetim Tarihi"] ?? c.goz ?? c.sGozetimT ?? "");
      row[8] = String(c["Tescil Tarihi"] ?? c.stt ?? c.sTT ?? "");
      row[9] = String(c["Sertifika Geçerlilik Tarihi"] ?? c.sgt ?? c.sGT ?? "");
      row[10] = String(c.Kapsam ?? c.kapsam ?? "");
      row[11] = String(c.Scope ?? c.scope ?? "");
      row[12] = String(c.Logo ?? c.logo ?? "");
      row[13] = String(c.Kod ?? c.kod ?? c.NACE ?? "");
      row[14] = String(c.Akreditasyon ?? c.akreditasyon ?? c.akrn ?? "");
      row[15] = String(c.Akredite ?? c.akredite ?? "");
      row[16] = String(c["Danışman"] ?? c.dan ?? c.danisman ?? "");
      row[17] = String(c.Durum ?? c.durum ?? "");
      row[18] = String(c.Not ?? c.not ?? "");
      row[19] = String(c["Gözetim Conf."] ?? c.gozetimConfirmed ?? c.gozetimConf ?? "");
      row[20] = String(c["Other Standard"] ?? c.other ?? "");
      row[21] = String(c["Calendar ID"] ?? c.eventId ?? c.calendar ?? "");
      row[22] = String(c["QR Code"] ?? c.qr ?? "");
      row[23] = String(c["Cert Link"] ?? c.certLink ?? c.certiLink ?? "");
      return row;
    };
    const normalizeCertificateSource = (source) => Array.isArray(source) ? mapLegacyCertificateRow(source) : source;
    const createCanonicalCertificate = (source, options = {}) => {
      const normalizedSource = normalizeCertificateSource(source);
      const input = normalizedSource && typeof normalizedSource === "object" ? normalizedSource : {};
      const pick = getPicker(input, options.explicit || null);
      const id = String(options.id ?? getCertificateId(input) ?? "").trim();
      const nick = pick(["nick", "nickname", "Nickname", "Firma Adı", "isim", "FirmaAdi"]);
      const firmaNo = pick(["firmano", "firmaNo", "Firma No", "fno", "FirmaNo"]);
      const standart = pick(["standart", "standard", "Standart", "Standard"]);
      const denetim = pick(["denetim", "Denetim Tipi", "Denetim", "denetimTipi", "DenetimTipi"]);
      const sno = pick(["sno", "sNo", "Sertifika No", "sertNo", "SertifikaNo", "Belge No", "BelgeNo"]);
      const gst = pick(["gst", "sTarihi", "Sertifika Tarihi", "Belge Tarihi", "BelgeTarihi"]);
      const goz = pick(["goz", "sGozetimT", "Gözetim Tarihi", "Sertifika Gözetim Tarihi"]);
      const stt = pick(["stt", "sTT", "Tescil Tarihi", "Sertifika Tescil Tarihi", "Son Tetkik Tarihi"]);
      const sgt = pick(["sgt", "sGT", "Sertifika Geçerlilik Tarihi"]);
      const kapsam = pick(["kapsam", "Kapsam"]);
      const scope = pick(["scope", "Scope"]);
      const akreditasyon = pick(["akreditasyon", "Akreditasyon", "akrn"]);
      const akredite = pick(["akredite", "Akredite"]);
      const dan = pick(["dan", "danisman", "Danışman", "Danisman"]);
      const other = pick(["other", "Other Standard", "Other", "Diğer", "Diger", "Diğer Standart"]);
      const durum = pick(["durum", "Durum"]);
      const not = pick(["not", "Not"]);
      const gozetimConf = pick(["gozetimConfirmed", "gozetimConf", "Gözetim Conf.", "gozetim"]);
      const calendar = pick(["calendar", "Calendar ID", "eventId"]);
      const qr = pick(["qr", "QR Code"]);
      const certLink = pick(["certLink", "certiLink", "Cert Link"]);
      const logo = pick(["logo", "Logo"]);
      const kod = pick(["kod", "Kod", "NACE", "nace"]);

      const canonical = {
        // ...(input || {}), // [DÜZELTME] Veri tekrarını önlemek için ham input spread'i kaldırıldı
        ...(id ? { ID: id, id, certId: id } : {}),
        "Firma Adı": nick, Nickname: nick, nick, isim: nick,
        "Firma No": firmaNo, firmaNo, firmano: firmaNo,
        Standart: standart, standart,
        "Denetim Tipi": denetim, denetim, denetimTipi: denetim,
        "Sertifika No": sno, sno, sNo: sno,
        "Sertifika Tarihi": gst, gst, sTarihi: gst,
        "Gözetim Tarihi": goz, "Sertifika Gözetim Tarihi": goz, goz, sGozetimT: goz,
        "Tescil Tarihi": stt, "Sertifika Tescil Tarihi": stt, "Son Tetkik Tarihi": stt, stt, sTT: stt,
        "Sertifika Geçerlilik Tarihi": sgt, sgt, sGT: sgt,
        Kapsam: kapsam, kapsam,
        Scope: scope, scope,
        Akreditasyon: akreditasyon, akreditasyon, akrn: akreditasyon,
        Akredite: akredite, akredite,
        "Danışman": dan, Danisman: dan, dan, danisman: dan,
        "Other Standard": other, Other: other, other,
        Durum: durum, durum,
        Not: not, not,
        "Gözetim Conf.": gozetimConf, gozetimConfirmed: gozetimConf, gozetimConf, gozetim: gozetimConf,
        "Calendar ID": calendar, calendar, eventId: calendar,
        "QR Code": qr, qr,
        "Cert Link": certLink, certLink, certiLink: certLink,
        Logo: logo, logo,
        Kod: kod, kod, NACE: kod, nace: kod,
      };
      return canonical;
    };
    const stripMeta = (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const next = { ...value };
      delete next.__etag;
      return next;
    };
    const createEtag = (value) => stableStringify(stripMeta(value));
    const pickRowValue = (record, aliases, fallback = "") => pickObjectValue(record, aliases, fallback);
    const pickCompanyValue = (record, aliases, fallback = "") => pickObjectValue(record, aliases, fallback);
    const getCompanyId = (record) => pickCompanyValue(record, ["Firma No", "FirmaNo", "firmaNo", "id", "ID"]);
    const normalizeCompanySource = (source) => Array.isArray(source) ? mapLegacyCompanyRow(source) : source;
    const createCanonicalCompany = (source, options = {}) => {
      const normalizedSource = normalizeCompanySource(source);
      const input = normalizedSource && typeof normalizedSource === "object" ? normalizedSource : {};
      const pick = getPicker(input, options.explicit || null);
      const id = String(options.id ?? getCompanyId(input) ?? "").trim();
      const nick = pick(["nickname", "nick", "Nick", "FirmaAdi", "Firma Adı"]);
      const unvan = pick(["unvan", "Unvan"]);
      const adres = pick(["adres", "Adres"]);
      const sehir = pick(["sehir", "il", "İl", "Il", "Şehir", "Sehir"]);
      const ulke = pick(["ulke", "Ülke", "Ulke"], "TÜRKİYE");
      const yazisma = pick(["yazisma", "YazismaAdresi", "Yazışma Adresi", "Şube Adresi"]);
      const vergiD = pick(["vergiD", "VergiDairesi", "Vergi Dairesi"]);
      const vergiN = pick(["vergiN", "VergiNumarasi", "Vergi Numarası"]);
      const tel = pick(["tel", "Tel", "Telefon"]);
      const faks = pick(["faks", "Faks"]);
      const www = pick(["www", "web", "İnternet", "Internet", "Web"]);
      const mail = pick(["mail", "Mail", "E-Posta"]);
      const yetA = pick(["yetA", "YetkiliAdi", "Yetkili Adı"]);
      const yetU = pick(["yetU", "YetkiliUnvani", "Yetkili Ünvanı", "Yetkili Unvani"]);
      const kyt = pick(["kyt", "KYT", "Kalite Yönetim Temsilcisi"]);
      const irtA = pick(["irtA", "IrtibatKisi", "İrtibat Kişisi"]);
      const irtU = pick(["irtU", "IrtibatUnvani", "İrtibat Ünvanı"]);
      const irtN = pick(["irtN", "IrtibatKisiNumarasi", "İrtibat Tel"]);
      const irtM = pick(["irtM", "IrtibatKisisMail", "İrtibat Mail"]);
      const kapsam = pick(["kapsam", "Kapsam", "Sertifika Kapsamı (TR)", "Türkçe Kapsam"]);
      const scope = pick(["scope", "Scope", "Sertifika Kapsamı (EN)", "İngilizce Kapsam"]);
      const yapis = pick(["yapis", "YapilanIs", "Yapılan İş"]);
      const tcs = pick(["tcs", "TCS", "Toplam Çalışan Sayısı"], "0");
      const ycs = pick(["ycs", "YCS", "Yönetim Çalışan Sayısı"], "0");
      const ucs = pick(["ucs", "UCS", "Üretim Çalışan Sayısı"], "0");
      const yzcs = pick(["yzcs", "YZCS", "Yarı Zamanlı Çalışan Sayısı"], "0");
      const tascs = pick(["tascs", "TASCS", "Taşeron Çalışan Sayısı"], "0");
      const acs = pick(["acs", "ACS", "Aynı İşte Çalışan Sayısı"], "0");
      const alan = pick(["alan", "Alan"]);
      const dept = pick(["departman", "dept", "Departman"]);
      const vardiya = pick(["vardiya", "Vardiya"], "1");
      const logo = pick(["logo", "logoK", "Firma Logosu", "LogoKaşe", "LogoKase"]);
      const kase = pick(["kase", "Kaşe İmza", "Kase Imza", "Kaşe&İmza"]);
      const dan = pick(["dan", "danisman", "Danisman", "Danışman"]);
      const ea = pick(["ea", "EA"]);
      const nace = pick(["nace", "NACE"]);
      const not = pick(["not", "Not", "Firma Not"]);
      const sinif = pick(["sinif", "Firma Sınıfı", "Firma Sinifi"]);
      const dokuman = pick(["dokuman", "Dokuman", "Doküman"]);
      const teknik = pick(["teknik", "Teknik Dosya"]);
      const tkapsam = pick(["tkapsam", "Teknik Dosya Kapsamı", "Teknik Dosya Kaspamı"]);
      const medikal = pick(["medikal", "Medikal Sektör"]);
      const gida = pick(["gida", "Gıda Sektörü", "Gida Sektoru"]);

      const canonical = {
        // ...(input || {}), // [DÜZELTME] Veri tekrarını önlemek için ham input spread'i kaldırıldı
        ...(id ? { "Firma No": id, FirmaNo: id, firmaNo: id, id, ID: id } : {}),
        "Firma Adı": nick, FirmaAdi: nick, nickname: nick, Nick: nick, nick,
        Unvan: unvan, unvan,
        Adres: adres, adres,
        "İl": sehir, Il: sehir, "Şehir": sehir, Sehir: sehir, sehir, il: sehir,
        "Ülke": ulke, Ulke: ulke, ulke,
        "Yazışma Adresi": yazisma, YazismaAdresi: yazisma, yazisma,
        "Vergi Dairesi": vergiD, VergiDairesi: vergiD, vergiD,
        "Vergi Numarası": vergiN, VergiNumarasi: vergiN, vergiN,
        Telefon: tel, Tel: tel, tel,
        Faks: faks, faks,
        "İnternet": www, Internet: www, Web: www, www,
        Mail: mail, mail,
        "Yetkili Adı": yetA, YetkiliAdi: yetA, yetA,
        "Yetkili Ünvanı": yetU, "Yetkili Unvani": yetU, YetkiliUnvani: yetU, yetU,
        KYT: kyt, kyt,
        "İrtibat Kişisi": irtA, IrtibatKisi: irtA, irtA,
        "İrtibat Ünvanı": irtU, IrtibatUnvani: irtU, irtU,
        "İrtibat Tel": irtN, IrtibatKisiNumarasi: irtN, irtN,
        "İrtibat Mail": irtM, IrtibatKisisMail: irtM, irtM,
        "Türkçe Kapsam": kapsam, "Sertifika Kapsamı (TR)": kapsam, Kapsam: kapsam, kapsam,
        "İngilizce Kapsam": scope, "Sertifika Kapsamı (EN)": scope, Scope: scope, scope,
        "Yapılan İş": yapis, YapilanIs: yapis, yapis,
        "Toplam Çalışan Sayısı": tcs, TCS: tcs, tcs,
        "Yönetim Çalışan Sayısı": ycs, YCS: ycs, ycs,
        "Üretim Çalışan Sayısı": ucs, UCS: ucs, ucs,
        "Yarı Zamanlı Çalışan Sayısı": yzcs, YZCS: yzcs, yzcs,
        "Taşeron Çalışan Sayısı": tascs, TASCS: tascs, tascs,
        "Aynı İşte Çalışan Sayısı": acs, ACS: acs, acs,
        Alan: alan, alan,
        Departman: dept, departman: dept, dept,
        Vardiya: vardiya, vardiya,
        "Firma Logosu": logo, LogoKase: logo, logoK: logo, logo,
        "Kaşe İmza": kase, "Kase Imza": kase, kase,
        "Danışman": dan, Danisman: dan, dan, danisman: dan,
        EA: ea, ea,
        NACE: nace, nace,
        "Firma Not": not, Not: not, not,
        "Firma Sınıfı": sinif, "Firma Sinifi": sinif, sinif,
        "Doküman": dokuman, Dokuman: dokuman, dokuman,
        "Teknik Dosya": teknik, teknik,
        "Teknik Dosya Kapsamı": tkapsam, "Teknik Dosya Kaspamı": tkapsam, tkapsam,
        "Medikal Sektör": medikal, medikal,
        "Gıda Sektörü": gida, "Gida Sektoru": gida, gida,
      };
      canonical.__etag = createEtag(canonical);
      return canonical;
    };
    // Arama indeksi için hafif firma kaydı — sadece search.astro'nun ihtiyaç duyduğu 4 alan
    const createSearchEntry = (company) => ({
      id: String(getCompanyId(company) || ""),
      nickname: String(company.nickname || company.nick || company["Firma Adı"] || company.FirmaAdi || ""),
      unvan: String(company.unvan || company.Unvan || ""),
      city: String(company.sehir || company["İl"] || company.Il || ""),
      kapsam: String(company.kapsam || company["Türkçe Kapsam"] || company["Sertifika Kapsamı (TR)"] || company.Kapsam || ""),
      scope: String(company.scope || company["İngilizce Kapsam"] || company["Sertifika Kapsamı (EN)"] || company.Scope || ""),
    });
    const createCertificateSummary = (certificate, city = "") => {
      const canonical = createCanonicalCertificate(certificate);
      const rawStandard = String(pickObjectValue(canonical, ["Standart", "standart", "Standard"], "")).trim();
      const otherStandard = String(pickObjectValue(canonical, ["Other Standard", "Other", "other", "Diğer Standart", "Diğer", "Diger"], "")).trim();
      const standardLower = rawStandard.toLocaleLowerCase("tr-TR");
      const standart = ["diğer", "diger", "other"].includes(standardLower) && otherStandard
        ? otherStandard
        : rawStandard;

      return {
        id: String(getCertificateId(canonical) || ""),
        firmaNo: String(getCertificateFirmaId(canonical) || ""),
        nickname: String(pickObjectValue(canonical, ["Nickname", "nick", "Firma Adı", "isim"], "")),
        standart,
        city: String(city || "").trim(),
        denetimTipi: String(pickObjectValue(canonical, ["Denetim Tipi", "denetimTipi", "denetim"], "")),
        sertifikaNo: String(pickObjectValue(canonical, ["Sertifika No", "sNo", "sno"], "")),
        sertifikaTarihi: String(pickObjectValue(canonical, ["Sertifika Tarihi", "gst", "sTarihi", "Belge Tarihi"], "")),
        gozetimTarihi: String(pickObjectValue(canonical, ["Gözetim Tarihi", "goz", "sGozetimT", "Sertifika Gözetim Tarihi"], "")),
        gozetimConfirmed: String(pickObjectValue(canonical, ["Gözetim Conf.", "gozetimConfirmed", "gozetimConf", "gozetim"], "")),
        danisman: String(pickObjectValue(canonical, ["Danışman", "Danisman", "dan", "danisman"], "")),
        durum: String(pickObjectValue(canonical, ["Durum", "durum", "Status"], "AKTIF")),
        gecerlilikTarihi: String(pickObjectValue(canonical, ["Sertifika Geçerlilik Tarihi", "sGT", "SGT", "gecerlilikTarihi"], "")),
      };
    };

    /**
     * 📜 KV Paging Helper — Cloudflare'in 1.000 liste limitini cursor ile aşar
     * Tüm eşleşen anahtarları döndürür. env.DB.list({ prefix, cursor }) kullanır.
     */
    const listAllKvKeys = async (prefix) => {
      const keys = [];
      let cursor = "";
      while (true) {
        const list = await env.DB.list({ prefix, cursor });
        keys.push(...list.keys);
        if (list.list_complete) break;
        cursor = list.cursor;
      }
      return keys;
    };

    /**
     * 📊 REBUILD DASHBOARD STATS (New Gen Architecture)
     * Verileri tek tek yüklemek yerine indeksleri çekip bellekte istatistikleri fırınlar.
     */
    const rebuildDashboardStats = async () => {
      if (!env.DB) return null;
      try {
        const [summaryRaw, fullRaw, companyRaw] = await Promise.all([
          env.DB.get(indexKeys.certificateSummary),
          env.DB.get(indexKeys.fullCertificates),
          env.DB.get(indexKeys.companySearch)
        ]);


        let certificates = [];
        const summaryList = summaryRaw ? Object.values(JSON.parse(summaryRaw)) : [];
        const fullList = fullRaw ? JSON.parse(fullRaw) : [];

        // 🛡️ En dolgun veriyi seç (Grafikler için)
        if (fullList.length > summaryList.length && fullList.length > 0) {
          certificates = fullList.map(item => createCertificateSummary(item));
        } else {
          certificates = summaryList;
        }

        const companies = companyRaw ? Object.values(JSON.parse(companyRaw)) : [];
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const today = new Date(currentYear, currentMonth, now.getDate());

        // DD.MM.YYYY veya DD/MM/YYYY → Date (geçersizse null)
        const parseTRDate = (str) => {
          const m = String(str || "").trim().match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
          if (!m) return null;
          return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
        };

        const stats = {
          totalCompanies: companies.length,
          totalCertificates: certificates.length,
          activeCertificates: 0,
          pendingSurveillance: 0,
          lastSync: Date.now()
        };

        const charts = { consultants: {}, yearly: {}, cityDensity: {}, cities: {} };
        const uniqueCompanies = new Set();
        const companyToCity = new Map();
        const foreignCompanies = new Set();

        // Türkçe karakterleri ASCII'ye çevirir (şehir ve durum normalize için)
        const normalizeTR = (raw) =>
          String(raw || "").trim().toUpperCase()
            .replace(/\u0130/g, "I").replace(/Ğ/g, "G").replace(/Ü/g, "U")
            .replace(/Ş/g, "S").replace(/Ö/g, "O").replace(/Ç/g, "C");

        companies.forEach(c => {
          if (!c.id) return;
          // Sadece harf bırak: "T.C." → "TC", "TÜRKİYE" → "TURKIYE", "TR (İst.)" → "TR"
          const ulkeStr = normalizeTR(c.ulke || c.Ulke || "").replace(/[^A-Z]/g, "");
          const isTurkish = !ulkeStr || ["TR", "TC", "TURKIYE", "TURKEY"].includes(ulkeStr);
          if (!isTurkish) {
            foreignCompanies.add(String(c.id));
            return;
          }
          const city = normalizeTR(c.city || c.City || c.Il || c.il || c.sehir) || "BILINMIYOR";
          companyToCity.set(String(c.id), city);
        });

        const cityMap = new Map();

        certificates.forEach((c) => {
          if (!c) return;

          // Yabancı firmaya ait sertifika tüm sayaçlardan dışlanıyor
          const firmaNoStr = String(c.firmaNo || "");
          if (firmaNoStr && foreignCompanies.has(firmaNoStr)) return;

          if (firmaNoStr) uniqueCompanies.add(firmaNoStr);

          // Aktif sertifika: bugün sertifikaTarihi ile gozetimTarihi arasında VE gözetim onaylanmamış
          const certDate = parseTRDate(c.sertifikaTarihi);
          const gozDate = parseTRDate(c.gozetimTarihi);
          const gozConf = String(c.gozetimConfirmed || "").toUpperCase();
          const gozNotConfirmed = gozConf !== "TRUE";

          const isActive = certDate !== null && gozDate !== null &&
            certDate <= today && today <= gozDate &&
            gozNotConfirmed;
          if (isActive) stats.activeCertificates++;

          // Bekleyen gözetim: geçen ay + bu ay + gelecek ay penceresi, onaylanmamış
          // 1 aydan eski → yeniden belgelendirme kapsamı, pencere dışında kalıyor
          const surveillanceWindowStart = new Date(currentYear, currentMonth - 1, 1);
          const surveillanceWindowEnd = new Date(currentYear, currentMonth + 2, 0);
          let isPending = false;
          if (gozDate && gozNotConfirmed && gozDate >= surveillanceWindowStart && gozDate <= surveillanceWindowEnd) {
            stats.pendingSurveillance++;
            isPending = true;
          }

          const dan = String(c.danisman || "Atanmamış").trim() || "Atanmamış";
          charts.consultants[dan] = (charts.consultants[dan] || 0) + 1;

          const dateStr = String(c.sertifikaTarihi || "").trim();
          const yearMatch = dateStr.match(/[./](\d{4})$/);
          if (yearMatch) charts.yearly[yearMatch[1]] = (charts.yearly[yearMatch[1]] || 0) + 1;

          const city = normalizeTR(c.city || companyToCity.get(firmaNoStr)) || "BILINMIYOR";

          if (!cityMap.has(city)) {
            cityMap.set(city, { activeCerts: 0, pendingSurveillance: 0, consultants: new Set(), totalCompanies: new Set(), nicknames: [] });
          }
          const entry = cityMap.get(city);
          if (isActive) entry.activeCerts++;
          if (isPending) entry.pendingSurveillance++;
          if (dan !== "Atanmamış") entry.consultants.add(dan);
          if (firmaNoStr) entry.totalCompanies.add(firmaNoStr);
          if (entry.nicknames.length < 15) entry.nicknames.push(c.nickname || "İsimsiz Firma");

          charts.cityDensity[city] = (charts.cityDensity[city] || 0) + 1;
        });

        // stats.totalCompanies = uniqueCompanies.size; // Bu satır gerçek sayımı bozuyordu, devre dışı bırakıldı

        cityMap.forEach((entry, city) => {
          charts.cities[city] = {
            companyCount: entry.totalCompanies.size,
            activeCerts: entry.activeCerts,
            pendingSurveillance: entry.pendingSurveillance,
            consultants: Array.from(entry.consultants).slice(0, 5),
            details: entry.nicknames
          };
        });

        const payload = { stats, charts };
        try {
          await env.DB.put(indexKeys.dashboardStats, JSON.stringify(payload), { expirationTtl: CACHE_TTL });
        } catch (writeErr) {
          // Günlük yazma limiti (1.000) dolmuş olabilir, hatayı yut ama veriyi yine de dön
          console.warn("Dashboard stats KV'ye kaydedilemedi (Limit dolmuş olabilir):", writeErr.message);
        }
        return payload;
      } catch (err) {
        // console.error("rebuildDashboardStats Hatası:", err);
        throw err; // Hata artık yutulmuyor, yukarı fırlatılıyor
      }
    };
    const createCanonicalTestRow = (source, options = {}) => {
      const input = source && typeof source === "object" ? source : {};
      const pick = getPicker(input, options.explicit || null);
      const id = String(options.id ?? pick(["ID", "id"]) ?? "").trim();
      return {
        id,
        firmaAdi: pick(["firmaAdi", "fname", "nick"]) ?? "",
        firmaNo: pick(["firmaNo", "fno"]) ?? "",
        testAdi: pick(["testAdi"]) ?? "",
        marka: pick(["marka"]) ?? "",
        urun: pick(["urun"]) ?? "",
        urunKodu: pick(["urunKodu"]) ?? "",
        urunNo: pick(["urunNo"]) ?? "",
        lot: pick(["lot"]) ?? "",
        urunKabul: pick(["urunKabul"]) ?? "",
        kabulSaat: pick(["kabulSaat"]) ?? "",
        testBaslangic: pick(["testBaslangic"]) ?? "",
        testBitis: pick(["testBitis"]) ?? "",
        raporTarihi: pick(["raporTarihi"]) ?? "",
        raporNo: pick(["raporNo"]) ?? "",
        numuneSayisi: pick(["numuneSayisi"]) ?? "",
        numuneUT: pick(["numuneUT"]) ?? "",
        numuneSKT: pick(["numuneSKT"]) ?? "",
        urunBilgi: pick(["urunBilgi"]) ?? "",
        gorsel1: pick(["gorsel1"]) ?? "",
        gorsel2: pick(["gorsel2"]) ?? "",
        detay: pick(["detay"]) ?? "",
      };
    };
    const getTestId = (t) => String(t?.id ?? t?.ID ?? "").trim();
    const getTestFirmaId = (t) => String(t?.firmaNo ?? t?.fno ?? "").trim();
    const loadTestNextId = async () => {
      if (!env.DB) return "1";
      const raw = await env.DB.get(indexKeys.testNextId);
      const n = parseInt(String(raw || "").trim(), 10);
      return Number.isFinite(n) && n >= 1 ? String(n) : "1";
    };
    const mapRawProformaRow = (row) => {
      const r = Array.isArray(row) ? row : [];
      return {
        id: String(r[0] ?? "").trim(),
        nick: r[1] || "",
        firmaNo: r[2] || "",
        kdvsiz: r[3] || "0",
        kdvOran: r[4] || "20",
        kdv: r[5] || "0",
        toplam: r[6] || "0",
        birim: r[7] || "TL",
        tarih: r[8] || "",
        konu: r[9] || "",
      };
    };
    const createCanonicalProformaRow = (source, options = {}) => {
      const input = source && typeof source === "object" ? source : {};
      const pick = getPicker(input);
      const id = String(options.id ?? pick(["ID", "id", "faturaNo"]) ?? "").trim();
      return {
        id,
        nick: pick(["nick", "nickname", "firmaAdi"], ""),
        firmaNo: pick(["firmaNo", "firmano", "fno"], ""),
        kdvsiz: pick(["kdvsiz", "haric"], "0"),
        kdvOran: pick(["kdvOran", "oran"], "20"),
        kdv: pick(["kdv"], "0"),
        toplam: pick(["toplam"], "0"),
        birim: pick(["birim", "paraBirimi"], "TL"),
        tarih: pick(["tarih"], ""),
        konu: pick(["konu"], ""),
      };
    };
    const getProformaId = (p) => String(p?.id ?? p?.ID ?? p?.faturaNo ?? "").trim();
    const getProformaFirmaId = (p) => String(p?.firmaNo ?? p?.fno ?? "").trim();
    const loadProformaNextId = async () => {
      const raw = await env.DB.get(indexKeys.proformaNextId);
      const parsed = parseInt(String(raw || "").trim(), 10);
      return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
    };
    const getAuditId = (a) => String(a?.id ?? a?.ID ?? "").trim();
    const getAuditFirmaId = (a) => String(a?.firmaNo ?? a?.firmano ?? "").trim();
    const createCanonicalAuditRow = (source, options = {}) => {
      const input = source && typeof source === "object" ? source : {};
      const pick = getPicker(input, options.explicit || null);
      const id = String(options.id ?? getAuditId(input) ?? "").trim();
      return {
        id,
        nick:       pick(["nick", "nickname"]) ?? "",
        firmaNo:    pick(["firmaNo", "firmano"]) ?? "",
        standart:   pick(["standart"]) ?? "",
        denetimTipi: pick(["denetimTipi", "denetim"]) ?? "",
        a1Full:     pick(["a1Full", "a1Denetci"]) ?? "",
        a1Auditor:  pick(["a1Auditor", "a1Denetci", "a1Full"]) ?? "",
        a2Full:     pick(["a2Full", "a2Denetci"]) ?? "",
        a2Auditor:  pick(["a2Auditor", "a2Denetci", "a2Full"]) ?? "",
        a1Basla:    pick(["a1Basla", "a1Baslav2"]) ?? "",
        a1Bitis:    pick(["a1Bitis", "a1Bitisv2"]) ?? "",
        a1Md:       pick(["a1Md"]) ?? "",
        a1La:       pick(["a1La", "a1Lead"]) ?? "",
        a1Fa:       pick(["a1Fa"]) ?? "",
        a1Sa:       pick(["a1Sa"]) ?? "",
        a2Basla:    pick(["a2Basla", "a2Baslav2"]) ?? "",
        a2Bitis:    pick(["a2Bitis", "a2Bitisv2"]) ?? "",
        a2Md:       pick(["a2Md"]) ?? "",
        a2La:       pick(["a2La", "a2Lead"]) ?? "",
        a2Fa:       pick(["a2Fa"]) ?? "",
        a2Sa:       pick(["a2Sa"]) ?? "",
        qms:        pick(["qms"]) ?? "",
        mdd:        pick(["mdd"]) ?? "",
        ems:        pick(["ems"]) ?? "",
        ohs:        pick(["ohs"]) ?? "",
        fsms:       pick(["fsms"]) ?? "",
        isms:       pick(["isms"]) ?? "",
        engy:       pick(["engy"]) ?? "",
        gmp:        pick(["gmp"]) ?? "",
        a1kDenet:   pick(["a1kDenet"]) ?? "",
        a2kDenet:   pick(["a2kDenet"]) ?? "",
        a1EventId:  pick(["a1EventId"]) ?? "",
        a2EventId:  pick(["a2EventId"]) ?? "",
      };
    };
    const loadAuditNextId = async () => {
      if (!env.DB) return "1";
      const raw = await env.DB.get(indexKeys.auditNextId);
      const n = parseInt(String(raw || "").trim(), 10);
      return Number.isFinite(n) && n >= 1 ? String(n) : "1";
    };
    const rowToObject = (headers, row) => {
      const obj = {};
      const safeHeaders = Array.isArray(headers) ? headers : [];
      const safeRow = Array.isArray(row) ? row : [];
      safeHeaders.forEach((header, index) => {
        obj[String(header ?? "").trim()] = String(safeRow[index] ?? "").trim();
      });
      return obj;
    };
    const extractConsultantNameFromRow = (headers, row) => {
      const objectRow = rowToObject(headers, row);
      const directName = pickObjectValue(objectRow, ["Danışman", "Danisman", "Name", "Ad Soyad", "Adı Soyadı", "Full Name", "FullName"]);
      if (directName) return directName;
      const firstName = pickObjectValue(objectRow, ["Ad", "First Name", "İsim", "Isim"]);
      const lastName = pickObjectValue(objectRow, ["Soyad", "Last Name"]);
      const combined = `${firstName} ${lastName}`.trim();
      if (combined) return combined;
      const fallback = Array.isArray(row) ? String(row[0] ?? "").trim() : "";
      return fallback;
    };
    const buildConsultantsFromDataset = (dataset) => {
      const headers = Array.isArray(dataset?.headers) ? dataset.headers : [];
      const rows = Array.isArray(dataset?.rows) ? dataset.rows : [];
      return [...new Set(
        rows
          .map((row) => extractConsultantNameFromRow(headers, row))
          .filter((value) => value && String(value).trim())
      )].sort((a, b) => String(a).localeCompare(String(b), "tr"));
    };
    const getMasterDataset = async (type) => {
      if (!env.DB) return null;
      const typeKey = `cache:getMasterData:${stableStringify({ type })}`;
      const typedRaw = await env.DB.get(typeKey);
      if (typedRaw) {
        const typedPayload = JSON.parse(typedRaw);
        const typedDataset = typedPayload?.dataset;
        if (typedDataset && Array.isArray(typedDataset.headers)) return typedDataset;
      }

      const allRaw = await env.DB.get("cache:getMasterData:{}");
      if (!allRaw) return null;
      const allPayload = JSON.parse(allRaw);
      const dataset = allPayload?.datasets?.[type];
      return dataset && Array.isArray(dataset.headers) ? dataset : null;
    };
    const buildStandardsByIdFromDataset = (dataset) => {
      const indexed = {};
      const headers = Array.isArray(dataset?.headers) ? dataset.headers : [];
      const rows = Array.isArray(dataset?.rows) ? dataset.rows : [];
      rows.forEach((row) => {
        const objectRow = rowToObject(headers, row);
        // "Standart" (TR sheet header) ve "standard" (EN alias) her ikisi de eşleşmeli.
        // normalizeHeader("Standart") → "standart", normalizeHeader("standard") → "standard"
        // Bunlar farklı olduğu için iki alias da listeye eklendi.
        const standardId = pickObjectValue(objectRow, ["Standart", "standard", "ID", "id", "Standart ID", "Standart No"]);
        if (!standardId) return;
        indexed[String(standardId)] = objectRow;
      });
      return indexed;
    };
    const loadStandardIndexes = async () => {
      if (!env.DB) return null;
      const indexedRaw = await env.DB.get(indexKeys.standardsById);
      if (indexedRaw) {
        const indexed = JSON.parse(indexedRaw);
        // Boş obje cache'i geçersiz say — yanlış kurulmuş eski index'i atla
        if (indexed && typeof indexed === "object" && Object.keys(indexed).length > 0) return indexed;
      }

      const dataset = await getMasterDataset("standards");
      if (!dataset) return null;
      const indexed = buildStandardsByIdFromDataset(dataset);
      if (Object.keys(indexed).length) {
        await env.DB.put(indexKeys.standardsById, JSON.stringify(indexed), { expirationTtl: CACHE_TTL });
      }
      return indexed;
    };
    const getTestValue = (row, aliases = []) => pickObjectValue(row, aliases, "");
    const getTestDocByName = async (testName) => {
      const target = String(testName || "").trim().toLocaleLowerCase("tr-TR");
      if (!target) return null;

      const cacheKey = `cache:getTestDocByName:${stableStringify({ name: target })}`;
      if (env.DB) {
        const cached = await env.DB.get(cacheKey);
        if (cached) return JSON.parse(cached);
      }

      const dataset = await getMasterDataset("testdocs");
      if (!dataset) return null;
      const headers = Array.isArray(dataset.headers) ? dataset.headers : [];
      const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
      
      const matchedRow = rows.find((row) => {
        const objectRow = rowToObject(headers, row);
        const docName = pickObjectValue(objectRow, ["Doküman Adı", "Dokuman Adi", "Doc Name", "DokumanAdi"], "");
        return String(docName || "").trim().toLocaleLowerCase("tr-TR") === target;
      });

      const matchedObj = matchedRow ? rowToObject(headers, matchedRow) : null;
      if (matchedObj && env.DB) {
        ctx.waitUntil(env.DB.put(cacheKey, JSON.stringify(matchedObj), { expirationTtl: CACHE_TTL }));
      }
      return matchedObj;
    };
    const buildCertificatePayloadFromKv = async (id, lang, select) => {
      const certKey = `cache:getCertificateById:${stableStringify({ id: String(id) })}`;
      let certRaw = await env.DB.get(certKey);

      // Fallback: bireysel key yoksa fullCertificates index'inden bul (bulkSync sonrası mevcuttur)
      if (!certRaw) {
        const fullRaw = await env.DB.get(indexKeys.fullCertificates);
        if (fullRaw) {
          const fullList = JSON.parse(fullRaw);
          const found = fullList.find((c) => String(getCertificateId(c)) === String(id));
          if (found) {
            certRaw = JSON.stringify(found);
            ctx.waitUntil(env.DB.put(certKey, certRaw, { expirationTtl: CACHE_TTL }));
          }
        }
      }

      if (!certRaw) throw new Error(`CERTIFICATE_KV_EMPTY: Sertifika '${id}' KV'de bulunamadı. Önce senkronizasyon yapın.`);
      const certObj = JSON.parse(certRaw);

      const firmId = getCertificateFirmaId(certObj);
      const standardId = pickObjectValue(certObj, ["Standart", "Standard", "standart"]);
      if (!firmId) throw new Error("Sertifika kaydında firma no boş.");
      if (!standardId) throw new Error("Sertifika kaydında standart boş.");

      const companyRaw = await env.DB.get(`cache:company:${firmId}`);
      if (!companyRaw) throw new Error(`COMPANY_KV_EMPTY: Firma '${firmId}' KV'de bulunamadı. Önce senkronizasyon yapın.`);
      const company = JSON.parse(companyRaw);

      const standardsById = await loadStandardIndexes();
      if (!standardsById) {
        throw new Error("STANDARD_KV_EMPTY: Standart KV verisi boş. Önce master senkronizasyonu yapın.");
      }
      const stdObj = standardsById[String(standardId)] || null;
      if (!stdObj) throw new Error(`Standart KV indexinde '${standardId}' bulunamadı.`);

      return {
        nick: pickObjectValue(certObj, ["Nickname", "Nick", "nick", "Firma Adı", "isim"]),
        id: String(firmId),
        standard: pickObjectValue(certObj, ["Standart", "Standard", "standart"]),
        sNo: pickObjectValue(certObj, ["Sno", "sNo", "Sertifika No", "sertNo", "SertifikaNo"]),
        sTarihi: pickObjectValue(certObj, ["GST", "gst", "Sertifika Tarihi", "Belge Tarihi", "sTarihi"]),
        sGozetimT: pickObjectValue(certObj, ["GOZ", "goz", "Gözetim Tarihi", "Sertifika Gözetim Tarihi", "sGozetimT"]),
        sTT: pickObjectValue(certObj, ["STT", "stt", "Tescil Tarihi", "Sertifika Tescil Tarihi", "Son Tetkik Tarihi", "sTT"]),
        sGT: pickObjectValue(certObj, ["SGT", "sgt", "Sertifika Geçerlilik Tarihi", "sGT"]),
        sKapsam: pickObjectValue(certObj, ["Kapsam", "Türkçe Kapsam", "kapsam"]),
        sScope: pickObjectValue(certObj, ["Scope", "İngilizce Kapsam", "scope"]),
        logo: pickObjectValue(certObj, ["Logo", "logo"]),
        nace: pickObjectValue(certObj, ["Kod", "Nace", "NACE", "kod", "nace"]),
        akrn: pickObjectValue(certObj, ["Akreditasyon", "Akrn", "AKRN", "akrn", "akreditasyon"]),
        not: pickObjectValue(certObj, ["Not", "not"]),
        other: pickObjectValue(certObj, ["Other", "Other Standard", "Diğer", "Diger", "other"]),
        qrLink: pickObjectValue(certObj, ["QrCode", "QR Code", "QR", "Search", "qr", "certLink", "Cert Link"]),
        unvan: pickObjectValue(company, ["Unvan", "unvan"]),
        adres: pickObjectValue(company, ["Adres", "adres"]),
        il: pickObjectValue(company, ["İl", "Il", "Şehir", "Sehir", "sehir", "il"]),
        ulke: pickObjectValue(company, ["Ülke", "Ulke", "ulke"]),
        sube: pickObjectValue(company, ["Şube", "Sube", "Yazışma Adresi", "Yazisma Adresi", "yazisma"]),
        trtema: pickObjectValue(stdObj, ["Temaid", "TemaID", "temaid", "TR Tema", "Türkçe Tema ID"]),
        entema: pickObjectValue(stdObj, ["Themeid", "ThemeID", "themeid", "EN Tema", "İngilizce Tema ID"]),
        lang: lang || "TR",
        select: select || "",
      };
    };
    const buildTestPayloadFromKv = async (id, lang) => {
      if (!env.DB) throw new Error("TEST_KV_EMPTY: Cloudflare KV bağı bulunamadı.");
      const testRaw = await env.DB.get(`cache:getTestById:${stableStringify({ id: String(id) })}`);
      if (!testRaw) throw new Error(`TEST_KV_EMPTY: Test '${id}' KV'de bulunamadı. Önce senkronizasyon yapın.`);
      const t = JSON.parse(testRaw);

      const testName = String(t.testAdi ?? "").trim();
      if (!testName) throw new Error("Test adı boş.");

      const testDoc = await getTestDocByName(testName);
      if (!testDoc) throw new Error(`TestDoc master dataset içinde '${testName}' bulunamadı.`);

      const firmId = getTestFirmaId(t);
      if (!firmId) throw new Error("Test kaydında firma no boş.");

      const companyRaw = await env.DB.get(`cache:company:${firmId}`);
      if (!companyRaw) throw new Error(`COMPANY_KV_EMPTY: Firma '${firmId}' KV'de bulunamadı. Önce senkronizasyon yapın.`);
      const company = JSON.parse(companyRaw);

      return {
        testno: String(t.id ?? ""),
        fnick: String(t.firmaAdi ?? ""),
        fno: String(firmId),
        testisim: testName,
        testadi: pickObjectValue(testDoc, ["Türkçe Test Adı", "Turkce Test Adi"]),
        testname: pickObjectValue(testDoc, ["İngilizce Test Adı", "Ingilizce Test Adi"]),
        trtema: pickObjectValue(testDoc, ["Türkçe Tema", "Turkce Tema"]),
        entema: pickObjectValue(testDoc, ["İngilizce Tema", "Ingilizce Tema"]),
        gunsay: pickObjectValue(testDoc, ["Gün Sayısı", "Gun Sayisi"]),
        kisabir: pickObjectValue(testDoc, ["Kısaltma", "Kisaltma"]),
        kisaiki: pickObjectValue(testDoc, ["Kısaltma 2", "Kisaltma 2"]),
        marka: String(t.marka ?? ""),
        urun: String(t.urun ?? ""),
        urunkod: String(t.urunKodu ?? ""),
        urunno: String(t.urunNo ?? ""),
        lot: String(t.lot ?? ""),
        kabultarih: String(t.urunKabul ?? ""),
        kabulsaat: String(t.kabulSaat ?? ""),
        testba: String(t.testBaslangic ?? ""),
        testbi: String(t.testBitis ?? ""),
        raportarihi: String(t.raporTarihi ?? ""),
        raporno: String(t.raporNo ?? ""),
        numunesay: String(t.numuneSayisi ?? ""),
        numuneut: String(t.numuneUT ?? ""),
        numuneskt: String(t.numuneSKT ?? ""),
        urunbilgi: String(t.urunBilgi ?? ""),
        gorselbir: String(t.gorsel1 ?? ""),
        gorseliki: String(t.gorsel2 ?? ""),
        detay: String(t.detay ?? ""),
        lang: lang || "TR",
        unvan: pickObjectValue(company, ["Unvan", "unvan"]),
        adres: pickObjectValue(company, ["Adres", "adres"]),
        sehir: pickObjectValue(company, ["İl", "Il", "Şehir", "Sehir", "sehir", "il"]),
        ulke: pickObjectValue(company, ["Ülke", "Ulke", "ulke"]),
      };
    };
    const buildProformaPayloadFromKv = async (id) => {
      const proformaRaw = await env.DB.get(`cache:getProformaById:${stableStringify({ id: String(id) })}`);
      if (!proformaRaw) throw new Error(`PROFORMA_KV_EMPTY: Proforma '${id}' KV'de bulunamadı. Önce senkronizasyon yapın.`);
      const proforma = JSON.parse(proformaRaw);

      const firmaId = getProformaFirmaId(proforma);
      if (!firmaId) throw new Error("Proforma kaydında firma no boş.");

      const companyRaw = await env.DB.get(`cache:company:${firmaId}`);
      if (!companyRaw) throw new Error(`COMPANY_KV_EMPTY: Firma '${firmaId}' KV'de bulunamadı. Önce senkronizasyon yapın.`);
      const company = JSON.parse(companyRaw);

      return {
        id: String(proforma.id || ""),
        faturaNo: String(proforma.id || ""),
        nick: String(proforma.nick || ""),
        firmaNo: String(firmaId),
        kdvsiz: String(proforma.kdvsiz || ""),
        kdvOran: String(proforma.kdvOran || "20"),
        kdv: String(proforma.kdv || ""),
        toplam: String(proforma.toplam || ""),
        birim: String(proforma.birim || "TL"),
        tarih: String(proforma.tarih || ""),
        konu: String(proforma.konu || ""),
        unvan: pickObjectValue(company, ["Unvan", "unvan", "Firma Adı", "FirmaAdi"]),
        adres: pickObjectValue(company, ["Adres", "adres"]),
        il: pickObjectValue(company, ["İl", "Il", "Şehir", "Sehir", "sehir", "il"]),
        ulke: pickObjectValue(company, ["Ülke", "Ulke", "ulke"]),
        tel: pickObjectValue(company, ["Telefon", "Tel", "tel"]),
        vergiD: pickObjectValue(company, ["Vergi Dairesi", "VergiDairesi", "vergiD"]),
        vergiN: pickObjectValue(company, ["Vergi Numarası", "VergiNumarasi", "vergiN"]),
        yetkili: pickObjectValue(company, ["Yetkili Adı", "YetkiliAdi", "yetA"]),
      };
    };

    if (request.method === "POST") {
      try {
        const body = await request.json();
        const action = body.action;
        const params = body.params || {};
        const kvPrimaryReads = String(env.KV_PRIMARY_READS || "1") === "1";

        // ⚡ YOĞUN OKUMA AKSİYONLARI (Cacheable)
        const cacheableActions = [
          "getCompanies",
          "getCompanyById",
          "getDashboardSummary",
          "getCertificateSummaries",
          "getCertificates",
          "getCertificateById",
          "getCertificatesByFirmaId",
          "getRecentCertificates",
          "getAudits",
          "getTestsByFirmaId",
          "getAuditsByFirmaId",
          "getConsultants",
          "getConsultantById",
          "getAuditorById",
          "getStandardById",
          "getTestDocByName",
          "getSysDocsBySetName",
          "getProformasByFirmaId",
          "getProformaById",
          "getMasterData",
          "getFolderId",
          "getRecentFiles",
          "getRawStats"
        ];
        const rawCachePassthroughActions = new Set([
          "getCompanies",
          "getDashboardSummary",
          "getCertificateSummaries",
          "getCertificates",
          "getRecentCertificates",
          "getConsultants",
          "getMasterData",
          "getFolderId",
          "getRecentFiles",
          "getRawStats"
        ]);
        const kvReadThroughActions = new Set([
          "getFolderId",
          "getRecentFiles",
          "getRawStats",
          "getCompanyById",   // KV miss durumunda GAS'a fallback yapılmasına izin ver
          "getCertificatesByFirmaId",
          "getTestsByFirmaId",
          "getMasterData"
        ]);
        const gasWriteActions = [
          "editCell",
          "importBackup"
        ];
        const documentListInvalidationActions = new Set([
          "convertToPdf",
          "uploadFile",
          "doUpload",
          "generateIso",
          "generateProforma",
          "generateAppForm",
          "generateDraftCertificate",
          "draftBas",
          "generateContract",
          "sozlesme",
          "generateSingleBatchDoc",
          "createBatchFolders"
        ]);

        const shouldUseKvCache = !!env.DB && cacheableActions.includes(action);
        const cacheKey = shouldUseKvCache
          ? `cache:${action}:${stableStringify(params)}`
          : null;

        // 1. KV'den Kontrol Et (Eğer DB binding varsa)
        if (shouldUseKvCache) {
          const cached = await env.DB.get(cacheKey);
          if (cached) {
            if (rawCachePassthroughActions.has(action)) {
              return jsonResponseWithRawData(cached, { fromCache: true });
            }
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

            if (action === "getConsultantById") {
              const consKey = `cache:getConsultantById:${stableStringify({ id: idKey })}`;
              const consRaw = await env.DB.get(consKey);
              if (consRaw) {
                ctx.waitUntil(env.DB.put(cacheKey, consRaw, { expirationTtl: CACHE_TTL }));
                return jsonResponseWithRawData(consRaw, { fromCache: true });
              }
              // [FALLBACK] Aggregate listeye bak (Self-healing)
              const listRaw = await env.DB.get("cache:getConsultants:{}");
              if (listRaw) {
                const list = JSON.parse(listRaw);
                // Eğer list string dizisi ise (mevcut durum), sadece varlığını kontrol et
                const found = list.find(c => (typeof c === 'string' ? c : c.id || c.name) === idKey);
                if (found) {
                  const foundStr = JSON.stringify(found);
                  ctx.waitUntil(Promise.all([
                    env.DB.put(cacheKey, foundStr, { expirationTtl: CACHE_TTL }),
                    env.DB.put(consKey, foundStr, { expirationTtl: CACHE_TTL })
                  ]));
                  return jsonResponseWithRawData(foundStr, { fromCache: true, rebuiltFromList: true });
                }
              }
              return jsonResponse({ success: false, error: "CONSULTANT_NOT_FOUND" }, 404);
            }

            if (action === "getAuditorById") {
              const auditKey = `cache:getAuditorById:${stableStringify({ id: idKey })}`;
              const auditRaw = await env.DB.get(auditKey);
              if (auditRaw) {
                ctx.waitUntil(env.DB.put(cacheKey, auditRaw, { expirationTtl: CACHE_TTL }));
                return jsonResponseWithRawData(auditRaw, { fromCache: true });
              }
              // [FALLBACK] Monolitik indekse bak (Self-healing)
              const monolithRaw = await env.DB.get(indexKeys.auditorsById);
              if (monolithRaw) {
                const monolith = JSON.parse(monolithRaw);
                const found = monolith[idKey];
                if (found) {
                  const foundStr = JSON.stringify(found);
                  ctx.waitUntil(Promise.all([
                    env.DB.put(cacheKey, foundStr, { expirationTtl: CACHE_TTL }),
                    env.DB.put(auditKey, foundStr, { expirationTtl: CACHE_TTL })
                  ]));
                  return jsonResponseWithRawData(foundStr, { fromCache: true, rebuiltFromMonolith: true });
                }
              }
              return jsonResponse({ success: false, error: "AUDITOR_NOT_FOUND" }, 404);
            }

            if (action === "getConsultants") {
            const consultantDataset = await getMasterDataset("consultants");
            if (consultantDataset) {
              const data = buildConsultantsFromDataset(consultantDataset);
              ctx.waitUntil(env.DB.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL }));
              return jsonResponse({ success: true, data, fromCache: true, rebuiltFromMasterData: true });
            }
          }

          if (action === "getCompanies") {
            const searchRaw = await env.DB.get(indexKeys.companySearch);
            if (searchRaw) {
              const searchIndex = JSON.parse(searchRaw);
              const data = Object.values(searchIndex || {});
              ctx.waitUntil(env.DB.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL }));
              return jsonResponse({ success: true, data, fromCache: true, rebuiltFromIndex: true });
            }
            // Fallback: If index is missing but full data exists
            const fullRaw = await env.DB.get(indexKeys.fullCompanies);
            if (fullRaw) {
              const full = JSON.parse(fullRaw);
              const data = full.map(createSearchEntry);
              ctx.waitUntil(env.DB.put(indexKeys.companySearch, JSON.stringify(data.reduce((acc, c) => ({ ...acc, [c.id]: c }), {})), { expirationTtl: CACHE_TTL }));
              return jsonResponse({ success: true, data, fallback: true });
            }
            return jsonResponse({ success: true, data: [], message: "No data found in KV" });
          }

          if (action === "getCertificateSummaries") {
            const summaryRaw = await env.DB.get(indexKeys.certificateSummary);
            if (summaryRaw) {
              const summaryIndex = JSON.parse(summaryRaw);
              const data = sortCertificatesByIdDesc(Object.values(summaryIndex || {}));
              ctx.waitUntil(env.DB.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL }));
              return jsonResponse({ success: true, data, fromCache: true, rebuiltFromIndex: true });
            }

            const rebuilt = await rebuildCertificatesFromEntityKeys();
            if (rebuilt && rebuilt.length) {
              const summaryIndex = {};
              rebuilt.forEach((certificate) => {
                const certId = getCertificateId(certificate);
                if (!certId) return;
                summaryIndex[String(certId)] = createCertificateSummary(certificate);
              });
              const data = Object.values(summaryIndex);
              ctx.waitUntil(Promise.all([
                env.DB.put(indexKeys.certificateSummary, JSON.stringify(summaryIndex), { expirationTtl: CACHE_TTL }),
                env.DB.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL }),
              ]));
              return jsonResponse({ success: true, data, fromCache: true, rebuiltFromEntities: true });
            }

            // bulkSync tarafından yazılan tam sertifika listesini fallback olarak kullan
            const fullRaw = await env.DB.get(indexKeys.fullCertificates);
            if (fullRaw) {
              const fullCerts = JSON.parse(fullRaw);
              const summaryIndex = {};
              fullCerts.forEach((certificate) => {
                const certId = getCertificateId(certificate);
                if (!certId) return;
                summaryIndex[String(certId)] = createCertificateSummary(certificate);
              });
              const data = sortCertificatesByIdDesc(Object.values(summaryIndex));
              ctx.waitUntil(Promise.all([
                env.DB.put(indexKeys.certificateSummary, JSON.stringify(summaryIndex), { expirationTtl: CACHE_TTL }),
                env.DB.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL }),
              ]));
              return jsonResponse({ success: true, data, fromCache: true, rebuiltFromFull: true });
            }
          }

          if (action === "getCertificates") {
            // Önce bulkSync'in yazdığı tam listeyi kontrol et (her zaman yetkili ve eksiksizdir)
            const fullRaw = await env.DB.get(indexKeys.fullCertificates);
            if (fullRaw) {
              const fullCerts = JSON.parse(fullRaw);
              const data = sortCertificatesByIdDesc(fullCerts);
              ctx.waitUntil(env.DB.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL }));
              return jsonResponse({ success: true, data, fromCache: true, rebuiltFromFull: true });
            }

            // Fallback: bireysel entity key'lerinden yeniden oluştur (eksik olabilir, son çare)
            const rebuilt = await rebuildCertificatesFromEntityKeys();
            if (rebuilt && rebuilt.length) {
              ctx.waitUntil(env.DB.put(cacheKey, JSON.stringify(rebuilt), { expirationTtl: CACHE_TTL }));
              return jsonResponse({ success: true, data: rebuilt, fromCache: true, rebuiltFromEntities: true });
            }
          }

          if (action === "getDashboardSummary") {
            const dashStatsRaw = await env.DB.get(indexKeys.dashboardStats);
            if (dashStatsRaw) {
              const parsed = JSON.parse(dashStatsRaw);
              return jsonResponse({
                success: true,
                data: parsed,          // ← sync.ts dashRes.data olarak okur
                stats: parsed.stats,   // ← geriye dönük uyumluluk
                charts: parsed.charts,
                fromPreCalc: true
              });
            }

            // Fallback: Eğer önceden hesaplanmış veri yoksa bellekte yeniden oluştur.
            const rebuilt = await rebuildDashboardStats();
            if (rebuilt) {
              return jsonResponse({
                success: true,
                data: rebuilt,
                stats: rebuilt.stats,
                charts: rebuilt.charts,
                fromPreCalc: false,
                rebuiltOnDemand: true
              });
            }

            return jsonResponse({ success: false, error: "DASHBOARD_STATS_NOT_AVAILABLE" }, 404);
          }

          if (action === "getRecentCertificates") {
            // Hafif recent index: bulkSync tarafından yazılan 50 ID dizisinden granüler lookup
            const recentIdsRaw = await env.DB.get(indexKeys.certificateRecent);
            if (recentIdsRaw) {
              const recentIds = JSON.parse(recentIdsRaw) || [];
              const limit = Math.max(1, parseInt(String(params?.limit || 25), 10) || 25);
              const slicedIds = recentIds.slice(0, limit);
              const certRaws = await Promise.all(
                slicedIds.map((id) => env.DB.get(`cache:getCertificateById:${stableStringify({ id: String(id) })}`))
              );
              const data = certRaws.filter(Boolean).map((raw) => JSON.parse(raw));
              ctx.waitUntil(env.DB.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL }));
              return jsonResponse({ success: true, data, fromCache: true, rebuiltFromIndex: true });
            }
            const rebuilt = await rebuildCertificatesFromEntityKeys();
            if (rebuilt && rebuilt.length) {
              const limit = Math.max(1, parseInt(String(params?.limit || 25), 10) || 25);
              const recentIds = rebuilt.slice(0, 50).map((certificate) => getCertificateId(certificate));
              const data = rebuilt.slice(0, limit);
              ctx.waitUntil(Promise.all([
                env.DB.put(indexKeys.certificateRecent, JSON.stringify(recentIds), { expirationTtl: CACHE_TTL }),
                env.DB.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL }),
              ]));
              return jsonResponse({ success: true, data, fromCache: true, rebuiltFromEntities: true });
            }
          }

          if (action === "getRawStats") {
            const [summaryRaw, companyRaw, fullCertRaw, fullCompRaw, dashboardRaw] = await Promise.all([
              env.DB.get(indexKeys.certificateSummary),
              env.DB.get(indexKeys.companySearch),
              env.DB.get(indexKeys.fullCertificates),
              env.DB.get(indexKeys.fullCompanies),
              env.DB.get(indexKeys.dashboardStats)
            ]);

            const certSummary = summaryRaw ? JSON.parse(summaryRaw) : {};
            const compSearch = companyRaw ? JSON.parse(companyRaw) : {};
            const fullCerts = fullCertRaw ? JSON.parse(fullCertRaw) : [];
            const fullComps = fullCompRaw ? JSON.parse(fullCompRaw) : [];
            const dashStats = dashboardRaw ? JSON.parse(dashboardRaw) : null;

            return jsonResponse({
              success: true,
              data: {
                counts: {
                  certificateSummary: Object.keys(certSummary).length,
                  companySearch: Object.keys(compSearch).length,
                  fullCertificates: Array.isArray(fullCerts) ? fullCerts.length : "invalid",
                  fullCompanies: Array.isArray(fullComps) ? fullComps.length : "invalid",
                  dashboardStatsAvailable: !!dashStats
                },
                dashboardStats: dashStats,
                samples: {
                  firstCertSummary: Object.values(certSummary).slice(0, 3),
                  firstCompSearch: Object.values(compSearch).slice(0, 3)
                }
              }
            });
          }

          // Bulk sync ile önceden yazılan indeks cache'lerini fallback olarak kullan.
          const idParam = params?.id ?? params?.firmaId;
          if (idParam !== undefined && idParam !== null) {
            const idKey = String(idParam);

            // getCompanyById: granüler cache:company:{id} direkt lookup (dev index yok)
            // getCompanyById: granüler cache:company:{id} direkt lookup + fullCompanies fallback
            if (action === "getCompanyById") {
              const companyRaw = await env.DB.get(`cache:company:${idKey}`);
              if (companyRaw !== null) {
                ctx.waitUntil(env.DB.put(cacheKey, companyRaw, { expirationTtl: CACHE_TTL }));
                return jsonResponseWithRawData(companyRaw, { fromCache: true, indexed: true });
              }
              // [FALLBACK] Full listeye bak
              const fullRaw = await env.DB.get(indexKeys.fullCompanies);
              if (fullRaw) {
                const fullList = JSON.parse(fullRaw);
                const found = fullList.find(c => String(getCompanyId(c)) === idKey);
                if (found) {
                  const foundStr = JSON.stringify(found);
                  ctx.waitUntil(Promise.all([
                    env.DB.put(cacheKey, foundStr, { expirationTtl: CACHE_TTL }),
                    env.DB.put(`cache:company:${idKey}`, foundStr, { expirationTtl: CACHE_TTL })
                  ]));
                  return jsonResponseWithRawData(foundStr, { fromCache: true, rebuiltFromFull: true });
                }
              }
            }

            let indexCacheKey = null;
            let emptyValue = null;

            // getCertificateById / getCertificatesByFirmaId:
            // cache:getCertificateById:{"id":"X"} = entity key = per-request cache key
            // bulkSync bu key'i yazar; Phase 1 hit olur. Phase 1 miss ise KV_PRIMARY_MISS doğru.
            if (action === "getTestsByFirmaId") {
              const testFirmaKey = `cache:getTestsByFirmaId:${stableStringify({ firmaId: idKey })}`;
              const testFirmaRaw = await env.DB.get(testFirmaKey);
              if (testFirmaRaw) {
                ctx.waitUntil(env.DB.put(cacheKey, testFirmaRaw, { expirationTtl: CACHE_TTL }));
                return jsonResponseWithRawData(testFirmaRaw, { fromCache: true, indexed: true });
              }
              // [FALLBACK] Full test listesine bak
              const fullTestRaw = await env.DB.get(indexKeys.fullTests);
              if (fullTestRaw) {
                const fullTests = JSON.parse(fullTestRaw);
                const filtered = fullTests.filter(t => String(getTestFirmaId(t)) === idKey);
                const filteredStr = JSON.stringify(filtered);
                ctx.waitUntil(Promise.all([
                  env.DB.put(cacheKey, filteredStr, { expirationTtl: CACHE_TTL }),
                  env.DB.put(testFirmaKey, filteredStr, { expirationTtl: CACHE_TTL })
                ]));
                return jsonResponseWithRawData(filteredStr, { fromCache: true, rebuiltFromFull: true });
              }
            } else if (action === "getAuditsByFirmaId") {
              const auditFirmaKey = `cache:getAuditsByFirmaId:${stableStringify({ firmaId: idKey })}`;
              const auditRaw = await env.DB.get(auditFirmaKey);
              if (auditRaw) {
                ctx.waitUntil(env.DB.put(cacheKey, auditRaw, { expirationTtl: CACHE_TTL }));
                return jsonResponseWithRawData(auditRaw, { fromCache: true, indexed: true });
              }
              // [FALLBACK] Full denetim listesine bak
              const fullAuditRaw = await env.DB.get(indexKeys.fullAudits);
              if (fullAuditRaw) {
                const fullAudits = JSON.parse(fullAuditRaw);
                const filtered = fullAudits.filter(a => String(getAuditFirmaId(a)) === idKey);
                const filteredStr = JSON.stringify(filtered);
                ctx.waitUntil(Promise.all([
                   env.DB.put(cacheKey, filteredStr, { expirationTtl: CACHE_TTL }),
                   env.DB.put(auditFirmaKey, filteredStr, { expirationTtl: CACHE_TTL })
                ]));
                return jsonResponseWithRawData(filteredStr, { fromCache: true, rebuiltFromFull: true });
              }
            } else if (action === "getProformasByFirmaId") {
              const proformaFirmaKey = `cache:getProformasByFirmaId:${stableStringify({ firmaId: idKey })}`;
              const proformaRaw = await env.DB.get(proformaFirmaKey);
              if (proformaRaw) {
                ctx.waitUntil(env.DB.put(cacheKey, proformaRaw, { expirationTtl: CACHE_TTL }));
                return jsonResponseWithRawData(proformaRaw, { fromCache: true, indexed: true });
              }
              // [FALLBACK] Full proforma listesine bak
              const fullProRaw = await env.DB.get(indexKeys.fullProformas);
              if (fullProRaw) {
                const fullProformas = JSON.parse(fullProRaw);
                const filtered = fullProformas.filter(p => String(getProformaFirmaId(p)) === idKey);
                const filteredStr = JSON.stringify(filtered);
                ctx.waitUntil(Promise.all([
                  env.DB.put(cacheKey, filteredStr, { expirationTtl: CACHE_TTL }),
                  env.DB.put(proformaFirmaKey, filteredStr, { expirationTtl: CACHE_TTL })
                ]));
                return jsonResponseWithRawData(filteredStr, { fromCache: true, rebuiltFromFull: true });
              }
              return jsonResponse({ success: true, data: [] });
            } else if (action === "getProformaById") {
              const proformaEntityKey = `cache:getProformaById:${stableStringify({ id: idKey })}`;
              const proformaRaw = await env.DB.get(proformaEntityKey);
              if (proformaRaw) {
                ctx.waitUntil(env.DB.put(cacheKey, proformaRaw, { expirationTtl: CACHE_TTL }));
                return jsonResponseWithRawData(proformaRaw, { fromCache: true, indexed: true });
              }
              // [FALLBACK] Full listeye bak
              const fullProRaw = await env.DB.get(indexKeys.fullProformas);
              if (fullProRaw) {
                const fullProformas = JSON.parse(fullProRaw);
                const found = fullProformas.find(p => String(getProformaId(p)) === idKey);
                if (found) {
                  const foundStr = JSON.stringify(found);
                  ctx.waitUntil(Promise.all([
                    env.DB.put(cacheKey, foundStr, { expirationTtl: CACHE_TTL }),
                    env.DB.put(proformaEntityKey, foundStr, { expirationTtl: CACHE_TTL })
                  ]));
                  return jsonResponseWithRawData(foundStr, { fromCache: true, rebuiltFromFull: true });
                }
              }
              return jsonResponse({ success: false, error: "PROFORMA_NOT_FOUND" }, 404);
            } else if (action === "getStandardById") {
              const stdKey = `cache:getStandardById:${stableStringify({ id: idKey })}`;
              const stdRaw = await env.DB.get(stdKey);
              if (stdRaw) {
                ctx.waitUntil(env.DB.put(cacheKey, stdRaw, { expirationTtl: CACHE_TTL }));
                return jsonResponseWithRawData(stdRaw, { fromCache: true, indexed: true });
              }
              // [FALLBACK] Monolitik indekse bak (Self-healing)
              const monolithRaw = await env.DB.get(indexKeys.standardsById);
              if (monolithRaw) {
                const monolith = JSON.parse(monolithRaw);
                const found = monolith[idKey];
                if (found) {
                  const foundStr = JSON.stringify(found);
                  ctx.waitUntil(Promise.all([
                    env.DB.put(cacheKey, foundStr, { expirationTtl: CACHE_TTL }),
                    env.DB.put(stdKey, foundStr, { expirationTtl: CACHE_TTL })
                  ]));
                  return jsonResponseWithRawData(foundStr, { fromCache: true, rebuiltFromMonolith: true });
                }
              }
              return jsonResponse({ success: false, error: "STANDARD_NOT_FOUND" }, 404);
            } else if (action === "getCertificateById") {
              const certKey = `cache:getCertificateById:${stableStringify({ id: idKey })}`;
              const certRaw = await env.DB.get(certKey);
              if (certRaw) {
                ctx.waitUntil(env.DB.put(cacheKey, certRaw, { expirationTtl: CACHE_TTL }));
                return jsonResponseWithRawData(certRaw, { fromCache: true, indexed: true });
              }
              // [FALLBACK] Full listeye bak
              const fullCertRaw = await env.DB.get(indexKeys.fullCertificates);
              if (fullCertRaw) {
                const fullCerts = JSON.parse(fullCertRaw);
                const foundCert = fullCerts.find(c => String(getCertificateId(c)) === idKey);
                if (foundCert) {
                  const foundCertStr = JSON.stringify(foundCert);
                  ctx.waitUntil(Promise.all([
                    env.DB.put(cacheKey, foundCertStr, { expirationTtl: CACHE_TTL }),
                    env.DB.put(certKey, foundCertStr, { expirationTtl: CACHE_TTL })
                  ]));
                  return jsonResponseWithRawData(foundCertStr, { fromCache: true, rebuiltFromFull: true });
                }
              }
            } else if (action === "getCertificatesByFirmaId") {
              const resKey = `cache:getCertificatesByFirmaId:${stableStringify({ firmaId: idKey })}`;
              const resRaw = await env.DB.get(resKey);
              if (resRaw) {
                ctx.waitUntil(env.DB.put(cacheKey, resRaw, { expirationTtl: CACHE_TTL }));
                return jsonResponseWithRawData(resRaw, { fromCache: true, indexed: true });
              }
              // [FALLBACK] Full listeye bak ve firmaId'ye göre filtrele
              const fullCertRaw = await env.DB.get(indexKeys.fullCertificates);
              if (fullCertRaw) {
                const fullCerts = JSON.parse(fullCertRaw);
                const filtered = fullCerts.filter(c => String(getCertificateFirmaId(c)) === idKey);
                const filteredStr = JSON.stringify(filtered);
                ctx.waitUntil(Promise.all([
                  env.DB.put(cacheKey, filteredStr, { expirationTtl: CACHE_TTL }),
                  env.DB.put(resKey, filteredStr, { expirationTtl: CACHE_TTL })
                ]));
                return jsonResponseWithRawData(filteredStr, { fromCache: true, rebuiltFromFull: true });
              }
            }

            if (indexCacheKey) {
              const indexedRaw = await env.DB.get(indexCacheKey);
              if (indexedRaw) {
                const indexed = JSON.parse(indexedRaw);
                const hasIndexedValue = Object.prototype.hasOwnProperty.call(indexed, idKey);
                const data = hasIndexedValue ? indexed[idKey] : emptyValue;
                if (hasIndexedValue || Array.isArray(data)) {
                  ctx.waitUntil(env.DB.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL }));
                }
                return jsonResponse({ success: true, data, fromCache: true, indexed: true });
              }
            }
          }

          // Phase 3.5: KV primary read. Drive-backed dinamik okumalarda read-through izinlidir.
          if (kvPrimaryReads && !kvReadThroughActions.has(action)) {
            return jsonResponse({
              success: false,
              data: null,
              error: "KV_PRIMARY_MISS",
              needsHydration: true,
              action,
              params
            });
          }
        }

        if (action === "buildCertPayload") {
          if (!env.DB) {
            return jsonResponse({ success: false, error: "Cloudflare KV Bağı (DB) bulunamadı!" }, 500);
          }
          try {
            const payload = await buildCertificatePayloadFromKv(params?.id, params?.lang, params?.select);
            return jsonResponse({ success: true, data: payload, source: "kv" });
          } catch (error) {
            return jsonResponse({
              success: false,
              data: null,
              error: `Sertifika payload üretilemedi (${params?.id ?? ""}): ${error.message}`
            });
          }
        }

        if (action === "buildTestPayload") {
          if (!env.DB) {
            return jsonResponse({ success: false, error: "Cloudflare KV Bağı (DB) bulunamadı!" }, 500);
          }
          try {
            const payload = await buildTestPayloadFromKv(params?.id, params?.lang);
            return jsonResponse({ success: true, data: payload, source: "kv" });
          } catch (error) {
            return jsonResponse({
              success: false,
              data: null,
              error: `Test payload üretilemedi (${params?.id ?? ""}): ${error.message}`
            });
          }
        }

        if (action === "generateProforma") {
          if (!env.DB) {
            return jsonResponse({ success: false, error: "Cloudflare KV Bağı (DB) bulunamadı!" }, 500);
          }
          try {
            const payload = await buildProformaPayloadFromKv(params?.id);
            const gasRes = await fetch(env.GAS_API_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "generateProforma",
                apiKey: env.API_KEY || "mc-portal-3.0_8a2d7f9e4c1b5a6c3d2e1f0b9a8c7d6e",
                params: { proforma: payload }
              }),
            });
            const result = await gasRes.json().catch(() => null);
            if (!gasRes.ok || !result) {
              return jsonResponse({
                success: false,
                error: result?.error || `GAS_HTTP_${gasRes.status}`
              }, gasRes.status || 502);
            }
            return jsonResponse(result, result.success ? 200 : 500);
          } catch (error) {
            return jsonResponse({
              success: false,
              error: `Proforma payload üretilemedi (${params?.id ?? ""}): ${error.message}`
            });
          }
        }

        if (action === "getAvailableSets") {
          const indexKey = "cache:index:sysdocSets";
          const cachedIndex = await env.DB.get(indexKey);
          if (cachedIndex) {
            ctx.waitUntil(env.DB.put(cacheKey, cachedIndex, { expirationTtl: CACHE_TTL }));
            return jsonResponseWithRawData(cachedIndex, { fromCache: true });
          }

          const dataset = await getMasterDataset("sysdocs");
          if (!dataset || !dataset.rows) return jsonResponse({ success: true, data: [] });
          const sets = [...new Set(dataset.rows.map(row => row[0]).filter(Boolean))];
          const dataStr = JSON.stringify(sets);
          ctx.waitUntil(env.DB.put(indexKey, dataStr, { expirationTtl: CACHE_TTL }));
          return jsonResponse({ success: true, data: sets, rebuiltFromMaster: true });
        }

        if (action === "prepareBatchFolders") {
          const setName = params?.data?.setName;
          const nick = params?.data?.nick;

          const sysdocKey = `cache:getSysDocsBySetName:${stableStringify({ setName })}`;
          let rowsRaw = await env.DB.get(sysdocKey);

          if (!rowsRaw) {
            const dataset = await getMasterDataset("sysdocs");
            if (dataset && dataset.rows) {
              const filtered = dataset.rows.filter(row => String(row[0]) === String(setName));
              if (filtered.length > 0) rowsRaw = JSON.stringify(filtered);
            }
          }

          if (!rowsRaw) return jsonResponse({ success: false, error: `"${setName}" setine ait veri bulunamadı.` });
          const allRows = JSON.parse(rowsRaw);
          const validRows = allRows.filter(row => Boolean(row[5])); // Kolon 5 template/ID kontrolü
          
          if (validRows.length === 0) return jsonResponse({ success: false, error: `"${setName}" setine ait geçerli şablon bulunamadı.` });
          const uniqueSubFolders = [...new Set(validRows.map(row => row[2]))];

          // Google Drive'da klasörleri oluşturmak için GAS'a side-effect isteği at
          const gasRes = await fetch(env.GAS_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "createBatchFolders",
              apiKey: env.API_KEY,
              params: { nick, uniqueSubFolders }
            })
          });
          const payload = await gasRes.json().catch(() => null);
          if (!gasRes.ok || !payload || !payload.success) {
            return jsonResponse({ success: false, error: payload?.error || "Klasör oluşturma hatası" });
          }

          return jsonResponse({ success: true, rows, folderMap: payload.data });
        }

        // 2. Dashboard İstatistiklerini Yeniden Hesapla
        if (action === "rebuildStats") {
          if (!env.DB) {
            return jsonResponse({ success: false, error: "Cloudflare KV Bağı (DB) bulunamadı!" }, 500);
          }
          try {
            const result = await rebuildDashboardStats();
            if (result) {
              return jsonResponse({ success: true, data: result });
            } else {
              return jsonResponse({ success: false, error: "İŞLEM_BAŞARISIZ", details: "rebuildDashboardStats null döndü." }, 500);
            }
          } catch (e) {
             return jsonResponse({ success: false, error: "REBUILD_EXCEPTION", details: e.message, stack: e.stack }, 500);
          }
        }

        // 2.1 Cache Temizleme Aksiyonu (Özel)
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
          const writes = [
            env.DB.put(allKey, JSON.stringify(payload), { expirationTtl: CACHE_TTL }),
            env.DB.put(typeKey, JSON.stringify(typePayload), { expirationTtl: CACHE_TTL })
          ];

          if (type === "consultants") {
            const list = buildConsultantsFromDataset(ds);
            writes.push(
              env.DB.put("cache:getConsultants:{}", JSON.stringify(list), { expirationTtl: CACHE_TTL })
            );
            // Granüler key'leri de güncelle
            for (const name of list) {
              if (name) {
                writes.push(env.DB.put(`cache:getConsultantById:${stableStringify({ id: String(name) })}`, JSON.stringify(name), { expirationTtl: CACHE_TTL }));
              }
            }
          }
          if (type === "standards") {
            const h = Array.isArray(ds.headers) ? ds.headers : [];
            const r = Array.isArray(ds.rows) ? ds.rows : [];
            const standardsById = {};
            for (const row of r) {
              const std = rowToObject(h, row);
              const sId = std?.ID || std?.id;
              if (sId) {
                const stringId = String(sId);
                standardsById[stringId] = std;
                writes.push(env.DB.put(`cache:getStandardById:${stableStringify({ id: stringId })}`, JSON.stringify(std), { expirationTtl: CACHE_TTL }));
              }
            }
            writes.push(env.DB.put(indexKeys.standardsById, JSON.stringify(standardsById), { expirationTtl: CACHE_TTL }));
          }
          if (type === "auditors") {
            const h = Array.isArray(ds.headers) ? ds.headers : [];
            const r = Array.isArray(ds.rows) ? ds.rows : [];
            const auditorsById = {};
            for (const row of r) {
              const aud = rowToObject(h, row);
              const aId = aud?.ID || aud?.id;
              if (aId) {
                const stringId = String(aId);
                auditorsById[stringId] = aud;
                writes.push(env.DB.put(`cache:getAuditorById:${stableStringify({ id: stringId })}`, JSON.stringify(aud), { expirationTtl: CACHE_TTL }));
              }
            }
            writes.push(env.DB.put(indexKeys.auditorsById, JSON.stringify(auditorsById), { expirationTtl: CACHE_TTL }));
          }
          if (type === "testdocs") {
            const h = Array.isArray(ds.headers) ? ds.headers : [];
            const r = Array.isArray(ds.rows) ? ds.rows : [];
            for (const row of r) {
              const td = rowToObject(h, row);
              const tdName = pickObjectValue(td, ["Doküman Adı", "Dokuman Adi", "Doc Name", "DokumanAdi"]);
              if (tdName) {
                const target = String(tdName).trim().toLocaleLowerCase("tr-TR");
                writes.push(env.DB.put(`cache:getTestDocByName:${stableStringify({ name: target })}`, JSON.stringify(td), { expirationTtl: CACHE_TTL }));
              }
            }
          }
          if (type === "sysdocs") {
            const r = Array.isArray(ds.rows) ? ds.rows : [];
            const sets = [...new Set(r.map(row => row[0]).filter(Boolean))];
            writes.push(env.DB.put("cache:index:sysdocSets", JSON.stringify(sets), { expirationTtl: CACHE_TTL }));
            for (const setName of sets) {
              const rows = r.filter(row => String(row[0]) === String(setName));
              writes.push(env.DB.put(`cache:getSysDocsBySetName:${stableStringify({ setName })}`, JSON.stringify(rows), { expirationTtl: CACHE_TTL }));
            }
          }

          await Promise.all(writes);

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
            const scope = Array.isArray(params?.scope) ? params.scope : ["companies", "certificates", "audits", "tests", "proformas", "master"];
            const hasScope = (s) => scope.includes(s);

            const syncRes = await fetch(env.GAS_API_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ 
                action: "getFullSyncData", 
                params: { 
                  scope, 
                  offset: params?.offset, 
                  limit: params?.limit 
                }, 
                apiKey: env.API_KEY 
              })
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
              const stats = {};
              const writes = [];
              const purges = [];

              // --- 🏗️ COMPANIES ---
              let canonicalCompanies = [];
              if (hasScope("companies")) {
                const companies = Array.isArray(d.companies) ? d.companies : [];
                const mappedCompanies = companies.map(c => Array.isArray(c) ? mapLegacyCompanyRow(c) : c);
                canonicalCompanies = mappedCompanies.map((company) => createCanonicalCompany(company)).filter((company) => getCompanyId(company));

                // Güvenlik Bariyeri (Sadece şirketler güncelleniyorsa)
                const currentSearchRaw = await env.DB.get(indexKeys.companySearch);
                const currentSearch = currentSearchRaw ? JSON.parse(currentSearchRaw) : {};
                const currentCount = Object.keys(currentSearch).length;
                if (currentCount > 50 && canonicalCompanies.length < (currentCount * 0.2)) {
                  console.error(`[Sync] MASS_DELETION_PROTECTION triggered: currentCount=${currentCount}, incoming=${canonicalCompanies.length}`);
                  return jsonResponse({ success: false, error: "MASS_DELETION_PROTECTION", message: "Kritik firma veri kaybı tespiti! İşlem iptal edildi." }, 400);
                }

                if (canonicalCompanies.length === 0 && currentCount === 0) {
                  return jsonResponse({ success: false, error: "EMPTY_SYNC_DATA", message: "GAS üzerinden hiç firma verisi gelmedi. Lütfen verilerin GAS (Sheets) tarafında mevcut olduğundan emin olun." }, 400);
                }

                const companySearchIndex = {};
                for (const company of canonicalCompanies) {
                  const cid = getCompanyId(company);
                  if (cid) {
                    companySearchIndex[cid] = createSearchEntry(company);
                    // [OPTIMIZATION] Individual writes removed to stay within KV limits.
                    // Fallback to fullCompanies index handles individual lookups.
                  }
                }
                const companyNextId = canonicalCompanies.reduce((highest, company) => {
                  const parsed = parseInt(getCompanyId(company), 10);
                  return Number.isFinite(parsed) && parsed >= highest ? parsed + 1 : highest;
                }, 1);

                purges.push(purgeCachePrefix("cache:getCompanyById:"));
                
                // --- 🛡️ MERGE INDEX LOGIC ---
                const existingSearchRaw = await env.DB.get(indexKeys.companySearch);
                const existingSearch = existingSearchRaw ? JSON.parse(existingSearchRaw) : {};
                const mergedSearch = { ...existingSearch, ...companySearchIndex };

                writes.push(env.DB.put(indexKeys.companySearch, JSON.stringify(mergedSearch), { expirationTtl: CACHE_TTL }));
                writes.push(env.DB.put(indexKeys.companyNextId, String(companyNextId), { expirationTtl: CACHE_TTL }));
                writes.push(env.DB.put(`cache:getCompanies:{}`, JSON.stringify(Object.values(mergedSearch)), { expirationTtl: CACHE_TTL }));
                writes.push(env.DB.put(indexKeys.fullCompanies, JSON.stringify(canonicalCompanies), { expirationTtl: CACHE_TTL }));
                
                stats.companies = Object.keys(mergedSearch).length;
              }

              // --- 🎖️ CERTIFICATES ---
              if (hasScope("certificates")) {
                const certificates = Array.isArray(d.certificates) ? d.certificates : (Array.isArray(d.certs) ? d.certs : []);
                const certificateRows = Array.isArray(d.certificateRows) ? d.certificateRows : (Array.isArray(d.certRows) ? d.certRows : []);
                const rawCombined = [...certificates, ...certificateRows];

                const mappedCertificates = rawCombined.map(c => Array.isArray(c) ? mapLegacyCertificateRow(c) : c);
                const canonicalCertificates = mappedCertificates.map(c => createCanonicalCertificate(c)).filter(c => getCertificateId(c));

                const certById = buildCertificatesById(canonicalCertificates);
                const dedupedCertificates = Object.values(certById);

                const certificateSummaryIndex = {};

                for (const cert of dedupedCertificates) {
                  const certId = getCertificateId(cert);
                  if (certId) {
                    certificateSummaryIndex[String(certId)] = createCertificateSummary(cert);
                    // [OPTIMIZATION] Individual writes removed to stay within KV limits.
                  }
                }

                const certNextId = dedupedCertificates.reduce((highest, cert) => {
                  const parsed = parseInt(getCertificateId(cert), 10);
                  return Number.isFinite(parsed) && parsed >= highest ? parsed + 1 : highest;
                }, 1);
                const sorted = [...dedupedCertificates].sort((a, b) => (parseInt(getCertificateId(b), 10) || 0) - (parseInt(getCertificateId(a), 10) || 0));
                const recentIds = sorted.slice(0, 50).map(c => getCertificateId(c));

                purges.push(purgeCachePrefix("cache:getRecentCertificates:"));
                
                // --- 🛡️ MERGE INDEX LOGIC ---
                const existingSummaryRaw = await env.DB.get(indexKeys.certificateSummary);
                const existingSummary = existingSummaryRaw ? JSON.parse(existingSummaryRaw) : {};
                const mergedSummary = { ...existingSummary, ...certificateSummaryIndex };
                
                writes.push(env.DB.put(indexKeys.certificateSummary, JSON.stringify(mergedSummary), { expirationTtl: CACHE_TTL }));
                writes.push(env.DB.put(indexKeys.certificateNextId, String(certNextId), { expirationTtl: CACHE_TTL }));
                writes.push(env.DB.put(indexKeys.certificateRecent, JSON.stringify(recentIds), { expirationTtl: CACHE_TTL }));
                writes.push(env.DB.put(`cache:getCertificateSummaries:{}`, JSON.stringify(sortCertificatesByIdDesc(Object.values(mergedSummary))), { expirationTtl: CACHE_TTL }));
                
                stats.certs = Object.keys(mergedSummary).length;
              }

              // --- 🧪 TESTS & AUDITS & PROFORMAS ---
              if (hasScope("tests")) {
                const rawTests = Array.isArray(d.tests) ? d.tests : [];
                const canonicalTests = rawTests.map(row => createCanonicalTestRow(row));
                
                // nextId sayacı
                const maxTestId = canonicalTests.reduce((m, t) => {
                  const n = parseInt(getTestId(t), 10);
                  return !isNaN(n) && n >= m ? n + 1 : m;
                }, 1);
                writes.push(env.DB.put(indexKeys.testNextId, String(maxTestId), { expirationTtl: CACHE_TTL }));
                // Full aggregate — yalnızca export/import için
                writes.push(env.DB.put(indexKeys.fullTests, JSON.stringify(canonicalTests), { expirationTtl: CACHE_TTL }));
                stats.tests = canonicalTests.length;
              }

              if (hasScope("audits")) {
                const rawAuditObjects = Array.isArray(d.auditObjects) ? d.auditObjects : [];
                const canonicalAudits = rawAuditObjects.map(a => createCanonicalAuditRow(a));

                // Timeline listesi
                writes.push(env.DB.put(`cache:getAudits:{}`, JSON.stringify(canonicalAudits), { expirationTtl: CACHE_TTL }));
                // Full aggregate — export/import için
                writes.push(env.DB.put(indexKeys.fullAudits, JSON.stringify(canonicalAudits), { expirationTtl: CACHE_TTL }));
                // nextId sayacı
                const auditNextId = canonicalAudits.reduce((highest, audit) => {
                  const parsed = parseInt(getAuditId(audit), 10);
                  return Number.isFinite(parsed) && parsed >= highest ? parsed + 1 : highest;
                }, 1);
                writes.push(env.DB.put(indexKeys.auditNextId, String(auditNextId), { expirationTtl: CACHE_TTL }));

                stats.audits = canonicalAudits.length;
              }

              if (hasScope("proformas")) {
                const rawProformas = Array.isArray(d.proformas) ? d.proformas : [];
                const canonicalProformas = rawProformas.map(row => {
                  const mapped = Array.isArray(row) ? mapRawProformaRow(row) : row;
                  return createCanonicalProformaRow(mapped);
                });
                writes.push(env.DB.put(indexKeys.fullProformas, JSON.stringify(canonicalProformas), { expirationTtl: CACHE_TTL }));
                const proformaNextId = canonicalProformas.reduce((highest, p) => {
                  const parsed = parseInt(getProformaId(p), 10);
                  return Number.isFinite(parsed) && parsed >= highest ? parsed + 1 : highest;
                }, 1);
                writes.push(env.DB.put(indexKeys.proformaNextId, String(proformaNextId), { expirationTtl: CACHE_TTL }));
                stats.proformas = canonicalProformas.length;
              }

              if (hasScope("master")) {
                const standards = Array.isArray(d.standards) ? d.standards : [];
                const consultants = Array.isArray(d.consultants) ? d.consultants : [];
                const auditors = Array.isArray(d.auditors) ? d.auditors : [];
                
                const standardsById = {};
                for (const std of standards) {
                  const sId = std?.ID || std?.id;
                  if (sId) {
                    const stringId = String(sId);
                    standardsById[stringId] = std;
                  }
                }

                const auditorsById = {};
                for (const aud of auditors) {
                  const aId = aud?.ID || aud?.id;
                  if (aId) {
                    const stringId = String(aId);
                    auditorsById[stringId] = aud;
                  }
                }

                writes.push(env.DB.put(indexKeys.standardsById, JSON.stringify(standardsById), { expirationTtl: CACHE_TTL }));
                writes.push(env.DB.put(indexKeys.auditorsById, JSON.stringify(auditorsById), { expirationTtl: CACHE_TTL }));
                
                // Test Dokümanlarını granüler olarak kaydet
                const testdocs = Array.isArray(d.testdocs) ? d.testdocs : [];
                for (const td of testdocs) {
                  const tdName = pickObjectValue(td, ["Doküman Adı", "Dokuman Adi", "Doc Name", "DokumanAdi"]);
                  if (tdName) {
                    const target = String(tdName).trim().toLocaleLowerCase("tr-TR");
                    writes.push(env.DB.put(`cache:getTestDocByName:${stableStringify({ name: target })}`, JSON.stringify(td), { expirationTtl: CACHE_TTL }));
                  }
                }

                // Sistem Dokümanlarını (SysDocs) granüler olarak kaydet
                const sysdocs = Array.isArray(d.sysdocs) ? d.sysdocs : [];
                const sysdocSets = [...new Set(sysdocs.map(row => row[0]).filter(Boolean))];
                writes.push(env.DB.put("cache:index:sysdocSets", JSON.stringify(sysdocSets), { expirationTtl: CACHE_TTL }));
                for (const setName of sysdocSets) {
                  const setRows = sysdocs.filter(row => String(row[0]) === String(setName));
                  writes.push(env.DB.put(`cache:getSysDocsBySetName:${stableStringify({ setName })}`, JSON.stringify(setRows), { expirationTtl: CACHE_TTL }));
                }

                writes.push(env.DB.put(`cache:getConsultants:{}`, JSON.stringify(consultants), { expirationTtl: CACHE_TTL }));
                stats.master_consultants = consultants.length;
                stats.master_standards = standards.length;
                stats.master_auditors = auditors.length;
              }

              // 🚀 WRITE IN BATCHES
              for (let i = 0; i < writes.length; i += 50) {
                await Promise.all(writes.slice(i, i + 50));
              }
              if (purges.length) ctx.waitUntil(Promise.all(purges));

              // 🔥 Dashboard istatistiklerini arka planda tazele
              ctx.waitUntil(rebuildDashboardStats());

              return jsonResponse({ success: true, message: "Senkronizasyon başarılı!", stats, scope });
            } else {
              return jsonResponse(fullData);
            }
          } catch (error) {
            return jsonResponse({ success: false, error: "Worker -> GAS Bağlantı Hatası: " + error.message });
          }
        }

        // 3.2 📦 KV -> JSON YEDEKLE (Export KV Data)
        if (action === "exportKvData") {
          try {
            const scope = Array.isArray(params?.scope) ? params.scope : ["companies", "certificates", "audits", "tests", "proformas", "master"];
            const exportData = {
              version: "1.0",
              timestamp: new Date().toISOString(),
              scope,
              data: {}
            };

            const fetchPromises = [];
            if (scope.includes("companies")) fetchPromises.push(env.DB.get(indexKeys.fullCompanies).then(v => exportData.data.companies = v ? JSON.parse(v) : []));
            if (scope.includes("certificates")) fetchPromises.push(env.DB.get(indexKeys.fullCertificates).then(v => exportData.data.certificates = v ? JSON.parse(v) : []));
            if (scope.includes("tests")) fetchPromises.push(env.DB.get(indexKeys.fullTests).then(v => exportData.data.tests = v ? JSON.parse(v) : []));
            if (scope.includes("audits")) fetchPromises.push(env.DB.get(indexKeys.fullAudits).then(v => exportData.data.audits = v ? JSON.parse(v) : []));
            if (scope.includes("proformas")) {
              fetchPromises.push(env.DB.get(indexKeys.fullProformas).then(v => exportData.data.proformas = v ? JSON.parse(v) : []));
            }
            if (scope.includes("master")) {
              fetchPromises.push(env.DB.get(indexKeys.standardsById).then(v => exportData.data.standardsById = v ? JSON.parse(v) : {}));
              fetchPromises.push(env.DB.get(indexKeys.auditorsById).then(v => exportData.data.auditorsById = v ? JSON.parse(v) : {}));
              fetchPromises.push(env.DB.get(`cache:getConsultants:{}`).then(v => exportData.data.consultants = v ? JSON.parse(v) : []));
              fetchPromises.push(env.DB.get(`cache:getMasterData:${stableStringify({ type: "testdocs" })}`).then(v => exportData.data.testdocs = v ? JSON.parse(v).dataset?.rows : []));
              fetchPromises.push(env.DB.get(`cache:getMasterData:${stableStringify({ type: "sysdocs" })}`).then(v => exportData.data.sysdocs = v ? JSON.parse(v).dataset?.rows : []));
            }

            await Promise.all(fetchPromises);
            return jsonResponse({ success: true, exportData });
          } catch (error) {
            return jsonResponse({ success: false, error: "KV Export Hatası: " + error.message });
          }
        }

        // 3.3 📥 JSON -> KV GERİ YÜKLE (Import KV Data - REPLACE)
        if (action === "importKvData") {
          try {
            const payload = params?.exportData?.data || params?.payload?.data || params?.payload;
            const scope = Array.isArray(params?.scope) ? params.scope : [];
            if (!payload || !scope.length) {
              return jsonResponse({ success: false, error: "Geçersiz yedek verisi veya kapsam." }, 400);
            }

            const writes = [];
            const purges = [];
            const stats = {};

            // Helper to build Stats (Shared logic from bulkSync)
            const companies = scope.includes("companies") ? (Array.isArray(payload.companies) ? payload.companies : []) : [];
            const currentCerts = scope.includes("certificates") ? (Array.isArray(payload.certificates) ? payload.certificates : []) : [];

            // Preserve existing company count if companies are not being imported
            let baseCompanyCount = companies.length;
            if (!scope.includes("companies")) {
              const currentSearchRaw = await env.DB.get(indexKeys.companySearch);
              if (currentSearchRaw) {
                baseCompanyCount = Object.keys(JSON.parse(currentSearchRaw)).length;
              }
            }

            if (scope.includes("companies") && companies.length > 0) {
              const canonicalCompanies = companies;
              const companySearchIndex = {};
              for (const company of canonicalCompanies) {
                const cid = getCompanyId(company);
                if (cid) companySearchIndex[cid] = createSearchEntry(company);
              }
              const companyNextId = canonicalCompanies.reduce((highest, company) => {
                const parsed = parseInt(getCompanyId(company), 10);
                return Number.isFinite(parsed) && parsed >= highest ? parsed + 1 : highest;
              }, 1);

              writes.push(env.DB.put(indexKeys.companySearch, JSON.stringify(companySearchIndex), { expirationTtl: CACHE_TTL }));
              writes.push(env.DB.put(indexKeys.companyNextId, String(companyNextId), { expirationTtl: CACHE_TTL }));
              writes.push(env.DB.put(`cache:getCompanies:{}`, JSON.stringify(Object.values(companySearchIndex)), { expirationTtl: CACHE_TTL }));
              writes.push(env.DB.put(indexKeys.fullCompanies, JSON.stringify(canonicalCompanies), { expirationTtl: CACHE_TTL }));
              purges.push(purgeCachePrefix("cache:getCompanyById:"));
              stats.companies = canonicalCompanies.length;
            }

            if (scope.includes("certificates") && currentCerts.length > 0) {
              const dedupedCertificates = currentCerts;
              const certificateSummaryIndex = {};

              for (const cert of dedupedCertificates) {
                const certId = getCertificateId(cert);
                if (certId) {
                  certificateSummaryIndex[String(certId)] = createCertificateSummary(cert);
                }
              }

              const certNextId = dedupedCertificates.reduce((highest, cert) => {
                const parsed = parseInt(getCertificateId(cert), 10);
                return Number.isFinite(parsed) && parsed >= highest ? parsed + 1 : highest;
              }, 1);
              const sorted = [...dedupedCertificates].sort((a, b) => (parseInt(getCertificateId(b), 10) || 0) - (parseInt(getCertificateId(a), 10) || 0));
              const recentIds = sorted.slice(0, 50).map(c => getCertificateId(c));

              writes.push(env.DB.put(indexKeys.certificateSummary, JSON.stringify(certificateSummaryIndex), { expirationTtl: CACHE_TTL }));
              writes.push(env.DB.put(indexKeys.certificateNextId, String(certNextId), { expirationTtl: CACHE_TTL }));
              writes.push(env.DB.put(indexKeys.certificateRecent, JSON.stringify(recentIds), { expirationTtl: CACHE_TTL }));
              writes.push(env.DB.put(`cache:getCertificateSummaries:{}`, JSON.stringify(sortCertificatesByIdDesc(Object.values(certificateSummaryIndex))), { expirationTtl: CACHE_TTL }));
              writes.push(env.DB.put(`cache:getCertificates:{}`, JSON.stringify(dedupedCertificates), { expirationTtl: CACHE_TTL }));
              writes.push(env.DB.put(indexKeys.fullCertificates, JSON.stringify(dedupedCertificates), { expirationTtl: CACHE_TTL }));
              purges.push(purgeCachePrefix("cache:getRecentCertificates:"));
              purges.push(purgeCachePrefix("cache:getCertificateSummaries:"));
              purges.push(purgeCachePrefix("cache:getCertificateById:"));
              purges.push(purgeCachePrefix("cache:getCertificatesByFirmaId:"));
              stats.certs = dedupedCertificates.length;
            }

            if (scope.includes("tests") && Array.isArray(payload.tests)) {
              const importedTests = payload.tests.map(t => createCanonicalTestRow(t));
              const testsByFirmaId = {};
              for (const t of importedTests) {
                const tid = getTestId(t);
                if (tid) writes.push(env.DB.put(`cache:getTestById:${stableStringify({ id: tid })}`, JSON.stringify(t), { expirationTtl: CACHE_TTL }));
                const fNo = getTestFirmaId(t);
                if (fNo) {
                  if (!testsByFirmaId[fNo]) testsByFirmaId[fNo] = [];
                  testsByFirmaId[fNo].push(t);
                }
              }
              for (const [fNo, list] of Object.entries(testsByFirmaId)) {
                writes.push(env.DB.put(`cache:getTestsByFirmaId:${stableStringify({ firmaId: fNo })}`, JSON.stringify(list), { expirationTtl: CACHE_TTL }));
              }
              writes.push(env.DB.put(indexKeys.fullTests, JSON.stringify(importedTests), { expirationTtl: CACHE_TTL }));
              stats.tests = importedTests.length;
            }
            if (scope.includes("audits") && Array.isArray(payload.audits)) {
              const importedAudits = payload.audits.map(a => createCanonicalAuditRow(a, { explicit: true }));
              const auditsByFirmaId = {};
              for (const audit of importedAudits) {
                const aId = getAuditId(audit);
                const fNo = getAuditFirmaId(audit);
                if (aId) {
                  writes.push(env.DB.put(`cache:getAuditById:${stableStringify({ id: aId })}`, JSON.stringify(audit), { expirationTtl: CACHE_TTL }));
                  if (fNo) {
                    if (!auditsByFirmaId[fNo]) auditsByFirmaId[fNo] = [];
                    auditsByFirmaId[fNo].push(audit);
                  }
                }
              }
              for (const [fId, companyAudits] of Object.entries(auditsByFirmaId)) {
                writes.push(env.DB.put(`cache:getAuditsByFirmaId:${stableStringify({ firmaId: fId })}`, JSON.stringify(companyAudits), { expirationTtl: CACHE_TTL }));
              }
              writes.push(env.DB.put(`cache:getAudits:{}`, JSON.stringify(importedAudits), { expirationTtl: CACHE_TTL }));
              writes.push(env.DB.put(indexKeys.fullAudits, JSON.stringify(importedAudits), { expirationTtl: CACHE_TTL }));
              const auditNextId = importedAudits.reduce((highest, audit) => {
                const parsed = parseInt(getAuditId(audit), 10);
                return Number.isFinite(parsed) && parsed >= highest ? parsed + 1 : highest;
              }, 1);
              writes.push(env.DB.put(indexKeys.auditNextId, String(auditNextId), { expirationTtl: CACHE_TTL }));
              stats.audits = importedAudits.length;
            }
            if (scope.includes("proformas") && Array.isArray(payload.proformas)) {
              const importedProformas = payload.proformas.map(p => createCanonicalProformaRow(p));
              const proformasByFirmaId = {};
              for (const p of importedProformas) {
                const pId = getProformaId(p);
                const fNo = getProformaFirmaId(p);
                if (pId) {
                  writes.push(env.DB.put(`cache:getProformaById:${stableStringify({ id: pId })}`, JSON.stringify(p), { expirationTtl: CACHE_TTL }));
                  if (fNo) {
                    if (!proformasByFirmaId[fNo]) proformasByFirmaId[fNo] = [];
                    proformasByFirmaId[fNo].push(p);
                  }
                }
              }
              for (const [fId, companyProformas] of Object.entries(proformasByFirmaId)) {
                writes.push(env.DB.put(`cache:getProformasByFirmaId:${stableStringify({ firmaId: fId })}`, JSON.stringify(companyProformas), { expirationTtl: CACHE_TTL }));
              }
              writes.push(env.DB.put(indexKeys.fullProformas, JSON.stringify(importedProformas), { expirationTtl: CACHE_TTL }));
              const proformaNextId = importedProformas.reduce((highest, p) => {
                const parsed = parseInt(getProformaId(p), 10);
                return Number.isFinite(parsed) && parsed >= highest ? parsed + 1 : highest;
              }, 1);
              writes.push(env.DB.put(indexKeys.proformaNextId, String(proformaNextId), { expirationTtl: CACHE_TTL }));
              stats.proformas = importedProformas.length;
            }
            if (scope.includes("master")) {
              if (payload.standardsById) {
                writes.push(env.DB.put(indexKeys.standardsById, JSON.stringify(payload.standardsById), { expirationTtl: CACHE_TTL }));
                for (const [sId, std] of Object.entries(payload.standardsById)) {
                  writes.push(env.DB.put(`cache:getStandardById:${stableStringify({ id: String(sId) })}`, JSON.stringify(std), { expirationTtl: CACHE_TTL }));
                }
              }
              if (payload.auditorsById) {
                writes.push(env.DB.put(indexKeys.auditorsById, JSON.stringify(payload.auditorsById), { expirationTtl: CACHE_TTL }));
                for (const [aId, aud] of Object.entries(payload.auditorsById)) {
                  writes.push(env.DB.put(`cache:getAuditorById:${stableStringify({ id: String(aId) })}`, JSON.stringify(aud), { expirationTtl: CACHE_TTL }));
                }
              }
              if (payload.consultants && Array.isArray(payload.consultants)) {
                writes.push(env.DB.put(`cache:getConsultants:{}`, JSON.stringify(payload.consultants), { expirationTtl: CACHE_TTL }));
                for (const name of payload.consultants) {
                  if (name) {
                    writes.push(env.DB.put(`cache:getConsultantById:${stableStringify({ id: String(name) })}`, JSON.stringify(name), { expirationTtl: CACHE_TTL }));
                  }
                }
              }
              if (payload.testdocs && Array.isArray(payload.testdocs)) {
                // Not: TestDocs dataset yapısında sadece row array'i geliyor olabilir (export logicine göre)
                // Ama granular keyleri kurmak için header lazım. 
                // exportKvData'da sadece rows aldığımız için burada fallback ya da master dataset üzerinden header alabiliriz.
                // Basitleştirmek için rowToObject yerine direkt kolon bazlı bakabiliriz.
                for (const row of payload.testdocs) {
                  if (Array.isArray(row)) {
                    const docName = row[1]; // Genellikle 2. kolon Doküman Adı
                    if (docName) {
                      const target = String(docName).trim().toLocaleLowerCase("tr-TR");
                      writes.push(env.DB.put(`cache:getTestDocByName:${stableStringify({ name: target })}`, JSON.stringify(row), { expirationTtl: CACHE_TTL }));
                    }
                  }
                }
              }
              if (payload.sysdocs && Array.isArray(payload.sysdocs)) {
                const sysdocSets = [...new Set(payload.sysdocs.map(row => row[0]).filter(Boolean))];
                writes.push(env.DB.put("cache:index:sysdocSets", JSON.stringify(sysdocSets), { expirationTtl: CACHE_TTL }));
                for (const setName of sysdocSets) {
                  const setRows = payload.sysdocs.filter(row => String(row[0]) === String(setName));
                  writes.push(env.DB.put(`cache:getSysDocsBySetName:${stableStringify({ setName })}`, JSON.stringify(setRows), { expirationTtl: CACHE_TTL }));
                }
              }
              stats.master = true;
            }

            // Global Version Update (Force client sync)
            writes.push(env.DB.put("sys:kvVersion", String(Date.now()), { expirationTtl: CACHE_TTL }));

            for (let i = 0; i < writes.length; i += 50) {
              await Promise.all(writes.slice(i, i + 50));
            }
            if (purges.length) ctx.waitUntil(Promise.all(purges));

            // 🔥 Dashboard istatistiklerini arka planda tazele
            ctx.waitUntil(rebuildDashboardStats());

            return jsonResponse({ success: true, message: "Yedek başarıyla geri yüklendi (İndeksler tazelendi).", scope, stats });
          } catch (error) {
            return jsonResponse({ success: false, error: "KV Import Hatası: " + error.message });
          }
        }
        // 3.3a ⚡ STATS REBUILD (Senkron — certificateSummary'den direkt hesapla)
        if (action === "rebuildStats") {
          try {
            const statsRes = await rebuildDashboardStats();
            if (!statsRes) return jsonResponse({ success: false, error: "Stats Rebuild Failed" });
            // Phase-1 cache'leri invalidate et — bir sonraki çağrı doğrudan index'ten okusun
            ctx.waitUntil(Promise.all([
              env.DB.delete("cache:getCertificateSummaries:{}"),
              env.DB.delete("cache:getCompanies:{}"),
              env.DB.delete("cache:getDashboardSummary:{}"),
            ]));
            return jsonResponse({ success: true, data: statsRes, stats: statsRes.stats, charts: statsRes.charts });
          } catch (error) {
            return jsonResponse({ success: false, error: "rebuildStats Hatasi: " + error.message });
          }
        }

        // 3.3b 🔍 KV TANİ (Diagnostic)
        if (action === "kvDiagnostic") {
          try {
            const [fullRaw, summaryRaw, companyRaw, statsRaw, summariesRaw] = await Promise.all([
              env.DB.get(indexKeys.fullCertificates),
              env.DB.get(indexKeys.certificateSummary),
              env.DB.get(indexKeys.companySearch),
              env.DB.get(indexKeys.dashboardStats),
              env.DB.get("cache:getCertificateSummaries:{}"),
            ]);

            const fullList = fullRaw ? JSON.parse(fullRaw) : [];
            const summaryObj = summaryRaw ? JSON.parse(summaryRaw) : {};
            const companyObj = companyRaw ? JSON.parse(companyRaw) : {};
            const statsObj = statsRaw ? JSON.parse(statsRaw) : null;
            const summLst = summariesRaw ? JSON.parse(summariesRaw) : [];

            // Bireysel cert key sayısı (eski mimari)
            const individualKeys = await listKvKeys("cache:getCertificateById:");

            // Detaylı inceleme için ilk 10 cert
            const samples = Array.isArray(fullList) ? fullList.slice(0, 10).map(c => ({
              keys: Object.keys(c),
              detectedId: getCertificateId(c),
              detectedFirma: getCertificateFirmaId(c),
              data: JSON.stringify(c).substring(0, 200)
            })) : [];

            return jsonResponse({
              success: true,
              diagnostic: {
                fullCertificates: { exists: !!fullRaw, count: fullList?.length, sizeKB: fullRaw ? Math.round(fullRaw.length / 1024) : 0 },
                certificateSummary: { exists: !!summaryRaw, count: Object.keys(summaryObj).length, sizeKB: summaryRaw ? Math.round(summaryRaw.length / 1024) : 0 },
                getCertificateSummaries: { exists: !!summariesRaw, count: summLst?.length, sizeKB: summariesRaw ? Math.round(summariesRaw.length / 1024) : 0 },
                companySearch: { exists: !!companyRaw, count: Object.keys(companyObj).length, sizeKB: companyRaw ? Math.round(companyRaw.length / 1024) : 0 },
                dashboardStats: { exists: !!statsRaw, totalCertificates: statsObj?.stats?.totalCertificates ?? 0, lastSync: statsObj?.stats?.lastSync },
                individualCertKeys: { count: individualKeys.length, sample: individualKeys.slice(0, 3) },
                samples: samples
              }
            });
          } catch (err) {
            return jsonResponse({ success: false, error: "Diagnostic Hatasi: " + err.message });
          }
        }

        // 3.4 🛠️ DERİN İNDEKS ONARIMI — fullCertificates + companySearch join
        if (action === "deepRepairIndex") {
          try {
            const [fullRaw, companyRaw] = await Promise.all([
              env.DB.get(indexKeys.fullCertificates),
              env.DB.get(indexKeys.companySearch),
            ]);

            if (!fullRaw) {
              return jsonResponse({ success: false, error: "KV'de 'fullCertificates' bulunamadi. Once 'Sheets'ten Cek' butonunu kullanin." });
            }

            const fullList = JSON.parse(fullRaw);
            const rawCount = fullList.length;

            if (rawCount === 0) {
              return jsonResponse({ success: false, error: "fullCertificates bos. KV'de hic sertifika yok." });
            }

            console.log(`[DeepRepair] ${rawCount} sertifika bulundu. Synchronous repair starting...`);

            // Firmadan city map'ini hazirla
            const cityByFirmaId = new Map();
            if (companyRaw) {
              const companyIndex = JSON.parse(companyRaw);
              for (const [id, company] of Object.entries(companyIndex)) {
                const city = String(company.city || company.City || company.Il || "").trim().toUpperCase().replace(/\u0130/g, "I") || "BILINMIYOR";
                cityByFirmaId.set(String(id), city);
              }
            }

            // Sertifikalari isle
            const summaryIndex = {};
            for (const cert of fullList) {
              const canonical = createCanonicalCertificate(cert);
              const cid = getCertificateId(canonical);
              if (!cid) continue;

              const fNo = getCertificateFirmaId(canonical);
              const city = (fNo && cityByFirmaId.get(String(fNo))) || String(canonical.city || canonical.sehir || "").trim().toUpperCase() || "BILINMIYOR";

              const summary = createCertificateSummary(canonical);
              summary.city = city;
              summaryIndex[cid] = summary;
            }

            const summaryList = sortCertificatesByIdDesc(Object.values(summaryIndex));
            console.log(`[DeepRepair] Writing ${summaryList.length} items to KV...`);

            // ─── KV Yazma ─────────────────────────────────────────────────────
            await Promise.all([
              env.DB.put(indexKeys.certificateSummary, JSON.stringify(summaryIndex), { expirationTtl: CACHE_TTL }),
              env.DB.put("cache:getCertificateSummaries:{}", JSON.stringify(summaryList), { expirationTtl: CACHE_TTL }),
              env.DB.put("cache:getCertificates:{}", JSON.stringify(fullList), { expirationTtl: CACHE_TTL }),
              env.DB.put("sys:kvVersion", String(Date.now()), { expirationTtl: CACHE_TTL })
            ]);

            // 🔥 Dashboard istatistiklerini de SENKRON tazele
            const finalStats = await rebuildDashboardStats();

            return jsonResponse({
              success: true,
              message: `Derin onarim tamamlandi! ${summaryList.length} sertifika işlendi.`,
              stats: {
                totalFound: rawCount,
                processed: summaryList.length,
                finalTotal: finalStats?.stats?.totalCertificates,
                active: finalStats?.stats?.activeCertificates
              }
            });
          } catch (error) {
            return jsonResponse({ success: false, error: "Onarim Hatasi: " + error.message });
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

            if (datasets.consultants) {
              writes.push(
                env.DB.put(`cache:getConsultants:{}`, JSON.stringify(buildConsultantsFromDataset(datasets.consultants)), { expirationTtl: CACHE_TTL })
              );
            }

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

        if (env.DB && ["addCompany", "updateCompany"].includes(action)) {
          if (action === "addCompany") {
            const nextIdRaw = await env.DB.get(indexKeys.companyNextId);
            if (!nextIdRaw || !parseInt(String(nextIdRaw).trim(), 10)) {
              return jsonResponse({ success: false, error: "COMPANY_KV_EMPTY", message: "Firma KV verisi boş. Önce manuel Sheets -> KV senkronizasyonu yapın." });
            }
            const newId = String(parseInt(String(nextIdRaw).trim(), 10));
            const created = createCanonicalCompany(params?.companyInfo || {}, { id: newId });
            const nextId = String(parseInt(newId, 10) + 1);

            // Search index: sadece ilgili satırı güncelle (~160KB toplam, hızlı okuma/yazma)
            const searchRaw = await env.DB.get(indexKeys.companySearch);
            const searchIndex = searchRaw ? JSON.parse(searchRaw) : {};
            searchIndex[newId] = createSearchEntry(created);
            const updatedCompaniesList = Object.values(searchIndex);

            await Promise.all([
              env.DB.put(`cache:company:${newId}`, JSON.stringify(created), { expirationTtl: CACHE_TTL }),
              env.DB.put(indexKeys.companyNextId, nextId, { expirationTtl: CACHE_TTL }),
              env.DB.put(indexKeys.companySearch, JSON.stringify(searchIndex), { expirationTtl: CACHE_TTL }),
              env.DB.put(`cache:getCompanyById:${stableStringify({ id: newId })}`, JSON.stringify(created), { expirationTtl: CACHE_TTL }),
              env.DB.put("cache:getCompanies:{}", JSON.stringify(updatedCompaniesList), { expirationTtl: CACHE_TTL }),
              env.DB.delete("cache:getConsultants:{}"),
            ]);

            // 🔥 Dashboard istatistiklerini arka planda tazele
            ctx.waitUntil(rebuildDashboardStats());

            return jsonResponse({ success: true, data: { id: newId, company: created }, id: newId, kvPrimaryWrite: true, sheetsWrite: false });
          }

          // updateCompany: sadece etkilenen firmanın 1KB'lık key'ini yükle
          const targetId = String(params?.id || "").trim();
          if (!targetId) {
            return jsonResponse({ success: false, error: "Firma ID boş olamaz." }, 400);
          }

          const cacheKeyTarget = `cache:getCompanyById:${stableStringify({ id: targetId })}`;
          let [existingRaw, searchRaw] = await Promise.all([
            env.DB.get(`cache:company:${targetId}`),
            env.DB.get(indexKeys.companySearch),
          ]);

          if (!existingRaw) {
            existingRaw = await env.DB.get(cacheKeyTarget);
          }

          if (!existingRaw) {
            return jsonResponse({ success: false, error: `Firma bulunamadı: ${targetId}` }, 404);
          }

          let existing;
          try {
            existing = JSON.parse(existingRaw);
          } catch (e) {
            return jsonResponse({ success: false, error: "Bozuk firma formatı." }, 500);
          }

          const currentEtag = String(existing.__etag || createEtag(existing));
          const expectedEtag = String(params?.expectedEtag || "").trim();
          if (expectedEtag && expectedEtag !== currentEtag) {
            return jsonResponse({ success: false, error: "CONFLICT", currentEtag }, 409);
          }

          const updated = createCanonicalCompany(existing, { id: targetId, explicit: params?.companyInfo || {} });
          const searchIndex = searchRaw ? JSON.parse(searchRaw) : {};
          searchIndex[targetId] = createSearchEntry(updated);
          const updatedCompaniesList = Object.values(searchIndex);

          await Promise.all([
            env.DB.put(`cache:company:${targetId}`, JSON.stringify(updated), { expirationTtl: CACHE_TTL }),
            env.DB.put(indexKeys.companySearch, JSON.stringify(searchIndex), { expirationTtl: CACHE_TTL }),
            env.DB.put(`cache:getCompanyById:${stableStringify({ id: targetId })}`, JSON.stringify(updated), { expirationTtl: CACHE_TTL }),
            env.DB.put("cache:getCompanies:{}", JSON.stringify(updatedCompaniesList), { expirationTtl: CACHE_TTL }),
            env.DB.delete("cache:getConsultants:{}"),
          ]);

          // 🔥 Dashboard istatistiklerini arka planda tazele
          ctx.waitUntil(rebuildDashboardStats());

          return jsonResponse({ success: true, data: { etag: updated.__etag, company: updated }, kvPrimaryWrite: true, sheetsWrite: false });
        }

        if (env.DB && ["addTest", "updateTest"].includes(action)) {
          if (action === "addTest") {
            const nextId = await loadTestNextId();
            const newId = String(nextId);
            const created = createCanonicalTestRow(params?.testInfo || {}, { id: newId });
            const firmaId = getTestFirmaId(created);
            const testEntityKey = `cache:getTestById:${stableStringify({ id: newId })}`;
            const writes = [
              env.DB.put(testEntityKey, JSON.stringify(created), { expirationTtl: CACHE_TTL }),
              env.DB.put(indexKeys.testNextId, String(parseInt(newId, 10) + 1), { expirationTtl: CACHE_TTL }),
            ];
            if (firmaId) {
              const firmaKey = `cache:getTestsByFirmaId:${stableStringify({ firmaId })}`;
              const firmaRaw = await env.DB.get(firmaKey);
              const firmaList = firmaRaw ? JSON.parse(firmaRaw) : [];
              firmaList.push(created);
              writes.push(env.DB.put(firmaKey, JSON.stringify(firmaList), { expirationTtl: CACHE_TTL }));
            }
            await Promise.all(writes);
            return jsonResponse({ success: true, data: { id: newId, test: created }, id: newId, kvPrimaryWrite: true, sheetsWrite: false });
          }

          // updateTest
          const targetId = String(params?.id || "").trim();
          if (!targetId) return jsonResponse({ success: false, error: "Test ID boş olamaz." }, 400);

          const testEntityKey = `cache:getTestById:${stableStringify({ id: targetId })}`;
          const currentRaw = await env.DB.get(testEntityKey);
          if (!currentRaw) return jsonResponse({ success: false, error: `Test bulunamadı: ${targetId}` }, 404);

          const current = JSON.parse(currentRaw);
          const prevFirmaId = getTestFirmaId(current);
          const updated = createCanonicalTestRow(current, { id: targetId, explicit: params?.testInfo || {} });
          const nextFirmaId = getTestFirmaId(updated);
          const writes = [
            env.DB.put(testEntityKey, JSON.stringify(updated), { expirationTtl: CACHE_TTL }),
          ];

          if (prevFirmaId === nextFirmaId) {
            // Aynı firma — listeyi güncelle
            if (prevFirmaId) {
              const firmaKey = `cache:getTestsByFirmaId:${stableStringify({ firmaId: prevFirmaId })}`;
              const firmaRaw = await env.DB.get(firmaKey);
              const firmaList = firmaRaw ? JSON.parse(firmaRaw) : [];
              const newList = firmaList.map(t => getTestId(t) === targetId ? updated : t);
              writes.push(env.DB.put(firmaKey, JSON.stringify(newList), { expirationTtl: CACHE_TTL }));
            }
          } else {
            // Firma değişti — eski listeden çıkar, yeni listeye ekle
            if (prevFirmaId) {
              const prevKey = `cache:getTestsByFirmaId:${stableStringify({ firmaId: prevFirmaId })}`;
              const prevRaw = await env.DB.get(prevKey);
              const prevList = prevRaw ? JSON.parse(prevRaw) : [];
              writes.push(env.DB.put(prevKey, JSON.stringify(prevList.filter(t => getTestId(t) !== targetId)), { expirationTtl: CACHE_TTL }));
            }
            if (nextFirmaId) {
              const nextKey = `cache:getTestsByFirmaId:${stableStringify({ firmaId: nextFirmaId })}`;
              const nextRaw = await env.DB.get(nextKey);
              const nextList = nextRaw ? JSON.parse(nextRaw) : [];
              nextList.push(updated);
              writes.push(env.DB.put(nextKey, JSON.stringify(nextList), { expirationTtl: CACHE_TTL }));
            }
          }

          await Promise.all(writes);
          return jsonResponse({ success: true, data: { id: targetId, test: updated }, kvPrimaryWrite: true, sheetsWrite: false });
        }

        if (env.DB && ["addProforma", "addProInfo", "updateProforma", "deleteProforma"].includes(action)) {
          if (action === "deleteProforma") {
            const targetId = String(params?.id || "").trim();
            if (!targetId) return jsonResponse({ success: false, error: "Proforma ID boş olamaz." }, 400);
            const entityKey = `cache:getProformaById:${stableStringify({ id: targetId })}`;
            const existingRaw = await env.DB.get(entityKey);
            if (!existingRaw) return jsonResponse({ success: false, error: `Proforma bulunamadı: ${targetId}` }, 404);
            const existing = JSON.parse(existingRaw);
            const firmaId = getProformaFirmaId(existing);
            const writes = [env.DB.delete(entityKey)];
            if (firmaId) {
              const firmaKey = `cache:getProformasByFirmaId:${stableStringify({ firmaId })}`;
              const firmaRaw = await env.DB.get(firmaKey);
              const firmaList = firmaRaw ? JSON.parse(firmaRaw) : [];
              const filtered = firmaList.filter(p => getProformaId(p) !== targetId);
              writes.push(env.DB.put(firmaKey, JSON.stringify(filtered), { expirationTtl: CACHE_TTL }));
            }
            await Promise.all(writes);
            return jsonResponse({ success: true, data: { id: targetId }, kvPrimaryWrite: true, sheetsWrite: false });
          }

          if (action === "updateProforma") {
            const targetId = String(params?.id || "").trim();
            if (!targetId) return jsonResponse({ success: false, error: "Proforma ID boş olamaz." }, 400);
            const entityKey = `cache:getProformaById:${stableStringify({ id: targetId })}`;
            const existingRaw = await env.DB.get(entityKey);
            if (!existingRaw) return jsonResponse({ success: false, error: `Proforma bulunamadı: ${targetId}` }, 404);
            const existing = JSON.parse(existingRaw);
            const updated = createCanonicalProformaRow({ ...existing, ...(params?.proInfo || {}) }, { id: targetId });
            const prevFirmaId = getProformaFirmaId(existing);
            const nextFirmaId = getProformaFirmaId(updated);
            const writes = [env.DB.put(entityKey, JSON.stringify(updated), { expirationTtl: CACHE_TTL })];
            if (prevFirmaId) {
              const prevKey = `cache:getProformasByFirmaId:${stableStringify({ firmaId: prevFirmaId })}`;
              const prevRaw = await env.DB.get(prevKey);
              const prevList = prevRaw ? JSON.parse(prevRaw) : [];
              if (nextFirmaId === prevFirmaId) {
                writes.push(env.DB.put(prevKey, JSON.stringify(prevList.map(p => getProformaId(p) === targetId ? updated : p)), { expirationTtl: CACHE_TTL }));
              } else {
                writes.push(env.DB.put(prevKey, JSON.stringify(prevList.filter(p => getProformaId(p) !== targetId)), { expirationTtl: CACHE_TTL }));
              }
            }
            if (nextFirmaId && nextFirmaId !== prevFirmaId) {
              const nextKey = `cache:getProformasByFirmaId:${stableStringify({ firmaId: nextFirmaId })}`;
              const nextRaw = await env.DB.get(nextKey);
              const nextList = nextRaw ? JSON.parse(nextRaw) : [];
              nextList.push(updated);
              writes.push(env.DB.put(nextKey, JSON.stringify(nextList), { expirationTtl: CACHE_TTL }));
            }
            await Promise.all(writes);
            return jsonResponse({ success: true, data: { id: targetId, row: updated }, kvPrimaryWrite: true, sheetsWrite: false });
          }

          // addProforma / addProInfo
          const nextId = await loadProformaNextId();
          const newId = String(nextId);
          const created = createCanonicalProformaRow(params?.proInfo || {}, { id: newId });
          const firmaId = getProformaFirmaId(created);
          const entityKey = `cache:getProformaById:${stableStringify({ id: newId })}`;
          const writes = [
            env.DB.put(entityKey, JSON.stringify(created), { expirationTtl: CACHE_TTL }),
            env.DB.put(indexKeys.proformaNextId, String(nextId + 1), { expirationTtl: CACHE_TTL }),
          ];
          if (firmaId) {
            const firmaKey = `cache:getProformasByFirmaId:${stableStringify({ firmaId })}`;
            const firmaRaw = await env.DB.get(firmaKey);
            const firmaList = firmaRaw ? JSON.parse(firmaRaw) : [];
            firmaList.push(created);
            writes.push(env.DB.put(firmaKey, JSON.stringify(firmaList), { expirationTtl: CACHE_TTL }));
          }
          await Promise.all(writes);
          return jsonResponse({ success: true, data: { id: newId, row: created }, id: newId, kvPrimaryWrite: true, sheetsWrite: false });
        }

        if (env.DB && ["scheduleAudit", "updateAudit"].includes(action)) {
          if (action === "scheduleAudit") {
            const nextId = await loadAuditNextId();
            const newId = String(nextId);
            const created = createCanonicalAuditRow(params?.data || {}, { id: newId });
            const firmaId = getAuditFirmaId(created);
            const entityKey = `cache:getAuditById:${stableStringify({ id: newId })}`;
            const writes = [
              env.DB.put(entityKey, JSON.stringify(created), { expirationTtl: CACHE_TTL }),
              env.DB.put(indexKeys.auditNextId, String(parseInt(newId, 10) + 1), { expirationTtl: CACHE_TTL }),
              env.DB.delete("cache:getAudits:{}"),
            ];
            if (firmaId) {
              const firmaKey = `cache:getAuditsByFirmaId:${stableStringify({ firmaId })}`;
              const firmaRaw = await env.DB.get(firmaKey);
              const firmaList = firmaRaw ? JSON.parse(firmaRaw) : [];
              firmaList.push(created);
              writes.push(env.DB.put(firmaKey, JSON.stringify(firmaList), { expirationTtl: CACHE_TTL }));
            }
            await Promise.all(writes);
            return jsonResponse({ success: true, data: { id: newId, audit: created }, id: newId, kvPrimaryWrite: true, sheetsWrite: false, sideEffectsSkipped: true });
          }

          // updateAudit
          const targetId = String(params?.id || "").trim();
          if (!targetId) return jsonResponse({ success: false, error: "Denetim ID boş olamaz." }, 400);

          const entityKey = `cache:getAuditById:${stableStringify({ id: targetId })}`;
          const currentRaw = await env.DB.get(entityKey);
          if (!currentRaw) return jsonResponse({ success: false, error: `Denetim bulunamadı: ${targetId}` }, 404);

          const current = JSON.parse(currentRaw);
          const prevFirmaId = getAuditFirmaId(current);
          const updated = createCanonicalAuditRow({ ...current, ...(params?.data || params?.auditInfo || {}) }, { id: targetId });
          const nextFirmaId = getAuditFirmaId(updated);
          const writes = [
            env.DB.put(entityKey, JSON.stringify(updated), { expirationTtl: CACHE_TTL }),
            env.DB.delete("cache:getAudits:{}"),
          ];

          if (prevFirmaId === nextFirmaId) {
            if (prevFirmaId) {
              const firmaKey = `cache:getAuditsByFirmaId:${stableStringify({ firmaId: prevFirmaId })}`;
              const firmaRaw = await env.DB.get(firmaKey);
              const firmaList = firmaRaw ? JSON.parse(firmaRaw) : [];
              writes.push(env.DB.put(firmaKey, JSON.stringify(firmaList.map(a => getAuditId(a) === targetId ? updated : a)), { expirationTtl: CACHE_TTL }));
            }
          } else {
            if (prevFirmaId) {
              const prevKey = `cache:getAuditsByFirmaId:${stableStringify({ firmaId: prevFirmaId })}`;
              const prevRaw = await env.DB.get(prevKey);
              const prevList = prevRaw ? JSON.parse(prevRaw) : [];
              writes.push(env.DB.put(prevKey, JSON.stringify(prevList.filter(a => getAuditId(a) !== targetId)), { expirationTtl: CACHE_TTL }));
            }
            if (nextFirmaId) {
              const nextKey = `cache:getAuditsByFirmaId:${stableStringify({ firmaId: nextFirmaId })}`;
              const nextRaw = await env.DB.get(nextKey);
              const nextList = nextRaw ? JSON.parse(nextRaw) : [];
              nextList.push(updated);
              writes.push(env.DB.put(nextKey, JSON.stringify(nextList), { expirationTtl: CACHE_TTL }));
            }
          }

          await Promise.all(writes);
          return jsonResponse({ success: true, data: { id: targetId, audit: updated }, kvPrimaryWrite: true, sheetsWrite: false, sideEffectsSkipped: true });
        }

        if (env.DB && ["addCertificate", "updateCertificate", "updateCertificateField", "updateGozetim"].includes(action)) {
          if (action === "addCertificate") {
            const nextIdRaw = await env.DB.get(indexKeys.certificateNextId);
            if (!nextIdRaw || !parseInt(String(nextIdRaw).trim(), 10)) {
              return jsonResponse({ success: false, error: "CERTIFICATE_KV_EMPTY", message: "Sertifika KV verisi boş. Önce manuel Sheets -> KV senkronizasyonu yapın." });
            }
            const newId = String(parseInt(String(nextIdRaw).trim(), 10));
            const created = createCanonicalCertificate(params?.certInfo || {}, { id: newId });
            const createdFirmaId = getCertificateFirmaId(created);
            const nextId = String(parseInt(newId, 10) + 1);

            const writes = [
              env.DB.put(`cache:getCertificateById:${stableStringify({ id: newId })}`, JSON.stringify(created), { expirationTtl: CACHE_TTL }),
              env.DB.put(indexKeys.certificateNextId, nextId, { expirationTtl: CACHE_TTL }),
              (async () => {
                const summaryRaw = await env.DB.get(indexKeys.certificateSummary);
                const summaryIndex = summaryRaw ? JSON.parse(summaryRaw) : {};
                summaryIndex[newId] = createCertificateSummary(created);
                await env.DB.put(indexKeys.certificateSummary, JSON.stringify(summaryIndex), { expirationTtl: CACHE_TTL });
              })(),
              env.DB.delete("cache:getCertificates:{}"),
              env.DB.delete("cache:getCertificateSummaries:{}"),
            ];
            const recentIdsRaw = await env.DB.get(indexKeys.certificateRecent);
            const recentIds = recentIdsRaw ? JSON.parse(recentIdsRaw) : [];
            writes.push(
              env.DB.put(indexKeys.certificateRecent, JSON.stringify(mergeRecentCertificateIds(recentIds, [newId])), { expirationTtl: CACHE_TTL })
            );
            if (createdFirmaId) {
              const firmaRaw = await env.DB.get(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: createdFirmaId })}`);
              const firmaList = Array.isArray(firmaRaw ? JSON.parse(firmaRaw) : null) ? JSON.parse(firmaRaw) : [];
              writes.push(env.DB.put(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: createdFirmaId })}`, JSON.stringify([...firmaList, created]), { expirationTtl: CACHE_TTL }));
            }
            await Promise.all(writes);
            ctx.waitUntil(purgeCachePrefix("cache:getRecentCertificates:"));

            // 🔥 Dashboard istatistiklerini arka planda tazele
            ctx.waitUntil(rebuildDashboardStats());

            return jsonResponse({ success: true, data: { id: newId, certificate: created }, id: newId, kvPrimaryWrite: true, sheetsWrite: false });
          }

          // update* işlemleri: sadece o sertifikanın 1KB key'ini yükle
          const targetId = String(params?.id || "").trim();
          if (!targetId) {
            return jsonResponse({ success: false, error: "Sertifika ID boş olamaz." }, 400);
          }
          const existingRaw = await env.DB.get(`cache:getCertificateById:${stableStringify({ id: targetId })}`);
          if (!existingRaw) {
            return jsonResponse({ success: false, error: `Sertifika bulunamadı: ${targetId}` }, 404);
          }
          const existing = JSON.parse(existingRaw);

          let updated = existing;
          if (action === "updateCertificate") {
            updated = createCanonicalCertificate(existing, { id: targetId, explicit: params?.certInfo || {} });
          } else if (action === "updateCertificateField") {
            const field = String(params?.field || "").trim();
            if (!field) {
              return jsonResponse({ success: false, error: "Alan adı boş olamaz." }, 400);
            }
            updated = createCanonicalCertificate(existing, { id: targetId, explicit: { [field]: params?.value } });
          } else if (action === "updateGozetim") {
            const status = params?.status === true || String(params?.status || "").toUpperCase() === "TRUE" ? "TRUE" : "FALSE";
            updated = createCanonicalCertificate(existing, { id: targetId, explicit: { "Gözetim Conf.": status, gozetimConfirmed: status } });
          }

          const previousFirmaId = getCertificateFirmaId(existing);
          const nextFirmaId = getCertificateFirmaId(updated);

          const cacheWrites = [
            env.DB.put(`cache:getCertificateById:${stableStringify({ id: targetId })}`, JSON.stringify(updated), { expirationTtl: CACHE_TTL }),
            (async () => {
              const summaryRaw = await env.DB.get(indexKeys.certificateSummary);
              const summaryIndex = summaryRaw ? JSON.parse(summaryRaw) : {};
              summaryIndex[targetId] = createCertificateSummary(updated);
              await env.DB.put(indexKeys.certificateSummary, JSON.stringify(summaryIndex), { expirationTtl: CACHE_TTL });
            })(),
            env.DB.delete("cache:getCertificates:{}"),
            env.DB.delete("cache:getCertificateSummaries:{}"),
          ];

          // Firma cert listelerini granüler güncelle — sadece etkilenen firma(lar)ın listesini yükle
          if (previousFirmaId) {
            const prevRaw = await env.DB.get(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: previousFirmaId })}`);
            let prevList = Array.isArray(prevRaw ? JSON.parse(prevRaw) : null) ? JSON.parse(prevRaw) : [];
            if (nextFirmaId !== previousFirmaId) {
              prevList = prevList.filter((c) => getCertificateId(c) !== targetId);
            } else {
              const idx = prevList.findIndex((c) => getCertificateId(c) === targetId);
              if (idx >= 0) prevList[idx] = updated; else prevList = [...prevList, updated];
            }
            cacheWrites.push(env.DB.put(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: previousFirmaId })}`, JSON.stringify(prevList), { expirationTtl: CACHE_TTL }));
          }
          if (nextFirmaId && nextFirmaId !== previousFirmaId) {
            const nextRaw = await env.DB.get(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: nextFirmaId })}`);
            const nextList = Array.isArray(nextRaw ? JSON.parse(nextRaw) : null) ? JSON.parse(nextRaw) : [];
            cacheWrites.push(env.DB.put(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: nextFirmaId })}`, JSON.stringify([...nextList, updated]), { expirationTtl: CACHE_TTL }));
          }

          await Promise.all(cacheWrites);
          ctx.waitUntil(purgeCachePrefix("cache:getRecentCertificates:"));

          // 🔥 Dashboard istatistiklerini arka planda tazele
          ctx.waitUntil(rebuildDashboardStats());

          return jsonResponse({ success: true, data: { id: targetId, certificate: updated }, kvPrimaryWrite: true, sheetsWrite: false });
        }

        if (env.DB && action === "updateSurveillance") {
          const ids = Array.isArray(params?.ids) ? params.ids.map((id) => String(id).trim()).filter(Boolean) : [];
          if (!ids.length) {
            return jsonResponse({ success: false, error: "Güncellenecek sertifika ID listesi boş." }, 400);
          }

          const status = params?.status === true || String(params?.status || "").toUpperCase() === "TRUE" ? "TRUE" : "FALSE";
          const hintFirmaId = params?.firmaId || params?.id || params?.targetId || null;
          if (!hintFirmaId || String(hintFirmaId).trim() === "") {
            return jsonResponse({ success: false, error: "firmaId parametresi eksik.", action, params }, 400);
          }

          const idSet = new Set(ids);
          const firmaListKey = `cache:getCertificatesByFirmaId:${stableStringify({ firmaId: hintFirmaId })}`;
          const firmaListRaw = await env.DB.get(firmaListKey);

          if (!firmaListRaw) {
            return jsonResponse({ success: false, error: "CERTIFICATE_KV_EMPTY", message: `Firma ${hintFirmaId} sertifika listesi KV'de bulunamadı. Sayfayı yenileyin veya senkronizasyon yapın.` });
          }

          const firmaList = JSON.parse(firmaListRaw);
          const updatedById = {};

          // In-place güncelleme: her cert'i tara, eşleşen ID'lerde surveillance field'ını değiştir
          const updatedList = firmaList.map((c) => {
            const certId = String(getCertificateId(c));
            if (!idSet.has(certId)) return c;

            if (Array.isArray(c)) {
              // Raw array format: index 19 = Gözetim Conf.
              const row = [...c];
              row[19] = status;
              updatedById[certId] = row;
              return row;
            } else {
              // Canonical object format
              const updated = {
                ...c,
                "Gözetim Conf.": status,
                gozetimConfirmed: status,
                gozetimConf: status,
                gozetim: status,
              };
              updatedById[certId] = updated;
              return updated;
            }
          });

          const updatedCount = Object.keys(updatedById).length;
          if (updatedCount === 0) {
            return jsonResponse({ success: false, error: "Seçili sertifikalar firma listesinde bulunamadı." });
          }

          const writes = [
            env.DB.put(firmaListKey, JSON.stringify(updatedList), { expirationTtl: CACHE_TTL }),
            env.DB.delete("cache:getCertificates:{}"),
            env.DB.delete("cache:getCertificateSummaries:{}"),
          ];

          // Bireysel cert key'lerini de güncelle (varsa üzerine yaz, yoksa oluştur)
          Object.entries(updatedById).forEach(([id, cert]) => {
            const canonical = Array.isArray(cert)
              ? createCanonicalCertificate(cert)
              : createCanonicalCertificate(cert, { id, explicit: { "Gözetim Conf.": status, gozetimConfirmed: status } });
            writes.push(env.DB.put(`cache:getCertificateById:${stableStringify({ id })}`, JSON.stringify(canonical), { expirationTtl: CACHE_TTL }));
          });

          // Summary index güncelle
          writes.push((async () => {
            const summaryRaw = await env.DB.get(indexKeys.certificateSummary);
            const summaryIndex = summaryRaw ? JSON.parse(summaryRaw) : {};
            Object.entries(updatedById).forEach(([id, cert]) => {
              const canonical = Array.isArray(cert) ? createCanonicalCertificate(cert) : cert;
              summaryIndex[id] = createCertificateSummary(canonical);
            });
            return env.DB.put(indexKeys.certificateSummary, JSON.stringify(summaryIndex), { expirationTtl: CACHE_TTL });
          })());

          // fullCertificates index'ini de in-place güncelle (getCertificates için yetkili kaynak)
          writes.push((async () => {
            const fullRaw = await env.DB.get(indexKeys.fullCertificates);
            if (!fullRaw) return;
            const fullList = JSON.parse(fullRaw);
            const updatedFull = fullList.map((c) => {
              const certId = String(getCertificateId(c));
              if (!updatedById[certId]) return c;
              const updated = updatedById[certId];
              if (Array.isArray(c) && Array.isArray(updated)) return updated;
              if (!Array.isArray(c) && !Array.isArray(updated)) return updated;
              // Format mismatch: canonical nesneyi tercih et
              return Array.isArray(updated) ? createCanonicalCertificate(updated) : updated;
            });
            return env.DB.put(indexKeys.fullCertificates, JSON.stringify(updatedFull), { expirationTtl: CACHE_TTL });
          })());

          await Promise.all(writes);
          ctx.waitUntil(purgeCachePrefix("cache:getRecentCertificates:"));

          // 🔥 Dashboard istatistiklerini arka planda tazele
          ctx.waitUntil(rebuildDashboardStats());

          return jsonResponse({ success: true, data: { updatedCount, ids, status }, kvPrimaryWrite: true, sheetsWrite: false, sideEffectsSkipped: true });
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

        const gasText = await gasResponse.text();
        let result = null;
        try {
          result = JSON.parse(gasText);
        } catch (_) {
          const preview = String(gasText || "").slice(0, 400);
          return jsonResponse({
            success: false,
            error: "GAS_INVALID_JSON",
            action,
            status: gasResponse.status,
            details: preview || "Boş yanıt"
          }, 502);
        }

        if (!gasResponse.ok) {
          return jsonResponse({
            success: false,
            error: result?.error || `GAS_HTTP_${gasResponse.status}`,
            action,
            status: gasResponse.status,
            data: result?.data ?? null
          }, gasResponse.status);
        }

        if (!result?.success) {
          console.error("GAS action failed", {
            action,
            params,
            error: result?.error || null,
            status: gasResponse.status,
          });
        }

        // 📥 Başarılıysa KV'ye Yaz (7 Günlük)
        if (shouldUseKvCache && result.success) {
          ctx.waitUntil(env.DB.put(cacheKey, JSON.stringify(result.data), { expirationTtl: CACHE_TTL }));
        }

        // 🧹 GAS üzerinden yazan legacy aksiyonlar sonrası ilgili KV key'lerini temizle
        if (env.DB && result.success && gasWriteActions.includes(action)) {
          if (action === "importBackup") {
            ctx.waitUntil(purgeCachePrefix("cache:"));
            return jsonResponse(result);
          }
          if (action === "editCell") {
            const invalidateKeys = new Set([
              "cache:getCertificateSummaries:{}",
              "cache:getCertificates:{}",
              `cache:getRecentCertificates:${stableStringify({ limit: 25 })}`,
              "cache:getRecentCertificates:{}",
              indexKeys.certificateSummary,
            ]);
            ctx.waitUntil(Promise.all([...invalidateKeys].map((key) => env.DB.delete(key))));
          }
        }

        if (env.DB && result.success && documentListInvalidationActions.has(action)) {
          await purgeCachePrefix("cache:getRecentFiles:");
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
