# Soundscaper

Soundscaper is a local-first multitrack audio and video editor for the browser.
Projects, recordings, and imported media remain in the browser's
origin-private storage.
The application is maintained by [kw.media](https://kw.media) and distributed
under AGPL-3.0-only, with third-party components documented in
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).

## Memory and local storage

Persisted PCM is the canonical copy of an audio source. New source audio is stored as
planar float32 PCM in chunks of up to 65,536 frames, using the browser's
origin-private file system (OPFS) when available and IndexedDB otherwise.
Decoded `AudioBuffer`s are only a hot LRU cache: its default PCM-payload budget
is 256 MiB, and an individual source larger than 32 MiB is not admitted. Those
larger streamable sources remain disk-canonical and are read through bounded
chunk providers. The thresholds refer to decoded PCM, not compressed file size,
and do not include browser object or Web Audio overhead.

Several high-volume paths avoid retaining a whole operation in RAM. Large
uncompressed mono/stereo RIFF/WAVE imports are decoded from bounded `Blob`
slices directly into storage; recording packets are coalesced into canonical
storage chunks; and IndexedDB source iteration uses small cursor pages. AUP4
snapshot writes stage and acknowledge one source at a time. Oversized Mix and
Render jobs use a bounded real-time pipeline that writes stereo output directly
into canonical storage chunks. The lazy FFmpeg worker is terminated after 30
seconds without queued work and reloaded on demand.

This is a bounded-working-set design, not a zero-RAM mode. Web Audio still needs
working buffers, and compressed imports, some destructive or stateful effects,
and final download assembly can temporarily require substantial memory. Browser
quota and eviction policy also remain authoritative: Soundscaper requests
persistent storage, but that best-effort request can be denied, private or
restricted contexts may fall back to process memory, and clearing site data
removes local projects. Keep rendered audio backups of important work rather
than treating origin-private storage as the only copy. AUP4 is an Audacity
interchange export: it preserves compatible editable tracks and reports
conversions, missing plug-ins, and omitted Soundscaper-only mixing state, but it
is not a full-fidelity Soundscaper backup. AUP4 is audio-only, so video media is
explicitly reported and omitted; use MP4 or WebM export for a rendered video.

Imported MP4, M4V, and WebM originals are stored immutably in OPFS when
available, with an IndexedDB Blob fallback. Posters and five-second filmstrip
thumbnails are disposable derivatives. Video and extracted audio enter the
Project Bin as one media item and are placed on adjacent linked lanes by
default, so move, split, trim, and stretch edits stay synchronized unless the
pair is explicitly unlinked.

## Local development

```sh
npm ci
npm run dev
```

Use Node.js 26.5.0 and npm 12.0.1. A fresh install needs no registry
credentials; the Audacity design system is vendored in-tree at
`vendor/audacity-design-system/`. Contributor workflow
and architecture boundaries are documented in
[`CONTRIBUTING.md`](CONTRIBUTING.md) and
[`docs/architecture.md`](docs/architecture.md).

`npm run preview` serves the production build on port 4321. Playwright keeps
its isolated preview server on port 4322 (or `PLAYWRIGHT_PORT` when overridden).

Application source is organized by ownership: `src/soundscaper/` and
`src/framescaper/` contain the product profiles and entry configuration, while
`src/common/` contains the shared React shell, editor domain, browser workers,
WASM integrations, and localization runtime. `src/main.jsx` is the Vite
bootstrap that selects the product and locale from the web route or Electron
environment.

English and German are always available at `/en/` and `/de/`. Additional
Audacity-backed static locale routes are generated from the reviewed allowlist
in `src/common/i18n/locales.js`. Embedding views without the Soundscaper sidebar use
the same tags under `/embed/<locale>/`.

The production browser does not load FFmpeg. Compressed audio exports lazily use
the reviewed, format-specific codec workers; AAC and keyed video exports use the
browser's WebCodecs implementation with the Mediabunny container muxer.
Audacity-derived locale packs are resolved from the versioned root configured by
`PUBLIC_TRANSLATIONS_BASE_URL`. Copy `.env.example` to `.env` to override that
locale-pack URL locally.

## Checks

```sh
npm run check
npm run test:browser
```

The canonical non-browser command includes lint, strict type checks,
architecture/size guardrails, reproducibility and notice audits, unit coverage,
and a production build. `npm run audit:ebu-r128` remains separate because it
requires the external conformance test set.

