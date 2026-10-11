# Motionscaper AE editable shape staging

The project converters map ordered isolated Bezier path/solid-paint groups. Fill
and stroke become separate editable path copies, with an explicit report. Static
positive uniform group transforms are baked into geometry and stroke width.
Path, opacity and width hold/linear keys retain their authored timing. Gradients,
compound paths, multiple paints in one group, nested groups, operators, dashed or
non-neutral tapered strokes, skew, nonuniform group scale, and unsupported easing
require an explicit mapping or whole-composition rendered fallback. Original
exchange data and source media remain in project custody.

Shape popup integers are not inferred from AVLayer enums or online examples. The
published [shape property inventory](https://ae-scripting.docsforadobe.dev/matchnames/layer/shapelayer/)
identifies the controls without defining their numeric popup mappings. A separate,
explicitly selected calibration workflow establishes a user's reviewed labels:

1. Download scripts from File > After Effects Bridge. Run
   `Motionscaper-Prepare-Shape-Profile.jsx` in installed AE and confirm. This creates
   one new sample composition with five bounded groups. It does not save a project
   or change existing layers, files, preferences, or render-queue items.
2. In AE's UI, set every sample group/paint blend to Normal; the two fills to
   Non-Zero Winding and Even-Odd; the three strokes to the named Butt/Miter,
   Round/Round, and Projecting/Bevel choices. Keep the first path direction and
   reverse the second once. The generated group names and README describe this.
3. Keep the sample composition active. Run `Motionscaper-Capture-Shape-Profile.jsx`
   and explicitly confirm the reviewed labels. Capture reads only that owned
   inventory. It rejects missing/extra/renamed samples, animated popup controls,
   inconsistent Normal choices, and duplicate values for distinct choices. It
   writes only a new, non-aliased file, never an existing destination.
4. Run `Motionscaper-Export-Shapes.jsx` and select the profile. Admission binds
   exact `app.version`, `app.buildNumber`, and `app.isoLanguage`; another build or
   UI language requires a new review. The selected profile is retained in the
   exchange report. Source export remains read-only.

Default `Motionscaper-Export.jsx` does not prepare calibration or ask for a profile.
It retains raw properties and enable switches, reports unavailable shape styles,
and gives profile/rendered-fallback guidance. A raw path-direction override is
editable only when the selected profile establishes its forward interpretation.
Profile data is closed, inert JSON bounded to 8 KiB. It executes no source code.

The installed-host importer remains profile-gated staging until its separate
shape-creation adapter is admitted. Project conversion alone does not establish
host application. Source-preserving fallback and the unsupported ledger remain
available while this adapter is completed.

The host identity and enable-switch authority come from the published
[Application](https://ae-scripting.docsforadobe.dev/general/application/) and
[PropertyBase](https://ae-scripting.docsforadobe.dev/property/propertybase/)
contracts. Shape order follows Adobe's
[shape layers and paths](https://helpx.adobe.com/after-effects/desktop/drawing-painting-and-paths/vector-graphics-and-raster-images/overview-shape-layers-paths-vector.html)
documentation.

Node tests exercise project roundtrips, actual CanvasKit painter-order/alpha
pixels, closed profile admission, calibration ownership, generated ES3 execution,
cancellation, overwrite refusal and cleanup errors. These are automated contract
checks, not installed-AE qualification. No AE installation was used to obtain
actual popup values or compare reference frames. Installed-AE shape rendering,
color/alpha/edge fidelity, UI labels, cancellation and platform behavior remain
open external gates. No manual **Update AI assets** run is required.
