# Soundscaper and Framescaper production roadmap

> Grounded against the repository on 2026-08-01. Milestones are ordered by
> dependency and close only when their exit gates pass. They are not release-date
> promises.

Soundscaper and Framescaper are two focused products over one local-first,
mixed-media editor and one canonical `.scape` project format. The destination is
an end-to-end professional workflow for recording, editing, mixing, picture
editorial, finishing, and delivery on the web and in Electron. It is not parity
with every specialist creative suite.

## How to use this roadmap

This file is a planning and sequencing document. It answers four questions:

1. What milestone owns the work?
2. What user or platform outcome is still missing?
3. What must be true before the milestone closes?
4. What is explicitly outside the current scope?

It is not an implementation log or an evidence register. Do not append exact
fixture dimensions, byte-by-byte protocol narratives, cancellation timelines,
test counts, or completed implementation history here. Put those details in the
owning source of truth:

- security boundaries, controls, actors, and residual risks:
  [production threat model](docs/production-threat-model.md) and
  [security matrix](config/production-security-matrix.json);
- project preservation, fallback, and migration behavior:
  [project compatibility policy](docs/project-compatibility.md) and
  [compatibility matrix](config/project-compatibility.json);
- performance fixtures and numeric qualification:
  [quality budgets](docs/quality-budgets.md) and
  [machine-readable budgets](config/quality-budgets.json);
- release severity and waiver rules: [release policy](docs/release-policy.md);
- licensing and provenance:
  [production licensing policy](docs/production-licensing-policy.md) and its
  machine-readable matrix;
- platform and product claims:
  [capability inventory](config/production-capabilities.json); and
- implementation evidence: owning modules, focused tests, browser workflows,
  and package smoke tests linked from those policies.

### Agent operating rules

- Work on the earliest incomplete prerequisite whose next step is actionable in
  the available repository and environment, unless the user explicitly chooses
  another milestone. Do not invent substitute work for a named external
  qualification blocker.
- Every change must name one roadmap outcome or exit-gate gap that it advances.
  State non-goals before expanding an owning schema or platform boundary.
- Prefer a complete vertical slice and an observable acceptance test over a new
  abstraction that no maintained workflow consumes.
- Preserve the product invariants below. Implementation structure may change as
  long as those contracts and the owning acceptance gate remain intact.
- A newly discovered issue expands the active milestone only when it is a
  credible data-loss or security-boundary failure, an irreversible schema/API
  mistake, or a violation of an existing exit gate. Otherwise record it in the
  owning policy's residual-risk backlog.
- Do not turn a residual risk into an implicit milestone requirement. Change an
  exit gate deliberately if product scope genuinely changes.
- Update this roadmap only when scope, priority, status, dependency, or an exit
  gate changes. Updating detailed evidence alone belongs in the owning policy.
- A status becomes **Implemented** only with maintained-product behavior and the
  relevant automated gate. Active work alone is **In progress**.
- Do not weaken resource, browser, coverage, reproducibility, licensing, or
  notice gates to make a milestone appear complete.

## Product boundaries and invariants

- Editing remains local-first, usable without an account, and offline after the
  application and optional runtime assets have been installed or cached.
- `.scape` is the lossless cross-product project format. AUP4 is audio-only
  Audacity interchange, not a Soundscaper backup format.
- Web and Electron share the project domain, commands, migrations, and as much
  UI as practical. Native services remain behind narrow adapters and do not fork
  the canonical project model.
- Unsupported native effects, routes, and codecs remain visible and round-trip
  as opaque state. A freeze, bounce, proxy, or rendered fallback provides the
  usable cross-platform result when required.
- Electron retains a sandboxed renderer, disabled Node integration, validated
  IPC, CSP, fuse hardening, and capability-scoped filesystem access.
- Large codec and model runtimes stay outside the Cloudflare Pages bundle.
  Preserve the 25 MiB Pages asset ceiling, 500,000-byte JavaScript chunk ceiling,
  pinned hashes, corresponding-source archives, and notices.
- Accessibility, deterministic history, bounded working sets, interruption
  recovery, and migration safety are release requirements.

The following are not completion requirements:

- mandatory cloud accounts, hosted collaboration, or hosted AI;
- score engraving or notation-suite parity;
- live-performance clip launching;
- deep node compositing, a 3D suite, or live-broadcast switching;
- capture-card, SDI, deck-control, or AAX support; or
- proprietary codecs or plug-ins that have not passed licensing and patent
  review.

## Deferred-capability fences

Through milestones 1–7:

- `export-midi`, `midi-device-info`, and `local://midi-track` remain disabled,
  excluded, and inert;
- add no MIDI schema, ports, capability flags, dependencies, imports, exports,
  UI placeholders, event input, instruments, or device enumeration; and
- add no Framescaper recording capability, command, schema, adapter, IPC,
  permission expansion, or UI. Existing Soundscaper microphone and desktop
  recording may be maintained.

Framescaper capture starts only in milestone 8A. MIDI starts only after the
milestone 8B Audacity design gate.

## Status and platform notation