CI splits that command across jobs so it is not confined to one runner's four
cores. `npm run check:static` is everything except the Node suite; the suite runs
as one job per product shard (`npm test -- --shard=common`, `--shard=framescaper`,
`--shard=soundscaper`), each writing raw V8 coverage that
`npm run coverage:compact` reduces to a single profile. The `coverage` job merges
those profiles and applies the `.c8rc.json` thresholds to the union, so the gate
still measures the whole suite.

`npm run build` fails when any generated Pages asset exceeds Cloudflare's 25 MiB
limit or any emitted JavaScript chunk exceeds 500,000 bytes. It also audits the
browser bundle for application-supplied FFmpeg imports, assets, and fetch seams.

## Desktop preview

Soundscaper 0.2 can now be built as an unsigned desktop preview:

| Platform | Architectures | Packages |
| --- | --- | --- |
| Windows | x64, ARM64 | Per-machine assisted NSIS installer and no-install ZIP |
| macOS | Apple silicon | DMG |
| Linux | x64, ARM64 | AppImage and Debian package |

The Windows installer requires administrator approval because Windows only
registers the `.aup4` association for this build's per-machine installation.
The ZIP does not install or register file types. The macOS preview is ad-hoc
signed rather than notarized, and the Windows preview has no publisher
certificate, so Gatekeeper or SmartScreen may show an unknown-developer
warning. A future public release will include `SHA256SUMS` for every artifact.

The desktop editor and all released languages work offline. Its package contains
the reviewed dedicated audio codec payloads, Electron's authenticated framework
codec library, and a digest-verified snapshot of the current Audacity-derived
translations. User-configured external FFmpeg remains a desktop-only provider.
The app's only runtime network request is a throttled GitHub check for a newer
release notification.
It never downloads or installs an update automatically and sends no telemetry.

Desktop projects remain in the app's autosaved local library. Opening or
double-clicking an `.aup4` imports a new independent library copy;
later edits never change the opened file. **Save** flushes that internal copy,
while **Save As** exports a new Audacity interchange `.aup4`. Move compatible
tracks between the browser and desktop app by exporting AUP4 and importing the
independent copy. The compatibility report identifies converted audio,
unavailable effects, and Soundscaper-only state that was omitted. Browser
preferences, undo history, mixer routing, and origin-private storage are not
migrated. Uninstalling an installed build preserves the local library, but
users should still keep rendered backups before removing application data
manually.

To prepare and package a local desktop build:

```sh
npm run desktop:prepare
npm run desktop:dir
npm run desktop:smoke
npm run desktop:dist
```

Preparation writes only to the ignored `.desktop-build/` directory and leaves
the web `dist/` untouched. Packaging writes ignored artifacts to
`release/desktop/`. The build machine needs HTTPS access to the public
translation release. For an intentionally offline/reproducible build, set
`SOUNDSCAPER_DESKTOP_TRANSLATIONS_SOURCE` to a previously staged directory that
contains `latest.json`, every referenced pack, the release manifest and audit,
and the referenced source license; every descriptor is rechecked before use.

Pushing a beta tag that exactly matches `package.json` (for example,
`v0.2.0-beta.1`) runs unit, reproducibility, browser, and native packaging
checks. The same build runs nightly from the default branch at 02:17 UTC and
can be started manually from the **Desktop preview and nightly** GitHub Actions
workflow. Soundscaper and Framescaper are prepared, packaged, and smoke-tested
in separate jobs for every supported OS/architecture. Each packaging job uploads
its verified installers to the Actions run for 14 days; these are CI artifacts,
not a public release channel. Public
desktop distribution still requires the release provenance recorded in
`desktop/ffmpeg-corresponding-source.json`, plus a future stable tag that passes
`npm run audit:aup4-interop:release`, uses Windows signing plus macOS Developer
ID signing/notarization; the compiled-native AUP4 gate is intentionally still
pending for this preview.

The packaged desktop entry point requests Electron's regular hardware GPU
selection before the application becomes ready. The operating system and
Chromium can still reject or block-list an unavailable driver; packaging does
not relabel a software fallback as hardware evidence.

### Nightly test runner artifacts

