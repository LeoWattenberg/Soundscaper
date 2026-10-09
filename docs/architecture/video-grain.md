# Shared deterministic Grain

Frame and Photo Develop expose Grain through their existing opt-in effect menus.
Both persist the closed `grain-v1` recipe and evaluate
`srgb-natural-output-grain-q8-v1`, native shader code 31, in authored order.
Older effect processes and their bytes remain unchanged. Native browser
execution and maximum-profile latency and memory qualification are separate gates.

The four finite controls are Amount (0–100, default 0), Size (1–8, default 1),
Roughness (0–100, default 50), and integer Seed (0–65520, default 0). Disabled
recipes receive the same closed validation. Amount and Roughness use JavaScript
`Math.round(value * 256 / 100)`; Size uses `Math.round(value * 256)`, including
IEEE intermediate rounding. Amount zero is exact identity.

The process reads straight UNORM8 encoded sRGB at the current natural-output
pixel centers. Crop and other geometry therefore change the coordinates seen
by later Grain stages. Coordinates do not depend on viewport size, playback
time or a random source. Size spaces a seeded triangular lattice; each pixel
bilinearly interpolates four lattice values. A second octave at half Size is
blended by Roughness. Every signed mean rounds to nearest with half ties toward
positive infinity. The same Seed and ordered recipe reproduce the same bytes.

Original encoded luma is `floor((54R + 183G + 19B + 128) / 256)`. Its symmetric
midtone response, `2 * min(luma, 255-luma)`, scales the signed noise and Amount
into one common RGB offset, bounded by 32 bytes. Each channel receives that
offset before explicit gamut clipping to 0–255. This process deliberately has
common RGB noise and a midtone envelope. Alpha is copied exactly; zero-alpha
centers retain their hidden RGB.

CPU, GLSL and GEQ share integer quantization and lattice arithmetic. For the
admitted coordinates 0–65535, the unsigned center numerator is at most
4,294,934,528. Half-Size is at least 128, so cell plus one is at most 131072.
The linear hash sum is at most 42,398,709; after reduction modulo 65521,
`h*h + 31*h + 17` is at most 4,294,901,537. Every unsigned product and sum fits
32 bits without wrapping. Signed bilinear, octave and midtone numerators also
have explicit bounds in the owning module. GLSL uses highp integer operations,
rather than Float32 multiplication for large coordinates.

The scoped CPU kernel owns one detached source snapshot and one output,
checks captured native cancellation, and joins processing yields and its
consumer before wiping both backings. Each Frame or fixed Photo stage replaces
and wipes its predecessor. Preview plans contain only the bounded numeric
recipe. There are no retained image-sized noise planes or per-pass lookup tables.
FFmpeg authenticates the exact private compiled operation and transports
original alpha around the RGB conversion through output-scoped split/merge
labels. Repeated and mixed stages retain their own original stage inputs.

Independent BigInt and literal PNG references qualify signed lattice results,
seed/size/roughness endpoints, all 256 alpha values and complete histogram bins.
Actual pinned FFmpeg, production selected finishing and the picture encoder
check ordered Grain/curve composition and explicit pre-encode bytes. Mounted
English and German authoring checks durable recipes and original custody.
Native source witnesses are maintained separately and have not yet run for
this packet. No assistance runtime source pins, engine closure or asset
publication changes are required; a manual **Update AI assets** run is not needed.
