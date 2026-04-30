/**
 * label-certificate-history.mjs içindeki kuralların frontend versiyonu.
 * Bu kurallar, kelime bazlı aramadan daha önceliklidir.
 */

export interface ClassificationRule {
  nace: string;
  note: string;
  match: (tr: string, en: string) => boolean;
}

const norm = (t: string) => t.toLocaleLowerCase("tr-TR").replace(/ı/g,"i").replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s").replace(/ö/g,"o").replace(/ç/g,"c").trim();
const has = (tr: string, en: string, rx: RegExp) => rx.test(tr) || rx.test(en);

export const RULES: ClassificationRule[] = [
  // TIBBİ CİHAZ / 13485 ÖZEL
  { nace: "32.50", note: "Tıbbi cihaz üretimi", 
    match: (tr, en) => has(tr, en, /medical.?device|tibbi.?cihaz|orthopedic|ortopedik|dis.?protez|dental|cerrahi.?alet|maske.*(cerrahi|tibbi)|surgical.?mask/i) 
  },
  { nace: "32.50", note: "CE belgeli spesifik ürünler", 
    match: (tr, en) => has(tr, en, /mlp-25ct|mlp-33ct|robocoating|ecct-mvs|ecct-c1|grn|efd/i) 
  },
  // ATIK YÖNETİMİ
  { nace: "38.12", note: "Tehlikeli atık toplama", 
    match: (tr, en) => has(tr, en, /tehlikeli.?(atik|bertaraf)|hazardous.?waste/i) 
  },
  { nace: "38.32", note: "Geri dönüşüm", 
    match: (tr, en) => has(tr, en, /tehlikesiz.?atik.*(geri.kazanim|yeniden.kullanim)|recycling/i) 
  },
  // SAĞLIK
  { nace: "86.21", note: "Klinik/Tıp Merkezi", 
    match: (tr, en) => has(tr, en, /saglik.?hizmetleri(?!.*urun)|klinik.?hizmet|tip.?merkezi/i) 
  },
  // EĞİTİM
  { nace: "85.59", note: "Eğitim hizmetleri", 
    match: (tr, en) => has(tr, en, /egitim.?(hizmet|faaliyeti)|training.?(service|activity)|kurs.?(hizmet|merkez)/i) 
  }
];

export function runRules(kapsam: string, scope: string): string[] {
  const tr = norm(kapsam);
  const en = norm(scope || "");
  const matchedCodes: string[] = [];
  
  for (const rule of RULES) {
    if (rule.match(tr, en)) {
      matchedCodes.push(rule.nace);
    }
  }
  
  return [...new Set(matchedCodes)];
}