For a self-contained browser test run, start the workflow manually and choose
`nightly-with-tests`. Its five platform jobs upload artifacts named
`nightly-with-tests-win-<architecture>`,
`nightly-with-tests-mac-<architecture>`, or
`nightly-with-tests-linux-<architecture>` for Windows x64/ARM64, macOS Apple
silicon, and Linux x64/ARM64. This flavor contains the built site, the
Playwright suite and runtime, the real packaged Soundscaper and Framescaper
executables, and the platform's pinned Chromium, Firefox, and WebKit engines.
It does not need npm or a checkout on the test machine.

Unpack the Actions artifact to a writable directory. Run the portable `.exe` on
Windows; unpack and run the `.app` from the inner macOS ZIP; or mark the Linux
AppImage executable (`chmod +x`) and run it. A completion dialog reports the
outcome and exact output path. Every invocation creates, in the same directory
as the executable (or beside the macOS `.app`), a unique
`soundscaper-nightly-tests-playwright-<UTC timestamp>-<suffix>/` directory with:

- `run.json` — launcher status, exit code, source revision, platform, and paths;
- `console.log` — the Playwright console stream.

After the functional suite, the binary runs the registered M1 720p preview,
M4 production-parity, and M4B2 keyframe collectors in a separate Chromium
process with one worker and zero retries. Its `metrics/`
directory contains `metrics/summary.json` with evaluated metric gates,
`metrics/raw.json` with the parsed diagnostics, `metrics/results.json` and
`metrics/junit.xml` for machine-readable test results, `metrics/console.log`,
`metrics/playwright-report/index.html`, and `metrics/test-results/`.

The runner then launches the bundled hardened Soundscaper and Framescaper
executables and attaches Playwright over an ephemeral loopback-only Chromium
debugging endpoint. It repeats M1 in Framescaper, M4 in Soundscaper, and M4B2
in Framescaper, and checks that both packaged apps boot with the reviewed
isolated bridge. The separate `packaged-runtime/`
directory contains `packaged-runtime/summary.json`,
`packaged-runtime/raw.json`, `packaged-runtime/results.json`,
`packaged-runtime/junit.xml`, `packaged-runtime/console.log`,
`packaged-runtime/playwright-report/index.html`, and
`packaged-runtime/test-results/`. It also writes
`packaged-runtime/qualification.json`: fail-closed formal verification entries
that independently admit the M1 preview and Soundscaper M4 results against the
owner-designated Windows x64 RTX 3090 host fingerprint, each registered
workload and sampling shape, the exact budget digest, one attempt, zero retries,
one worker, hardware rendering, and every registered threshold. A failure in
one workload or in unrelated Framescaper coverage does not invalidate another
complete qualification. This makes packaged-runtime evidence machine-readable
instead of relying only on CI log lines.

Other hosts and workloads remain `pending-external`. An identity, renderer,
source-revision, budget-digest, retry, worker, or metric mismatch is recorded as
a rejected qualification. A metric-threshold or collector failure still makes
the overall run fail.

The browser phase carries full Chromium rather than Chromium Headless Shell and
launches it headlessly with `--enable-gpu` for normal hardware renderer
selection. The packaged-runtime phase uses the
Chromium embedded in each real Electron application. Every diagnostic records
the observed renderer; a SwiftShader, llvmpipe, software, or unknown result
remains non-qualifying.

Those two launcher files are attempted even for infrastructure failures. Once
Playwright starts, the directory also contains `results.json` and `junit.xml`
for machine-readable results, `playwright-report/index.html` for the browsable
HTML report, and `test-results/` for traces, screenshots, and failure
attachments.

Exit code 0 means the suite passed, 1 means Playwright completed with test
failures, and 2 means the launcher, server, browser, or configuration failed.
The browser binaries are platform-specific and large, and Linux still requires
the system libraries supplied by a Playwright-supported distribution. The
nightly-with-tests executable intentionally enables Electron's Node mode for
Playwright workers and ships test JavaScript outside ASAR, so it is a diagnostic
artifact and not a public release or a substitute for the hardened desktop
package.

To build the current platform's equivalent artifact locally after installing
the hermetic engines, use:

```sh
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install --no-shell chromium firefox webkit
npm run desktop:nightly-tests:dist
```

## Cloudflare production setup

