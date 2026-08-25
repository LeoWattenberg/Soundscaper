# Lightscaper milestone L7 plan: raw and deep color

> Owning source for L7 sequencing, the sample-depth, working-range,
> raw-decoder, and GPU decisions, their invariants, and the bounded work
> packets. The
> [Lightscaper roadmap](../roadmap-lightscaper.md#l7-raw-and-deep-color)
> owns scope and status; the production licensing policy, the
> quality-budget policy, and the capability inventory own their claims.
> Grounded against the repository on 2026-08-25 at commit `3d1e908c` with
> file:line verification. L7 depends on L2's frame and develop contracts
> (`lightscaper-2-plan.md`), on L4's global operation set and renderer
> split (`lightscaper-4-plan.md`), and on L5's export paths
> (`lightscaper-5-plan.md`); it widens all three and adds no export
> milestone scope. Re-ground every citation at pickup — earlier milestones
> will have moved the tree.

## Goals and ordering principle

1. **Primary: users must not hit trouble.** A raw file is an original and stays
   byte-identical through import, develop, and export; precision is never
   silently discarded — an admission refuses a profile the renderer cannot
   carry, as `assertNativeImageSequenceRgba8DecodeCompatibility` does with nine
   named codes
   (`src/common/editor/native-media-image-sequence-rgba8-admission.ts:10-20`,
   `:36-58`); a pre-L7 `processVersion` stack renders identically after the
   widening; no decoder byte reaches a user before its licensing row clears.
2. **Secondary: one render, widened — not a deep-color fork.** Every deep sample
   flows through the same materializer, mask, composition, grade, and encode
   path the 8-bit render uses
   (`src/common/editor/unified-exact-render-visual-materializer-v13.ts:28-73`;
   `unified-exact-render-finishing-consumers-v13.ts:267-307`). The 8-bit path
   stays the conformance baseline, so it stays executable — it is the oracle the
   deep path is measured against.

Work is ordered by admission risk: the sample-profile widening and the
working-range declaration land first because every later packet emits buffers
under them, and because the headline acceptance — no schema change — is
falsifiable only before raw decode, GPU evaluation, and lens corrections have
added their own reasons for a schema to move.

## What already exists (do not re-plan)

- **The render core is already float.**
  `UnifiedExactLinearPremultipliedFrameV13` holds `Float64Array<ArrayBuffer>`
  pixels (`src/common/editor/unified-exact-linear-rgba-v13.ts:16-20,37`), and
  placement, dissolve, blend, and flatten all run there (`:48-155`); only the
  `Uint8Array` entry (`:276`) and the two exits that multiply by 255
  (`:157-173`, `:175-199`) are eight bits wide, and the managed-color grade —
  exposure, contrast, lift/gamma/gain, saturation, optional cube LUT — already
  divides by 255 in and rounds `value * 255` out
  (`unified-exact-render-finishing-consumers-v13.ts:281-303`;
  `video-color-management-v27.ts:325-339`, `:418-432`).
- **Depth and gamut limits live in admissions, not in types.**
  `VIDEO_SOURCE_V25_BIT_DEPTHS` admits 8, 10, 12, 16, 32
  (`video-source-professional-characteristics-v25.ts:22`) and `bitDepth` is
  `number | null` (`:71`); the eight-bit limit is an admission refusing
  `bit-depth-exceeds-rgba8`, `hdr-transfer-unsupported`,
  `wide-gamut-unsupported`, and `alpha-decode-unsupported`
  (`native-media-image-sequence-rgba8-admission.ts:38-57`), and
  `assertManagedVideoColorRenderAdmissionV1` refuses wide gamut and HDR the same
  way while its vocabularies already name `display-p3`, `bt2020`, `pq`, `hlg`
  and `VideoColorOutputSpaceV1` closes at `linear-rec709-d65 | srgb | rec709`
  (`video-color-management-v27.ts:392-409`, `:30-32`, `:33`).
- **A GPU accelerator with a CPU oracle exists and is CI-proved.**
  `video-motion-webgl2-v27.ts` carries a five-member fallback-reason vocabulary
  (`:19-25`) and an admission returning accelerator or reason (`:81-110`);
  `tests/browser/framescaper-v27-motion-webgl2.spec.js` runs both paths over one
  request and asserts an empty fallback list and a maximum absolute difference
  of `1e-6` (`:45-72`) in Chromium (`:14`). A digest-pinned corpus provisioned
  into an uncommitted `vendor/` by
  `scripts/provision-interchange-conformance.mjs`
  (`docs/interchange-conformance.md:21-34`) runs in CI ahead of the Node shards
  (`.github/workflows/quality.yml:113-114`).
- **The runtime-asset discipline is complete for one payload.**
  `config/ffmpeg-runtime-manifest.json` pins package identity, the
  `runtime/ffmpeg/0.12.10` public prefix (`:13`), per-file lengths, digests,
  bucket and CORS (`:31-48`), and an approved maintainer review with a
  `payloadSha256` (`:117-127`); `scripts/lib/ffmpeg-runtime-manifest.mjs`
  verifies it (`:59-90`) against five publication gate IDs (`:28-34`) and eight
  evidence paths (`:18-27`); `npm run audit:ffmpeg-runtime` (`package.json:132`)
  runs inside `audit:ci` (`package.json:139`), and the browser cache fetches
  from `https://assets.soundscaper.org`
  (`src/common/offline/ffmpeg-runtime-cache.ts:7-13`), the out-of-bundle
  convention `AGENTS.md:16-17` fixes.
- **The milestone-5 helper contract is the model for native decode.** Its seven
  elements — versioned wire schema, per-job grants, heartbeat and crash
  quarantine, cancellation acknowledgement, resource policy, structured
  progress, digest-pinned provenance — are at
  `docs/milestone-5-plan.md:133-169`; `HELPER_JOB_KINDS` holds eleven kinds with
  independently versioned subcontracts
  (`desktop/helper-job-subcontract.ts:10-38`), `HELPER_EXECUTABLE_ROLES` five
  (`desktop/helper-native-job-contract.ts:109-111`), and
  `desktop/helper-native-image-sequence-grant.ts:11-48` is the shape a decode
  grant follows. `VIDEO_EFFECT_DEFINITIONS`
  (`src/common/editor/video-effects.js:29`) registers a pixel operation.

## Verified gaps this plan closes (grounded 2026-08-25)

- **Nothing in the tree decodes raw.** No `libraw`, `demosaic`, or `bayer`
  identifier exists under `src/`, `desktop/`, `config/`, or `docs/`; native
  image-sequence decode covers `png`, `tif`, `tiff`, `exr` only
  (`native-media-image-sequence.ts:24-26`).
- **Every pixel-carrying interchange type is `Uint8Array`.**
  `UnifiedExactRenderRgbaFrameV13.pixels`
  (`unified-exact-render-finishing-consumers-v13.ts:49-53`),
  `VideoMaskMatteRgbaInputV13.pixels` (`video-mask-matte-rgba-v13.ts:9-13`), and
  the frame-pack length function's hardcoded `4n` bytes per pixel
  (`native-rgba-frame-pack-v1-contract.ts:27`) all fix eight bits per channel;
  the materializer allocates `new Uint8Array(width * height * 4)`
  (`unified-exact-render-visual-materializer-v13.ts:81,195`) and composites
  masks by `Math.round(alpha * mask / 255)` (`:69`).
- **The working space clamps to unit range, so scene-referred values cannot
  exist.** `rgbaTuple` bounds every channel to `[0, 1]`
  (`video-color-management-v27.ts:411-416`) and the stack clamps after every
  grade (`:286-289`, `:490-495`); highlight recovery and HDR merge need headroom
  above 1.0, and today an exposure lift silently clips.
- **The runtime-asset pipeline is single-payload, npm-shaped, and
  digest-bound.** `EXPECTED_RUNTIME_FILES` names exactly `ffmpeg-core.js` and
  `ffmpeg-core.wasm` (`scripts/lib/ffmpeg-runtime-manifest.mjs:14-17`), identity
  verification reads an installed package against the project lock (`:72-81`),
  runtime files resolve under `dist/esm/` (`:83-88`), and the browser cache
  hardcodes the same two names (`src/common/offline/ffmpeg-runtime-cache.ts:8`).
  The `THIRD_PARTY_LICENSES.md` digest is an evidence entry in that manifest
  (`:18-27`) whose review record is `approved` with a `payloadSha256`
  (`config/ffmpeg-runtime-manifest.json:117-127`); adding a decoder section
  invalidates it, and restoring it is a maintainer sign-off
  (`docs/interchange-conformance.md:60-72`).
- **The export plan seam moved since the contract sheet was written:**
  `createExportPlan` is at `src/common/editor/export.js:155` and
  `createVideoExportPlan` at `src/common/editor/video-export.js:244`.

## Decisions

### Depth widening is an admission edit, and the schema digest proves it

`RenderSampleProfileV1` (L2) gains `unorm16` and `float32` in its admitted set.
Nothing persisted changes: the profile is a per-buffer render declaration, the
develop stack records operations and a `processVersion`. The claim is
falsifiable, so WP-L7.0 ships a canonical-JSON digest golden over every L2
schema family and lands green only if that digest is untouched. The hard parts
are already float — Float64 composition
(`unified-exact-linear-rgba-v13.ts:19,37`) and unit-normalized grade math
(`unified-exact-render-finishing-consumers-v13.ts:288-302`) — so widening
replaces the element type at four allocation sites and one length computation,
not the renderer.

### The working range is declared; the old clamp belongs to the old version

Removing the unit clamp outright changes every existing render: an exposure lift
that clips today stops clipping and pre-L7 goldens move. So the color context
gains an explicit working range beside its `workingSpace` and `outputSpace`
fields (`video-color-management-v27.ts:37-44`). Stacks whose `processVersion`
predates L7 resolve to the clamping range and render identically; L7 stacks
resolve to the extended range, where `rgbaTuple`'s `[0, 1]` bound (`:411-416`)
and the per-grade `clamp` (`:286-289`) are lifted and the only remaining clamp
is `encodeManagedSdrLinearPixelV1` (`:312-323`) at output. Highlight recovery
and HDR merge become expressible, and process-version stability holds because
the old behavior is a named range, not a deleted branch.

### The raw decoder is a repository-built payload on the runtime-asset pipeline

The decoder does not enter the Pages bundle: production JavaScript chunks cap at
500,000 bytes (`AGENTS.md:37-39`) and the FFmpeg precedent already puts a
32,232,419-byte payload behind `assets.soundscaper.org`
(`config/ffmpeg-runtime-manifest.json:13-28`; `AGENTS.md:16-17`). It is built in
the repository from pinned sources on the pattern the seven audio codecs use —
`source-manifest.json`, `NOTICE.md`, `licenses/`, and a `build:*`/`audit:*` pair
wired into `audit:ci` (`package.json:111-112,139`) — because the FFmpeg
manifest's identity check reads an installed npm package
(`scripts/lib/ffmpeg-runtime-manifest.mjs:72-81`) and no npm-published raw
decoder carries a reviewable corresponding-source story. WP-L7A.0 generalizes
that verifier and the cache rather than forking a pipeline.

### LibRaw's dual license: LGPL-2.1 is selected; a recorded approval gates use

LibRaw is offered under LGPL-2.1 or CDDL-1.0, and this repository is
AGPL-3.0-only. The selection is made here, not deferred: **the LGPL-2.1 arm is
selected and CDDL-1.0 is explicitly not selected**, on the ASIO precedent, which
names the selected arm and records that "its alternative proprietary license is
not selected" (`config/production-licensing-matrix.json:956-968`). CDDL-1.0 is a
file-level copyleft whose direction toward AGPL-3.0-only the matrix's
`agplCompatibilityDirection` field could not describe honestly, so selecting it
produces an unfillable row.

Selecting an arm is not clearing it. This plan asserts no legal conclusion about
LGPL-2.1 combining into AGPL-3.0-only; that is a maintainer's recorded review.
The decoder's row lands with `status: "blocked"` and a named `blocker`, as every
plug-in and codec row does today — "a row's presence is not enablement"
(`docs/milestone-5-plan.md:203-205`) — and WP-L7A.0's audit refuses to build,
publish, or fetch a decoder byte while it is blocked. Because that review is
external, L7's raw capability is split so the milestone does not depend on it:
container read, embedded-preview fast path, and neutral baseline are first-party
code carrying no third-party license, and only demosaic-quality full decode sits
behind the gate. The exit gate's deterministic corpus decode is met over the
first-party path, and the decoder's goldens join that suite when it clears.

### Camera profiles and lens profiles stay blocked, and neutral means neutral

L7 ships neutral camera baseline rendering: white balance and primaries
reconstructed from the raw file's **own** recorded neutral and color-matrix
tags. A file recording neither is refused with a named code rather than rendered
against a guessed matrix — the fail-closed posture the image-sequence admission
takes toward unreported color
(`native-media-image-sequence-rgba8-admission.ts:44-45`). Any external
camera-profile or lens-profile database is a `nativeFormatPolicies` row with
`status: "blocked"`, excluded while its blocker stands.

### GPU evaluation is WebGL2 with the CPU as oracle, admitted per capability

The GPU tier reuses the proven shape rather than the newest API: WebGL2, a named
fallback-reason enum, and a CPU-versus-GPU parity spec in the CI Chromium job,
because that exact combination already passes at `1e-6`
(`video-motion-webgl2-v27.ts:19-25,81-110`;
`tests/browser/framescaper-v27-motion-webgl2.spec.js:45-72`;
`.github/workflows/quality.yml:181`). The WebGL2 develop-stack evaluator
replaces L4's fixed-code compositor as Lightscaper's proxy accelerator rather
than joining it; L4's conformance harness is the gate, the CPU evaluator stays
the render of record, and no third renderer exists at any point
(`lightscaper-4-plan.md`). Playwright's headless Chromium rasterizes WebGL2 in
software — deterministic, and what makes the parity claim CI-provable at all;
real-GPU breadth is an L9 row, and WebGPU stays a watch item.

### Wide-gamut output widens the existing admission, not the export stack

Display-P3 output is admitted by widening the primaries branch of
`assertManagedVideoColorRenderAdmissionV1`
(`video-color-management-v27.ts:400-408`) and the `VideoColorOutputSpaceV1`
union (`:33`), reaching files through L5's `createPhotoExportPlan`
(`src/common/editor/photo-export.ts`) and its output profile field, and through
`createExportPlan` (`src/common/editor/export.js:155`) and
`createVideoExportPlan` (`src/common/editor/video-export.js:244`) for the two
timeline products. Soft proofing renders the stack through the selected output
profile and back for display and never writes develop state; an output the
platform cannot prove refuses visibly.

### Rejected alternatives (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| A separate deep-color render path beside the 8-bit one | Two paths drift, and preview and export are the same render; the 8-bit path is the oracle, not a legacy branch. |
| Adding `sampleFormat` to the persisted develop stack | The profile is a per-buffer render declaration (L2), not develop state; putting it in the stack makes the headline "no schema change" acceptance false by construction and breaks reopening old stacks. |
| Selecting CDDL-1.0 | A file-level copyleft with no honest `agplCompatibilityDirection` toward AGPL-3.0-only; the row could not be filled truthfully. |
| Asserting LGPL-2.1 clears and shipping on that basis | License conclusions are recorded maintainer reviews here, never agent assertions; the row ships `blocked` and the audit enforces it. |
| A second GPU renderer beside L4's compositor | Three renderers cannot be kept in conformance; the accelerator is replaced, not multiplied (`lightscaper-4-plan.md`). |
| Re-stamping the approved FFmpeg review digest to land the decoder notices | That approval covers bytes a maintainer reviewed; re-stamping it to cover unreviewed bytes is a forged sign-off (`docs/interchange-conformance.md:60-72`). |

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| L7.0 | Serialized (one work stream) | WP-L7.0 sample-profile widening and the schema-digest proof; WP-L7.1 working-range declaration, highlight recovery, HDR merge |
| L7A | Parallel track (raw) | WP-L7A.0 runtime-asset generalization and the decoder licensing gate; WP-L7A.1 container read, embedded preview, neutral baseline, corpus |
| L7B | Parallel track (acceleration) | WP-L7B.0 GPU evaluation with the CPU oracle |
| L7C | Parallel track (surface) | WP-L7C.0 native raw and preview helper services; WP-L7C.1 manual lens corrections, wide-gamut output, soft proofing |

No track opens until every L7.0 acceptance check passes: WP-L7A.0 through
WP-L7C.1 emit or consume buffers whose sample profile and working range L7.0
fixes.

## Work packets

Every L7 packet is decomposed here against the five fields — Outcome,
Invariants, Acceptance, Non-goals, Stop condition — and no slice doc is owed at
pickup; a packet that grows one names it here first.

### WP-L7.0 — Deep-sample interchange widening

- **Outcome:** the admitted-set data in `render-sample-admission-v1.ts` gains
  `unorm16` and `float32` beside `unorm8`; the four eight-bit allocations
  (`unified-exact-render-visual-materializer-v13.ts:81,195`;
  `unified-exact-render-finishing-consumers-v13.ts:281`;
  `unified-exact-linear-rgba-v13.ts:161,181`) and the `/ 255` and `* 255`
  constants (`unified-exact-render-finishing-consumers-v13.ts:288-302`) derive
  element type and scale from the profile L2 already attached; the frame-pack
  length function's `4n` (`native-rgba-frame-pack-v1-contract.ts:27`) becomes
  profile-derived at a new pack version declaring the sample format in its
  header; digest goldens re-pinned at every admitted depth. No interchange type
  is re-declared here: L2's WP-L2.0 landed `RenderSampleBufferV1` and L6's
  WP-L6.0 the mask side (`lightscaper-2-plan.md`; `lightscaper-6-plan.md`).
- **Invariants:** `unorm8` + sRGB reproduces its pre-L7 goldens byte for byte;
  the accepted set lives in an admission function, never in a type, a persisted
  field, or a schema version; refusals carry named codes in the style of
  `native-media-image-sequence-rgba8-admission.ts:10-20`.
- **Acceptance:** `npm test -- --shard=lightscaper` runs
  `tests/lightscaper-render-sample-profile-admission.test.ts` (every admitted
  profile accepted, every refused profile refused with its exact code),
  `tests/lightscaper-deep-sample-parity.test.ts` (one plan at `unorm8`,
  `unorm16`, `float32` — exact where declared exact, within the recorded
  tolerance elsewhere), and `tests/lightscaper-develop-schema-digest.test.ts`
  (canonical-JSON digest of every L2 schema family, failing if the widening
  moves one); `npm run check:static` (`package.json:140`) covers lint,
  typecheck, `check:architecture`, `audit:ci`, and build.
- **Non-goals:** no raw decode, GPU, new output space, or extended-range
  headroom — the unit clamp stays put until WP-L7.1.
- **Stop condition:** stop if admitting a profile requires a field on any
  persisted record; the widening is then a schema change and the L2 contract,
  not this packet, is wrong.

### WP-L7.1 — Extended working range, highlight recovery, HDR merge

- **Outcome:** the color context declares a working range beside `workingSpace`
  and `outputSpace` (`video-color-management-v27.ts:37-44`); pre-L7
  `processVersion` values resolve to the clamping range, keeping the `[0, 1]`
  bound (`:411-416`) and the per-grade `clamp` (`:286-289`), while L7 stacks
  resolve to the extended range whose only clamp is output encode (`:312-323`).
  Highlight recovery reconstructs clipped channels from unclipped neighbors in
  that headroom as a shared effect; HDR exposure merge aligns and deghosts a
  bracket into one `float32` working image through the WP-L7.0 profile.
- **Invariants:** an old `processVersion` clamps exactly where it clamped
  before; no path here rewrites a stack's `processVersion` implicitly — only a
  `develop/set-stack` carrying both versions, journaled with its inverse, may
  change it (`lightscaper-2-plan.md`); output encoding clamps exactly once;
  alpha stays straight through the grade stack; a bracket whose exposures cannot
  be ordered is refused rather than merged in arbitrary order.
- **Acceptance:** `npm test -- --shard=lightscaper` runs
  `tests/lightscaper-working-range-process-version.test.ts` (a pre-L7 stack
  reproduces its clamped golden, the same stack at the L7 version its
  extended-range golden, and neither path rewrites a recorded `processVersion`),
  `tests/lightscaper-hdr-merge-deghost.test.ts` (a synthetic bracket with a
  moving element merges deterministically twice in one run and byte-compares; an
  unorderable bracket refuses with its named code), and
  `tests/lightscaper-highlight-recovery.test.ts` (identity on an unclipped
  frame).
- **Non-goals:** no tone mapping (`toneMapping` stays `'none'`,
  `video-color-management-v27.ts:43`), no display-referred HDR output.
- **Stop condition:** stop if lifting a clamp moves any pre-L7 golden — the
  range declaration is then not carrying the process version.

### WP-L7A.0 — Runtime-asset generalization and the decoder licensing gate

- **Outcome:** `scripts/lib/ffmpeg-runtime-manifest.mjs` generalized into a
  runtime-asset manifest family — its single manifest path (`:10`), two-name
  `EXPECTED_RUNTIME_FILES` map (`:14-17`), and npm-only identity check
  (`:72-81`) become per-payload descriptors admitting a repository-built payload
  with a `source-manifest.json`, and the browser cache's file-name pair is
  parameterized (`src/common/offline/ffmpeg-runtime-cache.ts:8`);
  `build:raw-decoder` and `audit:raw-decoder` on the pattern at
  `package.json:111-112`, joined into `audit:ci` (`package.json:139`).
  `config/production-licensing-matrix.json` gains a `nativeFormatPolicies` row
  in the ASIO row's shape (`:956-968`) recording the LGPL-2.1 selection, the
  non-selection of CDDL-1.0, the `agplCompatibilityDirection`, redistribution
  posture, `status: "blocked"`, and a named blocker, plus a
  `futureDistributionGates` entry beside `native-codecs` (`:894-901`).
- **Invariants:** while the row is `blocked` no decoder byte is built,
  published, fetched, staged, or bundled; the Pages bundle gains nothing; the
  FFmpeg manifest verifies byte-identically after generalization.
- **Acceptance:** `npm run audit:ci` with the new audit wired in;
  `tests/lightscaper-raw-runtime-manifest.test.ts` proves a manifest whose
  digests disagree with its payload fails, a `blocked` row refuses publication,
  and the existing FFmpeg manifest still verifies through the generalized path;
  `npm run check:notices` (`package.json:47`). One clause runs in the commit
  that records the external review: with the decoder's `nativeFormatPolicies`
  row moved from `blocked` to admitted by a recorded maintainer review,
  `npm run check:notices`, `npm run audit:raw-decoder`, and
  `npm run audit:ffmpeg-runtime` all pass with the decoder's
  `THIRD_PARTY_LICENSES.md` section at the exact locked version and the
  re-stamped runtime review record.
- **Non-goals:** no decode implementation, no publication, and no notices
  section while the row is `blocked`.
- **Stop condition:** escalate to a maintainer if landing the decoder's notices
  section would require re-stamping the approved FFmpeg runtime review record
  (`config/ffmpeg-runtime-manifest.json:117-127`).

### WP-L7A.1 — Raw container, embedded preview, neutral baseline, corpus

- **Outcome:** a first-party bounded raw container reader walking TIFF-EP and
  DNG image file directories, extracting the embedded preview and the sensor
  plane description without decoding the mosaic, feeding cull-speed previews
  before full decode; neutral camera baseline rendering from the file's own
  recorded neutral and color-matrix tags; the reviewed decoder bound behind
  WP-L7A.0's admission for demosaic-quality decode into a `float32` buffer under
  WP-L7.0's profile, unreachable while that row is `blocked` and no condition
  of this packet closing; `config/raw-conformance-corpus.json` pinning a
  synthetic set plus freely licensed real files, the real half provisioned into
  an uncommitted `vendor/raw-corpus/` by `scripts/provision-raw-corpus.mjs` as
  `scripts/provision-interchange-conformance.mjs` does
  (`docs/interchange-conformance.md:21-34`); `photoRaw` flipped to `true` in the
  Lightscaper `config/production-capabilities.json` profile and its
  `projectFeatures` inventory row in one change, scoped to the first-party
  capability this packet proves and evidenced on disk
  (`tests/production-capability-inventory.test.js:33,185-203`).
- **Invariants:** the reader never allocates from an unvalidated length nor
  follows an offset outside the file; the original is never rewritten; a file
  recording no neutral is refused with a named code, never rendered against a
  guessed matrix; the embedded preview never stands in for the render of record
  at export.
- **Acceptance:** `npm test -- --shard=lightscaper` runs
  `tests/raw-synthetic-corpus-goldens.test.ts` over the in-repo deterministic
  synthetic corpus, which is the CI gate and needs no provisioning;
  `npm run provision:raw-corpus && npm run test:reference:raw` (a
  `test:reference:*` script on the pattern at `package.json:54`) additionally
  runs the freely licensed real-file corpus, digest- and license-pinned with its
  source URLs in `config/raw-conformance-corpus.json`, which skips with a named
  `raw-corpus-unprovisioned` reason rather than failing when
  `vendor/raw-corpus/` is absent (`scripts/provision-raw-corpus.mjs --check`); a
  CI step provisions it on the pattern at
  `.github/workflows/quality.yml:113-114`.
  `tests/lightscaper-raw-container-goldens.test.ts` walks every corpus member
  through the first-party path — container IFD read, embedded-preview
  extraction, and neutral baseline from the file's own neutral and color-matrix
  tags — twice in one run, byte-compares the two runs, then checks each pinned
  golden digest, and refuses with its named code any member recording no
  neutral; `tests/lightscaper-raw-decoder-gate.test.ts` asserts that with the
  LGPL-2.1 row `blocked` no demosaic path is reachable and the refusal names the
  blocker. Demosaic-quality decode goldens join this suite in the commit that
  records the license review; they are not an L7 gate.
  `tests/lightscaper-raw-container-fuzz.test.ts` survives its mutation corpus
  with no crash, hang, or over-read;
  `tests/lightscaper-raw-preview-fastpath.test.ts` proves the preview path reads
  strictly fewer bytes than full decode on the same file.
- **Non-goals:** no camera- or lens-profile database, no DNG writing, no
  panorama, no real-camera breadth claim; license-provenance sign-off for every
  real corpus member is the L9 licensing row (`roadmap-lightscaper.md:512-515`),
  not an L7 claim.
- **Stop condition:** stop if any corpus member decodes non-reproducibly across
  two runs in one process — a non-deterministic decoder cannot be a golden
  oracle.

### WP-L7B.0 — GPU evaluation with the CPU conformance oracle

- **Outcome:** a WebGL2 evaluator for the develop stack modeled on
  `video-motion-webgl2-v27.ts`, reusing its fallback-reason vocabulary shape
  (`:19-25`) and its admission-returns-accelerator-or-reason contract
  (`:81-110`), replacing L4's fixed-code compositor as the proxy accelerator
  rather than joining it; the CPU path remains the conformance oracle; a
  tolerance budget registered in `config/quality-budgets.json` with `ratio`-unit
  thresholds against `github-ubuntu-playwright-1.62.1`, whose
  `qualificationEligible` flag is `false`, so the row is provisional evidence.
- **Invariants:** GPU absence produces a named fallback reason, never a silent
  CPU switch and never a different picture; the GPU path never becomes the
  oracle; operation order is identical on both paths; a GPU-evaluated pixel
  never reaches an export buffer, a 1:1 render of record, or a pinned golden —
  the GPU evaluator is an interactive-preview accelerator under the purpose
  policy WP-L4.5 generalized
  (`src/framescaper/editor-video-proxy-use-policy-v20.ts:46-51`;
  `lightscaper-4-plan.md`), so export and 1:1 zoom resolve to the CPU evaluator
  unconditionally; after this packet exactly two develop renderers exist, the
  CPU oracle and one accelerator.
- **Acceptance:** `npm run test:browser` runs
  `tests/browser/lightscaper-develop-gpu-parity.spec.js` in the CI Chromium
  project (`.github/workflows/quality.yml:181`), built with the esbuild harness
  pattern at `tests/browser/framescaper-v27-motion-webgl2.spec.js:75-96`,
  asserting an empty `fallbackReasons` list and a maximum absolute channel delta
  within budget; where the capability is absent it asserts the exact fallback
  reason rather than skipping. `npm test -- --shard=lightscaper` runs
  `tests/lightscaper-develop-export-evaluator.test.ts`, which asserts the export
  path's evaluator selection is CPU regardless of detected GPU capability,
  mirroring `tests/browser/lightscaper-develop-proxy.spec.js` in
  `lightscaper-4-plan.md`, and `tests/lightscaper-gpu-tolerance-budget.test.ts`,
  which pins the budget row against silent loosening
  (`docs/quality-budgets.md:719-726`).
- **Non-goals:** no WebGPU; no Firefox row (defined at
  `playwright.config.mjs:34`, absent from the CI matrix); no real-GPU breadth.
- **Stop condition:** stop if a shader requires reordering the stack to be fast;
  an accelerator that reinterprets the plan is a second renderer.

### WP-L7C.0 — Native raw and preview services

- **Outcome:** a `photo-raw-decode` job kind in `HELPER_JOB_KINDS`
  (`desktop/helper-job-subcontract.ts:10-22`) with its own
  `HELPER_JOB_SUBCONTRACT_VERSIONS` entry (`:26-38`); a grant module shaped like
  `desktop/helper-native-image-sequence-grant.ts:11-48` declaring the decode
  profile and the output sample profile; a `raw-decoder` entry in
  `HELPER_EXECUTABLE_ROLES` (`desktop/helper-native-job-contract.ts:109-111`)
  with digest-pinned per-platform provenance; a task-progress kind if the ten at
  `controller/task-progress.ts:3-13` do not cover it; the WASM path is the
  declared fallback.
- **Invariants:** the renderer never receives spawn or path authority; a helper
  crash quarantines and the Web Core path continues unchanged; disabling every
  native service leaves a complete working product; the native and WASM paths
  share one result contract, and their byte equivalence is proved when the
  license row clears.
- **Acceptance:** `npm test -- --shard=lightscaper` runs
  `tests/lightscaper-raw-helper-grant.test.ts` (malformed, oversized, and
  cross-kind grants refused by wire validation),
  `tests/lightscaper-raw-helper-fallback.test.ts` (a quarantined helper leaves
  the Web Core path serving and the project revision intact), and
  `tests/lightscaper-raw-helper-subcontract-version.test.ts` (the
  `photo-raw-decode` job kind, its subcontract version, and its `raw-decoder`
  executable role refuse an unpinned or mismatched provenance record). All three
  run against a stub decoder fixture: no decoder byte is built while the
  LGPL-2.1 row is `blocked` (WP-L7A.0).
- **Non-goals:** no packaging, signing, or release row — L8 packages this; no
  native-versus-WASM decode equivalence over the raw corpus, since both decoders
  are gated on the external LibRaw license review, so that byte-comparison joins
  the L9 licensing and real-camera rows
  (`roadmap-lightscaper.md:494-497,512-515`).
- **Stop condition:** stop if the native and WASM paths cannot share one result
  contract; the pair is what L8 ships, and a fork here ships two pictures.

### WP-L7C.1 — Manual lens corrections, wide-gamut output, soft proofing

- **Outcome:** distortion, chromatic aberration, defringe, and lens vignette
  registered in a new `visual-effect-catalog-lens.ts` on L4's definition-module
  pattern and assembled through `src/common/editor/video-effects.js`
  (`lightscaper-4-plan.md`), each declaring `kind`, `renderers` (`cpu`
  mandatory), `domains`, and `maskable: false`, authorable and renderable from
  Framescaper in the same change; Display-P3 admitted by widening the primaries
  branch of `assertManagedVideoColorRenderAdmissionV1`
  (`video-color-management-v27.ts:400-408`) and `VideoColorOutputSpaceV1`
  (`:33`), reaching files through L5's `createPhotoExportPlan`
  (`src/common/editor/photo-export.ts`) and its output profile field, and
  through `createExportPlan` (`src/common/editor/export.js:155`) and
  `createVideoExportPlan` (`src/common/editor/video-export.js:244`) for the two
  timeline products; soft proofing renders through the selected output profile
  and back for display only.
- **Invariants:** every new operation is a shared effect under `src/common/`
  with both products' tests in the same change; an output space the platform
  cannot prove refuses visibly rather than converting silently; soft proofing
  never writes develop state; sRGB and Rec.709 encodes stay byte-identical.
- **Acceptance:** `npm test -- --shard=framescaper` runs
  `tests/framescaper-lens-correction-authoring.test.ts` proving each new effect
  authorable and renderable from Framescaper; `npm test -- --shard=lightscaper`
  runs `tests/lightscaper-lens-correction-goldens.test.ts`,
  `tests/lightscaper-wide-gamut-admission.test.ts` (Display-P3 admitted;
  BT.2020, PQ, and HLG still refused with the existing message), and
  `tests/lightscaper-soft-proof-purity.test.ts` (a soft-proof render leaves the
  project revision unchanged).
- **Non-goals:** no profile-based corrections, camera-matching profiles, or
  custom ICC output — L5 defers profiles beyond sRGB and Display P3.
- **Stop condition:** stop if a correction needs a profile database to be
  useful; that is a Blocked-on-licensing row, not a scope negotiation.

## Quality-budget and evidence duties

- Register fixtures `l7-raw-corpus-v1` (kind `digest-pinned-media`: synthetic
  plus freely licensed real raw files with byte length, SHA-256, license id) and
  `l7-deep-sample-parity-v1` (kind `deterministic-generator`, the
  gradient/chart/edge artifact shape at `config/quality-budgets.json:538-560`).
- Register workload `l7-deep-color-render-parity` with thresholds drawn from the
  closed unit list: `deepColor.exactChannelMismatches eq 0` (`count`) over the
  declared-exact set, `deepColor.maxAbsoluteChannelDelta lte` the declared
  tolerance (`ratio`), `gpu.maxAbsoluteChannelDelta lte 1e-6` (`ratio`, the
  bound proved at `tests/browser/framescaper-v27-motion-webgl2.spec.js:72`), and
  `raw.nonReproducibleDecodes eq 0` (`count`).
- Browser rows run on `github-ubuntu-playwright-1.62.1`, which is
  `qualificationEligible: false`, so they stay provisional development evidence
  and no L7 number is claimed as qualified. Any structural row on
  `portable-node-structural-26.5.0` requires extending that environment's
  enforced `eligibleWorkloadIds` allowlist (`docs/quality-budgets.md:172-175`) —
  a reviewed change, never a silent edit.
- Correctness, admission, fuzz, and golden suites run in ordinary CI; only
  timing rows need provisioned environments, and L7 declares none. `photoRaw` is
  the one capability key L7 flips (WP-L7A.1), landing its
  `config/production-capabilities.json` boolean, its `projectFeatures` inventory
  row, and its evidence paths in one change
  (`tests/production-capability-inventory.test.js:33,185-203`); threshold
  changes record old and new values, fixture, environment, raw before/after
  measurements, reason, and reviewing commit
  (`docs/quality-budgets.md:719-726`).

## Coordination rules

- L7.0 is one work stream; the three tracks open only after every L7.0
  acceptance check passes, then run file-disjoint: raw modules and the
  runtime-asset pipeline to L7A, the GPU evaluator to L7B, helper and effect
  modules to L7C.
- **A test's shard follows its basename as well as its imports.**
  `classifyNodeTestFile` matches the product name in the file name as well as
  the tree the test reaches (`scripts/lib/node-test-shards.mjs:42-48`;
  `AGENTS.md:23-27`), so a `tests/lightscaper-*` file lands in the `lightscaper`
  shard whatever it imports: the acceptance command and the file name are chosen
  together, and a test that must run in `common` is named after neither product.
- **Spine files — one owner per edit, rebase before push.** Pixel and color, all
  under `src/common/editor/`: `video-color-management-v27.ts`, the three
  `unified-exact-*-v13.ts` render modules,
  `native-rgba-frame-pack-v1-contract.ts`, `video-effects.js`,
  `visual-effect-catalog-*.ts`, `controller/task-progress.ts`. Policy and config
  under `config/`: `production-licensing-matrix.json`,
  `production-capabilities.json`, `quality-budgets.json`,
  `ffmpeg-runtime-manifest.json`, `maintainability-allowlist.json`, plus
  `THIRD_PARTY_LICENSES.md`. Tooling: `package.json` (the `audit:ci` chain at
  `:139`), `scripts/lib/ffmpeg-runtime-manifest.mjs`,
  `scripts/publish-runtime-assets.mjs`,
  `src/common/offline/ffmpeg-runtime-cache.ts`, `.github/workflows/quality.yml`,
  `desktop/helper-job-subcontract.ts`, `desktop/helper-native-job-contract.ts`.
- Schema revisions stay serialized product-wide, at most one in flight; WP-L7.0
  claims none occurs, so a packet that needs one stops.
  `THIRD_PARTY_LICENSES.md` is edited by one packet at a time and only with the
  maintainer re-stamp in hand; two concurrent notices edits invalidate the same
  digest twice.
- Stage explicit paths and confirm `git diff --cached --name-only` before each
  commit; the tree is worked by many sessions at once. `npm run check`
  (`package.json:141`) stays green on every push.

## Known constraints this plan absorbs

- **The unit clamp is load-bearing for existing renders**, not a bug to delete;
  WP-L7.1 makes it a process-version-carried range the pre-L7 goldens prove
  faithful. **The notices file is digest-bound**: WP-L7A.0 lands the pipeline
  and the licensing rows, but the notices section is a maintainer sign-off, and
  the packet's stop condition names that boundary rather than routing around it.
- **The raw decoder's license review is external**, so L7's CI-provable raw
  capability is scoped to first-party container read, preview, and baseline.
  Until that review moves the row off `blocked`, the roadmap's licensing,
  notice, and runtime-asset gate (`roadmap-lightscaper.md:453-454`) closes over
  the first-party half only, and the decoder half stands as the named blocker
  recorded in the licensing matrix — never a silent pass.
- **Browser acceptance is Chromium and WebKit in CI, and WebKit lacks OPFS,
  MediaRecorder, and IndexedDB Blob storage** (`roadmap.md:271-274`). L7 adds no
  storage-dependent browser gate; its browser gate is the GPU parity spec.
- **File-size ceilings:** 600 lines for new source, 800 for browser specs
  (`AGENTS.md:34-36`). `video-color-management-v27.ts` is already 496 lines and
  `unified-exact-render-finishing-consumers-v13.ts` 540, so both widenings
  extract focused modules rather than growing in place.
- **The Framescaper V30 still-image campaign owns still ingest**; L7 consumes
  what it lands on `main`, never forks it, and runs under the sharded `check`
  gate — `check:static` plus one Node job per shard (`AGENTS.md:21-29`).

## Watch items (not gates yet)

- Canvas wide-gamut color-space support per engine, which bounds how honest
  Display-P3 preview is before L9 qualifies real displays, and WebGPU
  availability across the CI browser matrix, which has no in-tree consumer and
  no parity precedent to inherit today.
- Upstream LibRaw releases and relicensing, which would change the selection
  recorded here — pin and review the exact selected revision rather than
  remembered terms (`docs/milestone-5-plan.md:234`) — and freely licensed raw
  corpora, whose per-file licenses bound how much real-camera coverage L7 pins
  before L9's real-camera row.

## Non-goals and fences

- No panorama stitching (Deferred) and no DNG output (Optional), neither an L7
  gate; no tethered capture, camera control, or capture schema of any kind.
- No destructive raster editing; highlight recovery, heal, and clone all
  re-render from the original. No ML denoise, super-resolution, or
  auto-settings; those stay Electron Only under the milestone-7 rules and never
  a completion dependency here.
- No patent-encumbered codec and no enlargement of the FFmpeg enabled set; the
  two blocked FFmpeg release gates stand (`docs/milestone-5-plan.md:209-216`).
  No camera-profile or lens-profile database while its row is blocked.
- No second export stack: L7 widens the three existing plan builders and adds no
  fourth — L5's `createPhotoExportPlan` (`src/common/editor/photo-export.ts`),
  `createExportPlan` (`src/common/editor/export.js:155`), and
  `createVideoExportPlan` (`src/common/editor/video-export.js:244`).
- No human, real-device, real-camera, or real-GPU evidence in any L7 gate; those
  are L9 rows by construction.
- Every new surface is menu-reached and off by default (`AGENTS.md:8-11`).
