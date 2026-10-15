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

## Existing consumers and remaining activation

Current byte presentation accepts the known optional linear runtime method
while retaining only its existing two byte methods. It does not invoke or
inspect the unused callable. Accessors, non-functions and unrelated children
remain invalid. Permanent legacy2 presentation retains its two-method contract.
The new allocation, arithmetic and flat profile contract remain in the existing
optional Develop recipe chunk, outside eager catalog startup.

Current Photo Original decoding and Frame canonical packs still produce RGBA8.
Native deep ingestion, the rest of the Develop stack, geometry, masks, repairs,
display/output conversion, RAW decoding and wide-gamut support remain L7 work.
No new UI control is introduced by this backend slice; eventual RAW activation
must use the existing menu-owned import/develop paths.

No assistance runtime closure or runtime asset changes. A manual **Update AI
assets** run is not required.
