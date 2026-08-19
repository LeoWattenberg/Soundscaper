# Milestone 6C pickup: interchange and archive

> Owning pickup contract for the shared interchange track of milestone 6. The
> [milestone-6 plan](milestone-6-plan.md) owns the shared decisions and
> cross-track sequencing; the
> [roadmap](../roadmap.md#6-professional-delivery-and-interchange) owns product
> scope and status. This document decomposes the 6C summary into slices with
> the five packet fields. Grounded on 2026-08-16 at commit `14f45438`. Its
> siblings are [`milestone-6a-soundscaper-delivery.md`](milestone-6a-soundscaper-delivery.md)
> and [`milestone-6b-framescaper-delivery.md`](milestone-6b-framescaper-delivery.md).

## Pickup status and sequencing

**Status on 2026-08-19: all three 6C-1 profiles are implemented, reachable, and
verified against third-party readers; 6C-2's planning and byte-moving halves are
both complete — the checksum manifest and its `.scape` wiring, consolidate,
trim-media, and the kill/reload recovery acceptance — and what remains is the
controller and UI wiring that gives those operations their real ports.** The EDL profile establishes the pattern
the remaining profiles reuse: exact rational rates throughout, timecode from the
shared `sequence-timecode` module, and every out-of-scope feature itemized in a
delivery report rather than approximated. It is split deliberately —
`edl-export.ts` owns the CMX3600 grammar and knows nothing about documents,
`edl-project-adapter.ts` owns every judgement about what a project means — and
the later profiles are expected to reuse the second half's conversions rather
than restate them. Three of those conversions are the load-bearing ones: sample
frames to sequence frames through the shared navigation module, record timecode
carrying the sequence's start timecode, and source duration derived from record
duration so a cut cannot disagree with itself by a rounded frame.

Two seams landed with it that the sibling profiles inherit: the `interchange`
save purpose (`desktop/validation.js`, `file-service.js`), which already admits
`.otio` and `.fcpxml`, and `src/common/i18n/export-menu-copy.js`, which holds
the File > Export submenu's copy so the catalog's maintainability ceiling does
not have to rise once per profile. An exporter's caller-supplied omissions ride
`EdlExportRequest.omissions` into the report before it is sealed; appending to a
sealed report leaves its counts lying, which is what
`delivery.unreportedConversions` exists to catch.

6C opens only after every 6.0 acceptance check passes;
every exporter emits its conversion report through WP-6.0.0's model and every
long-running archive operation runs under WP-6.0.1's queue semantics.

What 6C builds on, verified:

- **The exporter rules are already recorded** and are the binding contract:
  exact rational rates as computed double quotients (never `29.97`
  literals), pre-rounded values because OTIO consumers truncate toward zero,
  one timebase per item (audio at sample rate, video at sequence rate), VFR
  timing tables in metadata namespaces, the tolerance-vs-exact equality
  split in conformance tests, and AUP4 tempo flattening with an explicit
  compatibility item (docs/milestone-3-plan.md:463-480). The milestone-3
  schema bought the structural prerequisites deliberately: per-element
  anchor domains, stable shared-timeline identities, nestable containers,
  and project-side rational sequence rate
  (docs/milestone-3-plan.md:449-462).
- **Interchange reporting has an in-tree precedent** in the annotation
  interchange modules (`timeline-annotation-interchange-report.ts`,
  `audacity-annotation-interchange.ts`, `aup4-annotation-interchange.ts`)
  and the AUP4 compatibility-report vocabulary the delivery-report model
  generalizes.
- **The relink lifecycle is closed and binding.** `m2-linked-media-lifecycle`
  is implemented with its acceptance recorded
  (config/milestone-2-closure.json:245); consolidation and trim never weaken
  it and external media is never deleted.
- **Digest infrastructure is ready.** `digestScapeBytes` and the descriptor
  verification helpers (`src/common/editor/scape-archive-media.ts:314-322`)
  are the manifest primitives; manifests save through the `'report'` purpose
  (`src/common/editor/file-service.js:171`).

**The rule that cost the most to learn: an interchange file describes the
render.** Playback and export are the same render in this project, and an edit
list is a statement about that render, so it answers to the same visibility
rules. FCPXML and OTIO originally tested `hidden || mute` on every track, which
dropped a muted video track that does compose — `mute` is deliberately
independent of picture — and ignored solo entirely, so a soloed programme
exported the tracks that do not compose. They also skipped
`projectTrackFolderMediaStateV12`, which every render path applies, so
folder-inherited state never reached them. All three profiles now resolve
visibility through `interchange-track-visibility.ts`; 6C-2's archive and
consolidate operations should read from the same projection rather than the raw
document.

A second, related lesson: **a lenient reader is evidence, not an oracle**. The
reference OTIO/FCPX readers accepted an FCPXML document that Apple's own DTD
rejects on three counts. Where a third-party reader disagrees with us, read its
source before assigning blame — and where it agrees, that is not proof of
validity.

One pattern recurred across all three profiles and is worth stating for 6C-2: a
clip shorter than one frame at the target timebase has no representable
duration, and every profile's first draft skipped it with a bare `continue`.
That leaves the output with fewer clips than the project and nothing to point
at. All three now report it (`*.sub-frame-clip-omitted`), and the EDL adapter
was fixed retroactively when the OTIO conformance fixture exposed it. Any new
walk over clips should assume this case exists.

Implementation order: **6C-1a** EDL first (smallest profile, proves the
report/conformance harness), then **6C-1b** OTIO and **6C-1c** FCPXML in
either order; **6C-2** archive/consolidate/trim in parallel with 6C-1 —
file-disjoint from it and from 6A/6B per the plan's coordination rules;
**6C-3** evidence last. Each 6C-1 slice closes its profile scope — which
features map, which report as omitted — in this document at its own pickup,
before code.

## 6C-1a — EDL profile

- **Outcome:** a CMX3600-class EDL exporter over the plan seam: video events
  from one selected sequence's track, cuts and the transitions the format can
  carry, source identity via reel/tape mapping with an explicit mapping
  table, drop/non-drop timecode per the sequence flag — plus the conformance
  suite and an itemized conversion report (everything an EDL cannot carry is
  an `omitted` item, per the report vocabulary).
- **Invariants:** timecode emission reuses the milestone-3B SMPTE module —
  no second formatter; every rate is the exact rational conversion, no
  decimal literals; the report is generated from the export walk, never
  hand-assembled.
- **Acceptance:** goldens at 23.976/24/25/29.97DF/30; a project using
  unmappable features exports successfully with those features itemized;
  conformance re-parses the emitted EDL and round-trips event boundaries
  exactly.
- **Non-goals:** no EDL import; no audio EDL events beyond what the profile
  scope records; no multi-track flattening heuristics — out-of-profile
  content is omitted and reported, not approximated.
- **Stop condition:** stop if any emitted value would round downstream or if
  profile scope cannot be stated as an exact feature list.
- **Landed, acceptance met:** the writer, the project adapter, the
  File > Export other entry, and the report path, with
  `tests/audio-editor-edl-export.test.ts`,
  `tests/audio-editor-edl-project-adapter.test.ts`,
  `tests/audio-editor-edl-export-action.test.ts`, and
  `tests/audio-editor-edl-conformance.test.ts`. The conformance suite runs the
  full rate matrix plus 29.97 non-drop and re-parses with its own line grammar
  rather than the writer's helpers; it is verified non-vacuous by mutation.
  **Remaining, and not part of the stated acceptance:** the reel mapping table
  is a request parameter with no editing surface, so a caller can supply one but
  a user cannot yet author one.

## 6C-1b — OTIO profile

- **Outcome:** an OTIO exporter (importer only if the profile scope commits
  to it at pickup): timelines/stacks/tracks/clips with per-source ranges,
  rational sequence rate carried as `{num, den}` in a metadata namespace
  because OTIO has no sequence-rate slot, VFR tables in metadata, rates
  emitted as exact double quotients — with conformance suite and itemized
  report.
- **Invariants:** the recorded OTIO cautions are law: rates as computed
  quotients only, all values pre-rounded in our module because
  `rescaled_to()` preserves fractional doubles and downstream consumers
  truncate; nested sequences map to nested stacks, never flattened
  silently.
- **Acceptance:** tolerance-vs-exact split proven in the conformance suite
  (exact for structure and integer frames, tolerance only where the rules
  allow); fixtures round-trip through the reference OTIO implementation
  without frame loss at 29.97/59.94.
- **Non-goals:** no OTIO effects/transitions vocabulary beyond the profile
  scope; no media embedding.
- **Stop condition:** stop if upstream's rational-rate limitation (the
  recorded watch item) makes a committed importer feature unsound — narrow
  the profile rather than approximate.
