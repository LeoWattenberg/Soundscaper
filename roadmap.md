# Soundscaper and Framescaper production roadmap

> Grounded against the repository on 2026-08-23. Milestones are ordered by dependency and close only when their exit gates pass. They are not release-date promises.

Soundscaper and Framescaper are two focused products over one local-first, mixed-media editor and one canonical `.scape` project format. The destination is an end-to-end professional workflow for recording, editing, mixing, picture editorial, finishing, and delivery on the web and in Electron. It is not parity with every specialist creative suite.

## How to use this roadmap

This file is a planning and sequencing document. It answers four questions:

1. What milestone owns the work?
2. What user or platform outcome is still missing?
3. What must be true before the milestone closes?
4. What is explicitly outside the current scope?

It is not an implementation log or an evidence register. Do not append exact fixture dimensions, byte-by-byte protocol narratives, cancellation timelines, test counts, or completed implementation history here. Put those details in the owning source of truth:

- security boundaries, controls, actors, and residual risks: [production threat model](docs/production-threat-model.md) and [security matrix](config/production-security-matrix.json);
- project preservation, fallback, and migration behavior: [project compatibility policy](docs/project-compatibility.md) and [compatibility matrix](config/project-compatibility.json);
- milestone-2 scope, closure items, and exact qualification sets: [milestone-2 closure inventory](config/milestone-2-closure.json);
- milestone-3 sequencing, time-model decisions, and work packets: [milestone-3 plan](docs/milestone-3-plan.md);
- milestone-4 sequencing, automation/keyframe and mixer-graph decisions, and work packets: [milestone-4 plan](docs/milestone-4-plan.md);
- milestone-5 sequencing, helper-contract, and work packets: [milestone-5 plan](docs/milestone-5-plan.md) and [5A plan](docs/milestone-5a-soundscaper-native.md);
- milestone-6 sequencing, delivery-model and interchange decisions, and work packets: [milestone-6 plan](docs/milestone-6-plan.md);
- milestone-7 sequencing, runtime and model-catalog decisions, and work packets: [milestone-7 plan](docs/milestone-7-plan.md);
- milestone-9 sequencing, qualification-campaign decisions, and work packets: [milestone-9 plan](docs/milestone-9-plan.md);
- performance fixtures and numeric qualification: [quality budgets](docs/quality-budgets.md) and [machine-readable budgets](config/quality-budgets.json);
- release severity and waiver rules: [release policy](docs/release-policy.md);
- licensing and provenance: [production licensing policy](docs/production-licensing-policy.md) and its machine-readable matrix;
- platform and product claims: [capability inventory](config/production-capabilities.json); and
- implementation evidence: owning modules, focused tests, browser workflows, and package smoke tests linked from those policies.

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
- For milestone 2, do not add a route, role, platform, fault class, or closure
  item without explicit user approval and a closure-inventory revision. New
  capabilities belong to milestone 3 or later.
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
milestone 8B Audacity design gate. The Framescaper Web VCR extension starts
only after milestone 8 closes; it may reuse milestone-8 capture contracts but
must not become an earlier hidden recording path.

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

## Current foundation

| Area | Current capability |
| --- | --- |
| Shared project core | Mixed-media schema, revisioned commands/history, autosave, locks, Project Bin, `.scape`, and web product handoff. |
| Storage | Chunked PCM, OPFS with IndexedDB fallback, retained originals, disposable derivatives, streaming media paths, and capacity preflight. |
| Soundscaper | Multitrack recording/editing, spectral and sample editing, buses/sends, effects/macros, analysis, surround/ADM, broad export, and Audacity interchange. |
| Framescaper | Linked A/V ingest, layered tracks, trim/split/stretch/ripple editing, crossfades, WebGL preview, video effects, and MP4/WebM render. |
| Electron | Hardened wrapper, dialogs, bounded reads, atomic saves, lifecycle handling, associations, packaged runtimes, and a shared current-schema project library. |
| Evidence | Node tests, cross-engine browser workflows, desktop smoke tests, architecture limits, output-size checks, and reproducibility audits. |

Known architectural constraints that drive later work:

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
| 3. Editorial foundations | **In progress — parallel tracks** | Add professional time, arrangement, and editorial models. |
| 4. Production surfaces | **In progress — local implementation complete; qualification open** | Complete automation, routing, compositing, captions, and finishing. |
| 5. Electron-native services | **In progress — 5A provisional, 5B substrate inert** | Add isolated native media, audio, render, and plug-in services. |
| 6. Delivery/interchange | **In progress — web tier implemented, none qualified** | Add professional masters, queues, exchange, and archives. |
| 7. Local assistance | **Optional** | Add removable on-device assistance without becoming a dependency. |
| 8. Capture and MIDI | **8A substrate implemented, dormant; 8B Blocked** | Framescaper recording code is retained as an unactivated historical substrate; selected-route activation and external qualification remain open, and MIDI waits for upstream design review. |
| 8+. Framescaper Web VCR | **Software substrate implemented — provisional, disabled** | Keep the dormant contracts, security seams, controller, crop pipeline, and UI behind `framescaperWebVcr: false` until post-milestone-8 runtime qualification. |
| 9. Final qualification | **Planned** | Requalify the complete product, including the accepted post-milestone-8 extension, and release matrix. |

Earlier milestones may ship independently. The complete roadmap does not close
until milestone 8, the Web VCR extension, and milestone 9 close. Milestone 7
may be skipped.

## 1. Baseline contracts and quality budgets

**Goal:** make every platform and quality claim reproducible before expanding
the shared schema or native boundary.

