# Motionscaper implementation order

Status: **In progress** on `feat/motionscaper`. This document owns the agreed
Motionscaper scope, implementation order, dependencies, and completion gates.
It describes the release target, not capabilities already shipped. All packages below are required for the
first public release; internal milestones do not reduce that release scope.

Motionscaper is a new local-first motion-graphics and compositing program for
the browser and Electron. It shares the editor platform with Soundscaper and
Framescaper, owns its project format, and supports saved-revision composition
links into Framescaper. After Effects exchange uses scripts in an installed
copy of After Effects and a documented editable subset.

## Agreed release boundaries

- Include composition/layer editing, graphical animation editing, typography,
  vector shapes, parenting, precompositions, masks/mattes, effects, time
  remapping, audio playback, and audio-driven animation.
- Include bounded JavaScript-style expressions, 2.5D layers, cameras, lights,
  shadows, depth of field, and motion blur.
- Include point/planar tracking, stabilization, corner pinning, chroma keying,
  and animated masks with manual corrections.
- Include linear-light SDR compositing, transparent delivery, browser and
  desktop packaging, offline linked compositions, and supported Adobe exchange.
- Defer imported 3D meshes, extruded geometry, automated subject rotoscoping,
  3D camera solving, content-aware removal, HDR/wide-gamut mastering, and
  unrestricted JavaScript.
- Native Adobe plug-in hosting and direct general-purpose `.aep`/`.aepx`
  parsing are separate feasibility work. The initial bridge can render
  unsupported AE effects and plug-ins in installed After Effects.

## How to execute the order

Start with the earliest incomplete package whose prerequisites are complete.
Within each package, add meaningful failing tests before implementation and
finish a maintained workflow before marking the package complete. Commit
changes in bounded, atomic units naming the package and outcome; select only
the files owned by that change. Keep all package statuses **Planned** until
implementation starts, then use **In progress** or **Implemented** only when
the corresponding behavior and automated gate justify it.

New domain/controller modules and their tests use strict TypeScript.
Product-specific application ownership belongs in `src/motionscaper/`; reusable
media, effects, rendering, storage, workers, and WASM integration belong in
`src/common/editor/`; UI belongs in `src/common/editor/ui/`. Extract reusable
Framescaper modules through narrow adapters rather than copying its controller
or relabeling its project runtime.

Every new feature has a menu entry. Reuse existing menu shells and submenus;
**File → New Composition** and **View → Motion Workspace** open the authoring
workspace. Graph, expression, tracking, and render-queue surfaces are opt-in.
Add no new always-visible toolbar controls, panels, rails, badges, or inline
controls. Keyboard shortcuts may supplement the menu entry.

| Order | Package | Prerequisites | Outcome |
| --- | --- | --- | --- |
| M01 | Product registration and platform seams | None | Isolated browser and desktop application shells. |
| M02 | Project, asset, and migration contracts | M01 | Durable Motionscaper projects and the Framescaper successor schema. |
| M03 | Composition evaluation | M02 | One deterministic evaluator for all consumers. |
| M04 | Typography, vectors, and 2D rasterization | M03 | Readable, portable composition frames. |
| M05 | Preview, delivery, and render queue | M04 | A complete composition-to-export workflow. |
| M06 | Layer and animation authoring | M05 | Usable motion-design editing and graphical keyframe tools. |
| M07 | Compositing and motion-design VFX | M06 | Masks, effects, tracking, and manually corrected roto workflows. |
| M08 | Expressions and procedural animation | M06 | Bounded, deterministic property expressions. |
| M09 | 2.5D cameras, lights, and temporal rendering | M07, M08 | Complete 2.5D compositing with blur and depth of field. |
| M10 | Linked Framescaper compositions | M02, M05, M09 | Saved revisions update portable, offline-renderable links. |
| M11 | After Effects interchange bridge | M05, M06, M07, M08, M09 | Qualified editable exchange with explicit baking reports. |
| M12 | Distribution and release qualification | M01–M11 | Both platforms pass the complete first-release gates. |

