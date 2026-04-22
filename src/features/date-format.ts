export function toIsoDate(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const dotsMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotsMatch) {
    return `${dotsMatch[3]}-${dotsMatch[2]}-${dotsMatch[1]}`;
  }

  return raw;
}

export function toDotsDate(value: string) {
  const iso = toIsoDate(value);
  if (!iso) return '';

  const isoMatch = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`;
  }

  return iso;
}

export function toInputDateValue(value: string) {
  const iso = toIsoDate(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '';
}

export function shiftIsoDate(startValue: string, offsetDays: number) {
  if (!startValue) return '';
  const date = new Date(startValue);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function addOneYearMinusOneDay(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  date.setFullYear(date.getFullYear() + 1);
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
