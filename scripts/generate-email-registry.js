/**
 * Build-time script: src/tenant/email-registry.js dosyasını otomatik üretir.
 * src/tenant/{id}/email/surv.js içeren her dizin için import ve renderer eklenir.
 * Çalıştırma: node scripts/generate-email-registry.js
 * package.json "prebuild" hook'u bu scripti otomatik tetikler.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tenantsDir = path.join(__dirname, "../src/tenant");
const outputFile = path.join(tenantsDir, "email-registry.js");

const tenants = fs
  .readdirSync(tenantsDir, { withFileTypes: true })
  .filter((entry) => {
    if (!entry.isDirectory()) return false;
    const survPath = path.join(tenantsDir, entry.name, "email", "surv.js");
    return fs.existsSync(survPath);
  })
  .map((entry) => entry.name);

if (tenants.length === 0) {
  console.warn("[email-registry] Hiç tenant bulunamadı — default kullanılacak.");
}

const imports = tenants
  .map((id) => `import { renderSurveillanceEmail as render_${id} } from "./${id}/email/surv.js";`)
  .join("\n");

const rendererEntries = tenants.map((id) => `  ${id}: render_${id},`).join("\n");

const content = `// Otomatik üretildi — düzenleme yapma. Üretmek için: node scripts/generate-email-registry.js
${imports}

const renderers = {
${rendererEntries}
};

export function renderTenantSurveillanceEmail(tenantId, payload) {
  const render = renderers[String(tenantId || "default")] || renderers.default;
  if (!render) throw new Error(\`Email renderer bulunamadı: \${tenantId}\`);
  return render(payload);
}
`;

fs.writeFileSync(outputFile, content, "utf8");
console.log(`[email-registry] Üretildi: ${tenants.join(", ")} (${tenants.length} tenant)`);
