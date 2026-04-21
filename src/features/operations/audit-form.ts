export type AuditRows = any[];

export function uniqueColumnValues(rows: AuditRows, index: number) {
  const seen = new Set<string>();
  const values: string[] = [];

  rows.forEach((row) => {
    const value = row?.[index] === undefined || row?.[index] === null ? '' : String(row[index]).trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    values.push(value);
  });

  return values;
}

export function filterAuditorsByStandard(rows: AuditRows, standard: string) {
  const stdMap: Record<string, string> = {
    '9001': 'std_9001',
    '13485': 'std_13485',
    '14001': 'std_14001',
    '22000': 'std_22000',
    '27001': 'std_27001',
    '45001': 'std_45001',
    '50001': 'std_50001',
    'GMP': 'std_gmp'
  };
  const field = stdMap[standard];
  if (!field) return [];
  return rows.filter((row) => {
    const val = row?.[field];
    return val === 1 || val === '1' || String(val).toUpperCase() === 'TRUE';
  });
}

export function getAuditorShortName(rows: AuditRows, name: string) {
  const match = rows.find((row) => {
    const fullName = `${row?.ad || row?.[1] || ''} ${row?.soyad || row?.[2] || ''}`.trim();
    return fullName === name || String(row?.ad || row?.[1] || '').trim() === name;
  });
  return match?.imza || match?.[3] || '';
}

export function formatDateToDots(dateString: string) {
  if (!dateString) return '';
  return dateString.split('-').reverse().join('.');
}

export function shiftIsoDate(startValue: string, offsetDays: number) {
  if (!startValue) return '';
  const date = new Date(startValue);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function buildAuditRangeLabel(startValue: string, endValue: string) {
  if (!startValue || !endValue) {
    return { fullLabel: '', manDays: '' };
  }

  const date1 = new Date(startValue);
  const date2 = new Date(endValue);
  const date3 = new Date(date1);
  date3.setDate(date3.getDate() + 1);

  const diffTime = Math.abs(date2.getTime() - date1.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const manDays = String(diffDays + 1);
  const endDots = formatDateToDots(endValue);

  if (diffDays === 0) {
    return { fullLabel: endDots, manDays };
  }

  if (diffDays === 1 && date1.getFullYear() === date2.getFullYear()) {
    return {
      fullLabel: date1.getMonth() === date2.getMonth()
        ? `${`0${date1.getDate()}`.slice(-2)}-${endDots}`
        : `${`0${date1.getDate()}`.slice(-2)}.${`0${date1.getMonth() + 1}`.slice(-2)}-${endDots}`,
      manDays,
    };
  }

  if (diffDays === 2 && date1.getFullYear() === date2.getFullYear()) {
    return {
      fullLabel: date1.getMonth() === date2.getMonth() && date2.getMonth() === date3.getMonth()
        ? `${`0${date1.getDate()}`.slice(-2)}-${`0${date3.getDate()}`.slice(-2)}-${endDots}`
        : `${`0${date1.getDate()}`.slice(-2)}.${`0${date1.getMonth() + 1}`.slice(-2)}-${`0${date3.getDate()}`.slice(-2)}-${endDots}`,
      manDays,
    };
  }

  return {
    fullLabel: date1.getFullYear() === date2.getFullYear()
      ? `${`0${date1.getDate()}`.slice(-2)}.${`0${date1.getMonth() + 1}`.slice(-2)}-${endDots}`
      : `${`0${date1.getDate()}`.slice(-2)}.${`0${date1.getMonth() + 1}`.slice(-2)}.${date1.getFullYear()}-${endDots}`,
    manDays,
  };
}

export function buildAuditorSummary(rows: AuditRows, auditors: string[], manDays: string) {
  const selected = auditors.filter(Boolean);
  const short = selected.map((name) => getAuditorShortName(rows, name)).filter(Boolean);
  const multiplier = selected.length || 1;

  return {
    names: selected.join(' - '),
    shortNames: short.join(' - '),
    totalManDays: String(Number(manDays || 0) * multiplier),
  };
}

export function shouldHideStage2(auditType: string) {
  return ['Gözetim', 'Özel'].includes(auditType);
}

export function checkboxIdForStandard(standard: string) {
  const mapping: Record<string, string> = {
    '9001': '9C',
    '13485': '13C',
    '14001': '14C',
    '22000': '22C',
    '27001': '27C',
    '45001': '45C',
    '50001': '50C',
    'GMP': 'GMPC',
  };

  return mapping[standard] || '';
}