| Status | Meaning |
| --- | --- |
| **Implemented** | Maintained behavior exists and its acceptance gate passes. |
| **Implemented (provisional)** | Behavior exists, but a named platform or qualification gate remains. |
| **In progress** | Maintained work exists, but its outcome or gate is incomplete. |
| **Planned** | Accepted future scope whose prerequisites are incomplete. |
| **Blocked** | Accepted scope waits on a named external decision or dependency. |
| **Deferred** | Deliberately outside the current completion target. |
| **Optional** | Valuable work that does not block full product functionality. |

| Platform | Contract |
| --- | --- |
| **Shared** | Canonical domain, schema, command, or UI used by both products and platforms. |
| **Web Core** | Works on the supported evergreen Chromium, Firefox, and Safari matrix without a limited-availability API. Electron inherits it. |
| **Web Enhanced** | Capability-detected web acceleration with a documented Web Core fallback. |
| **Electron Enhanced** | Same outcome as web with improved scale, latency, codec coverage, or reliability through a native adapter. |
| **Electron Only** | Requires an OS/native facility unavailable to a normal web origin; projects still open safely on web. |

Playwright Chromium, Firefox, and WebKit coverage is maintained, but Safari and
fixed-GPU qualification remain separate release gates.

## Current foundation

The following baseline exists and should not be re-planned:

| Area | Current capability |
| --- | --- |
| Shared project core | Mixed-media schema, revisioned commands/history, autosave, locks, Project Bin, `.scape`, and web product handoff. |
| Storage | Chunked PCM, OPFS with IndexedDB fallback, retained originals, disposable derivatives, streaming media paths, and capacity preflight. |
| Soundscaper | Multitrack recording/editing, spectral and sample editing, buses/sends, effects/macros, analysis, surround/ADM, broad export, and Audacity interchange. |
| Framescaper | Linked A/V ingest, layered tracks, trim/split/stretch/ripple editing, crossfades, WebGL preview, video effects, and MP4/WebM render. |
| Electron | Hardened wrapper, dialogs, bounded reads, atomic saves, lifecycle handling, associations, packaged runtimes, and a shared current-schema project library. |
| Evidence | Node tests, cross-engine browser workflows, desktop smoke tests, architecture limits, output-size checks, and reproducibility audits. |

Known architectural constraints that drive later work:

- video still lacks a rational sequence timebase and exact probed source timing;
- browser video decode and automatic export remain limited in resolution,
  frame rate, codec coverage, and long-form scale;
- browser storage remains quota- and eviction-bound;
- Electron has explicit managed handoff for canonical PCM and retained original
  video, but not a complete cross-product managed-media library;
- no native codec worker, audio backend, plug-in host, or background job service
  exists; and
- Safari, fixed-GPU, whole-process memory, and broad OS/architecture evidence
  remain incomplete.

## Milestone sequence

| Milestone | Status | Purpose |
| --- | --- | --- |
| 1. Baseline contracts | **In progress — external qualification** | Close reproducible quality qualification. |
| 2. Shared platform/storage/media | **In progress — current priority** | Finish safe scale, handoff, media ownership, and compatibility foundations. |
| 3. Editorial foundations | **Planned** | Add professional time, arrangement, and editorial models. |
| 4. Production surfaces | **Planned** | Complete automation, routing, compositing, captions, and finishing. |
| 5. Electron-native services | **Planned** | Add isolated native media, audio, render, and plug-in services. |
| 6. Delivery/interchange | **Planned** | Add professional masters, queues, exchange, and archives. |
| 7. Local assistance | **Optional** | Add removable on-device assistance without becoming a dependency. |
| 8. Capture and MIDI | **Blocked/Planned** | Add Framescaper recording, then MIDI after upstream design review. |
| 9. Final qualification | **Planned** | Requalify the complete product and release matrix. |

Earlier milestones may ship independently. The complete roadmap does not close
until milestones 8 and 9 close. Milestone 7 may be skipped.

## 1. Baseline contracts and quality budgets

**Goal:** make every platform and quality claim reproducible before expanding
the shared schema or native boundary.

### Current state

Implemented contracts include the capability inventory, project compatibility,
release severity, security matrix, licensing matrix, Audacity action
dispositions, MIDI fences, and the maintained Playwright engine matrix. Their
evidence lives in the owning policies linked above.

### Remaining work

1. Provision the fixed-GPU qualification host defined by
   `config/quality-budgets.json`.
2. Record the named milestone workloads without software rendering or
   environment drift.
3. Resolve the provisional Safari and supported-OS qualification claims needed
   for the Web Core release guarantee.

These are qualification-environment tasks, not a reason for an agent without
that environment to keep expanding milestone-1 policy. In that case, proceed to
the actionable milestone-2 priorities while leaving these gates provisional.

Do not add new milestone-1 documentation frameworks. Extend the existing
machine-readable inventories only when a later milestone introduces a genuinely
new platform, distribution, schema, or security boundary.

### Exit gate

- All capability, compatibility, security, licensing, browser, and OS matrices
  remain versioned and linked.
- Later milestones have named fixtures and machine-readable thresholds.
- Current fixtures run repeatably in CI or a documented reproducible benchmark
  job.
- Every Audacity action remains implemented, planned, blocked, or justified
  excluded.
- Required fixed-GPU and Safari qualification is recorded rather than
  provisional.

## 2. Shared platform, storage, and media foundation

**Builds on:** milestone 1. Implementation may proceed while milestone 1's named
external qualifications remain provisional, but milestone 2 cannot close first.

