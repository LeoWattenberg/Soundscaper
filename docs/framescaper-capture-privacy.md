# Framescaper capture privacy

> **Active selected boundary (2026-08-25):** selected Framescaper F31 sets
> `framescaperCapture:true` and activates capture on standalone web and desktop
> through its exact controller, app binding, and runtime probe. Recording Setup
> remains default-hidden and requires explicit opt-in through **View > Panels**.
> Manual real-device and owner-lab qualification is tracked only by the
> milestone-9 stable 1.0 admission record. `framescaperWebVcr:true` enables the
> default-hidden, Record-menu-owned post-milestone extension for testing now.

The selected F31 capture implementation is local-first. It can capture a
camera, microphone, display, or a supported combination of those sources.
Schema-18 desktop, schema-19 web, and schema-20 web/desktop are retained as
historical compatibility routes.
Display capture may also return system or tab audio when the browser and
operating system offer it. Framescaper treats that audio as a separate stream;
it does not imply that system audio is available.

## Consent and visible state

- On selected F31, opening a project or menu, opting into and showing the
  default-hidden Recording Setup panel, or pressing an inactive Record control
  does not open a device.
- A preview request consumes one fresh, direct user-action generation. Display
  selection is requested anew for each preview session.
- A desktop source list contains only bounded, pathless, short-lived tokens,
  display names, and source kinds. Framescaper never silently chooses its first
  entry. macOS uses the system picker when the qualified runtime supports it.
- An active or recovery-owned session keeps visible status and the exact Stop,
  release, recovery, or discard action needed to relinquish media, even if the
  Recording Setup panel closes.
- Embedded Framescaper routes deny camera, microphone, and display capture.
  Standalone Framescaper routes receive their own non-overlapping document
  policy. Framescaper recording is unavailable in Soundscaper; Soundscaper
  retains its existing microphone/display policy with camera denied.

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

Before recorder acceptance, a short-lived closed creation inventory owns the
intended spool identities. The closed CAS manifest then owns the acknowledged
packet prefix. A partial creation is cleaned by exact token on failure or a
later startup, including when its origin project is no longer in the project
inventory; changed ownership fails closed.

Every encoded and raw append first records an exact previous-to-next durable
intent, then writes its body and spool metadata. One outer project/session Web
Lock is held through authoritative manifest reread and compare-and-swap; nested
per-spool Web Locks are acquired only in that order. Recovery therefore cannot
mistake a longer physical spool for acknowledged media: the next manifest
prefix retires the intent, the previous prefix restores metadata and deletes
the unacknowledged tail, and any other prefix or changed token fails closed.
Passive spool inspection cannot roll an append back without an authoritative
manifest prefix. Tail-cleanup intents, terminal deleting state, and raw global
reservations survive interruption so startup can resume their exact cleanup.

Framescaper records camera, microphone, display, and optional returned system
audio as distinct timestamped streams. It does not destructively resample the
original streams to conceal drift. Stop first releases the capture lease, then
finalizes durable assets and applies one project command. Each recorded stream
becomes exactly one ordinary durable project source with bounded capture
provenance. Project Bin publication adds one bin item and clip reference per
source; timeline publication adds one dedicated track, lane, and clip per
stream; **both** reuses those same sources rather than duplicating media. The
normal relink, proxy, edit, `.scape`, handoff, and delivery paths apply.

Only after canonical capture and manifest commit does Framescaper queue
disposable derivatives without awaiting them. Audio receives ordinary waveform
activation and never a proxy job. Every valid owned captured video receives one
proxy job after its poster and filmstrip attempt. The proxy request binds the
capture session, origin project, source, committed revision, and source digest;
selected F31 and historical exact V19 web, V18 desktop, and V20 web/desktop
compatibility routes may attach it while the origin is inactive without
switching the user's active project. A proxy or reconciliation failure
is reported as a warning and does not roll back canonical recorded media. This
capture-derived post-commit route remains separate from selected F31's general
editorial proxy lifecycle.

Incomplete acknowledged data remains local as an explicit recovery session.
Startup scans stored project IDs current-first, admits at most one global
recovery, and opens a closed exact-origin project as an inactive tab before the
recovery decision is exposed. Framescaper offers three deliberate decisions:
recover and publish, import a playable acknowledged prefix as-is, or delete the
session-owned data. Closing the recovery surface makes no decision. A committed
or discarded session is no longer offered as recovery.

## Failure and teardown

The capture source set is frozen when armed. Denial, revocation, a required
source ending, backpressure, storage failure, or encoder failure stops further
acceptance, seals the acknowledged prefix when possible, and releases the
owned preview and recorder resources. Pausing applies to every source together
and excludes the paused span from active capture time.

