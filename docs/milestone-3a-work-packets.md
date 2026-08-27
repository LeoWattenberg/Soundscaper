# Milestone 3A work packets: Soundscaper editorial features

> Pickup contract for the Soundscaper half of milestone 3. This document
> decomposes the 3A summary in [the milestone plan](milestone-3-plan.md) before
> feature code is changed. The roadmap owns product scope; this document owns
> packet boundaries, dependencies, and acceptance.

## Pickup status and sequencing

The 3.0 foundation is the implementation baseline. Its browser and Node gates
are green. All ten packaged Electron probe rows in
`config/milestone-3-timing-probe-matrix.json` are enabled for automated testing
across the five maintained desktop targets; they remain `pending-external` only
as milestone-9 stable 1.0 qualification evidence. Those rows are not relabelled
or treated as passing evidence by this historical packet.

Schema-neutral work lands first. Document schema revisions are serialized: at
most one revision is in flight, and it is complete before the next begins.
Each commit is independently green. The implementation order is:

1. Musical timeline commands, consumers, interchange, and UI.
2. Marker/region revision and feature vertical slice.
3. Folder revision and feature vertical slice.
4. Exact punch/count-in and recording primitives.
5. Take/comp revision, capture, recovery, and UI.
6. Derived transient analysis, warp rendering, quantization, and groove.
7. The remaining approved Audacity parity inventory and milestone exit proof.

Markers/regions, folders, and take/comp state receive separate bounded schema
revisions. Tempo/signature editing uses the existing foundation maps. Warp uses
the existing breakpoint wire shape unless implementation proves that a new
persisted project field is unavoidable. A derived analysis cache is not a
reason to revise the project schema.

Every new capability-bearing document type lands atomically with its ID, both
product profiles initially unavailable, production inventory, compatibility
rule, owned-state predicate, state-to-manifest completeness fixture, and
same-schema cross-product preservation fixtures. Soundscaper availability is
enabled only after its full native workflow passes. Fallback eligibility is an
explicit security decision; it is never inherited merely because a feature is
audio-related.

Every schema revision also includes exact-current validation; typed rejection
of older schemas; future-schema read-only handling; clone, undo/redo,
clipboard, `.scape`, desktop, and archive fixtures; byte-idempotent load/save;
semantic survival after editing; and a fresh versioned desktop-library scope so
old catalog rows cannot poison startup. There are no pre-release migrations.

## 3A-1 — Musical timeline editing

- **Outcome:** Replace singleton-tempo editing with stable-ID CRUD for ordered
  rational tempo events and bar-indexed signature events. Make the authoritative
  `tempoMap` and `signatureMap` drive snapping, rulers, metronome, count-in,
  selection, stretch, navigation, import, export, and project display. Retain
  hold segments only. `sampleLocked` maps preserve their per-event sample
  authority. Legacy singleton fields, if retained on the wire, are validated as
  exact derived event-zero values rather than edited independently.
- **Invariants:** Events are canonical reduced rationals with deterministic
  stable-ID tie breaking; musical map beats are strictly ordered and signature
  events are unique integer bars. Scheduling always evaluates from an absolute
  sample origin. Musical clips and labels reflow; sample-anchored media does
  not. No consumer reads persisted clip timing directly. Tempo ramps and MIDI
  concepts never enter the model.
- **Acceptance:** Command CRUD rejects duplicates, unsafe rationals, invalid
  sample locks, non-hold segments, and non-bar signatures. Repeated edit,
  undo/redo, save, reopen, and re-edit produces zero sample drift at 44.1, 48,
  and 96 kHz. Compound-meter metronome and count-in accents are correct,
  including 6/8. AUP/AUP4 import creates canonical event-zero maps; AUP4 export
  flattens a nontrivial map only with an explicit compatibility item. Pointer,
  keyboard, screen-reader, and high-contrast workflows edit the same events.
- **Non-goals:** No schema revision, tempo ramps, MIDI document state, tempo
  detection, DAWproject export, or generalized automation.
- **Stop condition:** Stop if a consumer needs a second persisted timing cache,
  if a wire value changes during idempotent normalization, or if exact AUP4
  fixtures would need to be weakened instead of reporting flattening.

## 3A-2 — Markers and named regions

- **Outcome:** Introduce first-class timeline annotations with explicit
  `marker` point and positive-span `region` kinds, stable item IDs, optional
  stable batch IDs, sample or musical authority, deterministic ordering,
  navigation, selection, batch editing, and defined ripple behavior. Import and
  export adapters may share label/RIFF mechanics, but the project type stays
  distinct from labels and future captions.
- **Invariants:** A point has one authoritative coordinate; a region has ordered
  authoritative endpoints in one domain. Musical objects never persist derived
  sample caches. Ripple moves objects wholly after a cut, contracts objects
  spanning it, removes an emptied region, and applies one operation-level
  conformed delta to batch peers. Copying creates new item and batch identities
  unless an explicit same-batch operation says otherwise.
