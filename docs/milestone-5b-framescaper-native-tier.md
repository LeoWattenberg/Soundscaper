# Milestone 5B pickup: Framescaper native tier

> **Current-route note (2026-08-23):** Framescaper V27 is the selected M1–M4
> activation candidate. Packaged Framescaper mounts a dormant fail-closed M5
> services bridge, but V27 binds no native-media or OpenFX menu, project
> mutation, or execution authority to it. V20 through V26 labels below identify
> historical foundations, candidate contracts, typed errors, or dormant custody—
> not the selected product route. V25/V26 stay recognized, opaque, read-only,
> and no 5B activation is claimed.

> Owning pickup contract for the Framescaper half of milestone 5. The
> [milestone-5 plan](milestone-5-plan.md) owns the shared 5.0 helper contract
> and sequencing, while the
> [roadmap](../roadmap.md#5-electron-native-services-and-extensibility)
> owns product scope and the milestone exit gate. This document owns the 5B
> packet boundaries, implementation decisions, and acceptance contract.

## Pickup status and sequencing

**Audited status on 2026-08-22:** 5B is in progress and is not qualified. The
earlier claim that the whole software substrate was implemented was inaccurate:
it described validated domain records and fail-closed policy seams as though
the native controller, persistent repositories, media executors, packaged
helpers, and isolated OpenFX hosts also existed. The implementation record below
now distinguishes those layers. Framescaper V27 is the selected M1–M4
activation candidate for web and desktop, pending guided-local sign-off and
external qualification. It does not select or qualify V20–V26 native candidates
or satisfy any licensing, binary, signing, hardware, display, or manual gate.

Milestones 2 through 4 and the milestone 5.0 acceptance checks are all still
open, and 5B does not exit ahead of them. The locally green historical V20 route
was the coding prerequisite for the V22/V24/V25/V26 candidates; each candidate remains
dormant until its own exact-schema, migration, compatibility, licensing,
payload, self-test, target, signing, and manual gates pass. No native capability
is activated merely because its source contract exists. Native media, hardware
decode, hardware encode, and OpenFX consent all default off. Runtime manifests
may name only payloads that were actually built and digest-verified; an
unavailable target remains absent or `pending-external`.

The milestone-7 assistance implementation is not a 5.0-conformant substrate
unless it has first been re-audited and revised under the shared helper
contract. In particular, native speech recognition must not execute in the
Electron main process. Helper contract version 1 has been atomically enlarged
with the closed media and OFX families and bounded data plane required here;
any further wire change remains serialized 5.0 work.

Packet 5B-4 additionally waits for the shared 5A-3 isolated-host architecture
and the stable V22 transition, V24 generator/mask/matte/freeze, and exact retime
models required by the six OpenFX contexts. Implementing those prerequisites
permits host coding and hostile-fixture tests; it does not permit loading a
third-party binary in a shipped build.

The qualifying platform set is:

- Windows x64 and ARM64;
- macOS ARM64; and
- Linux x64 and ARM64.

macOS x64 is explicitly deferred. The milestone-2 closure inventory retires the
`macos-x64` desktop target, and the shared `native-os-lab-matrix` environment has
carried no macOS-x64 fingerprint since 5A removed that slot, so the deferral is
an absent row rather than a null qualification row. The five 5B evidence
workloads register against that same five-target matrix; there is no 5B-private
evidence environment. All native features are Framescaper-only, menu-reached,
and disabled by default. Disabling every helper must leave a usable Web Core and an accurate
capability report.

## Pre-gate research track

The following preparation may proceed before the product gate:

1. Re-ground canonical export authority. Historical V20 contains keyed V7 and
   static V8 plans; dormant V22 through V26 use unified exact plans V9 through
   V12. Every accepted version has an explicit adapter, validator, canonical
   fingerprint and golden; never accept an unknown plan generically.
2. Produce reproducible FFmpeg build recipes and per-target capability
   inventories for the professional codec and hardware matrix. Draft
   corresponding-source, notice, patent, and provenance rows without enabling
   distribution.
3. Register small deterministic codec/parity fixtures and a procedurally
   generated UHD long-GOP qualification workload. Test-only CLI oracles may
   consume canonical plans but must not create an application route.
4. Prototype the queue state machine, crash recovery, durable-root
   revalidation, watch reconciliation, scratch reservations, and second-display
   behavior outside production composition.
5. Build OpenFX sample hosts and plug-ins for all six contexts and all five
   target packages, including Windows Arm64EC and Linux aarch64. Failure to
   prove either architecture is an early hard blocker.

Research changes land on a clean branch as narrow docs, fixture, or test-only
commits. They do not edit the 5.0 wire contract or claim qualification from an
unprovisioned lab.

## Implementation record (audited 2026-08-22)

This packet is split by what the repository actually contains. A validated
record, menu model, or port declaration is useful substrate, but is not an
implemented service unless a main-owned repository/controller and its bounded
preload transport execute it. Likewise, a build recipe is not a payload and a
registered evidence row is not a measured result.

### Version map

| Project | Desktop library / SQLite / scope | Clipboard | Render plan | Route status |
| --- | --- | ---: | ---: | --- |
| V19 | V11 / 13 / `v11` | V5 | V8 | Reserved dormant boundary |
| V20 | V12 / 14 / `v12` | V6 | V7 keyed + V8 static | Historical provisional route; superseded by V27 |
| V22 | V13 / 15 / `v13` | V7 | V9 | Dormant transitions candidate |
| V24 | V14 / 16 / `v14` | V8 | V10 | Dormant visual-model candidate |
| V25 | V15 / 17 / `v15` | V9 | V11 | Dormant professional-media candidate |
| V26 | V16 / 18 / `v16` | V10 | V12 | Dormant OpenFX candidate |
| V27 | V18 / 20 / `v18` | V11 | V13 | Selected M1–M4 activation candidate; no M5 authority; guided/external qualification open |

V18 and V19 project media still requires typed re-import; the historical
desktop V10 library is not migrated. Future schemas remain opaque read-only,
and registered future feature IDs remain known/unavailable without authoring.
The public renderer bridge stays `framescaperDesktop.v1`; exact desktop
generation identity is authenticated inside each handshake.

### Implemented source and contract candidates

| Area | Implemented scope |
| --- | --- |
| Historical V20 foundation | Both App branches authenticated V20, enabled `videoKeyframes`, preserved V18/V19-owned behavior, and used the distinct desktop V17 boundary with immutable V12 copy-forward. Selected V27 supersedes this route; the V20 native machinery remains dormant historical candidate state. |
| Milestone-4 prerequisites | V22 transition and dissolve state plus V24 still/generator/adjustment/preset/mask/matte/freeze models include validation, commands/history where applicable, clipboard, archive, storage, desktop transport, and dormant capability profiles. |
| Exact render authority | Unified V9–V12 validators, canonical serializers/fingerprints, native envelopes, Web/native summaries and goldens exist. The exact retime ordinal oracle uses bounded arbitrary-precision rational arithmetic with a pinned Boost.Multiprecision 1.92.0 header closure. |
| Helper/media contract | Contract v1 owns exact media/OFX grants and results, 64 KiB control messages and a digest/length-bound 16 MiB-chunk MessagePort data plane. The one-to-four-worker pool defaults to two, runs one job per worker, self-tests before work and falls back hardware → native CPU → Web without plan drift. |
| Native media source | A C++20 FFmpeg 9.0.1 source pin, five-target build recipes, full extracted-tree authentication, exact Boost-header-closure verification and an empty fail-closed payload manifest exist. The closed recipe enables only ProRes decode/encode, MOV demux/mux and local files. Opt-in ambient developer-binary fixtures can exercise probe, bounded RGBA, ProRes Proxy/MOV and narrow identity-render paths, but they are not authenticated to that recipe. A bounded dormant historical-V20 V7 CPU frame core captures exact cadence, source ordinals, opacity and layered composition one frame at a time. V7 renderer production emits one authenticated evaluated-RGBA frame pack plus optional float32 WAV; main durably stages, claims and reclaims those inputs, and the carrier adapter applies exact rational timestamps, performs bounded H.264/AAC or VP9/Opus CPU encode, observes cancellation, and rechecks every source plus the temporary output before publication. V8 uses authenticated original-source authority and emits no RGBA carrier: an audio-bearing plan may stage one WAV, while silent V8 has no derived-input stage. Its closed admission captures detached residual presentation, render-description consistency and decomposition, layer order, effect/filter redundancy, delivery color, intervals and overlap opacity; this is static-semantic admission, not decode, static-geometry execution or an adapter. V8 mux, burn-in and sidecar captions refuse first with typed unsupported-caption-adapter; any other historical V20 V8 request returns the legacy-identified typed unsupported-selected-v20-static-adapter. The authenticated historical-V20 candidate operation self-test therefore remains not ready, and recipe-authenticated delivery codec evidence is also absent. V9–V12 receive closed semantic admission without serializing presentation ticks into canonical plans and cross renderer, sandbox preload and main queue with a required null derived-input stage, bypassing the legacy carrier repository. Their production queue/helper route retains declarative SCTI references, resolves exact V12 timing bodies, preflights scratch, stages bodies sequentially, mints dedicated timing grants and authenticates exact VFR ordinals in the native host. The dormant V26 route resolves current-project SCTI bodies, stages ordered digest-bound MessagePort timing grants, and authenticates VFR boundaries in the helper/native host before exact Retimer `SourceTime` comparison. V9–V12 and V26 remain dormant; broader graph execution remains typed unsupported after authority and timing authentication, and shipped VFR/Retimer execution remains unavailable, so production remains disabled. |
| Persistent services | Native-services database V2, legacy-plan blocking, queue/root/watch/scratch repositories, lease fencing, recovery, idempotent publication, external-display controller, main registration and pathless preload/controller bridge exist. The dormant native-services composition mounts exact V17 project authority, digest-bound source-body handoff, historical V20 queue admission, renderer-fed display, recovery staging, and a pathless watch-import mutation broker. Queue execution additionally requires a mounted main-owned physical-capacity authority. Each pass closes host CPU, free-memory, scratch-volume, durable-reservation, minimum-free-space and hardware budgets before the lease-fenced repository writer-atomically claims queued rows; the dispatcher executes only returned claims, and absent capacity authority keeps queue/proxy capability unavailable. Image-sequence checkpoints bind the plan fingerprint, source-inventory digest and frame count; recovery re-hashes the retained contiguous prefix and treats stale, malformed or tampered evidence as zero progress. Restart recovery detects the exact project-bin digest before recording a save whose watch acknowledgement was interrupted. Packaged Framescaper mounts this substrate fail-closed, while selected V27 binds no M5 menu, project mutation, or execution authority and does not activate the queue. Operations remain unavailable unless every off-by-default capability and runtime gate agrees. |
| V25 professional media | The existing characteristics model carries color/HDR/alpha detail; compact digest-bound image-sequence inventories and packs plus proxy generate/attach/detach/relink/reattest/adaptive/offline/cleanup state are persisted in a dormant exact candidate. Its menu-owned action accepts only pathless selected streams, resolves numeric order, rejects gaps and duplicates, publishes inventory and pack through rollback ports, binds native admission to project/revision/source/digests, and commits the source plus Project Bin clip in one history/CAS mutation. The historical V20 registration supplied no V25 mutation authority, and selected V27 keeps V25 opaque and read-only. The native probe source reports the full V25 bit-depth, pixel/chroma, range, color/HDR and alpha schema and its source self-test matches those characteristics; `alphaInterpretation` and start timecode may truthfully remain null. No authenticated payload exists, so shipped capability remains unavailable despite the implemented probe and self-test. The host source authenticates the compact sequence pack, and an opt-in ambient PNG fixture exists, but the closed recipe enables no PNG, TIFF or OpenEXR decoder and no recipe-authenticated codec evidence exists. Originals and source packs remain export authority. |
| V26 OpenFX | The OpenFX 1.5.1 signed tag is pinned; fingerprint-bound effect state, context/input/parameter/keyframe/fallback contracts and separate short-lived scanner/per-fingerprint runtime source recipes exist. A closed two-executable selector re-verifies byte length, digest and file identity before every spawn. Even a future built row is unavailable without a reviewed readiness record binding the target and both executable digests to OS isolation and real third-party execution evidence; every current row has `productionReadiness: null`. Electron main owns one-shot scanner utility processes and one supervised runtime per plug-in fingerprint; their adapters authenticate scanner grants and exact V12 data-plane jobs. Utility self-tests reject fixture mode, ambient authority, absent isolation, absent third-party execution, or the wrong pinned OFX identity before hello. Main resolves declarative SCTI references only through current-project custody and stages ordered digest-bound timing ports; the helper and native host reauthenticate the bytes and VFR boundaries before comparing Retimer `SourceTime` to the exact ordinal oracle. The controlled fixture exercises all six contexts and the V1 suite surface with bounded full RGBA planes, named inputs, padded rows and digest-verified output, and rasterizes offscreen events through the `kOfxImageEffectPluginPropOverlayInteractV2` property backed by Interact Suite V1 and DrawSuite V1. The renderer-facing inventory/scan/enable/Add source route and verified future-payload stager are source-implemented and candidate-tested. Shipped activation remains unavailable because V26/ofxEffects and runtime readiness are false, both manifests are empty, and genuine payload, signing, isolation and target evidence are absent. The interactive React event/compositing route and production-attested third-party execution/frame integration also remain unavailable; production therefore refuses third-party loading and no shipped process loads a plug-in binary. |
| Product/evidence surfaces | Framescaper-only menu models, lazy native-services dialogs, default-off settings and five strict workload-runner, measurement-validator, and digest-bound evidence-writer pipelines are present. Dormant V22/V24 transition and visual commands plus V25/V26 native actions are reachable through existing menus only when their exact candidate controller, project profile and runtime capabilities agree; selected V27 does not bind those M5 actions. Image-sequence selection keeps paths in main and exposes owner-bound opaque range capabilities. Each evidence pipeline can directly spawn one absolute executable without a shell, under bounded time/output, and admits exactly one pipeline-bound JSON diagnostic; hosted execution is refused. Accepted publication still occurs only when the exact lab environment, target fingerprint, fixture, workload, threshold cohort, and observed measurement all agree. Browser coverage exercises keyboard/focus return, forced colors and serious/critical axe checks. Soundscaper receives no 5B surface. |

The `PersistentRenderQueuePortV1` and `ExternalDisplayPortV1` contracts remain
registered in platform policy. HEVC/AV1, image-sequence still formats,
MOV/MXF/Matroska, hardware codecs and OpenFX remain fail-closed licensing rows
with named blockers.

### Still open and release-blocking

- **Native payloads and executable feature depth.** Both 5B payload manifests
  contain zero payloads and all five targets are `pending-external`. The media
  host's V7 evaluated-RGBA/optional-audio encoder, carrierless V8
  original-source/static-semantic admission, and the OpenFX scanner/runtime
  V12 conformance seam are source candidates, not shipped
  decode/encode/render/proxy or third-party hosting. The historical-V20
  candidate operation self-test remains not ready until native static-geometry execution/adapter,
  caption-delivery evidence and recipe-authenticated delivery codecs exist. The
  native media queue/helper route authenticates digest-bound VFR timing bytes, and
  the dormant OpenFX candidate now authenticates project-custodied SCTI before exact
  `SourceTime` comparison, but shipped and production-attested Retimer execution,
  transitions, visual/mask/generator graphs, broader
  V9–V12 execution, broader professional-media graphs and
  hardware backends remain typed fail-closed. OpenFX's inventory/scan/enable/Add
  source route and verified future-payload stager are candidate-tested, but
  shipped activation remains unavailable because no genuine built row or
  readiness evidence exists. The interactive React event/compositing route,
  production-attested third-party execution/frame integration and reviewed isolation remain
  absent.
- **Licensing clearance.** Professional codec/container, hardware, FFmpeg
  corresponding-source/patent, and OpenFX rows remain blocked. Source pins and
  notices do not clear a licensing or redistribution gate.
- **Provisioned measurement.** Every 5B workload remains `planned`; the bounded
  runners exist, but while the native lab is unprovisioned the five collectors
  can write only `pending-external` or failed evidence. Accepted publication is automatic—not
  a CLI override—and additionally requires the exact registered target
  fingerprint and qualified workload/fixture cohort. No throughput, timing,
  RSS, display, GPU or hardware claim is qualified.
- **Packaging and signing evidence.** No five-target packaged execution,
  Windows Arm64EC or Linux aarch64 host proof, signing, notarization, codec,
  display, GPU, or manual qualification result exists.
- **Activation.** V22 through V26 stay dormant, native media/hardware/OFX
  settings default off, and all operational actions remain unavailable unless
  both project and authenticated runtime capabilities permit them.

Security and threat-model rows follow the enacted pathless controller and
source candidates while retaining these blockers. A build recipe is never
treated as a payload, and a locally green candidate is never treated as release
qualification.

## 5B packet map

The implementation order is:

1. Native media engine and exact plan parity.
2. Professional decode, encode, color, sequence, and proxy support.
3. Persistent queues, durable roots, watch folders, managed scratch, and clean
   display output.
4. Full isolated OpenFX 1.5.1 hosting.
5. Five-target exit evidence and capability activation.

The queue foundation may proceed alongside advanced media adapters after the
5B-1 public contracts are fixed. OFX remains independently gated by 5A-3.

## 5B-1 — Native media engine

### Outcome and boundaries

Provide multithreaded native FFmpeg probing, decoding, and encoding behind the
versioned 5.0 helper contract. The native path consumes the exact canonical
export plans used by Web Core and lifts long-form decode throughput without
creating a second editor or renderer model.

The native media master switch is off by default. Native CPU processing becomes
available after explicit opt-in. Hardware decode and hardware encode are
separate default-off opt-ins with mandatory native-CPU fallback; complete
helper disablement falls back to Web Core.

### Helper and transfer contract

- Reuse the accepted 5.0 supervisor, grants, negotiation, heartbeat,
  cancellation, quarantine, resource policy, structured errors, and binary
  attestation.
- The media utility process may invoke only digest-pinned FFmpeg and ffprobe
  binaries through internally generated, allowlisted arguments. Renderer
  requests contain neither paths nor raw command-line fragments.
- Implement the existing probe, decode, encode, streaming media, and render-job
  ports. Preserve the 64 KiB control-message and 16 MiB media-chunk hard limits,
  sequence validation, backpressure, and `AbortSignal` behavior.
- Accept only the closed `NativeMediaPlanEnvelopeV1` union of exact V7 through
  V12 plans. Every future version requires a deliberate adapter, validator,
  fingerprint rule and parity golden; unknown versions never pass generically.
- Main-revalidated linked files may use direct helper-scoped sources. Media
  owned by browser storage crosses bounded streams. Raw-frame and audio
  intermediates remain bounded and backpressured.
- Every final output is written to a temporary sibling in the destination root,
  verified, and atomically renamed. Cancelled, failed, stale, or superseded jobs
  publish nothing.

### Hardware backends

Runtime capability is the intersection of the pinned build, driver probe,
self-test, codec row, operation, and user opt-in:

| Platform | Candidate backends |
| --- | --- |
| Windows | D3D11VA, Media Foundation, QSV, NVDEC/NVENC, AMF |
| macOS | VideoToolbox |
| Linux | VAAPI, QSV, NVDEC/NVENC, AMF where the pinned build supports them |

A failed hardware job retries once on native CPU without changing its semantic
plan. The failing backend becomes degraded or quarantined according to the 5.0
policy and is reported visibly. Hardware output is compared semantically, not
by encoded-byte identity.

### Acceptance

- Canonical plan fingerprints, frame counts, rational timestamps, source
  presentation, composition, effects, keyframes, audio inclusion, and final
  duration agree between Web and native consumers.
- Lossless paths are pixel exact. Lossy comparisons require SSIM at least
  `0.995` and PSNR at least `45 dB`; A/V endpoints differ by no more than one
  output frame.
- On provisioned reference hardware, the registered UHD long-GOP workload
  reaches at least twice the wasm throughput and at least realtime throughput
  on native CPU. An enabled hardware backend must not regress native CPU on its
  registered workload.
- Cancellation acknowledgement p95 remains at or below 1,000 ms; crash
  detection remains at or below 2,000 ms; editor recovery remains at or below
  5,000 ms; helper process-tree RSS remains at or below 1 GiB.
- Direct-sink backpressure, cancellation, helper death, renderer restart, and
  stale-plan tests produce no late or partial publication.

### Non-goals and stop condition

This packet adds no native-only timeline, render-plan vocabulary, delivery
preset, network media protocol, or renderer/main-process native execution. Stop
if semantic parity requires weakening the canonical plan, if a transfer becomes
unbounded, or if either CPU or Web fallback cannot remain truthful.

## 5B-2 — Professional media tier

### Outcome and boundaries

Add professional long-GOP, high-resolution, 10-bit/HDR, image-sequence, alpha,
mezzanine, and proxy behavior on top of 5B-1. This packet owns engine
capabilities and minimal technical export choices. Milestone 6 continues to own
delivery presets, platform deliverables, caption packaging, and publishing
workflows.

### Source and format contracts

Extend exact-or-unreported source characteristics with:

- bit depth, pixel and chroma format, and range;
- color primaries, transfer function, and matrix coefficients;
- mastering-display and content-light metadata; and
- alpha presence, mode, and interpretation.

No consumer infers an HDR or color fact that probing did not establish. A
profile that cannot preserve required bit depth, HDR metadata, or alpha rejects
before work begins rather than flattening or relabeling the output.

The required professional baseline is:

| Operation | Formats |
| --- | --- |
| Decode | AVC/H.264, HEVC/H.265, VP9, AV1, ProRes, DNxHR, PNG/TIFF/OpenEXR sequences |
| Encode | Existing MP4/WebM profiles, ProRes/MOV, DNxHR/MXF, FFV1/Matroska, alpha PNG/TIFF/OpenEXR sequences |

Every operation, codec, container, profile, and hardware combination has a
fail-closed licensing and provenance row. Because this baseline is required,
an uncleared row blocks 5B exit rather than silently narrowing the tier.

### Image sequences and proxies

- `File > Import > Image Sequence…` opens the only sequence-authoring path.
  Numeric ordering is explicit, the rational frame rate is user-selected, and
  missing or duplicate frame numbers reject before project mutation.
- Complete the existing proxy relationship rather than inventing another
  model: background generation, atomic claim/attachment, detach,
  attach/relink, reattestation, adaptive preview, offline reporting, and
  original-authoritative export.
- The default proxy profile is ProRes Proxy in MOV, maximum 1280×720 while
  preserving aspect ratio and exact timing. Proxy-container audio remains
  ignored under the existing policy. Failure of the ProRes gate leaves proxy
  generation blocked; it does not choose an undocumented substitute.
- Proxy generation is an atomic-restart queue job. Generated bodies and timing
  evidence use the existing content-addressed staging, claim, cleanup, and
  reattestation lifecycle.

### Project revision

V25 is the exact dormant Framescaper revision for source characteristics,
image-sequence sources and proxy authoring: desktop library V15, SQLite
user_version 17, scope `v15`, clipboard V9 and unified render plan V11. Its
validators, clipboard, storage, archive/transport, capability profiles and
Soundscaper custody contracts land together. Earlier schemas receive the
existing typed re-import result; future schemas remain opaque and read-only.

### Acceptance

- One licensed fixture row covers every required format and profile.
- Long-GOP seek and cut-boundary tests, high-resolution resource refusal,
  10-bit/HDR pixel and metadata observations, image-sequence ordering, alpha,
  and mezzanine round trips pass on applicable targets.
- Proxy generation, attach/detach, adaptive preview, offline/relink, save/open,
  archive, cleanup, and original-authoritative export pass without making an
  attached project intrinsically read-only.
- Helper-disabled projects preserve all authored state and either use the
  original Web path or report an unavailable native requirement without
  mutation.

### Non-goals and stop condition

There are no Milestone 6 delivery presets or automatic watched-folder exports.
Stop on an uncleared patent/source/provenance gate, guessed color metadata,
unreported alpha loss, proxy timing divergence, or export that consumes a proxy
as the authoritative source.

## 5B-3 — Persistent services and clean display

### Durable service database

Add a main-owned `framescaper-native-services.sqlite` database, separate from
the project-library database. It uses strict tables, WAL, full synchronous
commits, explicit schema migrations, future-version refusal, and a
single-writer lease. A second process cannot dispatch work.

Queue rows contain bounded descriptions only:

- task kind and immutable canonical plan version, payload, and fingerprint;
- project and revision identity plus input fingerprints;
- opaque root/grant identifiers and a validated relative destination;
- declared resource reservations and recovery class; and
- state, progress, attempt, and audit metadata.

They contain no raw paths or media bytes.

### Queue behavior

- Admit between one and four jobs, default two. CPU, process-tree RSS, hardware,
  scratch, and minimum-free-space reservations may lower concurrency.
- The source candidate constructs dispatch only when project/source and
  main-owned physical-capacity authorities are both mounted. Each pass samples
  current host parallelism, free memory and scratch-volume capacity, deducts
  running and durable reservations, then lets the lease-fenced repository claim
  the admitted queued rows as running in one immediate writer transaction.
  Dispatch executes only returned claims; without capacity authority the queue
  and proxy capability report stays unavailable.
- Support FIFO order, user reorder, pause, resume, cancel, retry, and structured
  progress through `PersistentRenderQueuePortV1`.
- Encoded exports and proxies declare `atomic-restart`. Image sequences alone
  may declare `verified-frame-checkpoint`, and only after each existing frame
  passes the plan, source, frame-number, size, and digest checks.
- Pausing a running atomic job cancels it into a clean restartable state; it
  never suspends an arbitrary encoder process or claims container-byte resume.
- Recovery revalidates the project revision, plan, sources, roots, licensing,
  helper build, and scratch identity before redispatch. A mismatch becomes a
  typed blocked or `needs-authorization` state.
- Dispatch and final commit are idempotent. Publication uses a temporary sibling
  in the destination root followed by verification and atomic rename.

### Durable roots, watch folders, and scratch

Persistent jobs require a user-granted destination root; expiring one-use save
tokens are never persisted. Root paths are main-private and renderer-visible
only as opaque IDs. Startup revalidation checks canonical path, filesystem
identity, containment, and revocation. A changed or moved root requires new
authorization.

A watch rule contains a root grant, target project/bin, extension filter,
bounded recursion flag, explicit link-or-copy import mode, and optional proxy
generation. Linking is the default. Recursion is off by default and never
follows directory symlinks.

`fs.watch` is only a latency hint. Startup and 30-second bounded reconciliation
are authoritative. A candidate becomes stable after two unchanged size/mtime
observations at least two seconds apart and a successful probe. Canonical file
identity and content fingerprint prevent duplicate import across repeated,
rename, overflow, and restart events. A closed or read-only project leaves a
pending ingest; main never mutates project state behind its controller.

Managed scratch uses one authenticated directory per job. At every admission:

- managed use is capped at the lesser of 100 GiB or 20% of the volume;
- the greater of 10 GiB or 10% of the volume remains free; and
- users may lower, but not raise, the computed cap.

Successful and cancelled scratch is removed immediately. Failed scratch is
retained for seven days for retry and diagnostics. Cleanup deletes only a
directory whose manager-owned manifest, job ID, and root identity all match.

### Clean external display

`View > External Display > <non-primary display>` opens a sandboxed, frameless,
full-screen programme window on the selected display. It consumes the same
evaluated frame stream and transport clock as the editor; it is not a second
render engine. Audio continues through the existing selected mix device.

The selection is session-only and remains off after restart. Escape and the
menu command close the window. Display removal closes it and reports the loss.
HDR output requires trusted display/color capability; otherwise the surface is
explicitly SDR. Native Wayland reports unavailable because exact placement is
not dependable; Linux qualification runs under X11/XWayland.

### Acceptance

- Queue schema/migration/future refusal, state transitions, adaptive admission,
  reorder, pause, retry, duplicate process, crash in every state, corrupt or
  truncated database, and exactly-once publication pass.
- `unrecoveredJobs`, partial publications, unauthorized grants, traversal
  escapes, duplicate watch imports, and deletion of external files are all
  zero in the registered fault workload.
- Root change/revocation, symlink escape, missed watch events, rename/delete,
  file stability, disk full, reservation contention, stale scratch, and crash
  leftovers produce the specified recoverable states.
- Matching-rate 1080p60 and UHD30 clean-display cohorts run for 30 minutes with
  no corrupt or reordered frames, no unexplained drops, and A/V drift no
  greater than one sequence frame.

### Non-goals and stop condition

This packet adds no background OS daemon, automatic delivery export, separate
external-display audio route, SDI, DeckLink, AJA, NDI, or native Wayland
placement claim. Stop if recovery needs an unrevalidatable path, final
publication is non-atomic, scratch cleanup can touch user content, watch
traversal escapes its root, or external display requires a second renderer.

## 5B-4 — Full isolated OpenFX 1.5.1

### Host and discovery model

Use a dedicated C++20 OFX host under the 5A-3 lifecycle. No OpenFX binary is
loaded by Electron main, a renderer, or the media helper. Scanning uses
short-lived isolated processes; runtime hosting keeps one plug-in binary
fingerprint per process boundary.

OFX remains disabled until the user opens `Effect > Video effects > Manage
OFX…`, grants scan consent, and enables a discovered binary. Standard and custom
search roots use main-owned grants. Descriptors bind plug-in ID, vendor,
version, bundle identity, binary digest, supported contexts, parameters,
components, pixel depths, threading declarations, and suites. A changed binary
is a different capability and cannot inherit consent silently.

The host sees only the selected plug-in bundle, bounded input frames, and its
managed scratch allocation. Network access is denied. Crashes, hangs, resource
violations, malformed descriptors, or repeated failures quarantine the binary
fingerprint without taking down the editor.

### Context mapping

Implement every OpenFX 1.5.1 Image Effect context:

| Context | Framescaper binding |
| --- | --- |
| Generator | External generator source with explicit project raster and time properties |
| Filter | Video clip or adjustment-layer effect |
| Transition | Milestone-4 explicit transition object and standard `Transition` parameter |
| Paint | Effect with an explicit source and mask/matte input binding |
| Retimer | Exact milestone-3 retime mapping and standard `SourceTime` parameter |
| General | Bounded external-effect source with explicit named input bindings and one output |

General-context support does not introduce a general-purpose node compositor.
Input bindings name existing project sources or resolved timeline outputs and
remain subject to the existing cycle/depth limits.

### Suites, rendering, and Interacts

Implement the complete 1.5.1 host surface: property and image-effect suites,
standard and parametric parameters, progress, timeline, messages, memory,
multithread, dialogs, regions and frames-needed actions, render threading and
sequential declarations, and abort polling.

The pinned OpenFX 1.5.1 API defines Interact V1, not an Interact V2 suite; do
not advertise or invent a vendor V2 contract. Support Interact V1, custom
parameter Interacts, and DrawSuite V1. The host renders overlay and
custom-parameter surfaces offscreen. A menu-opened React
surface composites bounded frames and sends normalized pointer, keyboard, and
focus events. Plug-ins cannot create a renderer-native or top-level vendor
window.

Support the OpenFX 1.5.1 OpenGL, OpenCL, CUDA, and Metal render properties and
suites on applicable provisioned hardware. CPU rendering is mandatory. A GPU
failure retries through the standard CPU path without changing project state;
the failed GPU capability is degraded or quarantined.

### Persistence and packaging

V26 is the exact dormant OpenFX revision: desktop library V16, SQLite
user_version 18, scope `v16`, clipboard V10 and unified render plan V12. Persist
the plug-in identifier and fingerprint, context, named inputs, typed
parameters and keyframes, bounded custom-parameter encodings, enabled state,
and fallback descriptor. Missing, changed, crashed, revoked, or quarantined
plug-ins preserve authored state and offer bypass or verified frozen playback.

Package and qualify OFX on all five targets:

- Windows x64 uses `Win64`;
- Windows ARM64 uses a dedicated Arm64EC host and `Win-arm64ec`;
- macOS ARM64 uses `MacOS`;
- Linux x64 uses `Linux-x86-64`; and
- Linux ARM64 uses the standard-documented `Linux-aarch64`
  forward-compatibility convention.

The OpenFX 1.5.1 packaging, context, suite, and Interact documentation is the
normative authority. No vendor-specific extension is advertised. CPU and
Interact/Draw qualification is required on every target; each GPU mechanism is
qualified on the applicable provisioned hardware.

### Acceptance

- Official/sample and hostile fixtures cover every context, suite, parameter
  type, Interact mode, threading declaration, CPU/GPU fallback, missing binary,
  fingerprint change, and frozen/bypass recovery.
- Discovery, consent, denial, revocation, quarantine, network/filesystem denial,
  crash, hang, cancellation, process-tree RSS, and per-platform packaging pass.
- Preview and offline export consume the same effect state and canonical plan.
  Unsupported or failed GPU work visibly falls back without state mutation or
  silent omission.
- All five target packages discover and render their architecture-appropriate
  conformance plug-ins. A failure on any target blocks 5B exit.

### Non-goals and stop condition

There is no in-process host, arbitrary vendor window, vendor-specific API,
instrument plug-in, or project-supplied executable. Stop on an unsupported
target ABI, uncontained native failure, unsafe or lossy state preservation,
renderer authority, or any format that requires in-process loading.

## 5B-5 — Capability activation and exit evidence

### Product surfaces

Every feature is reached through an existing menu family and opens lazily:

- `File > Import > Image Sequence…`;
- `File > Export > Add to Render Queue…`;
- `Tools > Background Jobs…`;
- `Tools > Watch Folders…`;
- `Tools > Proxies > Generate/Attach/Detach/Relink…`;
- `Tools > Native Media and Scratch…`;
- `View > External Display…`; and
- `Effect > Video effects > Add OFX…` or `Manage OFX…`.

No always-visible toolbar control, panel, side rail, badge, or inline control is
added. Extract focused strict-TypeScript registration, controller, preload,
menu, and overlay modules rather than growing maintained files at their current
ratchets. Soundscaper receives no native-video or OFX UI.

### Public contracts

| Contract | Required behavior |
| --- | --- |
| `NativeMediaPlanEnvelopeV1` | Closed union of exact canonical plan versions with validation and fingerprinting before I/O |
| `NativeMediaCapabilitySnapshotV1` | Per codec, operation, backend, queue, watch, scratch, display, and OFX state with reason, build fingerprint, and user-enabled flag |
| `PersistentRenderQueuePortV1` | `enqueue`, `list`, `events`, `reorder`, `pause`, `resume`, `cancel`, and `retry`; execution remains behind `RenderJobHostPort` |
| `DurableRootGrantV1` | Opaque renderer ID, main-private path and identity, explicit revalidation, and revocation |
| `WatchRuleV1` / `ScratchPolicyV1` | Closed bounded rules, quota/reservation policy, and no implicit repair |
| `ExternalDisplayPortV1` | `listDisplays`, `open`, `present`, `close`, and typed loss/status events; no project persistence |
| `OfxPluginDescriptorV1` / `OfxEffectBindingV1` | Fingerprint-bound descriptors, exact context/input/parameter state, and bypass/frozen fallback |

`NativeMediaCapabilitySnapshotV1` distinguishes `disabled`, `blocked-policy`,
`unavailable`, `available`, `degraded`, and `quarantined`; availability never
implies user enablement.

### Evidence registration

Register 5B-specific workloads and collectors rather than treating the existing
helper/audio workload as sufficient:

- native media plan parity and long-form decode performance, including the
  retired V18 exit workload's two-hour exact audio/video/nested/multicamera
  continuity requirement over attached-proxy, verified-VFR, and source-timecode
  state, now evaluated against the current registered plan family;
- professional codec, color, image-sequence, alpha, and proxy behavior;
- queue, durable-root, watch, and scratch recovery;
- clean external-display timing and correctness; and
- OpenFX conformance, failure isolation, and packaging.

Correctness and fault suites run in ordinary CI. Timing, RSS, display, hardware,
and GPU numbers qualify only on provisioned, fingerprinted, no-retry hardware.
Hosted packaging jobs are distribution evidence, not hardware qualification.

### Required test layers

1. **Helper contract:** 10,000 malformed and hostile messages, oversized and
   replayed traffic, wrong-job grants, navigation/restart, timeout, kill,
   cancel-under-load, quarantine, resource exhaustion, binary tamper, and
   network/child-policy denial.
2. **Media:** V7 through V12 plan goldens, rational CFR/VFR timing, color and
   alpha, audio, direct-sink backpressure, CPU/Web/hardware parity, cancellation,
   and atomic output.
3. **Professional formats:** one fixture per licensed row, long-GOP boundaries,
   high-resolution refusal, HDR observations, image-sequence errors,
   mezzanine round trips, and the complete proxy lifecycle.
4. **Persistent services:** schema migration and future refusal, every queue
   crash state, duplicate dispatch/process, root changes, watch overflow and
   traversal, disk full, reservations, cleanup, and zero partial publication.
5. **OpenFX:** every context and suite, standard/custom parameters, Interacts,
   threading, GPU/CPU fallback, crash/hang/resource denial, state survival, and
   all-five packaged execution.
6. **Product UI:** Framescaper-only menu reachability, default-off behavior,
   keyboard and focus return, forced colors, serious axe findings, save/reopen,
   Soundscaper absence, and all-helpers-disabled degradation.
7. **Packaging and policy:** helper and OFX tamper failures, binaries outside
   Pages and asar, unchanged fuses, notices/corresponding source, and applicable
   signing and notarization.

During implementation, run focused unit suites after each domain/helper slice,
desktop tests for real process behavior, a build before focused Chromium tests,
then the full browser suite. The final candidate runs `npm run check`, the full
desktop and browser suites, and packaged smoke on all five targets.

### Exit decision

5B is complete only when:

- all required codec and OFX policy rows are clear;
- all five platform packages pass their applicable functional and packaging
  suites;
- provisioned performance evidence meets the registered thresholds;
- helper, queue, watch, scratch, display, and OFX fault tests recover without
  corrupt state or partial publication;
- native/Web plan parity and plug-in bypass/frozen behavior pass; and
- disabling every helper leaves Web Core usable with an accurate capability
  report.

An unprovisioned target, blocked professional codec, failed Windows Arm64EC or
Linux aarch64 OFX host, missing signature/notarization evidence, or unresolved
semantic divergence leaves the packet or milestone open. No row is waived or
relabeled to manufacture completion.

## Explicit non-goals

- macOS x64 qualification;
- SDI, DeckLink, AJA, NDI, or separate external-display audio routing;
- native Wayland display-placement claims;
- Milestone 6 delivery presets or watched-folder automatic exports;
- Framescaper camera, microphone, display, or voiceover capture;
- MIDI, instruments, or control surfaces;
- arbitrary network media or renderer/main-process native execution;
- in-process or vendor-extended OpenFX hosting;
- auto-update; and
- any new default-visible application chrome.
