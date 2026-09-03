# Soundscaper and Framescaper production roadmap

> Grounded against the repository on 2026-08-29. Milestones are ordered by dependency and close only when their exit gates pass. They are not release-date promises.

Soundscaper and Framescaper are two focused products over one local-first, mixed-media editor and one canonical Scape project format. The destination is an end-to-end professional workflow for recording, editing, mixing, picture editorial, finishing, and delivery on the web and in Electron. It is not parity with every specialist creative suite.

## How to use this roadmap

This file is a planning and sequencing document. It answers four questions:

1. What milestone owns the work?
2. What user or platform outcome is still missing?
3. What must be true before the milestone closes?
4. What is explicitly outside the current scope?

It is not an implementation log or an evidence register. Do not append exact fixture dimensions, byte-by-byte protocol narratives, cancellation timelines, test counts, or completed implementation history here. Put those details in the owning source of truth:

- security boundaries, controls, actors, and residual risks: [production threat model](docs/production-threat-model.md) and [security matrix](config/production-security-matrix.json);
- project preservation, fallback, and migration behavior: [project compatibility policy](docs/project-compatibility.md) and [compatibility matrix](config/project-compatibility.json);
- milestone-2 scope, closure items, and exact verification sets: [milestone-2 closure inventory](config/milestone-2-closure.json);
- milestone-3 sequencing, time-model decisions, and work packets: [milestone-3 plan](docs/milestone-3-plan.md);
- milestone-4 sequencing, automation/keyframe and mixer-graph decisions, and work packets: [milestone-4 plan](docs/milestone-4-plan.md);
- milestone-5 sequencing, helper-contract, and work packets: [milestone-5 plan](docs/milestone-5-plan.md) and [5A plan](docs/milestone-5a-soundscaper-native.md);
- milestone-6 sequencing, delivery-model and interchange decisions, and work packets: [milestone-6 plan](docs/milestone-6-plan.md);
- milestone-7 sequencing, runtime and model-catalog decisions, and work packets: [milestone-7 plan](docs/milestone-7-plan.md);
- historical milestone-9 campaign design: [milestone-9 plan](docs/milestone-9-plan.md), retained for architectural provenance rather than current release authority;
- performance fixtures, correctness thresholds, and observational diagnostics: [quality budgets](docs/quality-budgets.md) and [machine-readable budgets](config/quality-budgets.json);
- optional human checks: the evergreen [Soundscaper](docs/qa/soundscaper.md) and [Framescaper](docs/qa/framescaper.md) owner-QA templates;
- the owner-run release rule: [release policy](docs/release-policy.md);
- licensing and provenance: [production licensing policy](docs/production-licensing-policy.md) and its machine-readable matrix;
- platform and product claims: [capability inventory](config/production-capabilities.json); and
- implementation evidence: owning modules, focused tests, browser workflows, and package smoke tests linked from those policies.

### Agent operating rules

- Work on the earliest incomplete prerequisite whose next step is actionable in
  the available repository and environment, unless the user explicitly chooses
  another milestone. Missing machine inputs should report their exact technical
  reason, not hide an implemented test surface.
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
- Scape is the lossless cross-product project format. Each product writes its
  own suffix — Soundscaper `.sscape`, Framescaper `.fscape`, a future
  Lightscaper `.liscape` — and every product opens all of them plus the
  legacy `.scape`, because the archive behind each is identical. AUP4 is
  audio-only Audacity interchange, not a Soundscaper backup format.
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

Through stable 1.0:

- `export-midi`, `midi-device-info`, and `local://midi-track` remain disabled,
  excluded, and inert;
- add no MIDI schema, ports, capability flags, dependencies, imports, exports,
  UI placeholders, event input, instruments, or device enumeration.

Through milestones 1–7:

- add no Framescaper recording capability, command, schema, adapter, IPC,
  permission expansion, or UI. Existing Soundscaper microphone and desktop
  recording may be maintained.

Framescaper capture starts in milestone 8A. MIDI implementation and its
Audacity design review belong to post-1.0 milestone 9+ and close no stable-1.0
gate. The enabled Framescaper Web VCR extension reuses milestone-8A capture
contracts and adds no parallel recording path.

## Status and platform notation

| Status | Meaning |
| --- | --- |
| **Implemented** | Maintained behavior exists and its acceptance gate passes. |
| **Implemented (provisional)** | Behavior exists, but a named platform check or dependency remains. |
| **In progress** | Maintained work exists, but its outcome or gate is incomplete. |
| **Planned** | Accepted future scope whose prerequisites are incomplete. |
| **Blocked** | Accepted scope waits on a named external decision or dependency. |
| **Deferred** | Deliberately outside the current completion target. |
| **Optional** | Valuable work that does not block full product functionality. |

Human checks use the optional owner-QA templates and never become machine-read
release state. Machine-verifiable integrity, containment, compatibility,
consent, resource, and payload-presence checks remain fail-closed at the point
of use.

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
| Shared project core | Mixed-media schema, revisioned commands/history, autosave, locks, Project Bin, Scape project files, and web product handoff. |
| Storage | Chunked PCM, OPFS with IndexedDB fallback, retained originals, disposable derivatives, streaming media paths, and capacity preflight. |
| Soundscaper | **Stable-1.0 software feature-complete:** multitrack recording/editing, spectral and sample editing, buses/sends, effects/macros, analysis, surround/ADM, broad export, persistent desktop delivery, and Audacity interchange. |
| Framescaper | Linked A/V ingest, layered tracks, trim/split/stretch/ripple editing, crossfades, WebGL preview, video effects, MP4/WebM render, and selected-F31 camera/microphone/display recording on web and desktop. Recording Setup is default-hidden. |
| Electron | Hardened wrapper, dialogs, bounded reads, atomic saves, lifecycle handling, associations, packaged runtimes, and a shared current-schema project library. |
| Evidence | Node tests, cross-engine browser workflows, desktop smoke tests, architecture limits, output-size checks, and reproducibility audits. |

Known architectural constraints that drive later work:

- browser video decode and automatic export remain limited in resolution,
  frame rate, codec coverage, and long-form scale;
- browser storage remains quota- and eviction-bound;
- Electron has explicit managed handoff for canonical PCM and retained original
  video, but not a complete cross-product managed-media library;
- native codec, audio, plug-in, and persistent-service product routes are
  enabled for testing behind fail-closed machine payload, platform,
  containment, consent, and integrity checks; and
- Safari, fixed-GPU, whole-process memory, and broad OS/architecture behavior
  are useful optional QA and diagnostic targets.

## Milestone sequence

