# Editor performance

Loading, timeline rendering, audio processing, and project responsiveness have
separate scaling constraints. The paths below use immutable document indexes,
bounded preparation, shared channel calculations, and deferred module ownership
to keep work proportional to the affected data. The October 2, 2026 measurements
compare these behaviors with baseline `8db9a142f`; no P0 performance problem was
found in the reviewed paths.

P1 denotes a cost that grows enough with document size, edit backlog, or channel
count to stall an affected workflow. P2 denotes avoidable startup latency or
allocation with a narrower effect. These priorities describe the demonstrated
workloads; they do not claim every ordinary project experiences the same delay.

| Priority | Current behavior | Evidence and focused regression |
| --- | --- | --- |
| P1 | Index immutable timeline clip windows | 100,000 clips, 500 queries: **554.9 → 3.65 ms**, with **78.3 ms** initial index construction. Clip order and long intersections remain correct; a 10,000-clip test reads fewer than 100 geometry properties across ten scroll queries. [Regression](../../tests/audio-editor-timeline-viewport-index.test.ts). |
| P1 | Prepare video overlap presentation once per snapshot | 5,000 clips, 20 views: **984.12 ms → 12.81 ms preparation + 0.274 ms queries** in the initial paired measurement. Repeated scrolling reads no authored clip geometry. Dense image/previews use bounded preparation; see the follow-up measurement below. [Regression](../../tests/audio-editor-video-overlap-presentation.test.ts). |
| P1 | Reuse clip, track, source, and snap indexes during drag | Mounted drag tests reject whole-project clip searches and repeated track membership scans. An indexed microfade move performs **zero project clip-array reads**, versus two full reads before; selection, grouping, snap ambiguity, and linked A/V behavior remain covered. [Drag regression](../../tests/audio-editor-clip-move-pointer-preview.test.tsx), [snap regression](../../tests/audio-editor-boundary-snap.test.ts). |
| P2 | Retain document duration across viewport changes | A 1,000-clip document previously reread all clip durations on each scroll. Scroll and recording-preview updates now perform **zero document clip reads**, while recording extension and document replacement still update duration. [Regression](../../tests/audio-editor-timeline-viewport-duration.test.tsx). |
| P1 | Share sinc kernels across resampled channels | One second at 48 kHz → 44.1 kHz: mono **72.5 → 55.1 ms**, stereo **135.7 → 103.3 ms**, eight channels **559.2 → 74.3 ms**. Eight-channel kernel trigonometry falls from eight evaluations to one per output frame; emitted PCM is exact. [Regression](../../tests/audio-editor-streaming-resample-kernel.test.ts). |
| P1 | Build frequency peak pyramids from finest extrema | 480,000 stereo frames with real PFFFT analysis: **644.2 → 188.6 ms**. PCM is scanned at the finest band level; coarser levels aggregate extrema. Complete extrema and centroid output remain exact, and the new helper retains deferred ownership. [Numerical regression](../../tests/audio-editor-frequency-waveform-band-peaks.test.ts), [ownership regression](../../tests/audio-editor-frequency-waveform-band-owner.test.ts). |
| P2 | Borrow live/offline resampler input windows | Each 8,192-frame stereo fixture avoids **65,536 bytes** of redundant input slicing. At 48 kHz stereo this removes **384,000 copied bytes per input second**. Retained resampler history and transferable playback packets still own their buffers. [Regression](../../tests/audio-editor-resample-borrowed-input.test.ts). |
| P1 | Calculate linked compressor/limiter gain once per frame | Eight channels, ten seconds: compressor **37.2 → 25.8 ms**, limiter **36.1 → 25.1 ms**. A 128-frame block reduces gain exponentials from **1,024 to 128**. PCM and accumulated telemetry remain exact. [Regression](../../tests/audio-editor-live-dynamics-gain-work.test.ts). |
| P1 | Maintain incremental session retention roots | 201 documents × 2,000 clips, 30 edits/root-query rounds: **3,952.7 → 59.9 ms**. After initial 200-document admission, an edit scans only its added root rather than rescanning 200,001 retained IDs. Dropped roots, duplicate references, undo/redo, projection failures, and detached public sets are covered. [Regression](../../tests/audio-editor-session-retention-index.test.ts). |
| P1 | Prune persisted revisions by scalar key | Canonical pruning changes **one revision-body `getAll` to zero revision-body reads**, using an index key cursor. Legacy keys still load their records; the current revision survives even when retained history has newer revisions. [Node regression](../../tests/audio-editor-project-revision-pruning-performance.test.ts), [real-browser autosave regression](../../tests/browser/audio-editor-storage-publication.spec.js). |
| P2 | Share privately owned memory publication snapshots | Memory compare-and-swap publication drops **five whole-project clones to three**. Incoming and returned nested values remain detached; current and revision stores share only an internally owned snapshot. Atomic rollback remains tested. [Regression](../../tests/audio-editor-project-memory-publication-performance.test.ts). |
| P1 | Coalesce superseded queued autosaves | 100 timer callbacks behind an in-flight save reduce **101 clones, writes, and maintenance passes to two each**: the in-flight revision and newest queued revision. Explicit flushes, project switches, cancellation, newest-save failure, dirty state, cleanup, and retry remain covered. [Regression](../../tests/audio-editor-autosave-queue-performance.test.ts). |
| P1 | Reuse resolved Project Bin command coordinates | 1,000 musical bin clips × 1,000 tempo events: **640.0 → 4.32 ms** in one paired sample. The deterministic fixture reduces Project Bin clip-array reads from **2,000 to 1,000**, retaining bin validation and source aliases. [Regression](../../tests/audio-editor-command-project-bin-performance.test.ts). |
| P1 | Index paste destinations and collision lookups | A 2,000-clip paste reduces ID-property reads from **8,004,001 to 8,004**. One snapshot index serves planning and collision rewriting; first-match semantics, missing references, malformed sources, and duplicate track references remain covered. [Regression](../../tests/audio-editor-paste-existing-clip-index.test.ts). |
| P1 | Compare project keys in linear time | Detached 20,000-clip snapshots: **180.3 → 25.3 ms**. A 5,000-clip fixture reduces large key-list searches from **5,001 to zero**. Sparse arrays, ordering, symbols, descriptors, cycles, binary values, dates, and accessor safety remain covered. [Regression](../../tests/audio-editor-project-snapshot-equality.test.ts). |
| P2 | Start independent startup settings reads together | **17 serial storage reads become one concurrent batch**. Per-setting fallback values, persisted false/null, fatal versus recoverable failures, and disposal semantics remain preserved. The production store signature is covered so missing settings retain their true/false/numeric defaults. [Regression](../../tests/audio-editor-project-bootstrap-concurrency.test.ts). |
| P2 | Keep menu-only UI and import helpers in deferred owners | Ownership regressions cover optional panels/dialogs and import preparation helpers. First-launch network checks reject eager optional execution, export, surfaces, and import-admission requests. The complete editor graph drops from **73 to 72 requests**, saving **79,360 raw bytes and 22,200 Brotli bytes**. [Ownership regression](../../tests/audio-editor-deferred-startup-ownership.test.ts), [browser regression](../../tests/browser/editor-startup-progress.spec.js). |

