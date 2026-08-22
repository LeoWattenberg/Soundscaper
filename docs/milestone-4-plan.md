# Milestone 4 plan: parallel production surfaces

> Owning source for milestone-4 sequencing, the automation/keyframe and
> mixer-graph decisions, their invariants, and the bounded work packets.
> The [roadmap](../roadmap.md#4-parallel-production-surfaces) owns scope
> and status; the compatibility, security, and licensing policies own
> their claims. Re-grounded on 2026-08-14 against the maintained Soundscaper
> V17 and Framescaper bases: milestone 3 and external qualification remain open,
> while the project owner has explicitly cleared the implementation sequencing
> gates for Framescaper 4B and Soundscaper 4A. Those clearances do not relabel
> evidence.

## Goals and ordering principle

1. **Primary: users must not hit trouble.** Automation replays
   sample-identically on every playback and export, latency compensation
   is exact on every routing path (`parity.pdcErrorSamples eq 0`,
   config/quality-budgets.json:1000), keyframes never slide under trims
   (the recorded StaffPad lesson, docs/milestone-3-plan.md:247-249),
   freeze never destroys editable state, captions never lose speaker or
   timing data, unsupported GPU operations fall back visibly
   (`parity.silentlyOmittedEffects eq 0`), and every new document type
   registers before it ships so nothing degrades projects silently.
2. **Secondary: two tracks stay file-disjoint.** The serialized 4.0
   foundation closes the contracts both tracks would otherwise fight
   over — the interpolation vocabulary, the parameter address space, and
   the parity harness — then 4A (Soundscaper production) and 4B
   (Framescaper finishing) run in parallel under the milestone-3
   coordination rules.

Work is ordered by irreversibility: the interpolation vocabulary and the
parameter address space shape every automation lane, keyframe,
transition curve, and caption timing decision after them; they land
first, once, under review, schema-neutral, before any dependent schema
revision.

## Prerequisites and pickup state (grounded 2026-08-14)

Milestone 4 depends on milestone 3. The shared exact-time foundation and the
maintained Soundscaper and Framescaper editorial base now exist, but roadmap
milestone 3 remains **In progress** and its manual and packaged-runtime
qualification rows remain open or `pending-external`. Shared 4.0 hosted
correctness is green. On 2026-08-21 the owner-designated Windows x64 RTX 3090
reference run passed M1 preview, M4 production parity, and M4B-2 keyed parity.
The retained 2026-08-22 packaged artifact formally qualifies M4 production.
M4B-2 now has the same independent formal nightly profile, but needs a fresh
owner-host run at the new budget digest before that formal row can close.

On 2026-08-13 the project owner explicitly cleared the milestone-3
implementation sequencing gate for the Framescaper 4B track. On 2026-08-14 the
owner explicitly cleared the maintained Soundscaper base for 4A by directing
implementation of milestone 4A. These directions authorize pickup and
implementation without claiming milestone-3 completion, waiving a manual or
external row, changing an observed result, or closing either track or the
milestone-4 exit gate.

The pickups leave concurrent milestone-3 work and its evidence state untouched.
Framescaper V20 is now the selected browser and packaged-desktop App authority;
V19 remains the reserved dormant boundary. Historical keyed/reference
diagnostics passed in the owner-designated run, while V20 formal, manual, and
release qualification remain open. The globally serialized V21 slot remains
the Soundscaper automation/mixer/PDC foundation and the selected Soundscaper
route is V23. Framescaper transitions begin at dormant V22.

## 2026-08-14 implementation decisions

- Serialized 4.0 is implemented provisionally. The Framescaper 4B-1
  implementation candidate is complete apart from manual qualification, and
  selected V20 4B-2 route remains in progress with
  manual and external qualification open under its
  [pickup contract](milestone-4b-framescaper-finishing.md). Soundscaper 4A now
  has explicit sequencing clearance and an active
  [V21 pickup contract](milestone-4a-soundscaper-production.md). Its local
  implementation candidate is complete and the maintained Soundscaper
  App/runtime/storage route is selected. Packets 4A-1 through 4A-6 are
  implemented provisionally and 4A-7's local automated acceptance is green;
  its reference-GPU row has passed, while hosted, packaged-runtime, and manual
  qualification remain open. Neither track is complete, and both track exit
  gates and the overall milestone-4 exit gate remain open.
- Automation uses one timebase per lane, a 4,096-point persisted cap, and
  deterministic adaptive thinning that preserves endpoints, discontinuities,
  mode boundaries, and the highest-error extrema.
- Bézier segments store two absolute clip-relative rational-time/native-value
  handles. Handle time is monotone; evaluation is defined for nonmonotone
  values, while inversion rejects them.
- Freeze is audio-track-only and captures through the track insert rack before
  strip controls and downstream routing. Commit bakes that track-local result,
  remains undoable while bounded history retains it, and preserves strip
  automation and routing.
- Reviewed packages trust only the release-pinned catalog. Pure WASM may run in
  both the dedicated offline worker and, when separately realtime-approved, a
  static first-party AudioWorklet host. The repository-owned Utility Gain
  package is the first shipped conformance surface; no user trust override or
  arbitrary package URL exists.

## Decisions

### One interpolation vocabulary

Milestone 4 introduces the product's single animation vocabulary —
**hold, linear, eased, and Bézier segments** — used by automation lanes,
video keyframes, and transition curves alike, implemented once as an
evaluator beside the shared time module. Today three incompatible
linear-only evaluators exist and none can express it:

- the clip/track/bus/master envelope evaluator, linear with unity
  endpoints (`src/common/editor/automation.js:19-46, 103-107`);
- the breakpoint-map evaluator, piecewise-linear plus freeze
  (`src/common/editor/timeline-time.ts:277-296`);
- the StaffPad keyframe evaluator, linear over normalized positions
  (`src/common/editor/staffpad/parameters.js:120-135`).

Rules carried over from the milestone-3 time model: control points
anchor in the owning object's authoritative domain and round once under
a named policy; positions are clip-relative and clamp into the clip
span; normalized-[0,1] positions are storage-banned (they slide under
trims); eased/Bézier segments evaluate in closed form with documented
monotonicity constraints so inversion stays defined where a consumer
needs it (the `video-retime-curve.ts:63,196,206` compile/evaluate/invert
shape is the precedent). The existing evaluators are not deleted:
clip envelopes stay Audacity-parity linear, warp/retime maps keep their
per-feature validity rules; the new vocabulary is for the new document
types.

### A parameter address space with stable identities

Automation needs an addressable target model. Today only gain has a
scheduled-parameter registry (`ProjectGainParams` — tracks, groups,
sends, master — `src/common/editor/engine/project-graph.ts:64-74`); pan,
mute, send level, and effect parameters have no parameter handle, and
effect parameters are flat named scalars with declared ranges
(`src/common/editor/effects.js:57-100, 182-192`) but **no per-parameter
descriptor and no identity-stability contract**. The foundation defines:

- a parameter descriptor (id, unit, range, taper, default,
  automatable) over track/bus/master strips and effect instances,
  with the id-stability rule that makes a persisted lane survive
  effect reordering and project reload;
- a scheduled-parameter registry generalizing `ProjectGainParams` to
  every automatable target, with per-target latency offsets exactly as
  gain scheduling already applies them
  (`src/common/editor/engine/clip-gain.ts:46-53`);
- tempo-addressable values resolved through the 3A-1 tempo map, never a
  second timing surface.

The write-mode gesture semantics (touch/latch/write) extend the proven
adopt-live-then-commit pattern of the rack effect service
(`src/common/editor/controller/rack-effect-service.ts:343-380`), where
live worklet configuration (`src/common/editor/engine/effect-control.ts:40-107`)
runs ahead of a single history commit.

### Automation lanes are bounded document state

Lane points are document state under the global 100,000-node validation
ceiling counted per scalar (`src/common/editor/scape-project-document.ts:38`;
`src/common/editor/project-v9-validation-budget.ts:6-14, 185-199`) with
full-document deep clones per edit and a 200-entry history
(`src/common/editor/history.js:4`; `src/common/editor/project.js:265-274`).
A `{frame, value, mode}` point costs ≈4 nodes, so ~25,000 points is the
whole-document budget shared with everything else. Consequences:

- every lane carries an explicit per-lane point cap (the
  `MAX_BREAKPOINTS = 4_096` and `maximumNodes: 16_384` precedents,
  `src/common/editor/timeline-time.ts:38`,
  `src/common/editor/track-hierarchy-v13`-family), unlike today's
  uncapped envelopes (`src/common/editor/project-v2.js:175-188`);
- write-mode capture records at gesture rate and **thins to the cap on
  commit** — control-rate capture is never persisted raw;
- if a workflow genuinely needs dense data, it becomes a digest-bound
  external asset per the established bulk-timing pattern
  (docs/milestone-3-plan.md:310-327) — declared, not smuggled.

The track/bus/master `envelope` arrays are superseded by lanes in the
same revision (pre-release clean break, no migration); the clip-local
envelope remains as the Audacity-parity clip primitive.

### The mixer graph revision

Today routing is one scalar plus a flat send map — `routes[trackId] =
{groupId, sends}` with audio-track-only keys
(`src/common/editor/project-v2.js:253-269`;
`src/common/editor/project-v9-document-validation.ts:153-168`) — sends
are hard-wired post-fader (tapped after gain, panner, PDC delay, and
analyser, `src/common/editor/engine/project-graph.ts:265-273`), bus→bus
routing does not exist, and no routing cycle validator exists because
the shape makes cycles impossible. Milestone 4 replaces this with the
full graph the roadmap names (roadmap.md:517-523): nested buses,
multiple assignments, pre/post-fader send position, VCAs, cue/control
room mixes, output placeholders, explicit sidechain routes (today
sidechains are implicit control-track inputs to Auto Duck,
`src/common/editor/engine/effect-rack.ts:151-156`), channel mapping,
and the product's **first real cycle validator** — rejecting, never
repairing.

The milestone-3A single-bus-layer rule is lifted in the same revision
that delivers per-path compensation, exactly as its own rationale
demands: `src/common/editor/folder-bus-v13.ts:3-13` records that one
layer exists *because* "bus-to-bus routing does not exist and delay
compensation is single-stage, so a second layer would misalign
silently." The folder-bus authority split (folder owns identity and
arrangement state, bus owns mix state,
docs/milestone-3a-track-folder-editing.md:53-58) is preserved; the
reconciler and its non-repairing validators
(`src/common/editor/folder-bus-v13.ts:92-197`) are revised together
with the graph.

