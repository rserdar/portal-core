import { renderTenantSurveillanceEmail } from "../tenant/email-registry.js";

/**
 * 🛰️ Portal Worker Proxy (v7.0 - D1-Primary)
 *
 * Mimari Özeti:
 * - Source of Truth: Cloudflare D1 — tüm yazma işlemleri doğrudan D1'e gider.
 * - KV (env.DB): Yalnızca token/lock/Drive cache için; operasyonel veri yazılmaz.
 * - Write path: Worker → D1 (doğrudan); GAS yazma yolunda yer almaz.
 * - Backup path: ctx.waitUntil → GAS (Sheets backup, non-blocking).
 * - Read path: Worker → D1 SQL; GAS fallback uygulanmaz.
 * - Google Native (Drive/Calendar/Docs/Gmail): Doğrudan GAS, D1 bypass.
 *
 * Bindings:
 *   env.DB      — Cloudflare KV  (token/lock/Drive cache only)
 *   env.DB_D1   — Cloudflare D1  (source of truth)
 */

export default {
  async fetch(request, env, ctx) {
    const appName = String(env.APP_NAME || "Portal");
    const tenantId = String(env.TENANT_ID || "default");
    const workerLabel = String(env.WORKER_LABEL || "Portal Cloudflare Proxy");
    const configuredOrigins = String(env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const allowedOriginPatterns = [
      ...configuredOrigins.map((allowed) => new RegExp(`^${allowed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)),
      /^http:\/\/localhost(?::\d+)?$/,
      /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
    ];

    const origin = request.headers.get("Origin");
    const isAllowedOrigin = origin
      ? allowedOriginPatterns.some((pattern) => pattern.test(origin))
      : false;
    const resolvedOrigin = isAllowedOrigin
      ? origin
      : String(env.APP_ORIGIN || configuredOrigins[0] || "http://localhost:4321");

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
    const createCanonicalCertificate = (source, options = {}) => {
      const input = source && typeof source === "object" && !Array.isArray(source) ? source : {};
      const pick = getPicker(input, options.explicit || null);
      const id = String(options.id ?? getCertificateId(input) ?? "").trim();
      const nick = pick(["nick", "nickname", "Firma Adı", "isim"]);
      const firmaNo = pick(["firma_no", "firmaNo", "firmano", "Firma No"]);
      const standart = pick(["standart", "standard"]);
      const denetimTipi = pick(["denetim_tipi", "denetim", "Denetim Tipi"]);
      const sertifikaNo = pick(["sertifika_no", "sno", "sNo", "Sertifika No"]);
      const sertifikaTarihi = pick(["sertifika_tarihi", "gst", "sTarihi", "Sertifika Tarihi"]);
      const gozetimTarihi = pick(["gozetim_tarihi", "goz", "Gözetim Tarihi"]);
      const tescilTarihi = pick(["tescil_tarihi", "stt", "sTT", "Tescil Tarihi", "Son Tetkik Tarihi"]);
      const gecerlilikTarihi = pick(["gecerlilik_tarihi", "sgt", "sGT", "Sertifika Geçerlilik Tarihi"]);
      const kapsam = pick(["kapsam", "Kapsam"]);
      const scope = pick(["scope", "Scope"]);
      const akreditasyon = pick(["akreditasyon", "akrn"]);
      const akredite = pick(["akredite"]);
      const consultant = pick(["consultant", "danisman", "dan", "Danışman"]);
      const otherStandart = pick(["other_standart", "other", "Other Standard", "Diğer"]);
      const durum = pick(["durum", "Durum"]);
      const sertifikaNot = pick(["sertifika_not", "not", "Not"]);
      const gozetimConfirmed = pick(["gozetim_confirmed", "gozetimConfirmed", "Gözetim Conf.", "gozetim"]);
      const calendarId = pick(["calendar_id", "calendar", "eventId"]);
      const qr = pick(["qr", "QR Code"]);
      const certLink = pick(["cert_link", "certLink", "Cert Link"]);
      const logo = pick(["logo", "Logo"]);
      const nace = pick(["nace", "kod", "NACE"]);
      const ea = pick(["ea", "EA", "Ea"]);

      const canonical = {
        ...(id ? { id } : {}),
        nick,
        firma_no: firmaNo,
        standart,
        denetim_tipi: denetimTipi,
        sertifika_no: sertifikaNo,
        sertifika_tarihi: sertifikaTarihi,
        gozetim_tarihi: gozetimTarihi,
        tescil_tarihi: tescilTarihi,
        gecerlilik_tarihi: gecerlilikTarihi,
        kapsam,
        scope,
        akreditasyon,
        akredite,
        ea,
        consultant,
        other_standart: otherStandart,
        durum,
        sertifika_not: sertifikaNot,
        gozetim_confirmed: gozetimConfirmed,
        calendar_id: calendarId,
        qr,
        cert_link: certLink,
        logo,
        nace,
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
    const escapeHtml = (value) => String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
    const parseTRDate = (str) => {
      const m = String(str || "").trim().match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
      if (!m) return null;
      const parsed = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };
    const formatDateDots = (date) => {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
      const dd = `0${date.getDate()}`.slice(-2);
      const mm = `0${date.getMonth() + 1}`.slice(-2);
      const yyyy = date.getFullYear();
      return `${dd}.${mm}.${yyyy}`;
    };
    const isConfirmedFlag = (value) => {
      const normalized = String(value ?? "").trim().toLowerCase();
      return normalized === "true" || normalized === "1";
    };
    const buildSurveillanceEmailHtml = (payload) => renderTenantSurveillanceEmail(tenantId, {
      ...payload,
      brandName: appName,
    });
    const sendHtmlEmailViaGas = async (payload) => fetchFromGas(env, {
      action: "sendSurveillanceEmail",
      params: payload,
    });
    const getCompanyId = (record) => pickCompanyValue(record, ["id", "ID", "firmaNo", "FirmaNo", "Firma No"]);
    const createCanonicalCompany = (source, options = {}) => {
      const input = source && typeof source === "object" && !Array.isArray(source) ? source : {};
      const pick = getPicker(input, options.explicit || null);
      const id = String(options.id ?? getCompanyId(input) ?? "").trim();
      const nick = pick(["nickname", "nick", "Nick", "FirmaAdi", "Firma Adı"]);
      const unvan = pick(["unvan", "Unvan"]);
      const adres = pick(["adres", "Adres"]);
      const sehir = pick(["city", "sehir", "il"]);
      const ulke = pick(["ulke", "Ülke", "Ulke"], "TÜRKİYE");
      const yazisma = pick(["yazisma", "YazismaAdresi", "Yazışma Adresi", "Şube Adresi"]);
      const vergiD = pick(["vergi_dairesi", "vergiD"]);
      const vergiN = pick(["vergi_no", "vergiN"]);
      const tel = pick(["tel", "Tel", "Telefon"]);
      const faks = pick(["faks", "Faks"]);
      const www = pick(["www", "web", "İnternet", "Internet", "Web"]);
      const mail = pick(["mail", "Mail", "E-Posta"]);
      const yetA = pick(["yetkili_adi", "yetA"]);
      const yetU = pick(["yetkili_unvani", "yetU"]);
      const kyt = pick(["kyt"]);
      const irtA = pick(["irtibat_kisi", "irtA"]);
      const irtU = pick(["irtibat_unvani", "irtU"]);
      const irtN = pick(["irtibat_tel", "irtN"]);
      const irtM = pick(["irtibat_mail", "irtM"]);
      const yapis = pick(["yapilan_is", "yapis"]);
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
      const not = pick(["firma_not", "not"]);
      const sinif = pick(["sinif", "Firma Sınıfı", "Firma Sinifi"]);
      const dokuman = pick(["dokuman", "Dokuman", "Doküman"]);
      const teknik = pick(["teknik", "Teknik Dosya"]);
      const tkapsam = pick(["tkapsam", "Teknik Dosya Kapsamı", "Teknik Dosya Kaspamı"]);

      const canonical = {
        // ...(input || {}), // [DÜZELTME] Veri tekrarını önlemek için ham input spread'i kaldırıldı
        ...(id ? { id, ID: id } : {}),
        nickname: nick,
        unvan,
        adres,
        city: sehir,
        ulke,
        yazisma,
        vergi_dairesi: vergiD,
        vergi_no: vergiN,
        tel,
        faks,
        www,
        mail,
        yetkili_adi: yetA,
        yetkili_unvani: yetU,
        kyt,
        irtibat_kisi: irtA,
        irtibat_unvani: irtU,
        irtibat_tel: irtN,
        irtibat_mail: irtM,
        yapilan_is: yapis,
        tcs,
        ycs,
        ucs,
        yzcs,
        tascs,
        acs,
        alan,
        departman: dept,
        vardiya,
        logo,
        kase,
        firma_not: not,
        sinif,
        dokuman,
        teknik,
        tkapsam,
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
          totalCertificates: 0,
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
          const durumNorm = normalizeTR(c.durum || "AKTIF");
          
          const certDate = parseTRDate(c.sertifika_tarihi);
          const gozDate = parseTRDate(c.gozetim_tarihi);
          const gozNotConfirmed = c.gozetim_confirmed !== 1;
          const isActiveStatus = durumNorm !== "PASIF" && durumNorm !== "IPTAL";

          const isActive = isActiveStatus && certDate !== null && gozDate !== null &&
            certDate <= today && today <= gozDate &&
            gozNotConfirmed;
          if (isActive) stats.activeCertificates++;

          // Bekleyen gözetim
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
          if (firmaNoStr) {
            uniqueCompanies.add(firmaNoStr);
            entry.totalCompanies.add(firmaNoStr);
          }
          if (entry.nicknames.length < 15) entry.nicknames.push(c.nickname || "");

          charts.cityDensity[city] = (charts.cityDensity[city] || 0) + 1;
        });

        stats.totalCertificates = certificates.length;

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
      const input = source && typeof source === "object" ? source : {};
      const pick = getPicker(input, options.explicit || null);
      const id = String(options.id ?? pick(["id", "ID"]) ?? "").trim();
      return {
        id,
        firma_no: pick(["firma_no", "firmaNo", "firmano"]) ?? "",
        test_adi: pick(["test_adi", "testAdi"]) ?? "",
        marka: pick(["marka"]) ?? "",
        urun: pick(["urun"]) ?? "",
        urun_kodu: pick(["urun_kodu", "urunKodu"]) ?? "",
        urun_no: pick(["urun_no", "urunNo"]) ?? "",
        lot: pick(["lot"]) ?? "",
        urun_kabul: pick(["urun_kabul", "urunKabul"]) ?? "",
        kabul_saat: pick(["kabul_saat", "kabulSaat"]) ?? "",
        test_baslangic: pick(["test_baslangic", "testBaslangic"]) ?? "",
        test_bitis: pick(["test_bitis", "testBitis"]) ?? "",
        rapor_tarihi: pick(["rapor_tarihi", "raporTarihi"]) ?? "",
        rapor_no: pick(["rapor_no", "raporNo"]) ?? "",
        numune_sayisi: pick(["numune_sayisi", "numuneSayisi"]) ?? "",
        numune_ut: pick(["numune_ut", "numuneUT"]) ?? "",
        numune_skt: pick(["numune_skt", "numuneSKT"]) ?? "",
        urun_bilgi: pick(["urun_bilgi", "urunBilgi"]) ?? "",
        gorsel1: pick(["gorsel1"]) ?? "",
        gorsel2: pick(["gorsel2"]) ?? "",
        detay: pick(["detay"]) ?? "",
        gizle: pick(["gizle"]) === true || pick(["gizle"]) === "true" || pick(["gizle"]) === 1 ? 1 : 0,
      };
    };
    const getTestId = (t) => String(t?.id ?? t?.ID ?? "").trim();
    const getTestFirmaId = (t) => String(t?.firma_no ?? "").trim();
    const createTestBackupPayload = (source, options = {}) => {
      const canonical = createCanonicalTestRow(source, options);
      return {
        ...canonical,
        urun_kabul: formatIsoToDots(canonical.urun_kabul),
        test_baslangic: formatIsoToDots(canonical.test_baslangic),
        test_bitis: formatIsoToDots(canonical.test_bitis),
        rapor_tarihi: formatIsoToDots(canonical.rapor_tarihi),
        numune_ut: formatIsoToDots(canonical.numune_ut),
        numune_skt: formatIsoToDots(canonical.numune_skt)
      };
    };
    const createCanonicalProformaRow = (source, options = {}) => {
      const input = source && typeof source === "object" ? source : {};
      const pick = getPicker(input);
      const id = String(options.id ?? pick(["id", "ID"]) ?? "").trim();
      return {
        id,
        firma_no: pick(["firma_no", "firmano", "firmaNo"]),
        kdvsiz: pick(["kdvsiz"], "0"),
        kdv_oran: pick(["kdv_oran", "kdvOran", "kdvoran"], "20"),
        kdv: pick(["kdv"], "0"),
        toplam: pick(["toplam"], "0"),
        birim: pick(["birim"], "TL"),
        tarih: pick(["tarih"], ""),
        konu: pick(["konu"], ""),
      };
    };
    const getProformaId = (p) => String(p?.id ?? p?.ID ?? "").trim();
    const getProformaFirmaId = (p) => String(p?.firma_no ?? "").trim();
    const createProformaBackupPayload = (source, options = {}) => {
      const canonical = createCanonicalProformaRow(source, options);
      return {
        ...canonical,
        tarih: formatIsoToDots(canonical.tarih)
      };
    };
    const getAuditId = (a) => String(a?.id ?? a?.ID ?? "").trim();
    const getAuditFirmaId = (a) => String(a?.firma_no ?? a?.firmaNo ?? a?.firmano ?? "").trim();
    const formatIsoToDots = (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) return "";
      
      const result = (() => {
        // Zaten noktalıysa döndür
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) return raw;
        // ISO ise noktalıya çevir
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          const [year, month, day] = raw.split("-");
          return `${day}.${month}.${year}`;
        }
        // Diğer durumlar
        const parts = raw.split(/[-./ ]/);
        if (parts.length === 3) {
          if (parts[0].length === 4) return `${parts[2]}.${parts[1]}.${parts[0]}`;
          if (parts[2].length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}`;
        }
        return raw;
      })();
      
      // GÜNCEL ÇÖZÜM: Başına tek tırnak (') ekleyerek Sheets'in formatı bozmasını engelle.
      // Bu tırnak hücrede görünmez, sadece Sheets'e "bu bir metindir" der.
      return result ? "'" + result : "";
    };
    const createCanonicalAuditRow = (source, options = {}) => {
      const input = source && typeof source === "object" ? source : {};
      const pick = getPicker(input, options.explicit || null);
      const id = String(options.id ?? getAuditId(input) ?? "").trim();
      return {
        id,
        firma_no: pick(["firma_no", "firmaNo", "firmano"]) ?? "",
        sertifika_id: pick(["sertifika_id", "certId", "sertifikaId"]) ?? "",
        standart: pick(["standart"]) ?? "",
        denetim_tipi: pick(["denetim_tipi", "denetimTipi", "denetim"]) ?? "",
        a1_baslangic: pick(["a1_baslangic", "a1Basla", "a1Baslav2"]) ?? "",
        a1_bitis: pick(["a1_bitis", "a1Bitis", "a1Bitisv2"]) ?? "",
        a1_manday: pick(["a1_manday", "a1Md"]) ?? "",
        a1_bas_denetci: pick(["a1_bas_denetci", "a1La", "a1Lead"]) ?? "",
        a1_denetci_2: pick(["a1_denetci_2", "a1Fa", "a1Auditor"]) ?? "",
        a1_denetci_3: pick(["a1_denetci_3", "a1Sa"]) ?? "",
        a2_baslangic: pick(["a2_baslangic", "a2Basla", "a2Baslav2"]) ?? "",
        a2_bitis: pick(["a2_bitis", "a2Bitis", "a2Bitisv2"]) ?? "",
        a2_manday: pick(["a2_manday", "a2Md"]) ?? "",
        a2_bas_denetci: pick(["a2_bas_denetci", "a2La", "a2Lead"]) ?? "",
        a2_denetci_2: pick(["a2_denetci_2", "a2Fa", "a2Auditor"]) ?? "",
        a2_denetci_3: pick(["a2_denetci_3", "a2Sa"]) ?? "",
      };
    };
    const createAuditBackupPayload = (source, options = {}) => {
      const canonical = createCanonicalAuditRow(source, options);
      return {
        id: canonical.id,
        firma_no: canonical.firma_no,
        firmano: canonical.firma_no, // Alias for Sheets
        sertifika_id: canonical.sertifika_id,
        standart: canonical.standart,
        denetim_tipi: canonical.denetim_tipi,
        denetim: canonical.denetim_tipi, // Alias for Sheets
        
        // Stage 1 - All formatted to dots
        a1_baslangic: formatIsoToDots(canonical.a1_baslangic),
        a1_bitis: formatIsoToDots(canonical.a1_bitis),
        a1Basla: formatIsoToDots(canonical.a1_baslangic),
        a1Bitis: formatIsoToDots(canonical.a1_bitis),
        a1Baslav2: formatIsoToDots(canonical.a1_baslangic),
        a1Bitisv2: formatIsoToDots(canonical.a1_bitis),
        // Google Sheets'teki BÜYÜK HARF ve Türkçe karakterli başlıklar için tam eşleşme:
        "A1 BAŞLA": formatIsoToDots(canonical.a1_baslangic),
        "A1 BİTİŞ": formatIsoToDots(canonical.a1_bitis),
        "A1 BASLA": formatIsoToDots(canonical.a1_baslangic),
        "A1 BITIS": formatIsoToDots(canonical.a1_bitis),
        "A1 Basla": formatIsoToDots(canonical.a1_baslangic),
        "A1 Bitiş": formatIsoToDots(canonical.a1_bitis),
        "A1 Bitis": formatIsoToDots(canonical.a1_bitis),
        a1_manday: canonical.a1_manday,
        a1Md: canonical.a1_manday,
        a1_bas_denetci: canonical.a1_bas_denetci,
        a1La: canonical.a1_bas_denetci,
        a1_denetci_2: canonical.a1_denetci_2,
        a1Fa: canonical.a1_denetci_2,
        a1_denetci_3: canonical.a1_denetci_3,
        a1Sa: canonical.a1_denetci_3,

        // Stage 2 - All formatted to dots
        a2_baslangic: formatIsoToDots(canonical.a2_baslangic),
        a2_bitis: formatIsoToDots(canonical.a2_bitis),
        a2Basla: formatIsoToDots(canonical.a2_baslangic),
        a2Bitis: formatIsoToDots(canonical.a2_bitis),
        a2Baslav2: formatIsoToDots(canonical.a2_baslangic),
        a2Bitisv2: formatIsoToDots(canonical.a2_bitis),
        // Google Sheets'teki BÜYÜK HARF ve Türkçe karakterli başlıklar için tam eşleşme:
        "A2 BAŞLA": formatIsoToDots(canonical.a2_baslangic),
        "A2 BİTİŞ": formatIsoToDots(canonical.a2_bitis),
        "A2 BASLA": formatIsoToDots(canonical.a2_baslangic),
        "A2 BITIS": formatIsoToDots(canonical.a2_bitis),
        "A2 Basla": formatIsoToDots(canonical.a2_baslangic),
        "A2 Bitiş": formatIsoToDots(canonical.a2_bitis),
        "A2 Bitis": formatIsoToDots(canonical.a2_bitis),
        a2_manday: canonical.a2_manday,
        a2Md: canonical.a2_manday,
        a2_bas_denetci: canonical.a2_bas_denetci,
        a2La: canonical.a2_bas_denetci,
        a2_denetci_2: canonical.a2_denetci_2,
        a2Fa: canonical.a2_denetci_2,
        a2_denetci_3: canonical.a2_denetci_3,
        a2Sa: canonical.a2_denetci_3
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
        logo: cert.logo || company.logo,
        nace: cert.nace,
        ea: cert.ea || null,
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
        id, c.nickname || null, c.unvan || null, c.adres || null, c.city || null, c.ulke || null,
        c.yazisma || null, c.vergi_dairesi || null, c.vergi_no || null, c.tel || null, c.faks || null, c.www || null, c.mail || null,
        c.yetkili_adi || null, c.yetkili_unvani || null, c.kyt || null, c.irtibat_kisi || null, c.irtibat_unvani || null, c.irtibat_tel || null, c.irtibat_mail || null,
        c.yapilan_is || null, c.tcs || null, c.ycs || null, c.ucs || null, c.yzcs || null, c.tascs || null, c.acs || null,
        c.alan || null, c.departman || null, c.vardiya || null, c.logo || null, c.kase || null,
        c.dokuman || null, c.teknik || null, c.tkapsam || null, c.sinif || null, c.firma_not || null
      );
    };
    const _D1_CERT_SQL = `INSERT OR REPLACE INTO certificates
      (id,firma_no,standart,denetim_tipi,sertifika_no,sertifika_tarihi,gozetim_tarihi,tescil_tarihi,
       gecerlilik_tarihi,kapsam,scope,akreditasyon,akredite,ea,nace,consultant,other_standart,durum,
       sertifika_not,gozetim_confirmed,calendar_id,qr,cert_link,logo,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`;
    const upsertCertificateD1 = (c, idOverride) => {
      const id = idOverride || parseInt(getCertificateId(c)) || null;
      const tGozConf = c.gozetim_confirmed;
      return env.DB_D1.prepare(_D1_CERT_SQL).bind(
        id, parseInt(c.firma_no) || null, c.standart || null, c.denetim_tipi || null,
        c.sertifika_no || null, c.sertifika_tarihi || null, c.gozetim_tarihi || null, c.tescil_tarihi || null, c.gecerlilik_tarihi || null,
        c.kapsam || null, c.scope || null, c.akreditasyon || null, c.akredite || null, c.ea || null,
        c.nace || null, c.consultant || null, c.other_standart || null, c.durum || null, c.sertifika_not || null,
        tGozConf === "TRUE" || tGozConf === true || tGozConf === "1" ? 1 : 0,
        c.calendar_id || null, c.qr || null, c.cert_link || null, c.logo || null
      );
    };
    const _D1_TEST_SQL = `INSERT OR REPLACE INTO tests
      (id,firma_no,test_adi,marka,urun,urun_kodu,urun_no,lot,urun_kabul,kabul_saat,
       test_baslangic,test_bitis,rapor_tarihi,rapor_no,numune_sayisi,numune_ut,numune_skt,
       urun_bilgi,gorsel1,gorsel2,detay,gizle,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`;
    const upsertTestD1 = (t, idOverride) => {
      const id = idOverride || parseInt(getTestId(t)) || null;
      return env.DB_D1.prepare(_D1_TEST_SQL).bind(
        id, parseInt(getTestFirmaId(t)) || null, t.test_adi || null, t.marka || null, t.urun || null,
        t.urun_kodu || null, t.urun_no || null, t.lot || null, t.urun_kabul || null, t.kabul_saat || null,
        t.test_baslangic || null, t.test_bitis || null, t.rapor_tarihi || null, t.rapor_no || null,
        parseInt(t.numune_sayisi) || null, t.numune_ut || null, t.numune_skt || null,
        t.urun_bilgi || null, t.gorsel1 || null, t.gorsel2 || null, t.detay || null, t.gizle || 0
      );
    };
    const _D1_PROFORMA_SQL = `INSERT OR REPLACE INTO proformas
      (id,firma_no,kdvsiz,kdv_oran,kdv,toplam,birim,tarih,konu,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,unixepoch())`;
    const upsertProformaD1 = (p, idOverride) => {
      const id = idOverride || parseInt(getProformaId(p)) || null;
      return env.DB_D1.prepare(_D1_PROFORMA_SQL).bind(
        id, parseInt(getProformaFirmaId(p)) || null, parseFloat(p.kdvsiz) || null,
        parseInt(p.kdv_oran) || null, parseFloat(p.kdv) || null, parseFloat(p.toplam) || null,
        p.birim || null, p.tarih || null, p.konu || null
      );
    };
    const _D1_AUDIT_SQL = `INSERT OR REPLACE INTO audits
      (id,firma_no,sertifika_id,standart,denetim_tipi,
       a1_baslangic,a1_bitis,a1_manday,a1_bas_denetci,a1_denetci_2,a1_denetci_3,
       a2_baslangic,a2_bitis,a2_manday,a2_bas_denetci,a2_denetci_2,a2_denetci_3,
       updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`;
    const upsertAuditD1 = (a, idOverride) => {
      const id = idOverride || parseInt(getAuditId(a)) || null;
      return env.DB_D1.prepare(_D1_AUDIT_SQL).bind(
        id, parseInt(getAuditFirmaId(a)) || null, parseInt(a.sertifika_id) || null,
        a.standart || null, a.denetim_tipi || null,
        a.a1_baslangic || null, a.a1_bitis || null, parseFloat(a.a1_manday) || null, a.a1_bas_denetci || null, a.a1_denetci_2 || null, a.a1_denetci_3 || null,
        a.a2_baslangic || null, a.a2_bitis || null, parseFloat(a.a2_manday) || null, a.a2_bas_denetci || null, a.a2_denetci_2 || null, a.a2_denetci_3 || null
      );
    };


    const upsertMasterTypeToD1 = async (type, rows, env) => {
      const batchInsert = async (stmts) => {
        for (let i = 0; i < stmts.length; i += 100) await env.DB_D1.batch(stmts.slice(i, i + 100));
      };
      if (type === "standards") {
        const normalized = rows.map(r => ({
          kod: r.kod,
          kisaltma: r.kisaltma,
          tam_ad: r.tam_ad,
          tanim_tr: r.tanim_tr,
          tanim_en: r.tanim_en,
          tema_id_en: r.tema_id_en,
          tema_id_tr: r.tema_id_tr,
        })).filter(r => r.kod || r.kisaltma || r.tam_ad);
        if (normalized.length) {
          await env.DB_D1.prepare(`DELETE FROM standards`).run();
          const s = env.DB_D1.prepare(`INSERT OR REPLACE INTO standards (kod,kisaltma,tam_ad,tanim_tr,tanim_en,tema_id_en,tema_id_tr) VALUES (?,?,?,?,?,?,?)`);
          await batchInsert(normalized.map(r => s.bind(String(r.kod || ""), r.kisaltma || null, r.tam_ad || null, r.tanim_tr || null, r.tanim_en || null, r.tema_id_en || null, r.tema_id_tr || null)));
        }
      } else if (type === "auditors") {
        const isChecked = (val) => String(val).trim().toUpperCase() === "TRUE" || val === true || val === "true" || val === 1 || String(val) === '1';
        const normalizedAuditors = rows.map((r, idx) => ({
          id: parseInt(r.id) || idx + 1,
          ad: String(r.ad || "").trim(),
          soyad: String(r.soyad || "").trim(),
          imza: String(r.imza || "").trim(),
          std_9001: isChecked(r.std_9001) ? 1 : 0,
          std_13485: isChecked(r.std_13485) ? 1 : 0,
          std_14001: isChecked(r.std_14001) ? 1 : 0,
          std_22000: isChecked(r.std_22000) ? 1 : 0,
          std_27001: isChecked(r.std_27001) ? 1 : 0,
          std_45001: isChecked(r.std_45001) ? 1 : 0,
          std_50001: isChecked(r.std_50001) ? 1 : 0,
          std_gmp: isChecked(r.std_gmp) ? 1 : 0
        })).filter(a => a.ad || a.soyad);
        if (normalizedAuditors.length) {
          await env.DB_D1.prepare(`DELETE FROM auditors`).run();
          const a = env.DB_D1.prepare(`INSERT INTO auditors (id,ad,soyad,imza,std_9001,std_13485,std_14001,std_22000,std_27001,std_45001,std_50001,std_gmp,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`);
          await batchInsert(normalizedAuditors.map(r => a.bind(r.id, r.ad, r.soyad, r.imza, r.std_9001, r.std_13485, r.std_14001, r.std_22000, r.std_27001, r.std_45001, r.std_50001, r.std_gmp)));
        }
      } else if (type === "consultants") {
        const normalized = rows.map(r => ({
          id: r.id,
          ad: r.ad,
          adres: r.adres,
          tel: r.tel,
          mail: r.mail,
          yetkili_adi: r.yetkili_adi,
          yetkili_soyad: r.yetkili_soyad,
          hitabet: r.hitabet,
        })).filter(r => r.id || r.ad || r.adres || r.tel || r.mail);
        if (normalized.length) {
          await env.DB_D1.prepare(`DELETE FROM consultants`).run();
          const c = env.DB_D1.prepare(`INSERT OR REPLACE INTO consultants (id,ad,adres,tel,mail,yetkili_adi,yetkili_soyad,hitabet,updated_at) VALUES (?,?,?,?,?,?,?,?,unixepoch())`);
          await batchInsert(normalized.map(r => c.bind(parseInt(r.id) || null, r.ad || null, r.adres || null, r.tel || null, r.mail || null, r.yetkili_adi || null, r.yetkili_soyad || null, r.hitabet || null)));
        }
      } else if (type === "testdocs") {
        const normalized = rows.map(r => ({
          id: r.id,
          kategori: r.kategori,
          aciklama: r.aciklama,
          dokuman_adi: r.dokuman_adi,
          test_adi_tr: r.test_adi_tr,
          test_adi_en: r.test_adi_en,
          standart: r.standart,
          tema_tr: r.tema_tr,
          tema_en: r.tema_en,
          gun_sayisi: r.gun_sayisi,
          kisaltma: r.kisaltma,
          kisaltma2: r.kisaltma2,
          notlar: r.notlar,
        })).filter(r => r.id || r.kategori || r.test_adi_tr || r.standart);
        if (normalized.length) {
          await env.DB_D1.prepare(`DELETE FROM testdocs`).run();
          const t = env.DB_D1.prepare(`INSERT OR REPLACE INTO testdocs (id,kategori,aciklama,dokuman_adi,test_adi_tr,test_adi_en,standart,tema_tr,tema_en,gun_sayisi,kisaltma,kisaltma2,notlar,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`);
          await batchInsert(normalized.map(r => t.bind(parseInt(r.id) || null, r.kategori || null, r.aciklama || null, r.dokuman_adi || null, r.test_adi_tr || null, r.test_adi_en || null, r.standart || null, r.tema_tr || null, r.tema_en || null, parseInt(r.gun_sayisi) || null, r.kisaltma || null, r.kisaltma2 || null, r.notlar || null)));
        }
      } else if (type === "sysdocs") {
        const normalized = rows.map(r => ({
          id: r.id,
          set_adi: r.set_adi,
          dosya_turu: r.dosya_turu,
          klasor_adi: r.klasor_adi,
          dokuman_kodu: r.dokuman_kodu,
          dokuman_adi: r.dokuman_adi,
          dokuman_id: r.dokuman_id,
        })).filter(r => r.id || r.set_adi || r.dokuman_kodu || r.dokuman_adi);
        if (normalized.length) {
          await env.DB_D1.prepare(`DELETE FROM sysdocs`).run();
          const s = env.DB_D1.prepare(`INSERT OR REPLACE INTO sysdocs (id,set_adi,dosya_turu,klasor_adi,dokuman_kodu,dokuman_adi,dokuman_id,updated_at) VALUES (?,?,?,?,?,?,?,unixepoch())`);
          await batchInsert(normalized.map(r => s.bind(parseInt(r.id) || null, r.set_adi || null, r.dosya_turu || null, r.klasor_adi || null, r.dokuman_kodu || null, r.dokuman_adi || null, r.dokuman_id || null)));
        }
      }
    };

    const normalizeIntegrationConfig = (raw) => {
      const input = raw && typeof raw === "object" ? raw : {};
      return {
        id: Number.parseInt(String(input.id || ""), 10) || null,
        provider: String(input.provider || "").trim().toLowerCase(),
        service: String(input.service || "").trim().toLowerCase(),
        config_key: String(input.config_key || input.configKey || "").trim().toLowerCase(),
        config_value: input.config_value === undefined || input.config_value === null
          ? ""
          : String(input.config_value),
        tenant_scope: String(input.tenant_scope || input.tenantScope || "global").trim().toLowerCase() || "global",
      };
    };

    const isValidIntegrationToken = (value) => /^[a-z0-9_:-]+$/i.test(String(value || "").trim());
    const GOOGLE_FEATURE_FLAG_DEFAULTS = {
      "feature:google_dlc": true,
      "feature:google_drive_backup": true,
      "feature:google_calendar": true,
      "feature:google_gmail": true,
    };
    const GOOGLE_FEATURE_FLAG_KEYS = Object.keys(GOOGLE_FEATURE_FLAG_DEFAULTS);
    const parseBooleanFlag = (value, fallback = false) => {
      if (value === undefined || value === null || String(value).trim() === "") return fallback;
      const normalized = String(value).trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(normalized)) return true;
      if (["0", "false", "no", "off"].includes(normalized)) return false;
      return fallback;
    };
    const getSyncMetaValue = async (key) => {
      const row = await env.DB_D1.prepare(`SELECT value FROM sync_meta WHERE key=?`).bind(key).first();
      return row?.value ?? null;
    };
    const getGoogleFeatureFlags = async () => {
      const rows = await env.DB_D1.prepare(
        `SELECT key, value FROM sync_meta WHERE key IN (${GOOGLE_FEATURE_FLAG_KEYS.map(() => "?").join(",")})`
      ).bind(...GOOGLE_FEATURE_FLAG_KEYS).all();
      const valueMap = new Map((rows.results || []).map((row) => [String(row.key), row.value]));
      const flags = {};
      for (const [key, fallback] of Object.entries(GOOGLE_FEATURE_FLAG_DEFAULTS)) {
        flags[key] = parseBooleanFlag(valueMap.get(key), fallback);
      }
      return flags;
    };
    const getGoogleRuntimeConfig = async () => {
      const { results } = await env.DB_D1.prepare(
        `SELECT service, config_key, config_value, tenant_scope
         FROM integration_configs
         WHERE provider = 'google'
         ORDER BY service, config_key, tenant_scope, id`
      ).all();
      const runtimeConfig = {};
      for (const row of results || []) {
        const service = String(row.service || "").trim().toLowerCase();
        const configKey = String(row.config_key || "").trim().toLowerCase();
        const tenantScope = String(row.tenant_scope || "global").trim().toLowerCase() || "global";
        if (!service || !configKey || tenantScope !== "global") continue;
        if (!runtimeConfig[service]) runtimeConfig[service] = {};
        runtimeConfig[service][configKey] = row.config_value == null ? "" : String(row.config_value);
      }
      return runtimeConfig;
    };
    const buildGasRuntimeParams = async (params) => {
      const safeParams = params && typeof params === "object" ? { ...params } : {};
      const [googleConfig, featureFlags] = await Promise.all([
        getGoogleRuntimeConfig(),
        getGoogleFeatureFlags(),
      ]);
      safeParams.googleConfig = googleConfig;
      safeParams.featureFlags = featureFlags;
      return safeParams;
    };
    const isGoogleFeatureEnabled = async (featureKey) => {
      const flags = await getGoogleFeatureFlags();
      const masterEnabled = Boolean(flags["feature:google_dlc"]);
      if (featureKey === "feature:google_dlc") return masterEnabled;
      return masterEnabled && Boolean(flags[featureKey]);
    };
    const buildGoogleFeatureSkipResponse = (featureKey, message, extra = {}) => ({
      success: true,
      skipped: true,
      feature: featureKey,
      message,
      ...extra,
    });

    const fetchFromGasViaGet = async (env, body) => {
      if (body?.action !== "translate") return null;

      const url = new URL(env.GAS_API_URL);
      url.searchParams.set("action", "translate");
      url.searchParams.set("apiKey", String(env.API_KEY || ""));
      url.searchParams.set("text", String(body?.params?.text || ""));
      url.searchParams.set("toEn", body?.params?.toEn ? "true" : "false");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 seconds timeout

      try {
        const res = await fetch(url.toString(), { method: "GET", signal: controller.signal });
        clearTimeout(timeoutId);

        const text = await res.text();
        if (!res.ok || !text.trimStart().startsWith('{')) {
          const code = res.status;
          if (code === 524 || text.includes('524')) throw new Error('GAS_TIMEOUT_524: Google Apps Script yanıt vermedi (süre aşımı). Daha küçük bir kapsam seçin veya GAS scriptini optimize edin.');
          throw new Error(`GAS_HTTP_ERROR: ${code} — ${text.slice(0, 200)}`);
        }
        return JSON.parse(text);
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          return { success: false, error: "GAS_TIMEOUT" };
        }
        throw err;
      }
    };

    const generateSqlDump = async (env, requestedTables) => {
      const tables = Array.isArray(requestedTables) ? requestedTables : ["companies", "certificates", "audits", "tests", "proformas", "standards", "auditors", "consultants", "testdocs", "sysdocs", "integration_configs"];
      let sql = `-- ${appName} D1 SQL Export\n`;
      sql += `-- Generated: ${new Date().toISOString()}\n\n`;

      for (const table of tables) {
        let results;
        try {
          const res = await env.DB_D1.prepare(`SELECT * FROM ${table}`).all();
          results = res.results;
        } catch (e) {
          sql += `-- Error fetching table ${table}: ${e.message}\n`;
          continue;
        }

        if (!results || results.length === 0) continue;

        sql += `-- Table: ${table} (${results.length} rows)\n`;
        const columns = Object.keys(results[0]);

        for (const row of results) {
          const values = columns.map(col => {
            const val = row[col];
            if (val === null || val === undefined) return "NULL";
            if (typeof val === "number") return val;
            if (typeof val === "string") return `'${val.replace(/'/g, "''")}'`;
            return `'${String(val).replace(/'/g, "''")}'`;
          });
          sql += `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")});\n`;
        }
        sql += "\n";
      }
      return sql;
    };

    const fetchFromGas = async (env, body) => {
      const action = body?.action || "";
      const longRunningActions = new Set([
        "bulkSync", "smartSync", "importBackup", "exportBackup", "translate",
        "generateIso", "generateDraftCertificate", "generateContract",
        "generateAppForm", "generateSingleBatchDoc", "generateTestReport",
        "convertToPdf", "uploadFile", "deepRepairIndex", "generateProforma", "getFolderId",
        "suggestCertificateClassification",
        "getRecentFiles", "listDriveContents"
      ]);
      const timeoutMs = longRunningActions.has(action) ? 120000 : 20000;
      const enrichedBody = { ...body };
      enrichedBody.params = await buildGasRuntimeParams(body?.params);
      const requestBody = JSON.stringify({ ...enrichedBody, apiKey: env.API_KEY });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(env.GAS_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

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
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          return { success: false, error: "GAS_TIMEOUT" };
        }
        throw err;
      }
    };

    const logSyncEvent = async (action, entityType, entityId, status, errorMessage = null) => {
      try {
        await env.DB_D1.prepare(
          `INSERT INTO sync_log (action, entity_type, entity_id, status, error_message, created_at)
           VALUES (?, ?, ?, ?, ?, unixepoch())`
        ).bind(action, entityType, entityId || null, status, errorMessage || null).run();
      } catch (logError) {
        console.error("[sync_log] write failed:", logError?.message || logError);
      }
    };

    const BULK_SYNC_ROW_LIMIT = 500;

    const getClientIp = (request) => {
      const forwarded = request.headers.get("CF-Connecting-IP")
        || request.headers.get("X-Forwarded-For")
        || "";
      return String(forwarded).split(",")[0].trim() || "unknown";
    };

    const checkOptimisticLock = async (table, id, expectedUpdatedAt) => {
      if (expectedUpdatedAt === undefined || expectedUpdatedAt === null || String(expectedUpdatedAt).trim() === "") {
        return { ok: true };
      }

      const row = await env.DB_D1.prepare(`SELECT updated_at FROM ${table} WHERE id=?`).bind(parseInt(id)).first();
      if (!row) {
        return { ok: false, response: jsonResponse({ success: false, error: "NOT_FOUND" }, 404) };
      }

      if (String(row.updated_at ?? "") !== String(expectedUpdatedAt)) {
        return {
          ok: false,
          response: jsonResponse({
            success: false,
            error: "CONFLICT",
            message: "Kayıt başkası tarafından değiştirildi.",
            current_updated_at: row.updated_at ?? null,
          }, 409)
        };
      }

      return { ok: true, row };
    };

    const countBulkSyncRows = (payload, hasScope, hasMasterType) => {
      let total = 0;
      if (hasScope("companies")) total += Array.isArray(payload.companies) ? payload.companies.length : 0;
      if (hasScope("certificates")) {
        total += Array.isArray(payload.certificates) ? payload.certificates.length : 0;
        total += Array.isArray(payload.certificateRows) ? payload.certificateRows.length : 0;
        total += Array.isArray(payload.certs) ? payload.certs.length : 0;
        total += Array.isArray(payload.certRows) ? payload.certRows.length : 0;
      }
      if (hasScope("audits")) {
        total += Array.isArray(payload.audits) ? payload.audits.length : 0;
        total += Array.isArray(payload.auditObjects) ? payload.auditObjects.length : 0;
      }
      if (hasScope("tests")) total += Array.isArray(payload.tests) ? payload.tests.length : 0;
      if (hasScope("proformas")) total += Array.isArray(payload.proformas) ? payload.proformas.length : 0;
      if (hasMasterType("standards")) total += Array.isArray(payload.standards) ? payload.standards.length : 0;
      if (hasMasterType("auditors")) total += Array.isArray(payload.auditors) ? payload.auditors.length : 0;
      if (hasMasterType("consultants")) total += Array.isArray(payload.consultants) ? payload.consultants.length : 0;
      if (hasMasterType("testdocs")) total += Array.isArray(payload.testdocs) ? payload.testdocs.length : 0;
      if (hasMasterType("sysdocs")) total += Array.isArray(payload.sysdocs) ? payload.sysdocs.length : 0;
      return total;
    };

    const buildRetryPayloadForLog = async (logRow) => {
      const action = String(logRow?.action || "").trim();
      const entityType = String(logRow?.entity_type || "").trim();
      const entityId = String(logRow?.entity_id || "").trim();
      const numericId = parseInt(entityId, 10);

      if (action === "cronBackup") {
        return { kind: "direct", body: { action: "runDailyBackup", params: {} } };
      }

      if (["deleteCompany", "deleteCertificate", "deleteAudit", "deleteTest", "deleteProforma"].includes(action)) {
        if (!entityId) throw new Error("DELETE_RETRY_ID_REQUIRED");
        return { kind: "sync", action, params: { id: entityId } };
      }

      if (!Number.isInteger(numericId)) {
        throw new Error("RETRY_ENTITY_ID_INVALID");
      }

      if (entityType === "companies") {
        const row = await env.DB_D1.prepare(`SELECT * FROM companies WHERE id=?`).bind(numericId).first();
        if (!row) throw new Error("RETRY_SOURCE_NOT_FOUND");
        return {
          kind: "sync",
          action,
          params: { id: numericId, companyInfo: createCanonicalCompany(row, { id: numericId }) }
        };
      }

      if (entityType === "certificates") {
        if (action === "updateSurveillance") throw new Error("RETRY_ACTION_UNSUPPORTED");
        if (action === "updateCertificateField") throw new Error("RETRY_ACTION_UNSUPPORTED");
        const row = await env.DB_D1.prepare(`SELECT * FROM certificates WHERE id=?`).bind(numericId).first();
        if (!row) throw new Error("RETRY_SOURCE_NOT_FOUND");
        return {
          kind: "sync",
          action,
          params: { id: numericId, certInfo: createCanonicalCertificate(row, { id: numericId }) }
        };
      }

      if (entityType === "tests") {
        const row = await env.DB_D1.prepare(`SELECT * FROM tests WHERE id=?`).bind(numericId).first();
        if (!row) throw new Error("RETRY_SOURCE_NOT_FOUND");
        return {
          kind: "sync",
          action,
          params: { id: numericId, testInfo: createTestBackupPayload(row, { id: numericId }) }
        };
      }

      if (entityType === "proformas") {
        const row = await env.DB_D1.prepare(`SELECT * FROM proformas WHERE id=?`).bind(numericId).first();
        if (!row) throw new Error("RETRY_SOURCE_NOT_FOUND");
        return {
          kind: "sync",
          action,
          params: { id: numericId, proInfo: createProformaBackupPayload(row, { id: numericId }) }
        };
      }

      if (entityType === "audits") {
        const row = await env.DB_D1.prepare(`SELECT * FROM audits WHERE id=?`).bind(numericId).first();
        if (!row) throw new Error("RETRY_SOURCE_NOT_FOUND");
        return {
          kind: "sync",
          action,
          params: { id: numericId, data: createAuditBackupPayload(row, { id: numericId }) }
        };
      }

      throw new Error("RETRY_ENTITY_UNSUPPORTED");
    };

    const syncToBackup = (action, params, type, id) => {
      ctx.waitUntil((async () => {
        try {
          const googleDlcEnabled = await isGoogleFeatureEnabled("feature:google_dlc");
          if (!googleDlcEnabled) {
            return;
          }
          const res = await fetchFromGas(env, { action, params });
          if (!res.success) {
            await logSyncEvent(action, type, id, "FAIL", res.error || "GAS_FAIL");
          }
        } catch (e) {
          await logSyncEvent(action, type, id, "CRASH", e.message);
        }
      })());
      };

      const NotificationHandlers = {
        sendSurveillanceEmail: async (p, ctx, env) => {
          const gmailEnabled = await isGoogleFeatureEnabled("feature:google_gmail");
          if (!gmailEnabled) {
            return jsonResponse(buildGoogleFeatureSkipResponse(
              "feature:google_gmail",
              "Google Gmail DLC kapalı olduğu için e-posta gönderimi atlandı."
            ));
          }
          const rows = Array.isArray(p?.data) ? p.data : Array.isArray(p?.rows) ? p.rows : [];
          const email = String(p?.email || "").trim();
          if (!email) return jsonResponse({ success: false, error: "EMAIL_REQUIRED" }, 400);

          const htmlBody = p?.htmlBody || buildSurveillanceEmailHtml({
            firstName: p?.firstName || "",
            title: p?.title || "",
            rows,
            startDate: p?.startDate || "",
            endDate: p?.endDate || "",
          });

          const gasResult = await sendHtmlEmailViaGas({
            email,
            subject: p?.subject || "Gozetim Bilgileri",
            htmlBody,
            from: p?.from,
            fromName: p?.fromName,
            firstName: p?.firstName || "",
            title: p?.title || "",
          });
          return jsonResponse(gasResult, gasResult?.success === false ? 502 : 200);
        },
        runMonthlyCheck: async (p, ctx, env) => {
          const gmailEnabled = await isGoogleFeatureEnabled("feature:google_gmail");
          if (!gmailEnabled) {
            return jsonResponse(buildGoogleFeatureSkipResponse(
              "feature:google_gmail",
              "Google Gmail DLC kapalı olduğu için aylık gözetim kontrolü atlandı.",
              { data: { sent: 0, matchedRows: 0, recipients: 0, skipped: 0, failures: [] } }
            ));
          }
          const today = new Date();
          const firstDayCurrentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
          const startDate = new Date(firstDayCurrentMonth);
          startDate.setMonth(startDate.getMonth() - 1);
          const endDate = new Date(firstDayCurrentMonth);
          endDate.setMonth(endDate.getMonth() + 2);

          const [{ results: consultantRows }, { results: certificateRows }] = await Promise.all([
            env.DB_D1.prepare(`
              SELECT ad, mail, yetkili_adi, yetkili_soyad, hitabet
              FROM consultants
              ORDER BY ad
            `).all(),
            env.DB_D1.prepare(`
              SELECT c.nickname, c.unvan, ce.consultant, ce.standart, ce.other_standart,
                     ce.sertifika_no, ce.akreditasyon, ce.gozetim_tarihi, ce.gozetim_confirmed
              FROM certificates_full ce
              JOIN companies c ON c.id = ce.firma_no
            `).all(),
          ]);

          const recipientsByConsultant = {};
          for (const consultant of consultantRows || []) {
            const key = String(consultant.ad || "").trim();
            if (!key) continue;
            const firstName = String(consultant.yetkili_adi || "").trim();
            const lastName = String(consultant.yetkili_soyad || "").trim();
            recipientsByConsultant[key] = {
              firstName,
              fullName: `${firstName} ${lastName}`.trim(),
              title: String(consultant.hitabet || "").trim(),
              email: String(consultant.mail || "").trim(),
              rows: [],
            };
          }

          let matchedRows = 0;
          for (const certificate of certificateRows || []) {
            const consultantKey = String(certificate.consultant || "").trim();
            const recipient = recipientsByConsultant[consultantKey];
            if (!recipient) continue;

            const surveillanceDate = parseTRDate(certificate.gozetim_tarihi);
            if (!surveillanceDate) continue;
            if (!(surveillanceDate >= startDate && surveillanceDate < endDate)) continue;
            if (isConfirmedFlag(certificate.gozetim_confirmed)) continue;

            recipient.rows.push({
              date: formatDateDots(surveillanceDate),
              firm: String(certificate.nickname || certificate.unvan || "").trim(),
              consultant: recipient.fullName || consultantKey,
              standard: String(certificate.standart || "").trim() === "Other"
                ? String(certificate.other_standart || "").trim()
                : String(certificate.standart || "").trim(),
              certificateNo: String(certificate.sertifika_no || "").trim(),
              accreditation: String(certificate.akreditasyon || "").trim(),
            });
            matchedRows += 1;
          }

          const recipients = Object.values(recipientsByConsultant).filter((entry) => entry.email && entry.rows.length > 0);
          let sent = 0;
          const failures = [];

          for (const recipient of recipients) {
            const htmlBody = buildSurveillanceEmailHtml({
              firstName: recipient.firstName,
              title: recipient.title,
              rows: recipient.rows,
              startDate: formatDateDots(startDate),
              endDate: formatDateDots(endDate),
            });
            const result = await sendHtmlEmailViaGas({
              email: recipient.email,
              subject: "Gozetim Bilgileri",
              htmlBody,
              firstName: recipient.firstName,
              title: recipient.title,
            });
            if (result?.success) {
              sent += 1;
            } else {
              failures.push({
                email: recipient.email,
                error: result?.error || "SEND_FAILED",
              });
            }
          }

          return jsonResponse({
            success: failures.length === 0,
            data: {
              sent,
              matchedRows,
              recipients: recipients.length,
              skipped: Math.max(0, recipients.length - sent),
              failures,
            },
            error: failures.length ? "PARTIAL_SEND_FAILURE" : null,
          }, failures.length ? 502 : 200);
        },
      };

      const SyncHandlers = {
      bulkSync: async (params, ctx, env) => {
        if (!env.DB_D1) return jsonResponse({ success: false, error: "NO_D1_BINDING" }, 500);
        const scope = Array.isArray(params?.scope) ? params.scope : ["companies", "certificates", "audits", "tests", "proformas", "master"];
        const hasScope = (s) => scope.includes(s);
        // companies DELETE yalnızca tüm FK-child tablolar da scope'taysa güvenli
        const canDeleteCompanies = hasScope("companies") &&
          hasScope("certificates") && hasScope("audits") &&
          hasScope("tests") && hasScope("proformas");
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

        const incomingRowCount = countBulkSyncRows(d, hasScope, hasMasterType);
        if (incomingRowCount > BULK_SYNC_ROW_LIMIT && !params?.forceLargeSync) {
          return jsonResponse({
            success: false,
            error: "BULK_SYNC_CONFIRMATION_REQUIRED",
            message: `Bu işlem ${incomingRowCount} satır yazacak. İkinci onay gerekiyor.`,
            rowCount: incomingRowCount,
            limit: BULK_SYNC_ROW_LIMIT,
          }, 400);
        }

        // === D1 YAZMA ===
        const stats = {};

        // D1 batch helper: 100'erli chunk'larda gönder
        const batchInsert = async (stmts) => {
          for (let i = 0; i < stmts.length; i += 100) {
            await env.DB_D1.batch(stmts.slice(i, i + 100));
          }
        };

        // === MASS DELETION PROTECTION (tüm tablolar için COUNT kontrolleri) ===
        if (hasScope("companies")) {
          const _cc = await env.DB_D1.prepare('SELECT COUNT(*) as cnt FROM companies').all();
          const _companies = Array.isArray(d.companies) ? d.companies : [];
          const _canonicalCount = _companies.map(c => createCanonicalCompany(c)).filter(c => getCompanyId(c)).length;
          const _cur = _cc.results[0]?.cnt ?? 0;
          if (_cur > 10 && _canonicalCount < _cur * 0.2) {
            return jsonResponse({ success: false, error: `MASS_DELETION_PROTECTION: companies (current: ${_cur}, incoming: ${_canonicalCount})` }, 400);
          }
        }
        if (hasScope("certificates")) {
          const _cc = await env.DB_D1.prepare('SELECT COUNT(*) as cnt FROM certificates').all();
          const _certs = Array.isArray(d.certificates) ? d.certificates : (Array.isArray(d.certs) ? d.certs : []);
          const _certRows = Array.isArray(d.certificateRows) ? d.certificateRows : (Array.isArray(d.certRows) ? d.certRows : []);
          const _canonicalCount = Object.values(buildCertificatesById([..._certs, ..._certRows].map(c => createCanonicalCertificate(c)).filter(c => getCertificateId(c)))).length;
          const _cur = _cc.results[0]?.cnt ?? 0;
          if (_cur > 10 && _canonicalCount < _cur * 0.2) {
            return jsonResponse({ success: false, error: `MASS_DELETION_PROTECTION: certificates (current: ${_cur}, incoming: ${_canonicalCount})` }, 400);
          }
        }
        if (hasScope("tests")) {
          const _cc = await env.DB_D1.prepare('SELECT COUNT(*) as cnt FROM tests').all();
          const _canonicalCount = (Array.isArray(d.tests) ? d.tests : []).map(r => createCanonicalTestRow(r)).filter(t => getTestId(t)).length;
          const _cur = _cc.results[0]?.cnt ?? 0;
          if (_cur > 10 && _canonicalCount < _cur * 0.2) {
            return jsonResponse({ success: false, error: `MASS_DELETION_PROTECTION: tests (current: ${_cur}, incoming: ${_canonicalCount})` }, 400);
          }
        }
        if (hasScope("audits")) {
          const _cc = await env.DB_D1.prepare('SELECT COUNT(*) as cnt FROM audits').all();
          const _canonicalCount = (Array.isArray(d.auditObjects) ? d.auditObjects : (Array.isArray(d.audits) ? d.audits : [])).map(a => createCanonicalAuditRow(a)).filter(a => getAuditId(a)).length;
          const _cur = _cc.results[0]?.cnt ?? 0;
          if (_cur > 10 && _canonicalCount < _cur * 0.2) {
            return jsonResponse({ success: false, error: `MASS_DELETION_PROTECTION: audits (current: ${_cur}, incoming: ${_canonicalCount})` }, 400);
          }
        }
        if (hasScope("proformas")) {
          const _cc = await env.DB_D1.prepare('SELECT COUNT(*) as cnt FROM proformas').all();
          const _canonicalCount = (Array.isArray(d.proformas) ? d.proformas : []).map(p => createCanonicalProformaRow(p)).filter(p => getProformaId(p)).length;
          const _cur = _cc.results[0]?.cnt ?? 0;
          if (_cur > 10 && _canonicalCount < _cur * 0.2) {
            return jsonResponse({ success: false, error: `MASS_DELETION_PROTECTION: proformas (current: ${_cur}, incoming: ${_canonicalCount})` }, 400);
          }
        }

        await env.DB_D1.exec('PRAGMA foreign_keys = OFF');

        try {
        // === DELETE — ters FK sırasında (çocuklar önce, parent sonra) ===
        const safeRun = async (label, fn) => { try { await fn(); } catch(e) { throw new Error(`FK_DEBUG [${label}]: ${e.message}`); } };
        if (hasScope("proformas"))    await safeRun('DELETE proformas',    () => env.DB_D1.prepare(`DELETE FROM proformas`).run());
        if (hasScope("audits"))       await safeRun('DELETE audits',       () => env.DB_D1.prepare(`DELETE FROM audits`).run());
        if (hasScope("tests"))        await safeRun('DELETE tests',        () => env.DB_D1.prepare(`DELETE FROM tests`).run());
        if (hasScope("certificates")) await safeRun('DELETE certificates', () => env.DB_D1.prepare(`DELETE FROM certificates`).run());
        // companies yalnızca tüm FK-child tablolar da temizlendiyse DELETE; aksi hâlde UPSERT yeterli
        if (canDeleteCompanies)       await safeRun('DELETE companies',    () => env.DB_D1.prepare(`DELETE FROM companies`).run());

        // --- 🏗️ COMPANIES ---
        if (hasScope("companies")) {
          const companies = Array.isArray(d.companies) ? d.companies : [];
          const canonicalCompanies = companies.map(c => createCanonicalCompany(c)).filter(c => getCompanyId(c));
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
          await safeRun('INSERT companies', () => batchInsert(canonicalCompanies.map(c => stmt.bind(
            parseInt(getCompanyId(c)) || null,
            c.nickname || null,
            c.unvan || null,
            c.adres || null,
            c.city || null,
            c.ulke || null,
            c.yazisma || null,
            c.vergi_dairesi || null,
            c.vergi_no || null,
            c.tel || null,
            c.faks || null,
            c.www || null,
            c.mail || null,
            c.yetkili_adi || null,
            c.yetkili_unvani || null,
            c.kyt || null,
            c.irtibat_kisi || null,
            c.irtibat_unvani || null,
            c.irtibat_tel || null,
            c.irtibat_mail || null,
            c.yapilan_is || null,
            c.tcs || null,
            c.ycs || null,
            c.ucs || null,
            c.yzcs || null,
            c.tascs || null,
            c.acs || null,
            c.alan || null,
            c.departman || null,
            c.vardiya || null,
            c.logo || null,
            c.kase || null,
            c.dokuman || null,
            c.teknik || null,
            c.tkapsam || null,
            c.sinif || null,
            c.firma_not || null
          ))));
          stats.companies = canonicalCompanies.length;
        }

        // FK güvenliği: child tabloları yalnızca D1'de mevcut company id'lerine karşı filtrele
        const { results: _validRows } = await env.DB_D1.prepare('SELECT id FROM companies').all();
        const validFirmaIds = new Set(_validRows.map(r => r.id));

        // --- 🎖️ CERTIFICATES ---
        if (hasScope("certificates")) {
          const certs = Array.isArray(d.certificates) ? d.certificates : (Array.isArray(d.certs) ? d.certs : []);
          const certRows = Array.isArray(d.certificateRows) ? d.certificateRows : (Array.isArray(d.certRows) ? d.certRows : []);
          const canonicalCerts = [...certs, ...certRows]
            .map(c => createCanonicalCertificate(c))
            .filter(c => getCertificateId(c) && validFirmaIds.has(parseInt(c.firma_no)));
          const dedupedCerts = Object.values(buildCertificatesById(canonicalCerts));
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
          await safeRun('INSERT certificates', () => batchInsert(dedupedCerts.map(c => stmt.bind(
            parseInt(getCertificateId(c)) || null,
            parseInt(c.firma_no) || null,
            c.standart || null,
            c.denetim_tipi || null,
            c.sertifika_no || null,
            c.sertifika_tarihi || null,
            c.gozetim_tarihi || null,
            c.tescil_tarihi || null,
            c.gecerlilik_tarihi || null,
            c.kapsam || null,
            c.scope || null,
            c.akreditasyon || null,
            c.akredite || null,
            null,                              // ea — GAS canonical objesinde gelmediğinden null; sütun D1'de var
            c.nace || null,
            c.consultant || null,
            c.other_standart || null,
            c.durum || null,
            c.sertifika_not || null,
            c.gozetim_confirmed === 'TRUE' || c.gozetim_confirmed === true || c.gozetim_confirmed === '1' ? 1 : 0,
            c.calendar_id || null,
            c.qr || null,
            c.cert_link || null,
            c.logo || null
          ))));
          stats.certs = dedupedCerts.length;
        }

        // --- 🧪 TESTS ---
        if (hasScope("tests")) {
          const canonicalTests = (Array.isArray(d.tests) ? d.tests : [])
            .map(row => createCanonicalTestRow(row)).filter(t => getTestId(t) && validFirmaIds.has(parseInt(getTestFirmaId(t))));
          const stmt = env.DB_D1.prepare(
            `INSERT OR REPLACE INTO tests
              (id, firma_no, test_adi, marka, urun, urun_kodu, urun_no, lot,
               urun_kabul, kabul_saat, test_baslangic, test_bitis,
               rapor_tarihi, rapor_no, numune_sayisi, numune_ut, numune_skt,
               urun_bilgi, gorsel1, gorsel2, detay, gizle, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`
          );
          await safeRun('INSERT tests', () => batchInsert(canonicalTests.map(t => stmt.bind(
            parseInt(getTestId(t)) || null,
            parseInt(getTestFirmaId(t)) || null,
            t.test_adi || null,
            t.marka || null,
            t.urun || null,
            t.urun_kodu || null,
            t.urun_no || null,
            t.lot || null,
            t.urun_kabul || null,
            t.kabul_saat || null,
            t.test_baslangic || null,
            t.test_bitis || null,
            t.rapor_tarihi || null,
            t.rapor_no || null,
            parseInt(t.numune_sayisi) || null,
            t.numune_ut || null,
            t.numune_skt || null,
            t.urun_bilgi || null,
            t.gorsel1 || null,
            t.gorsel2 || null,
            t.detay || null,
            t.gizle || 0
          ))));
          stats.tests = canonicalTests.length;
        }

        // --- 📋 AUDITS ---
        if (hasScope("audits")) {
          const canonicalAudits = (Array.isArray(d.audits) ? d.audits : [])
            .map(a => createCanonicalAuditRow(a)).filter(a => getAuditId(a) && validFirmaIds.has(parseInt(getAuditFirmaId(a))));
          await safeRun('INSERT audits', () => batchInsert(canonicalAudits.map(a => upsertAuditD1(a, parseInt(getAuditId(a)) || null))));
          stats.audits = canonicalAudits.length;
        }

        // --- 💰 PROFORMAS ---
        if (hasScope("proformas")) {
          const incomingProformas = (Array.isArray(d.proformas) ? d.proformas : [])
            .map(p => createCanonicalProformaRow(p));
          const proformasWithId = incomingProformas.filter(p => getProformaId(p));
          const droppedMissingId = incomingProformas.length - proformasWithId.length;
          const canonicalProformas = proformasWithId
            .filter(p => validFirmaIds.has(parseInt(getProformaFirmaId(p))));
          const droppedByFirmaRef = proformasWithId.length - canonicalProformas.length;
          const invalidFirmaSamples = proformasWithId
            .filter(p => !validFirmaIds.has(parseInt(getProformaFirmaId(p))))
            .slice(0, 5)
            .map((p) => ({
              id: getProformaId(p),
              firmaNo: getProformaFirmaId(p),
              nick: p.nick || null,
              konu: p.konu || null,
            }));
          const missingIdSamples = incomingProformas
            .filter(p => !getProformaId(p))
            .slice(0, 5)
            .map((p) => ({
              id: getProformaId(p) || null,
              firmaNo: getProformaFirmaId(p) || null,
              nick: p.nick || null,
              konu: p.konu || null,
            }));
          const proformaDebug = {
            rawCount: Array.isArray(d.proformas) ? d.proformas.length : 0,
            normalizedCount: incomingProformas.length,
            withIdCount: proformasWithId.length,
            insertedCount: canonicalProformas.length,
            droppedMissingId,
            droppedByFirmaRef,
            validFirmaIdCount: validFirmaIds.size,
            sampleMissingId: missingIdSamples,
            sampleInvalidFirmaRef: invalidFirmaSamples,
          };
          if (proformasWithId.length > 0 && canonicalProformas.length === 0 && validFirmaIds.size === 0) {
            throw new Error(`PROFORMA_SYNC_BLOCKED: Companies tablosu D1'de boş olduğu için proformalar yazılamadı. Önce firmaları senkronize edin. DEBUG=${JSON.stringify(proformaDebug)}`);
          }
          if (proformasWithId.length > 0 && canonicalProformas.length === 0 && droppedByFirmaRef > 0) {
            throw new Error(`PROFORMA_SYNC_BLOCKED: ${droppedByFirmaRef} proforma kaydı geçersiz veya eşleşmeyen firma_no nedeniyle yazılamadı. DEBUG=${JSON.stringify(proformaDebug)}`);
          }
          const stmt = env.DB_D1.prepare(
            `INSERT OR REPLACE INTO proformas
              (id, firma_no, kdvsiz, kdv_oran, kdv, toplam, birim, tarih, konu, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,unixepoch())`
          );
          await safeRun('INSERT proformas', () => batchInsert(canonicalProformas.map(p => stmt.bind(
            parseInt(getProformaId(p)) || null,
            parseInt(getProformaFirmaId(p)) || null,
            parseFloat(p.kdvsiz) || null,
            parseInt(p.kdv_oran) || null,
            parseFloat(p.kdv) || null,
            parseFloat(p.toplam) || null,
            p.birim || null,
            p.tarih || null,
            p.konu || null
          ))));
          stats.proformas = canonicalProformas.length;
          stats.proformasDebug = proformaDebug;
        }

        // --- 📚 MASTER DATA ---
        if (hasScope("master")) {
          const stdList = Array.isArray(d.standards) ? d.standards : [];
          const audList = Array.isArray(d.auditors) ? d.auditors : [];
          const conList = Array.isArray(d.consultants) ? d.consultants : [];
          const tdList = Array.isArray(d.testdocs) ? d.testdocs : [];
          const sdList = Array.isArray(d.sysdocs) ? d.sysdocs : [];
          let normalizedStandards = [];
          let normalizedConsultants = [];
          let normalizedTestDocs = [];
          let normalizedSysDocs = [];

          if (hasMasterType("standards")) {
            normalizedStandards = stdList
              .map((r) => ({
                kod: r.kod,
                kisaltma: r.kisaltma,
                tam_ad: r.tam_ad,
                tanim_tr: r.tanim_tr,
                tanim_en: r.tanim_en,
                tema_id_en: r.tema_id_en,
                tema_id_tr: r.tema_id_tr,
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
            normalizedAuditorsList = audList.map((r, idx) => ({
              id: parseInt(r.id) || idx + 1,
              ad: String(r.ad || "").trim(),
              soyad: String(r.soyad || "").trim(),
              imza: String(r.imza || "").trim(),
              std_9001: isChecked(r.std_9001) ? 1 : 0,
              std_13485: isChecked(r.std_13485) ? 1 : 0,
              std_14001: isChecked(r.std_14001) ? 1 : 0,
              std_22000: isChecked(r.std_22000) ? 1 : 0,
              std_27001: isChecked(r.std_27001) ? 1 : 0,
              std_45001: isChecked(r.std_45001) ? 1 : 0,
              std_50001: isChecked(r.std_50001) ? 1 : 0,
              std_gmp: isChecked(r.std_gmp) ? 1 : 0
            })).filter(a => a.ad || a.soyad);

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
          env.DB_D1.prepare(`INSERT OR REPLACE INTO sync_meta (key, value, updated_at) VALUES ('last_sync', ?, unixepoch())`).bind(new Date().toISOString()),
          env.DB_D1.prepare(`INSERT OR REPLACE INTO sync_meta (key, value, updated_at) VALUES ('last_sync_at', ?, unixepoch())`).bind(String(Date.now()))
        ];
        if (hasScope("master")) {
          for (const t of masterTypes) {
            const meta = d.masterMeta?.[t] || { version: d.masterVersion || null, updatedAt: d.masterUpdatedAt || null };
            if (meta.version) syncMetaStmts.push(env.DB_D1.prepare(`INSERT OR REPLACE INTO sync_meta (key, value, updated_at) VALUES (?, ?, unixepoch())`).bind(`master_version_${t}`, String(meta.version)));
            const resolvedUpdatedAt = meta.updatedAt || new Date().toISOString();
            syncMetaStmts.push(env.DB_D1.prepare(`INSERT OR REPLACE INTO sync_meta (key, value, updated_at) VALUES (?, ?, unixepoch())`).bind(`master_updated_${t}`, String(resolvedUpdatedAt)));
          }
        }
        await env.DB_D1.batch(syncMetaStmts);

        ctx.waitUntil(rebuildDashboardStats());
        return jsonResponse({ success: true, message: "Sync Completed", stats, scope, masterTypes });
        } finally {
          await env.DB_D1.exec('PRAGMA foreign_keys = ON');
        }
      },
      exportData: async (params, ctx, env) => {
        try {
          const scope = Array.isArray(params?.scope) ? params.scope : ["companies", "certificates", "audits", "tests", "proformas", "master"];
          const masterTypes = Array.isArray(params?.masterTypes) ? params.masterTypes : ["standards", "auditors", "consultants", "testdocs", "sysdocs"];
          
          const tables = [];
          if (scope.includes("companies")) tables.push("companies");
          if (scope.includes("certificates")) tables.push("certificates");
          if (scope.includes("audits")) tables.push("audits");
          if (scope.includes("tests")) tables.push("tests");
          if (scope.includes("proformas")) tables.push("proformas");
          if (scope.includes("master")) {
            masterTypes.forEach(t => tables.push(t));
          }
          if (!tables.includes("integration_configs")) {
            tables.push("integration_configs");
          }
          
          const sql = await generateSqlDump(env, tables);
          return jsonResponse({ success: true, sql });
        } catch (e) {
          return jsonResponse({ success: false, error: `EXPORT_FAILED: ${e.message}` }, 500);
        }
      },
      exportBackup: async (params, ctx, env) => {
        const ip = getClientIp(request);
        const dayKey = new Date().toISOString().slice(0, 10);
        const rateKey = `ratelimit:exportBackup:${ip}:${dayKey}`;
        const currentCount = parseInt(await env.DB.get(rateKey) || "0", 10);
        const limit = 3;

        if (currentCount >= limit) {
          return jsonResponse({
            success: false,
            error: "EXPORT_BACKUP_RATE_LIMIT",
            message: "Günlük dışa aktarma limiti aşıldı."
          }, 429);
        }

        ctx.waitUntil(env.DB.put(rateKey, String(currentCount + 1), { expirationTtl: 86400 }));
        return SyncHandlers.exportData(
          { scope: ["companies", "certificates", "audits", "tests", "proformas", "master"] },
          ctx, env
        );
      },
      getSyncLog: async (params, ctx, env) => {
        const limit = Math.min(Math.max(parseInt(params?.limit || "20", 10) || 20, 1), 100);
        const status = String(params?.status || "").trim().toUpperCase();
        const allowedStatuses = new Set(["FAIL", "CRASH", "RECOVERED"]);

        let stmt;
        if (status && allowedStatuses.has(status)) {
          stmt = env.DB_D1.prepare(
            `SELECT * FROM sync_log WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ?`
          ).bind(status, limit);
        } else {
          stmt = env.DB_D1.prepare(
            `SELECT * FROM sync_log ORDER BY created_at DESC, id DESC LIMIT ?`
          ).bind(limit);
        }

        const { results } = await stmt.all();
        return jsonResponse({ success: true, data: results || [] });
      },
      retrySyncLog: async (params, ctx, env) => {
        const ids = Array.isArray(params?.ids) ? params.ids.map((id) => parseInt(id, 10)).filter((id) => Number.isInteger(id)) : [];
        if (!ids.length) {
          return jsonResponse({ success: false, error: "SYNC_LOG_IDS_REQUIRED" }, 400);
        }

        const summary = {
          requested: ids.length,
          recovered: 0,
          failed: 0,
          skipped: 0,
          items: [],
        };

        for (const id of ids) {
          const logRow = await env.DB_D1.prepare(`SELECT * FROM sync_log WHERE id=?`).bind(id).first();
          if (!logRow) {
            summary.skipped += 1;
            summary.items.push({ id, status: "SKIPPED", error: "SYNC_LOG_NOT_FOUND" });
            continue;
          }

          try {
            const retry = await buildRetryPayloadForLog(logRow);
            let result;
            if (retry.kind === "direct") {
              result = await fetchFromGas(env, retry.body);
            } else {
              result = await fetchFromGas(env, { action: retry.action, params: retry.params });
            }

            if (!result?.success) {
              throw new Error(result?.error || "RETRY_FAILED");
            }

            await env.DB_D1.prepare(`UPDATE sync_log SET status='RECOVERED', error_message=NULL WHERE id=?`).bind(id).run();
            summary.recovered += 1;
            summary.items.push({ id, status: "RECOVERED" });
          } catch (error) {
            summary.failed += 1;
            summary.items.push({ id, status: "FAILED", error: error?.message || String(error) });
          }
        }

        return jsonResponse({ success: true, data: summary });
      },
      importBackup: async (params, ctx, env) => {
        const sqlContent = params?.sql || params?.payload;
        if (!sqlContent || typeof sqlContent !== "string") {
          return jsonResponse({ success: false, error: "SQL_CONTENT_REQUIRED" }, 400);
        }

        try {
          // Step 1: D1 Execute SQL (REPLACE mode)
          await env.DB_D1.exec(sqlContent);

          // Step 2: Sync back to Sheets
          ctx.waitUntil((async () => {
             console.log("[Import] SQL imported to D1, Sheets sync suggested.");
          })());
          
          await rebuildDashboardStats();
          return jsonResponse({ success: true, message: "SQL Import successful. D1 updated." });
        } catch (e) {
          console.error("SQL Import Error:", e);
          return jsonResponse({ success: false, error: `IMPORT_FAILED: ${e.message}` }, 500);
        }
      },
      importKvData: async (params, ctx, env) => {
        return jsonResponse({ success: false, error: "DEPRECATED: importKvData is superseded by bulkSync. Use bulkSync action instead." }, 410);
      },
      smartSync: async (params, ctx, env) => {
        return jsonResponse({ success: false, error: "DEPRECATED: smartSync is superseded by Daily Sweeper (reconcileFromD1). Use direct D1 operations instead." }, 410);
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
        const [companies, certs, audits, tests, proformas, standards, auditors, consultants, testdocs, sysdocs, syncMeta] = await Promise.all([
          env.DB_D1.prepare(`SELECT COUNT(*) as cnt FROM companies`).first(),
          env.DB_D1.prepare(`SELECT COUNT(*) as cnt FROM certificates`).first(),
          env.DB_D1.prepare(`SELECT COUNT(*) as cnt FROM audits`).first(),
          env.DB_D1.prepare(`SELECT COUNT(*) as cnt FROM tests`).first(),
          env.DB_D1.prepare(`SELECT COUNT(*) as cnt FROM proformas`).first(),
          env.DB_D1.prepare(`SELECT COUNT(*) as cnt FROM standards`).first(),
          env.DB_D1.prepare(`SELECT COUNT(*) as cnt FROM auditors`).first(),
          env.DB_D1.prepare(`SELECT COUNT(*) as cnt FROM consultants`).first(),
          env.DB_D1.prepare(`SELECT COUNT(*) as cnt FROM testdocs`).first(),
          env.DB_D1.prepare(`SELECT COUNT(*) as cnt FROM sysdocs`).first(),
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
            standards: standards?.cnt || 0,
            auditors: auditors?.cnt || 0,
            consultants: consultants?.cnt || 0,
            testdocs: testdocs?.cnt || 0,
            sysdocs: sysdocs?.cnt || 0,
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
      },
      handleSheetEdit: async (p, ctx, env) => {
        return jsonResponse({ success: false, error: "DEPRECATED: handleSheetEdit is disabled in Phase 7. Please use explicit Sync buttons." }, 410);
      },
      getD1Changes: async (p, ctx, env) => {
        const sinceTs = parseInt(p?.since || "0");
        const delta = {
          companies: (await env.DB_D1.prepare(`SELECT * FROM companies WHERE updated_at > ?`).bind(sinceTs).all()).results,
          certificates: (await env.DB_D1.prepare(`SELECT * FROM certificates WHERE updated_at > ?`).bind(sinceTs).all()).results,
          audits: (await env.DB_D1.prepare(`SELECT * FROM audits WHERE updated_at > ?`).bind(sinceTs).all()).results,
          tests: (await env.DB_D1.prepare(`SELECT * FROM tests WHERE updated_at > ?`).bind(sinceTs).all()).results,
          proformas: (await env.DB_D1.prepare(`SELECT * FROM proformas WHERE updated_at > ?`).bind(sinceTs).all()).results
        };
        return jsonResponse({ success: true, data: delta });
      },

      // D1 → Sheets + Drive backup (D1-Primary mimarisinde doğru yön)
      // Cron scheduled() tarafından tetiklenir; GAS DailyBackupService.runDailyBackup()'ı çağırır
      triggerDailyBackup: async (p, ctx, env) => {
        try {
          const googleDlcEnabled = await isGoogleFeatureEnabled("feature:google_dlc");
          if (!googleDlcEnabled) {
            return jsonResponse(buildGoogleFeatureSkipResponse(
              "feature:google_dlc",
              "Google DLC kapalı olduğu için günlük backup tetiklenmedi."
            ));
          }
          const gasResult = await fetchFromGas(env, { action: "runDailyBackup", params: {} });
          if (!gasResult.success) {
            await logSyncEvent("cronBackup", "all", null, "FAIL", gasResult.error || "GAS runDailyBackup başarısız");
          }
          return jsonResponse(gasResult);
        } catch (err) {
          await logSyncEvent("cronBackup", "all", null, "CRASH", err.message);
          return jsonResponse({ success: false, error: err.message }, 502);
        }
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
        const canonical = createCanonicalCompany(p?.companyInfo || {});
        // Step 1: D1 First (ID üretimi D1'e bırakılır)
        const dbRes = await upsertCompanyD1(canonical, null).run();
        const newId = dbRes.meta.last_row_id;

        // Step 2: Background Sync (Sheets'e yedekle)
        const syncParams = { ...p, id: newId, companyInfo: { ...p.companyInfo, id: newId } };
        syncToBackup("addCompany", syncParams, "companies", newId);
        
        return jsonResponse({ success: true, id: newId });
      },
      updateCompany: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);

        if (p?.expectedEtag) {
          const currentRow = await env.DB_D1.prepare(`SELECT * FROM companies WHERE id=?`).bind(parseInt(id)).first();
          if (!currentRow) return jsonResponse({ success: false, error: "NOT_FOUND" }, 404);
          const currentCanonical = createCanonicalCompany(currentRow, { id });
          if (String(currentCanonical.__etag || "") !== String(p.expectedEtag)) {
            return jsonResponse({ success: false, error: "CONFLICT" }, 409);
          }
        }
        const companyLock = await checkOptimisticLock("companies", id, p?.expected_updated_at);
        if (!companyLock.ok) return companyLock.response;

        const canonical = createCanonicalCompany(p?.companyInfo || {}, { id });
        // Step 1: D1 First
        await upsertCompanyD1(canonical, parseInt(id)).run();

        const freshRow = await env.DB_D1.prepare(`SELECT * FROM companies WHERE id=?`).bind(parseInt(id)).first();
        const responseCompany = freshRow ? createCanonicalCompany(freshRow, { id }) : { ...canonical, id };

        // Step 2: Background Sync
        syncToBackup("updateCompany", p, "companies", id);

        return jsonResponse({
          success: true,
          data: {
            company: responseCompany,
            etag: responseCompany.__etag || null,
            updated_at: freshRow?.updated_at ?? null,
          }
        });
      },
      deleteCompany: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);

        // Step 1: D1 First
        await env.DB_D1.prepare(`DELETE FROM companies WHERE id=?`).bind(parseInt(id)).run();

        // Step 2: Background Sync
        syncToBackup("deleteCompany", p, "companies", id);
        
        ctx.waitUntil(rebuildDashboardStats());
        return jsonResponse({ success: true });
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
          `SELECT c.id, c.firma_no, c.standart, c.other_standart, c.sertifika_no, c.sertifika_tarihi,
                  c.gozetim_tarihi, c.gecerlilik_tarihi, c.durum, c.gozetim_confirmed,
                  c.denetim_tipi, c.akredite, c.akreditasyon, c.consultant,
                  co.nickname, co.city, co.ulke
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
        const canonical = createCanonicalCertificate(p?.certInfo || {});
        // Step 1: D1 First
        const dbRes = await upsertCertificateD1(canonical, null).run();
        const newId = dbRes.meta.last_row_id;

        // Step 2: Background Sync
        const syncParams = { ...p, id: newId, certInfo: { ...p.certInfo, id: newId } };
        syncToBackup("addCertificate", syncParams, "certificates", newId);
        ctx.waitUntil(rebuildDashboardStats());

        return jsonResponse({ success: true, id: newId });
      },
      updateCertificate: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const lockCheck = await checkOptimisticLock("certificates", id, p?.expected_updated_at);
        if (!lockCheck.ok) return lockCheck.response;

        // Eğer certInfo.qr boşsa, mevcut D1 kaydındaki qr değerini koru
        let certInfoWithQr = p?.certInfo || {};
        if (!certInfoWithQr.qr) {
          const existingRow = await env.DB_D1.prepare(`SELECT qr, cert_link FROM certificates WHERE id=?`).bind(parseInt(id)).first();
          if (existingRow?.qr) {
            certInfoWithQr = { ...certInfoWithQr, qr: existingRow.qr };
          }
        }

        const canonical = createCanonicalCertificate(certInfoWithQr, { id });
        // Step 1: D1 First
        await upsertCertificateD1(canonical, parseInt(id)).run();

        // Step 2: Background Sync
        syncToBackup("updateCertificate", { ...p, certInfo: certInfoWithQr }, "certificates", id);
        ctx.waitUntil(rebuildDashboardStats());

        const freshRow = await env.DB_D1.prepare(`SELECT updated_at FROM certificates WHERE id=?`).bind(parseInt(id)).first();
        return jsonResponse({ success: true, data: { updated_at: freshRow?.updated_at ?? null } });
      },
      deleteCertificate: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);

        // Step 1: D1 First
        await env.DB_D1.prepare(`DELETE FROM certificates WHERE id=?`).bind(parseInt(id)).run();

        // Step 2: Background Sync
        syncToBackup("deleteCertificate", p, "certificates", id);
        
        ctx.waitUntil(rebuildDashboardStats());
        return jsonResponse({ success: true });
      },
      updateSurveillance: async (p, ctx, env) => {
        const ids = Array.isArray(p?.ids) ? p.ids : [];
        const status = p?.status === true || p?.status === "TRUE" ? "TRUE" : "FALSE";
        const confirmed = status === "TRUE" ? 1 : 0;

        // Step 1: D1 First
        if (ids.length) {
          const placeholders = ids.map(() => "?").join(",");
          await env.DB_D1.prepare(
            `UPDATE certificates SET gozetim_confirmed=?, updated_at=unixepoch() WHERE id IN (${placeholders})`
          ).bind(confirmed, ...ids.map(i => parseInt(i))).run();
        }

        // Step 2: Background Sync
        syncToBackup("updateSurveillance", p, "certificates", "bulk_update");

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
        const toIso = (col) => `CASE WHEN ${col} LIKE '__.__.____'
          THEN SUBSTR(${col},7,4)||'-'||SUBSTR(${col},4,2)||'-'||SUBSTR(${col},1,2)
          ELSE ${col} END`;
        const a1s = toIso("a.a1_baslangic");
        const a2s = toIso("a.a2_baslangic");

        const { results } = await env.DB_D1.prepare(
          `SELECT a.*, co.nickname, co.unvan FROM audits a
           LEFT JOIN companies co ON co.id = a.firma_no
           ORDER BY COALESCE(${a1s}, ${a2s}) DESC`
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
      getAuditCalendar: async (p, ctx, env) => {
        const year = Number.parseInt(String(p?.year || ""), 10);
        const month = Number.parseInt(String(p?.month || ""), 10);
        if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
          return jsonResponse({ success: false, error: "INVALID_YEAR_MONTH" }, 400);
        }

        const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
        const monthEnd = `${year}-${String(month + 1).padStart(2, "0")}-01`;
        // D1'de tarihler hem 'DD.MM.YYYY' hem 'YYYY-MM-DD' formunda olabilir.
        // CASE WHEN ile noktalı formatı ISO'ya çevirerek karşılaştırma yapıyoruz.
        const toIso = `CASE WHEN col LIKE '__.__.____'
          THEN SUBSTR(col,7,4)||'-'||SUBSTR(col,4,2)||'-'||SUBSTR(col,1,2)
          ELSE col END`;
        const a1s = toIso.replaceAll("col", "a.a1_baslangic");
        const a1e = toIso.replaceAll("col", "COALESCE(NULLIF(a.a1_bitis,''),a.a1_baslangic)");
        const a2s = toIso.replaceAll("col", "a.a2_baslangic");
        const a2e = toIso.replaceAll("col", "COALESCE(NULLIF(a.a2_bitis,''),a.a2_baslangic)");
        const { results } = await env.DB_D1.prepare(
          `SELECT a.*, co.nickname, co.unvan
           FROM audits a
           LEFT JOIN companies co ON co.id = a.firma_no
           WHERE (
             a.a1_baslangic IS NOT NULL AND TRIM(a.a1_baslangic) != ''
             AND ${a1s} < ? AND ${a1e} >= ?
           ) OR (
             a.a2_baslangic IS NOT NULL AND TRIM(a.a2_baslangic) != ''
             AND ${a2s} < ? AND ${a2e} >= ?
           )
           ORDER BY COALESCE(a.a1_baslangic, a.a2_baslangic) DESC`
        ).bind(monthEnd, monthStart, monthEnd, monthStart).all();
        return jsonResponse({ success: true, data: results || [] });
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
      generateTestReport: async (p, ctx, env) => {
        const googleDlcEnabled = await isGoogleFeatureEnabled("feature:google_dlc");
        if (!googleDlcEnabled) {
          return jsonResponse(buildGoogleFeatureSkipResponse(
            "feature:google_dlc",
            "Google DLC kapalı olduğu için test raporu üretimi atlandı."
          ));
        }
        const id = String(p?.id || "").trim();
        const lang = p?.lang || "TR";
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        try {
          const payload = await buildTestPayloadFromD1(id, lang);
          
          // Inline getFolderId logic
          const fno = payload.fno;
          const fnick = payload.fnick;
          const cacheKey = `cache:getFolderId:${stableStringify({ id: fno })}`;
          let folderId = await env.DB.get(cacheKey);
          
          if (!folderId) {
            const res = await fetchFromGas(env, { action: "getFolderId", params: { id: fno, nickname: fnick } });
            if (res.success && res.data) {
              folderId = String(res.data);
              ctx.waitUntil(env.DB.put(cacheKey, folderId, { expirationTtl: CACHE_TTL }));
            } else {
              throw new Error("Klasör ID alınamadı: " + (res.error || "Bilinmeyen hata"));
            }
          }

          const gasResult = await fetchFromGas(env, { 
            action: "generateTestReport", 
            params: { data: payload, folderId } 
          });
          return jsonResponse(gasResult);
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
        const googleDlcEnabled = await isGoogleFeatureEnabled("feature:google_dlc");
        if (!googleDlcEnabled) {
          return jsonResponse(buildGoogleFeatureSkipResponse(
            "feature:google_dlc",
            "Google DLC kapalı olduğu için proforma üretimi atlandı."
          ));
        }
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
        const googleDlcEnabled = await isGoogleFeatureEnabled("feature:google_dlc");
        if (!googleDlcEnabled) {
          return jsonResponse(buildGoogleFeatureSkipResponse(
            "feature:google_dlc",
            "Google DLC kapalı olduğu için sözleşme üretimi atlandı."
          ));
        }
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
        const canonical = createCanonicalTestRow(p?.testInfo || {});
        // Step 1: D1 First
        const dbRes = await upsertTestD1(canonical, null).run();
        const newId = dbRes.meta.last_row_id;

        // Step 2: Background Sync
        const syncParams = { ...p, id: newId, testInfo: { ...createTestBackupPayload(canonical), id: newId } };
        syncToBackup("addTest", syncParams, "tests", newId);
        
        return jsonResponse({ success: true, id: newId });
      },
      updateTest: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const lockCheck = await checkOptimisticLock("tests", id, p?.expected_updated_at);
        if (!lockCheck.ok) return lockCheck.response;

        const canonical = createCanonicalTestRow(p?.testInfo || {}, { id });
        // Step 1: D1 First
        await upsertTestD1(canonical, parseInt(id)).run();

        // Step 2: Background Sync
        syncToBackup("updateTest", { ...p, id, testInfo: createTestBackupPayload(canonical, { id }) }, "tests", id);
        
        const freshRow = await env.DB_D1.prepare(`SELECT updated_at FROM tests WHERE id=?`).bind(parseInt(id)).first();
        return jsonResponse({ success: true, data: { updated_at: freshRow?.updated_at ?? null } });
      },
      addProforma: async (p, ctx, env) => {
        const canonical = createCanonicalProformaRow(p?.proInfo || {});
        // Step 1: D1 First
        const dbRes = await upsertProformaD1(canonical, null).run();
        const newId = dbRes.meta.last_row_id;

        // Step 2: Background Sync
        const syncParams = { ...p, id: newId, proInfo: { ...createProformaBackupPayload(canonical), id: newId } };
        syncToBackup("addProforma", syncParams, "proformas", newId);
        
        return jsonResponse({ success: true, id: newId });
      },
      updateProforma: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const lockCheck = await checkOptimisticLock("proformas", id, p?.expected_updated_at);
        if (!lockCheck.ok) return lockCheck.response;

        const canonical = createCanonicalProformaRow(p?.proInfo || {}, { id });
        // Step 1: D1 First
        await upsertProformaD1(canonical, parseInt(id)).run();

        // Step 2: Background Sync
        syncToBackup("updateProforma", { ...p, id, proInfo: createProformaBackupPayload(canonical, { id }) }, "proformas", id);
        
        const freshRow = await env.DB_D1.prepare(`SELECT updated_at FROM proformas WHERE id=?`).bind(parseInt(id)).first();
        return jsonResponse({ success: true, data: { updated_at: freshRow?.updated_at ?? null } });
      },
      scheduleAudit: async (p, ctx, env) => {
        const canonical = createCanonicalAuditRow(p?.data || {});
        // Step 1: D1 First
        const dbRes = await upsertAuditD1(canonical, null).run();
        const newId = dbRes.meta.last_row_id;

        // Step 2: Background Sync (Calendar creation is done in GAS)
        const syncParams = { ...p, id: newId, data: createAuditBackupPayload({ ...canonical, id: newId }) };
        syncToBackup("scheduleAudit", syncParams, "audits", newId);
        
        return jsonResponse({ success: true, id: newId });
      },
      updateAudit: async (p, ctx, env) => {
        const id = String(p?.id || p?.auditId || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        const lockCheck = await checkOptimisticLock("audits", id, p?.expected_updated_at);
        if (!lockCheck.ok) return lockCheck.response;

        const canonical = createCanonicalAuditRow(p?.data || p?.auditInfo || {}, { id });
        // Step 1: D1 First
        await upsertAuditD1(canonical, parseInt(id)).run();

        // Step 2: Background Sync
        syncToBackup("updateAudit", { ...p, id, data: createAuditBackupPayload(canonical, { id }) }, "audits", id);
        
        const freshRow = await env.DB_D1.prepare(`SELECT updated_at FROM audits WHERE id=?`).bind(parseInt(id)).first();
        return jsonResponse({ success: true, data: { updated_at: freshRow?.updated_at ?? null } });
      },
      deleteAudit: async (p, ctx, env) => {
        const id = String(p?.id || p?.auditId || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);

        // Step 1: D1 First
        await env.DB_D1.prepare(`DELETE FROM audits WHERE id=?`).bind(parseInt(id)).run();

        // Step 2: Background Sync
        syncToBackup("deleteAudit", p, "audits", id);
        
        ctx.waitUntil(rebuildDashboardStats());
        return jsonResponse({ success: true });
      },
      deleteTest: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);

        // Step 1: D1 First
        await env.DB_D1.prepare(`DELETE FROM tests WHERE id=?`).bind(parseInt(id)).run();

        // Step 2: Background Sync
        syncToBackup("deleteTest", p, "tests", id);
        
        return jsonResponse({ success: true });
      },
      deleteProforma: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);

        // Step 1: D1 First
        await env.DB_D1.prepare(`DELETE FROM proformas WHERE id=?`).bind(parseInt(id)).run();

        // Step 2: Background Sync
        syncToBackup("deleteProforma", p, "proformas", id);
        
        return jsonResponse({ success: true });
      },
            updateCertificateField: async (p, ctx, env) => {
        const id = String(p?.id || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);

        // Step 1: D1 First (Fetch, Patch, Update)
        const cert = await env.DB_D1.prepare("SELECT * FROM certificates WHERE id=?").bind(parseInt(id)).first();
        if (cert) {
          const canonical = createCanonicalCertificate(cert, { id, explicit: p?.certInfo });
          await upsertCertificateD1(canonical, parseInt(id)).run();
        }

        // Step 2: Background Sync
        syncToBackup("updateCertificateField", p, "certificates", id);
        ctx.waitUntil(rebuildDashboardStats());

        return jsonResponse({ success: true, message: "Update confirmed" });
      }
    };

    const DriveHandlers = {
      getFolderId: async (p, ctx, env) => {
        const googleDlcEnabled = await isGoogleFeatureEnabled("feature:google_dlc");
        if (!googleDlcEnabled) {
          return jsonResponse(buildGoogleFeatureSkipResponse(
            "feature:google_dlc",
            "Google DLC kapalı olduğu için Drive klasör sorgusu atlandı."
          ));
        }
        const id = String(p?.id || p?.firmaId || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);

        const company = await env.DB_D1.prepare("SELECT nickname FROM companies WHERE id=?").bind(parseInt(id)).first();
        const nickname = company?.nickname || "";

        const cacheKey = `cache:getFolderId:${stableStringify({ id })}`;
        const cached = await env.DB.get(cacheKey);
        if (cached) return jsonResponse({ success: true, data: cached, fromCache: true });

        const res = await fetchFromGas(env, { action: "getFolderId", params: { id, nickname } });
        if (res.success && res.data) {
          ctx.waitUntil(env.DB.put(cacheKey, String(res.data), { expirationTtl: CACHE_TTL }));
        }
        return jsonResponse(res);
      },
      getRecentFiles: async (p, ctx, env) => {
        const googleDlcEnabled = await isGoogleFeatureEnabled("feature:google_dlc");
        if (!googleDlcEnabled) {
          return jsonResponse(buildGoogleFeatureSkipResponse(
            "feature:google_dlc",
            "Google DLC kapalı olduğu için Drive dosya listesi atlandı."
          ));
        }
        const id = String(p?.id || p?.firmaId || "").trim();
        if (!id) return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        
        const company = await env.DB_D1.prepare("SELECT nickname FROM companies WHERE id=?").bind(parseInt(id)).first();
        const nickname = company?.nickname || "";
        
        const mimeTypes = Array.isArray(p?.mimeTypes) ? p.mimeTypes : undefined;
        const forceRefresh = Boolean(p?.refreshToken || p?.forceRefresh);
        const cacheKey = `cache:getRecentFiles:${stableStringify({ id })}`;
        
        if (!forceRefresh) {
          const cached = await env.DB.get(cacheKey);
          if (cached) return jsonResponse({ success: true, data: JSON.parse(cached), fromCache: true });
        }

        const res = await fetchFromGas(env, {
          action: "getRecentFiles",
          params: { id, nickname, mimeTypes, refreshToken: p?.refreshToken }
        });
        
        if (res.success && res.data) {
          ctx.waitUntil(env.DB.put(cacheKey, JSON.stringify(res.data), { expirationTtl: CACHE_TTL }));
        }
        return jsonResponse(res);
      },
      listDriveContents: async (p, ctx, env) => {
        const googleDlcEnabled = await isGoogleFeatureEnabled("feature:google_dlc");
        if (!googleDlcEnabled) {
          return jsonResponse(buildGoogleFeatureSkipResponse(
            "feature:google_dlc",
            "Google DLC kapalı olduğu için Drive içerik listesi atlandı."
          ));
        }
        const id = String(p?.id || p?.firmaId || "").trim();
        let folderId = String(p?.folderId || "").trim();
        const mimeTypes = Array.isArray(p?.mimeTypes) ? p.mimeTypes : undefined;

        if (!folderId) {
          if (!id) return jsonResponse({ success: false, error: "ID_OR_FOLDERID_REQUIRED" }, 400);
          const company = await env.DB_D1.prepare("SELECT nickname FROM companies WHERE id=?").bind(parseInt(id)).first();
          const nickname = company?.nickname || "";
          
          const folderRes = await fetchFromGas(env, { action: "getFolderId", params: { id, nickname } });
          if (!folderRes.success || !folderRes.data) return jsonResponse(folderRes);
          folderId = String(folderRes.data);
        }

        const res = await fetchFromGas(env, {
          action: "listDriveContents",
          params: { folderId, mimeTypes }
        });
        
        if (res.success) {
          res.currentFolderId = folderId;
        }
        
        return jsonResponse(res);
      },
      prepareBatchFolders: async (p, ctx, env) => {
        const googleDlcEnabled = await isGoogleFeatureEnabled("feature:google_dlc");
        if (!googleDlcEnabled) {
          return jsonResponse(buildGoogleFeatureSkipResponse(
            "feature:google_dlc",
            "Google DLC kapalı olduğu için toplu klasör hazırlama atlandı."
          ));
        }
        const res = await fetchFromGas(env, { action: "prepareBatchFolders", params: p });
        return jsonResponse(res);
      }
    };

    const IntegrationHandlers = {
      getGoogleFeatureFlags: async (p, ctx, env) => {
        const flags = await getGoogleFeatureFlags();
        return jsonResponse({ success: true, data: flags });
      },
      updateGoogleFeatureFlag: async (p, ctx, env) => {
        const key = String(p?.key || "").trim();
        if (!GOOGLE_FEATURE_FLAG_KEYS.includes(key)) {
          return jsonResponse({ success: false, error: "INVALID_FEATURE_FLAG_KEY" }, 400);
        }
        const enabled = Boolean(p?.enabled);
        await env.DB_D1.prepare(
          `INSERT OR REPLACE INTO sync_meta (key, value, updated_at) VALUES (?, ?, unixepoch())`
        ).bind(key, enabled ? "true" : "false").run();
        const flags = await getGoogleFeatureFlags();
        return jsonResponse({ success: true, data: flags });
      },
      getIntegrationConfigs: async (p, ctx, env) => {
        const provider = String(p?.provider || "").trim().toLowerCase();
        const service = String(p?.service || "").trim().toLowerCase();

        if (provider && !isValidIntegrationToken(provider)) {
          return jsonResponse({ success: false, error: "INVALID_PROVIDER" }, 400);
        }
        if (service && !isValidIntegrationToken(service)) {
          return jsonResponse({ success: false, error: "INVALID_SERVICE" }, 400);
        }

        let stmt;
        if (provider && service) {
          stmt = env.DB_D1.prepare(
            `SELECT * FROM integration_configs
             WHERE provider = ? AND service = ?
             ORDER BY service, config_key, tenant_scope, id`
          ).bind(provider, service);
        } else if (provider) {
          stmt = env.DB_D1.prepare(
            `SELECT * FROM integration_configs
             WHERE provider = ?
             ORDER BY service, config_key, tenant_scope, id`
          ).bind(provider);
        } else {
          stmt = env.DB_D1.prepare(
            `SELECT * FROM integration_configs
             ORDER BY provider, service, config_key, tenant_scope, id`
          );
        }

        const { results } = await stmt.all();
        return jsonResponse({ success: true, data: results || [] });
      },
      upsertIntegrationConfig: async (p, ctx, env) => {
        const config = normalizeIntegrationConfig(p?.config);
        if (!config.provider || !isValidIntegrationToken(config.provider)) {
          return jsonResponse({ success: false, error: "INVALID_PROVIDER" }, 400);
        }
        if (!config.service || !isValidIntegrationToken(config.service)) {
          return jsonResponse({ success: false, error: "INVALID_SERVICE" }, 400);
        }
        if (!config.config_key || !isValidIntegrationToken(config.config_key)) {
          return jsonResponse({ success: false, error: "INVALID_CONFIG_KEY" }, 400);
        }
        if (!config.tenant_scope || !isValidIntegrationToken(config.tenant_scope)) {
          return jsonResponse({ success: false, error: "INVALID_TENANT_SCOPE" }, 400);
        }

        await env.DB_D1.prepare(
          `INSERT INTO integration_configs (provider, service, config_key, config_value, tenant_scope, updated_at)
           VALUES (?, ?, ?, ?, ?, unixepoch())
           ON CONFLICT(provider, service, config_key, tenant_scope)
           DO UPDATE SET
             config_value = excluded.config_value,
             updated_at = unixepoch()`
        ).bind(
          config.provider,
          config.service,
          config.config_key,
          config.config_value || null,
          config.tenant_scope,
        ).run();

        const row = await env.DB_D1.prepare(
          `SELECT * FROM integration_configs
           WHERE provider = ? AND service = ? AND config_key = ? AND tenant_scope = ?`
        ).bind(
          config.provider,
          config.service,
          config.config_key,
          config.tenant_scope,
        ).first();

        return jsonResponse({ success: true, data: row || null });
      },
      deleteIntegrationConfig: async (p, ctx, env) => {
        const id = Number.parseInt(String(p?.id || ""), 10);
        if (!Number.isInteger(id) || id <= 0) {
          return jsonResponse({ success: false, error: "ID_REQUIRED" }, 400);
        }
        await env.DB_D1.prepare(`DELETE FROM integration_configs WHERE id=?`).bind(id).run();
        return jsonResponse({ success: true });
      },
    };

    const MasterHandlers = {
      getConsultants: async (p, ctx, env) => {
        const { results } = await env.DB_D1.prepare(`SELECT * FROM consultants ORDER BY ad`).all();
        return jsonResponse({ success: true, data: results || [] });
      },
      getAuditors: async (p, ctx, env) => {
        const { results } = await env.DB_D1.prepare(`SELECT * FROM auditors ORDER BY ad, soyad`).all();
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
          return jsonResponse({
            success: true, data: {
              dataset: { headers, rows: rows.map(r => headers.map(h => r[h])), sheetName: type },
              version: metaRow?.value || null,
              updatedAt: metaUpdatedRow?.value || null
            }
          });
        }
        // Return all tables combined
        const [std, aud, con, td, sd] = await Promise.all([
          env.DB_D1.prepare(`SELECT * FROM standards`).all(),
          env.DB_D1.prepare(`SELECT * FROM auditors`).all(),
          env.DB_D1.prepare(`SELECT * FROM consultants`).all(),
          env.DB_D1.prepare(`SELECT * FROM testdocs`).all(),
          env.DB_D1.prepare(`SELECT * FROM sysdocs`).all(),
        ]);
        return jsonResponse({
          success: true, data: {
            standards: std.results || [], auditors: aud.results || [],
            consultants: con.results || [], testdocs: td.results || [], sysdocs: sd.results || []
          }
        });
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

        // Step 1: D1 First (Immediate Update)
        const rows = (params?.data?.rows || []);
        await upsertMasterTypeToD1(type, rows, env);

        // Step 2: Background Sync to GAS
        syncToBackup("updateMasterData", params, "master", type);

        return jsonResponse({ success: true, message: "Master update completed in D1 and queued for backup." });
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
          ...NotificationHandlers,
          ...MasterHandlers,
          ...IntegrationHandlers,
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

        const googleDlcGatedActions = new Set([
          "getFolderId",
          "getRecentFiles",
          "listDriveContents",
          "prepareBatchFolders",
          "uploadFile",
          "generateDraftCertificate",
          "generateAppForm",
          "generateSingleBatchDoc",
          "generateIso",
          "convertToPdf",
          "generateContract",
          "generateProforma",
          "generateTestReport",
          "runDailyBackup",
        ]);
        const gmailGatedActions = new Set(["sendSurveillanceEmail", "runMonthlyCheck", "sendReport"]);
        if (googleDlcGatedActions.has(action)) {
          const googleDlcEnabled = await isGoogleFeatureEnabled("feature:google_dlc");
          if (!googleDlcEnabled) {
            return jsonResponse(buildGoogleFeatureSkipResponse(
              "feature:google_dlc",
              `${action} işlemi Google DLC kapalı olduğu için atlandı.`
            ));
          }
        }
        if (gmailGatedActions.has(action)) {
          const gmailEnabled = await isGoogleFeatureEnabled("feature:google_gmail");
          if (!gmailEnabled) {
            return jsonResponse(buildGoogleFeatureSkipResponse(
              "feature:google_gmail",
              `${action} işlemi Google Gmail DLC kapalı olduğu için atlandı.`
            ));
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


    return new Response(`🚀 ${workerLabel} Active`, {
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  },

  // Her Pazar 04:00 UTC — D1 → Sheets + Drive backup (D1-Primary yönü)
  // Eski: GAS → D1 (bulkSync) — D1-Primary mimarisinde yanlış yöndü, kaldırıldı
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const fakeCtx = { waitUntil: (p) => p };
        await SyncHandlers.triggerDailyBackup({}, fakeCtx, env);
      } catch (e) {
        console.error("[Cron] Günlük yedekleme hatası:", e.message);
      }
    })());
  },

};