**Status:** **In progress — current priority.**

**Goal:** make large, capability-varying projects safe and usable across both
products before adding new editorial models or native engines.

### Completed foundation

- **Shared — Implemented:** immutable runtime capability snapshots and narrow,
  abortable platform ports.
- **Shared — Implemented:** milestone-8 capture and MIDI contract fences.
- **Web Enhanced / Electron Enhanced — Implemented:** streamed `.scape` saves;
  bounded archive validation; transactional import; and desktop range-based
  `.scape` opening without a final renderer-sized archive `Blob`.
- **Web Core — Implemented (provisional):** installable verified application
  shells and an explicit verified FFmpeg runtime cache with rollback. Remaining
  browser/device qualification belongs to the closeout work below.
- **Shared — Implemented for current surfaces:** bounded retained-media writes,
  content digests, derivative-cache policy, cleanup fencing, storage-capacity UI,
  and safe project-publication admission.
- **Electron Enhanced — Implemented for project documents:** product-neutral
  current-schema project catalog, leases, atomic publication, recovery,
  reclamation, pathless IPC, and source-free packaged handoff.
- **Shared — Implemented for maintained compatibility slices:** feature-requirement
  reporting, read-only incompatible opens, opaque state preservation, audio/video
  effect bypass, role-defined audio whole-mix and full-project video fallback
  playback, and the first-party clip-local `videoEffects` fallback.
- **Web Enhanced / Electron Enhanced — Implemented for direct PCM slices:**
  bounded direct WAV, AIFF, BWF, and admitted BW64 publication. Other render
  families remain below.

Security claims and exact limitations for these surfaces are owned by
`docs/production-threat-model.md`. Compatibility and fallback claims are owned
by `docs/project-compatibility.md`. Do not duplicate those narratives here.

### Remaining work, in priority order

#### 2.1 Cross-product media ownership and handoff — highest priority

- **Electron Enhanced — Implemented for explicit managed canonical PCM and
  retained original video:** ordinary saves remain document-only; explicit
  handoff supports fresh-recipient acquisition and exact same-content rebinding
  on return.
- **Shared / Electron Enhanced — Implemented for point-in-time linked retained
  video:** an exact product-local binding supports exact-revision,
  digest-verified owner-scoped range playback for the maintained visual
  lifecycle without another whole-original `Blob`, a fresh descriptor-free
  shared load without an owned-media copy, and explicit managed handoff.
- **Electron Enhanced / Shared — Implemented for bounded linked PCM:** admitted
  WAV, classic AIFF, and canonical first-party AIFF-C float32 stay unowned and
  pathless; exact-revision range reads avoid another whole-original `Blob`,
  while portable `.scape` and managed handoff acquire canonical PCM.
- **Shared / Electron Enhanced — Implemented for the closed audio whole-mix
  fallback role:** unavailable or unknown canonical feature identities reach
  portable `.scape` playback, explicit managed handoff to a fresh recipient,
  and maintained final-mix delivery. Canonical state remains read-only and
  unprojected.
- **Shared / Electron Enhanced — Implemented for the closed full-project video
  role and one clip-local first-party `videoEffects` relationship:** unavailable
  or unknown canonical feature identities qualify only for the full-project
  role. Both exact-schema relationships reach portable `.scape`, managed
  handoff, playback, and maintained delivery without canonical mutation. Other
  roles and packaged/browser qualification remain open.
- **Electron Enhanced — Implemented for point-in-time managed-media publication
  admission:** absent bindings reserve prospective catalog rows, serialized
  metadata, and aggregate pending body bytes, then reject failed, malformed, or
  known-insufficient destination capacity before body or hard-link work.
  Exact-present retries remain available at capacity after body reverification.
- **Electron Enhanced — Implemented for managed-media ownership and bounded
  startup reclamation:** schema-3 canonical and stage inventories bind exact
  descriptor provenance, state, lease, and fencing tokens before body or
  optional hard-link work; catalog publication requires materialized inventory
  and marks it published atomically. Startup retires stale tracked catalog rows
  and reclaims only registered regular stages and bodies through lease-fenced,
  persisted bounded passes. Unmanaged, unregistered, legacy, symlinked,
  non-regular, and foreign content stays untouched. The compiled desktop
  runtime includes this path; packaged source-bearing UI qualification remains
  open.
- **Electron Enhanced / Shared — Implemented for the bounded first-party linked
  retained-video import slice:** the capability-gated Project Bin chooser keeps
  filesystem paths in main-private product-local locator state and passes only
  opaque snapshot identity plus materialized video into shared import. Import
  verifies the selected content, publishes its exact local binding before the
  canonical source commit, skips an owned original-video copy, and retains
  canonical extracted audio plus binding-scoped disposable previews.
  Pre-commit failures roll back import-owned state.
