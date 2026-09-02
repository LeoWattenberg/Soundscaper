# Milestone 4A pickup: Soundscaper production

> **Historical implementation plan (superseded 2026-08-31):** selected
> Soundscaper S30 inherits this implementation-complete production surface
> through exact S29, and selected Framescaper F31 delegates its shared audio
> finishing through immutable exact V28. Qualification rows, fixed-hardware
> profiles, reviewed cohorts, evidence status, guided sign-off, and release
> gates below are dated architectural provenance, not current repository policy.
> Current automation reports only the checks and environment that ran; optional
> human observations belong in owner QA and never gate or certify a release.

> Owning pickup contract for the Soundscaper half of milestone 4. The
> [milestone-4 plan](milestone-4-plan.md) owns shared sequencing and the
> [roadmap](../roadmap.md#4-parallel-production-surfaces) owns product scope.
> This document owns the 4A packet boundaries and the exact V21 automation,
> mixer-graph, per-path delay-compensation, freeze, preservation, UI, and
> acceptance contracts.

## Current integrated workflow topology

The former six-tab **Production audio** dialog has been retired. Its retained
responsibilities now live at the controls where they are used:

- a track menu's checkable **Add automation** action reveals a session-only
  automation row in that track header, and the selected curve is drawn over
  the clips without changing the clip-gain envelope or waveform amplitude;
- the Mixer switches between **Channel strips** and an in-panel **Routing
  graph** beside the existing Add group/Add send actions;
- **Tools > Manage macros** offers the built-in Restoration template, including
  an embedded Noise Reduction profile before the macro may run;
- **Analyze > EBU R 128** remains the only metering UI; production phase,
  correlation, and history telemetry remains available to engine consumers;
- **Effect > Special Effects > Utility Gain (Reviewed)** uses the ordinary
  Selection Effects dialog and reviewed worker path; and
- **Tools > Mastering sequences** opens a focused standalone dialog.

These are presentation and workflow integrations only. V21 automation and
mixer command wires, project schemas, meter telemetry, reviewed-package
security boundaries, and mastering delivery semantics remain unchanged.

## Pickup status and sequencing authority

**Historical status on 2026-08-22: Implemented (provisional).** Soundscaper V23 is the
selected maintained Soundscaper App/runtime/storage route and retains V21's
automation, mixer, PDC and freeze foundation. Packets 4A-1 through 4A-6 are
implemented locally, and 4A-7's local automated acceptance is green.
This records a complete local implementation candidate, not a closed milestone.
The owner-designated Windows x64 RTX 3090 run passed the then-current 4A-7 M4
production-parity thresholds, but the retained artifact lacks the driver,
device, power, and display identity now required by the packaged-runtime
fingerprint. It remains diagnostic audit evidence and the current fixed-GPU row
is `pending-external`. A reviewed no-retry hosted cohort on the registered
hardware lower bound now qualifies the exact M4 production workload. The
owner-host packaged profile, manual, and release rows remain open.
Shared phase 4.0 remains implemented provisionally, and
milestone 3 remains **In progress** with its manual and packaged-runtime rows
unchanged. None of those rows is waived, relabelled, or cited as passing
evidence here.

Framescaper V20 historically owned the globally serialized schema slot after
V19 and was the provisional web/desktop route with `videoKeyframes` available.
The selected V27 activation candidate now supersedes that route, with guided-
local and external qualification still open. With the V20 wire fixed, this
pickup allocated the next product-wide schema number, **V21**, to Soundscaper's
automation/mixer/PDC revision. The 4B-3 transition revision consequently moved
from V21 to the implemented dormant V22 candidate. No implemented V18, V19, or
V20 statement changes.

V21 is a Soundscaper-owned exact document around the maintained V17 common
editorial foundation. It does not migrate V17, copy Framescaper V18-V20 private
state into Soundscaper, or make a V20 Framescaper project writable in
Soundscaper. Earlier Soundscaper schemas receive the existing typed pre-release
re-import refusal, future schemas stay opaque and intrinsically read-only, and
cross-product transfer is copy-only preservation until the receiving product
owns the complete native workflow.

Schema revisions remain serialized product-wide. V21 has landed as one atomic
domain candidate with its validators, commands, capability and compatibility
registration, browser and desktop storage, `.scape`, clipboard, history,
fixtures, and product selection fences. The complete native workflows passed
their local technical gates together, so the Soundscaper App/runtime/storage
route and its three capabilities are selected. That selection does not waive
the still-open owner-host packaged profile, manual, or release evidence.

## Packet map

The implementation landed in this order:

1. **4A-1a — Exact V21 domain kernel: Implemented (provisional).** The closed
   automation-lane and mixer documents, contextual validators, registration,
   commands, preservation carriers, and legacy-strip-envelope removal landed
   together. The track-owned freeze record was reserved for 4A-4.
2. **4A-1b — Automation lanes and modes: Implemented (provisional).** Lanes
   compile through the shared vocabulary and scheduled-parameter registry with
   bounded gesture capture, deterministic thinning, history, and per-track
   header controls with clip-body overlays.
3. **4A-2 — Mixer graph runtime: Implemented (provisional).** The exact graph,
   revised folder-bus reconciliation, and Mixer-integrated graph view passed
   their local gate before the mixer capability was selected.
4. **4A-3 — Per-path PDC: Implemented (provisional).** One graph-owned path plan
   replaces flat maxima across live playback, monitoring, offline render,
   automation, sends, sidechains, and the freeze boundary. Packets 4A-1 through
   4A-3 passed together before Soundscaper automation/mixer selection.
5. **4A-4 — Freeze, unfreeze, refresh, and commit: Implemented (provisional).**
   Verified derived bodies, the history-aware lifecycle, freeze capability, and
   `audio-freeze-fallback` compatibility rule landed together.
6. **4A-5 — Restoration and metering: Implemented (provisional).** Restoration
   is an ordinary editable Macro Manager template. Bounded session-only phase,
   correlation, surround, and loudness-history telemetry remains headless;
   EBU R 128 remains the sole meter UI.
7. **4A-6 — Reviewed effect packages: Implemented (provisional).** The pure-WASM
   ABI, release-pinned catalog and Utility Gain package, resource enforcement,
   revocation, security, and licensing evidence landed atomically.
8. **4A-7 — Exit evidence: Implemented (provisional).** The complete local
   automated surface is green against the registered production-parity
   workload. The reviewed hosted lower-bound cohort qualifies the exact M4 row.
   The historical owner-host package remains diagnostic-only for its separate
   profile, while that profile and the manual/release rows remain open.

The V21 domain kernel did not become a partial product route: nested buses were
kept unavailable until per-path PDC passed, and tracks could not author
`audioFreeze` until the 4A-4 lifecycle passed. Those local technical gates are
now green; the independent qualification gates remain open.

Every document-bearing packet repeats the full registration path from the
milestone plan: exact command discriminants in exactly one domain, both product
profiles initially unavailable, an owned-state predicate and compatibility
rule, capability-policy checks at direct and generic authoring paths,
normalizer idempotence and semantic-survival tests, and one controller mutation
path.

## Exact V21 document boundary

V21 replaces the V17 legacy mixer and strip envelopes. The exact new top-level
fields are `automationLanes` and `mixer`; freeze is an optional relationship on
an audio track, never a project-level collection:

```ts
interface SoundscaperProjectV21 {
	readonly schemaVersion: 21;
	readonly automationLanes: readonly AutomationLaneV21[];
	readonly mixer: MixerGraphV21;
	// Every other common editorial field retains its V17 meaning.
}

interface SoundscaperAudioTrackV21 {
	// Every other audio-track field retains its V17 meaning.
	readonly audioFreeze?: AudioTrackFreezeV1;
}
```

The field `envelope` is forbidden on V21 audio tracks, mixer strips, and the
master. Clip-local envelopes remain the Audacity-parity clip primitive and keep
their existing wire and evaluation. The V17 top-level `groups`, `sends`, and
`routes` dialect is forbidden; V21 routing lives only in `mixer`. Exact-current
validation rejects either legacy dialect rather than deleting, translating, or
defaulting it.

Every new record is closed. It accepts only named own enumerable data
properties on ordinary or null-prototype objects; arrays use ordinary dense
array properties. Accessors, symbols, inherited enumerable properties,
functions, `toJSON` hooks, extra keys, holes, nonfinite numbers, and negative
zero reject. Normalizers snapshot into detached recursively frozen values and
are idempotent. Lane and point IDs are nonempty strings; the graph's own IDs
are nonempty strings of at most 256 code units. Existing inherited and
parameter-address IDs retain the V17 compatibility domain.

V21 validation reuses the exact V17 editorial validators by ownership, but it
does not fabricate a legacy mixer or call the V17 folder-bus validator over a
lossy projection. The V21 graph and folder validator replaces that layer. A
runtime projection to V17 is forbidden because nested routing, lanes, and
per-path compensation are not representable there.

## 4A-1 — Automation lanes and modes

### Exact lane wire

```ts
type AutomationLaneTimebaseV21 = 'absolute-samples' | 'musical-beats';
type AutomationLanePositionV21 = number | Rational;

interface AutomationLanePointV21 {
	readonly id: string;
	readonly position: AutomationLanePositionV21;
	readonly value: number;
}

interface AutomationLaneV21 {
	readonly id: string;
	readonly address: ParameterAddress;
	readonly timebase: AutomationLaneTimebaseV21;
	readonly points: readonly AutomationLanePointV21[];
	readonly segments: readonly InterpolationShape[];
}
```

The project admits at most 4,096 lanes. A lane has 1 through 4,096 points,
unique nonempty point IDs, strictly increasing positions, and exactly one fewer
segment. An `absolute-samples` position is a nonnegative safe integer project
sample frame. A `musical-beats` position is a nonnegative canonical reduced
`{ num, den }` rational with a positive denominator under the shared coordinate
limits. It measures quarter-note beats from the authoritative tempo-map origin.
Tempo edits therefore re-flow musical lanes; absolute-sample lanes do not move.
No lane mixes timebases or persists seconds, an evaluated sample, or a
tempo-derived cache. The lane has no nested `schemaVersion`; the enclosing V21
project owns the revision.

The curve is the exact shared interpolation vocabulary. Bézier controls store
absolute lane-domain positions and native parameter values. Control positions
remain within their segment and are monotone in time; values may be
nonmonotone, while inversion retains the shared rejection rule. Evaluation
holds the nearest endpoint outside the authored anchor span and rounds once
under the named `point` policy at the scheduling boundary.

Addresses normalize through `parameter-address.ts` and are unique by its
collision-free canonical key: V21 permits at most one lane per address and no
duplicate lane ID. The
referenced track, mixer node, edge, effect instance, optional stable compound
element, and registered parameter must exist. Values, steps, taper, and
automation tolerance come from the one parameter descriptor inventory, never a
second lane table. When supplied to the contextual validator, a descriptor's ID
must be its canonical address key, its address must match the lane, it must be
automatable, and all point and Bézier-control values must be in range. Discrete
targets use hold segments only. A latency-changing parameter is not automatable.

The V17 deterministic `legacySendEdgeId(trackId, sendId)` becomes the exact ID
of a materialized legacy-shaped send edge when a fixture constructs equivalent
V21 state. Filter-curve compound points remain unavailable until their elements
own persisted stable IDs. A current first-party worklet parameter is unavailable
until its worklet consumes the bounded `schedule-parameter-v1` frame-offset
queue; registering a host-side producer alone does not expose the target.

Static strip or effect values remain the authority when no lane exists. A lane
writes the absolute native parameter value; it never multiplies an undisclosed
legacy envelope. Effect reorder and project reload do not change address IDs.

### Safe automation modes and capture

`read`, `trim`, `touch`, `latch`, and `write` are controller session state keyed
by the canonical target, not persisted V21 state. Every project open, reload,
cross-product handoff, tab replacement, controller disposal, and recovery boot
starts in `read`. Selecting a mode is a direct menu action; merely opening a lane
or starting ordinary playback never arms a write.

- **Read** schedules the canonical curve and owns no live gesture.
- **Trim** reads the curve while a gesture applies a live native-value offset;
  release commits one bounded transformed curve and relinquishes ownership.
- **Touch** adopts the live value only during the explicit gesture, captures
  while held, commits once on release, then returns playback ownership to read.
- **Latch** behaves as touch until first contact, then retains live ownership
  until stop, mode exit, project replacement, or cancellation and commits once.
- **Write** takes live ownership only after the user selected Write and started
  transport, captures until stop/mode exit/cancellation, and commits once.

Only the controller gesture adapter may transfer ownership. One target has at
most one gesture generation; a stale generation cannot schedule or commit.
Cancellation, lock/read-only transition, target disappearance, project change,
or transport failure discards raw capture and restores the last committed read
curve. Latch and Write never survive a project lifecycle boundary.

Raw gesture samples are bounded session memory. Commit converts them to the
lane's single time base, preserves the first and last sample, both adjacent
samples around a discontinuity or ownership boundary, and every required local
extremum, then applies deterministic constrained Ramer-Douglas-Peucker thinning
in descriptor-normalized value space. Each interval retains the candidate with
the largest error from its linear reconstruction; ties choose the earlier exact
position and then capture ordinal. Splitting continues until every discarded
sample is within the descriptor's `automationTolerance`. A captured
discontinuity becomes adjacent held/linear boundary samples and is never
averaged away. If the required set exceeds 4,096 or tolerance cannot be met
within the cap, commit refuses without changing history; dense state belongs to
the declared digest-bound external-asset path. No partial or over-cap curve is
published.

### Commands, preservation, and UI

Add `automation-lane/set` to exactly one `audioAutomation` command domain:

```ts
{
	readonly type: 'automation-lane/set';
	readonly laneId: string;
	readonly expected: AutomationLaneV21 | null;
	readonly lane: AutomationLaneV21 | null;
}
```

`expected: null` adds, `lane: null` removes, and two values replace. The handler
compares the complete canonical expected value, normalizes the complete
contextual replacement, checks target uniqueness and capability, and publishes
one revision or none. Gesture commit uses this command; it is not a second
mutation path. Reset removes the lane and leaves the static target value.

Removing a target track, mixer edge, mixer node, effect, or stable compound
element removes its lanes in the same owning command transaction. Track
duplication gives duplicated strip/effect lanes new lane IDs and remapped target
IDs; ordinary clip copy/paste never copies track automation. Effect reorder,
clip split/join/trim/move, source relink, and Project Bin operations preserve
lanes byte-for-byte. Track-local ripple operations transform lanes on the
affected track through the same exact interval map; all-track ripple also
transforms master and mixer-edge lanes. The transformation splits a segment
through exact evaluation and refuses transactionally if it cannot remain
canonical and below the cap. Sample lanes use sample coordinates; beat lanes
use beat coordinates and the authoritative tempo map. No edit samples an
eased/Bézier segment into a cache.

Automation presentation is enabled per track through:

```text
Track menu > Add automation
Track header > Automation parameter
Track header > Automation mode > Read | Trim | Touch | Latch | Write
```

The checkable action only toggles session visibility and never creates or
deletes project data. The optional 24px row exposes descriptor-derived track,
outgoing-route/send, and effect targets. Its accent curve and points are clipped
to clip bodies; clip gain stays white and owns pointer interaction while its
tool is active. A missing lane is displayed as the current flat value and the
first accepted edit creates it. Curve-menu deletion is explicit and leaves the
row visible. The controls and overlay support keyboard editing, announce
refused or stale edits, and are inert when read-only or locked.

## 4A-2 — Mixer graph revision

### Exact graph wire

```ts
type MixerOutputRoleV21 = 'main' | 'cue' | 'control-room' | 'auxiliary';
type MixerEdgeKindV21 = 'assignment' | 'send' | 'sidechain';
type MixerEdgePositionV21 = 'pre-fader' | 'post-fader';

interface MixerGraphV21 {
	readonly schemaVersion: 1;
	readonly groups: readonly MixerStripV21[];
	readonly sends: readonly MixerStripV21[];
	readonly cues: readonly MixerStripV21[];
	readonly vcas: readonly MixerVcaV21[];
	readonly outputs: readonly MixerOutputV21[];
	readonly edges: readonly MixerEdgeV21[];
}

interface MixerStripV21 {
	readonly id: string;
	readonly name: string;
	readonly color: string;
	readonly gain: number;
	readonly pan: number;
	readonly mute: boolean;
	readonly solo: boolean;
	readonly collapsed: boolean;
	readonly effectsActive: boolean;
	readonly effects: readonly Readonly<Record<string, unknown>>[];
	readonly channelCount: number;
}

interface MixerVcaV21 {
	readonly id: string;
	readonly name: string;
	readonly gain: number;
	readonly mute: boolean;
	readonly members: readonly StripRef[];
}

interface MixerOutputV21 {
	readonly id: string;
	readonly name: string;
	readonly role: MixerOutputRoleV21;
	readonly channelCount: number;
}

type MixerEndpointV21 =
	| { readonly kind: 'track'; readonly id: string }
	| { readonly kind: 'mixer-node'; readonly id: string }
	| { readonly kind: 'master' }
	| { readonly kind: 'output'; readonly id: string };

interface MixerEffectSidechainEndpointV21 {
	readonly kind: 'effect-sidechain';
	readonly strip: StripRef;
	readonly effectId: string;
}

interface MixerEdgeV21 {
	readonly id: string;
	readonly kind: MixerEdgeKindV21;
	readonly source: Exclude<MixerEndpointV21, { readonly kind: 'output' }>;
	readonly destination:
		| Exclude<MixerEndpointV21, { readonly kind: 'track' }>
		| MixerEffectSidechainEndpointV21;
	readonly position: MixerEdgePositionV21;
	readonly level: number;
	readonly enabled: boolean;
	readonly channelMap: readonly number[];
}
```

Each of `groups`, `sends`, `cues`, `vcas`, `outputs`, and `edges` admits at most
4,096 items under the unchanged global document-node ceiling. Mixer-node IDs
are unique across the group/send/cue collections; VCA IDs, output IDs, and edge
IDs are unique within their identity spaces, and VCA members are unique within
that VCA. Strip/output channel counts are safe integers from 1 through 32.
Strip gain is `[0, 4]`, pan is `[-1, 1]`, and VCA gain is `[0, 4]`. Output role
is one of the four literals above and exactly one output has role `main`.
Persisted output state is a named placeholder only; browser device IDs, native
device IDs, permissions, channel leases, and availability never enter the
project.

Tracks derive their channel width through the maintained terminal-width
resolver, master uses `project.masterChannels`, and every other audio endpoint
uses its declared width. `channelMap` contains at most 32 safe integers in
`[-1, 31]`: array position addresses the destination channel, the value selects
a source channel, and `-1` supplies silence. An empty array is the exact
preserve/default mapping; explicit maps such as `[0, 1, 0, 1, -1, -1]` express
duplication and silence without a second matrix dialect. Contextual validation
rejects an index outside the admitted endpoint width.

Every edge stores its exact `position`; the default assignment is post-fader,
while authored assignments, sends, and sidechains admit the two named values.
Pre-fader taps are after the source insert
rack but before strip gain, pan, mute, solo, metering, and any VCA multiplier;
post-fader taps are after those strip controls. Edge level is `[0, 4]`, is the
only persisted edge gain, and is addressed by the stable edge parameter target.
Disabled edges remain authored but do not contribute routing, reachability,
cycles, or PDC. No destination also reads a hidden route scalar.

Edges may originate at an audio track, mixer node, or master; outputs are
terminal and tracks are never destinations. A `send` must terminate at a mixer
node. A `sidechain` must terminate at `effect-sidechain`, whose strip and effect
must exist; there is deliberately no persisted sidechain `inputId`. Assignment
and send destinations never use `effect-sidechain`, and a sidechain never uses
an ordinary destination. VCA control is not encoded as an edge: each VCA owns
its closed `members` array of track, mixer-node, or master strip references.

The validator builds one dependency graph from enabled assignment, send, and
sidechain-computation edges. Any self-edge or strongly connected component
rejects; validation never removes an edge or chooses a winner. Missing
endpoints, dangling effects, duplicate identities, invalid maps, an output with
no enabled incoming audio path, or an audio track that cannot reach any output
also reject. Runtime input summation is deterministic after validation.
Multiple assignments are therefore explicit audible paths, not an
unordered-object accident.

A fresh V21 graph has empty group/send/cue/VCA collections, exactly one
`{ id: 'main', name: 'Main output', role: 'main', channelCount }` output,
explicit post-fader assignments from each audio track to master, and one from
master to output `main`. Default edge IDs are
`assignment:track:<trackId>:master` and `assignment:master:output:main`; level
is `1`, `enabled` is true, and the channel map is the explicit identity array.
A newly created audio track receives its assignment in the same transaction.
Because every audio track must reach an output, intentionally disconnected
tracks are not valid V21 state.

### Nested folders and graph ownership

Every timeline folder with an audio descendant, at any depth, owns one `mix`
bus whose ID equals the folder ID. The folder owns identity, name, arrangement,
collapse, height, hidden, mute, and solo state. Its mixer node owns color,
channel count, gain, pan, effects, and `effectsActive`; overlapping name and
collapse presentation mirrors the folder, while mute/solo resolve once through
the folder projection and remain false on the owned bus.

Each audio track has one reconciler-owned assignment to its nearest folder bus;
each nested folder bus has one reconciler-owned assignment to its nearest audio
ancestor folder bus. Other explicit assignments and sends remain user-owned and
visible. Moving, nesting, unnesting, or deleting a folder revises its owned
nodes and edges in the same transaction, preserves unrelated nodes/edges, and
rejects the complete candidate on conflict. The reconciler creates candidates;
exact-current validation only rejects and never repairs.

### Command and menu contract

Add `mixer-graph/set` to one `audioMixerGraph` command domain:

```ts
{
	readonly type: 'mixer-graph/set';
	readonly expected: MixerGraphV21;
	readonly mixer: MixerGraphV21;
}
```

The handler compares and normalizes the complete graph, validates it against
the candidate project and automation targets, and publishes one revision or
none. Focused add/remove/update/routing UI compiles to this command. Track,
folder, effect, and channel-shape commands construct their graph and lane
changes inside their existing atomic mutation; no intermediate dangling graph
is published. Deleting an edge or node also deletes its owned lanes in that
same transaction. Undo/redo restore the exact graph and lanes.

The existing menu-owned Mixer panel remains the entry point:

```text
View > Panels > Mixer
Mixer toolbar > Routing graph | Channel strips
```

Opening Mixer is already opt-in. Routing graph mode replaces the strip/table
body inside that panel and resets to Channel strips when Mixer remounts. Its
lazy dependency-free graph provides deterministic layout, zoom/Fit, scrolling,
semantic node/edge inspectors, pointer and equivalent keyboard connection
editing, and graph-local Cue/VCA/Output creation. Existing Add group/Add send
actions remain authoritative. Invalid cycles, endpoints, cascades, and channel
maps are announced before one optimistic `mixer-graph/set` commit; read-only
projects remain inspectable.

## 4A-3 — Per-path plug-in delay compensation

PDC is derived runtime state and has **no V21 wire field**. Persisting a path
latency, compensation delay, scheduled offset, compiled topology, or analyser
alignment is invalid. The exact graph, effect instances/parameters, project
sample rate, and active effect-rack latency are the complete inputs. The
initial leaf compiler consumes the maintained `effectLatencyFrames` authority;
4A-3 must consolidate that authority behind the descriptor inventory before
activation rather than add a second latency table.

The exact derived result is:

```ts
interface ProjectPathPdcPlanV21 {
	readonly nodeInputLatencyFrames: ReadonlyMap<string, number>;
	readonly nodeOutputLatencyFrames: ReadonlyMap<string, number>;
	readonly edgeCompensationFrames: ReadonlyMap<string, number>;
	readonly outputLatencyFrames: ReadonlyMap<string, number>;
	readonly freezeLatencyFramesByTrack: ReadonlyMap<string, number>;
	readonly latencyFrames: number;
	readonly monitoringLatencyFrames: number;
	readonly renderLatencyFrames: number;
	automationLatencyFrames(address: unknown): number;
}
```

Node keys are canonical `track:<id>`, `mixer-node:<id>`, and `master`; edge and
output maps use their exact persisted IDs. All values are nonnegative integer
sample frames. The three aggregate latency fields are the maximum resolved
output latency for this V21 plan. `freezeLatencyFramesByTrack` is the active
insert-rack latency at the post-insert/pre-strip boundary. The plan and maps are
immutable runtime results and never persistence carriers.

The compiler validates and topologically evaluates enabled assignment, send,
and sidechain dependencies. For every mixer/master input, it aligns incoming
source-rack arrivals to the maximum and adds the destination rack latency. An
output independently aligns its enabled incoming audio edges. A sidechain
arrives at the named effect's exact prefix inside the destination rack, so it is
compensated to that execution point rather than the strip output. Disabled
edges receive zero compensation. Branches share upstream work but own
compensation at each downstream merge. Safe-integer overflow, an unavailable
delay primitive, or a required delay beyond the admitted runtime limit refuses
the graph rather than clipping or persisting a repair.

`nodeInputLatencyFrames`, `nodeOutputLatencyFrames`,
`edgeCompensationFrames`, and `outputLatencyFrames` are the only plan diagnostic
maps. Live playback, monitoring, offline render, stem render, automation,
sidechains, and freeze must call this compiler. A specialized consumer may
select a subgraph, but it cannot recompute latency with a different rule.

`automationLatencyFrames` normalizes the supplied address. A strip target uses
that strip's output latency, an edge-level target uses the source output plus
that edge's inserted compensation, and an effect target uses its strip input
plus the effect's rack-prefix latency; an unknown edge or effect rejects. The
scheduled-parameter registry converts project frames to the actual context
sample rate once and applies that offset once. A ramp therefore reaches every
compensated output path on the same output sample. Offline render uses the same
integer offsets without converting through seconds.

The freeze render terminates immediately after the target track insert rack.
It prerolls by the descriptor rack latency, crops that leading latency from the
stored timeline-aligned body, and appends the exact rack tail. Frozen playback
treats the baked rack latency as zero and recompiles downstream compensation;
it never applies the baked rack twice.

The V21 mixer-graph selection gate required deterministic diamonds, nested
buses, parallel assignments, pre/post sends, sidechains, VCA control,
monitoring, offline render, automation, and freeze-boundary impulse fixtures to
report exact zero PDC error. That local matrix is green, so the selected
Soundscaper route enables the graph; the external qualification gates remain
open. Existing underrun counters and budgets must not regress.

## 4A-4 — Freeze, unfreeze, refresh, and commit

### Exact freeze wire

The field and record below are frozen as the 4A-4 input contract. They are not
part of the initial lane/graph/PDC leaf candidate: 4A-4 owns their validator,
derived-source lifecycle, carriers, commands, and activation.

```ts
interface AudioTrackFreezeV1 {
	readonly schemaVersion: 1;
	readonly derivedSourceId: string;
	readonly inputDigestSha256: string;
	readonly rackDigestSha256: string;
	readonly automationDigestSha256: string;
	readonly freshnessDigestSha256: string;
	readonly renderStartFrame: number;
	readonly renderFrameCount: number;
	readonly capturePosition: 'post-insert-pre-strip';
}
```

There is at most one freeze per audio track and no freeze for video, label,
master, mixer strip, VCA, output, Project Bin, or partial selection state.
`derivedSourceId` is a nonempty reference to one managed derived audio source;
all four digests are canonical lowercase SHA-256. `renderStartFrame` is a
nonnegative safe integer, `renderFrameCount` is a positive safe integer, and the
range end must also remain a safe integer. The only admitted capture position
is the literal above. The track that owns the
record is the editable authority and may retain many clips and sources; there
is deliberately no singular `trackId` or `editableSourceId` inside the record.
The derived source's ordinary source descriptor owns its byte length, content
digest, sample rate, channel count, and geometry. Its bytes live only in
managed derived-source storage; no PCM, Blob, typed array, base64 payload, or
chunk cache enters project JSON.

The freeze range is exactly `[renderStartFrame, renderStartFrame +
renderFrameCount)` and includes the insert-rack tail selected by the render
planner. Empty tracks refuse freeze.
The render captures clip scheduling, clip gain/fades/envelopes/warp, referenced
source content, the track insert rack, and automation lanes targeting effects
in that rack. It ends before track gain, pan, mute, solo, strip automation, VCA
control, meters, graph edges, sends, buses, master, and output mapping, all of
which remain live and editable.

The three component digests bind canonical array-form snapshots:
`inputDigestSha256` covers project sample rate, the render range, the retained
track's exact ordered clips and source-content identities, and clip scheduling;
`rackDigestSha256` covers the exact active/preserved insert rack;
`automationDigestSha256` covers only lanes whose addresses target effects in
that rack, together with the project tempo map when any of those lanes is on
the musical timebase — such a lane is authored in beats and rendered through
that map, so the map is part of what produced the frozen audio. A freeze whose
covered lanes are all sample-timebased does not bind the map and survives a
tempo edit. `freshnessDigestSha256` binds the versioned tuple of those three
digests, range, sample rate, and `capturePosition`. It therefore changes for
any retained clip/source content, sample-rate/range, insert-rack, addressed
rack-automation, or read-tempo change. It excludes wall-clock time, project revision,
selection/view state, strip gain/pan/mute/solo, VCA state, meters, graph edges,
routing, and downstream state. Media digests are computed under the owned task
signal before render; the complete canonical state and project generation are
rechecked after every awaited boundary and before publication. Freshness and
staleness are recomputed runtime observations and are never persisted as a
boolean or timestamp.

Activation recomputes the four digest relationships and verifies the derived
source through its ordinary source descriptor before substituting it. A
mismatch makes the freeze visibly
**stale** session state and uses the retained live canonical track/rack for
playback and export; stale bytes are never used silently and canonical state is
not mutated. Refresh repeats the owned render and atomically replaces the
record/source after currentness checks. Unfreeze removes the record and returns
to the already-retained live rack without reconstructing anything.

Commit requires a fresh, verified freeze. In one undoable mutation it replaces
the target track's owned clips with one clip at `renderStartFrame` over the
complete render including tail, clears the baked track insert rack and its
effect-target automation lanes, removes the freeze record, and retains the render source as
ordinary canonical media. Track identity, folder membership, lock, strip
gain/pan/mute/solo, strip automation, mixer/VCA assignments, sends, sidechains
not targeting the removed rack, and downstream routing remain exact. Original
clips and now-orphaned sources leave the current revision but remain available
while bounded history retains a referencing revision. Commit is destructive
current state, not irrecoverable history while that undo entry exists.

Derived-source deletion is history-aware. Install/refresh writes into a staging
record, closes and verifies it, rechecks project currentness, and only then
commits document state. Refusal or cancellation deletes staging. A replaced or
unfrozen body is retained while any live history, saved revision, handoff, or
task references it and is deleted only after the last exact owner retires. Undo
and redo never point at missing derived bytes.

### Commands, fallback, and menu contract

The controller owns the asynchronous render. Its final mutations use one
`audioFreeze` command domain with exact discriminants:

- `audio-freeze/install` carries the expected current freeze or `null`, the
  verified source descriptor, and the complete replacement record;
- `audio-freeze/remove` carries the complete expected record; and
- `audio-freeze/commit` carries the complete expected record and verified
  operation-time digest admission.

All three check the target lock, intrinsic read-only state, capability,
requirement reconciliation, graph validity, lanes, and exact expected state.
Refresh is another install, not a fourth mutation. A stale expected record,
late task, digest mismatch, storage failure, or invalid resulting project leaves
history and current state untouched.

Each fresh freeze owns one `rendered-fallback` manifest requirement for the new
`audioTrackFreeze` capability using role `audio-track-render-v1`, its exact
target track, render source, and digest. One eligible freeze can therefore use
the maintained relationship in a recipient lacking the feature. Multiple
simultaneous track fallbacks remain preserved but reject partial playback where
the compatibility layer cannot admit all of them; no recipient silently picks
one. Stale state is never published as an available fallback. The
`audio-freeze-fallback` compatibility rule flips from planned only with the
complete authoring, freshness, fallback, `.scape`, managed handoff, and packaged
workflow.

The selected-track menu path is:

```text
Tracks > Freeze > Freeze track
Tracks > Freeze > Refresh frozen track
Tracks > Freeze > Unfreeze track
Tracks > Freeze > Commit frozen track
```

Only actions valid for the selected writable audio track are enabled. Freeze
and refresh use the single abortable foreground task with existing structured
progress. Stale/fresh state is shown in the opened menu and existing contextual
status/compatibility surface; there is no default-visible badge, track control,
toolbar button, or panel.

## V21 registration and preservation

The selected registration has these capability keys and feature IDs:

| Capability key | Feature ID | Selected profiles |
| --- | --- | --- |
| `audioAutomation` | `org.soundscaper.capability.audio-automation` | Soundscaper V23 available; selected Framescaper V27 project profile locally implemented, pending guided/external qualification |
| `audioMixerGraph` | `org.soundscaper.capability.audio-mixer-graph` | Soundscaper V23 available; selected Framescaper V27 project profile locally implemented, pending guided/external qualification |
| `audioTrackFreeze` | `org.soundscaper.capability.audio-track-freeze` | Soundscaper available; Framescaper unavailable |

Nonempty `automationLanes` own reserved requirement
`soundscaper.audio-automation` with
`bypass` and no fallback. Any graph beyond the exact fresh main-output/master
edge and per-track master assignments owns `soundscaper.audio-mixer-graph` with
`bypass` and no fallback. Freeze records own their exact per-record rendered
fallback requirements described above. Missing, stray, reserved-ID-conflicting,
publisher-substituted same-feature, wrong-target, stale-fallback, or duplicate
declarations reject. Capability policy covers direct commands, recursive
batches, track/folder/effect deletion and duplication, generic clip/track
carriers, project replacement, and import/handoff.

Soundscaper enabled `audioAutomation` and `audioMixerGraph` together after 4A-1
through 4A-3 passed their complete local native workflows, and enabled
`audioTrackFreeze` after 4A-4 passed. Selected Framescaper V27 now adopts the
shared automation and mixer surfaces under its exact project profile while
keeping `audioTrackFreeze` unavailable. These were
technical route-selection gates, not waivers of the still-open manual,
owner-host packaged-profile, release, or other named qualification
evidence. The capability flip was atomic with the selected
App/runtime/storage route.

V21 retains `.scape` formats 1 and 2 and advances the Soundscaper desktop
library to a fresh product-owned V10 scope with SQLite `user_version` 12; it
does not mutate the historical V9 catalog. The session clipboard advances from
V6 to V7 for exact track duplication/remapping carriers; an older clipboard
requires recopy rather than inventing graph or lane state. Current-format
browser storage, `.scape`, desktop handoff, project duplication, history, and
recovery carry the complete graph, lanes, track-owned freeze metadata, and every
referenced freeze body. Explicit transfer to Framescaper remains copy-only and
round-trips back byte- and semantic-stable.

| Operation | Required V21 behavior |
| --- | --- |
| Clip move, trim, split, join, stretch, relink, replace | Preserve graph/freeze metadata; apply only the lane interval rule named above; a frozen input edit becomes stale |
| Track add | Add the track and explicit identity assignment to master atomically |
| Track duplicate | Remap track/effect lane targets and graph IDs; do not duplicate a freeze |
| Track delete | Remove owned lanes, edges, freeze record, and history-aware derived ownership atomically |
| Effect reorder | Preserve stable effect automation targets byte-for-byte |
| Effect remove | Remove its lanes and sidechain edges in the same transaction |
| Mixer edge/node delete | Remove owned lanes and dependent edges; reject if the complete candidate is invalid |
| Folder nest/move/delete | Reconcile only folder-owned nodes/edges, then reject-or-publish the complete graph |
| Copy/paste clips | Carry clip-local state only; never smuggle strip automation, routing, or freeze state |
| `.scape`, desktop, browser save/reopen | Preserve exact state and required derived bodies; verify freeze integrity before use |
| Cross-product transfer | Copy-only preservation; no lossy V17/V20 runtime projection |

## Acceptance for 4A-1 through 4A-4

1. Hostile-value tests cover every closed record, key set, prototype, accessor,
   symbol, sparse array, negative zero, nonfinite/range/ID/digest error,
   duplicate target, dangling reference, curve shape, channel map, and cycle.
   They prove recursive freeze, detachment, idempotence, and semantic equality.
2. Exact V21 create, validate, clone, selected load/save, typed V17 re-import
   refusal, future opaque-read-only handling, browser storage, `.scape` formats
   1/2, desktop V10, history, recovery, V7 clipboard, and copy-only
   cross-product fixtures preserve all fields and bodies.
3. Requirement/capability tests cover empty/default and authored state, both
   profiles, direct and nested-batch policy, every generic authoring carrier,
   missing/stray/conflicting requirements, rendered-fallback conflicts, and
   profile flips only after native workflows.
4. Lane vectors cover sample and beat time, all interpolation shapes, Bézier
   monotonicity/inversion, descriptor ranges/tapers/steps, worklet consumer
   fencing, effect reorder/reload identity, endpoint behavior, 4,096-point
   limits, and deterministic thinning ties.
5. Mode matrices cover read/trim/touch/latch/write across play, stop, seek,
   loop, gesture release, cancellation, target removal, track lock, read-only
   transition, project switch, stale generation, undo, and redo. Each accepted
   gesture creates exactly one history transaction.
6. Graph matrices cover nested buses, explicit multiple assignments, pre/post
   sends, VCAs, cue/control-room/output roles, sidechain inputs, every valid
   channel-width mapping, stable input order, folder reconciliation, all cycle
   classes, and reject-over-repair behavior.
7. One independent graph reference model compares live, monitoring, offline,
   stems, and freeze PDC for chains, diamonds, nested buses, sends, sidechains,
   and parallel paths. Every impulse and automation landmark reports
   `parity.pdcErrorSamples eq 0`; underrun metrics do not regress.
8. Freeze matrices cover initial freeze, verified activation, edit-to-stale live
   fallback, refresh, unfreeze, commit, task replacement, cancellation at every
   awaited boundary, source/render corruption, digest drift, storage failure,
   history retention/eviction, undo/redo, save/reopen, `.scape`, managed
   desktop handoff, eligible single fallback, and refused multiple partial
   fallbacks. No fixture places render bytes in project JSON.
9. Chromium proves all menu paths, keyboard operation, focus return, announced
   validation/staleness, no default-visible additions, forced colors, serious
   axe checks, undo/redo, and save/reopen. Framescaper exposes no 4A authoring
   entry while its capabilities are unavailable.
10. `npm run check`, the focused browser workflows, file-size ratchets, the
    500,000-byte production chunk ceiling, and the 25 MiB Pages ceiling remain
    green. The production-parity collector retains all five registered
    thresholds without retry or loosening.

Stop 4A-1 through 4A-4 if a lane needs raw dense persisted capture, a target
lacks stable identity, a graph has two authorities for one audible connection,
a cycle or dangling reference would be repaired, a path needs persisted PDC, a
worklet cannot consume bounded sample-offset packets, frozen bytes enter JSON,
history can point at deleted derived bytes, stale render can sound silently, a
consumer needs a lossy V17 projection, a capability must flip before its native
workflow passes, or a new control must be visible by default.

## 4A-5 — Restoration and metering

**Status: Implemented (provisional).** The local domain, controller, and
menu-reached browser acceptance are green; external qualification remains open.

- **Outcome:** add a built-in Restoration template under **Tools > Manage
  macros** that clones fresh IDs and canonical defaults for Click Removal,
  Noise Reduction, and Filter Curve EQ into an ordinary editable draft. Noise
  Reduction embeds a JSON-safe captured profile and gates Run until present.
  Preserve per-strip phase, correlation, declared-channel surround, and bounded
  loudness-history telemetry while keeping **Analyze > EBU R 128** as the only
  meter surface.
- **Invariants:** no new restoration DSP or project wire; effect parameters and
  history commits retain their current authorities. Meter history is bounded
  session state, resets on project/runtime lifecycle, never enters history or
  persistence, and schedules from the shared scalable analyser service rather
  than one timer per strip.
- **Acceptance:** deterministic DSP-chain and undo/redo matrices; mono/stereo/
  surround channel geometry; correlation/phase reference vectors; EBU momentary,
  short-term, integrated, and reset history; 128-strip scheduling bounds;
  menu/keyboard/screen-reader parity; unchanged transport underruns.
- **Non-goals:** no export normalization, loudness write-back, AI cleanup,
  document meter history, new default-visible meter, or new restoration
  algorithm. There is no bespoke Restoration compiler/dialog or Production
  meters menu.
- **Stop condition:** stop if a meter needs persisted state, a processor needs a
  second parameter definition, or scheduling requires one independent polling
  loop per strip.

## 4A-6 — Reviewed effect packages

**Status: Implemented (provisional).** The built-in, release-pinned Utility
Gain package ships through the reviewed pure-WASM offline/realtime paths.
External packages, arbitrary URLs, and user trust overrides remain fenced.

- **Outcome:** ship package ABI V1, the dedicated offline worker loader, the
  separately realtime-approved static first-party AudioWorklet host, release-
  pinned catalog, resource declarations, hash/signature and revocation policy,
  and repository-owned Utility Gain conformance package. Revise the threat
  model, security matrix, licensing matrix, notices, and runtime evidence pins
  in the same atomic packet. Utility Gain is reached through **Effect > Special
  Effects** and the canonical Selection Effects dialog, not a bespoke Tools
  surface.
- **Invariants:** packages are pure WASM; no package JavaScript, arbitrary URL,
  user trust override, same-origin storage/network access, ambient clock/random,
  or unbounded memory/output exists. Realtime approval is separate from offline
  approval and never inferred from a valid hash.
- **Acceptance:** malformed ABI, forbidden import, timeout, cancellation,
  memory/output oversize, declared-latency/tail violation, hash/signature
  mismatch, catalog mismatch, and revocation tests pass before the loader is
  exposed; Utility Gain produces bit-bounded offline and realtime reference
  vectors; licensing and repinned security evidence gates pass.
- **Non-goals:** no native plug-in, arbitrary third-party JavaScript, package
  marketplace, remote fetching, user signing authority, or same-origin API.
- **Stop condition:** stop if a package needs JavaScript import, ambient origin
  authority, an unpinned artifact, or a weakened worker/worklet boundary.

## 4A-7 — Exit evidence

Run the selected Soundscaper V23 surface, retaining V21 production state, through
`m4-production-render-parity`: audio maximum absolute sample error at most
`1e-6`, PDC error exactly zero samples, video SSIM at least `0.98`, normalized
channel MAE at most `6/255`, and silently omitted effects exactly zero. The
owner-designated 2026-08-21 fixed-GPU reference run passes these thresholds.
The retained 2026-08-22 packaged artifact lacks the complete current runtime
fingerprint and remains diagnostic-only for the owner-host profile. A reviewed
no-retry hosted cohort on the registered hardware lower bound formally
qualifies the exact M4 workload. A fresh owner-host run is still required to
close its separate packaged profile; manual, release, and milestone-3 rows stay
at their observed states until their own acceptance is complete.

Packets 4A-1 through 4A-6 and the complete native workflows are locally
implemented, and 4A-7's local automated acceptance is green. V23 is therefore
the selected maintained Soundscaper route, retaining V21 as its automation,
PDC and freeze foundation, and is a complete local implementation candidate.
Its exact M4 workload row is qualified, while its fixed-GPU packaged profile,
manual, and release evidence remain open, as do the
parallel 4B exit gate and the overall milestone-4 exit gate.

## Non-goals and fences

- No MIDI schema, UI, event, port, instrument, import, or export.
- No Framescaper capture, native helper, hardware encode, delivery queue,
  export preset, cloud processing, or hosted processing.
- No export-time normalization; no meter or PDC derived state in the document.
- No third-party JavaScript or arbitrary effect-package URL in the origin.
- Every new 4A workflow is reached through an existing menu or an already
  menu-opened Mixer, and remains closed or hidden until the user opts in.
