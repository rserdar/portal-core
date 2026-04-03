/**
 * 🛰️ Astro Portal: Cloudflare Worker Proxy
 * 
 * Bu dosya, Cloudflare Worker panelinize yapıştıracağınız koddur.
 * Görevi: Astro'dan gelen istekleri karşılamak, CORS sorunlarını çözmek
 * ve güvenli bir şekilde Google Apps Script (GAS) API'nize iletmektir.
 */

export default {
  async fetch(request, env, ctx) {
    // 🌐 İzin Verilen Kaynaklar (CORS)
    const allowedOrigins = [
      "https://portal.pages.dev", // Sizin Cloudflare Pages domaininiz
      "http://localhost:4321"     // Yerel geliştirme için
    ];

    const origin = request.headers.get("Origin");
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };

    // 🚥 OPTIONS (Preflight) İsteklerini Yanıtla
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 🛡️ Basit Güvenlik Kontrolü (İptal edebilirsiniz veya API anahtarı ekleyebilirsiniz)
    // const authHeader = request.headers.get("Authorization");
    // if (authHeader !== `Bearer ${env.API_KEY || "YOUR_SECRET_KEY"}`) {
    //   return new Response(JSON.stringify({ error: "Unauthorized" }), { 
    //     status: 401, 
    //     headers: { ...corsHeaders, "Content-Type": "application/json" } 
    //   });
    // }

    // 🔗 Google Apps Script URL'si
    // Not: Bu URL'yi Cloudflare Worker panelindeki "Settings -> Variables" kısmına eklemeniz önerilir.
    // Değişken adı: GAS_API_URL
    const gasApiUrl = env.GAS_API_URL || "BURAYA_GOOGLE_APPS_SCRIPT_WEB_APP_URL_YAPISTIRIN";

    if (request.method === "POST") {
      try {
        const body = await request.json();

        // 🔑 API Key'i Worker Secret'tan inject et (Frontend'den gelmiyor)
        body.apiKey = env.API_KEY || "";

        // GAS'a yönlendir (doPost çağrısı yapar)
        const gasResponse = await fetch(gasApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await gasResponse.json();

        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: "Worker Hatası: " + err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response("🚀 Astro Portal Proxy is active. Use POST requests.", {
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  },
};
