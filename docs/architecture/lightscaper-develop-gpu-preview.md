# Opt-in GPU Develop preview

Photo Develop's existing **Settings → Preview rendering…** menu offers **CPU**
and **GPU preferred**. CPU is the default. The choice is temporary presentation
state for the open Develop owner: it applies to proxy/Fit and Full inspection,
without changing recipes, history, presets, exported files or Original custody.
Canonical Before keeps its existing source and presentation route. Save does
not turn the preview renderer into a processing setting.

The first native GPU implementation evaluates white balance and the complete
tone ladder. Tone includes exposure, contrast, highlights, shadows, whites and
blacks in authored order. This is an initial GPU execution packet; the complete
Photo Develop GPU stack remains unfinished.

## Shared execution and fallback

`image-develop-gpu-current-v1.ts` admits the entire Current recipe, selected
mask overlay, resource authorities, geometry and processing limits before source
samples. The broker uses the existing native CPU engine as its whole-recipe
fallback. An unfinished stage never disappears from a GPU result.

At present, active geometry, other color families, LUTs, spatial and optical
effects, local masks, repairs or a selected mask overlay select the complete
CPU render. Encoded byte sources also retain their existing CPU process and
per-stage byte quantization. They are not implicitly promoted into the native
Float32 process to obtain GPU execution.

GPU preferred can also choose CPU because WebGL2, float render targets, texture
capacity, the admitted numeric profile or the working set is unavailable.
Metadata failures, missing resource authority, corrupt bodies, cancellation
and retirement failures remain errors. They are not capability refusals and
cannot cause a second attempt to deliver a consumer result.

The additive `withGpuPreview` runtime method serves presentation only. Existing
`withProxy`, `withFullResolution` and export methods retain their CPU behavior.
The Current presentation owner captures the chosen method and receiver for its
generation; switching policy joins the retired presentation before replacement.
RAW source-mode authentication and generated HDR Original authentication remain
upstream of this choice. Presentation caches do not become Develop input.

## Native samples and capability

The shared host accepts native linear sRGB/BT.709 UNORM16 or Float32 frames.
UNORM16 normalizes by 65535 into a privately owned Float32 snapshot. Float32
input retains signed/HDR samples. Source metadata and samples are captured
before the first asynchronous context-loading boundary; later caller mutation
cannot replace the admitted frame. Proxy mode first samples the existing
same-format native proxy grid, then evaluates the unchanged recipe on that grid.

The optional context owner uses two RGBA32F textures with nearest sampling and
integer `texelFetch`. Each authored operation writes a Float32 stage. White
balance multiplies native RGB gains. Tone uses the stable affine contrast form
and clamps only its regional smooth weights. Working RGB has no byte table,
transfer encoding or gamut clip; straight alpha passes through unchanged.
Final display, proofing and histogram generation retain their existing owners.

Extension names alone do not grant support. A native upload/render/readback
probe checks signed/HDR values, negative zero, small normal samples, subnormal
copy/arithmetic and alpha. The admitted pass identities retain a private link
to the existing CPU scalar, allowing numeric admission to consult that
normative operation without duplicating its formulas.

Some tested drivers flush subnormal arithmetic. Affected source or intermediate
profiles take the CPU path; an absolute-error allowance does not erase their
signal. Nonlinear near-zero and ill-conditioned cancellation profiles also
fall back conservatively. The contrast-pivot witness at Float32(.135) and
contrast 100 retains a nonzero CPU result of approximately 2.1457672e-8; returning
GPU zero is not accepted as equivalent. These guards do not constitute a
universal GPU accuracy proof over every finite control and sample.

## Working set and retirement

The Current preview working ceiling remains 768 MiB. Admission charges the full
physical borrowed backing, including padding outside a valid source view.
Native GPU execution overlaps that backing with one Float32 host capture, two
RGBA32F textures and one Float32 readback. Presentation planning also reserves
a full RGBA8 conversion plus a bounded fitted presentation allowance beside the
live native working set. Histogram and display conversions can run sequentially;
this is a conservative reserve, not a claim that both byte planes remain live
together. It charges 4 bytes per output pixel plus 4 bytes per fitted pixel,
with the fitted allowance capped at 4,194,304 pixels.

GPU and CPU fallback have separate phase plans. Proxy admission chooses once
using the actual physical Original backing before allocating its private proxy.
If GPU preferred cannot fit beside that backing but the complete CPU phase can,
it directly selects CPU. A combination that cannot fit either phase refuses.
No generic RangeError catch reopens the source, and the existing byte, native
frame and Original limits are unchanged. Maximum accepted image dimensions do
not promise that every GPU working set fits.

Bounded numeric scans yield to cancellation. Queued GPU work uses a fence and
zero-timeout polls with task yields before readback; context loss is checked at
execution boundaries. Scoped consumers join before host planes retire. Opaque
primary errors retain their identity, and distinct cleanup failures remain
observable. A delivered consumer is never retried through CPU fallback.

The context owner clears application-visible textures where the context still
accepts commands, deletes its handles, requests context loss when available and
zeros canvas backing dimensions. Captured host samples, probe arrays and readback storage
have physical wipe ownership. Deleting GL resources does not certify erasure
of driver-private GPU memory; a lost context cannot accept overwrite commands.

## Qualification and remaining scope

Focused tests cover native uniform authority, complete metadata admission,
immutable source capture, whole CPU parity for mixed recipes, projected mask
coverage, resource failures, cancellation and joined cleanup. Native browser
tests compare actual RGBA32F readback with independent WB/tone literals and the
CPU oracle for the recorded finite corpus. Byte-preview tolerances are not
reused as a native Float32 precision contract.

The dedicated [software-GPU configuration](../../playwright.lightscaper-gpu.config.mjs)
runs the native Float32 corpus and English/German Photo menu workflows through
Chromium with required SwiftShader renderer and readback observations.
[Quality](../../.github/workflows/quality.yml) and
[Desktop Preview](../../.github/workflows/desktop-preview.yml) declare dedicated
jobs using the existing digest-pinned Playwright 1.62.1 container. Both authenticate
the downloaded Lightscaper build and source maps before running the project;
their coverage dependencies make a failed GPU job block distribution.

The English/German software-GPU UI workflows collect built-site coverage.
Both jobs require compaction and upload of the distinct
`coverage-shard-browser-chromium-lightscaper-gpu` artifact into the existing
coverage union. Lower-level realtime cases retain their explicit coverage
opt-out. Local coverage-enabled UI qualification records actual Float32
readback and execution of all four new GPU owners; it does not establish a
hosted CI result or a coverage-floor pass, and no local floor tightening is
claimed.

The actual local software-GPU project has passed. Hosted CI execution remains
pending; the configured gate is not a report of a hosted success. This baseline
qualifies the recorded WB/tone subset and its truthful fallback behavior.
Full native color/curves/wheels, verified LUTs, geometry, all spatial and optical
families, complete mask graphs and overlay projection, Original-space Clone
and genuine screened-Poisson Heal still need GPU implementations and combined
conformance. Until each is qualified, its recipe keeps the complete CPU route.
Full-stack GPU parity and the broader L7 exit gates remain open.

This work changes no assistance engine or native decoder runtime closure.
No manual **Update AI assets** run is required.
