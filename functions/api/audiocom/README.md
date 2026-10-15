# audio.com integration

The menu-opened audio.com panel searches listed audio, previews playback, and uploads supported audio files. The backend also provides
a route to list owned audio. The integration uses only the
[public v1 API](https://api.audio.com/v1/docs), checked on 2026-10-15.

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
   `AUDIOCOM_LOCAL_DEVELOPMENT=1` admits loopback HTTP for local tests. Sign-in
   starts are disabled on Pages preview hosts.

No application registration, schema migration, remote upload, or deployment is
performed automatically by the implementation.

## Public contracts

All routes are under `/api/audiocom`. Responses use `{data: ...}` or
`{error:{code,message}}`, are not cached, and admit only Soundscaper web and
desktop origins. Mutations require a trusted origin and reject cross-site fetch
metadata. Web authentication uses a Secure, HttpOnly, SameSite=Strict host cookie.
Desktop authentication uses an opaque Soundscaper capability. Provider tokens and
PKCE verifiers are encrypted with AES-GCM and provider-specific authenticated data
in D1. Refresh-token rotation is serialized with a D1 lease.

- `POST /oauth/start`: JSON `{client:'web'|'desktop'}` returns an attempt,
  handoff capability, expiry, and authorization URL with `public` scope and S256.
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
  pinned storage URL, and invokes the policy's POST success hook. Failure or
  cancellation invokes the DELETE failure hook with an independent timeout.
  The response is `{audio,processing:true}`; completion of transcoding is not
  claimed. Signed upload URLs and hooks remain server-side.
- `GET /usage` reports a 100,000,000-byte application upload cap, audio.com's
  1 GiB provider cap, and `projectStorageSupported:false`. The local cap matches
  the existing request proxy limit; it does not represent account quota.

## Public API boundaries

The provider supports WAV, MP3, FLAC, WavPack, AIFF, Ogg and M4A. Metadata includes
ARR and Creative Commons licenses, download permission, and listed or unlisted
visibility. **Unlisted audio remains accessible to anyone with its link.**

The regular API has 19 audio, collection, embed, and search endpoints. It does
**not expose Audacity project upload, listing, or retrieval**, and does not expose
original source downloads. `.aup`, `.aup3`, `.aup4`, and `.scape` uploads are rejected.
The panel offers playback and the provider page; it does not treat a transcoded
preview as an original editable source or bypass download/license controls.
Audacity's private project-sync endpoints are deliberately outside this feature.

Provider-account OAuth, upload policy destinations, hook authorization, account
quotas, and processing completion still require an authenticated staging smoke
test with the deployed registered application; unit/browser fixtures do not
claim a successful live upload.