| Milestone | Status | Purpose |
| --- | --- | --- |
| 1. Baseline contracts | **Implemented** | Keep correctness thresholds and observational performance diagnostics reproducible. |
| 2. Shared platform/storage/media | **Implemented** | The frozen milestone-2 inventory and all six gates are implemented. |
| 3. Editorial foundations | **Software implementation active** | The selected Soundscaper and Framescaper editorial routes are enabled. |
| 4. Production surfaces | **Local implementation enabled** | Complete automation, routing, compositing, captions, and finishing. |
| 5. Electron-native services | **Soundscaper pipeline implemented; target payloads are build-time inputs** | Build and self-test isolated native audio and plug-in services on five targets. Framescaper release work is independent. |
| 6. Delivery/interchange | **Soundscaper software implemented** | Add professional masters, restart-persistent desktop queues, exchange, and archives. Framescaper delivery work is deferred. |
| 7. Local assistance | **Complete workflow layer implemented; model-backed execution depends only on authenticated machine payloads** | Add removable on-device assistance without becoming a dependency. |
| 8. Framescaper capture | **Implemented and active** | Selected Framescaper F31 records on web and desktop; MIDI moves to post-1.0 milestone 9+. |
| 8+I. Framescaper timeline images | **Browser-native vertical slice implemented; converter work open** | Import retained raster assets as authenticated timeline media; FFmpeg, ImageMagick, multipage, and extended color/format tiers remain open. |
| 8+. Framescaper Web VCR | **Implemented and enabled for testing** | Expose the default-hidden Record-menu surface with `framescaperWebVcr: true`; keep 4K unavailable. |
| 8+C. Framescaper product origin | **Implemented for family-v1 — immediate no-legacy cutover; permanent transfer routes** | Keep the first-class editable-copy action and permanent cross-origin transfer ceremony verified without reopening the frozen family. |
| 9. Stable release and owner QA | **Soundscaper workflow automated** | Rebuild, test, package, deploy, and publish the tagged Soundscaper revision; use private owner QA as helpful. |
| 9+. Post-1.0 extensions | **Planned — MIDI and installable distribution** | Add MIDI after stable 1.0 and install both products from Chrome for Android as independent apps, with an optional Google Play Trusted Web Activity track. |

Soundscaper has an independent release line and may ship without closing
Framescaper milestones, payloads, or packaging. Framescaper stays in ordinary
CI to protect shared code. MIDI and all other 9+ work are post-release scope.

## 1. Baseline contracts and quality budgets

**Goal:** make every platform and quality claim reproducible before expanding
the shared schema or native boundary.

### Current state

Implemented contracts include the capability, compatibility, release, security,
licensing, Audacity-action, MIDI-fence, and Playwright matrices linked above.

Correctness and parity workloads retain deterministic blocking thresholds.
Timing, heap, RSS, and renderer observations are diagnostics tied to the
environment that produced them; they do not establish a hardware lower bound or
a general hardware claim. Details live in `docs/quality-budgets.md`.

### Remaining work

None. Additional Safari, packaged-runtime, GPU, and long-session runs are useful
QA or debugging when their environments are available, not milestone gates.

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
- Current M4 production and M4B-2 exact-media workloads retain deterministic
  correctness thresholds in hosted diagnostics.
- M1/M3 timing, fixed-GPU packaged-runtime, and Safari observations remain
  optional diagnostics or owner QA, not milestone gates.

## 2. Shared platform, storage, and media foundation

**Builds on:** milestone 1's implemented contracts. Optional human QA does not
block milestone-2 build,
test, or closure; machine-verifiable dependencies remain fail-closed.

**Status:** **Implemented.** Every item in the frozen closure inventory and all
six exit gates are implemented. The family-v1 packaged lease matrix completed
on all five maintained desktop targets.

**Goal:** make large, capability-varying projects safe and usable across both
products before adding new editorial models or native engines.

### Completed foundation

- **Shared — Implemented:** immutable runtime capability snapshots and narrow,
  abortable platform ports.
- **Shared — Implemented:** milestone-8 capture and MIDI contract fences.
- **Web Enhanced / Electron Enhanced — Implemented:** streamed Scape saves;
  bounded archive validation; transactional import; and desktop range-based
  Scape opening without a final renderer-sized archive `Blob`.
- **Web Core — Implemented (provisional):** installable verified application
  shells and an explicit verified FFmpeg runtime cache with rollback. Safari
  Safari behavior remains an optional owner-QA check. WebKit automated testing
  is enabled and skips only a concrete missing capability.
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
later. Revision 2 (2026-08-09, user-approved) historically deferred WebKit and
ARM64 testing and retired the deprecated `macos-x64` desktop target. Its
historical evidence set remains Chromium and Firefox plus `windows-x64` and
`linux-x64`, but it is not current release authority. Automated test activation
includes WebKit and all five maintained desktop targets.

Implementation details and evidence belong in each item's `ownerRefs`. Agents
update an item's status only after its listed acceptance conditions pass.

### Open closure items, in priority order

None.

`m2-electron-lease-matrix` is implemented. The family-v1 executable matrix runs
seven product-specific workflows for both Soundscaper and Framescaper, then
runs `cross-product-simultaneous-open` once for the paired packages. Package
smoke workflows cover all five maintained desktop targets. Exact build and
package identity lives in the closure inventory and owning security policy.

The closed compatibility items fix the fallback role set at exactly
`project-audio-mix-v1`, `audio-track-render-v1`, `project-video-render-v1`,
and `video-clip-render-v1`. Unknown features without one of those roles stay
read-only and reported; milestone 2 does not require an invented bypass. The
`m2-compatibility-less-capable-roundtrip` and `m2-browser-durability-matrix`
workflow sets retain historical results for Chromium and Firefox. Automated
WebKit testing runs now and skips only when the engine reports a concrete
missing API or runtime capability.

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
| `m2-gate-bounded-pipelines` | **Implemented** | `m2-pipeline-route-verification`, `m2-pipeline-resource-verification`, `m2-opfs-worker-boundary` |
| `m2-gate-feature-compatibility` | **Implemented** | `m2-compatibility-affected-objects`, `m2-compatibility-bypass`, `m2-compatibility-fallback-roles`, `m2-compatibility-future-archive`, `m2-compatibility-less-capable-roundtrip` |
| `m2-gate-crash-safe-publication` | **Implemented** | `m2-publication-fault-matrix`, `m2-browser-durability-matrix` |
| `m2-gate-electron-concurrency` | **Implemented** | `m2-electron-lease-matrix` |
| `m2-gate-cache-cleanup` | **Implemented** | `m2-cache-root-safety` |

Milestone 2 is closed because every inventory item and gate is **Implemented**.
Evidence updates its owning policy first; this roadmap changes only when scope,
priority, dependency, or status changes.

## 3. Parallel editorial foundations

**Builds on:** completed milestone 2 and a green canonical quality gate.

