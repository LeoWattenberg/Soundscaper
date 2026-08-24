# Milestone 5A plan: Soundscaper native services

> Owning plan for the Soundscaper half of milestone 5. The
> [milestone-5 plan](milestone-5-plan.md) owns the shared helper contract and
> sequencing, and the
> [roadmap](../roadmap.md#5-electron-native-services-and-extensibility) owns
> product scope and status. This document owns 5A readiness, architecture
> decisions, all unfinished work from 5A-0b through 5A-4, packet boundaries,
> acceptance, and stop conditions.

## Status and readiness

**Status on 2026-08-24: the selected Soundscaper V29/V11 software route is
complete across audio, discovery, hosting, persistence, isolation-launcher, and
evidence contracts, but 5A has not exited and nothing is qualified or
activated.** The earlier implementation record is retained below for audit
history. Four facts bound every current claim and are
repeated here
because they are the ones most easily read as better than they are:

1. **The native-source acquisition audit authenticates 0 of 10 required exact
   archive/extracted-tree inputs.** A pin or delegated source manifest is not an
   authenticated external acquisition.
2. **The old proof addon exists for `linux-x64` only; it is not the selected
   professional release payload.** All five professional target rows are
   `pending-external` with named blockers, stage no payload, and report a typed
   unavailability. Five-target packaged and physical results remain
   pending-external as well.
3. **Every third-party plug-in format remains fail-closed.** VST3, CLAP, Audio
   Units and LV2 keep their blocked licensing rows. The scanner, registry,
   quarantine and host machinery is proven against a benign fixture format that
   is this project's own code, exactly as 5A-3 asks; the scanner reports real
   formats it finds as seen-and-not-enabled rather than skipping them. The
   format waits; the gate does not bend.
4. **No latency, underrun, recovery or RSS number is qualified.**
   `native-os-lab-matrix` is unprovisioned with five null fingerprints, so the
   M5 collector emits `pending-external` and refuses to run on a hosted runner
   at all.

The selected product route now uses the direct helper-to-worklet `MessagePort`
with a bounded reusable packet pool. One persistent helper session owns the
device generation: input reaches canonical recording publication, while output
feeds playback and monitoring, and loss closes exactly before the Web Core
fallback resumes. Requested sample rate, period, channel topology, and mode are
authenticated rather than inferred.

The plug-in route instantiates a reviewed descriptor, performs project
insertion as a `native-plugin` node in the canonical effect graph, and transfers
one persistent helper `MessagePort` for real-time RPC. Vendor `save-state` and
`load-state` are authenticated and bounded to 16 MiB; `.scape`, desktop-library,
and AUP4 custody retain the exact opaque bytes. Exact V21 PDC remains the timing
authority; truthful bypass or an already-authored fresh frozen result preserves
state when an instance is missing, crashed, or quarantined. Vendor UI is
helper-owned and owner-generation scoped.

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

The implemented route and remaining gates are explicit:

1. **5A-0a baseline and contract closure — implemented provisionally.** The
   reviewed smoke bridge now includes all four helper methods, the packaging
   test uses its runtime-import inventory, and the timing-probe fixture uses the
   selected Soundscaper V23 storage profile (including its V21-owned timing
   contract) with cross-realm diagnostics.
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
3. **5A-0b native payload provenance and packaged proof — implemented
   provisionally.** A Node-API addon is built from pinned sources with a pinned
   toolchain, per-target rows in a source manifest, and a derived
   `config/native-addon-payload-manifest.json` that ships inside the
   fuse-protected archive while the payload ships outside it as a verified
   resource. Staging, `beforePack`, `afterPack`, the release inventory and every
   spawn re-verify it; a tampered source, swapped binary, wrong-target package,
   or drifted manifest each fails closed, and the audit runs in ordinary CI with
   no compiler. A test launches the helper through Electron's real
   `utilityProcess` from a staged application tree and compares the audio it
   rendered against the same pinned addon loaded independently. **Only
   `linux-x64` is built.** `linux-arm64`, `mac-arm64`, `win-x64` and `win-arm64`
   are `pending-external` with named blockers, stage no payload, and report a
   typed unavailability; filling one of those rows from another target's bytes
   is forbidden. The professional build plan now binds authenticated JUCE,
   direct CLAP, VST3, LV2, ASIO, and Node-API source acquisitions; no missing
   archive or target build may be inferred from that metadata.
4. **5A-0c real-time data plane — implemented in the selected product route,
   externally unproven.** The
   direct helper-to-worklet `MessagePort` transport exists: a closed protocol
   validator that a peer's first message reaches before any state exists to
   corrupt, a fixed reusable packet pool, generation, sequence and buffer-
   ownership ledgers, and a broker that creates the port inside the helper and
   hands main only the far end. Both ends are required to speak that one
   vocabulary — the helper opens a generation before it sends audio, and a
   returned buffer is the only credit for another send — and a departure from
   it closes the generation rather than replaying stale audio. Soundscaper V29
   consumes the plane for native input, output, monitoring, and native-effect
   RPC. The packaged synthetic audio loop remains pending-external, so its M5
   latency, underrun, cancellation, recovery and RSS limits are unmet rather
   than met.
5. **Product software — complete; external evidence absent.** The OS audio
   backend, scanner, registry, plug-in host, vendor-window lifecycle, automatic
   state-quiescence hooks, M5 collector, and per-OS child-isolation launcher
   source/contracts/tests now exist. The launcher source implements Linux
   namespaces/Landlock/seccomp, macOS Seatbelt, and Windows AppContainer target
   contracts. No authenticated built launcher or professional target payload,
   independently signed isolation-readiness review, professional package/manual
   run, accepted cohort, or provisioned native lab exists. Signing/notarization
   identities, release keys, and target toolchains are likewise absent; no
   blocked row is promoted or simulated.

The entry rule is therefore exact: external source acquisition, target builds,
licensing/patent/notices/trademark clearance, signing/notarization, independent
isolation review, and physical qualification cannot be simulated. There is no
remaining in-repository 5A software packet, but third-party execution stays
production-closed until an authenticated built per-OS launcher and exact target
payload are bound to independently signed readiness evidence. Neither category
may be inferred or filled from a neighbouring target.

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
  licensed and selected ASIO. Linux: **PipeWire is the primary backend**, with
  ALSA as the working backup and for direct `hw:` access. A caller supplies an
  ordered candidate chain, each entry naming its own backend and its own
  device, because a device handle means nothing outside the backend that issued
  it; the answer reports every attempt and which one was granted, so a fallback
  is a visible sequence of refusals rather than a plain success. A backend that
  is absent is a reason to try the next candidate; a format or mode the caller
  asked for and the device refused stops the chain. This revises the original
  JACK-plus-ALSA decision deliberately: PipeWire is the session manager on every
  mainstream desktop, so reaching it through its ALSA or JACK compatibility
  shims would make the editor a compat client rather than a graph node the user
  can see and route, and would inherit whatever quantum the shim chose. Adding
  the `pipewire` backend value is a serialized contract-v1 change; PipeWire's
  public headers are vendored under their MIT licence because its SPA format
  builders are static inlines, and the library itself is resolved by `dlopen`
  and never linked or redistributed. Backend and mode are explicit capability/status fields; fallback is
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

1. **5A-0a — Software complete; external acceptance open.** The baseline repairs, exact
   control bounds and directions, closed negotiated kinds and correlated
   grants, cancellation quiescence, qualifying-fault accounting, bounded
   progress callback, measured recovery test, and exact 10,000-case malformed
   corpus are present. Product task-progress/UI wiring remains follow-on.
2. **5A-0b — Software complete; target payload proof open.** Build/source
   registers, ABI descriptors, digest manifests, staging/pack verification,
   release inventory, and tamper tests exist. All five professional payload rows
   remain pending-external.
3. **5A-0c — Software complete; packaged measurement open.** The direct
   helper-to-worklet transport, bounded buffer ownership, clocks, backpressure,
   cancellation, crash, and recovery paths exist; the synthetic packaged cohort
   has not run.
4. **5A-1 — Software complete; physical-device qualification open.** CoreAudio,
   WASAPI, ASIO, PipeWire, ALSA, topology, routing, destinations, monitoring,
   loss behavior, and truthful fallback are implemented; JACK remains
   discovery-only by policy.
5. **5A-2 — Software complete; packaged format evidence open.** Explicit
   consent, roots, scanner, registry, trust/compatibility decisions, durable
   quarantine, retry/revoke, and the menu-owned dialog are implemented.
6. **5A-3 — Software complete; third-party activation open.** Real-time/offline
   DSP, bounded state, exact PDC, recovery, revocation, helper-owned vendor UI,
   and the reviewed per-OS launcher contracts exist. VST3, CLAP, AU, and LV2
   remain licensing-, payload-, readiness-, signing-, and target-gated.
7. **5A-4 — Evidence software complete; qualification open.** The collector,
   verifier, and correctness/fault suites exist. Five-target packaged fixtures,
   independently signed readiness, and the no-retry native-lab cohort remain
   pending-external.

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
- **Unmet:** the packaged synthetic audio loop remains pending-external and has
  never been run against the M5 limits, so that clause is outstanding rather
  than satisfied.
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
- **Contract, restated because the open path did not hold it:** a requested
  sample rate, period size, channel count or mode is never silently substituted.
  ALSA's `_near` setters may choose a rate or period other than the one asked
  for, and PipeWire negotiates its quantum in the graph after the stream
  starts; in both cases the granted record must carry what the device actually
  gave, and an
  open whose result differs from what the caller asked for must refuse and end
  the chain rather than report the substitute as granted. Backend absence is the
  only reason to try the next candidate.
- **Unmet:** the 30-minute physical loopback remains pending-external on every
  claimed target. Product routing exists, but no target may claim latency,
  device-loss, route-restoration, or fallback qualification without that run.
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
- **Results surface:** the acceptance clause was written when the tier had no
  dialog at all and the only entry was an off-by-default toggle.
  `SoundscaperNativeServicesDialog` is now that surface. It is opened from the
  native menu family and nowhere else, so the tier adds no permanent editor
  chrome, and it is the only place a format is granted, a folder admitted, a
  scan watched, its findings read, or a quarantined digest cleared.
- **Implementation:** JUCE supplies VST3, Audio Units, and LV2 discovery on its
  applicable targets, while direct CLAP discovery preserves the CLAP ABI and
  lifecycle. Authenticated bundle-tree identities, descriptor selection, and
  durable quarantine remain separate from hosting permission.
- **Unmet:** the packaged scan fixture remains pending-external on every
  applicable target; source-level cross-platform scanning does not substitute
  for a signed package run.
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
- **Implementation:** the selected V29 route inserts reviewed `native-plugin`
  effects into the canonical graph, carries one persistent helper RPC port,
  renders real-time and offline, preserves bounded opaque state across `.scape`,
  desktop-library V11, and AUP4, applies exact V21 PDC, owns a helper-native
  vendor window, and retains bypass/fresh-frozen continuity after loss. The
  per-OS isolation launcher source and target contracts are present.
- **Unmet:** no third-party professional payload, authenticated built launcher,
  signed independent readiness decision, packaged format fixture, or licensing
  clearance exists, so the acceptance clause remains open and the route stays
  unavailable.
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
