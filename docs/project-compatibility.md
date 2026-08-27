# Project compatibility contract

The versioned source of truth is
[`config/project-compatibility.json`](../config/project-compatibility.json).
Its statuses distinguish behavior enforced today from outcomes owned by later
roadmap milestones. A planned row is a release requirement, not permission to
discard state until that row is implemented.

The milestone-2 closure inventory names nine media-relationship IDs; each maps
to one documented relationship here. `owned-canonical-pcm` and
`owned-retained-video` are the managed mixed-media handoff bodies of the shared
desktop persistence section. `linked-pcm` and `linked-retained-video` are the
linked originals of that same section; both convert to recipient-owned media on
handoff by design, and only linked PCM has a portable-archive route.
`project-audio-mix-v1`, `audio-track-render-v1`, `project-video-render-v1`, and
`video-clip-render-v1` are the closed rendered-fallback roles of the project
feature-requirements section. `disposable-preview-nonportable` is the
disposable video preview relationship.

## Core document versus `.scape`

The core project loader and the portable archive are separate compatibility
boundaries.

- A raw project object whose `schemaVersion` is newer than the maintained
  version is structured-cloned and returned read-only with reason
  `newer-schema`. It is not normalized through the current schema.
- A format-1 archive carrying a project schema greater than 17 opens read-only
  without graph interpretation: the importer returns the unmutated document
  before collision or source-identity rewriting, asset extraction, or store
  publication, and the retained original archive saves as an exact byte copy
  through the maintained save-copy action, so IDs, storage keys, binary state,
  and unknown entries survive byte-identically. Editing and repacking remain
  refused.
- A future `.scape` `formatVersion` is rejected before project persistence.
  Container-version support is never inferred from the inner project version.
- Current-format exact schema 17 `.scape` round trips promise JSON-semantic
  equality plus byte-exact preservation for the supported bounded tagged binary
  types described below. They do not promise byte-for-byte `project.json`
  equality, ZIP entry ordering, timestamps, or JSON formatting.

Read-only means that commands, autosave, overwrite, and migration publication
must remain disabled. A future document may be inspected or exported unchanged
only through a path proven not to normalize it. “Save a copy” may not silently
turn an unknown schema into the current schema.

One narrow linked-PCM portable-archive exception applies only to the
current-format exact schema 17 path. Under the 512 MiB linked-original ceiling,
a sender may be backed by a maintained RIFF/RF64 PCM or IEEE-float WAV, a
first-party BW64 integer-PCM `.wav`, or classic FORM/AIFF signed big-endian
integer PCM at 8, 16, 24, or 32 bits, or canonical first-party FORM/AIFC v1
`fl32` 32-bit floating point admitted only as exact `.aif` or `.aiff` plus
`audio/aiff`. It retains no owned PCM. Export reads its verified canonical
chunks and writes only a canonical `audio-f32le-chunks-v1` asset. External
container bytes and pathless locator identity are absent from the archive.
A maintained Electron chooser and initial bind still materialize one whole
source snapshot. After that binding commits, archive source reads acquire an
owner-scoped exact-revision range capability, hash the complete source in exact
at-most-4-MiB reads, recheck the binding, and decode through a range-backed
RIFF/RF64/BW64, classic AIFF, or canonical first-party AIFF-C source without
constructing another whole-original `Blob`. Classic AIFF admission and every
later read require bounded FORM/AIFF, COMM, and SSND structure. The AIFF-C
profile requires one four-byte FVER v1 (`0xA2805140`) before an exact 44-byte
COMM carrying 32-bit `fl32` and the exact Pascal compression name `32-bit
floating point`, plus structurally consistent SSND geometry. The first-party
label describes the maintained fixture, not authenticated provenance:
admission is producer-neutral and accepts any producer emitting that exact
tuple. Broader, compressed, and other AIFF-C profiles reject; broader
third-party interoperability and producer provenance are unqualified. A generic
platform port without the optional range operation retains the whole-`Blob`
source-reader fallback.
A fresh recipient without a linked-original port imports that asset through the
ordinary owned PCM writer,
then can close and reopen, recovering exact samples and project state with zero
linked bindings. The direct fixtures use first-party BW64 integer PCM, classic
AIFF, and canonical first-party AIFF-C float32; focused reader and import
coverage owns the maintained RIFF/RF64 PCM and IEEE-float, first-party BW64
integer-PCM, classic AIFF integer-PCM, and canonical first-party AIFF-C float32
input boundary.

This portable exception does not qualify future-schema archive preservation,
byte-exact external-container preservation or reconstruction, AIFF metadata
preservation, broader or compressed AIFC, third-party AIFC interoperability and
provenance, the `.aifc` extension, packaged executable or UI and operating-system
behavior, reference-scale evidence, relink or watch, other
audio formats, arbitrary third-party BW64, new BW64 ADM preservation or editing
semantics, a durable immutable byte lease, or range support outside maintained
post-bind Electron linked-PCM source reads.
Canonical PCM portability is the contract; the selected external container is
neither transferred nor reconstructed.

## Product-native project file suffixes

Soundscaper writes `.sscape`, Framescaper writes `.fscape`, and the
roadmap-only Lightscaper reserves `.liscape`. Every product accepts all three
plus the legacy `.scape`, case-insensitively, so a project archive is never
refused for carrying the suffix another product gave it.

- A suffix is a routing hint only. Manifest, schema, capability, and digest
  validation remain the authority on what a file is, and a disguised terminal
  name such as `mix.sscape.zip` is not a project.
- Saving replaces any recognized project suffix with the active product's and
  otherwise appends it, so a Soundscaper `Mix.sscape` saved from Framescaper
  becomes `Mix.fscape`. A retained future-schema archive is renamed the same
  way and still copied byte for byte.
- Save pickers and operating-system associations advertise only the active
  product's suffix plus legacy `.scape`. Neither shipping app claims
  `.liscape`.
- Every accepted suffix takes the 65 GiB `scape-range-v1` desktop read profile;
  none falls back to bounded materialization.

The archive itself is unchanged. The shared Scape schema, the
`application/vnd.soundscaper.scape+zip` media type, the `scape-project` format,
the `scape-range-v1` profile, and the `.scapefx` plug-in suffix all keep their
existing values, and no migration or format-version bump is involved. Legacy
`.scape` opening has no sunset; production code simply never emits it.

## Framescaper F31 product isolation

<!-- policy-narrative:framescaper-v18-product-isolation -->
The maintained Framescaper bootstrap authenticates selected exact F31 before
constructing its project environment on browser and packaged desktop routes. F31
owns create, clone, validation, commands, one-step history, session, Clipboard
V12, repository, playback, compatibility, Scape custody, product-isolated
storage and assistance-asset custody while delegating its inherited
retime/proxy, dissolve, visual, editorial, finishing, professional-source,
OpenFX and unified exact V14 render behavior through an immutable exact V28
foundation. Packaged desktop authenticates library V20, SQLite user_version 22,
scope v20, and the schema-31 renderer behind the unchanged public
framescaperDesktop.v1 bridge. When V20 is absent, first open treats a settled
V19 store as its immutable direct source, opens it read-only, authenticates
exact V28 documents, explicitly reimports them into F31, copies every referenced
managed body byte-for-byte through durable cursor checkpoints, resumes
idempotently after interruption, and never rewrites or deletes V19 or its
inherited V18, V17 and V12 lineages, leases, or journals. V20 through V24
require their historical reimport route before V27-to-V28 and V28-to-F31
reimport; V25 and V26 remain descriptor-snapshotted opaque read-only custody
with no candidate validation dispatch, and unowned V29/V30 remain opaque
read-only. Soundscaper separately authenticates exact project S30 and desktop
library V11, inherits its established project behavior through exact S29, and
treats Framescaper schemas as read-only. Cross-product preservation never grants
edit, activation, migration, native feature authority, shared catalog authority,
or release qualification.
<!-- /policy-narrative:framescaper-v18-product-isolation -->

## Current local-assistance transcript custody

<!-- policy-narrative:current-local-assistance-transcript-custody -->
Selected Soundscaper S30 and Framescaper F31 own the closed assistanceAssets
collection, org.soundscaper.capability.assistance-assets, and the additive
AssistanceWorkflow v1 bridge while preserving operation-v1 consumers. Analyze ->
Local Assistance exposes thirteen Guided recipes and an opt-in Advanced view of
the existing fifteen primitives; Tools -> Local Models -> Manage Models remains
the only installation surface, and no browser route runs inference. One
main-owned consent authority binds the exact selection, permitted stage graph,
model artifacts, slotted inputs and outputs, settings and recipe versions,
linked occurrences, source ranges, timing and retime authority, and transcript
body in an aggregate fence that is revalidated before disposable publication and
again before acceptance. Existing catalog-authenticated Parakeet, Silero VAD,
Pyannote-plus-ERes2Net diarization through Sherpa, deterministic cleanup, and
model-free admitted external-FFmpeg fast shots remain executable. Conditional
isolated workers and owned deterministic stages implement Whisper with
English-only wav2vec2 alignment, DeepFilterNet enhancement, TIGER D/M/E
separation, PANNs reactions, Beat This beats and held-tempo proposals,
TransNetV2 accurate shots, nomic transcript search, SigLIP and PP-OCR visual
search, YuNet/D-FINE/ByteTrack/U2-Net reframe, deterministic highlight ranking,
and bounded grammar-constrained Qwen editorial text. Missing model, runtime,
platform, conversion, or catalog authority returns typed unavailability without
implicit installation, upstream fetch, substitution, fabricated output, or
canonical mutation. Adapter-owned preparation retains exact channel and
sample-rate geometry, bounded long-media chunks stay under one whole-selection
fence, and strict semantic reviewers reject malformed, oversized, nonfinite,
unordered, corrupt, stale, or wrong-role results. Project-isolated disposable
custody holds embeddings, OCR and tags, shot tables, saliency and tracker state,
accepted reframe evidence, and ranking checkpoints without changing .scape.
Explicit review starts proposals unselected and publishes through ordinary
one-step commands: transcript and caption replacement, link-aware cleanup,
anonymous speakers, derived enhancement or D/M/E media, reactions, beats and
representable tempo, shot annotations, crop and keyframes, and editable
highlight sequences. Unaccepted indexes and raw Qwen output never become project
state; accepted editorial fields are bounded inert text only. Transcript bodies
retain digest-bound .scape custody and AUP4 reports their omission explicitly.
Web routes retain and edit accepted ordinary project state but expose neither
model installation nor inference. Only selected S30 and F31 profiles advertise
the maintained workflow and acceptance commands; generic and historical profiles
gain no authority. The converted TIGER, PANNs, Beat This, and TransNetV2
artifacts and live parity, externally signed catalog entries, all five ONNX
Runtime/whisper.cpp/llama.cpp target payload closures, Windows-arm64 Sherpa
addon, immutable EU R2 publication and full public digest read-back, packaged
canaries, privacy workload, and owner-lab evidence remain pending-external.
Licensing, catalog-signature, artifact-integrity, runtime/platform,
selected-media, storage-integrity, explicit-consent, and external-executable
gates remain fail closed; manual and owner-lab qualification is documentary,
nonblocking, unprovisioned, and open.
<!-- /policy-narrative:current-local-assistance-transcript-custody -->

## Framescaper V22–V30 compatibility and custody

<!-- policy-narrative:framescaper-v22-v26-compatibility-custody -->
Selected F31 explicitly reimports exact V28 documents through the
generation-owned validator and constructs new F31 authority; it never edits or
silently upgrades the source document. Historical V28 in turn owns the explicit
V27 reimport foundation. V22, V23 and V24 remain opaque custody at the direct
F31 boundary. V25 and V26 are recognized descriptor-snapshotted opaque read-only
custody: selected F31 does not dispatch their candidate validators, migrate,
author, save, overwrite, activate, or infer native-media or OpenFX authority
from them. V29 and V30 are unowned opaque read-only versions with no migration
or authoring route. Dormant candidate repositories remain exact-write only under
authenticated historical profiles. F31 delegates native-source and OpenFX
behavior through its immutable exact V28 foundation, but unavailable runtime
requirements remain visible, preserved and default-off; custody grants no
payload, third-party code, native execution, qualification, release, or
activation claim. Soundscaper and cross-product handoff may retain state
read-only but never acquire edit or migration authority.
<!-- /policy-narrative:framescaper-v22-v26-compatibility-custody -->

## Framescaper V18 nested-sequence compatibility

<!-- policy-narrative:framescaper-v18-nested-sequence-native -->
Exact V18 requires one dense subsequences collection. Its validator proves
stable identities, exact sequence ownership, bounded depth, cycle rejection,
canonical aliases, positive frame ranges, and exact composed rate mappings.
Nonempty state owns framescaper.nested-sequences for
org.soundscaper.capability.nested-sequences with bypass and no fallback;
Framescaper registers it native while Soundscaper registers it known
unavailable. Framescaper exposes add, update, and remove through a lazy
Tracks-menu subsequence menu, and its controller, commands, and history provide
one-step undo and redo. The runtime deterministically flattens shared aliases
into detached exact-V17 primary-sequence material, maps video and audio trims
only when their target grids are exact, preserves mixer routes, and feeds the
same result to playback and both rendered-fallback delivery projections. Clone,
local persistence, desktop V10, and Scape format 1 or 2 preserve the graph. The
session clipboard refuses a nonempty graph rather than flattening it, while
explicit Framescaper-to-Soundscaper transfer is copy-only preservation with
activation and editing forbidden; Soundscaper treats the V18 document as
newer-schema read-only and cannot author the field.
<!-- /policy-narrative:framescaper-v18-nested-sequence-native -->

## Framescaper V18 multicamera compatibility

<!-- policy-narrative:framescaper-v18-multicamera-native -->
Exact V18 requires one dense multicameraGroups collection. Each closed group
binds the project, one sequence, one unretimed output video clip and track, at
least two canonical video-source members, a stable active member, and signed
safe-integer sample-canonical sync offsets; duplicate output ownership,
unsupported automatic sync, retime, stale revisions, and stale active-member
fences reject. Nonempty state owns framescaper.multicamera for
org.soundscaper.capability.multicamera with bypass and no fallback; Framescaper
registers it native while Soundscaper registers it known unavailable. Create,
update, switch, nudge, and remove are reachable through the lazy Tracks-menu
multicamera submenu and route through controller history. Runtime selection
keeps the persisted output placement fixed and substitutes only the active
canonical original source. Exact CFR source boundaries are admitted directly;
verified timing evidence is mandatory for VFR, and even verified VFR refuses a
mapped time between exact presentation boundaries. Multicamera materialization
composes before nested flattening and feeds the same projection to playback and
both rendered-fallback delivery paths. Clone, history, local persistence, Scape,
and explicit copy-only cross-product preservation retain the groups; the session
clipboard refuses them rather than losing their ownership graph. Automatic sync
detection and proxy-source selection are not implemented.
<!-- /policy-narrative:framescaper-v18-multicamera-native -->

## Framescaper V18 video-proxy preservation

<!-- policy-narrative:framescaper-v18-video-proxy-preservation -->
Exact V18 validates one nullable proxyAttachment on every video source and
reconciles nonnull state to the owned framescaper.video-proxy requirement, which
Framescaper provides, so an attached document opens writable and its edits carry
or drop the attachment only while its source claim remains true. Claim-bound
repository publication, retention, startup maintenance, cleanup tombstones,
archive format 2, and the selected F31 body graph preserve each exact
proxy/timing pair while ordinary save cannot introduce or change a pointer. New
body publication writes the media row, durable unverified claim root, and
completed write lease in one transaction before bounded verification, preventing
an unrooted-body gap. Scape format 2 validates and stages canonical originals
plus proxy and timing bodies, while format 1 remains available only for
attachment-free V18. Desktop library V20 transfers exact bounded chunks through
its Framescaper/schema-31 handshake and reconciles the exact F31 shadow;
immutable V19/schema-28 remains its direct import source. Re-attestation
rehashes the bounded proxy and timing bodies, validates the timing reference and
summary, binds an ephemeral timing view, reruns exact conformance against the
current original, and mints process-local preview-only trust. Selected F31
delegates generation, attach, detach, relink, regenerate, and Original, Proxy,
or Auto selection through its exact V28 foundation to the lazy menu dialog. Its
scheduler reports bounded progress and cancellation; publication proves
candidates before stale-safe atomic history swaps. Before replacement or a
changed-original relink invalidates an attachment, it durably journals the exact
content-addressed proxy and timing body cleanup. Recovery resumes idempotently
after interruption, preserves a body still rooted by the current project, and
removes obsolete claims and bodies after successful regeneration or relink; a
failed regeneration cancels cleanup after history rollback, while manual detach
deliberately retains the body for one-step history. The maintained preview
resolver reattests each session, adapts under pressure, and can keep editing and
preview available from a valid proxy while the original is offline. Proxy
selection occurs in the source domain before occurrence retime. Browser export,
the V14 evaluated-RGBA carrier producer, and final delivery never select proxy
pictures and visibly refuse without an authenticated original. Desktop library
V20 delete and duplicate use the inherited main-first exact catalog
compare-and-swap core with alias-aware local-shadow reconciliation. Duplicate
retains the exact proxy and timing bodies through the F31 shadow. Delete
tombstones only catalog ownership and retains immutable revisions and bodies;
there is no physical reclamation, and it never reuses a project ID. Durable
delete intents resume exact local shadow and binding-row reconciliation after
restart. They do not durably capture pre-delete locator references: abrupt
process death before the outer linked-original drain can leave main-private
locator metadata for later cleanup, external files are never deleted, and crash-
or power-loss locator release remains unqualified. The maintained package
artifact smoke remains source-free and does not qualify packaged delete or
duplicate.
<!-- /policy-narrative:framescaper-v18-video-proxy-preservation -->

## Timeline annotation compatibility