### Current state

Implemented contracts include the capability, compatibility, release, security,
licensing, Audacity-action, MIDI-fence, and Playwright matrices linked above.

On 2026-08-21 the owner designated the Windows x64 RTX 3090 machine as the
fixed-GPU reference; its zero-retry M1 preview, M4 production parity, and M4B-2
keyed parity passed their then-current diagnostics. The corrected packaged-
runtime fingerprint requires driver, device, power, and display identity that
the retained artifact does not contain. The historical result remains audit
evidence, but closes no current formal row: M1, M3 long-form, M4 production
parity, and M4B-2 are all `pending-external` until a fresh owner-host run.
Details live in `docs/quality-budgets.md`.

### Remaining work

1. Record the named milestone workloads, including Soundscaper M4 production
   render parity, on their required reference environments without software
   rendering or environment drift.
2. Resolve the provisional Safari and supported-OS qualification claims needed
   for the Web Core release guarantee.

These are qualification-environment tasks, not a reason for an agent without
that environment to keep expanding milestone-1 policy. In that case, proceed
to the actionable milestone-2 and milestone-3 priorities while leaving these
gates provisional.

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
- Current owner-host fixed-GPU qualification for M1, M3 long-form, M4
  production parity, and M4B-2 is recorded as accepted rather than
  `pending-external`.
- Required Safari qualification is recorded rather than provisional.

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
  shells and an explicit verified FFmpeg runtime cache with rollback. Safari
  qualification stays with the milestone-1 release gates; scope revision 2
  defers WebKit.
- **Shared — Implemented for current surfaces:** bounded retained-media writes,
  content digests, derivative-cache policy, cleanup fencing, storage-capacity UI,
  and safe project-publication admission.
- **Electron Enhanced — Implemented for project documents:** product-neutral
  current-schema project catalog, leases, atomic publication, recovery,
  reclamation, pathless IPC, and source-free packaged handoff.
- **Shared — Implemented for maintained compatibility slices:** feature-requirement
  reporting, read-only incompatible opens, opaque state preservation, audio/video
  effect bypass, role-defined audio whole-mix and full-project video fallback
  playback, the first-party clip-local `videoEffects` and track-local
  `audioEffects` fallbacks, and read-only affected-object visibility for any
  unavailable or unknown requirement.
- **Web Enhanced / Electron Enhanced — Implemented for direct PCM slices:**
  bounded direct WAV, AIFF, BWF, and admitted BW64 publication.

Security claims and exact limitations for these surfaces are owned by
`docs/production-threat-model.md`. Compatibility and fallback claims are owned
by `docs/project-compatibility.md`. Do not duplicate those narratives here.

### Frozen closure scope

Revision 2 of [the milestone-2 closure inventory](config/milestone-2-closure.json)
is the sole completion inventory for this milestone. Its gate IDs, item IDs,
routes, roles, platforms, workflows, and fault classes are finite. Unnamed work
cannot block closure. Changing that scope requires explicit user approval and a
`scopeRevision` increase; newly proposed capabilities belong to milestone 3 or
later. Revision 2 (2026-08-09, user-approved) defers WebKit and ARM64
validation and retires the deprecated `macos-x64` desktop target. WebKit
stays deferred because the pinned Playwright WebKit build exposes no OPFS,
no MediaRecorder, and no IndexedDB Blob storage; ARM64 stays deferred
because no ARM64 hardware is accessible. The qualified platform set is
Chromium and Firefox plus the `windows-x64` and `linux-x64` desktop
targets.

Implementation details and evidence belong in each item's `ownerRefs`. Agents
update an item's status only after its listed acceptance conditions pass.

### Open closure items, in priority order

- `m2-electron-lease-matrix`

The executable matrix runs seven product-specific workflows independently against
the Soundscaper desktop-library V10 and Framescaper desktop-library V18.
`cross-product-simultaneous-open` runs once across the paired packages.
Framescaper V18 owns schema 27, SQLite `user_version` 20 and scope `v18`; its
crash-resumable first open copies V12 to V17 when needed, then reimports exact
V20 documents into V27 without reopening, rewriting, or deleting either source:
V17 or V12. Each product holds a separate process-lifetime renewable fenced
lease with journal recovery, admission fencing, drain, and exact release.
Windows x64 and Linux x64 accepted packaged results remain absent, so the gate
is **Partial**.

The closed compatibility items fix the fallback role set at exactly
`project-audio-mix-v1`, `audio-track-render-v1`, `project-video-render-v1`,
and `video-clip-render-v1`. Unknown features without one of those roles stay
read-only and reported; milestone 2 does not require an invented bypass. The
`m2-compatibility-less-capable-roundtrip` and `m2-browser-durability-matrix`
workflow sets are qualified in Chromium and Firefox, with WebKit deferred by
scope revision 2.

### Explicitly deferred or outside milestone 2

- Migration from experimental/private legacy Electron libraries is
	**Deferred** unless a meaningful installed population requires it. Before the
	first release, older raw project schemas require source-media re-import;
	Audacity interchange remains supported and emits the current schema directly.
- Third-party plug-in discovery or activation, native codec/audio helpers,
  Framescaper capture, MIDI, and optional AI belong to later milestones.
- A documented residual risk that does not violate an exit gate remains in its
  owning policy; it does not automatically become milestone-2 scope.

### Exit gate

