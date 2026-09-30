# Native services

Soundscaper and Framescaper keep native code behind supervised desktop service
boundaries. Native services add device, plug-in, media, and display capabilities;
they do not replace the editor domain, reinterpret projects, or weaken the Web
Core fallback.

This page describes the durable contract. Historical S/F/V generation labels
are provenance, not current runtime authority. Current
projects are admitted by the family-v1 rules in
[`project-compatibility.md`](../policies/project-compatibility.md).

## Authorities

The implementation is split deliberately so no prose document can grant native
execution by itself:

- `desktop/helper-contract.ts` owns the versioned helper wire.
- `desktop/helper-registration.mjs` and `desktop/helper-supervisor.ts` own
  process creation, supervision, cancellation, and quarantine.
- `config/production-security-matrix.json` and the
  [threat model](../policies/security.md) own security claims and residual
  risks.
- `config/production-licensing-matrix.json` and the
  [licensing policy](../policies/licensing.md) own distribution gates.
- `config/native-payload-producers.json` is the inventory of target-native CI
  producers.
- The native-addon, Soundscaper professional-host, Framescaper media-host, and
  Framescaper OpenFX payload manifests own exact target payload status, length,
  architecture, and digest.
- Canonical editor plans, project validators, and storage services remain the
  semantic authorities. A helper receives a validated operation; it never owns
  a project revision.

A source recipe, provisioned source tree, passing test, licensing row, payload
manifest, and packaged binary are distinct facts. Runtime admission requires the
applicable facts to agree; none stands in for another.

## Shared process boundary

Electron main is the sole process authority. It selects executables, resolves
private paths, mints and revokes grants, and starts helpers with
`utilityProcess`. Preload and renderer code receive opaque identifiers and
bounded status, not raw paths or generic process, filesystem, native-module, or
network primitives.

Native adapters load only inside supervised utility processes. They do not load
into Electron main, preload, a renderer, or an `AudioWorklet`. A helper may use
threads internally, but a worker thread never substitutes for the crash and
authority boundary of a process.

All renderer-to-main entry points retain the desktop trust checks: expected
sender, main frame, allowed document URL, closed request shape, and bounded
opaque identifiers. File and directory access begins with a main-owned picker or
another explicit grant and is revalidated before use.

A helper process contains crashes; it is not proof that arbitrary native code
has lost all authority of the current operating-system account. Each target's
launcher records the restrictions it actually enforces. Missing containment is
a residual risk and must never be described as a sandbox.

## Helper protocol and lifecycle

The shared helper contract has these invariants:

- Messages are versioned, discriminated, direction-checked, and rejected before
  semantic work when malformed or oversized.
- Control envelopes are capped at 64 KiB. PCM, frames, media bodies, and opaque
  state use separately authenticated, bounded, backpressured data planes.
- Every job receives a kind-correlated capability grant. A renderer can never
  turn a grant into arbitrary spawn, path, child-process, or network authority.
- Main validates grants before spawning. The helper negotiates a supported
  subset and cannot enlarge the grant.
- Heartbeats, job generations, monotonic progress, cancellation acknowledgement,
  and engine quiescence are part of the protocol rather than UI conventions.
- CPU, process-tree memory, duration, file, scratch, child-process, and network
  limits are explicit admission inputs. Reservations may lower concurrency.
- Crashes, hangs, contract faults, resource violations, and cancellation
  timeouts close the current generation and may quarantine the exact payload or
  plug-in fingerprint. User cancellation and orderly shutdown are not faults.
- Late results from a cancelled, stale, or superseded generation cannot publish
  output or mutate project state.

Failure preserves the last committed project revision. Offline work may retry
from the same canonical plan when its recovery class permits it. Real-time work
never replays stale packets silently.

Every native feature is reached from an existing menu and begins disabled or
unavailable until its exact capability checks pass. Removing or revoking every
helper leaves a usable Web Core editor and a truthful capability report.

## Packaging and provenance

The desktop application uses a fuse-protected asar without incidental
`asarUnpack` or runtime dependency rebuilding. JavaScript helper entry points may
remain in the asar. Target-selected native binaries, addons, launchers, and
profiles are staged as digest-pinned resources outside it.

The supported producer matrix is:

- Windows x64;
- Windows ARM64;
- macOS ARM64;
- Linux x64; and
- Linux ARM64.

macOS x64 is not an empty or pending row; it is outside the matrix. A result for
one target grants nothing to a neighbouring target.

Target workflows provision pinned sources, build the payload and containment
launcher, run required self-tests, inspect dependencies and architecture, close
the file inventory, and record byte lengths and SHA-256 digests. Packaging may
stage only the matching result for the current source revision, target, and
build plan. A `ci-generated` manifest row with no payload remains unavailable
and must report that fact.

The optional native source cache is uncommitted build input. Provisioning proves
the downloaded archives and extracted trees match their pins; it does not bundle
them, grant redistribution rights, enable a feature, or approve a release.

Licensing, corresponding-source, patent, trademark, and notice requirements are
distribution controls. They neither fabricate a payload nor replace runtime
checks. Conversely, a working payload does not clear a held distribution row.
Platform signing and notarization are package concerns described in
[`signing.md`](../operations/signing.md); they are not helper
protocol or project authority.

## Soundscaper audio and plug-ins

Native audio reuses the editor's recording routing, transport, effect graph,
automation, freeze, and per-path delay-compensation models. It does not create a
second device preference or render model.

