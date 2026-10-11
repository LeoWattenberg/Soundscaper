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
stretch from 1 through 9900 percent, static transforms, hold/linear curves with aligned axis clocks and
scalar/nonspatial temporal Bezier curves that fit AE ease limits. Position and
anchor spatial Bezier curves, independently timed vector axes and vertical or
out-of-range temporal handles receive an unsupported report; the mapped base
value does not masquerade as a sampled animation. Keys use composition seconds
and percentages are converted explicitly. The explicitly reviewed closed scalar expression subset is activated only after independent host admission; other expression text stays inert.

Unsupported layer kinds and nonplanar transforms become disabled named nulls.
Reviewed uniform text/font bindings, flat solid shapes, hard-edge masks, track
mattes, one-node cameras and ambient lights now have bounded editable mappings.
Normal, Multiply, Screen, Overlay, Darken, Lighten and Difference use named
SDK layer blend enums when captured AV switches are neutral. Missing or enabled
Preserve Transparency/Collapse Transformations, adjustment/3D blends, other
blend modes, solids, unsupported scene/text/shape intent, audio placement, time
remapping, held/reversed sources, unmapped effects and advanced render quality require
further mapping or explicit whole-composition rendered fallback.
Tracking authority stays in the original project even when a derived transform
curve maps. Effects outside the reviewed Gaussian profile are reported omissions. The transferred
scene is therefore a partial editing draft and may differ visually.

The reverse profile is video-only. The readable importer recognizes a
Motionscaper producer with bridge version `0.1.0` and sets `audioEnabled=false`
for every new layer, including precomposition layers. This prevents automatic
AE audio defaults from inventing unrequested sound. Earlier Adobe-produced
exchanges retain their existing importer behavior.

The documented AE constructor range is enforced before host mutation: 4–30000
pixels per dimension, 1–99 frames per second and at most three hours. Layer
start/in/out times must remain within ±three hours. Sub-one-percent stretch is
reported as unsupported because the documented host clamps it.

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

Blend conversion preserves source switches in the inert exchange and admits no
raw enum integers. The importer checks enum availability before creating objects,
sets admitted modes on newly owned layers, verifies readback and rolls back its
owned objects on failure. A neutral read-only collapse switch is not written; a
non-neutral switch that cannot be changed refuses the transfer with fallback
guidance. Legacy metadata remains absent and cannot authorize a
non-normal mode. This is structural editing support: installed-host blend-space,
color and alpha parity remain unqualified. The File bridge report and complete
rendered package remain the appearance-preservation alternatives.

The File bridge admits Gaussian Blur only after explicit selection of a reviewed
`org.motionscaper.ae-gaussian-profile` version 1 file. Import requires the exact
profile retained in the source exchange; Save/reopen retains that profile as
inert custody, not continuing permission to convert. Reverse export requires a
fresh selection. The profile binds the AE version, build and UI language, the
complete captured scalar/group control tree and bounds, selected Blurriness and
Effect Opacity paths, and a user-declared positive blurriness-per-Motion-sigma
scale. No published sigma/radius/kernel equivalence is inferred.

`Motionscaper-Gaussian-Profile.jsx` offers separate prepare/capture operations.
Prepare creates only its own empty shape sample and Gaussian effect. Capture
requires personally reviewed Both Dimensions, Repeat Edge Pixels off, Effect
Opacity 100%, no effect masks and only the two selected scalar controls. If the
host cannot expose the complete indexed closure including compositing controls,
editable capture refuses with full-render guidance. Source export remains
read-only through `Motionscaper-Export-Gaussian.jsx`. The installed importer
requires selecting the exact local profile before any objects are created,
checks fresh neutral 2D layer switches and the complete control inventory,
applies only static or hold/linear scalar blur values within host and Motion
sigma 0–20 bounds, and verifies values, keys, interpolation and effect switches.
A failed application rolls back newly owned objects. Expressions, changed
channels/edges/compositing, effect-mask references and unknown effects cannot
gain this capability. Original values and omission reports remain in custody.
Kernel, bounds, color, alpha and actual installed-host parity remain unqualified;
the complete composition PNG fallback is the separate appearance carrier.

Published API references used for the structural mapping:

- [Adobe first-party effect match names](https://ae-scripting.docsforadobe.dev/matchnames/effects/firstparty/)
  identify `ADBE Gaussian Blur 2`; the legacy effect is a distinct identity.
- [Adobe Blur and Sharpen effects](https://helpx.adobe.com/after-effects/using/blur-sharpen-effects.html)
  describes Gaussian controls without establishing Motion sigma equivalence.
- [PropertyGroup.addProperty](https://ae-scripting.docsforadobe.dev/property/propertygroup/#propertygroupaddproperty)
  specifies indexed-reference invalidation; the importer reacquires each new effect.
- [Adobe blend mode documentation](https://helpx.adobe.com/after-effects/using/blending-modes-layer-styles.html)
  describes the supported channel operations and dependence on project blending settings.
- [AVLayer.blendingMode](https://ae-scripting.docsforadobe.dev/layer/avlayer/#avlayerblendingmode)
  supplies the named SDK enums; its adjacent Preserve Transparency and Collapse
  Transformations attributes supply the explicitly captured switches.
- [Adobe AV layer property match names](https://ae-scripting.docsforadobe.dev/matchnames/layer/avlayer/)
  specify `ADBE Rotate X`, `ADBE Rotate Y` and `ADBE Rotate Z` with spaces.
- [ItemCollection.addComp](https://ae-scripting.docsforadobe.dev/item/itemcollection/#itemcollectionaddcomp)
  and [Layer timing](https://ae-scripting.docsforadobe.dev/layer/layer/#layerstretch)
  define the constructor limits and stretch clamping behavior.
- [KeyframeEase](https://ae-scripting.docsforadobe.dev/other/keyframeease/)
  defines speed and influence; actual interpolation is still a reference gate.
- [AVLayer audioEnabled](https://ae-scripting.docsforadobe.dev/layer/avlayer/#avlayeraudioenabled)
  supplies the explicit mute switch for this reverse subset.

No dependencies, native runtime recipes or assistance runtime bytes change.
A manual **Update AI assets** run is not required.
