/**
 * label-history-iso13485.mjs
 *
 * certificate-history.json'daki standard=13485 olan kayıtların nace alanını
 * iso13485-categories.json'daki MD/IVD kodlarıyla günceller.
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

// Priority-ordered rules — first match wins
// IMPORTANT: tr/en params are already normalized (ASCII, lowercase)
// Turkish chars: ö→o, ü→u, ş→s, ç→c, ğ→g, ı→i
const RULES = [
  // IVD — in vitro tanı
  {
    code: "IVD 0404",
    note: "Moleküler biyoloji / PCR tanı kitleri",
    match: (tr, en) => has(tr, en, /pcr|lamp.tabanli|molekuler.biyoloji|real.time.pcr|dijital.pcr|ngs/i),
  },
  {
    code: "IVD 0406",
    note: "Numune kapları — idrar numune kabı",
    match: (tr, en) => has(tr, en, /idrar.numune.kab|numune.kap/i),
  },
  {
    code: "IVD 0401",
    note: "Klinik kimya — hemodiyaliz solüsyon konsantreleri",
    match: (tr, en) =>
      has(tr, en, /hemodiyaliz.solus|diyaliz.solus/i) &&
      !has(tr, en, /hemodiyaliz.maki/i),
  },
  {
    code: "IVD 0403",
    note: "İmmünoloji — ECTV in vitro tanı",
    match: (tr, en) => has(tr, en, /ectv|electro.capacit|vitro.tani.amacli/i),
  },
  {
    code: "MD 1100",
    note: "Genel aktif medikal cihazlar — tanısal ve terapötik cihazlar",
    match: (tr, en) =>
      has(
        tr,
        en,
        /diagnostic.and.therapeutic.devices|diagnostic.devices|therapeutic.devices|tani.?ve.?tedavi.?cihaz|tanisal.?ve.?terapotik.?cihaz/i,
      ) && !has(tr, en, /in.?vitro/i),
  },

  // GÖRÜNTÜLEME
  {
    code: "MD 1202",
    note: "İyonize olmayan görüntüleme — kolposkopi, odyoloji",
    match: (tr, en) => has(tr, en, /kolposkopi|odyolojik.sessiz.kabin|odyoloji.kabin/i),
  },

  // DENTAL
  {
    code: "MD 0403",
    note: "Dental implantlar",
    match: (tr, en) =>
      has(tr, en, /dental.implant|dis.implant/i) &&
      !has(tr, en, /ortopedik.implant|travma.implant|omurga.implant/i),
  },
  {
    code: "MD 0402",
    note: "Dental materyaller — zirkon, akrilik, alaşım",
    match: (tr, en) =>
      has(tr, en, /zirkon|zirconia|dental.alaşim|dental.alasi|akril|dental.sarf|dental.seramik|dental.blok|dental.materyal/i) &&
      !has(tr, en, /dental.implant/i),
  },
  {
    code: "MD 0401",
    note: "Aktif olmayan dental ekipmanlar ve aletler",
    match: (tr, en) =>
      has(tr, en, /dis.hekimlig|dental.ekipman|dental.alet/i) &&
      !has(tr, en, /dental.implant|zirkon|dental.materyal/i),
  },

  // ORTOPEDİK İMPLANTLAR
  {
    code: "MD 0202",
    note: "Aktif olmayan ortopedik implantlar",
    match: (tr, en) =>
      has(
        tr,
        en,
        /ortopedik.implant|metal.implant|titan.implant|omurga.implant|spinal.fiksasyon|travma.implant|kemik.implant|diz.protez|kalca.protez|beyin.cerrahisi.*implant|implant.*travma/i
      ),
  },

  // SOLUNUM / OKSİJEN TERAPİSİ / VENTİLATÖR (AKTİF)
  {
    code: "MD 1102",
    note: "Solunum cihazları, oksijen terapisi, ventilatör",
    match: (tr, en) =>
      has(
        tr,
        en,
        /ventilator|solunum.sistem|bakteri.filtre|hme.filtr|oksijen.terapi|oksijen.debi|oksijen.kanul|oksijen.gaz|nebulizat|nazal.oksijen|inhalasyon|soda.lime|sorbo.lime|medikal.gaz.sistem|merkezi.medikal.gaz/i
      ),
  },

  // STİMÜLASYON / TENS
  {
    code: "MD 1103",
    note: "Stimülasyon — TENS, sinir stimülatörü",
    match: (tr, en) => has(tr, en, /tens.cihaz|sinir.stimulat|elektroterapi/i),
  },

  // AKTİF CERRAHİ
  {
    code: "MD 1104",
    note: "Aktif cerrahi — laparoskopi, endoskopi aletleri",
    match: (tr, en) => has(tr, en, /laparoskopi|gastroskopi|kolonoskopi/i),
  },

  // STERİLİZASYON CİHAZLARI (AKTİF) — EtO sterilizatörleri
  {
    code: "MD 1107",
    note: "Sterilizasyon için aktif cihazlar — EtO sterilizatörü, validasyon",
    match: (tr, en) =>
      has(tr, en, /etilen.oksit.sterilizat|eo.sterilizat|sterilizasyon.validasyon|gama.doz|doz.deney/i),
  },

  // AKTİF REHABİLİTASYON / PROTEZLER
  {
    code: "MD 1108",
    note: "Aktif rehabilitasyon ve protezler — bacak/ayak protezi",
    match: (tr, en) => has(tr, en, /bacak.protez|ayak.protez|uzuv.protez/i),
  },

  // HASTA YATAĞI / TEKERLEKLİ SANDALYE
  {
    code: "MD 1109",
    note: "Hasta yerleştirme ve taşıma — hasta yatağı, tekerlekli sandalye",
    match: (tr, en) =>
      has(tr, en, /hasta.yatak|tekerlekli.sandalye|akulu.tekerlekli|sedye/i),
  },

  // ORTEZLERİ / KORSE — aktif olmayan ortopedik
  {
    code: "MD 0103",
    note: "Aktif olmayan ortopedik ve rehabilitasyon — ortez, korse, sporcu destek",
    match: (tr, en) =>
      has(tr, en, /ortez|korse|sporcu.destek|boyunluk|bacak.sagl|ayak.sagl|kompresyon.giys|elastik.corap/i),
  },

  // ENJEKSİYON / İNFÜZYON / KATETER / İDRAR TORBALARI
  {
    code: "MD 0102",
    note: "Enjeksiyon, infüzyon, diyaliz — kateter, idrar torbası, kemo torbası",
    match: (tr, en) =>
      has(
        tr,
        en,
        /idrar.torba|kemoterapitorba|kemo.terapi.torba|eva.torba|kateter|dren.torba|infüzyon|manifol[dt].*kit|indeflator|koroner.enjekto|hemodiyaliz.maki/i
      ),
  },

  // DİKİŞ / STAPLER
  {
    code: "MD 0302",
    note: "Dikiş materyalleri ve kelepçeler — cilt stapler",
    match: (tr, en) => has(tr, en, /cilt.stapler|dikis.materyal|sutur|dikisli/i),
  },

  // STERİLİZASYON AMBALAJ / İNDİKATÖRLER
  {
    code: "MDS 7006",
    note: "Sterilizasyon ambalajı ve indikatörleri — rulo, poşet, zarf, tyvek, crepe",
    match: (tr, en) =>
      has(tr, en, /sterilizasyon.rulo|sterilizasyon.poset|sterilizasyon.zarf|sterilizasyon.indikat|steril.*ambalaj.*kagit|crepe.*sterilizasyon|tyvek.*sterilizasyon/i),
  },

  // EtO KARTUŞLAR
  {
    code: "MDS 7006",
    note: "EtO kartuşları — steril koşul",
    match: (tr, en) => has(tr, en, /etilen.oksit.kartus|eo.kartus/i),
  },

  // STERİL YARA / ÖRTÜ içeren (steril + non-steril karışık dahil)
  {
    code: "MDS 7006",
    note: "Steril tıbbi cihazlar — cerrahi örtüler, steril yara örtüsü, steril medikal ürünler",
    match: (tr, en) =>
      has(
        tr,
        en,
        /steril.*cerrahi.ortu|cerrahi.ortu.*steril|steril.*ortu|steril.*yara.ortu|steril.*gazli.bez|steril.*kompres|steril.*sargi|steril.*onluk|steril.*medikal|egyszer.*steril|steril.*surgical|steril.*non.steril|steril ve non.steril|steril ve steril.olmayan/i
      ),
  },

  // BANDAJ / GAZLI BEZ / KOMPRES
  {
    code: "MD 0301",
    note: "Bandajlar ve yara sargı bezi — gazlı bez, kompres, bandaj",
    match: (tr, en) =>
      has(
        tr,
        en,
        /gazli.bez|kompres|sargi.bez|alci.alti.pamuk|wrap.kagid|elastik.bandaj|xray.*gazli|bandaj.*gazli/i
      ),
  },

  // YARA BAKIM — jel, solüsyon, flaster
  {
    code: "MD 0303",
    note: "Diğer yara bakım — jel, solüsyon, medikal scarex",
    match: (tr, en) =>
      has(tr, en, /yanik.*bariyer|yara.bakim.jel|yara.bakim.sol|scarex.jel|yara.ortu/i),
  },

  // TIBBİ FLASTER / GÖZ PEDİ
  {
    code: "MD 0100",
    note: "Genel aktif olmayan — flaster, göz pedi",
    match: (tr, en) =>
      has(tr, en, /tibbi.flaster|medikal.flaster|goz.pedi|hipaler/i),
  },

  // ELDİVENLER
  {
    code: "MD 0100",
    note: "Genel aktif olmayan — lateks/nitril eldiven",
    match: (tr, en) => has(tr, en, /lateks.eldiven|lateks.muayene|nitril.eldiven|pudrali.*eldiven|pudrasiz.*eldiven/i),
  },

  // DEZENFEKSİYON / TEMİZLEME (aktif olmayan)
  {
    code: "MD 0108",
    note: "Dezenfeksiyon ve temizleme — enfekte atık kova, dezenfektan medikal",
    match: (tr, en) =>
      has(tr, en, /tibbi.atik.kova|enfekte.*atik.kova|tibbi.cam.atik/i),
  },

  // FFP MASKE — kişisel koruyucu
  {
    code: "MDS 7005",
    note: "Kişisel koruyucu ekipmanlar — FFP2/FFP3 maske",
    match: (tr, en) => has(tr, en, /ffp2|ffp3/i),
  },

  // MEDİKAL PARÇA / TALAŞLI İMALAT (medikal için)
  {
    code: "MD 0106",
    note: "Aktif olmayan aletler — medikal sektör için talaşlı imalat, parça üretimi",
    match: (tr, en) =>
      has(tr, en, /medikal.sektor.*talasli|talasli.*medikal|medikal.*parca.uretim|cerrahi.*alet.*uretim|tibbi.*alet.*uretim/i),
  },

  // CERRAHİ ALETLER genel
  {
    code: "MD 0106",
    note: "Aktif olmayan aletler — cerrahi, tıbbi, ortopedik alet/cihaz",
    match: (tr, en) =>
      has(tr, en, /cerrahi.*tibbi.*ortopedik.*alet|tibbi.*ortopedik.*alet|ameliyathane.kovasi|alet.ilac.dolabi/i),
  },

  // NON-STERİL ÖRTÜ / ÖNLÜK (fallback after MDS 7006 sterile check)
  {
    code: "MD 0106",
    note: "Aktif olmayan aletler — non-steril cerrahi örtü, önlük, havlu",
    match: (tr, en) =>
      has(
        tr,
        en,
        /non.steril.*cerrahi.ortu|cerrahi.ortu.*non.steril|steril.olmayan.*cerrahi.ortu|non.steril.*onluk|steril.olmayan.*onluk|non.steril.*havlu|steril.olmayan.*havlu/i
      ),
  },

  // YARA BAKIM ÜRÜNÜ (genel — "yara bakım ürünleri" ifadesi)
  {
    code: "MD 0303",
    note: "Yara bakım ürünleri — genel yara bakım ifadesi",
    match: (tr, en) => has(tr, en, /yara.bakim.urun|medikal.solus/i),
  },

  // RİBANA — medikal giysi bileşeni
  {
    code: "MD 0100",
    note: "Genel aktif olmayan — ribana, kol manşeti medikal",
    match: (tr, en) => has(tr, en, /ribana|kol.manseti/i),
  },

  // GENEL STERİL + NON-STERİL medikal ürünler (fallback)
  {
    code: "MD 0100",
    note: "Genel aktif olmayan medikal cihaz (fallback)",
    match: (tr, en) =>
      has(tr, en, /medikal.urun|tibbi.urun|medikal.cihaz|tibbi.cihaz|medikal.sarf|tibbi.sarf|medical.device|sterile.*medical/i),
  },
];

let labeled = 0;
let unchanged = 0;
const unmatched = new Map();

history.items.forEach((item) => {
  if (item.standard !== "13485") return;

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
    const key = (item.kapsam || "").substring(0, 80);
    unmatched.set(key, (unmatched.get(key) || 0) + 1);
  }
});

writeFileSync(
  join(root, "src/data/certificate-history.json"),
  JSON.stringify(history, null, 2)
);

console.log(`\n=== ISO 13485 Etiketleme Raporu ===`);
console.log(`Etiketlenen  : ${labeled}`);
console.log(`Değişmeyen   : ${unchanged}`);
console.log(`\nEşleşmeyen kapsamlar:`);
[...unmatched.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, c]) => {
  console.log(`  [${c}x] ${k}`);
});