<!-- policy-narrative:timeline-annotation-capability -->
Non-empty schema 17 timelineAnnotations state reconciles one reserved
soundscaper.timeline-annotations requirement for
org.soundscaper.capability.timeline-annotations with disposition bypass and no
fallback. Soundscaper and the selected Framescaper F31 profile register the
capability available, so current compatibility evaluation reports
available/native and the shared capability-gated command, controller, pointer
and keyboard UI, ripple-edit, clipboard, AUP/AUP4 label, and RIFF cue paths
author and preserve canonical markers and positive regions. F31 reviewed shot
acceptance also revalidates exact source and selection authority before
replacing only its owned in-selection markers through the ordinary annotation
command path. Historical Framescaper F18 through F28 profiles keep the
capability known but unavailable, so their owned documents retain
unavailable/bypassed preservation rather than acquiring native authority. The
capability remains excluded from both audio and video rendered-fallback sets,
and publisher-authored audio or video rendered fallback for it rejects.
Exact-V17 clone, validation, runtime projection, atomic command reconciliation,
current-format `.scape` persistence, and maintained desktop handoff preserve
authoritative annotation coordinates, order, selection, stable IDs, batch
identity, and opaque extensions within their tested interchange limits. Audacity
export reports losses that its label model cannot represent; RIFF export clips
or omits annotations at the selected media range and reports stable-ID, batch,
anchor, color, and opaque-extension loss. This rule claims no annotation
contribution to playback rendering, audio or video fallback, or semantic
preservation beyond the tested current-schema and interchange paths, and pending
manual qualification does not disable this bounded native path.
<!-- /policy-narrative:timeline-annotation-capability -->

## Nested track folder compatibility

Schema 17 persists closed top-level `trackFolders` metadata and authoritative
per-sequence `trackNodes`. Every sequence `trackIds` array and the project-wide
track and folder arrays must equal the exact preorder derived from those nodes;
validation rejects projection or metadata-order drift.

Nonempty folder state owns the reserved `soundscaper.track-folders` requirement
for `org.soundscaper.capability.track-folders`, with the fixed display name
`Nested track folders`, disposition `bypass`, and no fallback. Soundscaper and
Framescaper both register the capability known but unavailable, so nonempty
state is preserved through the existing read-only compatibility path. The
capability is not eligible for audio or video rendered fallback, and either
fallback kind rejects during manifest admission.

Before playback, audio render, video preview, or video export, a bounded
transient projection derives inherited folder mute, solo, and hidden state into
leaf track flags. It runs before rendered-fallback projections, carries private
trust across explicit transient clones, and rejects a forged marker before
hierarchy traversal. Canonical folder state, leaf-local state, routing, history,
and persistence stay unchanged; collapsed and height remain UI-only.

Empty-folder projects still carry mandatory root track nodes. Existing add,
remove, and within-sequence reorder commands reconcile that flat hierarchy
atomically. Cross-sequence reorder rejects instead of silently reparenting, and
structural legacy commands reject nonempty hierarchy instead of flattening it.
Clone, unrelated edit and undo/redo, local storage, current `.scape`, and the
fresh desktop V9 library preserve tested nonempty state exactly. Folder-aware
commands, clipboard behavior, and native UI are outside this slice.

## Probed source characteristics

<!-- policy-narrative:source-characteristics-capability -->
Every schema 17 video source carries a characteristics record stating what an
ingest probe reported: the reporting backend, coded frame size, rotation, pixel
aspect ratio, field order, alpha, video codec, colour primaries, transfer,
matrix and range, the bounded audio stream inventory with the stream ingest
extracted, and the source start timecode. An unreported characteristic persists
as an explicit null rather than a plausible default, so unknown rotation is not
zero and an unreported audio inventory is not an empty one. The record persists
only in its canonical normalized form; drift, an unsupported key, an
out-of-range value, a source start timecode the source rate cannot produce, and
a reported codec that disagrees with the legacy codec field it duplicates all
reject rather than repair. Any reported value reconciles the reserved
framescaper.source-characteristics requirement for
org.soundscaper.capability.source-characteristics with the fixed display name
Probed source characteristics, disposition bypass, and no fallback. Both
products ingest video through one path and register the capability available, so
the state reports available/native in Soundscaper and Framescaper alike; the
capability is excluded from both rendered-fallback eligibility sets and
publisher-authored audio or video fallback for it rejects at manifest admission.
Field order, colour, and the audio stream inventory are recorded for disclosure
and interchange, not conversion: this rule claims no deinterlacer, no colour
management, and no multi-stream audio import. Clone, undo/redo of unrelated
edits, local storage, current-format .scape archive import/export, and
desktop-library save/reopen preserve the record byte-exactly. It claims no
re-import upgrade of an already-imported source and no probe evidence beyond the
executed browser and Electron matrix.
<!-- /policy-narrative:source-characteristics-capability -->

## Pre-release schema breaks

Schema 17 is the only writable and readable raw-project schema before the first
shipped release. Inputs from schemas 1 through 16, including historical V16
documents carrying the video-retime V2 wire and V15 breakpoint-map retime state,
fail at the core boundary with the typed `REIMPORT_REQUIRED` error. They are
never partially loaded, silently normalized, or published. Development projects
are recreated from their source media.

Future raw schemas remain opaque read-only documents, and the exact-byte-copy
path for a future-schema `.scape` archive remains maintained. AUP, legacy XML
AUP, and AUP4 import are separate interchange boundaries and create current
documents directly. Retained raw-schema migrations begin with the first shipped
release and are governed by a separate versioned policy change.

## V16 wire preservation and selected F31 web-core retime

V17 preserves the closed JSON-safe V2 curve wire introduced by V16 on timeline
and Project Bin video clips; historical raw V16 documents themselves require
re-import. `null` is the writable default. A non-null map has 1 through 4,096
segments and one more point, uses exact canonical number rationals and safe
integers, spans outer frame zero through the owning `sequenceFrameCount`, stays
inside the owning source bounds, and delegates all direction, freeze, ramp,
endpoint, crossing, denominator, and bounded BigInt work to the exact V2 algebra
adapter. Validation returns a deeply frozen snapshot and rejects the old V15 wire
without guessing or migration.

A non-null map forces the exact reserved `framescaper.video-retime` requirement
for `org.soundscaper.capability.video-retime`, display name `Video retime maps`,
disposition `bypass`, and `fallback: null`. A publisher declaration cannot
suppress or replace it, and any reserved-ID conflict or rendered fallback
rejects. Historical Soundscaper V17 custody keeps `videoRetime` unavailable and
therefore retains the explicit read-only-or-cancel decision. Selected
Framescaper F31 explicitly reimports exact V28 and delegates to the maintained
V20 consumer through its immutable V28 foundation.

F31 exposes stale-safe set, reset, constant, ramp, reverse, and freeze commands,
each published as one history step through a menu-only lazy dialog. Inherited
editorial moves retain the occurrence curve, while linked audio follows ordinary
A/V-link placement without source warping (`warpMap` remains null and
`audioWarp` remains false). Nested materialization reparameterizes an exact leaf
curve onto the root occurrence. Program-preview random seeks and keyed browser
MP4/WebM export plus the evaluated-RGBA V14 carrier query one authenticated
ordinal authority for integer, NTSC, CFR, verified VFR, reverse, freeze, and
ramp timing, so each output ordinal resolves the same source picture in every
consumer.

The menu-reached proxy lifecycle performs Original, Proxy, or Auto selection in
the source domain before occurrence retime. It supports generation, attach,
detach, relink, regenerate, bounded progress and cancellation, adaptive preview,
offline editing, atomic cleanup, and original relink without making proxy timing
authoritative. Delivery still authenticates the original and visibly refuses
when it is unavailable. The V14 carrier likewise authenticates the original and
never promotes proxy pictures to delivery authority.

F31 clone/history, Clipboard V12, Scape custody, desktop library V20, and
copy-only cross-product routes preserve the unchanged wire through the immutable
V28/V14 foundation. V20 through V24 follow their historical reimport route
before V27-to-V28 and V28-to-F31 reimport; V25/V26 and unowned V29/V30 stay
opaque read-only custody. The native-media/OpenFX source route is complete, but
authenticated payloads, readiness, reference-renderer, packaged-manual, codec,
hardware, signing, lab, and release qualification remain open.

## V17 take/comp preservation

<!-- policy-narrative:take-comp-v17-preservation -->
V17 alone adds the required root takeGroups collection. Each take group binds
one sequence, one audio track, a positive sample range, stable lane order, takes
to lanes and audio sources with bounded source ranges, and non-overlapping comp
regions to available take spans. Validation enforces closed plain-data shapes,
bounded collections, canonical ordering, globally unique take/comp identities,
exact ownership, source bounds, group non-overlap on a track, and deeply frozen
canonical snapshots. Nonempty state reconciles exactly one reserved
soundscaper.take-comp requirement for org.soundscaper.capability.take-comp with
display name Take lanes and comps, disposition bypass, and fallback null; empty
state invents no requirement. Whenever take state exists, the reserved
requirement refuses publisher substitution. The capability is true in
Soundscaper and in the production capability register, so its compatibility
report is available/native and compatible; it is false but registered in
Framescaper, whose report is unavailable/bypassed and incompatible, so
activation is intrinsically read-only there. It is excluded from both audio and
video rendered-fallback eligibility sets, and publisher-authored substitution or
rendered fallback rejects. Soundscaper composes a typed take/comp domain, group
add, update, remove, and flatten command handlers, exact lane and take audition,
range promotion, boundary editing, and stale-safe exact flatten publication
behind a Tracks-menu dialog; Framescaper exposes no take/comp menu. Clipboard V4
clips take geometry, retains take-owned source roots, and pastes an
independently identified graph. A current-format .scape collision copy proves
take groups as the only logical roots for exact PCM, remaps source and storage
identities plus every take source ID, leaves recipient collisions untouched, and
reopens the copied document and PCM exactly. A fresh desktop V9 metadata 9 and
SQLite user_version 11 handoff proves Soundscaper opens the project writable, a
fresh Framescaper recipient fetches the managed PCM and preserves the exact
document intrinsically read-only, and a fresh Soundscaper recipient reopens it
writable with no missing sources. Soundscaper's existing Record options menu
exposes Record loop into takes only for a writable exact-schema-17 project with
takeComp true; Framescaper exposes neither the cycle entry nor recovery UI, and
direct start, Recover, and Discard actions enforce takeComp before controller
mutation. A positive enabled loop with unlocked armed audio targets, one routed
input for every target, and exactly one owning sequence per target is admitted;
timed, punch-selection, and sound-activated recording, busy or pending recovery
state, and a differently sized overlapping take group refuse. Selection-only
edits synchronize the owning session while preserving dirty state and without
autosave or compaction; cycle start then flushes the exact current project
before capture input or durable session I/O and rechecks currentness. Each
complete pass and an explicitly interrupted partial final pass becomes a
separate ordered lane, take, and source; repeating the exact loop appends to the
same group. Durable repository finalization and restart replay reopen exact
two-lane schema-17 documents and PCM. The .scape collision-copy witness consumes
recovered cycle output and proves exact source remapping and PCM; the fresh
desktop Soundscaper-to-Framescaper-read-only-to-Soundscaper handoff consumes
finalized cycle output and returns with no missing sources. The dedicated
`durable-routed-take-cycle-capture-and-recovery` production-security control
owns the exact resource, durability, recovery-authority, and qualification
limits.
<!-- /policy-narrative:take-comp-v17-preservation -->

## Audio warp compatibility

<!-- policy-narrative:audio-warp-capability -->
V17 validates audio warp maps on both timeline and Project Bin audio clips. A
map has 2 through 4,096 closed points with canonical reduced rational outer and
source positions, strictly increasing outer and source domains, and forward mode
only. Its outer endpoints match the resolved clip anchor extent and its source
endpoints match the clip source extent. Sample-anchored maps use sample frames;
musical maps require a beat extent and exact tempo authority; reversed clips
reject. A valid Project Bin map survives project-bin/place as a distinct
timeline clip ID with null binItemId and the same exact map, then passes V17
validation. Nonempty state reconciles exactly one reserved
soundscaper.audio-warp requirement for org.soundscaper.capability.audio-warp
with display name Audio warp maps, disposition bypass, and fallback null; empty
state invents no requirement. Authored state refuses publisher substitution.
audioWarp is true in Soundscaper and in the production capability register, so
compatibility is available/native, compatible, and writable. It is false but
registered in Framescaper, so compatibility is unavailable/bypassed and
incompatible and activation is intrinsically read-only. The capability is
excluded from both audio and video rendered-fallback eligibility sets;
publisher-authored substitution or rendered fallback rejects. Transient identity
binds the canonical full-source PCM SHA-256 digest, exact source range, channel
policy, normalized analysis parameters, and algorithm revision. A missing digest
is resolved by streaming the full canonical source under storage-generation
checks; exact range reading is bounded before allocation and opens only
intersecting generation-bound chunks. Transient records persist only in the
disposable derived analysis cache, never project JSON. Each record binds its key
and payload SHA-256 and contains a bounded transient array; corrupt or stale
records are discarded. Aggregate count, useful-byte, and age LRU retention is
enforced separately by the cache repository. Because no authoritative
digest-to-source index exists, successful source deletion and retention pruning
conservatively purge the whole transient payload and companion namespaces. Cache
state never roots pruning, unrelated analysis survives, and a disposable cleanup
fault cannot roll back or reject authoritative source deletion. That cache
lifecycle is not a bound on the project document, and V17 has no
transient-analysis array. Exact map algebra and its evaluator drive playback,
waveform projection, trim, split, exact offline fallback, and export. The
runtime never substitutes scalar output-length conversion: realtime segments
derive exact source-position endpoints and a piecewise linear projection from
the same map. A maintained nonidentity production-path browser fixture proves
PCM parity within the 0.000001 signal-error budget in Chromium and Firefox. When
realtime acceleration is absent, the bounded exact fallback admits only the
effect-free stateless dry, gain, pan, mute, envelope, and fade path; every
enabled processor in an included track, bus, send, or master rack rejects before
render. Playback retains the current window and exactly one window ahead; a
missed deadline stops playback and never time-shifts the next window, so gapless
playback is not guaranteed. Soundscaper exposes the workflow only through the
Effect > Pitch and tempo menu for a selected unlocked audio clip, with analyze,
identity-map, add, move, delete, quantize, groove, and clear actions. Browser
evidence exercises keyboard operation, screen-reader names and roles, serious
axe checks, and forced colors. Framescaper exposes no audio-warp menu or
surface.
<!-- /policy-narrative:audio-warp-capability -->

## Persisted track locking

Schema 17 requires one own boolean `locked` field on every audio, video, and
label track. Soundscaper and Framescaper both preserve and enforce the field;
it is mandatory current-schema behavior rather than a capability, owned feature
requirement, fallback, or read-only compatibility state. The shared command
boundary retains lock authority through nested batches and validates protected
editorial content, structure, media, and resolved timing before publication.
Existing selection, header, mixer, view, and track-rack controls remain usable,
and both products expose Lock track and Unlock track through the Tracks menu.
The lock does not imply mute, hidden, bypass, or project read-only state.

## Shared desktop current-schema persistence

The desktop editor has one implemented current-schema shared persistence
envelope. A fresh filesystem library scope `v9`
(`kw.media/scape-project-library/v9`) uses SQLite `user_version` 11 and ignores
rather than migrates the prior shared `v8` scope, preserving its metadata schema
8, exact schema 16 catalog, and SQLite `user_version` 10 in place. The older
`v7`/schema-15/user-version-9 and earlier scopes remain historical and untouched.
A copied `v8` database with `user_version` 10 placed at the `v9` path is rejected
without mutation instead of being migrated, adopted, or backfilled. Metadata
schema 9 binds a separate opaque library entry ID to the project identity,
exact schema 17, project revision,
byte length, SHA-256 digest, and a derived immutable revision-and-digest path.
No filesystem path, catalog entry ID, project-document digest, product
preference, timestamp source, or lease capability is exposed to a renderer.

Before publication, the main process canonicalizes the document with the
bounded tagged-binary Scape codec and applies the non-raiseable 256 MiB document
ceiling. The low-level store validates the persistence root schema, identity,
title, and revision. The main-owned identity service applies the shared strict
exact-V17 maintained-persistence-domain validator to the decoded document before
permitting host staging or catalog publication of a renderer commit. The same
service validates the loaded commit result and a stored project again before
returning either canonical document. Every serialized project first receives a
raw-JSON structural preflight capped at 101,536 JSON values and depth 130 before
`JSON.parse`; each exact-V17 decoded codec traversal and maintained-domain
validation phase is independently capped at 100,000 nodes and depth 128. The
service threads these lower-only caps through renderer input, loaded commit
results, stored reads, and response serialization. Renderer input refusal
precedes host mutation or staging. An over-budget loaded commit result is
refused before the renderer response, although host publication may already
have completed. Future-schema tag-shaped data is structurally counted but is
neither decoded nor interpreted. Canonical JSON-derived graphs and ordinary
direct objects reject accessors, `toJSON` hooks, method-shadowed arrays, hidden
or symbol data, cycles, exotic containers, and non-JSON scalars without
invoking application accessors; hostile proxies and prototype-polluted or
exotic injected graphs remain outside that code-safety claim. Counters reset
between the lexical, codec, validator, and serialization phases, so these
per-phase shape ceilings are not an aggregate work, CPU or elapsed-time,
allocation-amplification, cancellation, or resident-memory budget. The
validator strictly checks core project, document, media, and graph structures
without loading legacy migrations or executable effect and worker runtimes. All
audio effects must be cloneable and carry the generic effect identity, enabled,
and parameter structure.
Type-specific semantic checks currently cover missing-effect compatibility
metadata and parametric EQ; other first- and third-party effect payload semantics
are intentionally not gated yet. The store reserves each canonical path and a
unique random attempt in lease- and fencing-token-bound authoritative project
and stage inventories in one transaction before it exclusively creates the
private stage file. When exact-lease cleanup is acknowledged, an exclusive-open
failure retires only the registration without unlinking the path, while an error
after exclusive creation targets that registered random stage for removal.
Lost-lease or failed cleanup leaves the registration for takeover. Successful
materialization requires the exact metadata and stage paths, lease ID, and
fencing token, then performs an atomic rename, syncs
the project directory where the platform supports it, marks the canonical row
materialized, removes the stage row, and verifies the resulting immutable file
against its byte-length, digest, schema, identity, and revision descriptor.
Every catalog reference must have a materialized inventory row. Only then does it
publish an exact +1 catalog revision through the existing fenced journal, so a
reader observes the old or new complete project-and-catalog pair.
The main-only host serializes commits and renews its lease while it drains
admitted work during close.

