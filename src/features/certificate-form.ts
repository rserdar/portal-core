import { addOneYearMinusOneDay, toDotsDate } from './date-format';

export interface StandardOption {
  id: string;
  prefix: string;
  fullName: string;
}

export function normalizeStandards(rows: any[]): StandardOption[] {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: String(row?.kod || row?.[0] || '').trim(),
      prefix: String(row?.kisaltma || row?.[1] || '').trim(),
      fullName: String(row?.tam_ad || row?.[2] || '').trim(),
    }))
    .filter((item) => item.id);
}

export function buildSuggestedCertPrefix(prefix: string, firmaId: string) {
  if (!prefix || !firmaId) return '';
  return `${prefix}-${firmaId}.`;
}

export function mergeCertNoSuggestion(prefix: string, certNoInput: string) {
  const cleanInput = certNoInput.trim();
  if (!prefix) return cleanInput;
  if (/^\d+$/.test(cleanInput)) return `${prefix}${cleanInput}`;
  return prefix;
}

export function toDisplayDate(value: string) {
  return toDotsDate(value);
}

export { addOneYearMinusOneDay };

export function buildCertificateQrLink(unvan: string, standardLabel: string, certNo: string) {
  const cleanUnvan = unvan.trim();
  const cleanStandard = standardLabel.trim();
  const cleanCertNo = certNo.trim();
  if (!cleanUnvan || !cleanStandard || !cleanCertNo) return '';

  const pieces = cleanUnvan.split(/\s+/);
  const shortName = pieces[0]?.length < 3 && pieces.length > 1
    ? `${pieces[0]} ${pieces[1]}`
    : pieces[0];

  return `https://sorgulama.medicert.com.tr/?firma=${encodeURIComponent(shortName.trim())}&standart=${encodeURIComponent(cleanStandard)}&numara=${encodeURIComponent(cleanCertNo)}`;
}
