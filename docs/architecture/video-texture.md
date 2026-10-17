# Shared Texture process

Frame and Photo Develop offer Texture through their existing opt-in effect
menus. Both persist `texture-v1` and evaluate
`srgb-alpha-binomial3-5-luma-texture-q8-v1`, native shader code 32, in authored
order. This is a new medium-frequency contrast process; older sharpen, Clarity,
Grain and other effect recipes retain their existing bytes and behavior.

The finite Amount control spans -100 through 100, defaulting to zero. Recipes
retain fractional values. Evaluation prepares exactly JavaScript
`Math.round(amount * 256 / 100)`, including IEEE intermediate rounding. Zero
and disabled recipes retain every source byte, while disabled recipes still
receive complete closed admission.

Each stage reads straight UNORM8 encoded sRGB. Original luma is
`floor((54R + 183G + 19B + 128) / 256)`. Separately rounded alpha-weighted
three-by-three and five-by-five binomial means use the one-dimensional kernels
`[1,2,1]` and `[1,4,6,4,1]`, replicated independently across both axes. The
implementation couples both means into twenty-five immutable original-neighbor
reads. Transparent neighbors contribute zero weight, and every visible center
provides a positive denominator.

```text
fine = floor((2*sum3 + weight3) / (2*weight3))
coarse = floor((2*sum5 + weight5) / (2*weight5))
gate = max(0, 256 - 4*abs(originalLuma - coarse))
delta = floor(((fine - coarse)*amountQ8*gate + 32768) / 65536)
outputRGB = clip(originalRGB + delta, 0, 255)
```

The fine-minus-coarse band changes medium-frequency structure while the gate
protects strong coarse boundaries. Positive Amount increases that contrast;
negative Amount softens it. Signed nearest rounding takes half ties toward
positive infinity. Each channel receives the same offset before explicit
clipping. Alpha stays exact, and zero-alpha centers keep their hidden RGB.
Crop and geometry change the natural image extent seen by later Texture stages.

The maximum coarse rounded numerator is 33,358,080. The conservative signed
adjustment numerator bound is 16,744,448. Both fit signed 32-bit arithmetic.
CPU, GLSL and GEQ use the same quantization and explicit signed floor; preview
sampling uses original byte texels rather than interpolated blur textures.

The scoped CPU kernel owns one detached source snapshot and one output, joins
native cancellation, real processing yields and consumer settlement, then wipes
both captured backings. Each Frame or named fixed Photo stage retires its
predecessor. There is no retained image-sized blur or gate plane. FFmpeg admits
only its private compiled operation and carries original alpha separately around
planar RGB conversion with output-scoped labels for repeated and mixed stages.

Independent BigInt and literal fixtures cover fractional and signed Amount,
spatial edges, alpha-weight ties, all 256 alpha values and authored order.
Mounted English/German Photo Session and Frame rack tests cover authoring,
durable recipes and original custody. The actual pinned FFmpeg graph and owning
picture encoder qualify repeated Texture/curve stages and explicit pre-encode
bytes; H264 decoding is compared with the same declared codec reference and
does not claim lossless RGBA output. Native shader/menu execution and
maximum-profile latency or heap qualification remain separate pending gates.
No assistance runtime source pins, engine closure or asset publication change;
a manual **Update AI assets** run is not required.
