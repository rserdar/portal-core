/**
 * label-history-iso50001.mjs
 *
 * certificate-history.json'daki standard=50001 olan kayıtların nace alanını
 * iso50001-categories.json'daki MD kodlarıyla günceller.
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

const RULES = [
  {
    code: "MD 06",
    note: "Enerji üretimi ve dağıtımı — enerji nakil hatları, trafo, şebeke",
    match: (tr, en) =>
      has(tr, en, /enerji.nakil|trafo.merkezi|sehir.sebekesi|elektrik.sebekesi|ag.og.hat|154.kv|380.kv/i),
  },
  {
    code: "MD 02",
    note: "Hafif ve orta sanayi — tekstil, iplik, elektronik, imalat",
    match: (tr, en) =>
      has(tr, en, /tekstil|iplik|dokuma|denim|boyama|hasil|pamuk|elektronik.kart|devre.*tasarim/i),
  },
  {
    code: "MD 01",
    note: "Ticari binalar — yazılım, mühendislik, danışmanlık hizmetleri",
    match: (tr, en) =>
      has(tr, en, /yazilim.hizmet|musavirlik|danismanlik|muhendislik.*hizmet|proje.*tasarim.*yazilim/i),
  },
];

let labeled = 0;
let unchanged = 0;
const unmatched = new Map();

history.items.forEach((item) => {
  if (item.standard !== "50001") return;

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

console.log(`\n=== ISO 50001 Etiketleme Raporu ===`);
console.log(`Etiketlenen  : ${labeled}`);
console.log(`Değişmeyen   : ${unchanged}`);
if (unmatched.size > 0) {
  console.log(`\nEşleşmeyen kapsamlar:`);
  [...unmatched.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, c]) => {
    console.log(`  [${c}x] ${k}`);
  });
}
