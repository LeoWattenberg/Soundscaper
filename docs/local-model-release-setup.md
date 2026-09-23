# Publishing the additional local models

The eight additional models now have real conversion or native-worker evidence,
required nightly execution cases, and machine-verified entries in the checked-in
production catalog. Model Manager may install their SHA-256-pinned artifacts;
execution remains separately fail-closed on the selected target's authenticated
runtime closure. Target builds generate and verify that closure before R2
publication, so the
catalog-task register records both catalog and activation status as `ready`.

All eight artifacts have been uploaded to the versioned product asset server and
verified with public HEAD, byte-range, CORS, and full SHA-256 readback. Their
receipts are in `evidence/local-model-publication/`. Room dereverberation is
declared GPL-3.0 in its upstream model card. The retained card, full license,
source links, and conversion notices are in `LICENSES/local-models/` and
`THIRD_PARTY_LICENSES.md`. Its dry training corpus and base-checkpoint lineage
remain explicitly unknown; publication does not claim otherwise.

The [complete dereverb source archive](https://assets.soundscaper.org/models/dereverb-room/1.0.0/corresponding-source.tar.gz)
is published beside the model. It includes the original checkpoint, configuration,
upstream and repository conversion code, frozen dependencies, fixtures, and
licenses. Its instructions reproduce the exact distributed model bytes; public
readback and clean-extraction verification are in `evidence/model-source-publication/`.
Keep this source link with the model's download and offline notices.

## Repository verification

Run the complete catalog-inclusion check from an ordinary checkout:

```console
npm run audit:local-model-release
```

The command derives each of the eight release-task entries from the checked-in
model-supply and conversion registers, retained conversion and parity evidence,
complete licensing rows, exact offline notices, and digest-pinned public
read-back receipts. It then requires the production catalog entry to equal that
derived value and its canonical SHA-256 to equal the task register pin. Use
`--models qwen3-4b-q4-k-m` (or another comma-separated subset) for a focused
check.

Success prints a `catalog-inclusion-verified` JSON receipt to standard output.
The verifier neither writes a candidate catalog nor publishes an artifact, and
there is no separate review directory or catalog-acceptance step outside the
checkout. The repository inputs and their exact digests are the complete
catalog-inclusion authority. Generated model guides reflect the checked-in
catalog state; all published entries now include Windows ARM64 where their
downloadable runtime closure is available.

Kokoro v1.0 is a separate 56-artifact identity mirror. Its catalog entry,
licensing row, offline notices, upstream source pins, and retained public
readback are checked with `npm run audit:kokoro-model-release`. Run
`node scripts/models/verify-kokoro-model-release.mjs --verify-public` to repeat
HEAD, byte-range, CORS, and full SHA-256 checks against all 56 live CDN files.
The model files are published. Target builds generate the pinned offline G2P
helper, then publish its authenticated archive to R2. The client checks its
complete file inventory before inference. Actual
speech generation still requires a passing nine-language text-to-WAV nightly
case from each packaged target; the recipe does not establish a cross-target
result by itself.

The nightly-with-tests real-model phase remains the executable check for actual
installation, Electron IPC, inference, and output validation on a particular
package. A verified downloaded runtime closure establishes runtime availability;
direct Linux worker probes and catalog admission do not substitute for that
package's inference result.

## Asset publishing credentials

The existing model publisher reads `R2_MODELS_ACCESS_KEY_ID`,
`R2_MODELS_SECRET_ACCESS_KEY`, and `R2_MODELS_ENDPOINT` from its environment.
Its token needs object read/write access to `soundscaper-assets`; the endpoint
must address the bucket's EU jurisdiction. Load the ignored environment file
with Node's `--env-file=.env` when using local release tooling. These credentials
authorize asset storage, not catalog changes. Desktop users do not need these
secrets to download an admitted model.

For large R2 objects, a cold CDN edge can return a full `200` response to its
first range request. Publication verification cancels that body and retries
once, then still requires the exact `206`, `Content-Range`, CORS headers, byte
length, and complete-file digest. The desktop downloader already restarts a
resumed transfer safely when the server returns a full response.

## Verification limits and performance

Actual production-worker probes use Linux x64 under WSL2 and real model files.
They cover timed words, nonzero tag scores, beat positions, a shot boundary,
readable generated text, and changed, non-silent audio. Numerical conversion
comparisons separately cover the source frameworks. These are basic execution
checks, not quality scores or proof that every target has passed inference.

TIGER is expensive on the current CPU path: the 13-second speech/music fixture
took about 531 seconds including model loading on the recorded development
host. Concurrent conversion work affected the measurement. Its nightly case
has a 30-minute timeout; a successful result does not imply interactive speed.
Qwen requires 16 GiB system memory, sufficient free memory, and a separate
2.33 GiB model download. All heavyweight checks remain outside the normal
Node and browser suites.