The table is the default execution order. Its prerequisites identify the
minimum dependency closure; a later package does not make an unfinished earlier
package complete.

### Implementation status

M01–M12 are **In progress**; named implementations do not close release gates.
Source `328cae02f` passed fresh static, Motion Node and bounded Linux gates.
Full Node/browser regressions, color repairs, duration and external gates remain.
Earlier results below are historical; fresh results and failures are recorded in
[final validation status](motionscaper-final-integration-validation.md). Typed project contracts, atomic
history, deterministic evaluation, streamed `.mscape` archives, durable
saved/recovery storage, paragraph/vector rasterization, and linear-light CPU
and WebGL2 compositing have focused Motionscaper coverage. Menu-driven document
workflows, offline reopen, successor archive custody, and GPU context loss pass
in Chromium. Motion DB2 appends storage-only write leases; saved pointers and
recovery drafts are atomically fenced, and competing windows retain one authoring
owner. Motion File Open preserves foreign/future archives as private read-only
custody, with exact Save Copy and the previous document/history unchanged.
Same-identity File Open reviews Copy/Replace/Keep and Saved/Recover choices;
failed post-adoption native release retains an explicit cleanup retry.
The [packaged Linux native launch workflow](motionscaper-native-launch-qualification.md)
covers cold/warm OS arguments, original-file Save, deferred collision review,
opaque custody and renderer-reload reissue through main-private capabilities.
Lease release keeps its durable fence and navigator lock until deletion succeeds.
English/German Help-menu destinations open the Motion handbook through bounded
browser/native adapters. The desktop Help menu also offers a manual, bounded
own-tag release check with a verified repository link; release installation and
cross-platform updater qualification remain open. Retained imported Arabic and CJK fonts have shaping,
wrapping, pixel, portable-archive and offline-seek qualification.
M05 has a revision-pinned, cancellable render queue, menu-opened
worker preview and delivery, transparent PNG sequences, and browser MP4/WebM
round trips. The queue survives dialog closure and project switches, serializes
one renderer, and bounds retained intent and downloads. Retry retains the original
revision and obtains a fresh destination. Failed active native cancellation retains
the destination cleanup capability: **Retry Output Cleanup** must succeed before
removing the job or retrying its original revision. Queue disposal also retains
failed cleanup for another attempt. Header/publication failure and a real browser
render-to-queue workflow cover this ownership. Shared bounded PCM mixing, an audio sample clock, retained-media
decoding, and audio/video muxing pass a menu-driven media import, save/reopen,
preview, export, and re-import workflow. WebM declares its millisecond container
timing resolution. The separate float-carrier native helper and own-origin
desktop delivery pass a packaged Linux ProRes 4444 publication smoke test with
authenticated PCM24 audio. Other desktop targets remain unqualified. Flat MOV
delivery admits at most 32,768 frames so its retained sample index is bounded.
The [sustained drivers](motionscaper-sustained-browser-native-qualification.md)
measure worker preview, retained PCM and physical browser/native output as
duration grows. The c80 native 300/1,200-frame success was reported before the
reboot; its receipts are lost. The c80 browser verifier failed; source 328 fixes
its loader, but fresh qualification and maximum-workload evidence remain pending.
Preview and render leases retain bounded digest-bound font providers.
M06 has menu-opened layer/audio timelines, property/keyframe editing, portable
clipboard commands, and exact source timing. Opt-in value/speed graphs and
spatial/path editing pass actual browser workflows, including pixel preview,
undo, and save/reopen. Ordered shape operators and shaped text animators have
actual CanvasKit and worker/CPU preview coverage and menu-opened operator editing.
Exact work areas, composition selection, retained cross-project clipboard, and
source timing/remapping pass browser editing, history and reopen workflows.
The opt-in Composition Canvas has direct selection, move/scale/rotate handles,
parent-coordinate conversion, keyboard controls and one-step Undo for static 2D
transforms. A maintained title-and-shape browser workflow combines retained fonts,
fill editing, canvas manipulation, eased curves, null parenting and nesting, then
saves/reopens and exports PNG pixels matching preview within one channel code.
M07 includes bounded local masks, ordered effects,
alpha/luma mattes, backdrop adjustments, revision-bound tracking commands, and
projective corner pins. Tracking freshness stops preview/export before resource
acquisition; point analysis/correction, planar pins, stabilization, cancellation,
history and reopen pass menu-driven workflows using actual encoded footage.
Keyed footage with a corrected animated mask, a tracked overlay and a planar
corner pin survive save/reopen and produce delivered PNG pixels identical to
the matching preview frames.
Menu-opened masks, effects, blend modes, mattes and adjustments pass browser
editing and property-animation workflows. Timeline layer lifecycle controls
rename without rebinding expressions, enable/disable picture layers, mute
retained footage audio and remove dependency-closed selections with atomic Undo.
Chromium verifies referenced opacity pixels, removal refusal and Save/reopen.
M08
includes a closed expression parser/interpreter, shared exact scene/audio
clocks, stable references, bounded queries, and atomic source/baking commands;
bounded native-PCM amplitude now drives preview/export pixels and mixed gain,
with asynchronous baking and expression asset custody. Menu-driven source
editing, diagnostics, evaluation and baking pass browser preview, history and
reopen workflows, including retained PCM amplitude and cancellation. M09 has perspective/orthographic cameras, depth-sorted translucent
planes, linear-SDR materials/lights, transparent shadow casters and deterministic
thin-lens sampling. Actual worker/WebGL and host/CPU preview fixtures agree;
matching-quality shutter/lens preview and final export agree, including exact
nested quality and arbitrary seeks. Menu-driven camera, lighting, material and
quality authoring pass actual Chromium preview, undo/redo and save/reopen.
The [packaged Linux scene qualification](motionscaper-native-scene-qualification.md)
drives real native file dialogs and the unchanged encoder, with authored camera,
light, shadow, shutter and lens quality. Software preview and decoded ProRes agree
within declared color/alpha bounds and retain exact rational frame timestamps.
Hardware GPU and remaining native platform qualification remain open.
The [Linux package CI gate](motionscaper-linux-ci-qualification.md) now requires
real native launch, this authored scene and offline successor picture/PCM
delivery for candidate/nightly Linux artifacts. A complete local x64 aggregate
produced all four source-bound receipts. ARM64 execution and other targets
still need actual receipts; configuring those jobs does not qualify them.
M10 has versioned composition
offers, bounded streamed closure verification, compatible/pending update and
Undo/Resume rules, and atomic receiver-owned successor storage with retained
historical revisions, with atomic owning-project/history CAS and private
preparations. Saved-revision picture and PCM adapters use the shared scene and
retained bytes after offline receiver reopen. The explicit successor browser
shell exposes composition connections through File, with paired picture/PCM
placement, atomic editing and Undo/Redo, and lazy exact preview/delivery.
Authenticated generated video sources pass the actual Frame finishing exporter
without encoded proxy bodies. Fresh and edited family-v2 archives export and
import with retained ordinary media and linked closure; Chromium covers failed
publication, retry, reopen, deliberate media-cache loss and portable re-export.
The successor site builds within unchanged startup and chunk limits. Generated
bin thumbnails, exact filmstrips and muted source-monitor Play/Pause/Mark use
the retained renderer without encoded proxy URLs. Standard File Copy/Replace
retain original archives, rebind conflicting ordinary media and fence atomic
owner publication; focused tests cover complete cache recovery and prior-v1
custody. The dedicated real-editor browser gate covers saved sender updates,
Undo/Resume, width Conform, portable File Save/Open and offline reopen. Actual
video delivery now passes fresh portable reopen and decoded MP4 pixels matching
the blue preview. Duration/FPS Conform has an exact fit-window review, unchanged
intent on Cancel, stale-review refusal, atomic Apply and one-step Undo. The
packaged Linux x64 GTK/X11 saved-file link passes actual chooser, watch-generation,
closed-dialog update, corruption refusal and Disconnect custody checks. Native
generated-source delivery now has a real [Linux package qualification](motionscaper-successor-native-delivery.md):
offline owner reopen after removing the original source, actual GTK Save,
authenticated ProRes pictures and mixed PCM, exact timing and decoded pixels
matching the software WebGL preview within one display code. A subsequent actual
Chromium workflow verifies complete CPU finishing preview for retained linked
compositions when WebGL is unavailable or loses its context, context restoration,
offline receiver reload, and clearing the picture for a new document. Preview
converts declared Rec.709 finishing bytes to sRGB without changing delivery bytes.
Complete CPU finishing also covers retained timeline-image layers mixed with
linked scenes, through the same authenticated supplemental-picture executor as
export. Actual Chromium disables WebGL2 globally and verifies File Open,
animated-image playback, Stop, reopen and project replacement. Exact NTSC
random-seek pixels match export in either painter order. Inherited Frame
adjustment effects that require WebGL2 remain an explicit unavailable-render
error when WebGL2 is absent; no incomplete frame is reported as rendered.
The remaining native platform matrix remains unfinished.
M11 has a bounded
exchange schema, custody/report validation, readable installed-AE exporter and
limited importer scripts with media digest verification, a bounded script
download, explicit numeric sampling and limited editable exchange conversion.
Editable path geometry and hard-edge masks have bidirectional conversion,
closed host metadata, readable ES3 scripts, and a real Chromium bridge
import/pixel/save/reverse-package workflow. Unsupported temporal/path topology,
feathering and expansion remain explicitly reported.
Normal, Multiply, Screen, Overlay, Darken, Lighten and Difference have closed
bidirectional blend mappings with readable host preflight and readback. Chromium
verifies import pixels, Save/reopen and reverse packages. Non-neutral compositing
switches, adjustment/3D semantics and other blends remain inert report items
with original custody. These structural checks do not establish installed-AE
blend or color/alpha parity.
Gaussian Blur 2 exchange requires an explicitly selected reviewed profile for
the exact AE version, build and language, with a complete bounded neutral control
tree and a declared blurriness-to-sigma scale. Readable calibration/export/import
scripts verify fresh AV switches, effect controls, authored hold/linear keys and
readback, rolling back failed writes. The File workflow verifies mismatch refusal,
review invalidation, Save/reopen custody and reverse-package values. This is a
structural editable subset; installed-AE kernel, bounds, color and alpha parity
remain unqualified, with complete rendered fallback available.
Reviewed editable paragraph text includes retained font bytes, explicit PostScript
bindings, source custody and a real Chromium import/save/reopen/reverse-package
workflow. The readable host importer preflights fonts before mutation and requires
AE 24.6 or newer for text. Ordered shape project conversion is wired in both
directions; readable installed-host shape creation preflights an exact reviewed
version/build/language style profile, ordered path/paint operations and admitted
keys before mutation. Named style readback failures roll back new objects.
Separate menu-dialog expression opt-ins translate closed scalar opacity syntax
with explicit percentage units and preserved keys/source custody. Independent
ES3 validation precedes host activation, with error/nonfinite checks at one
bounded sample and owned-object rollback. Chromium exchange and Save/reopen
reproduce the authored opacity pixels. These structural checks do not qualify
installed AE expression, style, color or subframe fidelity.
Atomic import retains original exchange/report custody and every media file
through normal Save/reopen and portable archives, including unsupported null
placeholders. The opt-in File bridge workflow passes actual Chromium import,
preview-pixel, save/reopen, original-media custody and refusal checks; AEP/AEPX
selection routes to installed-AE guidance. The explicit whole-composition PNG
fallback has a bounded installed-host adapter, generated entry and complete
256-frame image-layer carrier with distinct-frame Chromium pixel checks.
The reverse [rendered Motion-to-AE transfer](motionscaper-ae-render-transfer-qualification.md)
uses full authored shutter/lens quality at every frame, verifies frame bytes
against normal PNG delivery, and retains the complete original project and
source media. Refusal, cancellation and failed output cleanup publish no package.
Installed-AE settings/cancellation/color/alpha and actual export/re-import
reference qualification remain unfinished. Additional composition authoring passes an actual nested picture/PCM
preview and save/reopen workflow; retained font and gradient authoring pass
Chromium pixel/history workflows.
Fresh source-328 Motion Node tests passed all 953 cases. All 139 Motion-named
Chromium cases passed within an unfinished full run with other-product failures.
These results do not close a package; complete accepted coverage remains pending.
The [platform fixture](motionscaper-platform-qualification.md) passes twelve
actual Chromium, Firefox and Linux WebKit workflows covering keyboard menus,
retained fonts, authored keys, Save/reopen, same-engine PNG/preview and offline
reopen with the origin shut down. Chromium and Firefox produce actual VP9 WebM;
Linux WebKit refuses before an independently reproduced native encoder crash.
Different engines' whole-frame hashes are not claimed identical. Maximum
workloads, full existing-product regression, hardware GPU, macOS Safari and
credentialed native distribution still require their own gates.
The capability register owns Motion's independent workspace and bounded claims.
Own Pages tables, stable-release and source-bound deployment preparation exist;
activation/publication and credentialed target qualification remain separate.

