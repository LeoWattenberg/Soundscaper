# Milestones 1–4 implementation, activation, and verification plan

> Canonical execution plan for completing and activating the remaining
> Milestone 1–4 work. Grounded against the repository on 2026-08-23. The
> [roadmap](../roadmap.md) continues to own milestone status, while the
> compatibility, capability, quality, and security registers own production
> claims and evidence.

## Intent and boundaries

This plan supersedes the earlier Milestone 4/V26 direction. It finishes every
remaining implementation and activation item owned by Milestones 1–4, runs the
automated gates, and then performs a guided local manual sign-off.

The following boundaries are fixed:

- Milestone 5 native-media and OpenFX execution is excluded. Dormant V25/V26
  state remains unavailable and must not be selected indirectly.
- A capability is activated only in the product and execution route that owns
  a maintained consumer. Product-isolation flags are not broadened to make a
  milestone appear complete.
- Every new user workflow is lazy and reached through an existing menu or
  submenu. This work adds no always-visible toolbar, panel, rail, badge, or
  inline control.
- Implementation/activation and external qualification are separate states.
  Local implementation may be complete while formal milestone status remains
  open for Windows, Safari, fixed-GPU, signing, or owner-host evidence.
- Policy registers are updated only after their implementation and automated
  gates pass. Derived policy narratives are regenerated from their registers,
  and digest-pinned evidence is repinned rather than edited by hand.

## Execution order

Work proceeds in dependency order:

1. Correct the Milestone 1 benchmark and qualification contract.
2. Complete Milestone 2 lease safety and its two-product qualification path.
3. Activate Milestone 3 retime, then resolve and activate the proxy lifecycle.
4. Forward-port the maintained V20 work into the Milestone 4 lineage and select
   the complete V27 Framescaper route.
5. Run all automated gates, activate truthful capability/register rows, and
   perform the guided local sign-off.

Feature slices follow test-driven development. A route or capability stays
unavailable until its focused tests and owning integration workflow pass.

## Milestone 1 — qualification plumbing

Milestone 1 has no remaining product, schema, capability, or UI implementation.
Its local work is to make the video-preview benchmark and verifier conform to
the documented measurement contract:

- Run one unmeasured warmup followed by five measured trials, each in a fresh
  browser context.
- Force three garbage collections before each heap snapshot.
- Retain the raw timing and heap samples alongside aggregates.
- Remove per-frame `gl.finish()` from the measured workload so the benchmark
  does not serialize normal GPU pipelining.
- Replace the reduced `local-browser-correctness` identity with the full
  packaged-runtime renderer, browser, driver, device, power, and display
  identity required by the quality policy.
- Emit the fixture SHA-256 in the result and make the qualifier verify it
  against the admitted fixture.

Focused tests must first fail for each missing contract field or invalid trial
shape, then cover accepted results, malformed samples, insufficient trials,
incorrect GC counts, incomplete environment identity, and fixture-digest
drift. After local gates pass, rerun the owner RTX 3090 workload. Safari,
supported OS/architecture claims, the M3 long-form workload, and M4B2 evidence
remain qualification-open until fresh external artifacts exist.

## Milestone 2 — desktop writer leases

Soundscaper retains desktop library V10. Framescaper moves from immutable V12
to a new exact library generation with this identity:

| Contract | Selected value |
| --- | --- |
| Project schema | V20 |
| Desktop library | V17 |
| SQLite `user_version` | 19 |
| Storage scope | `v17` |

V17 owns process-lifetime writer leases, persistent monotonic fencing tokens,
lease renewal, publication-journal checkpoints, crash recovery, admission
fencing, draining, and exact release. A writer that loses ownership can never
publish, including after renderer loss or a delayed commit.

The first V17 startup performs an idempotent, crash-resumable copy-forward
import from the V12 scope. It validates source rows and bodies before
publication, records durable progress in V17, and can resume without duplicate
projects or claims. V12 is never altered, deleted, or opened for writing. This
is a desktop-library import between exact scopes, not a retained project-schema
migration.

The packaged smoke bridge and lease-matrix runner become product-aware through
explicit Soundscaper V10 and Framescaper V17 document/runtime adapters. The
accepted matrix contains:

- Seven product-specific workflows for Soundscaper and the same seven for
  Framescaper: same-project simultaneous open, writer transfer, stale takeover,
  conflicting commit, renderer loss, orderly restart, and crash restart.
