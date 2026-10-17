# Shared Dehaze process

The shared effect type `dehaze-v1` defines the process
`srgb-alpha-dark3-white-dehaze-q8-v1`, with GPU code 33. Its one finite
amount is between -100 and 100, defaulting to zero. Fractional amounts are
retained in recipes and quantized for evaluation with JavaScript
`Math.round(amount * 256 / 100)`, including IEEE intermediate rounding.
Disabled effects still validate their complete closed settings.

Positive amounts remove haze and negative amounts add simulated haze, following
the [Adobe Effects vocabulary](https://helpx.adobe.com/ie/lightroom/web/edit-photos/apply-effects/adjust-effects.html).
The process uses the atmospheric mixing and floor-bounded reconstruction model
described in [He, Sun and Tang's CVPR 2009 paper](https://people.csail.mit.edu/kaiming/publications/cvpr09.pdf),
equations 1, 12 and 16. This application's process fixes atmospheric light to
white and operates on encoded sRGB bytes. Automatic airlight estimation,
transmission refinement and Adobe pixel equivalence are outside this process.

The current pixel admission is straight UNORM8 sRGB. For positive amounts, each
pixel reads the same immutable stage input in a replicated-edge 3 by 3
neighborhood. Each neighbor contributes an effective dark-channel byte:

```text
effectiveDark = floor((min(R,G,B)*alpha + 255*(255-alpha) + 127) / 255)
D = minimum effectiveDark in the neighborhood
tQ8 = max(26, 256-floor(D*amountQ8*243/65280))
output = clip(255+floor((2*(original-255)*256+tQ8)/(2*tQ8)), 0, 255)
```

Alpha is composited against white solely for transmission estimation. A hidden
black neighbor contributes 255 instead of suppressing haze removal. The
transmission floor bounds amplification by 256/26. The fixed 243/256
calibration retains a small atmospheric component. Signed reconstruction uses
nearest rounding with half ties toward positive infinity. Byte clipping is
explicit and follows reconstruction. A zero dark channel leaves positive
processing unchanged; white remains white. A positive gain of one quantizes
to identity because its estimated transmission reduction rounds to zero.

Negative amounts use per-pixel white atmospheric mixing:

```text
fogQ8 = floor((-amountQ8*128+128)/256)
output = original+floor(((255-original)*fogQ8+128)/256)
```

The largest negative amount mixes 50 percent white. Both signs preserve every
original alpha byte, and zero-alpha centers retain their hidden RGB. No
premultiplication or global image statistics enter this process. The largest
transmission numerator is 15,863,040; all CPU, GLSL and GEQ intermediates fit
signed 32-bit arithmetic. GLSL explicitly floors negative integer division.

The CPU kernel detaches settings and source bytes before yielding, owns one
input snapshot and one scoped output, and retains both until the consumer
settles. It yields every 256 KiB of output, checks captured native cancellation,
and wipes both captured backings on success and failure, including refusal of
the second allocation. It retains no image-sized transmission plane. FFmpeg
authenticates a private compiled operation, independently initializes each RGB
expression's registers, and receives original alpha before planar conversion
through the shared original-alpha transport.

Independent BigInt fixtures and literal atmospheric goldens cover signed and
fractional amounts, spatial edges, hidden neighbors, all 256 alpha values,
ordered repeated stages, and the actual pinned FFmpeg runtime. Scoped tests
cover held consumers, opaque cancellation, source transfer after a real yield,
allocation refusal and captured buffer cleanup. The closed shared registry
appends Dehaze without changing earlier recipes or compiled operation identity.
Existing Frame and Photo menus author the same fractional settings. Photo proxy
and full-resolution rendering use the same ordered kernel under their unchanged
fixed admission profiles; crop-first and Dehaze-first recipes use different
current-stage neighborhoods. Tests cover actual English and German authoring,
save/reopen and original custody, final Frame cancellation after scoped cloning,
full-resolution rendering beyond the proxy width, and selected picture-export
handoff through the owning encoder. The export witness compares exact pre-encode
bytes after the declared encoded-sRGB/linear-UNORM8 transfer and checks codec handoff;
it does not assert lossless H264 output. Native GPU execution and maximum-profile
heap/latency qualification remain pending. No runtime source pins, engine
closure or asset-publication logic changes; a manual **Update AI assets** run
is not required.