### Per-path plug-in delay compensation

Today PDC is single-stage with three flat maxima: per-effect latency is
known only for the limiter lookahead and Audacity live effects
(`src/common/editor/engine/effect-rack.ts:100-110`), each track is
delayed to the maximum track latency, each bus terminal to the maximum
bus latency, and the totals simply add
(`src/common/editor/engine/project-graph.ts:165-208, 396`). Nested
buses make that wrong by construction. Milestone 4 computes
compensation **per routing path** across playback, monitoring,
automation scheduling offsets, sends, sidechains, render, and freeze,
with every effect reporting latency through one descriptor field. The
gate is exact: `parity.pdcErrorSamples eq 0`
(config/quality-budgets.json:1000). Automation scheduling consumes the
same per-path offsets so a ramp lands on the same output sample through
any route.

### Freeze is a document model, not a fallback role

Nothing called freeze exists. What exists must not be mistaken for it:

- **mix-and-render** is a destructive bounce that deletes source
  material (`src/common/editor/controller/mix-render-model.ts:210-290`);
- the milestone-2 **rendered-fallback roles** are read-side,
  publisher-supplied, digest-bound substitutions that cannot author,
  refresh, or revert
  (`src/common/editor/project-feature-audio-rendered-fallback.ts:99-113`,
  `project-feature-audio-track-render-v1.ts:33-38`), and the
  compatibility policy already fences the distinction: "Canonical audio
  freeze, unfreeze, commit, relink, and freshness semantics are owned by
  milestone 4" (docs/project-compatibility.md:2186-2190).

