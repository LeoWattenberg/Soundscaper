# Milestone 5 plan: Electron-native services and extensibility

> Owning source for milestone-5 sequencing, the helper-contract and
> plug-in/codec decisions, their invariants, and the bounded work
> packets. The
> [roadmap](../roadmap.md#5-electron-native-services-and-extensibility)
> owns scope and status; the threat model, security matrix, licensing
> policy, and quality budgets own their claims. Grounded against the
> repository on 2026-08-11 (repo brief with file:line verification,
> taken on a dirty working tree — the threat model and security matrix
> carry uncommitted edits; re-verify their line numbers at pickup).

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

- **One process boundary.** Nothing in `src/` or `desktop/` uses
  `utilityProcess`, `child_process`, or `worker_threads` — only build
  and test scripts spawn processes. The app has exactly main ↔
  sandboxed renderer, plus renderer-side Web Workers behind the
  request-broker contract
  (`src/common/editor/worker-request-broker.ts:21-56` — exactly-once
  lifecycle, AbortSignal, timeout, progress-reset deadlines) and the
  OPFS worker protocol's normalize → assert → structured-error shape
  (`src/common/editor/storage/opfs-sync-worker-client.ts:29-45`).
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
- **Audio is Web Audio only.** Device enumeration exists in exactly one
  place (`src/common/editor/controller/recording-routing-service.ts:88-100`);
  there is no exclusive mode, channel-topology API, latency
  calibration, or underrun counter.
- **No job queue.** The task-progress coordinator is a
  single-foreground-task UI model whose `begin()` overwrites the active
  task (`src/common/editor/controller/task-progress.ts:45-71`); the
  abortable `render-job-port` interface exists with no implementation
  (`src/common/editor/platform/render-job-port.ts:9-22`).
- **The planned security surfaces are already owned here.**
  `native-helper-processes`: planned, surface-disabled, impact
  critical, `ownerMilestone: "5"`, residual acceptance "Crash, hang,
  malformed message, oversized payload, binary mismatch, and
  cancellation tests pass without exposing raw spawn authority to the
  renderer" (docs/production-threat-model.md:1008;
  config/production-security-matrix.json:8474-8517).
  `native-plugin-hosting`: planned, surface-disabled, `ownerMilestone:
  "5 and 8B"`, residual acceptance "Host compromise, crash recovery,
  denial, scanning, consent, revocation, and per-platform packaging
  tests pass before discovery is enabled"
  (docs/production-threat-model.md:1010;
  config/production-security-matrix.json:8519-8570). The
  current-bridge fence explicitly does not qualify a helper channel
  (docs/production-threat-model.md:617).

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

The threat-model `native-helper-processes` section and the security
matrix flip in the same change that enables the first surface, exactly
as milestone 7 planned for its own helper. The milestone-7 plan's
citations of the helper section as threat-model line 1006 are stale
against the current tree (the section sits at 1008 after uncommitted
edits); fixing those references rides whichever plan lands its
threat-model revision first.

### Packaging decision for native code

`asar` is enabled with **no** `asarUnpack` and `npmRebuild: false`
(electron-builder.config.cjs:10-11), and the fuses require
app-from-asar with integrity validation
(`scripts/desktop-after-pack.mjs:34-49`). Helper binaries and native
addons therefore ship as verified **extraResources** by default — the
proven ffmpeg pattern — and any first `asarUnpack` entry or
electron-rebuild step is a named design decision inside WP-5.0.2 with
its own verification story, never an incidental build change. Prebuilt
per-platform binaries are preferred over rebuild toolchains.

## Licensing decisions

