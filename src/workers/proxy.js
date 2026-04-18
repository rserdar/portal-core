/**
 * 🛰️ Medicert Portal: Cloudflare Worker Proxy (v6.0 - Dispatcher Pattern)
 *
 * Mimari Özeti:
 * - Source of Truth: Google Sheets (GAS üzerinden).
 * - Cache / Index: Cloudflare D1 (env.DB_D1) — SQL destekli, KV'nin yerini aldı.
 * - KV (env.DB): Yalnızca auth token ve mutex lock için korunur.
 * - Write path: Worker → GAS (Sheets write) → D1 güncelle.
 * - Read path:  Worker → D1 okur; self-healing fallback uygulanmaz (miss = boş sonuç).
 * - Google Native (Drive/Calendar/Docs/Gmail): Doğrudan GAS, D1 bypass.
 *
 * Bindings:
 *   env.DB      — Cloudflare KV  (token/lock only)
 *   env.DB_D1   — Cloudflare D1  (primary cache/index)
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

    const CACHE_TTL = 86400 * 365; // Drive cache TTL (KV)

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
    /**
     * 📊 REBUILD DASHBOARD STATS (New Gen Architecture)
     * Verileri tek tek yüklemek yerine indeksleri çekip bellekte istatistikleri fırınlar.
     */
    const rebuildDashboardStats = async () => {
      if (!env.DB_D1) return null;
      try {
        const [certRows, companyRows] = await Promise.all([
          env.DB_D1.prepare(
            `SELECT c.firma_no, c.sertifika_tarihi, c.gozetim_tarihi, c.gozetim_confirmed,
                    c.durum, c.consultant, co.nickname, co.city, co.ulke
             FROM certificates c
             LEFT JOIN companies co ON co.id = c.firma_no`
          ).all(),
          env.DB_D1.prepare('SELECT id, ulke, city FROM companies').all(),
        ]);

        const certificates = certRows.results || [];
        const companies = companyRows.results || [];
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
          const ulkeStr = normalizeTR(c.ulke || "").replace(/[^A-Z]/g, "");
          const isTurkish = !ulkeStr || ["TR", "TC", "TURKIYE", "TURKEY"].includes(ulkeStr);
          if (!isTurkish) {
            foreignCompanies.add(String(c.id));
            return;
          }
          const city = normalizeTR(c.city || "") || "BILINMIYOR";
          companyToCity.set(String(c.id), city);
        });

        const cityMap = new Map();

        certificates.forEach((c) => {
          if (!c) return;

          const firmaNoStr = String(c.firma_no || "");
          if (firmaNoStr && foreignCompanies.has(firmaNoStr)) return;

          if (firmaNoStr) uniqueCompanies.add(firmaNoStr);

          const certDate = parseTRDate(c.sertifika_tarihi);
          const gozDate = parseTRDate(c.gozetim_tarihi);
          const gozNotConfirmed = c.gozetim_confirmed !== 1;
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

          const dan = String(c.consultant || "Atanmamış").trim() || "Atanmamış";
          charts.consultants[dan] = (charts.consultants[dan] || 0) + 1;

          const dateStr = String(c.sertifika_tarihi || "").trim();
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
          if (entry.nicknames.length < 15) entry.nicknames.push(c.nickname || "");

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
        await env.DB_D1.prepare(
          `INSERT OR REPLACE INTO sync_meta (key, value, updated_at) VALUES ('dashboard_stats', ?, unixepoch())`
        ).bind(JSON.stringify(payload)).run();
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
    const rowToObject = (headers, row) => {
      const obj = {};
      const safeHeaders = Array.isArray(headers) ? headers : [];
      const safeRow = Array.isArray(row) ? row : [];
      safeHeaders.forEach((header, index) => {
        obj[String(header ?? "").trim()] = String(safeRow[index] ?? "").trim();
      });
      return obj;
    };
    const datasetRowsToObjects = (dataset) => {
      if (!dataset || typeof dataset !== "object") return [];
      const headers = Array.isArray(dataset.headers) ? dataset.headers : [];
      const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
      return rows.map((row) => rowToObject(headers, row));
    };
    const pickMasterField = (record, aliases, fallback = null) => {
      const value = pickObjectValue(record, aliases, "");
      return value === "" ? fallback : value;
    };
    const getTestDocByName = async (testName) => {
      const target = String(testName || "").trim();
      if (!target) return null;
      const row = await env.DB_D1.prepare(
        `SELECT * FROM testdocs WHERE LOWER(test_adi_tr)=LOWER(?) OR LOWER(dokuman_adi)=LOWER(?)`
      ).bind(target, target).first();
      return row || null;
    };
    const buildCertificatePayloadFromD1 = async (id, lang, select) => {
      const cert = await env.DB_D1.prepare(`SELECT * FROM certificates WHERE id=?`).bind(parseInt(id)).first();
      if (!cert) throw new Error(`CERTIFICATE_D1_EMPTY: Sertifika '${id}' bulunamadı. Önce senkronizasyon yapın.`);
      if (!cert.firma_no) throw new Error("Sertifika kaydında firma no boş.");

      const [company, std] = await Promise.all([
        env.DB_D1.prepare(`SELECT * FROM companies WHERE id=?`).bind(cert.firma_no).first(),
        cert.standart ? env.DB_D1.prepare(`SELECT * FROM standards WHERE kod=?`).bind(cert.standart).first() : Promise.resolve(null),
      ]);
      if (!company) throw new Error(`COMPANY_D1_EMPTY: Firma '${cert.firma_no}' bulunamadı. Önce senkronizasyon yapın.`);

      return {
        nick: company.nickname,
        id: String(cert.firma_no),
        standard: cert.standart,
        sNo: cert.sertifika_no,
        sTarihi: cert.sertifika_tarihi,
        sGozetimT: cert.gozetim_tarihi,
        sTT: cert.tescil_tarihi,
        sGT: cert.gecerlilik_tarihi,
        sKapsam: cert.kapsam,
        sScope: cert.scope,
        logo: cert.logo,
        nace: cert.nace,
        akrn: cert.akreditasyon,
        not: cert.sertifika_not,
        other: cert.other_standart,
        qrLink: cert.qr || cert.cert_link,
        unvan: company.unvan,
        adres: company.adres,
        il: company.city,
        ulke: company.ulke,
        sube: company.yazisma,
        trtema: std?.tema_id_tr || null,
        entema: std?.tema_id_en || null,
        lang: lang || "TR",
        select: select || "",
      };
    };
    const buildTestPayloadFromD1 = async (id, lang) => {
      const t = await env.DB_D1.prepare(`SELECT * FROM tests WHERE id=?`).bind(parseInt(id)).first();
      if (!t) throw new Error(`TEST_D1_EMPTY: Test '${id}' bulunamadı. Önce senkronizasyon yapın.`);

      const testName = String(t.test_adi || "").trim();
      if (!testName) throw new Error("Test adı boş.");

      const testDoc = await getTestDocByName(testName);
      if (!testDoc) throw new Error(`TestDoc master dataset içinde '${testName}' bulunamadı.`);

      if (!t.firma_no) throw new Error("Test kaydında firma no boş.");
      const company = await env.DB_D1.prepare(`SELECT * FROM companies WHERE id=?`).bind(t.firma_no).first();
      if (!company) throw new Error(`COMPANY_D1_EMPTY: Firma '${t.firma_no}' bulunamadı. Önce senkronizasyon yapın.`);

      return {
        testno: String(t.id || ""),
        fnick: String(company.nickname || ""),
        fno: String(t.firma_no),
        testisim: testName,
        testadi: testDoc.test_adi_tr,
        testname: testDoc.test_adi_en,
        trtema: testDoc.tema_tr,
        entema: testDoc.tema_en,
        gunsay: testDoc.gun_sayisi,
        kisabir: testDoc.kisaltma,
        kisaiki: testDoc.kisaltma2,
        marka: String(t.marka || ""),
        urun: String(t.urun || ""),
        urunkod: String(t.urun_kodu || ""),
        urunno: String(t.urun_no || ""),
        lot: String(t.lot || ""),
        kabultarih: String(t.urun_kabul || ""),
        kabulsaat: String(t.kabul_saat || ""),
        testba: String(t.test_baslangic || ""),
        testbi: String(t.test_bitis || ""),
        raportarihi: String(t.rapor_tarihi || ""),
        raporno: String(t.rapor_no || ""),
        numunesay: String(t.numune_sayisi || ""),
        numuneut: String(t.numune_ut || ""),
        numuneskt: String(t.numune_skt || ""),
        urunbilgi: String(t.urun_bilgi || ""),
        gorselbir: String(t.gorsel1 || ""),
        gorseliki: String(t.gorsel2 || ""),
        detay: String(t.detay || ""),
        lang: lang || "TR",
        unvan: company.unvan,
        adres: company.adres,
        sehir: company.city,
        ulke: company.ulke,
      };
    };
    const buildProformaPayloadFromD1 = async (id) => {
      const proforma = await env.DB_D1.prepare(`SELECT * FROM proformas WHERE id=?`).bind(parseInt(id)).first();
      if (!proforma) throw new Error(`PROFORMA_D1_EMPTY: Proforma '${id}' bulunamadı. Önce senkronizasyon yapın.`);
      if (!proforma.firma_no) throw new Error("Proforma kaydında firma no boş.");

      const company = await env.DB_D1.prepare(`SELECT * FROM companies WHERE id=?`).bind(proforma.firma_no).first();
      if (!company) throw new Error(`COMPANY_D1_EMPTY: Firma '${proforma.firma_no}' bulunamadı. Önce senkronizasyon yapın.`);

      return {
        id: String(proforma.id || ""),
        faturaNo: String(proforma.id || ""),
        nick: String(company.nickname || ""),
        firmaNo: String(proforma.firma_no),
        kdvsiz: String(proforma.kdvsiz || ""),
        kdvOran: String(proforma.kdv_oran || "20"),
        kdv: String(proforma.kdv || ""),
        toplam: String(proforma.toplam || ""),
        birim: String(proforma.birim || "TL"),
        tarih: String(proforma.tarih || ""),
        konu: String(proforma.konu || ""),
        unvan: company.unvan,
        adres: company.adres,
        il: company.city,
        ulke: company.ulke,
        tel: company.tel,
        vergiD: company.vergi_dairesi,
        vergiN: company.vergi_no,
        yetkili: company.yetkili_adi,
      };
    };

    // D1 upsert helpers (used by write handlers after GAS write)
    const _D1_COMPANY_SQL = `INSERT OR REPLACE INTO companies
      (id,nickname,unvan,adres,city,ulke,yazisma,vergi_dairesi,vergi_no,tel,faks,www,mail,
       yetkili_adi,yetkili_unvani,kyt,irtibat_kisi,irtibat_unvani,irtibat_tel,irtibat_mail,
       yapilan_is,tcs,ycs,ucs,yzcs,tascs,acs,alan,departman,vardiya,logo,kase,dokuman,
       teknik,tkapsam,sinif,firma_not,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`;
    const upsertCompanyD1 = (c, idOverride) => {
      const id = idOverride || parseInt(getCompanyId(c)) || null;
      return env.DB_D1.prepare(_D1_COMPANY_SQL).bind(
        id,c.nickname||c.nick||null,c.unvan||null,c.adres||null,c.sehir||c.il||null,c.ulke||null,
        c.yazisma||null,c.vergiD||null,c.vergiN||null,c.tel||null,c.faks||null,c.www||null,c.mail||null,
        c.yetA||null,c.yetU||null,c.kyt||null,c.irtA||null,c.irtU||null,c.irtN||null,c.irtM||null,
        c.yapis||null,c.tcs||null,c.ycs||null,c.ucs||null,c.yzcs||null,c.tascs||null,c.acs||null,
        c.alan||null,c.dept||c.departman||null,c.vardiya||null,c.logo||null,c.kase||null,
        c.dokuman||null,c.teknik||null,c.tkapsam||null,c.sinif||null,c.not||null
      ).run();
    };
    const _D1_CERT_SQL = `INSERT OR REPLACE INTO certificates
      (id,firma_no,standart,denetim_tipi,sertifika_no,sertifika_tarihi,gozetim_tarihi,tescil_tarihi,
       gecerlilik_tarihi,kapsam,scope,akreditasyon,akredite,ea,nace,consultant,other_standart,durum,
       sertifika_not,gozetim_confirmed,calendar_id,qr,cert_link,logo,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`;
    const upsertCertificateD1 = (c, idOverride) => {
      const id = idOverride || parseInt(getCertificateId(c)) || null;
      return env.DB_D1.prepare(_D1_CERT_SQL).bind(
        id,parseInt(c.firmaNo||c.firmano)||null,c.standart||null,c.denetim||c.denetimTipi||null,
        c.sno||null,c.gst||null,c.goz||null,c.stt||null,c.sgt||null,
        c.kapsam||null,c.scope||null,c.akreditasyon||c.akrn||null,c.akredite?1:0,null,
        c.kod||c.nace||null,c.dan||c.danisman||null,c.other||null,c.durum||null,c.not||null,
        c.gozetimConfirmed==='TRUE'||c.gozetimConf==='TRUE'?1:0,
        c.calendar||c.eventId||null,c.qr||null,c.certLink||c.certiLink||null,c.logo||null
      ).run();
    };
    const _D1_TEST_SQL = `INSERT OR REPLACE INTO tests
      (id,firma_no,test_adi,marka,urun,urun_kodu,urun_no,lot,urun_kabul,kabul_saat,
       test_baslangic,test_bitis,rapor_tarihi,rapor_no,numune_sayisi,numune_ut,numune_skt,
       urun_bilgi,gorsel1,gorsel2,detay,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`;
    const upsertTestD1 = (t, idOverride) => {
      const id = idOverride || parseInt(getTestId(t)) || null;
      return env.DB_D1.prepare(_D1_TEST_SQL).bind(
        id,parseInt(getTestFirmaId(t))||null,t.testAdi||null,t.marka||null,t.urun||null,
        t.urunKodu||null,t.urunNo||null,t.lot||null,t.urunKabul||null,t.kabulSaat||null,
        t.testBaslangic||null,t.testBitis||null,t.raporTarihi||null,t.raporNo||null,
        parseInt(t.numuneSayisi)||null,t.numuneUT||null,t.numuneSKT||null,
        t.urunBilgi||null,t.gorsel1||null,t.gorsel2||null,t.detay||null
      ).run();
    };
    const _D1_PROFORMA_SQL = `INSERT OR REPLACE INTO proformas
      (id,firma_no,kdvsiz,kdv_oran,kdv,toplam,birim,tarih,konu,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,unixepoch())`;
    const upsertProformaD1 = (p, idOverride) => {
      const id = idOverride || parseInt(getProformaId(p)) || null;
      return env.DB_D1.prepare(_D1_PROFORMA_SQL).bind(
        id,parseInt(getProformaFirmaId(p))||null,parseFloat(p.kdvsiz)||null,
        parseInt(p.kdvOran)||null,parseFloat(p.kdv)||null,parseFloat(p.toplam)||null,
        p.birim||null,p.tarih||null,p.konu||null
      ).run();
    };
    const _D1_AUDIT_SQL = `INSERT OR REPLACE INTO audits
      (id,firma_no,sertifika_id,standart,denetim_tipi,
       a1_baslangic,a1_bitis,a1_manday,a1_bas_denetci,a1_denetci_2,a1_denetci_3,
       a2_baslangic,a2_bitis,a2_manday,a2_bas_denetci,a2_denetci_2,a2_denetci_3,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`;
    const upsertAuditD1 = (a, idOverride) => {
      const id = idOverride || parseInt(getAuditId(a)) || null;
      return env.DB_D1.prepare(_D1_AUDIT_SQL).bind(
        id,parseInt(getAuditFirmaId(a))||null,parseInt(a.sertifikaId||a.certId)||null,
        a.standart||null,a.denetimTipi||null,
        a.a1Basla||null,a.a1Bitis||null,parseFloat(a.a1Md)||null,a.a1La||null,a.a1Fa||null,a.a1Sa||null,
        a.a2Basla||null,a.a2Bitis||null,parseFloat(a.a2Md)||null,a.a2La||null,a.a2Fa||null,a.a2Sa||null
      ).run();
    };


    const upsertMasterTypeToD1 = async (type, rows, env) => {
      const batchInsert = async (stmts) => {
        for (let i = 0; i < stmts.length; i += 100) await env.DB_D1.batch(stmts.slice(i, i + 100));
      };
      if (type === "standards") {
        const normalized = rows.map(r => ({
          kod: pickMasterField(r, ["kod", "id", "standard code", "standart kodu", "standart"]),
          kisaltma: pickMasterField(r, ["kisaltma", "kısaltma", "short code", "kisaltma kodu"]),
          tam_ad: pickMasterField(r, ["tam_ad", "tam adı", "tam adi", "tamad", "ad", "standart adı", "standart adi", "full"]),
          tanim_tr: pickMasterField(r, ["tanim_tr", "tanım (tr)", "tanim tr", "türkçe tanım", "turkce tanim"]),
          tanim_en: pickMasterField(r, ["tanim_en", "tanım (en)", "tanim en", "english description", "ingilizce tanım", "ingilizce tanim"]),
          tema_id_en: pickMasterField(r, ["tema_id_en", "tema id (en)", "english theme id", "themeid", "en tema", "ingilizce tema id"]),
          tema_id_tr: pickMasterField(r, ["tema_id_tr", "tema id (tr)", "turkish theme id", "temaid", "tr tema", "türkçe tema id", "turkce tema id"]),
        })).filter(r => r.kod || r.kisaltma || r.tam_ad);
        if (normalized.length) {
          await env.DB_D1.prepare(`DELETE FROM standards`).run();
          const s = env.DB_D1.prepare(`INSERT OR REPLACE INTO standards (kod,kisaltma,tam_ad,tanim_tr,tanim_en,tema_id_en,tema_id_tr) VALUES (?,?,?,?,?,?,?)`);
          await batchInsert(normalized.map(r => s.bind(String(r.kod||""),r.kisaltma||null,r.tam_ad||null,r.tanim_tr||null,r.tanim_en||null,r.tema_id_en||null,r.tema_id_tr||null)));
        }
      } else if (type === "auditors") {
        const isChecked = (val) => String(val).trim().toUpperCase() === "TRUE" || val === true || val === "true" || val === 1 || String(val) === '1';
        const normalizedAuditors = rows.map((r, idx) => {
          const isArr = Array.isArray(r);
          return {
            id: parseInt(isArr ? r[0] : r.id) || idx + 1,
            ad: String((isArr ? r[1] : r.ad) || "").trim(),
            soyad: String((isArr ? r[2] : r.soyad) || "").trim(),
            imza: String((isArr ? r[3] : r.imza) || "").trim(),
            std_9001: isChecked(isArr ? r[4] : r.std_9001) ? 1 : 0,
            std_13485: isChecked(isArr ? r[5] : r.std_13485) ? 1 : 0,
            std_14001: isChecked(isArr ? r[6] : r.std_14001) ? 1 : 0,
            std_22000: isChecked(isArr ? r[7] : r.std_22000) ? 1 : 0,
            std_27001: isChecked(isArr ? r[8] : r.std_27001) ? 1 : 0,
            std_45001: isChecked(isArr ? r[9] : r.std_45001) ? 1 : 0,
            std_50001: isChecked(isArr ? r[10] : r.std_50001) ? 1 : 0,
            std_gmp: isChecked(isArr ? r[11] : r.std_gmp) ? 1 : 0
          };
        }).filter(a => a.ad || a.soyad);
        if (normalizedAuditors.length) {
          await env.DB_D1.prepare(`DELETE FROM auditors`).run();
          const a = env.DB_D1.prepare(`INSERT INTO auditors (id,ad,soyad,imza,std_9001,std_13485,std_14001,std_22000,std_27001,std_45001,std_50001,std_gmp,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`);
          await batchInsert(normalizedAuditors.map(r => a.bind(r.id,r.ad,r.soyad,r.imza,r.std_9001,r.std_13485,r.std_14001,r.std_22000,r.std_27001,r.std_45001,r.std_50001,r.std_gmp)));
        }
      } else if (type === "consultants") {
        const normalized = rows.map(r => ({
          id: pickMasterField(r, ["id","consultant id","danisman id"]),
          ad: pickMasterField(r, ["ad","adı","adi","isim","danışman","danisman","danışmanlar","name"]),
          adres: pickMasterField(r, ["adres","address"]),
          tel: pickMasterField(r, ["tel","telefon","gsm"]),
          mail: pickMasterField(r, ["mail","email","e-posta","eposta"]),
          yetkili_adi: pickMasterField(r, ["yetkili_adi","yetkili adı","yetkili adi","yetkili","ilgili kişi","ilgili kisi"]),
          yetkili_soyad: pickMasterField(r, ["yetkili_soyad","yetkili soyadı","yetkili soyadi"]),
          hitabet: pickMasterField(r, ["hitabet","unvan","ünvan","title"]),
        })).filter(r => r.id || r.ad || r.adres || r.tel || r.mail);
        if (normalized.length) {
          await env.DB_D1.prepare(`DELETE FROM consultants`).run();
          const c = env.DB_D1.prepare(`INSERT OR REPLACE INTO consultants (id,ad,adres,tel,mail,yetkili_adi,yetkili_soyad,hitabet,updated_at) VALUES (?,?,?,?,?,?,?,?,unixepoch())`);
          await batchInsert(normalized.map(r => c.bind(parseInt(r.id)||null,r.ad||null,r.adres||null,r.tel||null,r.mail||null,r.yetkili_adi||null,r.yetkili_soyad||null,r.hitabet||null)));
        }
      } else if (type === "testdocs") {
        const normalized = rows.map(r => ({
          id: pickMasterField(r, ["id","testdoc id"]),
          kategori: pickMasterField(r, ["kategori","category"]),
          aciklama: pickMasterField(r, ["aciklama","açıklama","description","testin açıklaması","testin aciklamasi"]),
          dokuman_adi: pickMasterField(r, ["dokuman_adi","doküman adı","dokuman adi","document name"]),
          test_adi_tr: pickMasterField(r, ["test_adi_tr","test adı","test adı (tr)","türkçe test adı","turkce test adi"]),
          test_adi_en: pickMasterField(r, ["test_adi_en","test adı (en)","ingilizce test adı","ingilizce test adi","english test name"]),
          standart: pickMasterField(r, ["standart","standard","test standardı","test standardi"]),
          tema_tr: pickMasterField(r, ["tema_tr","türkçe tema","turkce tema","tema tr"]),
          tema_en: pickMasterField(r, ["tema_en","ingilizce tema","tema en","english theme"]),
          gun_sayisi: pickMasterField(r, ["gun_sayisi","gün sayısı","gun sayisi","days"]),
          kisaltma: pickMasterField(r, ["kisaltma","kısaltma"]),
          kisaltma2: pickMasterField(r, ["kisaltma2","kısaltma 2","kisaltma 2"]),
          notlar: pickMasterField(r, ["notlar","not","notes"]),
        })).filter(r => r.id || r.kategori || r.test_adi_tr || r.standart);
        if (normalized.length) {
          await env.DB_D1.prepare(`DELETE FROM testdocs`).run();
          const t = env.DB_D1.prepare(`INSERT OR REPLACE INTO testdocs (id,kategori,aciklama,dokuman_adi,test_adi_tr,test_adi_en,standart,tema_tr,tema_en,gun_sayisi,kisaltma,kisaltma2,notlar,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`);
          await batchInsert(normalized.map(r => t.bind(parseInt(r.id)||null,r.kategori||null,r.aciklama||null,r.dokuman_adi||null,r.test_adi_tr||null,r.test_adi_en||null,r.standart||null,r.tema_tr||null,r.tema_en||null,parseInt(r.gun_sayisi)||null,r.kisaltma||null,r.kisaltma2||null,r.notlar||null)));
        }
      } else if (type === "sysdocs") {
        const normalized = rows.map(r => ({
          id: pickMasterField(r, ["id","sysdoc id"]),
          set_adi: pickMasterField(r, ["set_adi","set adı","set adi","set","setin adı","setin adi"]),
          dosya_turu: pickMasterField(r, ["dosya_turu","dosya türü","dosya turu","tür","tur"]),
          klasor_adi: pickMasterField(r, ["klasor_adi","klasör adı","klasor adi","klasör","folder"]),
          dokuman_kodu: pickMasterField(r, ["dokuman_kodu","doküman kodu","dokuman kodu","kod"]),
          dokuman_adi: pickMasterField(r, ["dokuman_adi","doküman adı","dokuman adi","ad"]),
          dokuman_id: pickMasterField(r, ["dokuman_id","doküman id","dokuman id","drive id","file id"]),
        })).filter(r => r.id || r.set_adi || r.dokuman_kodu || r.dokuman_adi);
        if (normalized.length) {
          await env.DB_D1.prepare(`DELETE FROM sysdocs`).run();
          const s = env.DB_D1.prepare(`INSERT OR REPLACE INTO sysdocs (id,set_adi,dosya_turu,klasor_adi,dokuman_kodu,dokuman_adi,dokuman_id,updated_at) VALUES (?,?,?,?,?,?,?,unixepoch())`);
          await batchInsert(normalized.map(r => s.bind(parseInt(r.id)||null,r.set_adi||null,r.dosya_turu||null,r.klasor_adi||null,r.dokuman_kodu||null,r.dokuman_adi||null,r.dokuman_id||null)));
        }
      }
    };

    const fetchFromGasViaGet = async (env, body) => {
      if (body?.action !== "translate") return null;

      const url = new URL(env.GAS_API_URL);
      url.searchParams.set("action", "translate");
      url.searchParams.set("apiKey", String(env.API_KEY || ""));
      url.searchParams.set("text", String(body?.params?.text || ""));
      url.searchParams.set("toEn", body?.params?.toEn ? "true" : "false");

      const res = await fetch(url.toString(), { method: "GET" });
      const text = await res.text();
      if (!res.ok || !text.trimStart().startsWith('{')) {
        throw new Error(`GAS_HTTP_ERROR: ${res.status} — ${text.slice(0, 200)}`);
      }
      return JSON.parse(text);
    };

    const fetchFromGas = async (env, body) => {
      const requestBody = JSON.stringify({ ...body, apiKey: env.API_KEY });
      const res = await fetch(env.GAS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });

      const text = await res.text();
      if (!res.ok || !text.trimStart().startsWith('{')) {
        const code = res.status;
        if (body?.action === "translate") {
          return await fetchFromGasViaGet(env, body);
        }
        if (code === 524 || text.includes('524')) throw new Error('GAS_TIMEOUT_524: Google Apps Script yanıt vermedi (süre aşımı). Daha küçük bir kapsam seçin veya GAS scriptini optimize edin.');
        throw new Error(`GAS_HTTP_ERROR: ${code} — ${text.slice(0, 200)}`);
      }
      return JSON.parse(text);
    };

    const SyncHandlers = {
      bulkSync: async (params, ctx, env) => {
        if (!env.DB_D1) return jsonResponse({ success: false, error: "NO_D1_BINDING" }, 500);
        const scope = Array.isArray(params?.scope) ? params.scope : ["companies", "certificates", "audits", "tests", "proformas", "master"];
        const hasScope = (s) => scope.includes(s);
        const validMasterTypes = ["standards", "auditors", "consultants", "testdocs", "sysdocs"];
        const requestedMasterTypes = Array.isArray(params?.masterTypes)
          ? params.masterTypes.map((type) => String(type || "").trim().toLowerCase()).filter((type) => validMasterTypes.includes(type))
          : [];
        const masterTypes = requestedMasterTypes.length ? requestedMasterTypes : validMasterTypes;
        const hasMasterType = (type) => hasScope("master") && masterTypes.includes(type);

        // === GAS OKUMA (değişmez — sayfalı, GAS timeout korumalı) ===
        const PAGE_SIZE = 1500;
        const LARGE_SCOPES = new Set(["companies", "certificates", "audits", "tests", "proformas"]);
        const d = { masterMeta: {} };

        for (const s of scope) {
          if (s === "master") {
            if (masterTypes.length === validMasterTypes.length) {
              const res = await fetchFromGas(env, { action: "getMasterSyncData" });
              if (!res.success) return jsonResponse(res);
              const master = res.data || {};
              const datasets = master.datasets || {};

              d.masterVersion = master.version || null;
              d.masterUpdatedAt = master.updatedAt || null;
              d.standards = datasetRowsToObjects(datasets.standards);
              d.auditors = datasetRowsToObjects(datasets.auditors);
              d.consultants = datasetRowsToObjects(datasets.consultants);
              d.testdocs = datasetRowsToObjects(datasets.testdocs);
              d.sysdocs = datasetRowsToObjects(datasets.sysdocs);
              for (const type of validMasterTypes) {
                d.masterMeta[type] = {
                  version: master.version || null,
                  updatedAt: master.updatedAt || null
                };
              }
            } else {
              for (const type of masterTypes) {
                const res = await fetchFromGas(env, { action: "getMasterData", params: { type } });
                if (!res.success) return jsonResponse(res);
                const dataset = res.data?.dataset;
                if (!dataset) return jsonResponse({ success: false, error: `MASTER_DATASET_MISSING: ${type}` }, 502);
                d[type] = datasetRowsToObjects(dataset);
                d.masterMeta[type] = {
                  version: res.data?.version || null,
                  updatedAt: res.data?.updatedAt || null
                };
              }
            }
            continue;
          }

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

        // === D1 YAZMA ===
        const stats = {};

        // D1 batch helper: 100'erli chunk'larda gönder
        const batchInsert = async (stmts) => {
          for (let i = 0; i < stmts.length; i += 100) {
            await env.DB_D1.batch(stmts.slice(i, i + 100));
          }
        };

        // --- 🏗️ COMPANIES ---
        if (hasScope("companies")) {
          const companies = Array.isArray(d.companies) ? d.companies : [];
          const canonicalCompanies = companies.map(c => createCanonicalCompany(c)).filter(c => getCompanyId(c));

          const { results: cr } = await env.DB_D1.prepare('SELECT COUNT(*) as cnt FROM companies').all();
          const currentCount = cr[0]?.cnt ?? 0;
          if (currentCount > 10 && canonicalCompanies.length < currentCount * 0.2) {
            return jsonResponse({ success: false, error: `MASS_DELETION_PROTECTION: companies (current: ${currentCount}, incoming: ${canonicalCompanies.length})` }, 400);
          }

          await env.DB_D1.prepare(`DELETE FROM companies`).run();
          const stmt = env.DB_D1.prepare(
            `INSERT OR REPLACE INTO companies
              (id, nickname, unvan, adres, city, ulke, yazisma, vergi_dairesi, vergi_no,
               tel, faks, www, mail, yetkili_adi, yetkili_unvani, kyt,
               irtibat_kisi, irtibat_unvani, irtibat_tel, irtibat_mail,
               yapilan_is, tcs, ycs, ucs, yzcs, tascs, acs,
               alan, departman, vardiya, logo, kase, dokuman, teknik, tkapsam, sinif, firma_not,
               updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`
          );
          await batchInsert(canonicalCompanies.map(c => stmt.bind(
            parseInt(getCompanyId(c)) || null,
            c.nickname || c.nick || null,
            c.unvan || null,
            c.adres || null,
            c.sehir || c.il || null,
            c.ulke || null,
            c.yazisma || null,
            c.vergiD || null,
            c.vergiN || null,
            c.tel || null,
            c.faks || null,
            c.www || null,
            c.mail || null,
            c.yetA || null,
            c.yetU || null,
            c.kyt || null,
            c.irtA || null,
            c.irtU || null,
            c.irtN || null,
            c.irtM || null,
            c.yapis || null,
            c.tcs || null,
            c.ycs || null,
            c.ucs || null,
            c.yzcs || null,
            c.tascs || null,
            c.acs || null,
            c.alan || null,
            c.dept || c.departman || null,
            c.vardiya || null,
            c.logo || null,
            c.kase || null,
            c.dokuman || null,
            c.teknik || null,
            c.tkapsam || null,
            c.sinif || null,
            c.not || null
          )));
          stats.companies = canonicalCompanies.length;
        }

        // --- 🎖️ CERTIFICATES ---
        if (hasScope("certificates")) {
          const certs = Array.isArray(d.certificates) ? d.certificates : (Array.isArray(d.certs) ? d.certs : []);
          const certRows = Array.isArray(d.certificateRows) ? d.certificateRows : (Array.isArray(d.certRows) ? d.certRows : []);
          const canonicalCerts = [...certs, ...certRows].map(c => createCanonicalCertificate(c)).filter(c => getCertificateId(c));
          const dedupedCerts = Object.values(buildCertificatesById(canonicalCerts));

          const { results: cr } = await env.DB_D1.prepare('SELECT COUNT(*) as cnt FROM certificates').all();
          const currentCount = cr[0]?.cnt ?? 0;
          if (currentCount > 10 && dedupedCerts.length < currentCount * 0.2) {
            return jsonResponse({ success: false, error: `MASS_DELETION_PROTECTION: certificates (current: ${currentCount}, incoming: ${dedupedCerts.length})` }, 400);
          }

          await env.DB_D1.prepare(`DELETE FROM certificates`).run();
          const stmt = env.DB_D1.prepare(
            `INSERT OR REPLACE INTO certificates
              (id, firma_no, standart, denetim_tipi, sertifika_no, sertifika_tarihi,
               gozetim_tarihi, tescil_tarihi, gecerlilik_tarihi,
               kapsam, scope, akreditasyon, akredite, ea, nace,
               consultant, other_standart, durum, sertifika_not,
               gozetim_confirmed, calendar_id, qr, cert_link, logo,
               updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`
          );
          await batchInsert(dedupedCerts.map(c => stmt.bind(
            parseInt(getCertificateId(c)) || null,
            parseInt(c.firmaNo || c.firmano) || null,
            c.standart || null,
            c.denetim || c.denetimTipi || null,
            c.sno || null,
            c.gst || null,
            c.goz || null,
            c.stt || null,
            c.sgt || null,
            c.kapsam || null,
            c.scope || null,
            c.akreditasyon || c.akrn || null,
            c.akredite ? 1 : 0,
            null,                              // ea — GAS canonical objesinde gelmediğinden null; sütun D1'de var
            c.kod || c.nace || null,
            c.dan || c.danisman || null,
            c.other || null,
            c.durum || null,
            c.not || null,
            c.gozetimConfirmed === 'TRUE' || c.gozetimConf === 'TRUE' ? 1 : 0,
            c.calendar || c.eventId || null,
            c.qr || null,
            c.certLink || c.certiLink || null,
            c.logo || null
          )));
          stats.certs = dedupedCerts.length;
        }

        // --- 🧪 TESTS ---
        if (hasScope("tests")) {
          const canonicalTests = (Array.isArray(d.tests) ? d.tests : [])
            .map(row => createCanonicalTestRow(row)).filter(t => getTestId(t));

          const { results: cr } = await env.DB_D1.prepare('SELECT COUNT(*) as cnt FROM tests').all();
          const currentCount = cr[0]?.cnt ?? 0;
          if (currentCount > 10 && canonicalTests.length < currentCount * 0.2) {
            return jsonResponse({ success: false, error: `MASS_DELETION_PROTECTION: tests (current: ${currentCount}, incoming: ${canonicalTests.length})` }, 400);
          }

          await env.DB_D1.prepare(`DELETE FROM tests`).run();
          const stmt = env.DB_D1.prepare(
            `INSERT OR REPLACE INTO tests
              (id, firma_no, test_adi, marka, urun, urun_kodu, urun_no, lot,
               urun_kabul, kabul_saat, test_baslangic, test_bitis,
               rapor_tarihi, rapor_no, numune_sayisi, numune_ut, numune_skt,
               urun_bilgi, gorsel1, gorsel2, detay, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`
          );
          await batchInsert(canonicalTests.map(t => stmt.bind(
            parseInt(getTestId(t)) || null,
            parseInt(getTestFirmaId(t)) || null,
            t.testAdi || null,
            t.marka || null,
            t.urun || null,
            t.urunKodu || null,
            t.urunNo || null,
            t.lot || null,
            t.urunKabul || null,
            t.kabulSaat || null,
            t.testBaslangic || null,
            t.testBitis || null,
            t.raporTarihi || null,
            t.raporNo || null,
            parseInt(t.numuneSayisi) || null,
            t.numuneUT || null,
            t.numuneSKT || null,
            t.urunBilgi || null,
            t.gorsel1 || null,
            t.gorsel2 || null,
            t.detay || null
          )));
          stats.tests = canonicalTests.length;
        }

        // --- 📋 AUDITS ---
        if (hasScope("audits")) {
          const canonicalAudits = (Array.isArray(d.auditObjects) ? d.auditObjects : (Array.isArray(d.audits) ? d.audits : []))
            .map(a => createCanonicalAuditRow(a)).filter(a => getAuditId(a));

          const { results: cr } = await env.DB_D1.prepare('SELECT COUNT(*) as cnt FROM audits').all();
          const currentCount = cr[0]?.cnt ?? 0;
          if (currentCount > 10 && canonicalAudits.length < currentCount * 0.2) {
            return jsonResponse({ success: false, error: `MASS_DELETION_PROTECTION: audits (current: ${currentCount}, incoming: ${canonicalAudits.length})` }, 400);
          }

          await env.DB_D1.prepare(`DELETE FROM audits`).run();
          const stmt = env.DB_D1.prepare(
            `INSERT OR REPLACE INTO audits
              (id, firma_no, standart, denetim_tipi,
               a1_baslangic, a1_bitis, a1_manday, a1_bas_denetci, a1_denetci_2, a1_denetci_3,
               a2_baslangic, a2_bitis, a2_manday, a2_bas_denetci, a2_denetci_2, a2_denetci_3,
               updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`
          );
          await batchInsert(canonicalAudits.map(a => stmt.bind(
            parseInt(getAuditId(a)) || null,
            parseInt(getAuditFirmaId(a)) || null,
            a.standart || null,
            a.denetimTipi || null,
            a.a1Basla || null,
            a.a1Bitis || null,
            parseFloat(a.a1Md) || null,
            a.a1La || null,
            a.a1Fa || null,
            a.a1Sa || null,
            a.a2Basla || null,
            a.a2Bitis || null,
            parseFloat(a.a2Md) || null,
            a.a2La || null,
            a.a2Fa || null,
            a.a2Sa || null
          )));
          stats.audits = canonicalAudits.length;
        }

        // --- 💰 PROFORMAS ---
        if (hasScope("proformas")) {
          const canonicalProformas = (Array.isArray(d.proformas) ? d.proformas : [])
            .map(p => createCanonicalProformaRow(Array.isArray(p) ? rowToObject(d.proformaHeaders, p) : p))
            .filter(p => getProformaId(p));

          const { results: cr } = await env.DB_D1.prepare('SELECT COUNT(*) as cnt FROM proformas').all();
          const currentCount = cr[0]?.cnt ?? 0;
          if (currentCount > 10 && canonicalProformas.length < currentCount * 0.2) {
            return jsonResponse({ success: false, error: `MASS_DELETION_PROTECTION: proformas (current: ${currentCount}, incoming: ${canonicalProformas.length})` }, 400);
          }

          await env.DB_D1.prepare(`DELETE FROM proformas`).run();
          const stmt = env.DB_D1.prepare(
            `INSERT OR REPLACE INTO proformas
              (id, firma_no, kdvsiz, kdv_oran, kdv, toplam, birim, tarih, konu, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,unixepoch())`
          );
          await batchInsert(canonicalProformas.map(p => stmt.bind(
            parseInt(getProformaId(p)) || null,
            parseInt(getProformaFirmaId(p)) || null,
            parseFloat(p.kdvsiz) || null,
            parseInt(p.kdvOran) || null,
            parseFloat(p.kdv) || null,
            parseFloat(p.toplam) || null,
            p.birim || null,
            p.tarih || null,
            p.konu || null
          )));
          stats.proformas = canonicalProformas.length;
        }

        // --- 📚 MASTER DATA ---
        if (hasScope("master")) {
          const stdList  = Array.isArray(d.standards)   ? d.standards   : [];
          const audList  = Array.isArray(d.auditors)    ? d.auditors    : [];
          const conList  = Array.isArray(d.consultants) ? d.consultants : [];
          const tdList   = Array.isArray(d.testdocs)    ? d.testdocs    : [];
          const sdList   = Array.isArray(d.sysdocs)     ? d.sysdocs     : [];
          let normalizedStandards = [];
          let normalizedConsultants = [];
          let normalizedTestDocs = [];
          let normalizedSysDocs = [];

          if (hasMasterType("standards")) {
            normalizedStandards = stdList
              .map((r) => ({
                kod: pickMasterField(r, ["kod", "id", "standard code", "standart kodu", "standart"]),
                kisaltma: pickMasterField(r, ["kisaltma", "kısaltma", "short code", "kisaltma kodu"]),
                tam_ad: pickMasterField(r, ["tam_ad", "tam adı", "tam adi", "tamad", "ad", "standart adı", "standart adi", "full"]),
                tanim_tr: pickMasterField(r, ["tanim_tr", "tanım (tr)", "tanim tr", "türkçe tanım", "turkce tanim"]),
                tanim_en: pickMasterField(r, ["tanim_en", "tanım (en)", "tanim en", "english description", "ingilizce tanım", "ingilizce tanim"]),
                tema_id_en: pickMasterField(r, ["tema_id_en", "tema id (en)", "english theme id", "themeid", "en tema", "ingilizce tema id"]),
                tema_id_tr: pickMasterField(r, ["tema_id_tr", "tema id (tr)", "turkish theme id", "temaid", "tr tema", "türkçe tema id", "turkce tema id"]),
              }))
          .filter((r) => r.kod || r.kisaltma || r.tam_ad || r.tanim_tr || r.tanim_en || r.tema_id_en || r.tema_id_tr);

            await env.DB_D1.prepare(`DELETE FROM standards`).run();
            if (normalizedStandards.length) {
              const s = env.DB_D1.prepare(
                `INSERT OR REPLACE INTO standards (kod, kisaltma, tam_ad, tanim_tr, tanim_en, tema_id_en, tema_id_tr) VALUES (?,?,?,?,?,?,?)`
              );
              await batchInsert(normalizedStandards.map(r => s.bind(
                String(r.kod || ""),
                r.kisaltma || null,
                r.tam_ad || null,
                r.tanim_tr || null,
                r.tanim_en || null,
                r.tema_id_en || null,
                r.tema_id_tr || null
              )));
            }
          }


                    let normalizedAuditorsList = [];
          if (hasMasterType("auditors")) {
            const isChecked = (val) => String(val).trim().toUpperCase() === "TRUE" || val === true || val === "true" || val === 1 || String(val) === '1';
            normalizedAuditorsList = audList.map((r, idx) => {
              const isArr = Array.isArray(r);
              return {
                id: parseInt(isArr ? r[0] : r.id) || idx + 1,
                ad: String((isArr ? r[1] : r.ad) || "").trim(),
                soyad: String((isArr ? r[2] : r.soyad) || "").trim(),
                imza: String((isArr ? r[3] : r.imza) || "").trim(),
                std_9001: isChecked(isArr ? r[4] : r.std_9001) ? 1 : 0,
                std_13485: isChecked(isArr ? r[5] : r.std_13485) ? 1 : 0,
                std_14001: isChecked(isArr ? r[6] : r.std_14001) ? 1 : 0,
                std_22000: isChecked(isArr ? r[7] : r.std_22000) ? 1 : 0,
                std_27001: isChecked(isArr ? r[8] : r.std_27001) ? 1 : 0,
                std_45001: isChecked(isArr ? r[9] : r.std_45001) ? 1 : 0,
                std_50001: isChecked(isArr ? r[10] : r.std_50001) ? 1 : 0,
                std_gmp: isChecked(isArr ? r[11] : r.std_gmp) ? 1 : 0
              };
            }).filter(a => a.ad || a.soyad);
            
            await env.DB_D1.prepare(`DELETE FROM auditors`).run();
            if (normalizedAuditorsList.length) {
              const a = env.DB_D1.prepare(
                `INSERT INTO auditors (id, ad, soyad, imza, std_9001, std_13485, std_14001, std_22000, std_27001, std_45001, std_50001, std_gmp, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`
              );
              await batchInsert(normalizedAuditorsList.map(r => a.bind(
                r.id, r.ad, r.soyad, r.imza,
                r.std_9001, r.std_13485, r.std_14001, r.std_22000,
                r.std_27001, r.std_45001, r.std_50001, r.std_gmp
              )));
            }
          }

          if (hasMasterType("consultants")) {
            normalizedConsultants = conList
              .map((r) => ({
                id: pickMasterField(r, ["id", "consultant id", "danisman id"]),
                ad: pickMasterField(r, ["ad", "adı", "adi", "isim", "danışman", "danisman", "danışmanlar", "name"]),
                adres: pickMasterField(r, ["adres", "address"]),
                tel: pickMasterField(r, ["tel", "telefon", "gsm"]),
                mail: pickMasterField(r, ["mail", "email", "e-posta", "eposta"]),
                yetkili_adi: pickMasterField(r, ["yetkili_adi", "yetkili adı", "yetkili adi", "yetkili", "ilgili kişi", "ilgili kisi"]),
                yetkili_soyad: pickMasterField(r, ["yetkili_soyad", "yetkili soyadı", "yetkili soyadi"]),
                hitabet: pickMasterField(r, ["hitabet", "unvan", "ünvan", "title"]),
              }))
              .filter((r) => r.id || r.ad || r.adres || r.tel || r.mail || r.yetkili_adi || r.yetkili_soyad || r.hitabet);

            await env.DB_D1.prepare(`DELETE FROM consultants`).run();
            if (normalizedConsultants.length) {
              const c = env.DB_D1.prepare(
                `INSERT OR REPLACE INTO consultants (id, ad, adres, tel, mail, yetkili_adi, yetkili_soyad, hitabet, updated_at)
                 VALUES (?,?,?,?,?,?,?,?,unixepoch())`
              );
              await batchInsert(normalizedConsultants.map(r => c.bind(
                parseInt(r.id) || null,
                r.ad || null,
                r.adres || null,
                r.tel || null,
                r.mail || null,
                r.yetkili_adi || null,
                r.yetkili_soyad || null,
                r.hitabet || null
              )));
            }
          }

          if (hasMasterType("testdocs")) {
            normalizedTestDocs = tdList
              .map((r) => ({
                id: pickMasterField(r, ["id", "testdoc id"]),
                kategori: pickMasterField(r, ["kategori", "category"]),
                aciklama: pickMasterField(r, ["aciklama", "açıklama", "description", "testin açıklaması", "testin aciklamasi"]),
                dokuman_adi: pickMasterField(r, ["dokuman_adi", "doküman adı", "dokuman adi", "document name"]),
                test_adi_tr: pickMasterField(r, ["test_adi_tr", "test adı", "test adı (tr)", "türkçe test adı", "turkce test adi"]),
                test_adi_en: pickMasterField(r, ["test_adi_en", "test adı (en)", "ingilizce test adı", "ingilizce test adi", "english test name"]),
                standart: pickMasterField(r, ["standart", "standard", "test standardı", "test standardi"]),
                tema_tr: pickMasterField(r, ["tema_tr", "türkçe tema", "turkce tema", "tema tr"]),
                tema_en: pickMasterField(r, ["tema_en", "ingilizce tema", "ingilizce tema", "tema en", "english theme"]),
                gun_sayisi: pickMasterField(r, ["gun_sayisi", "gün sayısı", "gun sayisi", "days"]),
                kisaltma: pickMasterField(r, ["kisaltma", "kısaltma"]),
                kisaltma2: pickMasterField(r, ["kisaltma2", "kısaltma 2", "kisaltma 2"]),
                notlar: pickMasterField(r, ["notlar", "not", "notes"]),
              }))
              .filter((r) => r.id || r.kategori || r.aciklama || r.dokuman_adi || r.test_adi_tr || r.test_adi_en || r.standart || r.tema_tr || r.tema_en || r.gun_sayisi || r.kisaltma || r.kisaltma2 || r.notlar);

            await env.DB_D1.prepare(`DELETE FROM testdocs`).run();
            if (normalizedTestDocs.length) {
              const t = env.DB_D1.prepare(
                `INSERT OR REPLACE INTO testdocs (id, kategori, aciklama, dokuman_adi, test_adi_tr, test_adi_en, standart, tema_tr, tema_en, gun_sayisi, kisaltma, kisaltma2, notlar, updated_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`
              );
              await batchInsert(normalizedTestDocs.map(r => t.bind(
                parseInt(r.id) || null,
                r.kategori || null, r.aciklama || null, r.dokuman_adi || null,
                r.test_adi_tr || null, r.test_adi_en || null, r.standart || null,
                r.tema_tr || null, r.tema_en || null,
                parseInt(r.gun_sayisi) || null,
                r.kisaltma || null, r.kisaltma2 || null, r.notlar || null
              )));
            }
          }

          if (hasMasterType("sysdocs")) {
            normalizedSysDocs = sdList
              .map((r) => ({
                id: pickMasterField(r, ["id", "sysdoc id"]),
                set_adi: pickMasterField(r, ["set_adi", "set adı", "set adi", "set", "setin adı", "setin adi"]),
                dosya_turu: pickMasterField(r, ["dosya_turu", "dosya türü", "dosya turu", "tür", "tur"]),
                klasor_adi: pickMasterField(r, ["klasor_adi", "klasör adı", "klasor adi", "klasör", "folder"]),
                dokuman_kodu: pickMasterField(r, ["dokuman_kodu", "doküman kodu", "dokuman kodu", "kod"]),
                dokuman_adi: pickMasterField(r, ["dokuman_adi", "doküman adı", "dokuman adi", "ad"]),
                dokuman_id: pickMasterField(r, ["dokuman_id", "doküman id", "dokuman id", "drive id", "file id"]),
              }))
              .filter((r) => r.id || r.set_adi || r.dosya_turu || r.klasor_adi || r.dokuman_kodu || r.dokuman_adi || r.dokuman_id);

            await env.DB_D1.prepare(`DELETE FROM sysdocs`).run();
            if (normalizedSysDocs.length) {
              const s = env.DB_D1.prepare(
                `INSERT OR REPLACE INTO sysdocs (id, set_adi, dosya_turu, klasor_adi, dokuman_kodu, dokuman_adi, dokuman_id, updated_at)
                 VALUES (?,?,?,?,?,?,?,unixepoch())`
              );
              await batchInsert(normalizedSysDocs.map(r => s.bind(
                parseInt(r.id) || null,
                r.set_adi || null, r.dosya_turu || null, r.klasor_adi || null,
                r.dokuman_kodu || null, r.dokuman_adi || null, r.dokuman_id || null
              )));
            }
          }

          stats.master = {};
          if (hasMasterType("standards")) stats.master.standards = normalizedStandards.length;
          if (hasMasterType("auditors")) stats.master.auditors = normalizedAuditorsList.length;
          if (hasMasterType("consultants")) stats.master.consultants = normalizedConsultants.length;
          if (hasMasterType("testdocs")) stats.master.testdocs = normalizedTestDocs.length;
          if (hasMasterType("sysdocs")) stats.master.sysdocs = normalizedSysDocs.length;
        }

        // sync_meta güncelle
        const syncMetaStmts = [
          env.DB_D1.prepare(`INSERT OR REPLACE INTO sync_meta (key, value, updated_at) VALUES ('last_sync', ?, unixepoch())`).bind(new Date().toISOString())
        ];
        if (hasScope("master")) {
          for (const t of masterTypes) {
            const meta = d.masterMeta?.[t] || { version: d.masterVersion || null, updatedAt: d.masterUpdatedAt || null };
            if (meta.version) syncMetaStmts.push(env.DB_D1.prepare(`INSERT OR REPLACE INTO sync_meta (key, value, updated_at) VALUES (?, ?, unixepoch())`).bind(`master_version_${t}`, String(meta.version)));
            if (meta.updatedAt) syncMetaStmts.push(env.DB_D1.prepare(`INSERT OR REPLACE INTO sync_meta (key, value, updated_at) VALUES (?, ?, unixepoch())`).bind(`master_updated_${t}`, String(meta.updatedAt)));
          }
        }
        await env.DB_D1.batch(syncMetaStmts);

        ctx.waitUntil(rebuildDashboardStats());
        return jsonResponse({ success: true, message: "Sync Completed", stats, scope, masterTypes });
      },
      exportData: async (params, ctx, env) => {
        const scope = Array.isArray(params?.scope) ? params.scope : ["companies", "certificates", "audits", "tests", "proformas", "master"];
        const validMasterTypes = ["standards", "auditors", "consultants", "testdocs", "sysdocs"];
        const requestedMasterTypes = Array.isArray(params?.masterTypes)
          ? params.masterTypes.map((type) => String(type || "").trim().toLowerCase()).filter((type) => validMasterTypes.includes(type))
          : [];
        const masterTypes = requestedMasterTypes.length ? requestedMasterTypes : validMasterTypes;
        const exportData = { version: "2.0", timestamp: new Date().toISOString(), scope, data: {} };
        const ps = [];
        if (scope.includes("companies")) ps.push(env.DB_D1.prepare(`SELECT * FROM companies`).all().then(r => { exportData.data.companies = r.results || []; }));
        if (scope.includes("certificates")) ps.push(env.DB_D1.prepare(`SELECT * FROM certificates`).all().then(r => { exportData.data.certificates = r.results || []; }));
        if (scope.includes("tests")) ps.push(env.DB_D1.prepare(`SELECT * FROM tests`).all().then(r => { exportData.data.tests = r.results || []; }));
        if (scope.includes("audits")) ps.push(env.DB_D1.prepare(`SELECT * FROM audits`).all().then(r => { exportData.data.audits = r.results || []; }));
        if (scope.includes("proformas")) ps.push(env.DB_D1.prepare(`SELECT * FROM proformas`).all().then(r => { exportData.data.proformas = r.results || []; }));
        if (scope.includes("master")) {
          exportData.masterTypes = masterTypes;
          if (masterTypes.includes("standards")) ps.push(env.DB_D1.prepare(`SELECT * FROM standards`).all().then(r => { exportData.data.standards = r.results || []; }));
          if (masterTypes.includes("auditors")) ps.push(env.DB_D1.prepare(`SELECT * FROM auditors`).all().then(r => { exportData.data.auditors = r.results || []; }));
          if (masterTypes.includes("consultants")) ps.push(env.DB_D1.prepare(`SELECT * FROM consultants`).all().then(r => { exportData.data.consultants = r.results || []; }));
          if (masterTypes.includes("testdocs")) ps.push(env.DB_D1.prepare(`SELECT * FROM testdocs`).all().then(r => { exportData.data.testdocs = r.results || []; }));
          if (masterTypes.includes("sysdocs")) ps.push(env.DB_D1.prepare(`SELECT * FROM sysdocs`).all().then(r => { exportData.data.sysdocs = r.results || []; }));
        }
        await Promise.all(ps);
        return jsonResponse({ success: true, exportData });
      },
      exportBackup: async (params, ctx, env) => {
        return SyncHandlers.exportData(
          { scope: ["companies", "certificates", "audits", "tests", "proformas", "master"] },
          ctx, env
        );
      },
      importBackup: async (params, ctx, env) => {
        const gasResult = await fetchFromGas(env, {
          action: "importBackup",
          params: { payload: params?.payload, options: params?.options }
        });
        if (!gasResult.success) return jsonResponse(gasResult);
        await SyncHandlers.bulkSync({}, ctx, env);
        return jsonResponse(gasResult);
      },
      importKvData: async (params, ctx, env) => {
        return jsonResponse({ success: false, error: "DEPRECATED: importKvData is superseded by bulkSync. Use bulkSync action instead." }, 410);
      },
      syncCheck: async (params, ctx, env) => {
        const d1Ok = !!env.DB_D1;
        const row = d1Ok ? await env.DB_D1.prepare(`SELECT value FROM sync_meta WHERE key='last_sync'`).first() : null;
        return jsonResponse({
          success: d1Ok,
          d1: d1Ok,
          lastSync: row?.value || null,
        });
      },
      rebuildStats: async (params, ctx, env) => {
        const result = await rebuildDashboardStats();
        return jsonResponse({ success: !!result, data: result });
      },
      kvDiagnostic: async (params, ctx, env) => {
        const [companies, certs, audits, tests, proformas, syncMeta] = await Promise.all([
          env.DB_D1.prepare(`SELECT COUNT(*) as cnt FROM companies`).first(),
          env.DB_D1.prepare(`SELECT COUNT(*) as cnt FROM certificates`).first(),
          env.DB_D1.prepare(`SELECT COUNT(*) as cnt FROM audits`).first(),
          env.DB_D1.prepare(`SELECT COUNT(*) as cnt FROM tests`).first(),
          env.DB_D1.prepare(`SELECT COUNT(*) as cnt FROM proformas`).first(),
          env.DB_D1.prepare(`SELECT value FROM sync_meta WHERE key='last_sync'`).first(),
        ]);
        return jsonResponse({
          success: true,
          diagnostic: {
            companies: companies?.cnt || 0,
            certificates: certs?.cnt || 0,
            audits: audits?.cnt || 0,
            tests: tests?.cnt || 0,
            proformas: proformas?.cnt || 0,
            lastSync: syncMeta?.value || null,
          }
        });
      },
      deepRepairIndex: async (params, ctx, env) => {
        const result = await rebuildDashboardStats();
        return jsonResponse({ success: !!result, data: result });
      },
      clearCache: async (p, ctx, env) => {
        let cursor = undefined;
        do {
          const page = await env.DB.list({ prefix: "cache:", cursor });
          if (page.keys.length) await Promise.all(page.keys.map(k => env.DB.delete(k.name)));
          cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor);
        return jsonResponse({ success: true, message: "Drive cache cleared" });
      }
    };


    const CompanyHandlers = {
      getCompanies: async (p, ctx, env) => {
        const { results } = await env.DB_D1.prepare(
          `SELECT co.id, co.nickname, co.unvan, co.city, co.ulke,
                  COALESCE(ce.kapsam, '') AS kapsam,
                  COALESCE(ce.scope,  '') AS scope
           FROM companies co
           LEFT JOIN certificates ce ON ce.id = (
             SELECT id FROM certificates
             WHERE firma_no = co.id
             ORDER BY id DESC LIMIT 1
           )
           ORDER BY co.nickname`
        ).all();
        return jsonResponse({ success: true, data: results || [] });
      },
      getCompanyById: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const row = await env.DB_D1.prepare(`SELECT * FROM companies WHERE id=?`).bind(parseInt(id)).first();
        return jsonResponse({ success: !!row, data: row || null });
      },
      addCompany: async (p, ctx, env) => {
        const gasResult = await fetchFromGas(env, { action: "addCompany", params: p });
        if (!gasResult.success) return jsonResponse(gasResult);
        const canonical = createCanonicalCompany(gasResult.data || p?.companyInfo || {});
        const newId = parseInt(gasResult.id || getCompanyId(canonical)) || null;
        if (newId) await upsertCompanyD1(canonical, newId);
        return jsonResponse(gasResult);
      },
      updateCompany: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const gasResult = await fetchFromGas(env, { action: "updateCompany", params: p });
        if (!gasResult.success) return jsonResponse(gasResult);
        const canonical = createCanonicalCompany(gasResult.data || p?.companyInfo || {}, { id });
        await upsertCompanyD1(canonical, parseInt(id));
        return jsonResponse(gasResult);
      }
    };

    const CertificateHandlers = {
      getDashboardSummary: async (p, ctx, env) => {
        const row = await env.DB_D1.prepare(`SELECT value FROM sync_meta WHERE key='dashboard_stats'`).first();
        const data = row?.value ? JSON.parse(row.value) : null;
        return jsonResponse({ success: !!data, data });
      },
      getCertificateSummaries: async (p, ctx, env) => {
        const { results } = await env.DB_D1.prepare(
          `SELECT c.id, c.firma_no, c.standart, c.sertifika_no, c.sertifika_tarihi,
                  c.gozetim_tarihi, c.gecerlilik_tarihi, c.durum, c.gozetim_confirmed,
                  c.consultant, co.nickname, co.city, co.ulke
           FROM certificates c LEFT JOIN companies co ON co.id = c.firma_no
           ORDER BY c.id DESC`
        ).all();
        return jsonResponse({ success: true, data: results || [] });
      },
      getCertificates: async (p, ctx, env) => {
        const { results } = await env.DB_D1.prepare(`SELECT c.*, co.nickname, co.city FROM certificates c LEFT JOIN companies co ON co.id = c.firma_no ORDER BY c.id DESC`).all();
        return jsonResponse({ success: true, data: results || [] });
      },
      getRecentCertificates: async (p, ctx, env) => {
        const limit = parseInt(p?.limit) || 25;
        const { results } = await env.DB_D1.prepare(
          `SELECT c.*, co.nickname, co.city FROM certificates c
           LEFT JOIN companies co ON co.id = c.firma_no
           ORDER BY c.id DESC LIMIT ?`
        ).bind(limit).all();
        return jsonResponse({ success: true, data: results || [] });
      },
      getCertificateById: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const row = await env.DB_D1.prepare(`SELECT * FROM certificates WHERE id=?`).bind(parseInt(id)).first();
        return jsonResponse({ success: !!row, data: row || null });
      },
      getCertificatesByFirmaId: async (p, ctx, env) => {
        const fId = String(p?.firmaId || "").trim();
        if (!fId) return jsonResponse({ success: false, error: "FIRMA_ID_REQUIRED" }, 400);
        const { results } = await env.DB_D1.prepare(`SELECT * FROM certificates WHERE firma_no=? ORDER BY id DESC`).bind(parseInt(fId)).all();
        return jsonResponse({ success: true, data: results || [] });
      },
      addCertificate: async (p, ctx, env) => {
        const gasResult = await fetchFromGas(env, { action: "addCertificate", params: p });
        if (!gasResult.success) return jsonResponse(gasResult);
        const canonical = createCanonicalCertificate(gasResult.data || p?.certInfo || {});
        const newId = parseInt(gasResult.id || getCertificateId(canonical)) || null;
        if (newId) {
          await upsertCertificateD1(canonical, newId);
          ctx.waitUntil(rebuildDashboardStats());
        }
        return jsonResponse(gasResult);
      },
      updateCertificate: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const gasResult = await fetchFromGas(env, { action: "updateCertificate", params: p });
        if (!gasResult.success) return jsonResponse(gasResult);
        const canonical = createCanonicalCertificate(gasResult.data || p?.certInfo || {}, { id });
        await upsertCertificateD1(canonical, parseInt(id));
        ctx.waitUntil(rebuildDashboardStats());
        return jsonResponse(gasResult);
      },
      deleteCertificate: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const gasResult = await fetchFromGas(env, { action: "deleteCertificate", params: p });
        if (!gasResult.success) return jsonResponse(gasResult);
        await env.DB_D1.prepare(`DELETE FROM certificates WHERE id=?`).bind(parseInt(id)).run();
        ctx.waitUntil(rebuildDashboardStats());
        return jsonResponse(gasResult);
      },
      updateSurveillance: async (p, ctx, env) => {
        const ids = Array.isArray(p?.ids) ? p.ids : [];
        const status = p?.status === true || p?.status === "TRUE" ? "TRUE" : "FALSE";
        const confirmed = status === "TRUE" ? 1 : 0;
        const gasResult = await fetchFromGas(env, { action: "updateSurveillance", params: p });
        if (!gasResult.success) return jsonResponse(gasResult);
        if (ids.length) {
          const placeholders = ids.map(() => "?").join(",");
          await env.DB_D1.prepare(
            `UPDATE certificates SET gozetim_confirmed=?, updated_at=unixepoch() WHERE id IN (${placeholders})`
          ).bind(confirmed, ...ids.map(i => parseInt(i))).run();
        }
        ctx.waitUntil(rebuildDashboardStats());
        return jsonResponse({ success: true, updatedCount: ids.length });
      }
    };


    const EntityHandlers = {
      getTestsByFirmaId: async (p, ctx, env) => {
        const id = String(p?.firmaId || "").trim();
        const { results } = await env.DB_D1.prepare(`SELECT * FROM tests WHERE firma_no=? ORDER BY id DESC`).bind(parseInt(id)).all();
        return jsonResponse({ success: true, data: results || [] });
      },
      getAudits: async (p, ctx, env) => {
        const { results } = await env.DB_D1.prepare(
          `SELECT a.*, co.nickname, co.unvan FROM audits a
           LEFT JOIN companies co ON co.id = a.firma_no
           ORDER BY COALESCE(a.a1_baslangic, a.a2_baslangic) DESC`
        ).all();
        return jsonResponse({ success: true, data: results || [] });
      },
      getTests: async (p, ctx, env) => {
        const { results } = await env.DB_D1.prepare(`SELECT * FROM tests ORDER BY id DESC`).all();
        return jsonResponse({ success: true, data: results || [] });
      },
      getAuditsByFirmaId: async (p, ctx, env) => {
        const id = String(p?.firmaId || "").trim();
        const { results } = await env.DB_D1.prepare(`SELECT * FROM audits WHERE firma_no=? ORDER BY id DESC`).bind(parseInt(id)).all();
        return jsonResponse({ success: true, data: results || [] });
      },
      getProformasByFirmaId: async (p, ctx, env) => {
        const id = String(p?.firmaId || "").trim();
        const { results } = await env.DB_D1.prepare(`SELECT * FROM proformas WHERE firma_no=? ORDER BY id DESC`).bind(parseInt(id)).all();
        return jsonResponse({ success: true, data: results || [] });
      },
      getProformaById: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        const row = await env.DB_D1.prepare(`SELECT * FROM proformas WHERE id=?`).bind(parseInt(id)).first();
        return jsonResponse({ success: !!row, data: row || null });
      },
      getAuditById: async (p, ctx, env) => {
        const id = String(p?.id || p?.auditId || "").trim();
        const row = await env.DB_D1.prepare(`SELECT * FROM audits WHERE id=?`).bind(parseInt(id)).first();
        return jsonResponse({ success: !!row, data: row || null });
      },
      buildCertPayload: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        try {
          const payload = await buildCertificatePayloadFromD1(id, p?.lang, p?.select);
          return jsonResponse({ success: true, data: payload, source: "d1" });
        } catch (e) {
          return jsonResponse({ success: false, data: null, error: `Sertifika payload üretilemedi (${id}): ${e.message}` }, 500);
        }
      },
      buildTestPayload: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        try {
          const payload = await buildTestPayloadFromD1(id, p?.lang);
          return jsonResponse({ success: true, data: payload });
        } catch (e) {
          return jsonResponse({ success: false, error: e.message }, 500);
        }
      },
      buildProformaPayload: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        try {
          const payload = await buildProformaPayloadFromD1(id);
          return jsonResponse({ success: true, data: payload });
        } catch (e) {
          return jsonResponse({ success: false, error: e.message }, 500);
        }
      },
      generateProforma: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        try {
          const payload = await buildProformaPayloadFromD1(id);
          const gasResult = await fetchFromGas(env, { action: "generateProforma", params: { proforma: payload } });
          return jsonResponse(gasResult);
        } catch (e) {
          return jsonResponse({ success: false, error: e.message }, 500);
        }
      },
      generateContract: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        try {
          const gasResult = await fetchFromGas(env, { action: "generateContract", params: p });
          return jsonResponse(gasResult);
        } catch (e) {
          return jsonResponse({ success: false, error: e.message }, 500);
        }
      },
      addTest: async (p, ctx, env) => {
        const gasResult = await fetchFromGas(env, { action: "addTest", params: p });
        if (!gasResult.success) return jsonResponse(gasResult);
        const canonical = createCanonicalTestRow(gasResult.data || p?.testInfo || {});
        const newId = parseInt(gasResult.id || getTestId(canonical)) || null;
        if (newId) await upsertTestD1(canonical, newId);
        return jsonResponse(gasResult);
      },
      updateTest: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const gasResult = await fetchFromGas(env, { action: "updateTest", params: p });
        if (!gasResult.success) return jsonResponse(gasResult);
        const canonical = createCanonicalTestRow(gasResult.data || p?.testInfo || {}, { id });
        await upsertTestD1(canonical, parseInt(id));
        return jsonResponse(gasResult);
      },
      addProforma: async (p, ctx, env) => {
        const gasResult = await fetchFromGas(env, { action: "addProforma", params: p });
        if (!gasResult.success) return jsonResponse(gasResult);
        const canonical = createCanonicalProformaRow(gasResult.data || p?.proInfo || {});
        const newId = parseInt(gasResult.id || getProformaId(canonical)) || null;
        if (newId) await upsertProformaD1(canonical, newId);
        return jsonResponse(gasResult);
      },
      updateProforma: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const gasResult = await fetchFromGas(env, { action: "updateProforma", params: p });
        if (!gasResult.success) return jsonResponse(gasResult);
        const canonical = createCanonicalProformaRow(gasResult.data || p?.proInfo || {}, { id });
        await upsertProformaD1(canonical, parseInt(id));
        return jsonResponse(gasResult);
      },
      scheduleAudit: async (p, ctx, env) => {
        const gasResult = await fetchFromGas(env, { action: "scheduleAudit", params: p });
        if (!gasResult.success) return jsonResponse(gasResult);
        const canonical = createCanonicalAuditRow(gasResult.data || p?.data || {});
        const newId = parseInt(gasResult.id || getAuditId(canonical)) || null;
        if (newId) await upsertAuditD1(canonical, newId);
        return jsonResponse(gasResult);
      },
      updateAudit: async (p, ctx, env) => {
        const id = String(p?.id || p?.auditId || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const gasResult = await fetchFromGas(env, { action: "updateAudit", params: p });
        if (!gasResult.success) return jsonResponse(gasResult);
        const canonical = createCanonicalAuditRow(gasResult.data || p?.data || p?.auditInfo || {}, { id });
        await upsertAuditD1(canonical, parseInt(id));
        return jsonResponse(gasResult);
      },
      deleteTest: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const gasResult = await fetchFromGas(env, { action: "deleteTest", params: p });
        if (!gasResult.success) return jsonResponse(gasResult);
        await env.DB_D1.prepare(`DELETE FROM tests WHERE id=?`).bind(parseInt(id)).run();
        return jsonResponse(gasResult);
      },
      deleteProforma: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const gasResult = await fetchFromGas(env, { action: "deleteProforma", params: p });
        if (!gasResult.success) return jsonResponse(gasResult);
        await env.DB_D1.prepare(`DELETE FROM proformas WHERE id=?`).bind(parseInt(id)).run();
        return jsonResponse(gasResult);
      },
      updateCertificateField: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const gasResult = await fetchFromGas(env, { action: "updateCertificateField", params: p });
        if (!gasResult.success) return jsonResponse(gasResult);
        const canonical = createCanonicalCertificate(gasResult.data || p?.certInfo || {}, { id });
        await upsertCertificateD1(canonical, parseInt(id));
        ctx.waitUntil(rebuildDashboardStats());
        return jsonResponse(gasResult);
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
        const mimeTypes = Array.isArray(p?.mimeTypes) ? p.mimeTypes : undefined;
        const forceRefresh = Boolean(p?.refreshToken || p?.forceRefresh);
        const cacheKey = `cache:getRecentFiles:${stableStringify({ id })}`;
        if (!forceRefresh) {
          const cached = await env.DB.get(cacheKey);
          if (cached) return jsonResponse({ success: true, data: JSON.parse(cached), fromCache: true });
        }

        const res = await fetchFromGas(env, {
          action: "getRecentFiles",
          params: { id, mimeTypes, refreshToken: p?.refreshToken }
        });
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
        const { results } = await env.DB_D1.prepare(`SELECT * FROM consultants ORDER BY ad`).all();
        return jsonResponse({ success: true, data: results || [] });
      },
      getConsultantById: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        const row = await env.DB_D1.prepare(`SELECT * FROM consultants WHERE id=?`).bind(parseInt(id)).first();
        return jsonResponse({ success: !!row, data: row || null });
      },
      getAuditorById: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        const row = await env.DB_D1.prepare(`SELECT * FROM auditors WHERE id=?`).bind(parseInt(id)).first();
        return jsonResponse({ success: !!row, data: row || null });
      },
      getStandardById: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        const row = await env.DB_D1.prepare(`SELECT * FROM standards WHERE kod=?`).bind(id).first();
        return jsonResponse({ success: !!row, data: row || null });
      },
      getMasterData: async (p, ctx, env) => {
        const type = String(p?.type || "").trim().toLowerCase();
        const tableMap = { standards: "standards", auditors: "auditors", consultants: "consultants", testdocs: "testdocs", sysdocs: "sysdocs" };
        if (type && tableMap[type]) {
          const [{ results }, metaRow, metaUpdatedRow] = await Promise.all([
            env.DB_D1.prepare(`SELECT * FROM ${tableMap[type]}`).all(),
            env.DB_D1.prepare(`SELECT value FROM sync_meta WHERE key=?`).bind(`master_version_${type}`).first(),
            env.DB_D1.prepare(`SELECT value FROM sync_meta WHERE key=?`).bind(`master_updated_${type}`).first()
          ]);
          const rows = results || [];
          const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
          return jsonResponse({ success: true, data: {
            dataset: { headers, rows: rows.map(r => headers.map(h => r[h])), sheetName: type },
            version: metaRow?.value || null,
            updatedAt: metaUpdatedRow?.value || null
          }});
        }
        // Return all tables combined
        const [std, aud, con, td, sd] = await Promise.all([
          env.DB_D1.prepare(`SELECT * FROM standards`).all(),
          env.DB_D1.prepare(`SELECT * FROM auditors`).all(),
          env.DB_D1.prepare(`SELECT * FROM consultants`).all(),
          env.DB_D1.prepare(`SELECT * FROM testdocs`).all(),
          env.DB_D1.prepare(`SELECT * FROM sysdocs`).all(),
        ]);
        return jsonResponse({ success: true, data: {
          standards: std.results || [], auditors: aud.results || [],
          consultants: con.results || [], testdocs: td.results || [], sysdocs: sd.results || []
        }});
      },
      getAvailableSets: async (p, ctx, env) => {
        const { results } = await env.DB_D1.prepare(`SELECT DISTINCT set_adi FROM sysdocs WHERE set_adi IS NOT NULL ORDER BY set_adi`).all();
        return jsonResponse({ success: true, data: (results || []).map(r => r.set_adi) });
      },
      getSysDocsBySetName: async (p, ctx, env) => {
        const setName = String(p?.setName || "").trim();
        const { results } = await env.DB_D1.prepare(`SELECT * FROM sysdocs WHERE set_adi=? ORDER BY dokuman_kodu`).bind(setName).all();
        return jsonResponse({ success: true, data: results || [] });
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

        const gasResult = await fetchFromGas(env, { action: "updateMasterData", params });
        if (!gasResult.success) return jsonResponse(gasResult);

        // Synchronous D1 write-through: only refresh the updated type
        const fetchResult = await fetchFromGas(env, { action: "getMasterData", params: { type } });
        if (fetchResult.success && fetchResult.data?.dataset) {
          await upsertMasterTypeToD1(type, datasetRowsToObjects(fetchResult.data.dataset), env);
          const metaStmts = [];
          if (fetchResult.data.version) metaStmts.push(env.DB_D1.prepare(`INSERT OR REPLACE INTO sync_meta (key, value, updated_at) VALUES (?, ?, unixepoch())`).bind(`master_version_${type}`, String(fetchResult.data.version)));
          const updatedAt = fetchResult.data.updatedAt || new Date().toISOString();
          metaStmts.push(env.DB_D1.prepare(`INSERT OR REPLACE INTO sync_meta (key, value, updated_at) VALUES (?, ?, unixepoch())`).bind(`master_updated_${type}`, updatedAt));
          if (metaStmts.length) await env.DB_D1.batch(metaStmts);
        }

        return jsonResponse(gasResult);
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
        try {
          const gasResult = await fetchFromGas(env, body);
          return jsonResponse(gasResult, gasResult?.success === false ? 502 : 200);
        } catch (gasErr) {
          return jsonResponse({ success: false, error: "GAS_INVALID_RESPONSE", details: gasErr.message }, 502);
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
