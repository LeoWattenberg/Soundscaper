# Milestone 6 plan: professional delivery and interchange

> Owning source for milestone-6 sequencing, the delivery-model and
> interchange decisions, their invariants, and the bounded work packets.
> The [roadmap](../roadmap.md#6-professional-delivery-and-interchange)
> owns scope and status; the compatibility, licensing, and
> quality-budget policies own their claims. Grounded against the
> repository on 2026-08-11 (repo brief with file:line verification).
> Milestone 6 depends on milestones 4 and 5; this plan names those
> dependencies per packet and must be re-grounded at pickup.

## Goals and ordering principle

1. **Primary: users must not hit trouble.** No hidden conversion — the
   delivery gate is literal (`delivery.unreportedConversions eq 0`,
   config/quality-budgets.json:1039); no partial output ever publishes
   (`delivery.partialPublishedOutputBytes eq 0`); nothing is labeled
   resumable without tested resume or an atomic verified restart
   (roadmap.md:658-659); masters reopen with exact duration, frame
   count, sync, loudness, and caption timing
   (config/quality-budgets.json:1031-1038); and ADM passthrough — a
   byte-preservation contract, not a renderer — is never weakened
   (roadmap.md:641-642).
2. **Secondary: one delivery model, extended — not a parallel export
   stack.** Every milestone-6 surface grows out of the existing plan
   seam (`createExportPlan`,
   `src/common/editor/export.js:152-327`; `createVideoExportPlan`,
   `src/common/editor/video-export.js:123-232`) and the existing
   direct-to-destination transports the milestone-2 witnesses froze.
   Presets, queues, and reports wrap plans; they never bypass them.

Work is ordered by contract risk: the delivery-report model, the
plan-version pin repair, and the queue semantics land first because
every later packet emits reports, pins plans, and enqueues jobs.

## What exists today (verified baseline)

- **Audio delivery is broad and direct-to-disk.** Twelve formats
  (`src/common/editor/controller/export-settings.ts:5-18`) over
  native-WAV/AIFF and ffmpeg backends with per-format channel ceilings
  (`src/common/editor/media-export.js:34-104`); RF64 is automatic
  promotion above the RIFF size limit, not a selectable format
  (`src/common/editor/wav.js:275-277`); dither modes and channel
  mapping with per-output gain matrices are complete
  (`src/common/editor/media-export.js:277-329, 428-435`); export-time
  windowed-sinc resampling engages when rates differ
  (`src/common/editor/controller/rendered-audio-encoding.ts:126-134`);
  stems export per-track with streaming ZIP32/7z archives
  (`src/common/editor/export.js:252-288`).
- **Loudness is measured, never applied.** EBU R128 measurement is
  mature (`src/common/editor/ebu-r128.js`), BWF/BW64 exports can
  capture loudness into BEXT
  (`src/common/editor/controller/rendered-audio-encoding.ts:143-145`)
  — but `measureLoudness` has no UI, and no export-time normalization
  exists anywhere.
- **Video delivery is two formats at 720p30.** MP4/h264+aac and
  WebM/vp9+opus only (`src/common/editor/video-export.js:26-55`),
  encoded by single-threaded ffmpeg.wasm, default canvas ceiling
  1280×720@30 (`src/common/editor/video-export.js:21-23`), range
  restriction project/selection/loop
  (`src/common/editor/controller/video-export-service.ts:117`). No
  WebCodecs encode path and no JS muxer exist.
- **Captions are sidecar-only.** txt/srt/vtt/json plus Podcast 2.0
  chapters (`src/common/editor/label-io.js:1-2, 75-99, 357-370`); the
  encoder strips subtitle and data streams outright (`-sn`, `-dn`,
  `src/common/editor/video-ffmpeg.js:63-67`) — that exact line is what
  muxed captions change.
- **Interchange is Audacity plus `.scape`.** AUP/AUP4 both directions
  with a **versioned omission/conversion report already produced and
  retained** (`src/common/editor/aup4-profile.js:74-112`;
  `src/common/editor/controller/native-project-service.ts:220-240`) —
  but no UI renders it; `.scape` is deterministic, streaming, and
  digest-gated end-to-end
  (`src/common/editor/scape-export-plan.ts:92-300`), with byte-exact
  future-schema copy
  (`src/common/editor/scape-archive-copy.ts:37`). EDL, OTIO, FCPXML,
  and DAWproject exporters do not exist; the exporter rules milestone 3
  recorded for them are at docs/milestone-3-plan.md:434-464.
- **Jobs are one-at-a-time and unresumable.** A single foreground task
  with named-scope AbortSignal cancellation
  (`src/common/editor/controller/lifecycle.ts:150-187`;
  `src/common/editor/controller/export-service.ts:53-93`); no pause, no
  retry, no persistence; the abortable `render-job-port` interface
  exists unimplemented
  (`src/common/editor/platform/render-job-port.ts:9-22`); the
  restartable persistent queue is a milestone-5 deliverable (5B-3).
- **Relink exists; consolidate and trim-media do not.** The
  milestone-2 linked-media lifecycle is closed and must not be
  weakened (config/milestone-2-closure.json:236-256); digest
  infrastructure is ready for manifests
  (`src/common/editor/scape-archive-media.ts:314-322`).
- **No preset system exists.** The file-save purpose allowlist already
  reserves `'preset'` and `'report'`
  (`src/common/editor/file-service.js:168`); the flat export dialog
  a preset system must subsume is
  `src/common/editor/ui/inspector/ExportDialog.jsx:33-186`.
- **ADM is two modes with hard caps.** Authored beds are mono, stereo,
  and 5.1 only (`src/common/editor/adm-project-metadata.ts:14-22`);
  passthrough is a strict byte-preservation contract (neutral path,
  dither none, exact one full-source clip, chunk-sequence preservation,
  `src/common/editor/export.js:408-478`). No objects, no binaural.

## Known defect this plan absorbs first

The export-plan version pin has already drifted: the planner emits
`version: 5` (`src/common/editor/video-export.js:212`) and the direct
path requires exactly 5
(`src/common/editor/controller/direct-video-export.ts:315`), but the
quality-budget fixture pins `"planVersion": 4`
(config/quality-budgets.json:679), the narrative repeats "version-4
plans" (docs/quality-budgets.md:309-310), and a security test asserts
the stale 4 (tests/production-direct-video-security.test.js:161). This
is a live instance of the recorded "3B-2b trap" — the version is pinned
in more places than the planner (docs/milestone-7-plan.md:772-773).
WP-6.0.0 repairs the pins and adds a single-source-of-truth check
before any packet bumps the plan version again.

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
purpose (`src/common/editor/file-service.js:168`). The AUP4 report
finally gets its user-facing surface in the same stroke — produced and
stored today, rendered nowhere. `delivery.unreportedConversions eq 0`
is the machine gate over this model.

### Loudness normalization applies what measurement knows

Milestone 6 adds target-driven normalization (integrated loudness and
true-peak ceiling) as an explicit, reported delivery step over the
existing R128 meter, exposes `measureLoudness`, and records both
measured and post-normalization values in the report. The gates:
`delivery.integratedLoudnessErrorLu lte 0.2`,
`delivery.truePeakErrorDb lte 0.2`
(config/quality-budgets.json:1035-1036). The destructive
Audacity-parity loudness effect is unrelated and unchanged.

### Queue semantics are honest by construction

The web tier gets a bounded in-session delivery queue (ordered jobs,
pause between jobs, cancel, retry-from-failure) over the existing
abortable task discipline; the Electron tier binds the same queue
model to the milestone-5 restartable persistent queue (5B-3) through
`render-job-port`. Every backend/preset declares one of exactly two
recovery classes — **tested resume** or **atomic verified restart** —
and the label is evidence-bound per the exit gate (roadmap.md:658-659).
Jobs publish nothing partial: the milestone-2 direct-transport
invariants (select-before-render, seal-before-commit, no final Blob)
carry over unchanged.

### Presets are validated data over plans

A preset is a versioned, validated record declaring container, codec,
profile, color, audio layout, captions, metadata, **legal
availability**, and fallback behavior (roadmap.md:660-661) that
resolves to an export plan — it never carries its own encode path.
Platform presets whose codecs sit behind the milestone-5 licensing
gates (config/production-licensing-matrix.json:326-337) declare that
status explicitly and degrade to available codecs visibly. The preset
system subsumes the flat dialog settings; the milestone-7 vertical
lookahead explicitly built no presets (docs/milestone-7-plan.md:773-774)
— if 7B-5 landed, its vertical canvas/crop stage is absorbed here with
milestone 6 retaining acceptance ownership of canvas/aspect delivery.

### Captions deliver three ways

Sidecar (exists), **burned** (a caption render stage in the filter
plan over the milestone-4 styled caption schema), and **muxed** where
the container supports it (removing `-sn` for those plans,
`src/common/editor/video-ffmpeg.js:63-67`). Cue timing is gated at
`delivery.captionCueErrorFrames lte 1`
(config/quality-budgets.json:1037). Burn-in consumes milestone-4
caption styling; if only label tracks exist at pickup, burn-in scopes
to them explicitly rather than inventing styling here.

### The web encode tier is WebCodecs plus a reviewed muxer

For qualified SDR outputs, a WebCodecs encode path with a reviewed
muxer (Web Enhanced), falling back semantically to the FFmpeg path —
same plan, same golden checks (roadmap.md:648-649). The muxer is a new
reviewed dependency: licensing row, provenance manifest, and notices
land with it, and the choice (mp4/webm muxing library vs. first-party)
is the packet's named design decision. Encoder output is validated
against the same golden suite as the wasm path; WebCodecs
availability never changes what a plan *means*.

### Mastering sequences are a bounded new document type

Named regions with per-region metadata, order, gaps, and fades over the
existing region/label primitives — a serialized schema revision under
the standing registration duties, designed at pickup. Region-cue
interchange reuses the marker/RIFF mechanics where formats allow.

### Interchange lands against the recorded rules

EDL, OTIO, and FCPXML profiles implement the exporter rules milestone 3
already recorded (docs/milestone-3-plan.md:448-464): exact rational
rates as computed double quotients (never `29.97` literals),
pre-rounded values, one timebase per item, VFR tables in metadata
namespaces, tolerance-vs-exact equality split in conformance tests, and
AUP4 tempo flattening with an explicit compatibility item. Archive,
consolidate, and trim-media build on the closed relink lifecycle and
digest infrastructure, emitting checksum manifests; consolidation
never deletes external media (the milestone-2 lifecycle acceptance,
config/milestone-2-closure.json:236-256).

### Immersive extends without weakening passthrough

Object and binaural delivery are a reviewed addition (roadmap.md:
640-642): the authored bed cap (mono/stereo/5.1) may grow and object
metadata may be authored, but the passthrough contract — byte
preservation with a neutral path — stays intact and its refusal rules
stay refusals. The compatibility fence stands: new BW64 ADM
preservation-or-editing semantics are not silently qualified by the
existing portable exception (docs/project-compatibility.md:86-88).

### Rejected alternatives (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| A second export stack for presets/queues | Two stacks drift; the plan seam is the single semantic authority and the milestone-2 witnesses pin its transports. |
| "Resumable" as a UI label | The exit gate demands tested resume or atomic verified restart per backend/preset (roadmap.md:658-659); the label is evidence-bound. |
| A new conversion-report vocabulary | The AUP4 report model is proven, versioned, and already retained; delivery generalizes it. |
| Muxing captions by post-processing files | Caption mux rides the plan and its args; post-hoc file surgery breaks determinism and the digest discipline. |
| Loudness normalization inside the encoder | Normalization is a reported plan step with measured evidence, not an encoder flag; encoders vary, the report cannot. |
| Growing the codec set web-side for presets | Codec availability follows the milestone-5 licensing/patent gates; presets declare legal status, they do not create it. |
| Editing ADM passthrough output "slightly" | Passthrough is byte-preservation or it is nothing; any authored change routes through the authored mode's validation. |

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
five fields and decomposed into slice docs at pickup
(docs/milestone-3-plan.md:467-470).

### WP-6.0.0 — Plan-pin repair and the delivery-report model

- **Outcome:** the plan-version pins reconciled (fixture, narrative,
  security test) with a single-source-of-truth check so the next bump
  is one-constant; the delivery-report model implemented over the
  AUP4-report shape with the `'report'` save purpose; the AUP4
  compatibility report rendered to users; the
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

### 6A packets (Soundscaper delivery; slice docs at pickup)

- **6A-1 — Mastering sequences.** Outcome: the mastering-sequence
  document type (named regions, per-region metadata, order, gaps,
  fades, validation) with its serialized revision and atomic
  registration; region-aware delivery through the plan seam.
  Stop: stop if region semantics would fork the milestone-3A
  marker/region model instead of consuming it.
- **6A-2 — Normalization and reporting.** Outcome: loudness/true-peak
  normalization as a reported plan step; `measureLoudness` surfaced;
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
  checks of the exit gate (roadmap.md:662-663) automated on the
  reference suite.
- **6A-5 — Immersive delivery (reviewed).** Outcome: object/binaural
  delivery per the decision above, with the passthrough contract
  untouched and every new semantics registered and reported.
  Stop: stop if any change would relax a passthrough refusal.
- **6A-6 — Exit evidence.** The 6A surface against
  `m6-reference-master-delivery` (one-hour audio master,
  config/quality-budgets.json:806-817) recorded honestly on the named
  environments.

### 6B packets (Framescaper delivery; slice docs at pickup)

- **6B-1 — Canvas, aspect, and delivery options.** Outcome: canvas,
  rational frame rate, aspect, fit, background, quality, audio layout,
  caption selection, and range as validated plan/preset options —
  lifting the 1280×720@30 default ceiling deliberately
  (`src/common/editor/video-export.js:21-23`); absorbs the 7B-5
  vertical canvas/crop stage if milestone 7 landed it, retaining
  acceptance ownership here (docs/milestone-7-plan.md:769-772).
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
  formats, and platform delivery presets with explicit legal status —
  consuming the milestone-5 native media engine and its per-codec
  licensing rows. Stop: stop on any codec whose milestone-5 gates are
  not clear; the preset declares unavailability instead.
- **6B-5 — Exit evidence.** The 6B surface against the ten-minute
  video master and the render-time budgets
  (`delivery.webVideoRenderP95Rtf lte 12`,
  `delivery.audioRenderP95Rtf lte 1`,
  config/quality-budgets.json:1041-1042), recorded honestly.

### 6C packets (shared interchange; slice docs at pickup)

- **6C-1 — EDL, OTIO, and FCPXML profiles.** Outcome: exporters (and
  importers where the profile commits to them) under the recorded
  milestone-3 rules, each with a conformance suite and an itemized
  conversion report; profile scope (which features map, which report
  as omitted) closed in the slice doc. Stop: stop if any rate is
  emitted as a decimal literal or any value rounds downstream.
- **6C-2 — Archive, consolidate, trim-media, manifests.** Outcome:
  project archive with checksum manifests; consolidate and trim-media
  as explicit, reported, undoable-where-possible operations over the
  relink lifecycle; verification tooling reading the manifests back.
  Invariants: external media is never deleted; digest verification
  end-to-end. Stop: stop if trim-media cannot prove which bytes are
  unreferenced.
- **6C-3 — Exit evidence.** Cross-format round-trip fixtures and the
  `.scape` handoff preservation sentence of the exit gate
  (roadmap.md:664-665) witnessed.

## Quality-budget and evidence duties

- Workload `m6-reference-master-delivery` and fixture
  `m6-reference-master-suite-v1` (3600 s audio, 600 s 720p30 video)
  are registered with the eleven thresholds cited above
  (config/quality-budgets.json:806-817, 1026-1044) against
  `reference-linux-gpu-01` and `native-os-lab-matrix` — both
  unprovisioned today. The fixture's 720p spec predates the 6B-1
  canvas lift; a companion fixture entry (including 9:16) is a
  deliberate, reviewed budget change under the threshold-change rules
  (docs/quality-budgets.md:543-550), never a silent edit.
- Correctness and conformance suites run in ordinary CI; RTF and
  timing thresholds qualify only on provisioned environments, no-retry
  (docs/quality-budgets.md:102-104).
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

- **The plan-version pin drift** is repaired in WP-6.0.0 before any
  plan bump.
- **Milestone-5 dependencies:** the persistent queue (5B-3), the
  native media engine and codec licensing rows (5B-1/2, WP-5.0.2) gate
  6B-4 and the Electron queue binding; the web tier of every 6.0/6A
  packet works without them.
- **Milestone-4 dependencies:** styled captions gate 6B-2's styling
  scope; the mastering-sequence revision consumes the 3A marker/region
  model.
- **Loudness UI debt:** `measureLoudness` exists wire-side with no
  surface; 6A-2 closes it.
- **The AUP4 report has no UI** despite being produced and retained;
  WP-6.0.0 closes it.
- **Both qualification environments are unprovisioned**; development
  evidence proceeds, qualification rows stay honest
  (docs/quality-budgets.md:121-142).

## Watch items (not gates yet)

- WebCodecs encode maturity and per-browser codec coverage for the
  6B-3 tier.
- Muxer library candidates and their licensing posture (the 6B-3
  named decision).
- OTIO's rational-rate limitation (rates as doubles) — the recorded
  cautionary tale; watch upstream before committing importer scope.
- If milestone 7 shipped, assistance-derived exports (clip-maker
  outputs) become queue consumers; no coupling beyond ordinary jobs.

## Non-goals and fences

- No MIDI import/export of any kind (8B fence; roadmap.md:621-622).
- No cloud rendering, upload targets, or hosted delivery.
- No codec, muxer, or preset shipping ahead of its licensing/patent
  gates; legal availability is declared per preset, never implied.
- No weakening of the milestone-2 direct-transport invariants, the
  `.scape` digest discipline, or the linked-media lifecycle.
- No second export stack; plans remain the single semantic authority.
- Every new surface is menu-reached and off by default
  (AGENTS.md:8-11).
