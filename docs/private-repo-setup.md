# Private Tenant Repo Kurulumu

`portal-tenants` (private), `portal-core` (public) üzerine tenant katmanını yazar ve deploy eder.

## Repo yapısı

```
portal-tenants/
  medicert/
    src/
      tenant/
        medicert/
          config.ts
          email/
            surv.js
    wrangler.medicert.toml
  firma2/
    src/
      tenant/
        firma2/
          config.ts
          email/
            surv.js
    wrangler.firma2.toml
  .github/
    workflows/
      deploy.yml
```

## GitHub Secrets (private repoda tanımlanır)

| Secret | Açıklama |
| :--- | :--- |
| `CLOUDFLARE_API_TOKEN` | Pages:Edit + Workers:Edit yetkili CF token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare hesap ID |
| `CORE_REPO_TOKEN` | `portal-core` reposunu okuyabilecek PAT (public repoysa gerekmez) |

## `.github/workflows/deploy.yml` (private repoya kopyala)

```yaml
name: Deploy Tenants

on:
  push:
    branches: [main]
  repository_dispatch:
    types: [core-updated]   # portal-core güncellenince tetiklenir
  workflow_dispatch:

jobs:
  deploy:
    name: Deploy — ${{ matrix.tenant }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - tenant: firma1
            pages_project: firma1-portal
            brand_app_name: "Firma1 Portal"
            brand_short_name: "Firma1"
            brand_description: "Firma1 operasyon portalı"
            wrangler_config: firma1/wrangler.firma1.toml

          # Yeni tenant:
          # - tenant: firma2
          #   pages_project: firma2-portal
          #   brand_app_name: "Firma2 Portal"
          #   brand_short_name: "Firma2"
          #   brand_description: "Firma2 operasyon portalı"
          #   wrangler_config: firma2/wrangler.firma2.toml

    steps:
      - name: Checkout private repo (tenant configs)
        uses: actions/checkout@v4
        with:
          path: tenants

      - name: Checkout portal-core (public)
        uses: actions/checkout@v4
        with:
          repository: YOUR_ORG/portal-core
          path: core
          # token: ${{ secrets.CORE_REPO_TOKEN }}  # private ise açın

      - name: Overlay tenant files
        run: |
          cp -r tenants/${{ matrix.tenant }}/src/tenant/${{ matrix.tenant }} \
                core/src/tenant/${{ matrix.tenant }}
          cp tenants/${{ matrix.wrangler_config }} core/

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: core/package-lock.json

      - name: Install dependencies
        working-directory: core
        run: npm ci

      - name: Build — ${{ matrix.tenant }}
        working-directory: core
        env:
          TENANT_ID: ${{ matrix.tenant }}
          PUBLIC_BRAND_APP_NAME: ${{ matrix.brand_app_name }}
          PUBLIC_BRAND_SHORT_NAME: ${{ matrix.brand_short_name }}
          PUBLIC_BRAND_DESCRIPTION: ${{ matrix.brand_description }}
        run: npm run build

      - name: Deploy Pages — ${{ matrix.tenant }}
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: core
          command: pages deploy dist --project-name=${{ matrix.pages_project }} --branch=main

      - name: Deploy Worker — ${{ matrix.tenant }}
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: core
          command: deploy --config $(basename ${{ matrix.wrangler_config }})
```

## Yeni tenant ekleme adımları

1. `portal-tenants` reposunda `firma2/src/tenant/firma2/` klasörünü oluştur
2. `config.ts` ve `email/surv.js` dosyalarını yaz (`default` tenant'ı örnek al)
3. `firma2/wrangler.firma2.toml` dosyasını oluştur (mevcut tenant toml örneklerinden kopyala, binding'leri güncelle)
4. `deploy.yml` matrix'ine yeni blok ekle
5. Cloudflare'de D1 database + KV namespace oluştur, toml'a yaz
6. `wrangler d1 migrations apply` çalıştır (private repo CI'dan da yapılabilir)
7. GAS: yeni bağımsız proje aç, Script Properties'i doldur

## Otomatik yayılma akışı

```
portal-core'a push
    ↓  (notify-tenants job — portal-core/deploy.yml içinde etkinleştirilirse)
portal-tenants CI tetiklenir  (repository_dispatch: core-updated)
    ↓
Her tenant için: core çek → tenant overlay → build → deploy
```

`portal-core/deploy.yml` dosyasındaki `notify-tenants` job'undaki yorumları açın ve
`YOUR_ORG/portal-tenants` ile `TENANTS_REPO_TOKEN` secret'ını ayarlayın.
