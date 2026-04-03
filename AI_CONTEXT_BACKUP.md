# 🤖 Project Intelligence & Context (AI_CONTEXT.md v2.9.0)

This document is the **Primary Source of Truth** for the modernized Medicert Portal. It provides absolute technical precision, comprehensive data schemas with exact JavaScript property mappings, and formal architectural workflows.

---

## 🏗️ Core Architecture & Data Strategy

### 1. Database & Persistence Layer
- **Primary Database:** **Google Sheets** (Single Source of Truth).
- **Backend Engine:** **Modular Google Apps Script** (GAS) in `src/gas/api/`.
- **Legacy Knowledge:** `src/gas/server/*.gs` contains original business rules and must be referenced for complex calculation audits.
- **Client Cache:** **IndexedDB** (`medicert-portal-db`) stores local copies for zero-latency UI.

### 2. Middleware & Security (Cloudflare Worker)
- **Role:** Secure API Proxy & Secret Injector.
- **Security Flow:** **Browser (No Key)** -> **Cloudflare Worker (Injects Secret API_KEY)** -> **GAS Bridge**.
- **Worker Secrets:** `API_KEY` (Auth), `GAS_API_URL` (Execution URL).

---

## 📂 Technical Directory Matrix

### `/src/gas/api/` (Modern Services)
- `BaseService.gs`: Shared spreadsheet access, logging, and `LAST_UPDATE` management.
- `CompanyService.gs`: Specialized logic for the `Firmalar` sheet.
- `CertificateService.gs`: Specialized logic for the `Sertifika` sheet.
- `AuditService.gs`: Calendar Integration & Surveillance Archiving.
- `DriveService.gs`: Recursive folder scanning and hierarchy management.
- `DocumentService.gs`: Batch generation engine for ISO documents using `makeCopy`.
- `PDFService.gs`: **Primary Converter:** Local `pdf.serdar.cc` (with Token). **Fallback:** iLovePDF.

### `/src/lib/` (Core Logic)
- `api.ts`: Fetch wrapper for CF Worker.
- `sync.ts`: **The Brain.** Implements the decision tree for incremental background synchronization.
- `db.ts`: `idb-keyval` wrapper for structured IndexedDB access.
- `store.ts`: Defines shared global stores (`$companies`, `$certificates`, `$syncStatus`, `$lastSyncTime`).

### `/src/pages/` (UI Modules)
- `index.astro`: Reactive Dashboard.
- `search.astro`: Cached company lookup.
- `company/add.astro`: Registration & Property Mapping.
- `certificates.astro`: Grid view & Bulk Surveillance updates.
- `documents/add.astro`: Batch document production.
- `documents/view.astro`: Recursive Drive Explorer & PDF conversion management.
- `audits/index.astro`: Audit timeline & Calendar overview.

---

## 📊 Data Schema & Property Mapping (Definitive)

> [!IMPORTANT]
> **Data Formats:**
> - **Dates:** All dates are stored as **Strings** in the `dd.MM.yyyy` format.
> - **Boolean:** Status flags are represented by **TRUE/FALSE** strings.