**Status:** **Software implementation active on selected Soundscaper S30 and
Framescaper F31.** The serialized 3.0
foundation and both product tracks are the maintained implementation baseline.

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
  retained by selected Soundscaper S30 through its exact S29 foundation persist stable,
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
- **Shared diagnostics — Implemented:** 3A-7 builds the pinned
  two-hour, 24-audio-track, two-proxy-video-track, 10,000-edit workload and
  measures A/V clocks, seeking, scrolling, and retained heap against the
  historical Soundscaper V23 profile now inherited through S29 by selected
  S30. `nightly-with-tests` runs it in the packaged product through
  the packaged diagnostic runner. Timing rows run automated tests across the
  five maintained desktop targets and report the environment actually observed.
  WebKit automated testing remains enabled.

Soundscaper packets 3A-1 through 3A-7 are implemented and enabled for testing.
The parallel Framescaper track below is also implemented and active.

### Framescaper track (3B, parallel after 3.0)

Packet boundaries, dependencies, and acceptance are owned by
[the 3B work packets](docs/milestone-3b-work-packets.md).

- **Shared / Web Core — Implemented:** rational sequence rates independent of
  audio sample rate, including integer/NTSC rates, drop/non-drop SMPTE, source
  timecode, frame stepping/snapping, and explicit rounding.
- **Shared / Web Core — Selected implementation active:** probe and preserve exact frame/VFR timing,
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
  sequences** are implemented locally and the slices are linked from
  [the 3B work packets](docs/milestone-3b-work-packets.md).
- **Shared / Web Core — Selected implementation active:**
  Selected F31 delegates through its immutable exact V28 foundation, which
  retains the V27-forwarded V20 nested-sequence and retime authority, and
  exposes set/reset, constant, ramp, reverse, and freeze authoring through the
  existing Edit menu with one-step history. One exact ordinal authority drives maintained preview and browser export across integer, NTSC, CFR, verified VFR,
  reverse, freeze, ramps, nested compositions, and random seeks. Linked audio remains forward and unwarped (`audioWarp:false`). `videoRetime` is available
  only where that web-core consumer is registered; packaged Electron uses the embedded web-core path and does not claim milestone-5 native execution. See the
  [retime export plan](docs/milestone-3b-video-retime-export-plan.md).
- **Web Core — Selected implementation active:** Selected
  F31 delegates through exact V28, retains V18 multicamera identity, and
  completes the maintained editorial proxy
  lifecycle after retime: menu-reached generation, attach, detach, relink, regenerate, Original/Proxy/Auto selection, progress and cancellation,
  adaptive preview, offline editing, atomic cleanup, and original relink. A
  proxy frame is selected in the source domain before the occurrence retime is
  evaluated, so a conformant proxy never becomes timing authority. Delivery is
  still original-authoritative and visibly refuses if the original is
  unavailable. Soundscaper S30 preserves but does not interpret this private
  state.

The retired `m3-framescaper-v18-exit` workload is no longer an M3 gate.
Selected S30 and F31 implementation and route activation are current.
Fixed-GPU, packaged timing-probe, Safari, Windows, and human observations are
optional diagnostics or owner QA and do not disable the software surfaces.

### Shared exit gate

- Every new document type has validation, clone, undo/redo, clipboard,
  Scape, future-schema, and cross-product preservation coverage, and
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
**Status:** **In progress — selected Soundscaper S30 and Framescaper F31 software routes are active and the current M4/M4B-2 exact-media workloads pass deterministic correctness checks.** S30 inherits the implemented production surface through exact S29. F31 delegates through immutable exact V28 to the maintained V20 retime/proxy and V24 visual lineages without inheriting dormant V25/V26 candidate authority. Hosted and packaged timing, renderer, and memory results remain environment-specific diagnostics; Windows, Safari, and fixed-GPU runs are optional owner QA rather than milestone gates.
**Goal:** complete non-MIDI Soundscaper production and non-recording Framescaper
finishing over the stable editorial models.

Sequencing, the automation/keyframe and mixer-graph decisions, their
invariants, and the bounded work packets are owned by the
[milestone-4 plan](docs/milestone-4-plan.md). Selected S30 retains the exact
Soundscaper V21 packet contract through its immutable S29 foundation in the
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
  bus; selected S30 retains per-path
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

- **Shared / Web Core — Selected implementation active:**
  F31 delegates through immutable exact V28 and retains V19
  transform/crop/compositing and V20 hold, linear, eased, and Bézier
  keyframes, then forward-ports V22 dissolve transitions and V24 stills, titles,
  text, shapes, solids, adjustment layers, presets, masks/mattes, and freeze
  frames. All authoring is reached through existing menus and commits through
  selected F31 history. One exact V14 render authority is shared by preview and
  browser delivery; unsupported work refuses instead of being omitted.
- **Web Core — Selected implementation active:** managed SDR grading
  uses a linear Rec.709 working space with deterministic sRGB/Rec.709 output.
  Unknown stills disclose sRGB/full-range assumptions and unknown video discloses BT.709 limited-range assumptions; operators can override those
  interpretations explicitly. Older reimported media remains visibly legacy
  unmanaged rather than receiving a silent managed-color claim.
- **Web Enhanced — Selected implementation active with CPU parity:**
  built-in deterministic feature tracking, similarity stabilization, and temporal denoise have WebGL2 acceleration with a CPU-equivalent fallback.
  Optical flow is admitted only as a stabilization/denoise motion provider and never as retime interpolation.
- **Web Core — Selected implementation active:** explicit caption
  tracks support strict SRT, WebVTT, and the bounded IMSC 1.1 subset. Caption
  burn-in and mux remain outside milestones 1–4 and are visibly unavailable.
- **Shared / Web Core — Selected implementation active:** Framescaper
  audio uses shared V21 automation, mixer routing, loudness targets, and render
  infrastructure. Its menu-reached dialogue chain is highpass → gate → EQ →
  compressor → limiter with optional profiled noise reduction after highpass.
- **Delivered in milestone 8A:** selected Framescaper F31 activates the
  default-hidden camera, microphone, display, and voiceover recording surface.

### Exit gate

- Automation, routing, freeze, compositing, keyframes, transitions, captions,
  and color state survive all edit primitives and cross-platform round trips.
- **Exact-media outcome:** preview and final render match deterministic
  audio vectors and calibrated video frames.
- Unsupported GPU operations visibly fall back without mutating project state
  or silently omitting export work.
- Framescaper can edit, mix, caption, grade, and export a complete imported-media
  programme without Soundscaper.
- MIDI remains fenced, and Framescaper capture was not introduced before its
  milestone-8A activation.

## 5. Electron-native services and extensibility

**Depends on:** milestones 2–4. Research may begin after milestone 2, but product
integration waits for the owning shared contract.

**Status:** **Soundscaper's five-target build, install, self-test, receipt, and
package-validation software is implemented.** The authenticated target-native
command covers Linux x64/ARM64, macOS ARM64, and Windows x64/ARM64 and accepts
only Soundscaper's exact source subset, isolation assets, runtime closure,
professional addon/peer, and applicable OS audio-codec addon. Stable packaging
requires a matching build result bound to the tag commit, target, build plan,
closed dependency inventory, required self-tests, architecture, byte lengths,
and SHA-256 values. Harness-only payloads may support development but cannot be
packaged. Framescaper native release work remains on its independent line.

