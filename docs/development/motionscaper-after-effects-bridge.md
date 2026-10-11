# Motionscaper After Effects bridge

M11 is in development. The versioned exchange contract is implemented; the
installed-After-Effects scripts, editor menu workflow, editable conversion, and
reference qualification are still being built. No After Effects version has
been qualified. Synthetic host tests must not populate that qualification matrix.

The intended workflow uses readable `.jsx` scripts through **File > Scripts >
Run Script File** in an installed After Effects application. Adobe documents
that workflow and the user-controlled permission for scripts to write files in
its [Scripts help](https://helpx.adobe.com/ca/after-effects/desktop/automate-in-after-effects/automate-animation/scripts.html).
That page designates the [After Effects Scripting Guide](https://ae-scripting.docsforadobe.dev/)
for the API. The bridge will not change those application preferences, parse
binary `.aep` projects, or claim native AE plug-in compatibility.

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
retained keys. That declaration is input intent, not proof that an expression
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

## Required qualification

The installed-AE matrix remains empty. It must record actual application
versions, exported fixture hashes, subsequent AE re-import results, structure
comparisons, and reference frames. Required cases include media and font loss,
unsupported plug-ins, expressions sampled in AE, full-composition baking for
cross-layer dependencies, repeated transfers, cancellation, and preservation of
the original project and source media. A mock host or structural JSON test
cannot satisfy this gate.

This work does not change assistance runtime assets and does not require a
manual **Update AI assets** run.