- **Landed:** `src/common/editor/otio-export.ts`, its menu entry, and the
  conformance suite proving the tolerance-vs-exact split — strict equality for
  structure, schema strings, and every frame or sample value; tolerance for the
  rate double alone. **Profile scope, as committed here:** export only, no
  importer; one stack of video and audio tracks with gaps; no effects or
  transitions vocabulary; media addressed by managed storage key and reported
  as a conversion. **Acceptance met, including the reference round trip:**
  `tests/audio-editor-otio-reference-conformance.test.ts` reads our output back
  with the OpenTimelineIO reference implementation itself, recovering every
  frame boundary at 29.97 and 59.94 (both named in the acceptance) as well as 25
  and 23.976, plus the sequence start and the per-item timebases. See
  [`interchange-conformance.md`](interchange-conformance.md) for how the
  reference implementation is provisioned.

## 6C-1c — FCPXML profile

- **Outcome:** an FCPXML exporter under the same rules: rational times in
  FCPXML's native rational attributes, one timebase per item, explicit
  format resources per sequence rate, roles for audio/caption lanes per the
  profile scope — with conformance suite and itemized report.
- **Invariants:** rational times are emitted as exact rationals (FCPXML's
  own `N/Ds` form), never decimal seconds; resources are deduplicated by
  stable identity, not by path string.