Capture remains bound to the exact origin project revision and playhead while
other projects may be used. The globally admitted origin cannot be edited,
closed, deleted, or handed off until successful live or recovery publication,
or an explicit discard. A failed Stop or publication attempt preserves the
recovery decision and origin protection. A stale origin revision leaves
recoverable assets instead of applying a partial project mutation.

Renderer revocation, controller disposal, application shutdown, and explicit
desktop teardown invalidate the current generation and join resource cleanup.
Short-lived desktop grants are single-use and expire if they are not consumed.

Record is available on selected F31 standalone web and desktop only when the
source, supported video encoder, audio packet path, cross-context Web Locks, complete
encoded/raw/manifest repository set, video probe, and canonical publication
store are all present. A partial stack remains unavailable; the presence of Web
Locks alone is not a durability or device qualification claim.
Historical exact schema-19 web, schema-18 desktop, and schema-20 web/desktop
remain compatibility routes, and embedded Framescaper remains denied.

## Active Web VCR privacy boundary

The Framescaper Web VCR software substrate is enabled with
`framescaperWebVcr: true`. Its panel is default-hidden and summon-only from the
Record menu. Startup and ordinary project use create no remote guest, popup,
persistent profile, or capture grant; those resources are materialized lazily
only after a direct user action summons the feature.

Web VCR authentication lives only in a dedicated persistent profile. Browser
URL, page title, and login state stay
ephemeral; crop gesture history and diagnostic data stay out of project state. The remote
page naturally receives the navigation and interactive input sent to it, but
it receives no editor preload, IPC, filesystem, project, helper, shell, or
DevTools authority. HTTPS authentication popups use the same isolated profile,
and unrelated downloads and permissions are denied. The explicit idle-only
clear action must destroy the guest and every popup before clearing cookies,
cache, and site storage.

A record action must freeze one validated crop, keep page-audio capture
independent of local monitoring, and admit only the verified cropped result as
an ordinary project asset. An uncropped intermediate is capture-owned working
data, never a Project Bin asset, and must be removed after verified crop
publication or preserved only inside the existing explicit recovery envelope
until import or discard. Exact-surface, encoder-crop, cropped-only retention,
sync, drop, teardown, and recovery machine checks all fail closed per recording.

The deterministic loopback HTTPS fixture and its Linux x64/Xvfb packaged
feasibility smoke are evidence only. The smoke emits `qualification: false`
after authentication, interactive input, exact 720p and 1080p owned-guest
video, page audio, visual-marker, crop/ended, data-clear, and teardown checks.
It does not establish the supported real-runtime matrix, encoder performance,
long-session, platform, or privacy qualification, and it uses only a checked-in
test certificate and loopback content rather than public network or provider
credentials. Those human reviews are milestone-9 stable 1.0 admission checks;
they never disable the enabled build or test surface.

## Qualification status

Automated tests cover permission admission, source combinations, state and
resource ownership, exact stream timing and bounded PCM gap materialization,
closed creation recovery, prewrite append-intent recovery, cross-context
session-to-spool ordering, durable tail repair and terminal retirement, atomic
publication, inactive and closed origin handling, ordinary asset exits,
post-commit one-per-video/zero-audio proxy scheduling, V19/V18 inactive-origin
attachment, active reconciliation and proxy cleanup/fencing, route policies,
and desktop grant isolation. The selected F31 route, schema, storage profile,
and controller-owned capture binding are covered without replacing the
historical V19/V18 evidence.
Configured Chromium, Firefox, and WebKit exercise the eight-case browser
workflow with synthetic media: no implicit device enumeration, embedded and
incomplete-runtime denial, all six source combinations, pause/resume and reopen,
mixed four-stream proxy completion, inactive-origin publication, later-denial
cleanup, and source-ended recovery. This comprises 24 configured-engine cases.
A packaged, no-device desktop smoke exercises only the
pathless control-plane authority, status, grant, and teardown boundary; it does
not exercise an actual camera, microphone, operating-system picker, loopback
device, encoder, or long capture.

The selected F31 implementation is active on standalone web and desktop, while
its manual qualification remains provisional. The registered 30-minute,
six-combination fixture and workload remain provisional because
`capture-os-browser-lab-matrix` is unprovisioned and is not qualification
eligible. Synthetic configured-engine evidence and packaged no-device smoke
do not close this gate. No browser, operating-system, owner-lab, or
packaged-device performance qualification is claimed until that controlled
matrix is provisioned and passes its registered budgets.
