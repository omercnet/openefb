# ota: self-hosted Expo Updates for the React Native spike

Status: spike. Deployed 2026-11-09 to `https://openefb-ota.omerc.workers.dev` (bucket `openefb-ota`, nothing published yet).
The end-to-end client tests run against `wrangler dev` with the local R2 simulator in CI (`.github/workflows/app.yml`).

A read-only Cloudflare Worker serves Expo Updates protocol v1 from an R2 bucket (`openefb-ota`, binding `OTA_BUCKET`).
The publisher CLI (`cli/ota.mjs`) signs on the publisher's machine and writes R2 directly, so the Worker has no upload
route, no secret and no signing key. No runtime dependencies.

## Routes

| Route | Does |
|---|---|
| `GET /manifest` | Replays the stored signed part for `(expo-channel-name, expo-runtime-version, expo-platform)` as `multipart/mixed`; 204 when no pointer exists; 400 on bad headers (protocol must be `1`); 500 on a corrupt pointer |
| `GET /assets/<sha256hex>` | Streams the immutable asset with its stored content type and `cache-control: public, max-age=31536000, immutable` |
| `GET /health` | `{"ok":true}` |

The channel defaults to `production` when `expo-channel-name` is absent. The app sends it through
`updates.requestHeaders`.

## R2 layout

```
assets/<sha256hex>                                          content addressed, immutable
updates/<channel>/<runtimeVersion>/<platform>/<id>.json     archive of every signed part
channels/<channel>/<runtimeVersion>/<platform>.json         pointer the Worker reads
```

A pointer is `{ kind: "manifest" | "directive", body, signature, updateId?, createdAt, publishedBy? }`. `body` is the exact
text that was signed; the Worker never re-serialises it. Segments match `^[A-Za-z0-9._-]{1,128}$`.

## Keys

Generate once, with Expo's tool (`private-key.pem` PKCS#8, `certificate.pem` self-signed):

```
npx expo-updates codesigning:generate --key-output-directory ~/.config/kanaf/ota \
  --certificate-output-directory <app>/ota --certificate-validity-duration-years 10 --certificate-common-name Kanaf
```

- The certificate goes into the app (`updates.codeSigningCertificate`, keyid `main`, alg `rsa-v1_5-sha256`). It is public.
- The private key stays on the publisher machine or in a CI secret written to a temp file. Never in the Worker, `wrangler.toml`,
  R2 or this repo. The CLI refuses `--key` paths inside the checkout unless `--allow-repo-key`; `tools/hooks/forbidden-files.sh`
  rejects any `private-key.pem` / `public-key.pem`.
- An attacker with Cloudflare write access cannot make the app accept a new update (no signature) or swap an asset (sha256 is
  in the signed manifest). They can delete pointers (clients keep what they have), deny service, or replay an older validly
  signed update to another channel of the same runtime version (residual risk).

## Publish and roll back

Default mode is `--local` (nothing leaves the machine). `--remote` writes the real bucket and needs `wrangler login`.

```
cd web/ota && npm ci
node cli/ota.mjs publish --dist <expo export dir> --platform ios --channel production \
  --runtime-version "$(cd ../../app && npx expo-updates runtimeversion:resolve --platform ios | jq -r .runtimeVersion)" \
  --key ~/.config/kanaf/ota/private-key.pem --base-url https://<worker-host> [--dry-run]
node cli/ota.mjs rollback --embedded --platform ios --channel production --runtime-version <rv> --key <pem>
node cli/ota.mjs rollback --to <updateId> --certificate <pem> --platform ios --channel production --runtime-version <rv> --key <pem>
node cli/ota.mjs status --platform ios --channel production --runtime-version <rv>
node cli/ota.mjs verify --platform ios --channel production --runtime-version <rv> --certificate <pem>
```

`publish` prints `published <id> ... assets=<n> uploaded=<m>`. Writes go assets, archive, pointer, so a crash leaves the
channel unchanged. Asset `key` is the md5 hex of the file so assets already embedded in the binary are not downloaded again.
`extra.expoClient` comes from `<dist>/expoConfig.json` when present.

`rollback --embedded` signs a `rollBackToEmbedded` directive (clients roll back only when its `commitTime` is newer than the
running update). `rollback --to` republishes the archived manifest under a new id and a new `createdAt`, because clients
launch the newest `createdAt` they hold: re-pointing to old bytes would be ignored by devices already on the newer update.
It needs the private key by design. `verify` accepts a certificate or a public key PEM.

Exit codes: 0 ok, 1 failure, 2 usage.

## Runtime-version safety

Use `runtimeVersion: { policy: "fingerprint" }` in the app. Pointers are keyed by runtime version, so a binary with different
native code looks up another key and gets 204. Publish with the runtime version resolved from the same checkout and
environment the binary was built from.

## What needs a store release

Anything that changes the fingerprint: native dependency changes, Expo SDK upgrades, config plugins or permissions,
`expo-build-properties`, icons and splash, Info.plist / manifest entries, the signing certificate. JS, assets listed in
`metadata.json`, `EXPO_PUBLIC_*` values and the bundled database file can ship over the air.

## Develop

```
npm test && npm run typecheck
npm run dev          # wrangler dev --port 8787 --local; the CLI shares its local R2 state (.wrangler/state) from this directory
```

Tests generate RSA keys in memory; no key material is committed. `test/fixtures/dist` is a tiny `expo export` layout.

## Limits

Workers free: 100k requests/day, 10 ms CPU (streaming a body is I/O, not CPU; to be measured on a real deploy). R2 free: 10 GB,
no egress fees. Not built: percentage rollout, D1/KV, upload endpoint, key rotation tooling, asset diffing.