- One paired cross-product workflow proving that both products can operate
  simultaneously in physically separate scopes. It does not introduce a
  shared catalog or re-admit a retired shared generation.

CI builds and exercises both products on Windows x64 and Linux x64, retains
bounded no-retry artifacts, and verifies monotonic fencing plus zero losing
publication. The frozen M2 closure does not absorb unrelated composite-memory,
parser, portability, generic native-feature, or durability policy debt.

## Milestone 3 — V20 retime and proxy activation

Project schema V20 remains selected. Its existing `retimeMap` and
`proxyAttachment` wire contracts do not require a schema bump unless their
persisted shape changes.

### Exact web-core retime

Add menu-driven set, reset, constant-rate, ramp, reverse, and freeze commands
with one-step history. The maintained source/program preview and browser export
paths consume the same exact ordinal authority for CFR, integer, NTSC, and VFR
sources, including nested compositions and random seeks. Preview and export
must resolve identical source ordinals.

The functional `videoRetime` capability becomes available only where this
web-core consumer is registered. Electron may use its embedded web-core route;
native execution and native qualification remain unavailable Milestone 5 work.
Linked audio is not warped, and `audioWarp` stays false.

Acceptance covers forward, reverse, freeze, constant-rate and ramp mappings;
composition boundaries; clipboard and `.scape` preservation; undo/redo;
desktop round trips; cross-product preservation; menu keyboard operation; and
screen-reader and high-contrast behavior.

### Proxy lifecycle

After retime passes, complete the V20-routed proxy lifecycle:

- Generate, attach existing, detach, regenerate/relink, and select
  Original/Proxy/Auto from an existing Project Bin menu or submenu.
- Report bounded progress and cancellation, prove a replacement before atomic
  pointer swap, and clean claims/bodies without exposing partial state.
- Bind maintained source/program playback, seek, and scrub consumers to the
  selected proxy policy.
- Preserve and reattest a proxy when an original relinks with identical
  identity; atomically invalidate and purge it when the original changed.
- Permit editing and preview from a valid proxy while the original is offline,
  but visibly refuse delivery until the original is available and authenticated.

Proxy selection occurs in the source domain, then the occurrence retime map is
applied. A retimed occurrence therefore does not silently detach an otherwise
valid proxy, and final delivery remains original-authoritative.

## Milestone 4 — complete production route

Soundscaper V23 is implementation-complete for M4. It receives regression and
manual verification, not new feature scope.

Framescaper V27 is created from the V24/M4 lineage after the maintained V20
retime and proxy work is forward-ported. It does not inherit V25/V26
native-media or OpenFX state. V25/V26 documents are recognized as known dormant
formats and retained as opaque read-only custody rather than migrated or
partially interpreted.

The selected companion identities are:

| Contract | Selected value |
| --- | --- |
| Project schema | V27 |
| Desktop library | V18 |
| SQLite `user_version` | 20 |
| Storage scope | `v18` |
| Session clipboard | V11 |
| Unified exact render plan | V13 |

V18 inherits the V17 lease, fence, journal, recovery, and import invariants.
V27 adds exact persisted state for sequence color contexts, source color
interpretations, visual presentations, processor stacks, motion analyses,
richer visual presets, explicit caption tracks, automation lanes, and mixer
state. V20, V22, and V24 documents use explicit opt-in reimport adapters; older
media is labelled `legacy-unmanaged-encoded` rather than silently assigned a
managed history.

### Transitions and visual finishing

- Activate dissolve transitions through one canonical resolver shared by
  preview and export.
- Provide menu-reached workflows for stills, titles, text, shapes, solids,
  adjustment layers, authored presets with fresh IDs, masks/mattes, and freeze
  frames.
- Make selection inspectors lazy and opt-in. Preview, thumbnails, Project Bin,
  and export consume the same admitted presentation state.

### Color and motion

- Use managed SDR Rec.709 with a linear Rec.709/D65 working space and
  deterministic sRGB/Rec.709 output. Compositing uses straight authored alpha
  and premultiplied linear working pixels.
- Interpret unknown stills as sRGB full-range and unknown video as BT.709
  limited-range. Show the assumption in an opt-in inspector and allow an
  explicit override.
