import { addOneYearMinusOneDay, toDotsDate } from './date-format';
import tenant from '@tenant/config';

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

function normalizeOtherStandardLabel(value: string) {
  const raw = String(value || '').trim();
  const normalized = raw
    .toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/ı/g, 'i');
  if (normalized === 'diger' || normalized === 'other' || normalized === 'others') {
    return 'Others';
  }
  return raw;
}

function resolveCertificateLookupUrl() {
  const configuredLookupUrl = String(tenant.integrations.certificateLookupUrl || '').trim();
  if (configuredLookupUrl) return configuredLookupUrl;

  if (typeof window === 'undefined') return '';

  try {
    const currentUrl = new URL(window.location.origin);
    const host = currentUrl.hostname;

    if (host.startsWith('portalapi.')) {
      currentUrl.hostname = `sorgulama.${host.slice('portalapi.'.length)}`;
      return currentUrl.toString();
    }

    if (host.startsWith('portal.')) {
      currentUrl.hostname = `sorgulama.${host.slice('portal.'.length)}`;
      return currentUrl.toString();
    }

    return '';
  } catch {
    return '';
  }
}

export function buildCertificateQrLink(unvan: string, standardLabel: string, certNo: string) {
  const cleanUnvan = (unvan || '').trim();
  const cleanStandard = normalizeOtherStandardLabel(standardLabel || '');
  const cleanCertNo = (certNo || '').trim();

  const pieces = cleanUnvan.split(/\s+/).filter(Boolean);
  const firstWord = pieces[0] || '';
  const shortName = firstWord.length < 3 && pieces.length > 1
    ? `${firstWord} ${pieces[1]}`
    : firstWord;

  const lookupUrl = resolveCertificateLookupUrl();
  if (!lookupUrl) return '';

  const url = new URL(lookupUrl);
  const normalizedShortName = shortName.trim();
  if (normalizedShortName) url.searchParams.set('firma', normalizedShortName);
  if (cleanStandard) url.searchParams.set('standart', cleanStandard);
  if (cleanCertNo) url.searchParams.set('numara', cleanCertNo);

  if (![normalizedShortName, cleanStandard, cleanCertNo].some(Boolean)) return '';

  return url.toString();
}