- **Electron Enhanced / Shared — Implemented for bounded cooperative startup
  locator reconciliation:** after persistent IndexedDB opens and before project
  loading, the maintained renderer reads an authoritative point-in-time catalog
  of at most 10,000 exact project/revision summaries. One atomic transaction
  validates at most 100,000 closed binding rows, deletes catalog-absent bindings
  and source-unreachable bindings only from bounded catalog-revision-matched
  exact-schema-9 current and retained graphs, preserves unverifiable local
  graphs and any surviving locator alias, and submits at most 128 exact
  locator/revision references. Durable-unavailable storage sends nothing and
  invalid catalog or binding scans reject before IPC. Main performs at most one
  successful serialized pass per store/process, retiring only absent
  startup-loaded metadata while retaining referenced and current-process
  records; external media is never inspected or deleted. Cleanup beyond this
  bounded startup pass and the one-live-store maintained
  save/activation/delete/clear lifecycle, cross-store/process coordination,
  hostile-renderer inventory authority, abrupt-crash/power-loss durability, and
  packaged/OS qualification remain open.
- **Electron Enhanced / Shared — Implemented:** revision- and live-history-aware
  same-store saves and successful writable activations retire source-unreachable
  linked-original bindings; exact locator retirement after saves, activations,
  project deletion, and clear preserves live aliases and external files.
- **Shared / Electron Enhanced — Implemented:** same-store project duplication
  preserves reachable linked-original bindings without copying external media.
- **Electron Enhanced — In progress:** broaden the concrete platform locator
  beyond the bounded linked-PCM and retained-video slices, and
  finish broader linked and unmanaged-original lifecycles, exact or write-time
  capacity behavior, stable playback identity beyond the maintained linked-PCM
  and retained-video lifecycles,
  linked-locator cleanup beyond this bounded startup pass and the one-live-store
  maintained save/activation/delete/clear lifecycle,
  cross-store/process coordination where required,
  and packaged
  UI/OS/browser-codec qualification.
- **Shared — Implemented for disposable previews:** poster and thumbnail cache
  records bind a trusted retained-original digest or exact linked binding and a
  versioned recipe while staying outside project history, portable archive
  media, and managed media transfer. They are not editorial proxies.
- **Shared — In progress:** extend role-defined rendered-fallback acquisition,
  activation, and delivery beyond the audio whole-mix and full-project video
  roles plus the clip-local `videoEffects` relationship.
- **Headless Electron path — Implemented:** a positive mixed-media Soundscaper ↔
  Framescaper round trip proves fresh activation, playback, edits, save, return,
  exact media, and retained histories; narrower one-way fixtures prove the
  role-defined audio and full-project video fallbacks plus the maintained
  first-party clip-local video fallback each reach a fresh recipient from a
  manifest-only reference and activate their exact managed body.
  Packaged UI and browser-codec qualification remain open.

This is the main architectural blocker for closing milestone 2. Do not spend the
next work cycle deepening already-qualified source-free handoff unless it fixes a
release-blocking defect in its owning policy.

#### 2.2 Remaining bounded pipelines

- **Web Enhanced / Electron Enhanced — In progress:** direct native-PCM ZIP and
  7z stems, canonical compressed ZIP stems (realtime and centrally admitted
  offline), canonical realtime compressed mixes, centrally admitted offline
  native-PCM and compressed mixes, and MP4/WebM output avoid final output
  `Blob`s; scale qualification and other final-delivery paths remain.
- **Web Enhanced — Planned:** move hot OPFS access to dedicated workers and use
  synchronous access handles only after capability detection; retain IndexedDB
  as the correctness fallback.
- Close the named end-to-end memory and concurrency gaps in the quality budget:
  proxy generation, autosave/revision publication, render/codec workers,
  browser/renderer/main-process RSS, concurrent writers, and quota behavior.
- Qualify current direct paths on the required browser, OS, architecture, and
  failure matrix. Admission ceilings alone are not reference-scale evidence.

#### 2.3 Compatibility completion

- **Shared — In progress:** provide generic affected-object visibility and
  bypass behavior beyond the maintained first-party audio/video slices.
- Extend required rendered-fallback runtime use beyond the role-defined audio
  whole-mix and full-project video roles plus the maintained first-party
  clip-local video-effects relationship.
- Preserve and re-export arbitrary future-schema `.scape` archives without
  interpreting unknown state.
- Verify that a project opened on a less-capable platform subsequently
  round-trips without losing editable or opaque native state.

#### 2.4 Durability and qualification closeout

- Complete crash, renderer-loss, helper-loss, quota-failure, and power-loss
  fixtures for every maintained publication path.
- Qualify simultaneous opens and lease transfer through packaged Soundscaper and
  Framescaper processes on the supported platform matrix.
- Finish real durable OPFS/IndexedDB, storage-pressure, multi-tab, and offline
  upgrade/rollback workflows required by the quality and compatibility policies.

### Explicitly deferred or outside milestone 2

- Migration from experimental/private legacy Electron libraries is
  **Deferred** unless a meaningful installed population requires it. Retained
  raw project-schema migrations and Audacity interchange remain supported.
- Third-party plug-in discovery or activation, native codec/audio helpers,
  Framescaper capture, MIDI, and optional AI belong to later milestones.
- A documented residual risk that does not violate an exit gate remains in its
  owning policy; it does not automatically become milestone-2 scope.

### Exit gate