The current [2.5D rendering contract](motionscaper-2-5d-rendering.md) declares
M09's camera, depth-group, lighting and quality semantics. It does not claim
After Effects pixel parity.

The current [composition link foundations](motionscaper-composition-links.md)
declare M10's revision, closure, history and rendering authority. Fresh
bounded Linux delivery has source-328 evidence; full browser editing,
duration, remaining target and hardware qualification remain open.

During implementation, run only Motionscaper-specific tests. Run the complete
repository and existing-product regression gates at M12. Keep at most ten
task worktrees active and remove each after its work is integrated and it is
no longer needed. The integration worktree is `Soundscaper-motionscaper`.

## M01. Product registration and platform seams

**Deliverables:** register `motionscaper` throughout product identity, profiles,
capabilities, bootstrap selection, build aliases, release lines, routes, offline
shells, icons, locale handling, handbook generation, desktop packaging, and CI.
Replace binary product/peer switches with explicit product selection. Preserve
the reserved Lightscaper suffix and its separate roadmap scope.

Give Motionscaper separate storage and lock namespaces, desktop user data,
scheme, updater identity, and native-service admission. Use
`org.motionscaper.desktop` as the application ID and `motionscaper.org` as the
default configurable web origin. Domain provisioning and publication follow
the existing release process; normal editing requires no cloud account.
Add a Motionscaper Node-test owner and browser/desktop test-site support.

