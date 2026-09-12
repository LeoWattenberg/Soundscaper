# Publishing the additional local models

The eight additional models now have real conversion or native-worker evidence
and required nightly execution cases. This does not authorize installation:
Model Manager accepts only entries in the checked-in production catalog, whose
artifacts and licensing evidence are pinned by SHA-256.

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

## Prepare the exact review bundle

Commit the reproduced converter, artifact registers, evidence, and notices first.
Use that commit as the recipe revision. The preparation command refuses a
revision whose converter and evidence inputs differ from the working tree.

```sh
node --import tsx scripts/models/prepare-local-model-release.mjs \
  --output /tmp/soundscaper-local-model-release \
  --recipe-revision <committed-recipe-sha> \
  --models wav2vec2-base-960h,tiger-dnr,panns-cnn10,beat-this-small0,beat-this-final0,transnetv2,qwen3-4b-q4-k-m,dereverb-room
```

This writes `catalog.payload.json` and `release-bundle.json` in the selected
fresh directory outside the checkout (use an equivalent temporary path on
Windows). It verifies the current catalog, public-readback
receipts, exact source/conversion identities, retained conversion evidence,
and offline artifact notices. The bundle contains proposed licensing rows
bound by the candidate catalog. Those rows describe the state after publication;
preparation does not write them into the production matrix or claim release
completion. The existing catalog remains intact.

The payload preserves every existing catalog entry and appends the selected
models. This release does not broaden existing models' platform admission.
The separate Windows ARM64 catalog update can be reviewed later.

## Review and verify

Review `catalog.payload.json` and its `payloadSha256` in `release-bundle.json`.
Do not alter the reviewed catalog. Verify the resulting full catalog before
applying it:

```sh
node --import tsx scripts/models/prepare-local-model-release.mjs \
  --output /tmp/soundscaper-local-model-release \
  --verify-catalog /path/to/reviewed-catalog.json
```

Verification checks the exact reviewed payload and its SHA-256, its
licensing-row bindings, and that the base catalog has not changed
since preparation. It does not replace production files. After it succeeds,
apply the reviewed catalog and set the matrix's `localModelEvidence` to the
bundle's `licensingEvidence` rows together, retaining the rest of the matrix. Record each
entry's canonical SHA-256 in its catalog task and regenerate that task's
derived blockers. Retain the verified public-readback identities unchanged.

Run policy-narrative synchronization, regenerate the model guides, refresh
runtime evidence pins, and run the canonical quality gate. Build the
nightly-with-tests package and execute its real-model phase to verify actual
catalog installation, Electron IPC, inference, and output validation. The eight
candidate cases fail explicitly until their required catalog entries exist;
their direct Linux worker probes are not substitutes for this package test.

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
