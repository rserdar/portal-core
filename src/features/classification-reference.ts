export interface EaReferenceItem {
  id: string;
  label: string;
  code?: string;
  group?: string;
  scopeCount?: number;
  sampleCount?: number;
}

export interface NaceReferenceItem {
  id: string;
  label: string;
  code?: string;
  group?: string;
  ea?: string;
  text?: string;
  scopeCount?: number;
  keywords?: string[];
  samples?: string[];
}

export interface ClassificationContext {
  companyName?: string;
  companyTitle?: string;
  businessText?: string;
  facilityText?: string;
  departmentText?: string;
  currentEa?: string;
  currentNace?: string;
  currentKapsam?: string;
  currentScope?: string;
  previousKapsam?: string;
  previousScope?: string;
}

export interface ClassificationSuggestion {
  ea: string;
  nace: string;
  label: string;
  score: number;
  reasons: string[];
  keywordMatches: string[];
  kapsamLines: string[];
}

const STOP_WORDS = new Set([
  "ve",
  "ile",
  "bir",
  "olan",
  "olanlar",
  "diger",
  "diğer",
  "icin",
  "için",
  "ait",
  "gibi",
  "the",
  "and",
  "for",
  "that",
]);

function normalizeText(value: unknown) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .trim();
}

function tokenize(value: unknown) {
  const matches = normalizeText(value).match(/[a-z0-9.]{2,}/g) || [];
  return matches.filter((token) => !STOP_WORDS.has(token));
}

function uniqueList(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function parseReferenceScript<T>(elementId: string): T[] {
  const raw = document.getElementById(elementId)?.textContent || "[]";
  try {
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

export function buildClassificationContext(input: ClassificationContext) {
  const contextParts = [
    input.companyName,
    input.companyTitle,
    input.businessText,
    input.facilityText,
    input.departmentText,
    input.currentKapsam,
    input.currentScope,
    input.previousKapsam,
    input.previousScope,
  ];

  const text = contextParts.filter(Boolean).join(" \n ");
  const tokens = uniqueList(tokenize(text));

  return {
    text,
    tokens,
    currentEa: String(input.currentEa || "").trim(),
    currentNace: String(input.currentNace || "").trim(),
  };
}

export function recommendClassification(
  eaItems: EaReferenceItem[],
  naceItems: NaceReferenceItem[],
  input: ClassificationContext,
  limit = 6,
): ClassificationSuggestion[] {
  const context = buildClassificationContext(input);
  if (!context.text.trim()) return [];

  const eaSet = new Set(eaItems.map((item) => item.id));

  const suggestions = naceItems
    .map((item) => {
      const keywords = uniqueList([
        ...(item.keywords || []),
        ...tokenize(item.label),
        ...tokenize(item.text),
        ...(item.samples || []).flatMap((sample) => tokenize(sample)),
      ]);

      const keywordMatches = context.tokens.filter((token) => keywords.includes(token));
      let score = keywordMatches.length * 12;
      const reasons: string[] = [];

      if (keywordMatches.length > 0) {
        reasons.push(`Metin eşleşmesi: ${keywordMatches.slice(0, 4).join(", ")}`);
      }

      const combinedText = normalizeText([item.label, item.text, ...(item.samples || [])].join(" "));
      if (context.currentNace && item.id === context.currentNace) {
        score += 140;
        reasons.push("Mevcut NACE ile birebir eşleşiyor");
      } else if (context.currentNace && combinedText.includes(normalizeText(context.currentNace))) {
        score += 28;
      }

      if (context.currentEa && item.ea && item.ea === context.currentEa) {
        score += 60;
        reasons.push("Mevcut EA ile uyumlu");
      }

      if (item.text && normalizeText(context.text).includes(normalizeText(item.text))) {
        score += 40;
        reasons.push("Kapsam metni doğrudan referans tanımı içeriyor");
      }

      const kapsamLines = uniqueList([...(item.samples || []), item.text || ""]).slice(0, 3);
      if (kapsamLines.length > 1) {
        score += Math.min(12, kapsamLines.length * 3);
      }

      const ea = eaSet.has(item.ea || "") ? item.ea || "" : "";
      return {
        ea,
        nace: item.id,
        label: item.text || item.label || item.id,
        score,
        reasons,
        keywordMatches,
        kapsamLines,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return suggestions;
}

export function buildKapsamText(lines: string[]) {
  return uniqueList(lines).map((line) => `- ${line}`).join("\n");
}
