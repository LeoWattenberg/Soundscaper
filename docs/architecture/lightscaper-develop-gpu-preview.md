# Opt-in GPU Develop preview

Photo Develop's existing **Settings → Preview rendering…** menu offers **CPU**
and **GPU preferred**. CPU is the default. The choice is temporary presentation
state for the open Develop owner: it applies to proxy/Fit and Full inspection,
without changing recipes, history, presets, exported files or Original custody.
Canonical Before keeps its existing source and presentation route. Save does
not turn the preview renderer into a processing setting.

The native GPU path implements all eight Current color families: white balance,
the full tone ladder, chroma, black-and-white mix, HSL, point curves, parametric
curves and color wheels. Tone includes exposure, contrast, highlights, shadows,
whites and blacks. Each authored effect retains its order and Float32 stage
store. The recorded local software-GPU corpus qualifies these color paths and
their truthful fallback. The complete Photo Develop GPU stack remains unfinished.
Authenticated cube-LUT stages use the same native path; their recorded local
software-GPU and Firefox corpus now passes.

## Shared execution and fallback

`image-develop-gpu-current-v1.ts` admits the entire Current recipe, selected
mask overlay, resource authorities, geometry and processing limits before source
samples. The broker uses the existing native CPU engine as its whole-recipe
fallback. An unfinished stage never disappears from a GPU result.

At present, active geometry, spatial and optical effects, local masks,
repairs or a selected mask overlay select the complete CPU render.
Encoded byte sources also retain their existing CPU process and
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
balance, tone and wheels operate in native linear RGB. Tone uses the stable
affine contrast form and clamps only its regional smooth weights; wheels use
signed lift, gain and gamma. Chroma, black-and-white, HSL and curves use
continuous sign-symmetric extended-sRGB coordinates and return to linear RGB
without a byte lookup or encoded working plane. Curves share the CPU's authored
knots and parametric Q16 gain definition; master and channel compose before the
stage store. Distinct curve knots that collapse in Float32 uniforms or nonfinite
uniform slopes select CPU. Straight alpha remains exact, and hidden RGB retains
the CPU process's semantics. Final display, proofing and histogram generation
retain their existing owners.

Extension names alone do not grant support. A native upload/render/readback
probe checks signed/HDR values, negative zero, small normal samples, subnormal
copy/arithmetic and alpha. The admitted pass identities retain a private link
to the existing CPU scalar, allowing numeric admission to consult that
normative operation without duplicating its formulas.

Before consumer delivery, a bounded streaming check evaluates the existing
normative CPU scalar and rounds once per authored effect. Alpha, signed zeros,
expected RGB magnitudes below `2^-60` and final unchanged native components must
match exactly. Other finite normal results permit at most eight Float32 ULPs;
no absolute epsilon can erase a signal. A mismatch retires GPU resources before
the complete CPU fallback. The check allocates no expected-result image plane.
It currently also evaluates CPU color work, so this packet makes no speed claim.

Some tested drivers flush subnormal arithmetic. Affected source or intermediate
profiles take the CPU path. Nonlinear near-zero and ill-conditioned cancellation
profiles also fall back conservatively. The contrast-pivot witness at
Float32(.135) and contrast 100 retains a nonzero CPU result of approximately
2.1457672e-8; returning GPU zero is not accepted as equivalent. Float32 rounding
of derived identity-curve knots can also drift an otherwise unchanged native
channel. Even a two-ULP difference then selects CPU: the eight-ULP allowance
does not apply to an unchanged component. Readback is never patched with CPU
samples to manufacture conformance. This result contract is not a universal
shader-accuracy or capability claim over every finite control and sample.

## Authenticated cube LUTs

The Original snapshot finishes before the first asynchronous resource read.
Closed LUT references bind their SHA-256, byte length, lattice size and input
domain. Every unique body passes the existing parser and those complete identity
checks before GL opens. Reads are sequential, with no nested repository borrows;
the source method and receiver are pinned before awaits. Repeated authored
references share one private table without changing effect order.