### 🏢 Companies (Sheet: `Firmalar`)
| Index | Col | Name | Ref (crtInfo) | Role |
| :--- | :--- | :--- | :--- | :--- |
| **0** | **A** | **Firma No** | `newID` | Primary Key. |
| **1** | **B** | **Firma Adı** | `nickname` | Mnemonic short name for file pathing. |
| **2** | **C** | **Unvan** | `unvan` | Official corporate title. |
| **3** | **D** | **Adres** | `adres` | Physical address. |
| **4** | **E** | **İl** | `sehir` | City. |
| **5** | **F** | **Ülke** | `ulke` | Country (Defaults to TÜRKİYE). |
| **6** | **G** | **Yazışma Adresi** | `yazisma` | Specific mailing address. |
| **7** | **H** | **Vergi Dairesi** | `vergiD` | Tax office name. |
| **8** | **I** | **Vergi Numarası** | `vergiN` | Tax registration number. |
| **9** | **J** | **Telefon** | `tel` | Phone. |
| **10** | **K** | **Faks** | `faks` | Fax. |
| **11** | **L** | **İnternet** | `www` | Website URL. |
| **12** | **M** | **Mail** | `mail` | Contact email. |
| **13** | **N** | **Yetkili Adı** | `yetA` | Signatory name. |
| **14** | **O** | **Yetkili Unvanı** | `yetU` | Signatory title. |
| **15** | **P** | **KYT** | `kyt` | Quality Management Representative. |
| **16** | **Q** | **İrtibat Kişisi** | `irtA` | Contact Person. |
| **17** | **R** | **İrtibat Unvanı** | `irtU` | Contact Title. |
| **18** | **S** | **İrtibat Tel** | `irtN` | Contact Phone. |
| **19** | **T** | **İrtibat Mail** | `irtM` | Contact Mail. |
| **20** | **U** | **Türkçe Kapsam**| `kapsam` | ISO Scope (TR). |
| **21** | **V** | **İngilizce Kapsam**| `scope` | ISO Scope (EN). |
| **22** | **W** | **Yapılan İş** | `yapis` | Nature of business. |
| **23** | **X** | **TCS** | `tcs` | Total Employee Count. |
| **24** | **Y** | **YCS** | `ycs` | Management System Standard Flag. |
| **25** | **Z** | **UCS** | `ucs` | Quality System Standard Flag. |
| **26** | **AA** | **ACS** | `acs` | Environmental System Standard Flag. |
| **27** | **AB** | **YZCS** | `yzcs` | Software System Standard Flag (Yazılım). |
| **28** | **AC** | **TASCS** | `tascs` | Design System Standard Flag (Tasarım). |
| **29** | **AD** | **Alan** | `alan` | Workspace Area Calculation. |
| **30** | **AE** | **Departman** | `dept` | Department listing. |
| **31** | **AF** | **Vardiya** | `vardiya`| Shift Details. |
| **32** | **AG** | **Logo/Kase** | `logoK` | Path to stamps/logos. |
| **33** | **AH** | **Danışman** | `dan` | Company Consultant. |
| **34** | **AI** | **EA** | `ea` | EA Certification Code. |
| **35** | **AJ** | **NACE** | `nace` | Industry Sector Code. |

### 🎖️ Certificates (Sheet: `Sertifika`)
| Index | Col | Name | Ref (crtInfo) | Role |
| :--- | :--- | :--- | :--- | :--- |
| **0** | **A** | **ID** | `newID` | Primary Key. |
| **1** | **B** | **Nickname** | `nick` | Alias. |
| **2** | **C** | **Firma No** | `firmano`| ID Link. |
| **3** | **D** | **Standart** | `standart`| e.g., ISO 9001. |
| **4** | **E** | **Denetim Tipi**| `denetim`| Certification type. |
| **5** | **F** | **sNo** | `sno` | Certificate Number. |
| **6** | **G** | **gst** | `gst` | Cert Date (dd.MM.yyyy). |
| **7** | **H** | **goz** | `goz` | Next Surveillance (dd.MM.yyyy). |
| **8** | **I** | **stt** | `stt` | Last Audit (dd.MM.yyyy). |
| **9** | **J** | **sgt** | `sgt` | Validity Date (dd.MM.yyyy). |
| **10** | **K** | **Kapsam** | `kapsam` | Audit Scope (TR). |
| **11** | **L** | **Scope** | `scope` | Audit Scope (EN). |
| **12** | **M** | **Logo** | `logo` | Logo Path. |
| **13** | **N** | **Kod** | `kod` | NACE Code. |
| **14** | **O** | **Akreditasyon**| `akreditasyon`| Body name. |
| **15** | **P** | **Akredite** | `akredite`| Body status. |
| **16** | **Q** | **Danışman** | `dan` | Consultant name. |
| **17** | **R** | **Durum** | `durum` | Active/Expired. |
| **18** | **S** | **Not** | `not` | General Notes. |
| **19** | **T** | **Gözetim Conf.**| `gozetimConfirmed`| **TRUE/FALSE** status. |
| **20** | **U** | **Other** | `other` | Custom Standard (only if Standart == "Diğer"). |
| **21** | **V** | **Calendar ID**| `eventId` | Google Calendar Event ID. |
| **22** | **W** | **QR Code** | `qr` | QR Metadata/Link. |
| **23** | **X** | **Cert Link** | `certLink` | Direct link to Drive doc. |

### 📅 Audits (Sheet: `Denetim`)

**Terminology:**
- **MD:** Man-Days (Adam/Gün) | **LA:** Lead Auditor (Başdenetçi)
- **FA:** Auditor (Tetkikçi) | **SA:** Sector Expert (Sektör Uzmanı)

