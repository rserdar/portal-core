/**
 * enrich-nace-codes.mjs
 *
 * certificate-history.json'daki etiketlenmiş kapsamları nace-codes.json'a
 * samples[] olarak ekler. Yerel öneri motorunu güçlendirir.
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
const naceCodes = readJson("src/content/reference/nace-codes.json");

// NACE kodu → nace-codes item map
const naceMap = new Map();
naceCodes.items.forEach((item) => {
  if (item.code) naceMap.set(item.code, item);
});

// Benzersiz kapsamları NACE'ye göre grupla
const kapsamByNace = new Map();
history.items.forEach((item) => {
  if (!item.nace || !item.kapsam) return;
  const kapsam = item.kapsam.trim();
  if (!kapsam || kapsam.match(/^[-]+$/) || kapsam === "Products and details are given in Annex I") return;
  if (!kapsamByNace.has(item.nace)) kapsamByNace.set(item.nace, new Set());
  kapsamByNace.get(item.nace).add(kapsam);
});

let totalAdded = 0;
let nacesEnriched = 0;

kapsamByNace.forEach((kapsamSet, nace) => {
  const target = naceMap.get(nace);
  if (!target) return; // bu NACE kodu referansta yok

  if (!Array.isArray(target.samples)) target.samples = [];

  const existingNorm = new Set(
    target.samples.map((s) => s.trim().toLowerCase())
  );

  let added = 0;
  for (const kapsam of kapsamSet) {
    if (existingNorm.has(kapsam.toLowerCase())) continue;
    // En fazla 12 sample ekle (motorun yükünü sınırla)
    if (target.samples.length >= 12) break;
    target.samples.push(kapsam);
    existingNorm.add(kapsam.toLowerCase());
    added++;
    totalAdded++;
  }

  if (added > 0) {
    nacesEnriched++;
    console.log(`  ${nace}: +${added} sample (toplam ${target.samples.length})`);
  }
});

writeFileSync(
  join(root, "src/content/reference/nace-codes.json"),
  JSON.stringify(naceCodes, null, 2)
);

console.log(`\n=== Zenginleştirme Raporu ===`);
console.log(`NACE kodları zenginleştirilen  : ${nacesEnriched}`);
console.log(`Toplam eklenen sample          : ${totalAdded}`);
