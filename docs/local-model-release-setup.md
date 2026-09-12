# Publishing the additional local models

The eight additional models now have real conversion or native-worker evidence
and required nightly execution cases. This does not authorize installation:
Model Manager accepts only entries in the signed production catalog.

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

## Existing signing authority

The signing private key is deliberately outside the repository. Production
accepts the public keys pinned in `desktop/local-model-catalog-signature.ts`:

- `soundscaper-local-model-catalog-2026-08`
- `soundscaper-local-model-catalog-2027-01`

Use the existing private key, hardware signer, or signing service corresponding
to one of those keys. A file path or service/CI secret location is sufficient
for a maintainer to connect the signer. Do not put private key contents in a
commit, documentation, command output, or chat. No new key or disabled signature
check is needed for this release. A newly generated key will be rejected by
existing production builds.

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
Windows). It verifies the current signed catalog, public-readback
receipts, exact source/conversion identities, retained conversion evidence,
and offline artifact notices. The bundle contains proposed licensing rows
bound by the candidate catalog. Those rows describe the state after signing;
preparation does not write them into the production matrix or claim release
completion. The existing catalog and its valid signature remain intact.

The payload preserves every existing catalog entry and appends the selected
models. This release does not broaden existing models' platform admission.
The separate Windows ARM64 catalog update can be reviewed and signed later.

## Sign and verify

The signer signs the UTF-8 bytes returned by `canonicalJson(payload)` from
`desktop/local-model-catalog-signature.ts`, using Ed25519 with no prehash.
Pretty-printed JSON file bytes are not the signature input. Add the signature
to the payload as:

```json
"signature": {
  "algorithm": "Ed25519",
  "keyId": "<existing authorized key id>",
  "value": "<base64 Ed25519 signature>"
}
```

The signature is the only addition the signer should make. Verify the resulting
full catalog before applying it:

```sh
node --import tsx scripts/models/prepare-local-model-release.mjs \
  --output /tmp/soundscaper-local-model-release \
  --verify-signed /path/to/signed-catalog.json
```

Verification checks the existing production trust keys, the exact reviewed
payload, its licensing-row bindings, and that the base catalog has not changed
since preparation. It does not replace production files. After it succeeds,
apply the signed catalog and set the matrix's `localModelEvidence` to the
bundle's `licensingEvidence` rows together, retaining the rest of the matrix. Record each
signed entry's canonical SHA-256 in its catalog task and regenerate that task's
derived blockers. Retain the verified public-readback identities unchanged.

Run policy-narrative synchronization, regenerate the model guides, refresh
runtime evidence pins, and run the canonical quality gate. Build the
nightly-with-tests package and execute its real-model phase to verify actual
catalog installation, Electron IPC, inference, and output validation. The eight
candidate cases fail explicitly until their required signed entries exist;
their direct Linux worker probes are not substitutes for this package test.

## Asset publishing credentials

The existing model publisher reads `R2_MODELS_ACCESS_KEY_ID`,
`R2_MODELS_SECRET_ACCESS_KEY`, and `R2_MODELS_ENDPOINT` from its environment.
Its token needs object read/write access to `soundscaper-assets`; the endpoint
must address the bucket's EU jurisdiction. Load the ignored environment file
with Node's `--env-file=.env` when using local release tooling. These credentials
authorize asset storage, not catalog signing. Desktop users need neither set
of secrets to download an admitted model.

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