After journal recovery and before the host is exposed, main-only startup
maintenance walks the authoritative project and stage inventories by monotonic
row IDs. It captures independent cycle high-waters, persists both cursors and an
alternating schedule, and scans at most 100,000 total rows per invocation in
at-most-64-row batches. It reports canonical, stage, live-stage, protected, and
reclaimed counts plus whether both bounded cycles completed. Every destructive
batch holds an immediate SQLite writer transaction and revalidates the exact
live lease before and after filesystem work. A current exact-lease stage remains
live. A stale registered regular stage is removed, a missing attempt retires,
and a non-regular target or non-direct parent remains untouched and inventoried.
Canonical rows owned by the current lease or referenced by any outstanding
stage remain ineligible. When stage retirement could unblock a canonical row
already passed by its cursor, a persisted rescan flag atomically restarts the
canonical high-water cycle before completion is reported.

Canonical batches rebuild portable case-folded reachability from the
integrity-checked current catalog plus both previous and next snapshots of any
pending prepared or committed journal. Only registered canonical unreachable
regular immutable project files and their deterministic noncatalogable
quarantine paths are eligible. Unregistered stage-looking, canonical, forged
quarantine, and foreign files do not consume inventory budget and remain
untouched. A real 100,001-row fixture proves successive bounded passes reach the
suffix; later inserts above a captured high-water wait for the next cycle. The
collector renames an eligible canonical file to its deterministic quarantine
before unlinking it, so a crash is retryable and a higher fencing token can
safely reuse the canonical path. It yields between batches for lease renewal and
cancellation. A static symlinked project root and corrupt catalog or journal
metadata fail closed; malformed names, non-regular or symlinked entries, and
managed media remain untouched. Collector state is visible in the host snapshot.
A tested reclamation failure during startup stops renewal and releases its
still-owned lease; any cleanup failure is reported.

The main identity service and owner-scoped IPC expose only bounded project
summaries, canonical documents and bundles, project identities, delete results,
and managed-source descriptors and chunks for canonical PCM and retained
original video. The main process strips catalog
implementation fields; navigation, renderer loss, and window close fence new
work for that renderer owner, abort its managed-source upload sessions, and
drain operations admitted before revocation. Main and preload repeat the
non-raiseable 256 MiB UTF-8 document, 4 KiB project-ID, 10,000-summary, 64 GiB
managed-source, and 4 MiB chunk ceilings; main additionally admits at most four
active managed-source upload sessions and four active managed-source reads
across the bridge service. Upload capacity remains charged until publication or
abort settles, and service disposal waits for finishing publications. Neither
layer exposes a path or fencing value.

The renderer repository repeats the same maintained-persistence-domain exact-V17
validation as defense in depth and canonically reserializes the document before
local mutation. The shared catalog is authoritative for latest loads and
summary lists, while
product-local IndexedDB retains revision history, source records, and media
bytes. A remote commit failure therefore leaves a retryable local shadow;
identical same-revision retry is a catalog no-op. A shared delete commits
remotely first and reports, rather than reverses, failed local cleanup. A
detected desktop with an incomplete shared-project bridge fails closed instead
of falling back to its former product-private project catalog. Ordinary project
saves publish only the canonical document; they do not copy source bytes into
the shared library.

An explicit managed-handoff path covers canonical PCM and retained original
video. After flushing the current exact-schema-17 project, the
sender enumerates at most 4,094 logical sources, deduplicates compatible
same-kind physical bindings, rejects conflicting geometry, and preflights one
aggregate 64 GiB expanded-byte budget across canonical audio archive bytes and
original-video bodies plus the 65,536-PCM-chunk ceiling before the first
source-body read or bridge body transfer. Canonical PCM receives two full
digesting source reads. Retained original video requires trusted exact-size
SHA-256 metadata and receives two full body-digest passes through 4 MiB windows
with metadata revalidation. When either binding is absent, the second audio or
video pass also streams at-most-4-MiB chunks through the pathless bridge.

Main admits at most four active uploads across that service through publication
or abort settlement. It validates the requested reachable source kind, identity,
and geometry against the exact current project revision, derives the catalog
document SHA-256 itself rather than accepting it from the renderer, and derives
the immutable media binding from the encoding, project identity, revision,
document digest, and storage-key/media geometry. The host repeats the exact
revision-and-document-digest check inside serialized publication, so a
prior-revision row or same-revision document variant is neither advertised by
the current bundle nor accepted as already present. Exact-present reuse also
requires the declared byte length and SHA-256 and reverifies the body. A new
upload must retain the same digest on both sender passes. After point-in-time
capacity admission, and before directory or stage creation, hard-link work, or
body consumption, main commits an authoritative canonical row and exact random
stage attempt. The canonical row binds the descriptor and its
encoding, project identity, exact revision, document digest, and storage key;
both rows carry the live lease ID and fencing token. Promotion accepts only that
registered regular stage, atomically renames it to its canonical path, syncs the
directory where supported, advances the row to materialized, and removes the
stage row under persisted before-and-after lease checks. Catalog preparation
requires every recognized managed descriptor to have an exact materialized or
published row, and catalog commit marks those rows published in the same SQLite
transaction as metadata publication. Stale revisions, immutable binding
conflicts, changed source bytes, malformed ranges, symlinked storage boundaries,
and incomplete bodies fail closed.

When the exact current binding is absent, main, not the renderer, may select a
canonical same-kind catalog donor with the same byte length and SHA-256. Main
fully verifies each donor, creates a random same-directory hard-link stage,
verifies the linked body, promotes it without overwriting a winning target,
syncs cleanup and directory state, and only then publishes a distinct
revision-bound descriptor. Unsupported linking, a missing or corrupt donor, or
an exhausted link count uses the normal bounded upload fallback; operational or
access failures fail closed. The renderer supplies neither a path nor a donor
selector. If catalog publication fails after an uploaded or linked immutable
body lands, an exact retry reverifies the inventoried body and publishes without
consuming another offered stream.

Each absent managed audio or video binding synchronously reserves its
prospective catalog row and metadata bytes together with other in-flight
reservations. It enforces the 50,000-row catalog ceiling, the 4 MiB metadata
ceiling, and a lower-only 64 GiB aggregate declared body bytes ceiling before
the first filesystem query, hard-link attempt, directory or stage creation, or
body consumption. A BigInt `statfs` query against the managed-media destination
then compares its available blocks with the aggregate in-flight declared bytes.
The reservation is held until descriptor publication settles and released
idempotently on every success, failure, or cancellation path. Publication
revalidates the prospective row and metadata against the current catalog. An
exact-present retry bypasses a new reservation and `statfs`, consumes no offered
body, and still reverifies the existing body.

This is point-in-time in-process admission, not an operating-system reservation
or an exact allocation or write-time capacity guarantee. It does not account
for allocation-unit rounding, SQLite or WAL overhead, external writers, or
other store instances or processes. Every binding is admitted independently;
the whole handoff is not reserved atomically. Charging declared bytes before
hard-link reuse is conservative and does not establish a portable capacity
claim for hard links.

After metadata-journal recovery and project-document reclamation, and before
host exposure, a separate managed-media collector first performs logical
retirement. For recognized inventoried descriptors, it removes catalog rows
whose exact project ID, revision, and document digest are no longer current;
unmanaged or opaque descriptors remain untouched. Retirement uses the normal
fenced metadata journal and must settle it before physical work. A recognized
descriptor that remains current but lacks an exact materialized or published
inventory row fails startup before managed-media filesystem mutation.

Physical managed-media reclamation uses independent persisted canonical and
stage high-waters plus an alternating schedule. It scans at most 100,000 total
inventory rows per startup in at-most-64-row transactions, rechecking the
unexpired lease before and after filesystem work and yielding between nonempty
batches. Stale registered regular upload and hard-link stages are removed;
missing stages retire their registration; non-regular targets and non-direct
parents remain untouched and inventoried. Stage cleanup requests a canonical
rescan so a newly unblocked row cannot be skipped. Catalog retirement restarts
the canonical cycle so a row already behind its cursor becomes eligible in the
same invocation. Current catalog descriptors are protected exactly. Eligible
registered canonical bodies are moved through deterministic noncatalogable
quarantine names before unlink, so crash-left promotion, quarantine, missing,
and hard-link-name states are retryable without deleting another live link.
Unregistered and legacy lookalikes, symlinks, foreign files, and unmanaged
catalog rows are neither adopted nor removed. Counts, logical retirements, and
bounded completion are exposed in the host snapshot, and startup failure
releases the still-owned lease.

This is startup-only cooperative-writer reclamation, not continuous runtime
cleanup or a hostile-filesystem sweep. More than 100,000 tracked rows require a
later startup pass. Empty directories, SQLite/WAL space, unregistered legacy
files, external-writer races, platform-specific power-loss behavior, and
write-time capacity remain unqualified. Structural inventory validation is
performed for exact references and bounded batches; it is deliberately not an
unbounded eager scan of arbitrary third-party database corruption.

Before local shadow save or activation, a latest exact-schema-17 source-bearing
shared load performs bounded sequential recipient-local admission. It collects
at most 4,094 unique logical sources reachable from timeline clips, Project Bin
clips, and rendered-fallback references. It deduplicates compatible same-kind
physical bindings and rejects conflicting geometry. One aggregate 64 GiB budget
charges canonical audio archive bytes and recipient-local or managed
original-video bodies, while a 65,536-PCM-chunk ceiling charges audio. Admission
completes those budgets before any body read, shared body transfer, or recipient
write. A fresh recipient may then acquire matching managed canonical-PCM and
original-video descriptors through bounded 4 MiB reads, with at most four
main-process reads active, into a staged product-local audio source or an owned
video-media writer. Each transfer must match descriptor identity, kind and
storage key, exact byte length, SHA-256, and canonical audio byte geometry
before atomic if-absent publication. Retained original video stays opaque and
is not decoded or probed for media geometry at this boundary. A writer that
loses that absence race deletes only its own staging and preserves the winner.
Partial acquisition, later admission failure, and conflicting recipient-local
bindings roll back in reverse order only the exact acquisition-owned audio
record or video publication and its source token, path, or media-chunk payload;
a concurrent replacement is preserved. Each source not acquired this
way still requires the pre-existing latest
recipient-local exact-schema-17 snapshot of the same project to bind its logical
ID, kind, physical storage key, MIME type, frame/sample geometry, and
kind-specific descriptor; names and opaque extensions are not provenance.
Compatible same-kind aliases of one physical key are read once, while
conflicting bindings reject and audio/video storage domains remain separate.
Declared payload geometry is capped at 65,536 PCM chunks, while one cumulative
64 GiB budget charges canonical audio archive bytes—including four framing
bytes per chunk—and recipient-local video metadata sizes together.

For maintained demand-loaded playback, an owned canonical-PCM provider passes
the source metadata already admitted for that provider into lazy session
opening. The store captures at most 4,094 cycle-free records from the requested
root through its linear root-to-base copy-on-write ancestry, retains the
observed metadata records, reads only their captured source token or path, and
serializes chunk requests. Before and after each chunk it checks every observed
generation by the stored identity tuple of source ID, storage kind, source
token or path, base-source ID, and PCM encoding version. Root or ancestry drift
is terminal for the session; per-request cancellation remains local, and store cleanup releases owned and
fallback sessions while aggregating failures.

This is a fence over the provider's expected root and the ancestry generations
observed at open. A copy-on-write record persists only its base source ID, not
the generation intended when the derived record was published, so a base
already replaced before opening can become the observed ancestry. The identity
tuple is not complete metadata equality, a content digest, storage retention or
a byte lease. Deletion or same-token/path byte mutation can still fail or evade
that metadata fence, and separate repository instances and processes are not
serialized into one byte snapshot.

One narrow linked-PCM managed-handoff exception is qualified here. Through an
explicitly injected Electron port, one point-in-time maintained PCM container no
larger than 512 MiB may remain in a main-private registry: RIFF/RF64 PCM or
IEEE-float WAV, first-party BW64 integer-PCM `.wav`, or classic FORM/AIFF signed
big-endian integer PCM at 8, 16, 24, or 32 bits, or canonical first-party
FORM/AIFC v1 `fl32` 32-bit floating point admitted only as exact `.aif` or
`.aiff` plus `audio/aiff`. Only that registry contains the absolute path and its
device, inode, size, modification time, and change time; the project and
renderer-side binding retain pathless locator and revision tokens plus scalar
canonical source geometry. The chooser and initial bind still materialize and
hash one whole source snapshot. After that binding commits, maintained Electron
canonical PCM reads instead acquire an owner-scoped `linked-audio-range-v1`
capability at the exact locator revision. Before container inspection or PCM
decoding, the renderer requires the exact byte length and MIME type, hashes the
complete opened handle sequentially through exact at-most-4-MiB `206` reads,
and rechecks the exact binding. The container inspector and chunk decoder then
use a range-backed source, so the session constructs no second whole-original
`Blob`, and release of the capability is owned by that read session. Classic
AIFF admission and every later read require bounded FORM/AIFF, COMM, and SSND
structure. The AIFF-C profile requires one four-byte FVER v1 (`0xA2805140`)
before an exact 44-byte COMM carrying 32-bit `fl32` and the exact Pascal
compression name `32-bit floating point`, plus structurally consistent SSND
geometry. The first-party label describes the maintained fixture, not
authenticated provenance: admission is producer-neutral and accepts any
producer emitting that exact tuple. Broader, compressed, and other AIFF-C
profiles reject; broader third-party interoperability and producer provenance
are unqualified. An available range operation that
reports unavailable, malformed, drifted, or corrupt data fails closed; a
generic platform port that does not implement the optional range operation
retains the prior whole-`Blob` source-reader fallback.
For maintained playback, one provider lazily owns one provider-owned stable PCM
read session. It reuses one full-container digest and one parsed descriptor across serialized random
or sequential chunk reads, and rechecks the complete alias group and exact
binding before and after every chunk. Per-read engine or stream cancellation is
local; drift, corruption, and provider retirement are terminal. Provider
replacement, failed activation, project switch, project or source deletion and
clear, rollback, and controller or store disposal retire the provider, await
exact-once release, and fence backing cleanup; bulk cleanup failures aggregate
with the primary failure.
The sender's owned PCM inventory remains empty.

Only explicit `prepareHandoff` performs the normal two canonical Float32 PCM
source-API passes and publishes their chunks through the maintained managed
`audio-f32le-chunks-v1` path. On Electron, both post-bind passes use the ranged
source lifecycle above; the handoff does not collapse them into one pass. A
fresh recipient acquires those chunks through its ordinary owned source writer
and can close and reopen the canonical PCM without the linked-original port or
locator. External container bytes and locator identity do not cross the
managed-media bridge or enter the shared catalog or recipient.

A binding-backed exact- or shape-compatible changed-content Project Bin linked-PCM relink resolves the
compound item to exactly one audio source with a current audio binding; it does
not use missing-source state as eligibility. The component fences its
asynchronous decision to the exact project revision and menu request. Its UI
handoff carries only the pathless selected `File`, opaque locator ID and
revision, and exact `{projectId, projectRevision}` target. A stale chooser scope
is released before dispatch. The service validates that target before starting
the shared audio/video relink task and releases a mismatch without cancelling
current work, then rechecks the target in storage publication admission. The UI
classifies the candidate by byte length and SHA-256 at the exact project and
project revision. Exact content dispatches immediately. A changed choice stays
owned by the UI until explicit localized confirmation; cancellation, failure,
or stale scope releases it. Before timeline transport, Project Bin preview, or
the provider is disturbed, a bounded structural probe requires the same
maintained container identity and exact frame count, channel count, sample
rate, and original sample rate without retaining decoded PCM. The controller
then stops transport and preview and retires and drains the current provider.
Storage proves the old binding and platform snapshot are current. Its default
admission still requires exact byte-length and SHA-256 equality. Changed-content
admission reloads the candidate at its exact revision and publishes its measured
byte length and SHA-256 while copying the bound MIME and source shape unchanged.
One synchronous `assertCanPublish` runs inside the same compensated
memory batch or IndexedDB binding-and-provisional-root transaction and rechecks
the shared task, exact target, project generation, and writable editor state.
Project, source, clip, and history identity remain unchanged. After publication,
the controller invalidates stale source buffers, peaks, waveform state, and
analysis, then reactivates the replacement before publishing availability.

Recovery state is guarded by current audio-operation ownership plus the active
project and controller lifetime, rather than shared-task currentness. A
prepublication failure preserves the old binding, and recovery rechecks
operation ownership after metadata before activation of the old runtime. It
drains cleanup of only a distinct unused candidate. Shared video relink or
project-lock cancellation before publication can therefore restore the old
runtime while that audio operation still owns the active project. After
publication the new binding remains: when activation is incomplete the same
ownership guard retires and invalidates any partial runtime and records missing
state, while a completed owned activation publishes availability even if the
shared task was cancelled. A newer audio relink, project replacement, or
controller disposal prevents stale recovery. The displaced old locator waits
for bounded alias-aware startup reconciliation.

