/**
 * 🛰️ Medicert Tenant Worker Extension
 * Multi-parameter support for Legacy and New Lookups
 */

const normalizeForSearch = (text) => {
  if (!text) return "";
  let str = String(text).trim().replace(/\s+/g, " ");
  const chars = {
    "ş": "s", "ğ": "g", "ü": "u", "ö": "o", "ç": "c", "ı": "i",
    "İ": "i", "Ş": "s", "Ğ": "g", "Ü": "u", "Ö": "o", "Ç": "c", "I": "i"
  };
  str = str.replace(/[iışğüçöİIŞĞÜÖÇ]/g, (m) => chars[m] || m);
  return str.toLowerCase();
};

const parseDateString = (str) => {
  const raw = String(str || "").trim();
  if (!raw) return null;
  // Format: DD.MM.YYYY
  const m = raw.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  if (m) {
    return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
  }
  // Format: YYYY-MM-DD
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
  }
  return null;
};

const createResponse = (payload, status = 200) => {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
};

const hasRenderableCertificateFields = (row) => {
  return Boolean(
    row &&
    row.company &&
    row.address &&
    row.city &&
    row.country &&
    row.standard &&
    row.number &&
    row.certDate &&
    row.surveillanceDate
  );
};

const OTHER_STANDARD_TOKENS = new Set(["other", "others", "diger"]);

const buildStandardLookupContext = async (env, inputStandard) => {
  const rawStandard = String(inputStandard || "").trim();
  const normalizedInput = normalizeForSearch(rawStandard);
  let dbStandardCode = rawStandard;
  let kvStandardKey = normalizedInput;
  const standardNames = new Set([rawStandard]);

  if (OTHER_STANDARD_TOKENS.has(normalizedInput)) {
    dbStandardCode = "Diğer";
    kvStandardKey = normalizeForSearch(dbStandardCode);
    standardNames.add("Diğer");
    standardNames.add("Others");
    standardNames.add("Other");
  }

  const stdRecord = await env.DB_D1.prepare(
    `SELECT kod, tam_ad FROM standards WHERE tam_ad = ? OR kod = ? OR kisaltma = ?`
  ).bind(rawStandard, rawStandard, rawStandard).first();

  if (stdRecord) {
    dbStandardCode = stdRecord.kod || dbStandardCode;
    kvStandardKey = normalizeForSearch(dbStandardCode);
    if (stdRecord.kod) standardNames.add(stdRecord.kod);
    if (stdRecord.tam_ad) standardNames.add(stdRecord.tam_ad);
  }

  return {
    dbStandardCode,
    kvStandardKey,
    standardNameCandidates: Array.from(standardNames).filter(Boolean),
  };
};

