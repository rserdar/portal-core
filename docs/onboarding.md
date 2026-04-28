# Tenant Onboarding

Bu proje tenant-aware çalışacak şekilde hazırlanmıştır. Yeni tenant eklerken çekirdeği değiştirmeden aşağıdaki akışı izleyin.

## 1. Tenant klasörünü oluştur

`src/tenant/default/` klasörünü kopyalayın:

```text
src/tenant/<tenant-id>/config.ts
```

Zorunlu alanlar:

- `brand.appName`
- `brand.shortName`
- `brand.description`
- `brand.logoSrc`
- `brand.logoAlt`
- `userDefaults.email`
- `userDefaults.adminEmails`
- `integrations.workerUrl`
- `integrations.certificateLookupUrl`

Çekirdek kod tenant klasörünü doğrudan import etmez. Her zaman `@tenant/config` alias'ı kullanılır.

## 2. Build env değerlerini ayarla

Astro build için:

```env
TENANT_ID=<tenant-id>
PUBLIC_WORKER_URL=https://api.example.com
PUBLIC_BRAND_APP_NAME=Example Portal
PUBLIC_BRAND_SHORT_NAME=Example
PUBLIC_BRAND_DESCRIPTION=Example operasyon portalı
```

Yerelde `.dev.vars` yalnızca secret override için kullanılır. Secret değerleri `wrangler.toml` içine yazılmaz.

## 3. Tenant wrangler dosyasını oluştur

Mevcut örnek:

```text
wrangler.medicert.toml
```

Yeni tenant için aynı yapıda bir dosya üretin:

```text
wrangler.<tenant-id>.toml
```

Burada tenant'a özel olanlar:

- `account_id`
- `routes`
- `kv_namespaces`
- `d1_databases`
- `[vars].APP_NAME`
- `[vars].APP_ORIGIN`
- `[vars].WORKER_LABEL`
- `[vars].ALLOWED_ORIGINS`

Deploy örneği:

```bash
npx wrangler deploy --config wrangler.<tenant-id>.toml
```

## 4. Secret'ları tanımla

Cloudflare Worker secret'ları:

- `API_KEY`
- `GAS_API_URL`
- gerekiyorsa diğer tenant-specific secret'lar

Örnek:

```bash
npx wrangler secret put API_KEY
npx wrangler secret put GAS_API_URL
```

## 5. D1 migration çalıştır

Her tenant kendi D1 veritabanını kullanmalıdır.

Migration komutu:

```bash
npx wrangler d1 migrations apply <db-name> --remote --config wrangler.<tenant-id>.toml
```

`wrangler d1 execute --file` kullanılmaz.

## 6. GAS projesini tenant bazında hazırla

Her tenant bağımsız GAS projesi kullanır.

Script Properties içine en az şu değerleri girin:

- `API_KEY`
- `WORKER_URL`
- `SPREADSHEET_ID`
- `BACKUP_FOLDER_ID`

Tenant branding ve bildirim override'ları için önerilen ek property'ler:

- `APP_NAME`
- `APP_FORM_PRIMARY_LABEL`
- `APP_FORM_SECONDARY_LABEL`
- `CONTRACT_BRAND_LABEL`
- `NOTIFICATION_FROM`
- `NOTIFICATION_FROM_NAME`
- `NOTIFICATION_REPORT_RECIPIENT`

Notlar:

- `API_KEY`, Worker secret ile birebir aynı olmalıdır.
- Drive klasör ID'leri ve template dosya ID'leri GAS kodunda tenant'a özel kalabilir.
- Sunucu URL'si veya API anahtarı gibi operasyonel değerler Script Properties'e alınmalıdır.

## 7. CI/CD'ye Tenant Ekle

`.github/workflows/deploy.yml` dosyasındaki `matrix.include` listesine yeni blok ekleyin:

```yaml
- tenant: <tenant-id>
  pages_project: <tenant-id>-portal
  brand_app_name: "Firma Portal"
  brand_short_name: "Firma"
  brand_description: "Firma operasyon portalı"
  wrangler_config: wrangler.<tenant-id>.toml
```

`src/tenant/email-registry.js` dosyasına da import + renderer kaydı ekleyin.

## 8. Doğrulama

Kontrol listesi:

- `TENANT_ID=<tenant-id>` ile `npm run build` başarılı mı?
- `@tenant/config` doğru brand bilgilerini üretiyor mu?
- Worker doğru origin'leri kabul ediyor mu?
- D1 migration'lar eksiksiz mi?
- GAS `API_KEY` doğrulaması çalışıyor mu?
- Header/logo/title/QR linkleri doğru tenant değerlerini gösteriyor mu?
- GitHub Actions deploy job'ı yeşil mi?