Overlap preparation caches at most `max(128, 2 × clip count)` pair records before
switching to viewport-only pair generation. This bound matters for images and invalid drag
previews, where arbitrary overlap density is possible. For 500 offscreen images,
unbounded preparation retains 124,750 pair records although the viewport has no
overlays. Bounded preparation retains zero pairs, reducing measured heap growth
from **53,251,144 to 80,648 bytes** after explicit garbage collection and
preparation from **92.21 to 0.728 ms**. All invalid clip IDs and visible pairs
remain represented. The sparse path remains indexed: a repeat with 5,000 video
clips measured **10.34 ms preparation + 0.101 ms for 20 queries**.

## Measurement and reproduction

Measurements used Node.js **26.5.0** and npm **12.0.1** on the same local host.
Sinc, frequency analysis, dynamics, snapshot equality, and the dense-overlap
follow-up use one warm-up and the median of five runs, with fixture construction
outside the timed interval. Timeline, retention, and Project Bin numbers are
indicative paired microbenchmarks; the bin measurement is a single sample.
Numbers from different workloads or runs should not be added together.

The committed regressions enforce numerical/behavioral parity and operation
counts, not wall-clock thresholds. Reproduce those counts using the linked test
fixtures, for example from the repository root:

```sh
node --import tsx --import ./scripts/node-style-asset-loader.mjs --test tests/audio-editor-timeline-viewport-index.test.ts tests/audio-editor-video-overlap-presentation.test.ts
node --import tsx --import ./scripts/node-style-asset-loader.mjs --test tests/audio-editor-streaming-resample-kernel.test.ts tests/audio-editor-frequency-waveform-band-peaks.test.ts tests/audio-editor-live-dynamics-gain-work.test.ts
```

To repeat timings, run baseline `8db9a142f` and the final branch in isolated
worktrees with identical fixture geometry, channel counts, chunk sizes, warm-up,
and repetition counts. Include index preparation separately from repeated
queries; use `--expose-gc` and explicit collection for retained-heap comparisons.
These are local algorithm measurements, not field latency or guaranteed speedup
on every CPU, browser, GPU, or project. Browser startup checks use local production
previews and do not establish production network or cache behavior.

Production graph measurements include the complete implementation and its new
indexes; they are read from each build's `.startup-graph-report.json`:

| Graph | Baseline requests → current | Raw bytes | Brotli bytes |
| --- | --- | --- | --- |
| Initial page | 6 → 6 | 253,651 → 253,658 | 68,965 → 68,883 |
| Soundscaper editor | 73 → 72 | 6,348,187 → 6,268,827 | 1,544,358 → 1,522,158 |

