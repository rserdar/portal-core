import { runRules } from "./classification-rules";

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
  examples?: string[];
  category?: string;
  subcategory?: string;
  fullName?: string;
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
  historicalKapsam?: string;
  historicalScope?: string;
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

export interface HistoricalScopeItem {
  id?: number | string;
  standard?: string;
  kapsam?: string;
  scope?: string;
  ea?: string;
  nace?: string;
}

export interface HistoricalScopeMatch {
  id: string;
  standard: string;
  kapsam: string;
  scope: string;
  score: number;
  reasons: string[];
  ea?: string;
  nace?: string;
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
  "olarak",
  "veya",
  "yada",
  "gore",
  "göre",
  "genel",
  "dahil",
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

function normalizeCode(value: unknown) {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

function compactWhitespace(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pickSuggestionCode(item: NaceReferenceItem) {
  return String(item.code || item.id || "").trim();
}

function isReferenceSuggestionCode(
  code: string,
  naceCodeMap: Map<string, NaceReferenceItem>,
) {
  return Boolean(code && naceCodeMap.has(code));
}

function buildContextBuckets(input: ClassificationContext) {
  return [
    { name: "business", weight: 5, text: [input.businessText, input.companyTitle, input.companyName].filter(Boolean).join(" ") },
    { name: "facility", weight: 3, text: [input.facilityText, input.departmentText].filter(Boolean).join(" ") },
    { name: "current", weight: 4, text: [input.currentKapsam, input.currentScope].filter(Boolean).join(" ") },
    { name: "previous", weight: 2, text: [input.previousKapsam, input.previousScope].filter(Boolean).join(" ") },
    { name: "historical", weight: 2, text: [input.historicalKapsam, input.historicalScope].filter(Boolean).join(" ") },
  ]
    .map((bucket) => ({
      ...bucket,
      normalizedText: normalizeText(bucket.text),
      tokens: uniqueList(tokenize(bucket.text)),
    }))
    .filter((bucket) => bucket.normalizedText);
}

function extractItemKeywords(item: NaceReferenceItem) {
  return uniqueList([
    ...(item.keywords || []),
    ...tokenize(item.label),
    ...tokenize(item.text),
    ...tokenize(item.code),
    ...tokenize(item.group),
    ...tokenize(item.category),
    ...tokenize(item.subcategory),
    ...tokenize(item.fullName),
    ...(item.samples || []).flatMap((sample) => tokenize(sample)),
    ...(item.examples || []).flatMap((sample) => tokenize(sample)),
  ]);
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
  const buckets = buildContextBuckets(input);
  const text = buckets.map((bucket) => bucket.text).join(" \n ");
  const tokens = uniqueList(buckets.flatMap((bucket) => bucket.tokens));

  return {
    text,
    tokens,
    buckets,
    currentEa: String(input.currentEa || "").trim(),
    currentNace: String(input.currentNace || "").trim(),
  };
}

export function recommendClassification(
  eaItems: EaReferenceItem[],
  naceItems: NaceReferenceItem[],
  input: ClassificationContext,
  limit = 6,
  historicalMatches: HistoricalScopeMatch[] = [],
): ClassificationSuggestion[] {
  const context = buildClassificationContext(input);
  const normalizedContextText = normalizeText(context.text);
  const hasTradeContext =
    /(toptan|perakende|ticaret|satis|satış|distributor|distrib|bayi|ithalat|ihracat|servis|bakim|bakım|onarim|onarım)/i.test(
      normalizedContextText,
    );
  const hasManufacturingContext =
    /(imalat|uretim|üretim|manufactur|fabrika|montaj|proses|isleme|işleme)/i.test(
      normalizedContextText,
    );
  const eaSet = new Set(eaItems.map((item) => item.id));
  const naceCodeMap = new Map(naceItems.map((item) => [item.code || item.id, item]));
  const aggregated = new Map<string, ClassificationSuggestion>();

  // -----------------------------------------------------------------------
  // 1. ÖZEL KURALLARI ÇALIŞTIR (kapsam metni boş olsa bile çalışır)
  // -----------------------------------------------------------------------
  const ruleMatchedCodes = runRules(input.currentKapsam || "", input.currentScope || "");
  ruleMatchedCodes.forEach((code) => {
    if (!isReferenceSuggestionCode(code, naceCodeMap)) return;
    const naceItem = naceCodeMap.get(code);
    aggregated.set(code, {
      ea: eaSet.has(naceItem?.ea || "") ? (naceItem?.ea || "") : "",
      nace: code,
      label: naceItem?.text || naceItem?.label || code,
      score: 2000,
      reasons: ["Özel tanımlanmış kural eşleşmesi"],
      keywordMatches: [],
      kapsamLines: (naceItem?.samples || []).slice(0, 2),
    });
  });

  // -----------------------------------------------------------------------
  // 2. GEÇMİŞ EŞLEŞMELERİ DOĞRUDAN ÖNERİYE DÖNÜŞTÜR
  // -----------------------------------------------------------------------
  historicalMatches.forEach((hMatch) => {
    const code = hMatch.nace || "";
    if (!isReferenceSuggestionCode(code, naceCodeMap)) return;

    const naceItem = naceCodeMap.get(code);
    const existing = aggregated.get(code);
    if (!existing) {
      aggregated.set(code, {
        ea: hMatch.ea || "",
        nace: code,
        label: naceItem?.text || naceItem?.label || code,
        score: 1000 + (hMatch.score || 0),
        reasons: ["Benzer geçmiş kapsam eşleşmesi"],
        keywordMatches: [],
        kapsamLines: [hMatch.kapsam, hMatch.scope].filter(Boolean) as string[],
      });
    } else {
      existing.score += 500;
      existing.reasons.unshift("Geçmiş veri ile destekleniyor");
      if (hMatch.kapsam) existing.kapsamLines.unshift(hMatch.kapsam);
    }
  });

  // -----------------------------------------------------------------------
  // 3. REFERANS VERİLERİ ÜZERİNDEN KELİME ANALİZİ
  // (Sadece context metni doluysa çalışır)
  // -----------------------------------------------------------------------
  if (context.text.trim()) naceItems.forEach((item) => {
    const suggestionCode = pickSuggestionCode(item);
    if (!suggestionCode) return;

    let score = 0;
    let reasons: string[] = [];
    const itemKeywords = extractItemKeywords(item);
    let kapsamLines: string[] = (item.samples || []).slice(0, 3);
    const normalizedSuggestionCode = normalizeCode(suggestionCode);

    const keywordSet = new Set(itemKeywords);
    const keywordMatches = context.tokens.filter((token) => keywordSet.has(token));
    const weightedMatches = context.buckets.flatMap((bucket) =>
      bucket.tokens
        .filter((token) => keywordSet.has(token))
        .map((token) => ({ token, weight: bucket.weight })),
    );
    const weightedScore = weightedMatches.reduce((total, entry) => total + entry.weight, 0);
    score = weightedScore * 6;

    if (keywordMatches.length > 0) {
      reasons.push(`Metin eşleşmesi: ${uniqueList(keywordMatches).slice(0, 4).join(", ")}`);
    }

      const combinedText = normalizeText([
        item.label,
        item.text,
        item.code,
        item.group,
        item.category,
        item.subcategory,
        item.fullName,
        ...(item.samples || []),
        ...(item.examples || []),
      ].join(" "));
      const normalizedCurrentCode = normalizeCode(context.currentNace);

      if (normalizedCurrentCode && normalizedSuggestionCode && normalizedSuggestionCode === normalizedCurrentCode) {
        score += 140;
        reasons.push("Mevcut kod ile birebir eşleşiyor");
      } else if (context.currentNace && combinedText.includes(normalizeText(context.currentNace))) {
        score += 28;
      }

      if (context.currentEa && item.ea && item.ea === context.currentEa) {
        score += 60;
        reasons.push("Mevcut EA ile uyumlu");
      }

      if (item.text && normalizedContextText.includes(normalizeText(item.text))) {
        score += 40;
        reasons.push("Kapsam metni doğrudan referans tanımı içeriyor");
      }

      const normalizedItemText = normalizeText([
        item.label,
        item.text,
        ...(item.samples || []),
        ...(item.examples || []),
      ].join(" "));

      const itemLooksTrade = /(toptan|perakende|ticareti|satis|distributor|servis|bakim|onarim)/i.test(
        normalizedItemText,
      );
      const itemLooksManufacturing = /imalat/i.test(normalizedItemText);

      if (hasTradeContext && itemLooksTrade) {
        score += 32;
        reasons.push("Ticaret / distribütörlük bağlamı ile uyumlu");
      }

      if (hasTradeContext && itemLooksManufacturing) {
        score -= 16;
      }

      if (hasManufacturingContext && itemLooksManufacturing) {
        score += 18;
      }

      const phraseMatches = itemKeywords.filter((token) =>
        token.length >= 4 && context.buckets.some((bucket) => bucket.normalizedText.includes(token)),
      );
      if (phraseMatches.length >= 2) {
        score += Math.min(32, phraseMatches.length * 6);
        reasons.push(`Güçlü bağlam eşleşmesi: ${phraseMatches.slice(0, 3).join(", ")}`);
      }

      kapsamLines = uniqueList([...(item.samples || []), ...(item.examples || []), item.text || ""]).slice(0, 4);
      if (kapsamLines.length > 1) {
        score += Math.min(12, kapsamLines.length * 3);
      }

      if (/baska yerde siniflandirilmamis|siniflandirilmamis diger|genel$/i.test(normalizeText(item.label || item.text || ""))) {
        score -= 18;
      }

      if (compactWhitespace(item.text).length > 0 && compactWhitespace(item.text).length <= 80) {
        score += 6;
      }

      // Eğer item.samples içinde geçmiş eşleşmelerden birinin metni varsa (birebir veya yakın)
      for (const hMatch of historicalMatches) {
        const hKapsam = normalizeText(hMatch.kapsam);
        if (item.samples?.some(s => normalizeText(s) === hKapsam)) {
          score += 200; // VIP Boost
          reasons.push("Geçmişte bu kapsamla birebir etiketlenmiş");
          break;
        }
      }

      const ea = eaSet.has(item.ea || "") ? item.ea || "" : "";
      if (score <= 0) return;

      const nextSuggestion: ClassificationSuggestion = {
        ea,
        nace: suggestionCode,
        label: item.text || item.label || item.id,
        score,
        reasons,
        keywordMatches: uniqueList(keywordMatches),
        kapsamLines,
      };

      const existing = aggregated.get(suggestionCode);
      if (!existing) {
        aggregated.set(suggestionCode, nextSuggestion);
        return;
      }

      aggregated.set(suggestionCode, {
        ea: existing.ea || nextSuggestion.ea,
        nace: suggestionCode,
        label: (existing.label && existing.label !== existing.nace) ? existing.label : nextSuggestion.label,
        score: existing.score + Math.round(nextSuggestion.score * 0.45),
        reasons: uniqueList([...existing.reasons, ...nextSuggestion.reasons]).slice(0, 4),
        keywordMatches: uniqueList([...existing.keywordMatches, ...nextSuggestion.keywordMatches]).slice(0, 8),
        kapsamLines: uniqueList([...existing.kapsamLines, ...nextSuggestion.kapsamLines]).slice(0, 4),
      });
    });

  return [...aggregated.values()]
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function buildKapsamText(lines: string[]) {
  return uniqueList(lines).map((line) => `- ${line}`).join("\n");
}

export function findHistoricalScopeMatches(
  items: HistoricalScopeItem[],
  input: ClassificationContext,
  standard = "",
  limit = 5,
): HistoricalScopeMatch[] {
  const context = buildClassificationContext(input);
  if (!context.text.trim()) return [];

  const normalizedStandard = normalizeText(standard);
  const currentSignature = compactWhitespace(
    [input.currentKapsam, input.currentScope].filter(Boolean).join(" "),
  );
  const currentSignatureNormalized = normalizeText(currentSignature);

  return items
    .map((item) => {
      const kapsam = compactWhitespace(item.kapsam);
      const scope = compactWhitespace(item.scope);
      const standardText = compactWhitespace(item.standard);
      const combinedText = [kapsam, scope].filter(Boolean).join(" ");
      const normalizedCombined = normalizeText(combinedText);
      const tokens = uniqueList([
        ...tokenize(kapsam),
        ...tokenize(scope),
        ...tokenize(standardText),
      ]);

      if (!combinedText || !tokens.length) return null;
      if (
        currentSignatureNormalized &&
        normalizedCombined === currentSignatureNormalized
      ) {
        return null;
      }

      const tokenSet = new Set(tokens);
      const weightedMatches = context.buckets.flatMap((bucket) =>
        bucket.tokens
          .filter((token) => tokenSet.has(token))
          .map((token) => ({ token, weight: bucket.weight })),
      );
      const uniqueMatches = uniqueList(weightedMatches.map((entry) => entry.token));
      let score = weightedMatches.reduce((total, entry) => total + entry.weight, 0) * 5;
      const reasons: string[] = [];

      if (uniqueMatches.length) {
        reasons.push(`Benzer terimler: ${uniqueMatches.slice(0, 4).join(", ")}`);
      }

      if (
        normalizedStandard &&
        normalizeText(standardText) === normalizedStandard
      ) {
        score += 32;
        reasons.push("Ayni standartta gecmis kayit");
      }

      const longMatches = uniqueMatches.filter((token) => token.length >= 5);
      if (longMatches.length >= 2) {
        score += Math.min(24, longMatches.length * 5);
      }

      if (
        input.currentKapsam &&
        normalizeText(kapsam).includes(normalizeText(input.currentKapsam))
      ) {
        score += 28;
      }

      if (
        input.currentScope &&
        normalizeText(scope).includes(normalizeText(input.currentScope))
      ) {
        score += 28;
      }

      if (score <= 0) return null;

      return {
        id: String(item.id || combinedText),
        standard: standardText,
        kapsam,
        scope,
        score,
        reasons,
        ea: item.ea,
        nace: item.nace,
      } as HistoricalScopeMatch;
    })
    .filter((item): item is HistoricalScopeMatch => item !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
