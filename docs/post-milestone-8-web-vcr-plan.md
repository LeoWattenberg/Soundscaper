# Post-milestone-8 Framescaper Web VCR plan

> Owning source for the Web VCR product, security, capture, lifecycle, and
> qualification decisions. The [roadmap](../roadmap.md) owns sequencing and
> closure status. Activation starts only after milestone 8 closes and consumes
> milestone 8A's capture contracts rather than creating an earlier recording
> path.

## Implementation status

The focused Web VCR software substrate is implemented and integrated but
disabled. Strict
domain and geometry contracts, desktop security and lifecycle seams, capture
authority, controller/crop/monitor/recorder modules, and a capability-gated UI
exist behind `framescaperWebVcr: false`. A normal production Framescaper build
therefore exposes no Web VCR menu or panel and creates no remote guest, popup,
persistent browser profile, or capture grant. The controller reports
`unavailable` / `roadmap-gate` and returns before desktop handshake or guest
open. This dormant path is maintained
software evidence; it is not an activated product, packaged real-runtime
qualification, or platform-support claim.

Activation remains blocked until milestone 8 and the applicable milestone-5B
native-media gates close. A deterministic Linux x64/Xvfb packaged feasibility
smoke exercises owned-guest 720p and 1080p video, page audio, authentication,
input, crop, ended, security, data-clear, and teardown paths and emits
`qualification: false`. The supported real-runtime matrix, encoder, recovery,
performance, and registered quality gates remain open. 4K is unavailable until
its independent capture-surface and encoder qualifications pass.

Those dependency gates remain open. The packaged feasibility smoke uses the
deterministic loopback HTTPS fixture to exercise login-cookie persistence,
an OAuth-like popup, interactive input, standard HTML media with generated
video and tone, ended/loop behavior, redirects, and clean shutdown. That
loopback HTTPS fixture and packaged smoke are evidence only and do not
establish the supported real-runtime matrix, performance, or platform
qualification.

## Outcome and boundaries

Framescaper desktop gains an isolated, dockable browser for capturing
authorized HTTPS media into the normal recoverable Project Bin and timeline
workflow. `Record`'s existing split-button menu is the sole entry point:
`Web VCR` summons the default-hidden panel, and the feature is absent from
View > Panels, Preferences, search, Soundscaper, and both web products.

The first release supports persistent HTTPS authentication, whole-page audio,
a crop frozen at Record, standard HTML-media-ended automatic stop, and cropped-
only project retention. It does not support DRM/EME/HDCP capture, anti-bot
evasion, user-agent spoofing, HTTP browsing, arbitrary downloads, provider-
specific player adapters, or isolated-element audio. A virtual viewport or DPI
override never claims to force a provider's source resolution or bitrate.

This plan depends on milestone 8A's recoverable multi-stream capture,
publication, monitoring, destination, and recovery services and the applicable
milestone 5B native media capability and encoder ports. It adds no recording
clock, general remote-content IPC bridge, or project schema.

## Product and UI contract

- Add a Framescaper-desktop-only `Web VCR` item to the Record flyout. Selecting
  it makes `web-vcr` the active capture mode and opens or focuses the panel.
- The primary Record control and the panel Record control call the same
  exclusive capture action. During capture the existing Record control remains
  red/pressed even when the panel is closed or another project is active.
- Register `web-vcr` as a summon-only dockable panel, default hidden and
  initially bottom-docked. Exclude it from application menus, panel
  preferences, and command search; the Record flyout is how it is reopened.
- Lazy-load a focused panel containing Back, Forward, Reload, an HTTPS address
  field, interactive zoom-fit preview, Record/Stop & Import, Mute local output,
  Auto-crop, 720p/1080p/4K viewport, Auto-stop, and manual free/16:9/9:16/1:1
  crop controls.
- Default to 1080p, auto-crop on, free aspect, local output audible, and auto-
  stop off. Disable viewport, target, and aspect changes while recording.