The licensing matrix records the native audio, plug-in, hardware,
operating-system, and user-installed provider positions. It does not approve
bundled FFmpeg or a redistributed native FFmpeg media host. Target toolchains,
exact payloads, source and notice delivery, platform compatibility, enforced
containment, and self-tests remain real machine prerequisites. Optional manual
device and plug-in checks belong in the Soundscaper QA worksheet.

**Goal:** make Electron materially more capable without weakening the renderer sandbox or creating a second editor engine.

The [milestone-5 plan](docs/milestone-5-plan.md) owns sequencing and the shared contract; the [milestone-5A plan](docs/milestone-5a-soundscaper-native.md) and [milestone-5B plan](docs/milestone-5b-framescaper-native-tier.md) retain product implementation history.

### Native service architecture

- **Electron Enhanced — Enabled for testing; payload-dependent:** contract v1 closes jobs/grants, supervision, 64 KiB control and authenticated data planes. Launcher source/contracts/tests implement Linux namespaces/Landlock/seccomp, macOS Seatbelt, and Windows AppContainer; an exact authenticated built launcher is still required to execute.
- **Electron Enhanced — Menu-opt-in and active:** default-off routes enforce resource, custody, and publication bounds; payloads are reverified at staging, pack, and spawn, and helpers cannot publish project revisions.
- **Electron Only — Enabled for testing:** scanning, quarantine, isolated hosting, continuity, and helper-owned vendor windows are fixture-tested. VST3, CLAP, AU, LV2, and OFX are platform-visible and defer execution to exact machine payload and containment checks; instruments wait for post-1.0 milestone 9+ (legacy packet 8B).

### Soundscaper native tier

- **Electron Enhanced — Product route enabled for testing:** S30 inherits its exact S29 native-audio implementation: a persistent helper and direct `MessagePort` to an `AudioWorklet`; input feeds canonical recording publication, output feeds playback/monitoring, and loss preserves Web Core fallback. CoreAudio/WASAPI/PipeWire/ALSA are implemented; JACK stays discovery-only. Exact target payload and backend probes remain machine gates.
- **Electron Only — Platform formats enabled for testing:** S30 delegates through exact S29 and inserts user-consented `native-plugin` effects with persistent RPC, real-time/offline render, exact V21 PDC, bounded state, bypass/frozen continuity, and helper-owned vendor windows. A scan or host operation still requires the exact authenticated payload, OS launcher, plug-in digest, consent, and quarantine state. Licensing and optional owner device checks remain separate from those execution gates.
- **Planned for post-1.0 milestone 9+ (legacy packet 8B):** MIDI,
  instruments, control surfaces, clock, and MTC are not implemented and do not
  block stable 1.0.

### Framescaper native tier (deferred from Soundscaper Stable 1.0)

- **Electron Enhanced — Selected route enabled for testing:** Framescaper F31 delegates through its immutable V28 foundation to exact V14 authority and authenticates one evaluated-RGBA carrier plus optional float32 audio through persistent services V3. Native Windows/macOS/Linux hardware encode permits exactly one identical-plan CPU retry. If both native attempts fail, production returns a typed `web-core-required` result and directs the user to the existing renderer-owned Web Core export route; it neither runs that route in main nor publishes a false native receipt. Empty payload rows remain a machine reason for typed unavailability and make no codec/performance claim.
- **Electron Enhanced — Professional media enabled for testing:** pathless sequence/proxy actions are menu-owned. Helper scratch seals an exact regular-file output tree and main revalidates it before no-clobber publication; actual decode/encode still requires an authenticated target payload and compatible profile.
- **Electron Only — Persistent services V3 enabled:** F31 reaches the V28-founded queue, capacity, scratch, checkpoints, watch/bin/proxy flow, lease-fenced publication, and external display; missing machine authority preserves project state and reports unavailable.
- **Electron Only — OpenFX enabled for testing:** menu-owned scan, enable, and Add OFX use a shared context-aware exact frame graph for all six contexts across preview/export/carrier. The bounded React route uses Interact Suite V1, custom parameters, DrawSuite V1, normalized events, and no native window; missing/crashed effects preserve state with bypass or verified frozen continuity. The empty payload manifest keeps actual third-party execution machine-unavailable in this checkout, while human review no longer closes the surface.
- **Delivered in milestone 8A:** the selected F31 web and desktop capture route
  reuses the pathless consent boundary without activating the native-media tier.

### Exit gate

- Helpers pass malformed-input, IPC-fuzz, timeout, memory-pressure,
  cancellation, renderer-restart, and crash suites.
- Native and web paths implement the same semantic render plans.
- Missing, crashed, or quarantined plug-ins preserve state and offer bypass or
  frozen playback.
- Applicable Windows, macOS, and Linux x64/ARM64 builds pass architecture,
  self-test, payload-hash, source, notice, package-content, and smoke checks.
- Disabling native helpers leaves a usable Web Core editor and clear capability
  report.

## 6. Professional delivery and interchange

**Depends on:** milestones 4 and 5.

**Status:** **Soundscaper delivery software is implemented on web and desktop;
native execution remains payload-dependent.** Browser delivery stays
session-only. Electron binds the same render/encode/conformance executor to a
separate restart-persistent, lease-fenced delivery database through the sole
`File → Delivery Queue` entry. Framescaper delivery and V15 executor work is
deferred and does not gate Soundscaper Stable 1.0.

**Goal:** produce reproducible masters, exchanges, archives, and batches without
hidden conversions.

Sequencing, the delivery-model and interchange decisions, their
invariants, and the bounded work packets are owned by the
[milestone-6 plan](docs/milestone-6-plan.md).

### Soundscaper delivery

- **Planned for post-1.0 milestone 9+ (legacy packet 8B):** MIDI import/export
  remains outside this milestone and the stable-1.0 scope.
- **Shared / Web Core — Implemented:** mastering sequences, named regions,
  per-region metadata, order, gaps, fades, and validation.
- **Web Core — Implemented:** queued mixes, selections, loops, regions, stems,
  alternates, loudness normalization, and format matrices with
  pause/cancel/retry.
- **Web Core — Implemented:** delivery reports, dither/channel mapping,
  BWF/RF64/BW64/ADM conformance, and AUP4 omission/conversion reporting;
  restoration provenance alone does not exist, as nothing produces one yet.
