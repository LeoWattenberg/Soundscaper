# Framescaper Web VCR

Web VCR is a Framescaper-desktop capture source for authorized HTTPS media. It
owns the isolated guest, navigation and crop behavior, page-audio monitoring,
and its desktop trust boundary. Recording durability, recovery, publication,
and origin-project protection come from the shared Framescaper
[capture contract](framescaper-capture.md).

Product status and future sequencing belong in the
[roadmap](../../roadmap.md). The current capability declaration is in
[`production-capabilities.json`](../../config/production-capabilities.json).

## Current surface

`framescaperWebVcr: true` enables the desktop-only surface. **Web VCR** in the
Record flyout summons its default-hidden panel; it is absent from View >
Panels, Preferences, command search, Soundscaper, and both browser products.
A normal startup creates no remote guest, popup, persistent browser profile,
or capture grant. A direct user action opens the isolated guest lazily.

The maintained surface provides:

- persistent HTTPS authentication in a dedicated profile;
- whole-page audio, independently mutable local monitoring, and one captured
  video surface;
- a crop frozen when recording starts;
- optional automatic stop for the selected standard HTML media element; and
- 720p and 1080p viewport profiles, subject to live machine capability checks.

The 4K choice is available only when both the runtime capture probe and the
selected encoder backend report support. A capability mismatch refuses before
recording rather than silently lowering quality. A virtual viewport or device
scale never claims to force a provider's source resolution or bitrate.

Web VCR does not support DRM, EME or HDCP capture, anti-bot evasion,
user-agent spoofing, HTTP browsing, arbitrary downloads, provider-specific
player adapters, or isolated-element audio. It adds no project schema,
recording clock, or general remote-content IPC bridge.

## UI and lifecycle

- Selecting **Web VCR** makes `web-vcr` the active capture mode and opens or
  focuses the panel.
- The primary Record control and the panel control call the same exclusive
  capture action. While recording, the primary control remains active even if
  the panel closes or another project becomes active.
- The panel contains Back, Forward, Reload, an HTTPS address field, a zoom-fit
  interactive preview, Record/Stop & Import, local-output mute, automatic crop,
  720p/1080p/4K viewport choices, automatic stop, and free/16:9/9:16/1:1 crop
  controls.
- Defaults are 1080p, automatic crop on, free aspect, audible local output,
  and automatic stop off. Viewport, target, and aspect changes are disabled
  during recording.
- The panel reports actual captured dimensions and detected media dimensions,
  including a warning when the source appears lower-resolution than the render
  surface.
- URL, page title, login state, crop gestures, and diagnostics stay out of
  project state. Published takes receive a generic timestamped name and remain
  ordinarily renameable.

Closing the idle panel suspends or destroys its guest without clearing the
persistent profile. Closing it during recording leaves capture running. The
shared capture service binds the take to its origin project, sequence,
record-start playhead, and Recording Setup destination. Other projects remain
usable, but the origin cannot close or be deleted until the take is published
or discarded. Application quit stops input and leaves the acknowledged prefix
in the ordinary capture recovery flow for explicit import or discard.

## Desktop trust boundary

The focused main-process
[`framescaper-web-vcr-host.ts`](../../desktop/framescaper-web-vcr-host.ts)
and separately registered
[`framescaper-web-vcr-preload.ts`](../../desktop/framescaper-web-vcr-preload.ts)
own the desktop boundary. No preload is exposed to remote content.

The host owns one guest generation and the dedicated
`persist:framescaper-web-vcr-v1` partition. Guest web preferences retain
sandboxing, context isolation, disabled Node integration, web security, and
disallowed insecure content. Top-level navigation accepts HTTPS and the
internal blank page only. Downloads and unrelated camera, microphone, display,
location, notification, MIDI, USB, serial, and Bluetooth permissions are
denied.

Authentication popups are bounded HTTPS-only guest windows in the same
partition, with the same web preferences and no opener-granted native
authority. The idle-only **Clear browser data** action destroys the guest and
all popups before clearing cookies, cache, and site storage.

The remote page receives no editor preload, IPC, filesystem, project, helper,
shell, or raw DevTools authority. Main owns navigation, target observation,
viewport emulation, input forwarding, capture grants, popup policy, and
teardown. The trusted renderer receives only a frozen, versioned, pathless API
with closed DTO validation, bounded strings and coordinates, opaque session
identities, and owner/generation checks.

Target observation runs in a CDP isolated world without exposing its binding
to the page's main world. It reports bounded geometry and media state only.
Main treats tracker results as untrusted input and exposes no arbitrary
evaluation or CDP method to the renderer. The closed desktop messages are
defined by
[`framescaper-web-vcr-contract.ts`](../../desktop/framescaper-web-vcr-contract.ts).

## Capture adapter

