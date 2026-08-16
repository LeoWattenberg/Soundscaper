# Milestone 5A plan: Soundscaper native services

> Owning plan for the Soundscaper half of milestone 5. The
> [milestone-5 plan](milestone-5-plan.md) owns the shared helper contract and
> sequencing, and the
> [roadmap](../roadmap.md#5-electron-native-services-and-extensibility) owns
> product scope and status. This document owns 5A readiness, architecture
> decisions, all unfinished work from 5A-0b through 5A-4, packet boundaries,
> acceptance, and stop conditions.

## Status and readiness

**Status on 2026-08-14: 5A-0a is implemented provisionally in the local tree;
5A-0b is next. Native audio and plug-in surfaces remain disabled.** The plan
was grounded at commit `9d8427dd`; this implementation status includes the
implemented 5A-0a slice and is not a formal qualification claim.

The prerequisite foundations are physically present:

- The milestone-5 helper is real, not a type-only or injected-channel sketch.
  Main calls `utilityProcess.fork()` in `desktop/helper-registration.mjs`; the
  process speaks contract v1 through `desktop/helper-probe-process.js`, and
  `desktop/helper-supervisor.ts` owns verification, heartbeat, cancellation,
  restart, and in-session quarantine.
- Renderer requests remain pathless. The probe surface accepts an opaque read
  capability, main resolves and re-verifies the file identity, and the helper
  engine payload is digest-checked before spawn and again before execution.
- The first surface is menu-reached, off by default, owner-revoked, and falls
  back visibly to the WebAssembly probe.
- Soundscaper V21's exact per-path PDC and authored freeze lifecycle now exist
  in `project-path-pdc-plan-v21.ts`, `audio-track-freeze-v21.ts`, and their
  coordinator, playback, persistence, and command integrations. They are
  implemented provisionally rather than still-missing 5A-3 prerequisites.
- Existing bounded-transfer, transferable PCM queue, audio-device port,
  effect-host port, recording-routing, opaque effect-state, menu, packaging,
  and quality-result seams are sufficient anchors for the first implementation
  slice.

That is a **yes** to continuing at 5A-0b. It is not a claim that 5A-1, 5A-2, or
5A-3 already has its native implementation. The implemented local slice and
remaining gaps are explicit:

1. **5A-0a baseline and contract closure — implemented provisionally.** The
   reviewed smoke bridge now includes all four helper methods, the packaging
   test uses its runtime-import inventory, and the timing-probe fixture uses the
   current Soundscaper V21 storage profile with cross-realm diagnostics.
   Fresh-project creation publishes the default track in canonical revision
   zero; coalesced autosaves accept only strictly higher safe-integer revisions
   under the exact prior revision-and-SHA witness; clean flushes do not replay
   equal revisions. One fresh local Linux x64 package and one no-retry packaged
   timing-probe run passed both pinned CFR and VFR fixtures. This is not the
   real packaged helper proof owned by 5A-0b. Contract v1 now admits a
   closed set of probe, audio-device, plug-in-scan, and plug-in-host kinds with
   kind-correlated grants and deny-only resource controls. Every family passes
   a universal control-envelope gate bounded exactly at 64 KiB and has
   pre-semantic oversize and wrong-direction rejection, while binary admission
   retains its separate bound. The deterministic assigned-direction corpus now
   rejects exactly 10,000 malformed cases; a separate hostile-object suite
   covers accessors, symbols, unusual prototypes, sparse arrays, cycles, excess
   nesting, and shared memory without invoking getters.
2. **5A-0a supervision — implemented provisionally.** Main validates grants
   before spawn, helpers negotiate their supported subset, heartbeat/job
   generations are checked, and progress is bounded, monotonic, and suppressed
   after cancellation. Cancellation acknowledgement waits for engine-thread
   termination. Duration, RSS, cancellation-timeout, channel, and contract
   terminations are qualifying quarantine faults; acknowledged user
   cancellation and editor shutdown are not. Local tests measure fresh-helper
   recovery against the five-second ceiling. The callback is suitable for the
   existing task coordinator, but the product progress UI/coordinator hookup is
   deliberately follow-on work.
3. **5A-0b native payload provenance and packaged proof.** The probe reuses pinned FFmpeg WebAssembly
   bytes. There is no target-selected N-API/addon manifest, native build,
   staging rule, release inventory, or packaged native-helper smoke yet. These
   are 5A-0b deliverables.
4. **5A-0c real-time data plane.** The current chunk stream is renderer worker ->
   renderer client -> AudioWorklet. No helper -> AudioWorklet path exists. The
   existing promise/chunk ports are valid control and offline abstractions but
   do not prove a zero-underrun real-time path. This is 5A-0c.
5. **Product implementations and evidence.** There is no OS audio backend,
   scanner, plug-in host, vendor UI host, native fixture set, M5 collector, or
   provisioned native lab. Those are 5A-1 through 5A-4 outcomes. Signing
   identity and hardware qualification may remain externally blocked while
   implementation proceeds; no blocked row is promoted or simulated.

The entry rule is therefore exact: **start 5A-0b next**. Do not start backend
or host breadth merely because the hardened proof helper exists. Scanning may
start after 5A-0b; native audio and real-time hosting also require 5A-0c.

## Non-negotiable invariants

- Main owns process creation, executable selection, raw paths, device grants,
  plug-in roots, and revocation. The renderer receives opaque IDs and bounded
  status only; preload exposes no spawn, arbitrary path, native module, file,
  child-process, or network primitive.
- A helper process is crash containment, not a claim that arbitrary native
  code loses all ordinary user-account authority. The UI and threat model say
  so. OS-enforced restrictions are recorded per target; absent restrictions are
  residual risk, never described as a sandbox.
- Native services accelerate or execute canonical editor plans. They do not
  own project revisions and cannot publish project state. Failure leaves the
  last revision intact.
- No native code loads into Electron main, preload, renderer, or an
  AudioWorklet. Native adapters load only inside supervised utility processes.
- Control messages are closed, versioned, discriminated, and bounded. PCM and
  opaque state use their dedicated bounded channels and never ride as an
  unbounded control result.
- Every user-facing surface is opened from an existing menu or submenu and is
  off by default. Web builds omit or truthfully disable native entries.
- Disabling or revoking all helpers leaves Web Core usable. Missing plug-ins
  and opaque state survive desktop, `.scape`, and AUP4 round trips.
- Instruments may be identified by scanning but are never offered for use
  before milestone 8B. MIDI devices, MPE, clock, MTC, and control surfaces are
  outside 5A.

## Frozen architecture decisions

### Process and native stack

- Electron `utilityProcess` remains the only process primitive. A narrow N-API
  addon is loaded inside each relevant helper; `worker_threads` may isolate a
  helper's internal job but never substitutes for the process boundary.
- JUCE 9 is the common device and hosted-format integration layer. CLAP uses
  the direct CLAP ABI so its lifecycle and extensions are not reduced to the
  JUCE abstraction. The acquisition packet pins exact source revisions,
  digests, licenses, and notices before compiling either one; a version named
  in this plan is not provenance evidence by itself.
- Native helper/addon payloads ship outside the asar as target-selected,
  digest-pinned resources. JavaScript helper entrypoints may remain inside the
  fuse-protected asar. No incidental `asarUnpack` or runtime rebuild is allowed.
- The claimed matrix is five targets: Windows x64, Windows ARM64, macOS ARM64,
  Linux x64, and Linux ARM64. macOS x64 is retired and is not a null
  qualification row.

### Real-time transport

- 5A uses a directly transferred `MessagePort` between the utility helper and
  the AudioWorklet, with a fixed reusable pool of ordinary `ArrayBuffer`
  packets. Renderer main participates in setup and revocation but is not the
  per-block relay. `SharedArrayBuffer` is not introduced by this milestone.
- The proof starts with the existing 1,024-frame planar-f32 packet vocabulary,
  contiguous sequence checks, bounded queues, ownership transfer, underrun
  events, and cancellation semantics. Packet and queue sizes may be lowered by
  measured proof; they are not raised past existing hard limits to hide
  starvation.
- The AudioWorklet clock is authoritative for playback/monitor deadlines. Each
  packet carries generation, sequence, and absolute start frame. A returned
  buffer is the only credit for another send. Stale-generation packets are
  discarded and cannot satisfy a new stream.
- A helper crash, missed deadline, non-contiguous packet, pool leak, or queue
  overflow closes that generation exactly once. Offline work may retry from a
  canonical plan; real-time work never silently replays stale audio.
- Stop 5A-1 and 5A-3 if Electron cannot transfer the port without renderer-main
  per-block relay, if a peer can force main to deserialize unbounded control
  data, or if the synthetic packaged loop cannot meet the registered latency,
  underrun, cancellation, recovery, and RSS limits.

### Audio backends and device loss

- macOS: CoreAudio. Windows: WASAPI shared and exclusive, plus separately
  licensed and selected ASIO. Linux: JACK when available and ALSA as the direct
  fallback. Backend and mode are explicit capability/status fields; fallback is
  never mislabeled as the requested mode.
- Native inventory adapts into the existing recording-routing service. Stable
  IDs, saved preferences, channel selections, and calibration offsets are not
  forked into a second model.
- Input loss during recording commits the already-captured prefix through the
  existing recording publication path, stops that input, and reports the loss.
  It never fabricates silence as recorded source. Input loss outside recording
  closes the stream.
- Output loss stops monitoring immediately. Playback may explicitly fall back
  to Web Core/default output if compatible; the UI reports the backend/mode
  change. The project is unchanged in every case.
- Exclusive-mode denial falls back only after a visible choice or a previously
  recorded user policy. Calibration is keyed by stable input/output/backend/
  mode/sample-rate/buffer identity and becomes stale when any member changes.

### Scanning, identity, consent, and quarantine

- Scanner and host are separate helper kinds and separate security controls.
  Scanning loads no plug-in into a hosting process and grants no project audio.
- Consent is per format. Standard OS roots are offered explicitly; custom roots
  come only from a main-owned directory picker. Nothing scans at startup, and
  raw roots or binary paths never cross into renderer state or project files.
- The registry identity is format + format-native stable ID. Installations add
  platform, architecture, version, and binary digest. A stable-ID collision is
  ineligible until the user selects one installation; path order never chooses
  silently. A changed digest is a new unreviewed installation.
- The scanner records effect/instrument classification, channel/topology
  support, real-time/offline support, reported latency capability, signature
  and trust result, compatibility result, and descriptor version. Instrument
  entries remain non-materializable.
- A scanner crash, hang, malformed/oversized answer, or identity change
  quarantines that digest immediately and durably. A host digest is quarantined
  after two qualifying host faults in ten minutes. User cancellation, device
  loss, and editor shutdown are not faults. Quarantine survives restart and is
  cleared only by explicit rescan/re-enable of that digest.
- Unsigned or unverifiable code is never silently eligible. Where platform
  policy permits it, one explicit warning and allow decision may authorize one
  exact digest; a binary change revokes that decision.

### Hosting, state, PDC, and vendor UI

- VST3 and CLAP are cross-platform targets; Audio Units is macOS-only and LV2
  Linux-only. Each format remains disabled until its platform/source/license/
  notice row and packaged fixture pass.
- Isolation is one host process per renderer owner and plug-in binary digest.
  Multiple instances of that exact digest may share the host, but unrelated
  binaries and renderer owners never do. Revocation kills the matching host and
  prevents automatic restart.
- Opaque state is capped at 16 MiB per instance and transferred in bounded
  chunks. Descriptor/control envelopes remain at 64 KiB. Oversize state makes
  the instance ineligible without discarding its last persisted opaque state.
- Reported latency is generation-scoped. A latency change produces a new graph
  revision and atomically swaps at a safe block boundary; the old plan remains
  authoritative until the swap. Unbounded or unstable latency faults and
  bypasses the instance. The accepted value feeds
  `ProjectPathPdcPlanV21` across outputs, groups, sends, sidechains,
  monitoring, offline render, and freeze, with `pdcErrorSamples == 0`.
- On crash or quarantine, canonical parameters and opaque state remain intact.
  The user receives bypass when live continuation is valid or verified V21
  frozen playback when an authored fresh freeze exists. 5A never manufactures
  a freeze after failure or labels a generic rendered fallback as authored
  freeze.
- Vendor UI is a helper-owned top-level native window tied to one instance and
  owner generation. It receives no renderer bridge, DOM, Node, arbitrary file,
  network, or child-process API. Closing it does not close the effect; helper or
  owner loss closes it immediately. An embedded native child window is not a
  fallback design.

## Packet map and sequencing

1. **5A-0a — Implemented provisionally/local.** The baseline repairs, exact
   control bounds and directions, closed negotiated kinds and correlated
   grants, cancellation quiescence, qualifying-fault accounting, bounded
   progress callback, measured recovery test, and exact 10,000-case malformed
   corpus are present. Product task-progress/UI wiring remains follow-on.
2. **5A-0b — Native payload and packaged proof.** Add the five-target native
   build lock, source pins, addon ABI descriptor, digest manifest, staging and
   pack verification, release inventory, notices, tamper tests, and an actual
   packaged utility-process smoke. The smoke must cross Electron's real process
   boundary; injected channels do not satisfy it.
3. **5A-0c — Real-time transport proof.** Package a synthetic passthrough/
   loopback native addon and prove direct helper-to-worklet port transfer,
   bounded buffer ownership, clocks, backpressure, cancellation, crash, and
   recovery. No OS backend or third-party SDK breadth lands before this proof.
4. **5A-1 — Native audio.** Implement inventory and open/close control, then
   CoreAudio, WASAPI, ASIO, JACK, and ALSA behind the one adapter, with routing
   convergence, topology, destinations, monitoring metadata, calibration,
   device-loss behavior, and truthful fallback.
5. **5A-2 — Discovery and registry.** Implement explicit consent, roots,
   scanner, stable registry, trust/signature/compatibility decisions, durable
   quarantine, retry/revoke, and app-owned menu dialog. Discovery remains
   unable to instantiate audio or vendor UI.
6. **5A-3 — Isolated effects.** Add benign format fixtures first, then real-time
   and offline DSP, bounded state, exact PDC, failure recovery, revocation, and
   helper-owned vendor UI. VST3/CLAP land first; AU/LV2 remain platform-gated.
7. **5A-4 — Exit evidence.** Add the M5 collector and verifier, ordinary-CI
   correctness/fault suites, five-target packaged fixtures, and the no-retry
   native-lab cohort. Keep every unavailable hardware/signing row named and
   unaccepted.

5A-1 and 5A-2 may run in parallel only after their applicable 5A-0 exits. 5A-3
requires 5A-0c, the 5A-2 registry/revocation model, and the already-implemented
V21 PDC/freeze seams. 5A-4 develops alongside the packets but cannot publish an
accepted result before all product packets close.

## Packet acceptance and stop conditions

### 5A-0

- **Acceptance:** `npm run check` is green; ordinary and packaged smoke include
  the reviewed helper bridge; one test launches the packaged helper through
  real `utilityProcess`; the universal envelope has exact-size and one-byte-
  oversize cases, every message family proves pre-semantic oversize rejection,
  and every bulk family proves its exact maximum and one-byte-over limit;
  version/kind/grant denial, abort under load, kill,
  hang, RSS, restart, owner destruction, navigation, tamper, and repeated-fault
  cases pass; cancellation is quiescent at acknowledgement; a malicious result
  cannot create an unbounded main-process clone; five target identities select
  exactly one verified payload; the packaged synthetic audio loop meets the M5
  limits.
- **Non-goals:** no real device API, third-party scan, or plug-in format.
- **Stop:** stop on a required renderer sandbox relaxation, main-process native
  load, in-process host, unverified payload, or renderer-main real-time relay.

### 5A-1

- **Acceptance:** deterministic topology and channel mapping; shared/exclusive
  negotiation; exact-once close; abort during enumerate/open/read/write;
  input/output unplug while idle, recording, monitoring, and playback; backend
  crash/hang and stale events; route preference restoration; truthful Web Core
  fallback; synthetic loop math; and a separate 30-minute physical loopback on
  every claimed target with p95 round trip <= 20 ms and zero underrun frames.
- **Non-goals:** MIDI, instruments, clock, MTC, control surfaces, or Framescaper
  capture.
- **Stop:** stop if native inventory requires new renderer-owned device IDs, a
  requested mode is silently substituted, or recording loss can corrupt the
  canonical prefix.

### 5A-2

- **Acceptance:** clean effect, instrument, wrong-architecture, unsupported
  format, unsigned/invalid signature, duplicate, changed digest, malformed,
  oversize, crash, and hang fixtures; no scan before consent; per-format gate;
  no hosting during scan; main-private roots; durable quarantine; explicit
  retry/revoke; no scanner file/network/child escalation; menu-opened accessible
  progress/results dialog; actual packaged scan fixture on each applicable
  target.
- **Non-goals:** DSP execution, project insertion, vendor UI, or instrument
  exposure.
- **Stop:** stop if a format requires loading into main/renderer, exposes a raw
  path, or cannot separate discovery from hosting.

### 5A-3

- **Acceptance:** per-format passthrough, gain, and impulse goldens in real-time
  and offline modes; topology; sequence/backpressure; abort/timeout/exact-once
  close; 16 MiB state boundary and oversize rejection; `.scape`, desktop, and
  AUP4 opaque-state round trips; exact PDC on every V21 path; crash/hang/
  malformed audio/state/UI faults; durable quarantine and active revocation;
  canonical state survival; truthful bypass/freeze choice; no renderer or
  in-process native load; packaged VST3/CLAP everywhere, AU on macOS, and LV2
  on Linux.
- **Non-goals:** instruments, MIDI, bridge-hosted DOM UI, preset marketplace,
  or automatic trust of newly changed binaries.
- **Stop:** stop if any format demands in-process loading, if vendor UI needs
  renderer authority, if latency cannot feed the exact V21 path plan, or if a
  crash can mutate the last project revision.

### 5A-4

- **Acceptance:** `m5-helper-fault-and-loopback-v1` becomes a concrete fixture
  with collector tests and a retained raw result; all eight
  `m5-native-helper-and-audio` metrics are present and verified; the exact OS,
  CPU, memory, interface, driver, backend, buffer, sample rate, Electron build,
  helper/addon digests, and package identity are recorded. Timing follows the
  common one-warm-up/five-fresh-helper measurement procedure with zero
  retry-to-pass. Ordinary CI owns correctness; only `native-os-lab-matrix` may
  publish latency, underrun, recovery, and RSS qualification.
- **Non-goals:** relabelling hosted runners as audio-device evidence or filling
  null fingerprints from intended hardware.
- **Stop:** leave the workload planned or pending-external if any claimed target
  lacks real hardware, signed package evidence where required, raw artifacts,
  or a complete fingerprint.

## Handoff checklist

Before coding a packet, its owner records:

- the exact contract discriminants, limits, and process owner it adds;
- the capability/menu state while disabled, enabled, failed, revoked, and
  web-only;
- source revision, build toolchain, target/architecture binding, digest,
  license, notice, and tamper test for every native byte;
- canonical-state and owner-revocation behavior;
- unit, real-process, packaged, and native-lab evidence destinations;
- the rollback that restores a truthful Web Core editor.

Any change to helper contract v1, native payload selection, scanner/host trust
policy, or real-time packet ownership is a serialized 5A-0 decision. Backend
and format adapters consume those decisions; they do not fork them.
