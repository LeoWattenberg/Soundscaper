# Callback-scoped managed SDR frames

This shared foundation renders the existing numeric `VideoColorGradeV1` schema:
exposure, contrast and pivot, per-channel lift/gamma/gain, and saturation. It
requires `lut: null`; the existing Frame LUT renderer remains responsible for
its already supported grades. No new persisted effect or photo develop recipe
is introduced. Frame authoring stays behind **Effect > Video finishing >
Grading and presets**, using the existing grading document and command owner.

## Budgets recorded before implementation

One invocation admits at most 64 grades and 64 KiB of normalized numeric grade
JSON. Each normalized null-LUT grade has 119 fixed JSON bytes plus 13 numeric
values; allowing 25 bytes per finite ECMAScript number gives 444 bytes per grade
and 28,481 bytes for all 64 grades including array punctuation. The 64 KiB bound
therefore admits every legal numeric stack. Input and output are tightly packed
straight-alpha UNORM8 RGBA. The
caller supplies explicit pixel limits; the Frame bridge uses its existing
33,554,432-pixel / 128 MiB visual-frame ceiling. A future photo caller must
supply its own tighter source and output limits.

The grade phase borrows the input bytes `N`, owns one output of `N` bytes, and
owns at most one 261,888-byte transformed chunk plus the existing byte kernel's
256-byte ungraded transfer lookup. Borrowed chunk views share the input buffer.
The combined pixel-backing grade phase is `2N + 256 KiB`, at most 256.25 MiB for the
Frame bridge, excluding decoder, masks and existing composition buffers.

Frame placement consumes the temporary grade output while creating the existing
Float64 RGBA placement buffer, whose backing is `8N` at matching geometry.
That phase is `10N + 256 KiB`, at most 1280.25 MiB at the existing maximum,
before other composition buffers. This is a phase accounting statement, not a
claim that the complete Frame renderer has that working-set ceiling. The new
kernel adds only its bounded chunk to the existing grade/placement phase.

## Admission and ownership

`withManagedSdrPixelFrameV1(request, consume, { limits })` snapshots a closed
request and grade stack, admits the declared profile and geometry before reading
pixels, and delegates grade preparation and every pixel transform to the
existing managed SDR byte kernel. File samples must agree with their explicit
source interpretation. Canvas readback is encoded sRGB; linear samples are
linear Rec.709/D65. Unsupported depth, wide color, HDR, mismatched declarations,
unknown fields, accessors and malformed grades refuse without conversion.

The input is borrowed and must remain fixed and unchanged until the invocation
settles. The callback borrows the output only until its returned promise settles;
it must copy any pixels it needs afterward. The kernel wipes output and chunk
bytes on success, cancellation and failure, including callback failures. It
yields a real timer task between chunks, so externally delivered cancellation
can interrupt a large frame. The Frame bridge places the borrowed result inside
the callback and returns only its independently owned composition buffer after
the grade acknowledges success. If cancellation arrives after placement but
before acknowledgement, the bridge also wipes that unpublished composition.

## Evidence and scope

Focused tests pin independently calculated output bytes, straight alpha, grade
ordering, disabled Frame presentations, default and authored Frame menu/command
behavior, cancellation, callback lifetime, malformed/profile refusal and
determinism. Existing synchronous Frame helpers and existing LUT routes keep
their current APIs and semantics. The selected exact Frame execution calls the
new bridge for eligible numeric grades. Existing LUT, oversized and nonintrinsic
Frame buffers explicitly retain the old route; its existing allocation and
render semantics are not covered by the new kernel's bound. Photo persistence,
photo preview identity and L4
application composition remain separate work.
