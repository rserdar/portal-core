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
    nick: pickValue(company, ['nickname', 'Firma Adı', 'Nick', 'nick', 'FirmaAdi']),
    unvan: pickValue(company, ['unvan', 'Unvan']),
    adres: pickValue(company, ['adres', 'Adres']),
    sehir: pickValue(company, ['city', 'İl', 'Il', 'Şehir', 'Sehir', 'il', 'sehir']),
    ulke: pickValue(company, ['ulke', 'Ülke', 'Ulke']),
    kapsam: pickValue(company, ['tkapsam', 'Türkçe Kapsam', 'Sertifika Kapsamı (TR)', 'Kapsam', 'kapsam']),
    scope: pickValue(company, ['scope', 'İngilizce Kapsam', 'Sertifika Kapsamı (EN)', 'Scope']),
    vergiD: pickValue(company, ['vergi_dairesi', 'Vergi Dairesi', 'VergiDairesi', 'vergiD']),
    vergiN: pickValue(company, ['vergi_no', 'Vergi Numarası', 'VergiNumarasi', 'vergiN']),
    tel: pickValue(company, ['tel', 'Telefon', 'Tel']),
    faks: pickValue(company, ['faks', 'Faks', 'Fax']),
    mail: pickValue(company, ['mail', 'Mail', 'E-Posta']),
    web: pickValue(company, ['www', 'İnternet', 'Web', 'web']),
    yetkiliAdi: pickValue(company, ['yetkili_adi', 'Yetkili Adı', 'YetkiliAdi', 'yetA']),
    yetkiliUnvani: pickValue(company, ['yetkili_unvani', 'Yetkili Ünvanı', 'YetkiliUnvani', 'yetU']),
    irtibatAdi: pickValue(company, ['irtibat_kisi', 'İrtibat Kişisi', 'IrtibatKisi', 'irtA']),
    irtibatUnvani: pickValue(company, ['irtibat_unvani', 'İrtibat Ünvanı', 'IrtibatUnvani', 'irtU']),
    irtibatTel: pickValue(company, ['irtibat_tel', 'İrtibat Tel', 'IrtibatKisiNumarasi', 'irtN']),
    irtibatMail: pickValue(company, ['irtibat_mail', 'İrtibat Mail', 'IrtibatKisisMail', 'irtM']),
    danisman: pickValue(company, ['consultant', 'Danışman', 'Danisman', 'dan']),
    ea: pickValue(company, ['ea', 'EA']),
    nace: pickValue(company, ['nace', 'NACE']),
    yapilanIs: pickValue(company, ['yapilan_is', 'Yapılan İş', 'Yapilan Is', 'yapilanIs']),
    alan: pickValue(company, ['alan', 'Alan']),
    departman: pickValue(company, ['departman', 'Departman']),
    logo: pickValue(company, ['logo', 'Firma Logosu', 'Logo/Kase', 'Logo Kase', 'Logo/Kase-Imza', 'logoK']),
    kase: pickValue(company, ['kase', 'Kaşe İmza', 'Kase Imza', 'Kaşe&İmza', 'Logo/Kase', 'Logo Kase', 'Logo/Kase-Imza', 'logoK']),
    certificates: Array.isArray(certRes?.data) ? certRes.data : [],
    tests: Array.isArray(testRes?.data) ? testRes.data : [],
  };
}
