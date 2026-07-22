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
npm install
npm run dev
```

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

## Desktop preview

Soundscaper 0.2 can now be built as an unsigned desktop preview:

| Platform | Architectures | Packages |
| --- | --- | --- |
| Windows | x64, ARM64 | Per-machine assisted NSIS installer and no-install ZIP |
| macOS | Intel, Apple silicon | DMG |
| Linux | x64, ARM64 | AppImage and Debian package |

The Windows installer requires administrator approval because Windows only
registers the `.aup4` association for this build's per-machine installation.
The ZIP does not install or register file types. The macOS preview is ad-hoc
signed rather than notarized, and the Windows preview has no publisher
certificate, so Gatekeeper or SmartScreen may show an unknown-developer
warning. A future public release will include `SHA256SUMS` for every artifact.

The desktop editor and all released languages work offline. Its package contains
the pinned FFmpeg 0.12.10 JavaScript/WebAssembly runtime plus a digest-verified
snapshot of the current Audacity-derived translations; those larger runtime
files remain outside the Cloudflare Pages `dist/` build. The app's only runtime
network request is a throttled GitHub check for a newer release notification.
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
4. Use production branch `main`, the Vite framework preset, build command
   `npm run build`, and output directory `dist`. Leave the root directory empty.
5. Attach `soundscaper.org` under the Pages project's custom domains.

Cloudflare will build and deploy every push to `main` and create preview
deployments for other selected branches.

### 3. Configure Pages build variables

In the Pages project, open **Settings → Variables and Secrets**. Add these to
both Production and Preview unless noted otherwise:

- `SOUNDSCAPER_SITE` = `https://soundscaper.org`
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
