# Milestone 6A pickup: Soundscaper delivery

> Owning pickup contract for the Soundscaper half of milestone 6. The
> [milestone-6 plan](milestone-6-plan.md) owns the shared delivery decisions,
> the 6.0 packets, and cross-track sequencing; the
> [roadmap](../roadmap.md#6-professional-delivery-and-interchange) owns product
> scope and status. This document decomposes the 6A summary into slices with
> the five packet fields. Grounded on 2026-08-16 at commit `14f45438`. Its
> siblings are [`milestone-6b-framescaper-delivery.md`](milestone-6b-framescaper-delivery.md)
> and [`milestone-6c-interchange-archive.md`](milestone-6c-interchange-archive.md).

## Pickup status and sequencing

**Status on 2026-08-18: 6A-1a, 6A-1b and 6A-2 are complete. 6A-3 is next.**

- **The decision.** `src/common/editor/loudness-normalization.ts` computes one
  gain from a measurement and a target and returns it as inspectable data. The
  slice's stop condition is implemented literally: when the true-peak ceiling
  binds before the integrated target, the gain stops at the ceiling and the
  delivery is reported short — there is no limiter, and the ceiling property is
  proven by sweep rather than by example.
- **The application.** `loudness-normalization-render.ts` applies the gain at
  the one point in `encodeRenderedAudio` where channel mapping is done and no
  encoder has been chosen, so every format normalizes identically or not at all.
  The target rides on the plan: `createExportPlan` resolves it from a preset name
  or an explicit pair, and refuses stems (normalized stems stop summing to the
  normalized mix), ADM passthrough (byte preservation), and anything the realtime
  stream would render (it never holds the delivery long enough to measure it).
  The realtime re-encode fallback is refused for the same reason. The gain is
  applied in place, which the fallback refusal is what makes safe.
- **The reporting.** Loudness is measured twice: the first pass decides the gain,
  the second measures the written samples, and that second value is what the BEXT
  capture stamps and what the report carries beside the projection. A gap wider
  than `delivery.integratedLoudnessErrorLu` / `delivery.truePeakErrorDb` is its
  own warning, because when the file does not measure what the gain promised
  nothing downstream can tell which number to trust. An absent delivered
  measurement stays absent rather than appearing as null. Because the gain is
  only known after the render, `export-service` rebuilds the report rather than
  appending to the sealed one.
- **The surface.** Analyze > Measure loudness renders the selection, or the whole
  mix when there is none, through the same offline path the other analyzers use,
  and publishes a sealed report whose subject reads `loudness-measurement`. It
  proposes no gain: what a delivery should do about the number is the delivery's
  decision to report.

Two things 6A-2 deliberately did not do, recorded so a later slice does not
mistake them for oversights. The second meter pass runs only when a delivery
captures loudness metadata, because metering an hour of audio for a value nothing
reads is not free; a non-broadcast normalized delivery therefore reports
projections only. And stems refuse normalization outright rather than inheriting
the mix's gain, which would need the mix rendered as well — 6A-3 owns stems and
may revisit it, but only by paying for that render explicitly.

6A opens only after every 6.0 acceptance check
passes (WP-6.0.0 delivery reports and plan-pin repair, WP-6.0.1 queue
semantics, WP-6.0.2 preset core); every slice below consumes at least one of
those surfaces, and none may reimplement one.

The substrate 6A consumes is present and verified:

- **The Soundscaper V21 production surface is implemented (provisional).**
  Automation lanes, the mixer graph, per-path PDC, and the authored freeze
  lifecycle exist (`src/common/editor/automation-lane-v21.ts`,
  `mixer-graph-v21.ts`, `audio-track-freeze-v21.ts` and their coordinator and
  controller integrations), unqualified. 6A builds over them and must not
  block on their qualification rows.
- **The marker/region model exists and is not label tracks.** V11 timeline
  annotations carry sample- and musically-anchored markers and regions with
  `id`, `sequenceId`, `name`, `color`, `batchId`, and `opaqueExtensions`
  (`src/common/editor/timeline-annotation.ts:39-74`), bounded at 4,096
  annotations (`timeline-annotation.ts:31-35`), with navigation, RIFF
  interchange, and an interchange report already modular
  (`timeline-annotation-navigation.ts`,
  `timeline-annotation-riff-interchange.ts`, `riff-markers.ts`,
  `timeline-annotation-interchange-report.ts`).
- **Loudness measurement is complete; its surface and application are not.**
  `measureBextLoudness` returns integrated loudness, loudness range, maximum
  true peak (dBTP), and momentary/short-term maxima from the R128 meter
  (`src/common/editor/broadcast-loudness.ts:6-21`), reachable only as a BEXT
  capture flag (`controller/export-settings.ts:41,80`;
  `controller/rendered-audio-encoding.ts:143-145`). No UI reads it and no
  export path applies gain from it.
- **Stems and the plan seam are the extension points.** `createExportPlan`
  (`src/common/editor/export.js:152`), the stem archive plan
  (`export.js:279-288`) and its ZIP32/7z selector
  (`controller/stem-archive.ts:36-76`) are extended by 6A-3, never
  duplicated.
- **ADM is two modes with hard caps.** Authored beds are mono/stereo/5.1
  (`src/common/editor/adm-project-metadata.ts:14-22`); passthrough is the
  byte-preservation contract (`export.js:408-478`). 6A-5 grows the first and
  must not touch the second.

Implementation order, dependency-driven:

1. **6A-2** normalization and reporting (needs only WP-6.0.0's report model).
2. **6A-1a** the mastering-sequence schema revision (serialized product-wide).
3. **6A-1b** region-aware delivery, then **6A-3** batches/stems/alternates
   (needs WP-6.0.1's queue and 6A-1's regions).
4. **6A-4** conformance feeding the reports.
5. **6A-5** immersive, as the reviewed addition, last.
6. **6A-6** exit evidence develops alongside and publishes only after 6A-1
   through 6A-5 close.

The schema-revision discipline binds 6A-1a and 6A-5: at most one document
schema revision in flight product-wide, owned by one agent, landing atomically
with validators, command migrations, and fixtures
(docs/milestone-3b-work-packets.md:25-28), walking the full registration path
(docs/milestone-4-plan.md:383-395) with both product profiles initially
unavailable. V19/V20/V21 are taken and V22 is reserved for 4B-3 transitions
(docs/milestone-4-plan.md:381-383); the mastering-sequence revision takes the
next free number at its own pickup and never assumes one here.

## 6A-1a status: complete

The mastering-sequence revision is **V23**, mounted as the Soundscaper web
revision. 18 through 20 are Framescaper, 21 was the previous Soundscaper
revision, and 22 stays reserved for 4B-3 transitions — numbering mattered
because five tests use V21 + 1 as their future-schema sentinel.

- **Schema-neutral half.** `mastering-sequence.ts` (the document type),
  `mastering-sequence-edit.ts` (the edit primitives) and
  `mastering-sequence-regions.ts` (the bridge to V11 annotations). Entries point
  at regions by identity and store no time ranges; gaps belong to the entry that
  follows them; titles fall back to the region's own name; delivery metadata is
  open key/value pairs. A sequence never repairs itself — a deleted or moved
  region is a typed validation state, never a silent reorder — and position is
  always resolved through the runtime annotation projection so musically
  anchored regions have exactly one timing authority.
- **The revision.** Constant, all ten enumerating predicates, document,
  validation, commands, history, and the full runtime chain. The production
  validator and the undo stack are shared and parameterized rather than cloned,
  so V21 and V23 cannot drift about what a valid document is while each still
  validates only itself. Mastering-sequence commands get their own apply branch;
  everything else is lent to V21's applier, which is why V23 has V21's exact
  semantics for the hundred-odd inherited commands without a second copy.
- **Registration.** The capability id in the global registry, both product
  capability maps, the production inventory and all three Framescaper profiles —
  unavailable everywhere. The owned requirement is derived from the state, so a
  project holding a sequence demands the capability and reports a
  known-but-unavailable feature rather than an unknown one.
- **Fixtures.** Exact-current validation, typed rejection of older schemas,
  future-schema read-only with opaque retention, clone, undo/redo, batching,
  durable storage, duplication, `.scape` round trip, byte-idempotent load/save,
  and semantic survival.

**The editing surface landed with 6A-1b**, which is what turned the capability
on. Tools > Mastering sequences opens the production dialog on its own surface,
gated on the revision that owns the collection rather than on the production
authority — a V21 document carries that authority and still has nowhere to put a
sequence, so the entry is visible and disabled there.

**Two shared-code fixes the revision forced, both of the same shape.** Twenty
places gated behaviour on `schemaVersion === 21` exactly, six on the shared
playback-and-export path, none of them throwing — now one named predicate with a
source-level guard. And the desktop project library pinned the exact V21 runtime
profile even though its schema, scope and database version are production-wide —
now it accepts any authentic production profile, while store authority still
dispatches per revision so the brand isolation stands.

Two inherited feature modules — the automation binding and the freeze actions —
named V21's validator internally and would have thrown on every V23 document.
They take the validator from the controller that binds them now, which is eight
hundred lines of feature code not duplicated.

## 6A-1a — Mastering-sequence document type

- **Outcome:** the mastering-sequence schema revision: an ordered set of named
  regions with per-region metadata (title, performer, ISRC-class identifiers as
  open metadata, not a hardcoded field list), inter-region gaps, and per-region
  fade-in/fade-out, validated end-to-end. Regions are V11 timeline-annotation
  regions consumed by reference — the sequence stores annotation identity plus
  ordering and per-entry delivery metadata, not copied time ranges. Undoable
  commands create, reorder, retitle, and remove entries and edit gaps and
  fades. The revision registers its capability ID (both product profiles
  initially unavailable), owned-requirement predicate, compatibility rule, and
  capability-policy gate, with the full fixture set: exact-current validation,
  typed rejection of older schemas, future-schema read-only handling, clone,
  undo/redo, clipboard, `.scape`, desktop, and archive fixtures, byte-idempotent
  load/save, and semantic survival after editing.
- **Invariants:** region semantics are consumed from the V11 annotation model,
  never forked; deleting or moving an annotation is visible to the sequence as
  a validation state, never a silent reorder; the sequence document owns
  ordering and metadata only — no audio, no render settings; the revision is
  the single in-flight schema change while it lands.
- **Acceptance:** a sequence survives every edit primitive and both product
  round trips; an annotation deleted out from under a sequence yields a typed,
  user-visible validation error rather than a shrunk sequence; the
  state-to-manifest completeness fixture proves a project holding a mastering
  sequence demands the capability.
- **Non-goals:** no delivery, no cue interchange, no burn of fades into media
  (6A-1b); no per-region loudness targets (6A-2 owns loudness semantics).
- **Stop condition:** stop if the sequence needs its own time model or a
  second region type, or if any consumer needs the annotation model changed
  incompatibly.

## 6A-1b status: complete

A mastering sequence delivers through `createExportPlan` as one ordinary plan:
the delivered length is the sequence, the cues are its entries at their
delivered positions, and there is no tail, because audio past the last region is
audio the sequence did not ask for.

- **The plan.** `mastering-sequence-delivery.ts` resolves a sequence into exact
  output positions by accumulating integer region extents and integer gaps.
  `scaleMasteringSequenceDeliveryPlan` converts each gap and each extent on its
  own before accumulating, so the delivered length is the exact sum of its scaled
  parts; scaling accumulated positions instead would let rounding drift a
  boundary away from the audio it belongs to. Source frames keep the project
  rate: they say what to render, not what was written.
- **The render.** `controller/mastering-sequence-export-render.ts` calls the same
  offline render every other export calls, once per entry over its own region's
  range, and `mastering-sequence-render.ts` arranges the results — gaps as real
  silence, fades applied on the way out, the source untouched, which is what
  makes a reprise with a different treatment expressible. A region named twice is
  rendered once. A sequence never falls back to the realtime stream: that renders
  one contiguous range, so the fallback would write the project's own timeline
  under a name that promised the sequence's.
- **The report.** Per-entry items and the cue outcome join the plan-derived
  inventory rather than being appended by the export path, which is what makes
  `delivery.unreportedConversions eq 0` observe a cue omission.
- **The surfaces.** The delivery is chosen in the export dialog's range control,
  beside the project, selection and loop, and off by default. The editing surface
  is Tools > Mastering sequences.

**Refusals, all typed and all before any bytes are written:** stems and ADM
cannot deliver a sequence; an unvalidatable sequence throws
`MasteringSequenceValidationError` before a plan exists; a delivery too large for
the offline render is refused rather than streamed. The offline-render admission
is sized from the longest single entry, since entries render one at a time — the
whole span a sequence draws from would refuse two short regions at opposite ends
of a long project.

**A known limitation, recorded rather than hidden.** Because the delivered
timeline is assembled in memory, a sequence whose total exceeds the offline
render's admission is refused outright. That is honest but it bites exactly the
album-length case 6A-6's reference fixture describes. 6A-3 owns batching and is
the place to revisit it — most album delivery wants one artifact per entry
anyway, which is a batch of ordinary plans rather than one large one.

**Two shared-code fixes this slice forced.** Markers that survive selection and
clipping are dropped by any writer with no cue chunk, and the marker interchange
report is written before that happens — so a compressed delivery reported markers
it never wrote; cue capability is now read off the writer backend rather than
kept as a second list. And `export.js` gave up its BW64/ADM construction to
`export-bw64-adm.js` to stay under the maintainability ceiling.

## 6A-1b — Region-aware delivery and cue interchange

- **Outcome:** mastering sequences deliver through `createExportPlan`: one
  plan per delivered artifact, region order and gaps realized in the rendered
  timeline, fades applied as plan steps, per-region metadata carried into the
  delivery report. Region-cue interchange rides the existing RIFF marker
  mechanics (`timeline-annotation-riff-interchange.ts`, `riff-markers.ts`)
  where the output format supports cues, itemized in the report where it does
  not. The surface is menu-reached and off by default.
- **Invariants:** delivery consumes the plan seam — no second render path; a
  sequence with validation errors refuses delivery with the typed error; cue
  emission never alters audio bytes.
- **Acceptance:** a fixture sequence delivers with sample-exact region
  boundaries and gaps; cues reopen in the RIFF reader at the emitted
  positions; a format without cue support reports the omission
  (`delivery.unreportedConversions eq 0` observes it).
- **Non-goals:** no queue integration (6A-3 delivers sequences as batch
  members); no DDP or PQ-sheet formats — out of milestone scope.
- **Stop condition:** stop if realizing gaps or fades requires mutating
  project state or a "measurement mode" branch in product code.

## 6A-2 — Normalization and reporting

- **Outcome:** target-driven loudness normalization (integrated target and
  true-peak ceiling) as an explicit, reported plan step over the existing
  meter: measure, compute one gain decision, apply in the neutral path, record
  measured and post-normalization values in the delivery report.
  `measureBextLoudness` gets its user surface (menu-reached measurement of a
  mix or selection, results in the report vocabulary). Dither and channel-map
  decisions (`media-export.js:277-329, 428-432`) are itemized in every audio
  delivery report whether or not normalization runs.
- **Invariants:** normalization is a plan step, never an encoder flag; a
  delivery without normalization reports measured loudness unchanged; the
  destructive Audacity-parity loudness effect
  (`audacity-effects/basic.js:212`) is untouched and shares no code path;
  ADM passthrough remains ineligible for normalization by construction.
- **Acceptance:** `delivery.integratedLoudnessErrorLu lte 0.2` and
  `delivery.truePeakErrorDb lte 0.2` (config/quality-budgets.json:1333-1334)
  on the reference master in development evidence; a normalized delivery's
  report carries both value pairs; the BEXT capture records post-normalization
  values.
- **Non-goals:** no per-region targets, no dynamics processing, no real-time
  loudness UI (the meter history surface exists separately).
- **Stop condition:** stop if true-peak limiting would require lookahead
  processing that changes the render topology — a ceiling violation after
  gain reduction is a reported refusal, not a limiter.

## 6A-3 — Batches, stems, alternates

- **Outcome:** queued delivery of mixes, selections, loops, regions,
  mastering sequences, stems, and alternates over format matrices — each batch
  member resolving to one ordinary plan, enqueued with WP-6.0.1 semantics
  (order, pause between jobs, cancel, retry-from-failure). Stem delivery
  extends `export.js:279-288` and `stem-archive.ts:36-76`; alternates are
  preset×range cross products, not bespoke plans.
- **Invariants:** a batch is a list of plans plus a manifest — no member gets
  a second render path; a queue record stores no media bytes; partial batch
  failure publishes the completed members' outputs and reports the rest, never
  a partial member.
- **Acceptance:** kill/reload mid-batch leaves publishable state consistent
  with the recovery class each backend declared; a mixed audio/stems batch
  produces one report itemizing every member; retry-from-failure re-runs only
  failed members.
- **Non-goals:** no scheduling policy beyond WP-6.0.1's FIFO with explicit
  reordering; no cross-project batches.
- **Stop condition:** stop if any batch member type cannot express itself as
  one plan, or if stems require duplicating the archive path.

## 6A-4 — Conformance and delivery reports

- **Outcome:** conformance validation of produced masters feeding the
  delivery report: BWF/RF64/BW64 and ADM outputs are reopened and checked for
  exact duration, channel count and map, metadata round-trip, and loudness
  consistency with the reported values; AUP4 omission/conversion reporting is
  completed at delivery time through the existing report surface (menu entry
  `ui/application-menus.js:137-139`, dialog `ui/dialogs/EditorDialog.jsx`),
  which WP-6.0.0 has migrated onto the generalized delivery-report model.
- **Invariants:** conformance reads produced bytes back — it never trusts the
  writer; a conformance failure is a failed delivery, not a warning; checks
  run per delivery, not as a separate "verification mode".
- **Acceptance:** the exit-gate master sentence (roadmap.md:745-746) automated
  on the reference suite in development evidence:
  `delivery.audioDurationErrorSamples eq 0`,
  `delivery.channelMapErrors eq 0`, `delivery.avDriftMaximumMs lte 20`
  (config/quality-budgets.json:1330-1336); a deliberately corrupted output
  fails its reopen check and the report says why.
- **Non-goals:** no third-party file QC beyond our own output formats; no
  video conformance (6B-5 owns the video master evidence).
- **Stop condition:** stop if any conformance check would need format
  knowledge the writers don't already own — that is a missing writer contract,
  not a checker feature.

## 6A-5 — Immersive delivery (reviewed)

- **Outcome:** the reviewed object/binaural addition (roadmap.md:723-724):
  the authored bed cap may grow beyond mono/stereo/5.1
  (`adm-project-metadata.ts:14-22`), object metadata becomes authorable, and
  binaural render lands as a delivery option — every new semantic registered
  (serialized schema revision where state is added) and itemized in the
  delivery report.
- **Invariants:** the passthrough contract (`export.js:408-478`) is
  byte-preservation or nothing — its refusal rules stay refusals; authored
  changes route through authored-mode validation only; the compatibility
  fence stands: new BW64 ADM preservation-or-editing semantics are never
  silently qualified by the portable exception
  (docs/project-compatibility.md:84-88).
- **Acceptance:** passthrough fixtures are byte-identical before and after
  this slice; an authored object project round-trips both products; binaural
  delivery reports its renderer decision.
- **Non-goals:** no external renderer plug-ins; no loudspeaker-layout
  authoring beyond the grown bed set.
- **Stop condition:** stop if any change would relax a passthrough refusal or
  make passthrough output editable "slightly".

## 6A-6 — Exit evidence

The 6A surface recorded against workload `m6-reference-master-delivery`
(config/quality-budgets.json:1324-1343) with fixture
`m6-reference-master-suite-v1` (config/quality-budgets.json:976-987, the
one-hour audio master). Correctness and conformance run in ordinary CI
(docs/quality-budgets.md:91); RTF thresholds
(`delivery.audioRenderP95Rtf lte 1`, config/quality-budgets.json:1340)
qualify only on the named environments, no-retry
(docs/quality-budgets.md:123-125). Both environments are unprovisioned today:
the collector and verifier may land and must refuse to publish an accepted
result, exactly as the M5 collector does. No row is simulated or relabelled.