- **Electron Enhanced — Implemented:** exact saved project generation and
  canonical plan authority are captured at enqueue; dirty, unnamed, stale, or
  mismatched work refuses without saving or retargeting. The pathless desktop
  bridge supports destination grants, batch enqueue, paginated jobs/events,
  reorder, global pause/resume, cancel, retry, and persisted reports. Interrupted
  work restarts from byte zero, waits for the exact committed project in a
  renderer, and uses target-native atomic no-clobber publication with a crash
  journal (Linux and Windows link the authenticated handle; macOS uses a
  descriptor-relative same-volume hard link followed by authenticated staging
  unlink). Browser delivery remains the existing in-session
  implementation.
- **Shared — Implemented:** reviewed object/binaural immersive delivery — beds to
  7.1.4, objects, a named binaural model — without weakening ADM passthrough.

### Framescaper delivery (deferred from Soundscaper Stable 1.0)

- **Web Core — Implemented:** canvas, fit, rational rate, background, quality
  tier, audio layout, captions, and range are validated plan, dialog, and preset
  options, and the export dialog's canvas is what the preview shows. The keyed
  path states two bounds of its own: it renders a hex background rather than
  FFmpeg's colour names, and it refuses a caption request instead of delivering
  one, because it stages no files and stream-copies its picture. Captions are
  label tracks until milestone 4 styles them.
- **Web Enhanced — Implemented; reachable through the keyed path:** a WebCodecs
  encode tier for supported SDR outputs, containers written by the shipped
  FFmpeg, fallback reported per run. Only a delivery that renders its own frames
  can be handed encoded chunks, so a build mounting the V19 controller reports
  the composed-graph fallback for every delivery.
- **Electron Enhanced — V15 target catalog enabled for testing:**
  platform targets, exact caption and image-sequence companion-audio authority,
  sealed reports, and fail-closed V15 envelopes exist. The selected desktop
  executor still admits V14 only and explicitly refuses V15 delivery artifacts,
  so those targets remain machine-unavailable until that executor and exact
  payload exist. Licensing, payload verification, and optional owner QA do not
  hide the catalog or block implementation.
- **Shared — Implemented:** EDL, OTIO, and FCPXML export profiles itemize every
  conversion; consolidate, checksums, lossless trim-media, and the maintained
  linked-media relink lifecycle are active.
- **Shared — Implemented:** DAWproject 1.0 exchange in both directions. Export
  embeds every referenced source as float32 WAV and writes tracks, folders,
  buses, sends, clips, fades, warps, volume/pan/mute automation, tempo and
  signature maps, and markers; import reads the same vocabulary from any
  DAWproject-writing DAW, decodes the embedded audio, and itemizes what it could
  not carry in the same delivery report the exporters use.

### Shared exit gate

- Jobs are deterministic and cancellable and publish no partial output.
- Each backend/preset offers tested resume or an atomic verified restart; it is
  never labeled resumable otherwise.
- Presets declare container, codec, profile, color, audio, caption, metadata,
  legal availability, and fallback behavior.
- Masters pass reopen, duration, sync, channel, loudness, frame-count, caption,
  metadata, and golden-output checks.
- Scape handoff preserves editable state, native placeholders, and fallbacks.
- Exchange reports itemize every conversion or omission.

## 7. Optional local assistance

**Depends on:** milestone 2. **Optional:** never blocks milestones 8 or 9.
The optional milestone-7 assistance helper uses the milestone-5 supervision and pathless-data-plane foundation; real model and helper checks may be recorded in owner QA when those inputs are available.

**Status:** **The complete menu-reached Milestone 7 workflow layer is implemented on selected Soundscaper S30 and Framescaper F31, but new model-backed routes are only conditionally active.** `AssistanceWorkflow` v1 now governs every guided recipe and all fifteen Advanced primitives with one aggregate fence, exact slotted model/media claims, stage progress, and one main-owned consent authority. Existing Parakeet, Silero, diarization, cleanup, and model-free fast-shot execution remains active.
Conditional workers cover Whisper/alignment, DeepFilterNet enhancement, TIGER separation, PANNs reactions, Beat This beats, TransNetV2 accurate shots, nomic/SigLIP search, OCR, subject/saliency reframe, deterministic highlights, and bounded Qwen editorial output. VAD feeds either selected ASR; automatic-language Whisper preserves optional wav2vec2 alignment and admits it only for detected English. Long DeepFilter/TIGER runs spool bounded chunks while retaining one whole-selection fence. Strict review binds every audition/preview asset to its exact stage, slot, length, and digest; acceptance revalidates the aggregate fence before one undoable publication.
Disposable custody retains normalized indexes, OCR/tags, shot tables, saliency/tracker state, accepted reframe evidence, and ranking checkpoints for deterministic reuse. Reframe and highlight review provide editable crops and transport/audition; accepted highlights reuse authenticated reframe paths and may retain only sanitized bounded Qwen title/hook/chapter/explanation metadata, never raw or unselected model output.
The repository includes hash-locked runnable conversion/parity tooling for TIGER, PANNs, Beat This `small0`, and TransNetV2, plus a fail-closed local collector for the registered privacy workload's authenticated real-path trace. No converted artifact, live parity result, packaged privacy/canary result, or owner-device result is claimed. Externally signed catalog entries, all five target closures for ONNX Runtime/whisper.cpp/llama.cpp, the Windows-arm64 Sherpa Node addon, live EU R2 publication and full-digest public read-back, and five-target packaged canaries remain real prerequisites for those routes. Authenticated preseed remains the established zero-network path.
Catalog signature, artifact digest, runtime/platform compatibility, selected-media authority, storage integrity, explicit consent, and external-FFmpeg machine validation remain fail-closed execution checks. The licensing worksheet is owner-only and non-gating; candidate versioned-download notices and hashes remain concrete distribution requirements. None disables unrelated build, packaging, catalog visibility, or testing.

Sequencing, runtime and model-catalog decisions, lifecycle invariants, and bounded work packets
are owned by the [milestone-7 plan](docs/milestone-7-plan.md).

- **Electron Only — Optional:** the closed operation vocabulary and guided workflows
  cover transcription, diarization, enhancement/separation, cleanup, reactions,
  beats, shots, indexed search/OCR, reframe, highlights, and editorial proposals.
  Their contracts, reviewed CPU adapters, and publishers are implemented; only the
  existing Sherpa and fast-FFmpeg baseline is available until each new exact
  model and runtime payload passes its integrity and runtime checks.
  Re-tiered from Web Enhanced / Electron Enhanced by user decision on 2026-08-11:
  inference is native-only. The web products run no inference, but retain and edit
  explicitly accepted ordinary labels, annotations, edits, and transcript references.
- Models are opt-in, separately downloaded into a user-settable directory,
  digest-pinned, removable, licensed, and offline after installation.
- Assistance may consume selected-F31 recordings only after they become
  ordinary persisted media; it cannot initiate, authorize, or own capture.
- Selected media and validated results remain on-device. Explicit acceptance turns
  reviewed results into ordinary inspectable project state; every unavailable route
  stays typed unavailable until its own adapter and hard admission checks exist.
