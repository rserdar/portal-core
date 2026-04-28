export interface TenantNavigationItem {
  name: string;
  href: string;
  icon: string;
  dropdown?: TenantNavigationItem[];
}

export interface TenantUserDefaults {
  email: string;
  name: string;
  role: string;
  initials: string;
  picture: string | null;
  adminEmails: string[];
}

export interface TenantBrandConfig {
  appName: string;
  shortName: string;
  description: string;
  logoSrc: string;
  logoAlt: string;
  footerText: string;
}

export interface TenantIntegrationConfig {
  workerUrl?: string;
  certificateLookupUrl?: string;
}

export interface TenantConfig {
  id: string;
  locale: string;
  brand: TenantBrandConfig;
  userDefaults: TenantUserDefaults;
  navigation: TenantNavigationItem[];
  integrations: TenantIntegrationConfig;
}
