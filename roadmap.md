# Soundscaper and Framescaper production roadmap

> Grounded against the repository on 2026-08-12. Milestones are ordered by
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
- milestone-2 scope, closure items, and exact qualification sets:
  [milestone-2 closure inventory](config/milestone-2-closure.json);
- milestone-3 sequencing, time-model decisions, and work packets:
  [milestone-3 plan](docs/milestone-3-plan.md);
- milestone-4 sequencing, automation/keyframe and mixer-graph decisions,
  and work packets: [milestone-4 plan](docs/milestone-4-plan.md);
- milestone-5 sequencing, helper-contract and plug-in/codec decisions,
  and work packets: [milestone-5 plan](docs/milestone-5-plan.md);
- milestone-6 sequencing, delivery-model and interchange decisions, and
  work packets: [milestone-6 plan](docs/milestone-6-plan.md);
- milestone-7 sequencing, runtime and model-catalog decisions, and work
  packets: [milestone-7 plan](docs/milestone-7-plan.md);
- milestone-9 sequencing, qualification-campaign decisions, and work
  packets: [milestone-9 plan](docs/milestone-9-plan.md);
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

Its eight lease workflows must pass for Soundscaper and Framescaper packages
on the qualified `windows-x64` and `linux-x64` desktop targets with
monotonically increasing fencing tokens and no losing writer publishing a
project or managed-media descriptor; the exact workflow IDs and acceptance
conditions are named in the inventory.

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

The foundation's browser and Node acceptance gates are green. The provisional
mark names the four packaged Electron rows in
`config/milestone-3-timing-probe-matrix.json`, which await the Linux and
Windows package runners and are not treated as passing evidence.

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
- **Shared / Web Core — Implemented:** schema-V17 take groups persist stable,
  ordered lane, take, and non-overlapping comp-region identities. Soundscaper's
  menu-reached workflow auditions and promotes takes, edits comp boundaries,
  and flattens explicitly as one reversible edit while retaining referenced
  sources. Exact cycle capture creates one ordered lane per loop pass, appends
  repeated recordings to the same exact group, isolates failed routed lanes,
  and settles project, media, raw-spool, and recovery-envelope ownership through
  generation-fenced publication. Explicit recover or discard is required after
  interruption; mutation stays blocked while that decision is pending. Focused
  domain, command, storage-fault, `.scape`, desktop-handoff, cross-product, and
  browser take-comp workflows cover the maintained surface.
- **Shared / Web Enhanced — Implemented:** digest- and algorithm-bound transient
  analysis uses bounded disposable cache storage, while strictly increasing
  audio warp maps share one exact evaluator across waveform projection,
  realtime scheduling, and export. Soundscaper reaches marker authoring,
  beat-aware quantization, and adjustable groove strength through its existing
  menus; deterministic commands preserve trims, splits, tempo edits, undo/redo,
  clipboard, and save/reopen meaning. Missing realtime acceleration selects the
  bounded exact-offline path instead of scalar stretch, including direct WAV
  output. `.scape`, desktop handoff, and browser workflows prove native
  Soundscaper editing and read-only Framescaper preservation.
- **Web Core — Implemented:** tempo-map-aware compound-meter count-in and exact
  one-transaction punch run through both default and routed capture, alongside
  sound-activated recording. Every approved milestone-3 Audacity action is
  menu-reached with concrete enablement and localization: clip and selection
  navigation, spectral selection and brush, boundary skips, structural
  alignment and sorting, bounded raw import, bulk selection and mute actions,
  repeat generator/analyzer, and regular-interval annotations. The audited
  milestone-3 manifest count is zero planned actions; Node and browser evidence
  covers recording, undo, menu reachability, and keyboard navigation.
- **Shared qualification — Implemented (provisional):** the local 3A-7 evidence
  harness deterministically builds the two-hour, 24-audio-track,
  two-proxy-video-track, 10,000-edit workload, measures decoded-media A/V clocks,
  seeking, scrolling, and retained heap, and admits results through a fail-closed
  collector. A packaged Electron timing-probe harness also exists. These are
  runnable evidence infrastructure, not accepted qualification: the fixed
  `reference-linux-gpu-01` host remains unprovisioned, the long-form workload is
  still provisional and absent from the qualified workload set, and all four
  Linux/Windows packaged Electron timing rows remain `pending-external`. WebKit
  remains deferred under milestone-2 scope revision 2.

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
  previous/next video edit-point navigation are implemented on the program
  playhead. Both are reachable through the existing Transport menu and the
  Framescaper workspace keys, shuttle positions stay on exact sequence-frame
  boundaries, and reverse uses descending scrub feedback without persisting
  reversed media. Framescaper now also exposes the existing exact timeline A/V
  Link/Unlink and video Show/Hide commands through its application menus, with
  undo/redo and reload persistence. The frame-canonical edge-trim planner
  (`024ad9b`) and its controller, existing-pointer, and application-menu
  integration (`8de72ca`) are implemented: video-bearing left/right trims share
  one absolute-boundary authority, keep linked audio aligned, and remain
  one-step undoable. Exact-current V15 track locks now persist across both
  products and desktop storage, centrally refuse direct or nested changes to
  protected editorial state, drive shared Tracks-menu Lock/Unlock, and make
  trim/navigation consume live lock facts. Frame-canonical roll and lane-ripple
  trim is implemented through `47a0be9`: one planner owns linked integer/NTSC
  geometry, lock-aware clamping, complete previews, and the atomic command used
  by the lazy menu and modified existing handles. Frame-canonical slip and slide
  are implemented through `c490af3b`: one verified-timing authority keeps linked
  A/V exact through lazy menu actions and modified whole-clip gestures, with
  persisted locks and one-step undo/redo. Uniform constant rate-stretch is
  implemented through `2bbfa06b`: one verified timing and rational duration
  authority keeps source ranges fixed while lazy menu actions and the existing
  video handles update linked A/V canonically and report the derived rate.
  Existing focused-clip trim and stretch keys now route exact linked A/V through
  those canonical authorities one adjacent sequence frame at a time, while
  Soundscaper retains its legacy behavior. Packet 3B-4 is complete and packet
  **3B-5 — Retiming, ramps, and nested sequences** is in progress. See
  [`docs/milestone-3b-shuttle-navigation.md`](docs/milestone-3b-shuttle-navigation.md),
  [`docs/milestone-3b-linked-audio-visibility.md`](docs/milestone-3b-linked-audio-visibility.md),
  [`docs/milestone-3b-frame-canonical-edge-trim-planner.md`](docs/milestone-3b-frame-canonical-edge-trim-planner.md),
  [`docs/milestone-3b-frame-canonical-edge-trim-integration.md`](docs/milestone-3b-frame-canonical-edge-trim-integration.md),
  [`docs/milestone-3b-track-locking.md`](docs/milestone-3b-track-locking.md),
  [`docs/milestone-3b-roll-ripple-trim.md`](docs/milestone-3b-roll-ripple-trim.md),
  [`docs/milestone-3b-slip-slide.md`](docs/milestone-3b-slip-slide.md),
  [`docs/milestone-3b-uniform-rate-stretch.md`](docs/milestone-3b-uniform-rate-stretch.md),
  and
  [`docs/milestone-3b-canonical-trim-keyboard.md`](docs/milestone-3b-canonical-trim-keyboard.md).