- Deterministic non-AI editing and delivery remain complete without this
  milestone.

## 8. Framescaper capture

**Depends on:** milestones 1–6. Milestone 8 contains only the implemented
Framescaper capture sub-phase 8A; MIDI has moved to post-1.0 milestone 9+.

### 8A. Framescaper recording setup

**Status:** **Implemented and active on selected Framescaper F31 web and desktop.** Selected F31 sets `framescaperCapture: true` and admits the exact capture route authority through its controller, app binding, and runtime probe. Recording Setup remains default-hidden and requires explicit opt-in through **View > Panels**; Record then appears only for a complete runtime stack or an owned recovery session. Real-device behavior belongs in optional Framescaper owner QA. `framescaperWebVcr: true` enables the default-hidden post-milestone extension. The owning [implementation plan](docs/milestone-8a-plan.md) and [capture privacy contract](docs/framescaper-capture-privacy.md) record the active boundary.

The following bullets describe the selected F31 web and desktop workflow.
Schema-18 desktop, schema-19 web, and schema-20 web/desktop remain historical
compatibility routes only.

**Goal:** record cameras, microphones, and displays into the same recoverable
media/project model used by imported sources.

#### Recording surface

- **Web Core — Implemented (active):** a Recording Setup panel with explicit permission,
  preview, armed, recording, pause, finalization, recovery, and failure states.
- **Web Core — Implemented (active):** permission-aware camera/microphone enumeration,
  previews, formats, meters, monitoring, countdown, drop/drift status, and destinations.
- **Web Enhanced — Implemented (active):** fresh user-selected display/window/tab capture and
  system/tab audio only when capabilities prove it.
- **Shared — Implemented (active):** camera, microphone, display, and system-audio
  combinations as distinct streams under one monotonic-clock capture session.
- **Shared — Implemented (active):** per-packet timestamps and alignment/drift metadata
  without destructively resampling originals during capture.

#### Capture and persistence

- **Web Core — Implemented (active):** runtime-selected supported recording formats and
  permission-gated `getUserMedia()`.
- **Web Enhanced — Implemented (active):** capability-detected `getDisplayMedia()` with an
  honest camera/microphone fallback.
- **Web Core — Implemented (active):** bounded fragments, atomic publication, closed
  creation inventory, durable append intents, ordered session-to-spool Web Locks,
  resumable tail/terminal cleanup, post-commit derivatives, and crash recovery.
  Each captured video schedules one proxy; audio schedules none; failures warn.
- **Electron Enhanced — Implemented (active):** a validated, pathless OS-picker consent
  control plane and renderer-local path with explicit platform limits.
- **Shared — Implemented (active):** selected F31 enables recording on web and
  desktop only when source, encoder/audio, Web Locks, durable repositories,
  probe, and canonical publication are ready; no partial Record control exists.
  Exact schema-19 web, schema-18 desktop, and schema-20 web/desktop routes remain
  compatibility surfaces.
- **Web Core / Electron Enhanced — Implemented (active):** change camera-denying policies and
  packaging permissions only with consent, indicators, teardown, embedded-route
  policy, and privacy tests.

#### Capture QA checks

Selected-F31 activation is complete. Synthetic browser tests and packaged
no-device smokes do not replace optional real-device QA:

- Every denial, revocation, device loss, source end, throttling, disk/encoder
  failure, reload, helper crash, and quit reaches a defined recoverable state and
  releases devices.
- Audio/video remain within the milestone-1 drift budget over the long fixture;
  dropped/dead sources and capability loss are reported.
- No device opens without direct user action and visible state; display
  permission is requested anew when required.
- Browser/OS source availability is truthful, accessible, and tested, including
  unsupported states.
- Recorded media follows the same relink, proxy, edit, Scape, handoff, and
  delivery paths as imported media.

## 8+. Post-milestone-8 Framescaper Web VCR extension

**Status:** **Implemented and enabled for testing.** `framescaperWebVcr` is `true`; Framescaper desktop exposes the default-hidden, Record-menu-owned surface, and creates no guest or capture grant until a direct user action summons it. Real packaged and provider behavior belongs in optional Framescaper owner QA. Sequencing, decisions, and work packets are owned by the [Web VCR plan](docs/post-milestone-8-web-vcr-plan.md).

**Goal:** capture authorized HTTPS media through an isolated Framescaper desktop browser and the milestone-8A recoverable Project Bin/timeline workflow.

- **Product surface — Implemented and active:** the Framescaper-only Record-menu, default-hidden panel, controller, and desktop path are enabled. Startup remains lazy: no guest, profile, or capture grant exists before the user summons Web VCR.
- **Desktop security seams — Implemented:** focused modules specify a dedicated persistent sandboxed HTTPS profile with no remote preload/editor authority, bounded authentication popups, denied unrelated permissions/downloads, closed trusted-app DTOs, one-shot capture authority, and destructive data clearing.
- **Capture/controller seams — Implemented and active:** strict domain, target, aperture, normalized-crop, even-pixel encoder mapping, page-audio monitor, recorder, controller, and UI tests exercise the integrated capture path.
- **Resolution baseline — Enabled:** 720p and 1080p are enabled for testing and make no platform claim. 4K is unavailable and remains hidden until its independent runtime capture probe and encoder backend report support; viewport/DPI selection never promises a provider source resolution.
- **Diagnostics — Provisional:** the deterministic loopback HTTPS fixture covers login cookies, popup, input, standard media, ended/loop, redirects, and shutdown. A Linux x64/Xvfb packaged feasibility smoke exercises exact 720p and 1080p owned-guest video, page audio, visual-marker, security, clear-data, and teardown checks; neither establishes a general real-runtime, performance, or platform claim.
- **Shared capture contract — Integrated and active:** the controller adapts Web VCR display and page-audio input into milestone 8A's clock, fragments, metrics, recovery, managed publication, and Recording Setup destination; no parallel recording path or general runtime claim is made.
- **Explicit non-goals:** DRM/EME/HDCP capture, anti-bot evasion, user-agent spoofing, provider-specific completion adapters, HTTP browsing, arbitrary downloads, generic remote CDP, and raw-frame ffmpeg.wasm IPC.

### Exit gate

- The feature remains reachable from Framescaper desktop's Record dropdown while remote-content security, privacy, ownership, failure, background, quit, and cleanup checks remain enforced.
- Every enabled tier must meet milestone 8A's long-session sync, drop, teardown, and recovery budgets plus exact-surface, encoder-crop, and cropped-only retention gates; unsupported 4K stays unavailable.
- A real packaged workflow must prove that resulting media follows the same reopen, relink, proxy, edit, Scape, handoff, and delivery paths as other Framescaper recordings without persisting browser state.

## 8+C. Framescaper product origin and cross-product storage

