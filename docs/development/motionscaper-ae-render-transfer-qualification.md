# Motion to After Effects complete rendered transfer

File > After Effects Bridge > Rendered composition export prepares the full selected composition, independent of its work area. The immutable source revision, rational frame rate, dimensions, shutter sampling and depth-of-field sample count are pinned before media reads. The source project is never edited or saved by this operation.

`editor-ae-render-package.ts` calls the maintained `renderMotionscaperDelivery` PNG pipeline. It does not substitute preview resolution or quality. The renderer prepares any expression audio needed to evaluate appearance, but the transferred output is image-only. All original audio and every retained asset, including unused sources, remain in `original.mscape` with the complete authored project and previous interchange custody.

The package contains:

- `original.mscape`: the full pinned source archive, admitted up to 128 MiB.
- `media/render-frame-N.png`: every frame from zero through duration minus one, at most 256 frames and 64 MiB per PNG.
- `motionae.json`: one full-size still layer per frame, with exact source digest and individual media digests. The installed-side import plan mutes every layer.
- `sequence.json`: the exact rational clock, full span, quality settings and frame descriptors.
- `conversion-report.json` and `README.txt`: full-span rendering ledger, audio omission, flattened editability, carrier precision and installed-host qualification limits.

The complete ZIP is limited to 256 MiB. This is an output bound, not a claim that total resident memory is 256 MiB: the retained source archive, output chunks and one bounded PNG may coexist, in addition to the renderer's independently bounded working surfaces. Streaming backpressure permits only one PNG at a time; no second complete PNG TAR is retained. The canonical sequence adapter refuses missing, duplicate, reordered or truncated frames, malformed headers, wrong dimensions, excess bytes and metadata differing from the pinned revision, quality or clock. A complete download is returned only after rendering, sequence verification and ZIP finalization succeed. Cancellation yields no partial download.

PNG uses the same straight-alpha, 8-bit sRGB carrier as ordinary Motion PNG delivery. HDR/out-of-range values are clipped or quantized. Flattening preserves the sampled Motion picture at this carrier precision; it does not preserve editable layer structure, audio, arbitrary subframe evaluation, high-precision color or other compositions' rendered pictures. Their complete original intent remains in the source archive. Unsupported Motion renderer capabilities fail the operation rather than publishing incomplete output.

## Local evidence

`tests/motionscaper-ae-render-{export,stream,package}.test.ts` covers source/quality admission, exact full-span host plans, canonical streaming validation, backpressure, bounded allocation, source custody admission and cancellation before reads.

`tests/browser/motionscaper-ae-render-package.spec.ts` opens a real `.mscape` through File, renders a moving 3D card with authored temporal and depth-of-field sampling, and compares every packaged PNG byte-for-byte with the normal full-quality PNG export. It verifies nonempty translucent picture content and changing frames, the retained original project/audio bytes, the exact rational clock and quality, the muted generated host plan, unchanged saved state, the overlong-composition refusal and real render cancellation without a download.

## External gate remains open

No installed Adobe After Effects test environment is available. Generated host-plan tests do not establish installed-host behavior. Run the shipped `Motionscaper-Import.jsx` in a separate destination project using the documented bridge staging profile, then compare every frame's placement/timing, source interpretation and color/alpha with the packaged PNGs. No AE version, color/alpha equivalence or successful native AE reimport is claimed by the local evidence.

No manual **Update AI assets** run is required: this feature uses the existing render and assistance runtime closures.
