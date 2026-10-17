# Shared post-crop vignette

The opt-in Frame effect rack and Photo Develop adjustment menu author
`post-crop-vignette-v1`. Its `srgb-natural-output-vignette-q8-v1` process works
on straight encoded-sRGB RGBA8 at the current ordered stage's natural size.
The legacy `vignette` recipe, shader code 3, and FFmpeg mapping keep their bytes.

Five finite numeric controls are persisted: signed Amount and Roundness from
−100 to 100, and Midpoint, Feather, and Highlights from 0 to 100. Amount mixes
toward black or white. Highlights protects the original pixel's maximum RGB
channel while darkening; brightening ignores protection. Alpha is copied
exactly, including all 256 values. Zero-alpha centers keep hidden RGB unchanged.

Pixel centers quantize to signed Q8 coordinates with ties toward positive
infinity. Roundness blends the rectangular ellipse toward a square for negative
values or a shortest-side circle for positive values. Circle coordinates clamp
to ±512 and squared radius caps at 131072 before interpolation, keeping extreme
aspect ratios bounded. Midpoint and Feather quantize to Q16; Feather zero is a
one-unit hard edge. Integer smoothstep and the final signed byte mix round ties
toward positive infinity. CPU, code-28 highp integer GLSL, and ten-register GEQ
use this same numerical process. No persisted LUT or full-frame mask is created.

The scoped CPU owner holds one detached output and wipes its captured backing
after the consumer settles, including cancellation and failure. Frame and Photo
prepare only the current ordered stage. Photo uses natural geometry output;
Frame preserves its explicit delivery geometry. Crop followed by vignette
therefore differs from vignette followed by crop. The FFmpeg graph carries
original alpha separately through RGB plane conversion and final publication.

Independent literal pixels, a BigInt spatial reference, every alpha byte,
mounted EN/DE authoring, real Session persistence, and pinned FFmpeg/picture
encoding cover the owning paths. Maintained native shader and Photo menu
witnesses require separate browser qualification. This UI and host JavaScript
slice leaves the assistance runtime closure unchanged and requires no manual
**Update AI assets** run.
