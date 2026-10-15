# Lightscaper linear working frames

The first L7 processing slice adds a source-native linear CPU route to the
existing Current Photo renderer. It uses the unchanged PixelFrameDescriptorV1,
PixelFrameV1 and Current Develop recipe contracts. It does not widen the old
byte-rendering admission policy or reinterpret word/float bytes as RGBA8.

## Admission and delivery

`createPhotoDevelopRenderRuntimeV3().withLinearWorkingFrame()` delegates to the
shared `withImageDevelopLinearFrameV1` owner. It accepts native Uint16Array or
Float32Array samples, linear transfer and sRGB or BT.709 primaries. These two
primary declarations share the same chromaticities; their supplied declaration
is retained. Other transfer functions and primaries require later routes.

Identity, white balance and all six tone-ladder controls are implemented.
Every retained effect is admitted, including disabled effects. Unsupported
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
This does not claim a tolerance proof for the remaining deep operations.

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

## Current RAW activation and remaining processing

The original `withLinearWorkingFrame` foundation keeps its white-balance/tone
contract. The active `createPhotoDevelopRenderRuntimeCurrentV1` composition
delegates byte input to the unchanged V3 renderer and sends native linear word
or float input to `withImageDevelopLinearCurrentV1`. That Current owner adds
chroma, black-and-white mix, HSL, point/parametric curves and color wheels to
white balance and tone, using the same owned Float32 working plane. Encoded
color families use extended sRGB arithmetic without a byte quantizer between
stages. Unsupported families, geometry, masks/bindings and enabled repairs
remain explicit refusals.

The [Current RAW workflow](lightscaper-raw-decoder.md) uses the existing File
menu to retain DNG/CRW Original bytes and supply authenticated native RGBA16 to
development. Native decoder workers retire before the Float32 render starts.
Only the final thumbnail/histogram/canvas boundary transfers linear samples to
encoded RGBA8; those display bytes never feed the deep Develop stack. Save and
reload retain recipes beside the immutable Original. Byte FramePack1 remains
unchanged and does not carry deep samples. Chromium and Firefox qualify the
actual menu → import → white balance/exposure → Save/reload loop.

Deep spatial effects, geometry, LUTs, local adjustments, repair evaluation,
RAW raster export and cross-product handoff remain L7 work, alongside wide
gamut and the wider milestone exit gates. The external RAW runtime/source
publication and broader camera qualification are also pending. Lightscaper and
L7 are not complete.

No assistance runtime closure or runtime asset changes. A manual **Update AI
assets** run is not required.
