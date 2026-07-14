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

The English and German applications are available at `/en/` and `/de/`.
Embedding views without the Soundscaper sidebar are available at `/embed/en/`
and `/embed/de/`.

The production FFmpeg runtime is loaded lazily from the versioned URL configured
by `PUBLIC_FFMPEG_CORE_BASE_URL`. Copy `.env.example` to `.env` to override it
locally.

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
repository therefore does not need a GitHub Actions deployment workflow,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, or an R2 bucket variable.

### 1. Publish the FFmpeg runtime to R2

Create an R2 Standard bucket named `soundscaper-assets`. Give it the custom
domain `assets.soundscaper.org` and public read access.

FFmpeg 0.12.10 is versioned and only needs to be uploaded once. The simplest
option is to authenticate Wrangler on a trusted local machine and run:

```sh
npx wrangler login
npm run deploy:runtime
```

The script uploads `ffmpeg-core.js` and `ffmpeg-core.wasm` under
`runtime/ffmpeg/0.12.10/` and applies `r2-cors.json`. No long-lived Cloudflare
credential needs to be stored in GitHub or in the Pages project.

Alternatively, upload those two files from
`node_modules/@ffmpeg/core/dist/esm/` in the R2 dashboard, preserving the same
object path, and add the CORS policy in R2 → `soundscaper-assets` → Settings.

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
- `PUBLIC_AUDIO_EDITOR_V2` = `true`
- `PUBLIC_FFMPEG_CORE_BASE_URL` =
  `https://assets.soundscaper.org/runtime/ffmpeg/0.12.10`
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
