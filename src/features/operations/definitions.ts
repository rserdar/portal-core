export type OperationPageKey = 'form' | 'proforma' | 'draft' | 'contract' | 'audit';

export interface OperationDefinition {
  key: OperationPageKey;
  title: string;
  description: string;
  href: string;
  badge: string;
}

export const OPERATION_DEFINITIONS: OperationDefinition[] = [
  {
    key: 'audit',
    title: 'Denetim Ekle',
    description: 'Firmayla bağlantılı denetim planlaması, tarih girişi ve takvim akışına doğrudan geçiş sağlar.',
    href: '/audits/add',
    badge: 'Takvim',
  },
  {
    key: 'form',
    title: 'Başvuru Formu',
    description: 'Standart seçimi, akreditasyon alanları ve firma bilgileri kontrolü için mobil uyumlu akışı açar.',
    href: '/company/form',
    badge: 'Form',
  },
  {
    key: 'proforma',
    title: 'Proforma',
    description: 'Proforma kayıtlarını listeleme, yeni kayıt hazırlama ve finansal alanları yönetme ekranıdır.',
    href: '/company/proforma',
    badge: 'Finans',
  },
  {
    key: 'draft',
    title: 'Taslak Oluştur',
    description: 'Sertifika standardı ve dil seçimi ile taslak belge üretim akışını yönetir.',
    href: '/certificates/draft',
    badge: 'Belge',
  },
  {
    key: 'contract',
    title: 'Sözleşme',
    description: 'Ücret, tarih ve kapsam bilgileri ile sözleşme üretimine odaklanan işlem sayfasıdır.',
    href: '/company/contract',
    badge: 'Sözleşme',
  },
];

export function buildOperationHref(baseHref: string, firmaId: string) {
  return `${baseHref}?id=${encodeURIComponent(firmaId)}`;
}

