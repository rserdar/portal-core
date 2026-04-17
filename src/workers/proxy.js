/**
 * 🛰️ Medicert Portal: Cloudflare Worker Proxy (v6.0 - Dispatcher Pattern)
 *
 * Mimari Özeti:
 * - V6 Action Dispatcher: O(1) hızında yönlendirme ve modüler handler yapısı.
 * - KV-primary read (miss => needsHydration)
 * - KV-primary write (Sheets write-back devre dışı)
 * - Automatic GAS Fallback: Worker'da tanımlanmayan veya hata veren aksiyonlar GAS'a devredilir.
 *
 * Author: Antigravity AI
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

    const stableStringify = (value) => {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
      const keys = Object.keys(value).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
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
      ulke: String(company.ulke || company["Ülke"] || company.Ulke || "TÜRKİYE"),
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
     * 📊 REBUILD DASHBOARD STATS (New Gen Architecture)
     * Verileri tek tek yüklemek yerine indeksleri çekip bellekte istatistikleri fırınlar.
     */
    const rebuildDashboardStats = async () => {
      if (!env.DB) return null;
      try {
        const [summaryRaw, companyRaw] = await Promise.all([
          env.DB.get(indexKeys.certificateSummary),
          env.DB.get(indexKeys.companySearch)
        ]);

        const certificates = summaryRaw ? Object.values(JSON.parse(summaryRaw)) : [];
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

          // Aktif sertifika: bugün sertifikaTarihi ile gozetimTarihi arasında,
          // gözetim onaylanmamış VE durum PASİF/İPTAL değil
          const certDate = parseTRDate(c.sertifikaTarihi);
          const gozDate = parseTRDate(c.gozetimTarihi);
          const gozConf = String(c.gozetimConfirmed || "").toUpperCase();
          const gozNotConfirmed = gozConf !== "TRUE";
          const durumNorm = normalizeTR(c.durum || "AKTIF");
          const isActiveStatus = durumNorm !== "PASIF" && durumNorm !== "IPTAL";

          const isActive = isActiveStatus && certDate !== null && gozDate !== null &&
            certDate <= today && today <= gozDate &&
            gozNotConfirmed;
          if (isActive) stats.activeCertificates++;

          // Bekleyen gözetim: geçen ay + bu ay + gelecek ay penceresi,
          // onaylanmamış VE durum aktif
          const surveillanceWindowStart = new Date(currentYear, currentMonth - 1, 1);
          const surveillanceWindowEnd = new Date(currentYear, currentMonth + 2, 0);
          let isPending = false;
          if (isActiveStatus && gozDate && gozNotConfirmed && gozDate >= surveillanceWindowStart && gozDate <= surveillanceWindowEnd) {
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
      const input = Array.isArray(source)
        ? {
            ID: source[0] ?? "",
            firmaAdi: source[1] ?? "",
            firmaNo: source[2] ?? "",
            testAdi: source[3] ?? "",
            marka: source[4] ?? "",
            urun: source[5] ?? "",
            urunKodu: source[6] ?? "",
            urunNo: source[7] ?? "",
            lot: source[8] ?? "",
            urunKabul: source[9] ?? "",
            kabulSaat: source[10] ?? "",
            testBaslangic: source[11] ?? "",
            testBitis: source[12] ?? "",
            raporTarihi: source[13] ?? "",
            raporNo: source[14] ?? "",
            numuneSayisi: source[15] ?? "",
            numuneUT: source[16] ?? "",
            numuneSKT: source[17] ?? "",
            urunBilgi: source[18] ?? "",
            gorsel1: source[19] ?? "",
            gorsel2: source[20] ?? "",
            detay: source[21] ?? "",
          }
        : source && typeof source === "object"
          ? source
          : {};
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
        nick: pick(["nick", "nickname"]) ?? "",
        firmaNo: pick(["firmaNo", "firmano"]) ?? "",
        standart: pick(["standart"]) ?? "",
        denetimTipi: pick(["denetimTipi", "denetim"]) ?? "",
        a1Full: pick(["a1Full", "a1Denetci"]) ?? "",
        a1Auditor: pick(["a1Auditor", "a1Denetci", "a1Full"]) ?? "",
        a2Full: pick(["a2Full", "a2Denetci"]) ?? "",
        a2Auditor: pick(["a2Auditor", "a2Denetci", "a2Full"]) ?? "",
        a1Basla: pick(["a1Basla", "a1Baslav2"]) ?? "",
        a1Bitis: pick(["a1Bitis", "a1Bitisv2"]) ?? "",
        a1Md: pick(["a1Md"]) ?? "",
        a1La: pick(["a1La", "a1Lead"]) ?? "",
        a1Fa: pick(["a1Fa"]) ?? "",
        a1Sa: pick(["a1Sa"]) ?? "",
        a2Basla: pick(["a2Basla", "a2Baslav2"]) ?? "",
        a2Bitis: pick(["a2Bitis", "a2Bitisv2"]) ?? "",
        a2Md: pick(["a2Md"]) ?? "",
        a2La: pick(["a2La", "a2Lead"]) ?? "",
        a2Fa: pick(["a2Fa"]) ?? "",
        a2Sa: pick(["a2Sa"]) ?? "",
        qms: pick(["qms"]) ?? "",
        mdd: pick(["mdd"]) ?? "",
        ems: pick(["ems"]) ?? "",
        ohs: pick(["ohs"]) ?? "",
        fsms: pick(["fsms"]) ?? "",
        isms: pick(["isms"]) ?? "",
        engy: pick(["engy"]) ?? "",
        gmp: pick(["gmp"]) ?? "",
        a1kDenet: pick(["a1kDenet"]) ?? "",
        a2kDenet: pick(["a2kDenet"]) ?? "",
        a1EventId: pick(["a1EventId"]) ?? "",
        a2EventId: pick(["a2EventId"]) ?? "",
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

      const [companyRaw, stdRaw] = await Promise.all([
        env.DB.get(`cache:company:${firmId}`),
        env.DB.get(`cache:getStandardById:${stableStringify({ id: String(standardId) })}`),
      ]);
      if (!companyRaw) throw new Error(`COMPANY_KV_EMPTY: Firma '${firmId}' KV'de bulunamadı. Önce senkronizasyon yapın.`);
      if (!stdRaw) throw new Error(`STANDARD_KV_EMPTY: Standart '${standardId}' KV'de bulunamadı. Önce master senkronizasyonu yapın.`);
      const company = JSON.parse(companyRaw);
      const stdObj = JSON.parse(stdRaw);

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
      const proformaKey = `cache:getProformaById:${stableStringify({ id: String(id) })}`;
      let proformaRaw = await env.DB.get(proformaKey);
      if (!proformaRaw) {
        const fullRaw = await env.DB.get(indexKeys.fullProformas);
        const item = fullRaw ? JSON.parse(fullRaw).find(pr => String(getProformaId(pr)) === String(id)) : null;
        if (!item) throw new Error(`PROFORMA_KV_EMPTY: Proforma '${id}' KV'de bulunamadı. Önce senkronizasyon yapın.`);
        proformaRaw = JSON.stringify(item);
        ctx.waitUntil(env.DB.put(proformaKey, proformaRaw, { expirationTtl: CACHE_TTL }));
      }
      const proforma = JSON.parse(proformaRaw);

      const firmaId = getProformaFirmaId(proforma);
      if (!firmaId) throw new Error("Proforma kaydında firma no boş.");

      const companyKey = `cache:company:${firmaId}`;
      let companyRaw = await env.DB.get(companyKey);
      if (!companyRaw) {
        const fullRaw = await env.DB.get(indexKeys.fullCompanies);
        const item = fullRaw ? JSON.parse(fullRaw).find(c => String(getCompanyId(c)) === String(firmaId)) : null;
        if (!item) throw new Error(`COMPANY_KV_EMPTY: Firma '${firmaId}' KV'de bulunamadı. Önce senkronizasyon yapın.`);
        companyRaw = JSON.stringify(item);
        ctx.waitUntil(env.DB.put(companyKey, companyRaw, { expirationTtl: CACHE_TTL }));
      }
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


    const fetchFromGas = async (env, body) => {
      const res = await fetch(env.GAS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, apiKey: env.API_KEY }),
      });
      const text = await res.text();
      if (!res.ok || !text.trimStart().startsWith('{')) {
        const code = res.status;
        if (code === 524 || text.includes('524')) throw new Error('GAS_TIMEOUT_524: Google Apps Script yanıt vermedi (süre aşımı). Daha küçük bir kapsam seçin veya GAS scriptini optimize edin.');
        throw new Error(`GAS_HTTP_ERROR: ${code} — ${text.slice(0, 200)}`);
      }
      return JSON.parse(text);
    };

    const SyncHandlers = {
      bulkSync: async (params, ctx, env) => {
        if (!env.DB) return jsonResponse({ success: false, error: "NO_DB_BINDING" }, 500);
        const scope = Array.isArray(params?.scope) ? params.scope : ["companies", "certificates", "audits", "tests", "proformas", "master"];
        const hasScope = (s) => scope.includes(s);

        // Büyük veri setleri için sayfalı GAS okuma (her sayfa ~1500 satır, GAS timeout'u önlemek için)
        const PAGE_SIZE = 1500;
        const LARGE_SCOPES = new Set(["certificates", "audits", "tests"]);
        const d = {};

        for (const s of scope) {
          if (!LARGE_SCOPES.has(s)) {
            const res = await fetchFromGas(env, { action: "getFullSyncData", params: { scope: [s] } });
            if (!res.success) return jsonResponse(res);
            Object.assign(d, res.data);
          } else {
            let offset = 0;
            let totalCount = null;
            while (true) {
              const res = await fetchFromGas(env, { action: "getFullSyncData", params: { scope: [s], offset, limit: PAGE_SIZE } });
              if (!res.success) return jsonResponse(res);
              const page = res.data;
              if (totalCount === null) totalCount = (typeof page.totalCount === 'number') ? page.totalCount : 0;
              for (const [key, val] of Object.entries(page)) {
                if (Array.isArray(val)) {
                  d[key] = d[key] ? d[key].concat(val) : val.slice();
                } else {
                  d[key] = val;
                }
              }
              offset += PAGE_SIZE;
              if (!totalCount || offset >= totalCount) break;
            }
          }
        }
        const stats = {};
        const writes = [];

        // --- 🏗️ COMPANIES ---
        if (hasScope("companies")) {
          const companies = Array.isArray(d.companies) ? d.companies : [];
          const canonicalCompanies = companies.map(c => createCanonicalCompany(c)).filter(c => getCompanyId(c));

          {
            const currentSearchRaw = await env.DB.get(indexKeys.companySearch);
            const currentCount = currentSearchRaw ? Object.keys(JSON.parse(currentSearchRaw)).length : 0;
            if (currentCount > 10 && canonicalCompanies.length < (currentCount * 0.2)) {
              return jsonResponse({ success: false, error: `MASS_DELETION_PROTECTION: companies (current: ${currentCount}, incoming: ${canonicalCompanies.length})` }, 400);
            }
          }

          const companySearchIndex = {};
          canonicalCompanies.forEach(c => {
            const cid = getCompanyId(c);
            if (cid) companySearchIndex[cid] = createSearchEntry(c);
          });

          const companyNextId = canonicalCompanies.reduce((h, c) => Math.max(h, parseInt(getCompanyId(c)) || 0), 0) + 1;

          writes.push(env.DB.put(indexKeys.companySearch, JSON.stringify(companySearchIndex), { expirationTtl: CACHE_TTL }));
          writes.push(env.DB.put(indexKeys.companyNextId, String(companyNextId), { expirationTtl: CACHE_TTL }));
          writes.push(env.DB.put(indexKeys.fullCompanies, JSON.stringify(canonicalCompanies), { expirationTtl: CACHE_TTL }));
          stats.companies = Object.keys(companySearchIndex).length;
        }

        // --- 🎖️ CERTIFICATES ---
        if (hasScope("certificates")) {
          const certs = Array.isArray(d.certificates) ? d.certificates : (Array.isArray(d.certs) ? d.certs : []);
          const certRows = Array.isArray(d.certificateRows) ? d.certificateRows : (Array.isArray(d.certRows) ? d.certRows : []);
          const canonicalCerts = [...certs, ...certRows].map(c => createCanonicalCertificate(c)).filter(c => getCertificateId(c));

          const certById = buildCertificatesById(canonicalCerts);
          const dedupedCerts = Object.values(certById);

          {
            const currentSummaryRaw = await env.DB.get(indexKeys.certificateSummary);
            const currentCount = currentSummaryRaw ? Object.keys(JSON.parse(currentSummaryRaw)).length : 0;
            if (currentCount > 10 && dedupedCerts.length < (currentCount * 0.2)) {
              return jsonResponse({ success: false, error: `MASS_DELETION_PROTECTION: certificates (current: ${currentCount}, incoming: ${dedupedCerts.length})` }, 400);
            }
          }

          const summaryIndex = {};
          dedupedCerts.forEach(c => {
            const id = getCertificateId(c);
            if (id) summaryIndex[id] = createCertificateSummary(c);
          });

          const certNextId = dedupedCerts.reduce((h, c) => Math.max(h, parseInt(getCertificateId(c)) || 0), 0) + 1;
          const sorted = sortCertificatesByIdDesc(dedupedCerts);
          const recentIds = sorted.slice(0, 50).map(c => getCertificateId(c));

          writes.push(env.DB.put(indexKeys.certificateSummary, JSON.stringify(summaryIndex), { expirationTtl: CACHE_TTL }));
          writes.push(env.DB.put(indexKeys.certificateNextId, String(certNextId), { expirationTtl: CACHE_TTL }));
          writes.push(env.DB.put(indexKeys.certificateRecent, JSON.stringify(recentIds), { expirationTtl: CACHE_TTL }));
          writes.push(env.DB.put(indexKeys.fullCertificates, JSON.stringify(dedupedCerts), { expirationTtl: CACHE_TTL }));
          stats.certs = Object.keys(summaryIndex).length;
        }

        // --- 🧪 TESTS / AUDITS / PROFORMAS ---
        if (hasScope("tests")) {
          const rawTests = Array.isArray(d.tests) ? d.tests : [];
          const canonicalTests = rawTests.map(row => createCanonicalTestRow(row));

          {
            const currentFullRaw = await env.DB.get(indexKeys.fullTests);
            const currentCount = currentFullRaw ? JSON.parse(currentFullRaw).length : 0;
            if (currentCount > 10 && canonicalTests.length < (currentCount * 0.2)) {
              return jsonResponse({ success: false, error: `MASS_DELETION_PROTECTION: tests (current: ${currentCount}, incoming: ${canonicalTests.length})` }, 400);
            }
          }
          const testNextId = canonicalTests.reduce((h, t) => Math.max(h, parseInt(getTestId(t)) || 0), 0) + 1;
          writes.push(env.DB.put(indexKeys.testNextId, String(testNextId), { expirationTtl: CACHE_TTL }));
          writes.push(env.DB.put(indexKeys.fullTests, JSON.stringify(canonicalTests), { expirationTtl: CACHE_TTL }));
          stats.tests = canonicalTests.length;
        }

        if (hasScope("audits")) {
          const rawAudits = Array.isArray(d.auditObjects) ? d.auditObjects : (Array.isArray(d.audits) ? d.audits : []);
          const canonicalAudits = rawAudits.map(a => createCanonicalAuditRow(a));

          {
            const currentFullRaw = await env.DB.get(indexKeys.fullAudits);
            const currentCount = currentFullRaw ? JSON.parse(currentFullRaw).length : 0;
            if (currentCount > 10 && canonicalAudits.length < (currentCount * 0.2)) {
              return jsonResponse({ success: false, error: `MASS_DELETION_PROTECTION: audits (current: ${currentCount}, incoming: ${canonicalAudits.length})` }, 400);
            }
          }

          const auditNextId = canonicalAudits.reduce((h, a) => Math.max(h, parseInt(getAuditId(a)) || 0), 0) + 1;
          writes.push(env.DB.put(indexKeys.auditNextId, String(auditNextId), { expirationTtl: CACHE_TTL }));
          writes.push(env.DB.put(indexKeys.fullAudits, JSON.stringify(canonicalAudits), { expirationTtl: CACHE_TTL }));
          writes.push(env.DB.delete("cache:getAudits:{}"));
          stats.audits = canonicalAudits.length;
        }

        if (hasScope("proformas")) {
          const rawProformas = Array.isArray(d.proformas) ? d.proformas : [];
          const canonicalProformas = rawProformas.map(p => createCanonicalProformaRow(Array.isArray(p) ? rowToObject(d.proformaHeaders, p) : p));

          {
            const currentFullRaw = await env.DB.get(indexKeys.fullProformas);
            const currentCount = currentFullRaw ? JSON.parse(currentFullRaw).length : 0;
            if (currentCount > 10 && canonicalProformas.length < (currentCount * 0.2)) {
              return jsonResponse({ success: false, error: `MASS_DELETION_PROTECTION: proformas (current: ${currentCount}, incoming: ${canonicalProformas.length})` }, 400);
            }
          }
          const proformaNextId = canonicalProformas.reduce((h, p) => Math.max(h, parseInt(getProformaId(p)) || 0), 0) + 1;
          writes.push(env.DB.put(indexKeys.proformaNextId, String(proformaNextId), { expirationTtl: CACHE_TTL }));
          writes.push(env.DB.put(indexKeys.fullProformas, JSON.stringify(canonicalProformas), { expirationTtl: CACHE_TTL }));
          stats.proformas = canonicalProformas.length;
        }

        if (hasScope("master")) {
          const standards = Array.isArray(d.standards) ? d.standards : [];
          const consultants = Array.isArray(d.consultants) ? d.consultants : [];
          const auditors = Array.isArray(d.auditors) ? d.auditors : [];
          standards.forEach(s => {
            const sid = String(s.ID || s.id || "");
            if (sid) writes.push(env.DB.put(`cache:getStandardById:${stableStringify({ id: sid })}`, JSON.stringify(s), { expirationTtl: CACHE_TTL }));
          });
          auditors.forEach(a => {
            const aid = String(a.ID || a.id || "");
            if (aid) writes.push(env.DB.put(`cache:getAuditorById:${stableStringify({ id: aid })}`, JSON.stringify(a), { expirationTtl: CACHE_TTL }));
          });
          writes.push(env.DB.put(`cache:getConsultants:{}`, JSON.stringify(consultants), { expirationTtl: CACHE_TTL }));
          writes.push(env.DB.delete("cache:getMasterData:{}"));
        }

        for (let i = 0; i < writes.length; i += 50) {
          await Promise.all(writes.slice(i, i + 50));
        }
        ctx.waitUntil(rebuildDashboardStats());
        return jsonResponse({ success: true, message: "Sync Completed", stats, scope });
      },
      exportKvData: async (params, ctx, env) => {

        const scope = Array.isArray(params?.scope) ? params.scope : ["companies", "certificates", "audits", "tests", "proformas", "master"];
        const exportData = { version: "1.0", timestamp: new Date().toISOString(), scope, data: {} };
        const ps = [];
        if (scope.includes("companies")) ps.push(env.DB.get(indexKeys.fullCompanies).then(v => exportData.data.companies = v ? JSON.parse(v) : []));
        if (scope.includes("certificates")) ps.push(env.DB.get(indexKeys.fullCertificates).then(v => exportData.data.certificates = v ? JSON.parse(v) : []));
        if (scope.includes("tests")) ps.push(env.DB.get(indexKeys.fullTests).then(v => exportData.data.tests = v ? JSON.parse(v) : []));
        if (scope.includes("audits")) ps.push(env.DB.get(indexKeys.fullAudits).then(v => exportData.data.audits = v ? JSON.parse(v) : []));
        if (scope.includes("proformas")) ps.push(env.DB.get(indexKeys.fullProformas).then(v => exportData.data.proformas = v ? JSON.parse(v) : []));
        if (scope.includes("master")) {
           ps.push(env.DB.get(`cache:getConsultants:{}`).then(v => exportData.data.consultants = v ? JSON.parse(v) : []));
        }
        await Promise.all(ps);
        return jsonResponse({ success: true, exportData });
      },
      importKvData: async (params, ctx, env) => {

        const payload = params?.exportData?.data || params?.payload?.data || params?.payload;
        const scope = Array.isArray(params?.scope) ? params.scope : [];
        if (!payload || !scope.length) return jsonResponse({ success: false, error: "INVALID_IMPORT_PAYLOAD" }, 400);
        const ws = [];
        const stats = {};

        if (scope.includes("companies") && Array.isArray(payload.companies)) {
          const companies = payload.companies.map(c => createCanonicalCompany(c)).filter(c => getCompanyId(c));
          const searchIdx = {};
          companies.forEach(c => { const cid = getCompanyId(c); if (cid) searchIdx[cid] = createSearchEntry(c); });
          const nextId = companies.reduce((h, c) => Math.max(h, parseInt(getCompanyId(c)) || 0), 0) + 1;
          ws.push(env.DB.put(indexKeys.companySearch, JSON.stringify(searchIdx), { expirationTtl: CACHE_TTL }));
          ws.push(env.DB.put(indexKeys.companyNextId, String(nextId), { expirationTtl: CACHE_TTL }));
          ws.push(env.DB.put(indexKeys.fullCompanies, JSON.stringify(companies), { expirationTtl: CACHE_TTL }));
          stats.companies = companies.length;
        }

        if (scope.includes("certificates") && Array.isArray(payload.certificates)) {
          const certs = payload.certificates.map(c => createCanonicalCertificate(c)).filter(c => getCertificateId(c));
          const certById = buildCertificatesById(certs);
          const dedupedCerts = Object.values(certById);
          const summaryIdx = {};
          dedupedCerts.forEach(c => { const cid = getCertificateId(c); if (cid) summaryIdx[cid] = createCertificateSummary(c); });
          const nextId = dedupedCerts.reduce((h, c) => Math.max(h, parseInt(getCertificateId(c)) || 0), 0) + 1;
          const recentIds = sortCertificatesByIdDesc(dedupedCerts).slice(0, 50).map(c => getCertificateId(c));
          ws.push(env.DB.put(indexKeys.certificateSummary, JSON.stringify(summaryIdx), { expirationTtl: CACHE_TTL }));
          ws.push(env.DB.put(indexKeys.certificateNextId, String(nextId), { expirationTtl: CACHE_TTL }));
          ws.push(env.DB.put(indexKeys.certificateRecent, JSON.stringify(recentIds), { expirationTtl: CACHE_TTL }));
          ws.push(env.DB.put(indexKeys.fullCertificates, JSON.stringify(dedupedCerts), { expirationTtl: CACHE_TTL }));
          stats.certs = dedupedCerts.length;
        }

        if (scope.includes("audits") && Array.isArray(payload.audits)) {
          const audits = payload.audits.map(a => createCanonicalAuditRow(a));
          const nextId = audits.reduce((h, a) => Math.max(h, parseInt(getAuditId(a)) || 0), 0) + 1;
          ws.push(env.DB.put(indexKeys.auditNextId, String(nextId), { expirationTtl: CACHE_TTL }));
          ws.push(env.DB.put(indexKeys.fullAudits, JSON.stringify(audits), { expirationTtl: CACHE_TTL }));
          stats.audits = audits.length;
        }

        if (scope.includes("tests") && Array.isArray(payload.tests)) {
          const tests = payload.tests.map(t => createCanonicalTestRow(t));
          const nextId = tests.reduce((h, t) => Math.max(h, parseInt(getTestId(t)) || 0), 0) + 1;
          ws.push(env.DB.put(indexKeys.testNextId, String(nextId), { expirationTtl: CACHE_TTL }));
          ws.push(env.DB.put(indexKeys.fullTests, JSON.stringify(tests), { expirationTtl: CACHE_TTL }));
          stats.tests = tests.length;
        }

        if (scope.includes("proformas") && Array.isArray(payload.proformas)) {
          const proformas = payload.proformas.map(p => createCanonicalProformaRow(p));
          const nextId = proformas.reduce((h, p) => Math.max(h, parseInt(getProformaId(p)) || 0), 0) + 1;
          ws.push(env.DB.put(indexKeys.proformaNextId, String(nextId), { expirationTtl: CACHE_TTL }));
          ws.push(env.DB.put(indexKeys.fullProformas, JSON.stringify(proformas), { expirationTtl: CACHE_TTL }));
          stats.proformas = proformas.length;
        }

        for (let i = 0; i < ws.length; i += 50) await Promise.all(ws.slice(i, i + 50));
        ctx.waitUntil(rebuildDashboardStats());
        return jsonResponse({ success: true, message: "Import Successful", stats });
      },
      syncCheck: async (params, ctx, env) => {
        // Worker + KV sağlığını doğrular — GAS'a gitmez, kota tüketmez
        const kvOk = !!env.DB;
        const statsRaw = kvOk ? await env.DB.get(indexKeys.dashboardStats) : null;
        return jsonResponse({
          success: kvOk,
          kv: kvOk,
          lastSync: statsRaw ? JSON.parse(statsRaw).stats?.lastSync : null,
        });
      },
      rebuildStats: async (params, ctx, env) => {
        const result = await rebuildDashboardStats();
        return jsonResponse({ success: !!result, data: result });
      },
      kvDiagnostic: async (params, ctx, env) => {
        const [full, summ, comp, stats] = await Promise.all([
          env.DB.get(indexKeys.fullCertificates),
          env.DB.get(indexKeys.certificateSummary),
          env.DB.get(indexKeys.companySearch),
          env.DB.get(indexKeys.dashboardStats)
        ]);
        return jsonResponse({
          success: true,
          diagnostic: {
            fullCerts: { exists: !!full, count: full ? JSON.parse(full).length : 0 },
            summary: { exists: !!summ, count: summ ? Object.keys(JSON.parse(summ)).length : 0 },
            companies: { exists: !!comp, count: comp ? Object.keys(JSON.parse(comp)).length : 0 },
            dashboard: { exists: !!stats, lastSync: stats ? JSON.parse(stats).stats?.lastSync : null }
          }
        });
      },
      deepRepairIndex: async (params, ctx, env) => {

        const fullRaw = await env.DB.get(indexKeys.fullCertificates);
        if (!fullRaw) return jsonResponse({ success: false, error: "NO_FULL_CERT_DATA" }, 404);
        const fullList = JSON.parse(fullRaw);
        const summaryIndex = {};
        fullList.forEach(c => {
           const canonical = createCanonicalCertificate(c);
           const cid = getCertificateId(canonical);
           if (cid) summaryIndex[cid] = createCertificateSummary(canonical);
        });
        await env.DB.put(indexKeys.certificateSummary, JSON.stringify(summaryIndex), { expirationTtl: CACHE_TTL });
        ctx.waitUntil(rebuildDashboardStats());
        return jsonResponse({ success: true, count: Object.keys(summaryIndex).length });
      },
      clearCache: async (p, ctx, env) => {
        let cursor = undefined;
        do {
          const page = await env.DB.list({ prefix: "cache:", cursor });
          if (page.keys.length) await Promise.all(page.keys.map(k => env.DB.delete(k.name)));
          cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor);
        return jsonResponse({ success: true, message: "Cache Cleared" });
      }
    };


    const CompanyHandlers = {
      getCompanies: async (p, ctx, env) => {
        const raw = await env.DB.get(indexKeys.companySearch);
        return jsonResponse({ success: true, data: raw ? Object.values(JSON.parse(raw)) : [] });
      },
      getCompanyById: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const raw = await env.DB.get(`cache:company:${id}`);
        if (raw) return jsonResponse({ success: true, data: JSON.parse(raw) });

        // Fallback to Full Index + write-back
        const fullRaw = await env.DB.get(indexKeys.fullCompanies);
        const company = fullRaw ? JSON.parse(fullRaw).find(c => String(getCompanyId(c)) === id) : null;
        if (company) ctx.waitUntil(env.DB.put(`cache:company:${id}`, JSON.stringify(company), { expirationTtl: CACHE_TTL }));
        return jsonResponse({ success: !!company, data: company });
      },
      addCompany: async (p, ctx, env) => {
        const nextIdRaw = await env.DB.get(indexKeys.companyNextId);
        const newId = String(parseInt(nextIdRaw || "1") || 1);
        const created = createCanonicalCompany(p?.companyInfo || {}, { id: newId });
        const searchRaw = await env.DB.get(indexKeys.companySearch);
        const searchIdx = searchRaw ? JSON.parse(searchRaw) : {};
        searchIdx[newId] = createSearchEntry(created);

        await Promise.all([
          env.DB.put(`cache:company:${newId}`, JSON.stringify(created), { expirationTtl: CACHE_TTL }),
          env.DB.put(indexKeys.companyNextId, String(parseInt(newId) + 1), { expirationTtl: CACHE_TTL }),
          env.DB.put(indexKeys.companySearch, JSON.stringify(searchIdx), { expirationTtl: CACHE_TTL }),
        ]);
        return jsonResponse({ success: true, id: newId, data: created });
      },
      updateCompany: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        let existingRaw = await env.DB.get(`cache:company:${id}`);
        if (!existingRaw) {
          const fullRaw = await env.DB.get(indexKeys.fullCompanies);
          const found = fullRaw ? JSON.parse(fullRaw).find(c => String(getCompanyId(c)) === id) : null;
          if (!found) return jsonResponse({ success: false, error: "NOT_FOUND" }, 404);
          existingRaw = JSON.stringify(found);
        }

        const updated = createCanonicalCompany(JSON.parse(existingRaw), { id, explicit: p?.companyInfo || {} });
        const searchRaw = await env.DB.get(indexKeys.companySearch);
        const searchIdx = searchRaw ? JSON.parse(searchRaw) : {};
        searchIdx[id] = createSearchEntry(updated);

        await Promise.all([
          env.DB.put(`cache:company:${id}`, JSON.stringify(updated), { expirationTtl: CACHE_TTL }),
          env.DB.put(indexKeys.companySearch, JSON.stringify(searchIdx), { expirationTtl: CACHE_TTL }),
        ]);
        return jsonResponse({ success: true, data: updated });
      }
    };

    const CertificateHandlers = {
      getDashboardSummary: async (p, ctx, env) => {
        const raw = await env.DB.get(indexKeys.dashboardStats);
        return jsonResponse({ success: !!raw, data: raw ? JSON.parse(raw) : null });
      },
      getCertificateSummaries: async (p, ctx, env) => {
        const raw = await env.DB.get(indexKeys.certificateSummary);
        const list = raw ? Object.values(JSON.parse(raw)) : [];
        return jsonResponse({ success: true, data: sortCertificatesByIdDesc(list) });
      },
      getCertificates: async (p, ctx, env) => {
        const raw = await env.DB.get(indexKeys.fullCertificates);
        return jsonResponse({ success: !!raw, data: raw ? JSON.parse(raw) : [] });
      },
      getRecentCertificates: async (p, ctx, env) => {
        const [recentIdsRaw, summaryRaw] = await Promise.all([
          env.DB.get(indexKeys.certificateRecent),
          env.DB.get(indexKeys.certificateSummary),
        ]);
        if (!recentIdsRaw) return jsonResponse({ success: true, data: [] });
        const ids = JSON.parse(recentIdsRaw).slice(0, p?.limit || 25);
        const summaryIdx = summaryRaw ? JSON.parse(summaryRaw) : {};
        const data = ids.map(id => summaryIdx[id]).filter(Boolean);
        return jsonResponse({ success: true, data });
      },
      getCertificateById: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const raw = await env.DB.get(`cache:getCertificateById:${stableStringify({ id })}`);
        if (raw) return jsonResponse({ success: true, data: JSON.parse(raw) });
        // Fallback to full list + write-back
        const fullRaw = await env.DB.get(indexKeys.fullCertificates);
        const cert = fullRaw ? JSON.parse(fullRaw).find(c => String(getCertificateId(c)) === id) : null;
        if (cert) ctx.waitUntil(env.DB.put(`cache:getCertificateById:${stableStringify({ id })}`, JSON.stringify(cert), { expirationTtl: CACHE_TTL }));
        return jsonResponse({ success: !!cert, data: cert });
      },
      getCertificatesByFirmaId: async (p, ctx, env) => {
        const fId = String(p?.firmaId || "").trim();
        if (!fId) return jsonResponse({ success: false, error: "FIRMA_ID_REQUIRED" }, 400);
        const cached = await env.DB.get(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: fId })}`);
        if (cached) return jsonResponse({ success: true, data: JSON.parse(cached) });
        // Fallback to full list + write-back
        const fullRaw = await env.DB.get(indexKeys.fullCertificates);
        const list = fullRaw ? JSON.parse(fullRaw).filter(c => String(getCertificateFirmaId(c)) === fId) : [];
        if (list.length) ctx.waitUntil(env.DB.put(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: fId })}`, JSON.stringify(list), { expirationTtl: CACHE_TTL }));
        return jsonResponse({ success: true, data: list });
      },
      addCertificate: async (p, ctx, env) => {
        const nextIdRaw = await env.DB.get(indexKeys.certificateNextId);
        const newId = String(parseInt(nextIdRaw || "1") || 1);
        const created = createCanonicalCertificate(p?.certInfo || {}, { id: newId });
        const fId = getCertificateFirmaId(created);

        const [summaryRaw, recentRaw, firmaListRaw] = await Promise.all([
          env.DB.get(indexKeys.certificateSummary),
          env.DB.get(indexKeys.certificateRecent),
          fId ? env.DB.get(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: fId })}`) : Promise.resolve(null),
        ]);
        const summaryIdx = summaryRaw ? JSON.parse(summaryRaw) : {};
        summaryIdx[newId] = createCertificateSummary(created);
        const recentIds = mergeRecentCertificateIds(recentRaw ? JSON.parse(recentRaw) : [], [newId]);
        const firmaList = firmaListRaw ? JSON.parse(firmaListRaw) : [];
        firmaList.push(created);

        const writes = [
          env.DB.put(`cache:getCertificateById:${stableStringify({ id: newId })}`, JSON.stringify(created), { expirationTtl: CACHE_TTL }),
          env.DB.put(indexKeys.certificateNextId, String(parseInt(newId) + 1), { expirationTtl: CACHE_TTL }),
          env.DB.put(indexKeys.certificateSummary, JSON.stringify(summaryIdx), { expirationTtl: CACHE_TTL }),
          env.DB.put(indexKeys.certificateRecent, JSON.stringify(recentIds), { expirationTtl: CACHE_TTL }),
        ];
        if (fId) writes.push(env.DB.put(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: fId })}`, JSON.stringify(firmaList), { expirationTtl: CACHE_TTL }));
        await Promise.all(writes);
        ctx.waitUntil(rebuildDashboardStats());
        return jsonResponse({ success: true, id: newId, data: created });
      },
      updateCertificate: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        let existingRaw = await env.DB.get(`cache:getCertificateById:${stableStringify({ id })}`);
        if (!existingRaw) {
          const fullRaw = await env.DB.get(indexKeys.fullCertificates);
          const found = fullRaw ? JSON.parse(fullRaw).find(c => String(getCertificateId(c)) === id) : null;
          if (!found) return jsonResponse({ success: false, error: "NOT_FOUND" }, 404);
          existingRaw = JSON.stringify(found);
        }

        const existing = JSON.parse(existingRaw);
        const prevFirmaId = getCertificateFirmaId(existing);
        const updated = createCanonicalCertificate(existing, { id, explicit: p?.certInfo || {} });
        const nextFirmaId = getCertificateFirmaId(updated);

        const summaryRaw = await env.DB.get(indexKeys.certificateSummary);
        const summaryIdx = summaryRaw ? JSON.parse(summaryRaw) : {};
        summaryIdx[id] = createCertificateSummary(updated);

        const writes = [
          env.DB.put(`cache:getCertificateById:${stableStringify({ id })}`, JSON.stringify(updated), { expirationTtl: CACHE_TTL }),
          env.DB.put(indexKeys.certificateSummary, JSON.stringify(summaryIdx), { expirationTtl: CACHE_TTL }),
        ];

        if (prevFirmaId && prevFirmaId !== nextFirmaId) {
          // Firma değişti: eski listeden çıkar, yeni listeye ekle
          const [prevRaw, nextRaw] = await Promise.all([
            env.DB.get(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: prevFirmaId })}`),
            nextFirmaId ? env.DB.get(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: nextFirmaId })}`) : Promise.resolve(null),
          ]);
          const prevList = prevRaw ? JSON.parse(prevRaw).filter(c => String(getCertificateId(c)) !== id) : [];
          writes.push(env.DB.put(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: prevFirmaId })}`, JSON.stringify(prevList), { expirationTtl: CACHE_TTL }));
          if (nextFirmaId) {
            const nextList = nextRaw ? JSON.parse(nextRaw) : [];
            const nIdx = nextList.findIndex(c => String(getCertificateId(c)) === id);
            if (nIdx > -1) nextList[nIdx] = updated; else nextList.push(updated);
            writes.push(env.DB.put(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: nextFirmaId })}`, JSON.stringify(nextList), { expirationTtl: CACHE_TTL }));
          }
        } else if (prevFirmaId) {
          // Aynı firma: listeyi yerinde güncelle
          const firmaListRaw = await env.DB.get(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: prevFirmaId })}`);
          const firmaList = firmaListRaw ? JSON.parse(firmaListRaw) : [];
          const fIdx = firmaList.findIndex(c => String(getCertificateId(c)) === id);
          if (fIdx > -1) firmaList[fIdx] = updated; else firmaList.push(updated);
          writes.push(env.DB.put(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: prevFirmaId })}`, JSON.stringify(firmaList), { expirationTtl: CACHE_TTL }));
        }

        await Promise.all(writes);
        ctx.waitUntil(rebuildDashboardStats());
        return jsonResponse({ success: true, data: updated });
      },
      updateSurveillance: async (p, ctx, env) => {
        const ids = Array.isArray(p?.ids) ? p.ids : [];
        const status = p?.status === true || p?.status === "TRUE" ? "TRUE" : "FALSE";

        const summaryRaw = await env.DB.get(indexKeys.certificateSummary);
        const summaryIdx = summaryRaw ? JSON.parse(summaryRaw) : {};

        const ps = ids.map(async sId => {
          sId = String(sId);
          const certRaw = await env.DB.get(`cache:getCertificateById:${stableStringify({ id: sId })}`);
          if (!certRaw) return;
          const updated = createCanonicalCertificate(JSON.parse(certRaw), { id: sId, explicit: { "Gözetim Conf.": status, gozetimConfirmed: status } });
          summaryIdx[sId] = createCertificateSummary(updated);

          const fId = getCertificateFirmaId(updated);
          const writes = [env.DB.put(`cache:getCertificateById:${stableStringify({ id: sId })}`, JSON.stringify(updated), { expirationTtl: CACHE_TTL })];
          if (fId) {
            const firmaListRaw = await env.DB.get(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: fId })}`);
            const firmaList = firmaListRaw ? JSON.parse(firmaListRaw) : [];
            const fIdx = firmaList.findIndex(c => String(getCertificateId(c)) === sId);
            if (fIdx > -1) firmaList[fIdx] = updated; else firmaList.push(updated);
            writes.push(env.DB.put(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: fId })}`, JSON.stringify(firmaList), { expirationTtl: CACHE_TTL }));
          }
          return Promise.all(writes);
        });
        await Promise.all(ps);

        await env.DB.put(indexKeys.certificateSummary, JSON.stringify(summaryIdx), { expirationTtl: CACHE_TTL });
        ctx.waitUntil(rebuildDashboardStats());
        return jsonResponse({ success: true, updatedCount: ids.length });
      }
    };


    const EntityHandlers = {
      getTestsByFirmaId: async (p, ctx, env) => {
        const id = String(p?.firmaId || "").trim();
        const raw = await env.DB.get(`cache:getTestsByFirmaId:${stableStringify({ firmaId: id })}`);
        if (raw) return jsonResponse({ success: true, data: JSON.parse(raw) });

        // Fallback to Full Index + write-back
        const fullRaw = await env.DB.get(indexKeys.fullTests);
        const list = fullRaw ? JSON.parse(fullRaw).filter(t => String(getTestFirmaId(t)) === id) : [];
        if (list.length) ctx.waitUntil(env.DB.put(`cache:getTestsByFirmaId:${stableStringify({ firmaId: id })}`, JSON.stringify(list), { expirationTtl: CACHE_TTL }));
        return jsonResponse({ success: true, data: list });
      },
      getAudits: async (p, ctx, env) => {
        const cached = await env.DB.get("cache:getAudits:{}");
        if (cached) {
          const data = JSON.parse(cached);
          if (hasUsableAuditDates(data)) return jsonResponse({ success: true, data, fromCache: true });
        }
        const rebuilt = await rebuildAuditsFromIndex();
        if (rebuilt) {
           ctx.waitUntil(env.DB.put("cache:getAudits:{}", JSON.stringify(rebuilt), { expirationTtl: CACHE_TTL }));
           return jsonResponse({ success: true, data: rebuilt, rebuiltFromIndex: true });
        }
        return jsonResponse({ success: true, data: [] });
      },
      getTests: async (p, ctx, env) => {
        const raw = await env.DB.get(indexKeys.fullTests);
        const data = raw ? JSON.parse(raw) : [];
        return jsonResponse({ success: true, data });
      },
      getAuditsByFirmaId: async (p, ctx, env) => {
        const id = String(p?.firmaId || "").trim();
        const raw = await env.DB.get(`cache:getAuditsByFirmaId:${stableStringify({ firmaId: id })}`);
        if (raw) return jsonResponse({ success: true, data: JSON.parse(raw) });

        // Fallback to Full Index + write-back
        const fullRaw = await env.DB.get(indexKeys.fullAudits);
        const list = fullRaw ? JSON.parse(fullRaw).filter(a => String(getAuditFirmaId(a)) === id) : [];
        if (list.length) ctx.waitUntil(env.DB.put(`cache:getAuditsByFirmaId:${stableStringify({ firmaId: id })}`, JSON.stringify(list), { expirationTtl: CACHE_TTL }));
        return jsonResponse({ success: true, data: list });
      },
      getProformasByFirmaId: async (p, ctx, env) => {
        const id = String(p?.firmaId || "").trim();
        const raw = await env.DB.get(`cache:getProformasByFirmaId:${stableStringify({ firmaId: id })}`);
        if (raw) return jsonResponse({ success: true, data: JSON.parse(raw) });

        // Fallback to Full Index + write-back
        const fullRaw = await env.DB.get(indexKeys.fullProformas);
        const list = fullRaw ? JSON.parse(fullRaw).filter(pr => String(getProformaFirmaId(pr)) === id) : [];
        if (list.length) ctx.waitUntil(env.DB.put(`cache:getProformasByFirmaId:${stableStringify({ firmaId: id })}`, JSON.stringify(list), { expirationTtl: CACHE_TTL }));
        return jsonResponse({ success: true, data: list });
      },
      getProformaById: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        const raw = await env.DB.get(`cache:getProformaById:${stableStringify({ id })}`);
        if (raw) return jsonResponse({ success: true, data: JSON.parse(raw) });

        // Fallback to Full Index + write-back
        const fullRaw = await env.DB.get(indexKeys.fullProformas);
        const item = fullRaw ? JSON.parse(fullRaw).find(pr => String(getProformaId(pr)) === id) : null;
        if (item) ctx.waitUntil(env.DB.put(`cache:getProformaById:${stableStringify({ id })}`, JSON.stringify(item), { expirationTtl: CACHE_TTL }));
        return jsonResponse({ success: !!item, data: item });
      },
      getAuditById: async (p, ctx, env) => {
        const id = String(p?.id || p?.auditId || "").trim();
        const raw = await env.DB.get(`cache:getAuditById:${stableStringify({ id })}`);
        if (raw) return jsonResponse({ success: true, data: JSON.parse(raw) });

        // Fallback to Full Index + write-back
        const fullRaw = await env.DB.get(indexKeys.fullAudits);
        const item = fullRaw ? JSON.parse(fullRaw).find(a => String(getAuditId(a)) === id) : null;
        if (item) ctx.waitUntil(env.DB.put(`cache:getAuditById:${stableStringify({ id })}`, JSON.stringify(item), { expirationTtl: CACHE_TTL }));
        return jsonResponse({ success: !!item, data: item });
      },
      buildCertPayload: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        try {
          const payload = await buildCertificatePayloadFromKv(id, p?.lang, p?.select);
          return jsonResponse({ success: true, data: payload, source: "kv" });
        } catch (e) {
          return jsonResponse({ success: false, data: null, error: `Sertifika payload üretilemedi (${id}): ${e.message}` }, 500);
        }
      },
      buildTestPayload: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if(!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        try {
           const payload = await buildTestPayloadFromKv(id);
           return jsonResponse({ success: true, data: payload });
        } catch (e) {
           return jsonResponse({ success: false, error: e.message }, 500);
        }
      },
      buildProformaPayload: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if(!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        try {
           const payload = await buildProformaPayloadFromKv(id);
           return jsonResponse({ success: true, data: payload });
        } catch (e) {
           return jsonResponse({ success: false, error: e.message }, 500);
        }
      },
      generateProforma: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if(!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        try {
          const payload = await buildProformaPayloadFromKv(id);
          const gasResult = await fetchFromGas(env, { action: "generateProforma", params: { proforma: payload } });
          return jsonResponse(gasResult);
        } catch (e) {
          return jsonResponse({ success: false, error: e.message }, 500);
        }
      },
      addTest: async (p, ctx, env) => {
        const nextId = await loadTestNextId();
        const created = createCanonicalTestRow(p?.testInfo || {}, { id: String(nextId) });
        const fId = getTestFirmaId(created);

        const writes = [
          env.DB.put(`cache:getTestById:${stableStringify({ id: String(nextId) })}`, JSON.stringify(created), { expirationTtl: CACHE_TTL }),
          env.DB.put(indexKeys.testNextId, String(nextId + 1), { expirationTtl: CACHE_TTL }),
        ];
        if (fId) {
          const raw = await env.DB.get(`cache:getTestsByFirmaId:${stableStringify({ firmaId: fId })}`);
          const list = raw ? JSON.parse(raw) : [];
          list.push(created);
          writes.push(env.DB.put(`cache:getTestsByFirmaId:${stableStringify({ firmaId: fId })}`, JSON.stringify(list), { expirationTtl: CACHE_TTL }));
        }
        await Promise.all(writes);
        return jsonResponse({ success: true, id: String(nextId), data: created });
      },
      updateTest: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        const existingRaw = await env.DB.get(`cache:getTestById:${stableStringify({ id })}`);
        if (!existingRaw) return jsonResponse({ success: false, error: "NOT_FOUND" }, 404);
        const updated = createCanonicalTestRow(JSON.parse(existingRaw), { id, explicit: p?.testInfo || {} });
        const fId = getTestFirmaId(updated);

        const writes = [env.DB.put(`cache:getTestById:${stableStringify({ id })}`, JSON.stringify(updated), { expirationTtl: CACHE_TTL })];
        if (fId) {
          const raw = await env.DB.get(`cache:getTestsByFirmaId:${stableStringify({ firmaId: fId })}`);
          const list = raw ? JSON.parse(raw) : [];
          const newList = list.map(t => getTestId(t) === id ? updated : t);
          writes.push(env.DB.put(`cache:getTestsByFirmaId:${stableStringify({ firmaId: fId })}`, JSON.stringify(newList), { expirationTtl: CACHE_TTL }));
        }
        await Promise.all(writes);
        return jsonResponse({ success: true, data: updated });
      },
      addProforma: async (p, ctx, env) => {
        const nextId = await loadProformaNextId();
        const created = createCanonicalProformaRow(p?.proInfo || {}, { id: String(nextId) });
        const fId = getProformaFirmaId(created);

        const writes = [
          env.DB.put(`cache:getProformaById:${stableStringify({ id: String(nextId) })}`, JSON.stringify(created), { expirationTtl: CACHE_TTL }),
          env.DB.put(indexKeys.proformaNextId, String(nextId + 1), { expirationTtl: CACHE_TTL }),
        ];
        if (fId) {
          const raw = await env.DB.get(`cache:getProformasByFirmaId:${stableStringify({ firmaId: fId })}`);
          const list = raw ? JSON.parse(raw) : [];
          list.push(created);
          writes.push(env.DB.put(`cache:getProformasByFirmaId:${stableStringify({ firmaId: fId })}`, JSON.stringify(list), { expirationTtl: CACHE_TTL }));
        }
        await Promise.all(writes);
        return jsonResponse({ success: true, id: String(nextId), data: created });
      },
      updateProforma: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        const existingRaw = await env.DB.get(`cache:getProformaById:${stableStringify({ id })}`);
        if (!existingRaw) return jsonResponse({ success: false, error: "NOT_FOUND" }, 404);
        const updated = createCanonicalProformaRow({ ...JSON.parse(existingRaw), ...(p?.proInfo || {}) }, { id });
        const fId = getProformaFirmaId(updated);

        const writes = [env.DB.put(`cache:getProformaById:${stableStringify({ id })}`, JSON.stringify(updated), { expirationTtl: CACHE_TTL })];
        if (fId) {
          const raw = await env.DB.get(`cache:getProformasByFirmaId:${stableStringify({ firmaId: fId })}`);
          const list = raw ? JSON.parse(raw) : [];
          const newList = list.map(pr => getProformaId(pr) === id ? updated : pr);
          writes.push(env.DB.put(`cache:getProformasByFirmaId:${stableStringify({ firmaId: fId })}`, JSON.stringify(newList), { expirationTtl: CACHE_TTL }));
        }
        await Promise.all(writes);
        return jsonResponse({ success: true, data: updated });
      },
      scheduleAudit: async (p, ctx, env) => {
        const nextId = await loadAuditNextId();
        const created = createCanonicalAuditRow(p?.data || {}, { id: String(nextId) });
        const fId = getAuditFirmaId(created);

        const [firmaRaw, fullAuditsRaw] = await Promise.all([
          fId ? env.DB.get(`cache:getAuditsByFirmaId:${stableStringify({ firmaId: fId })}`) : Promise.resolve(null),
          env.DB.get(indexKeys.fullAudits),
        ]);

        const firmaList = firmaRaw ? JSON.parse(firmaRaw) : [];
        firmaList.push(created);

        const fullList = fullAuditsRaw ? JSON.parse(fullAuditsRaw) : [];
        fullList.push(created);

        const writes = [
          env.DB.put(`cache:getAuditById:${stableStringify({ id: String(nextId) })}`, JSON.stringify(created), { expirationTtl: CACHE_TTL }),
          env.DB.put(indexKeys.auditNextId, String(nextId + 1), { expirationTtl: CACHE_TTL }),
          env.DB.put(indexKeys.fullAudits, JSON.stringify(fullList), { expirationTtl: CACHE_TTL }),
          env.DB.delete("cache:getAudits:{}"),
        ];
        if (fId) writes.push(env.DB.put(`cache:getAuditsByFirmaId:${stableStringify({ firmaId: fId })}`, JSON.stringify(firmaList), { expirationTtl: CACHE_TTL }));
        await Promise.all(writes);
        return jsonResponse({ success: true, id: String(nextId), data: created });
      },
      updateAudit: async (p, ctx, env) => {
        const id = String(p?.id || p?.auditId || "").trim();
        const existingRaw = await env.DB.get(`cache:getAuditById:${stableStringify({ id })}`);
        if (!existingRaw) return jsonResponse({ success: false, error: "NOT_FOUND" }, 404);
        const updated = createCanonicalAuditRow({ ...JSON.parse(existingRaw), ...(p?.data || p?.auditInfo || {}) }, { id });
        const fId = getAuditFirmaId(updated);

        const [firmaRaw, fullAuditsRaw] = await Promise.all([
          fId ? env.DB.get(`cache:getAuditsByFirmaId:${stableStringify({ firmaId: fId })}`) : Promise.resolve(null),
          env.DB.get(indexKeys.fullAudits),
        ]);

        const firmaList = firmaRaw ? JSON.parse(firmaRaw) : [];
        const newFirmaList = firmaList.map(a => getAuditId(a) === id ? updated : a);

        const fullList = fullAuditsRaw ? JSON.parse(fullAuditsRaw) : [];
        const newFullList = fullList.map(a => getAuditId(a) === id ? updated : a);

        const writes = [
          env.DB.put(`cache:getAuditById:${stableStringify({ id })}`, JSON.stringify(updated), { expirationTtl: CACHE_TTL }),
          env.DB.put(indexKeys.fullAudits, JSON.stringify(newFullList), { expirationTtl: CACHE_TTL }),
          env.DB.delete("cache:getAudits:{}"),
        ];
        if (fId) writes.push(env.DB.put(`cache:getAuditsByFirmaId:${stableStringify({ firmaId: fId })}`, JSON.stringify(newFirmaList), { expirationTtl: CACHE_TTL }));
        await Promise.all(writes);
        return jsonResponse({ success: true, data: updated });
      }
    };

    const DriveHandlers = {
      getFolderId: async (p, ctx, env) => {
        const id = String(p?.id || p?.firmaId || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const cacheKey = `cache:getFolderId:${stableStringify({ id })}`;
        const cached = await env.DB.get(cacheKey);
        if (cached) return jsonResponse({ success: true, data: cached, fromCache: true });
        
        const res = await fetchFromGas(env, { action: "getFolderId", params: { id } });
        if (res.success && res.data) {
          ctx.waitUntil(env.DB.put(cacheKey, String(res.data), { expirationTtl: CACHE_TTL }));
        }
        return jsonResponse(res);
      },
      getRecentFiles: async (p, ctx, env) => {
        const id = String(p?.id || p?.firmaId || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const cacheKey = `cache:getRecentFiles:${stableStringify({ id })}`;
        const cached = await env.DB.get(cacheKey);
        if (cached) return jsonResponse({ success: true, data: JSON.parse(cached), fromCache: true });

        const res = await fetchFromGas(env, { action: "getRecentFiles", params: { id } });
        if (res.success && res.data) {
          ctx.waitUntil(env.DB.put(cacheKey, JSON.stringify(res.data), { expirationTtl: CACHE_TTL }));
        }
        return jsonResponse(res);
      },
      prepareBatchFolders: async (p, ctx, env) => {
        const res = await fetchFromGas(env, { action: "prepareBatchFolders", params: p });
        return jsonResponse(res);
      }
    };


    const MasterHandlers = {
      getConsultants: async (p, ctx, env) => {
        const raw = await env.DB.get(`cache:getConsultants:{}`);
        return jsonResponse({ success: !!raw, data: raw ? JSON.parse(raw) : [] });
      },
      getConsultantById: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        const raw = await env.DB.get(`cache:getConsultantById:${stableStringify({ id })}`);
        return jsonResponse({ success: !!raw, data: raw ? JSON.parse(raw) : null });
      },
      getAuditorById: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        const raw = await env.DB.get(`cache:getAuditorById:${stableStringify({ id })}`);
        return jsonResponse({ success: !!raw, data: raw ? JSON.parse(raw) : null });
      },
      getStandardById: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        const raw = await env.DB.get(`cache:getStandardById:${stableStringify({ id })}`);
        return jsonResponse({ success: !!raw, data: raw ? JSON.parse(raw) : null });
      },
      getMasterData: async (p, ctx, env) => {
        const type = p?.type || "";
        const raw = await env.DB.get(`cache:getMasterData:${stableStringify({ type })}`);
        return jsonResponse({ success: !!raw, data: raw ? JSON.parse(raw) : null });
      },
      getAvailableSets: async (p, ctx, env) => {
        const raw = await env.DB.get("cache:index:sysdocSets");
        return jsonResponse({ success: !!raw, data: raw ? JSON.parse(raw) : [] });
      },
      getSysDocsBySetName: async (p, ctx, env) => {
        const setName = String(p?.setName || "").trim();
        const raw = await env.DB.get(`cache:getSysDocsBySetName:${stableStringify({ setName })}`);
        return jsonResponse({ success: !!raw, data: raw ? JSON.parse(raw) : [] });
      },
      getTestDocByName: async (p, ctx, env) => {
        const name = String(p?.name || "").trim();
        const data = await getTestDocByName(name);
        return jsonResponse({ success: !!data, data });
      },
      updateMasterData: async (params, ctx, env) => {

        const type = String(params?.type || "").trim().toLowerCase();
        const validTypes = new Set(["standards", "auditors", "consultants", "testdocs", "sysdocs"]);
        if (!validTypes.has(type)) return jsonResponse({ success: false, error: "INVALID_MASTER_TYPE" }, 400);

        const allKey = "cache:getMasterData:{}";
        let payload = null;
        const currentRaw = await env.DB.get(allKey);
        if (currentRaw) {
          payload = JSON.parse(currentRaw);
        } else {
          const fetched = await fetchFromGas(env, { action: "getMasterSyncData" });
          if (!fetched.success) return jsonResponse({ success: false, error: "MASTER_SYNC_FAILED" }, 503);
          payload = fetched.data;
        }

        payload.datasets = payload.datasets || {};
        const ds = payload.datasets[type];
        if (!ds || !Array.isArray(ds.headers)) return jsonResponse({ success: false, error: "MASTER_DATASET_NOT_FOUND" }, 404);

        const expectedVersion = params?.expectedVersion;
        if (expectedVersion !== undefined && String(expectedVersion) !== String(payload.version)) {
          return jsonResponse({ success: false, error: "MASTER_VERSION_CONFLICT", currentVersion: payload.version }, 409);
        }

        const rows = Array.isArray(params?.data?.rows) ? params.data.rows : [];
        const replace = params?.replace !== false;
        if (replace && !rows.length && !params?.options?.allowEmptyReplace) {
          return jsonResponse({ success: false, error: "EMPTY_REPLACE_BLOCKED" }, 400);
        }

        const hLen = ds.headers.length;
        const normalized = rows.map(r => {
          const arr = Array.isArray(r) ? r.slice(0, hLen) : [];
          while (arr.length < hLen) arr.push("");
          return arr;
        });

        ds.rows = replace ? normalized : [...(Array.isArray(ds.rows) ? ds.rows : []), ...normalized];
        payload.version = String(parseVersionNumber(payload.version) + 1);
        payload.updatedAt = new Date().toISOString();

        const typeKey = `cache:getMasterData:${stableStringify({ type })}`;
        const typePayload = { version: payload.version, updatedAt: payload.updatedAt, dataset: ds };
        const writes = [
          env.DB.put(allKey, JSON.stringify(payload), { expirationTtl: CACHE_TTL }),
          env.DB.put(typeKey, JSON.stringify(typePayload), { expirationTtl: CACHE_TTL })
        ];

        if (type === "consultants") {
          const list = buildConsultantsFromDataset(ds);
          writes.push(env.DB.put("cache:getConsultants:{}", JSON.stringify(list), { expirationTtl: CACHE_TTL }));
        }
        if (type === "standards") {
          const indexed = buildStandardsByIdFromDataset(ds);
          Object.entries(indexed).forEach(([sid, sObj]) => {
            writes.push(env.DB.put(`cache:getStandardById:${stableStringify({ id: sid })}`, JSON.stringify(sObj), { expirationTtl: CACHE_TTL }));
          });
        }

        for (let i = 0; i < writes.length; i += 50) await Promise.all(writes.slice(i, i + 50));
        return jsonResponse({ success: true, version: payload.version });
      }
    };

    if (request.method === "POST") {
      try {
        const body = await request.json();
        const { action, params = {} } = body;

        // V6 Dictionary Initialization
        const actionHandlers = {
          ...SyncHandlers,
          ...CompanyHandlers,
          ...CertificateHandlers,
          ...EntityHandlers,
          ...MasterHandlers,
          ...DriveHandlers
        };

        // 🎯 1. V6 Dispatcher (O(1) Domain Logic)
        if (actionHandlers[action]) {
          try {
             return await actionHandlers[action](params, ctx, env);
          } catch (e) {
             console.error(`Handler Error: ${action}`, e);
             return jsonResponse({ success: false, error: `HANDLER_ERROR: ${action}`, details: e.message }, 500);
          }
        }

        // 🛰️ 2. GAS Fallback (Tanınmayan aksiyonlar doğrudan GAS'a iletilir)
        const gasResponse = await fetch(env.GAS_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, apiKey: env.API_KEY }),
        });

        const gasText = await gasResponse.text();
        try {
          const gasResult = JSON.parse(gasText);
          return jsonResponse(gasResult, gasResponse.status);
        } catch (_) {
          return jsonResponse({ success: false, error: "GAS_INVALID_RESPONSE", details: gasText.slice(0, 500) }, 502);
        }

      } catch (err) {
        return jsonResponse({ success: false, error: "V6 Proxy Hatası: " + err.message }, 500);
      }
    }


    return new Response("🚀 Medicert Cloudflare Proxy (v6.0 - Dispatcher) Active", {
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  },

};