| Gate ID | State | Closure item IDs |
| --- | --- | --- |
| `m2-gate-mixed-media-handoff` | **Implemented** | `m2-handoff-packaged-roundtrip`, `m2-media-relationship-roundtrip`, `m2-linked-media-lifecycle`, `m2-managed-capacity-admission` |
| `m2-gate-bounded-pipelines` | **Implemented** | `m2-pipeline-route-qualification`, `m2-pipeline-resource-qualification`, `m2-opfs-worker-boundary` |
| `m2-gate-feature-compatibility` | **Implemented** | `m2-compatibility-affected-objects`, `m2-compatibility-bypass`, `m2-compatibility-fallback-roles`, `m2-compatibility-future-archive`, `m2-compatibility-less-capable-roundtrip` |
| `m2-gate-crash-safe-publication` | **Implemented** | `m2-publication-fault-matrix`, `m2-browser-durability-matrix` |
| `m2-gate-electron-concurrency` | **Partial** | `m2-electron-lease-matrix` |
| `m2-gate-cache-cleanup` | **Implemented** | `m2-cache-root-safety` |

Milestone 2 closes only when every inventory item and gate is **Implemented**.
Evidence updates its owning policy first; this roadmap changes only when scope,
priority, dependency, or status changes.

## 3. Parallel editorial foundations

**Builds on:** milestone 2 and a green canonical quality gate. Implementation
proceeds while milestone 2's last lease-matrix evidence stays open, but
milestone 3 cannot close first.

**Status:** **In progress.** The serialized 3.0 foundation is complete and is
the implementation baseline; the 3A and 3B product tracks run in parallel over
it.

**Goal:** establish professional time, arrangement, and editorial models before
adding broader production surfaces.

Sequencing, the shared time-model decision, its invariants, and the bounded
work packets are owned by [the milestone-3 plan](docs/milestone-3-plan.md).
Milestone 3 runs as one serialized foundation phase followed by two parallel
product tracks; the parallel tracks do not begin until the foundation's
acceptance checks pass.

### 3.0 Shared time and schema foundation (serialized, first)

- **Shared — Implemented:** a single exact rational time module owning every
  frames/seconds/beats/frame-rate conversion, with named rounding policies,
  reduced-rational overflow guards, and absolute-origin evaluation, which
  replaced the previously duplicated conversion and beat-math sites.
- **Shared — Implemented (provisional):** the foundation schema revision
  establishing the time-model core: rational-rate sequences with drop-frame
  and start timecode, frame-anchored video clip placement, source-domain
  in/out points with externally stored probed and VFR timing, a musically
  anchored tempo and signature map, per-coordinate time anchors, and unified
  warp/retime breakpoint maps. Derived time fields validate against their
  authoritative anchor and are rejected on mismatch, never silently repaired.
  Later product-track document types land as bounded, serialized follow-up
  revisions under the plan's pre-release schema policy (no retained
  migrations before the first release).
- **Shared — Implemented:** compatibility registration and a state-to-manifest
  completeness gate landed with the schema, so no milestone-3 feature can
  evaluate as unknown and silently force projects read-only, and no
  undeclared structure can persist without its feature requirement.
- **Shared — Implemented:** the parallel-work headroom refactors named in the
  plan.

The foundation's browser and Node gates are green. CI retains bounded timing
evidence for both selected product routes on Linux and Windows; all four matrix
rows remain `pending-external` until successful artifacts are reviewed and
revision-bound.

### Soundscaper track (3A, parallel after 3.0)

Packet boundaries, dependencies, and acceptance are owned by
[the 3A work packets](docs/milestone-3a-work-packets.md).

- **Shared / Web Core — Implemented:** musically anchored ordered tempo and
  signature maps resolved sample-accurately across snapping, metronome,
  rulers, stretch, selection, import, and export. Soundscaper edits the maps
  natively; Framescaper keeps the capability known but unavailable, so a
  musical document opens there read-only instead of degrading silently.
- **Shared / Web Core — Implemented:** first-class markers and named regions
  distinct from captions, including navigation, batch identity, and ripple
  behavior, under the same split availability.
- **Shared / Web Core — Implemented:** nested track folders with deterministic,
  undoable edit, visibility, mute/solo, height, and routing behavior, where a
  top-level timeline folder holding audio owns a group bus and deeper folders
  route to it. Bus nesting below that single layer stays milestone-4 work and
  is not approximated here.
- **Shared / Web Core — Implemented:** take groups introduced in V17 and
  retained by selected Soundscaper V23 persist stable,
  ordered lane, take, and non-overlapping comp-region identities. Soundscaper's
  menu-reached workflow auditions and promotes takes, edits comp boundaries,
  and flattens explicitly as one reversible edit while retaining referenced
  sources. Exact cycle capture creates one ordered lane per loop pass, appends
  repeated recordings to the same exact group, isolates failed routed lanes,
  and settles project, media, raw-spool, and recovery-envelope ownership through
  generation-fenced publication. Explicit recover or discard is required after
  interruption; mutation stays blocked while that decision is pending.
- **Shared / Web Enhanced — Implemented:** digest- and algorithm-bound transient
  analysis uses bounded disposable cache storage, while strictly increasing
  audio warp maps share one exact evaluator across waveform projection,
  realtime scheduling, and export. Soundscaper reaches marker authoring,
  beat-aware quantization, and adjustable groove strength through its existing
  menus; deterministic commands preserve trims, splits, tempo edits, undo/redo,
  clipboard, and save/reopen meaning. Missing realtime acceleration selects the
  bounded exact-offline path instead of scalar stretch, including direct WAV
  output. Framescaper preserves the result read-only.
