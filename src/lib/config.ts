/**
 * 🛠️ Astro Portal Configuration
 *
 * Cloudflare Worker endpoint ve uygulama meta bilgileri.
 * Üretimde PUBLIC_WORKER_URL zorunlu olmalı.
 */

export const CONFIG = {
  // Örn: https://portalapi.medicert.com.tr
  WORKER_URL: import.meta.env.PUBLIC_WORKER_URL || "http://localhost:8787",
  
  APP_NAME: "Astro Portal",
  VERSION: "5.4.0",
};
