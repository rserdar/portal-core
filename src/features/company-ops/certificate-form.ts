export interface LegacyIsoOption {
  id: string;
  prefix: string;
  fullName: string;
}

export function normalizeLegacyIsoRows(rows: any[][]): LegacyIsoOption[] {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: String(row?.[0] || '').trim(),
      prefix: String(row?.[1] || '').trim(),
      fullName: String(row?.[2] || '').trim(),
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

export function addOneYearMinusOneDay(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  date.setFullYear(date.getFullYear() + 1);
  date.setDate(date.getDate() - 1);
  return date.toISOString().split('T')[0];
}

export function toDisplayDate(value: string) {
  if (!value) return '';
  const parts = value.split('-');
  if (parts.length !== 3) return value;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

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