Milestone 4 adds reversible freeze/unfreeze/commit: frozen audio renders
persist through the derived-source machinery
(`src/common/editor/controller/derived-source-service.ts:51-62`), the
frozen state retains the complete editable rack and routing, freshness
is digest-bound to the inputs that produced the render, and commit is
the explicit irreversible step. The planned `audio-freeze-fallback`
compatibility rule (config/project-compatibility.json:1236-1246) flips
in the packet that ships it.

### Transforms, keyframes, and one shared render description

Composition is shared but rendering is split: the domain resolves
painter-ordered layers and intervals
(`src/common/editor/video-timeline.js:99-252`) consumed by both the
WebGL preview compositor and the FFmpeg filter-graph builder — which
agree today only through the parity fixtures. There is **no transform,
crop, opacity, blend, or flip anywhere in the persisted model**: a video
clip persists exactly `speedRatio` and `videoEffects`
(`src/common/editor/project-v9-media-validation.ts:130-133`), the
preview compositor has fixed contain-fit geometry and two hard-coded
blend functions (`src/common/editor/ui/video-preview-compositor.js:471-473,
616-619`), and the export side mirrors them
(`src/common/editor/video-ffmpeg.js:258-269`).

Milestone 4 defines one **per-clip geometry/blend description**
(transform, crop, opacity, blend mode, flip, compositing order) that
both renderers consume, keyframable under the shared vocabulary, with
the crop rectangle keyframable as a path — the explicit migration
target milestone 7 records for its reframe proposals
(docs/milestone-7-plan.md:734-750) and the styled-caption/transform
upgrade expectations at docs/milestone-7-plan.md:409-422. Renderer
parity is enforced by the golden-frame harness, extended beyond
single-frame effects to composited transforms and transitions (today's
parity spec covers effects only,
tests/browser/audio-editor-video-effects-parity.spec.js:141-145).

### Explicit transitions