This exception does not qualify packaged executable or UI behavior,
operating-system file-dialog or path durability, changed-geometry,
changed-container or other-media relink, automatic watch or discovery,
broader audio formats, arbitrary third-party BW64, new BW64 ADM preservation or
editing semantics, AIFF metadata preservation, broader or compressed AIFC,
third-party AIFC interoperability and provenance, the `.aifc` extension,
reference-scale evidence, or range support outside maintained post-bind
Electron linked-PCM source reads. The external path and stat tuple are a
point-in-time main-private identity. Moving or replacing the pathname after
range admission does not retarget the opened handle, but same-inode in-place
mutation during or after sequential digest verification is not fenced. The
capability is therefore not an operating-system bookmark, content-frozen or
durable immutable byte lease, restart-stable identity, or cross-process snapshot.

A deliberately narrow linked retained-video path is qualified at this same
boundary. A local binding joins the exact project ID, logical video source ID,
physical storage key, MIME type, byte length, SHA-256, and maintained
frame/sample/video geometry to an opaque locator ID and opaque locator
revision. Neither locator value appears in the project document. IndexedDB
database version 8 and the memory backend retain a closed scalar-only binding
record, including scalar source-shape fields, a compare-and-swap token, and a
canonical timestamp; they retain no linked body, `Blob`, filesystem path, URL,
platform handle, or persisted playback lease.

The maintained Electron source now supplies that platform port. Its native
chooser accepts exactly one non-empty regular video no larger than 512 MiB and
registers it in a product-local schema-1 file under main-owned `userData`. That
private atomically replaced registry admits at most 128 locator records and
64 GiB of declared files. Only it contains the raw absolute path plus the
selected file's device, inode, size, modification time, and change time. The
sandboxed renderer receives only random pathless 64-hex locator and revision
tokens with bounded display metadata. An ordinary body load rechecks the
persisted stat identity around a fresh owner-scoped `materialized-v1` descriptor,
so a moved, deleted, replaced, or changed pathname fails closed at that
point-in-time boundary. Binding and import, document-only shared-load
resolution, and explicit handoff still materialize a complete `Blob` through
the 512 MiB tier. Their later 4 MiB digest windows do not bound provider
allocation, decoder memory, or process RSS.

Maintained Electron visual activation takes a separate route when there is no
owned video asset. It requests the exact locator revision and main grants an
owner-scoped `linked-video-range-v1` pathless capability backed by an opened
handle matching the persisted device, inode, size, modification time, and
change time. Admission permits at most 128 such
capabilities and 64 GiB of aggregate declared bytes, with a 512 MiB per-file
ceiling, at most 16 active range requests, and at most 4 MiB in one response.
The renderer verifies exact response status, range, length, and MIME while
performing a full sequential SHA-256 in at-most-4-MiB ranges, then rechecks the
binding before exposing the pathless media URL. The visual service owns that
playback lease together with any poster and thumbnail object URLs and awaits
release on replacement, cancellation, supersession, project switch, project
deletion, project clear, source replacement, import rollback, media-element
failure, and controller disposal. Release is owner-scoped and fences later
range requests; admitted cancellation drains the current file read before its
request slot is reused.

A pathname move or replacement after admission does not retarget the open
handle, so the live lease continues to read the admitted inode. Same-inode
in-place mutation during or after verification is not fenced, however, and the
lease is not content-frozen. The persisted locator therefore remains a
point-in-time identity rather than an operating-system bookmark, automatic
watch or moved-path-repair handle, or cross-restart playback identity. This is
bounded range transport for the maintained live visual only, not
reference-scale qualification. The whole-`Blob` import, shared-load, and
handoff routes remain unchanged; packaged executable/UI, operating-system, and
browser codec behavior remain unqualified.

The capability-gated Project Bin action passes that one pathless choice into the
maintained video importer. The importer may derive canonical audio and
disposable poster/thumbnail cache entries, but it skips the owned retained-video
asset write. It constructs the exact video source, hashes and publishes its
linked binding before visual activation and canonical project publication.
Failures before the canonical source lands retire the unused locator by its
exact ID and revision, conditionally unlink only the import's exact binding, and
roll back import-owned audio and previews. Once the canonical source has landed,
a later publication or reporting failure retains its binding, locator, audio,
and previews rather than attempting destructive rollback. Persistent-locator
release is a closed own-data `{ locatorId, locatorRevision }` request at both
preload and main; identifier-only, missing, malformed, accessor-backed, and
extra-field inputs reject. Main applies owner-scoped exact-revision
compare-and-swap retirement. A stale or missing pair and an already-revoked
owner return `false` without a registry write. A failed persistence write
restores the in-memory entry, while revocation observed after the deletion write
attempts a second persisted restore. A successful release removes only the
main-private registry metadata; no release path deletes the user-selected
external file.

The localized Project Bin Relink action is available for a bound
retained-video item when the linked-video capability exists; the menu asks the
controller's binding eligibility check rather than missing-source state, so an
available item may relink to the same exact content. The controller
then requires a current binding, a compound A/V item that resolves to exactly
one video source, and editing that remains writable. It snapshots the old
binding token and whether the source is missing, stops timeline playback and
Project Bin preview, revokes the current visual, and
revalidates project, task, and editing state; a source that was missing must
stay missing until publication. The UI passes only
the selected `File` and pathless locator ID and revision. For the default
exact-content admission, storage first requires
that file to match the existing byte length and SHA-256, then requires the
exact-revision platform snapshot to match the selection before a same-source
compare-and-swap publishes the replacement binding and provisional root.
A separate changed-content admission relinks a silent video source to
different bytes behind explicit caller authorization and the maintained
localized confirmation. It refuses any source or compound bin item that
retains canonical extracted audio or pairs an audio member, keeps the
binding's MIME type, and probes the selected file with the same decode
pipeline import uses, so frame size and duration must match the canonical
claims and no audio may decode. The compare-and-swap then publishes the
measured byte length and SHA-256 with the source shape copied unchanged,
stale disposable derivatives are purged best-effort after publication, and a
declined confirmation releases the chooser's locator; frameRate and
videoCodec remain unverified import placeholders carried through unchanged.
The synchronous controller guard runs inside that same memory or IndexedDB
binding-and-provisional-root CAS immediately before publication and rechecks
task, project, and writable state plus, for an initially missing item,
missing-source state. The project document,
source, and history remain unchanged. Verified visual activation then clears
the missing state and publishes the view.

A wrong-content, stale, superseded, cancelled, or disposed attempt before
publication keeps the old binding current and releases only a distinct unused
candidate; when an initially available item's visual was already revoked, the
same failure restores that visual under current operation ownership or records
missing state when restoration fails. If activation fails after publication,
the new binding remains and missing state is recorded for retry, also for an
initially available item. The displaced prior locator is deliberately not
released immediately; it remains eligible for later bounded startup
reconciliation. That pass preserves submitted same-store aliases; cross-store,
cross-profile, and cross-process coordination remains unqualified.

After durable IndexedDB opens and before project loading, the
maintained store obtains one point-in-time authoritative project-summary
snapshot from its active project repository. In Electron that authority is the
shared catalog rather than a stale product-local shadow. For a
reconciliation-capable port, the repository projects every summary to closed
own-data `{ id, revision }`, validates the exact project identity and
non-negative safe-integer revision, rejects duplicates, and enforces the 10,000
summary maximum before opening a binding transaction. Memory fallback returns
before requesting the catalog, mutating a binding, or invoking main-process
reconciliation. A durable load-only injected port may request the catalog
snapshot but performs no binding mutation or reconciliation IPC.

One readwrite transaction over local current projects, retained revisions, and
linked-original bindings then walks at most 100,000 closed binding rows,
validates every authoritative binding key, identity, and storage alias. The
generic mixed-kind pass admits at most 128 unique exact locator/revision pairs
across the full inventory. The legacy video-only fallback still validates all
rows and storage aliases, but applies reference cardinality and deletion only to
video while preserving audio rows. A malformed row, conflicting revision or
storage alias, exceeded applicable bound, or deletion failure rejects
reconciliation and rolls the transaction back before IPC, including when every
offending managed row belongs to a project absent from the catalog.

Every binding whose project is absent from the catalog is unreachable. For a
catalog-live project, source-level pruning runs only when the product-local
current document is exact schema 17 at the catalog revision and at most 64 exact
retained revisions include that current revision. The pass conservatively
unions kindful timeline, Project Bin, and every feature-fallback source across
the current and retained graphs without publisher gating. Missing, older,
newer, malformed, incomplete, or over-bound local graph state retains all
bindings for that catalog-live project. More than 100,000 aggregate roots across
otherwise verifiable projects suppresses all source-level pruning while leaving
catalog-absent deletion eligible. Only after the complete scan does the same
transaction apply its binding deletions. Any surviving same-store alias keeps
the shared locator live.

The maintained bootstrap submits the surviving exact references over the
closed preload/IPC boundary. Main's serialized pass removes only startup-loaded
metadata absent from that positive inventory and retains runtime-created
records. It can retry after failure and completes at most once per
store/process. A failed first registry write restores the in-memory inventory;
owner revocation after publication attempts a second persisted restore and
surfaces either failure. The pass rewrites locator metadata only and never
stats or deletes the external files. On the next successful full bootstrap it
retires startup-loaded chooser metadata with no durable binding and metadata
whose binding rows were durably removed as project-absent or source-unreachable
under the exact catalog-revision fence.

Within one live `AudioEditorProjectStore` instance in one renderer process, a
separate coordinator serializes binding publication, exact unlink, unused
locator release, startup reconciliation, project deletion, and whole-store
clear. Each complete before/after binding inventory admits at most 100,000
closed rows and 128 unique exact locator/revision pairs; its pending cleanup set
is also capped at 128. After a project deletion or clear has committed its local
project and binding removal, the coordinator rescans the same store and releases
only a candidate with no surviving same-store alias. Clear's local-commit signal
is published after the memory or IndexedDB binding store is cleared and before
fallible OPFS cleanup. A failure before that signal preserves the bindings and
does not admit their locators for retirement; a later physical-cleanup failure
does not undo the committed local deletion.

Thrown platform-release failures are reported as committed cleanup errors and
retain the exact reference for a later serialized retry. Every retry first
rescans current same-store aliases, so a rebound alias suppresses retirement.
Either fulfilled `true` or `false` settles the pending exact reference because
`false` cannot retire a stale, missing, or revoked replacement. Reporting or
release failure never rolls back the local commit, and locator cleanup still
never stats, writes, or deletes the external video file.

An opt-in maintained controller save or a terminal successful writable
activation makes kindful source-level cleanup a separate part of that same
live-store lifecycle. Maintained queued autosaves, flushes, inactive-tab saves,
and project-switch or analysis explicit saves capture the complete live-session
roots when the queued write executes, after any earlier queued save has settled
rather than when an autosave timer is scheduled. Activation maintenance runs
only after engine and session activation, state publication, and source garbage
collection have succeeded. It is limited to a durable IndexedDB-backed store
and skips a read-only or failed activation, an activation using `options.save`,
and a memory or degraded store.

The activation pass enters the linked-original lifecycle and
latest-project-mutation locks in that order. Inside both serialized scopes it
revalidates the controller lifetime and activation admission, the active project
and write-lock identity, and both the controller and original lock's writable
state. If ownership has changed, it returns no roots and suppresses destructive
maintenance. Otherwise it collects the current live-session roots inside that
serialized ownership window rather than using a pre-lock snapshot. For either
route, the resulting frozen, deduplicated kindful references derive exactly
from every open tab's present, Undo, and Redo clip and fallback references, the
session clipboard's media kind, an audio recording in progress, and audio clip
time/pitch render-cache protection. The same textual source ID in audio and
video remains distinct, and a wrong-kind root does not retain a binding.
`protectedLinkedVideoSourceIds` remains a compatibility facade for direct
callers. Direct store callers that omit authoritative kindful roots still save
normally but perform no destructive source-level cleanup: no project binding is
pruned on that save.

After an opted-in save has published the current project and compacted its
retained revision set, or during serialized maintenance after a successful
activation, the reachability repository validates the current exact-schema-17
project plus every retained exact-schema-17 revision. Each revision must have its
canonical key, project identity, and revision identity, and the set must contain
an exact revision matching the current project. Current and retained graphs are
conservatively unioned even if two validated documents at the same revision
diverge. Durable audio and video roots include timeline clips, Project Bin
clips, and every feature-requirement fallback, without first-party or
third-party provenance gating. Caller-supplied live roots and transient import
roots are retention roots for this pass but do not become durable project roots.

The pass admits at most 64 retained revisions, 100,000 aggregate durable,
caller, provisional, and exact-owner source roots, 100,000 complete binding
rows, 100,000 complete provisional-root rows, and 128 unique exact
locator/revision references. A malformed, older-schema,
future-schema, identity-mismatched, missing-current-revision, or over-bound current or
retained revision state suppresses cleanup before any binding deletion. The
public save option instead rejects malformed, duplicate, noncanonical, or more
than 100,000 caller roots before project publication. Once binding inventory
begins, every row must be closed and authoritative; malformed or conflicting
rows and row or exact-reference overflow fail the maintenance pass without a
partial deletion.

For memory storage, save-triggered unreachable target-project bindings and
their roots are removed as one compensated mutation batch;
activation-triggered maintenance is a no-op there and in degraded storage. For
IndexedDB, current project, retained revisions, complete binding and root
validation, and pair removals share one readwrite transaction. This atomic
binding prune runs only after the
project/revision save and retained-revision compaction have committed or after
the terminal activation has reached its post-garbage-collection maintenance
point. On Desktop, a save-triggered pass runs only after the shared bridge
returns an exact canonical remote acknowledgement. A successful activation
does not publish another remote document; its maintenance instead finishes
under the same latest-project-mutation lock, so a following latest load, save,
delete, or activation cannot interleave with the prune. A rejected or inexact
remote publication never starts save maintenance. Project publication and this
later prune are nevertheless separate commits.

Every maintained new or replacement binding and copied alias also publishes a
closed scalar provisional root containing only its schema version, binding key,
project, kind, source, and binding token. It contains no locator, path, or body.
The binding and root use the same compensated memory mutation or IndexedDB
readwrite transaction; exact unlink and determinate rollback delete the pair.
The complete root inventory is validated under its 100,000-row ceiling before
mutation. This closes the same-database bind-before-canonical-import window
against independent cleanup.

A rooted binding remains protected until an exact durable current or retained
graph or its exact owner token consumes the root. A caller wildcard live root
retains the binding for one pass but does not consume the root. A stale owner
settles its prior in-memory reference without consuming a replacement root or
protecting an unrooted replacement. Suppressed and failed maintenance consume
no root. Startup has no owner token: a catalog-live rooted binding remains when
the local graph says it is unreachable or unverifiable, exact durable graph
membership consumes the root, and catalog absence deletes the binding/root
pair. Project deletion validates the complete root inventory before pair
deletion, and whole-store clear removes all roots. Roots have no time expiry, so
interruption safely leaves a bounded metadata leak. The version-8 upgrade does
not backfill existing pre-root binding rows.

An unreachable binding deletion returns only sorted, deduplicated exact locator
references. Before exact release, the coordinator re-inventories all current
same-store bindings; any surviving project/source alias suppresses retirement.
A project-binding prune failure is reported as committed cleanup while the
project save or activation remains successful, safely leaves the binding and
locator live, and lets a later opted-in save or writable activation retry the
prune. Locator-release failure retains the exact ID/revision pair for the
existing serialized retry path. A previously failed pending exact release that
rejects again is attempted once before an activation prune and excluded from
that activation's later release batch, so it does not starve unrelated
activation pruning or retry twice during one activation. Reachability inventory
and release perform no external-file
stat, write, deletion, or body load; a successful exact release changes only
main-private locator registry metadata and never the user-selected media. The
memory and IndexedDB acceptance witness proves that a no-owned-PCM linked WAV
survives after its last durable revision ages out while a live audio root keeps
it canonically readable. When the last root disappears, the next maintained
save or writable activation removes the binding and releases its exact locator
once while leaving the external WAV untouched.

The binding/root transaction is qualified within the same IndexedDB database,
including independent browser connections. Different databases or profiles,
the project catalog, and the main locator registry are not coordinated by that
transaction. Restart and crash windows, power loss, and hostile-row authority
do not qualify, and the stated count bounds do not qualify arbitrary hostile-row
clone cost or process RSS. Project publication, the memory or IndexedDB binding
prune, alias re-inventory, and main-process exact release are not one
cross-boundary transaction; interruption between them may safely leak metadata
until a later maintained save or writable activation. Coordination beyond the
same-database provisional-root window, relink or watch, range support outside
maintained post-bind Electron linked-PCM source reads, packaged executable or
operating-system qualification, third-party activation gating, and legacy
private libraries are outside this claim.

That same lifecycle coordinator now serializes project duplication with binding
publication, exact unlink, startup reconciliation, project deletion, and
whole-store clear for one live `AudioEditorProjectStore` in one renderer
process. Duplication reads the source project first; the desktop repository uses
an exact canonical shared-document read that performs no managed-media
resolution. A subsequent point-in-time catalog check must still contain the
source ID and must not contain the destination ID. The duplicate receives a new
project ID, revision 0, a requested non-empty title or the source title plus
` copy`, and fresh creation and update timestamps. Reachable source collection
is capped at 4,094 references. No linked body, source body, media body, locator,
or playback capability is loaded, released, staged, or copied by this operation.

Before project publication, the alias repository scans and validates the
complete binding inventory, capped at 100,000 closed rows and 128 unique exact
locator/revision references. It rejects malformed or conflicting inventory, an
already-bound destination project, an over-capacity prospective row set, and a
reachable source binding whose storage key, MIME type, or maintained source
geometry does not exactly match the project source. For each reachable video
source that has a source-project binding, it publishes a destination-project
alias to the same pathless locator ID and revision, byte length, and digest, but
with a fresh binding token and timestamp. An unbound reachable video receives no
alias. IndexedDB publishes the complete alias set in one readwrite transaction;
the memory backend compensates a partial synchronous publication. This alias
publication is separate from, and not atomic with, project publication.

