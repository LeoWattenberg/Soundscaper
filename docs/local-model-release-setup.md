# Publishing the additional local models

The eight additional models now have real conversion or native-worker evidence,
required nightly execution cases, and reviewed entries in the checked-in
production catalog. Model Manager may install their SHA-256-pinned artifacts;
execution remains separately fail-closed on the selected target's authenticated
runtime closure. The catalog-task register therefore records catalog status as
`ready` while activation remains `pending-external` on
`runtime-target-closure`.

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

## Applied review record

The reviewed release was prepared from catalog SHA-256
`fdcd0c72162926611093596708daf6d588e75fb2321a082f0c02b4ec4a6ad01f`
at recipe revision `fbf2f30b8d9f246b5c6724a31125a2de5a84e010`.
Its canonical 21-entry payload SHA-256 is
`3f2d8e731f8a8ee0f7fb828ae95f591bf67814cd3fe0c807a6e1e9f42bfdfed2`.
Exact verification passed before the catalog and its complete licensing rows
were applied together. Each task also pins the SHA-256 of its canonical catalog
entry, and validation recomputes that digest from the offered entry instead of
trusting a merely well-formed recorded value.

The payload preserves every prior catalog entry and appends only the eight
reviewed models. It does not broaden prior models' platform admission; a
separate Windows ARM64 catalog update remains necessary for those identities.
Generated model guides and runtime-evidence pins are refreshed from the applied
state. The next distinct model release must use a fresh external output directory
and unpublished model IDs; the preparation tool deliberately refuses an entry
already present in the production catalog.

The nightly-with-tests real-model phase remains the executable check for actual
installation, Electron IPC, inference, and output validation on a particular
package. Direct Linux worker probes and catalog admission do not substitute for
the selected target's authenticated runtime closure or packaged test result.

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
