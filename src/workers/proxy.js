/**
 * 🛰️ Medicert Portal: Cloudflare Worker Proxy (V1)
 * 
 * Bu kodu doğrudan Cloudflare Worker panelinize yapıştırabilirsiniz.
 * 
 * Görevi: Frontend'den (Astro) gelen istekleri karşılamak, 
 * CORS ayarlarını yönetmek ve güvenli bir şekilde GAS API'ye iletmektir.
 */

export default {
  async fetch(request, env, ctx) {
    // 🌐 İzin Verilen Kaynaklar (CORS)
    const allowedOrigins = [
      "https://portal.medicert.com.tr", // Ana Portal (Production)
      "https://portal.pages.dev",       // Cloudflare Pages (Staging)
      "http://localhost:4321"           // Yerel Geliştirme
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

    if (request.method === "POST") {
      try {
        const body = await request.json();

        // 🔗 GAS_API_URL ve API_KEY: 
        // Bunları Cloudflare Worker panelindeki "Settings -> Variables" kısmından ekleyin.
        const gasApiUrl = env.GAS_API_URL;
        body.apiKey = env.API_KEY || "mc-portal-3.0_8a2d7f9e4c1b5a6c3d2e1f0b9a8c7d6e"; 

        if (!gasApiUrl) {
          throw new Error("GAS_API_URL 'Settings -> Variables' kısmında tanımlanmamış.");
        }

        // 🚀 Google Apps Script'e yönlendirme yap (doPost çağrısı tetiklenir)
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
        return new Response(JSON.stringify({ success: false, error: "Proxy Hatası: " + err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response("🚀 Cloudflare Worker Proxy is active. Use POST requests.", {
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  },
};