The application is AGPL-3.0-only (package.json:14). GPLv3-licensed
SDKs (the VST3 SDK's GPL arm) are compatible one-way into an AGPL-3.0
work via GPLv3 §13; permissive SDKs (CLAP, LV2) are compatible
trivially; Audio Units is an OS API on macOS rather than a
redistributed SDK; OFX is permissively licensed. **No per-format
licensing row exists today** — the matrix carries only the two coarse
fail-closed gates, `native-plugins` (per-format-and-platform license
review, redistribution/user-installation policy, sandbox review,
notices) and `native-codecs` (codec license inventory, corresponding
source where required, jurisdiction-specific patent review, package
notices) at config/production-licensing-matrix.json:326-337, with the
bypass fence at docs/production-licensing-policy.md:151-153. Milestone
5 authors the per-format and per-codec rows from scratch, modeled on
the existing runtime rows
(config/production-licensing-matrix.json:214-260), and respects the two
already-blocked FFmpeg release gates
(`ffmpeg-enabled-library-corresponding-source`,
`ffmpeg-enabled-codec-patent-review`,
config/production-licensing-matrix.json:307-317): a native FFmpeg
helper does not enlarge the enabled codec set until those gates clear
for the enlarged set. Hardware-codec enablement (NVENC, QSV,
VideoToolbox, VAAPI) is a per-codec licensing/patent question first and
a performance feature second.

Signing and notarization become real in this milestone: §5's exit gate
includes "packaging, signing, notarization, licensing, and source
audits" (roadmap.md:614-615). Today macOS is ad-hoc-signed with
hardened runtime off (electron-builder.config.cjs:63-65), CI disables
signing everywhere
(`.github/workflows/desktop-preview.yml:248` et al.), and previews are
documented as unsigned (docs/production-threat-model.md:1379-1380).
Milestone 5 enacts the signing chain; milestone 9 requalifies it
release-shaped (docs/milestone-9-plan.md).

### Rejected alternatives (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| Native inference/decoding in `worker_threads` | A native crash kills the editor; helpers contain crashes by construction (the milestone-7 table already records this). |
| In-process plug-in hosting | "A malicious native plug-in is not made safe merely by running in another ordinary user process" (docs/production-threat-model.md:23) — and in-process is strictly worse; hosting is out-of-process with supervision, always. |
| A second renderer-reachable spawn channel | The residual acceptance forbids exposing raw spawn authority to the renderer (config/production-security-matrix.json:8508-8515); helpers are spawned and owned by main only. |
| Forking the editor engine for native paths | The exit gate requires native and web to implement the same semantic render plans (roadmap.md:611-612); the native tier accelerates plans, it never reinterprets them. |
| Enlarging the codec set because native FFmpeg makes it easy | The blocked corresponding-source and patent-review gates are fail-closed; capability follows evidence, not convenience. |
| Ultralytics-style GPL-incompatibility caution applied to VST3 | Wrong direction: this app is AGPL-3.0-only, so GPLv3 SDK code is compatible one-way; the real work is the per-format policy rows, not license fear. |

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| 5.0 | Serialized (one work stream) | Packaged-staging fix, helper contract v1 with first proof helper, threat-model/matrix enactment, binary provenance and signing enactment |
| 5A | Parallel track | Soundscaper native tier: audio device/backend helper, plug-in scanning, isolated plug-in hosting |
| 5B | Parallel track | Framescaper native tier: media engine helper, advanced decode/encode, persistent queues, watch folders, scratch volumes, isolated OFX |

5A and 5B must not begin until every 5.0 acceptance check passes. The
milestone-7 assistance helper, if it shipped first, is retrofitted onto
the 5.0 contract inside 5.0, not deferred.

## Work packets

5.0 packets are decomposed here; 5A/5B are summarized against the five
fields and decomposed into slice docs at pickup
(docs/milestone-3-plan.md:467-470).

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

### 5A packets (Soundscaper native tier; slice docs at pickup)

- **5A-1 — Native audio backend helper.** Outcome: per-OS low-latency
  backends behind one audio-device helper (exclusive/shared modes,
  channel topology, recording destinations, monitoring metadata,
  latency calibration, underrun reporting) with Web Core fallback;
  device enumeration converges with the existing routing service
  rather than forking it. Acceptance: the 30-minute loopback fixture
  with `audioRoundTripLatencyP95Ms lte 20` and
  `audioUnderrunFrames eq 0` (config/quality-budgets.json:1020-1021)
  on the provisioned matrix; graceful degradation on device loss.
  Non-goals: no MIDI devices, clock, or surfaces (8B fence). Stop:
  stop if any backend requires renderer-side native code.
- **5A-2 — Plug-in discovery and scanning.** Outcome: out-of-process
  scanning with quarantine, descriptors, consent and allow/deny
  policy, signing/compatibility metadata — discovery only, nothing
  hosted; the licensing rows from WP-5.0.2 gate which formats scan.
  Acceptance: the matrix's scanning/consent/revocation suite subset;
  a crashing or malicious scan target is quarantined and reported.
  Stop: stop before any instrument-class exposure (8B).
- **5A-3 — Isolated plug-in hosting.** Outcome: VST3 and CLAP
  cross-platform, AU on macOS, LV2 on Linux, hosted out-of-process
  under the helper contract; vendor UI receives no direct renderer
  authority; missing/crashed/quarantined plug-ins preserve state and
  offer bypass or frozen playback (roadmap.md:613-614) — consuming
  the milestone-4 freeze model. Acceptance: host-compromise, crash
  recovery, denial, and per-platform packaging suites
  (config/production-security-matrix.json:8566); PDC integration
  proves plug-in latency reports flow into the milestone-4 per-path
  compensation. Stop: stop if a format demands in-process hosting.
- **5A-4 — Exit evidence.** The 5A surface against
  `m5-native-helper-and-audio` recorded honestly on the
  `native-os-lab-matrix` environment — unprovisioned today
  (config/quality-budgets.json:198-212); unprovisioned rows stay
  named, never simulated (docs/quality-budgets.md:139-142).

### 5B packets (Framescaper native tier; slice docs at pickup)

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
  loopback) are registered with the eight thresholds above
  (config/quality-budgets.json:795-803, 1008-1024) against
  `native-os-lab-matrix`, whose six platform fingerprints are all null
  today. Provisioning follows the fixed-hardware checklist discipline
  (docs/quality-budgets.md:123-137); hosted-runner packaging is
  distribution evidence, never device qualification
  (docs/quality-budgets.md:139-142).
