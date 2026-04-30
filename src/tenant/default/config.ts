import type { TenantConfig } from "../types";

const tenantConfig: TenantConfig = {
  id: "default",
  locale: "tr",
  brand: {
    appName: "Portal",
    shortName: "Portal",
    description: "Tenant-ready operasyon portalı",
    logoSrc: "/favicon.svg",
    logoAlt: "Portal",
    footerText: "Tüm hakları saklıdır.",
  },
  userDefaults: {
    email: "info@example.com",
    name: "Kullanıcı",
    role: "Personel",
    initials: "PT",
    picture: null,
    adminEmails: [],
  },
  navigation: [
    { name: "Anasayfa", href: "/", icon: "mdi:home" },
    {
      name: "Firmalar",
      href: "/search",
      icon: "mdi:office-building",
      dropdown: [
        { name: "Yeni Firma Ekle", href: "/company/add", icon: "mdi:office-building-plus" },
        { name: "Başvuru Formu", href: "/company/form", icon: "mdi:file-document-edit-outline" },
        { name: "Proforma", href: "/company/proforma", icon: "mdi:cash-multiple" },
        { name: "Sözleşme", href: "/company/contract", icon: "mdi:file-sign" },
      ],
    },
    {
      name: "Denetimler",
      href: "/audits",
      icon: "mdi:clipboard-check-outline",
      dropdown: [
        { name: "Denetim Planla", href: "/audits/add", icon: "mdi:calendar-plus" },
        { name: "Denetçi Logu", href: "/audits/auditors", icon: "mdi:account-clock-outline" },
      ],
    },
    {
      name: "Sertifikalar",
      href: "/certificates",
      icon: "mdi:certificate-outline",
      dropdown: [
        { name: "Sertifika Ekle", href: "/certificates/add", icon: "mdi:plus-circle-outline" },
        { name: "Taslak Oluştur", href: "/certificates/draft", icon: "mdi:file-document-outline" },
      ],
    },
    {
      name: "Testler",
      href: "/tests",
      icon: "mdi:flask-outline",
      dropdown: [
        { name: "Test Ekle", href: "/tests/add", icon: "mdi:plus-circle-outline" },
      ],
    },
    {
      name: "Dokümanlar",
      href: "/documents/view",
      icon: "mdi:file-document-box-multiple-outline",
      dropdown: [
        { name: "Doküman Oluştur", href: "/documents/add", icon: "mdi:file-plus-outline" },
        { name: "PDF Çevir", href: "/documents/pdf", icon: "mdi:file-pdf-box" },
      ],
    },
  ],
  integrations: {
    // Tenant reposunda medicert/config.ts içinde gerçek URL set edilir.
    // Örnek: certificateLookupUrl: 'https://www.medicert.com.tr/verify'
    certificateLookupUrl: '',
  },
};

export default tenantConfig;