There is no transition object, type, or registry to migrate — a
crossfade is *inferred* from clip overlap on one track with hard-coded
linear complementary opacity
(`src/common/editor/video-timeline.js:39-93, 450-463`;
`src/common/editor/video-ffmpeg.js:571-581`). Milestone 4 introduces
explicit transition objects (type, duration, curve under the shared
vocabulary, per-edge alignment) behind an extensible registry modeled
on the video-effect registry shape
(`src/common/editor/video-effects.js:29-98`), and re-expresses the
implicit overlap crossfade as the default transition. Audio's parallel
implicit model (`automaticCrossfadeRanges`,
`src/common/editor/engine/clip-schedule-plan.ts:148-175`) keeps its
semantics; whether it migrates onto the same objects is a 4B slice
decision, not a foundation mandate.

### Styled captions are a third timed-text type

Labels carry no style, region, speaker, or line data
(`src/common/editor/types.ts:126-138`) and timeline annotations are
deliberately fenced against becoming captions
(docs/milestone-3a-work-packets.md:83-101). The styled caption track is
therefore a new document type: cues with regions, speakers, styling,
and safe-area-relative placement; sidecar interchange reuses the
label-io mechanics (`src/common/editor/label-io.js:1-2, 75-99`) for
SRT/VTT plus styled formats decided in the slice doc. The schema must
carry **speaker identity and word-level timing** so milestone-7
transcripts re-target it losslessly
(docs/milestone-7-plan.md:409-413), and burn-in/mux delivery stays
milestone 6 (roadmap.md:647). Safe-area preview lands with the caption
inspector, not as a new always-visible surface.

### New source and clip kinds

Titles, text, shapes, solids, stills, generators, and adjustment layers
all require model growth: source kinds are exactly `'audio' | 'video'`
(`src/common/editor/types.ts:40`) and nothing imports still images
(accept lists are audio plus `video/mp4,video/webm`,
`src/common/editor/video-media.js:6`). The foundation decides the kind
taxonomy once (generator-backed sources vs. intrinsic clips vs.
adjustment layers as track-scoped effect hosts); each kind then lands
as a bounded 4B revision with its registration. The selection-aware
inspector is the surface change that binds them.

### Color and motion are Web Enhanced with exact fallbacks

3B-2 persists probed color as **disclosed, inert metadata** — "Milestone
3 ships no deinterlacer and no colour management"
(`src/common/editor/video-source-characteristics.ts:63-87`;
docs/milestone-3b-probed-source-characteristics.md:93-94) — and no LUT,
grading, scopes, tracking, stabilization, denoise, or optical-flow code
exists. Milestone 4 introduces them under the Web Enhanced contract
(roadmap.md:141): every GPU-accelerated grade has a deterministic
software/proxy fallback producing the same committed state, and
unsupported operations fall back visibly — the compositor's only
failure signal today is a `-1` return
(`src/common/editor/ui/video-preview-compositor.js:416-417`), which the
foundation parity harness converts into an observable
`silentlyOmittedEffects` counter. Color management scope (working
space, display transform) is a named 4B design decision closed in its
slice doc before any grade ships; disclosed-but-unmanaged color must
not silently become managed for old projects.

### Reviewed web-effect packages

The security matrix already owns this surface with
`ownerMilestone: "4"`: `reviewed-web-effect-packages` is planned and
surface-disabled — "pure WebAssembly instantiated in a dedicated worker
through a minimal allowlisted host ABI. Arbitrary third-party
JavaScript must not be imported into the application origin"
(docs/production-threat-model.md:1006;
config/production-security-matrix.json:8424-8471). The roadmap phrase
"WebAssembly/AudioWorklet effect packages" (roadmap.md:529-530) and the
current first-party pattern (WASM compiled per context and instantiated
*inside* AudioWorklets, `src/common/editor/engine/effect-worklets.ts:147-186`)
are in tension with the dedicated-worker mandate. Resolution stance:
the package format is pure WASM against a minimal ABI with hash
pinning, resource declarations, and revocation; no third-party
JavaScript ever enters the origin; whether a reviewed module may
additionally be hosted by the first-party worklet host for realtime
monitoring — versus dedicated-worker-only offline render — is the
packet's named design decision, closed in the same change that revises
the threat model and satisfies the recorded acceptance bar ("Malformed
ABI, forbidden import, timeout, oversized output, hash mismatch, and
revocation tests pass before a package loader is exposed",
config/production-security-matrix.json:8467). Any new package
dependency also lands licensing-matrix rows (the `web-effect-packages`
distribution gate, config/production-licensing-matrix.json:321-325).