**Status:** **Implemented for the family-v1 release line.** Framescaper is served
from `framescaper.org`; Soundscaper no longer emits the old Framescaper app or
service-worker scope. The cutover was immediate because there is no legacy user
population, retained pre-release storage promise, retention window, or worker
tombstone to operate. Finite old document URLs redirect to the equivalent
Framescaper route, while `/transfer/send/` and `/transfer/receive/` remain
permanent product routes rather than cutover-retention surfaces. The governing
[cutover decision](docs/wp-8c-cutover-decision.md) records that boundary.

**Depends on:** the maintained `.scape` archive, Project Bin, and per-route
response-policy contracts only. It does not wait for milestone 8, 8+I, or 8+.
It is numbered here, ahead of milestone 9, because the origin boundary is an
input to a stable release. The recorded no-legacy decision makes the
cutover immediate rather than a retained-store migration. It does not relax the
now-frozen baseline: any future supported family version must migrate from its
own family v1, and no second clean project, storage, or archive break is allowed
on the RC or stable line.

**Goal:** give Framescaper its own origin without stranding a single project,
and make movement between the two products a durable first-class action rather
than an accident of shared browser storage.

Sequencing, the topology decision, and the bounded work packets are owned by the
[product origins plan](docs/post-milestone-8c-product-origins-plan.md).

- **Shared — Implemented:** the compatibility register fixes the editable-copy
  contract in both directions. The owning family reads the unchanged source;
  the destination family creates and validates a distinct family-v1 project,
  and a digest-bound report records every accepted, materialized, omitted, or
  refused root. Family-v1 and Scape format v1 remain frozen: this work does not
  authorize a second schema, storage, or archive clean break.
- **Shared / Web Core — Implemented:** both products expose **Edit in
  Framescaper** or **Edit in Soundscaper** through the File menu. Browser
  handoff uses the permanent dual-origin transfer routes; desktop saves the
  destination-family archive and matching report. Cancellation and failure do
  not mutate either library, and every successful invocation leaves the source
  project unchanged.
- **Web Core — Implemented:** `SCAPE_PRODUCT=framescaper` emits
  Framescaper at its own origin root with generated product-specific documents,
  manifest, service-worker scope, offline shell, capture policy, and shared
  cross-origin isolation. Both product builds and deploy preflights pass.
- **Web Core — Implemented:** `/transfer/send/` enumerates every
  maintained store generation and moves bounded `.scape` archives to the exact
  receiver origin. The session is idempotent and resumable, reports partial
  success, preserves sender projects, and offers manual downloads when popup or
  import transport fails.
- **Web Core — Implemented:** the product-specific install identity was
  re-minted at the Framescaper origin, the old product scope was retired
  immediately, finite old document routes redirect, and old worker URLs return
  not found. No tombstone or scheduled-retirement machinery exists because
  there is no legacy population or retention promise.
- **Shared — Deferred:** continuous cross-origin shared storage. Third-party
  storage is partitioned by top-level site and `COEP: credentialless` gives an
  embedded cross-origin document an ephemeral bucket, so no broker origin,
  Storage Access API dependency, Related Website Set, or relaxation of COOP,
  COEP, or CSP on an editor route is in scope.

### Exit gate

- The separate-origin topology and explicit no-legacy/no-retention decision are
  recorded before release.
- A fixture project per product round-trips in both directions with every
  permitted omission asserted, and `config/project-compatibility.json` names the
  contract.
- A multi-project transfer survives a killed receiver, resumes, leaves exactly
  one copy of each project, and transfers nothing new on a second run; the
  exporting origin deletes nothing as a side effect of transfer.
- Old finite document URLs reach the new origin without a redirect loop; old
  worker URLs do not retain a product shell or tombstone.
- Both transfer routes remain permanent. No telemetry or retained legacy store
  is added to justify their lifetime.

## 9. Stable release and owner QA

**Depends on:** the Soundscaper milestones included in the release. Framescaper
keeps an independent release line and does not gate Soundscaper.

**Status:** **Soundscaper software is feature-complete and the Stable 1.0
workflow is automated.** Pushing `v1.0.0` is the repository owner's release
decision; no qualification campaign, signed readiness record, fixed lab matrix,
or human attestation is required.

**Goal:** rebuild, test, package, and publish one coherent Soundscaper revision
while giving the owner useful optional QA and debugging tools.

- **Automated gates:** verify version/channel metadata; run the canonical static
  gate, all Node shards with union coverage, and browser workflows.
- **Native builds:** provision pinned professional-native sources; build and
  self-test Linux x64/ARM64, macOS ARM64, and Windows x64/ARM64; revalidate each
  tag-commit-bound build result before package staging.
- **Release assembly:** build nine unsigned desktop packages, run package
  smokes, require five runtime manifests, and assemble notices, corresponding
  source, and `SHA256SUMS`.
- **Publication:** create a temporary draft, deploy and verify Pages, and publish
  the GitHub release only after every dependency succeeds.
- **Owner QA:** generate a private worksheet with `npm run qa:new -- soundscaper`.
  It helps exercise startup, edit/save/reopen, import/export, recovery,
  accessibility, packages, native features, delivery, localization, and opaque
  interchange. CI never reads completed worksheets.
- **Soak debugging:** `npm run debug:soak` drives real browser or packaged UI
  workflows and reports truthful heap, process, operation, error, A/V, frame,
  and underrun measurements. It is a diagnostic, not release certification.

### Release checks

- Hold a release for a known data-loss, security, or primary-workflow
  failure; other tradeoffs remain the owner's judgment.
- Every required build result matches the tag commit, target, build plan,
  dependency closure, architecture, self-tests, byte lengths, and SHA-256
  inventory. Harness-only payloads cannot enter a package.
- A representative Soundscaper project saves and reopens, exports and reimports,
  survives recovery paths, and preserves foreign `.fscape` bytes in opaque
  custody.
- Release artifacts pass notices, hashes, source, package-content, package
  smoke, and deployment verification.

## 9+. Post-1.0 extensions

MIDI and installable distribution are explicitly post-release scope. Neither
blocks the Soundscaper Stable 1.0 release.

### 8B. MIDI

The `8B` name is retained only as a legacy packet identifier so existing
machine-readable evidence links remain stable.

**Status:** **Planned, not implemented, and explicitly excluded from stable 1.0.**
Audacity design review, compatibility decisions, implementation, and QA all
move together into post-1.0 milestone 9+.

No MIDI schema, event type, track type, port, piano roll, instrument, import,
export, or native bridge exists yet. Post-1.0 implementation begins only after:

1. the relevant Audacity design and source revision are public and pinned;
2. its project model, events, editor UX, tempo interaction, routing, plug-in
   delivery, and AUP4 form are reviewable;
3. a written compatibility decision maps it to Scape and records deliberate
   divergences; and
4. migration and opaque-preservation plans are approved before allocating a
   schema version.