The normal project-publication admission runs after alias publication. The
create-only project repository then checks the current-project row, the exact
revision key, and every revision for the destination before atomically writing
only the project and its revision-0 record. It does not publish or adopt staged
source or media records. On a determinate later failure, alias compensation
first validates the complete current inventory and removes only the exact fresh
binding tokens; a missing alias is already settled, while any replacement makes
cleanup fail without partially deleting the requested set. Desktop local-shadow
compensation likewise requires the exact returned snapshot plus its persisted
creation fence, removes only project and revision rows, and preserves an
identical later publication, a changed project, and every binding.

Desktop duplication checks remote destination absence, creates that fenced
local shadow, verifies its exact canonical document, and then requests the
shared commit. An exact acknowledgement succeeds. If commit or acknowledgement
handling fails, one remote reread treats the exact expected document as success,
proven absence as a determinate failure eligible for exact local and alias
compensation, and a divergent or unreadable result as
`ProjectDuplicationIndeterminateError`; the last case retains the local shadow
and aliases because the remote outcome cannot be proved safe to undo.

There is no durable duplication receipt or restart reconciliation for these
multi-store steps. The exact local-delete capability is process-local even
though its revision fence is persisted, so abrupt interruption after local
shadow creation can leave a hidden shadow and aliases that block retry; startup
linked-locator reconciliation does not retire that shadow. Cross-store,
cross-profile, cross-process, and project-catalog races are not serialized by
this guarantee. The concurrency evidence covers two calls through one memory
store facade, not overlapping browser IndexedDB connections, and there is no
crash, restart, power-loss, or packaged interactive duplication qualification.

The project-catalog snapshot, local binding transaction, and main reconciliation
are separate, not atomic. A catalog mutation after its snapshot may be observed
only later. If binding deletion commits before IPC or main rejects, the binding
deletion remains committed; a later startup retry can prune the now-unreferenced
locator. Catalog absence remains an authoritative deletion root regardless of a
product-local shadow. Catalog presence admits source-level pruning only through
the bounded product-local exact-schema-17 current and retained graphs whose
current revision equals the catalog summary. Missing, stale, structurally
invalid, incomplete, or over-bound graph state retains the project's bindings.
The summary revision is not a document-content digest, so this is a cooperative
revision fence rather than authentication of same-revision local graph content.
Current-process records abandoned outside the maintained startup, binding,
save, successful writable activation, delete, and clear lifecycle may still
wait for a later main-process restart. Main validates the DTO and exact
revisions but cannot authenticate inventory or local-graph completeness, so a
compromised renderer can omit live references and delete startup locator
metadata. This is cooperative availability maintenance, not a
compromised-renderer integrity control. Cleanup beyond one live store's bounded
startup and maintained save/successful-writable-activation/delete/clear
lifecycle, cross-store, cross-profile, or cross-process mutation serialization,
abrupt-crash or power-loss durability, and a total cloned-byte or process-RSS
bound for one hostile IndexedDB row are not implemented. Packaged executable/UI
and operating-system behavior remain unqualified as described above.

With this explicitly injected platform port, a fresh document-only latest shared
load can admit a complete exact linked-video alias group without a prior local
project snapshot or managed descriptor. Binding and group inspection performs
no privileged body read. The declared linked byte length participates in the
complete logical-source, 64 GiB byte, and PCM-chunk preflight above; only after
that aggregate preflight succeeds does the first body request reload the opaque
locator at its expected revision, require the exact byte length, hash through
at-most-4-MiB windows, and recheck every binding token. The ordinary load may
then save the authoritative local shadow and trust those exact sources without
reading, writing, or copying an owned media asset. Malformed, incomplete,
conflicting, replaced, stale-revision, wrong-size, or wrong-digest bindings fail
closed before shadow publication.

Only an explicit `prepareHandoff` turns that verified linked body into owned
media: an exact linked-session overlay supplies the whole `Blob` to the existing
managed original-video sender, which retains its normal aggregate preflight,
digest, bounded-transfer, and publication contract. The playback lease neither
copies media nor changes this whole-`Blob` handoff. This handoff path adds no
product chooser, relink or watch flow, durable operating-system handle,
background copy/consolidation beyond the bounded same-store scalar-alias
duplication above, or an alternate publishing protocol.
Generic linked audio beyond the narrow linked-PCM managed-handoff exception,
every other linked or unmanaged original, authored proxies, other video
rendered-fallback roles and authoring, packaged executable/UI behavior, and
browser codec playback remain unqualified. The maintained role-defined
whole-project video and first-party clip fallback activation rule below is
separate from this linked-original contract. The separate source- and
component-tested chooser and import described above still lacks packaged and
operating-system qualification, cleanup beyond the bounded startup binding
inventory, and fallback acquisition or handoff outside the closed maintained
roles. The range route has no packaged executable/UI, operating-system, or
browser codec playback qualification.

For a successfully qualified body, admission snapshots metadata before and
after it, consumes the exact sequential PCM chunk count and ordered
`Float32Array` channel/frame geometry, requires any supplied chunk index or
frame count to match, and requires a syntactically valid trusted recipient-local
SHA-256 before any video body read. It then fully reads each genuine exact-size
video `Blob`, hashes it with SHA-256 through 4 MiB windows, and its body digest
must match. Shared admission performs no on-access storage maintenance. Digestless legacy video therefore fails closed before body read, local shadow save, or activation; with no lazy digest backfill, such sources require re-import.
Every source binding, budget, metadata, geometry, body, or digest failure
detected before shadow publication leaves the recipient's latest local shadow
and revision history unchanged and prevents bootstrap activation. Cancellation
first observed after the exact shadow is durable still rejects the load before
activation, but retains that shadow and any acquired managed media it references. This
does not describe the later controller-owned rendered-fallback-declaration
digest check, which follows repository shadowing.
Source-free latest loads perform zero source or media I/O. Bootstrap propagates
its lifetime signal; one repository instance keeps latest load, save, and
delete serialized per project; and publication and retention resolve logical
references to physical storage keys.

A real-store fixture qualifies recipient audio and video bytes already present
under nontrivial storage keys and bound by the pre-existing latest local
snapshot. Composed cross-product evidence separately proves the source-free
Soundscaper-to-Framescaper success path and a source-bearing
missing-recipient-PCM refusal that preserves the pre-existing revision without
activation. A maintained explicit-audio fixture additionally proves managed PCM
acquisition by a fresh Framescaper store.

A composed headless Soundscaper-to-fresh-Framescaper-to-Soundscaper fixture
publishes canonical PCM and retained original video, acquires both into the fresh
profile, activates with an empty missing-source set, verifies exact audio engine
buffers and video blob-URL bytes, exercises transport play, edits, and saves. Its
explicit return handoff gives both unchanged bodies distinct revision-bound
bindings backed by the same inodes without renderer body chunks. Reopening the
original Soundscaper profile returns the exact edited document and preserves its
product-local revision history with zero bridge body I/O and no duplicate local
media. This headless evidence does not qualify executable/UI launch coordination
or browser video-element codec playback.

A narrower composed Soundscaper-to-fresh-Framescaper fixture roots an exact
schema 17 role-defined audio whole-mix fallback for the unknown canonical
`org.example.future-mixer` feature solely through its requirement. The sender is
intrinsically read-only only because of that feature-requirement report and
still owns the current writable project lock, so explicit handoff publishes the
unchanged active snapshot without flushing. Declared read-only, future-schema,
missing- or stale-lock, and lock-contended projects remain refused. The empty
recipient acquires the fallback and editable original as canonical managed PCM
plus the exact canonical shadow, remains intrinsically read-only, and activates
the transient fallback with exact engine samples and no missing source. Managed
acquisition verifies its descriptor and body SHA-256. The separate fallback
digest declared by the project manifest remains controller-owned after shadow
publication and before activation.

A parallel composed headless Framescaper-to-fresh-Soundscaper fixture carries
an exact schema 17 editable retained original alongside a manifest-only
`project-video-render-v1` fallback for the unknown canonical
`org.example.future-video-pipeline` feature. Explicit managed whole-`Blob`
transfer moves the two exact video bodies into the empty recipient. It publishes
the exact canonical shadow, leaves the recipient intrinsically read-only, and
separately verifies the manifest fallback digest in the controller after shadow
publication and before transient activation. After activation, replacing the
local fallback with corrupt same-shaped bytes proves that stale activation-time
admission cannot authorize delivery: maintained video export rejects before
FFmpeg or output publication. Restoring the exact body allows fresh
selector-bound operation-time verification to return the exact size- and
digest-verified native `Blob`. Delivery reuses that same immutable `Blob`
directly as its only video input without a second fallback storage read, while
the exact canonical shadow remains unprojected. The fixture has no canonical
audio, and embedded fallback-video audio is not used. This headless,
whole-`Blob` evidence does not qualify codec or browser behavior, a packaged
runtime, range or reference-scale transfer, fallback authoring, other-role or
simultaneous fallbacks, third-party feature-code activation, linked-only or
unmanaged delivery, a durable byte lease, broad export or offline-render parity,
or whole-handoff atomicity.

Recipient-local admission for unmanaged sources remains a bounded sequential
readability check, not an atomic snapshot or publisher authentication. The
owned canonical-PCM session above narrows provider-generation drift after
admission but does not turn admission itself into a durable byte lease.
Unmanaged audio is availability and geometry qualified, not
authenticated against a prior content digest. Selected metadata is reread
around each body, but body reads are not transactionally bound to that metadata;
same-metadata replacement during the sequential observations can go undetected,
and replacement or deletion afterward is not fenced. Injected
non-cooperative providers may continue work after cancellation rejects; shadow
save is not abort-atomic once begun; and separate repository instances and
processes are not serialized. Source-bearing saves and explicit local revision
loads bypass this admission. Explicit managed handoff supplies automatic
fresh-recipient acquisition for canonical PCM—including the maintained exact
schema 17 role-defined unavailable-or-unknown audio whole-mix fallback—and
retained original video. The
qualified video slice also covers the maintained exact schema 17 manifest-only
unknown-feature whole-project video fallback when handed off alongside its
editable retained original from Framescaper to a fresh Soundscaper store as
described above.
The maintained pathless desktop linked retained-video slice and narrow
linked-PCM managed-handoff exception described above are also qualified. Other
linked audio and every other linked or unmanaged original, authored proxies,
rendered-fallback authoring and transfer semantics beyond the closed audio
whole-mix and maintained video roles, relink beyond these exact- or
shape-compatible changed-content retained-video and linked-PCM Project Bin flows
and automatic watch behavior, general
copy/consolidate beyond the bounded same-store project-alias duplication above,
source-level linked-locator cleanup outside maintained same-store saves and
successful writable activations, general linked-locator cleanup beyond the
bounded startup and same-store save/activation/delete/clear inventories,
packaged chooser/import qualification, managed-media
runtime cleanup beyond the startup-bounded tracked inventory, recipient-local or
whole-handoff capacity reservation, stable playback identity beyond the
maintained owned canonical PCM, linked-PCM, and retained-video lifecycles,
content-frozen identity against same-inode mutation,
browser codec playback, packaged source-bearing relationships beyond the fixed
two-body Electron workflows described below, portable hard-link capacity
qualification, and a shared cross-product
revision journal and undo/redo history remain unqualified.
Product-local bounded revision history is the only history proven by the
composed return fixture.
Rendered-fallback digest verification remains controller-owned after repository
shadowing and before activation side effects. The video-delivery slice repeats
that verification independently at operation time as described below.

A composed source-free editor fixture creates and autosaves in Soundscaper,
closes its fenced host, discovers and bootstrap-reopens the same identity and
revision from a fresh Framescaper-local store, and commits the next revision in
Framescaper. It also proves a higher fencing token without stale takeover and
an empty shared media catalog. This composes the real controller, default
Soundscaper desktop-store selection, renderer repository, main service, and
host.

Historical pre-V18 desktop-library V9 and shared schema 17 evidence used a
dedicated Linux x64 CI job to build two separate unpacked packages and run them
sequentially as Soundscaper → Framescaper → Soundscaper. The current CI job is
retired and no longer runs this incompatible V9/V17 source-free handoff against
Framescaper V18/V10. Those historical processes share only one isolated appData
root, use separate product profiles, and the final process reuses the original
Soundscaper profile. After the
renderer-ready signal, each packaged executable drives the bounded pathless
preload IPC, exact-SHA-256 verifies its expected canonical source-free schema 17
document, commits revisions 1, 2, and 3, and checks both the renderer summary
and the main-only catalog row. Each stage requires clean recovery, no stale
takeover, a strictly higher fencing token, an increasing catalog revision, and
the expected preferred product. The runner awaits process exit and lease
release before launching the next stage.

Combined with the composed editor fixture, that closes only the generic packaged
source-free preload/IPC/multi-process/executable lifecycle gap. It does not
qualify packaged controller autosave or tab activation; source-bearing bytes,
playback, or managed media; concurrent opens; crash or stale takeover;
interruption or power loss; parent-, database-, or project-root path identity;
installers or file associations; or Windows, macOS, or ARM64. Third-party
activation gating and legacy Soundscaper library migration remain deliberately
separate from this slice.

<!-- policy-narrative:desktop-electron-lease-protections -->
Soundscaper V11 and selected Framescaper V20 each start one process-lifetime
main-owned lease in a separate product scope and database, carrying a
persistently monotonic fencing token. Startup waits out an unexpired lease left
by a crashed owner, recovers pending prepared, materialized, or committed
journals before authenticated renderer admission, renews the exact lease while
the process is live, fences new admission and publication on renewal loss,
drains admitted work, and releases only the exact lease before closing the
database. Soundscaper V11 authenticates library generation 11, project
generation 30, SQLite user_version 13 and scope v11; selected S30 inherits
established project behavior through exact S29. Framescaper V20 authenticates
library generation 20, project generation 31, SQLite user_version 22 and scope
v20. When no V20 store exists, its idempotent first-open importer opens a
settled V19 source read-only, authenticates exact V28 documents, explicitly
reimports them into F31, copy-forwards managed bodies byte-for-byte through
durable cursor checkpoints, resumes without duplication after interruption, and
never reopens for writing, rewrites, or deletes V19 or its inherited V18, V17
and V12 lease, lineage, or journal state. Publication compares expected metadata
and project revisions and SHA-256, admits only a strictly higher revision, and
passes prepared, materialized, committed, and complete journal checkpoints. The
closed runner executes `same-project-simultaneous-open`,
`writer-lease-transfer`, `stale-lease-takeover`, `conflicting-canonical-commit`,
`renderer-loss-during-operation`, `orderly-process-restart`, and
`crash-restart-recovery` for each selected product, then executes
`cross-product-simultaneous-open` once to prove the V11 and V20 storage roots
and fencing domains remain physically isolated. Qualification may only lower the
shipped lease TTL and renewal interval. CI is configured to build both unpacked
products and emit one bounded no-retry aggregate on Windows x64 and Linux x64.
Soundscaper V11 Windows x64, Soundscaper V11 Linux x64, Framescaper V20 Windows
x64, and Framescaper V20 Linux x64 remain pending-external; no accepted packaged
result is checked in, so this rule and m2-electron-lease-matrix remain Partial.
<!-- /policy-narrative:desktop-electron-lease-protections -->

<!-- policy-narrative:desktop-packaged-source-bearing-handoff -->
Historical pre-V18 desktop-library V9 and shared schema 17 evidence ran the two
frozen Electron workflows as six sequential packaged executable processes:
Soundscaper → Framescaper → Soundscaper and Framescaper → Soundscaper →
Framescaper. The current CI job is retired and no longer runs these incompatible
workflows against Framescaper V18/V10. In that historical evidence, each
workflow owns isolated shared appData and separate product profiles, then
returns to its origin profile. Its fixed exact schema 17 project contains one
canonical PCM audio track and clip plus one retained-original VP8 WebM video
track and clip that is also represented in the Project Bin. The origin publishes
both exact managed bodies. A fresh recipient follows the normal project route
into editor activation, hashes the exact Project Bin Blob, starts and stops
transport, edits the audio track name through native input, waits for the shared
revision 2 save, and invokes the visible Edit in the other product action. The
origin return reactivates the exact edited revision and both media bindings.
Before the editable recipient project, each fresh recipient also activates two
additional exact-schema-17 role witnesses from the same shared library. The
Soundscaper-to-Framescaper workflow witnesses `project-audio-mix-v1` and
`audio-track-render-v1`; the reverse workflow witnesses
`project-video-render-v1` and `video-clip-render-v1`. Each witness carries one
canonical source and one manifest-only digest-bound fallback source. On the
less-capable recipient it is intrinsically read-only, reaches the role-specific
compatibility indicator, starts and stops editor transport, and invokes the
visible cross-product handoff. Feature-requirement read-only is the only
read-only state admitted by that menu action; a busy editor or read-only project
lock remains blocked. The origin return opens both role witnesses before the
editable mixed-media project, proves the compatibility indicator absent, opens
an enabled track-name editor and cancels it without mutation, and starts and
stops transport. The paired aggregate owns `audio-whole-mix-electron-roundtrip`,
`audio-track-render-electron-roundtrip`,
`video-full-project-electron-roundtrip`, and
`video-clip-render-electron-roundtrip` and requires exact feature, project,
requirement, relationship role and fallback source identity plus unchanged
canonical-document, canonical-source-body, and fallback-body SHA-256 across
recipient and origin. Main-owned evidence also binds every handoff navigation,
the mixed-media document digest and binding IDs and digests, and strictly
increasing catalog revisions and fencing tokens across all six processes. This
qualifies only the `electron-soundscaper-to-framescaper-to-soundscaper-library`
and `electron-framescaper-to-soundscaper-to-framescaper-library` workflow IDs
plus those four exact role-return workflow IDs; the web `.scape` workflow matrix
is qualified separately. The evidence uses fixed small first-party fixtures on
Linux x64 with muted audio. It qualifies packaged activation, fallback playback,
unchanged project handoff, and editable origin return only for the four frozen
rendered-fallback roles; it does not qualify packaged rendered-media delivery,
fallback authoring or other relationships, audible or device-output fidelity,
general browser or codec coverage, linked or unmanaged media, installers or file
associations, concurrent opens, crash or power-loss behavior, or Windows, macOS,
or ARM64. This is legacy desktop-library-v9, shared-schema-17 pre-V18 evidence;
it does not authorize Framescaper V17 activation after the V18 selector lands,
and cross-product V18 transfer is copy-only preservation until separately
qualified.
<!-- /policy-narrative:desktop-packaged-source-bearing-handoff -->

