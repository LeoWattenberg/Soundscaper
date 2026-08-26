# Milestone 8A plan: Framescaper capture

> Owning source for milestone-8A sequencing, capture contracts, durability and
> recovery invariants, platform decisions, and bounded work packets. The
> [roadmap](../roadmap.md#8a-framescaper-recording-setup) owns scope and status.
> Milestone 8B MIDI remains independently blocked and is outside this plan.

## Summary

Framescaper camera, microphone, screen, and optional system-audio capture is
implemented and active on the selected F31 standalone web and desktop routes.
MIDI remains fenced and unchanged.

**Status:** **Implemented and active on selected F31 standalone web and desktop.**
The product sets `framescaperCapture: true` and admits the exact capture route
authority through its controller, app binding, and runtime probe.
Recording Setup remains default-hidden and requires explicit opt-in through **View > Panels**.
`framescaperWebVcr: false` keeps the post-milestone extension disabled.
Schema-19 web, schema-18 desktop, and schema-20 web/desktop remain historical
compatibility surfaces. Activation intentionally precedes qualification:
manual qualification remains open until the provisional, unprovisioned real-device and
owner-lab matrix passes all six source combinations.

## Work packets

### 8A-0: Plan and contracts

- Add the owning milestone-8A plan and divide delivery into atomic TDD packets.
- Introduce a Framescaper-only `framescaperCapture` capability, separate from
  Soundscaper audio recording.
- Implement the `framescaper-capture` platform contract while preserving every
  MIDI block and inertness test. Selected-F31 web and desktop activation is
  complete; real-device and owner-lab qualification remains a separate gate.

### 8A-1: Capture domain

- Add strict TypeScript controllers for the phases: inactive,
  permission-pending, previewing, armed, countdown, recording, paused,
  finalizing, recovery, and failed.
- Support camera, microphone, display, and optional returned system audio under
  one monotonic active-time clock.
- Freeze the source set when armed. Pause all sources together and exclude
  paused spans from media time.
- Default countdown to three seconds, monitoring off, and gain to unity.

### 8A-2: Browser capture

- Use explicit preview leases and never open a device on page load, menu
  opening, or an inactive Record shortcut.
- Request display capture directly from each user gesture; request display
  before camera or microphone for combined sessions and release everything if
  a later request fails.
- Capture each video source with an independent video-only `MediaRecorder`;
  negotiate supported formats and retain the recorder's actual MIME type.
- Capture microphone and system audio as timestamped PCM using the qualified
  track-processor path with an AudioWorklet fallback.
- Report measured drops and drift; unsupported measurement is recorded as
  unavailable, never as zero.

### 8A-3: Durability and recovery

- Add bounded encoded-fragment spooling using OPFS when available and the
  existing chunked-storage fallback otherwise. Keep physical records within
  the existing 4 MiB chunk limit.
- Persist a closed, leased creation inventory before creating spools, then a
  CAS-forward capture manifest before accepting media. Only the manifest's
  acknowledged packet prefix is recoverable; startup retries exact partial
  creation cleanup even when the origin project is absent.
- Fence every encoded and raw body with a durable exact previous-to-next append
  intent. Hold one outer project/session Web Lock through manifest reread and
  CAS, acquiring nested exact spool locks only in that direction. Retire an
  intent at the next manifest prefix, restore metadata and tail at the previous
  prefix, and fail closed on any other prefix or changed ownership.
- Persist physical-tail cleanup and terminal deleting state, including raw
  global-reservation ownership, so interruption cannot orphan admitted capacity
  and startup can resume the exact retirement operation.
- Seal recoverable data on source loss, quota or encoder failure, reload,
  helper loss, or quit, and release devices promptly.
- On restart offer exactly: recover, import playable acknowledged data as-is,
  or delete all session-owned storage.
- Extend retention and garbage collection to protect active and recoverable
  encoded capture roots.

#### Committed crash-safe durability evidence

The crash-safe creation and append protocol landed in commit `917add78`.
Runtime admission and orchestration are owned by
`src/common/editor/controller/framescaper-capture-app-composition.ts`,
`src/common/editor/controller/framescaper-capture-durable-creation.ts`, and
`src/common/editor/controller/framescaper-capture-durable-session.ts`. Closed
creation inventory and fencing are owned by
`src/common/editor/storage/framescaper-capture-creation-admission.ts`,
`src/common/editor/storage/framescaper-capture-session-creation-repository.ts`,
and `src/common/editor/storage/capture-spool-creation-fence.ts`.

Exact append intent, lock ordering, prefix repair, tail cleanup, and terminal
retirement are owned by
`src/common/editor/storage/capture-spool-append-intent-repository.ts`,
`src/common/editor/storage/capture-spool-operation-lock.ts`,
`src/common/editor/storage/encoded-capture-spool-append.ts`,
`src/common/editor/storage/raw-pcm-spool-append.ts`,
`src/common/editor/storage/capture-spool-tail-cleanup-repository.ts`, and the
encoded/raw spool repositories and tail-cleanup modules. The focused proofs are
`tests/audio-editor-framescaper-capture-creation-recovery.test.ts`,
`tests/audio-editor-framescaper-capture-prewrite-intent.test.ts`,
`tests/audio-editor-framescaper-capture-rollback-lock.test.ts`,
`tests/audio-editor-framescaper-capture-tail-cleanup.test.ts`,
`tests/audio-editor-framescaper-capture-opfs-cleanup.test.ts`, and
`tests/audio-editor-framescaper-capture-terminal-retirement.test.ts`. They cover
partial creation with an absent origin, a crash after body/metadata but before
manifest CAS, two stale contexts across different streams, manifest-CAS
commit-then-throw reconciliation, stale recovery inventory reread, resumable
physical-tail cleanup, and terminal reservation retirement.

### 8A-4: Project publication and lifecycle

- Finalize and publish every captured stream durably before applying one atomic
  project command.
- Store audio as ordinary PCM sources and video as ordinary retained media with
  exact timing and probe assets.
- Offer Project Bin, timeline, or both; default to both.
- Create one timeline lane per stream at the record-start playhead. Group all
  clips by capture session and only create A/V links when existing
  exact-alignment invariants are satisfied.
- Pair camera with microphone and display with system audio when valid; camera
  appears above display. Camera plus screen plus microphone leaves display
  independent.
- Add bounded provenance and metrics under
  `opaqueExtensions.framescaperCaptureV1`; keep the project schema version
  unchanged.
- After canonical capture and manifest commit, queue thumbnails, posters,
  waveforms, and captured-video proxies without awaiting them. Schedule exactly
  one proxy after the poster/filmstrip attempt for every valid owned captured
  video and zero proxies for audio; aggregate derivative failures as warnings
  rather than capture loss.
- Bind capture to its origin project revision and playhead while permitting the
  user to switch to and edit other projects.
- Freeze the globally admitted exact origin against edits and block its close,
  deletion, or handoff through successful live or recovery publication, or
  explicit discard. A failed Stop remains protected recovery state.
- Publish through a background origin-project controller. A revision mismatch
  leaves a sealed recovery session rather than partially mutating the project.

#### Committed captured-video proxy evidence

The capture-only proxy route landed in commit `4f4d9d5a`. Canonical fire-and-forget
scheduling is owned by
`src/common/editor/controller/framescaper-capture-canonical-publication.ts` and
`src/common/editor/controller/framescaper-capture-derivative-scheduler.ts`.
Product composition and exact selected-F31 web/desktop attachment, with
historical V19-web/V18-desktop compatibility, are owned by
`src/common/editor/app.js`,
`src/framescaper/editor-captured-video-proxy-scheduler-composition.ts`, and
`src/framescaper/editor-captured-video-proxy-scheduler.ts`; the focused body,
claim, CAS-fence, preservation, landed/indeterminate reconciliation, request,
lineage-state, and session-install owners are the sibling
`src/framescaper/editor-captured-video-proxy-*.ts` modules.

The exact focused proofs are
`tests/audio-editor-framescaper-capture-derivative-scheduler.test.ts`,
`tests/audio-editor-framescaper-captured-video-proxy-scheduler.test.ts`,
`tests/audio-editor-framescaper-captured-video-proxy-reconciliation.test.ts`, and
`tests/audio-editor-framescaper-captured-video-proxy-final-fence.test.ts`.
They cover one proxy job per captured video and none for audio, selected F31 and
historical V19 web/V18 desktop inactive-origin publication, active-origin
synchronization, source/CAS races, multiple captured videos, determinate
cleanup, landed automatic reconciliation, save/history fencing, disposal, and
capture-derived `.scape` round-trip/reopen through ordinary proxy selection.
The capture-only post-commit scheduler remains separate from the selected F31
general editorial proxy lifecycle, including menu-invoked generation, adaptive
selection, offline editing, detach, relink, regeneration, and cancellation.

### 8A-5: UI and accessibility

- Add a default-hidden, Framescaper-only Recording Setup workspace panel
  reachable from **View > Panels**.
- The first menu opt-in records a local workspace preference; only then may the
  existing toolbar slot expose the Framescaper Record split control.
- An inactive Record action focuses setup and never opens devices. Armed starts;
  recording or paused stops and imports.
- Provide preview tiles, source and format selectors, meters, destination,
  countdown, monitoring, elapsed time, drop and drift status, and recovery
  actions.
- Keep a visible stop and status control while capture is active, even if the
  panel closes.
- Add complete keyboard operation, focus restoration, live-region
  announcements, non-color state cues, forced-colors support, and localized
  copy.

### 8A-6: Electron and deployment security

- Add a control-plane-only desktop capture port; raw audio and video never
  cross IPC.
- Validate product, trusted origin, focused sender, session generation, and
  single-use expiring grants.
- Use the macOS system picker where supported; otherwise present a bounded
  source chooser. Never silently choose the first screen.
- Gate system audio by truthful platform and runtime probes and add required
  signed macOS camera, microphone, and audio-capture metadata and entitlements.
- Extract new main and preload handlers rather than growing
  maintainability-allowlisted files.
- Generate mutually exclusive Pages document policies: standalone Framescaper
  routes allow required capture features, embedded routes deny them, and
  Soundscaper retains its current policy. Prevent overlapping rules from
  producing comma-joined `Permissions-Policy` headers.

### 8A-7: Qualification and evidence

- Add the 30-minute, six-combination quality collector and bind its evidence to
  the registered workload and environment fingerprint.
- Keep the quality fixture, workload, and external qualification provisional
  until the real-device matrix is provisioned and passes; implementation
  completion does not qualify that matrix.
- Update security, privacy, platform-capability, and quality evidence through
  their owning registers and required narrative-sync and digest-repin workflows.
- Preserve all MIDI fences and leave milestone 8B blocked.

#### Committed timing and configured-browser evidence

Commit `15a50dcb` normalizes an aggregate `unavailable` timing verdict in
`src/common/editor/controller/framescaper-capture-stream-timing.ts`: numeric
drop and drift fields remain `null` rather than retaining a misleading value.
`tests/audio-editor-framescaper-capture-shared-timing.test.ts` owns the focused
regression.

Commit `70d1192e` expands
`tests/browser/framescaper-v19-capture.spec.js` to eight configured-Chromium
cases covering default-hidden consent, embedded and incomplete-runtime denial,
all six preview combinations, pause/resume and ordinary-media reopen, mixed
four-stream publication/reopen, capture publication to an inactive origin while
another project is edited, later-request cleanup, and source-ended recovery.
This synthetic-media evidence does not provision or qualify the external
camera, microphone, display, system-audio, operating-system, or browser matrix.

Commits `5ccf6447`, `2c6e2a94`, and `16029166` preserve that historical
coverage while restoring it against the selected F31 route, schema, and storage
profile, pacing the synthetic audio source at a realistic cadence, and making
the fixture portable across the configured Chromium, Firefox, and WebKit
projects. The eight cases now define 24 configured-engine cases and additionally
assert that opening capture does not implicitly enumerate devices, that closing
and reopening the panel preserves an active recording, and that mixed video
publication completes its camera and display proxies. These remain synthetic
automation results: actual devices, operating-system pickers, encoders,
long-session performance, and manual privacy behavior are still unqualified.

## Public interfaces

- `CaptureSourceRole`: `camera | microphone | display | system-audio`.
- `CaptureDestination`: `project-bin | timeline | both`.
- `CapturePhase`: the closed lifecycle defined in packet 8A-1.
- `CaptureSourcePortV1`: probe, enumerate, explicit preview lease, actual
  settings and capabilities, and idempotent disposal.
- Timestamped encoded-video and PCM-audio packet contracts carrying session,
  stream, sequence, PTS, duration, receipt time, size or frame count, and drop
  evidence.
- `CaptureActions`: open setup, preview or configure, arm, start, pause, resume,
  stop, release, recover, import as-is, and discard.
- Framescaper state exposes `snapshot.capture` and `actions.capture`; existing
  Soundscaper `recording` contracts remain unchanged.
- The desktop API exposes source listing, grant, status, and teardown only.

## Capture and publication invariants

- The six required source combinations are camera only, microphone only,
  display only, camera plus microphone, display plus microphone, and camera plus
  display plus microphone. System or tab audio is optional and represented as a
  separate stream only when the selected source returns it.
- `getDisplayMedia()` is invoked from a fresh direct user gesture for every
  session. Device labels and identifiers are not persisted before permission,
  and no device is reopened automatically.
- All streams use a shared monotonic clock and retain original per-packet timing.
  Capture never destructively resamples sources to force alignment.
- The armed source set is immutable. A required source ending seals the whole
  session's acknowledged prefix for recovery.
- Stop releases capture devices before potentially long finalization work.
- Project state is changed exactly once, after all canonical assets are durable.
  Commit failure leaves recoverable owned assets and never partial clips.
- Startup scans stored project IDs current-first, admits at most one global
  recovery, and opens a closed exact-origin project as an inactive tab before
  exposing its explicit recovery decisions.
- Capture remains bound to its origin project while the user works elsewhere;
  the protected origin cannot be mutated, closed, deleted, or handed off.
- Each stream becomes one ordinary durable source. Project Bin adds one bin
  item/clip reference per source; timeline adds one dedicated track/lane and
  clip per stream; **both** reuses those same sources. Recorded assets follow
  ordinary relink, proxy, edit, `.scape`, handoff, and delivery paths. Capture
  provenance does not require a project-schema bump.
- Canonical capture success does not await disposable derivatives. A captured
  video's proxy attachment, when generated, is a later exact project revision;
  failure is a warning and never rolls back the committed capture.

## Verification

- Unit-test lifecycle transitions, direct-gesture generations, leases, shared
  clock and pause math, metrics, MIME negotiation, and cleanup.
- Fault-test manifest CAS, acknowledged-prefix recovery, bounded queues,
  prewrite append intents, session-to-spool cross-context lock ordering,
  backpressure, storage failure, crash boundaries, durable tail cleanup,
  terminal retirement, retention, duplicate finalization, and exact-token
  deletion.
- Test atomic publication, rollback, origin-project locking, inactive-origin
  commit, `.scape` round trips, relink, proxy, edit paths, and unchanged MIDI
  fences.
- Prove post-commit scheduling queues every valid captured video exactly once,
  queues no audio proxy, and reports a proxy failure only through the derivative
  warning path.
- Browser-test the default-hidden opt-in, absence of implicit device access, all
  six required combinations, optional system audio, permission and source loss,
  pause and resume, destinations, project switching, recovery, accessibility,
  and unsupported-runtime messaging.
- Desktop-test sender and grant validation, picker behavior, teardown,
  product-specific headers, packaging metadata, and applicable packaged smoke
  paths.
- Run focused tests throughout, then `npm test`, `npm run build`, focused and
  full Playwright suites, packaging and security checks, and `npm run check`.
- The 30-minute quality workload must meet: no more than 20 ms drift, no more
  than 0.001 dropped-frame ratio, zero unreported drops, zero audio-dropout
  frames, no more than one-second p95 teardown, zero unrecoverable fragments,
  and zero unauthorized opens.

## Status, defaults, and stop conditions

- Browser and Electron media APIs are the initial encoder path. Add a native
  encoder behind the same port only if qualification proves it necessary.
- Embedded Framescaper capture remains unsupported.
- Selected-F31 runtime support requires the exact Framescaper route plus the complete source,
  supported video encoder, audio packet, cross-context Web Lock,
  encoded/raw/manifest repository, video-probe, and canonical-publication path;
  partial support does not enable Record.
- Selected F31 admits capture on standalone web and desktop only through its
  exact controller, app binding, and runtime probe. Embedded Framescaper remains
  denied; historical exact routes retain compatibility and recovery behavior.
- The capture quality fixture and workload remain provisional. Do not claim
  qualification while `capture-os-browser-lab-matrix` is unprovisioned or
  ineligible. The packaged no-device control-plane smoke is not actual packaged
  camera, microphone, operating-system picker, loopback, encoder, or timing
  qualification.
- Stop a packet if it would require weakening storage atomicity, device-consent
  rules, origin-project protection, capture metrics, security policy, or
  existing A/V invariants; revise the owning contract before continuing.
- Do not add dependencies unless the implementation proves an existing
  platform adapter cannot meet the accepted qualification thresholds.
- Do not implement or relax any MIDI contract, schema, UI, device, import,
  export, or native bridge as part of milestone 8A.
