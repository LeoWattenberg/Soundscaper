# Shared RGB noise reduction

This foundation advances the missing noise-reduction operation in Lightscaper
L4. The versioned process is `srgb-alpha-bilateral-ycocg-noise-q8-v1` and its
effect type is `noise-reduction-v1`. Its reserved shared GPU code is 30.
Registration, Frame/Photo authoring and native qualification are still pending;
this document does not declare that vertical slice complete. The existing
gray-frame temporal denoiser and older effect recipes remain unchanged.

The process admits straight UNORM8 encoded sRGB. It has six finite controls,
all between 0 and 100: luminance (default 0), luminance detail (50), luminance
contrast (0), color (0), color detail (50), and color smoothness (50). Each is
quantized to Q8 with JavaScript `Math.round(value * 256 / 100)`, including its
IEEE intermediate rounding. Controls are validated even
when the effect is disabled. Both zero strengths give exact identity.

The controls distinguish luminance noise, color speckling, detail preservation,
contrast preservation and chroma smoothness using the familiar
[Adobe detail vocabulary](https://helpx.adobe.com/ie/lightroom/web/edit-photos/apply-effects/adjust-details.html).
This is the application's own explicit process, with no claim of Adobe pixel
parity.

The integer color basis uses the reversible lifting equations described in
[Malvar, Sullivan and Srinivasan's color-transform paper](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/2008_ColorTransforms_MalvarSullivanSrinivasan.pdf),
equation 8:

```text
Co = R - B
t  = B + floor(Co / 2)
Cg = G - t
Y  = t + floor(Cg / 2)

t = Y - floor(Cg / 2)
B = t - floor(Co / 2)
R = Co + B
G = Cg + t
```

Luma reduction uses a replicated-edge 3 by 3 binomial neighborhood with
weights `[1,2,1]` in each direction. Each weight is multiplied by original
alpha and `max(0,16-floor(abs(neighborY-centerY)*detailQ8/256))`. The weighted
mean is rounded first. Contrast protection is the rounded fraction
`contrastQ8 * (maximumVisibleY-minimumVisibleY) / 255`; it reduces the Q8
luminance strength before blending the mean with the original Y.

Color reduction averages original Co and Cg using the same alpha and a shared
range weight based on the larger chroma distance. Smoothness blends the 3 by 3
binomial support, normalized to sum 256, with the 5 by 5 binomial
`[1,4,6,4,1]` support. Every blended spatial weight is rounded before the
chroma accumulation. The two strengths always read the same original stage
input. Color-only processing preserves the reversible Y coordinate until
explicit final RGB gamut clipping; it does not filter an already modified
luma image.

All signed means and Q8 blends use nearest rounding with half ties toward
positive infinity. The inverse clamps RGB to 0 through 255. Original alpha
is copied exactly, and centers with zero alpha retain their hidden RGB.
CPU, GLSL and GEQ specify the same integer operations. Chroma spatial weights
sum to at most 268; weights are at most 1,093,440 and every signed mean
numerator stays below 559 million, within GLSL signed 32-bit arithmetic.

The CPU kernel detaches settings and source bytes before yielding, owns one
immutable input snapshot and one output, and retains both until its consumer
settles. It yields after each 256 KiB of output and checks captured native
cancellation. Both backings are wiped on success or refusal, including second
allocation failure. No image-sized color planes, masks or caches are retained.
FFmpeg authenticates the compiled operation and uses the shared original-alpha
transport; it does not rely on RGBA-to-GBRAP conversion to preserve alpha.

Focused literal goldens, scoped cleanup/cancellation tests and actual pinned
FFmpeg comparisons qualify this foundation. GPU execution, production picture
export, persisted menu authoring and maximum-profile memory/latency remain
separate pending checks. There are no runtime source-pin, engine closure or
asset-publication changes; a manual **Update AI assets** run is not required.
