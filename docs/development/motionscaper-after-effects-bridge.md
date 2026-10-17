# Motionscaper After Effects bridge

M11 remains **In progress**. The versioned exchange, readable scripts,
menu-driven import/export, source custody, reviewed editable subset and bounded
sampled/rendered alternatives are implemented. No installed After Effects test
environment is available and no AE version is qualified. Synthetic host tests
must not populate the installed-host matrix. Historical local browser results
were reported before the 2026-10-13 reboot; their temporary receipts are lost and
fresh local checks do not qualify an installed AE host. See [final validation status](motionscaper-final-integration-validation.md).

The intended workflow uses readable `.jsx` scripts through **File > Scripts >
Run Script File** in an installed After Effects application. Adobe documents
that workflow and the user-controlled permission for scripts to write files in
its [Scripts help](https://helpx.adobe.com/ca/after-effects/desktop/automate-in-after-effects/automate-animation/scripts.html).
That page designates the [After Effects Scripting Guide](https://ae-scripting.docsforadobe.dev/)
for the API. The bridge will not change those application preferences, parse
binary `.aep` projects, or claim native AE plug-in compatibility.

A [pinned review of Storytold and the external AEP format candidates](motionscaper-aep-native-format-research.md)
records the unmerged EffectCraft importer, py-aep's experimental binary writer,
and a bounded Rust reader. Direct native-format support remains separate
follow-on feasibility work; those projects are not adopted dependencies or
Motionscaper compatibility evidence.

## Editor workflow

**File > After Effects Bridge** opens the lazy bridge dialog, including before
a document is open. It downloads the readable script ZIP, accepts a manifest
and all package media files, prepares a read-only report, and requires explicit
acknowledgement before atomically importing a new document. The report can also
be downloaded alongside its untouched source exchange. Choosing `.aep` or
`.aepx` through **File > Open** routes to installed-AE instructions without
trying to parse the source project.

Actual Chromium workflows cover script ZIP download, AEP/AEPX routing,
real encoded PNG import and alpha pixels in the preview, report acknowledgement,
Save/reopen and `.mscape` custody, unused original media byte preservation,
missing files, digest mismatch, closing a prepared review without changing
the open document, seeking distinct retained rendered PNG frames, and editable
hard-edge mask import, preview pixels and reverse export after Save. These
browser checks do not establish installed-AE behavior.

## Readable exporter

`node scripts/build-motionscaper-ae-bridge.mjs` derives readable ES3-syntax
artifacts from the strict TypeScript host controllers. Its `--check` form rejects
drift, and generation parses every executable include as ES3. The source entry
is stored as `Motionscaper-Export.jsx.txt` so web tooling does not parse Adobe
preprocessor directives as React; the downloadable filename is `.jsx`. Keep the
generated `.jsxinc` files alongside that entry when running it in AE.

The exporter reads compositions and authored property values without changing
the open project, copying media into a newly created transfer folder. The JSON
manifest is published last. Copy/write failure removes only files owned by that
pending package; failed cleanup remains visible with the original error. It
never saves the original `.aep`, overwrites retained media, or changes script
permissions. The JSON codec requires neither a host `JSON` global nor `eval`.

Enabled expression text is retained but not run by this exporter; it reads
pre-expression values. A separate confirmed entry supports numeric sampling as
described below; the separate rendered entry is described under qualification.
Unmapped features receive explicit unsupported reports, including layers whose
text runs, advanced masks, solid sources, footage interpretation, or plug-ins
need further mapping. The host API tests exercise the generated entry, media
copy, source-byte preservation, pre-expression reads, manifest publication and
rollback. They are synthetic host evidence, not an AE execution result. Escape
handling and filesystem behavior require actual installed-AE qualification;
media copying uses AE's per-file operation.

## Limited importer

`Motionscaper-Import.jsx` parses inert bounded JSON before opening an undo group.
Its admitted subset includes compositions, retained footage, nulls, parent links,
timing/transforms, authored keys/ease and the hard-edge masks/mattes below.
Reviewed paragraph text, ordered path/paint shapes, a narrow camera/ambient-light
mapping, named blends and Gaussian Blur 2 controls also have host and Motion
conversion paths. Their admission rules are explicit; they are not general
AE compatibility. Unmapped layers and properties retain reports and source
custody, with an explicit choice before creating partial content.

Expressions stay inactive by default. Separate import/export opt-ins translate
only the admitted scalar opacity subset. The installed importer independently
validates its closed ES3 expression source before mutation, applies values and
keys first, then checks activation errors and one finite in-point sample.
Failure rolls back only newly created objects. That probe does not qualify all
frames or subframes. See [expression mapping](motionscaper-ae-expressions.md).

The destination project must already have matching working space, linear blend
and bit depth settings; the script never changes those project-wide settings.
It checks all retained file lengths and any declared SHA-256 before mutation,
rejects aliases and unsafe paths, and then creates new items under a new folder.
The ES3 binary-string hash implementation uses bounded 1 MiB reads and follows
[FIPS 180-4](https://csrc.nist.gov/pubs/fips/180-4/upd1/final). A null digest at the
capture boundary remains explicitly unverified beyond byte length. Failure
removes only created objects and closes their undo group; cleanup failure stays
visible with the primary failure. Existing items, project files and media files
are not overwritten or saved. Successful import does add new unsaved items to
the open destination project.

Generated-script host tests cover separate item creation, ordering, parent
binding, temporal ease and spatial tangents, media hash mismatch, color mismatch,
and rollback. These tests do not establish actual AE re-import or pixel parity.

## Editable paths and hard-edge masks

Both project converters preserve path vertices and their relative Bézier handles,
as defined by Adobe's [Shape API](https://ae-scripting.docsforadobe.dev/other/shape/).
Static paths and topology-preserving hold/linear path keys remain editable.
Export rebases local frame keys to composition seconds; import reports any
one-millionth-frame quantization. Expressions, negative imported key times,
changing topology and unsupported temporal easing require an explicit bake or
rendered fallback. No temporal speed curve is guessed.

The exporter captures [MaskPropertyGroup attributes](https://ae-scripting.docsforadobe.dev/property/maskpropertygroup/)
as optional closed metadata: mode, inversion, RotoBezier, feather falloff and
mask motion blur. Existing exchanges without that field retain identical data;
their masks require a new capture before editable conversion. Variable feather
points remain bounded inert shape custody and are refused by editable mapping.

The admitted subset maps path, opacity, inversion and add/subtract/intersect/
difference operations with zero feather and expansion. Motion feather uses
Gaussian sigma; AE radius and falloff are not silently treated as equivalent.
RotoBezier, forced mask motion blur, variable feather and unsupported mask
properties produce explicit refusals or unsupported conversion reports. The
generated importer validates its subset before mutation, constructs `Shape`
objects, creates new masks with explicit attributes and applies admitted keys.
Its generated-script tests cover those calls and refusal before mutation. Actual
AE edge pixels, compositing modes and interpolation still need host/reference
qualification.

Matte import preserves the original source visibility and creates independent
editable source copies clipped to each consumer's imported active span. Nested
copies share the unchanged 256-layer and 32-level limits; importing beyond them
refuses with a rendered-fallback action. Retiming or changing visibility after
import requires reviewing the copy as well as its consumer; no live AE source
relationship is implied. A disabled AE source can therefore provide matte
pixels without becoming an ordinary visible Motion layer.

Reverse export maps source IDs and all four alpha/luma modes when enabled
consumer spans cover the source's complete active range. It refuses disabled,
unmapped or intermittently visible Motion sources instead of changing their
ordinary visibility silently. The installed importer uses Adobe's
[setTrackMatte API](https://ae-scripting.docsforadobe.dev/layer/avlayer/#avlayersettrackmatte),
requires AE 23 or newer before mutation, preserves layer order and restores
explicit source visibility after host binding. Missing APIs roll back newly
created objects. Structural host tests and actual browser matte pixels cover
these paths; actual AE alpha/luma/color/reference qualification remains open.

## Other implemented editable mappings

- **Text:** static uniform fill-only horizontal paragraph boxes, with explicit
  retained-font/PostScript associations and reviewed line spacing/color. Reflow
  is reported; mixed runs, animation, strokes, point/vertical text and missing
  style metadata require fallback. The host importer requires AE 24.6 or newer
  and verifies installed faces; it never installs fonts. See [text staging](motionscaper-ae-text-qualification.md).
- **Shapes:** ordered isolated Bézier path/solid-paint groups with admitted
  hold/linear keys and static similarity transforms. Fill/stroke use independent
  editable path copies. Gradients, nested groups, compound/operator semantics and
  unsupported easing remain reported. Named popup styles require a separately
  reviewed exact version/build/language profile, never guessed enum values.
  See [shape staging](motionscaper-ae-shape-qualification.md).
- **Scenes:** unparented one-node perspective cameras with neutral X/Y rotation,
  Z roll and disabled depth of field; ambient lights with reviewed static opaque
  SDR color and intensity keys. General 3D AV/materials, point/spot lights,
  shadows, orthographic/parented cameras and DOF are not editable mappings.
  See [scene staging](motionscaper-ae-scene-qualification.md).
- **Blends and Gaussian:** Normal, Multiply, Screen, Overlay, Darken, Lighten and
  Difference have closed bidirectional named mappings. Gaussian Blur 2 requires
  an explicitly selected exact-host profile, complete neutral control inventory
  and positive declared blurriness-to-sigma scale. Host readback/rollback preserves
  source values; it does not establish kernel/radius, bounds, color or alpha
  equivalence. Other enabled effects and non-neutral compositing controls stay
  unsupported. Complete rendered fallback is offered within its bounds.

The Motion-to-AE editable package retains `original.mscape` and an explicit
ledger. It is video-only: imported layers are muted, including precompositions.
Authored audio, unused assets, unsupported timing, temporal/DOF and other intent
remain in the original archive. A retained original is not a rendered appearance
claim. The [rendered export](motionscaper-ae-render-transfer-qualification.md)
uses full authored Motion quality for every frame of one complete composition,
up to 256 frames, with 8-bit straight-alpha sRGB PNG and no transferred audio.
The 256 MiB package includes an original archive admitted up to 128 MiB. It
refuses excess or missing output rather than skipping frames. This is not a
universal editable-or-baked promise for every admitted project.

## Exchange contract

`motion-ae-exchange.ts` admits `org.motionscaper.ae-exchange`, version 1. The
package manifest is `motionae.json`, accompanied by a `media/` directory.
Media references use a portable, flat relative path and explicit byte lengths.
SHA-256 is optional at the AE scripting boundary; an importing asset repository
must hash and verify retained bytes before publication. A missing file has a
null path and byte length and a required `missing-media` report. Absolute paths,
parent traversal, platform aliases, case-folded collisions, and unresolved
composition/layer references are rejected before any file operation.

The envelope retains the producing application and bridge versions, source
project display name, optional source revision digest, color settings, ordered
compositions/layers, and closed typed property data. It preserves AE seconds,
frame rate, pixel aspect, keyframe interpolation, temporal speed/influence,
spatial tangents, roving flags, shape paths, and uniform text-document fields.
Transfer IDs are local to one package. A later import allocates destination
identities; it must not overwrite source projects or media.

Expression source is inert custody data. It is never evaluated by parsing this
format. Enabled expressions require an exact per-property report and a declared
translated, sampled, or unsupported disposition; sampled expressions require
retained frame-grid samples beside the untouched authored keys. That declaration is input intent, not proof that an expression
is supported by the Motionscaper evaluator. The conversion layer must validate
its supported subset independently. Reports distinguish editable, sampled,
rendered, and unsupported content. A rendered claim requires a retained media
reference. Property paths include each property's zero-based collection index
and stable match name, separated by `/` through groups.

Limits are 16 MiB of manifest JSON, 256 compositions, 4,096 footage items and
total layers, 65,536 properties, 16 property-group levels, 4,096 keys per
property, 262,144 total keys, 4,096 vertices per shape, 65,536 report entries,
and 256 GiB of referenced media. These are package admission limits, not
promises that every admitted feature is editable or renderable. Direct object
inputs are also checked for bounded inert data before normalization.

## Explicit numeric sampling

`Motionscaper-Export-Sampled.jsx` is a separate user-selected entry point. After
confirmation it evaluates animated numeric properties and enabled numeric
expressions with AE's documented [valueAtTime API](https://ae-scripting.docsforadobe.dev/property/property/#propertyvalueattime).
Original
authored keys and expression text remain in the exchange; optional `samples`
retain a composition frame rate, first integer frame, and values on that grid.
The terminal grid point is included. The standard exporter continues to read
pre-expression values without evaluation.

Sampling is limited to 4,096 values per property and the shared 262,144
key/sample budget, checked before evaluation. Cancellation is checked between
host calls. An individual native expression evaluation may block; installed-AE
Escape interruption remains unqualified. Sampling failures retain authored
data and add an unsupported report. Frame values do not preserve subframe
motion, motion blur, or general spatial/temporal interpolation semantics.
The host importer uses admitted authored transform keys. The project converter
can consume declared frame samples as linear keys; otherwise expressions stay
inert unless the separate reviewed scalar translation option is admitted.

## Required qualification

The bounded full-composition render host controller has focused synthetic
tests for exact frame count/order, existing-queue refusal, selected template,
8-bit PNG carrier dimensions/alpha-channel admission, frame/byte budgets and
primary-plus-cleanup errors. The readable `Motionscaper-Export-Rendered.jsx`
entry now requires explicit confirmation, an active composition, an empty
render queue, and an exact user-selected installed PNG output template. It
creates one owned queue item and a fresh output folder, requests the full span
from zero at the composition frame rate with no skipped frames, reads the
settings back, disables post-render project actions, and removes its queue
item. Original project settings and files remain untouched. Native rendering
blocks until AE returns; cancellation/Escape requires installed-host evidence.

The current installed adapter and Motion image-layer carrier accept at most
256 frames. Every full-size 8-bit PNG must contain alpha channels, match the
canvas and frame grid, and survive byte verification. The complete sequence
becomes one exact one-frame image layer per frame; no first-frame flattening is
allowed. Original authored exchange and every original media body remain in
custody. Original AE image-sequence footage cannot be represented by copying
its first source file: the exporter reports missing custody and import refuses
until all originals have an admitted carrier. The fallback sequence carries no
audio. Existing 64 MiB/file, 256 MiB/transfer and overall project traversal
limits still apply. Larger compositions require splitting or a future carrier.

Synthetic generated-entry tests verify confirmation, empty-queue refusal,
full-span settings, all frame copies, original file preservation, and cleanup.
A browser test decodes two actual PNGs and verifies distinct pixels when seeking
between frames. The actual AE setting names/values, installed output templates,
file naming, cancellation, and alpha/color/reference fidelity remain
unqualified. A PNG channel header cannot establish alpha/color parity. The
[render item](https://ae-scripting.docsforadobe.dev/renderqueue/renderqueueitem/)
and [output module](https://ae-scripting.docsforadobe.dev/renderqueue/outputmodule/)
APIs define the adapter seam; their actual host behavior remains a release gate.

The pure exchange-to-Motion draft converter now maps 2D retained images/footage,
precompositions, nulls, ordering, parenting, known blend/matte intent, and
numeric transforms. Static, hold and linear values retain editable keys;
explicit AE samples become linear frame-grid keys. Percent scale/opacity become
Motion factors. Animated or sequence footage cannot bind a single decoded still. Spatial tangents, roving and temporal Bezier speed require
samples rather than an inferred curve. Expressions remain inert by default;
explicit reviewed scalar translation is the separately bounded exception.
The new document uses fresh identities and retains the original exchange as
separate custody. Unsupported layer kinds become named null placeholders, and
all partial conversion requires explicit report acknowledgement before any
publication. Reviewed text, shapes, hard-edge masks/mattes, scenes, named blends
and Gaussian controls are mapped under the limits below. Audio, non-square
pixels, general 3D/materials, advanced masks and broader mappings remain outside
this editable subset.

AE floating clocks cross an explicit one-millionth frame/second boundary;
changed values get a sampling report and original values remain in custody.
Composition duration rounds outward to a whole frame. Imported transforms use
composition-origin keys, while source timing is rebased to that same origin.
The converter validates declared media bindings; an importing controller must
independently verify actual retained bytes before publishing them.

The import controller now prepares without storage writes, requires explicit
acknowledgement of the report, stages at most 4 MiB per write, verifies every
body digest, and atomically commits a new project. Each selected source must
pass the existing 64 MiB decoder admission; a transfer admits at most 256 MiB
of selected media. Every original footage file, including unused originals,
must be selected and representable by a validated Motion asset. Missing files
or unsupported original byte carriers refuse publication; named null draft
placeholders alone cannot substitute for media custody.

Optional project `interchangeCustody` carries the closed inert original AE
exchange, exact conversion report, and source-to-asset digest/length bindings.
It is omitted for ordinary projects, bounded to 16 MiB before traversal and
serialization, and part of the saved revision digest. Asset removal or
replacement cannot discard its bound originals. Normal Save/reopen and
`.mscape` roundtrip tests retain unsupported intent, original source names,
and unused original media bytes. No custody expression enters the evaluator.

The installed-AE matrix remains empty. It must record actual application
versions, exported fixture hashes, subsequent AE re-import results, structure
comparisons, and reference frames. Required cases include media and font loss,
unsupported plug-ins, expressions sampled in AE, full-composition baking for
cross-layer dependencies, repeated transfers, cancellation, and preservation of
the original project and source media. A mock host or structural JSON test
cannot satisfy this gate.

This work does not change assistance runtime assets and does not require a
manual **Update AI assets** run.
