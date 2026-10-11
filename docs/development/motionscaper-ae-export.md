# Motionscaper → After Effects development exchange

This is a partial, unqualified editable export. No installed After Effects
version has passed reference qualification. M11 remains incomplete until real
AE-generated fixtures and actual reimports qualify the intended feature matrix.
The Node script harness checks generated script behavior against a controlled
host model; it does not substitute for an installed Adobe application.

`prepareMotionscaperAeExport` pins an immutable Motion revision and produces the
closed `org.motionscaper.ae-exchange` version 1 manifest. Transfer identities are
deterministic within that snapshot. The manifest and its unsupported report are
reviewed before creating a package; packaging requires the exact reviewed
object and explicit acknowledgement. No normal Save or saved-revision event is
issued by export.

The initial reverse subset includes 2D image/footage, nested compositions, null
layers, layer order, parent references, source timing with positive finite
stretch, static transforms, hold/linear curves with aligned axis clocks and
scalar/nonspatial temporal Bezier curves that fit AE ease limits. Position and
anchor spatial Bezier curves, independently timed vector axes and vertical or
out-of-range temporal handles receive an unsupported report; the mapped base
value does not masquerade as a sampled animation. Keys use composition seconds
and percentages are converted explicitly. Expression text stays inert.

Unsupported layer kinds and nonplanar transforms become disabled named nulls.
Text, shapes, solids, cameras, lights, audio placement, time remapping, held or
reversed sources, masks, mattes, effects, non-normal blends and advanced render
quality require further mapping or an explicit whole-composition render.
Tracking authority stays in the original project even when a derived transform
curve maps. Effects on supported layers are reported omissions. The transferred
scene is therefore a partial editing draft and may differ visually.

The reverse profile is video-only. The readable importer recognizes a
Motionscaper producer with bridge version `0.1.0` and sets `audioEnabled=false`
for every new layer, including precomposition layers. This prevents automatic
AE audio defaults from inventing unrequested sound. Earlier Adobe-produced
exchanges retain their existing importer behavior.

The separate destination project must use Working Space None, linear blending
and 32 bits per channel. These are explicit staging settings, not qualified
color/alpha conversion. The importer does not change an existing project's
color settings. Footage interpretation and native decoder availability remain
installed-host qualification requirements.

The companion package includes `motionae.json`, `conversion-report.json`,
`README.txt`, `original.mscape`, and the original media admitted by the AE
subset. `original.mscape` contains the exact source snapshot and every declared
asset, including unused images, fonts and audio, plus earlier interchange
custody. Unsupported original assets are preserved there even if absent from
AE's media folder. Both archive creation and AE media emission verify lengths
and SHA-256 digests. Source archive memory admission is 128 MiB; final package
admission is 256 MiB, with bounded streaming chunks and cancellation. Larger
transfers require a future streaming package capability or a smaller source.

Published API references used for the structural mapping:

- [Adobe AV layer property match names](https://ae-scripting.docsforadobe.dev/matchnames/layer/avlayer/)
  specify `ADBE Rotate X`, `ADBE Rotate Y` and `ADBE Rotate Z` with spaces.
- [KeyframeEase](https://ae-scripting.docsforadobe.dev/other/keyframeease/)
  defines speed and influence; actual interpolation is still a reference gate.
- [AVLayer audioEnabled](https://ae-scripting.docsforadobe.dev/layer/avlayer/#avlayeraudioenabled)
  supplies the explicit mute switch for this reverse subset.

No dependencies, native runtime recipes or assistance runtime bytes change.
A manual **Update AI assets** run is not required.
