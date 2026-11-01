# charts: chart pack hosting on Cloudflare R2

Hosts the official CAAI CVFR MBTiles (100+ MB per edition) and the Israel data packs. R2 because egress is free; Vercel
Blob's 10 GB/month transfer would cover only ~50 downloads. No Worker: the bucket is public-read through an r2.dev URL
or a custom domain, and the app downloads straight from it.

## URL layout (public base = `https://<public-host>`)

```
/<product>/manifest.json                 product index the app polls: { product, updatedAt, latest, editions[] }
/<product>/<edition>/manifest.json       the pipeline's manifest + product, edition, published, publishedAt, files[]
/<product>/<edition>/<file>              packs, e.g. /israel-cvfr/2025-02/israel-cvfr-2025-02.mbtiles
```

- `latest` is the newest **published** edition (null if none). Unpublished editions are listed with `published: false`;
  the app must ignore them (IL-9). `files[]` entries: `{ name, bytes, sha256, path, url? }`; the app verifies `sha256`.
- Packs are cached `immutable` (an edition's files never change; publish a new edition id instead). Manifests: `max-age=300`.

## One-time setup (owner)

```
cd web/charts && npm ci && npx wrangler login
npx wrangler r2 bucket create openefb-charts
npx wrangler r2 bucket cors set openefb-charts --file cors.json
npx wrangler r2 bucket dev-url enable openefb-charts     # prints https://pub-<hash>.r2.dev ; or attach a custom domain in the dashboard
```

r2.dev URLs are rate-limited and meant for development; attach a custom domain (dashboard > R2 > bucket > Settings)
before pilots depend on it. Don't upload anything publicly before the CAAI permission is settled (IL-9).

## Publish an edition

```
web/charts/publish.sh --product israel-cvfr --edition 2025-02 \
  --pack tools/caai-chart/out/2025-02/israel-cvfr-2025-02.mbtiles \
  --manifest tools/caai-chart/out/2025-02/manifest.json \
  --remote --base-url https://<public-host>            # uploaded as published=false
web/charts/publish.sh ...same... --remote --manifest-only --approve   # the owner's go-ahead: flips published=true, no re-upload
```

Without `--remote` everything goes to wrangler's local R2 simulator (`.wrangler/state`), the default for dry runs.
`--dry-run` prints the plan and manifests without touching any bucket. Order of writes: packs, edition manifest, product
index. Re-publishing never unpublishes. Wrangler's upload limit is 300 MiB per file; larger packs need the S3 API
(rclone or `aws s3 --endpoint-url https://<account>.r2.cloudflarestorage.com`) and then `--manifest-only`.

`npm test` covers the manifest rules (`lib.mjs`). Free tier: 10 GB storage (~80 editions at 120 MB), no egress fees.
