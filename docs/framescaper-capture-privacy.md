# Framescaper capture privacy

Framescaper recording is an opt-in, local-first feature. It can capture a
camera, microphone, display, or a supported combination of those sources.
Display capture may also return system or tab audio when the browser and
operating system offer it. Framescaper treats that audio as a separate stream;
it does not imply that system audio is available.

## Consent and visible state

- Opening a project, opening a menu, showing Recording setup, or pressing an
  inactive Record control does not open a device. The inactive control only
  focuses the default-hidden **Recording setup** panel.
- A preview request consumes one fresh, direct user-action generation. Display
  selection is requested anew for each preview session.
- A desktop source list contains only bounded, pathless, short-lived tokens,
  display names, and source kinds. Framescaper never silently chooses its first
  entry. macOS uses the system picker when the qualified runtime supports it.
- The toolbar keeps a visible recording or paused state and a Stop action while
  capture is active, even when Recording setup is closed.
- Embedded Framescaper routes deny camera, microphone, and display capture.
  Standalone Framescaper routes receive their own non-overlapping document
  policy; Soundscaper routes remain denied.

Camera and microphone labels and identifiers are enumerated only after a
permissioned preview exists. They are held in the live session snapshot and are
not persisted as pre-permission identity. A device is never reopened
automatically after reload or recovery.

## Local data and publication

Capture packets, fragments, recovery manifests, and recorded assets stay in
the selected local project environment. Browser capture uses OPFS when it is
available and the existing bounded IndexedDB chunk store otherwise. Packaged
desktop capture keeps raw media in the renderer capture path; its isolated
desktop API carries only status, source-selection tokens, grants, and teardown
requests.

Framescaper records camera, microphone, display, and optional returned system
audio as distinct timestamped streams. It does not destructively resample the
original streams to conceal drift. Stop first releases the capture lease, then
finalizes durable assets and applies one project command. Recorded audio and
video become ordinary project sources with bounded capture provenance, so the
normal relink, proxy, edit, `.scape`, handoff, and delivery paths apply.

Incomplete acknowledged data remains local as an explicit recovery session.
Framescaper offers three deliberate decisions: recover and publish, import a
playable acknowledged prefix as-is, or delete the session-owned data. Closing
the recovery surface makes no decision. A committed or discarded session is no
longer offered as recovery.

## Failure and teardown

The capture source set is frozen when armed. Denial, revocation, a required
source ending, backpressure, storage failure, or encoder failure stops further
acceptance, seals the acknowledged prefix when possible, and releases the
owned preview and recorder resources. Pausing applies to every source together
and excludes the paused span from active capture time.

Capture remains bound to the origin project revision and playhead while other
projects may be used. The origin project cannot be edited, closed, deleted, or
handed off until the capture is stopped or discarded. A stale origin revision
leaves recoverable assets instead of applying a partial project mutation.

Renderer revocation, controller disposal, application shutdown, and explicit
desktop teardown invalidate the current generation and join resource cleanup.
Short-lived desktop grants are single-use and expire if they are not consumed.

## Qualification status

Automated tests cover permission admission, source combinations, state and
resource ownership, durable acknowledged-prefix recovery, atomic publication,
origin fencing, route policies, and desktop grant isolation. The registered
30-minute, six-combination device workload remains provisional because
`capture-os-browser-lab-matrix` is unprovisioned and is not qualification
eligible. No browser or operating-system device-performance qualification is
claimed until that controlled matrix is provisioned and passes its registered
budgets.
