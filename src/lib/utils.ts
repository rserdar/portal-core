/**
 * 🛠️ Common Utility Functions for Portal
 */

export const STANDART_PRIORITY = ['9001', '13484', '13485', '14001', '22000', '45001', '27001', '50001', 'GMP'];

/**
 * Gets the priority index of a standard for sorting.
 */
export function getStandartPriority(standart: string): number {
  const s = (standart || '').toUpperCase().trim();
  const idx = STANDART_PRIORITY.findIndex((p) => s.includes(p));
  return idx === -1 ? STANDART_PRIORITY.length : idx;
}

/**
 * Escapes HTML special characters to prevent XSS.
 */
export function escHtml(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escapes characters for use in HTML attributes.
 */
export function escAttr(value: any): string {
  return escHtml(value).replace(/"/g, "&quot;");
}

/**
 * Normalizes a string for search and comparison (Turkish characters support).
 */
export function normalize(str: any): string {
  if (!str) return "";
  return str
    .toString()
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .trim();
}

/**
 * Normalizes a key for loose property lookup.
 */
export function normalizeKey(value: any): string {
  return normalize(value)
    .replace(/_/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Gets the initials of a name (first letters of first two words).
 */
export function getInitials(name: string): string {
  return (
    String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "??"
  );
}

/**
 * Parses a date string in TR (DD.MM.YYYY) or ISO format.
 */
export function parseDateValue(raw: string): Date | null {
  const value = String(raw || "").trim();
  if (!value) return null;

  // DD.MM.YYYY HH:mm
  const trMatch = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (trMatch) {
    const [, dd, mm, yyyy, hh = "00", min = "00"] = trMatch;
    const dt = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Calculates visible page numbers for pagination UI.
 */
export function getVisiblePageNumbers(totalPages: number, page: number): number[] {
  const pages = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  return Array.from(pages)
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);
}

/**
 * Picks a value from an object using a list of potential keys (aliases).
 */
export function pickValue(item: any, aliases: string[], fallback = ""): string {
  if (!item) return fallback;

  // Direct check
  for (const key of aliases) {
    if (item[key] !== undefined && item[key] !== null) {
      const val = String(item[key]).trim();
      if (val !== "") return val;
    }
  }

  // Normalized check
  if (typeof item === "object") {
    const normalizedAliases = aliases.map((alias) => normalizeKey(alias));
    for (const [rawKey, rawValue] of Object.entries(item)) {
      if (rawValue === undefined || rawValue === null) continue;
      if (String(rawValue).trim() === "") continue;
      if (normalizedAliases.includes(normalizeKey(rawKey))) {
        return String(rawValue);
      }
    }
  }

  return fallback;
}

/**
 * Animated count up for numbers in DOM elements.
 */
export function countUp(el: HTMLElement, target: number) {
  if (target === 0) {
    el.textContent = "0";
    return;
  }
  const duration = 600;
  const start = performance.now();
  const from = parseInt(el.textContent || "0") || 0;

  const tick = (now: number) => {
    const progress = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (target - from) * ease).toString();
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Normalizes a URL/link.
 */
export function normalizeLink(value: string): string {
  const raw = String(value || "").trim();
  if (!raw || raw === "-") return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^www\./i.test(raw)) return `https://${raw}`;
  // Drive file ID detected (20+ chars, alphanumeric, starts with '1' or common patterns)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) {
    return `https://drive.google.com/file/d/${raw}/view`;
  }
  return raw;
}

/**
 * Formats a href for different communication types.
 */
export function toHrefByType(value: string, type: "tel" | "mail" | "web" | "drive"): string {
  const raw = String(value || "").trim();
  if (!raw || raw === "-") return "";

  if (type === "tel") return `tel:${raw.replace(/\s+/g, "")}`;
  if (type === "mail") return `mailto:${raw}`;
  if (type === "drive" || type === "web") return normalizeLink(raw);
  return raw;
}

/**
 * Checks if a value is truthy based on common strings.
 */
export function isTruthyFlag(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "on", "evet", "aktif"].includes(normalized);
}

/**
 * Checks if a numeric value is zero or empty.
 */
export function isZeroish(value: any): boolean {
  const text = String(value ?? "").trim();
  if (!text || text === "-") return true;
  const normalized = text.replace(",", ".");
  if (!/^[-+]?\d+(\.\d+)?$/.test(normalized)) return false;
  return Number(normalized) === 0;
}

/**
 * Gets the record ID for a certificate from its direct keys or first property for unnamed objects.
 */
export function getCertificateRecordId(item: any, fallback = "-"): string {
  if (!item) return fallback;
  const direct = pickValue(item, ["ID", "Id", "id", "Certificate ID", "certificateId", "sertifikaId"], "");
  if (direct) return direct;

  if (typeof item === "object") {
    const entries = Object.entries(item);
    if (entries.length > 0) {
      const [firstKey, firstValue] = entries[0];
      const normalizedKey = (firstKey || "").trim().toLowerCase();
      // If the key looks like an ID/index or is empty, use the value
      if (!normalizedKey || normalizedKey === "0" || normalizedKey === "id") {
        return String(firstValue ?? "").trim() || fallback;
      }
    }
  }

  return fallback;
}
