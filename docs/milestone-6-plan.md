# Milestone 6 plan: professional delivery and interchange

> **Current release note (2026-08-31):** manual delivery, upgrade, and rollback
> checks are optional owner QA. Historical qualification/admission language in
> packet records below does not define current release state.

> Owning source for milestone-6 sequencing, the delivery-model and
> interchange decisions, their invariants, and the bounded work packets.
> The [roadmap](../roadmap.md#6-professional-delivery-and-interchange)
> owns scope and status; the compatibility, licensing, and
> quality-budget policies own their claims. Re-grounded against the
> repository on 2026-08-16 at commit `14f45438`. Milestone 6 depends on
> milestones 4 and 5; this plan names those dependencies per packet. The
> 6A/6B/6C tracks are decomposed in their pickup contracts:
> [6A](milestone-6a-soundscaper-delivery.md),
> [6B](milestone-6b-framescaper-delivery.md), and
> [6C](milestone-6c-interchange-archive.md).

## Activation audit — 2026-08-24

The web milestone remains implemented and menu-reached. The requested native
activation has produced a fail-closed integration contract, not a production
activation claim:

- Soundscaper has bounded persistent delivery descriptions/results, a renderer
  queue adapter, exact-plan revalidation, and a caller-owned atomic publication
  fence. No main/preload job implementation currently binds that adapter to the
  application, so the maintained product continues to run the existing
  in-session delivery queue.
- Framescaper V15 binds an exact platform profile, caption mux/sidecar/burn-plan
  artifacts, image-sequence companion audio, target policy, conformance closure,
  and a sealed delivery report. The selected native lifecycle, queue, helper
  grant, and executor contracts still admit through V14. Their verification-only
  V15 projection refuses any caption or companion artifact instead of silently
  dropping it.
- EDL, OTIO, and FCPXML exports now inventory authored caption tracks as explicit
  omissions, including an authored track with no cues in the exported sequence.

Native surfaces are implemented and enabled for testing. Execution still
requires facts this repository cannot manufacture: exact target payloads,
corresponding-source identity, platform compatibility, containment, project
authority, capacity, and explicit consent. Source, licensing, payload,
architecture, package-content, and runtime-integrity checks remain ordinary
automation. Timing, heap, codec, display, GPU, install, upgrade, and rollback
observations belong in diagnostics or the conditional owner-QA worksheet; there
is no fixed hardware matrix, accepted measurement set, or milestone-6 release
authority. Missing machine facts keep the affected operation unavailable but no
pending human row disables build, packaging, catalog visibility, or testing.

## Goals and ordering principle

1. **Primary: users must not hit trouble.** No hidden conversion — the
   delivery gate is literal (`delivery.unreportedConversions eq 0`,
   config/quality-budgets.json:1337); no partial output ever publishes
   (`delivery.partialPublishedOutputBytes eq 0`); nothing is labeled
   resumable without tested resume or an atomic verified restart
   (roadmap.md:741-742); masters reopen with exact duration, frame
   count, sync, loudness, and caption timing
   (config/quality-budgets.json:1330-1335); and ADM passthrough — a
   byte-preservation contract, not a renderer — is never weakened
   (roadmap.md:723-724).
2. **Secondary: one delivery model, extended — not a parallel export
   stack.** Every milestone-6 surface grows out of the existing plan
   seam (`createExportPlan`,
   `src/common/editor/export.js:152`; `createVideoExportPlan`,
   `src/common/editor/video-export.js:143`) and the existing
   direct-to-destination transports the milestone-2 witnesses froze.
   Presets, queues, and reports wrap plans; they never bypass them.

Work is ordered by contract risk: the delivery-report model, the
plan-version pin repair, and the queue semantics land first because
every later packet emits reports, pins plans, and enqueues jobs.

## What exists today (verified baseline)

- **Audio delivery is broad and direct-to-disk.** Twelve formats
  (`src/common/editor/controller/export-settings.ts:5-18`) over
  native-WAV/AIFF and ffmpeg backends with per-format channel ceilings
  (`src/common/editor/media-export.js:34-105`); RF64 is automatic
  promotion above the RIFF size limit, not a selectable format
  (`src/common/editor/wav.js:275-277`); dither modes and channel
  mapping with per-output gain matrices are complete
  (`src/common/editor/media-export.js:277-329, 428-432`); export-time
  windowed-sinc resampling engages when rates differ
  (`src/common/editor/controller/rendered-audio-encoding.ts:126-134`);
  stems export per-track with streaming ZIP32/7z archives
  (`src/common/editor/export.js:279-288`;
  `src/common/editor/controller/stem-archive.ts:36-76`).
- **Loudness was measured, never applied — 6A-2 closed both halves.** EBU R128
  measurement is mature (`src/common/editor/ebu-r128.js`) and BWF/BW64 exports
  capture loudness into BEXT. At the original grounding `measureBextLoudness`
  (`src/common/editor/broadcast-loudness.ts:6`) had no UI and no export-time
  normalization existed. Both landed in 6A-2:
  `src/common/editor/loudness-normalization.ts` decides the gain,
  `loudness-normalization-render.ts` applies it, Analyze > Measure loudness
  surfaces the meter, and the export dialog states the target.
- **Video delivery is two formats at 720p30.** MP4/h264+aac and
  WebM/vp9+opus only (`src/common/editor/video-export.js:29-57`),
  encoded by single-threaded ffmpeg.wasm, default canvas ceiling
  1280×720@30 (`src/common/editor/video-export.js:24-26`), range
  restriction project/selection/loop
  (`src/common/editor/controller/video-export-service.ts:124`). No
  WebCodecs encode path and no JS muxer exist. Since first grounding, a
  V7 keyframe export subsystem
  (`src/common/editor/video-keyframe-export-plan-v7.ts` and siblings,
  FFmpeg-backed, with a read-side WebM container verifier) and the
  V19/V20 export strategy seams
  (`src/framescaper/video-export-strategy-v19.ts`,
  `video-export-dispatch-v20.ts`) have landed; they are plan-seam
  consumers, and 6B options reach them through the same builders.
- **Captions are sidecar-only.** txt/srt/vtt/json plus Podcast 2.0
  chapters (`src/common/editor/label-io.js:1-2, 75-99, 357-370`); the
  encoder strips subtitle and data streams outright (`-sn`, `-dn`,
  `src/common/editor/video-ffmpeg.js:71-72`) — that exact line is what
  muxed captions change.
- **Interchange is Audacity plus `.scape`.** AUP/AUP4 both directions
  with a **versioned omission/conversion report produced, retained, and
  now rendered** (`src/common/editor/aup4-profile.js:74-112`;
  `src/common/editor/controller/native-project-service.ts:223-233`;
  menu entry `src/common/editor/ui/application-menus.js:137-139` with
  its dialog in `ui/dialogs/EditorDialog.jsx` — the surface landed
  after first grounding); `.scape` is deterministic, streaming, and
  digest-gated end-to-end
  (`src/common/editor/scape-export-plan.ts:92-300`), with byte-exact
  future-schema copy
  (`src/common/editor/scape-archive-copy.ts:37`). EDL, OTIO, FCPXML,
  and DAWproject exporters do not exist; the exporter rules milestone 3
  recorded for them are at docs/milestone-3-plan.md:449-480.
- **Web jobs remain one-at-a-time and unresumable.** A single foreground task
  with named-scope AbortSignal cancellation
  (`src/common/editor/controller/lifecycle.ts:150-187`;
  `src/common/editor/controller/export-service.ts:53-93`); no pause, no
  retry, no persistence; the abortable `render-job-port` interface
  exists unimplemented
  (`src/common/editor/platform/render-job-port.ts:9-23`). The 5B-3
  restartable-queue model now exists (`native-queue-record.ts`,
  `native-queue-state-machine.ts`, `desktop/native-services-database.ts`,
  and `platform/persistent-render-queue-port.ts:39`). Helper contract v1 now
  admits closed media kinds and a main-owned dispatcher exists, but its 5B
  payload manifest is empty and source-backed production dispatch remains
  gated. The ordinary Web fallback is unchanged.
- **Relink exists; consolidate and trim-media do not.** The
  milestone-2 linked-media lifecycle is closed and must not be
  weakened (config/milestone-2-closure.json:245); digest
  infrastructure is ready for manifests
  (`src/common/editor/scape-archive-media.ts:314-322`).
- **No preset system exists.** The file-save purpose allowlist already
  reserves `'preset'` and `'report'`
  (`src/common/editor/file-service.js:171`); the flat export dialog
  a preset system must subsume is
  `src/common/editor/ui/inspector/ExportDialog.jsx:31-375`.
- **ADM is two modes.** Authored programmes carry a bed from mono through
  7.1.4 plus positioned objects, and may be rendered binaurally
  (`src/common/editor/adm-bed-layout.ts`, `adm-authored-objects.ts`,
  `binaural-render.ts`, all landed by 6A-5); passthrough is a strict
  byte-preservation contract (neutral path, dither none, exact one
  full-source clip, chunk-sequence preservation,
  `src/common/editor/export-bw64-adm.js:95-115`, extracted from `export.js` by
  6A-1b) and 6A-5 did not touch it.

## Known defect this plan absorbed first (repaired)

The export-plan version pin had drifted across five sites and was widening:
the planner emitted `version: 6`, the direct-path contract accepted 6 or 7,
the FFmpeg runner accepted 1–6, while the quality-budget fixture, its
security test, and the budgets narrative all still said 4 — describing
evidence tests that provably bind version-6 plans and reject 5 as legacy.
This was a live instance of the recorded "3B-2b trap": the version was
pinned in more places than the planner.

WP-6.0.0 repaired it. `src/common/editor/video-export-plan-version.ts` is
now the single source of truth, the supported set is derived from the
canonical version minus any number another plan kind claims (so the graph
runner can never be handed a keyframe plan), and
`tests/audio-editor-video-export-plan-version.test.ts` derives its
expectations from the constant rather than repeating a literal — which is
what stops the stale pin recurring the next time the version moves.

## Decisions

### Reports are first-class delivery artifacts

Every delivery emits a **delivery report**: settings, format, channel
map, dither, resample decision, loudness measurement/normalization
result, restoration provenance where applicable, conformance results,
and an itemized conversion/omission list. The report model generalizes
the proven AUP4 compatibility-report shape
(dispositions `preserved|converted|missing|omitted` with counts,
`src/common/editor/aup4-profile.js:74-88`) rather than inventing a
second vocabulary, and saves through the already-reserved `'report'`
purpose (`src/common/editor/file-service.js:171`). The AUP4 report's
menu-reached dialog landed after first grounding; WP-6.0.0 migrates
that existing surface onto the generalized model rather than creating
it. `delivery.unreportedConversions eq 0` is the machine gate over
this model.

### Loudness normalization applies what measurement knows

Milestone 6 adds target-driven normalization (integrated loudness and
true-peak ceiling) as an explicit, reported delivery step over the
existing R128 meter, exposes `measureBextLoudness`, and records both
measured and post-normalization values in the report. The gates:
`delivery.integratedLoudnessErrorLu lte 0.2`,
`delivery.truePeakErrorDb lte 0.2`
(config/quality-budgets.json:1333-1334). The destructive
Audacity-parity loudness effect is unrelated and unchanged.

### Queue semantics are honest by construction

The web tier gets a bounded in-session delivery queue (ordered jobs,
pause between jobs, cancel, retry-from-failure) over the existing
abortable task discipline; the Electron tier binds the same queue
model to the milestone-5 restartable persistent queue (5B-3) through
`render-job-port`. Every backend/preset declares one of exactly two
recovery classes — **tested resume** or **atomic verified restart** —
and the label is evidence-bound per the exit gate (roadmap.md:741-742).
Jobs publish nothing partial: the milestone-2 direct-transport
invariants (select-before-render, seal-before-commit, no final Blob)
carry over unchanged.

### Presets are validated data over plans

A preset is a versioned, validated record declaring container, codec,
profile, color, audio layout, captions, metadata, milestone-9 legal-review
status, and fallback behavior (roadmap.md:743-744) that
resolves to an export plan — it never carries its own encode path.
Platform presets with pending milestone-9 licensing rows declare that status
without hiding or disabling themselves. A browser executor degrades a native
target visibly because it cannot execute its plan; the native executor instead
applies exact machine admission. The preset
system subsumes the flat dialog settings; the milestone-7 vertical
lookahead (7B-5, docs/milestone-7-plan.md:827-844) never landed, so
6B-1 owns canvas/aspect and vertical delivery whole, including
acceptance.

### Captions deliver three ways

Sidecar (exists), **burned** (a caption render stage in the filter
plan over the milestone-4 styled caption schema), and **muxed** where
the container supports it (removing `-sn` for those plans,
`src/common/editor/video-ffmpeg.js:71-72`). Cue timing is gated at
`delivery.captionCueErrorFrames lte 1`
(config/quality-budgets.json:1335). Burn-in consumes milestone-4
caption styling; if only label tracks exist at pickup, burn-in scopes
to them explicitly rather than inventing styling here.

### The web encode tier is WebCodecs plus FFmpeg stream-copy muxing

For qualified SDR outputs, a WebCodecs encode path whose containers are
written by the FFmpeg that already ships, falling back semantically to the
full FFmpeg path (roadmap.md:731-732).

**This revises the original decision, which called for a reviewed muxer
dependency and named the muxer choice as the packet's design decision.**
Measurement retired that question. On a 640×360 90-frame fixture through the
pinned `@ffmpeg/core` 0.12.10, `encode + mux` took 3494 ms while `remux only`
with `-c:v copy` took 4.9 ms — muxing is 0.1% of the FFmpeg-side cost, so
reusing FFmpeg for it forfeits almost nothing. The shipped build has every
piece required: the `h264_mp4toannexb` bitstream filter, the `h264`
elementary-stream demuxer, and both the `mp4` and Matroska/WebM muxers
accepting a copied stream. `tests/audio-editor-video-remux-ffmpeg.test.ts`
re-measures this rather than trusting the number.

Two consequences. **No new dependency:** no muxer licensing row, provenance
manifest, or notices, and nothing is added to the FFmpeg enabled set that
the two blocked release gates govern. **A second, larger saving:** that
fixture pushed 82.9 MB of raw RGBA into wasm to produce a 232 kB MP4, because
today's path transfers frames. WebCodecs accepts a `VideoFrame` straight from
the canvas, so what crosses into FFmpeg becomes the compressed chunks
instead — roughly a 360× reduction before any encoding speedup.

The risks that remain are not about muxing. Elementary streams carry no
container timing, so the rate is handed to FFmpeg as the exact rational
quotient the plan owns (`30000/1001`, never `29.97`), which
`video-remux-ffmpeg.ts` enforces and its test pins. Hardware encoders are not
byte-reproducible across machines, so this path's goldens are tolerance-based
while the FFmpeg path keeps its byte goldens. Audio stays on the ordinary
FFmpeg encoder, since `AudioEncoder` coverage is thinner than `VideoEncoder`
and the existing plans already take a separate staged audio input.

Longer term this is also a lever on the milestone-9 licensing review: once
encoding leaves FFmpeg, a narrower `@ffmpeg/core` rebuild could drop the
x264, x265, and libvpx encoders and keep muxers and parsers, shrinking the
enabled library set that `ffmpeg-enabled-library-corresponding-source` and
`ffmpeg-enabled-codec-patent-review` both govern. That rebuild is not in
milestone-6 scope; it is recorded here because this decision is what makes it
possible.

### Mastering sequences are a bounded new document type

Named regions with per-region metadata, order, gaps, and fades over the
existing region/label primitives — a serialized schema revision under
the standing registration duties, designed at pickup. Region-cue
interchange reuses the marker/RIFF mechanics where formats allow.

### Interchange lands against the recorded rules

EDL, OTIO, and FCPXML profiles implement the exporter rules milestone 3
already recorded (docs/milestone-3-plan.md:463-480): exact rational
rates as computed double quotients (never `29.97` literals),
pre-rounded values, one timebase per item, VFR tables in metadata
namespaces, tolerance-vs-exact equality split in conformance tests, and
AUP4 tempo flattening with an explicit compatibility item. Archive,
consolidate, and trim-media build on the closed relink lifecycle and
digest infrastructure, emitting checksum manifests; consolidation
never deletes external media (the milestone-2 lifecycle acceptance,
config/milestone-2-closure.json:245).

### Immersive extends without weakening passthrough

Object and binaural delivery are a reviewed addition (roadmap.md:
723-724), landed by 6A-5: the authored bed set grew through 7.1.4 and
object metadata became authorable, while the passthrough contract — byte
preservation with a neutral path — stayed intact and its refusal rules
stayed refusals, proved by a digest of the chunks a passthrough plan
reproduces. The compatibility fence stands: new BW64 ADM
preservation-or-editing semantics are not silently qualified by the
existing portable exception (docs/project-compatibility.md:86-88).

### Rejected alternatives (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| A second export stack for presets/queues | Two stacks drift; the plan seam is the single semantic authority and the milestone-2 witnesses pin its transports. |
| "Resumable" as a UI label | The exit gate demands tested resume or atomic verified restart per backend/preset (roadmap.md:741-742); the label is evidence-bound. |
| A new conversion-report vocabulary | The AUP4 report model is proven, versioned, and already retained; delivery generalizes it. |
| Muxing captions by post-processing files | Caption mux rides the plan and its args; post-hoc file surgery breaks determinism and the digest discipline. |
| Loudness normalization inside the encoder | Normalization is a reported plan step with measured evidence, not an encoder flag; encoders vary, the report cannot. |
| A reviewed muxer library for the WebCodecs tier | Retired by measurement: muxing is 0.1% of FFmpeg-side cost, so the FFmpeg already shipping does it for free rather than adding a dependency with its own licensing row. |
| Growing the codec set web-side for presets | Codec availability follows the milestone-5 licensing/patent gates; presets declare legal status, they do not create it. |
| Editing ADM passthrough output "slightly" | Passthrough is byte-preservation or it is nothing; any authored change routes through the authored mode's validation. |

## Implementation status

**Status on 2026-08-19: phase 6.0, the whole 6A track and the whole 6B track are
complete for the web tier; 6C-1 is complete across all three profiles, and 6C-2
is complete — archive manifests, consolidate, and a lossless trim-media that
rebinds the document through its own undoable command.** The
6A track was reviewed after it closed, and the repairs that review produced are
recorded with their slices below rather than reopening the packets. Nothing here is
qualified — the owner-qualified fixed-GPU host is not admitted for M6 and the
native OS matrix remains unprovisioned, so no RTF or throughput number in this
milestone is claimed as met. The two interchange
acceptance items that were previously blocked are now closed: the OTIO
reference-implementation round trip runs against the real `opentimelineio`,
provisioned per [`interchange-conformance.md`](interchange-conformance.md), and
FCPXML is validated against the reference FCPX reader instead of Apple's DTD,
which is not redistributable. What landed:

- **WP-6.0.0 plan-pin repair — implemented.**
  `src/common/editor/video-export-plan-version.ts` is the single source of
  truth; the planner, the FFmpeg runner's accepted set, the direct-path
  contract, the budget fixture, its security test, and the narrative all
  derive from it, and `tests/audio-editor-video-export-plan-version.test.ts`
  fails the moment any pin stops agreeing with the planner. The extraction
  that paid for the new import also took `video-ffmpeg.js` under the
  600-line ceiling, retiring its allowlist entry.
- **WP-6.0.0 delivery-report model — complete.**
  `delivery-report.ts` generalizes the AUP4 report vocabulary;
  `delivery-conversion-inventory.ts` and
  `delivery-video-conversion-inventory.ts` derive conversions from the plan
  and supply the `delivery.unreportedConversions` count. Both the audio and
  video export services build the report from the plan they are about to
  execute, recording it as session state, and a menu-reached Delivery
  Report dialog renders it. Building it surfaced two conversions the
  product had never disclosed: integer sample formats enable triangular
  dither by default, so ordinary WAV delivery dithered silently; and every
  video export passes `-sn`/`-dn`, dropping any subtitle or data stream a
  source carried. Both are now itemized. Reports save through the reserved
  `'report'` purpose as deterministic JSON, so a delivery's evidence
  outlives its session and two runs compare byte for byte.
- **WP-6.0.1 queue semantics — complete (web tier).**
  `delivery-queue.ts` is the bounded in-session queue, consuming the 5B-3
  recovery-class and task-kind vocabulary rather than forking it. Enqueue
  refuses a job that would claim a recovery it cannot prove.
  `controller/delivery-queue-runner.ts` drives it: one job at a time, a
  cancelled job stays cancelled even if its executor later resolves, and an
  abort settles as cancelled rather than failed.
  `controller/delivery-queue-service.ts` binds it to the real export path:
  every member is one ordinary `handleExportAction` call, so a batch is
  never a second render path.
- **WP-6.0.2 preset core — complete.**
  `delivery-preset.ts` validates preset records with closed field lists,
  resolves them to ordinary plan options (parity-tested against the dialog
  path), and declares legal availability from the licensing matrix.
  `delivery-preset-store.ts` and `controller/delivery-preset-service.ts`
  mirror `effect-presets.js` and its service exactly — same state shape,
  same verbs, same id-collision rule — because the export dialog reuses the
  effect-preset controls, which is the owner's recorded decision. The
  dialog shows the picker, name field, and save/delete/import/export
  controls; `ui/export-preset-model.ts` owns the string-to-value
  translation and keeps dialog-only state out of saved presets.

**6.0 acceptance is met for the web tier, so 6A/6B/6C may open.** What
remains inside 6.0 is gated on work this milestone does not own:

- The Electron queue binding has a main-owned V2 host and closed media helper
  kinds. It runs when an authenticated payload, complete source/project
  authority, supported platform, containment, capacity, and user consent are
  present. Pending licensing review is reported to milestone 9 only. The
  in-session queue remains the browser-executor fallback.
- The AUP4 report still renders through its own component rather than the
  shared one, though both now draw their copy from
  `src/common/i18n/report-copy.js` and share the disposition vocabulary.
- Conformance and loudness report fields landed with 6A-4 and 6A-2 and extended
  the model rather than changing it, as planned. Restoration-provenance fields
  still do not exist; nothing in milestone 6 produces one yet.

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| 6.0 | Serialized (one work stream) | Plan-pin repair, delivery-report model with AUP4 report surface, queue semantics, preset system core |
| 6A | Parallel track | Soundscaper delivery: mastering sequences, normalization, batches/stems/alternates, conformance and reports, immersive |
| 6B | Parallel track | Framescaper delivery: canvas/aspect/quality/audio-layout, caption burn-in/mux, WebCodecs tier, Electron format tier and platform presets |
| 6C | Parallel track (shared, file-disjoint) | EDL/OTIO/FCPXML, archive/consolidate/trim-media, checksum manifests |

6A/6B/6C must not begin until every 6.0 acceptance check passes.

## Work packets

6.0 packets are decomposed here; 6A/6B/6C are summarized against the
five fields (docs/milestone-3-plan.md:483-485) and decomposed in their
pickup contracts:
[`docs/milestone-6a-soundscaper-delivery.md`](milestone-6a-soundscaper-delivery.md),
[`docs/milestone-6b-framescaper-delivery.md`](milestone-6b-framescaper-delivery.md),
and
[`docs/milestone-6c-interchange-archive.md`](milestone-6c-interchange-archive.md).

### WP-6.0.0 — Plan-pin repair and the delivery-report model

- **Outcome:** the plan-version pins reconciled across all five
  surfaces (planner, direct-path contract, FFmpeg runner, budget
  fixture, security test — plus the narrative) with a
  single-source-of-truth check so the next bump is one-constant; the
  delivery-report model implemented over the AUP4-report shape with the
  `'report'` save purpose; the existing AUP4 report dialog migrated
  onto the generalized model; the
  `delivery.unreportedConversions` collector observing the real path.
- **Invariants:** reports are generated from plan execution, never
  hand-assembled; report emission cannot mutate project state.
- **Acceptance:** a deliberately injected unreported conversion trips
  the collector; the stale-pin regression cannot recur (test derives
  from the constant); AUP4 report renders offline for a fixture
  project.
- **Non-goals:** no new formats, no queue, no presets.
- **Stop condition:** stop if any report field would require
  "measurement mode" special-casing in product code.

### WP-6.0.1 — Queue semantics

- **Outcome:** the bounded web delivery queue (order, pause between
  jobs, cancel, retry-from-failure) over the existing task and
  cancellation discipline; the recovery-class declaration (tested
  resume vs. atomic verified restart) wired per backend; Electron
  binding to the milestone-5 persistent queue through
  `render-job-port` where available, with honest degradation to the
  in-session queue where not.
- **Invariants:** no partial publication; a queue record never stores
  media bytes; cancellation keeps the recorded long-job settlement
  semantics.
- **Acceptance:** kill/reload during each queue state leaves
  publishable state consistent; a backend claiming resume proves it
  under kill-mid-job; one claiming restart proves atomicity.
- **Non-goals:** no scheduling policy beyond FIFO with explicit
  reordering; no cross-app queue sharing.
- **Stop condition:** stop if any job type can neither resume nor
  restart atomically — it stays out of the queue rather than lying.

### WP-6.0.2 — Preset system core

- **Outcome:** the validated preset record and resolver over export
  plans; audio and video preset coverage for today's formats;
  legal-availability wiring to the licensing matrix; the flat export
  dialog subsumed; preset import/export as data.
- **Invariants:** a preset never bypasses plan validation; unknown
  preset fields are rejected, not ignored; presets with unavailable
  codecs degrade visibly.
- **Acceptance:** preset→plan resolution golden tests; a preset naming
  a gated codec renders its legal status and fallback; dialog parity
  fixtures (same settings, same plan) pass.
- **Non-goals:** no platform preset catalog yet (6B-4); no new codecs.
- **Stop condition:** stop if any preset needs its own encode branch.

### 6A packets (Soundscaper delivery — decomposed in [the 6A pickup](milestone-6a-soundscaper-delivery.md))

- **6A-1 — Mastering sequences.** Outcome: the mastering-sequence
  document type (named regions, per-region metadata, order, gaps,
  fades, validation) with its serialized revision and atomic
  registration; region-aware delivery through the plan seam.
  Stop: stop if region semantics would fork the milestone-3A
  marker/region model instead of consuming it.
- **6A-2 — Normalization and reporting.** Outcome: loudness/true-peak
  normalization as a reported plan step; `measureBextLoudness` surfaced;
  dither and channel-map decisions itemized in the report. Acceptance:
  the loudness and true-peak error gates on the reference master.
- **6A-3 — Batches, stems, alternates.** Outcome: queued mixes,
  selections, loops, regions, stems, and alternates over format
  matrices with pause/cancel/retry (WP-6.0.1 semantics); stem-archive
  paths extended, not duplicated. Stop: stop if a batch needs a second
  render path per member rather than one plan each.
- **6A-4 — Conformance and delivery reports.** Outcome: BWF/RF64/BW64
  and ADM conformance validation of produced masters (reopen, duration,
  channel, metadata checks) feeding the report; AUP4 omission and
  conversion reporting completed at delivery time. Acceptance: the
  reopen/duration/sync/channel/frame-count/caption/metadata master
  checks of the exit gate (roadmap.md:745-746) automated on the
  reference suite.
- **6A-5 — Immersive delivery (reviewed).** Outcome: object/binaural
  delivery per the decision above, with the passthrough contract
  untouched and every new semantics registered and reported.
  Stop: stop if any change would relax a passthrough refusal.
- **6A-6 — Exit evidence.** The 6A surface against
  `m6-reference-master-delivery` (one-hour audio master,
  config/quality-budgets.json:1324-1343) recorded honestly on the named
  environments.

### 6B packets (Framescaper delivery — decomposed in [the 6B pickup](milestone-6b-framescaper-delivery.md))

- **6B-1 — Canvas, aspect, and delivery options.** Outcome: canvas,
  rational frame rate, aspect, fit, background, quality, audio layout,
  caption selection, and range as validated plan/preset options —
  lifting the 1280×720@30 default ceiling deliberately
  (`src/common/editor/video-export.js:24-26`); 7B-5 never landed, so
  vertical canvas/crop delivery is owned here whole
  (docs/milestone-7-plan.md:827-844).
  Acceptance: crop-correct goldens including 9:16; existing exports
  byte-stable when no new option is exercised.
- **6B-2 — Caption burn-in and mux.** Outcome: the burn-in render
  stage and supported muxed captions per the decision above, cue
  timing within one frame. Stop: stop if burn-in styling would be
  invented here rather than consumed from milestone 4.
- **6B-3 — WebCodecs encode tier.** Outcome: the WebCodecs + reviewed
  muxer path for qualified SDR outputs with semantic FFmpeg/proxy
  fallback; the muxer dependency's licensing row, provenance, and
  notices in the same change. Acceptance: same-plan goldens across
  both encode paths on the qualified browser matrix. Stop: stop if
  the two paths' outputs diverge beyond the golden thresholds — the
  plan is the meaning, not the encoder.
- **6B-4 — Electron format tier and platform presets.** Outcome:
  4K/HDR, 10-bit, hardware encode, image sequences, alpha, mezzanine
  formats, and platform delivery presets with explicit milestone-9 legal
  review status — consuming the milestone-5 native media engine and its
  per-codec report rows. Stop current execution only when the authenticated
  payload, codec, platform, containment, capacity, consent, or project
  authority is unavailable; pending human review stops stable 1.0 only.
- **6B-5 — Exit evidence.** The 6B surface against the ten-minute
  video master and the render-time budgets
  (`delivery.webVideoRenderP95Rtf lte 12`,
  `delivery.audioRenderP95Rtf lte 1`,
  config/quality-budgets.json:1339-1340), recorded honestly.

### 6C packets (shared interchange — decomposed in [the 6C pickup](milestone-6c-interchange-archive.md))

- **6C-1 — EDL, OTIO, and FCPXML profiles.** Outcome: exporters (and
  importers where the profile commits to them) under the recorded
  milestone-3 rules, each with a conformance suite and an itemized
  conversion report; profile scope (which features map, which report
  as omitted) closed in the slice doc. Stop: stop if any rate is
  emitted as a decimal literal or any value rounds downstream.
  **Implemented — all three profiles**, export-only, each reachable from
  File > Export other through the shared `interchange` save purpose and each
  publishing its report to the same File menu surface the encode paths use.
  Every profile committed its scope in the pickup before landing. All three are
  additionally proven against third-party readers rather than only against our
  own parsers — see [`interchange-conformance.md`](interchange-conformance.md),
  which also records the one notices entry a maintainer still owes, since
  `THIRD_PARTY_LICENSES.md` is digest-bound by an approved review record.
- **6C-2 — Archive, consolidate, trim-media, manifests.** Outcome:
  project archive with checksum manifests; consolidate and trim-media
  as explicit, reported, undoable-where-possible operations over the
  relink lifecycle; verification tooling reading the manifests back.
  Invariants: external media is never deleted; digest verification
  end-to-end. Stop: stop if trim-media cannot prove which bytes are
  unreferenced.
  **Implemented.** A `.scape` save records the checksum manifest of the archive
  it wrote, measured by reading the finished file back rather than copied from
  the writer's own digests; File > Save archive checksums writes it out and the
  verifier reads it back. Consolidate copies linked originals into managed
  storage and rebinds by unlinking under the compare-and-swap fence, never
  deleting the external file. Trim-media proves which frames are referenced —
  from the timeline and the Project Bin alike, ignoring visibility — cuts video
  losslessly on keyframes, and moves the document onto the result through
  `source/rewrite-media` in one undoable batch. Nothing on either path removes
  the bytes an undo would need.
- **6C-3 — Exit evidence.** Cross-format round-trip fixtures and the
  `.scape` handoff preservation sentence of the exit gate
  (roadmap.md:747) witnessed.

## Quality-budget and evidence duties

- Workload `m6-reference-master-delivery` and fixture
  `m6-reference-master-suite-v1` (3600 s audio, 600 s 720p30 video)
  are registered with the eleven thresholds cited above
  (config/quality-budgets.json:976-987, 1324-1343) against
  `owner-qualified-windows-x64-rtx3090-01` and `native-os-lab-matrix`.
  The fixed-GPU descriptor retains historical earlier-workload diagnostics but
  is currently unprovisioned and does not admit M6; the native OS matrix also
  remains unprovisioned. The fixture's 720p spec predates
  the 6B-1 canvas lift; a companion fixture entry (including 9:16) is a
  deliberate, reviewed budget change under the threshold-change rules
  (docs/quality-budgets.md:607), never a silent edit.
- Correctness and conformance suites run in ordinary CI; RTF and
  timing thresholds qualify only on provisioned environments, no-retry
  (docs/quality-budgets.md:91, 123-125).
- Bundle gates unchanged: no codec or muxer byte enters the Pages
  bundle beyond the ceilings; new web dependencies ride the runtime
  asset discipline.

## Two-agent-plus coordination rules

- 6.0 is one work stream; 6A/6B/6C open after its acceptance passes
  and run file-disjoint: the audio delivery stack to 6A, the video
  delivery stack to 6B, interchange and archive modules to 6C.
- Spine files: the plan builders and their version constants, the
  preset and report schemas, the queue model, export settings and
  dialog models, licensing matrix, capability/compatibility registers,
  application menus, i18n catalog, maintainability allowlist. One
  owner per edit, rebase before push.
- Schema revisions stay serialized product-wide (mastering sequences,
  any caption-delivery state); at most one in flight.
- Shared fate on repo gates; the canonical check stays green on every
  push.

## Known constraints this plan absorbs

- **The three-way plan-version pin drift** is repaired in WP-6.0.0
  before any plan bump.
- **Milestone-5 dependencies:** 5B now has exact V7–V12 admission, closed
  media/OFX helper kinds, a main-owned V2 queue/controller, and a bounded native
  source host. No 5B payload is built, the
  selected V17 renderer now has digest-bound source-body handoff, V20 queue
  admission, and pathless watch mutation, while most unified render semantics
  remain typed unsupported. Empty payload rows and those semantic boundaries
  still gate native execution, but the 6B-4 catalog is visible for testing and
  reports exact executor/payload reasons. Human licensing review is a
  milestone-9 stable 1.0 gate only; the web tier of every 6.0/6A packet works
  without native payloads.
- **Milestone-4 dependencies:** selected Framescaper V27 now locally implements
  explicit caption tracks with SRT, WebVTT, and a bounded IMSC 1.1 subset.
  Guided-local and external qualification remain open, and M1–M4 grant no
  caption burn-in or mux authority; 6B-2's historical label-track burn-in path
  remains separate from the V27 track model. The mastering-sequence revision consumes the 3A
  marker/region model (`src/common/editor/timeline-annotation.ts`).
- **The AUP4 report dialog landed** after first grounding
  (`src/common/editor/ui/application-menus.js:137-139`); WP-6.0.0
  migrates it onto the generalized report model instead of creating it.
- **M6 qualification remains unavailable**; the fixed-GPU host does not admit
  the M6 workload and the native OS matrix is unprovisioned, so development
  evidence proceeds while qualification rows stay honest
  (docs/quality-budgets.md:157-197).

## Watch items (not gates yet)

- WebCodecs encode maturity and per-browser codec coverage for the
  6B-3 tier.
- Muxer library candidates and their licensing posture (the 6B-3
  named decision).
- OTIO's rational-rate limitation (rates as doubles) — the recorded
  cautionary tale; watch upstream before committing importer scope.
- Milestone 7 has shipped 7A-1/7A-2 only; if later assistance packets
  ship clip-maker outputs, they become queue consumers — no coupling
  beyond ordinary jobs.

## Non-goals and fences

- No MIDI import/export of any kind (8B fence; roadmap.md:711-712).
- No cloud rendering, upload targets, or hosted delivery.
- No stable 1.0 release while required licensing/patent reviews are pending.
  Build, packaging, catalog visibility, and testing remain enabled; exact
  payload, codec, muxer, platform, and containment support is machine-checked.
- No weakening of the milestone-2 direct-transport invariants, the
  `.scape` digest discipline, or the linked-media lifecycle.
- No second export stack; plans remain the single semantic authority.
- Every new surface is menu-reached and off by default
  (AGENTS.md:8-11).
