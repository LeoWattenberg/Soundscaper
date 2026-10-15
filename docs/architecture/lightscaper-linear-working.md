# Lightscaper linear working frames

The Current Photo renderer evaluates the develop stack from native linear
word or float samples. It uses the unchanged PixelFrameDescriptorV1,
PixelFrameV1 and Current Develop recipe contracts. The original white-balance
and tone foundation remains a separate fixed API. Existing byte renderers and
their admission policies remain unchanged.

## Admission and delivery

`createPhotoDevelopRenderRuntimeV3().withLinearWorkingFrame()` retains the
shared `withImageDevelopLinearFrameV1` foundation. It accepts native Uint16Array or
Float32Array samples, linear transfer and sRGB or BT.709 primaries. These two
primary declarations share the same chromaticities; their supplied declaration
is retained. Other transfer functions and primaries require later routes.

That fixed foundation supports identity, white balance and all six tone-ladder
controls. Every retained effect is admitted, including disabled effects. Other
families, geometry, masks, bindings and nonempty repair lists refuse before
source samples are inspected. This is an explicit processing foundation,
not an alternate byte fallback for an unsupported deep stack.

Delivery borrows one native Float32 linear RGBA plane. Uint16 values normalize
directly by 65535; Float32 source bits copy directly from the exact admitted
span. No transfer curve, byte lookup or integer quantizer intervenes. The
complete source snapshot finishes synchronously before an asynchronous stage
can yield. The same allocation then holds the working state and output.

## Arithmetic and precision

White balance uses the existing normalized temperature/tint gains directly in
linear RGB. Exposure and contrast use the stable affine expression
`sample * exposureGain * contrastGain + 0.18 * (1 - contrastGain)`.
Subtracting and re-adding the pivot first would erase very small float values
even with neutral contrast; normal and subnormal regressions pin that case.

Highlights, shadows, whites and blacks use the existing smooth region weights
and coefficients. Only region weights clamp to their domains. The working RGB
signal remains signed and can exceed one; straight alpha is preserved. Every
effect writes into actual Float32 storage, so stage rounding is explicit.
Results outside finite Float32 range refuse before consumer delivery.

The existing 8-bit process remains the exact conformance baseline. Tests
compare independently presented linear results with that process where its
intermediate clipping does not alter the recipe. Extended-range linear
processing deliberately retains information that a byte stage would clip.
Family-specific tests distinguish continuous results from intermediate byte
clipping; a universal tolerance bound for arbitrary stacks is not claimed.

## Bounds and ownership

The Photo linear profile admits up to 8192 pixels per side and 16,777,216
pixels, with 268,435,456 bytes per source or rendered plane. Before samples are
read, the shared owner plans the native source and sixteen-byte-per-pixel
output and charges their combined declared size against 512 MiB.

Native cancellation checks bound effect work in chunks. A pending consumer is
joined before output retirement. The owner pins the allocation, offset and
length independently of borrowed view properties and wipes its physical bytes
on success or failure. A transferred output cannot certify retirement and
therefore refuses; a distinct consumer failure and retirement failure both
survive, with the exact consumer failure first. Caller source storage remains
unchanged. No working plane enters the catalog or history.

## Current multistage processing

The active `createPhotoDevelopRenderRuntimeCurrentV1` composition delegates
byte input to the unchanged V3 renderer and sends native linear word or float
input to `withImageDevelopLinearCurrentV1`. Its complete recipe and resource
plan finishes before source pixels are read. Disabled stages still undergo
closed metadata admission. The execution order is:

1. Clone and screened-Poisson Heal in Original coordinates, with every donor
   and Heal boundary sampled from the immutable normalized Original.
2. Any legacy top-level crop, rotation and flips.
3. Effects in authored order, including geometry at its actual stack position.

The color stages include white balance, the full tone ladder, saturation and
vibrance, black-and-white mix, HSL, point and parametric curves, color wheels,
and the authenticated cube-LUT profile. White balance, tone, wheels and the
managed LUT grade operate in linear RGB. The encoded-domain color families
use sign-symmetric extended sRGB transfer, continuous arithmetic and an inverse
transfer. No byte lookup or byte working plane intervenes. Curves evaluate
authored segments directly and extrapolate their endpoint segments; parametric
curve gains retain their authored Q16 definition. Neutral stages and unchanged
channels avoid transfer round trips.