A maintained Chromium browser spec closes the two frozen web `.scape` workflow
IDs through three isolated browser contexts in each product order. The origin
imports one canonical-PCM audio source and one generated WebM, persists them,
and exports through the browser-download fallback. The witness checks the exact
project ID and verifies every manifest asset body against its declared byte
length and SHA-256. A fresh recipient activates the audio and video clips,
starts and stops transport, edits a track name through its native input, exposes
the edit through Undo, invokes explicit save, and exports the return archive. A
fresh origin-product context reopens the same project ID, exact asset descriptor
set, and edited track name and starts and stops playback.

This evidence is limited to the fixed small first-party fixture in Chromium. It
does not qualify direct File System Access streaming, Firefox, WebKit or Safari,
long-form or reference-scale behavior, broad codec coverage, rendered
fallbacks, linked or unmanaged media, quota or eviction recovery, crash
behavior, or preservation of a shared cross-product undo journal.

Both frozen web workflows are legacy shared-schema-17 pre-V18 evidence. They do
not authorize Framescaper V17 activation after the V18 selector lands. Exact
V17 then takes the typed re-import route in Framescaper, and cross-product V18
transfer is copy-only preservation until separately qualified; archive copying
does not grant activation, edit, save, migration, or media-use authority.

This catalog rule is current-only. Activation-specific feature-capability
evaluation remains editor-owned. Explicit managed canonical PCM and retained
original video are the fresh-recipient source-byte transfers provided by this
library; this includes a maintained exact-schema role-defined unavailable-or-
unknown audio whole-mix fallback when its manifest is the only reference.
Ordinary saves remain
document-only. The maintained pathless desktop linked retained-video slice and
narrow linked-PCM managed-handoff exception described above are additionally
qualified. Other linked audio and every other linked or unmanaged original,
authored proxies, rendered-fallback authoring and transfer semantics beyond the
closed audio whole-mix and maintained video roles, general
copy/consolidate beyond the bounded same-store project-alias
duplication above, relink beyond these exact- or shape-compatible changed-content
retained-video and linked-PCM Project Bin flows and automatic watch behavior,
source-level linked-locator cleanup
outside maintained same-store saves and successful writable activations,
general linked-locator cleanup beyond the bounded startup and same-store
save/activation/delete/clear inventories, packaged chooser/import qualification,
managed-media runtime cleanup beyond the startup-bounded tracked inventory,
recipient-local or whole-handoff capacity reservation, content-frozen or
cross-restart playback identity, executable/UI and
browser-codec qualification, portable hard-link capacity
behavior, and shared cross-product revision or undo history remain outside it.
The remaining platform and fault matrix includes
per-platform parent- and database-path identity, power-loss durability, and
interrupted foreign collisions at registered random stage paths.
Unregistered or legacy pre-inventory stage-looking files are deliberately
foreign content and are not adopted or deleted.
Pre-release schemas 1 through 16 require source-media re-import and have no raw-
project migration path. Migration from the prior shared `v8` scope, the older
`v7`, `v6`, `v5`, `v4`, `v3`, `v2`, and `v1` scopes, or product-private Soundscaper libraries also remains unsupported by
this contract. AUP,
legacy XML AUP, and AUP4 remain separate maintained interchange boundaries.

## Project feature requirements

Schema 17 establishes the raw-project declaration and evaluation foundation. Its
root-level `featureRequirements` value is a bounded, normalized manifest. The
current nested manifest schema 2 has canonical namespaced feature identifiers,
unique requirement IDs, closed bypass or rendered-fallback dispositions, and
bounded display strings. Its closed rendered-fallback roles are
`project-audio-mix-v1`, `audio-track-render-v1`, `project-video-render-v1`, and
`video-clip-render-v1`. Every descriptor references an existing project source
of the declared audio or video kind and carries a canonical lowercase SHA-256
string; the clip role also carries one canonical target clip ID and the track
role one canonical target track ID. The track role is restricted to
`audioEffects` and validates its target at normalization: exactly one audio
track with an active effect rack, at least one enabled effect, and a non-empty
clip lane whose clips are audio, carry exact timeline placement, and do not
reference the fallback source, whose `frameCount` must equal the lane extent.
Manifest normalization therefore receives the project tracks at every
validation, creation, clone, commit, remap, and inspection call site, and a
caller that supplies no tracks fails closed for the track role. Nested manifest
schema 1 remains a narrow compatibility input and deterministically normalizes
audio and video descriptors to the corresponding whole-project roles. It cannot
declare the clip or track relationship. These checks validate descriptor
syntax and source identity; they do not hash or authenticate the referenced media bytes.

Schemas 1 through 16 are rejected at the raw-project boundary before feature-
requirement reconciliation. Maintained exact-schema-17 create, load, clone, and
commit paths reconcile the editor-owned
`soundscaper.audio-effects` bypass requirement when a maintained first-party
processor exists in a non-label or non-video track, mixer group, mixer send, or
master rack, and the editor-owned `soundscaper.video-effects` bypass requirement
when a maintained first-party video effect exists on a timeline or Project Bin
video clip. Disabled effects and inactive audio racks still require
preservation; missing or foreign effect types and video-effect stacks on
non-video clips do not. An explicit publisher declaration for the same
capability wins without duplication, while conflicting use of either reserved
owned requirement ID rejects.

The pure evaluator compares a normalized manifest with caller-declared known
and available feature IDs and reports available,
unavailable, and unknown entries. Each item retains its declared bypass or
rendered-fallback disposition separately from its effective native, bypassed,
or rendered-fallback disposition. Unknown feature IDs remain declarative data and
cannot activate code. Malformed current-schema manifest state fails validation;
a newer outer project schema is instead cloned opaquely and returned read-only
before current-manifest normalization.

At the controller boundary, explicit stable broad capability IDs map one-to-one
to the maintained keys in each selected product profile. The controller snapshots that
profile at construction: only a strict `true` value makes a registered feature
available, a registered non-true value is unavailable, and an unregistered ID
is unknown. It evaluates exact schema 17 from the actual project history that
will be activated, before activation side effects. A report containing an
unavailable or unknown requirement makes the project intrinsically read-only.
When an existing same-ID tab wins, its stored read-only declaration also wins
over the ignored incoming document's flags.
The report is retained per tab, remains deeply frozen across session metadata
clones, and is exposed on the document snapshot. Future schemas produce no
feature report, and their `featureRequirements` value is not traversed.

For the maintained first-party audio-effect slice, the controller derives a
transient playback projection from that authoritative activation project and
report before activation side effects. Projection requires exact schema 17 and a
registered audio-effects item that is unavailable, declares bypass, and has the
effective bypassed disposition. Active, enabled, not-already-bypassed maintained
processors in non-label and non-video track, mixer-group, mixer-send, and master
racks become minimal bypassed copies only for editor engine loading. Inactive
racks, disabled or already-bypassed effects, and missing or foreign effect types
remain untouched. Stable IDs and effect types are bounded, a count above 4,096
rejects rather than truncates, and future schemas return
unchanged before rack traversal.

The canonical project, history, source loading, persistence, and save paths do
not receive that projection. Deeply frozen per-tab session metadata and the
document snapshot identify each affected scope, owner ID, effect ID, and effect
type without reading or retaining effect params, context, state, or other
payloads.

The maintained exact schema 17 audio whole-mix fallback is defined by the closed
`project-audio-mix-v1` role rather than a producer allowlist. It activates only
when exactly one report item has a canonical namespaced feature ID, is
unavailable or unknown with declared and effective `rendered-fallback`
dispositions, and has an audio descriptor that exactly matches the canonical
manifest. The closed role supplies only fixed media semantics; the feature ID
remains opaque identity, and Soundscaper does not discover, load, or execute its
feature code. The referenced source must be mono or stereo, cover a safe
positive frame range, and match the project sample rate and master channel
count. ADM and surround projects, ambiguous candidates, descriptor drift,
missing sources, unsafe geometry, and collisions with the reserved synthetic
track or clip IDs reject rather than guessing.

The closed `audio-track-render-v1` role is the track-local sibling of that
whole-mix contract and of the clip-local video relationship. The audio playback
umbrella qualifies at most one audio rendered fallback of either closed audio
role; more reject as ambiguous. The track branch accepts only an exact
registered `audioEffects` item reported unavailable with declared and effective
`rendered-fallback` dispositions whose descriptor exactly matches the canonical
manifest by requirement ID, feature ID, role, target track ID, audio kind,
source ID, and SHA-256; because the capability is always registered, unknown
availability never qualifies this role. The projection rechecks the manifest
contract and the source geometry — the fallback source must be audio, mono or
stereo, and match the project sample rate, its frame count must equal the lane
extent, ADM routing rejects, and a collision with the reserved rendered lane
clip ID rejects — and then replaces only the target lane with one neutral
rendered clip from frame zero to the lane extent while neutralizing only that
track's effect rack. The track keeps its identity, gain, pan, mute, solo, and
envelope, so native mixing and routing still apply over the rendered lane, and
every other track, clip, mixer group, mixer send, master rack, source, and
Project Bin entry stays canonical. The required fallback source is staged
privately exactly like the whole-mix role, while ordinary lanes still load
their ordinary sources; the playback reapply path skips ordinary source loading
only when the whole-mix role is the projection's sole audio surface. Admission
capture binds the target track's type, rack activity, effect identity and
inertness flags, lane membership, and exact lane placement, so target drift
fails currentness, and a lane or rack change that breaks the declared geometry
fails admission capture itself, which the currentness fence reports as an
admission change.

On explicit desktop handoff, manifest reachability retains this fallback even
when no timeline or Project Bin clip references it. A real Soundscaper sender
using the unknown canonical `org.example.future-mixer` feature is intrinsically
read-only solely because of the feature-requirement report, but it retains the
current writable project lock. The controller therefore publishes the unchanged
active snapshot without flushing; declared read-only, future-schema, missing-
or stale-lock, and lock-contended projects still reject. A fresh Framescaper
recipient acquires the canonical original and fallback PCM as exact managed
bodies plus the canonical project shadow.
That transfer authenticates each managed descriptor and body digest; the
controller then separately verifies the manifest fallback digest before
read-only activation. The engine alone receives the synthetic whole-mix
projection and exact fallback samples, while the document snapshot remains the
publisher's canonical project.

The track-local relationship reaches the same explicit desktop handoff. Its
sender stays compatible and editable because the registered rack is available,
and an ordinary save stays document-only; the explicit handoff publishes the
target-lane and native-lane originals plus the digest-bound track render as
exact managed bodies. A fresh recipient that reports the registered
`audioEffects` capability unavailable acquires all three bodies
digest-verified, preserves the byte-exact canonical shadow, and admits the
relationship by role, target track ID, source ID, and SHA-256 before the
target-lane-only projection plays. Delivery on that recipient refuses
corrupted recipient-local render PCM before render or download and, after
exact repair, mixes the native lane with the verified private provider into
exact WAV output while the canonical project stays unchanged.

`org.example.future-mixer` supplies this unknown-feature composed
Soundscaper-to-fresh-Framescaper witness. The canonical manifest, frozen
metadata, and localized source/component UI stay bound to the exact feature ID
and requirement ID without exposing fallback internals. Its operation-time
export selector cross-binds the exact requirement ID and feature ID with the
audio kind, source ID, and SHA-256.
Corrupt same-shaped recipient-local PCM after activation triggers tamper refusal
and rejects delivery before rendering or output; exact repair restores the exact
PCM and produces a final-mix float WAV containing the expected fallback samples
while the canonical project and stored project shadow remain unchanged.

For editor playback, that source becomes one neutral whole-mix clip using its
full frame range from frame zero. The transient projection removes every
canonical audio clip and track and neutralizes mixer and master processing to
prevent double playback, while retaining video and label timing. Initial
activation and later engine reapplies use the same playback-project service.
Fallback-only sources are required explicitly and their stored metadata is
rechecked. Short sources are decoded and their buffer geometry must match
exactly; oversized sources must expose a streamable chunk provider. Readiness
does not prefetch or revalidate streamed chunks, so a later provider failure
remains possible. Initial activation stages only the required fallback source's
decoded buffer or stream-provider candidate privately before obtaining the
activation reservation, without changing shared buffer, provider, or engine
chunk-source state. Metadata, audio-context, and decoded-body stalls race the
controller-lifetime signal; cancellation rejects promptly with the exact signal
reason, and late settlement cannot publish buffers, chunk providers, engine
chunk sources, missing-source state, or status. If post-preparation currentness
or reservation fails, the stage is discarded and the prior buffer and provider
identities, engine chunk-source state, active project, tab, and lock remain
unchanged. After currentness and reservation succeed, ordinary-source loading
excludes the required fallback. Ordinary transient buffers and the staged
required representation are composed into private source-buffer and
chunk-source snapshots; the staged required representation wins a conflicting
transient before those snapshots reach the engine. After the engine callback
succeeds and the lifetime signal remains active, commit runs its caller-supplied
synchronous project-identity or activation-admission assertion immediately
before shared publication, with no intervening await; only then do the shared
source maps change.
Each canonical playback reapply owns one replaceable controller-lifetime task.
A newer reapply or a successful project switch aborts stalled metadata,
audio-context, or decoded-body source preparation with the exact signal reason;
the switch does so before teardown. Late settlement is fenced from
buffer, provider, engine-source, missing-source, and status publication. In the
tested stalled-preparation race, only the newest source-ready projection enters
the engine.
The standalone audio-delivery projection invokes the
audio rendered fallback and reapplies the audio effect bypass playback
applied — playback and delivery are the same render, so a bypassed effect
never reappears in the delivered file. It does not compose the video
rendered fallback, and a simultaneous rendered fallback rejects
instead of delivering a partial projection. Maintained final-video delivery
is the separate composed path: it may compose one audio whole-mix fallback
with one maintained video fallback through a single joint integrity
admission, described with the video slice below. Standalone audio delivery
accepts normalized final-mix audio only. Stems, BW64, and any ADM setting
reject before fallback verification, export planning, destination selection,
storage preflight, or rendering.

Under the owned export signal and task, project-generation, and operation
currentness fences, fresh operation-time verification binds an exact selector
to the active requirement ID, feature ID, audio kind, source ID, and SHA-256,
together with the closed audio role and, for the track role, the exact target
track ID, in the canonical project; selection, currentness, and
conflicting-claim comparison all include that relationship. Selector mode performs a full canonical chunk scan of
only that selected source's `audio-f32le-chunks-v1` sequence, checks its source
geometry and aggregate digest, and builds an admission-time per-chunk digest
table. It returns a private chunk provider with the exact admitted source
geometry before planning or any other export work. In maintained final-video
delivery that same audio selector is passed alongside the video selector to one
joint verification: their cumulative non-raiseable 64 GiB preflight applies
before both fallback body reads, this audio chunk scan runs first, and
nonselected fallback bodies are not read.

For the whole-mix role, the delivery clone receives an empty private
audio-buffer map and that provider as its sole chunk render source. Global
source buffers, providers, and cache state remain unchanged, and whole-mix
fallback delivery does not prepare committed time/pitch caches. Every provider
read rereads one exact stored chunk, copies
its `Float32Array` channels, and checks canonical geometry and the admission-time
chunk digest under currentness and cancellation fences. A changed storage body,
geometry, or digest becomes the stable audio-fallback integrity error; an
offline integrity failure does not retry through realtime rendering. Ordinary
audio export keeps its existing source and renderer contracts.

The track render composes instead of standing alone. Its delivery clone
receives ordinary source buffers and chunk providers with the fallback source
removed from both, so the fallback bytes are readable only through the
operation-time digest-bound private provider, which replaces any ordinary
provider or cached buffer for that source; committed time/pitch caches are
prepared for the native lanes, and missing ordinary sources still refuse
export. Stems, BW64, and any ADM setting reject for both audio roles before
export side effects, and the same role-keyed composition reaches the audio side
of maintained final-video delivery through one shared recipe.

The canonical project, history, persistence, and save paths never receive the
playback or delivery projection and remain unchanged by final-mix output.

Deeply frozen per-tab and document-snapshot metadata retains the selected
feature ID, requirement ID, and source ID and drives one localized
active-during-editor-playback source/component UI indicator. The UI matches the
exact feature and requirement without reading or exposing the audio kind,
source ID, or digest; operation-time export separately binds the exact audio
kind and SHA-256 from the canonical manifest. More than one qualifying audio
rendered fallback of either closed audio role across any
feature identities rejects as ambiguous, and
non-audio roles never qualify for this projection. Simultaneous audio/video
rendered fallbacks reject for standalone final-audio delivery; maintained
final-video delivery instead applies the active audio rendered-fallback
projection of either closed audio role
whenever it qualifies, so the delivered video audio renders through its
digest-bound private chunk provider even when no video rendered fallback is
active, and may compose that one audio whole-mix or track render with one
maintained video fallback through a single joint integrity admission, while
anything beyond that exact one-audio/one-video composition rejects. Future
schemas and earlier Soundscaper schemas remain outside this slice. Linked-only
and unmanaged delivery, fallback authoring, freeze and proxy relationships,
publisher authenticity, and third-party code activation remain unqualified, as
do stems, BW64 or ADM delivery and ADM or surround playback. Packaged runtime
or UI final-delivery workflows, operating-system behavior, browser audio
behavior beyond the maintained portable-open witness, reference-scale evidence,
and a durable byte lease remain unqualified. The exact Linux x64 packaged
workflow qualifies source/component UI activation and transport playback for
both frozen audio roles. The separate maintained video slice below does not
broaden that boundary.