- **Acceptance:** fixtures validate against the FCPXML DTD version the
  profile pins; boundary round-trips are exact at mixed rates; omissions
  itemized.
- **Non-goals:** no import; no event/library management semantics; no
  Motion-template vocabulary.
- **Stop condition:** stop if a committed feature requires emitting
  approximate rationals or duplicating the plan walk.
- **Landed:** `src/common/editor/fcpxml-export.ts` and its menu entry.
  **Profile scope, as committed here:** export only; one spine of `asset-clip`
  elements over a single `format` resource; assets deduplicated by source
  identity; one default role per track kind; `tcFormat` from the sequence's own
  drop-frame flag; connected lanes for simultaneous tracks (video above at
  1, 2, …, audio below at -1, -2, …) since a spine is serial; no `timeMap`, no
  transitions, no Motion vocabulary. The emitted document is **DTD-valid against
  Apple's FCPXMLv1_10.dtd**, verified with `xmllint`; the DTD itself is not
  committed, so the shipped suite asserts the shapes the DTD requires —
  `asset` as `(media-rep+, metadata?)` with `src` on `media-rep`, and
  `audioRole`/`videoRole` rather than a bare `role`.
  **Acceptance met by substitution, deliberately.** Apple's FCPXML DTD is not
  published under terms that permit redistribution, so validating against a
  pinned DTD would trade a licensing problem for a conformance claim we can get
  honestly elsewhere. `tests/audio-editor-fcpxml-reference-conformance.test.ts`
  instead parses our output with the `otio-fcpx-xml` reference reader, which
  recovers our timeline exactly at 24/25/30/50/60. Two reader limitations are
  pinned rather than worked around: it truncates the rate with
  `int(fd_rate / fd_total)`, losing every NTSC rate, and it has no `tcStart`
  code path at all. `1001/30000s` is what Final Cut Pro itself writes, so our
  output is correct and must not be bent to suit an integer-only reader.

## 6C-2 — Archive, consolidate, trim-media, manifests

- **Outcome:** project archive with a checksum manifest (every referenced
  media byte range digested via the `scape-archive-media.ts` primitives, the
  manifest a `'report'`-purpose document); **consolidate** as an explicit,
  reported operation that copies referenced external media into managed
  storage over the relink lifecycle; **trim-media** as an explicit, reported
  operation producing trimmed copies of referenced ranges with handle
  margins, undoable where possible and refusing where undo cannot be
  honest; verification tooling that reads a manifest back against the bytes
  and reports every mismatch.
- **Invariants:** external media is never deleted (the m2 lifecycle
  acceptance is binding); consolidate and trim produce new bytes and rebind
  through the existing relink machinery — no in-place mutation; digest
  verification is end-to-end (written, then read back); every operation
  emits a report itemizing what was copied, trimmed, or left.
- **Acceptance:** kill/reload during archive/consolidate/trim leaves the
  project consistent and the operation resumable or atomically restartable
  per its declared recovery class; a tampered archive member fails
  verification with the exact member named; trim provably retains every
  referenced sample/frame plus declared handles.
- **Non-goals:** no cloud targets; no compression-format additions beyond
  the existing archive writers; no automatic deletion of anything.
- **Stop condition:** stop if trim-media cannot prove which bytes are
  unreferenced, or if consolidation would need to weaken any
  `m2-linked-media-lifecycle` semantics.