The Web VCR adapter supplies the shared capture service with the guest video
source, whole-page audio track, monotonic clock, drop metrics, recovery owner,
and opaque guest generation. Binary video and audio never cross the control
bridge. Bounded fragments, backpressure, durable storage, recovery, canonical
asset publication, destination handling, and origin-project fencing follow the
same contract as camera, microphone, and display capture.

The adapter and finalizer are owned by
[`framescaper-web-vcr-capture-adapter.ts`](../../src/common/editor/controller/capture/internal/web-vcr/framescaper-web-vcr-capture-adapter.ts)
and
[`framescaper-web-vcr-finalizer.ts`](../../src/common/editor/controller/capture/internal/web-vcr/framescaper-web-vcr-finalizer.ts).
The domain and crop arithmetic live in
[`web-vcr-domain.ts`](../../src/common/editor/web-vcr-domain.ts) and
[`web-vcr-geometry.ts`](../../src/common/editor/web-vcr-geometry.ts).

### Target and crop

Automatic targeting chooses the largest visible playing HTML video whose
content aperture can be measured. It accounts for viewport clipping, intrinsic
dimensions, `object-fit`, and `object-position`. This can remove element
letterboxing, but it does not promise to detect bars encoded into media.
Canvas players, inaccessible shadow DOM, unsupported transforms, and ambiguous
targets use manual crop.

The manual overlay stores a normalized rectangle constrained to the preview
and optional aspect lock. Recording freezes the target generation and crop,
maps the rectangle against the first actual captured frame, clamps it, and
rounds it to encoder-compatible even coordinates. Later page movement cannot
move the frozen crop.

Cropping occurs before encoding when the admitted backend supports it, keeping
uncropped pixels transient. If a backend must spool a full encoded viewport
before native crop, that body is capture-owned recovery staging only. It never
becomes a Project Bin asset and is removed after verified cropped publication.
Native processing consumes a semantic crop description and generates its own
allowlisted arguments.

The viewport profiles are:

| Choice | CSS viewport | Device scale | Required capture surface |
| --- | --- | --- | --- |
| 720p | 1280×720 | 1 | 1280×720 |
| 1080p | 1920×1080 | 1 | 1920×1080 |
| 4K | 1920×1080 | 2 | 3840×2160 |

Raw 4K RGBA does not travel through JavaScript IPC, use enlarged browser
FFmpeg raw-frame limits, or accept renderer-provided FFmpeg arguments.

### Audio and stopping

The captured audio is the complete audio output of the owned guest frame.
Guest echo is suppressed during capture; a capture-track clone feeds the
shared trusted monitor bus. Mute changes only that monitor connection and does
not change the recorded track.

Automatic stop accepts only a standard `ended` event from the exact target,
navigation generation, and recording token frozen at Record. Manual **Stop &
Import**, the primary Record control, and a valid ended event converge on one
idempotent finalizer. Target loss, navigation, guest crash, encoder or storage
failure, renderer loss, and helper failure preserve a recoverable acknowledged
prefix rather than silently importing a partial take.

Successful publication produces ordinary linked recorded video and audio
sources. They use the same relink, proxy, edit, Scape, handoff, and delivery
paths as other Framescaper recordings. The renderer never receives a large
generic desktop `File` or read descriptor.

## Verification evidence and limits

Focused tests cover the closed desktop contract, sender and generation
ownership, HTTPS and popup policy, permission denial, data clearing, hostile
remote data, target and crop math, stale targets, stop idempotence, origin
binding, recovery, and UI gating. The maintained browser workflow is
[`framescaper-web-vcr.spec.js`](../../tests/browser/framescaper-web-vcr.spec.js);
controller and finalizer evidence includes
[`audio-editor-framescaper-web-vcr-controller.test.ts`](../../tests/audio-editor-framescaper-web-vcr-controller.test.ts)
and
[`audio-editor-framescaper-web-vcr-finalizer.test.ts`](../../tests/audio-editor-framescaper-web-vcr-finalizer.test.ts).

The deterministic Linux x64/Xvfb packaged smoke uses a loopback HTTPS fixture
to exercise owned-guest 720p and 1080p video, page audio, authentication,
interactive input, crop, standard ended behavior, security, data clearing, and
teardown. It emits `diagnosticOnly: true`. The fixture uses generated media and
test credentials; public websites are never CI dependencies.

That smoke proves only the paths it executed. It does not establish behavior
for public providers, real credentials, other operating systems, unsupported
encoders, 4K, long-session sync or drop rates, performance, accessibility, or
the privacy behavior of arbitrary sites. Those observations may be recorded in
optional owner QA, which neither activates nor disables the capability.

Security or privacy changes also update their owning matrices and synchronized
policy narratives, with digest pins refreshed where required.
