import { execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const historyPath = join(root, "src/data/certificate-history.json");
const unmatchedReportPath = join(
  root,
  "src/data/certificate-history-unmatched.json",
);
const EXCLUDED_STANDARDS = new Set(["CE", "DİĞER"]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, ""));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function cleanText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function normalizeHistory() {
  const history = readJson(historyPath);
  const items = Array.isArray(history.items) ? history.items : [];
  const cleanedItems = [];
  let removedEmptyRows = 0;
  let removedDebugFields = 0;
  let removedExcludedStandards = 0;

  for (const item of items) {
    const standard = cleanText(item.standard);
    if (EXCLUDED_STANDARDS.has(standard)) {
      removedExcludedStandards += 1;
      continue;
    }

    const cleaned = {
      id: item.id,
      standard,
      kapsam: cleanText(item.kapsam),
      scope: cleanText(item.scope),
      ea: cleanText(item.ea),
      nace: cleanText(item.nace),
    };

    if (!cleaned.kapsam && !cleaned.scope) {
      removedEmptyRows += 1;
      continue;
    }

    if ("_score" in item) removedDebugFields += 1;
    if ("_top5" in item) removedDebugFields += 1;
    if ("_needs_review" in item) removedDebugFields += 1;

    cleanedItems.push(cleaned);
  }

  history.items = cleanedItems;
  writeJson(historyPath, history);

  return {
    before: items.length,
    after: cleanedItems.length,
    removedEmptyRows,
    removedDebugFields,
    removedExcludedStandards,
  };
}

function runLabelScript(name) {
  execFileSync("node", [join("scripts", name)], {
    cwd: root,
    stdio: "inherit",
  });
}

function updateHistoryStats() {
  const history = readJson(historyPath);
  const items = Array.isArray(history.items) ? history.items : [];
  const standards = {};

  for (const item of items) {
    const standard = cleanText(item.standard);
    standards[standard] = (standards[standard] || 0) + 1;
  }

  history.stats = {
    ...(history.stats || {}),
    total_rows: items.length,
    standards,
    ea_filled: items.filter((item) => cleanText(item.ea)).length,
    nace_filled: items.filter((item) => cleanText(item.nace)).length,
  };

  writeJson(historyPath, history);
  return history;
}

function buildUnmatchedReport(history) {
  const items = Array.isArray(history.items) ? history.items : [];
  const grouped = new Map();

  for (const item of items) {
    if (cleanText(item.nace)) continue;

    const standard = cleanText(item.standard) || "BELİRSİZ";
    if (!grouped.has(standard)) {
      grouped.set(standard, new Map());
    }

    const key = cleanText(item.kapsam) || cleanText(item.scope) || "(boş kapsam)";
    const entry = grouped.get(standard);
    const next = entry.get(key) || {
      count: 0,
      standard,
      kapsam: cleanText(item.kapsam),
      scope: cleanText(item.scope),
      ids: [],
    };
    next.count += 1;
    next.ids.push(item.id);
    entry.set(key, next);
  }

  const standards = [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "tr"))
    .map(([standard, entry]) => {
      const examples = [...entry.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 25);

      return {
        standard,
        unmatched_count: [...entry.values()].reduce(
          (total, item) => total + item.count,
          0,
        ),
        examples,
      };
    });

  const report = {
    generated_at: new Date().toISOString(),
    source_file: history.source_file || "",
    total_items: items.length,
    unmatched_total: items.filter((item) => !cleanText(item.nace)).length,
    standards,
  };

  writeJson(unmatchedReportPath, report);
  return report;
}

const cleanupSummary = normalizeHistory();

runLabelScript("label-history-iso13485.mjs");
runLabelScript("label-history-iso22000.mjs");
runLabelScript("label-history-iso50001.mjs");
runLabelScript("label-certificate-history.mjs");
normalizeHistory();

const updatedHistory = updateHistoryStats();
const unmatchedReport = buildUnmatchedReport(updatedHistory);

console.log("\n=== certificate-history bakım özeti ===");
console.log(`Satır sayısı        : ${cleanupSummary.before} -> ${cleanupSummary.after}`);
console.log(`Standart silindi    : ${cleanupSummary.removedExcludedStandards} (CE, DİĞER)`);
console.log(`Boş satır silindi   : ${cleanupSummary.removedEmptyRows}`);
console.log(`Debug alan temizliği: ${cleanupSummary.removedDebugFields}`);
console.log(`NACE dolu kayıt     : ${updatedHistory.stats?.nace_filled || 0}`);
console.log(`EA dolu kayıt       : ${updatedHistory.stats?.ea_filled || 0}`);
console.log(`Eşleşmeyen kayıt    : ${unmatchedReport.unmatched_total}`);
console.log(`Rapor               : src/data/certificate-history-unmatched.json`);
