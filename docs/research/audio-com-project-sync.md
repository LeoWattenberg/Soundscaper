# audio.com native Audacity project sync

Validation date: 2026-10-15. The real registered Soundscaper PR preview passed
audio search, ranged playback and a small audio upload through processing, with
explicit provider deletion and application disconnect. Native project sync was a
separate experiment using the authorized disposable account. No Audacity client
secret or compiled application credentials were used.

## Authorization and user agent

The public [authorization server metadata](https://api.audio.com/.well-known/oauth-authorization-server)
advertises registration, authorization-code exchange, refresh grants, and PKCE
S256. A Soundscaper public client can complete browser consent and exchange its
own authorization code without a client secret.

The ordinary panel requests `public`. Its token cannot call `/project`:
audio.com returns HTTP 403, with the message that the token is limited to the
public API. Requesting `public all` during a separate browser consent produced a
token that was still confined in the same way. A standard refresh grant requesting
only the already authorized `all` scope returned a token without `public`;
`GET /project` then returned HTTP 200. This scope narrowing was performed only
for the manual experiment, outside the application's normal token lifecycle.

Both `User-Agent: Audacity/4.0.1` and an ordinary validation user agent could list
projects with the `all`-only token. An empty snapshot round trip succeeded using
the Audacity user agent. The subsequent snapshot containing audio succeeded with
the ordinary user agent throughout. User-agent spoofing was unnecessary for these
operations. This does not establish the behavior of other private endpoints.

audio.com's token response contains `token_type`, `expires_in`, `access_token`,
and `refresh_token`, without a `scope` field. Its observed expiry was 31,536,000
seconds. Soundscaper accepts this valid lifetime but caps its own refresh interval
at seven days. The application session still has its separate rolling expiry.

## Source-derived protocol

The protocol was read from Audacity commit
[`b482a5e3ee5443c0a438908aaf1caf09250171a9`](https://github.com/audacity/audacity/tree/b482a5e3ee5443c0a438908aaf1caf09250171a9/au3/libraries/au3-cloud-audiocom).
The principal sources are
[`ServiceConfig.cpp`](https://github.com/audacity/audacity/blob/b482a5e3ee5443c0a438908aaf1caf09250171a9/au3/libraries/au3-cloud-audiocom/ServiceConfig.cpp),
[`ProjectCloudExtension.cpp`](https://github.com/audacity/audacity/blob/b482a5e3ee5443c0a438908aaf1caf09250171a9/au3/libraries/au3-cloud-audiocom/sync/ProjectCloudExtension.cpp),
[`CloudSyncDTO.cpp`](https://github.com/audacity/audacity/blob/b482a5e3ee5443c0a438908aaf1caf09250171a9/au3/libraries/au3-cloud-audiocom/sync/CloudSyncDTO.cpp),
[`LocalProjectSnapshot.cpp`](https://github.com/audacity/audacity/blob/b482a5e3ee5443c0a438908aaf1caf09250171a9/au3/libraries/au3-cloud-audiocom/sync/LocalProjectSnapshot.cpp),
[`BlockHasher.cpp`](https://github.com/audacity/audacity/blob/b482a5e3ee5443c0a438908aaf1caf09250171a9/au3/libraries/au3-cloud-audiocom/sync/BlockHasher.cpp),
and [`WavPackCompressor.cpp`](https://github.com/audacity/audacity/blob/b482a5e3ee5443c0a438908aaf1caf09250171a9/au3/libraries/au3-cloud-audiocom/sync/WavPackCompressor.cpp).

The live sequence was:

1. `POST /project` with `{name, blocks: [hash, ...]}` creates a pending snapshot
   and returns `project`, `snapshot`, and `sync`. The real service returned HTTP
   200, while Audiocity returns 201 for creation.
2. PUT the metadata bytes to `sync.file.url`, then POST its `success` hook.
   Despite its `snapshot.xml` object name, the metadata is binary: an eight-byte
   little-endian dictionary length, the serialized dictionary, and the serialized
   project document. It is not the complete SQLite AUP3 file.
3. PUT each missing WavPack block to its descriptor URL and POST its `success`
   hook. Audacity hashes the uncompressed block, replaces the first eight hex
   characters with its block ID, and embeds `FORMAT`, `BLOCK_ID` and `HASH` APE
   tags in the WavPack data. The server normalizes descriptor hashes to lowercase;
   Audacity maps them without case sensitivity.
4. `POST /project/{projectId}/snapshot/{snapshotId}/sync` completes the snapshot
   after metadata and blocks are confirmed. The observed response was HTTP 204.
   A mixdown upload was unnecessary for these tests.
5. `GET /project/{projectId}/snapshot/{snapshotId}?expand=blocks,file_url` returns
   the metadata download URL and block hashes and URLs. Reconstructing a local
   AUP3 requires decoding these blocks and rebuilding the database.
6. `DELETE /project/{projectId}` removes the test project, returning HTTP 204.

The observed native storage host was `s3.eu-central-1.wasabisys.com`, under
`/audio.com.projects/projects/`. Hooks were on `https://api.audio.com/project/`.
The signed transfers and their success hooks worked without sending the provider
OAuth bearer token to storage. Signed URLs are bearer capabilities and are not
included in this record. These observations do not broaden the shipped proxy's
destination allowlists.

## Verified project round trips

An empty project transferred 299 metadata bytes and returned a synchronized
snapshot. Downloaded metadata matched exactly. The corresponding standalone AUP3
fixture was 20,480 bytes.

The audio-bearing fixture contained one mono track, one clip, and 4,800 float32
samples at 48 kHz: a generated 440 Hz tone. Its metadata was 674 bytes and its
tagged WavPack block was 8,802 bytes. Creation, both signed PUTs, both success
hooks, final synchronization, metadata retrieval and block retrieval succeeded.
The downloaded metadata and WavPack bytes matched exactly; the decoded PCM also
matched the original float32 bytes exactly. A 40,960-byte standalone AUP3 was
reconstructed from the returned metadata and audio. It opened through the
deployed preview's File menu, with the expected track name, one track and one clip.

All projects created by these experiments were explicitly deleted. These checks
do not establish native Audacity desktop interoperability, conflict resolution,
resumption, quota handling, or compatibility with arbitrary projects.

## Application boundary and remaining work

The [regular public API](https://api.audio.com/v1/docs) does not expose these
project routes. Soundscaper's shipped audio.com panel therefore continues to
report project storage unavailable. Its project controls remain available only
for an explicitly configured Audiocity server advertising whole-file archives.
That transport preserves an entire AUP3/AUP4 SQLite file and cannot be substituted
for audio.com's native metadata-and-block protocol.

Exposing native audio.com project sync in the application needs a separate
opt-in authorization flow for project access, strict native route and signed
destination admission, and a bounded adapter between AUP3 databases and native
metadata/WavPack blocks. It also needs revision, cancellation, cleanup, ownership,
and conflict tests against the real protocol. Reusing the archive route to upload
whole SQLite bytes as `snapshot.xml` would not implement that protocol.