| Gate | State | Required closure |
| --- | --- | --- |
| Bounded import, autosave, proxy, render, and save pipelines | **Partial** | Named Web Core fallbacks complete below their limits or refuse before unsafe work; enhanced/native direct-file fixtures meet their memory budgets. |
| Crash-safe publication | **Partial** | Killing a renderer/helper during every write path leaves the previous commit or a recoverable journal, never a half-published project. |
| Mixed-media cross-product handoff | **Partial** | Both web and packaged Electron UI products use the same project and media without losing history or accidental copies; remaining media relationships are stable. |
| Shared Electron concurrency | **Partial** | Packaged simultaneous opens, lease transfer, recovery, conflict, and supported-platform fixtures pass. |
| Cache cleanup safety | **Implemented** | Cleanup removes only reproducible derivatives, never originals, canonical PCM, or the last recoverable revision. |
| Unavailable-feature compatibility | **Partial** | Actionable report, usable fallback/bypass behavior, and faithful subsequent `.scape` round trip work for the required generic surface. |

Milestone 2 closes only when every row is **Implemented**. New evidence should
update the owning policy first; update this table only when a row's state or
required closure changes.

## 3. Parallel editorial foundations

**Depends on:** milestone 2.

**Goal:** establish professional time, arrangement, and editorial models before
adding broader production surfaces.

### Soundscaper track

- **Shared / Web Core — Planned:** ordered tempo and signature maps with
  sample-accurate positions across snapping, metronome, rulers, stretch,
  selection, import, export, and migration.
- **Shared / Web Core — Planned:** first-class markers and named regions distinct
  from captions, including navigation, batch identity, and ripple behavior.
- **Shared / Web Core — Planned:** nested track folders with deterministic,
  undoable edit, visibility, mute/solo, height, and routing behavior.
- **Shared / Web Core — Planned:** take lanes, cycle-recorded takes, audition,
  promotion, comp regions, flattening, and interrupted-take recovery.
- **Shared / Web Enhanced — Planned:** transient analysis, warp markers,
  beat-aware stretch, audio quantization, and groove strength with an exact
  offline fallback.
- **Web Core — Planned:** complete punch/count-in and approved Audacity gaps,
  including sound-activated recording, clip-boundary navigation, alignment,
  sorting, spectral selection/brush, and repeat-generator/analyzer workflows.

### Framescaper track

- **Shared / Web Core — Planned:** rational sequence rates independent of audio
  sample rate, including integer/NTSC rates, drop/non-drop SMPTE, source
  timecode, frame stepping/snapping, and explicit rounding.
- **Shared / Web Core — Planned:** probe and preserve exact frame/VFR timing,
  rotation, aspect, fields, alpha, codec, color, audio streams, and timecode.
- **Web Core — Planned:** source/program monitors, source in/out, track targeting,
  insert, overwrite, replace, lift, extract, match-frame, and three-point edits.
- **Web Core — Planned:** J/K/L shuttle, edit-point navigation,
  roll/ripple/slip/slide/rate-stretch tools, track lock, visibility, linked-audio
  controls, and keyboard-complete trim feedback.
- **Shared / Web Core — Planned:** explicit retiming and speed ramps,
  reverse/freeze frames, nested sequences, subsequence time mapping, and
  deterministic flattening.
- **Web Core — Planned:** proxy attachment, adaptive preview, offline/relink, and
  synchronized multicamera groups.

### Shared exit gate

- Every new document type has validation, migration, clone, undo/redo,
  clipboard, `.scape`, future-schema, and cross-product preservation coverage.
- Audio remains sample-accurate through tempo changes and repeated save/reopen.
- Video remains frame-accurate across integer, NTSC, VFR, nested, proxy, and
  source-timecode fixtures without cumulative A/V drift.
- Long-form sessions meet milestone-1 transport, seeking, scrolling, memory,
  and recovery budgets.
- Pointer, keyboard, screen-reader, and high-contrast workflows reach the same
  editorial outcomes.

## 4. Parallel production surfaces

**Depends on:** milestone 3.

**Goal:** complete non-MIDI Soundscaper production and non-recording Framescaper
finishing over the stable editorial models.

### Soundscaper track

- **Shared / Web Core — Planned:** automation lanes for gain, pan, mute, sends,
  buses, plug-in parameters, and tempo-addressable values with line, hold, and
  curve interpolation.
- **Web Core — Planned:** read, trim, touch, latch, and write modes with safe
  playback ownership and deterministic history commits.
- **Shared / Web Core — Planned:** nested buses, multiple assignments,
  pre/post-fader sends, VCAs, cue/control-room mixes, output placeholders,
  sidechains, channel mapping, and cycle validation.
- **Web Core — Planned:** plug-in delay compensation across playback,
  monitoring, automation, buses, sidechains, render, and freeze.
- **Shared / Web Core — Planned:** freeze, unfreeze, commit, and rendered
  fallback without losing editable or native-effect state.
- **Web Core — Planned:** restoration, phase/correlation/surround metering,
  loudness history, and scalable scheduling.
- **Web Core — Planned:** constrained reviewed WebAssembly/AudioWorklet effect
  packages with declared resources and no arbitrary same-origin access.

### Framescaper track

- **Shared / Web Core — Planned:** transform, crop, opacity, blend, flip, and
  compositing-order controls.
- **Shared / Web Core — Planned:** keyframes with hold, linear, eased, and Bézier
  interpolation plus copy/paste/preset semantics.
- **Shared / Web Core — Planned:** explicit transition objects and a migrated,
  extensible transition registry.