**Completion gate:** the browser and packaged desktop shells boot with the
correct identity; existing products still boot; libraries and locks are
isolated; build selection includes only the intended product bootstrap. Motion
capabilities remain unavailable until their owning packages land.

## M02. Project, asset, and migration contracts

**Deliverables:** introduce `{ schemaFamily: 'motionscaper', schemaVersion: 1 }`
and `.mscape`, using Scape container format 1. Define typed compositions,
ordered layers, parent/precomposition relationships, property animation,
media/font assets, and immutable revisions. Layer kinds cover footage, images,
text, shapes, solids, nulls, adjustments, precompositions, cameras, and lights.
Keep renderer state and source-discovery capabilities out of persisted intent.

Own validation, commands, history, storage, project locks, asset retention, and
archive assembly through a Motionscaper runtime profile. Preserve foreign/future
families under the established read-only custody rules; suffixes are routing
hints, never schema authority.

Introduce Framescaper family v2 on the **1.1 successor development line**, with
a typed source-to-composition link relation. Replace the global current-schema
version with per-family versions. Soundscaper remains family v1. Migrate
Framescaper v1 transactionally into the successor namespace, retaining the
original bytes and project identity and recovering idempotently after
interruption. Do not put this schema change into the current Framescaper 1.0
RC/stable line.

