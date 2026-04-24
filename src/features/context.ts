import { api } from '../lib/api';

export interface CompanyOperationContext {
  firmaId: string;
  nick: string;
  unvan: string;
  adres: string;
  sehir: string;
  ulke: string;
  kapsam: string;
  scope: string;
  vergiD: string;
  vergiN: string;
  tel: string;
  faks: string;
  mail: string;
  web: string;
  yetkiliAdi: string;
  yetkiliUnvani: string;
  irtibatAdi: string;
  irtibatUnvani: string;
  irtibatTel: string;
  irtibatMail: string;
  danisman: string;
  ea: string;
  nace: string;
  yapilanIs: string;
  alan: string;
  departman: string;
  logo: string;
  kase: string;
  certificates: any[];
  tests: any[];
}

function pickValue(record: Record<string, any>, aliases: string[]) {
  for (const alias of aliases) {
    const value = record?.[alias];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

export async function loadCompanyOperationContext(firmaId: string): Promise<CompanyOperationContext | null> {
  if (!firmaId) return null;

  const [companyRes, certRes, testRes] = await Promise.all([
    api.getCompanyById(firmaId),
    api.getCertificatesByFirmaId(firmaId),
    api.getTestsByFirmaId(firmaId),
  ]);

  const company = companyRes?.data as Record<string, any> | null;
  if (!company) return null;

  return {
    firmaId,
    nick: pickValue(company, ['Firma Adı', 'Nick', 'nick', 'FirmaAdi']),
    unvan: pickValue(company, ['Unvan', 'unvan']),
    adres: pickValue(company, ['Adres', 'adres']),
    sehir: pickValue(company, ['İl', 'Il', 'Şehir', 'Sehir', 'il', 'sehir']),
    ulke: pickValue(company, ['Ülke', 'Ulke', 'ulke']),
    kapsam: pickValue(company, ['Türkçe Kapsam', 'Sertifika Kapsamı (TR)', 'Kapsam', 'kapsam']),
    scope: pickValue(company, ['İngilizce Kapsam', 'Sertifika Kapsamı (EN)', 'Scope', 'scope']),
    vergiD: pickValue(company, ['Vergi Dairesi', 'VergiDairesi', 'vergiD']),
    vergiN: pickValue(company, ['Vergi Numarası', 'VergiNumarasi', 'vergiN']),
    tel: pickValue(company, ['Telefon', 'Tel', 'tel']),
    faks: pickValue(company, ['Faks', 'Fax', 'faks']),
    mail: pickValue(company, ['Mail', 'mail', 'E-Posta']),
    web: pickValue(company, ['İnternet', 'Web', 'www', 'web']),
    yetkiliAdi: pickValue(company, ['Yetkili Adı', 'YetkiliAdi', 'yetA']),
    yetkiliUnvani: pickValue(company, ['Yetkili Ünvanı', 'YetkiliUnvani', 'yetU']),
    irtibatAdi: pickValue(company, ['İrtibat Kişisi', 'IrtibatKisi', 'irtA']),
    irtibatUnvani: pickValue(company, ['İrtibat Ünvanı', 'IrtibatUnvani', 'irtU']),
    irtibatTel: pickValue(company, ['İrtibat Tel', 'IrtibatKisiNumarasi', 'irtN']),
    irtibatMail: pickValue(company, ['İrtibat Mail', 'IrtibatKisisMail', 'irtM']),
    danisman: pickValue(company, ['Danışman', 'Danisman', 'dan', 'danisman']),
    ea: pickValue(company, ['EA', 'ea']),
    nace: pickValue(company, ['NACE', 'nace']),
    yapilanIs: pickValue(company, ['Yapılan İş', 'Yapilan Is', 'yapilan_is', 'yapilanIs']),
    alan: pickValue(company, ['Alan', 'alan']),
    departman: pickValue(company, ['Departman', 'departman']),
    logo: pickValue(company, ['Firma Logosu', 'logo', 'Logo/Kase', 'Logo Kase', 'Logo/Kase-Imza', 'logoK']),
    kase: pickValue(company, ['Kaşe İmza', 'Kase Imza', 'Kaşe&İmza', 'kase', 'Logo/Kase', 'Logo Kase', 'Logo/Kase-Imza', 'logoK']),
    certificates: Array.isArray(certRes?.data) ? certRes.data : [],
    tests: Array.isArray(testRes?.data) ? testRes.data : [],
  };
}
