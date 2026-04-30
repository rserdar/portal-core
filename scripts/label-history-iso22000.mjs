/**
 * label-history-iso22000.mjs
 *
 * certificate-history.json'daki standard=22000 olan kayıtların nace alanını
 * iso22000-categories.json'daki kodlarla günceller.
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function readJson(p) {
  return JSON.parse(readFileSync(join(root, p), "utf-8").replace(/^﻿/, ""));
}

const history = readJson("src/data/certificate-history.json");

const norm = (t) =>
  (t || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .trim();

const has = (tr, en, rx) => rx.test(tr) || rx.test(en);

// Priority-ordered rules — tr/en are already norm()'ed ASCII
const RULES = [
  // A: Hayvan yetiştiriciliği
  {
    code: "AI",
    note: "Et, süt, yumurta, bal için hayvan yetiştiriciliği",
    match: (tr, en) =>
      has(tr, en, /ciftlik.hayvan.*yem|aricilik|avcilik|hayvan.yetistir/i) &&
      !has(tr, en, /yem.imalat|hazir.yem/i),
  },

  // B: Bitki yetiştiriciliği
  {
    code: "BIII",
    note: "Bitki ürünleri ön işleme — kuru meyve/sebze işleme, paketleme",
    match: (tr, en) =>
      has(tr, en, /kuru.meyve|kuru.sebze|findik|antep.fistigi|incir|kuru.uzum|kuru.kayisi/i) &&
      has(tr, en, /uretim|isleme|paketleme|satisi/i),
  },

  // C: Gıda işleme
  {
    code: "E",
    note: "Yemek hizmeti — restoran, toplu yemek, catering",
    match: (tr, en) =>
      has(tr, en, /restoran|toplu.yemek|catering|kendi.yerinde.yemek|yemek.hizmet|mutfak.hizmet/i),
  },
  {
    code: "DI",
    note: "Yem üretimi — çiftlik hayvanları için hazır yem",
    match: (tr, en) =>
      has(tr, en, /hazir.yem|yem.imalat|yem.uretim|premiks|kumes.yem|besi.yem|kanatli.*yem/i),
  },
  {
    code: "DI",
    note: "Yem/vitamin — kanatlı için vitamin, probiyotik satışı",
    match: (tr, en) =>
      has(tr, en, /kanatli.*vitamin|kanatli.*probiyotik|hayvan.*vitamin.*satis/i),
  },
  {
    code: "K",
    note: "Biyokimyasallar — gıda takviyesi, bitkisel ürünler, aroma",
    match: (tr, en) =>
      has(tr, en, /gida.takviyesi|takviye.edici|bitki.*cay|form.cay|bitki.*macun|kozmetik.*gida.takviye|biyosidal/i),
  },
  {
    code: "CIV",
    note: "Dayanıklı ürün işleme — un, zeytinyağı, içme suyu, bisküvi",
    match: (tr, en) =>
      has(
        tr,
        en,
        /un.uretim|un.ve.kepek|zeytinyagi.uretim|zeytinyagi.*siselen|icme.suyu.uretim|icme.suyu.*siselen|konserve.uretim|biskuvi|makarna.uretim|seker.uretim/i
      ),
  },
  {
    code: "CI",
    note: "Dayanıksız hayvansal ürün işleme — et, süt, balık",
    match: (tr, en) =>
      has(tr, en, /et.isleme|et.paketleme|sut.uretim|peynir.uretim|yogurt.uretim|balik.isleme|balik.paketleme/i),
  },
  {
    code: "CII",
    note: "Dayanıksız bitkisel ürün işleme — meyve suyu, sebze",
    match: (tr, en) =>
      has(tr, en, /meyve.suyu.uretim|sebze.isleme|taze.meyve.isleme/i),
  },

  // F: Ticaret / perakende
  {
    code: "FI",
    note: "Perakende ve toptan satış — gıda satışı, market",
    match: (tr, en) =>
      has(tr, en, /bal.*zeytin.*satis|gida.*satisi.*ithalat|gida.*toptan|market.*gida|gida.*perakende/i),
  },
  {
    code: "FII",
    note: "Gıda komisyonculuğu ve ticareti — ithalat/ihracat",
    match: (tr, en) =>
      has(tr, en, /gida.*ithalat.*ihracat|ihracat.*ithalat.*gida/i),
  },

  // G: Depolama
  {
    code: "GII",
    note: "Dayanıklı gıda depolama — serbest depolama, ihracat",
    match: (tr, en) =>
      has(tr, en, /gida.*depolama|serbest.depolama.*gida|gida.*temas.*eden.*depolama/i),
  },
  {
    code: "GI",
    note: "Dayanıksız gıda nakliye ve depolama — soğuk zincir",
    match: (tr, en) =>
      has(tr, en, /soguk.zincir|soguk.hava.deposu|sicaklik.kontrol.*gida.nakliye/i),
  },

  // I: Ambalaj
  {
    code: "I",
    note: "Gıda ambalaj malzemesi üretimi — pizza kutusu, gıda ambalajı",
    match: (tr, en) =>
      has(tr, en, /pizza.kutusu|gida.*ambalaj.uretim|gida.ile.temas.*ambalaj|paket.servis.*ambalaj/i),
  },

  // H: Yardımcı hizmetler — temizlik, hijyen
  {
    code: "H",
    note: "Yardımcı hizmetler — temizlik, hijyen, deterjan",
    match: (tr, en) =>
      has(tr, en, /deterjan|ovma.krem|yumusatici|temizlik.malzeme|hijyen.urun/i),
  },
];

let labeled = 0;
let unchanged = 0;
const unmatched = new Map();

history.items.forEach((item) => {
  if (item.standard !== "22000") return;

  const tr = norm(item.kapsam || "");
  const en = norm(item.scope || "");

  let matched = null;
  for (const rule of RULES) {
    if (rule.match(tr, en)) {
      matched = rule;
      break;
    }
  }

  if (matched) {
    item.nace = matched.code;
    labeled++;
  } else {
    unchanged++;
    const key = (item.kapsam || "").substring(0, 100);
    unmatched.set(key, (unmatched.get(key) || 0) + 1);
  }
});

writeFileSync(
  join(root, "src/data/certificate-history.json"),
  JSON.stringify(history, null, 2)
);

console.log(`\n=== ISO 22000 Etiketleme Raporu ===`);
console.log(`Etiketlenen  : ${labeled}`);
console.log(`Değişmeyen   : ${unchanged}`);
if (unmatched.size > 0) {
  console.log(`\nEşleşmeyen kapsamlar:`);
  [...unmatched.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, c]) => {
    console.log(`  [${c}x] ${k}`);
  });
}