- Display actual captured dimensions and detected media intrinsic dimensions.
  Warn when the source appears lower-resolution than the render surface.
- Keep URL, browser title, login state, crop gestures, and diagnostics out of
  project state. Published takes use a generic timestamped name and can be
  renamed normally.

Closing the panel while idle suspends or destroys its guest without clearing
the persistent profile. Closing it while recording leaves the capture running.
Ordinary project switching is allowed; the capture remains bound to the
originating project, sequence, record-start playhead, and Recording Setup
destination. The originating project cannot be closed or deleted until the
take is stopped or discarded. Application quit stops input, durably seals the
milestone-8A recovery envelope, and offers Import or Discard on the next launch.

## Desktop trust boundary

Create a focused main-process Web VCR host and a separately registered,
versioned Framescaper app preload. Do not grow the shared main or preload files
or expose any preload to remote content.

The host owns one guest generation and a dedicated persistent partition such
as `persist:framescaper-web-vcr-v1`. Guest web preferences retain sandboxing,
context isolation, disabled Node integration, web security, and disallowed
insecure content. Top-level navigation accepts HTTPS and the internal blank
page only. Downloads and unrelated camera, microphone, display, location,
notification, MIDI, USB, serial, and Bluetooth permissions are denied.

OAuth or authentication popups are bounded, HTTPS-only, same-partition guest
windows with the same web preferences and no opener-granted native authority.
The panel provides an idle-only confirmed Clear browser data action that
destroys all guest contents before clearing cookies, cache, and site storage.

The remote page receives no editor preload, IPC, filesystem, project, helper,
shell, or raw DevTools authority. Main owns navigation, target observation,
viewport emulation, input forwarding, capture grants, popup policy, and
teardown. The trusted renderer receives only a frozen, versioned, pathless API
with closed DTO validation, bounded strings and coordinates, opaque session
identities, and owner/generation checks.

Target observation runs in a CDP isolated world without exposing its binding to
the page's main world. It reports bounded geometry and media state only. Main
accepts tracker results as untrusted input, validates them, and never exposes
arbitrary evaluation or CDP methods to the renderer.

## Capture architecture

### Feasibility and capability gate

Before activation, prove the complete guest-frame capture path against a
deterministic controlled HTTPS page:

1. The isolated guest renders the selected virtual viewport and remains
   navigable through scaled preview input.
2. Milestone 8A obtains the exact guest video frame and complete page audio
   through a one-shot main-owned capture grant.
3. Local monitoring can be muted or enabled without changing the recorded
   audio track.
4. Captured frame dimensions match the selected preset and remain stable
   through a long recording.
5. Stop, navigation, guest loss, renderer loss, and quit release or recover all
   owned resources.

Qualify 720p and 1080p as the baseline. The 4K choice is visible only when both
the runtime capture probe and selected encoder backend report qualified support.
Any mismatch refuses before recording instead of silently lowering quality.
Do not move raw 4K RGBA frames through JavaScript IPC, raise the existing
ffmpeg.wasm raw-frame limits, or use renderer-provided FFmpeg arguments.

The viewport profiles are:

| Choice | CSS viewport | Device scale | Required capture surface |
| --- | --- | --- | --- |
| 720p | 1280×720 | 1 | 1280×720 |
| 1080p | 1920×1080 | 1 | 1920×1080 |
| 4K | 1920×1080 | 2 | 3840×2160 |

### Target and crop

Prefer the largest visible playing HTML video whose content aperture can be
measured. Account for viewport clipping, intrinsic dimensions, `object-fit`,
and `object-position`; this may remove element letterboxing but does not promise
pixel-analysis removal of bars encoded into the media. Canvas players,
inaccessible shadow DOM, unsupported frame transforms, and ambiguous targets
fall back to manual crop.