- **Web Core — Planned:** masks, mattes, titles, text, shapes, solids, stills,
  generators, adjustment layers, presets, and a selection-aware inspector.
- **Web Enhanced — Planned:** LUTs, grading, scopes, tracking, stabilization,
  denoise, and optical flow with deterministic software/proxy fallbacks.
- **Web Core — Planned:** styled caption tracks with regions, speakers,
  safe-area preview, sidecar interchange, and later burn-in/mux delivery.
- **Web Core — Planned:** audio clip gain/fades, automation, buses, dialogue
  cleanup, selected effects, loudness targets, and mix export.
- **Blocked until milestone 8:** no Framescaper camera, microphone, display, or
  voiceover recording surface.

### Exit gate

- Automation, routing, freeze, compositing, keyframes, transitions, captions,
  and color state survive all edit primitives and cross-platform round trips.
- Preview and final render match deterministic audio vectors and calibrated
  video frames.
- Unsupported GPU operations visibly fall back without mutating project state
  or silently omitting export work.
- Framescaper can edit, mix, caption, grade, and export a complete imported-media
  programme without Soundscaper.
- MIDI and Framescaper capture have not been introduced early.

## 5. Electron-native services and extensibility

**Depends on:** milestones 2–4. Research may begin after milestone 2, but product
integration waits for the owning shared contract.

**Goal:** make Electron materially more capable without weakening the renderer
sandbox or creating a second editor engine.

### Native service architecture

- **Electron Enhanced — Planned:** versioned media, audio-device, render, and
  plug-in helper processes with authenticated bounded IPC, explicit capabilities,
  cancellation, heartbeats, and structured progress/errors.
- **Electron Enhanced — Planned:** per-job CPU, memory, file, duration,
  child-process, and network policy; helper failure cannot corrupt the last
  project revision.
- **Electron Only — Planned:** out-of-process effect plug-in scanning,
  descriptors, quarantine, and isolated hosting. Instrument-class exposure
  remains blocked until milestone 8B.

### Soundscaper native tier

- **Electron Enhanced — Planned:** appropriate low-latency OS audio backends,
  with exclusive/shared modes, channel topology, recording destinations,
  monitoring metadata, latency calibration, underrun reporting, and Web Core
  fallback.
- **Electron Only — Planned:** VST3 and CLAP cross-platform, Audio Units on
  macOS, and LV2 on Linux, subject to licensing and packaging gates. Vendor UI
  receives no direct renderer authority.
- **Blocked until milestone 8:** MIDI devices, MPE, instrument plug-ins, control
  surfaces, MIDI clock, and MTC.

### Framescaper native tier

- **Electron Enhanced — Planned:** native ffprobe and multithreaded FFmpeg,
  hardware decode/encode, bounded intermediates, and shared render-plan parity.
- **Electron Enhanced — Planned:** long-GOP/high-resolution decode, background
  proxies, 10-bit/HDR, color metadata, image sequences, alpha masters, and
  distributable mezzanine formats.
- **Electron Only — Planned:** persistent parallel queues, external reference
  output, watch folders, managed scratch/cache volumes, and isolated OFX.
- **Blocked until milestone 8:** no new Framescaper capture IPC, permissions,
  entitlements, or UI.

### Exit gate

- Helpers pass malformed-input, IPC-fuzz, timeout, memory-pressure,
  cancellation, renderer-restart, and crash suites.
- Native and web paths implement the same semantic render plans.
- Missing, crashed, or quarantined plug-ins preserve state and offer bypass or
  frozen playback.
- Applicable Windows, macOS, and Linux x64/ARM64 packaging, signing,
  notarization, licensing, and source audits pass.
- Disabling native helpers leaves a usable Web Core editor and clear capability
  report.

## 6. Professional delivery and interchange

**Depends on:** milestones 4 and 5.

**Goal:** produce reproducible masters, exchanges, archives, and batches without
hidden conversions.

### Soundscaper delivery

- **Blocked until milestone 8:** MIDI import/export remains outside this
  milestone.
- **Shared / Web Core — Planned:** mastering sequences, named regions,
  per-region metadata, order, gaps, fades, and validation.
- **Web Core — Planned:** queued mixes, selections, loops, regions, stems,
  alternates, loudness normalization, and format matrices with
  pause/cancel/retry.
- **Web Core — Planned:** delivery reports, dither/channel mapping, restoration
  provenance, BWF/RF64/BW64/ADM conformance, and AUP4 omission/conversion
  reporting.
- **Electron Enhanced — Planned:** restartable background queues, direct
  streaming, reference-scale archives, and reviewed professional deliverables.
- **Shared — Planned:** reviewed object/binaural immersive delivery without
  weakening current ADM passthrough.

### Framescaper delivery

- **Web Core — Planned:** canvas, rational frame rate, aspect, fit, background,
  quality, audio layout, captions, range, and validated presets.
- **Web Core — Planned:** sidecar, burned, and supported muxed captions.
- **Web Enhanced — Planned:** WebCodecs plus a reviewed muxer for qualified SDR
  outputs, with FFmpeg/proxy semantic fallback.
- **Electron Enhanced — Planned:** 4K/HDR, 10-bit, hardware, image sequence,
  alpha, mezzanine, and platform delivery presets with explicit legal status.
