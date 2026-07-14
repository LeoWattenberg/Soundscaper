# Soundscaper

Soundscaper is a local-first multitrack audio editor for the browser. Projects,
recordings, and imported audio remain in the browser's origin-private storage.
The application is maintained by [kw.media](https://kw.media) and distributed
under AGPL-3.0-only, with third-party components documented in
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).

## Local development

```sh
npm install
npm run dev
```

English and German are always available at `/en/` and `/de/`. Additional
Audacity-backed static locale routes are generated from the reviewed allowlist
in `src/i18n/locales.js`. Embedding views without the Soundscaper sidebar use
the same tags under `/embed/<locale>/`.

The production FFmpeg runtime is loaded lazily from the versioned URL configured
by `PUBLIC_FFMPEG_CORE_BASE_URL`. Audacity-derived locale packs are resolved from
the versioned root configured by `PUBLIC_TRANSLATIONS_BASE_URL`. Copy
`.env.example` to `.env` to override either URL locally.

## Checks

```sh
npm test
npm run audit:staffpad
npm run build
npm run test:browser
```

`npm run build` fails when any generated Pages asset exceeds Cloudflare's 25 MiB
limit. FFmpeg's larger WASM runtime is therefore published to R2 rather than
included in `dist/`.

## Cloudflare production setup

Cloudflare Pages can build and deploy Soundscaper directly from GitHub. The
Pages deployment therefore does not need a GitHub Actions deployment workflow,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, or an R2 bucket variable. The
independent translation publisher described below has narrowly scoped S3
credentials for its dedicated bucket; those credentials are never available to
the Pages build or the FFmpeg asset publisher.

### 1. Publish the FFmpeg runtime to R2

Create an R2 Standard bucket named `soundscaper-assets`. Give it the custom
domain `assets.soundscaper.org` and public read access.

FFmpeg 0.12.10 is versioned and only needs to be uploaded once. The simplest
option is to upload these two files in the R2 dashboard:

- `node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js`
- `node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm`

Store both objects under `runtime/ffmpeg/0.12.10/`, preserving their filenames,
then add the CORS policy in R2 → `soundscaper-assets` → Settings. The policy in
`r2-cors.json` uses Wrangler's configuration shape; the R2 dashboard can also
accept the equivalent JSON:

```json
[
  {
    "AllowedOrigins": ["https://soundscaper.org", "https://kw.media"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "ETag"],
    "MaxAgeSeconds": 86400
  }
]
```

To use the included upload script instead, create a Cloudflare API token with
**Workers R2 Storage: Edit** for the account containing the bucket. Put the
credentials in a temporary, gitignored `.env` file:

```dotenv
CLOUDFLARE_ACCOUNT_ID=<account-id>
CLOUDFLARE_API_TOKEN=<api-token>
```

Run `npm run deploy:runtime`, then delete `.env`. These credentials are only
needed for that local command and do not need to be stored in GitHub or in the
Pages project. A normal `wrangler login` OAuth token may not include R2 access;
in that case Wrangler can misleadingly report an existing bucket as nonexistent.

### 2. Connect Cloudflare Pages to GitHub

1. Add `soundscaper.org` as a Cloudflare zone and point the registrar's
   nameservers to Cloudflare. An apex Pages domain must be in the same
   Cloudflare account.
2. In Workers & Pages, choose **Create application → Pages → Connect to Git**.
3. Authorize the Cloudflare GitHub app for `LeoWattenberg/Soundscaper` and select
   that repository.
4. Use production branch `main`, the Astro framework preset, build command
   `npm run build`, and output directory `dist`. Leave the root directory empty.
5. Attach `soundscaper.org` under the Pages project's custom domains.

Cloudflare will build and deploy every push to `main` and create preview
deployments for other selected branches.

### 3. Configure Pages build variables

In the Pages project, open **Settings → Variables and Secrets**. Add these to
both Production and Preview unless noted otherwise:

- `ASTRO_SITE` = `https://soundscaper.org`
- `PUBLIC_FFMPEG_CORE_BASE_URL` =
  `https://assets.soundscaper.org/runtime/ffmpeg/0.12.10`
- `PUBLIC_TRANSLATIONS_BASE_URL` =
  `https://translations.soundscaper.org/runtime/translations/audacity/4`
- `NODE_VERSION` = `22`
- Encrypted secret `NODE_AUTH_TOKEN` = a GitHub personal access token (classic)
  with `read:packages` and read access to the Audacity Design System package.