The manual overlay stores a normalized rectangle constrained to the preview and
optional aspect lock. At Record, freeze target generation and crop, map the
normalized rectangle against the first actual captured frame, clamp it, and
round it to encoder-compatible even coordinates. A later element move does not
move the crop.

Prefer cropping `VideoFrame`s before the milestone-8A encoder so uncropped
pixels remain transient. If an admitted backend must spool a full encoded
viewport before native crop, that body is recovery staging only. Delete it
after the cropped publication is verified; it never becomes a project asset.
Native processing consumes a semantic crop plan and internally generates
allowlisted arguments.

### Audio, stop, and publication

Capture all audio produced by the owned guest frame. Suppress guest echo while
capturing and route a capture-track clone through milestone 8A's trusted monitor
bus for local output. Mute toggles only that monitor connection.

Automatic stop accepts only standard `ended` from the exact target, navigation
generation, and recording token frozen at Record. Manual Stop & Import, the
primary Record control, and valid ended converge on one idempotent finalizer.
Target loss, guest navigation/crash, encoder/storage failure, renderer loss,
and helper failure seal a recoverable partial take rather than importing it
silently.

Use milestone 8A's bounded fragments, monotonic clock, backpressure, drop/drift
metrics, storage admission, recovery ownership, and managed-media publication.
Capture the Recording Setup destination at Record, defaulting to Project Bin
plus timeline at the record-start playhead. Publish ordinary linked recorded
video/audio sources through the same relink, proxy, edit, `.scape`, handoff, and
delivery paths as other Framescaper recordings. Do not return a large generic
desktop `File` or read descriptor to the renderer.

## Renderer and platform interfaces

Add strict, frozen types for:

- `WebVcrResolution = "720p" | "1080p" | "4k"`;
- `WebVcrAspect = "free" | "16:9" | "9:16" | "1:1"`;
- the closed Web VCR lifecycle phases, capability reasons, normalized crop,
  target summary, navigation state, recording metrics, and snapshot;
- a closed `WebVcrCommandV1` union for navigation, visibility, input, viewport,
  crop, local monitoring, automatic stop, data clearing, and session closure;
  and
- `WebVcrDesktopPortV1` operations for handshake, open, dispatch, one-shot
  capture preparation, subscription, and disposal.

Register one milestone-8A `web-vcr` source adapter returning the captured video
frame source, whole-page audio track, monotonic clock, drop metrics, recovery
owner, and opaque guest generation. Binary frames and audio never use the
control bridge.

## Verification and release gates

Develop test-first with focused coverage for:

- command/response validation, sender and generation ownership, HTTPS and popup
  policy, permissions, downloads, clear-data teardown, and hostile remote data;
- target selection, aperture and aspect math, frame-coordinate conversion,
  stale targets, standard ended, duplicate stop, and navigation replacement;
- lifecycle transitions, background panel/project switching, origin-project
  protection, import-once behavior, partial recovery, quit sealing, cleanup
  aggregation, and cropped-only retention;
- Record-dropdown-only product gating, hidden panel defaults, keyboard crop
  editing, accessible controls/status, global recording indication, and absence
  from Soundscaper, web routes, View > Panels, Preferences, and search; and
- a packaged Electron workflow using a deterministic controlled HTTPS media
  fixture for authentication persistence, input, audio monitoring, resolution,
  crop, auto-stop, project switch, import, reopen, recovery, and data clearing.

Every enabled resolution tier must pass milestone 8A's long-session A/V drift,
dropped-frame, audio-dropout, teardown, and durable-fragment budgets. Additional
acceptance requires exact full-surface dimensions, encoder-compatible crop
agreement, no retained uncropped project asset, and truthful runtime gating.
Public websites are never CI dependencies.

Before activation, update the capability inventory, privacy documentation,
threat model, security matrix, and applicable quality workloads. Refresh every
digest-controlled evidence pin through its owning script. No platform or 4K
claim ships before its required packaged, security, performance, licensing, and
recovery evidence passes.