- **Partially landed.** `src/common/editor/archive-manifest.ts` is the manifest
  primitive the other three operations report through: it digests member bytes
  itself rather than accepting a caller's digest, verifies every member instead
  of stopping at the first failure, names the failing member, distinguishes a
  size mismatch from a digest mismatch (truncation moves both, substitution
  usually only the digest), and treats a member present but unlisted as a
  finding. Serialization is deterministic and saves through the `'report'`
  purpose. `src/common/editor/trim-media-plan.ts` is the proof side of
  trim-media: it computes the referenced ranges per source, widens them by
  declared handles, merges overlapping *and* abutting runs, and reports an
  unreferenced source rather than acting on it. Its retention property is tested
  exhaustively, not by example. **Note the deliberate asymmetry:** trim-media
  ignores visibility entirely, because it decides which bytes survive rather
  than describing the render — a hidden track's media must not be destroyed by
  hiding it. That is the opposite of the 6C-1 rule and the two must not be
  conflated. **The operations have since landed.** `consolidate-operation.ts` runs a
  consolidate plan in the one order that survives an interruption — copy, verify,
  then rebind — because a process that dies between the copy and the rebind
  leaves a project still pointing at its original with an unreferenced managed
  copy behind it, which is garbage to collect rather than a project that lost its
  media. Verification is doubled on purpose: the original is digested as it
  streams, catching a file that changed since it was bound, and the managed copy
  is read back and digested again, catching storage that accepted bytes and
  returned different ones. `trim-media-operation.ts` does the same for trimmed
  copies, checking what the writer produced against the frames the plan retained
  and refusing anything short. The plan now also states where each retained run
  lands in the trimmed source, so clips can be moved without recomputing it, and
  a discarded frame maps to nothing rather than to its nearest survivor.

  Two refusals in each are structural rather than documentary: neither operation
  has a port that could delete, move, or rewrite a linked original, and
  trim-media refuses an external source outright, pointing at consolidate first —
  which is also the slice's "refuse where undo cannot be honest", since there is
  no honest undo for somebody else's bytes.

  `scape-archive-manifest.ts` is the manifest wiring, and deliberately does not
  reuse the export manifest's digests: a checksum document copied from the
  writer's own account of itself agrees with the writer by construction and
  catches nothing the writer got wrong. It reads the finished archive back,
  digesting members as they stream, and verification compares the recorded
  manifest against that observed one rather than reading every member twice.

  The kill/reload acceptance is in
  `tests/audio-editor-archive-recovery-acceptance.test.ts`, and kills every port
  call in turn rather than one representative step. Held against an operation
  deliberately weakened to rebind before verifying, it fails.

  **Still owed:** the controller and UI wiring that gives these operations their
  real ports and a surface to run from.
- **Consolidate planning has landed** in `src/common/editor/consolidate-plan.ts`.
  It takes the linked-original bindings as an argument, because a source carries
  no linked-or-managed flag — that lives in the repositories behind
  `storage/linked-original-store-service.ts` (`linkedOriginalBindings`,
  `linkedVideoOriginalBindings`, and their alias/reachability tables). The
  binding record (`storage/linked-original-binding.ts`) supplies the two things
  a verified copy needs: the recorded `sha256` and the `bindingToken`
  compare-and-swap fence the rebind must present. Reachability is injected,
  because it is a platform question and a plan that assumed everything was
  reachable would be wrong exactly when it matters.

  **Owner's decision, recorded:** an unreachable original does not abort the
  run. Consolidate copies what it can reach and itemises what it could not,
  because a drive is unplugged far more often than a project is abandoned. The
  hazard that comes with it — someone reading "consolidated" and shipping an
  archive with holes — is handled structurally: `complete` and `unreachable`
  live on the plan itself rather than only in the report, so a caller cannot
  report success without stepping over them.

  Consolidate copies and never relocates by removal; the
  `m2-linked-media-lifecycle` acceptance
  (config/milestone-2-closure.json:245) is binding and external media is never
  deleted. An unreferenced source is still consolidated — deciding a source is
  expendable is trim-media's job, and only when asked for. When those
  land they must read the project through `projectTrackFolderMediaStateV12`
  rather than the raw document, for the reason recorded in the pickup status
  above.

## 6C-3 — Exit evidence

Cross-format round-trip fixtures over the 6C-1 profiles, the archive
verification fixtures of 6C-2, and the `.scape` handoff preservation sentence
of the exit gate (roadmap.md:747) witnessed alongside the report-completeness
sentence (roadmap.md:748, observed by
`delivery.unreportedConversions eq 0`, config/quality-budgets.json:1337).
Interchange correctness runs entirely in ordinary CI; 6C claims no
environment-gated numbers.
