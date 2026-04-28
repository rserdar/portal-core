function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderSurveillanceEmail(payload = {}) {
  const {
    firstName = "Merhaba",
    title = "",
    rows = [],
    startDate = "",
    endDate = "",
    brandName = "Portal",
  } = payload;

  const greeting = [title, firstName].filter(Boolean).join(" ").trim() || "Merhaba";
  const tableRows = rows.map((row) => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(row.date)}</td>
      <td style="padding:12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(row.firm)}</td>
      <td style="padding:12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(row.consultant)}</td>
      <td style="padding:12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(row.standard)}</td>
      <td style="padding:12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(row.certificateNo)}</td>
      <td style="padding:12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(row.accreditation)}</td>
    </tr>
  `).join("");

  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:32px;color:#0f172a;">
      <div style="max-width:900px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;">
        <div style="padding:24px 28px;background:#0f172a;color:#f8fafc;">
          <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.72;">${escapeHtml(brandName)}</p>
          <h1 style="margin:0;font-size:24px;line-height:1.2;">Gozetim Bilgileri</h1>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 14px;font-size:15px;">Sayin ${escapeHtml(greeting)},</p>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#334155;">
            ${escapeHtml(startDate)} - ${escapeHtml(endDate)} tarih araligindaki gozetim kayitlariniz asagidadir.
          </p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f1f5f9;color:#334155;text-align:left;">
                <th style="padding:12px;">Tarih</th>
                <th style="padding:12px;">Firma</th>
                <th style="padding:12px;">Danisman</th>
                <th style="padding:12px;">Standart</th>
                <th style="padding:12px;">Sertifika No</th>
                <th style="padding:12px;">Akreditasyon</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}