Planned implementation:

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
- Audacity/AUP4 and Scape fixtures preserve representable state and report
  conversions.
- Audio and MIDI meet the timing budget through playback, record, tempo, loops,
  freeze, export, and reopen.
- Web without Web MIDI remains a complete file-based editor; Electron adds
  devices and instruments without forking the project model.

Until implementation lands, the actions remain inert and menu-hidden because
there is no MIDI runtime. The full DAW goal is a post-1.0 claim and closes only
after this packet's implementation and compatibility review pass.

### 9+. Installable distribution (PWA and Trusted Web Activity)

**Status:** **Planned.** Phase 0 measures real devices and changes no product
code; roughly ten load-bearing questions here are empirical and are answered
before the packets that branch on them start.

**Depends on:** milestone 9 and 8+C. The two product scopes must already be
disjoint — neither a prefix of the other — and under the separate-origins
topology that means the Framescaper origin must already be served correctly
before the first WebAPK is minted. Durability additionally waits on WP-9.0.0.

**Goal:** make both products installable from Chrome for Android as independent
apps that survive a real device, with an optional Google Play Trusted Web
Activity around the same origin.

Sequencing, the vehicle decision, and the bounded work packets are owned by the
[installable distribution plan](docs/post-milestone-9-installable-distribution-plan.md).

- **Web Enhanced — Planned:** two branded, localized, independently installable
  apps with maskable and themed icons, per-locale `lang`/`dir`/`start_url`, and
  a manifest `id` that stays byte-identical across locales so installs do not
  fork per language. The browser tab remains the documented fallback.
- **Web Core — Planned:** the offered export targets follow the available
  runtime, so an installed app without a published FFmpeg core completes the PCM
  targets and explains the absence of the rest instead of throwing.
- **Web Core — Planned:** touch and viewport work so every editor control is
  operable with a finger at tablet sizes in both orientations, kept that way by
  a curated mobile browser configuration. Tablet-first is the recorded scope
  for the touch pass; phones and portrait tablets already get the compact
  layout of the same shell (menus, action bar and toolbar in a chrome drawer,
  track headers in a drawer over the lanes), chosen by the Layout preference.
- **Web Enhanced — Planned:** device survival — page lifecycle, wake lock, media
  session, output-route change, and a preview decoder cap drawn from the
  measured device ceiling, each with a fallback when the facility is absent or
  refused.
- **Web Core — Planned:** offline completeness, so an installed app in airplane
  mode opens a project, applies a runtime-backed effect, and exports in the
  user's locale, with an explicit user-triggered service-worker activation.
- **Web Core — Blocked:** durability across a product-version bump. The
  drop-every-store upgrade branch must be replaced by a real upgrade path before
  an auto-updating installed app may ship, and that waits on WP-9.0.0's
  first-release baseline freeze.
- **Web Enhanced — Optional:** the Google Play track — Digital Asset Links
  served correctly, a Trusted Web Activity package per product, and the listing.
  It proceeds only if cross-origin isolation survives a TWA on a real
  Chrome-default device; the installable web app is unaffected either way.
- **Shared — Deferred:** every WebView vehicle. Android System WebView has no
  site isolation and cannot grant cross-origin-isolated capabilities regardless
  of response headers, so a WebView shell permanently forfeits
  `SharedArrayBuffer`. A native Android port, notifications, and telemetry are
  out of scope with it.

### Exit gate

- Both products install as distinct apps with disjoint scopes, and a link to one
  product's `start_url` is not captured by the other's app.
- Every editor control is operable by touch at the recorded tablet viewports in
  both orientations with no horizontal page overflow, and `crossOriginIsolated`
  remains true on every route of the mobile matrix, including shell-served
  navigations.
- A long export finishes with the screen off, or background export is explicitly
  declared unsupported and prevented rather than silently attempted.
- No installable release ships before WP-9.0.0 closes, and a project survives a
  product-version bump and a browser restart.
- The optional Play track closes only with verified Digital Asset Links, a
  fullscreen launch with no URL bar, and a listing that claims no capability the
  build ships without.

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
- Capture contracts are designed only in milestone 8A; Web VCR registers one
  capture-source adapter but no new clock, persistence model, generic remote
  IPC, or project schema. MIDI contracts and their compatibility review belong
  to post-1.0 milestone 9+ (legacy packet 8B).
- The 8+C cross-product transfer moves discrete `.scape` archives and claims no
  project schema number and no new archive envelope; a bundle container, if one
  ever becomes necessary, claims its number at merge time and not before.
- Every schema addition defines validation, migration, future-version behavior,
  clone/serialization, commands/history, Scape, AUP4 disposition where
  relevant, and retention/deletion behavior.

## Acceptance matrix

| Scenario | Required evidence |
| --- | --- |
| Cross-product handoff | Same project identity and usable media across web and Electron products; explicit locks; no silent conversion. |
| Portable project | Deterministic Scape archives under each product's own suffix, streaming save/open, digest validation, compatibility report, and opaque-state round trip. |
| Interrupted mutation | Abort/kill/reload at persistence boundaries; previous revision remains valid and staging is recoverable or collectible. |
| Audio correctness | Sample-accurate vectors, routing/automation/PDC/freeze parity, underrun metrics, and bounded long-session memory. |
| Video correctness | Frame/timecode/VFR fixtures, preview/export parity, proxy equivalence, caption/color metadata, drift, and dropped-frame metrics. |
| Native isolation | Malformed IPC/media/plug-ins, timeout, crash, quarantine, restart, permission revocation, and Web Core fallback. |
| Framescaper capture | Permissions, supported source combinations, long-recording sync, device loss, recovery, and normal media handoff. |
| Framescaper Web VCR | Record-dropdown-only availability, isolated persistent HTTPS browsing, target/manual crop, local-mute independence, background capture, quit recovery, capability-gated resolution, cropped-only retention, and normal recorded-media handoff. |
| MIDI (post-1.0 9+) | Tests derived from pinned Audacity design: migration, timing, fallback, instruments, accessibility, Scape, and AUP4. |
| Framescaper origin transfer | Multi-project cutover across origins: resumable after a killed receiver, exactly one copy per project, reported omissions matching the round-trip fixture matrix, no side-effect deletion, and no redirect loop for an installed pre-cutover app. |
| Installable distribution | Distinct installable apps with disjoint scopes, touch operation at the recorded tablet viewports, cross-origin isolation on installed and shell-served navigations, screen-off export or its enforced refusal, offline localized open/effect/export, and survival of a product-version bump. |
| Accessibility | Keyboard and assistive-technology completion at supported zoom, contrast, locale, and direction. |
| Distribution | Browser and desktop workflows, licenses, notices, SHA-256 sums, authenticated runtime/catalog payloads, and unsigned package smoke. |

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
- Keep absent MIDI actions marked planned until their post-1.0 implementation
  lands; the Audacity compatibility review belongs to the same 9+ packet.