- Preserve recognized HDR/wide-gamut identity, but refuse managed-SDR grading
  or export when no admitted transform exists; do not silently tone-map.
- Support exposure, contrast/pivot, lift/gamma/gain, saturation, and bounded
  `.cube` LUTs.
- Implement deterministic Shi–Tomasi tracking, pyramidal Lucas–Kanade flow,
  deterministic RANSAC, similarity stabilization, and bounded spatial or
  motion-compensated temporal denoise. WebGL2 acceleration must match a CPU
  parity fallback.
- Use optical flow only as a motion provider for stabilization and denoise. It
  is never a retime frame-interpolation mode.

Accepted motion analyses are external digest-bound assets; raw decoded frames,
flow fields, and scopes remain transient. Final export recomputes or visibly
refuses stale analysis.

### Captions and audio finishing

- Add explicit caption tracks with exact sample-frame cue timing, styles,
  regions, speakers, and optional word spans.
- Import and export SRT, WebVTT, and a bounded IMSC 1.1 subset. XML parsing
  rejects DTDs and external content, and lossy conversions return structured
  loss reports. Caption burn-in and mux remain outside Milestones 1–4.
- Reuse the Soundscaper V21 automation, mixer, latency-compensation, and
  loudness infrastructure through Framescaper-owned adapters and menu routes.
- Provide the dialogue chain highpass → gate → EQ → compressor → limiter, with
  optional profiled noise reduction. Preserve the existing EBU, ATSC, and
  streaming loudness targets and choose no default target.
- Do not activate Framescaper recording, transcripts, macros, track freeze, or
  other Soundscaper-only features.

The M4 complete-program fixture must exercise import, editorial operations,
retime, proxy selection, mix, captions, grade, and deterministic export with
zero unexplained omissions.

## Automated verification and activation

Each slice runs its focused strict-TypeScript tests before the broader gate.
Helper/domain changes run `npm test`; Vite or UI changes run `npm run build`;
interactive workflows run the focused browser specs and then
`npm run test:browser`; the final non-browser gate is `npm run check`.

Activation is atomic with the owning implementation: product/project profiles,
commands, menus, capability inventory, compatibility rules, owned-state
predicates, preservation fixtures, and evidence links change together only
after the route passes. Generated policy prose is synchronized from its
register, and edits covered by `config/ffmpeg-runtime-manifest.json` are
repinned with the repository script.

## Guided local sign-off

After every automated gate passes and the routes are activated, perform one
guided manual pass over Soundscaper and Framescaper in the browser and over
both current Linux desktop packages. Record the commit/build, product, runtime,
OS/browser, result, notes, and issue link for every row.

| Area | Required check | Result / notes / issue |
| --- | --- | --- |
| Reachability | Every activated workflow is discoverable through an existing menu and opens lazily. | Pending |
| Project lifecycle | Create/open, import, edit, undo/redo, save, restart, and reopen preserve exact state. | Pending |
| M3 retime | Forward/reverse/freeze/ramp preview matches browser export and linked audio remains unwarped. | Pending |
| M3 proxies | Generate/attach/select/relink/offline preview works; delivery refuses without the original. | Pending |
| M4 visuals | Transitions, generators, adjustment layers, presets, masks, and freeze preview/export consistently. | Pending |
| M4 color | Source assumptions are disclosed/overrideable and deterministic Rec.709 output matches preview. | Pending |
| M4 motion | Tracking, stabilization, denoise, cancellation, stale-analysis refusal, and CPU fallback behave visibly. | Pending |
| M4 captions | SRT/WebVTT/IMSC subset import, editing, export, and loss reports are usable and deterministic. | Pending |
| M4 audio | Automation, dialogue processing, latency compensation, loudness targets, and export operate in Framescaper. | Pending |
| Accessibility | Menus/dialogs support keyboard use, focus restoration, screen readers, and high contrast. | Pending |
| Isolation | Soundscaper-only and Framescaper-only capabilities stay unavailable in the other product. | Pending |
| Dormant routes | V25/V26 and M5 native/OpenFX workflows remain unavailable; opaque custody is non-destructive. | Pending |

Any failed row creates a tracked defect and is rerun after the fix. Local
implementation and activation are complete only when automated gates and this
guided pass are green. Formal milestone qualification remains open wherever a
named external artifact is still missing; no local substitute is recorded as
that evidence.