export const TenantLookupHandlers = {
  sertifikaSorgula: async (p, ctx, env) => {
    try {
      // Hem yeni hem eski parametre isimlerini destekle
      const certNo = normalizeForSearch(p?.sertifikaNo || p?.certNo || p?.certificateNumber || p?.numara || "");
      const std = normalizeForSearch(p?.standart || p?.standard || "");
      const company = normalizeForSearch(p?.firma || p?.company || p?.companyName || "");

      if (!certNo || !std) return createResponse({ success: false, error: "CERTNO_AND_STANDARD_REQUIRED" }, 400);

      // 1. Önce gelen standart isminden asıl kodu bulmaya çalış (KV eşleşmesi için kritik)
      const standardContext = await buildStandardLookupContext(env, p.standart || p.standard);
      const searchStd = standardContext.kvStandardKey;
      const dbStandardCode = standardContext.dbStandardCode;
      const standardNameCandidates = standardContext.standardNameCandidates;

      // 1. Layer: KV (Edge) - Artık kod üzerinden arıyoruz
      const cachedStr = await env.DB.get(`idx:cert:${searchStd}:${certNo}`);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (cachedStr) {
        try {
          const cachedData = JSON.parse(cachedStr);
          const dataToCheck = cachedData.data || cachedData;
          const gozDate = parseDateString(dataToCheck.surveillanceDate || dataToCheck.gozetim_tarihi);
          
          if (gozDate && gozDate < today) {
            // Süresi geçmiş, cache'den sil ve yokmuş gibi davran
            ctx.waitUntil(env.DB.delete(`idx:cert:${searchStd}:${certNo}`));
          } else {
            // ÖNEMLİ: Cache'den gelen veri eski formatta olabilir (DD.MM.YYYY). 
            // Sunmadan önce her zaman güncel formata (YYYY-MM-DD) ve doğru field isimlerine çekiyoruz.
            const formatDate = (dateStr) => {
              if (!dateStr || !dateStr.includes(".")) return dateStr;
              const parts = dateStr.split(".");
              if (parts.length !== 3) return dateStr;
              return `${parts[2]}-${parts[1]}-${parts[0]}`;
            };

            const row = dataToCheck;
            row.gecerlilik_tarihi = row.gozetim_tarihi || row.surveillanceDate || row.gecerlilik_tarihi;
            row.durum = row.durum || "GEÇERLİ";
            
            row.sertifika_tarihi = formatDate(row.sertifika_tarihi || row.certDate);
            row.gozetim_tarihi = formatDate(row.gozetim_tarihi || row.surveillanceDate);
            row.gecerlilik_tarihi = formatDate(row.gecerlilik_tarihi);

            // Arayüzün beklediği alias'lar
            row.certDate = row.sertifika_tarihi;
            row.surveillanceDate = row.gecerlilik_tarihi;
            row.accreditation = row.accreditation || row.akreditasyon;
            row.company = row.company || row.unvan || row.nickname || row.nick;
            row.number = row.number || row.sertifika_no;
            row.standard = row.standard_full || row.standart || row.standard || p.standart;

            // Eski KV payload'lari arayuzun bekledigi alanlarin bir kismini
            // hic tasimiyor. Bu durumda eksik veri donmek yerine D1'e dusuyoruz.
            if (!hasRenderableCertificateFields(row)) {
              throw new Error("KV_PAYLOAD_INCOMPLETE");
            }

            const finalResp = JSON.stringify(row);
            return new Response(finalResp, { 
              headers: { 
                "Content-Type": "application/json", 
                "X-Lookup-Source": "KV-Corrected", 
                "Access-Control-Allow-Origin": "*" 
              } 
            });
          }
        } catch (e) {
          // Parse hatası durumunda devam et (D1'den bakar)
        }
      }

      // 2. Layer: D1 (Database) - GAS ile birebir aynı field isimlerini dönmek kritik
      const inputCertNo = p.sertifikaNo || p.certNo || p.certificateNumber || p.numara || "";
      const row = await env.DB_D1.prepare(`
        SELECT 
          c.sertifika_no,
          c.sertifika_tarihi,
          c.gozetim_tarihi,
          c.gecerlilik_tarihi,
          c.kapsam,
          c.scope,
          c.akreditasyon,
          c.durum,
          co.unvan as company,
          co.nickname,
          co.ulke as country,
          co.adres as address,
          co.city,
          c.standart,
          s.tam_ad as standard_full
        FROM certificates c 
        LEFT JOIN companies co ON co.id = c.firma_no 
        LEFT JOIN standards s ON s.kod = c.standart
        WHERE (
          LOWER(c.sertifika_no) = LOWER(?) 
          OR REPLACE(LOWER(c.sertifika_no), ' ', '') = REPLACE(LOWER(?), ' ', '')
          OR REPLACE(LOWER(c.sertifika_no), '-', '') = REPLACE(LOWER(?), '-', '')
        )
        AND (
          c.standart = ? 
          OR s.tam_ad IN (${standardNameCandidates.map(() => "?").join(", ")})
          OR s.kod = ? 
          OR LOWER(c.other_standart) LIKE LOWER(?)
        )
        AND (c.gozetim_confirmed != 1 OR c.gozetim_confirmed IS NULL)
        AND (c.durum IS NULL OR (UPPER(c.durum) NOT LIKE 'İPTAL%' AND UPPER(c.durum) NOT LIKE 'PASİF%' AND UPPER(c.durum) NOT LIKE 'ASKI%'))
        ORDER BY c.id DESC
      `).bind(
        inputCertNo, inputCertNo, inputCertNo,
        dbStandardCode,
        ...standardNameCandidates,
        dbStandardCode,
        `%${p.standart || p.standard}%`
      ).first();

      if (row) {
        // Tarih formatlama yardımcısı
        const formatDate = (dateStr) => {
          if (!dateStr || !dateStr.includes(".")) return dateStr;
          const parts = dateStr.split(".");
          if (parts.length !== 3) return dateStr;
          // DD.MM.YYYY -> YYYY-MM-DD
          return `${parts[2]}-${parts[1]}-${parts[0]}`;
        };

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const gozDate = parseDateString(row.gozetim_tarihi);
        if (gozDate && gozDate < today) {
           return createResponse({ success: false, error: "CERTIFICATE_EXPIRED" }, 404);
        }

        // Kullanıcının isteği: Gözetim tarihini (2027) ana geçerlilik olarak kullan
        row.gecerlilik_tarihi = row.gozetim_tarihi;
        
        // Frontend "durum" alanının "GEÇERLİ" olmasını bekliyor.
        row.durum = row.durum || "GEÇERLİ";
        
        // Tüm tarihleri frontend dostu formatta dönüyoruz
        row.sertifika_tarihi = formatDate(row.sertifika_tarihi);
        row.gozetim_tarihi = formatDate(row.gozetim_tarihi);
        row.gecerlilik_tarihi = formatDate(row.gecerlilik_tarihi);
        
        // Arayüzün (Frontend) beklediği özel isimlendirmeler (Aliasing)
        row.certDate = row.sertifika_tarihi;
        row.surveillanceDate = row.gecerlilik_tarihi; // 2027 tarihini buraya basıyoruz
        row.accreditation = row.akreditasyon;
        
        // Backwards compatibility ve Frontend uyumu için her iki alanı da (t ve d) tam isimle dolduruyoruz
        row.standart = row.standard_full || row.standart;
        row.standard = row.standart || p.standart;
        row.number = row.sertifika_no;
        row.company = row.company || row.nickname;

        // Kurumsal sitenin beklediği format doğrudan obje, wrapper yok
        const resp = JSON.stringify(row);
        
        // Önbelleği güncellenmiş veriyle tekrar aktif ediyoruz (1 saatlik kısa cache)
        ctx.waitUntil(env.DB.put(`idx:cert:${searchStd}:${certNo}`, resp, { expirationTtl: 3600 })); 
        return new Response(resp, { 
          headers: { 
            "Content-Type": "application/json", 
            "X-Lookup-Source": "D1-Fresh", 
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
          } 
        });
      }

      // 3. Layer: GAS (Legacy Fallback)
      const queryParams = new URLSearchParams({
        action: "sertifikaSorgula",
        sertifikaNo: p.sertifikaNo || p.certNo || p.certificateNumber || p.numara || "",
        standart: p.standart || p.standard || "",
        companyName: p.companyName || p.firma || "",
        apiKey: env.API_KEY || ""
      });

      const gasRes = await fetch(`${env.GAS_API_URL}?${queryParams.toString()}`);
      const gasData = await gasRes.json();
      
      // GAS'tan gelen cevabı da doğrudan dön
      return new Response(JSON.stringify(gasData), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    } catch (e) {
      return createResponse({ error: "LOOKUP_EXCEPTION", details: e.message }, 500);
    }
  },

  testSorgula: async (p, ctx, env) => {
    try {
      const raporNo = normalizeForSearch(p?.raporNo || p?.reportNo || p?.numara || "");
      if (!raporNo) return createResponse({ error: "RAPORNO_REQUIRED" }, 400);

      const cached = await env.DB.get(`idx:test:${raporNo}`);
      if (cached) return new Response(cached, { headers: { "Content-Type": "application/json", "X-Lookup-Source": "KV", "Access-Control-Allow-Origin": "*" } });

      const row = await env.DB_D1.prepare(`SELECT * FROM tests WHERE rapor_no = ?`).bind(p.raporNo || p.reportNo || p.numara || "").first();
      if (row) {
        // Wrapper yok, doğrudan obje dönülüyor
        const resp = JSON.stringify(row);
        
        ctx.waitUntil(env.DB.put(`idx:test:${raporNo}`, resp, { expirationTtl: 86400 * 7 }));
        return new Response(resp, { 
          headers: { 
            "Content-Type": "application/json", 
            "X-Lookup-Source": "D1", 
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
          } 
        });
      }

      const gasRes = await fetch(`${env.GAS_API_URL}?action=testSorgula&raporNo=${encodeURIComponent(p.raporNo || p.reportNo || p.numara || "")}&apiKey=${encodeURIComponent(env.API_KEY || "")}`);
      const gasData = await gasRes.json();
      return new Response(JSON.stringify(gasData), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    } catch (e) {
      return createResponse({ error: "TEST_LOOKUP_EXCEPTION", details: e.message }, 500);
    }
  },


  getStandards: async (p, ctx, env) => {
    try {
      const { results } = await env.DB_D1.prepare(`SELECT kod, tam_ad, tanim_tr FROM standards ORDER BY kod`).all();
      
      if (!results || results.length === 0) {
        throw new Error("D1_EMPTY");
      }

      let list = results.map(r => {
        // Vegan için özel isim düzeltmesi
        if (r.kod === "Vegan") return "Vegan";
        return r.tam_ad;
      }).filter(Boolean);
      
      // "Others" veya "Diğer" seçeneğini bul ve en sona taşı
      const othersIndex = list.findIndex(i => i.toLowerCase().includes("others") || i.toLowerCase().includes("diğer"));
      if (othersIndex > -1) {
        const others = list.splice(othersIndex, 1)[0];
        list.push(others);
      }
      
      return createResponse(list);
    } catch (e) {
      try {
        const gasRes = await fetch(`${env.GAS_API_URL}?action=getStandards&apiKey=${encodeURIComponent(env.API_KEY || "")}`);
        const gasData = await gasRes.json();
        // GAS'tan gelen veriyi de standart formatta (createResponse ile) dönüyoruz ki CORS başlıkları eklensin
        return createResponse(gasData);
      } catch (gasErr) {
        return createResponse({ error: "STANDARDS_LOAD_FAILED", details: gasErr.message }, 500);
      }
    }
  },

  rebuildLookupIndex: async (p, ctx, env) => {
    try {
      if (!env.DB_D1 || !env.DB) return createResponse({ success: false, error: "BINDINGS_MISSING" }, 500);
      
      const { results } = await env.DB_D1.prepare(`
        SELECT c.*, co.unvan as company, co.nickname, co.adres as address, co.city, co.ulke as country, s.tam_ad as standard_full
        FROM certificates c
        LEFT JOIN companies co ON co.id = c.firma_no
        LEFT JOIN standards s ON s.kod = c.standart
        WHERE (c.gozetim_confirmed != 1 OR c.gozetim_confirmed IS NULL)
        AND (c.durum IS NULL OR (UPPER(c.durum) NOT LIKE 'İPTAL%' AND UPPER(c.durum) NOT LIKE 'PASİF%' AND UPPER(c.durum) NOT LIKE 'ASKI%'))
      `).all();
      
      let count = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const formatDate = (dateStr) => {
        if (!dateStr || !dateStr.includes(".")) return dateStr;
        const parts = dateStr.split(".");
        if (parts.length !== 3) return dateStr;
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      };

      for (const row of results) {
        const gozDate = parseDateString(row.gozetim_tarihi);
        if (gozDate && gozDate < today) continue; 

        // Kuralları uygula
        row.gecerlilik_tarihi = row.gozetim_tarihi;
        row.durum = row.durum || "GEÇERLİ";
        
        row.sertifika_tarihi = formatDate(row.sertifika_tarihi);
        row.gozetim_tarihi = formatDate(row.gozetim_tarihi);
        row.gecerlilik_tarihi = formatDate(row.gecerlilik_tarihi);
        
        row.certDate = row.sertifika_tarihi;
        row.surveillanceDate = row.gecerlilik_tarihi; 
        row.accreditation = row.akreditasyon;
        row.number = row.sertifika_no;
        row.standart = row.standard_full || row.standart;
        row.standard = row.standart;
        row.company = row.company || row.nickname;

        const certNo = normalizeForSearch(row.sertifika_no);
        const std = normalizeForSearch(row.standart);
        
        if (certNo && std) {
          ctx.waitUntil(env.DB.put(`idx:cert:${std}:${certNo}`, JSON.stringify(row), { expirationTtl: 86400 * 30 }));
          count++;
        }
      }
      return createResponse({ success: true, indexedCount: count });
    } catch (e) {
      return createResponse({ success: false, error: "REBUILD_EXCEPTION", details: e.message }, 500);
    }
  }
};

export async function onDataChange(env, type, data, action = "put") {
  if (!env.DB) return;
  try {
    if (type === "certificate") {
      const row = { ...data };
      const certNo = normalizeForSearch(row.sertifika_no || row.number);
      const std = normalizeForSearch(row.standart || row.standard);
      if (!certNo || !std) return;
      
      const key = `idx:cert:${std}:${certNo}`;
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const gozDate = parseDateString(row.gozetim_tarihi || row.surveillanceDate);

      if (action === "delete" || (gozDate && gozDate < today)) {
        await env.DB.delete(key);
      } else {
        const formatDate = (dateStr) => {
          if (!dateStr || !dateStr.includes(".")) return dateStr;
          const parts = dateStr.split(".");
          if (parts.length !== 3) return dateStr;
          return `${parts[2]}-${parts[1]}-${parts[0]}`;
        };

        // Yeni kuralları uygula
        row.gecerlilik_tarihi = row.gozetim_tarihi || row.surveillanceDate;
        row.durum = row.durum || "GEÇERLİ";
        
        row.sertifika_tarihi = formatDate(row.sertifika_tarihi || row.certDate);
        row.gozetim_tarihi = formatDate(row.gozetim_tarihi || row.surveillanceDate);
        row.gecerlilik_tarihi = formatDate(row.gecerlilik_tarihi);
        
        row.certDate = row.sertifika_tarihi;
        row.surveillanceDate = row.gecerlilik_tarihi;
        row.accreditation = row.accreditation || row.akreditasyon;
        row.number = row.number || row.sertifika_no;
        row.standart = row.standard_full || row.standart;
        row.standard = row.standart;

        await env.DB.put(key, JSON.stringify(row), { expirationTtl: 86400 * 30 });
      }
    }
  } catch (e) {
    console.error("onDataChange Error:", e);
  }
}
