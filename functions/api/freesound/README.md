# Freesound Pages Functions

These routes keep Freesound application and user credentials out of the client.
Public search, details, waveform, and HQ OGG preview routes use Soundscaper's
server-side API key. An optional user OAuth grant adds original-file imports,
uploads, metadata submission, pending-upload recovery, and account disconnect.
Obtain an APIv2 application from Freesound's
[API application page](https://freesound.org/apiv2/apply).

## Secrets and environments

The public read routes require the encrypted `FREESOUND_API_KEY` secret. The
authenticated routes additionally require:

- `FREESOUND_CLIENT_ID`: the Freesound OAuth application client ID;
- `FREESOUND_CLIENT_SECRET`: its encrypted client secret;
- `FREESOUND_OAUTH_MASTER_KEY`: an independent 32-byte random key encoded as
  `v1:` followed by exactly 43 unpadded base64url characters; and
- the `FREESOUND_OAUTH_DB` D1 binding. Its migrations live in
  `migrations/freesound-oauth/`.

Register `https://soundscaper.org/api/freesound/oauth/callback` as the exact
production redirect URI in Freesound. `FREESOUND_OAUTH_REDIRECT_URI` may pin
that same URI explicitly. The only other admitted form is the exact loopback
callback while `FREESOUND_LOCAL_DEVELOPMENT=1` is enabled.

Create the production D1 database, add its generated `database_id` to the
`FREESOUND_OAUTH_DB` entry in `wrangler.jsonc`, and bind it to the Pages project.
The checked-in configuration leaves that account-specific ID unset. Apply its
migration, then add each credential under
**Workers & Pages → soundscaper → Settings → Variables and Secrets** as an
encrypted secret. Typical Wrangler commands are:

```sh
npx wrangler d1 migrations apply soundscaper-freesound-oauth --remote
npx wrangler pages secret put FREESOUND_API_KEY --project-name soundscaper
npx wrangler pages secret put FREESOUND_CLIENT_ID --project-name soundscaper
npx wrangler pages secret put FREESOUND_CLIENT_SECRET --project-name soundscaper
npx wrangler pages secret put FREESOUND_OAUTH_MASTER_KEY --project-name soundscaper
npx wrangler pages secret list --project-name soundscaper
```

Pages does not accept the Workers-only `secrets.required` configuration field.
Production requests fail closed with `503` when the production secret is absent.

Preview hostnames may serve only the public read routes when their environment
has `FREESOUND_API_KEY`. OAuth start deliberately fails closed with `503` on
previews: the fixed production callback cannot read an authorization attempt
from an isolated preview D1 database. OAuth authentication and every
authenticated endpoint—including original-file access, uploads, metadata
submission, pending-upload recovery, and account usage—are therefore
unavailable in previews. Preview URLs are public by default; if public read
routes are enabled there, protect them with equivalent abuse controls and
Cloudflare Access where appropriate. Configure `FREESOUND_API_KEY` in the
dashboard's **Preview** environment; the Pages secret CLI does not expose an
environment selector.

For local development, place the four credentials in an ignored `.dev.vars`
file, apply the migration to the local D1 database, then explicitly enable
loopback request and callback URLs when starting Pages:

```sh
npx wrangler d1 migrations apply soundscaper-freesound-oauth --local
npx wrangler pages dev dist --binding FREESOUND_LOCAL_DEVELOPMENT=1
```

The relevant handlers return `503` when a required local binding or secret is
absent. Keep secrets only in `.dev.vars`; the non-secret loopback flag remains a
CLI binding. Never put credentials in `wrangler.jsonc`, a plain Pages variable,
a Vite variable, or a client bundle.

## OAuth and data lifecycle

OAuth starts and polling handoffs are unguessable capabilities with a ten-minute
logical expiry. Access and refresh tokens are encrypted in D1 with AES-256-GCM
and field-specific authenticated data. Browser sessions use a Secure,
HttpOnly, SameSite=Strict cookie. Packaged Soundscaper receives an opaque session
capability in Electron main, stores it with `safeStorage` only when a secure OS
backend is available, and never exposes it to the renderer. Sessions have a
rolling 30-day expiry. Disconnect deletes that session; deleting the final
session also deletes the shared user grant and encrypted tokens once no live,
unclaimed OAuth handoff still needs it.

Expired attempts and sessions are rejected on lookup. A later OAuth start
physically prunes expired attempts, expired sessions, and orphan grants. D1 does
not store uploaded audio, submitted metadata, or pending-upload identifiers.
Freesound owns the upload, processing, moderation, publication, and deletion
lifecycle once bytes or metadata have been submitted.

## Authenticated media routes

`GET /api/freesound/sounds/:id/original` streams the authenticated original
through the fixed Freesound API origin with a 128 MiB declared and observed byte
ceiling. A larger original returns an explicit error; the client may fetch the
HQ OGG preview only after the user confirms that fallback.

`POST /api/freesound/uploads` accepts one raw WAV, AIFF, FLAC, OGG, or MP3 body
with a canonical percent-encoded filename header. Both the declared and observed
body must be from 1 through exactly 100,000,000 bytes. The worker constructs the
only upstream multipart field and never accepts caller-controlled multipart
headers. Metadata submission has closed title, description, tag, Broad Sound
Taxonomy category, and license contracts. Pending-upload results are normalized
on every request and are always `no-store`.

## Waveform images

Search and sound responses include `waveform.available` and, when available,
`waveform.url`. The URL is an absolute Soundscaper API path; packaged clients
resolve it against `https://soundscaper.org`. A GET or HEAD to that path fetches
the medium Freesound waveform PNG directly, without another metadata API call.
The proxy validates the sound ID and asset identifier, pins the upstream host
and path, rejects redirects and other media types, and limits the image to 1 MiB.
Raw Freesound image URLs and the application credential stay out of public JSON.

## Required Cloudflare controls

Requests are accepted only for the canonical Soundscaper host, Soundscaper Pages
hosts, or an explicitly enabled loopback development host. This remains a
public read API: browser CORS is limited to the requesting Soundscaper web origin
and the packaged app origin. CORS controls browser response sharing, but does
not authenticate a caller.

Before production release:

- Add a Cloudflare rate-limiting rule and monitoring for
  `soundscaper.org/api/freesound/*`, sized to the Freesound application quota and
  concurrent preview budget. The Functions do not keep mutable counters in
  isolate globals.
- Prevent the production `soundscaper.pages.dev` hostname from bypassing those
  zone controls. Cloudflare documents an account-level Bulk Redirect to the
  custom domain (including subdomains), or protect the Pages hostnames with
  Access. If previews remain public and enabled, give them equivalent abuse
  controls.
- If a Cache Rule makes these Function responses cacheable, keep the full query
  string in the cache key and configure Cloudflare Vary handling for the emitted
  `Origin` and `Range` headers. The safest rule passes through `Origin` and
  bypasses shared caching when `Range` is listed; otherwise bypass API caching.
  Test `200`, `206`, and `416` behavior after every cache-rule change.

## License compatibility

The current Freesound resource documentation lists CC0, Attribution, and
Attribution NonCommercial. Every search, including `all`, sends an explicit
allowlist for those three licenses. Legacy Sampling and Sampling+ entries are
also removed from returned search pages, and direct sound or preview requests
reject them so a known ID cannot bypass the search filter. Freesound's sound
serializer returns a Creative Commons deed URL for `license`, including older
HTTP and 3.0 deeds. The proxy maps only known displayed deed URLs to HTTPS links
and keeps the license version in attribution.

The bounded implementation controls and remaining preview-stream risks are
recorded in the
[production threat model](../../../docs/production-threat-model.md#freesound-api-proxy).