A link records stable project/composition identity, accepted revision and
digest, output timing/canvas/color/alpha contract, and a content-addressed
snapshot with its complete dependencies. Paths, handles, tokens, and transport
sessions remain platform-local. Do not hide executable link semantics in
`opaqueExtensions`.

**Completion gate:** ordinary and malformed projects, archive round trips,
foreign/future custody, asset retention, and interrupted migrations are tested.
A saved composition preserves all declared layer/property kinds, even before
their authoring UI is enabled. Existing family-v1 archives stay recoverable.

## M03. Composition evaluation

**Deliverables:** compile a revision into a cycle-checked composition/property
graph and evaluate it at exact rational time. Resolve layer timing, parenting,
precompositions, animation, time remapping, audio synchronization, and effect
order into renderer-neutral frame state. Add typed scalar, vector, color, and
path animation; reuse existing timing and scalar interpolation primitives.

Use the same evaluator for playback, arbitrary seeking, thumbnails, offline
export, and linked Framescaper sources. Declare effect/mask/transform ordering
once and produce a consumption ledger so a renderer cannot silently omit
authored operations. Expression and 2.5D implementations extend this graph in
M08/M09 rather than creating a second evaluator.

**Completion gate:** nested/mixed-rate timing, parent transforms, cycle
rejection, retiming, and evaluation after random seeks agree across consumers.
Trim, split, clipboard, undo/redo, and save/reopen preserve animation authority.