- **Web Core — Implemented:** tempo-map-aware compound-meter count-in and exact
  one-transaction punch run through both default and routed capture, alongside
  sound-activated recording. Every approved milestone-3 Audacity action is
  menu-reached with concrete enablement and localization: clip and selection
  navigation, spectral selection and brush, boundary skips, structural
  alignment and sorting, bounded raw import, bulk selection and mute actions,
  repeat generator/analyzer, and regular-interval annotations. The audited
  milestone-3 manifest count is zero planned actions.
- **Shared qualification — Implemented (provisional):** 3A-7 builds the pinned
  two-hour, 24-audio-track, two-proxy-video-track, 10,000-edit workload and
  measures A/V clocks, seeking, scrolling, and retained heap against selected
  Soundscaper V23. `nightly-with-tests` runs it in the packaged product through
  the formal owner-host verifier. No fresh artifact exists for this profile and
  budget digest, so long-form qualification and all four timing rows remain
  `pending-external`. WebKit remains deferred under milestone-2 scope revision 2.

Soundscaper packets 3A-1 through 3A-6 are implemented, but packet 3A-7 and
milestone 3 remain **In progress** until the external results above exist,
milestone 2's partial Electron lease matrix closes, and the parallel Framescaper
track reaches its exit gate.

### Framescaper track (3B, parallel after 3.0)

Packet boundaries, dependencies, and acceptance are owned by
[the 3B work packets](docs/milestone-3b-work-packets.md).

- **Shared / Web Core — Implemented:** rational sequence rates independent of
  audio sample rate, including integer/NTSC rates, drop/non-drop SMPTE, source
  timecode, frame stepping/snapping, and explicit rounding.
- **Shared / Web Core — In progress:** probe and preserve exact frame/VFR timing,
  rotation, aspect, fields, alpha, codec, color, audio streams, and timecode.
  Ingest now persists every one of them as probed truth or as an explicitly
  unreported value, the workspace reads the source timecode and discloses what
  it records without acting on, and the preview and the export both present the
  source's display geometry — engine-independently, so a project exports the
  same frames wherever it was made. An already-imported source can be re-read
  from the bytes it already names: one undoable command replaces what an older
  or probe-less ingest concluded and conforms every edit cut against the frame
  grid it replaces. The packaged Electron probe-matrix rows remain.
- **Web Core — Implemented:** source/program monitors, source in/out, track
  targeting, insert, overwrite, replace, lift, extract, match-frame, and
  three-point edits. Three of the four points determine the fourth once, a lane
  can be targeted explicitly or inherited from the selection, and a Project Bin
  item inserts or overwrites into that lane as one undoable edit. A source now
  opens in its own monitor on its own frame grid, where marking a range decides
  what the next edit uses; match-frame answers which frame of which source is
  under the playhead and leaves the monitor holding that clip's material; and
  replace stands new media in for what is on air without moving it or changing
  its length. Four points that disagree are refused rather than fitted, because
  fitting one to the other is a speed change and retiming is not in this packet.
- **Web Core — Implemented:** session-only J/K/L shuttle and strict
  previous/next video edit-point navigation on the program playhead, reachable
  through the Transport menu and the Framescaper workspace keys, with shuttle
  positions on exact sequence-frame boundaries and reverse scrub that persists
  no reversed media. Framescaper also exposes the exact timeline A/V
  Link/Unlink and video Show/Hide commands through its application menus, with
  undo/redo and reload persistence. Frame-canonical edge, roll, lane-ripple,
  slip, slide, and uniform constant rate-stretch trims each route through one
  absolute-boundary or verified-timing authority that keeps linked A/V exact,
  clamps against exact-current V15 track locks — persisted across both products
  and desktop storage, refused centrally for direct and nested changes alike,
  and driven by a shared Tracks-menu Lock/Unlock — previews completely, and
  stays one-step undoable, whether reached from the lazy Tracks menu, the
  existing pointer handles, or the focused-clip keys; Soundscaper retains its
  legacy behavior. Packets 3B-4 and **3B-5 — Retiming, ramps, and nested
  sequences** are implemented locally; their remaining qualification evidence
  stays open and the slices are linked from
  [the 3B work packets](docs/milestone-3b-work-packets.md).
- **Shared / Web Core — Implementation complete; activation candidate pending
  guided-local sign-off; qualification open:** Selected V27
  forward-ports the maintained V20 nested-sequence and retime authority and
  exposes set/reset, constant, ramp, reverse, and freeze authoring through the
  existing Edit menu with one-step history. One exact ordinal authority drives maintained preview and browser export across integer, NTSC, CFR, verified VFR,
  reverse, freeze, ramps, nested compositions, and random seeks. Linked audio remains forward and unwarped (`audioWarp:false`). `videoRetime` is available
  only where that web-core consumer is registered; packaged Electron uses the embedded web-core path and does not claim milestone-5 native execution. See the
  [retime export plan](docs/milestone-3b-video-retime-export-plan.md).
- **Web Core — Implementation complete; activation candidate pending
  guided-local sign-off; qualification open:** Selected V27 retains
  V18 multicamera identity and completes the maintained editorial proxy
  lifecycle after retime: menu-reached generation, attach, detach, relink, regenerate, Original/Proxy/Auto selection, progress and cancellation,
  adaptive preview, offline editing, atomic cleanup, and original relink. A
  proxy frame is selected in the source domain before the occurrence retime is
  evaluated, so a conformant proxy never becomes timing authority. Delivery is
  still original-authoritative and visibly refuses if the original is
  unavailable. Soundscaper V23 preserves but does not interpret this private
  state.