The maintained exact schema 17 video rendered-fallback projection has two closed
relationships. `project-video-render-v1` accepts any canonical namespaced feature
ID reported unavailable or unknown. `video-clip-render-v1` remains restricted to
exact `videoEffects` reported unavailable. Exactly one item may qualify, and it
must have declared and effective `rendered-fallback` dispositions. Its video
descriptor must exactly match the canonical manifest by requirement ID, feature
ID, disposition, relationship role, optional target clip ID, video kind, source
ID, and SHA-256. The separate controller fallback-integrity admission verifies
the local body before activation side effects. Maintained final-video delivery
then runs one joint operation-time integrity verification over the active audio
and video selectors it derives. The video selector binds the requirement ID,
feature ID, relationship role, target clip ID, video kind, source ID, and
SHA-256; an active audio fallback of either closed audio role contributes the
separate role- and target-bound audio selector
described above. Their cumulative non-raiseable 64 GiB preflight applies before
both fallback body reads. A composed audio chunk scan runs first and returns its
digest-bound private chunk provider; the selected video body is then loaded
under the export-task signal, size-checked and hashed as its canonical native
`Blob`, and retained as that exact immutable `Blob`. Nonselected fallback bodies
are not read, and verification completes before the video plan, storage
preflight, audio render, FFmpeg call, or publication.

`project-video-render-v1` retains the whole-project behavior. Its source must
have the exact video kind, match the project sample rate, carry positive
safe-integer frame count, width, and height, and carry a positive finite frame
rate. Its transient projection replaces all timeline video clips and tracks
with one neutral clip and track using the fallback's full source from frame zero.
It preserves audio and label clips and tracks, Project Bin, sources, and every
other canonical field. Missing or duplicate sources, descriptor drift, invalid
geometry, or a reserved synthetic track or clip collision reject.

`video-clip-render-v1` is a closed `videoEffects`-only relationship. It binds one
exact target clip ID whose timeline video clip contains an enabled maintained
effect. The fallback source must be different from the target's canonical
source, declare `hasAudio: false`, have frame count equal to the target clip
duration, and match that canonical source's sample rate, width, height, and
frame rate. The transient projection replaces only that target timeline clip.
Its source starts at frame zero, source duration becomes the target duration,
trim values become zero, speed becomes one, and video effects become empty.
Track membership, timeline placement, duration, group, A/V link, layer and
transition context, every unaffected clip and source, and the canonical project
and history remain unchanged. The manifest-only fallback becomes an explicit
required source before engine or preview entry, and preview lookup follows the
projected clip's exact source identity rather than assuming canonical clip state.

The maintained video-delivery projection applies the active audio
rendered-fallback projection — the audio whole-mix or the track render —
first and then the selected video rendered fallback. It represents at most one
audio and one video rendered fallback and reapplies exactly the audio and
video effect bypasses playback applied, so a bypassed effect never
reappears in the delivered file; unrepresented, duplicate same-kind,
unsupported-role, or additional rendered
fallbacks reject instead of delivering a partial projection. Standalone
final-audio delivery does not compose and still rejects simultaneous rendered
fallbacks. The verified `Blob` is the whole-project plan's only video input or
the clip-local plan's selected target input. Ordinary video export and
composition consume the projected target alongside normally loaded unaffected
video, preserving its track and transition context. An active audio whole-mix
renders through an empty private audio-buffer map and its sole admitted chunk
source without committed time/pitch cache preparation; an active audio track
render instead keeps ordinary lane buffers and providers beside its private
fallback provider, which replaces any ordinary representation of the fallback
source, with committed time/pitch caches prepared for the native lanes;
otherwise canonical
audio clips and effects stay in the delivery snapshot and render into the
separately staged mix. Embedded fallback-video audio is not extracted or
mapped. The canonical project, history, persistence, and save state remain
read-only and unmodified.

Export checks project, task, generation, and operation currentness before and
after verification, binds admission to the canonical relationship, and checks
again after FFmpeg and publication. Refusal or cancellation begins no later
planning or media work. The relationship snapshot includes role, target clip ID,
canonical source and duration, maintained target effects, and required source
geometry. Role, target, context, or same-source relationship conflict rejects
before media use. This is exact point-in-time immutable-`Blob` reuse, not a
durable storage-record lease or cross-process replacement guarantee.

The `org.example.future-video-pipeline` unknown-feature headless witness carries
a whole-project fallback and retained original through explicit managed handoff.
A second headless `video-clip-render-v1` witness carries the canonical target,
unaffected video, and manifest-only fallback body to a fresh recipient, preserves
the target clip ID and digest-bound fallback body in the exact canonical shadow,
reopens that shadow, and performs relationship-bound admission before playback.
Portable `.scape` export and import preserve the same relationship; a copy
collision remaps only the fallback source ID and preserves the canonical target
clip ID. Ordinary video export, portable `.scape` collision handling, and
managed handoff therefore share the same closed relationship rather than
inventing route-local identities. Composed product-identified return roundtrips
close the archive loop in both product orders for all four closed roles — the
clip-target and whole-project video roles and the track-local and whole-mix
audio roles: the less-capable recipient reports rendered-fallback, returns the
exact portable bodies it received, and the origin reopens natively editable
with byte-identical manifests, native effect payloads, and asset digests.

Deeply frozen per-tab and document-snapshot metadata and the localized
source/component UI bind only the exact feature ID and requirement ID without
exposing source ID or digest. The exact one-audio/one-video final-video
composition is qualified. More than one qualifying fallback rejects as
ambiguous. Multiple clip fallbacks, duplicate same-kind fallbacks, and other
mixed fallback relationships are unqualified. Audio-kind descriptors of either
closed audio role never qualify for this video projection; the delivery layer
admits an audio fallback only through its separate exact role, and noncanonical
feature IDs fail manifest admission. Unknown canonical feature IDs qualify only
for the whole-project role and do not activate third-party feature code. Future
schemas remain outside this slice. Generic fallback authoring and other
relationship roles are unqualified. Linked or unmanaged delivery is
unqualified, as is simultaneous rendered fallback delivery beyond that exact
composition; standalone final-audio delivery still rejects simultaneous
fallbacks. Freeze, proxy, relink, embedded fallback audio, and broader render
parity are unqualified. The exact Linux x64 packaged workflow qualifies
source/component UI activation and transport playback for both frozen video
roles. Packaged runtime or UI final-delivery workflows are unqualified, browser
behavior is unqualified, codec qualification is unqualified, and reference-scale
evidence is unqualified. Earlier Soundscaper
project schemas are not a compatibility target for this slice beyond retained
outer migrations and deterministic nested manifest-schema-1 whole-project
normalization. Whole-handoff atomicity and a durable storage or cross-process
byte lease remain unqualified.

For the maintained first-party video-effect slice, the controller likewise
derives a transient activation projection only for exact schema 17 when the
registered video-effects item is unavailable, declares bypass, and has the
effective bypassed disposition. Enabled maintained effects on timeline and
Project Bin video clips become minimal disabled copies; disabled effects and
missing, foreign, or wrong-kind stacks remain untouched. Stable clip and effect
IDs are bounded to 256 characters, effect types to 128 characters, the combined
count above 4,096 rejects rather than truncates, and future schemas return
unchanged before clip or Project Bin traversal.

Only transient engine loading receives the video project projection. The WebGL
preview filters exact affected effects from timeline stacks using trusted
metadata, caches the selector, and preserves unchanged stack references.
Canonical project, history, source loading, persistence, save, export, and
offline-render paths do not receive the projection. Each placeholder entry in
the deeply frozen per-tab session metadata and document snapshot identifies
only location, clip ID, effect ID, and effect type without reading or retaining
params, context, state, or other opaque payloads.
This exact-schema-17 bypass slice does not attempt compatibility with earlier
Soundscaper project schemas. Its separate rendered-fallback rule above does not
broaden that boundary.

For an incompatible active document, the maintained active workspace consumes
`featureRequirementsCompatibility` directly and derives a separate frozen
structured notice containing only unavailable and unknown requirements. A
persistent, non-dismissible document-level localized region shows recomputed
counts, bounded display names, stable feature IDs, availability, and the
declared disposition while that active tab is selected; the effective
disposition remains structured metadata rather than being mislabeled as the
declaration. The region is keyboard-focusable when its bounded list scrolls.
It does not render the evaluator's message, read fallback internals, expose an
activation control, or claim feature-code loading. For the role-defined audio
and closed video rendered-fallback slices it shows only
each metadata-bound active-playback indicator described above. For
qualifying audio- or video-effects items with bypass metadata, the same notice
matches the corresponding frozen projection metadata to one requirement and nests
persistent localized, control-free affected-effect placeholders. Audio rows use
the maintained effect label and canonical track, group, send, or master owner;
video rows use the maintained effect label and canonical Timeline or Project
Bin clip owner. Neither inventory reads effect payloads. A compatible or `null`
report produces no notice, tab switching follows the per-tab report, and the
workspace never traverses future-schema `featureRequirements` state.

A separate read-only affected-object pass names the canonical objects behind
each unavailable or unknown requirement, including publisher feature identities
the maintained first-party inventories cannot name, and says plainly when it can
name none. It runs for every maintained feature schema with a `soundscaper-project` report
whose `compatible` value is exactly `false`, and it returns one entry per report
item reported unavailable or unknown, or no index at all when no item qualifies.
A compatible report, an available-only report, an absent, item-less, or
differently formatted report, and every other schema return no index without
traversing the project. The pass reads canonical state and changes none of it:
it walks the live canonical current project but projects, mutates, bypasses, and
reprojects nothing and reaches no engine project or audio graph, and beyond the
containers it walks it reads only identity and inertness—track type, clip kind,
effect type, stable IDs, and the `effectsActive`, `enabled`, and `bypassed`
flags—never effect params, context, state, or other opaque payloads. From the
report it reads only the format and compatibility, each item's requirement ID,
feature ID, and availability, and the declared fallback role and target clip or
track ID;
evaluator messages, fallback source IDs, and digests stay unread. Every named
property it takes from project data goes through an own-data-property check, so
an accessor or inherited property in a named position is treated as absent
rather than invoked or thrown on. That guarantee covers named reads only: array
membership is reached by ordinary element access, so a getter installed on an
index of `tracks`, `clips`, or an effect stack is still invoked.

Attribution has three channels, and it follows the declared descriptor rather
than the outcome of playback qualification or integrity admission. An item whose
manifest declares a rendered fallback is attributed from that declared role
alone: `project-audio-mix-v1` names every non-label, non-video track rack, every
mixer group and send, the master rack under its fixed `master` identity, and
every non-video timeline clip; `project-video-render-v1` names every video track
as well as every timeline video clip, because the projection collapses both and
naming only the clips would leave a video-track-only project reporting nothing
while every video track was discarded; `audio-track-render-v1` names the
declared target track together with each timeline clip its lane anchors,
because the projection replaces that lane and rack wholesale; and
`video-clip-render-v1`—like any other
role reaching this pass—names at most the one timeline clip whose ID equals the
declared target clip ID. Because the role is taken as declared, a
`video-clip-render-v1` descriptor on an item reported unknown is still indexed,
and its target clip is still labelled as replaced during editor playback, even
though that clip role qualifies for editor playback only when the item is
unavailable and carries the maintained video-effects capability ID. That label
reports a declared relationship, not an admitted or qualified substitution.

An item that declares no fallback and carries the maintained audio-effects
capability ID is instead attributed effect by effect across every non-label,
non-video track rack, every mixer group and send, and the master rack; the
maintained video-effects capability ID is attributed likewise across every
timeline and Project Bin video clip. Both channels collect only effect types
outside the maintained registry, so every entry they produce is flagged
unregistered: a registered type already has its own first-party placeholder
section above, and collecting it would spend the shared ceiling on rows the
notice discards. Both also apply the same inertness gates as the sibling bypass
projections—the audio channel skips a rack whose `effectsActive` is `false` and
an effect whose `enabled` is `false` or whose `bypassed` is `true`, and the
video channel skips an effect whose `enabled` is `false`, which is its whole
gate because a persisted video effect carries no bypass flag. The two channels
are not equally reachable. Persisted audio-effect validation admits any
non-empty type string, so an unregistered rack processor is an ordinary schema-12
occurrence; video effect stacks are normalized against the maintained video
registry when the project opens, so a foreign video effect type cannot exist in
a project that opens at all, and the video-effect channel is reachable in
principle but not by any project that opens.

A requirement is marked attributable only once a channel has actually named an
object, and a requirement no channel could name one for is explicitly
unattributable, carrying an empty object list rather than a guess. That is the
normal outcome for an arbitrary publisher feature ID with no fallback
descriptor, and equally the outcome for a maintained effect capability whose
project holds no active unregistered effect in scope and for a declared fallback
that matches nothing—a target clip ID no timeline clip carries, or a video role
on a project with no video track and no video clip. An object the shared ceiling
dropped still counts as named; a candidate whose identity could not be read does
not. The notice renders an unattributable requirement as one explicit line
stating that its affected objects cannot be identified, instead of an empty list
or nothing at all.

Stable IDs are bounded to 256 characters and object types to 128 while schema-12
validation bounds neither, so a valid document can carry an identity longer than
either bound. Exceeding a bound does not reject: this pass runs on the
document-snapshot path, where a throw would blank the editor, so a missing,
empty, or over-long stable ID or object type skips the object instead of
truncating the value or failing snapshot construction. Disclosure of those skips
is uneven. An effect whose type is a readable non-empty string but whose stable
ID is missing, empty, or over-long, or whose type exceeds 128 characters, is
counted in its requirement's omitted count; a track, mixer bus, or clip whose
own ID is unreadable is dropped silently by the traversal, taking every effect
it would have anchored with it, so a list can be short by an unnamed object
without saying so. A clip whose kind is not a readable bounded string is still
listed, defensively, under the generic object type `clip`.

One shared, lower-only 4,096-object ceiling is spent across the whole index in
report order, so a large early requirement can starve a later one, whose objects
then survive only as an omitted count. Exhaustion truncates rather than rejects:
the pass records the object in that requirement's omitted count, marks the index
truncated, and continues. The sibling first-party audio- and video-effect bypass
passes reject above that same 4,096 count instead, and the divergence is
intentional—truncating a bypass would leave a maintained effect audible, while
truncating a read-only advisory list leaves nothing audible, so a large project
must degrade this list rather than fail its open to produce one. The ceiling
bounds the retained list, not the traversal: enumeration continues after
exhaustion, every remaining rack, clip, and effect stack is still walked, and
the whole index is recomputed on every document snapshot for as long as an
incompatible schema-12 document is active, so an oversized project pays that walk
each time. Raising the ceiling, or supplying a negative or non-integer seam,
rejects with a `RangeError`, and that rejection is the pass's only one;
everything else about it is total.

The controller derives the index in the document snapshot from the live
canonical current project together with the retained activation-time report, so
the named objects follow later edits while each entry's availability stays fixed
by activation. It is computed from the canonical project rather than from any
playback or bypass projection, is frozen at every level, is not persisted, and
is not stored in per-tab session metadata. The workspace hands it to the same
post-open notice, which nests one persistent localized, control-free
affected-object section under the matching requirement, rendered only for a
requirement with a listed object or a nonzero omitted count. Each row shows the
object ID, the object type, and one of two localized labels—replaced during
editor playback on the rendered-fallback channel, otherwise a type this editor
does not recognize—and is keyed by channel, location, scope, owner, and object
ID, because schema 17 enforces ID uniqueness only within a collection and a track
and a clip may legitimately share one. The section shows only newly visible
state, namely the canonical objects a declared rendered fallback names and
effects whose type is outside the maintained registry; because the effect
channels never collect a registered type at all, the notice's registered-effect
filter is a redundant safeguard rather than a live deduplication. A nonzero
omitted count adds one line stating that further affected objects are not
listed, without distinguishing a ceiling-dropped object from an unreadable one.
No row exposes a control.

Beyond that disclosure the pass adds no behavior. It introduces no bypass:
bypass remains exactly the two maintained first-party audio- and video-effect
slices, and generic per-feature bypass controls remain unimplemented. It makes
no previously invisible object controllable, selectable, or actionable, and the
post-open notice stays control-free and informational. It does not change
activation, read-only enforcement, the engine project, persistence, offline
render, export, or delivery, and it verifies or authenticates no bytes. It
grants no new capability to third-party or unknown features: naming the objects
a requirement affects is not discovery, loading, or execution of publisher
feature code, and is not a claim about what the unavailable feature would have
done to a named object.

