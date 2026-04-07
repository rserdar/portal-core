/**
 * 🛠️ Astro Portal Configuration
 *
 * Cloudflare Worker endpoint ve uygulama meta bilgileri.
 * Üretimde PUBLIC_WORKER_URL zorunlu olmalı.
 */

export const CONFIG = {
  // Local geliştirmede localhost Worker, production'da portalapi fallback.
  WORKER_URL: import.meta.env.PUBLIC_WORKER_URL || (
    import.meta.env.DEV
      ? "http://localhost:8787"
      : "https://portalapi.medicert.com.tr"
  ),
  
  APP_NAME: "Astro Portal",
  VERSION: "5.4.0",
};
