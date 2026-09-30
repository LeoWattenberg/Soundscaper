# Local-model provenance

This reference defines the evidence a model needs before Soundscaper or
Framescaper may offer it through Model Manager, and records the current model
selection. It complements the runtime and consent boundaries in
[local assistance architecture](../architecture/local-assistance.md).

The executable authorities are `config/production-licensing-matrix.json`,
`config/local-model-catalog.json`, the catalog-task and conversion registers,
`THIRD_PARTY_LICENSES.md`, retained publication receipts, and their validators.
This page explains their contract; it does not replace their hashes or grant
admission independently.

## Evidence record contract

The `local-models` distribution gate is enabled, but only a complete evidence
row can feed the offered catalog. Requirements are fields, not prose. Every
`localModelEvidence` record must answer exactly these four keys:

| Requirement | Required evidence |
| --- | --- |
| `weights-and-code-license-review` | Separate code and weight grants, attribution duties, and any ambiguity about converted or redistributed bytes |
| `training-data-provenance-record` | The upstream account of training/evaluation sources, including acknowledged gaps |
| `model-card-and-use-restrictions` | Model-card conditions, access gates, field-of-use terms, and other restrictions |
| `versioned-download-notices-and-hashes` | Versioned artifacts, notices, byte lengths, SHA-256 values, distribution identities, and public read-back evidence |

Each requirement status is `recorded`, `pending`, or `unresolved`; only
`recorded` satisfies the gate. `pending` identifies work the repository can
complete, while `unresolved` identifies missing or conflicting upstream
authority. Both block distribution.

Distribution status is derived, never authored. `blockedBy` is the sorted set
of requirements not recorded, and `distributionStatus` is `permitted` only
when that set is empty. The validator rejects a missing or unknown requirement,
an authored result that disagrees with the derivation, a refused model id, and
non-commercial, research-only, or otherwise incompatible terms. Unknown,
conflicting, or incomplete evidence blocks distribution of the affected
artifact; it never becomes an optimistic status or silent exception.

Upstream URLs belong in `provenanceSources`. Repository evidence paths belong
in `evidence` and must resolve in the checkout. A permitted licensing row does
not by itself prove publication, installation, runtime compatibility, or a
successful inference case.

## Artifact identity and publication

An artifact is not verified by filename and digest alone. Every source object
is fetched in full and hashed. ONNX files are also parsed for the graph inputs,
outputs, opsets, operator counts, tensor geometry, and role-specific structure
the consuming adapter expects.

The structural checks include three independently loadable Parakeet encoder,
decoder, and joiner graphs; an OCR recognizer whose 6,625 output classes match
the 6,623-entry dictionary plus CTC blank and space; and separate SigLIP vision
and text towers projecting into the same 768-dimensional embedding space.
These checks prevent digest-correct but runtime-incompatible artifacts from
entering the catalog.

The catalog distinguishes two distribution kinds:

- `identity-mirrored` preserves authenticated upstream bytes exactly.
- `reproducibly-derived` binds a pinned source revision and digest, a locked
  offline toolchain and recipe, the output digest, required notices, graph
  inspection, and source-framework/ONNX parity.

The hash-locked CPython 3.12 conversion runner retains exact Linux x64 exports
and parity evidence for TIGER-DnR, PANNs Cnn10, both Beat This checkpoints,
TransNetV2, and Dereverb Room. TIGER keeps STFT, ISTFT, and overlap-add in owned
DSP around the converted neural core. TransNetV2 is converted only from the
pinned MIT upstream; the conflicting third-party CoreML redistribution is not
an accepted source.

Published objects use immutable `models/<id>/<version>/<file>` keys in the EU
R2 bucket. The publisher streams to disk, supports resumable multipart upload,
and requires HEAD, byte-range, CORS, and full public SHA-256 read-back before it
emits catalog output. Publication receipts are retained per artifact. The
catalog binds the complete licensing row and distributed artifact identities
by SHA-256, and the desktop package carries versioned offline notices.

Upstream Hugging Face and GitHub URLs remain provenance sources, not runtime
fallbacks. A gated, moved, or unavailable upstream object cannot cause an
installation from outside the catalog. Explicit authenticated preseed remains
the zero-network alternative.

## Offered speech and audio models

