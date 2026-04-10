/**
 * 🛠️ Astro Portal Configuration
 *
 * Cloudflare Worker endpoint ve uygulama meta bilgileri.
 * Üretimde PUBLIC_WORKER_URL zorunlu olmalı.
 */

export const CONFIG = {
  // .env veya CF Pages Settings'te PUBLIC_WORKER_URL set et.
  // Local dev ve production aynı URL'i kullanabilir (CORS localhost'a açık).
  WORKER_URL: import.meta.env.PUBLIC_WORKER_URL || "https://portalapi.medicert.com.tr",
  
  APP_NAME: "Astro Portal",
  VERSION: "5.4.0",
};