Each authenticated table is copied into private Float64 storage for the
normative CPU sampler. The Float32 RGBA upload bank is separate and cannot
become that oracle: rounding two lattice endpoints can erase a real interpolated
signal. The shader uses eight explicit nearest texel reads and the CPU's
red-fastest, B→G→R difference-form interpolation. Only declared input-domain
coordinates clamp. Signed/HDR output remains unclipped, each authored stage
stores Float32, and straight alpha remains exact. Float32-collapsed domains or
nonfinite uploads select whole CPU processing after body authentication.
The texture operations follow the [WebGL2 specification](https://registry.khronos.org/webgl/specs/2.0/)
and its [float render-target extension](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/).

One reusable RGBA32F 3D texture and one host upload bank use the largest selected
lattice; smaller passes read only their declared lattice extent. The LUT shader
variant requires 143 fragment-uniform vectors. The existing eight-ULP and exact
component guards apply unchanged to the private Double oracle. Numerical or
capability refusal retires the resource and GL scopes before whole CPU fallback.
That CPU phase can read LUT bytes again through the same pinned source method
and complete SHA-bound reference; the Original is never reopened. Authentication,
opaque operation, cancellation and cleanup failures remain fatal and never
trigger replay.

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

Active extended color or LUT passes also reserve 4096 bytes for bounded uniform
staging. One reusable Float32 bank holds the band controls and curve points;
the streamed scalar comparison introduces no additional image plane or
pixel-bearing rank scratch. Capability probing retains its separate fixed
reserve.

LUT planning charges the sum of unique Float64 RGB tables, one maximum-size
Float32 RGBA upload bank and one matching 3D texture. A 65³ table costs
6,591,000 oracle bytes and 4,394,000 bytes each for upload and texture storage.
The separate capture phase charges the retained Double prefix including the
current table, a 128-MiB parser/transient reserve, the full 16-MiB admitted
borrowed backing and the reference's raw snapshot byte length. Padding outside
an authenticated source view therefore cannot hide physical source cost. The
ceiling stays 768 MiB; an oversized valid set selects whole CPU before GPU I/O.
These scalar reserves are not an exact JavaScript-engine or driver heap bound.
Existing parser text and frozen numeric scratch are released without a claim
that their physical memory can be wiped. The new mutable Double snapshots and
upload bank have explicit wipe ownership.

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
Private Double tables retire before the final GPU consumer. The GL texture and
host upload bank stay owned through that joined consumer; retirement wipes the
bank and clears every layer of the maximum-size cube before deleting its handle
when the context still accepts commands.

## Qualification and remaining scope

Focused tests cover native uniform authority, complete metadata admission,
immutable source capture, whole CPU parity for mixed recipes, projected mask
coverage, resource failures, cancellation and joined cleanup. Native browser
qualification compares actual RGBA32F readback with independent color literals
and the CPU oracle, including per-family positive GPU cases and deliberate
whole-CPU numerical refusals. Every family and the authored mixed stack require
accepted GPU delivery for their positive corpus. Byte-preview tolerances are
not reused as its native Float32
precision contract.

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
opt-out. Local qualification passed all 48 software-GPU cases across six specs,
including six coverage-enabled English/German menu workflows, and all 48 Firefox
compatibility cases. Compaction retained 116 scripts and maps with exact pins
for 16 processing and presentation source owners. Mandatory positive software-GPU
literals prove accepted native color/LUT delivery; numerical-refusal witnesses
require exact whole-CPU output. The all-color RAW workflow retains its explicit
precision-refusal witness, while the RAW LUT workflow proves accepted LUT preview
with unchanged Original and resource custody. Observed GL work alone does not
prove accepted GPU delivery. These local results do not establish hosted CI
success or a coverage-floor pass; no local floor tightening is claimed.

The recorded local color/LUT software-GPU and Firefox corpus passed. Hosted CI
execution remains pending; a configured gate is not a hosted success.
Geometry, all spatial and
optical families, complete mask graphs and overlay projection, Original-space
Clone and genuine screened-Poisson Heal still need GPU implementations and
combined conformance. Until each is qualified, its recipe keeps the complete
CPU route. Full-stack GPU parity, native desktop services, the broader L7/L8/L9
exit gates and final inter-slice QA remain open.

This work changes no assistance engine or native decoder runtime closure.
No manual **Update AI assets** run is required.