The retired `m3-framescaper-v18-exit` workload is no longer an M3 gate. Local
implementation and route activation are complete only after the checked-in
guided sign-off; fixed-GPU, Safari, Windows, signing, and other external rows
remain independent qualification work and do not downgrade selected V27.

### Shared exit gate

- Every new document type has validation, clone, undo/redo, clipboard,
  `.scape`, future-schema, and cross-product preservation coverage, and
  older-schema documents fail with a typed re-import error under the
  pre-release schema policy.
- Audio remains sample-accurate through tempo changes and repeated save/reopen.
- Video remains frame-accurate across integer, NTSC, VFR, nested, proxy, and
  source-timecode fixtures without cumulative A/V drift.
- Video edits land on sequence frame boundaries through every edit primitive;
  no operation leaves a video cut off the frame grid.
- Signature changes stay on barlines through tempo edits; musically anchored
  material re-flows and absolutely anchored material does not move.
- Every rate conversion routes through the shared time module's named
  rounding policies and remains exact under composed nested-sequence and
  retime mappings.
- Every milestone-3 feature is registered in the capability and compatibility
  registers before it ships.
- Long-form sessions meet milestone-1 transport, seeking, scrolling, memory,
  and recovery budgets.
- Pointer, keyboard, screen-reader, and high-contrast workflows reach the same
  editorial outcomes.

## 4. Parallel production surfaces

**Depends on:** milestone 3.
**Status:** **In progress — Soundscaper V23 is implementation-complete; Framescaper V27 is the selected activation candidate for browser and desktop, pending guided-local sign-off; external qualification remains open.** V27 forward-ports maintained V20 retime/proxy and V24 visual lineage without inheriting dormant V25/V26 native-media or OpenFX authority. The historical RTX 3090 diagnostics remain audit evidence, but the corrected packaged-runtime fingerprint now requires driver, device, power, and display identity, so fixed-GPU profiles require a fresh owner-host run. Windows, Safari, signing, guided-manual, and whole-milestone qualification remain open.
**Goal:** complete non-MIDI Soundscaper production and non-recording Framescaper
finishing over the stable editorial models.

Sequencing, the automation/keyframe and mixer-graph decisions, their
invariants, and the bounded work packets are owned by the
[milestone-4 plan](docs/milestone-4-plan.md). The selected V23 route retains the
exact Soundscaper V21 packet contract in the
[milestone-4A pickup](docs/milestone-4a-soundscaper-production.md); sequencing
clearance does not close either track or milestone exit gate.

### Soundscaper track

- **Shared / Web Core — Implemented (provisional):** automation lanes for gain,
  pan, mute, sends, buses, plug-in parameters, and tempo-addressable values with
  line, hold, and curve interpolation.
- **Web Core — Implemented (provisional):** read, trim, touch, latch, and write
  modes with safe playback ownership and deterministic history commits.
- **Shared / Web Core — Implemented (provisional):** nested buses, multiple
  assignments, pre/post-fader sends, VCAs, cue/control-room mixes, output placeholders,
  sidechains, channel mapping, and cycle validation. Nested buses lift the
  milestone-3 single-layer folder rule so a track folder at any depth can own a
  bus; the selected V23 revision retains per-path
  plug-in delay compensation.
- **Web Core — Implemented (provisional):** plug-in delay compensation across
  playback, monitoring, automation, buses, sidechains, render, and freeze.
- **Shared / Web Core — Implemented (provisional):** freeze, unfreeze, commit,
  and rendered fallback without losing editable or native-effect state.
- **Web Core — Implemented (provisional):** restoration,
  phase/correlation/surround metering, loudness history, and scalable
  scheduling.
- **Web Core — Implemented (provisional):** constrained reviewed
  WebAssembly/AudioWorklet effect packages with declared resources and no
  arbitrary same-origin access. The built-in, release-pinned Utility Gain
  package ships; external packages, arbitrary URLs, and user trust overrides
  remain fenced.

### Framescaper track

- **Shared / Web Core — Implementation complete; activation candidate pending
  guided-local sign-off; qualification open:** V27 retains
  V19 transform/crop/compositing and V20 hold, linear, eased, and Bézier
  keyframes, then forward-ports V22 dissolve transitions and V24 stills, titles,
  text, shapes, solids, adjustment layers, presets, masks/mattes, and freeze
  frames. All authoring is reached through existing menus and commits through
  selected V27 history. One V13 exact render plan is shared by preview and
  browser delivery; unsupported work refuses instead of being omitted.
- **Web Core — Implementation complete; activation candidate pending guided-local
  sign-off; qualification open:** managed SDR grading
  uses a linear Rec.709 working space with deterministic sRGB/Rec.709 output.
  Unknown stills disclose sRGB/full-range assumptions and unknown video discloses BT.709 limited-range assumptions; operators can override those
  interpretations explicitly. Older reimported media remains visibly legacy
  unmanaged rather than receiving a silent managed-color claim.
- **Web Enhanced — Implementation complete with CPU parity; activation candidate
  pending guided-local sign-off; qualification open:**
  built-in deterministic feature tracking, similarity stabilization, and temporal denoise have WebGL2 acceleration with a CPU-equivalent fallback.
  Optical flow is admitted only as a stabilization/denoise motion provider and never as retime interpolation.
- **Web Core — Implementation complete; activation candidate pending guided-local
  sign-off; qualification open:** explicit caption
  tracks support strict SRT, WebVTT, and the bounded IMSC 1.1 subset. Caption
  burn-in and mux remain outside milestones 1–4 and are visibly unavailable.