### Rejected alternatives (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| Reusing envelope arrays as automation lanes | Linear-only, uncapped, whole-array-rewrite commands, no target addressing; lanes need modes, caps, and stable parameter ids. |
| Normalized-[0,1] keyframe positions | Slide under every trim; the recorded StaffPad lesson (docs/milestone-3-plan.md:247-249). |
| Extending labels or timeline annotations into captions | Both types are explicitly fenced against caption semantics (docs/milestone-3a-work-packets.md:97-101); styling/speakers/regions would bloat fenced wire contracts. |
| Gating milestone-4 surfaces on `enabledCommands` | Dead configuration: the array in both product profiles has zero consumers; menu gating keys on capability booleans (`src/common/editor/ui/application-menu-product-filter.js:3-34`). Give it a consumer deliberately or leave it alone. |
| Freeze via the milestone-2 rendered-fallback roles | Read-side substitutions without authoring, refresh, or revert; the compatibility policy forbids hiding freeze behind them (docs/project-compatibility.md:2186-2190). |
| Persisting derived sample caches for lanes | The standing milestone-3 rule: derived caches are never persisted; validators reject, never repair (docs/milestone-3-plan.md:113-119). |
| Third-party JavaScript effect plug-ins in the origin | Forbidden by the threat model's package control (docs/production-threat-model.md:1006). |

## Schema revisions

Serialized product-wide, one in flight, atomic with validators,
commands, and fixtures, under the pre-release policy (no migrations)
until the first shipped release — unchanged from milestone 3
(docs/milestone-3b-work-packets.md:25-28, 44-48). The bounded sequence is V19
for the reserved 4B-1 transform boundary, selected V20 for 4B-2 keyframes, V21
for the Soundscaper automation-lane/mixer-graph/PDC foundation, dormant V22 for
4B-3 transitions, selected Soundscaper V23 for mastering sequences, and dormant
V24 for the visual-model prerequisites; later revisions are assigned only at
their own pickup. Every
revision walks the full registration path — command discriminants and
one domain registry (`src/common/editor/commands/protocol.ts:9-12`,
`commands/registry.ts:80-137`), capability id and both product profiles
initially unavailable
(`src/common/editor/project-feature-capabilities.ts:3-31`), owned
requirement predicate
(`src/common/editor/project-owned-feature-requirements.ts:16-27, 64-96`),
compatibility register rule, capability-policy gate
(`src/common/editor/controller/command-capability-policy.ts:20-104`),
factory/normalizer coverage with the idempotence/survival pair, and the
single mutation path
(`src/common/editor/controller/project-mutation-service.ts:140-161`) —
per the standing duties (roadmap.md:844-846).

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| 4.0 | Serialized (one work stream) | Interpolation vocabulary, parameter address space and scheduled-parameter registry, production parity harness |
| 4A | Parallel track | Soundscaper production: automation lanes and modes, mixer graph, per-path PDC, freeze, restoration/metering, reviewed effect packages |
| 4B | Parallel track | Framescaper finishing: transforms/keyframes, transitions, new kinds and inspector, color/motion, styled captions, Framescaper audio finishing |

**Implementation status (2026-08-22):** shared phase 4.0 is implemented and
its hosted correctness acceptance is green. Soundscaper M4 production is
formally qualified; M4B-2 formal qualification remains `pending-external`, and
milestone 3 remains recorded **In progress** with its
manual/external evidence unchanged. The project owner explicitly cleared the
Framescaper implementation sequencing gate: the 4B-1 implementation candidate
is complete apart from manual/end-to-end qualification, and selected V20
4B-2 is **In progress** under the
[pickup contract](milestone-4b-framescaper-finishing.md), with manual and
external release evidence still open. The owner also explicitly cleared
Soundscaper 4A sequencing. Its V21 foundation is retained by selected V23 and
is **Implemented (provisional)**
under the [4A pickup contract](milestone-4a-soundscaper-production.md), and the
maintained Soundscaper App/runtime/storage route is selected. Packets 4A-1
through 4A-6 are locally implemented and 4A-7 local automated acceptance is
green. The fixed-GPU packaged M4 row is closed; the remaining hosted, manual,
M4B-2 formal, and release rows stay open, so neither track is complete and the
overall milestone-4 exit gate remains open.

## Work packets

The 4.0 packets are decomposed here. The complete 4A decomposition and exact
V21 automation/mixer/PDC/freeze contract are maintained in
[`docs/milestone-4a-soundscaper-production.md`](milestone-4a-soundscaper-production.md).
The complete 4B decomposition and detailed 4B contracts are maintained in
[`docs/milestone-4b-framescaper-finishing.md`](milestone-4b-framescaper-finishing.md),
each written at pickup before feature publication
(docs/milestone-3-plan.md:467-470).

### WP-4.0.0 — Interpolation vocabulary (schema-neutral)

