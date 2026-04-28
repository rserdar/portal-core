import tenant from "@tenant/config";

/**
 * Uygulama genelinde tenant-aware public config erişimi.
 * Env değerleri tenant varsayılanlarını override edebilir.
 */

export const CONFIG = {
  WORKER_URL: import.meta.env.PUBLIC_WORKER_URL || tenant.integrations.workerUrl || "",
  APP_NAME: import.meta.env.PUBLIC_BRAND_APP_NAME || tenant.brand.appName,
  APP_SHORT_NAME: import.meta.env.PUBLIC_BRAND_SHORT_NAME || tenant.brand.shortName,
  APP_DESCRIPTION: import.meta.env.PUBLIC_BRAND_DESCRIPTION || tenant.brand.description,
  VERSION: "5.5.0",
};