The current catalog contains 22 published identities. The table states the
maintained decision, not every possible replacement.

| Catalog id | Use | Code / weights | Decision |
| --- | --- | --- | --- |
| `silero-vad-v6` | Voice activity and silence | MIT / MIT | Pin the `silero-vad` source; do not confuse it with the non-commercial `silero-models` repository |
| `parakeet-tdt-0.6b-v2` | English ASR and filler-sensitive transcription | Apache-2.0 / CC-BY-4.0 | Primary English recognizer with native word timing |
| `parakeet-tdt-0.6b-v3` | European multilingual ASR | Apache-2.0 / CC-BY-4.0 | Multilingual Parakeet option; not assumed to retain fillers like v2 |
| `whisper-large-v3-turbo-ggml` | Long-tail multilingual ASR | MIT / MIT | q5_0 fallback through whisper.cpp; not the filler-removal authority |
| `wav2vec2-base-960h` | English Whisper word alignment | Apache-2.0 / Apache-2.0 | Runs only after automatic-language Whisper detects English |
| `pyannote-segmentation-3.0` | Speaker segmentation | MIT / MIT | Uses the reviewed ungated Sherpa mirror, never the gated upstream URL at install time |
| `speech-3d-speaker-eres2net` | Speaker embeddings | Apache-2.0 / Apache-2.0 | Forms the admitted diarization pair with pyannote segmentation |
| `deepfilternet3` | 48 kHz speech enhancement | MIT OR Apache-2.0 / same | Channel-preserving cleanup model |
| `tiger-dnr` | Dialogue/Music/Effects separation | MIT / Apache-2.0 | Repository-owned ONNX core with owned spectral processing |
| `panns-cnn10` | AudioSet reaction and event tagging | MIT / MIT | Pins the official 527-class map and records the lack of separate checkpoint terms |
| `beat-this-small0` | CPU beat/downbeat baseline | MIT / MIT | Default beat tracker |
| `beat-this-final0` | Higher-quality beat/downbeat tracking | MIT / MIT | Optional quality pack |
| `dereverb-room` | Room dereverberation | MIT / GPL-3.0 | Reproducible selected replacement for unlicensed UVR de-reverb weights |
| `kokoro-82m-v1.0` | Local text to speech | Apache-2.0 / Apache-2.0 | Uses the separately authenticated, package-generated offline G2P closure |

Parakeet remains primary because it supplies native segment/token timing and is
fast on CPU. Whisper remains the broad-language fallback; its non-verbatim
training and jittery native timing make it unsuitable as the sole filler and
karaoke authority. The planted-filler fixture, not a general reputation claim,
decides which ASR a filler recipe may use.

GTCRN, RNNoise, low-disk Whisper variants, GPU providers, and a fine-tuned
highlight classifier are not hidden prerequisites. They are outside the
current offered set.

## Offered vision, search, and editorial models

| Catalog id | Use | Code / weights | Decision |
| --- | --- | --- | --- |
| `yunet-face-detection-2026may` | Face detection for reframe | MIT / MIT | Uses the dynamic-height/width 2026may graph instead of fixed 640×640 `2023mar` |
| `dfine-nano-coco` | Person/object detection | Apache-2.0 / Apache-2.0 | Full-precision nano balances cadence and tracker interpolation |
| `u2netp-saliency` | No-subject saliency fallback | Apache-2.0 / Apache-2.0 | Accepted third-party conversion chain is recorded explicitly; centre crop remains the final fallback |
| `ppocr-v4-mobile` | On-screen text | Apache-2.0 / Apache-2.0 | v4 is the newest reviewed ONNX chain; v5 would require a repository-owned conversion |
| `nomic-embed-text-v1.5` | Transcript embeddings | Apache-2.0 / Apache-2.0 | First-party ONNX export keeps semantic search independent of llama.cpp |
| `siglip2-base-patch16-224` | Frame semantics and visual search | Apache-2.0 / Apache-2.0 | Separate reviewed text and vision towers share one embedding space |
| `transnetv2` | Accurate shot boundaries | MIT / MIT | Repository-owned ONNX conversion with TensorFlow, PyTorch, and ORT parity; FFmpeg `scdet` remains the model-free fast mode |
| `qwen3-4b-q4-k-m` | Titles, hooks, chapters, explanations | Apache-2.0 / Apache-2.0 | Optional 16 GiB-RAM GGUF pack; non-thinking grammar mode emits bounded JSON |