- **Shared / Web Core — Implementation complete; activation candidate pending
  guided-local sign-off; qualification open:** Framescaper
  audio uses shared V21 automation, mixer routing, loudness targets, and render
  infrastructure. Its menu-reached dialogue chain is highpass → gate → EQ →
  compressor → limiter with optional profiled noise reduction after highpass.
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

**Status:** **In progress — 5A is provisionally local; bounded 5B source candidates exist and none is qualified.** Only `linux-x64` has a 5A payload; no 5B target has one. Licensing stays fail-closed, the lab is unprovisioned, and contract-v1 media/OFX jobs plus their data plane activate no native capability.

**Goal:** make Electron materially more capable without weakening the renderer
sandbox or creating a second editor engine.

The [milestone-5 plan](docs/milestone-5-plan.md) owns sequencing and the shared
contract; the [milestone-5A plan](docs/milestone-5a-soundscaper-native.md) and
[milestone-5B plan](docs/milestone-5b-framescaper-native-tier.md) own each
product's readiness, architecture, and acceptance.

### Native service architecture

- **Electron Enhanced — Implemented contract candidate, not qualified:** contract v1 has closed jobs/grants, cancellation, heartbeats, quarantine, progress, 64 KiB control and authenticated 16 MiB-chunk data planes; five-target execution remains open.
- **Electron Enhanced — In progress:** the real off-by-default probe enforces
  input, duration, concurrency, and RSS limits. Native payloads are now target-
  selected, digest-pinned, and re-verified at staging, pack time and every spawn
  across a real `utilityProcess`; helpers still cannot publish revisions.
- **Electron Only — In progress:** out-of-process scanning, descriptors, durable
  quarantine and isolated hosting, proven against a benign fixture format; VST3,
  CLAP, AU and LV2 stay fail-closed. Instruments never materialize before 8B.

### Soundscaper native tier

- **Electron Enhanced — In progress:** appropriate low-latency OS audio backends,
  with exclusive/shared modes, channel topology, recording destinations, monitoring
  metadata, latency calibration, underrun reporting, and Web Core fallback. The
  addon opens PipeWire and ALSA streams through an ordered candidate chain; JACK
  stays discovery-only, and no helper job reaches the open path yet.
- **Electron Only — Blocked on licensing:** VST3 and CLAP cross-platform, Audio
  Units on macOS, LV2 on Linux. The hosting machinery exists and is proven against
  a fixture format; each waits on its licensing row. Vendor UI gets no authority.
- **Blocked until milestone 8:** MIDI devices, MPE, instrument plug-ins, control
  surfaces, MIDI clock, and MTC.

### Framescaper native tier

- **Electron Enhanced — Source candidate, not activated:** V7–V12 envelopes, unified authority, exact retime, pool policy and a fully extracted-tree-authenticated FFmpeg 9.0.1 recipe exist. V7 has bounded CPU frame execution: renderer production emits one authenticated evaluated-RGBA frame pack plus optional float32 WAV; main durably stages, claims and reclaims those inputs, and the historical candidate carrier adapter encodes exact-timestamp H.264/AAC or VP9/Opus while rechecking source/output identity. V8 instead uses authenticated original-source authority and emits no RGBA carrier: an audio-bearing plan may stage one WAV, while silent V8 has no derived-input stage. Its closed admission captures detached static visual authority for residual presentation, render-description consistency and decomposition, layer order, effect/filter redundancy, delivery color, intervals and overlap opacity. That capture is not source decode, static-geometry execution or an output adapter. V8 mux, burn-in and sidecar captions refuse first with typed unsupported-caption-adapter; all other historical V20 V8 requests return the legacy-identified typed unsupported-selected-v20-static-adapter. The authenticated historical-V20 candidate operation self-test remains not ready, and a recipe-authenticated delivery codec set is also absent. V9–V12 receive closed semantic admission without serializing presentation ticks into canonical plans and cross renderer, sandbox preload and main queue with a required null derived-input stage, bypassing the legacy carrier repository. Their production queue/helper route resolves exact V12 timing bodies, preflights scratch, stages bodies sequentially, mints dedicated timing grants and authenticates exact VFR ordinals in the media host. The dormant V26 main path additionally resolves current-project SCTI bodies, stages ordered digest-bound MessagePort timing grants, and has the helper/native host authenticate VFR boundaries before comparing exact Retimer `SourceTime`. V9–V12 and V26 remain dormant; broader graph execution remains typed unsupported after authority and timing authentication, and shipped VFR/Retimer execution remains unavailable. All five payload rows remain pending-external.
- **Electron Enhanced — Dormant V25:** professional characteristics, compact
  image-sequence packs, proxy lifecycle and one pathless menu/CAS import exist.
  Closed recipes have no authenticated PNG, TIFF or OpenEXR evidence; codec,
  payload, signing and hardware rows remain blocked.
- **Electron Only — Controller candidate, not activated:** main-owned V2 services, pathless preload/image-sequence selection, digest-bound restart checkpoints, renderer-fed display and menu surfaces remain behind default-off capabilities and blocked native-lab evidence. Queue execution is constructed only with both project/source authority and a main-owned physical-capacity sampler; each pass closes current CPU, free-memory, scratch-volume, durable-reservation and hardware budgets before the lease-fenced repository writer-atomically claims queued rows. Without that capacity authority, render-queue and proxy capabilities remain unavailable.
- **Electron Only — Dormant V26:** fingerprint-bound state, isolated-host recipes, exact V12/Retimer grants, a verified two-executable selector, one-shot scanner utility processes and per-fingerprint runtime supervisors exist. Main owns current-project SCTI resolution and ordered digest-bound timing ports; the helper stages those bytes inside its reservation, and the native host authenticates VFR boundaries before comparing exact Retimer `SourceTime`. The owned conformance fixture transports bounded full RGBA planes with named inputs, padded rows and digest-verified output, and rasterizes offscreen events through the `kOfxImageEffectPluginPropOverlayInteractV2` property backed by Interact Suite V1 and DrawSuite V1. Its menu-only inventory/scan/enable/Add source route and verified future-payload stager are source-implemented and candidate-tested, but shipped activation remains unavailable because manifests are empty and no readiness, isolation, signing or target evidence exists. The interactive React event/compositing route and production-attested third-party execution remain absent; no shipped build loads a plug-in binary.
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

