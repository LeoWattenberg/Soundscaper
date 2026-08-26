# Milestone 7B: video model licence review and upstream pins

> **Activation status (2026-08-26):** this remains the provenance record for
> the six permitted video/semantic catalog entries, not evidence that their
> operation adapters or remote objects are production-admitted. Later work now
> implements the conditional TransNetV2, SigLIP/OCR, subject/saliency/reframe,
> semantic-search, highlight, and editorial workflow code and reviewed project
> publishers. Fast FFmpeg shots remain the admitted model-free baseline.
> TransNetV2 still lacks its converted graph, three-runtime parity, signed
> catalog entry, and authenticated ONNX Runtime target payloads; the same
> payload closure blocks the other visual models in packages. Intended EU R2
> URLs and digests remain metadata, not durable publication/read-back evidence.
> Five-target canaries and owner-lab qualification remain open and nonblocking;
> licensing, signatures, digests, selection, consent, runtime, and result
> authentication stay fail closed.

This is the licence and provenance review for the models the Framescaper
assistance track (7B) needs, and the record of how each pinned artifact was
verified. It is the video-side counterpart to
`docs/milestone-7-local-model-evidence.md`, which established the record
format, and it is cited as evidence by the video records in
`config/production-licensing-matrix.json`.

## What "verified" means here

The audio track staged a model whose bytes matched their pin exactly and which
the runtime still could not load: the Parakeet export fused the decoder and
joiner into one graph where the runtime wants three. The digest was right and
the model was wrong. That cost roughly 1.3 GB of local mirror transfer before
anything caught it, and it is why nothing below is pinned on a size and a
filename.

Every artifact in this review was fetched in full, hashed locally, and — for
every ONNX file — parsed to read its graph inputs, outputs, opsets and
operator counts. An artifact is pinned only when both its digest and its graph
signature match what the consuming stage needs. Two checks below exist purely
because of that discipline and would not have been caught by a digest:

- **The OCR dictionary.** The pinned recogniser emits 6625 classes. The pinned
  dictionary holds 6623 entries, which with a CTC blank and a space symbol
  accounts for the width exactly. A dictionary from a neighbouring build has a
  different length and decodes to confident nonsense rather than to an error.
- **The two SigLIP towers.** The pinned export ships the vision and text
  encoders as separate graphs projecting into one 768-dimension space. A fused
  export cannot embed a search query without also being handed an image.

`tests/desktop-local-model-catalog.test.ts` pins both shapes, alongside the
existing three-graph rule for speech recognition, so a future refresh that
breaks either fails in the repository rather than on a user's disk.

## The models

Six models are reviewed, pinned, and awaiting their first upload. Sizes are
the upstream bytes that will be mirrored.

| Model | Task | Size | Code | Weights |
| --- | --- | --- | --- | --- |
| YuNet 2026may | Face detection | 0.2 MiB | MIT | MIT |
| D-FINE-N (COCO) | Person and object detection | 14.6 MiB | Apache-2.0 | Apache-2.0 |
| U²-Net-P | Saliency fallback | 4.4 MiB | Apache-2.0 | Apache-2.0 |
| PP-OCRv4 mobile | On-screen text | 15.5 MiB | Apache-2.0 | Apache-2.0 |
| nomic-embed-text-v1.5 | Transcript embeddings | 131.6 MiB | Apache-2.0 | Apache-2.0 |
| SigLIP 2 base patch16-224 | Frame semantics and search | 393.3 MiB | Apache-2.0 | Apache-2.0 |

Total first upload: **559.5 MiB**, against the roughly 500 MB the plan
budgeted for this batch.

## Where this review departs from the plan's table

The plan's vision table (`docs/milestone-7-plan.md`) was written before any
artifact was fetched. Four of its rows changed once the actual bytes were
read, and the reasons are recorded here rather than silently applied.

**YuNet moves from the 2023mar build to 2026may.** The plan named 2023mar
because that was the published build when it was written. The zoo now also
ships 2026may under the same MIT terms, and the graphs differ in a way that
matters: 2023mar fixes its input at 640×640, while 2026may takes dynamic
height and width. Reframing operates on arbitrary source resolutions, so the
fixed-size build would force a resize-and-letterbox step on every frame and
push the anchor arithmetic back through that transform. Both builds carry the
same operator count and opset; the newer one is slightly smaller.