## M04. Typography, vectors, and 2D rasterization

**Deliverables:** add pinned, lazily loaded CanvasKit WASM for real paragraph
shaping and vector rasterization. Bundle licensed fallback fonts and retain
imported font bytes as digest-bound assets; system font availability is not
document authority. Replace the placeholder-glyph path for Motionscaper.

Rasterize text, primitives, Bezier paths, fills, strokes, gradients, clipping,
and isolated precomposition surfaces. Add the dedicated WebGL2 composition
renderer using linear-light SDR, floating-point working surfaces, premultiplied
alpha, and explicit output conversion. Provide a CPU reference/fallback path
with the same composition semantics.

**Completion gate:** readable multilingual text, ligatures, line wrapping,
font portability, vector geometry, blend formulas, and alpha edges have
reference-frame coverage. Preview and full-quality rasterization agree at the
same time, resolution, and quality settings. Runtime assets load lazily and
remain available offline after installation/caching.

## M05. Preview, delivery, and render queue

**Deliverables:** connect the evaluator and renderer to preview/playback and
export through bounded decode/render queues. Add minimal menu actions to create
a composition and add media, text, and shapes so this package's workflow is
usable before the full M06 authoring workspace. Use a persistent worker and
OffscreenCanvas where supported, with a canvas-host adapter otherwise. Include
seeking, cache eviction, cancellation, context-loss recovery, and progress in
the menu-opened workflow.

Deliver browser MP4/WebM plus transparent PNG sequences, and desktop ProRes
4444 through the existing native delivery services. Add a separately versioned
high-precision native frame adapter with explicit color/alpha metadata; retain
the existing RGBA8 contract. Pin one project revision for each render task and
retain its dependency closure until completion/cancellation.

**Completion gate:** a user creates, saves, previews, and exports a basic
composition through menus on both platforms. Reference frames and transparent
output round trips agree; cancellation and recovery leave no partial project
publication; memory remains bounded as output duration grows.

## M06. Layer and animation authoring

**Deliverables:** implement the menu-opened composition/layer workspace,
selection and direct manipulation, property inspection, layer order/timing,
parenting/nulls, precomposition creation, time remapping, audio playback,
work areas, duplication, and clipboard workflows.

Add graphical value/speed editors, keyframe selection and transfer, hold,
linear, eased, and Bezier interpolation, and editable spatial motion paths.
Add shape operators for trim paths, repeaters, boolean operations, and
compatible-path morphing. Reject incompatible morph topology with an actionable
diagnostic. Text animators operate on shaped character clusters, words, and
lines and expose position, scale, rotation, opacity, color, and tracking.

