# audio.com integration

The menu-opened audio.com panel searches listed audio, previews playback, and uploads supported audio files. The backend also provides
a route to list owned audio. The default provider uses the
[public v1 API](https://api.audio.com/v1/docs), checked on 2026-10-15.
An administrator can select a self-hosted Audiocity server, which additionally
advertises whole-file AUP3/AUP4 archive storage.

## Deployment

1. Register an OAuth client with audio.com for Soundscaper, including the exact
   redirect URI `https://soundscaper.org/api/audiocom/oauth/callback`. Registration
   is an administrator setup action, not something the browser performs.
   The provider's [authorization server metadata](https://api.audio.com/.well-known/oauth-authorization-server)
   advertises `https://api.audio.com/auth/authorize`, `/auth/token`, and
   `/auth/client`, PKCE S256, and public or confidential clients.
2. Configure Pages secrets `AUDIOCOM_CLIENT_ID` and `AUDIOCOM_OAUTH_MASTER_KEY`.
   The latter is `v1:` followed by the unpadded base64url encoding of 32 random
   bytes. Configure `AUDIOCOM_CLIENT_SECRET` only for a confidential registration
   using `client_secret_post`. The browser never receives these secrets.
3. Apply `migrations/freesound-oauth/0002_audiocom.sql` to the existing
   `FREESOUND_OAUTH_DB` binding. audio.com uses separate `audiocom_oauth_*` tables;
   it does not reuse Freesound grants or encryption keys. Both migrations can be
   applied with `npx wrangler d1 migrations apply FREESOUND_OAUTH_DB --remote`.
4. The optional `AUDIOCOM_OAUTH_REDIRECT_URI` must have the exact callback path
   above on `https://soundscaper.org` (no query, fragment, credentials or port).
   `AUDIOCOM_LOCAL_DEVELOPMENT=1` admits same-origin loopback HTTP for local tests.

No production application registration, schema migration, remote upload, or
deployment is performed automatically by the integration.

### PR previews

The Pages project is `soundscaper`, with hostname `soundscaper-5ki.pages.dev`.
Its preview environment uses the separate `soundscaper-audiocom-preview` D1
database configured in `wrangler.jsonc`; production keeps its existing binding.
Apply both migrations to preview with:

```sh
npx wrangler d1 migrations apply FREESOUND_OAUTH_DB --remote --env preview
```

Preview sign-in requires an explicitly configured, registered callback on this
Pages project. The current preview client is registered for
`https://feat-audio-com-integration.soundscaper-5ki.pages.dev/api/audiocom/oauth/callback`.
Its client ID, independent encryption key, and exact redirect URI are stored as
`AUDIOCOM_CLIENT_ID`, `AUDIOCOM_OAUTH_MASTER_KEY`, and
`AUDIOCOM_OAUTH_REDIRECT_URI` in the Pages **preview** secret store. Secrets and
registration responses must never be committed. An administrator can register a
public client at `/auth/client` with `token_endpoint_auth_method: "none"`,
`scope: "public"`, and the exact `redirect_uris`, then provision these secrets
with `npx wrangler pages secret bulk <protected-json-file> --project-name
soundscaper --env preview`.

Cloudflare deploys this repository's PR branches automatically. Both immutable
deployment URLs and branch aliases can initiate authorization; the provider
returns to the stable registered branch callback. The original editor polls its
own origin and receives a host-only session cookie there. Preview starts without
an explicit preview callback, callbacks on other Pages projects, and production
callbacks from previews are rejected. The callback deployment and originating
deployment must use the same preview database, key, and client registration.
Changing the configured branch callback requires registering the new exact URI
and redeploying. These preview credentials do not configure production OAuth.

## Validate against Audiocity locally

With dependencies installed in both checkouts and Audiocity at `../audiocity`
(or `SCAPE_AUDIOCITY_CHECKOUT`), run:

```sh
npm run build
npx playwright test --config playwright.audiocity.config.mjs
```

The browser harness starts its own Audiocity process, disposable data directory,
registered public OAuth client, local D1 database and Soundscaper Pages preview.
It uses editor port 4325 and Audiocity port 8091; `PLAYWRIGHT_PORT` and
`SCAPE_AUDIOCITY_PORT` override them. The test performs real OAuth authorization,
upload, search, range playback and project archive transfers against the local
HTTP server. It does not contact audio.com or use production credentials. To keep
a disposable validation server running for manual inspection, run
`node scripts/audiocity-validation-server.mjs`; open its printed editor URL and
sign in as `soundscaper-validation@example.test` with the test-only password
`soundscaper-audiocity-test-only-password`. Stop it after validation. Its generated
configuration and credentials stay in ignored temporary files and are removed on exit.

For an existing local Audiocity instance, configure these backend variables:

```text
AUDIOCOM_PROVIDER=audiocity
AUDIOCOM_API_ORIGIN=http://127.0.0.1:8088
AUDIOCOM_LOCAL_DEVELOPMENT=1
AUDIOCOM_CLIENT_ID=<registered-client-id>
AUDIOCOM_OAUTH_MASTER_KEY=v1:<base64url-32-random-bytes>
```

Register a public client once at that server's `/auth/client`, supplying
`client_name`, `token_endpoint_auth_method: "none"`, and `redirect_uris` containing
the exact editor callback URL, for example
`http://127.0.0.1:4325/api/audiocom/oauth/callback`. Use its returned `client_id`;
do not copy Audacity's compatibility client secret or audio.com's credentials.
Keep the master key in ignored `.dev.vars` or the deployment secret store, and
apply the same local D1 migrations as the default provider. The editor and
callback must use the same hostname and port. HTTP is admitted only for an
explicitly enabled loopback development origin. Hosted Audiocity origins require
HTTPS, with no URL path, credentials, query or fragment.

The provider is fixed by administrator environment configuration. Requests and
browser preferences cannot change it. `AUDIOCOM_API_ORIGIN` is rejected unless
`AUDIOCOM_PROVIDER=audiocity`; the default retains audio.com's exact API and CDN
pins. API, OAuth, capability hooks and media for Audiocity use the one configured
origin with their exact route and capability shapes. Changing providers or their
origin requires reconnecting; existing grants cannot be sent to another issuer.
Audiocity authorization requests `public projects`, rather than the administrative
`all` scope. Discovery at `/.well-known/audiocity` supplies archive formats and
transfer limits; unadvertised project transports stay disabled.

## Public contracts

All routes are under `/api/audiocom`. Responses use `{data: ...}` or
`{error:{code,message}}`, are not cached, and admit only Soundscaper web and
desktop origins. Mutations require a trusted origin and reject cross-site fetch
metadata. Web authentication uses a Secure, HttpOnly, SameSite=Strict host cookie.
Desktop authentication uses an opaque Soundscaper capability. Provider tokens and
PKCE verifiers are encrypted with AES-GCM and provider-specific authenticated data
in D1. Refresh-token rotation is serialized with a D1 lease.

- `POST /oauth/start`: JSON `{client:'web'|'desktop'}` returns an attempt,
  handoff capability, expiry, and authorization URL with the configured provider's scope and S256.
- `GET /oauth/callback`: exchanges the code server-side, verifies state, and
  returns a close-window page. No private account endpoint is called: the public
  API has no userinfo route, so sessions do not invent account identity.
- `POST /oauth/poll`: JSON `{attemptId,handoffToken}` returns 202 pending or
  200 connected. Only desktop receives an opaque app session capability.
- `GET /oauth/session` restores the connection; `DELETE` disconnects it and
  removes the last orphaned local grant.
- `GET /search?q=...&page=1` searches only audio; `GET /library?page=1` lists
  owned audio. Both return `{results,page,hasNext}` in pages of ten. An extra
  empty page may be necessary because the public API exposes no result total.
- `GET /preview?url=...` streams approved playback URLs. The proxy pins exact
  HTTPS CDN hosts and path prefixes (`s3.audio.com/audio/` and
  `s3.ustatik.com/audio.com.audio/`), blocks redirects, validates audio content,
  limits transfers to 128 MiB, forwards simple byte ranges, and never forwards
  provider credentials to storage.
- `POST /uploads` receives raw audio bytes with an audio MIME type,
  `X-Audiocom-Filename` (URI-encoded filename) and
  `X-Audiocom-Content-Length` (exact decimal bytes). Query parameters are `title`,
  `category`, `description`, `license`, `listed=0|1`, and `downloadable=0|1`.
  The server creates an upload policy, streams exactly the declared bytes to its
  pinned storage URL, and invokes the policy's POST success hook. In addition
  to the CDN paths above, upload policies admit the exact Wasabi destination
  `https://s3.eu-central-1.wasabisys.com/audio.com.audio/source/`; this source
  bucket is not admitted for playback or source download. Failure or
  cancellation invokes the DELETE failure hook with an independent timeout.
  The audio.com response is `{audio,processing:true}`; completion of transcoding
  is not claimed. Audiocity commits the preserved original synchronously and
  returns `processing:false`, refreshing ready playback metadata when available.
  A failed metadata refresh does not make the committed upload retryable. Signed
  upload URLs and hooks remain server-side.
- `GET /usage` reports the public provider configuration and upload limits. For
  audio.com these are a 100,000,000-byte application cap, the provider's 1 GiB cap,
  and `projectStorageSupported:false`. For Audiocity it discovers the provider cap
  and advertised `projectFormats`; the application cap is the smaller of that
  value and 100,000,000. Limits describe transfers, rather than account quota.
- `GET /projects?page=1` lists the connected owner's whole-file Audiocity projects
  and latest synchronized revision. `POST /projects?name=...&format=aup3|aup4`
  streams a complete project file with `application/octet-stream`, the filename
  and exact length headers above, and the same 100 MB application ceiling.
  The proxy checks the SQLite signature, completes the signed transfer, then
  synchronizes the archive revision. Only advertised archive formats are admitted.
- `GET /projects/download?id=...&snapshotId=...` retrieves an owner's completed
  whole-file archive revision through a pinned signed media URL, as an attachment
  with the same size ceiling. Native block snapshots are excluded. The server
  preserves archive bytes; it does not translate project versions or reconstruct
  an archive from native Audacity metadata and blocks.

## Public API boundaries

The provider supports WAV, MP3, FLAC, WavPack, AIFF, Ogg and M4A. Metadata includes
ARR and Creative Commons licenses, download permission, and listed or unlisted
visibility. **Unlisted audio remains accessible to anyone with its link.**

The regular API has 19 audio, collection, embed, and search endpoints. It does
**not expose Audacity project upload, listing, or retrieval**, and does not expose
original source downloads. The regular audio upload route rejects `.aup`, `.aup3`,
`.aup4`, and `.scape`; supported Audiocity archives use the separate project route.
The panel offers playback and the provider page; it does not treat a transcoded
preview as an original editable source or bypass download/license controls.
The audio.com provider does not call Audacity's private project-sync endpoints.
Audiocity archive support uses its explicit whole-file extension, separately from
its native block synchronization transport.

Provider-account OAuth, upload policy destinations, hook authorization, account
quotas, and processing completion still require an authenticated staging smoke
test with the deployed registered application; unit/browser fixtures do not
claim a successful live upload.