- **Shared / Web Core — In progress:** the exact schema-neutral retime curve
  algebra, [V16 persistence and preservation](docs/milestone-3b-video-retime-v16.md),
  [exact clip-bound runtime mapping](docs/milestone-3b-video-retime-runtime-mapping.md),
  [native retime dispatch](docs/milestone-3b-native-video-retime-workflow.md),
  and [dormant exact output cadence and isolated preview
  execution](docs/milestone-3b-video-retime-output-preview.md), plus the dormant
  backend-neutral intent in [3B-5g's split export
  contract](docs/milestone-3b-video-retime-export-plan.md), are implemented.
  The exact executor half, atomic maintained adoption, and capability flip are
  hard-stopped pending a reviewed exact backend or narrower-domain proof;
  maintained retime workflows, nested sequences, subsequence time mapping, and
  flattening remain later slices.
- **Web Core — In progress:** [dormant exact proxy timing
  conformance](docs/milestone-3b-video-proxy-timing-conformance.md) and the
  [exact proxy relationship proof](docs/milestone-3b-video-proxy-relationship.md)
  are implemented through `937e52bf`. The dormant 3B-6c-a1
  [current-target preparation material](docs/milestone-3b-video-proxy-v18.md)
  is implemented through `c195a8c1`: exact V17 relationship admission retains
  the already validated timing publication behind a private one-use WeakMap.
  The pure dormant
  [V18 attachment normalizer](docs/milestone-3b-video-proxy-attachment-normalization.md)
  is implemented through production `189e901f` and proof hardening `692fee74`
  on 2026-08-12. These Framescaper-only slices add no maintained proxy consumer,
  UI, schema/project owner, storage, preparation consumption, capability,
  Soundscaper change, or browser row. Shared V17 is already owned by take/comp
  state; c-a2 is folded into c-c, and durable storage/c-c remain hard-stopped on
  V18 product isolation. A standalone V17 proof lease cannot authenticate the
  future V18 settlement boundary. Body staging or adoption is not authorized;
  the next contract-first prerequisite is the dormant
  [opaque Framescaper V18 storage profile](docs/milestone-3b-framescaper-storage-profile.md),
  whose draft adds no production selector or persistence authority. Soundscaper
  product work is owned elsewhere. Adaptive preview,
  offline/relink, and synchronized multicamera groups follow the separately
  reviewed durable transition.

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

**Goal:** complete non-MIDI Soundscaper production and non-recording Framescaper
finishing over the stable editorial models.

Sequencing, the automation/keyframe and mixer-graph decisions, their
invariants, and the bounded work packets are owned by the
[milestone-4 plan](docs/milestone-4-plan.md).

### Soundscaper track

- **Shared / Web Core — Planned:** automation lanes for gain, pan, mute, sends,
  buses, plug-in parameters, and tempo-addressable values with line, hold, and
  curve interpolation.
- **Web Core — Planned:** read, trim, touch, latch, and write modes with safe
  playback ownership and deterministic history commits.
- **Shared / Web Core — Planned:** nested buses, multiple assignments,
  pre/post-fader sends, VCAs, cue/control-room mixes, output placeholders,
  sidechains, channel mapping, and cycle validation. Nested buses lift the
  milestone-3 single-layer folder rule so a track folder at any depth can own a
  bus, which also requires per-path plugin delay compensation instead of the
  present single-stage compensation.
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

Sequencing, the helper-contract and plug-in/codec decisions, their
invariants, and the bounded work packets are owned by the
[milestone-5 plan](docs/milestone-5-plan.md).

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

Sequencing, the delivery-model and interchange decisions, their
invariants, and the bounded work packets are owned by the
[milestone-6 plan](docs/milestone-6-plan.md).

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
The assistance helper process is milestone-7-owned scope whose protocol is
designed to converge with the future milestone-5 helper contract; milestone 5
remains the owning contract for the general helper architecture, and its exit
gate owns full qualification.

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