Cloudflare Pages can build and deploy Soundscaper directly from GitHub. The
Pages deployment therefore does not need a GitHub Actions deployment workflow,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, or an R2 bucket variable. The
independent translation publisher described below has narrowly scoped S3
credentials for its dedicated bucket; those credentials are never available to
the Pages build.

### Two projects, one repository

Two products are built from this one repository, and each is deployed from a
project of its own: `soundscaper` serves `soundscaper.org` and `framescaper`
serves `framescaper.org`. They cannot share one deployment. A service worker's
script URL bounds the maximum scope it may claim, so Framescaper at the root of
its own origin needs its worker at `/service-worker.js` — the path Soundscaper's
worker already occupies — and no Cloudflare mechanism serves two different files
at one path from one deployment. Splitting the deployments also keeps
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: credentialless` on the same plain `/*` rule in
[`public/_headers`](public/_headers) for both products, which is what gives the
editor `SharedArrayBuffer`.

Which product a build emits is decided by the `SCAPE_PRODUCT` environment
variable, and it must be set explicitly on both projects. An unset or empty
value still means `soundscaper`, so that an existing `npm run build` keeps
meaning what it meant, but neither deployment should depend on that default: an
unset `SCAPE_PRODUCT` on the Framescaper project would publish the Soundscaper
bundle to `framescaper.org`. Any other value — including a case variant such as
`Framescaper` — is refused before Vite does any work.

| | `soundscaper` | `framescaper` |
| --- | --- | --- |
| Build command | `npm run build:pages` | `SCAPE_PRODUCT=framescaper npm run build:pages` |
| Custom domain | `soundscaper.org` | `framescaper.org` |
| Editor routes | `/`, `/:locale/`, `/embed/:locale/` | `/`, `/:locale/`, `/embed/:locale/` |
| Also serves | Framescaper under `/framescaper/…` for the cutover | — |
| Service worker | `/service-worker.js` scope `/` (plus `/framescaper/service-worker.js` scope `/framescaper/`) | `/service-worker.js` scope `/` |
| Web app manifest | `manifest-soundscaper.webmanifest`, scope `/` | `manifest-framescaper.webmanifest`, scope `/`, `start_url` `/en/` |
| Canonical base | `SOUNDSCAPER_SITE` | `FRAMESCAPER_SITE` |

Both products build into `./dist`, so builds and deploys are sequential, never
concurrent. During the cutover the Soundscaper deployment keeps serving
Framescaper under `/framescaper/` exactly as it does today; the deploy that
finally drops those documents is the same deploy that must add their permanent
redirects to `framescaper.org`, and `scripts/preflight-pages-deploy.mjs` audits
them as redirects from that point on rather than expecting a document.

### 1. Retained legacy FFmpeg publication tooling

The production browser and Pages deployment do not publish, import, fetch, or
preflight this runtime. The following blocked procedure remains only to reproduce
and audit the historical publication records; it is not a deployment prerequisite.

Create an R2 Standard bucket named `soundscaper-assets`. Give it the custom
domain `assets.soundscaper.org` and public read access.

Do not upload the runtime files to the mutable
`runtime/ffmpeg/0.12.10/` prefix. The reviewed publisher creates an immutable
`releases/<full-manifest-sha256>/` directory containing the exact JavaScript,
WebAssembly, manifest, notice, and corresponding-source metadata, reads every
object back, purges predictable cached misses, smoke-tests the public domain,
and then conditionally promotes `latest.json`.

Create a bucket-scoped R2 API token with **Object Read & Write** for
`soundscaper-assets`; its S3 access-key pair is distinct from a Cloudflare API
token. Create a second Cloudflare API token limited to the owning account and
zone with **Workers R2 Storage: Edit**, **Cache Rules: Edit**, and
**Cache Purge: Purge**. Record the account ID and the 32-character zone ID. Put
the credentials in a temporary, gitignored `.env` file:

```dotenv
R2_FFMPEG_ENDPOINT=https://<account-id>.eu.r2.cloudflarestorage.com
R2_FFMPEG_ACCESS_KEY_ID=<r2-s3-access-key-id>
R2_FFMPEG_SECRET_ACCESS_KEY=<r2-s3-secret-access-key>
R2_FFMPEG_BUCKET=soundscaper-assets
CLOUDFLARE_ACCOUNT_ID=<account-id>
CLOUDFLARE_ZONE_ID=<zone-id>
CLOUDFLARE_API_TOKEN=<r2-cors-cache-rules-and-purge-token>
```

Use the jurisdiction-specific endpoint required by the manifest (`eu` here).
Node and npm do not load `.env` automatically. After the three checked-in
publication blockers have received their existing approvals, run the two gated
steps explicitly:

```sh
node --env-file=.env scripts/configure-ffmpeg-runtime-cache.mjs
node --env-file=.env scripts/publish-runtime-assets.mjs
```

The first command reconciles the three stable-ref Cache Rules while retaining
unrelated rules. The second applies the checked-in `r2-cors.json`, conditionally
publishes and reads back immutable objects with the S3 credentials, and uses the
zone token for exact purges. Both commands currently refuse before any remote
operation because runtime publication remains policy-blocked. After a successful
authorized run, delete `.env`; none of these credentials belongs in GitHub or
the Pages project. `npm run deploy:runtime` is equivalent only when these
variables have already been exported into its process environment.

### 2. Connect Cloudflare Pages to GitHub

1. Add `soundscaper.org` as a Cloudflare zone and point the registrar's
   nameservers to Cloudflare. An apex Pages domain must be in the same
   Cloudflare account.
2. In Workers & Pages, choose **Create application → Pages → Connect to Git**.
3. Authorize the Cloudflare GitHub app for `LeoWattenberg/Soundscaper` and select
   that repository.
4. Use production branch `main`, the Vite framework preset, gated build command
	`npm run build:pages`, and output directory `dist`. Leave the root directory
	empty. This command verifies that the live Pages hostname preserves
	the checked-in no-cache/no-store headers for stable documents, product artwork,
	manifests, offline audit data, and both workers while keeping hashed assets
	immutable. The check runs before Pages can publish either a production or preview
	deployment; do not replace it with the ungated `npm run build`.
5. Attach `soundscaper.org` under the Pages project's custom domains.
6. Repeat steps 1–5 for a second Pages project named `framescaper`, connected to
   the same repository and the same production branch `main`, with build command
   `SCAPE_PRODUCT=framescaper npm run build:pages`, output directory `dist`, the
   zone `framescaper.org`, and that apex attached as its custom domain. The
   checked-in [`wrangler.framescaper.jsonc`](wrangler.framescaper.jsonc)
   describes the equivalent static-assets deployment for a `wrangler deploy` run
   from a workstation. Its preflight audits `framescaper.org`'s own routes;
   nothing in it reaches soundscaper.org's.

Cloudflare will build and deploy every push to `main` and create preview
deployments for other selected branches.

### 3. Configure Pages build variables

In each Pages project, open **Settings → Variables and Secrets**. Add these to
both Production and Preview unless noted otherwise.

Both projects:

- `PUBLIC_TRANSLATIONS_BASE_URL` =
  `https://translations.soundscaper.org/runtime/translations/audacity/4`
- `NODE_VERSION` = `26.5.0`

The `soundscaper` project:

- `SCAPE_PRODUCT` = `soundscaper`
- `SOUNDSCAPER_SITE` = `https://soundscaper.org`

The `framescaper` project:

- `SCAPE_PRODUCT` = `framescaper`
- `FRAMESCAPER_SITE` = `https://framescaper.org`

Set `SCAPE_PRODUCT` on both even though the Soundscaper value is also the
default: a project that inherits the default is a project that silently changes
product the day the default changes. Each build reads only its own site
variable, which supplies the canonical and hreflang base and the origin the
deploy preflight audits; a value carrying a path, query or fragment is refused
rather than silently truncated. [`.env.example`](.env.example) lists the same
variables for local builds.

No registry credentials are required: the Audacity Design System (formerly the
authenticated GitHub Packages package `@dilsonspickles/components`) is vendored
in-tree at `vendor/audacity-design-system/` and compiled by the application's
Vite build. The org secret `PACKAGES_TOKEN` that backed the removed
`NODE_AUTH_TOKEN` plumbing should be kept alive for one release cycle as the
rollback path (reverting the vendoring requires re-fetching
`@dilsonspickles/components@0.9.0` from GitHub Packages), then deleted.

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
Pages preview for either project uses an origin that the file does not already
list, add that exact origin to the CORS policy before testing remote packs from
the preview. After changing CORS on a bucket that is already serving the custom
domain, purge cached objects for that hostname so cached responses acquire the
new headers.

`https://framescaper.org` is listed in that file for the second deployment, and
the file is applied to the bucket by hand rather than by any automated step. Its
current contents are therefore not live until someone re-applies it: re-apply
`r2-translations-cors.json` during bucket administration and then purge cached
objects for `translations.soundscaper.org`, or Framescaper's own origin will
keep receiving CORS responses cached from before it was allowed, and locale
packs will fail to load there while working on soundscaper.org.
`r2-cors.json` for the FFmpeg runtime bucket already lists
`https://framescaper.org`, and its publisher applies it.

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
checkout with Node.js 26.5.0, run:

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
exposed_locales="$(node --input-type=module -e "import { COMMITTED_LOCALE_TAGS } from './src/common/i18n/locales.js'; process.stdout.write(COMMITTED_LOCALE_TAGS.join(','));")"
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
`src/common/i18n/locales.js`. The generated localized pages and embedded Vite routes then
generate both static routes. Run `npm test`, `npm run build`, and
`npm run test:browser`; deploy the Pages change normally, then manually dispatch
the translation workflow with `operation=sync` so the next manifest records the
locale as exposed rather than pending.

## Embedding and storage migration

kw.media embeds the locale-specific `/embed/` route and delegates microphone,
display capture, clipboard, and fullscreen permissions to it. The embedding
iframe must include both `microphone` and `display-capture` in its `allow`
attribute. Because browser IndexedDB and OPFS
are isolated by origin, projects previously stored under `https://kw.media`
cannot be read automatically from `https://soundscaper.org`. Users should export
important projects before the hosting switch; a future explicit migration bridge
would need to run code on both origins and transfer user-approved data.

The same isolation applies between the two product origins. While Framescaper is
served from `soundscaper.org/framescaper/`, the application menu's product switch
hands the destination a `?project=` id that resolves in the shared origin's
storage. Once Framescaper is served from `framescaper.org`, that switch becomes a
cross-origin navigation and the id no longer names anything the destination can
read, so the handoff needs an explicit transfer between the two origins rather
than a shared-storage lookup.

## Audacity interoperability

The AUP4 fixture codec and StaffPad WASM audits are retained from the original
kw.media implementation. The compiled-native Audacity round-trip release gate is
still tracked separately in `tests/fixtures/aup4-interop-gate.json` and fails
closed until its required evidence is supplied.

The release audit accepts an optional executable built from the pinned Audacity
commit:

```sh
npm run audit:aup4-interop:release -- --native-runner /path/to/aup4-native-runner
# or
AUDACITY_AUP4_NATIVE_RUNNER=/path/to/aup4-native-runner npm run audit:aup4-interop:release
```

Runner protocol version 1 requires a direct compiled ELF, PE, Mach-O, or
universal Mach-O executable, not a script or wrapper. Invoking
`<runner> --revision` must print exactly
`908ad0a526e5bfdab68de780e893cebe172d27eb` followed only by optional trailing
whitespace. Invoking
`<runner> --roundtrip <input.aup4> <output.aup4>` must open the read-only input
through that revision's Audacity loader, save to the distinct output path
through its native writer, close and checkpoint the database, and exit zero.
The audit hashes the runner and both directions' files, independently validates
the native outputs with Soundscaper's codec, and only passes the release gate
from evidence produced during that invocation. Without a runner, the normal
codec audit still passes and the release audit exits with status 2.

### Nyquist WebAssembly

Soundscaper includes Audacity 3.7.7's Nyx/Nyquist interpreter as a pinned,
reproducible WebAssembly runtime. It runs in a dedicated worker with PCM input
and bounded output memory. The browser adapter does not expose host file I/O,
shell commands, MIDI, audio devices, or AUD-DO.

The bundle includes the 25 compatible Audacity 3.7.7 Nyquist plug-ins. All 18
processor effects are grouped under **Effect → Legacy**; the three generators
and four analyzers remain under their respective Nyquist menu groups. The file
oriented plug-in installer and sample-data import/export scripts are excluded.
Tools → Nyquist prompt accepts Lisp and SAL and stores its source locally.

Use the pinned toolchain and source checkout recorded in
`src/common/editor/nyquist/source-manifest.json`:

```sh
npm run build:nyquist -- --audacity-source /path/to/audacity-3.7.7
npm run audit:nyquist
```