| Index | Col | Name | Role |
| :--- | :--- | :--- | :--- |
| **0** | **A** | **ID** | Audit Record ID. |
| **1** | **B** | **Nickname** | Link to Company name. |
| **2** | **C** | **Firma No** | Link to Company ID. |
| **3** | **D** | **Standart** | ISO Standard. |
| **4** | **E** | **Denetim Tipi**| Certification Type. |
| **5-6** | **F-G** | **A1 Auditors** | Auditor (F), Lead Auditor (G). |
| **7-8** | **H-I** | **A2 Auditors** | Auditor (H), Lead Auditor (I). |
| **9-14** | **J-O** | **Stage 1 (A1)** | Dates (J-K), MD (L), LA (M), FA (N), SA (O). |
| **15-20**| **P-U** | **Stage 2 (A2)** | Dates (P-Q), MD (R), LA (S), FA (T), SA (U). |

**Flag Mapping (V-AC Checkboxes):**
- **V (21): QMS** (ISO 9001) | **W (22): MDD** (ISO 13485) | **X (23): EMS** (ISO 14001) | **Y (24): OHS** (ISO 45001)
- **Z (25): FSMS** (ISO 22000) | **AA (26): ISMS** (ISO 27001) | **AB (27): ENGY** (ISO 50001) | **AC (28): GMP** (Good Manufacturing)

**Coverage & Management (AD-AG):**
- **AD-AE (29-30): Coverage** | String description of audit scope (used as Calendar title).
- **AF-AG (31-32): Events** | Stage 1 Event ID (AF), Stage 2 Event ID (AG).

---

## ⚙️ GAS Script Properties (The "Vault")
- `API_KEY`: Secret used to authenticate POST requests.
- `LAST_UPDATE`: Numeric timestamp (Incremental Sync brain).
- `SPREADSHEET_ID`: Unique ID for the target Google Sheet.
- `ILOVEPDF_PUBLIC_KEY`: Fallback PDF converter.
- `LOCAL_CONVERTER_TOKEN`: Primary converter (pdf.serdar.cc).

---

## 🔌 API Gateway & Contract (Formal Specification)

### 1. JSON Contract
**Request (POST):**
*(Worker appends `apiKey` internally before forwarding to GAS)*
```json
{
  "action": "string",
  "params": { "id": "integer", "data": "object" },
  "apiKey": "string" 
}
```

**Response (JSON):**
```json
{
  "success": boolean,
  "data": "any | null",
  "error": "string | null"
}
```

### 2. Comprehensive Action List (Active v2.0)
| Module | Action | Description |
| :--- | :--- | :--- |
| **Firma** | `getCompanies`, `getCompanyById`, `addCompany`| Registration & Lookup. *(update/delete Pending)*. |
| **Sertifika** | `getCertificates`, `getCertificateById`, `updateGozetim`| Certification lifecycle. |
| **Drive** | `getFolderId`, `getRecentFiles` | Recursive explorer. |
| **Docs** | `generateIso`, `getAvailableSets`, `prepareBatchFolders`| Generation engine. |
| **PDF** | `convertToPdf` | Doc->PDF transformation. |
| **Audit** | `getAudits`, `scheduleAudit`, `updateSurveillance`| Planning & Archiving. |
| **Sync** | `syncCheck` | Heartbeat & Version check. |

---

## 🔄 Synchronization & SyncManager Algorithm
1. **Check:** call `syncCheck` -> get `Server.LAST_UPDATE`.
2. **Decision:** If `Server.LAST_UPDATE > Local.last_sync` -> **Full Hydration** of Nano Stores.
3. **Invalidation:** Every write in GAS increments `LAST_UPDATE`.

---

## 🚀 Production Deployment Workflow
- **Backend (GAS):** Deploy EXE URL (New Version). Set Script Properties.
- **Core (Worker):** `wrangler deploy`. Set `API_KEY` and `GAS_API_URL` secrets.
- **UI (Astro):** `npm run build` -> CF Pages. **CRITICAL:** Set `PUBLIC_WORKER_URL` in Pages Settings.

## 💻 Local Development Guide
1. **Middleware (Worker):** Run `npx wrangler dev`. Ensure local secrets match GAS.
2. **Frontend (Astro):** Run `npm run dev`. Ensure `PUBLIC_WORKER_URL` in `.env` points to local Worker.
3. **GAS Backend:** Ensure `API_KEY` script property is set for local proxy calls.

---
**Status:** Secured, Fully Restored & Perfected Enterprise Release.
**Architecture Version:** 2.9.0 (Absolute Stable Release)
