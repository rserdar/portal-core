export type CompanyOperationPageKey = 'form' | 'proforma' | 'draft' | 'contract' | 'audit';

export interface CompanyOperationDefinition {
  key: CompanyOperationPageKey;
  title: string;
  description: string;
  href: string;
  badge: string;
}

export const COMPANY_OPERATION_DEFINITIONS: CompanyOperationDefinition[] = [
  {
    key: 'audit',
    title: 'Denetim Ekle',
    description: 'Firma ile baglantili denetim planlama, tarih girisi ve takvim akisina dogrudan gecis saglar.',
    href: '/addaudit',
    badge: 'Takvim',
  },
  {
    key: 'form',
    title: 'Basvuru Formu',
    description: 'Standart secimi, akreditasyon alanlari ve firma bilgileri kontrolu icin mobil uyumlu akisi acar.',
    href: '/company/form',
    badge: 'Form',
  },
  {
    key: 'proforma',
    title: 'Proforma',
    description: 'Proforma kayitlarini listeleme, yeni kayit hazirlama ve finansal alanlari yonetme ekranidir.',
    href: '/company/proforma',
    badge: 'Finans',
  },
  {
    key: 'draft',
    title: 'Draft Olustur',
    description: 'Sertifika standart ve dil secimi ile draft belge uretim akisini yonetir.',
    href: '/company/draft',
    badge: 'Belge',
  },
  {
    key: 'contract',
    title: 'Sozlesme',
    description: 'Ucret, tarih ve kapsam bilgileri ile sozlesme uretimine odaklanan islem sayfasidir.',
    href: '/company/contract',
    badge: 'Sozlesme',
  },
];

export function buildCompanyOperationHref(baseHref: string, firmaId: string) {
  return `${baseHref}?id=${encodeURIComponent(firmaId)}`;
}