- **Acceptance:** The serialized revision, factories, validation, commands,
  projection, navigation, ripple matrix, clipboard, undo/redo, `.scape`,
  desktop, and cross-product fixtures pass. RIFF cue/region and maintained label
  interchange is loss-accounted. A timeline and list surface provide equivalent
  pointer and keyboard create, rename, move, resize, batch, and navigate
  workflows with accessible names and high-contrast states.
- **Non-goals:** No captions, transcript text, cue automation, MIDI markers, or
  opaque reuse of label-track objects as the new type.
- **Stop condition:** Stop if musical ordering depends on raw `startFrame`, if
  captions become necessary to close the wire contract, or if ripple behavior
  cannot be expressed as one atomic editor command.

## 3A-3 — Nested track folders

The V12 document model landed schema-first with no editing surface. The
remaining half — folder-aware commands, clipboard survival, and the native
tree, through the Soundscaper capability flip — is decomposed in
[`docs/milestone-3a-track-folder-editing.md`](milestone-3a-track-folder-editing.md).

- **Outcome:** Add a bounded folder tree with stable identities and one
  authoritative parent relation. Implement deterministic subtree creation,
  rename, move, reorder, expand/collapse, delete/promote, visibility, mute/solo,
  height, and routing derivation across sequence-owned tracks. A top-level
  timeline folder that contains audio owns a group bus, so a folder is the
  arrangement view of a mix channel. Folder UI and keyboard tree navigation
  expose the same ordering.
- **Invariants:** The hierarchy is acyclic, depth-bounded, single-parented, and
  deterministically ordered. A folder never crosses a sequence boundary.
  Effective hidden/mute/solo state is derived without overwriting child-local
  state. Moving or sorting preserves whole structural blocks, including folder
  subtrees and adjacent linked A/V lane pairs. `laneGroupId` remains reserved
  for the existing A/V media-lane contract. Exactly one bus layer exists: a
  depth-1 timeline folder with an audio descendant owns a group bus, deeper
  folders own none and their audio routes to that same bus, and project-bin
  folders never own one. The folder owns identity, name, order, collapse,
  height, hidden, mute, and solo; the bus owns color, gain, pan, envelope, and
  effects. Mirrored bus fields are validated as exact mirrors and rejected on
  mismatch, never repaired. Folder mute and solo stay authoritative in the
  derived state projection, and the owned bus is pinned neutral so audibility
  is never resolved twice.
- **Acceptance:** The revision rejects cycles, excessive depth, missing parents,
  duplicate ownership, split A/V pairs, and cross-sequence parenting. Every
  tree mutation is one undoable command and survives clone, clipboard,
  save/reopen, `.scape`, desktop, and unavailable Framescaper round trips.
  Routing, visibility, mute/solo, collapse, and height matrices are deterministic
  under nested combinations. Creating, moving, promoting, and deleting folders
  keeps bus ownership and `mixer.routes` exactly consistent within one undo
  transaction, and a folder holding no audio descendant owns no bus and
  authors no route. Pointer drag/drop and keyboard tree operations
  produce identical projects and announce structure/state to assistive tech.
- **Non-goals:** No nested folder buses, sends, VCAs, automation, generalized
  mixer graph, or folder clips. Bus nesting for folders deeper than level 1 is
  milestone-4 work and is not approximated here.
- **Stop condition:** Stop if two structures claim authoritative ordering, if a
  folder bus is required to make mute or solo behave, if more than one bus layer
  appears between a track and the master, or if deletion can leave an
  unreachable track or an orphaned route.

## 3A-4 — Punch, count-in, and approved Audacity gaps

- **Outcome:** Complete tempo-map-aware count-in and punch in both default and
  routed recording paths; add sound-activated recording with explicit threshold,
  hysteresis, hold, pause/resume, cancellation, and arming semantics. Complete
  the exact milestone-3 Audacity manifest in narrow groups: clip-boundary and
  selection navigation, spectral selection/brush, skip boundaries, alignment,
  structural sorting, raw-data import, select-none/mute-all/unmute-all, repeat
  generator/analyzer, regular-interval annotations, and their menu parents.
- **Invariants:** Punch replacement uses exact selection boundaries and one
  history transaction. Count-in is expressed in signature-denominator beats,
  not numerator quarter-notes. Capture publication remains ownership-fenced and
  never creates a project reference before durable media. Alignment applies one
  operation-level conformed delta and preserves A/V links. Sorting moves folder
  subtrees, linked lane pairs, and take groups as structural blocks.
- **Acceptance:** Default/routed input parity, compound meters, project switch,
  disposal, permission denial, threshold chatter, cancellation, and undo tests
  pass. Each completed Audacity action atomically changes parity disposition,
  handler, enablement, menu, placeholder inventory, localization, and tests.
  The audited milestone-3 action count reaches zero planned actions. Browser
  tests cover the recording and keyboard navigation workflows.
- **Non-goals:** No take-lane persistence in this packet, Framescaper capture,
  MIDI punch, background recording after disposal, or unbounded arbitrary raw
  decoder formats.
- **Stop condition:** Stop if a capture path publishes media outside its
  transaction, if alignment requires per-clip delta rounding, or if sorting
  reparents or separates a structural block.

## 3A-5 — Take lanes, cycle recording, comping, and recovery