Deterministic heuristics and embeddings remain the always-available highlight
ranking path. Qwen earns its optional footprint through constrained generation
and explanation; raw output and unselected suggestions are never project state.

## Blocked and refused models

Two historical evidence rows remain blocked and absent from the offered
catalog so their ambiguity is not repeatedly rediscovered:

- `spleeter`: MIT code, but upstream has not resolved whether that grant covers
  the pretrained weights. TIGER-DnR replaces it.
- `demucs-v4-htdemucs`: MIT code, unstated weight terms, and an archived
  upstream repository. TIGER-DnR replaces it.

The refusal register is a second guard: the validator rejects these ids even
if a later author attempts to create an apparently complete record.

| Refused id | Reason and maintained replacement |
| --- | --- |
| `crisperwhisper` | Non-commercial weights; Parakeet timing plus the filler lexicon replaces it |
| `mms-300m-1130-forced-aligner` | Non-commercial upstream and re-exports; English alignment uses wav2vec2 |
| `nvidia-sortformer-diarization` | Non-commercial weights; pyannote plus ERes2Net replaces it |
| `nvidia-canary-1b` | Original release is non-commercial; later variants add no required capability over Parakeet |
| `madmom-models` | Non-commercial trained models; Beat This replaces them |
| `beatnet` | Unstated weights and a dependency on madmom models; Beat This replaces it |
| `open-unmix-umxhq` | Non-commercial weights; TIGER-DnR replaces it |
| `ten-vad` | Redistribution and competitive-use restrictions; Silero VAD replaces it |
| `essentia-models` | Non-commercial pretrained models despite compatible AGPL code |
| `bs-roformer-community-checkpoints` | No per-file grants or adequate provenance; `dereverb-room` covers the selected need |
| `beats-audioset-checkpoints` | Unstable shared-drive source and per-model licensing uncertainty; PANNs Cnn10 covers tagging |
| `uvr-deecho-dereverb` | No weight licence grant or first-party model card; `dereverb-room` replaces it |

Ultralytics YOLO is not refused as a licensing incompatibility: this product is
AGPL-3.0-only. It is simply not selected because D-FINE provides an ONNX-ready,
permissive, lower-complexity path without making the model packs depend on the
weights-as-derivatives theory.

## Runtime and real-model evidence

Catalog presence still permits installation and custody, not execution. Each
model's engine must be present in the authenticated selected-target runtime
manifest. The five maintained package targets generate the Sherpa, ONNX
Runtime, whisper.cpp, llama.cpp, and Kokoro G2P closures they need; packages
that omit a closure report typed unavailability rather than borrowing another
target's evidence or substituting an engine.

`config/local-model-real-test-cases.json` contains 20 cases covering all 22
published model identities. The generated handbook pages derive their purpose,
fixture, validation, engine availability, and test explanation from that
manifest and the catalog. Nightly-with-tests installs through Model Manager and
runs the packaged worker; direct conversion parity and production-worker
smokes cover reproducibly derived artifacts.

A successful case proves only its exact artifact, runtime, target, fixture, and
revision. It does not establish broad quality, performance, remote
availability, or an operating-system sandbox. Optional owner QA never grants
runtime authority.

## Adding or refreshing a model

Treat a model update as one reviewed supply-chain change:

1. add or update the complete licensing-evidence row and provenance sources;
2. record a refusal instead if any required authority is incompatible,
   conflicting, or unavailable;
3. pin the upstream revision and inspect every artifact's full bytes and
   runtime-specific structure;
4. for a derived artifact, update the locked recipe and retain conversion and
   source-framework parity evidence;
5. publish through the scoped mirror and retain HEAD, Range, CORS, and full
   SHA-256 read-back evidence;
6. update offline notices and bind their licensing row from the catalog;
7. add or update a real-model case and generated handbook page; and
8. verify every supported target's runtime closure before making the route
   available.

Changes to `config/production-licensing-matrix.json` or the licensing policy
also require the repository's FFmpeg runtime-evidence repin. Never hand-author
`distributionStatus`, infer one target from another, or describe an upload,
conversion, parity result, or runtime test that was not actually recorded.