Sequencing, the delivery-model and interchange decisions, their
invariants, and the bounded work packets are owned by the
[milestone-6 plan](docs/milestone-6-plan.md).

### Soundscaper delivery

- **Blocked until milestone 8:** MIDI import/export remains outside this
  milestone.
- **Shared / Web Core — Implemented:** mastering sequences, named regions,
  per-region metadata, order, gaps, fades, and validation.
- **Web Core — Implemented:** queued mixes, selections, loops, regions, stems,
  alternates, loudness normalization, and format matrices with
  pause/cancel/retry.
- **Web Core — Implemented:** delivery reports, dither/channel mapping,
  BWF/RF64/BW64/ADM conformance, and AUP4 omission/conversion reporting;
  restoration provenance alone does not exist, as nothing produces one yet.
- **Electron Enhanced — Planned:** restartable background queues, direct
  streaming, reference-scale archives, and reviewed professional deliverables.
- **Shared — Implemented:** reviewed object/binaural immersive delivery — beds to
  7.1.4, objects, a named binaural model — without weakening ADM passthrough.

### Framescaper delivery

- **Web Core — Implemented:** canvas, fit, rational rate, background, quality
  tier, audio layout, captions, and range are validated plan, dialog, and preset
  options, and the export dialog's canvas is what the preview shows. The keyed
  path states two bounds of its own: it renders a hex background rather than
  FFmpeg's colour names, and it refuses a caption request instead of delivering
  one, because it stages no files and stream-copies its picture. Captions are
  label tracks until milestone 4 styles them.
- **Web Enhanced — Implemented; reachable through the keyed path:** a WebCodecs
  encode tier for qualified SDR outputs, containers written by the shipped
  FFmpeg, fallback reported per run. Only a delivery that renders its own frames
  can be handed encoded chunks, so a build mounting the V19 controller reports
  the composed-graph fallback for every delivery.
- **Electron Enhanced — Planned; substrate implemented:** nine delivery targets
  declare legal status and fallback behaviour; the three that ship declare their
  container, codec and canvas through the format they resolve to, and the six
  needing an uncleared row resolve to no plan, fall back, and report the blocker
  with the substitution.
- **Shared — In progress:** EDL, OTIO, and FCPXML profiles itemize conversions;
  consolidate, checksums, and lossless trim-media are done; relink is Planned.

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
The optional milestone-7 helper must conform to the milestone-5 helper contract
before packaged wiring; milestone 5 owns its architecture and qualification.

Sequencing, the runtime and model-catalog decisions, the assistance-lifecycle
invariants, and the bounded work packets are owned by the
[milestone-7 plan](docs/milestone-7-plan.md).

- **Electron Only — Optional:** on-device transcription, diarization, source
  separation, cleanup, semantic tags, shot/silence detection, beat
  suggestions, and assistive search/edit proposals. Re-tiered from Web
  Enhanced / Electron Enhanced by user decision on 2026-08-11: inference is
  native-only, and the web products read accepted results as ordinary
  project state.
- Models are opt-in, separately downloaded into a user-settable directory,
  digest-pinned, removable, licensed, and offline after installation.
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

**Status:** **Implementation complete as dormant historical substrate; not activated.** Selected Framescaper V27 sets `framescaperCapture: false`, passes no capture route authority to its controller, and exposes no Recording Setup menu, preference, panel, or ordinary toolbar action. Only an already-active or recovery-owned historical session retains narrow stop, release, and recovery reachability. Selected-route activation and external qualification remain open. The owning [implementation plan](docs/milestone-8a-plan.md) and [capture privacy contract](docs/framescaper-capture-privacy.md) record this boundary and the still-unprovisioned real-device matrix.

The following bullets describe retained historical schema-18, schema-19, and
schema-20 implementation, not a selected V27 product workflow.

**Goal:** record cameras, microphones, and displays into the same recoverable
media/project model used by imported sources.

#### Recording surface

- **Web Core — Implemented substrate (dormant):** a Recording Setup panel with explicit permission,
  preview, armed, recording, pause, finalization, recovery, and failure states.
- **Web Core — Implemented substrate (dormant):** permission-aware camera/microphone enumeration,
  previews, formats, meters, monitoring, countdown, drop/drift status, and destinations.
- **Web Enhanced — Implemented substrate (dormant):** fresh user-selected display/window/tab capture and
  system/tab audio only when capabilities prove it.
- **Shared — Implemented substrate (dormant):** camera, microphone, display, and system-audio
  combinations as distinct streams under one monotonic-clock capture session.
- **Shared — Implemented substrate (dormant):** per-packet timestamps and alignment/drift metadata
  without destructively resampling originals during capture.

#### Capture and persistence

- **Web Core — Implemented substrate (dormant):** runtime-selected supported recording formats and
  permission-gated `getUserMedia()`.