**Transcript embeddings move from GGUF to ONNX.** The plan assumed
nomic-embed-text-v1.5 in GGUF, which would have made a llama.cpp runtime a
prerequisite for semantic search and deferred the work to 7B-4 where that
runtime was scheduled. The model's own repository publishes an ONNX export
beside the original weights, under the same Apache-2.0 terms and from the
licence holder rather than a third party. Pinning that instead removes the
llama.cpp dependency from the search path entirely: it runs on the same
runtime the rest of the video stack uses. The optional editorial LLM at 7B-4
still needs a GGUF runtime; semantic search no longer waits on it.

**D-FINE is pinned at the nano size in full precision, not the small size.**
The plan offered N or S. At 14.6 MiB the nano export in float32 costs less
disk than the small model would quantised, and detector output here feeds a
tracker that interpolates between detections rather than a per-frame
consumer, so recall at the cadence matters more than per-frame precision. The
size can be revisited against the 7B-3 subject-retention fixture without any
licensing rework, since both sizes share one upstream and one licence.

**On-screen text is pinned at PP-OCRv4, not v5.** The plan named v4 or v5.
The runtime whose maintainer republishes these conversions under Apache-2.0
carries v4 as its newest ONNX build; v5 exists upstream only in the framework's
own format. Taking v4 keeps every shipped file inside one Apache-2.0 chain
rather than adding a conversion step this repository would then have to own.

## What is blocked, and what it does not block

**TransNetV2 is blocked.** It was the plan's accurate shot-detection mode.
Upstream is MIT and publishes weights for two runtimes this product cannot
load, and no ONNX build is published by its authors. The only public
redistribution of a converted build asserts GPL-3.0 over MIT upstream material
and ships a CoreML package rather than ONNX, so its terms conflict with
upstream and its bytes would be unusable here in any case. The record stays
`unresolved` on its licence review, which means the mirror refuses to publish
it — that refusal is enforced, not merely documented, because
`assertPublishable` treats any blocker other than the pending-hash one as
disqualifying.

This does not block 7B-1. Shot detection ships its fast mode on ffmpeg scene
scores, which needs no model at all; the accurate mode is the part that waits.
Resolving it means either an upstream ONNX release or an export produced and
documented in this repository, and the second option is a deliberate decision
about what this project is willing to own, not a task to slip into a later
slice unannounced.

**U²-Net-P is pinned but its provenance is thinner than the rest**, and the
record says so. Upstream is Apache-2.0 and states no separate weight terms,
but the ONNX conversion is redistributed by a widely used MIT-licensed tool
rather than by the weights' author, so the chain to the exact bytes rests on
that tool crediting its source rather than on machine-readable metadata. It is
pinned because the Apache-2.0 grant covers the conversion and the digest makes
the bytes auditable, and it is used only as the fallback consulted when
detection finds no subject, with a centre crop behind it. Its absence would
cost proposal quality, not the feature.

The D-FINE and SigLIP exports rest on the same kind of third-party conversion
but with a stronger chain: each declares its originating repository as its
base model in machine-readable metadata, and in SigLIP's case the export's own
configuration names that repository too. That is the distinction that
separates them from an anonymous re-upload, and it is the distinction that
made TransNetV2's only available conversion unusable.

## Upload

All six records are `permitted`, which authorizes an exact future publication;
it does not prove one occurred. The catalog carries intended immutable EU R2
URLs, sizes, and digests, and the mirror tooling can verify a credentialed
publication, but this activation contains no accepted durable upload/read-back
record. `THIRD_PARTY_LICENSES.md` and the pinned evidence continue to govern any
bytes offered through authenticated preseed or a later verified mirror.

## Branch hygiene: this branch must be squash-merged

The mirror stages downloads into `.model-mirror/`, which was not ignored until
this slice added it. Six commits on this branch therefore carry roughly 3.7 GB
of model weights that are already digest-pinned in the catalog and assigned
intended mirror identities, so nothing is recoverable from having them in the
history. This statement does not claim that the mirror objects were published.

The tree is fixed and nothing further accumulates, and by decision on
2026-08-13 the history is deliberately **not** being rewritten. That decision
depends on how this branch lands: it must be **squash-merged** into `main`, not
merged with its history. The final tree contains no `.model-mirror`, so a
squash carries no weights onto `main`; a normal merge would carry all 3.7 GB
onto `main` permanently. This historical local staging does not establish a
remote publication. Deleting the branch after the squash and running
`git gc --prune` reclaims the space locally.

## Non-goals

No video runtime, no inference code, and no UI. This slice reviews licences,
pins bytes, and proves those bytes are the ones the consuming stages need.
The 7B packets that consume them keep their own acceptance criteria, and
nothing here relabels a pending row as delivered.
