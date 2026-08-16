# Milestone 5B pickup: Framescaper native tier

> Owning pickup contract for the Framescaper half of milestone 5. The
> [milestone-5 plan](milestone-5-plan.md) owns the shared 5.0 helper contract
> and sequencing, while the
> [roadmap](../roadmap.md#5-electron-native-services-and-extensibility)
> owns product scope and the milestone exit gate. This document owns the 5B
> packet boundaries, implementation decisions, and acceptance contract.

## Pickup status and sequencing

**Status on 2026-08-16:** The whole 5B software substrate is implemented and
tested; every part that needs a compiled binary, a cleared licensing row, or
provisioned hardware remains open. See the
[implementation record](#implementation-record-2026-08-16) for exactly which is
which.

Milestone 5B does not begin product implementation until milestones 2 through
4 and every milestone 5.0 acceptance check pass. Before that gate closes, 5B
may land only documentation, deterministic fixtures, build and licensing
research, and non-product spikes. It must not add production imports, menu
entries, capability activation, shipped native binaries, or packaging-manifest
entries.

The milestone-7 assistance implementation is not a 5.0-conformant substrate
unless it has first been re-audited and revised under the shared helper
contract. In particular, native speech recognition must not execute in the
Electron main process. The 5B implementation consumes the accepted 5.0
contract read-only; changes to that contract remain serialized 5.0 work.

Packet 5B-4 additionally waits for the shared 5A-3 isolated-host architecture
and the stable milestone-3/4 transition, generator, mask/matte, retime, and
freeze models required by the six OpenFX contexts.

The qualifying platform set is:

- Windows x64 and ARM64;
- macOS ARM64; and
- Linux x64 and ARM64.

macOS x64 is explicitly deferred. A dedicated five-target 5B evidence
environment records this scope without deleting the broader native OS matrix.
All native features are Framescaper-only, menu-reached, and disabled by
default. Disabling every helper must leave a usable Web Core and an accurate
capability report.

## Pre-gate research track

The following preparation may proceed before the product gate:

1. Re-ground canonical export authority. The current baseline contains static
   V6 and keyed V7 plans. If milestone 4 advances either plan before pickup,
   add an explicit adapter and golden for every exact accepted version; never
   accept an unknown plan generically.
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

## Implementation record (2026-08-16)

This packet is split by what a change actually needs. Everything that is
software — contracts, validators, state machines, ports, policy, capability
reporting, and product surfaces — is implemented with its tests. Everything that
needs a compiled native binary, a cleared licensing row, a provisioned lab
machine, or a signing identity is untouched, because none of those can be
produced by writing code.

### Implemented

| Area | Modules |
| --- | --- |
| Canonical plan admission | `native-media-plan-canonical-form.ts`, `native-media-plan-v6-admission.ts`, `native-media-plan-envelope.ts` |
| Capability reporting | `native-media-capability-snapshot.ts` |
| Backends and comparison | `native-media-backend-policy.ts`, `native-media-semantic-comparison.ts` |
| Data-plane sequencing | `native-media-transfer-sequence.ts` |
| Atomic publication | `native-media-atomic-publication.ts` |
| Professional tier | `native-media-professional-characteristics.ts`, `native-media-professional-profiles.ts` |
| Image sequences and proxies | `native-media-image-sequence.ts`, `native-media-proxy-recipe.ts` |
| Persistent queue | `native-queue-record.ts`, `native-queue-state-machine.ts`, `native-queue-admission.ts`, `desktop/native-services-database.ts` |
| Roots, watch, scratch | `native-durable-root-grant.ts`, `native-watch-rule.ts`, `native-watch-reconciliation.ts`, `native-scratch-policy.ts` |
| Clean display | `native-external-display.ts`, `platform/external-display-port.ts` |
| OpenFX | `native-ofx-descriptor.ts`, `native-ofx-consent.ts`, `native-ofx-binding.ts`, `native-ofx-packaging.ts` |
| Product surfaces | `ui/framescaper-native-services-menu.ts`, `ui/framescaper-native-services-copy.ts` |

The `PersistentRenderQueuePortV1` and `ExternalDisplayPortV1` contracts are
registered in the platform port policy. The three missing professional
licensing rows — HEVC/AV1, image-sequence still formats, and the MOV/MXF/
Matroska containers — exist as fail-closed blocked entries with named blockers,
and the five 5B evidence workloads are registered against the native OS lab
matrix.

### Not implemented, and why

- **Native FFmpeg and OpenFX host binaries.** No native code is compiled,
  digest-pinned, or packaged. The two blocked FFmpeg release gates and the
  per-format rows above all forbid shipping the enlarged enabled set, so a
  binary would have nothing it was allowed to decode.
- **Licensing clearance.** Every row this tier needs is `blocked` with a named
  blocker. Clearing one is a review, not an edit; the fail-closed gate is
  working as designed and admission already refuses an uncleared row.
- **The exact Framescaper project revision.** Source characteristics,
  image-sequence sources, and proxy authoring persist through a new exact
  revision that opens only *after* the milestone-4 revision is fixed. Until
  then the professional characteristics record stands on its own and is not
  wired into a persisted schema.
- **Provisioned measurement.** Every registered threshold is `planned`. The
  five native-lab fingerprints are still null, so no timing, throughput, RSS,
  display, or GPU number has been measured. Registering a number is not
  measuring it.
- **Packaging and signing evidence.** No five-target packaged run, notarization
  result, or signed execution result exists; the named signing-identity blocker
  from WP-5.0.2 is unchanged.
- **The helper tier itself, and therefore the controller and overlays.** No
  media, queue, watch, or OFX helper process is spawned. Contract v1's job-kind
  set is closed at `probe-video-source`, `audio-device`, `plugin-scan`, and
  `plugin-host`; admitting a media, render, watch, or OFX kind is a change to
  the 5.0 contract, which this packet consumes read-only. A controller cannot
  be written against a wire that refuses its jobs, so the registration,
  controller, preload, and overlay modules are not built either — and the menu
  group is consequently absent rather than present-but-inert. Enlarging the
  job-kind set is the first serialized 5.0 step this tier waits on.

Because of the last point the security matrix and threat model are deliberately
unchanged: `native-helper-processes` and `native-plugin-hosting` describe
enacted surfaces, and nothing here enacts one. The menu group is absent
entirely in a build without a native-services controller, so this change adds
no reachable surface to ship.

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
- Accept only a closed `NativeMediaPlanEnvelopeV1` union. At grounding time the
  union contains static V6 and keyed V7. A future version requires a deliberate
  adapter, validator, fingerprint rule, and parity golden.
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

After the milestone-4 revision is fixed, open the next unallocated exact
Framescaper revision for source characteristics, image-sequence sources, and
proxy authoring. Land validators, normalizers, commands/history, clipboard,
storage, `.scape`, desktop transport, feature requirements, capability
profiles, and Soundscaper preservation atomically. Earlier schemas receive the
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

OFX remains disabled until the user opens `Effects > Video Effects > Manage
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

Support Interact V1/V2, custom parameter Interacts, and DrawSuite V1. The host
renders overlay and custom-parameter surfaces offscreen. A menu-opened React
surface composites bounded frames and sends normalized pointer, keyboard, and
focus events. Plug-ins cannot create a renderer-native or top-level vendor
window.

Support the OpenFX 1.5.1 OpenGL, OpenCL, CUDA, and Metal render properties and
suites on applicable provisioned hardware. CPU rendering is mandatory. A GPU
failure retries through the standard CPU path without changing project state;
the failed GPU capability is degraded or quarantined.

### Persistence and packaging

Open the next unallocated exact Framescaper revision after the 5B-2 revision.
Persist the plug-in identifier and fingerprint, context, named inputs, typed
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
- `Project > Proxies > Generate/Attach/Detach/Relink…`;
- `Tools > Background Jobs…`;
- `Tools > Watch Folders…`;
- `Preferences > Native Media and Scratch…`;
- `View > External Display…`; and
- `Effects > Video Effects > Add/Manage OFX…`.

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

- native media plan parity and long-form decode performance;
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
2. **Media:** static and keyed plan goldens, rational CFR/VFR timing, color and
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