**Completion gate:** a maintained browser workflow builds a readable animated
title and shape composition, edits its curves, parents it to a null, nests it,
saves/reopens it, and exports it. Undo/redo, keyboard navigation, focus,
accessible controls, and shaping-preserving text animation are covered.

## M07. Compositing and motion-design VFX

**Deliverables:** expose animated masks, feathering, alpha/luma mattes, blend
modes, adjustment layers, and ordered effect stacks. Reuse registered effects
through narrow adapters and preserve their native/platform availability rules.

Reuse point tracking and stabilization foundations; add planar tracking and
corner pinning. Provide chroma keying and editable animated-mask workflows with
manual corrections. Bind analysis results to source/settings digests and
surface stale analysis before applying or exporting it.

**Completion gate:** tracked overlays, planar corner pins, keyed footage, and
manually corrected masks survive history and reopen and render identically in
preview/export. Missing mattes, cyclic references, stale analysis, and
unavailable effects produce explicit diagnostics without losing authored state.

## M08. Expressions and procedural animation

**Deliverables:** parse and interpret a closed JavaScript-style AST supporting
arithmetic, vectors, conditionals, typed property links, time, `valueAtTime`,
looping, easing, seeded random/noise/wiggle, and audio amplitude. Resolve
property links to stable identities. Detect cycles and bound evaluation work.

Expose expression editing, diagnostics, and baking through menus. Keep invalid
expressions editable; block final export with actionable errors. Expressions
have no DOM, network, filesystem, arbitrary imports, host `eval`, or mutable
state carried between evaluated frames.

**Completion gate:** seeking and sequential rendering yield the same values;
renaming referenced layers preserves links; cycles, malformed expressions,
resource exhaustion, cancellation, audio timing, and baking are tested.

## M09. 2.5D cameras, lights, and temporal rendering

**Deliverables:** extend evaluated layers with 3D transforms and material
response; add perspective/orthographic cameras, ambient/point/spot lights,
shadows, depth of field, and depth-aware compositing of translucent planes.
Keep precompositions isolated and transform their output as a layer.

Motion blur evaluates the scene within a declared shutter interval. Preview
may use explicitly reduced quality; final rendering uses the selected output
quality. Temporal sampling must preserve expression determinism and remain
independent of prior playback.

**Completion gate:** camera animation, parented 3D layers, intersecting
translucent planes, shadows, depth of field, and motion blur have reference
fixtures. Matching-quality preview/export results agree on browser and desktop;
unsupported GPU capabilities take the declared fallback or report refusal.

## M10. Linked Framescaper compositions

**Deliverables:** implement a separate versioned link protocol. Browser
linking opens a dedicated top-level bridge, verifies the peer origin/window,
and uses same-origin communication with its own editor. Preserve editor COOP/
COEP isolation and product library separation. Desktop linking watches an
explicitly selected `.mscape` through main-process capabilities, including
authorized atomic file replacement and generation renewal.

Explicit successful Save publishes a revision; recovery autosaves do not.
On desktop, normal Save updates the bound `.mscape` before publication. On the
web, publication follows durable project commit. Transfer and validate the
immutable snapshot and complete asset closure before accepting an update.

Framescaper places/trims/retimes/finishes the linked source; Motionscaper edits
its contents. Accept compatible saved revisions automatically while connected,
as one undo step. Timing, dimensions, or duration changes remain pending until
a menu-driven conform action. Undo pauses that link's automatic acceptance
until Resume. Renaming a composition preserves its link; deletion, disconnect,
save failure, and corrupt/partial updates preserve the accepted revision.

Route linked sources through the shared evaluator in both preview and final
export, including native delivery. Retain snapshots/assets referenced by
history or active exports. Archives package the entire closure for offline
rendering; destination ownership remaps without changing external composition
identity. Allow Motionscaper-to-Framescaper render dependencies initially and
reject cycles. Exports pin their starting revision throughout the task.

