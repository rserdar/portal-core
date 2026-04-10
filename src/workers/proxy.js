/**
 * 🛰️ Medicert Portal: Cloudflare Worker Proxy (v5.4 / Phase 3.5)
 *
 * Mimari özeti:
 * - KV-primary read (miss => needsHydration)
 * - KV-primary write (Sheets write-back devre dışı)
 * - Google-native side-effect'ler geçici olarak kapalı
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

    const getPicker = (record) => {
      const src = record && typeof record === "object" ? record : {};
      let normalizedMap = null;

      return (aliases, fallback = "") => {
        // Fast path: exact key match
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
    const getCertificateId = (record) => pickObjectValue(record, ["ID", "id", "certId"]);
    const getCertificateFirmaId = (record) => pickObjectValue(record, ["Firma No", "firmaNo", "firmano", "fno"]);
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
      const pick = getPicker(input);
      const id = String(options.id ?? getCertificateId(input) ?? "").trim();
      const nick = pick(["nick", "nickname", "Nickname", "Firma Adı", "isim"]);
      const firmaNo = pick(["firmano", "firmaNo", "Firma No", "fno"]);
      const standart = pick(["standart", "standard", "Standart"]);
      const denetim = pick(["denetim", "Denetim Tipi", "Denetim", "denetimTipi"]);
      const sno = pick(["sno", "sNo", "Sertifika No", "sertNo", "SertifikaNo"]);
      const gst = pick(["gst", "sTarihi", "Sertifika Tarihi", "Belge Tarihi"]);
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

      return {
        ...(input || {}),
        ...(id ? { ID: id, id, certId: id } : {}),
        "Firma Adı": nick,
        Nickname: nick,
        nick,
        isim: nick,
        "Firma No": firmaNo,
        firmaNo,
        firmano: firmaNo,
        Standart: standart,
        standart,
        "Denetim Tipi": denetim,
        denetim,
        denetimTipi: denetim,
        "Sertifika No": sno,
        sno,
        sNo: sno,
        "Sertifika Tarihi": gst,
        gst,
        sTarihi: gst,
        "Gözetim Tarihi": goz,
        "Sertifika Gözetim Tarihi": goz,
        goz,
        sGozetimT: goz,
        "Tescil Tarihi": stt,
        "Sertifika Tescil Tarihi": stt,
        "Son Tetkik Tarihi": stt,
        stt,
        sTT: stt,
        "Sertifika Geçerlilik Tarihi": sgt,
        sgt,
        sGT: sgt,
        Kapsam: kapsam,
        kapsam,
        Scope: scope,
        scope,
        Akreditasyon: akreditasyon,
        akreditasyon,
        akrn: akreditasyon,
        Akredite: akredite,
        akredite,
        "Danışman": dan,
        Danisman: dan,
        dan,
        danisman: dan,
        "Other Standard": other,
        Other: other,
        other,
        Durum: durum,
        durum,
        Not: not,
        not,
        "Gözetim Conf.": gozetimConf,
        gozetimConfirmed: gozetimConf,
        gozetimConf,
        gozetim: gozetimConf,
        "Calendar ID": calendar,
        calendar,
        eventId: calendar,
        "QR Code": qr,
        qr,
        "Cert Link": certLink,
        certLink,
        certiLink: certLink,
        Logo: logo,
        logo,
        Kod: kod,
        kod,
        NACE: kod,
        nace: kod,
      };
    };
    const listKvJsonValues = async (prefix) => {
      if (!env.DB) return [];
      const values = [];
      let cursor = undefined;
      do {
        const page = await env.DB.list({ prefix, cursor });
        if (page.keys && page.keys.length) {
          const rawValues = await Promise.all(page.keys.map((entry) => env.DB.get(entry.name)));
          rawValues.forEach((raw) => {
            if (!raw) return;
            try {
              values.push(JSON.parse(raw));
            } catch (_) {
              // Ignore malformed cache entries; canonical rebuild below will use valid rows.
            }
          });
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return values;
    };
    const loadCertificateState = async () => {
      if (!env.DB) return null;
      const [allRaw, byFirmaRaw, byIdRaw] = await Promise.all([
        env.DB.get("cache:getCertificates:{}"),
        env.DB.get(indexKeys.certsByFirmaId),
        env.DB.get(indexKeys.certificateById),
      ]);
      let certificates = allRaw ? JSON.parse(allRaw) : null;
      let certsByFirmaId = byFirmaRaw ? JSON.parse(byFirmaRaw) : null;
      let certById = byIdRaw ? JSON.parse(byIdRaw) : null;

      if (!Array.isArray(certificates) && certById && typeof certById === "object") {
        certificates = Object.values(certById);
      }
      if (!Array.isArray(certificates) && certsByFirmaId && typeof certsByFirmaId === "object") {
        certificates = Object.values(certsByFirmaId).flatMap((value) => Array.isArray(value) ? value : []);
      }
      if (!Array.isArray(certificates)) {
        const groupedCertificateCaches = await listKvJsonValues("cache:getCertificatesByFirmaId:");
        if (groupedCertificateCaches.length) {
          certificates = groupedCertificateCaches.flatMap((value) => Array.isArray(value) ? value : []);
        }
      }
      if (!Array.isArray(certificates)) {
        const singleCertificateCaches = await listKvJsonValues("cache:getCertificateById:");
        if (singleCertificateCaches.length) {
          certificates = singleCertificateCaches.filter((value) => value && typeof value === "object");
        }
      }
      if (!Array.isArray(certificates)) return null;

      const canonicalCertificates = certificates
        .map((certificate) => createCanonicalCertificate(certificate))
        .filter((certificate) => getCertificateId(certificate));
      certById = buildCertificatesById(canonicalCertificates);
      const dedupedCertificates = Object.values(certById);
      certsByFirmaId = buildCertificatesByFirmaId(dedupedCertificates);
      return {
        certificates: dedupedCertificates,
        certById,
        certsByFirmaId,
      };
    };
    const saveCertificateState = async (state) => {
      const certificates = Array.isArray(state?.certificates) ? state.certificates : [];
      const certById = state?.certById && typeof state.certById === "object" ? state.certById : buildCertificatesById(certificates);
      const certsByFirmaId = state?.certsByFirmaId && typeof state.certsByFirmaId === "object" ? state.certsByFirmaId : buildCertificatesByFirmaId(certificates);
      await Promise.all([
        env.DB.put("cache:getCertificates:{}", JSON.stringify(certificates), { expirationTtl: CACHE_TTL }),
        env.DB.put(indexKeys.certificateById, JSON.stringify(certById), { expirationTtl: CACHE_TTL }),
        env.DB.put(indexKeys.certsByFirmaId, JSON.stringify(certsByFirmaId), { expirationTtl: CACHE_TTL }),
      ]);
    };
    const getNextCertificateId = (certificates) => {
      const max = (Array.isArray(certificates) ? certificates : []).reduce((highest, certificate) => {
        const raw = parseInt(getCertificateId(certificate), 10);
        return !isNaN(raw) && raw > highest ? raw : highest;
      }, 0);
      return String(max + 1);
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
    const getCompanyConsultant = (record) => pickCompanyValue(record, ["Danışman", "Danisman", "dan", "danisman"]);
    const createCanonicalCompany = (source, options = {}) => {
      const input = source && typeof source === "object" ? source : {};
      const pick = getPicker(input);
      const id = String(options.id ?? getCompanyId(input) ?? "").trim();
      const nick = pick(["Firma Adı", "FirmaAdi", "nickname", "nick", "Nick"]);
      const unvan = pick(["Unvan", "unvan"]);
      const adres = pick(["Adres", "adres"]);
      const sehir = pick(["İl", "Il", "Şehir", "Sehir", "sehir", "il"]);
      const ulke = pick(["Ülke", "Ulke", "ulke"], "TÜRKİYE");
      const yazisma = pick(["Yazışma Adresi", "YazismaAdresi", "yazisma", "Şube Adresi"]);
      const vergiD = pick(["Vergi Dairesi", "VergiDairesi", "vergiD"]);
      const vergiN = pick(["Vergi Numarası", "VergiNumarasi", "vergiN"]);
      const tel = pick(["Telefon", "Tel", "tel"]);
      const faks = pick(["Faks", "faks"]);
      const www = pick(["İnternet", "Internet", "Web", "www", "web"]);
      const mail = pick(["Mail", "mail", "E-Posta"]);
      const yetA = pick(["Yetkili Adı", "YetkiliAdi", "yetA"]);
      const yetU = pick(["Yetkili Ünvanı", "Yetkili Unvani", "YetkiliUnvani", "yetU"]);
      const kyt = pick(["KYT", "Kalite Yönetim Temsilcisi", "kyt"]);
      const irtA = pick(["İrtibat Kişisi", "IrtibatKisi", "irtA"]);
      const irtU = pick(["İrtibat Ünvanı", "IrtibatUnvani", "irtU"]);
      const irtN = pick(["İrtibat Tel", "IrtibatKisiNumarasi", "irtN"]);
      const irtM = pick(["İrtibat Mail", "IrtibatKisisMail", "irtM"]);
      const kapsam = pick(["Türkçe Kapsam", "Sertifika Kapsamı (TR)", "Kapsam", "kapsam"]);
      const scope = pick(["İngilizce Kapsam", "Sertifika Kapsamı (EN)", "Scope", "scope"]);
      const yapis = pick(["Yapılan İş", "YapilanIs", "yapis"]);
      const tcs = pick(["Toplam Çalışan Sayısı", "TCS", "tcs"], "0");
      const ycs = pick(["Yönetim Çalışan Sayısı", "YCS", "ycs"], "0");
      const ucs = pick(["Üretim Çalışan Sayısı", "UCS", "ucs"], "0");
      const yzcs = pick(["Yarı Zamanlı Çalışan Sayısı", "YZCS", "yzcs"], "0");
      const tascs = pick(["Taşeron Çalışan Sayısı", "TASCS", "tascs"], "0");
      const alan = pick(["Alan", "alan"]);
      const dept = pick(["Departman", "departman", "dept"]);
      const vardiya = pick(["Vardiya", "vardiya"], "1");
      const logo = pick(["Firma Logosu", "LogoKaşe", "LogoKase", "logoK", "logo", "kase"]);
      const dan = pick(["Danışman", "Danisman", "dan", "danisman"]);
      const ea = pick(["EA", "ea"]);
      const nace = pick(["NACE", "nace"]);
      const not = pick(["Firma Not", "Not", "not"]);

      const canonical = {
        ...(input || {}),
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
        Alan: alan, alan,
        Departman: dept, departman: dept, dept,
        Vardiya: vardiya, vardiya,
        "Firma Logosu": logo, LogoKase: logo, logoK: logo, logo,
        "Danışman": dan, Danisman: dan, dan, danisman: dan,
        EA: ea, ea,
        NACE: nace, nace,
        "Firma Not": not, Not: not, not,
      };
      canonical.__etag = createEtag(canonical);
      return canonical;
    };
    const buildCompaniesById = (companies) => {
      const indexed = {};
      for (const company of Array.isArray(companies) ? companies : []) {
        const id = getCompanyId(company);
        if (!id) continue;
        indexed[id] = createCanonicalCompany(company, { id });
      }
      return indexed;
    };
    const buildConsultants = (companies) =>
      [...new Set((Array.isArray(companies) ? companies : [])
        .map((company) => getCompanyConsultant(company))
        .filter((value) => value && String(value).trim()))].sort((a, b) => String(a).localeCompare(String(b), "tr"));
    const loadCompanyState = async () => {
      if (!env.DB) return null;
      const [allRaw, byIdRaw] = await Promise.all([
        env.DB.get("cache:getCompanies:{}"),
        env.DB.get(indexKeys.companyById),
      ]);
      let companies = allRaw ? JSON.parse(allRaw) : null;
      let companiesById = byIdRaw ? JSON.parse(byIdRaw) : null;
      if (!Array.isArray(companies) && companiesById && typeof companiesById === "object") {
        companies = Object.values(companiesById);
      }
      if (!Array.isArray(companies)) return null;
      const canonicalCompanies = companies.map((company) => createCanonicalCompany(company)).filter((company) => getCompanyId(company));
      return { companies: canonicalCompanies, companiesById: buildCompaniesById(canonicalCompanies) };
    };
    const saveCompanyState = async (state) => {
      const companies = Array.isArray(state?.companies) ? state.companies : [];
      const companiesById = state?.companiesById && typeof state.companiesById === "object" ? state.companiesById : buildCompaniesById(companies);
      await Promise.all([
        env.DB.put("cache:getCompanies:{}", JSON.stringify(companies), { expirationTtl: CACHE_TTL }),
        env.DB.put(indexKeys.companyById, JSON.stringify(companiesById), { expirationTtl: CACHE_TTL }),
        env.DB.put("cache:getConsultants:{}", JSON.stringify(buildConsultants(companies)), { expirationTtl: CACHE_TTL }),
      ]);
    };
    const getNextCompanyId = (companies) => {
      const max = (Array.isArray(companies) ? companies : []).reduce((highest, company) => {
        const raw = parseInt(getCompanyId(company), 10);
        return !isNaN(raw) && raw > highest ? raw : highest;
      }, 0);
      return String(max + 1);
    };
    const createCanonicalTestRow = (source, options = {}) => {
      const input = source && typeof source === "object" ? source : {};
      const pick = getPicker(input);
      const id = String(options.id ?? pick(["ID", "id"]) ?? "").trim();
      return [
        id,
        pick(["firmaAdi", "fname", "nick"]),
        pick(["firmaNo", "fno"]),
        pick(["testAdi"]),
        pick(["marka"]),
        pick(["urun"]),
        pick(["urunKodu"]),
        pick(["urunNo"]),
        pick(["lot"]),
        pick(["urunKabul"]),
        pick(["kabulSaat"]),
        pick(["testBaslangic"]),
        pick(["testBitis"]),
        pick(["raporTarihi"]),
        pick(["raporNo"]),
        pick(["numuneSayisi"]),
        pick(["numuneUT"]),
        pick(["numuneSKT"]),
        pick(["urunBilgi"]),
        pick(["gorsel1"]),
        pick(["gorsel2"]),
        pick(["detay"]),
      ];
    };
    const getTestId = (row) => Array.isArray(row) ? String(row[0] ?? "").trim() : pickRowValue(row, ["ID", "id"]);
    const getTestFirmaId = (row) => Array.isArray(row) ? String(row[2] ?? "").trim() : pickRowValue(row, ["firmaNo", "fno"]);
    const buildTestsByFirmaId = (rows) => {
      const grouped = {};
      for (const row of Array.isArray(rows) ? rows : []) {
        const firmaId = getTestFirmaId(row);
        if (!firmaId) continue;
        if (!grouped[firmaId]) grouped[firmaId] = [];
        grouped[firmaId].push(row);
      }
      return grouped;
    };
    const loadTestState = async () => {
      if (!env.DB) return null;
      const indexedRaw = await env.DB.get(indexKeys.testsByFirmaId);
      if (!indexedRaw) return null;
      const testsByFirmaId = JSON.parse(indexedRaw) || {};
      const rows = Object.values(testsByFirmaId).flatMap((value) => Array.isArray(value) ? value : []);
      return { rows, testsByFirmaId: buildTestsByFirmaId(rows) };
    };
    const saveTestState = async (state) => {
      const rows = Array.isArray(state?.rows) ? state.rows : [];
      await env.DB.put(indexKeys.testsByFirmaId, JSON.stringify(buildTestsByFirmaId(rows)), { expirationTtl: CACHE_TTL });
    };
    const getNextTestId = (rows) => {
      const max = (Array.isArray(rows) ? rows : []).reduce((highest, row) => {
        const raw = parseInt(getTestId(row), 10);
        return !isNaN(raw) && raw > highest ? raw : highest;
      }, 0);
      return String(max + 1);
    };
    const createCanonicalProformaRow = (source, options = {}) => {
      const input = source && typeof source === "object" ? source : {};
      const pick = getPicker(input);
      const id = String(options.id ?? pick(["ID", "id", "Fatura No", "faturaNo"]) ?? "").trim();
      return [
        id,
        pick(["nick", "nickname", "firmaAdi"]),
        pick(["firmaNo", "fno"]),
        pick(["kdvsiz"], "0"),
        pick(["kdvOran"], "20"),
        pick(["kdv"], "0"),
        pick(["toplam"], "0"),
        pick(["birim", "lira"], "TL"),
        pick(["tarih"]),
        pick(["konu"]),
      ];
    };
    const getProformaId = (row) => Array.isArray(row) ? String(row[0] ?? "").trim() : pickRowValue(row, ["ID", "id", "Fatura No", "faturaNo"]);
    const getProformaFirmaId = (row) => Array.isArray(row) ? String(row[2] ?? "").trim() : pickRowValue(row, ["firmaNo", "fno"]);
    const buildProformasByFirmaId = (rows) => {
      const grouped = {};
      for (const row of Array.isArray(rows) ? rows : []) {
        const firmaId = getProformaFirmaId(row);
        if (!firmaId) continue;
        if (!grouped[firmaId]) grouped[firmaId] = [];
        grouped[firmaId].push(row);
      }
      return grouped;
    };
    const buildProformasById = (rows) => {
      const indexed = {};
      for (const row of Array.isArray(rows) ? rows : []) {
        const id = getProformaId(row);
        if (!id) continue;
        indexed[id] = row;
      }
      return indexed;
    };
    const loadProformaState = async () => {
      if (!env.DB) return null;
      const [byFirmaRaw, byIdRaw] = await Promise.all([
        env.DB.get(indexKeys.proformasByFirmaId),
        env.DB.get(indexKeys.proformasById),
      ]);
      let rows = [];
      const proformasById = byIdRaw ? JSON.parse(byIdRaw) : null;
      const proformasByFirmaId = byFirmaRaw ? JSON.parse(byFirmaRaw) : null;
      if (proformasById && typeof proformasById === "object") rows = Object.values(proformasById);
      else if (proformasByFirmaId && typeof proformasByFirmaId === "object") rows = Object.values(proformasByFirmaId).flatMap((value) => Array.isArray(value) ? value : []);
      if (!Array.isArray(rows)) return null;
      return { rows, proformasByFirmaId: buildProformasByFirmaId(rows), proformasById: buildProformasById(rows) };
    };
    const saveProformaState = async (state) => {
      const rows = Array.isArray(state?.rows) ? state.rows : [];
      await Promise.all([
        env.DB.put(indexKeys.proformasByFirmaId, JSON.stringify(buildProformasByFirmaId(rows)), { expirationTtl: CACHE_TTL }),
        env.DB.put(indexKeys.proformasById, JSON.stringify(buildProformasById(rows)), { expirationTtl: CACHE_TTL }),
      ]);
    };
    const getNextProformaId = (rows) => {
      const max = (Array.isArray(rows) ? rows : []).reduce((highest, row) => {
        const raw = parseInt(getProformaId(row), 10);
        return !isNaN(raw) && raw > highest ? raw : highest;
      }, 0);
      return String(max + 1);
    };
    const getAuditId = (row) => Array.isArray(row) ? String(row[0] ?? "").trim() : pickRowValue(row, ["id", "ID"]);
    const getAuditFirmaId = (row) => Array.isArray(row) ? String(row[2] ?? "").trim() : pickRowValue(row, ["firmaNo", "firmano"]);
    const createCanonicalAuditRow = (source, options = {}) => {
      const input = source && typeof source === "object" ? source : {};
      const pick = getPicker(input);
      const id = String(options.id ?? getAuditId(input) ?? "").trim();
      return [
        id,
        pick(["nick", "nickname"]),
        pick(["firmano", "firmaNo"]),
        pick(["standart"]),
        pick(["denetim", "denetimTipi"]),
        pick(["a1Full", "a1Denetci"]),
        pick(["a1Auditor", "a1Denetci", "a1Full"]),
        pick(["a2Full", "a2Denetci"]),
        pick(["a2Auditor", "a2Denetci", "a2Full"]),
        pick(["a1Basla", "a1Baslav2"]),
        pick(["a1Bitis", "a1Bitisv2"]),
        pick(["a1Md"]),
        pick(["a1La", "a1Lead"]),
        pick(["a1Fa"]),
        pick(["a1Sa"]),
        pick(["a2Basla", "a2Baslav2"]),
        pick(["a2Bitis", "a2Bitisv2"]),
        pick(["a2Md"]),
        pick(["a2La", "a2Lead"]),
        pick(["a2Fa"]),
        pick(["a2Sa"]),
        pick(["qms"]),
        pick(["mdd"]),
        pick(["ems"]),
        pick(["ohs"]),
        pick(["fsms"]),
        pick(["isms"]),
        pick(["engy"]),
        pick(["gmp"]),
        pick(["a1kDenet"]),
        pick(["a2kDenet"]),
        pick(["a1EventId"]),
        pick(["a2EventId"]),
      ];
    };
    const auditRowToInfo = (row) => ({
      id: row[0] ?? "", nick: row[1] ?? "", firmano: row[2] ?? "", firmaNo: row[2] ?? "", standart: row[3] ?? "",
      denetim: row[4] ?? "", denetimTipi: row[4] ?? "", a1Full: row[5] ?? "", a1Denetci: row[6] ?? row[5] ?? "",
      a2Full: row[7] ?? "", a2Denetci: row[8] ?? row[7] ?? "", a1Basla: row[9] ?? "", a1Bitis: row[10] ?? "",
      a1Md: row[11] ?? "", a1La: row[12] ?? "", a1Lead: row[12] ?? "", a1Fa: row[13] ?? "", a1Sa: row[14] ?? "",
      a2Basla: row[15] ?? "", a2Bitis: row[16] ?? "", a2Md: row[17] ?? "", a2La: row[18] ?? "", a2Lead: row[18] ?? "",
      a2Fa: row[19] ?? "", a2Sa: row[20] ?? "", qms: row[21] ?? "", mdd: row[22] ?? "", ems: row[23] ?? "",
      ohs: row[24] ?? "", fsms: row[25] ?? "", isms: row[26] ?? "", engy: row[27] ?? "", gmp: row[28] ?? "",
      a1kDenet: row[29] ?? "", a2kDenet: row[30] ?? "", a1EventId: row[31] ?? "", a2EventId: row[32] ?? "",
    });
    const buildAuditsByFirmaId = (rows) => {
      const grouped = {};
      for (const row of Array.isArray(rows) ? rows : []) {
        const firmaId = getAuditFirmaId(row);
        if (!firmaId) continue;
        if (!grouped[firmaId]) grouped[firmaId] = [];
        grouped[firmaId].push(row);
      }
      return grouped;
    };
    const buildAuditObjects = (rows) => (Array.isArray(rows) ? rows : []).map((row) => mapLegacyAuditRow(row)).reverse();
    const loadAuditState = async () => {
      if (!env.DB) return null;
      const indexedRaw = await env.DB.get(indexKeys.auditsByFirmaId);
      if (!indexedRaw) return null;
      const auditsByFirmaId = JSON.parse(indexedRaw) || {};
      const rows = Object.values(auditsByFirmaId).flatMap((value) => Array.isArray(value) ? value : []);
      return { rows, auditsByFirmaId: buildAuditsByFirmaId(rows) };
    };
    const saveAuditState = async (state) => {
      const rows = Array.isArray(state?.rows) ? state.rows : [];
      await Promise.all([
        env.DB.put(indexKeys.auditsByFirmaId, JSON.stringify(buildAuditsByFirmaId(rows)), { expirationTtl: CACHE_TTL }),
        env.DB.put("cache:getAudits:{}", JSON.stringify(buildAuditObjects(rows)), { expirationTtl: CACHE_TTL }),
      ]);
    };
    const getNextAuditId = (rows) => {
      const max = (Array.isArray(rows) ? rows : []).reduce((highest, row) => {
        const raw = parseInt(getAuditId(row), 10);
        return !isNaN(raw) && raw > highest ? raw : highest;
      }, 0);
      return String(max + 1);
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
      certificateById: "cache:index:certificateById",
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

        // ⚡ YOĞUN OKUMA AKSİYONLARI (Cacheable)
        const cacheableActions = [
          "getCompanies",
          "getCompanyById",
          "getCertificates",
          "getCertificateById",
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
        const rawCachePassthroughActions = new Set([
          "getCompanies",
          "getCertificates",
          "getRecentCertificates",
          "getConsultants",
          "getMasterData",
          "getFolderId",
          "getRecentFiles"
        ]);
        const gasWriteActions = [
          "editCell",
          "importBackup"
        ];

        // 🔑 KV Cache Key
        const cacheKey = `cache:${action}:${stableStringify(params)}`;

        // 1. KV'den Kontrol Et (Eğer DB binding varsa)
        if (env.DB && cacheableActions.includes(action)) {
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

          // Bulk sync ile önceden yazılan indeks cache'lerini fallback olarak kullan.
          const idParam = params?.id ?? params?.firmaId;
          if (idParam !== undefined && idParam !== null) {
            const idKey = String(idParam);
            let indexCacheKey = null;
            let emptyValue = null;

            if (action === "getCompanyById") {
              indexCacheKey = indexKeys.companyById;
            } else if (action === "getCertificateById") {
              indexCacheKey = indexKeys.certificateById;
              emptyValue = null;
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
                const hasIndexedValue = Object.prototype.hasOwnProperty.call(indexed, idKey);
                const data = hasIndexedValue ? indexed[idKey] : emptyValue;
                if (hasIndexedValue || Array.isArray(data)) {
                  ctx.waitUntil(env.DB.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL }));
                }
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
            });
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
              const canonicalCompanies = companies.map((company) => createCanonicalCompany(company)).filter((company) => getCompanyId(company));
              const canonicalCertificates = [
                ...certificates,
                ...certificateRows,
              ]
                .map((certificate) => createCanonicalCertificate(certificate))
                .filter((certificate) => getCertificateId(certificate));
              const certById = buildCertificatesById(canonicalCertificates);
              const dedupedCertificates = Object.values(certById);
              const certsByFirmaId = buildCertificatesByFirmaId(dedupedCertificates);

              const companiesById = buildCompaniesById(canonicalCompanies);

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
                env.DB.put(`cache:getCompanies:{}`, JSON.stringify(canonicalCompanies), { expirationTtl: CACHE_TTL }),
                env.DB.put(`cache:getCertificates:{}`, JSON.stringify(dedupedCertificates), { expirationTtl: CACHE_TTL }),
                env.DB.put(`cache:getAudits:{}`, JSON.stringify(auditObjects), { expirationTtl: CACHE_TTL }),
                env.DB.put(`cache:getConsultants:{}`, JSON.stringify(consultants), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.companyById, JSON.stringify(companiesById), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.certificateById, JSON.stringify(certById), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.certsByFirmaId, JSON.stringify(certsByFirmaId), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.testsByFirmaId, JSON.stringify(testsByFirmaId), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.auditsByFirmaId, JSON.stringify(auditsByFirmaId), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.proformasByFirmaId, JSON.stringify(proformasByFirmaId), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.proformasById, JSON.stringify(proformasById), { expirationTtl: CACHE_TTL }),
                env.DB.put(indexKeys.standardsById, JSON.stringify(standardsById), { expirationTtl: CACHE_TTL }),
              ]);
              ctx.waitUntil(Promise.all([
                purgeCachePrefix("cache:getCertificateById:"),
                purgeCachePrefix("cache:getCertificatesByFirmaId:"),
                purgeCachePrefix("cache:getRecentCertificates:"),
              ]));

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

        if (env.DB && ["addCompany", "updateCompany"].includes(action)) {
          const state = await loadCompanyState();
          if (!state) {
            return jsonResponse({ success: false, error: "COMPANY_KV_EMPTY", message: "Firma KV verisi boş. Önce manuel Sheets -> KV senkronizasyonu yapın." });
          }

          const nextState = {
            companies: [...state.companies],
            companiesById: { ...state.companiesById },
          };

          if (action === "addCompany") {
            const newId = getNextCompanyId(nextState.companies);
            const created = createCanonicalCompany(params?.companyInfo || {}, { id: newId });
            nextState.companies.push(created);
            nextState.companiesById[newId] = created;
            await saveCompanyState(nextState);
            await env.DB.put(`cache:getCompanyById:${stableStringify({ id: newId })}`, JSON.stringify(created), { expirationTtl: CACHE_TTL });
            return jsonResponse({ success: true, data: { id: newId, company: created }, id: newId, kvPrimaryWrite: true, sheetsWrite: false });
          }

          const targetId = String(params?.id || "").trim();
          if (!targetId) {
            return jsonResponse({ success: false, error: "Firma ID boş olamaz." }, 400);
          }

          const existing = nextState.companiesById[targetId];
          if (!existing) {
            return jsonResponse({ success: false, error: `Firma bulunamadı: ${targetId}` }, 404);
          }

          const currentEtag = String(existing.__etag || createEtag(existing));
          const expectedEtag = String(params?.expectedEtag || "").trim();
          if (expectedEtag && expectedEtag !== currentEtag) {
            return jsonResponse({ success: false, error: "CONFLICT", currentEtag }, 409);
          }

          const updated = createCanonicalCompany({ ...existing, ...(params?.companyInfo || {}) }, { id: targetId });
          nextState.companies = nextState.companies.map((company) => getCompanyId(company) === targetId ? updated : company);
          nextState.companiesById[targetId] = updated;
          await saveCompanyState(nextState);
          await env.DB.put(`cache:getCompanyById:${stableStringify({ id: targetId })}`, JSON.stringify(updated), { expirationTtl: CACHE_TTL });
          return jsonResponse({ success: true, data: { etag: updated.__etag, company: updated }, kvPrimaryWrite: true, sheetsWrite: false });
        }

        if (env.DB && ["addTest", "updateTest"].includes(action)) {
          const state = await loadTestState();
          if (!state) {
            return jsonResponse({ success: false, error: "TEST_KV_EMPTY", message: "Test KV verisi boş. Önce manuel Sheets -> KV senkronizasyonu yapın." });
          }

          const nextState = { rows: [...state.rows] };

          if (action === "addTest") {
            const newId = getNextTestId(nextState.rows);
            const created = createCanonicalTestRow(params?.testInfo || {}, { id: newId });
            nextState.rows.push(created);
            await saveTestState(nextState);
            const firmaId = getTestFirmaId(created);
            if (firmaId) {
              await env.DB.put(`cache:getTestsByFirmaId:${stableStringify({ firmaId })}`, JSON.stringify(buildTestsByFirmaId(nextState.rows)[firmaId] || []), { expirationTtl: CACHE_TTL });
            }
            return jsonResponse({ success: true, data: { id: newId, row: created }, id: newId, kvPrimaryWrite: true, sheetsWrite: false });
          }

          const targetId = String(params?.id || "").trim();
          if (!targetId) {
            return jsonResponse({ success: false, error: "Test ID boş olamaz." }, 400);
          }
          const rowIndex = nextState.rows.findIndex((row) => getTestId(row) === targetId);
          if (rowIndex === -1) {
            return jsonResponse({ success: false, error: `Test bulunamadı: ${targetId}` }, 404);
          }

          const current = nextState.rows[rowIndex];
          const updated = createCanonicalTestRow({
            id: targetId,
            firmaAdi: current[1] ?? "",
            fname: current[1] ?? "",
            firmaNo: current[2] ?? "",
            fno: current[2] ?? "",
            testAdi: current[3] ?? "",
            marka: current[4] ?? "",
            urun: current[5] ?? "",
            urunKodu: current[6] ?? "",
            urunNo: current[7] ?? "",
            lot: current[8] ?? "",
            urunKabul: current[9] ?? "",
            kabulSaat: current[10] ?? "",
            testBaslangic: current[11] ?? "",
            testBitis: current[12] ?? "",
            raporTarihi: current[13] ?? "",
            raporNo: current[14] ?? "",
            numuneSayisi: current[15] ?? "",
            numuneUT: current[16] ?? "",
            numuneSKT: current[17] ?? "",
            urunBilgi: current[18] ?? "",
            gorsel1: current[19] ?? "",
            gorsel2: current[20] ?? "",
            detay: current[21] ?? "",
            ...(params?.testInfo || {})
          }, { id: targetId });
          nextState.rows[rowIndex] = updated;
          await saveTestState(nextState);
          const grouped = buildTestsByFirmaId(nextState.rows);
          const writes = [];
          const prevFirmaId = getTestFirmaId(current);
          const nextFirmaId = getTestFirmaId(updated);
          if (prevFirmaId) {
            writes.push(env.DB.put(`cache:getTestsByFirmaId:${stableStringify({ firmaId: prevFirmaId })}`, JSON.stringify(grouped[prevFirmaId] || []), { expirationTtl: CACHE_TTL }));
          }
          if (nextFirmaId && nextFirmaId !== prevFirmaId) {
            writes.push(env.DB.put(`cache:getTestsByFirmaId:${stableStringify({ firmaId: nextFirmaId })}`, JSON.stringify(grouped[nextFirmaId] || []), { expirationTtl: CACHE_TTL }));
          }
          await Promise.all(writes);
          return jsonResponse({ success: true, data: { id: targetId, row: updated }, kvPrimaryWrite: true, sheetsWrite: false });
        }

        if (env.DB && ["addProforma", "addProInfo"].includes(action)) {
          const state = await loadProformaState();
          if (!state) {
            return jsonResponse({ success: false, error: "PROFORMA_KV_EMPTY", message: "Proforma KV verisi boş. Önce manuel Sheets -> KV senkronizasyonu yapın." });
          }

          const newId = getNextProformaId(state.rows);
          const created = createCanonicalProformaRow(params?.proInfo || {}, { id: newId });
          const nextRows = [...state.rows, created];
          const firmaId = getProformaFirmaId(created);
          await saveProformaState({ rows: nextRows });
          await Promise.all([
            env.DB.put(`cache:getProformaById:${stableStringify({ id: newId })}`, JSON.stringify(created), { expirationTtl: CACHE_TTL }),
            firmaId
              ? env.DB.put(`cache:getProformaByFirmaId:${stableStringify({ firmaId })}`, JSON.stringify(buildProformasByFirmaId(nextRows)[firmaId] || []), { expirationTtl: CACHE_TTL })
              : Promise.resolve(),
          ]);
          return jsonResponse({ success: true, data: { id: newId, row: created }, id: newId, kvPrimaryWrite: true, sheetsWrite: false });
        }

        if (env.DB && ["scheduleAudit", "updateAudit"].includes(action)) {
          const state = await loadAuditState();
          if (!state) {
            return jsonResponse({ success: false, error: "AUDIT_KV_EMPTY", message: "Denetim KV verisi boş. Önce manuel Sheets -> KV senkronizasyonu yapın." });
          }

          if (action === "scheduleAudit") {
            const newId = getNextAuditId(state.rows);
            const created = createCanonicalAuditRow(params?.data || {}, { id: newId });
            const nextRows = [...state.rows, created];
            const grouped = buildAuditsByFirmaId(nextRows);
            const firmaId = getAuditFirmaId(created);
            await saveAuditState({ rows: nextRows });
            if (firmaId) {
              await env.DB.put(`cache:getAuditsByFirmaId:${stableStringify({ firmaId })}`, JSON.stringify(grouped[firmaId] || []), { expirationTtl: CACHE_TTL });
            }
            return jsonResponse({ success: true, data: { id: newId, row: created }, id: newId, kvPrimaryWrite: true, sheetsWrite: false, sideEffectsSkipped: true });
          }

          const targetId = String(params?.id || "").trim();
          if (!targetId) {
            return jsonResponse({ success: false, error: "Denetim ID boş olamaz." }, 400);
          }
          const nextRows = [...state.rows];
          const rowIndex = nextRows.findIndex((row) => getAuditId(row) === targetId);
          if (rowIndex === -1) {
            return jsonResponse({ success: false, error: `Denetim bulunamadı: ${targetId}` }, 404);
          }

          const current = nextRows[rowIndex];
          const updated = createCanonicalAuditRow({ ...auditRowToInfo(current), ...(params?.data || params?.auditInfo || {}) }, { id: targetId });
          nextRows[rowIndex] = updated;
          const grouped = buildAuditsByFirmaId(nextRows);
          const writes = [];
          const prevFirmaId = getAuditFirmaId(current);
          const nextFirmaId = getAuditFirmaId(updated);
          await saveAuditState({ rows: nextRows });
          if (prevFirmaId) {
            writes.push(env.DB.put(`cache:getAuditsByFirmaId:${stableStringify({ firmaId: prevFirmaId })}`, JSON.stringify(grouped[prevFirmaId] || []), { expirationTtl: CACHE_TTL }));
          }
          if (nextFirmaId && nextFirmaId !== prevFirmaId) {
            writes.push(env.DB.put(`cache:getAuditsByFirmaId:${stableStringify({ firmaId: nextFirmaId })}`, JSON.stringify(grouped[nextFirmaId] || []), { expirationTtl: CACHE_TTL }));
          }
          await Promise.all(writes);
          return jsonResponse({ success: true, data: { id: targetId, row: updated }, kvPrimaryWrite: true, sheetsWrite: false, sideEffectsSkipped: true });
        }

        if (env.DB && ["addCertificate", "updateCertificate", "updateCertificateField", "updateGozetim"].includes(action)) {
          const state = await loadCertificateState();
          if (!state) {
            return jsonResponse({
              success: false,
              error: "CERTIFICATE_KV_EMPTY",
              message: "Sertifika KV verisi boş. Önce manuel Sheets -> KV senkronizasyonu yapın."
            });
          }

          const nextState = {
            certificates: [...state.certificates],
            certById: { ...state.certById },
            certsByFirmaId: { ...state.certsByFirmaId },
          };

          if (action === "addCertificate") {
            const newId = getNextCertificateId(nextState.certificates);
            const created = createCanonicalCertificate(params?.certInfo || {}, { id: newId });
            nextState.certificates.push(created);
            nextState.certById[newId] = created;
            const createdFirmaId = getCertificateFirmaId(created);
            if (createdFirmaId) {
              nextState.certsByFirmaId[createdFirmaId] = [...(nextState.certsByFirmaId[createdFirmaId] || []), created];
            }
            await saveCertificateState(nextState);
            await Promise.all([
              env.DB.put(`cache:getCertificateById:${stableStringify({ id: newId })}`, JSON.stringify(created), { expirationTtl: CACHE_TTL }),
              createdFirmaId
                ? env.DB.put(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId: createdFirmaId })}`, JSON.stringify(nextState.certsByFirmaId[createdFirmaId]), { expirationTtl: CACHE_TTL })
                : Promise.resolve(),
            ]);
            ctx.waitUntil(purgeCachePrefix("cache:getRecentCertificates:"));
            return jsonResponse({ success: true, data: { id: newId, certificate: created }, id: newId, kvPrimaryWrite: true, sheetsWrite: false });
          }

          const targetId = String(params?.id || "").trim();
          if (!targetId) {
            return jsonResponse({ success: false, error: "Sertifika ID boş olamaz." }, 400);
          }

          const existing = nextState.certById[targetId];
          if (!existing) {
            return jsonResponse({ success: false, error: `Sertifika bulunamadı: ${targetId}` }, 404);
          }

          let updated = existing;
          if (action === "updateCertificate") {
            updated = createCanonicalCertificate({ ...existing, ...(params?.certInfo || {}) }, { id: targetId });
          } else if (action === "updateCertificateField") {
            const field = String(params?.field || "").trim();
            if (!field) {
              return jsonResponse({ success: false, error: "Alan adı boş olamaz." }, 400);
            }
            updated = createCanonicalCertificate({ ...existing, [field]: params?.value }, { id: targetId });
          } else if (action === "updateGozetim") {
            const status = params?.status === true || String(params?.status || "").toUpperCase() === "TRUE" ? "TRUE" : "FALSE";
            updated = createCanonicalCertificate({ ...existing, "Gözetim Conf.": status, gozetimConfirmed: status }, { id: targetId });
          }

          const previousFirmaId = getCertificateFirmaId(existing);
          const nextFirmaId = getCertificateFirmaId(updated);
          nextState.certificates = nextState.certificates.map((certificate) => getCertificateId(certificate) === targetId ? updated : certificate);
          nextState.certById[targetId] = updated;
          nextState.certsByFirmaId = buildCertificatesByFirmaId(nextState.certificates);

          await saveCertificateState(nextState);

          const cacheWrites = [
            env.DB.put(`cache:getCertificateById:${stableStringify({ id: targetId })}`, JSON.stringify(updated), { expirationTtl: CACHE_TTL }),
          ];
          if (previousFirmaId) {
            cacheWrites.push(
              env.DB.put(
                `cache:getCertificatesByFirmaId:${stableStringify({ firmaId: previousFirmaId })}`,
                JSON.stringify(nextState.certsByFirmaId[previousFirmaId] || []),
                { expirationTtl: CACHE_TTL }
              )
            );
          }
          if (nextFirmaId && nextFirmaId !== previousFirmaId) {
            cacheWrites.push(
              env.DB.put(
                `cache:getCertificatesByFirmaId:${stableStringify({ firmaId: nextFirmaId })}`,
                JSON.stringify(nextState.certsByFirmaId[nextFirmaId] || []),
                { expirationTtl: CACHE_TTL }
              )
            );
          }
          if (nextFirmaId && nextFirmaId === previousFirmaId) {
            cacheWrites.push(
              env.DB.put(
                `cache:getCertificatesByFirmaId:${stableStringify({ firmaId: nextFirmaId })}`,
                JSON.stringify(nextState.certsByFirmaId[nextFirmaId] || []),
                { expirationTtl: CACHE_TTL }
              )
            );
          }
          await Promise.all(cacheWrites);
          ctx.waitUntil(purgeCachePrefix("cache:getRecentCertificates:"));
          return jsonResponse({ success: true, data: { id: targetId, certificate: updated }, kvPrimaryWrite: true, sheetsWrite: false });
        }

        if (env.DB && action === "updateSurveillance") {
          const state = await loadCertificateState();
          if (!state) {
            return jsonResponse({ success: false, error: "CERTIFICATE_KV_EMPTY", message: "Sertifika KV verisi boş. Önce manuel Sheets -> KV senkronizasyonu yapın." });
          }

          const ids = Array.isArray(params?.ids) ? params.ids.map((id) => String(id).trim()).filter(Boolean) : [];
          if (!ids.length) {
            return jsonResponse({ success: false, error: "Güncellenecek sertifika ID listesi boş." }, 400);
          }

          const status = params?.status === true || String(params?.status || "").toUpperCase() === "TRUE" ? "TRUE" : "FALSE";
          const nextCertificates = state.certificates.map((certificate) => {
            const id = getCertificateId(certificate);
            if (!ids.includes(id)) return certificate;
            return createCanonicalCertificate({ ...certificate, "Gözetim Conf.": status, gozetimConfirmed: status }, { id });
          });
          const nextState = {
            certificates: nextCertificates,
            certById: buildCertificatesById(nextCertificates),
            certsByFirmaId: buildCertificatesByFirmaId(nextCertificates),
          };
          await saveCertificateState(nextState);

          const touchedFirmaIds = [...new Set(ids.map((id) => getCertificateFirmaId(nextState.certById[id])).filter(Boolean))];
          const writes = ids.map((id) => nextState.certById[id]
            ? env.DB.put(`cache:getCertificateById:${stableStringify({ id })}`, JSON.stringify(nextState.certById[id]), { expirationTtl: CACHE_TTL })
            : Promise.resolve());
          touchedFirmaIds.forEach((firmaId) => {
            writes.push(env.DB.put(`cache:getCertificatesByFirmaId:${stableStringify({ firmaId })}`, JSON.stringify(nextState.certsByFirmaId[firmaId] || []), { expirationTtl: CACHE_TTL }));
          });
          await Promise.all(writes);
          ctx.waitUntil(purgeCachePrefix("cache:getRecentCertificates:"));
          return jsonResponse({ success: true, data: { updatedCount: ids.length, ids, status }, kvPrimaryWrite: true, sheetsWrite: false, sideEffectsSkipped: true });
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

        // 🧹 GAS üzerinden yazan legacy aksiyonlar sonrası ilgili KV key'lerini temizle
        if (env.DB && result.success && gasWriteActions.includes(action)) {
          if (action === "importBackup") {
            ctx.waitUntil(purgeCachePrefix("cache:"));
            return jsonResponse(result);
          }
          if (action === "editCell") {
            const invalidateKeys = new Set([
              "cache:getCertificates:{}",
              `cache:getRecentCertificates:${stableStringify({ limit: 25 })}`,
              "cache:getRecentCertificates:{}",
              indexKeys.certsByFirmaId,
              indexKeys.certificateById,
            ]);
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
