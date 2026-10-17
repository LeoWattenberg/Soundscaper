# Motionscaper AE editable text staging

The File > After Effects Bridge dialog offers separate opt-in text settings for
import and export. The user chooses destination line spacing, color interpretation,
and explicit PostScript-name/font associations. The conversion report always
retains the reflow warning. This is structural editable interchange, with no
installed-After-Effects visual qualification yet.

The admitted text is a static, uniform, fill-only horizontal paragraph box.
Mixed runs, Source Text keys or enabled expressions, text animators, text strokes,
point text, vertical text, and missing full-range style metadata require fallback.
Other captured text-layer controls are reported as omitted in the partial draft;
source exchange custody preserves them. Family names never substitute for an
explicit PostScript binding.

Selected fonts pass the same bounded font decoder as Motion rendering. Each face
is limited to 16 MiB and counts toward the shared 256 MiB transfer budget. Normal
Save, project reopen, and `.mscape` transfer preserve exact font bytes plus optional
closed `interchangeCustody.fonts` associations. Publication verifies byte lengths
and SHA-256 digests. Existing custody without the optional field is unchanged.

AE paragraph-box positions are layer-local. Import rebases the anchor and mask
paths together; keyed anchor values and Bezier controls receive the same constant
translation. A nonzero origin on a text layer with children is refused until child
coordinate compensation has an explicit mapping. Source hierarchy remains in the
retained exchange.

The readable installed-AE importer requires AE 24.6 or newer for editable text. It
preflights all text faces before creating items and refuses missing, substitute,
variable, or ambiguous fonts. It creates a new paragraph layer with `addBoxText`,
resets character/paragraph styles, applies the reviewed settings, and checks the
selected face after applying the document. It never installs fonts. The reverse
package retains every font in `original.mscape`; the installed font's bytes still
need independent reference qualification.

The exporter reads a complete character range to detect mixed styles. Unavailable
or non-neutral character, paragraph, and box controls cannot establish basic style.
Older hosts preserve first-character custody with unavailable metadata. Disabled
stroke colors are not read, because AE can throw for that accessor.

Implementation references:

- [CharacterRange](https://ae-scripting.docsforadobe.dev/text/characterrange/)
- [TextDocument](https://ae-scripting.docsforadobe.dev/text/textdocument/)
- [LayerCollection.addBoxText](https://ae-scripting.docsforadobe.dev/layer/layercollection/#layercollectionaddboxtext)
- [FontsObject.getFontsByPostScriptName](https://ae-scripting.docsforadobe.dev/text/fontsobject/#fontsobjectgetfontsbypostscriptname)
- [FontObject](https://ae-scripting.docsforadobe.dev/text/fontobject/)

Automated evidence covers full-range mixed/unavailable capture, style admission,
font preflight before host mutation, generated ES3 script execution, rollback,
geometry rebasing, immutable source retention, and byte-exact archive closure.
The real Chromium menu test imports a retained Inter face, renders visible text,
saves/reopens its binding, and verifies the reverse manifest and original font
bytes. These checks do not simulate or replace installed AE visual testing.

Open external gates include installed-AE export/reimport, exact font-face byte
identity, shaping, baseline/wrapping/leading, color/alpha, and platform behavior.
No manual **Update AI assets** run is required by this change.