**Completion gate:** saved edits update a connected Framescaper project;
closing Motionscaper leaves preview/export working. Test offline archive
reopen, reconnect, interrupted transfer, atomic saves, incompatible updates,
undo/resume, concurrent export, asset retention, and cross-origin isolation.

## M11. After Effects interchange bridge

**Deliverables:** provide readable ExtendScript exporter/importer scripts run
through installed After Effects and a versioned exchange package with media
references. Reconstruct supported compositions, footage, parenting, transforms,
keyframes/easing, text, shape paths, masks/mattes, cameras, lights, blend modes,
and explicitly mapped effects as editable content.

Translate the supported expression subset. Offer sampled keyframes or
AE-rendered media for unsupported constructs; bake a complete composition when
cross-layer dependencies make layer-level baking incorrect. Preserve source
projects and emit a report distinguishing editable, sampled, rendered, and
unsupported content, including missing media/fonts. Direct `.aep` selection
leads to the bridge workflow rather than claiming native project support.

**Completion gate:** real AE-generated fixtures and actual AE re-imports
qualify the supported subset. Compare editable structure and reference frames;
test missing assets, unsupported plug-ins, expression baking, repeat transfers,
and source preservation. Publish the tested AE version/feature matrix. Mocks
alone cannot close this package; unavailable AE qualification remains an
explicit incomplete gate.

## M12. Distribution and release qualification

**Deliverables:** finish browser/offline and Electron distributions, signing,
updater configuration, icons, file associations, help links, English/German
copy, generated translations, and handbook workflows. Register implemented
capabilities and their evidence in the owning machine-readable policies.
Preserve third-party notices, source pins, and reproducibility workflows.

Use Node 26.5.0 and npm 12.0.1, preserve `package-lock.json`, and update it with
dependency metadata. Keep FFmpeg runtime assets outside the Pages bundle and
retain semantic chunk ownership. Add a Motionscaper startup budget under the
existing family maxima; preserve initial-page and existing-product ceilings,
the 500,000-byte JavaScript chunk limit, file-size ratchets, and coverage floors.

**Completion gate:** run `npm run lint:changed`, full lint for the shared
type/configuration/dependency changes, `npm run check`, `npm run test:browser`,
and appropriate packaged-desktop qualification. Exercise complete editing,
delivery, linking, Adobe exchange, keyboard/accessibility, and existing-product
regressions. Update generated references and translations through their tools,
regenerate policy narratives from registers, and repin digest-bound runtime
evidence when its owning files change. The first-release gate closes only when
M01–M11 and these automated/compatibility gates are complete; publication uses
the [existing release process](../operations/release.md).

## Runtime asset handoff

This implementation-order document and the agreed scope do **not** require a
manual **Update AI assets** run: no assistance-engine closure change is planned.
CanvasKit and native rendering changes require their own asset builds and
audits. Reassess the AI-assets requirement if implementation changes assistance
runtime source pins, recipes, patches, bundled dependencies, archive/signing
logic, or target inventories. If required, use the AGENTS.md handoff procedure
and commit the refreshed desktop-test runtime snapshots.

## Reference contracts

- [Architecture and maintainability](../architecture/overview.md)
- [Time and media](../architecture/time-and-media.md)
- [Production and rendering](../architecture/production-rendering.md)
- [Native services](../architecture/native-services.md)
- [Delivery and interchange](../architecture/delivery-and-interchange.md)
- [Family-v1 baseline](../decisions/project-family-v1.md)
- [Product origins and handoff](../decisions/product-origins.md)
- [Project compatibility](../policies/project-compatibility.md)
- [CanvasKit documentation](https://docs.skia.org/docs/user/modules/canvaskit/)
- [Adobe project formats](https://helpx.adobe.com/mena_en/after-effects/desktop/work-with-projects/after-effects-projects/projects.html)
- [Adobe script workflow](https://helpx.adobe.com/after-effects/desktop/automate-in-after-effects/automate-animation/scripts.html)
- [Adobe SDK third-party-host limitations](https://ae-plugins.docsforadobe.dev/ppro/other-hosts/)