- **Outcome:** Add stable take-group, lane, take, and comp-region identities;
  lane ordering; audition and promotion; non-overlapping comp selection;
  deterministic flattening; exact loop-pass capture; and a durable external
  recovery journal for interrupted takes. Recording finalization and recovery
  publish project and media state through ownership-fenced atomic transitions.
- **Invariants:** Comp regions are ordered, non-overlapping selections of valid
  source takes and cover only the group's timeline extent. Cycle passes share
  exact loop/punch boundaries without cumulative drift. Flatten is explicit and
  undoable; retained sources are reclaimed only when no live snapshot references
  them. The recovery journal is generation-bound, idempotent, digest-verified,
  and is never embedded as stale project state.
- **Acceptance:** The revision fixture suite covers lane/take/comp state and
  commands. Cycle capture, audition, promotion, comp boundary edits, flatten,
  undo/redo, save/reopen, clipboard, `.scape`, desktop, and cross-product
  preservation pass. Crash tests cover before media commit, after media commit
  but before project commit, and during project publication; restart offers
  deterministic recover/discard and never deletes another generation. Routed
  multi-input failure isolates only the failed lane.
- **Non-goals:** No playlist collaboration, alternative mixer automation per
  take, destructive source edits, comp crossfades beyond existing clip fades,
  or cloud recovery.
- **Stop condition:** Stop if project JSON must reference uncommitted media, if
  a recovery action cannot prove generation ownership, or if flattening loses
  the reversible pre-flatten snapshot.

## 3A-6 — Transients, warp, quantization, and groove

- **Outcome:** Add digest- and algorithm-version-bound derived transient
  analysis; author and evaluate strictly increasing audio warp maps; consume the
  same map in playback, waveform, stretch, export, and exact offline render;
  derive quantization and adjustable groove strength as deterministic warp-map
  commands. Enable Soundscaper's existing `audioWarp` capability only after the
  native and exact fallback paths pass.
- **Invariants:** Transient bulk data is disposable derived storage keyed by
  source identity/digest, source range, channel policy, analysis parameters, and
  algorithm revision. Warp outer units follow the clip anchor contract; source
  units stay in source samples. Endpoints, trims, and map clamps are explicit.
  Audio maps cannot freeze or reverse. Cache admission fingerprints the
  canonical map and never silently substitutes scalar speed/pitch rendering.
  Piecewise boundaries round once under the shared time policy.
- **Acceptance:** Detector fixtures are deterministic across supported runtimes;
  corrupt/stale derived data is discarded. Warp authoring, trims, tempo edits,
  quantization strength 0/1/intermediate, groove templates, undo/redo,
  clipboard, and save/reopen preserve meaning. Fractional warp and held-tempo
  boundaries contribute both enclosing integer frames, so realtime and offline
  consume the exact rational map at every discrete output frame. The positional
  diagnostic is measured in source frames; the separately named PCM budget is
  measured in normalized sample amplitude across every rendered output frame.
  Missing realtime acceleration selects the exact offline path with visible
  status. UI editing has pointer/keyboard/screen-reader/high-contrast parity.
- **Non-goals:** No video speed ramps, pitch-formant editor, MIDI quantization,
  tempo detection that rewrites the map, or persisted transient arrays.
- **Stop condition:** Stop if playback/export/waveform require different map
  evaluators, if a cache key omits any authority input, or if exact fallback
  would degrade to the old scalar renderer.

## 3A-7 — Exit evidence

- **Outcome:** Close the Soundscaper roadmap bullets and action manifest only
  after all native workflows, compatibility registrations, cross-product
  preservation paths, accessibility flows, and performance budgets have current
  evidence. Activate the planned two-hour workload with 24 audio tracks, two
  proxy-video tracks, and 10,000 edits.
- **Invariants:** Evidence records observed results without converting deferred
  WebKit or pending external Electron rows into passes. The canonical non-browser
  gate stays green on every commit. Quality thresholds and memory/chunk/file
  budgets are not weakened to make closure pass.
- **Acceptance:** Full Node, coverage, type, lint, architecture, notices,
  production audit, build, Chromium, Firefox, desktop, `.scape`, AUP/AUP4,
  cross-product, accessibility, and long-form suites pass on their qualified
  matrices. The long-form result has zero audio/video position error, at most
  20 ms A/V drift, seek p95 at most 200 ms, scroll-frame p95 at most 33.34 ms,
  and retained-heap growth at most 256 MiB. Roadmap and capability inventory
  statuses cite the owning modules and tests.
- **Non-goals:** No claims for unexecuted package matrices, no WebKit promotion,
  no milestone-4 mixing features, and no milestone-7 MIDI work.
- **Stop condition:** Stop closure on any planned milestone-3 Audacity action,
  unavailable Soundscaper capability, unregistered owned state, failing
  qualified runtime, or missing long-form measurement.

## Global fences

MIDI schema, ports, flags, devices, editing, and UI are out of scope through
milestone 7. Tempo ramps are out of scope. Framescaper recording is out of
scope. DAWproject, OTIO, and FCPXML exporters are out of scope. New document
types cannot be smuggled through opaque extension fields, labels, lane groups,
or mixer groups.