Geometry reuses the admitted crop, perspective, rotation and flip plan. Its
Float32 kernel filters premultiplied linear RGB and alpha, restores straight
RGB, extends crop edges and leaves rotated corners transparent. The seven
spatial families have native Float32 stages: post-crop vignette, clarity,
noise reduction, grain, texture, dehaze and detail sharpening. They retain their
authored encoded-domain formulas with continuous RGB and neighborhood means.
Existing Q8 controls, deterministic grain lattice and vignette shape weights
remain explicit. Neighborhoods read one immutable stage input; output does not
feed subsequent taps in that stage. These kernels use caller-owned destination
planes and no frame-sized spatial scratch.

LUT bodies pass the existing digest, byte length, lattice geometry and parser
authentication before any destination write. Native managed exposure,
contrast, lift/gain/gamma and saturation precede red-fastest trilinear sampling.
The LUT's declared input domain clamps sampling coordinates. Its output and
the managed grade retain signed/HDR values; they are not clipped to display
range. Every completed stage rounds into finite Float32 storage.

## Native local adjustments and repair UI

Procedural, luminance-range, color-range and authenticated brush masks use the
shared graph calculations. Only coverage uses the existing byte mask planes.
Luminance and color selection sample the incoming Float32 adjustment stage
directly, without an RGBA8 proxy. Adjustments blend in linear RGB and retain
source alpha. Named and composed graphs keep their existing recipe and body
authority. Factoring the shared coverage generator preserves the permanent
byte wrapper's profile and mathematics.

An explicitly selected mask/effect pair can observe that incoming coverage.
Remaining geometry projects it into final output coordinates. Color/grayscale
overlay presentation starts off and remains temporary UI state; neither the
overlay nor its display mode enters Source, history or the catalog.

The Current Develop Settings menu opens the shared repair editor explicitly.
Its native-depth Original preview and local Clone/Heal changes remain scoped
until Apply updates the draft. Save performs the existing recipe/history
command. Cancel and Close join accepted preview work and discard the local
edit. The permanent legacy repair wrapper keeps its byte contract.

## Multistage bounds and retirement

The fixed foundation's combined source/output limit remains 512 MiB. The new
Current multistage owner has a separate 768 MiB aggregate working budget. Its
scalar plan charges the borrowed native source, at most two live Float32 stage
planes, mask and projected coverage, resource residency, repair scratch and
display work before pixels or resource bodies are acquired. Replaced stage
planes retire immediately; stages and resource borrows run serially.
Native plane admission also charges the borrowed source's full underlying
fixed backing, including padding outside a valid view, before private frame
allocation. A small admitted span cannot hide a larger physical source cost.

Each active LUT charges twice its declared byte length plus a conservative
128 MiB parser/transient reserve. This is a planning reserve, not an exact
bound on JavaScript engine string or array overhead. Oversized combinations of
natural geometry, masks, resources and scratch refuse before sample access;
admitting a per-plane extent does not promise that every stack at that extent
fits the aggregate budget. Shared kernel admission requires dedicated fixed,
nonshared native planes, distinct input/output backings and exact scratch.

Cancellation is checked at task yields. The owner joins rendering, resource
callbacks and the final consumer before physical retirement. It pins allocation
geometry independently of delivered views, wipes all owned planes on either
outcome, and preserves a primary failure together with distinct cleanup
failures. Working pixels, coverage and scratch are never persisted.

## RAW activation and remaining work

The [Current RAW workflow](lightscaper-raw-decoder.md) uses the existing File
menu to retain DNG/CRW Original bytes and supply authenticated native RGBA16 to
development. Native decoder workers retire before the Float32 render starts.
Only the final thumbnail/histogram/canvas boundary transfers linear samples to
encoded RGBA8; those display bytes never feed the deep Develop stack. Save and
reload retain recipes beside the immutable Original. Byte FramePack1 remains
unchanged and does not carry deep samples. The earlier Chromium and Firefox
qualification covers the actual menu → import → white balance/exposure →
Save/reload loop. Qualification of the expanded multistage workflow is in
progress; this document does not claim its final suite or browser result.

RAW raster export, cross-product RAW handoff and RAW-specific culling remain
pending. Highlight recovery, wider primaries/output, soft proofing, GPU/native
execution, lens/camera profiles and HDR merge are separate unfinished work.
External RAW runtime/source publication, broader camera qualification, the
remaining L3–L6 gates, L7 exit, desktop L8 and owner-QA L9 remain open.

No assistance runtime closure changes. A manual **Update AI assets** run is
not required. RAW corresponding-source packaging remains part of the decoder's
separate reproduction and publication workflow.
