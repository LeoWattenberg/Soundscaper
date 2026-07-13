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

The deployment workflow publishes `soundscaper.org` to the Cloudflare Pages
project `soundscaper` and uploads FFmpeg 0.12.10 to the R2 bucket configured by
the `SOUNDSCAPER_R2_BUCKET` repository variable.

Create these Cloudflare resources once:

1. Add `soundscaper.org` as a Cloudflare zone and point the registrar's
   nameservers to Cloudflare; an apex Pages domain requires the zone to be in
   the same account. Create a Pages project named `soundscaper`, then attach
   `soundscaper.org` as its production custom domain.
2. An R2 Standard bucket named `soundscaper-assets`.
3. The R2 custom domain `assets.soundscaper.org`, with public read access and a
   cache rule for versioned runtime assets. The deployment workflow applies
   `r2-cors.json` after uploading the runtime.
4. A Cloudflare API token scoped to this account with **Cloudflare Pages: Edit**
   and **Workers R2 Storage: Edit**.

Configure the GitHub repository at **Settings → Secrets and variables → Actions**:

- Secret `CLOUDFLARE_API_TOKEN`: the scoped Cloudflare API token.
- Secret `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID.
- Secret `PACKAGES_TOKEN`: a GitHub PAT with `read:packages`, used only to
  install the restricted `@dilsonspickles/components` package.
- Variable `SOUNDSCAPER_R2_BUCKET`: `soundscaper-assets`.

No R2 access-key pair is required because Wrangler uses the scoped Cloudflare API
token. The workflow pins the public runtime URL at build time and deploys only
after unit checks pass.

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