The service reports explicit backend and mode identities:

- CoreAudio on macOS;
- WASAPI shared or exclusive, and separately admitted ASIO, on Windows; and
- PipeWire as the primary Linux backend, with ALSA as a backup and for direct
  hardware access.

A device candidate belongs to the backend that enumerated it. Fallback walks an
ordered caller-supplied candidate list and reports each refusal and the granted
candidate. An absent backend may advance the list; refusal of a requested format
or mode does not silently turn into a different request.

Real-time audio uses a directly transferred `MessagePort` between the helper and
the `AudioWorklet`, with a fixed pool of transferable `ArrayBuffer` packets.
Main participates in setup and revocation, not per-block relay. Generation,
sequence, and absolute frame identity fence every packet; returning a buffer is
the credit for another send.

Input loss during recording commits only the already captured prefix through
the normal recording publication path. It never invents recorded silence.
Output loss stops monitoring; playback may use an explicitly compatible Web
fallback, with the backend change reported and the project unchanged.

Plug-in discovery and execution are separate helper kinds and security controls.
Scanning grants no project audio and hosts no project instance. Scan roots are
main-owned grants, scanning never runs automatically at startup, and consent is
per format.

Registry identity is the format plus its native stable identifier. An installed
binary additionally binds platform, architecture, version, and digest. A new or
changed digest requires an explicit allow decision; path ordering never resolves
a stable-ID collision silently.

VST3 and CLAP are cross-platform effect targets, Audio Units is macOS-only,
LADSPA and LV2 effects are Linux-only, and Vamp is an analyzer rather than an
effect. Instrument descriptors may be discovered but are not materialized by
this surface.

Runtime hosting isolates one renderer owner and one plug-in digest per process.
Opaque state is retained exactly and capped at 16 MiB per instance. State and
parameters survive missing, changed, crashed, revoked, or quarantined binaries;
the live graph uses truthful bypass or an already authored, verified freeze.
The host never manufactures a freeze after failure.

Reported latency is generation-scoped and feeds the canonical path-delay plan.
A change produces a new graph revision and swaps only at a safe block boundary.
Unbounded or unstable latency faults the instance rather than shifting the
project silently.

Vendor UI is a helper-owned top-level native window tied to one instance and
owner generation. It has no renderer bridge or general filesystem, network, or
child-process API. Closing the window does not remove the effect; losing the
owner or helper closes the window.

## Framescaper media and OpenFX

Native media consumes a closed canonical plan envelope with an authenticated
fingerprint. Unknown plan versions are refused; every accepted version needs an
explicit adapter, validator, canonical form, and parity evidence. Native
execution may accelerate the plan but may not add native-only timeline or render
semantics.

Inputs owned by browser storage cross bounded streams. Main-revalidated linked
files may use helper-scoped handles. Raw frames, audio intermediates, and output
trees remain bounded and backpressured. Final files are written to a temporary
sibling in the authorized destination, verified, then renamed without replacing
an existing output. Failure, cancellation, stale authority, or supersession
publishes nothing.

Hardware capability is the intersection of the staged build, live probe,
self-test, codec and licensing rows, operation, project authority, capacity, and
user opt-in. A typed hardware failure may retry once on native CPU with the
identical plan and fingerprint. If native attempts fail, main reports that the
renderer-owned Web Core route is required; it does not forge a native receipt or
execute renderer work itself.

Professional source characteristics are exact-or-unreported. Required bit
depth, pixel format, color primaries, transfer, matrix, range, HDR metadata, or
alpha that cannot be preserved causes a typed refusal before work. A limited
RGBA8 image-sequence carrier must not be described as high-precision, HDR, or
alpha-preserving beyond what it actually carries. Proxies remain derivatives;
original media is authoritative for final export.

Persistent native jobs live in a main-owned database separate from project
storage. Rows contain bounded plan descriptions, fingerprints, opaque grants,
relative destinations, reservations, recovery class, state, and audit metadata;
they contain no raw paths or media bytes. A single-writer lease prevents a
second process from dispatching work.

The queue supports reorder, pause, resume, cancel, retry, and structured
progress. Recovery revalidates project revision, sources, plan, roots, payload,
scratch, and authorization before dispatch. Encoded outputs use atomic restart;
only image sequences with verified existing frames may use frame checkpoints.

Durable roots keep their paths private to main and require identity,
containment, and revocation checks at startup and use. Watch services treat
filesystem notifications as hints and bounded reconciliation as authoritative;
they do not follow directory symlinks or mutate a closed project. Scratch is
per-job, reservation-bound, and deleted only when its manager-owned manifest,
job, and root identities agree.

External display presents the same evaluated frame stream and transport clock
as the editor. It is a session-only, menu-opened sink, not a second renderer or
audio route. Display loss closes it; unsupported placement or HDR capability is
reported rather than guessed.

OpenFX discovery and hosting follow the same grant, consent, fingerprint, and
quarantine model as audio plug-ins, using a dedicated host rather than the media
helper. Generator, filter, transition, paint, retimer, and general contexts map
to existing project sources and resolved timeline outputs. General context does
not introduce an unrestricted node compositor.

CPU rendering is mandatory. Applicable GPU paths may fall back through the
same canonical CPU plan without mutating authored state. Interact V1, custom
parameter interacts, and DrawSuite V1 render through bounded frames and
normalized events in a menu-opened React surface; OpenFX plug-ins cannot create
renderer-native or arbitrary vendor windows.
