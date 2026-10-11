# Motionscaper After Effects bridge

M11 is in development. The versioned exchange contract, readable exporter and
limited importer are implemented; the editor menu workflow, broad editable
conversion, and reference qualification are still being built. No After Effects version has
been qualified. Synthetic host tests must not populate that qualification matrix.

The intended workflow uses readable `.jsx` scripts through **File > Scripts >
Run Script File** in an installed After Effects application. Adobe documents
that workflow and the user-controlled permission for scripts to write files in
its [Scripts help](https://helpx.adobe.com/ca/after-effects/desktop/automate-in-after-effects/automate-animation/scripts.html).
That page designates the [After Effects Scripting Guide](https://ae-scripting.docsforadobe.dev/)
for the API. The bridge will not change those application preferences, parse
binary `.aep` projects, or claim native AE plug-in compatibility.

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
described below; rendered fallback remains pending.
Unmapped features receive explicit unsupported reports, including layers whose
text runs, mask attributes, solid sources, footage interpretation, or plug-ins
need further mapping. The host API tests exercise the generated entry, media
copy, source-byte preservation, pre-expression reads, manifest publication and
rollback. They are synthetic host evidence, not an AE execution result. Escape
handling and filesystem behavior require actual installed-AE qualification;
media copying uses AE's per-file operation.

## Limited importer

`Motionscaper-Import.jsx` parses inert bounded JSON before opening an undo group.
Its current admitted subset is compositions, retained footage, null layers,
parent links, layer timing and transforms, temporal interpolation/ease, spatial
tangents and roving keys. Unsupported layer kinds produce an actionable request
to render the complete composition; unsupported property groups, expressions,
masks, mattes and blend intent produce a preflight warning requiring an explicit
choice before creating partial imported content. Imported expressions are never
activated. Text, shapes, solid sources, cameras, lights, effect mappings and
Motionscaper model conversion remain incomplete.

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
The initial AE importer still imports authored transform keys and keeps
expressions inactive; consuming sampled values is a separate conversion step.

## Required qualification

The pure exchange-to-Motion draft converter now maps 2D retained images/footage,
precompositions, nulls, ordering, parenting, known blend/matte intent, and
numeric transforms. Static, hold and linear values retain editable keys;
explicit AE samples become linear frame-grid keys. Percent scale/opacity become
Motion factors. Spatial tangents, roving and temporal Bezier speed require
samples rather than an inferred curve. Imported expressions never execute.
The new document uses fresh identities and retains the original exchange as
separate custody. Unsupported layer kinds become named null placeholders, and
all partial conversion requires explicit report acknowledgement before any
publication. Audio, non-square pixels, color/footage interpretation, 3D,
text/shapes/effects/masks and broader editable mapping remain incomplete.

AE floating clocks cross an explicit one-millionth frame/second boundary;
changed values get a sampling report and original values remain in custody.
Composition duration rounds outward to a whole frame. Imported transforms use
composition-origin keys, while source timing is rebased to that same origin.
The converter validates declared media bindings; an importing controller must
independently verify actual retained bytes before publishing them.

The installed-AE matrix remains empty. It must record actual application
versions, exported fixture hashes, subsequent AE re-import results, structure
comparisons, and reference frames. Required cases include media and font loss,
unsupported plug-ins, expressions sampled in AE, full-composition baking for
cross-layer dependencies, repeated transfers, cancellation, and preservation of
the original project and source media. A mock host or structural JSON test
cannot satisfy this gate.

This work does not change assistance runtime assets and does not require a
manual **Update AI assets** run.