- **Web Enhanced — Implemented substrate (dormant):** capability-detected `getDisplayMedia()` with an
  honest camera/microphone fallback.
- **Web Core — Implemented substrate (dormant):** bounded fragments, atomic publication, closed
  creation inventory, durable append intents, ordered session-to-spool Web Locks,
  resumable tail/terminal cleanup, post-commit derivatives, and crash recovery.
  Each captured video schedules one proxy; audio schedules none; failures warn.
- **Electron Enhanced — Implemented substrate (dormant):** a validated, pathless OS-picker consent
  control plane and renderer-local path with explicit qualification limits.
- **Shared — Implemented substrate (dormant):** historically enable recording only on exact schema-19 web or
  schema-18 desktop when source, encoder/audio, Web Locks, durable repositories,
  probe, and canonical publication are ready; no partial Record control exists.
- **Web Core / Electron Enhanced — Implemented substrate (dormant):** change camera-denying policies and
  packaging permissions only with consent, indicators, teardown, embedded-route
  policy, and privacy tests.

#### Capture qualification exit gate (open)

The historical substrate implementation exit is complete. Selected-route
activation and real-device/external-runtime qualification remain open and
cannot be inferred from synthetic browser tests or packaged no-device smoke:

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

## 8+. Post-milestone-8 Framescaper Web VCR extension

**Status:** **Software substrate Implemented (provisional; disabled).** `framescaperWebVcr` remains `false`, so the normal production product exposes no Web VCR entry and creates no remote guest or capture grant. Milestone 8 and the applicable milestone-5B gates must close before activation; activation is also blocked on packaged and real-runtime capture, audio, encoder, security, lifecycle, and long-session qualification. Sequencing, decisions, and work packets are owned by the [Web VCR plan](docs/post-milestone-8-web-vcr-plan.md).

**Goal:** capture authorized HTTPS media through an isolated Framescaper desktop browser and the milestone-8A recoverable Project Bin/timeline workflow.

- **Dormant product surface — Implemented:** the integrated Framescaper-only Record-menu, default-hidden panel, controller, and desktop path is capability-gated. While the application feature is false, the UI is unreachable, the controller returns `unavailable` / `roadmap-gate` without a handshake, and the registered desktop boundary refuses guest/profile creation and capture grants.
- **Desktop security seams — Implemented:** focused modules specify a dedicated persistent sandboxed HTTPS profile with no remote preload/editor authority, bounded authentication popups, denied unrelated permissions/downloads, closed trusted-app DTOs, one-shot capture authority, and destructive data clearing.
- **Capture/controller seams — Implemented:** strict domain, target, aperture, normalized-crop, even-pixel encoder mapping, page-audio monitor, recorder, controller, and UI tests exercise the integrated dormant software contracts without qualifying an activated end-to-end packaged capture path.
- **Resolution baseline — Implemented in software only:** 720p and 1080p profiles exist in the software substrate, but make no platform claim. 4K is unavailable and must remain hidden until its independent runtime and encoder gates pass; viewport/DPI selection never promises a provider source resolution.
- **Qualification evidence — Provisional:** the deterministic loopback HTTPS fixture covers login cookies, popup, input, standard media, ended/loop, redirects, and shutdown. A Linux x64/Xvfb packaged feasibility smoke emits `qualification: false` after exact 720p and 1080p owned-guest video, page audio, visual-marker, security, clear-data, and teardown checks; both are evidence only, not qualification, and neither establishes the supported real-runtime matrix, performance, or platform support.
- **Shared capture contract — Integrated but dormant:** the controller adapts Web VCR display and page-audio input into milestone 8A's clock, fragments, metrics, recovery, managed publication, and Recording Setup destination. The false application gate prevents activation, and no parallel production recording path or runtime qualification is claimed.
- **Explicit non-goals:** DRM/EME/HDCP capture, anti-bot evasion, user-agent spoofing, provider-specific completion adapters, HTTP browsing, arbitrary downloads, generic remote CDP, and raw-frame ffmpeg.wasm IPC.

### Exit gate

- Only after the activation gates close may the feature become reachable from Framescaper desktop's Record dropdown; remote-content security, privacy, ownership, failure, background, quit, and cleanup paths must pass maintained packaged-runtime review and tests.
- Every enabled tier must meet milestone 8A's long-session sync, drop, teardown, and recovery budgets plus exact-surface, encoder-crop, and cropped-only retention gates; unqualified 4K stays unavailable.
- A real packaged workflow must prove that resulting media follows the same reopen, relink, proxy, edit, `.scape`, handoff, and delivery paths as other Framescaper recordings without persisting browser state.

## 9. Final convergence and qualification

**Depends on:** milestones 1–6, both milestone-8 sub-phases, and every accepted Web VCR platform tier above.

**Goal:** qualify the complete products as coherent systems.

Sequencing, the qualification-campaign decisions, and the bounded work
packets are owned by the [milestone-9 plan](docs/milestone-9-plan.md).

- **Shared — Planned:** every migration retained from the first shipped release
	through current save/reopen, plus future-schema read-only and opaque-state
	round trips.
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
- Capture contracts are designed only in milestone 8A; after milestone 8, Web VCR may register one capture-source adapter but no new clock, persistence model, generic remote IPC, or project schema. MIDI contracts are designed only after milestone 8B's upstream review gate.
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
| Framescaper Web VCR | Record-dropdown-only availability, isolated persistent HTTPS browsing, target/manual crop, local-mute independence, background capture, quit recovery, capability-gated resolution, cropped-only retention, and normal recorded-media handoff. |
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