The last secret is currently required because the Audacity Design System React
components are distributed as the authenticated GitHub Packages package
`@dilsonspickles/components`. Soundscaper imports its controls, theme and
accessibility providers, and stylesheet directly. The package name is the
publisher scope; it is the Audacity Design System component package, not a
different design system.

GitHub Packages requires authentication even for public npm packages. To remove
this final build secret, publish the component package to an anonymously
readable npm registry or vendor/build it as part of this repository.

The optional GitHub Actions quality workflow also needs a repository secret
named `PACKAGES_TOKEN` with the same package-read permission. It is not used for
deployment and can be omitted if that workflow is disabled.

### 4. Configure the Audacity translation publisher

Create a second R2 Standard bucket named `soundscaper-translations`, enable
public reads through the custom domain `translations.soundscaper.org`, and apply
[`r2-translations-cors.json`](r2-translations-cors.json) during one-time bucket
administration. The file uses Wrangler's CORS configuration shape; the
equivalent policy can be entered in the R2 dashboard. The publisher's
object-scoped token deliberately cannot change bucket CORS. This bucket must
remain separate from `soundscaper-assets`: the automated translation credential
must not be able to replace executable FFmpeg JavaScript or WebAssembly. If a
Pages preview uses an origin other than `https://soundscaper.pages.dev`, add that
exact origin to the CORS policy before testing remote packs from the preview.
After changing CORS on a bucket that is already serving the custom domain,
purge cached objects for that hostname so cached responses acquire the new
headers.

R2 custom domains do not cache JSON by default. Add a Cache Rule for
`translations.soundscaper.org` that makes the versioned `/packs/` and
`/releases/` paths under `/runtime/translations/audacity/4/` eligible for cache
and respects the origin `Cache-Control` header. Explicitly bypass cache for
`/runtime/translations/audacity/4/latest.json`. Set Edge TTL to zero/bypass for
non-2xx responses so a request made before an immutable release is uploaded
cannot leave a cached 404 at its predictable release path. The publisher writes versioned
objects with a one-year immutable policy and writes the pointer with `no-store`.
See Cloudflare's [R2 cache behavior](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/).

In GitHub, create a protected environment named `translations-production` with:

- environment variable `R2_TRANSLATIONS_ENDPOINT` set to the full S3 endpoint,
  normally `https://<account-id>.r2.cloudflarestorage.com` (use the
  jurisdiction-specific endpoint for an EU or FedRAMP bucket);
- secret `R2_TRANSLATIONS_ACCESS_KEY_ID`;
- secret `R2_TRANSLATIONS_SECRET_ACCESS_KEY`.

Generate those two secrets under **R2 → Manage API Tokens** with **Object Read &
Write**, restricted to `soundscaper-translations` only, as described in
Cloudflare's [R2 authentication guide](https://developers.cloudflare.com/r2/api/tokens/).
They are S3 credentials, not a general Cloudflare API token. The workflow uses
AWS Signature Version 4 with region `auto` and refuses endpoints outside
Cloudflare's R2 S3 domain.

[`sync-audacity-translations.yml`](.github/workflows/sync-audacity-translations.yml)
runs at 03:37 UTC every Monday and can also be dispatched manually. Its first
job has no private credentials: it selects the newest successful scheduled run
of Audacity's `translate_tx_pull_to_s3.yml` workflow, downloads the run-specific
nightly.link artifact, and checks both the official GitHub byte length and
SHA-256 digest before conversion. A fresh protected job independently re-queries
the upstream run and artifact metadata, binds the recorded converter revision to
its checkout, and deterministically reproduces the staged release before the R2
credentials are exposed. It restores a clean dependency-free checkout for the
later credentialed step, then uploads immutable packs and
preserved source, smoke-tests the public domain and CORS, and conditionally moves
`latest.json`. If the first pointer smoke test fails, the serialized publisher
rechecks its ETag and bytes, removes that first pointer, and verifies its absence;
an existing pointer is conditionally restored instead. Unchanged
normalized catalogs are skipped, and immutable release objects are never deleted.
Every release manifest embeds `GPL-3.0-only` provenance, immutable upstream and
Soundscaper project URLs, the commit-specific Audacity license URL, and the
notice describing Soundscaper's catalog modifications.

Published keys use this stable layout:

