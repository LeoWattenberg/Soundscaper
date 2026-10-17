# Shared color grading wheels

Framescaper's existing effect picker and Lightscaper's opted-in Develop
adjustment picker expose `color-wheels-v1`. Each contains a two-dimensional
wheel for shadows, midtones and highlights, with keyboard hue/saturation
changes, exact numeric hue/saturation/luminance fields and a wheel reset.
The existing gesture owners retain preview, cancellation and durable history.

The persisted recipe contains nine finite numbers. Hue is −180 through 180
degrees, saturation 0 through 100 percent, and luminance −100 through 100
percent. The normalizer refuses unknown fields and accessors, detaches inputs,
and canonicalizes negative zero. Existing effect order, alpha, disabled
effects, catalog/photo schemas and process-1 settings remain unchanged.

## Numerical process

The explicit process is `srgb-scalar-lgg-wheels-v1`. The wheels overlap: shadows
control lift, midtones control gamma, and highlights control gain, rather than
selecting three exclusive tonal bands. Each hue uses the six linear HSV
primary/secondary knots. Subtracting Rec.709 luminance from that RGB vector
produces the zero-luma chroma offset `c`, scaled by saturation. The existing
closed GradeV1 numeric model carries these triples:

- `lift = 0.25 × (shadow luminance / 100 + c)`
- `gamma = 2^(midtone luminance / 100 + c)`
- `gain = 2^(highlight luminance / 100 + c)`

Each straight encoded sRGB byte decodes to linear Rec.709, evaluates
`max(0, linear + lift) × gain` raised to `1 / gamma`, clips to 0–1, encodes sRGB,
and quantizes with `floor(encoded × 255 + 0.5)`. Alpha is untouched, including
hidden RGB at zero alpha on a color-only route.

Legacy GradeV1 retains its original multichannel luminance recombination.
Floating-point cancellation there can change a half-byte boundary. For the
legal highlight luminance values −9.310940439148165 and 8.74628412503394,
the independent mixed-RGB goldens retain legacy red values 7 and 8, while the
new scalar wheel process yields 8 and 9. No legacy evaluator or byte is changed.

## Ownership and evidence

CPU admission retains immutable recipes and derives only the current stage's
private one-KiB byte table, retiring it before the next stage and before output
delivery. Preview planning retains only privately branded scalar recipes.
The shared GPU resource derives and wipes one upload copy; the wheel adapter
also authenticates a still-live recipe on cached use. FFmpeg receives balanced,
depth-eight allowlisted byte expressions from the same scalar authority.
No authored or persisted LUT is introduced.

Strict tests cover all 256 scalar/table inputs, literal primaries and gray
goldens, alpha, ordered stacks, reentry, held output settlement, cleanup,
native upload retry and released identities. Mounted tests use the actual
Framescaper gesture service and EN/DE Photo Session saves. Pinned WASM GEQ
and the owning selected-finishing/picture-encoder pipeline execute the recipe.
Native browser, product chunk and broader integration qualification remain
separate gates; this slice does not complete the Develop milestone.
