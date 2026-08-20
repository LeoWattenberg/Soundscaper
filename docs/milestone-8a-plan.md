# Milestone 8A plan: Framescaper capture

> Owning source for milestone-8A sequencing, capture contracts, durability and
> recovery invariants, platform decisions, and bounded work packets. The
> [roadmap](../roadmap.md#8a-framescaper-recording-setup) owns scope and status.
> Milestone 8B MIDI remains independently blocked and is outside this plan.

## Summary

Implement Framescaper camera, microphone, screen, and optional system-audio
capture. MIDI remains fenced and unchanged.

Capture is runtime-gated and usable only where the complete capture,
persistence, and probing stack is supported. Milestone status remains
provisional until the required real-device lab qualifies all six source
combinations.

## Work packets

### 8A-0: Plan and contracts

- Add the owning milestone-8A plan and divide delivery into atomic TDD packets.
- Introduce a Framescaper-only `framescaperCapture` capability, separate from
  Soundscaper audio recording.
- Activate the `framescaper-capture` platform contract while preserving every
  MIDI block and inertness test.

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
- Persist a CAS-forward capture manifest before accepting media. Only its
  acknowledged packet prefix is recoverable.
- Seal recoverable data on source loss, quota or encoder failure, reload,
  helper loss, or quit, and release devices promptly.
- On restart offer exactly: recover, import playable acknowledged data as-is,
  or delete all session-owned storage.
- Extend retention and garbage collection to protect active and recoverable
  encoded capture roots.

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
- Generate thumbnails, posters, waveforms, and proxies asynchronously after
  canonical commit; derivative failures become warnings rather than capture
  loss.
- Bind capture to its origin project revision and playhead while permitting the
  user to switch to and edit other projects.
- Freeze the origin against edits and block its close, deletion, or handoff
  until stop or discard.
- Publish through a background origin-project controller. A revision mismatch
  leaves a sealed recovery session rather than partially mutating the project.

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
- Keep the quality workload provisional and the milestone in progress until the
  real-device matrix is provisioned and passes.
- Update security, privacy, platform-capability, and quality evidence through
  their owning registers and required narrative-sync and digest-repin workflows.
- Preserve all MIDI fences and leave milestone 8B blocked.

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
- Capture remains bound to its origin project while the user works elsewhere;
  the protected origin cannot be mutated, closed, deleted, or handed off.
- Recorded assets follow ordinary relink, proxy, edit, `.scape`, handoff, and
  delivery paths. Capture provenance does not require a project-schema bump.

## Verification

- Unit-test lifecycle transitions, direct-gesture generations, leases, shared
  clock and pause math, metrics, MIME negotiation, and cleanup.
- Fault-test manifest CAS, acknowledged-prefix recovery, bounded queues,
  backpressure, storage failure, crash boundaries, retention, duplicate
  finalization, and exact-token deletion.
- Test atomic publication, rollback, origin-project locking, inactive-origin
  commit, `.scape` round trips, relink, proxy, edit paths, and unchanged MIDI
  fences.
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
- Runtime support requires the complete source, encoder, durable-storage, and
  probe path; partial support does not enable Record.
- The capture quality workload remains provisional. Do not claim qualification
  while `capture-os-browser-lab-matrix` is unprovisioned or ineligible.
- Stop a packet if it would require weakening storage atomicity, device-consent
  rules, origin-project protection, capture metrics, security policy, or
  existing A/V invariants; revise the owning contract before continuing.
- Do not add dependencies unless the implementation proves an existing
  platform adapter cannot meet the accepted qualification thresholds.
- Do not implement or relax any MIDI contract, schema, UI, device, import,
  export, or native bridge as part of milestone 8A.