```text
runtime/translations/audacity/4/
  latest.json
  packs/{sha256}.json
  releases/{artifact-id}/manifest.json
  releases/{artifact-id}/audit.json
  releases/{artifact-id}/source/Audacity_locale_{build}.zip
  releases/{artifact-id}/source/LICENSE.txt
```

To promote an earlier immutable release, dispatch the same workflow with
`operation=rollback` and its numeric Audacity artifact ID as `release_id`. The
publisher verifies that release's manifest, source, license, audit, and every
locale pack against the current canonical Soundscaper keys and named placeholders
before conditionally updating the pointer. This permits rollback across reviewed
Audacity mapping revisions while failing closed if the application catalog is no
longer compatible. GitHub may delay
scheduled workflows, and automatically disables them in a public repository
after 60 days without repository activity; manual dispatch remains available.
See GitHub's [scheduled workflow documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

#### Credential-free translation dry run

The preparation and audit path needs no GitHub or Cloudflare credential. From a
checkout with Node.js 22, run:

```bash
work="$(mktemp -d)"
npm install --prefix scripts --no-save --package-lock=false --ignore-scripts --no-audit --no-fund saxes@6.0.0 xmlchars@2.2.0
node scripts/manage-audacity-translation-release.mjs discover \
  --output "$work/source" --github-env "$work/source.env" --github-output "$work/source.outputs"
node scripts/manage-audacity-translation-release.mjs snapshot --output "$work/previous"
set -a
. "$work/source.env"
set +a
previous=()
if [ -f "$work/previous/latest.json" ]; then previous=(--previous-root "$work/previous"); fi
exposed_locales="$(node --input-type=module -e "import { COMMITTED_LOCALE_TAGS } from './src/i18n/locales.js'; process.stdout.write(COMMITTED_LOCALE_TAGS.join(','));")"
node scripts/audacity-qt-translations.mjs prepare \
  --archive "$work/source/$AUDACITY_TRANSLATION_ARCHIVE_NAME" \
  --output "$work/staged" \
  --artifact-id "$AUDACITY_TRANSLATION_ARTIFACT_ID" \
  --source-run-id "$AUDACITY_TRANSLATION_RUN_ID" \
  --source-head-sha "$AUDACITY_TRANSLATION_HEAD_SHA" \
  --source-workflow-url "$AUDACITY_TRANSLATION_WORKFLOW_URL" \
  --source-sha256 "$AUDACITY_TRANSLATION_ARCHIVE_SHA256" \
  --source-byte-length "$AUDACITY_TRANSLATION_ARCHIVE_BYTE_LENGTH" \
  --source-license "$work/source/LICENSE.txt" \
  --tool-revision "$(git rev-parse HEAD)" \
  --converted-at "$AUDACITY_TRANSLATION_CONVERTED_AT" \
  --exposed-locales "$exposed_locales" \
  "${previous[@]}"
node scripts/manage-audacity-translation-release.mjs verify-stage --root "$work/staged"
node scripts/manage-audacity-translation-release.mjs verify-publication \
  --root "$work/staged" \
  --expected-tool-revision "$(git rev-parse HEAD)"
```

This writes nothing to R2. Inspect
`$work/staged/releases/<artifact-id>/manifest.json` for `pendingLocales` and
follow its `audit.path` descriptor to review per-locale coverage and skipped
mapping reasons. A locale may be exposed only when its manifest descriptor has
`eligible: true` and it appears in `pendingLocales`.

After review, add its canonical tag to `COMMITTED_LOCALE_TAGS` in
`src/i18n/locales.js`. The existing `[locale]` and `embed/[locale]` pages then
generate both static routes. Run `npm test`, `npm run build`, and
`npm run test:browser`; deploy the Pages change normally, then manually dispatch
the translation workflow with `operation=sync` so the next manifest records the
locale as exposed rather than pending.

## Embedding and storage migration

kw.media embeds the locale-specific `/embed/` route and delegates microphone,
clipboard, and fullscreen permissions to it. Because browser IndexedDB and OPFS
are isolated by origin, projects previously stored under `https://kw.media`
cannot be read automatically from `https://soundscaper.org`. Users should export
important projects before the hosting switch; a future explicit migration bridge
would need to run code on both origins and transfer user-approved data.

## Audacity interoperability

The AUP4 fixture codec and StaffPad WASM audits are retained from the original
kw.media implementation. The compiled-native Audacity round-trip release gate is
still tracked separately in `tests/fixtures/aup4-interop-gate.json` and fails
closed until its required evidence is supplied.
