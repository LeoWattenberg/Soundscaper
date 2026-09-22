# Freesound Pages Functions

These routes proxy the read-only Freesound API without exposing Soundscaper's
application credential. Obtain an APIv2 application key from Freesound's
[API application page](https://freesound.org/apiv2/apply). The proxy uses that
key with Freesound's token authentication and imports the HQ OGG preview exposed
by the sound resource, not the original file. It therefore does not need a user
OAuth grant.

## Secrets and environments

Set the required encrypted secret before the next production deployment. In the
Cloudflare dashboard, open **Workers & Pages → soundscaper → Settings →
Variables and Secrets**, select the **Production** environment, add
`FREESOUND_API_KEY`, and choose **Encrypt**. The Wrangler equivalent for the
project's production secret is:

```sh
npx wrangler pages secret put FREESOUND_API_KEY --project-name soundscaper
npx wrangler pages secret list --project-name soundscaper
```

Pages does not accept the Workers-only `secrets.required` configuration field.
Production requests fail closed with `503` when the production secret is absent.

Preview hostnames are admitted by the request guard, but preview deployments
deliberately fail closed with `503` unless the Preview environment also has a
secret. Only enable Freesound on trusted previews; preview URLs are public by
default. Protect them with Cloudflare Access and, where possible, use a separate
Freesound application credential. Configure it as an encrypted
`FREESOUND_API_KEY` in the dashboard's **Preview** environment; the Pages secret
CLI does not expose an environment selector.

For local development, put only `FREESOUND_API_KEY` in an ignored `.dev.vars`
file, then explicitly enable loopback request URLs when starting Pages:

```sh
npx wrangler pages dev dist --binding FREESOUND_LOCAL_DEVELOPMENT=1
```

The handler returns `503` when the local key is absent. Keep only that key in
`.dev.vars`; the non-secret loopback flag remains a CLI binding. Never put the
key in `wrangler.jsonc`, a plain Pages variable, a Vite variable, or a client
bundle.

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
Attribution NonCommercial. Freesound's current FAQ also says legacy Sampling+
sounds remain. The proxy accepts those results so one legacy entry cannot reject
an entire `all` search page, requires attribution, links the retired Sampling+
1.0 deed, and conservatively marks commercial use as unavailable. Freesound's
sound serializer returns a Creative Commons deed URL for `license`, including
older HTTP and 3.0 deeds. The proxy maps only known deed URLs to HTTPS links and
keeps the license version in attribution.

The bounded implementation controls and remaining preview-stream risks are
recorded in the
[production threat model](../../../docs/production-threat-model.md#freesound-api-proxy).