- **Status:** implemented.
- **Outcome:** the shared segment evaluator (hold, linear, eased,
  Bézier) beside the shared time module, with closed-form evaluation,
  documented monotonicity/inversion rules, clip-relative anchoring and
  clamping, and property tests; adapters proving the existing envelope
  and breakpoint evaluators are expressible as vocabulary subsets
  without behavior change.
- **Invariants:** exact rational anchors with single named-policy
  rounding; no normalized positions in storage; no change to any
  existing persisted wire value.
- **Acceptance:** property tests for continuity, monotone-segment
  inversion, and tie cases at 44.1 kHz × 24 fps; existing envelope and
  warp suites green on the adapters.
- **Non-goals:** no schema change, no commands, no UI.
- **Stop condition:** stop if any existing evaluator's behavior would
  change — the vocabulary extends, it does not repair.

### WP-4.0.1 — Parameter address space (schema-neutral)

- **Status:** implemented. The first-party worklet packet contract is a
  producer-only foundation until the named 4A consumer revision lands; no
  current worklet is falsely registered as a consumer.
- **Outcome:** parameter descriptors with the id-stability contract
  over strips and effect instances; the scheduled-parameter registry
  generalizing `ProjectGainParams` to pan, mute, send level, and effect
  parameters with per-target latency offsets; the write-gesture
  adapter over the adopt-live-then-commit pattern.
- **Invariants:** descriptor ranges derive from the existing effect
  definitions (`src/common/editor/effects.js:57-100`), never a second
  table; scheduling changes are behavior-preserving while no lane
  exists.
- **Acceptance:** id stability across reorder/reload fixtures; the
  audio engine suites pass unchanged with the registry active.
- **Non-goals:** no schema change; no persisted lanes.
- **Stop condition:** stop if any parameter cannot be given a stable
  id without a schema change — surface it as a 4A revision input, not
  a workaround.

### WP-4.0.2 — Production parity harness

- **Status:** implemented; the owner-host packaged M4 production row is
  formally qualified. Hosted diagnostics remain provisional.
- **Outcome:** `m4-production-parity-v1` now pins one second of 48 kHz stereo
  Float32 input/reference vectors and exact impulse, PDC, and automation
  landmarks beside the existing calibrated 128×72 RGBA fixture. The focused
  browser workload records complete PCM, RGBA pairs, and structured
  requested/rendered/fallback-rendered/omitted effect ledgers. The collector
  independently recomputes exactly the five `m4-production-render-parity`
  thresholds and publishes only no-retry, digest-bound evidence. Its audio
  paths consume the engine-owned PDC and gain-event planners used by live and
  offline project graphs; perturbation tests prove either planner changes a
  registered metric.
- **Fallback report:** the compositor returns a frozen structured report
  instead of the old integer/`-1` sentinel. The existing contextual warning
  displays bounded omitted effect-instance IDs. The zero parity gate counts
  each unique requested active effect absent from `rendered`, including a
  visibly reported fallback, so fallback observability cannot hide missing
  production work. Renderer failure remains an independent report field, and
  effect fallback does not stop a healthy compositor's playback loop.
- **Invariants:** fixtures are deterministic and digest-pinned before any
  4A/4B feature cites them; hosted-CI runs remain correctness evidence only.
  Standalone local, hosted, and packaged diagnostics can emit only pending or
  failed evidence. Formal acceptance belongs solely to the packaged-nightly
  verifier, which pins the owner-host identity, source revision, budget digest,
  attempt/retry policy, and complete registered threshold verdicts.
- **Acceptance:** the focused Chromium/FFmpeg harness passes against today's
  features; a deliberately unsupported effect is the sole omitted ID, and
  collector tests prove one omitted or fallback-rendered effect trips the
  zero counter.
- **Non-goals:** no new product behavior beyond the fallback report.
- **Stop condition:** stop if a threshold would need loosening to pass
  on existing behavior — that is a defect to fix, not a baseline to
  move (docs/quality-budgets.md:543-550).

### 4A packets (Soundscaper track; pickup contract active)

The owning decomposition, exact V21 wire, preservation matrix, and acceptance
suite are in
[`docs/milestone-4a-soundscaper-production.md`](milestone-4a-soundscaper-production.md).

- **4A-1 — Automation lanes and modes. Status: Implemented (provisional).**
  Outcome: the lane document
  type over the vocabulary and address space, lane UI reached through
  existing track/mixer menus, read/trim/touch/latch/write modes with
  safe playback ownership and single-transaction commits. Invariants:
  per-lane caps; capture thins on commit; superseded strip envelopes
  removed in the same revision. Acceptance: deterministic replay
  vectors, mode matrices, undo/redo, registration fixtures.
  Non-goals: no tempo-map rewriting; no MIDI-shaped state. Stop: any
  lane needing dense persisted data — that is the declared external
  asset path.