- **Shared — Planned:** EDL, OTIO, and FCPXML profiles plus archive,
  consolidate, trim-media, relink, and checksum manifests.

### Shared exit gate

- Jobs are deterministic and cancellable and publish no partial output.
- Each backend/preset offers tested resume or an atomic verified restart; it is
  never labeled resumable otherwise.
- Presets declare container, codec, profile, color, audio, caption, metadata,
  legal availability, and fallback behavior.
- Masters pass reopen, duration, sync, channel, loudness, frame-count, caption,
  metadata, and golden-output checks.
- `.scape` handoff preserves editable state, native placeholders, and fallbacks.
- Exchange reports itemize every conversion or omission.

## 7. Optional local assistance

**Depends on:** milestone 2. **Optional:** never blocks milestones 8 or 9.

- **Web Enhanced / Electron Enhanced — Optional:** on-device transcription,
  diarization, source separation, cleanup, semantic tags, shot/silence detection,
  beat suggestions, and assistive search/edit proposals.
- Models are opt-in, separately downloaded, digest-pinned, removable, licensed,
  and offline after installation.
- Before milestone 8A, assistance consumes only imported or persisted media and
  cannot create a hidden recording path.
- Selected media and results remain on-device. Accepted results become ordinary,
  inspectable commands or derived assets.
- Deterministic non-AI editing and delivery remain complete without this
  milestone.

## 8. Final deferred capability milestone

**Depends on:** milestones 1–6. Capture is sub-phase 8A; MIDI is the final
product sub-phase 8B.

### 8A. Framescaper recording setup

**Goal:** record cameras, microphones, and displays into the same recoverable
media/project model used by imported sources.

#### Recording surface

- **Web Core — Planned:** a Recording Setup panel with explicit permission,
  preview, armed, recording, pause, finalization, recovery, and failure states.
- **Web Core — Planned:** permission-aware camera/microphone enumeration,
  previews, formats, meters, monitoring, countdown, controls, dropped-frame and
  drift status, and Project Bin/timeline destinations.
- **Web Enhanced — Planned:** fresh user-selected display/window/tab capture and
  system/tab audio only when capabilities prove it.
- **Shared — Planned:** camera, microphone, display, and system-audio
  combinations as distinct streams under one capture session and monotonic
  clock.
- **Shared — Planned:** per-packet timestamps and alignment/drift metadata
  without destructively resampling originals during capture.

#### Capture and persistence

- **Web Core — Planned:** runtime-selected supported recording formats and
  permission-gated `getUserMedia()`.
- **Web Enhanced — Planned:** capability-detected `getDisplayMedia()` with an
  honest camera/microphone fallback.
- **Web Core — Planned:** bounded incremental fragments, atomic publication,
  asynchronous derivatives, and reload/crash recovery of finalized or incomplete
  takes.
- **Electron Enhanced — Planned:** validated OS pickers and native capture where
  needed, with entitlement/privacy declarations and explicit limitations.
- **Shared — Planned:** enable Framescaper recording commands only when the
  complete setup is ready; there is no partially active record button.
- **Web Core / Electron Enhanced — Planned:** change camera-denying policies and
  packaging permissions only with consent, indicators, teardown, embedded-route
  policy, and privacy tests.

#### Capture exit gate

- Every denial, revocation, device loss, source end, throttling, disk/encoder
  failure, reload, helper crash, and quit reaches a defined recoverable state and
  releases devices.
- Audio/video remain within the milestone-1 drift budget over the long fixture;
  dropped/dead sources and capability loss are reported.
- No device opens without direct user action and visible state; display
  permission is requested anew when required.
- Browser/OS source availability is truthful, accessible, and tested, including
  unsupported states.
- Recorded media follows the same relink, proxy, edit, `.scape`, handoff, and
  delivery paths as imported media.

### 8B. MIDI, strictly after Audacity design review

**Status:** **Blocked** until Audacity publishes a reviewable MIDI design.

No MIDI schema, event type, track type, port, piano roll, instrument, import,
export, or native bridge starts until:

1. the relevant Audacity design and source revision are public and pinned;
2. its project model, events, editor UX, tempo interaction, routing, plug-in
   delivery, and AUP4 form are reviewable;
3. a written compatibility decision maps it to `.scape` and records deliberate
   divergences; and
4. migration and opaque-preservation plans are approved before allocating a
   schema version.

Record the transition **Blocked** → **upstream design pinned** → **compatibility
design approved** → **implementation**. A prototype does not skip a state.

After the entry gate:

- **Shared / Web Core — Planned:** reviewed MIDI project, track, clip/event,
  selection, history, clipboard, tempo, quantization, and interchange semantics.
- **Web Core — Planned:** accessible Audacity-aligned event editing,
  velocity/controllers, navigation, and bounce/freeze.
- **Web Enhanced — Planned:** permission-aware Web MIDI with a complete
  file/editor fallback.
- **Shared / Web Core — Planned:** a focused reviewed built-in instrument and
  sampler only after event/timing stability.
- **Electron Only — Planned:** native MIDI, MPE where supported, instruments,
  control surfaces, MIDI clock, and MTC through isolated services.
- **Shared — Planned:** visible missing-instrument/device placeholders with
  frozen audio and preserved editable state.