- Malformed-case and fault suites run in ordinary CI as correctness
  evidence; latency/underrun/RSS numbers qualify only on the
  provisioned matrix, no-retry (docs/quality-budgets.md:102-104).
- Bundle gates unchanged; helper binaries live outside the Pages
  bundle and the asar by construction.

## Two-agent coordination rules

- 5.0 is one work stream; 5A/5B open only after its acceptance passes.
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

- **Desktop packaging is broken at tip** by the `.ts`-import crash;
  WP-5.0.0 owns the fix unless milestone 7 landed it first — the two
  plans deliberately name the same first task.
- **The security matrix and threat model carry uncommitted edits** at
  grounding time; every cited line number there is re-verified at
  pickup, and the milestone-7 plan's stale helper-section line
  references are corrected alongside the first threat-model revision.
- **`native-os-lab-matrix` is unprovisioned**; the audio-latency and
  device thresholds cannot qualify until hardware exists. Development
  evidence proceeds; qualification rows stay honest.
- **Milestone-4 dependencies:** plug-in PDC integration needs the
  per-path compensation model; bypass/frozen-playback needs the freeze
  model. 5A-3 states both as pickup prerequisites.
- **The milestone-2 lease matrix** (`m2-electron-lease-matrix`,
  roadmap.md:290-296) is the standing concurrency substrate under all
  desktop evidence; still open at grounding.
- **Capture and MIDI fences hold throughout** (roadmap.md:109-122): no
  helper gains capture authority, and instrument-class plug-in
  exposure waits for 8B.

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