- **4A-2 — Mixer graph revision. Status: Implemented (provisional).** Outcome:
  nested buses, multiple
  assignments, pre/post-fader sends, VCAs, cue mixes, output
  placeholders, explicit sidechains, channel mapping, cycle
  validation; folder single-layer rule lifted with the folder-bus
  reconciler revised. Invariants: rejection over repair; folder/bus
  authority split preserved. Acceptance: graph validation matrices,
  routing round trips, cross-product preservation. Stop: any graph
  state whose audibility resolves in two places.
- **4A-3 — Per-path PDC. Status: Implemented (provisional).** Outcome: per-path
  compensation across
  playback, monitoring, automation, sends, sidechains, render, freeze;
  every effect latency-reporting via its descriptor. Acceptance:
  `parity.pdcErrorSamples eq 0` on the harness; underrun metrics
  unchanged. Stop: any path where compensation would require persisted
  derived state.
- **4A-4 — Freeze, unfreeze, commit. Status: Implemented (provisional).**
  Outcome: reversible freeze with
  retained editable state, digest-bound freshness, explicit commit;
  rendered-fallback publication for cross-product availability where
  eligible. Invariants: no source deletion (mix-and-render remains the
  separate destructive tool); derived-source lifecycle rules apply.
  Acceptance: freeze/edit/unfreeze/commit matrices, stale-freeze
  detection, `.scape`/desktop round trips; `audio-freeze-fallback`
  rule flipped. Stop: any freeze byte entering the document.
- **4A-5 — Restoration and metering. Status: Implemented (provisional).**
  Outcome: restoration workflow surface over the existing Audacity DSP;
  phase/correlation/surround metering per strip; loudness history as bounded
  session state over the existing EBU R128
  meter (`src/common/editor/ebu-r128.js`); scalable scheduling.
  Non-goals: no export-time normalization (milestone 6). Stop: any
  meter needing document persistence.
- **4A-6 — Reviewed effect packages. Status: Implemented (provisional).**
  Outcome: the package ABI, loader, hash/revocation policy, and
  threat-model/security-matrix revision in one change, per the decision above;
  licensing-gate rows for any shipped package. The built-in, release-pinned
  Utility Gain package ships through the reviewed pure-WASM paths; external
  packages, arbitrary URLs, and user trust overrides remain fenced. Acceptance:
  the matrix's recorded
  malformed-ABI/timeout/oversize/hash/revocation suite. Stop: any
  package requiring JavaScript import or same-origin access.
- **4A-7 — Exit evidence. Status: Implemented locally (provisional).** The local
  automated 4A surface passes the parity workload and registered budgets. The
  4A hosted no-retry, packaged-runtime, manual, and reference-GPU evidence
  remains open and no unprovisioned row is relabelled.

### 4B packets (Framescaper track; pickup contract active)

The owning decomposition, exact 4B-1 wire/render contract, preservation matrix,
and acceptance suite are in
[`docs/milestone-4b-framescaper-finishing.md`](milestone-4b-framescaper-finishing.md).

- **4B-1 — Transform, crop, and compositing controls.** Outcome: the
  shared geometry/blend description persisted per clip and consumed by
  both renderers; transform/crop/opacity/blend/flip/order editing via
  inspector and menus. Invariants: preview/export parity on the
  harness; painter-order semantics preserved
  (`src/common/editor/video-timeline.js:97-107`). Stop: any
  renderer-specific persisted field.
- **4B-2 — Keyframes.** Outcome: keyframing over the vocabulary for
  the geometry description and effect parameters, with copy/paste and
  preset semantics; crop paths as the milestone-7 reframe migration
  target. Invariants: trim-invariant anchoring; bounded point counts.
  Stop: any keyframe stored normalized.
- **4B-3 — Transition objects and registry.** Outcome: explicit
  transitions behind the registry; implicit overlap crossfades
  re-expressed as the default object; audio crossfade disposition
  decided in the slice doc. Acceptance: export/preview parity on
  transition fixtures; overlap-validation rules updated coherently
  (`src/common/editor/video-timeline.js:39-93`).
- **4B-4 — Titles, stills, generators, adjustment layers, inspector.**
  Outcome: the new source/clip kinds with import where relevant
  (stills), text/shape/solid generators, adjustment layers, and the
  selection-aware inspector. Invariants: each kind registers
  atomically; no kind smuggled through extension fields. Stop: a kind
  that cannot express validation, clone, clipboard, and `.scape`
  behavior.
- **4B-5 — Color and motion (Web Enhanced).** Outcome: LUTs, grading,
  scopes; tracking, stabilization, denoise, optical flow — each with a
  deterministic software/proxy fallback and visible degradation; the
  color-management scope decision closed in the slice doc against the
  inert probed color metadata. Stop: any grade whose fallback diverges
  from its accelerated result beyond the parity thresholds.