Raw and stored-project controller activation has a separate integrity admission
step for exact schema 17. The maintained role-defined audio and closed
video delivery slices invoke the same body verifier at export-operation time,
independently of activation admission; standalone audio delivery invokes it with
only its audio selector, while composed final-video delivery makes one joint
invocation carrying both selectors. Activation
verifies the authoritative project that would be activated, including existing
same-ID tab history, before project-generation invalidation, recording or engine
shutdown, lock changes, session publication, ordinary engine-source loading, or
normal activation persistence. Admission reads publish no storage maintenance. Audio fallbacks are read from their
local `storageKey` and hashed as the canonical
`audio-f32le-chunks-v1` sequence: a four-byte little-endian frame count followed
by planar little-endian Float32 channel bytes for each checked project chunk.
That path shares `.scape` export's PCM geometry validation and cumulative
65,536-chunk ceiling. Video fallbacks resolve their retained original-media
`storageKey`, require a genuine immutable `Blob`, and hash its actual body
sequentially through the non-raiseable 4 MiB media-digest window. Identical
source claims are hashed once. Unique claimed audio bytes and video sizes share
a non-raiseable 64 GiB cumulative ceiling that rejects before fallback body
reads. Conflicting digests reject before storage reads, and a missing,
malformed, or mismatched local asset rejects activation. The controller binds
existing-tab verification to an opaque session-owned history token. After
verification it upgrades that token—or the still-absent project ID—to one
exclusive session activation reservation before the first activation side
effect. The reservation rejects target history replacement, close/reopen, and
competing active-project publication through synchronous session publication,
and is released in `finally`. The controller-lifetime signal is propagated
through verification, and maintained
store operations cooperate with it to cancel and close an active audio
iterator. Read-only video-metadata preflight is raced against cancellation, so
an injected provider that ignores its signal may continue after the admission
has rejected. A provider-stalled fallback body read can instead delay
cancellation settlement and iterator cleanup. Empty manifests and future
schemas perform no asset reads, and future `featureRequirements` state is not
traversed.

Audio delivery selects the exact active requirement ID, feature ID, audio kind,
source ID, SHA-256, closed audio role, and, for the track role, target track ID
under the owned export signal. Selector mode scans only
that source's complete canonical chunk sequence and returns a private provider
bound to the exact source geometry and admission-time per-chunk digests. Each
render read checks a fresh owned copy of the stored chunk against those bounds;
the provider never becomes a global engine source. Verification and operation
currentness complete before planning or rendering, and a mismatch or
cancellation reaches no output work.

Video delivery passes the owned export-task signal to a fresh verification of
the canonical project with the exact requirement ID, feature ID, video kind,
source ID, and SHA-256 selected by the maintained delivery projection, together
with the exact audio selector when that projection also represents an audio
fallback of either closed audio role. One joint selector-mode verification
applies the cumulative 64 GiB
ceiling before both fallback body reads, scans any composed audio source first,
returns the canonical native `Blob` whose exact size and digest it verified, and
does not read or admit nonselected fallback bodies.
Export checks task, project-generation, and operation currentness before that
verification, asserts the returned admission against the same canonical project
and selectors, and repeats those fences after verification. It reuses that same
immutable `Blob` directly as the whole-project plan's only video input or the
clip-local plan's selected target input, without a second fallback storage
read; any unaffected clip-local video input still loads through ordinary storage
reads. It then checks currentness again after FFmpeg and across output
publication. Verification completes before video planning, storage preflight,
audio rendering, FFmpeg, or output publication. A mismatch or cancellation
reaches none of that later delivery work.

These are exact point-in-time provider and immutable-`Blob` admissions at the
maintained controller boundary, not durable leases over the underlying managed
storage binding. Calling `store.loadProject()` directly does not verify fallback
bytes, and admission does not prevent later low-level or cross-process
replacement of that storage binding, verify a nonselected fallback body, or
establish publisher authenticity. Admission itself does not
substitute fallback media at runtime; the separate exact-schema-17 role-defined
audio whole-mix, audioEffects-only track-target,
role-defined whole-project video, and videoEffects-only
clip-target projections described above perform their narrow editor-playback and
delivery uses.
Initial required-source preparation is
lifetime-abortable and occurs before activation reservation and side effects.
A signal-ignoring metadata, context, or decoded-body operation may continue
internally after cancellation, but its late settlement is fenced from buffer,
provider, engine-source, missing-source, and status publication. An engine
application already entered is not abortable or transactional and can leave
engine-side effects after callback failure or cancellation. A later activation
failure after a successful commit does not roll back committed shared source
state or earlier activation effects. Ordinary-source loading remains outside
this required-source staging transaction, and short-buffer retention after
engine application remains subject to cache-fit policy. Readiness does not
prefetch or revalidate streamed chunks. The maintained projections do not
provide generic per-feature bypass controls, rendered-fallback roles beyond the
closed audio and maintained video relationships, authored freeze or proxy
relationships, publisher authentication or
third-party feature-code activation, simultaneous fallback delivery beyond the
exact one-audio/one-video final-video composition, linked-only or unmanaged
fallback delivery, whole-video fallback audio handling, ADM or surround
fallback playback, broad export or offline-render parity, future-schema
preservation, earlier Soundscaper-schema compatibility, reference-scale or
browser/packaged codec qualification, or a complete third-party activation gate.

The same selected product service now powers a programmatic current-format `.scape`
inspection report. The composition root snapshots the selected product
and injects its evaluator as provider-owned state, so caller options cannot
override it. After archive integrity and project-source validation, exact schema
10 fallback claims are bound by source ID, kind, and SHA-256 to their canonical
manifest asset before evaluation and any project collision lookup. The deeply
frozen `featureRequirementsCompatibility` report therefore follows descriptor
binding, but inspection does not read or hash asset bodies and performs no
import, persistence, or activation. Future project schemas return `null`, and
their `featureRequirements` value is not traversed. This report does not claim
body verification or activate rendered fallbacks, and it is not a third-party
activation gate.

The maintained normal no-collision open workflow now turns an incompatible
exact-schema-17 report into an explicit choice: **Open read-only** or **Cancel**.
If the imported ID also collides, the dialog presents the compatibility report
and the collision together with **Open as read-only copy** or **Cancel** as a
single decision. Compatible collisions offer the safe **Open as copy** or
**Cancel** choices. A future-schema `null` report does not enter this feature
decision. The low-level native-open API remains outside this maintained-UI rule
and retains its caller-supplied collision policy; third-party activation is
likewise not gated here.

The decision belongs to one replaceable request lifecycle from inspection
through user settlement. Cancel resolves before import, persistence, or
activation and late settlement after replacement, project switching, caller
abort, or disposal cannot open the archive. The localized dialog shows each
affected feature's bounded display name, stable feature ID, availability, and
declared disposition; it does not render the evaluator's fallback-use message
or claim that fallback bytes were verified. Incompatible decisions initially
focus Cancel, and Escape dismisses the dialog and restores focus.

Acceptance carries no trusted read-only flag into the importer. It maps the
accepted no-collision or combined choice to the existing copy policy, then the
controller evaluates the actual project history again before activation and
enforces its intrinsically read-only result. This second evaluation also keeps
same-ID session history authoritative and makes the UI decision a consent
boundary rather than a capability override.

Current-schema and current-format `.scape` preservation is now part of this
contract. A rendered-fallback descriptor makes its source an independent
retention root even when no timeline or Project Bin clip references it. Project
and history compaction therefore retain that source metadata, current-format
export includes its source asset with the full manifest, and reopen preserves
the normalized manifest and its evaluation semantics. The portable archive
retains the relationship and exact target track ID of a track-render descriptor
just as it retains a clip-render descriptor's target clip ID, and import
revalidates each against the extracted project including its tracks. When a
copy import
rewrites colliding source identity, it rewrites the known fallback descriptor
reference through the same mapping while preserving the digest and the
canonical target clip or track ID.

The maintained export plan snapshots the admitted project root and complete
source records before its first asynchronous asset operation, then serializes
those same source records and the same bounded normalized fallback manifest into
`project.json`. Project-root and source-record accessors and callable `toJSON`
hooks are rejected without invocation rather than allowed to rewrite that
admitted serialization. Export hashes the actual canonical audio or video asset
output and rejects a claim-to-descriptor mismatch before writing the manifest or
committing a destination. Inspection and import perform the same
claim-to-manifest descriptor binding before compatibility evaluation, collision
lookup, or transactional storage. Import additionally hashes each extracted
asset body against that descriptor before source or project publication. Thus
inspection remains metadata-only; descriptor binding there does not read or
hash the potentially reference-scale asset bodies.

Blob-backed and random-access `.scape` reads now share the same canonical
archive-structure admission. A private witness retains at most 69,271,649 bytes
of admitted end, central, local-header, name/extra/comment, and descriptor data,
then replays those bytes while reading only payload gaps from the provider. This
ceiling exactly follows the maintained writer/export profile; archives that use
otherwise legal but noncanonical aggregate local-extra expansion are not a
compatibility target. The transport seam does not yet raise the desktop 512 MiB
selected-file materialization ceiling.

This archive evidence is deliberately limited to schema 17 and `.scape` format
1. It does not establish arbitrary future-schema archive preservation,
generic affected-object unavailable-feature placeholders or per-feature bypass
controls beyond the maintained first-party audio- and video-effect slices, or
third-party feature activation. The separate read-only affected-object index
described above is not archive evidence either: it names objects from the
activated project and its report, and it adds no bypass control, no runtime
substitution, and no activation route. After archive acceptance and import, the
separate maintained controller admission described above verifies the local
bytes referenced by the authoritative exact-schema-17 activation project. That
does not make metadata-only inspection a body-verification route and does not
cover direct store loads. Runtime use belongs only to the separate role-defined
audio whole-mix, audioEffects-only track-target, role-defined whole-project
video, and videoEffects-only
clip-target editor-playback and bounded operation-verified delivery paths.
Rendered-fallback roles beyond those closed relationships and authored fallback
relationships remain planned. The remaining
outcomes stay governed by the planned compatibility rows and roadmap exit gate.

## Opaque state

Binary opaque state and JSON-compatible opaque preservation are type-specific.

- Unknown JSON-compatible fields from schema 1 are collected under
  `opaqueExtensions.legacyV1`. Maintained JSON-compatible
  `opaqueExtensions` survive migration and current-schema `.scape` reopen
  semantically unchanged.
- A newer raw core document is structured-cloned, so typed arrays can remain
  typed arrays inside that in-memory read-only result.
- Before `JSON.parse`, every project schema receives an iterative raw-JSON
  structural preflight bounded to 101,536 values and depth 130 in production.
  The extra 1,536 values and two levels are the maximum tagged-descriptor
  allowance needed to keep the bounded exact-schema-17 binary representation
  round-trip closed; tests may only lower the underlying limits.
- Exact schema 17, format 1 `.scape` export preserves `Uint8Array` values,
  including only the addressed bytes of an offset view, and `ArrayBuffer`
  values through the reserved `$soundscaperOpaqueBinary` tag. Its descriptor is
  closed and versioned, identifies the restored type, declares an exact byte
  length, and carries canonical base64. Encoding and post-parse decoding each
  independently enforce the logical limits of 100,000 traversed nodes and
  depth 128, plus at most 256 payloads, 4 MiB per payload, and 8 MiB in
  aggregate. Import and inspection validate every descriptor, unique positive
  payload ID, base64 form, declared length, collision, and aggregate budget
  before allocating decoded bytes or starting collision and persistence work.
  Serialization copies the bytes and rejects reserved-tag collisions,
  project-container accessors, cycles, and callable container `toJSON` hooks
  rather than activating project code. Other `ArrayBuffer` views are
  unsupported and reject instead of being converted silently.
- Future-schema tag-shaped data is structurally counted by the all-schema raw
  preflight but is neither decoded nor interpreted as a binary descriptor;
  unchanged future `.scape` re-export remains a separate planned guarantee.

Unknown fields and unavailable features must never be interpreted as executable
code. Preservation does not imply activation.

## Disposable video preview relationships

Imported-video posters and filmstrip thumbnails are reproducible local cache
records. Each maintained record is related to a trusted retained original by
its storage key and SHA-256 digest, the poster or thumbnail type and normalized
timestamp, and a versioned recipe. For an owned original the repository derives
the current local generation token. For a linked original the maintained storage
facade refuses caller-supplied provenance, derives a generation token from the
normalized exact project/source binding, and checks that binding before and
after save, list, and load operations. Publication revalidates the applicable
owned original or linked binding around committing the payload and scalar
companion; loading requires that pair to agree and verifies the exact output
size and SHA-256. A different recipe revision can coexist, while an unbound
legacy record, replacement owned original, or changed linked binding is a cache
miss or refusal.

The reproducible preview cache records and bodies—including previews captured
while importing a linked original—are not project history, `.scape` media, or
managed handoff payloads. New video sources and maintained
read-write `.scape` imports keep their nullable preview locators clear;
maintained source-update commands cannot author them, desktop recipient binding
ignores old locator values, and managed source declarations omit them. The
nullable schema fields remain readable for old and opaque future documents.
Archive export includes only its canonical source assets, not derivative cache
entries. After a portable-archive transfer, the recipient regenerates a preview
bound to the exact admitted original digest, and neither transfer direction
carries it. By contrast, rendered fallbacks and their referenced sources remain
durable project, retention, and portable-archive state under the fallback rules
below. The maintained exact-schema role-defined audio whole-mix fallback is
separately qualified for fresh-recipient managed acquisition and activation.
The maintained role-defined whole-project video render and one closed
videoEffects-only clip-target render relationship are separately qualified for
controller activation and bounded video delivery after their independent
route-specific relationship, source, and digest admissions. Framescaper V18
proxy attachment preservation and its isolated re-attestation primitive remain
qualified under the product-specific rules above. Selected Framescaper F31
retains the menu-reached proxy lifecycle after retime through its immutable V28
foundation: generation,
attach/detach, Original/Proxy/Auto preview selection,
adaptive preview, offline editing, cancellation, relink/regenerate, atomic
cleanup, and original relink. Those F31 consumer relationships remain resource-
and externally unqualified and grant no delivery or native-runtime authority;
browser export, the V14 carrier producer, and delivery stay
original-authoritative and refuse when the original is unavailable.

Posters and thumbnails are not editorial proxies. They provide no relink,
watch, freeze, export, decoder-isolation, browser-heap, or process-RSS guarantee;
they are unrelated to the preserved V18 proxy attachment or the selected F31
editorial-proxy lifecycle and do not satisfy that lifecycle's still-open
resource, decoder-memory, or external qualification.

## Freeze and proxy fallback

Unavailable capabilities follow this order once their owning milestones land:

1. retain the editable source and opaque feature state unchanged;
2. show a named unavailable-feature placeholder and an explicit bypass state;
3. use a digest-linked frozen render or reproducible proxy when one exists;
4. keep relink/unfreeze information with the project; and
5. report every omission or fallback during interchange and delivery.

The maintained first-party audio- and video-effect bypass slices now implement
the first two steps for active known effects during editor playback only. The
exact-schema-17 mono/stereo role-defined audio whole-mix, role-defined video
whole-project, one first-party audio-effects track-target, and
one first-party video-effects clip-target slice implement
narrow forms of step 3 during editor playback and maintained delivery after
fresh operation-time integrity admission. The clip and track relationships are
durable publisher state, but Soundscaper does not create them. These slices do not freeze,
unfreeze, relink, watch, or refresh a fallback, and the bypass slices do not
generalize to unknown or third-party effects. Fallback authoring and selection
beyond the closed audio and maintained video roles and simultaneous fallback
delivery beyond the exact one-audio/one-video final-video composition remain
planned. The selected F31 authored proxy lifecycle delegates through its
immutable V28 foundation and is a separate source-complete
route whose resource, decoder-memory, and external qualification remain open.
Browser export and the V14 carrier remain original-authoritative; broad
rendered-fallback offline-render parity remains outside the bounded
video-delivery projection.

Video proxy attachment preservation was implemented in milestone 3. Selected
F31 retains generation, maintained Original/Proxy/Auto preview through its V28 foundation,
adaptive and offline editing, attach/detach, cancellation, relink/regenerate,
cleanup, and original relink after retime. The source route is complete while
resource and external qualification remain open; browser export, the V14
carrier, and delivery remain original-authoritative and visibly refuse without
the original.
Canonical audio freeze, unfreeze, commit, relink, and freshness semantics are
owned by milestone 4. The narrow rendered-fallback playback and delivery
relationships above do not supply those broader document models, and their
absence must not be hidden behind a compatibility claim.

## Schema retirement

Schema migrations are not removed automatically because of age, file count, or
maintenance cost. The minimum readable version remains 1 until a separate
versioned policy change proves every condition in the machine-readable matrix:

- an offline upgrader handles the retiring schema without an account or network;
- the oldest retained fixture reaches the current schema and reopens at every
  required gate;
- at least two stable release cycles carried a published deprecation notice;
- compatibility documentation identifies the first unsupported release; and
- no state representable by the retired schema lacks a lossless current form.

The retirement change must preserve archived fixtures and the upgrader after
the in-product migration is removed. Telemetry is neither required nor used to
justify removal.

## Deferred compatibility backlog

These are recorded residual items, not milestone requirements. No current exit
gate depends on them, and none of them may be treated as an implicit
prerequisite without a deliberate scope change.

- **Versioned capability catalogue for forward opens.** Forward compatibility is
  currently decided from one monotonic `schemaVersion`: a newer raw project is
  structured-cloned and returned read-only with reason `newer-schema`, and a
  newer archive `formatVersion` is rejected outright. Neither decision consults
  what the project actually requires, even though `featureRequirements` already
  declares required capabilities and the report already resolves each one to
  `available`, `unavailable`, or `unknown`. A versioned catalogue of released
  capability sets would let an older or less capable build decide from those
  declarations whether it can open a project at all, degrade it to read-only, or
  refuse — instead of inferring capability from a version number that rises for
  unrelated reasons. This would also give schema retirement and the
  first-unsupported-release notice a machine-readable basis. Deferred: it
  expands the compatibility boundary and needs its own non-goals, refusal
  semantics, and evidence before any of it becomes a requirement.

## Change control

The compatibility matrix test checks the source schema constants, archive
format, retained migration list, evidence paths, fallback ownership, and
fail-closed forward behavior. A code change that strengthens or weakens one of
these guarantees updates the matrix, this document, fixtures, and the roadmap
status in the same atomic change.
