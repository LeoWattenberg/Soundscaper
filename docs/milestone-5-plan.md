# Milestone 5 plan: Electron-native services and extensibility

> **Current-route note (2026-08-25):** selected Soundscaper S30/V11 and
> Framescaper F31/V14/V20 source routes are complete. Selected F31 delegates
> through its immutable V28 foundation to exact V14 render authority, the main render queue, persistent services V3, the exact watch/bin/proxy flow, native
> media and OpenFX routes; historical V20 through V27 machinery remains an
> implementation source or explicit re-import boundary, and V25/V26 retain
> opaque, read-only custody. F31 product activation does not activate those
> native routes; no Milestone 5 qualification or release activation is claimed.

> The source audit authenticates 0/10 required exact archive/extracted-tree
> inputs until a cache is provisioned — see
> [Provisioning the native source cache](#provisioning-the-native-source-cache),
> which reaches 10/10 and grants nothing further.
> All five Soundscaper professional payload rows are `pending-external`;
> both five-target Framescaper payload manifests are empty and every row is
> `pending-external`. Per-OS launcher source/contracts/tests exist, but
> authenticated target payloads, independently signed readiness, licensing and
> redistribution clearance, signing/notarization identities and keys, accepted
> packages/manual runs, and native-lab cohorts do not.

> Owning source for milestone-5 sequencing, the helper-contract and
> plug-in/codec decisions, their invariants, and the bounded work
> packets. The
> [roadmap](../roadmap.md#5-electron-native-services-and-extensibility)
> owns scope and status; the threat model, security matrix, licensing
> policy, and quality budgets own their claims. Re-grounded on 2026-08-24 for
> the software-complete Milestone 5 implementation branch, with milestones 1
> through 4 assumed formally validated as prerequisites. The implementation
> record distinguishes landed code from still-open source, licensing, payload,
> signed-readiness, packaged, manual, and native-lab acceptance. The
> [5A Soundscaper plan](milestone-5a-soundscaper-native.md) owns the
> current Soundscaper readiness verdict and external acceptance gates.

## Goals and ordering principle

1. **Primary: users must not hit trouble.** A helper or plug-in crash
   never corrupts the last project revision or takes the editor down;
   no native process gains authority the renderer sandbox was built to
   deny; no plug-in binary runs without consent, scanning, and
   quarantine; no codec ships without its licensing and patent gates;
   native and web paths render the same semantic plans so a project
   never changes meaning by changing machines; and disabling every
   helper leaves a usable Web Core editor with a truthful capability
   report (roadmap.md:616-617).
2. **Secondary: one helper contract, defined once.** Milestone 5 owns
   the general helper architecture the roadmap already assigns it
   (roadmap.md:669-673); every native service — and the milestone-7
   assistance helper, which implements "the milestone-5 helper
   contract's first slice" and must conform or be revised
   (docs/milestone-7-plan.md:171-180, 622-625) — speaks that one
   contract. Divergence is a design conversation here, never a
   workaround elsewhere.

Work is ordered by trust: the contract, its threat-model enactment, and
binary provenance land first, once, serialized; service tiers then
parallelize. Research may begin after milestone 2, but product
integration waits for the owning shared contract (roadmap.md:565-566).

## What exists today (verified baseline)

- **One enacted helper architecture.** Main owns supervised
  `utilityProcess.fork()` surfaces for probe, persistent native audio/effects,
  media, and per-fingerprint OpenFX work. Contract v1, pathless grants, bounded
  data planes, heartbeats, cancellation, quarantine, and exact payload custody
  are shared. The renderer receives opaque authority only, each product surface
  is menu-reached and off by default, and refusal or loss preserves a truthful
  Web Core fallback. The per-OS child launcher source/contracts/tests implement
  Linux namespaces/Landlock/seccomp, macOS Seatbelt, and Windows AppContainer;
  no authenticated target launcher/payload set or signed readiness exists.
- **A hardened IPC discipline to extend, not reinvent.** Every channel
  passes the trust gate (`assertTrustedIpc`,
  `desktop/main.mjs:362-382`: sender identity, main-frame check,
  document-URL check); renderer-supplied ids are fixed-length opaque
  hex (`desktop/main.mjs:568-572`); the project-library bridge is
  pathless by construction (`desktop/project-library-ipc.js:28-33`);
  bounds are constants-owned (`desktop/constants.js:40-62`) and
  enforced by admission classes
  (`desktop/read-capability-admission.js:23-40`); file access is
  user-mediated capability minting
  (`desktop/main.mjs:384-403`) validated again renderer-side
  (`desktop/preload.mjs:157-172, 269-279`). Downloads are cancelled
  session-wide (`desktop/main.mjs:478`); navigation is locked
  (`desktop/main.mjs:481-487`).
- **A packaged-runtime provenance pipeline to reuse.** The ffmpeg wasm
  core is digest-pinned end-to-end: manifest with byte lengths and
  SHA-256 (config/ffmpeg-runtime-manifest.json:15-28), staging verified
  before build (`scripts/desktop-prepare.mjs:41-88`), re-verified at
  pack time before fuses (`scripts/desktop-after-pack.mjs:19-20,
  52-68`), shipped as extraResources
  (electron-builder.config.cjs:25-31). The manifest library API
  (`scripts/lib/ffmpeg-runtime-manifest.mjs:58-198`) is the template
  for helper-binary manifests.
- **Resource-policy and cancellation precedents.** The capacity
  admission's lower-only limits and reservation handles
  (`desktop/project-library-media-capacity.ts:20-61`) are the shape for
  per-job resource policy; the long-job cancellation invariants the
  helper must not break are recorded at
  docs/production-threat-model.md:1014-1080 (eight-admission cap,
  30-second settlement deadlines, only-exact-abort-reason-is-benign,
  non-cancellable commit-phase ownership rules).
- **The media ceiling milestone 5 removes.** Decode/probe/encode run on
  a lazy **single-threaded** ffmpeg.wasm worker released after 30 s
  idle (`src/common/editor/ffmpeg.js:31, 74-80`); probe parses one
  run's logs (`src/common/editor/ffmpeg-video-source-characteristics.ts:13-35`);
  preview decode is `HTMLVideoElement` + canvas
  (`src/common/editor/video-media.js:38-71`); export encodes
  libx264/libvpx-vp9 via FFmpeg's own muxers
  (`src/common/editor/video-export.js:26-55`,
  `src/common/editor/video-ffmpeg.js:9-21`). WebCodecs is detected but
  unused for media work
  (`src/common/editor/platform-capabilities.ts:153-158`). Milestone 7
  names this dependency explicitly
  (docs/milestone-7-plan.md:847-849).
- **Selected Soundscaper audio/effects software exists.** S30/V11 delegates
  through its exact S29 foundation and owns native
  device inventory/open/close, direct helper-to-`AudioWorklet` packet transport,
  input recording publication, output/monitoring, reviewed effect insertion,
  real-time/offline RPC, exact V21 PDC, bounded opaque state, continuity, and
  helper-owned vendor windows. The five professional payload rows and all
  physical qualification remain pending-external.
- **Selected Framescaper queue and render software exists.** Persistent services
  V3 reach the selected F31/V14/V20 queue through its immutable V28 foundation,
  including capacity, scratch, recovery, watch/bin/proxy,
  image-sequence tree publication, and lease-fenced output. Native hardware
  encode permits one exact CPU retry; one context-aware OpenFX graph serves
  preview, browser export, and native carrier execution. Empty payload manifests
  keep production dispatch fail-closed.
- **The helper security surface remains partial by evidence, not by software
  reach.** Product callers, reviewed isolation-launcher contracts, pathless
  bridges, supervision, vendor-window ownership, and fail-closed activation now
  exist. The residual risks are unauthenticated external source trees and target
  payloads, missing independent signed readiness and publisher provenance,
  blocked licensing, and zero accepted native-lab cohorts.

## The helper contract (the milestone's one-way door)

Milestone 5 defines, versions, and owns these seven elements; every
helper — media, audio-device, render, plug-in host, and the milestone-7
assistance helper retrofitted onto them — conforms:

1. **Versioned wire schema** with negotiation and typed rejection,
   following the OPFS protocol's normalize → assert → structured-error
   round-trip shape; malformed or oversized messages are rejected by
   wire validation, never trusted.
2. **Explicit per-job capability grants** — which binary, which media
   paths, which output paths, network deny-by-default — mirroring the
   pathless, opaque-id, user-mediated discipline of the existing
   desktop protocol; no helper channel ever exposes raw spawn or path
   authority to the renderer.
3. **Heartbeat and liveness** with a crash-quarantine state machine:
   crash detection ≤ 2 s, editor recovery ≤ 5 s
   (config/quality-budgets.json:1017-1018), repeated-crash quarantine,
   and restart without corrupting the last project revision
   (roadmap.md:576-578).
4. **Cancellation acknowledgement** end-to-end on AbortSignal with the
   ≤ 1000 ms p95 budget (config/quality-budgets.json:1016 — note this
   is twice as strict as milestone 7's 2000 ms assistance budget) and
   the recorded long-job settlement invariants left intact.
5. **Per-job resource policy** — CPU, memory (helper peak RSS ≤ 1 GiB,
   config/quality-budgets.json:1019), file, duration, child-process,
   and network policy — expressed as lower-only limits with reservation
   handles, the `DesktopLibraryMediaCapacity` shape.
6. **Structured progress and errors** through the task-progress
   coordinator with new milestone-5 task kinds (the kind enum at
   `src/common/editor/controller/task-progress.ts:3-12` is a spine
   file), and bulk data crossing as bounded transfers, never unbounded
   invoke payloads (roadmap.md:837-839; the milestone-7 IPC data
   discipline at docs/milestone-7-plan.md:183-187 carries over).
7. **Binary provenance and packaging** — per-platform helper binaries
   digest-pinned in manifests, verified at staging and pack time, with
   licensing rows and notices in the same change
   (docs/production-licensing-policy.md:69-71): the ffmpeg-runtime
   pipeline generalized.

The seven elements are implemented across the selected product routes. Contract
v1 carries the closed probe, audio-device, plug-in-scan/host, media, and OpenFX
families with kind-correlated main grants, deny-only resource controls,
direction-correct validation, an exact 64 KiB control bound, and separately
bounded authenticated data planes. Main preflight prevents invalid grants from
spawning a helper; cancellation waits for engine quiescence; qualifying forced
terminations feed quarantine; and bounded progress reaches product UI. The
remaining gates are external payload, licensing, signed-readiness, package,
manual, and native-lab evidence rather than another helper-contract slice.

`native-helper-processes` remains **partial** because none of the professional
target matrices is qualified. Scanner and host controls remain separate because
discovery consent is not permission to execute project audio or video.

### Packaging decision for native code

`asar` is enabled with **no** `asarUnpack` and `npmRebuild: false`, and the
fuses require app-from-asar with integrity validation. JavaScript helper
entrypoints currently ship inside the asar; the probe's executable engine bytes
reuse the verified FFmpeg WebAssembly `extraResources`. Future native binaries
and addons ship as target-selected, digest-pinned **extraResources** by default.
Generic native-addon and separate Framescaper media/OpenFX payload manifests,
selectors, and stagers now exist with tamper and package tests. Pending-external
targets stage no bytes, and only exact built, digest-verified rows can become
resources. Any first `asarUnpack` entry or runtime rebuild remains a named design
decision, never an incidental build change.

## Licensing decisions

The application is AGPL-3.0-only. The licensing register has
`nativeFormatPolicies` rows for VST3, CLAP, Audio Units, LV2, OFX, the current
native FFmpeg set, hardware acceleration, and advanced codec families, in
addition to the coarse `native-plugins`, `native-audio` and `native-codecs`
gates. A row's presence is not enablement, and an enabled row is still not a
shipping capability.

On 2026-08-26 the owner reviewed and recorded the `native-audio` and
`native-plugins` gates as enabled, the audio-stack, five OS audio-backend and
five plug-in-format rows as implemented, and the six professional source rows
(Electron Node-API headers, JUCE, CLAP, VST3 SDK, ASIO SDK, LV2) as accepted.
`native-codecs` and `codec-native-ffmpeg-current-set` were deliberately held
back pending closer review, so the four FFmpeg external libraries — x264, x265,
libvpx and libopus — stay activation-blocked with them. Nothing ships as a
result: activation additionally requires an authenticated source audit at
runtime, and plug-in formats require an enforced OS launcher plus a
production-readiness statement signed by a key in
`config/milestone-5-native-isolation-review-policy.json`, whose `trustedKeys`
list is still empty. Every per-target payload row remains `pending-external`.

JUCE 9 plus the direct CLAP ABI are the 5A integration decision and their
source acquisition rows are pinned and provisionable, but authenticating a
source is provenance and nothing else. Corresponding-source, patent and notice
review for the codec set remains open. Milestone 5 also respects the two
already-blocked FFmpeg release gates
(`ffmpeg-enabled-library-corresponding-source`,
`ffmpeg-enabled-codec-patent-review`): a native FFmpeg
helper does not enlarge the enabled codec set until those gates clear
for the enlarged set. Hardware-codec enablement (NVENC, QSV,
VideoToolbox, VAAPI) is a per-codec licensing/patent question first and
a performance feature second.

Signing configuration is now identity-gated: providing the named macOS signing
identity and notarization credentials enables the configured chain, while
current previews remain unsigned/ad-hoc and CI deliberately disables automatic
identity discovery. No signing identity, signed execution result, notarization
result, or workflow secret mapping is present. This blocks qualification, not
local 5A-0 implementation; milestone 9 requalifies the release-shaped chain.

### Provisioning the native source cache

`config/milestone-5-native-source-acquisitions.json` pins ten upstream inputs by
archive digest and by the portable identity of the tree each archive extracts
to. `auditMilestone5NativeSourceAcquisitions` authenticates a cache of those
inputs, reading its root from `SOUNDSCAPER_M5_NATIVE_SOURCE_ROOT`, and an absent
cache is a truthful `pending-external` result rather than an error — which is
why the audit reports 0/10 on a machine that has never provisioned one.

`npm run provision:milestone-5-native-sources` assembles that cache into the
uncommitted `vendor/milestone-5-native-sources/`, one directory per source
holding exactly the pinned archive and its extracted `source/` tree. Each
archive is refused unless its bytes match the pinned length and SHA-256, each
tree is built by the same non-executing extractor the audit path uses and
refused unless it matches the pinned portable identity, and an entry is renamed
into the cache only once it is whole. Useful flags: `--check` reports status
and provisions nothing, `--source <id>` narrows the run, `--force` replaces a
drifted entry, and `--archive-directory <dir>` reads the archives from local
storage instead of fetching them, which is the path to use for upstreams behind
terms a person must accept — the Steinberg ASIO SDK above all.

The cache is deliberately outside the repository and outside the product's
dependency graph. Nothing provisioned is committed, bundled, linked, or
redistributed, and authenticating a source grants no redistribution, trademark,
patent, signing, activation, or qualification approval: the licensing gates, the
per-target payload rows, the signed readiness evidence, and the native-lab
cohorts stay exactly as blocked as they were. What it changes is that the source
gate the activation policy checks can now be satisfied by evidence rather than
being unreachable on every machine.

### Rejected alternatives (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| Native inference/decoding in `worker_threads` | A native crash kills the editor; helpers contain crashes by construction (the milestone-7 table already records this). |
| In-process plug-in hosting | "A malicious native plug-in is not made safe merely by running in another ordinary user process" (docs/production-threat-model.md:23) — and in-process is strictly worse; hosting is out-of-process with supervision, always. |
| A second renderer-reachable spawn channel | The residual acceptance forbids exposing raw spawn authority to the renderer (config/production-security-matrix.json:8508-8515); helpers are spawned and owned by main only. |
| Forking the editor engine for native paths | The exit gate requires native and web to implement the same semantic render plans (roadmap.md:611-612); the native tier accelerates plans, it never reinterprets them. |
| Enlarging the codec set because native FFmpeg makes it easy | The blocked corresponding-source and patent-review gates are fail-closed; capability follows evidence, not convenience. |
| Selecting a plug-in SDK from remembered licensing terms | Upstream licensing changes. Pin and review the exact selected revision, then update the fail-closed row, source delivery, and notices from that evidence. |

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| 5.0 | Serialized (one work stream) | Packaged-staging fix, helper contract v1 with first proof helper, threat-model/matrix enactment, binary provenance and signing enactment |
| 5A | Parallel track | Soundscaper native tier: audio device/backend helper, plug-in scanning, isolated plug-in hosting |
| 5B | Parallel track | Framescaper native tier: media engine helper, advanced decode/encode, persistent queues, watch folders, scratch volumes, isolated OFX |

Feature breadth in 5A and 5B must not begin until the applicable 5.0 contract
acceptance passes. The proof-helper implementation now exists, so the 5A plan
opens with a deliberately bounded **5A-0 closure slice**: repair the green-gate
regressions, harden and generalize contract v1, add the generic native-payload
pipeline and real packaged-process smoke, then prove the real-time audio data
plane. This is foundation work, not early native product enablement. 5A-1 and
5A-2 open only after their applicable 5A-0 exits; 5A-3 also requires the
real-time proof. A milestone-7 assistance helper, if later wired, must conform
to this contract rather than create another helper protocol.

## 5.0 implementation record (2026-08-14)

- **WP-5.0.0 is implemented.** The two staged witnesses now reach
  `createUnreportedVideoSourceCharacteristics` through the
  `#desktop-runtime/video-source-characteristics` package-imports alias,
  which the repository manifest maps to the TypeScript source and the
  staged application manifest maps to the compiled runtime member that
  already ships; the `.ts`-import guard now scans the entire staged
  `desktop` tree before the preload bundle is built, and the packaging
  test proves it fails on a deliberately reintroduced `.ts` import
  (scripts/lib/desktop-project-library-runtime.mjs,
  tests/desktop-project-library-packaging.test.js).
- **WP-5.0.1 is implemented for the probe surface, with acceptance gaps.** Contract v1 lives in
  `desktop/helper-contract.ts` (versioned wire schema, typed rejections,
  pathless-toward-renderer grants with captured file identity, lower-only
  resource policy), supervision in `desktop/helper-supervisor.ts`
  (verified spawn, 1 s heartbeat, ≤ 2 s crash detection, ≤ 1 s
  cancellation acknowledgement, repeated-crash quarantine), and the
  surface in `desktop/helper-probe-service.ts` +
  `desktop/helper-registration.mjs` + `desktop/helper-probe-process.js` +
  `desktop/helper-probe-engine.js`: an Electron utility process whose
  engine is the digest-pinned FFmpeg wasm core the application already
  ships, re-verified before every spawn and executed from the verified
  bytes, probing one granted file per job in a per-job worker thread. The
  renderer reaches it only by opaque read-capability id through
  `src/common/editor/desktop-helper-video-timing-probe.ts`, ahead of the
  wasm probe in the shared resolver, with failures recorded and the wasm
  path visibly taking over; the surface is off by default behind the
  desktop Tools menu. The `probe` task kind is registered and drives the
  re-probe command. The threat model and security matrix were revised to
  **partial** in this same change. The generated 10,000-case test,
  supervisor fault suites, probe-service suites, preload validation suites,
  and WebAssembly/helper parity fixtures run in ordinary
  CI (tests/desktop-helper-*.test.*,
  tests/desktop-preload-helper-probe.test.js,
  tests/audio-editor-desktop-helper-video-timing-probe.test.ts). All
  process/supervisor tests use injected seams or direct modules; none yet proves
  `utilityProcess.fork()` in a packaged application.
- **5A-0a is implemented provisionally in the local tree.** The universal
  control-envelope gate now has exact 64 KiB and one-byte-oversize coverage;
  every message family has pre-semantic oversize and wrong-direction rejection,
  while bulk binary admission remains separately bounded. The contract
  negotiates the closed future job set with correlated grants, kind-aware
  durations, and deny-only network/child/output policy. Its deterministic
  assigned-direction corpus rejects exactly 10,000 malformed cases. A separate
  hostile-object suite rejects accessors, symbols, non-plain prototypes, sparse
  arrays, cycles, excess nesting, and shared memory without invoking hostile
  getters. Supervision preflights grants, rejects unannounced
  kinds and stale generations, publishes bounded monotonic progress, waits for
  worker termination before cancellation acknowledgement, and distinguishes
  qualifying forced kills from user cancellation and shutdown. A local
  monotonic-clock test covers recovery within five seconds. The task-progress
  coordinator/UI consumer is not wired by this slice.
- **The repaired packaged baseline passes locally on Linux x64.** Fresh-project
  creation now seeds the default track in canonical revision zero, clean
  explicit/terminal flushes do not replay an equal revision, and coalesced
  autosaves may advance to any strictly higher safe-integer project revision
  only under the exact prior revision-and-SHA witness. One fresh package and
  one no-retry packaged timing-probe run passed both pinned CFR and VFR
  fixtures. This is product persistence/smoke evidence, not the still-missing
  packaged `utilityProcess` execution proof.
- **Milestone-7 assistance helper conformance is implemented but remains
  independently dormant.** Its native runtime now uses the shared helper
  supervision and payload discipline rather than executing speech inference in
  Electron main. Milestone 7 still owns model payload and activation evidence.
- **WP-5.0.2 software is enacted across the selected helper families.** Control
  entrypoints remain in the protected asar; manifests, selectors, release
  inventories, staging, pack checks, and every spawn reauthenticate exact
  external payload bytes. The per-format/per-codec licensing rows remain
  fail-closed. The signing chain is configured but identity-gated: no signing
  or notarization identity, release key, signed result, or workflow secret is
  present, and no pending target row may borrow another target's bytes.
- **Recorded limits and follow-ups.** The probe helper reads the granted
  file into the engine's in-memory filesystem, so probe admission bounds
  input bytes (lower-only, 4 GiB hard ceiling) and oversized inputs
  degrade to the renderer wasm probe; 5B's native media engine owns
  removing that ceiling. A packaged desktop smoke mode for the helper
  surface and the `native-os-lab-matrix` qualification rows remain open;
  the fault-and-loopback fixture stays `planned` and unqualified until that
  hardware exists. 5A-0a repairs the reviewed bridge inventory and packaging
  test import and updates the timing fixture to the selected Soundscaper V23
  storage profile, including its inherited V21 timing contract, with actionable
  cross-realm diagnostics. After repairing
  revision-zero creation and coalesced-update publication, one fresh local
  Linux x64 package and one no-retry timing-probe run passed both pinned
  fixtures. That run does not substitute for 5A-0b's real packaged
  `utilityProcess` proof. WP-5.0.2's licensing rows and
  signing enactment are recorded in the licensing policy and matrix.

## Work packets

5.0 packets are decomposed here. All unfinished 5A work is owned by the
[Soundscaper native plan](milestone-5a-soundscaper-native.md); this parent keeps
only its status and ordering boundary. 5B is decomposed at pickup.

### WP-5.0.0 — Packaged staging fix and guard

- **Outcome:** the two staged witnesses that import
  `../src/common/editor/video-source-characteristics.ts` with a `.ts`
  extension — crashing packaged main —
  (`desktop/project-library-fallback-role-witnesses.js:5`,
  `desktop/project-library-source-bearing-smoke.js:12`) re-pointed at
  the compiled runtime member that already ships
  (`scripts/lib/desktop-project-library-runtime.mjs:82, 122`); the
  `.ts`-import guard extended from compiled output to the staged
  `desktop/**/*.js` tree (today it scans only tsc output,
  `scripts/lib/desktop-project-library-runtime.mjs:101-104`, which is
  why CI missed this).
- **Invariants:** no staged file may import a `.ts` specifier; packaged
  smoke evidence is recorded only after the fix.
- **Acceptance:** packaged desktop smoke green on the qualified
  targets; the extended guard fails on a deliberately reintroduced
  `.ts` import.
- **Non-goals:** none beyond the staging pipeline.
- **Stop condition:** stop if milestone 7's WP-7.0.2 already landed
  this exact fix — verify, don't duplicate.

### WP-5.0.1 — Helper contract v1 and the proof helper

- **Outcome:** the seven contract elements implemented and versioned;
  the **native probe helper** as the first surface — a read-only
  ffprobe-class helper whose results conform to the existing probed
  source-characteristics model (exact-or-unreported, never guessed,
  `src/common/editor/ffmpeg-video-source-characteristics.ts:13-35`) —
  chosen because it is read-only, converges with an existing wire
  contract, and exercises every contract element without touching
  documents; the threat-model `native-helper-processes` section and
  security matrix revised in the same change that enables the surface;
  new task kinds registered; the milestone-7 assistance helper's
  conformance disposition recorded (conforms / revised / not present).
- **Invariants:** helper spawn authority lives in main only; grants
  are pathless-opaque toward the renderer and path-verified in main;
  a probe helper failure degrades to the wasm probe with visible
  status, never silently.
- **Acceptance:** the malformed-input, oversized-payload, timeout,
  cancel-under-load, kill-mid-job, restart, quarantine, and
  binary-mismatch suites pass (the 10,000-malformed-case fixture
  discipline, config/quality-budgets.json:795-803); probe parity
  fixtures agree between wasm and native paths or record the
  difference as probed truth.
- **Non-goals:** no encode/decode, no devices, no plug-ins, no
  queues.
- **Stop condition:** stop if any contract element must be weakened to
  fit `utilityProcess` semantics — the contract changes deliberately
  or the platform primitive does, never silently.

### WP-5.0.2 — Binary provenance, packaging, and signing enactment

- **Outcome:** the helper-binary manifest pipeline (per-platform
  digests, staging and pack-time verification, notices) generalized
  from the ffmpeg-runtime library; the extraResources-vs-asarUnpack
  decision enacted; the per-format/per-codec licensing rows for
  everything 5A/5B will ship, authored against the two matrix gates;
  the signing/notarization chain enacted for the claimed desktop
  targets with CI wiring.
- **Invariants:** no unverified byte executes from a helper path;
  fuse state (`strictlyRequireAllFuses`,
  `scripts/desktop-after-pack.mjs:34-49`) is preserved; licensing
  gates stay fail-closed — a format without its row does not ship.
- **Acceptance:** pack-time verification fails on a tampered helper
  binary; notices render for every shipped runtime; signing
  verification passes on signed targets or records the named identity
  blocker.
- **Non-goals:** no auto-update (the notification-only posture,
  `desktop/update-check.js:1-46`, is unchanged).
- **Stop condition:** stop if a licensing gate cannot be satisfied for
  a format — the format waits; the gate does not bend.

### 5A plan (Soundscaper native tier)

The selected Soundscaper S30/V11 software packets 5A-0 through 5A-4 inherit
their established native implementation through exact S29 and are
implemented. The
[Milestone 5A Soundscaper plan](milestone-5a-soundscaper-native.md) owns their
invariants and the still-open external source, five-target payload, licensing,
signed-readiness, package/manual, and native-lab acceptance. No professional
surface activates before those exact gates close.

### 5B packets (Framescaper native tier; slice docs at pickup)

The owning pickup contract is
[`milestone-5b-framescaper-native-tier.md`](milestone-5b-framescaper-native-tier.md).
Its implementation record is authoritative for what has landed: selected
F31/V14/V20 binds the complete media, professional sequence/proxy, persistent
services V3, and context-aware OpenFX routes through F31's immutable V28
foundation. V20 through V27 remain historical or re-import sources and V25/V26
retain opaque read-only custody. No 5B payload
is built or staged; source authentication, licensing, reviewed target isolation,
signing, five-target hardware, package/manual, and native-lab qualification
remain open. Empty payload manifests prevent any shipped 5B helper spawn.

- **5B-1 — Native media engine helper.** Outcome: multithreaded FFmpeg
  decode/encode and hardware acceleration as per-feature opt-ins with
  mandatory CPU fallback, behind the contract; render-plan parity —
  the native path consumes the same semantic export plan the wasm path
  does (`src/common/editor/video-export.js:123-232`), version-pinned
  under the export-plan discipline. Acceptance: plan-parity goldens
  between wasm and native outputs; the decode-speed ceiling measurably
  lifted for the long-form fixtures. Stop: stop if native output
  diverges semantically from the plan rather than accelerating it.
- **5B-2 — Advanced decode/encode tier.** Outcome: long-GOP and
  high-resolution decode, background proxy generation (consuming the
  3B-6 proxy model), 10-bit/HDR decode with color metadata carried,
  image sequences, alpha masters, mezzanine formats — each behind its
  codec licensing row. Stop: stop on any codec whose patent/source
  gates are not clear.
- **5B-3 — Persistent parallel queues, watch folders, scratch.**
  Outcome: the restartable background job queue (the anchor interface
  is `src/common/editor/platform/render-job-port.ts:9-22`), durable
  across app restarts, with explicit resume-or-atomic-restart
  semantics per job type — milestone 6 consumes this and its exit gate
  forbids mislabeled resumability (roadmap.md:658-659); watch folders
  and managed scratch/cache volumes under explicit user-granted roots
  with the existing capability discipline. Invariants: queue
  persistence never stores media bytes, only job descriptions; a
  helper death mid-job leaves a resumable or cleanly-restartable
  record (`soak.unrecoveredJobs eq 0` is the eventual milestone-9
  gate). Stop: stop if a queue record would need paths the capability
  model can't re-verify at resume time.
- **5B-4 — Isolated OFX.** Outcome: OFX effect hosting under the 5A-3
  hosting architecture, video-side. Stop: same as 5A-3.
- **5B-5 — Exit evidence.** The 5B surface against the registered
  workload and the §5 exit gate, including the disable-all-helpers
  degradation check (roadmap.md:616-617).

## Quality-budget and evidence duties

- Workload `m5-native-helper-and-audio` and fixture
  `m5-helper-fault-and-loopback-v1` (10,000 malformed cases, 30-minute
  loopback) are registered with eight thresholds against
  `native-os-lab-matrix`, whose five current platform fingerprints are all null
  today. Provisioning follows the fixed-hardware checklist discipline;
  hosted-runner packaging is
  distribution evidence, never device qualification
  (docs/quality-budgets.md).
- Malformed-case and fault suites run in ordinary CI as correctness
  evidence; latency/underrun/RSS numbers qualify only on the
  provisioned matrix, no-retry (docs/quality-budgets.md:102-104).
- Bundle gates remain unchanged. JavaScript helper entrypoints live in the
  desktop asar; native engine/addon payloads live outside both the Pages bundle
  and asar as verified resources.

## Two-agent coordination rules

- 5.0 is one work stream. The dedicated 5A plan owns its bounded Soundscaper
  closure/proof slices; 5A/5B product breadth opens only after the applicable
  acceptance passes.
- Spine files: the helper wire schema and contract module, task-kind
  enum, licensing matrix and threat model/security matrix, packaging
  configs and staging scripts, capability register, application menus,
  i18n catalog, maintainability allowlist. One owner per edit, rebase
  before push, ratchets in the same commit.
- Leaf ownership: audio-device and plug-in host helpers to 5A; media
  engine, queue, and watch-folder helpers to 5B. Both consume the 5.0
  contract read-only; contract changes are serialized 5.0-owned edits.
- Shared fate on repo gates: keep the canonical check green on every
  push.

## Known constraints this plan absorbs

- **Soundscaper 5A external gates are delegated.** The
  [Milestone 5A Soundscaper plan](milestone-5a-soundscaper-native.md) owns the
  source/payload/readiness/licensing/signing/qualification boundary,
  unprovisioned native lab, capture/MIDI fences, and every product packet.
- **The milestone-2 lease matrix** (`m2-electron-lease-matrix`,
  roadmap.md:290-296) is the standing concurrency substrate under all
  desktop evidence; still open at grounding.

## Watch items (not gates yet)

- The milestone-7 assistance helper's actual shipped shape (if 7
  runs first): WP-5.0.1 records its conformance disposition.
- Electron `utilityProcess` API evolution and per-platform QoS
  controls (the milestone-7 etiquette stack generalizes to all
  helpers).
- WebCodecs maturity for the milestone-6 web encode tier — milestone 5
  should keep the native encoder behind the same semantic plan so the
  web tier can slot in beside it.
- Windows-on-ARM and Linux-ARM64 prebuilt availability for chosen
  plug-in SDKs and codec libraries.
- Signing identity acquisition lead time (also a milestone-9 watch
  item — start early).

## Non-goals and fences

- No MIDI devices, MPE, instrument plug-ins, control surfaces, clock,
  or MTC (8B); no Framescaper capture IPC, permissions, entitlements,
  or UI (8A).
- No second editor engine; native services accelerate the canonical
  model behind narrow adapters (roadmap.md:86-88).
- No renderer sandbox weakening: fuses, CSP, pathless IPC, and the
  capability model are invariants, not variables.
- No auto-update channel; the notification-only update posture stands.
- No codec or plug-in surface without its fail-closed licensing row;
  no gated or unverifiable binary distribution.
- Every new surface is menu-reached and off by default
  (AGENTS.md:8-11); disabling every helper leaves the complete Web
  Core editor.