- **4B-6 — Styled caption tracks.** Outcome: the caption document type
  (regions, speakers, styling, word-timing carriage), editing surface,
  safe-area preview, sidecar interchange. Non-goals: no burn-in or mux
  (milestone 6); no transcript generation (milestone 7 consumes this
  schema). Stop: caption data that cannot round-trip sidecar formats
  losslessly-or-reported.
- **4B-7 — Framescaper audio finishing.** Outcome: expose the existing
  shared audio model surfaces Framescaper lacks, automation lane
  parity, the deterministic dialogue-cleanup chain (complete without
  AI — the milestone-7 boundary, docs/milestone-7-plan.md:496-497),
  loudness targets, and mix export. Invariants: capability flips only
  after full native workflows pass. Stop: any Soundscaper-only module
  gaining a Framescaper fork instead of a shared surface.
- **4B-8 — Exit evidence.** The 4B surface against the golden-frame
  workload; the roadmap exit-gate sentence "Framescaper can edit, mix,
  caption, grade, and export a complete imported-media programme
  without Soundscaper" (roadmap.md:559-560) witnessed end-to-end.

## Quality-budget and evidence duties

- The workload and fixture are registered: `m4-production-render-parity`
  with `parity.audioMaximumAbsoluteSampleError lte 1e-6`,
  `parity.pdcErrorSamples eq 0`, `parity.videoMinimumSsim gte 0.98`,
  `parity.videoMaximumChannelMae lte 6/255`,
  `parity.silentlyOmittedEffects eq 0`
  (config/quality-budgets.json:992-1006), against the hosted container and the
  active `owner-qualified-windows-x64-rtx3090-01` profile. Local and hosted runs
  are development evidence; only the exact owner-host packaged verifier can
  publish formal acceptance, and it never admits a software renderer.
- Bundle gates are untouched: the 500,000-byte chunk and 25 MiB Pages
  ceilings stay independent (docs/quality-budgets.md:33-35); new UI
  keeps the canonical check green; file-size ratchets and command
  registry pins update in the feature commits.

## Two-agent coordination rules

Identical to milestone 3 (docs/milestone-3-plan.md:634-651): 4.0 is one
work stream; schema revisions serialized product-wide; spine files
(command protocol and registries, validators, capability and
compatibility registers, application menus, i18n catalog,
maintainability allowlist, and now the parameter descriptor table and
transition registry) one-owner-per-edit, rebase before push; leaf
ownership product-disjoint — the mixer/automation/engine stack to 4A,
the video domain/compositor/export stack to 4B; shared fate on repo
gates.

## Known constraints this plan absorbs

- **Milestone 3 and its manual/external evidence remain open** — see
  "Prerequisites". The explicit 4B implementation clearance changes sequencing
  authority only; every packet still re-grounds and names its dependency, and
  no unobserved qualification is promoted.
- **The node ceiling and history deep clones bound automation scale**;
  the per-lane caps and thinning rules above are the response, and the
  external-asset escape hatch is declared, not improvised.
- **The compositor has no fallback signal** beyond `-1`
  (`src/common/editor/ui/video-preview-compositor.js:416-417`);
  WP-4.0.2 fixes observability before features rely on it.
- **`enabledCommands` is dead configuration** with no consumer — not a
  gating mechanism.
- **The maintainability ceilings** (600-line new-file limit, chunk
  budget) mean `project-graph.ts` and `effect-rack.ts` grow by
  extraction, not appension.
- **The single foreground task coordinator**
  (`src/common/editor/controller/task-progress.ts`) is not a queue;
  long renders in 4A/4B stay single-task and abortable, and queueing
  remains milestone 5/6 scope.

## Watch items (not gates yet)

- A fresh owner-host nightly run for the new M4B-2 formal profile and budget
  digest; its older keyed diagnostic remains historical correctness evidence.
- The milestone-7 packets that name m4 upgrade targets (7A-1 captions,
  7B-3 crops): if milestone 7 runs first, their proposal-side data
  migrates onto the m4 schemas when these land — coordination is a
  pickup note in the affected slice docs.
- WebGPU maturity for the color/motion tier; the Web Enhanced fallback
  contract makes it non-blocking.

## Non-goals and fences

- No MIDI schema, ports, flags, dependencies, or UI; no Framescaper
  capture surface of any kind (roadmap.md:109-122).
- No export preset system, no caption burn-in or muxing, no delivery
  queues (milestone 6); no native helpers or hardware encode
  (milestone 5).
- No cloud or hosted processing of any kind.
- Every new surface is menu-reached and off by default (AGENTS.md:8-11).
- Deterministic non-AI editing remains complete without milestone 7;
  nothing in milestone 4 depends on assistance output.