#### MIDI exit gate

- The pinned-design compatibility matrix has no unresolved model question.
- Audacity/AUP4 and `.scape` fixtures preserve representable state and report
  conversions.
- Audio and MIDI meet the timing budget through playback, record, tempo, loops,
  freeze, export, and reopen.
- Web without Web MIDI remains a complete file-based editor; Electron adds
  devices and instruments without forking the project model.

If the upstream design remains unavailable, milestone 8B remains **Blocked**.
Earlier milestones may ship, but the roadmap may not claim the full DAW goal or
invent an interim Soundscaper-only design.

## 9. Final convergence and qualification

**Depends on:** milestones 1–6 and both milestone-8 sub-phases.

**Goal:** qualify the complete products as coherent systems.

- **Shared — Planned:** every retained migration through current save/reopen,
  plus future-schema read-only and opaque-state round trips.
- **Web Core — Planned:** current and previous supported Chromium, Firefox, and
  Safari releases, including every fallback.
- **Electron Enhanced — Planned:** supported Windows, macOS, and Linux x64/ARM64
  packages, helpers, crash, upgrade/downgrade, signing, notarization, and
  uninstall preservation.
- **Shared — Planned:** keyboard, screen reader, zoom/reflow, contrast, motion,
  localization, RTL, and WCAG 2.2 AA review for every critical workflow.
- **Shared — Planned:** long-session audio, video, capture, MIDI, autosave,
  handoff, proxy, plug-in, and render-queue soaks under resource pressure.
- **Shared — Planned:** local exportable diagnostics without telemetry or media
  content, plus recovery, compatibility, migration, keyboard, codec, plug-in,
  and backup documentation.

### Exit gate

- No open data-loss, corruption, security-boundary, accessibility-blocker,
  unreported-conversion, or unexplained A/V-sync defect remains in the required
  matrix.
- Benchmark evidence shows bounded memory and stable timing over every pinned
  long-session fixture.
- A representative project moves between either web product and either Electron
  product, returns with fallbacks, and renders without losing editable state.
- Release artifacts pass notices, hashes, provenance, codec/plug-in licensing,
  package smoke, signatures, and update/recovery gates.

## Interface and schema commitments

- `PlatformCapabilities` remains immutable, runtime-derived, test-injectable,
  and distinguishes API presence from initialized adapters.
- Streaming media, codec, render, device, and effect-host ports remain abortable,
  bounded, progress-reporting, and React-independent.
- Electron IPC remains versioned and least-privilege; binary streams use bounded
  transfer rather than unbounded invoke payloads.
- Project evolution covers rational video time, tempo maps, markers, takes,
  automation/keyframes, sequences, media links, native-effect state, feature
  requirements, and rendered fallbacks.
- Capture contracts are designed only in milestone 8A. MIDI contracts are
  designed only after milestone 8B's upstream review gate.
- Every schema addition defines validation, migration, future-version behavior,
  clone/serialization, commands/history, `.scape`, AUP4 disposition where
  relevant, and retention/deletion behavior.

## Acceptance matrix

| Scenario | Required evidence |
| --- | --- |
| Cross-product handoff | Same project identity and usable media across web and Electron products; explicit locks; no silent conversion. |
| Portable project | Deterministic `.scape`, streaming save/open, digest validation, compatibility report, and opaque-state round trip. |
| Interrupted mutation | Abort/kill/reload at persistence boundaries; previous revision remains valid and staging is recoverable or collectible. |
| Audio correctness | Sample-accurate vectors, routing/automation/PDC/freeze parity, underrun metrics, and bounded long-session memory. |
| Video correctness | Frame/timecode/VFR fixtures, preview/export parity, proxy equivalence, caption/color metadata, drift, and dropped-frame metrics. |
| Native isolation | Malformed IPC/media/plug-ins, timeout, crash, quarantine, restart, permission revocation, and Web Core fallback. |
| Framescaper capture | Permissions, supported source combinations, long-recording sync, device loss, recovery, and normal media handoff. |
| MIDI | Tests derived from pinned Audacity design: migration, timing, fallback, instruments, accessibility, `.scape`, and AUP4. |
| Accessibility | Keyboard and assistive-technology completion at supported zoom, contrast, locale, and direction. |
| Distribution | Browser and desktop matrices, licenses, notices, hashes, signatures, and package smoke. |

## Platform feasibility references

Revalidate platform assumptions when the owning milestone starts:

- [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
- [Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
- [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
- [File System Access](https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker)
- [Camera and microphone capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [Display capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [Web MIDI](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API)
- [Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules/)
- [Electron utility processes](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron desktop capture](https://www.electronjs.org/docs/latest/api/desktop-capturer/)

## Maintaining this roadmap

- Keep it forward-looking. Remove completed implementation detail once the
  status and owning evidence source are clear.
- Preserve heading anchors referenced by machine-readable policy files.
- Change status only with maintained behavior and its acceptance gate, or with a
  named external blocker.
- Before implementation, decompose a new milestone item into a bounded work
  packet with outcome, invariants, acceptance, non-goals, and stop condition.
- Promote a platform tier only when the supported matrix proves the stronger
  contract.
- Keep MIDI blocked until the Audacity entry gate and Framescaper recording in
  milestone 8A.