The editor graph saves approximately **1.25% raw** and **1.44% Brotli** bytes.
The largest production JavaScript chunk remains **489,766 bytes**, below the
500,000-byte ceiling. No source, chunk, startup, or coverage ceiling was raised.

A local cold-start sample used headless Chromium, five alternating fresh
contexts per build, disabled browser caching, a 1,365 × 768 viewport, and 4× CPU
throttling. The editor-ready marker includes project initialization; mounting
the React editor is an earlier event. Medians were:

| Observation | Baseline | Current |
| --- | --- | --- |
| First contentful paint | 447.8 ms | 425.2 ms |
| Editor mounted | 1,363.0 ms | 1,340.4 ms |
| Project ready | 3,140.9 ms | 2,971.5 ms |
| Resource requests through ready | 89 | 88 |
| Resource transfer bytes through ready | 2,060,529 | 2,034,770 |
| Cumulative layout shift | 0.000414 | 0.000421 |

An earlier sample had both builds ready near 2.3 seconds. Shared-host variation
is larger than the small startup difference, so these samples establish no
reliable wall-clock startup speedup. The removed request and byte savings are
consistent; the large algorithm gains above concern their stated workloads.

## Correctness and guardrails

Indexes belong to controller-owned immutable snapshots and invalidate when the
document is replaced. Arbitrary mutable callers retain uncached paths. Audio
optimizations preserve PCM and telemetry, retained history owns its buffers, and
transferred packets never expose borrowed storage buffers. Autosave coalescing
preserves explicit flushes and keeps failed newest saves dirty and retryable.
Revision pruning retains the current document, accepts historical key formats,
and keeps requests within their IndexedDB transaction lifetime.

Focused regressions cover these contracts and deferred module ownership. The real
browser mixed-key pruning test exercises an actual rename/autosave and expects
the current document plus the newest 19 historical revisions.

Keep the 500,000-byte production chunk ceiling, semantic chunk groups, startup
graph budgets, coverage floors, and source-file size ratchets. New optional
features should enter through menus and load with their owning feature.

## Validation record

- Canonical **`npm run check` passed**, including complete repository lint,
  source/test and four product composition type checks, architecture and size
  checks, provenance/security/license audits, handbook checks/build, production
  build, and the complete Node suite. **21,236 tests passed, 13 skipped, zero
  failed**, including the separately isolated real desktop worker/AudioWorklet
  test. Pinned Electron, independent interchange readers/schema validators,
  and authenticated Boost headers were provisioned for this worktree. Skips
  cover opt-in reference-scale/model cases and fixture-dependent branches.
- Fresh Node-only coverage: **88.64% lines/statements, 81.43% branches, 90.06%
  functions**. CI evaluates the combined Node and Chromium floors; no floor was
  altered using an incomplete local union.
- Production chunk-size and startup graph guards passed. Running
  **`npm run check:startup-graph:tighten`** found no initial-page byte ceiling
  with further room to tighten; product ceilings remain their stable maxima.
- Focused browser runs passed **26 Chromium workflows**, the mixed-key
  revision-pruning regression in **all three engines**, **37 Firefox
  audio/import/analysis/spreadsheet workflows**, and **14 WebKit spreadsheet
  workflows**. Firefox's image/export test is capability-skipped because its
  browser lacks the required video encoder.
- Baseline validation repairs cover retained ImageDecoder frame lifetime,
  cross-engine clipboard permissions, and dialog/transport test sequencing.
  Panel-focus and guide-input races were reproduced on both baseline and current
  code: keyboard docking now waits for initial panel focus, and guide drags use
  settled clip/ruler bounds after scrolling. Focused validation passed **57
  workspace tests**, **201 guide tests**, **nine tutorial tests**, and **six
  size-warning tests** across all three engines. The repaired zoom guide also
  passed **12 current and eight baseline WebKit repeats**.
- Firefox validation uses a live 48 kHz PulseAudio null sink, with rewinds
  disabled as in [the CI setup](../../scripts/ci-firefox-pulseaudio.sh).
  [The audio-clock probe](../../scripts/ci-firefox-audio-clock.mjs) passed;
  four simultaneous probes also resumed within 39 ms. The inherited WSLg
  socket was unavailable, so it was excluded from final validation. Browser
  tests use native keyboard clipboard operations in Chromium and DOM clipboard
  events in Firefox/WebKit, whose Playwright permission maps differ.
- Full **`npm run test:browser` passed**: **2,774 passed, 160 skipped, zero
  failed** across all 2,934 planned results. Chromium passed 965 and skipped 13;
  Firefox passed 915 and skipped 63; WebKit passed 894 and skipped 84. Skips
  follow existing browser-capability, target-specific, and opt-in benchmark/soak
  gates. No retries or relaxed assertions were added.

Smaller candidates requiring further representative profiling are recorded in
[performance-candidates.md](performance-candidates.md).

A manual **Update AI assets** run is **not required**: this work changes browser,
UI, editor helpers, tests, and documentation without changing the assistance
runtime closure, source pins, recipes, archives, signing, or target inventories.
