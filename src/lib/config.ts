/**
 * 🛠️ Astro Portal Configuration
 * 
 * Cloudflare Worker URL ve diğer çevresel yapılandırmaları burada tutun.
 * Geliştirme aşamasında localhost, üretimde ise kendi Worker URL'nizi kullanın.
 */

export const CONFIG = {
  // Cloudflare Worker URL'nizi buraya yapıştırın
  // Örn: https://portal-proxy.rserdar.workers.dev
  WORKER_URL: import.meta.env.PUBLIC_WORKER_URL || "http://localhost:8787",
  
  APP_NAME: "Astro Portal",
  VERSION: "1.0.0",
};
