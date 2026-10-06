# Soundscaper editing responsiveness opportunities

These 100 proposed improvements target Generate and Apply completion, timeline interaction, audio rendering, source publication and local assistance. The largest measured responsiveness problem is synchronous pink-noise generation: a two-minute signal blocks Electron's renderer for roughly nine-tenths of a second. The strongest initial changes are generator worker execution, pink-noise accumulation, scalar gain loops, selection-worker reuse and eliminating repeated snap membership scans.

The scope excludes initial editor loading and its expected lazy boundary. Electron's fresh profile used its default **Speed** preference, verified in General preferences, and completed Speed preparation before timing. The audit starts at committed revision `25d7cbdb4` on 6 October 2026; concurrent uncommitted changes in the original checkout are outside this baseline. Earlier fixes in [Editor performance](performance.md), including indexed viewport queries, live dynamics gains and autosave coalescing, remain in place and are excluded from these candidates.

All entries are **proposals**. Source evidence identifies current work and scaling costs; operation-count probes and isolated kernel prototypes strengthen selected entries. The Electron observations measure existing end-to-end behavior and do not establish the speedup of an unimplemented change. P1 denotes the first candidates to investigate for stalls or substantial throughput gains; P2 denotes narrower or workload-dependent savings; P3 needs a representative profile before implementation. The [structured register](editing-performance-opportunities.json) retains every scenario, source location, existing protection and correctness constraint; [raw measurements](editing-performance-measurements.json) retain all trials.

## Electron observations

The freshly staged production desktop renderer and compiled desktop sources ran in Electron **43.7.7**, Chromium **150.0.7871.250**, using the real preload, SQLite library, PCM storage and workers. The host was Linux x64, AMD Ryzen 9 9900X 12-Core Processor, 24 logical CPUs, with a 1280 × 900 viewport at DPR 1. Node tooling used **26.5.0** and npm **12.0.1**.

Each operation was measured three times. Timing begins in the capture phase of the actual button click and ends after the dialog closes, the success status appears, pending waveform work clears and two animation frames run. Undo restores the same input between trials. The first trial includes first-use processing engines, which Speed intentionally leaves on demand; subsequent trials are warm. Fixture construction, menu navigation and editor startup are outside the timed interval.

| Operation | Input duration | Median completion | Longest renderer task across trials | Largest frame gap |
| --- | --- | --- | --- | --- |
| Generate Tone | 30 s | 441.09 ms | 91 ms | 99.99 ms |
| Generate Noise pink | 30 s | 760.79 ms | 238 ms | 233.32 ms |
| Generate Noise pink | 120 s | 1941.47 ms | 843 ms | 849.97 ms |
| Apply Amplify | 120 s | 4755.32 ms | 61 ms | 50 ms |
| Apply Compressor | 120 s | 3113.34 ms | 62 ms | 50 ms |

The eight-clip duplicated timeline recorded median and p95 animation intervals of **16.67 ms** and **16.67 ms** during three seconds of playback, with **0** intervals above 33.4 ms. The playhead advanced from 0 to 144000 frames; playback was asserted active. Idle intervals were similarly 16.67 ms. This small workload showed no frame-rate problem, while generation caused large gaps.

This was an Electron development launch with production assets, rather than a signed packaged release. Runtime configuration and non-exercised assets were reused from existing local staging; renderer and desktop application code were rebuilt from the audited revision. AI models, plug-ins and native professional render payloads were not exercised. Xvfb and the Playwright Electron launch used software compositing, as recorded by `app.getGPUFeatureStatus()`. Animation-frame intervals measure renderer scheduling responsiveness; actual GPU presentation, large-project drag and real-model timings need their own representative runs. There was no artificial CPU throttling; shared-host and garbage-collection variation remain in the raw trials. Three samples support a local baseline, not a reliable population p95.

## Isolated work and kernel measurements

The kernel experiments import the existing implementation and make in-memory prototypes without editing application files. Each case checks every Float32 sample outside timing, then uses one warm-up and five measurements. These tests measure computation only, excluding storage, graph preparation, worker startup and React publication.

| Candidate | Fixture | Current median | Prototype median | Numerical check |
| --- | --- | --- | --- | --- |
| 34. Maintain a running pink-noise bin sum | 30 s stereo pink noise | 178.8 ms | 13.67 ms | 2,880,000 identical samples |
| 46. Use indexed sample loops instead of Float32Array.from mapping callbacks | 30 s mono gain | 117.94 ms | 2.38 ms | 1,440,000 identical samples |
| 47. Calculate destructive linked dynamics gain once per frame | 10 s eight-channel linked compressor | 50.82 ms | 34.47 ms | 3,840,000 identical samples |

The aligned little-endian PCM interleaving sketch measured a median **5.28 → 0.49 ms** per 65,536-frame, eight-channel packet after its first sample. It preserves tested non-finite and signed-zero modes, but omits production geometry/offset validation and needs an alignment/endian fallback. It is a fast-path experiment rather than a complete replacement. Tone phase wrapping showed inconsistent results across exploratory samples and was excluded from the 100 recommendations.

Deterministic probes found **10,000,000 track memberships** traversed in 100 indexed snapping queries on 100,000 loop-free clips; the ordinary edge index does not cover the loop-discovery scan. The same baseline still reads RMS 1,000 times for 1,000 columns with RMS hidden, and issues 1,999 canvas strokes for 2,000 connecting-dot samples. Those fake-canvas counters do not measure actual paint time. Snapshot probes traverse 10,000 unchanged clip leaves again after a root-only project replacement, while the already-cached unchanged project identity costs zero; two unchanged preset listings each copy all 1,000 saved presets.

## Suggested first implementation batch

| Entries | Change | Why first | Acceptance check |
| --- | --- | --- | --- |
| 31 and 34 | Worker generation and running pink-noise total | Electron's two-minute pink-noise generation produced the largest renderer stall; the arithmetic prototype is substantially cheaper. | Exact seeded PCM across block boundaries, busy-state first paint, cancel latency, Generate completion and renderer long tasks. |
| 46 and 47 | Indexed scalar gain and shared destructive dynamics gain | Measured kernel reductions with exact tested PCM; existing live dynamics optimization does not cover the destructive path. | Parameterized PCM parity plus Electron Apply completion and worker CPU. |
| 1 | Index loop-bearing snap candidates | Deterministic whole-project scan remains within a pointer path despite indexed ordinary edges. | Membership counts, coincident/loop exclusions and p95 drag gaps on a dense project. |
| 37 and 40 | Retain bounded selection workers and merge neighboring renders | Repeated Apply/macro jobs discard worker caches and may prepare multiple contexts for one target. | Stale-job/abort isolation, memory bounds, effect output parity and repeated Apply timings. |
| 64 and 68 | Move compression off foreground publication and bound generation fencing | Foreground persistence and serial ancestry scans can dominate large or evicted-source operations. | Durable reopen/crash behavior, exact-generation races, storage capacity and result-to-playable latency. |
| 61 | Bounded faster-than-realtime export | Large admitted exports currently fall back to the live audio clock. | Stateful-effect seams, latency/tail parity, programme-duration throughput and bounded RSS. |

## The 100 opportunities

Each numbered entry gives the remaining work, proposed change and a concrete measurement. Conditions in the linked register remain part of the proposal: cache only admitted immutable state, preserve source/task ownership, keep storage and memory limits, and verify audio and rendered-pixel parity where relevant. Parallelism and thread-budget proposals need contention measurements before adoption.

### Timeline and display

1. **Index looped clips for boundary snapping** (P1 candidate). [boundary-snap.ts:152](../../src/common/editor/ui/timeline/boundary-snap.ts), [boundary-snap.ts:189](../../src/common/editor/ui/timeline/boundary-snap.ts).

   Every snap query traverses every track clip ID to discover loop boundaries, including documents with no loops. Move snapping runs this scan for both edges. The existing sorted edge index only bounds the normal edge lookup. Store loop-bearing clips and track IDs in BoundarySnapIndex; query only indexed loop extents intersecting the pointer's tolerance window.

   Validate with membership iterations per pointer update, handler CPU time, p95 drag frame interval; preserve coincident-boundary and exclusion behavior.

2. **Index microfade neighbors and collision intervals** (P2 candidate). [boundary-snap.ts:211](../../src/common/editor/ui/timeline/boundary-snap.ts), [boundary-snap.ts:227](../../src/common/editor/ui/timeline/boundary-snap.ts).

   After a successful edge snap, microfadeOverlapFrames materializes every destination-track clip, filters for the one touching neighbor, then scans all clips for collisions. A dense destination track repeats this cost as a clip stays snapped while dragging. Extend the immutable snap index with per-track start/end neighbor maps and a bounded interval collision query.

   Validate with destination clip property reads and allocations per successful snapped move; p95 snapped-handler duration.

3. **Coalesce canvas invalidations across React commits** (P2 candidate). [TimelineCanvasRenderer.jsx:83](../../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx), [TimelineCanvasRenderer.jsx:202](../../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx).

   Each changed layout-effect dependency immediately calls draw(), before paint. Several visual publications or selection commits within one display frame can repeat DOM scanning and draw-key construction even where unchanged canvases skip painting. Keep a persistent dirty renderer and latest-input ref, coalesce updates once per animation frame, and retain an explicit immediate path where first-frame correctness requires it.

   Validate with renderer scans/draws per display frame and main-thread time until the next paint; check no blank initial waveform.

4. **Batch waveform geometry and palette reads before canvas writes** (P2 candidate). [TimelineCanvasRenderer.jsx:103](../../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx), [TimelineCanvasRenderer.jsx:113](../../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx), [TimelineCanvasRenderer.jsx:298](../../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx).

   The renderer reads one canvas rectangle, mutates backing dimensions and dataset/style, reads computed styles, paints, then reads the next canvas rectangle. Mixed reads and writes can trigger repeated style/layout work across clips. Collect live canvases, geometry, and theme/color palette first; then size and paint them in a write phase, caching palettes by theme/color revision.

   Validate with forced layout/style-recalculation events and duration in an Electron trace; canvas paint CPU per frame.

5. **Paint selection with cached waveform layers** (P2 candidate). [TimelineCanvasRenderer.jsx:114](../../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx), [TimelineCanvasRenderer.jsx:337](../../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx), [TimelineCanvasRenderer.jsx:390](../../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx).

   Selection pixel endpoints are part of the draw key. Every changed selection clears the complete clip and redraws all waveform columns in selected/unselected colors, although PCM geometry and envelope have not changed. Retain unselected and selected-color waveform images, and composite clipped selection regions plus body fill; invalidate these images only on geometry/audio/theme changes.

   Validate with waveform column evaluations versus selection-only drawImage calls, p95 selection frame time, bounded cache bytes.

6. **Memoize unaffected mounted audio rows with narrow inputs** (P2 candidate). [TrackListView.jsx:219](../../src/common/editor/ui/timeline/TrackListView.jsx), [TrackListView.jsx:239](../../src/common/editor/ui/timeline/TrackListView.jsx), [AudioTrackRow.jsx:29](../../src/common/editor/ui/timeline/AudioTrackRow.jsx).

   AudioTrackRow receives the full snapshot as viewModelRevision and freshly bound per-row callbacks. It is not memoized, so parent viewport, selection, or unrelated document changes still execute unchanged row render functions and their hooks. Pass stable track-specific visual revisions and callbacks, separate exact viewport/ruler ownership, and add memo boundaries with explicit relevant props.

   Validate with react Profiler unchanged-row render/commit counts and render duration, while exercising selection and recording changes.

7. **Construct virtualized row children only when mounted** (P3 candidate). [TrackListView.jsx:332](../../src/common/editor/ui/timeline/TrackListView.jsx), [TrackViewportRow.tsx:90](../../src/common/editor/ui/timeline/TrackViewportRow.tsx).

   TrackListView calls renderTrack for every nonhidden track before TrackViewportRow decides whether to discard the resulting child element. Offscreen slots avoid heavy component execution, but parent construction of props, callbacks, and recording-preview searches still scales with all tracks. Provide a stable deferred row factory or move track-child creation into the mounted slot owner.

   Validate with offscreen row-element constructions/allocations per update and parent render CPU.

8. **Window label markers horizontally** (P2 candidate). [LabelTrackRow.jsx:127](../../src/common/editor/ui/timeline/LabelTrackRow.jsx).

   A mounted label track maps every label into a full interactive marker even when almost all labels are outside the time viewport. Index point/range labels against the viewport and render visible/overscan markers plus the active edit/focus marker; retain list-wide keyboard navigation.

   Validate with mounted label DOM count, zoom/selection React duration, p95 scroll frame interval.

9. **Include label tracks in vertical row virtualization** (P2 candidate). [TrackListView.jsx:320](../../src/common/editor/ui/timeline/TrackListView.jsx).

   The vertical virtualizer explicitly returns label rows directly. Every label track remains mounted below/above the viewport, including all of its markers and their listeners. Use TrackViewportRow for label rows with label-aware focus/edit pinning and placeholders.

   Validate with offscreen label component/DOM counts, retained heap and vertical scrolling frame time.

10. **Coalesce ordinary pointer preview work to display frames** (P2 candidate). [useTimelinePointerMove.js:159](../../src/common/editor/ui/timeline/useTimelinePointerMove.js), [useTimelinePointerMove.js:276](../../src/common/editor/ui/timeline/useTimelinePointerMove.js), [useTimelinePointerMove.js:329](../../src/common/editor/ui/timeline/useTimelinePointerMove.js), [useTimelinePointerMove.js:509](../../src/common/editor/ui/timeline/useTimelinePointerMove.js).

   Pinch zoom commits, track resize, selection, loop, stretch, and trim update previews/actions at raw pointer event rate. A 120-240 Hz pointer can drive more expensive projection/React work than the display can present. Keep the latest pointer sample/session result and publish once per animation frame; flush the latest canonical geometry on pointer-up and cancel stale scheduled work.

   Validate with preview publications/action invocations per display frame, input-to-paint p95 and missed frames.

11. **Use a maintained lane geometry table for pointer hit testing** (P2 candidate). [useTimelineHitTesting.js:48](../../src/common/editor/ui/timeline/useTimelineHitTesting.js), [track-selection-scope.ts:51](../../src/common/editor/ui/timeline/track-selection-scope.ts).

   Track targeting queries every lane and reads rectangles until finding the destination; range selection reads every lane rectangle on each move. Placeholder virtualized rows are still included, so these DOM reads can scale with total track count. Maintain row top/height prefix geometry invalidated by track resize/folder/dock changes, transform clientY through current scroll, and binary-search the destination/span. Reuse measured container bounds within a frame.

   Validate with getBoundingClientRect calls and lane iterations per event, forced layouts, p95 gesture CPU.

12. **Patch only affected track projections during drag** (P1 candidate). [useAudioTrackRowViewModel.js:123](../../src/common/editor/ui/timeline/useAudioTrackRowViewModel.js), [useAudioTrackRowViewModel.js:398](../../src/common/editor/ui/timeline/useAudioTrackRowViewModel.js), [useAudioTrackRowViewModel.js:402](../../src/common/editor/ui/timeline/useAudioTrackRowViewModel.js).

   Any clipDragPreview invalidates every mounted row's clip collection, copies/filter-scans its complete track, and disables the viewport clip index even for rows unrelated to the move. Large static tracks therefore fall back to full projection scans during a drag elsewhere. Compute affected source/destination track IDs once, retain unchanged row collections/indexes, and query the stable viewport index before applying a small dragged-clip overlay/exclusion.

   Validate with static-track clip reads/copies per move and p95 drag frame CPU; verify clips entering/leaving the viewport and cross-track previews.

13. **Skip RMS reductions when RMS is hidden** (P3 candidate). [audacity-waveform-renderer.js:127](../../src/common/editor/audacity-waveform-renderer.js), [audacity-waveform-renderer.js:143](../../src/common/editor/audacity-waveform-renderer.js).

   drawSummaryColumns reads every source RMS value and squares/adds it before checking showRms. Ordinary waveforms with RMS disabled still perform this work, including three frequency-band passes. Guard RMS reads and accumulation with showRms && channel.rms, leaving extrema unchanged.

   Validate with rMS element reads and summary-render CPU; numerical/screenshot parity for both toggle states.

14. **Avoid repeated canvas fill-style assignments across uniform waveform runs** (P3 candidate). [audacity-waveform-renderer.js:141](../../src/common/editor/audacity-waveform-renderer.js), [audacity-waveform-renderer.js:217](../../src/common/editor/audacity-waveform-renderer.js).

   Every min/max column assigns fillStyle, even while the complete waveform uses the same base color. Selected waveforms generally have only three color runs; RMS-on alternation also prevents simple style reuse. Draw min/max and RMS as separate passes or color runs and set style once per run, preserving physical-pixel alignment and layering.

   Validate with fillStyle setter count and canvas CPU per 1,000 columns; verify RMS compositing and selected colors.

15. **Batch connecting-dot and sample-stem paths by color** (P2 candidate). [audacity-waveform-renderer.js:175](../../src/common/editor/audacity-waveform-renderer.js), [audacity-waveform-renderer.js:187](../../src/common/editor/audacity-waveform-renderer.js).

   Connecting-dot mode begins and strokes a separate path for every adjacent pair; stem mode also strokes each sample individually. Most ordinary waveform samples share a color. Batch same-color segments/stems into paths, with separate groups at selection/color boundaries; validate joins/caps and rainbow rendering before adopting.

   Validate with stroke calls, canvas CPU and p95 zoom/selection paint; screenshot parity at joins and selection boundaries.

16. **Reuse sample coordinate scratch instead of allocating point objects per paint** (P3 candidate). [audacity-waveform-renderer.js:158](../../src/common/editor/audacity-waveform-renderer.js), [audacity-waveform-renderer.js:164](../../src/common/editor/audacity-waveform-renderer.js).

   Every individual-sample redraw creates a new array and one {x,y} object per sample, followed by multiple traversals. Stream previous/current coordinates for connecting dots and retain bounded numeric scratch for stems/heads when a second pass is needed.

   Validate with allocated objects/bytes per redraw and GC pauses, with exact coordinate parity.

17. **Draw three-band RMS directly without a transparent peak pass** (P3 candidate). [frequency-waveform-renderer.ts:62](../../src/common/editor/ui/timeline/frequency-waveform-renderer.ts), [audacity-waveform-renderer.js:141](../../src/common/editor/audacity-waveform-renderer.js).

   Three-band RMS requests the complete ordinary waveform renderer with sampleColor='transparent'. The renderer still evaluates extrema, writes fillStyle, and issues transparent min/max rectangles before drawing RMS. Add an explicit RMS-only paint mode that retains clipping to waveform extrema but omits transparent peak canvas writes.

   Validate with peak fillRect calls eliminated per channel and canvas CPU; compare RMS envelope/extrema clipping pixels.

18. **Keep ruler and grid backing buffers when dimensions are unchanged** (P2 candidate). [MappedTimelineRulerCanvas.jsx:39](../../src/common/editor/ui/timeline/MappedTimelineRulerCanvas.jsx), [TimelineGridLines.jsx:53](../../src/common/editor/ui/timeline/TimelineGridLines.jsx).

   Both canvases assign width and height on every redraw, even for selection-only or scroll-only changes. Canvas dimension assignment clears/resets the drawing context and can recreate backing resources despite unchanged geometry. Compare backing dimensions before assignments and otherwise clear/repaint the existing buffer; keep ratio/theme invalidation explicit.

   Validate with backing-dimension writes/resource allocations per scroll frame and paint CPU.

19. **Share viewport tick generation between rulers and grid canvases** (P3 candidate). [MappedTimelineRulerCanvas.jsx:83](../../src/common/editor/ui/timeline/MappedTimelineRulerCanvas.jsx), [timeline-grid-model.ts:124](../../src/common/editor/ui/timeline/timeline-grid-model.ts), [TimelineWorkspaceView.jsx:352](../../src/common/editor/ui/timeline/TimelineWorkspaceView.jsx).

   Mapped ruler drawing builds musical/timecode ticks, and grid-line generation separately calls the same tick generators for the same sample-rate/zoom/viewport. Output-dock grids can repeat the same preparation. Resolve an immutable viewport tick model once at its owning timeline and pass/project it into ruler and all grid paints.

   Validate with tick-builder calls and allocations per viewport change, preserving exact tick/grid alignment.

20. **Move timeline spectrogram FFT work off the renderer thread** (P1 candidate). [spectrogram-canvas-renderer.js:47](../../src/common/editor/ui/timeline/spectrogram-canvas-renderer.js), [spectrogram-pcm-tiles.ts:150](../../src/common/editor/ui/timeline/spectrogram-pcm-tiles.ts), [pffft-spectrogram.js:64](../../src/common/editor/pffft-spectrogram.js).

   Each visible spectrogram column fills FFT input, calls PFFFT, and groups magnitudes synchronously. Whole-buffer analysis is called inside a layout-effect painter; streamed tile analysis also runs synchronously after its read resolves. Bounded PCM memory does not bound renderer-thread CPU per tile. Run column analysis in a dedicated worker with transferred bounded PCM windows and cancellation/version keys; publish ready raster/columns back to the renderer.

   Validate with renderer long-task duration and p95 interaction latency during analysis, plus time to final spectrogram and worker transfer bytes.

21. **Support bulk spectrogram rasterization at fractional backing ratios** (P2 candidate). [spectrogram-image-data.ts:33](../../src/common/editor/ui/timeline/spectrogram-image-data.ts), [spectrogram-canvas-renderer.js:90](../../src/common/editor/ui/timeline/spectrogram-canvas-renderer.js).

   The ImageData fast path requires integer transform scales and integer rectangle geometry. A fractional devicePixelRatio, fractional clip width, or unequal stereo channel height often fails those checks and falls back to per-frequency-span fillRect writes. Rasterize directly in backing-pixel coordinates with shared rounded boundaries, or rasterize at logical pixels and draw the cached image at the requested ratio; choose by verified visual parity.

   Validate with bulk-path hit ratio and canvas calls/paint CPU at fractional DPI, screenshot seam/antialiasing parity.

22. **Retain reusable fixed spectrogram tiles across viewport shifts** (P2 candidate). [useSpectrogramPcmTiles.ts:113](../../src/common/editor/ui/timeline/useSpectrogramPcmTiles.ts), [useSpectrogramPcmTiles.ts:133](../../src/common/editor/ui/timeline/useSpectrogramPcmTiles.ts), [useSpectrogramPcmTiles.ts:138](../../src/common/editor/ui/timeline/useSpectrogramPcmTiles.ts).

   Completed tile columns are keyed to the entire projected clip start/end/width. Crossing a render anchor replaces that viewport key, discards completed columns, aborts old jobs, and regenerates the overlapping analysis. Cache fixed source/time tiles by immutable audio content, FFT/window, and resolution; assemble the current window from retained intersections and analyze only new coverage under a byte-budgeted LRU.

   Validate with overlapping FFT columns recomputed/read bytes per anchor transition and time until a new viewport is painted; cache memory cap.

23. **Bound and prioritize multitrack spectrogram jobs** (P2 candidate). [useSpectrogramPcmTiles.ts:144](../../src/common/editor/ui/timeline/useSpectrogramPcmTiles.ts), [useSpectrogramPcmTiles.ts:150](../../src/common/editor/ui/timeline/useSpectrogramPcmTiles.ts).

   Each mounted row starts every projected clip request immediately, with no scheduler shared across rows. A viewport revealing many spectrogram clips can queue simultaneous reads and analysis, increasing contention and slowing the selected visible clip's response. Use a controller-owned bounded queue across rows, prioritize selected/onscreen clips over overscan, and cancel superseded jobs before admitting more work.

   Validate with concurrent read/analysis count, selected-clip first/final paint latency, renderer long tasks and peak PCM memory.

24. **Memoize immutable waveform content identity and time authority keys** (P3 candidate). [waveform-view-model.ts:253](../../src/common/editor/ui/timeline/waveform-view-model.ts), [waveform-view-model.ts:379](../../src/common/editor/ui/timeline/waveform-view-model.ts), [waveform-preview-cache.ts:109](../../src/common/editor/ui/waveform-preview-cache.ts), [useSpectrogramPcmTiles.ts:109](../../src/common/editor/ui/timeline/useSpectrogramPcmTiles.ts).

   A clip projection serializes content identity, maps its entire envelope, and may serialize a full tempo map before testing a waveform cache hit. It constructs another content identity for cacheSignature; spectrogram request keys serialize overlapping content again. Cache normalized content identity by immutable clip/source identity and a separate tempo-map revision key; combine scalar window/resolution keys without reserializing whole envelopes/maps.

   Validate with jSON/string allocations, envelope entries visited per cache hit, projection CPU; mutation-safe fallback for noncanonical callers.

25. **Index authored automation points and visible spans during overlay projection** (P2 candidate). [track-automation-overlay-projection.ts:101](../../src/common/editor/ui/timeline/track-automation-overlay-projection.ts), [track-automation-overlay-projection.ts:111](../../src/common/editor/ui/timeline/track-automation-overlay-projection.ts), [track-automation-overlay-bezier.ts:99](../../src/common/editor/ui/timeline/track-automation-overlay-bezier.ts).

   Each clip scans all automation points twice to find its authored points. Each generated curve sample additionally findIndex-scans those points to discover hold boundaries; Bezier handles scan every projected span to test visibility. Build one frame-to-point-index map, range-query sorted point frames, and binary-query merged visible spans for handles.

   Validate with point/span comparisons per overlay projection, CPU and allocations; preserve duplicate-position/hold-transition behavior.

26. **Use compact segment geometry for simple automation curves** (P2 candidate). [track-automation-overlay-projection.ts:92](../../src/common/editor/ui/timeline/track-automation-overlay-projection.ts), [track-automation-overlay-projection.ts:104](../../src/common/editor/ui/timeline/track-automation-overlay-projection.ts), [TrackAutomationOverlay.tsx:396](../../src/common/editor/ui/timeline/TrackAutomationOverlay.tsx).

   Even a constant lane/current value emits samples every two CSS pixels, freezes sample objects, and creates a long SVG path. This work is unnecessary for constant spans; linear or hold segments can often be represented by endpoints under a linear descriptor taper. Emit exact minimal geometry for constant/hold/linear-in-screen-space segments and use error-bounded adaptive subdivision for nonlinear taper/eased/Bezier segments.

   Validate with sample objects/path bytes per span, overlay CPU and SVG paint time; numerical pixel-error threshold and exact hold corners.

27. **Limit automation draft normalization and React publication to one per frame** (P2 candidate). [TrackAutomationOverlay.tsx:154](../../src/common/editor/ui/timeline/TrackAutomationOverlay.tsx), [TrackAutomationOverlay.tsx:233](../../src/common/editor/ui/timeline/TrackAutomationOverlay.tsx), [TrackAutomationOverlay.tsx:244](../../src/common/editor/ui/timeline/TrackAutomationOverlay.tsx).

   Every captured pointer move creates a replacement automation lane and setDraftLane state. This recomputes point projection, sampled paths, and handle geometry at event rate. Retain latest drag coordinates in refs, create/publish one draft per RAF, and synchronously flush final coordinates before commit; optionally update only affected segment geometry.

   Validate with lane replacements and overlay projections per display frame, p95 drag latency, final committed point parity.

28. **Select track meter display values instead of entire telemetry objects** (P3 candidate). [TrackTelemetryMeters.tsx:34](../../src/common/editor/ui/timeline/TrackTelemetryMeters.tsx), [TrackTelemetryMeters.tsx:64](../../src/common/editor/ui/timeline/TrackTelemetryMeters.tsx), [DesignSystemRuntime.jsx:48](../../src/common/editor/ui/DesignSystemRuntime.jsx).

   Track/output meters subscribe to full meter objects with Object.is, although their display only uses dbfs and peak clipping. A fresh object with spectrum/RMS/loudness changes can rerender these components despite identical rendered values. Select an equality-stable pair of rendered meterPercent and clipped state, using a comparator or scalar encoding; quantize only to actual display pixel precision.

   Validate with unchanged meter React renders per telemetry tick and commit time; clipping and level precision parity.

29. **Memoize static meter ruler ticks** (P3 candidate). [AudioEditorMeters.jsx:63](../../src/common/editor/ui/toolbar/AudioEditorMeters.jsx), [AudioEditorMeters.jsx:130](../../src/common/editor/ui/toolbar/AudioEditorMeters.jsx).

   Every live AudacityAudioMeter render recomputes tick arrays and reconciles all tick-label elements although type/range/size usually remain stable throughout playback. Memoize tick calculation by type/range/EBU scale/unit/meterSize and isolate the static ruler component from live values.

   Validate with tick-generator invocations and static-ruler renders per second; preserve resize tick density.

30. **Animate meter fills with fixed geometry and transforms** (P2 candidate). [MixerTelemetryMeters.tsx:55](../../src/common/editor/ui/workspace/MixerTelemetryMeters.tsx), [03-shell-toolbars-meters.css:30](../../src/common/editor/ui/audio-editor-design-system/03-shell-toolbars-meters.css), [03-shell-toolbars-meters.css:251](../../src/common/editor/ui/audio-editor-design-system/03-shell-toolbars-meters.css).

   Live mixer fills update top; ordinary horizontal/vertical meters update width/height and peak-marker left/bottom through CSS variables. These properties require layout/paint rather than a transform-only update. Keep fill geometry fixed and use scale/translate or a clipped fixed-gradient layer, with measured selective compositing and bounded layer count.

   Validate with per-tick layout/paint duration, compositor layer memory and p95 playback frame time; pixel parity of RMS and gradient scales.


### Generate Apply and DSP

31. **Run long built-in generators off the renderer thread** (P1 candidate). [generator-service.ts:262](../../src/common/editor/controller/edit/generator-service.ts).

   generateSignal calls synchronous generateAudioEditorSignal before the first storage await; markProcessing is not called until line 273. All tone, chirp, noise and DTMF sample loops therefore block the renderer and even delay the busy feedback. Use a cancelable dedicated generator worker with transferable chunks; publish processing state before dispatch. Keep short jobs on a measured low-overhead path if appropriate.

   Validate with click-to-first-busy-paint, renderer long-task maximum, dropped animation frames, and click-to-committed-generated-clip p50/p95.

32. **Generate bounded PCM blocks instead of materializing the complete signal** (P1 candidate). [generators.js:38](../../src/common/editor/generators.js).

   generateFixedDuration allocates the entire duration; generator-service retains all channels while createBuffer subsequently copies them. Generation supports up to 24 hours subject to frame bounds. Give each generator a stateful block iterator (phase, noise bins/RNG, segment offset) that writes bounded blocks and feeds incremental peak construction, with backpressure.

   Validate with peak process RSS, allocated PCM bytes, longest renderer task and Generate-to-clip latency for 30 s, 5 min and 30 min inputs.

33. **Keep the already-owned mono generator result as channel zero** (P2 candidate). [generators.js:208](../../src/common/editor/generators.js).

   duplicateChannels creates a new Float32Array(mono) for every channel including channel zero, discarding the freshly generated mono array afterward. A mono tone/chirp/DTMF/Morse therefore incurs a needless full PCM copy. Return mono as the first independently owned channel, and clone it only for channels 1..channelCount-1.

   Validate with copied bytes and allocation count: one fewer frameCount*4 buffer for every such generation; exact channel independence regression.

34. **Maintain a running pink-noise bin sum** (P1 candidate). [generators.js:121](../../src/common/editor/generators.js).

   Pink noise calls pinkBins.reduce(callback) across seven bins for every sample even though at most one bin changes each frame. Maintain the bin total when the selected bin changes, then use (total + white)/4. Keep the existing RNG calls and counter ordering.

   Validate with kernel wall-clock median and full bitwise PCM equality, plus Electron Generate latency.

35. **Share the gain envelope of fixed offline linked noise gates** (P2 candidate). [noise-gate-dsp.ts:81](../../src/common/editor/first-party-effects/standard/noise-gate-dsp.ts).

   In linked mode every freshly initialized channel sees the same detector peak and starts with identical gain/hold/opening state, but lines 81–96 repeat threshold, attack/release and exponential-envelope work per channel. For an explicitly fixed-parameter linked offline job, compute the gain/hold/attack envelope once per frame and use it across channels; retain independent delayed audio and crossover states.

   Validate with envelope update/transcendental count per frame: channelCount→one; exact PCM and worker Apply CPU. Representative Electron profiling required for user impact.

36. **Reuse identical DTMF digit waveforms within one Generate job** (P2 candidate). [generators.js:150](../../src/common/editor/generators.js).

   Each occurrence of a digit recomputes two Math.sin calls and the same fade envelope for every frame; its phase resets to zero on every occurrence. Render each distinct symbol once for the fixed toneFrames/rate/amplitude/fade, then copy its PCM to each occurrence. Bound the per-job cache to the 16 valid symbols.

   Validate with sin evaluations scale with distinct symbols*toneFrames instead of sequence length*toneFrames; compare wall-clock and exact PCM.

37. **Retain a bounded selection/spectral worker pool across successful operations** (P1 candidate). [selection-effect-worker-service.ts:182](../../src/common/editor/controller/effects/internal/selection-effect-worker-service.ts).

   Each apply constructs a new selection worker; executeWorker cleanup terminates it even on success at line 333. PFFFT ready/plans and the StaffPad runtime promise are per-worker module caches and disappear with it. Retain one idle worker per required execution class, with request IDs and resettable per-job state; terminate on cancellation, faults or project disposal. Avoid eagerly creating workers at editor startup.

   Validate with warm repeated Apply latency, worker creations, WASM instantiations and FFT-plan creations per operation.

38. **Transfer consumed dry-effect buffers without another full PCM clone** (P1 candidate). [nyquist-audio.ts:142](../../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts).

   cloneAudacityWorkerPayload Float32Array.from-copies all selection and context channels before transferring them. renderDryTrackRange already returns newly rendered channel arrays, so some one-shot paths have no remaining reader for that PCM. Introduce an explicit owned/consumed-buffer request path that transfers exclusively owned dry/context buffers directly; keep cloning for preview caches, borrowed source data, linked jobs or fallback paths.

   Validate with renderer clone time, copied bytes, peak RSS and click-to-result latency.

39. **Process independent target tracks through bounded concurrent jobs** (P1 candidate). [effect-execution-service.ts:140](../../src/common/editor/controller/effects/internal/effect-execution-service.ts).

   All target dry renders finish serially before processing starts, then each target effect worker is awaited serially at lines 182–211. Independent tracks do not overlap render/DSP work. Use a memory-budgeted pipeline with a small worker/render concurrency limit; retain input order and commit all targets atomically. Keep shared-peak parameter resolution and linked truncate-silence as barriers.

   Validate with total Apply latency, CPU utilization, peak RSS, per-target completion times and renderer frame gaps at 1/2/4 concurrent jobs.

40. **Render effect selection and neighboring context in one extended range** (P1 candidate). [effect-execution-service.ts:195](../../src/common/editor/controller/effects/internal/effect-execution-service.ts).

   The selection is rendered at lines 140–149, then preroll and postroll each call renderDryTrackRange again at lines 197 and 202, constructing separate isolated snapshots and offline renders. Plan one extended dry range per target and split its owned PCM into before/selection/after views; retain the exact original start/end and requested clip scope.

   Validate with offline render/context constructions per target: up to three→one; Apply latency especially for tiny repaired ranges.

41. **Reuse immutable neighbor context across offline macro steps** (P2 candidate). [effect-macro-chain.ts:145](../../src/common/editor/controller/effects/internal/macro/effect-macro-chain.ts).

   Every context-requiring offline step renders before/after PCM again through renderNeighbouringRange, although the documented neighbors remain authored project audio and are unchanged by the chain. Keep a per-run, per-target cache of bounded neighboring dry PCM keyed by track/clip scope/range/channels and captured project revision; a larger context can serve smaller slices.

   Validate with neighbor renders and copied context bytes per chain; macro Apply latency.

42. **Run consecutive offline macro steps inside one worker request** (P1 candidate). [effect-macro-chain.ts:250](../../src/common/editor/controller/effects/internal/macro/effect-macro-chain.ts).

   Each offline step crosses runtime.runSelectionEffect, returning PCM to the renderer before the next step clones/transfers it back into a freshly created worker. Dispatch an offline segment as an ordered list of steps with its immutable context; keep intermediate owned PCM inside one worker and transfer only the final result.

   Validate with worker round trips, intermediate PCM transferred/copied bytes, worker creations and macro click-to-result time.

43. **Slice already-rendered full-selection PCM for short previews** (P2 candidate). [effect-preview-service.ts:123](../../src/common/editor/controller/effects/internal/effect-preview-service.ts).

   When preview needs full-selection analysis, fullChannelSets already hold the complete dry PCM. Reuse occurs only if preview bounds equal the full bounds; a shorter preview invokes another offline render. For a contained preview range, use owned subarray views at preview.startFrame-full.startFrame instead of rerendering; retain aligned preview offsets.

   Validate with dry renders per preview and Preview-to-audible-result latency.

44. **Reuse dry selection analysis between dialog preparation, Preview and Apply** (P2 candidate). [effect-execution-service.ts:61](../../src/common/editor/controller/effects/internal/effect-execution-service.ts).

   Amplify preparation renders the entire selection for its default gain; Apply rerenders it at line 141. Preview also renders its own dry selection and no reusable revision-keyed dry-result cache is retained by these services. Keep a bounded speed-preference cache of owned dry PCM and peak statistics keyed by project/audio revision, selection, track/clip scope, sample rate and channel count; invalidate on any audio-affecting edit.

   Validate with repeat dry render count, Preview/Apply p50/p95 latency and retained cache bytes.

45. **Initialize FFT only for effect types that actually use it** (P2 candidate). [index.js:131](../../src/common/editor/audacity-effects/index.js).

   applyAudacityEffectAsync awaits initializePffft for every non-StaffPad Audacity effect, including Amplify, Invert, fades, DC removal, echo and compressor whose implementations perform no FFT. Classify FFT-requiring effects explicitly and initialize PFFFT only for those or spectral-selection compositing; preserve worker-local lazy ownership.

   Validate with pFFFT instantiations/FFT-plan work for a scalar Apply should be zero; measure Apply runtime setup CPU and latency after the editor is already ready.

46. **Use indexed sample loops instead of Float32Array.from mapping callbacks** (P1 candidate). [basic-channel-math.js:33](../../src/common/editor/audacity-effects/basic-channel-math.js).

   multiplyChannel creates a typed array with Float32Array.from(channel, callback). Amplify, normalize, legacy-compressor makeup and RMS normalization use it; Invert repeats the same pattern in basic.js:205. Allocate one destination array and fill it with an indexed loop, preserving Float32 writes and exact arithmetic.

   Validate with kernel time, exact PCM and end-to-end Apply latency.

47. **Calculate destructive linked dynamics gain once per frame** (P1 candidate). [basic-dynamics.js:72](../../src/common/editor/audacity-effects/basic-dynamics.js).

   applyLinkedDynamics shares detector/envelope work but its channel-major output loop computes dbToLinear(envelope[index]+makeupGainDb) again for every channel/sample. Use a frame-major fill across output channels or reuse the envelope array for linear gains after lookahead is complete.

   Validate with exponentials per frame decrease from channelCount to one; bitwise PCM parity and Apply CPU time.

48. **Fuse effect validation with existing PCM production/copy passes** (P2 candidate). [selection-effects-runtime.js:29](../../src/common/editor/selection-effects-runtime.js).

   Standard/band effects validate every input sample through assertAudacityEffectOutput, their own validateChannels finite scan, then another output assertion. Persistence asserts the returned channels again at effect-result-service.ts:281. Validate untrusted input once and pass an internal owned validation token to the kernel; enforce output finiteness during DSP/write loops rather than repeatedly rescanning unchanged PCM.

   Validate with full finite-check passes and bytes scanned per Apply, plus click-to-result latency.

49. **Share prepared convolution kernel FFT across EQ channels** (P2 candidate). [spectral-equalization-curves.js:197](../../src/common/editor/audacity-effects/spectral-equalization-curves.js).

   Filter/Graphic EQ builds one time-domain kernel per apply, but each channels.map(convolveSame) creates and transforms identical kernelReal/kernelImaginary arrays again. Prepare an immutable kernel spectrum once for the operation and pass it to per-channel convolution; optionally use a bounded parameter/sample-rate cache inside a retained worker.

   Validate with kernel forward FFT count: channelCount→one; numerical parity, short-selection Apply latency and allocated bytes.

50. **Reuse EQ convolution block scratch instead of allocating it per block** (P2 candidate). [spectral-equalization-curves.js:204](../../src/common/editor/audacity-effects/spectral-equalization-curves.js).

   convolveSame allocates new Float64 real and imaginary arrays inside every FFT block loop, despite identical FFT size. Allocate scratch once per convolution instance, reset it to zero before each block, and refill the live sample extent.

   Validate with float64 scratch allocation count, GC pauses and convolution CPU time; exact numerical output.

51. **Bound overlap-add convolution accumulation to a ring buffer** (P1 candidate). [spectral-equalization-curves.js:201](../../src/common/editor/audacity-effects/spectral-equalization-curves.js).

   convolveSame retains a full Float64 input.length+kernel.length-1 accumulation and then copies the centered result into Float32 output. Use an overlap-add ring sized to the FFT block/tail; finalize samples into the required Float32 output once no future block can affect them.

   Validate with peak scratch bytes decrease from roughly 8*selectionFrames per active channel to bounded FFT/tail geometry; GC pauses and Apply latency.

52. **Reuse noise-reduction FFT and smoothing scratch** (P1 candidate). [spectral-noise-reduction.js:86](../../src/common/editor/audacity-effects/spectral-noise-reduction.js).

   Both powerSpectrum and the synthesis loop allocate two Float64 FFT arrays per window. Geometric smoothing allocates logs/prefix arrays for every gain frame at lines 124–125. Keep per-run scratch arrays for analysis/synthesis and smoothing, clear padding correctly, and write powers to owned output rows. Remove the unused logs retention by accumulating log values directly into prefix.

   Validate with typed-array allocation count, worker GC time, peak RSS and Apply latency.

53. **Keep only neighboring noise power spectra required by the detector** (P1 candidate). [spectral-noise-reduction.js:40](../../src/common/editor/audacity-effects/spectral-noise-reduction.js).

   reduceNoiseChannel materializes powers for every STFT window before producing gains. Detection at lines 46–60 reads only the current frame and two neighboring windows on either side; later attack/release passes read gains, not powers. Calculate powers into a five-window ring plus exact edge handling, emit gain rows when their future neighbors are ready, and release old powers.

   Validate with power-spectrum retained bytes become O(windowSize), rather than O(selectionFrames); peak RSS and Apply latency without any change to gain decisions.

54. **Share noise-reduction overlap normalization across channels** (P2 candidate). [spectral-noise-reduction.js:83](../../src/common/editor/audacity-effects/spectral-noise-reduction.js).

   Each channel allocates and fills a normalization array by adding window[index]^2 at identical starts, even though channel length/window/hop geometry are shared. Prepare one read-only normalization vector per apply and reuse it for all channel synthesis; precompute window squared once.

   Validate with normalization accumulation writes and arrays per operation: channelCount→one; exact PCM and multichannel Apply CPU.

55. **Reuse Paulstretch FFT scratch across output windows** (P1 candidate). [spectral.js:298](../../src/common/editor/audacity-effects/spectral.js).

   paulstretchChannel allocates Float64 real and imaginary arrays inside every output-window loop; high stretch factors multiply the number of allocations. Allocate one pair per channel processor, fill/reset it for each window, and reuse bounded immutable Hann geometry across channel processors.

   Validate with typed-array allocations, worker GC duration, peak RSS and click-to-stretched-result time.

56. **Precompute the selected FFT bin interval for spectral edits** (P2 candidate). [spectral-edit.js:55](../../src/common/editor/spectral-edit.js).

   Every STFT window walks all nonnegative bins, computes frequency=bin*rate/windowSize and branches on min/max band membership. Spectral replacement duplicates this scan at line 142. Resolve inclusive first/last selected bins once per operation and loop only over that range; preserve DC/Nyquist mirror rules.

   Validate with bins visited and frequency calculations per window; worker CPU time and exact PCM at frequency/bin boundaries.

57. **Borrow full input blocks in standard destructive effect processing** (P2 candidate). [dsp.ts:53](../../src/common/editor/first-party-effects/standard/dsp.ts).

   applyStandardEffect clears each zero block and copies every input block into it even when the block is fully inside the source. It also creates a new input array via zeros.map for every block. For ordinary full blocks, pass read-only subarray views of owned input channels; use the zero scratch only for the final partial block and latency flush. Reuse channel-view containers.

   Validate with copied/zeroed bytes and per-block allocations, exact PCM and Apply CPU time.

58. **Skip unused full-band noise-gate crossover work for fixed offline jobs** (P2 candidate). [noise-gate-dsp.ts:75](../../src/common/editor/first-party-effects/standard/noise-gate-dsp.ts).

   The gate ticks both crossovers and runs dry through both low-pass filters for every channel/frame even when gateFrequency is zero; the resulting low value is ignored by the full-band output at line 100. Use a fixed-parameter offline full-band branch that omits crossover processing; retain the existing realtime state behavior when future automation could enable frequency gating.

   Validate with crossover tick/low calls become zero in the fixed full-band case; exact PCM, Apply CPU and realtime transition parity.

59. **Use a direct dry-PCM path for simple unprocessed selections** (P1 candidate). [effect-audio-service.ts:86](../../src/common/editor/controller/effects/internal/effect-audio-service.ts).

   After an optional source-editor fast path, ordinary timeline selections are rendered through renderSnapshot/OfflineAudioContext even when they consist of simple same-rate source clips with unity processing. Add a rigorously admitted direct source-range copy/mix path for simple unwarped, unlooped, untransformed clips, using the same clip fade/crossfade rules; retain offline rendering for every unsupported case.

   Validate with offline contexts/node graphs created per Apply, dry-preparation latency, exact PCM and renderer long tasks.

60. **Index engine render-range clip plans and retain crossfade preparation** (P1 candidate). [clip-schedule-plan.ts:186](../../src/common/editor/engine/clip-schedule-plan.ts).

   Every render rebuilds a map of all project clips, obtains every clip in each active track, prepares automatic crossfades for all track clips, then checks range intersection in the inner loop. The timeline viewport index does not serve this engine scheduler. Prepare immutable engine snapshot indexes once, query only clips intersecting the render range (including long overlaps), and reuse canonical per-track crossfade geometry until affected clips change.

   Validate with authored clip geometry reads and crossfade sorts per range render, scheduler preparation milliseconds and Apply latency.


### Desktop storage delivery and assistance

61. **Replace large-export realtime fallback with bounded faster-than-realtime rendering** (P1 candidate). [export.js:104](../../src/common/editor/export.js).

   chooseRenderStrategy falls back to realtime-stream above output/total memory admission. audio-export-render-orchestration.ts:157-163 sends this to renderMixRealtime; engine/rendering.ts:110,208 uses a live AudioContext audio clock. Add a bounded offline/native DSP render-to-sink strategy for supported graphs, preserving state between chunks and refusing unsupported graph shapes. Keep current limits; do not simply increase OfflineAudioContext memory thresholds.

   Validate with export wall time / programme duration, peak RSS, output audio null comparison, stateful-effect boundary continuity, cancellation latency.

62. **Feed offline compressed encoders bounded PCM without a complete staging WAV** (P1 candidate). [direct-offline-compressed-export.ts:60](../../src/common/editor/controller/export/internal/direct/direct-offline-compressed-export.ts).

   The full admitted render is synchronously encodeWav-ed into one Uint8Array and then one Blob before encodeDirectCompressedStagedFile begins. Extend the existing desktop streaming codec contract to accept render PCM blocks directly, applying the admitted conversion/dither once; avoid the complete WAV encode/Blob/decode/reinterleave cycle.

   Validate with render-complete-to-encoder-start latency, total export p50/p95, max renderer long task, peak binary bytes and codec output/reference equality.

63. **Pipeline independent stem render and ordered archive emission** (P2 candidate). [direct-stem-archive-export.ts:185](../../src/common/editor/controller/export/internal/direct/direct-stem-archive-export.ts).

   Each stem fully awaits renderStem and archive.add before the following stem starts. Use a memory-admitted pipeline with at most one next stem render/encode in progress while the previous completed stem drains into the sequential archive. Retain deterministic archive order.

   Validate with complete archive latency, encoder/renderer/disk overlap, peak staged bytes, archive order and CRC equality.

64. **Let Speed publish lossless raw PCM before optional compression** (P1 candidate). [source-write-repository.ts:216](../../src/common/editor/storage/source-write-repository.ts).

   Every persistent write calls pcm.encode(packPlanarFloat32(...)) and awaits compression before OPFS/IndexedDB write and source commit. optimizeFor is not consulted here. Under desktop Speed, write supported raw-f32le chunks immediately and schedule atomic low-priority lossless compression/replacement after the result is usable, subject to storage capacity.

   Validate with apply-to-visible-result latency, first playable result, encoder CPU time, background interference, raw/compressed exact PCM equality and crash/reopen durability.

65. **Remove the second raw PCM ownership copy before WavPack encode** (P2 candidate). [pcm-repository.ts:97](../../src/common/editor/storage/pcm-repository.ts).

   packPlanarFloat32 already snapshots the channel data; encode then rawPayload.slice(0) duplicates that owned chunk before transfer to the worker, retaining the first for fallback. Give the codec the owned packed snapshot and have it return either compressed data or the original owned raw payload. Keep failure recovery explicit, or choose raw persistence before dispatch when needed.

   Validate with bytes allocated per persisted chunk, encode/commit p50/p95 and peak GC pause; mutation, abort and raw-fallback tests.

66. **Use private channel views for owned decoded planar PCM** (P2 candidate). [pcm.js:105](../../src/common/editor/wavpack/pcm.js).

   On little-endian hosts unpackPlanarFloat32 slices the owned decoded payload separately for every channel. Add an internal read-only owned-payload projection using Float32Array views, with copy-on-mutation only where a public/history-owned consumer requires mutable isolation.

   Validate with decoded bytes allocated/chunk, read throughput, GC pauses and immutable-history mutation tests.

67. **Move PCM checksum work off the renderer hot path** (P1 candidate). [pcm-repository.ts:83](../../src/common/editor/storage/pcm-repository.ts).

   PCM encode computes a byte-by-byte JS CRC32 before its worker call; decode also recomputes CRC32 in renderer at lines 177/207. wavpack/pcm.js:139-146 is a scalar loop. Compute and validate identical CRC32 in a worker/native byte-processing stage that owns the payload, returning an authenticated exact-geometry result; preserve all corruption checks.

   Validate with renderer CPU and long tasks, CRC worker time, p95 read/write latency and corruption fixtures. Reproduce the isolated CRC cost with scripts/performance/measure-pcm-helpers.mjs; retain every trial, including GC/shared-host variation, in editing-performance-measurements.json.

68. **Replace per-chunk full ancestry metadata scans with a coherent generation fence** (P1 candidate). [owned-source-pcm-read-session.ts:152](../../src/common/editor/storage/owned-source-pcm-read-session.ts).

   Every read calls assertGenerationCurrent before and after chunk access; that loops serial getMetadata over every COW ancestor at lines 204-209. Acquire an exact-generation read lease or a transaction-coherent generation version at session admission, invalidate it when any retained ancestor changes, and keep cheap per-read fence checks.

   Validate with metadata queries per chunk, chunk p95, apply/render wall time and tests for replacement/release races across all ancestors.

69. **Memoize which COW generation owns each chunk** (P2 candidate). [owned-source-pcm-read-session.ts:154](../../src/common/editor/storage/owned-source-pcm-read-session.ts).

   After generation checks, each read probes records.chunk on successive COW ancestors until a replacement or physical base is found. Build a bounded chunk-to-owning-generation index for the admitted immutable ancestry, or memoize resolved owners within the session; keep currentness fence independent.

   Validate with chunk record lookups per repeated read, first-read versus repeat-read latency and correctness when overlapping sparse edits override base chunks.

70. **Allow bounded concurrent positional reads of immutable PCM** (P2 candidate). [source-pcm-read-session.ts:61](../../src/common/editor/storage/source-pcm-read-session.ts).

   One queue serializes all chunk calls in a session even when chunk indexes are independent. Offer a bounded positional-read session for backends that safely support it, allowing disk I/O for the next packet while the current one decodes/consumes. Keep serialization for stateful/non-positional backends.

   Validate with storage-read overlap, chunk throughput, maximum in-flight bytes, cancellation latency and release/error ordering tests.

71. **Reuse an OPFS source readable within an exact-generation session** (P2 candidate). [opfs-repository.ts:299](../../src/common/editor/storage/opfs-repository.ts).

   readPcmContainerChunk reacquires sourceFile each time; sourceFile may ask sync.readable or getFileHandle/getFile at lines 417-422. Container indexes are cached separately. Bind the source readable/file snapshot and parsed index to the explicit read session, releasing it with the session and reopening only after authoritative invalidation.

   Validate with oPFS handle/readable acquisitions per render, chunk latency, release correctness and provider-replacement tests.

72. **Read a legacy multichannel PCM chunk as one bounded byte span** (P2 candidate). [opfs-repository.ts:363](../../src/common/editor/storage/opfs-repository.ts).

   Legacy chunk reads await one Blob slice/arrayBuffer per channel; sequential legacy streaming does the same at lines 329-332. Read all admitted channel bytes for one chunk together, then project independent channel views/copies under the existing byte bound.

   Validate with blob read count per chunk, multichannel chunk p95 and exact channel/NaN payload tests.

73. **Avoid coalescer copies for already aligned owned PCM packets** (P2 candidate). [pcm-chunks.js:107](../../src/common/editor/pcm-chunks.js).

   The coalescer allocates pendingChannels and copies all samples even when a full input packet exactly matches chunkFrames and no pending tail exists. Add an explicitly ownership-transferred aligned packet fast path that emits the original packet; retain copying for borrowed/mutable inputs and partial boundaries.

   Validate with copied bytes and allocations per import, wall time and tests mutating caller buffers before/after awaited write.

74. **Stream desktop compressed decode into canonical PCM storage** (P1 candidate). [desktop-audio-codec-runtime.ts:198](../../src/common/editor/desktop-audio-codec-runtime.ts).

   decode materializes all input with boundedInputBytes, sends a whole Uint8Array request, receives complete output and projects it. IPC permits64 MiB total active input at desktop-audio-codec-main-ipc.ts:62. Extend main-owned decoding with bounded input capabilities/streams and PCM output packets written directly to the staged source, instead of whole-file request/result buffers.

   Validate with import-to-first-visible/playable source latency, total import wall time, peak RSS, renderer long tasks and sample/gapless conformance.

75. **Avoid repeated full payload clones at internal desktop codec boundaries** (P2 candidate). [desktop-audio-codec-operation-contract.ts:212](../../desktop/desktop-audio-codec-operation-contract.ts).

   normalizeDesktopAudioCodecRequest copies input at renderer and main normalization boundaries; createDesktopAudioCodecResult copies output at 228 and normalize result copies again at 305. Separate assert-only validation from ownership-taking normalization for internal owned values and use transferable MessagePort payloads where supported. Snapshot external mutable callers once.

   Validate with instrument copies/allocated bytes per request/result, IPC phase latency, renderer GC and caller-mutation/owner-revocation tests.

76. **Move large desktop decoded PCM projection out of renderer** (P1 candidate). [desktop-audio-codec-result.ts:26](../../src/common/editor/desktop-audio-codec-result.ts).

   projectDesktopAudioDecodeResult loops over every frame/channel using DataView.getFloat32 and allocates full planar channels on renderer. Produce planar bounded chunks in the main codec worker or a dedicated renderer worker and transfer them directly to the canonical source writer.

   Validate with maximum renderer long task, input-to-paint during import, projection CPU and output exactness. Reproduce the isolated projection cost with scripts/performance/measure-pcm-helpers.mjs; inspect the full trial distribution in editing-performance-measurements.json.

77. **Add aligned little-endian typed-array PCM interleaving** (P1 candidate). [interleaved-float32-pcm.ts:40](../../src/common/editor/interleaved-float32-pcm.ts).

   Each sample uses optional channel indexing, Number(sample) and DataView.setFloat32. stagedDesktopWavPcm and desktop stream encoding call this helper. When destination is aligned and host little-endian, write directly through Float32Array after geometry checks; hoist channel count/frame offset and keep existing DataView fallback.

   Validate with packet interleaving CPU, bitwise sample/byte equality, Electron export phase latency, renderer long tasks, and aligned/misaligned/destination-offset coverage. Reproduce with scripts/performance/measure-pcm-helpers.mjs; raw results are in editing-performance-measurements.json.

78. **Specialize WAV PCM decoding once per format** (P2 candidate). [wav-pcm-chunk-reader.ts:325](../../src/common/editor/wav-pcm-chunk-reader.ts).

   For every sample decodeInterleavedPcm calls readPcmSample, which tests sampleFormat through uint8/int16/int20/int24/int32/float branches at 335-345. Select the decoding loop once per inspected descriptor; add aligned float32 and native typed integer paths where safe, preserving24-bit and valid-bit semantics.

   Validate with pCM decode CPU per chunk, import/Apply wall time, main-thread long tasks and existing PCM-format conformance fixtures.

79. **Prepare desktop assistance media directly into native custody** (P1 candidate). [local-assistance-audio-preparation.ts:67](../../src/common/editor/controller/assistance/internal/audio/local-assistance-audio-preparation.ts).

   Selected PCM is encoded into a renderer memory/OPFS WAV spool, then local-assistance-bridge.ts:191-195 hashes its Blob and streams/stages it again into desktop custody. Add a main-owned preparation capability to conform admitted selected PCM directly into the authenticated assistance staging file. Keep operation/selection fences and avoid exposing paths to renderer.

   Validate with generate-click-to-inference-start, bytes written/read across renderer/native staging, peak RSS, timeline input latency and fence/custody tests.

80. **Hash accepted generated speech incrementally outside the renderer** (P1 candidate). [local-assistance-text-to-speech-project-service.ts:119](../../src/common/editor/controller/assistance/local-assistance-text-to-speech-project-service.ts).

   accept reads the complete reviewed audio arrayBuffer and calls synchronous noble SHA256 before publishing, with allowed output up to 128 MiB. Use an off-main-thread bounded digest or carry the verified exact-Blob digest through review into acceptance under an immutable custody binding.

   Validate with accept-to-track-visible time, longest renderer task, peak bytes and tampered output/review binding tests.

81. **Publish independent separation result sources with bounded parallelism** (P2 candidate). [local-assistance-audio-publication.ts:143](../../src/common/editor/controller/assistance/internal/audio/local-assistance-audio-publication.ts).

   Audio result acceptance publishes each output source sequentially before committing one final project command. Admit a small parallel writer pool or pipeline distinct D/M/E source storage stages while preserving an all-or-nothing final command and complete rollback list.

   Validate with apply-to-project-visible time, storage/compression overlap, peak working bytes and partial failure/cancel rollback tests.

82. **Keep admitted ONNX sessions warm across successful jobs** (P1 candidate). [assistance-runtime-family-thread-worker.ts:49](../../desktop/assistance-runtime-family-thread-worker.ts).

   A new Worker with job data is made per job; ONNX adapters create InferenceSession and release it in finally (e.g.enhancement worker 185/236, Kokoro109/140). Retain a bounded model session in an isolated reusable worker keyed by authenticated artifact digest and exact settings, retiring the worker on failure/cancel and unloading after idle policy.

   Validate with second/third job inference-start latency, total warm Generate latency, model-load CPU, RSS cap and cancellation/foreign-job isolation tests.

83. **Avoid restarting Whisper and loading its model per VAD segment** (P1 candidate). [assistance-whisper-cpp-worker.ts:203](../../desktop/assistance-whisper-cpp-worker.ts).

   Each detected voice-activity segment is written to segment.wav and then runWhisperCli spawns the CLI with --model (229-250). Use a supervised batch/native Whisper session that retains one authenticated model for all VAD ranges, preserving per-range timestamps and deterministic language settings.

   Validate with cLI spawn count, model load time, transcript wall time, real-time factor and segment offset/language/tokens parity.

84. **Reuse a supervised llama model and invariant prompt prefix** (P1 candidate). [assistance-llama-cpp-worker.ts:127](../../desktop/assistance-llama-cpp-worker.ts).

   Every editorial job runs llama CLI with --model and --single-turn; utility family warmth does not preserve the CLI model/KV state. Introduce a supervised offline inference service with digest-bound resident model and reusable invariant prompt prefix; reset job-specific state and retire on cancel/failure.

   Validate with repeated Generate latency, model reloads, tokens/sec, prefix evaluation time, deterministic JSON/grammar outputs and cross-job data isolation.

85. **Tune inference thread budgets to actual desktop hardware and competing work** (P2 candidate). [assistance-onnx-worker-common.ts:63](../../desktop/assistance-onnx-worker-common.ts).

   ONNX fixes intraOp threads to 4 and interOp to 1; Whisper/llama also hardcode4, while Sherpa defaults2. Derive a bounded shared inference thread budget from available cores and active work, benchmark task-specific choices, and preserve UI/audio headroom under concurrent jobs.

   Validate with generate p50/p95, inference throughput, dropped playback packets, timeline frame times and CPU contention at 2/4/8 thread settings.

86. **Avoid recomputing DeepFilter overlapping context features** (P2 candidate). [assistance-onnx-enhancement-separation-worker.ts:202](../../desktop/assistance-onnx-enhancement-separation-worker.ts).

   Default 4-second cores include 1-second context on each side; source frames and full analysis are reread/recomputed for adjacent windows. Cache overlap PCM/STFT/ERB feature work where normalization semantics allow, or increase the bounded core span under Speed after boundary quality tests.

   Validate with analyzed frames/source frame, prep DSP CPU, total enhancement real-time factor and seam/reference error.

87. **Batch or pipeline independent DeepFilter channel work** (P2 candidate). [assistance-onnx-enhancement-separation-worker.ts:209](../../desktop/assistance-onnx-enhancement-separation-worker.ts).

   For each chunk, channels are analyzed, inferred and synthesized sequentially, with a model batch dimension fixed to 1. Pipeline bounded channel analysis/synthesis against the existing inference session, reserving UI cores. Only consider model batching after a separately authenticated model graph demonstrates compatible batch geometry; current model fixes batch dimension to one.

   Validate with channel batch throughput, whole enhancement time, RSS and per-channel reference/boundary equality.

88. **Reuse DeepFilter Bluestein transform scratch buffers** (P2 candidate). [deepfilternet3-signal-v1.ts:288](../../src/common/editor/assistance/deepfilternet3-signal-v1.ts).

   Every transformBluestein forward call allocates two Float64Array buffers of convolutionSize; analysis/synthesis call this for many960-sample FFT frames. Create a job-owned/reentrant transform workspace and reuse workReal/workImaginary with required tail zeroing, or evaluate a tested960-point native/SIMD FFT adapter.

   Validate with allocations/FFT frame, DSP CPU, worker GC pause, full Generate latency and deterministic/reference tolerance tests.

89. **Stream Kokoro output chunks into its reserved WAV sink** (P2 candidate). [assistance-onnx-kokoro-worker.ts:112](../../desktop/assistance-onnx-kokoro-worker.ts).

   All generated Float32 waveforms are retained in chunks, then encodePcm16Wave constructs full output before publishAssistanceOnnxOutput writes it. Write quantized PCM chunks into the authenticated reserved sink as each sentence finishes, maintain incremental digest/frame count and finalize the WAV header atomically.

   Validate with peak worker RSS, post-inference encode/publication latency, total Generate time and exact WAV/header/sample/digest parity.

90. **Reuse an authenticated G2P closure within a supervised speech worker lifetime** (P2 candidate). [assistance-kokoro-g2p-runtime.ts:85](../../desktop/assistance-kokoro-g2p-runtime.ts).

   Every phonemize request loads manifest, inventories every closure file and hashes them serially before spawning the helper; authenticateClosure loop is175-178. Authenticate a private immutable closure/snapshot once for a bounded supervised worker lifetime, pin exact identity and invalidate/reverify on changes; optionally keep the G2P subprocess warm.

   Validate with generate-to-first-token latency, closure bytes hashed/request, G2P process starts and tamper/replacement invalidation tests.


### Controller and analysis

91. **Detach only changed immutable project branches for publication** (P1 candidate). [document-snapshot.ts:421](../../src/common/editor/controller/document/document-snapshot.ts), [document-snapshot.ts:424](../../src/common/editor/controller/document/document-snapshot.ts), [document-snapshot.ts:447](../../src/common/editor/controller/document/document-snapshot.ts), [editor-project.ts:113](../../src/soundscaper/editor-project.ts).

   The existing top-level WeakMap reuses a detached project while its identity stays unchanged. Every new canonical project identity recursively copies/freezes the entire project with a new traversal WeakMap, including unchanged clips, tracks and metadata. Soundscaper's clone helper currently structuredClone-copies the document, so a nested-identity cache alone cannot reuse those newly cloned leaves. Introduce explicit immutable ownership and copy-on-write authored updates, then retain detached unchanged subtrees by owned identity/version; publish only edited paths. An alternative is a trusted command change-set for incrementally updating the detached view. Keep full detachment for untrusted/mutable inputs.

   Validate with visited/copied snapshot nodes and allocated bytes per small edit, snapshot build CPU, command-to-visible-result p50/p95, retained cache bytes.

92. **Retain effect-type catalog snapshots for each registry and locale** (P2 candidate). [snapshot-composition.ts:32](../../src/common/editor/controller/composition/snapshot-composition.ts), [document-snapshot.ts:57](../../src/common/editor/controller/document/document-snapshot.ts), [document-snapshot.ts:379](../../src/common/editor/controller/document/document-snapshot.ts).

   Every document publication remaps the rack and selection effect registries into fresh frozen objects, recomputes hasSettings using Object.keys, and obtains a fresh video-definition array even when the registry/copy has not changed. Build the frozen effect catalogs once per snapshot composition or cache them by registry revision and localized copy identity; preserve invalidation when translations or registry contents change.

   Validate with registry mapping/Object.keys invocations and effect-catalog allocations per publication; snapshot build CPU and dependent menu renders.

93. **Reuse admitted preset normalization and per-effect lists** (P2 candidate). [snapshot-composition.ts:36](../../src/common/editor/controller/composition/snapshot-composition.ts), [effect-presets.js:15](../../src/common/editor/effect-presets.js), [effect-presets.js:32](../../src/common/editor/effect-presets.js).

   Every document snapshot calls listAudioEditorEffectPresets, which normalizes every saved preset, checks ID uniqueness and freezes another normalized state before filtering for the current effect and appending factory presets. Unrelated project/status publications repeat this work over the whole library. Retain normalization at an explicit admission boundary for an immutable preset-state identity, and cache its display list by preset revision/current effect/factory registry revision. Keep validation for arbitrary imported or mutable inputs.

   Validate with preset normalizations and allocated parameter objects per publish, snapshot build CPU at 100/1,000/5,000 saved presets, preset-menu render counts.

94. **Retain detached macro and script libraries until their revision changes** (P2 candidate). [document-snapshot.ts:394](../../src/common/editor/controller/document/document-snapshot.ts), [document-snapshot.ts:439](../../src/common/editor/controller/document/document-snapshot.ts), [effect-macro-library-service.ts:101](../../src/common/editor/controller/effects/effect-macro-library-service.ts), [macro-script-library-service.ts:118](../../src/common/editor/controller/effects/macro-script-library-service.ts).

   Every snapshot recursively materializes and freezes the entire macro library and script library using a fresh traversal map, although their services replace library state only on explicit library edits/imports. Unlike preferences and project lists, these potentially large detached values have no retained publication identity. Cache detached macros/scripts by the controller-owned immutable library identity or explicit revision; return a stable frozen empty value. Invalidate on import/save/delete and preserve mutation isolation.

   Validate with library entries/script bytes copied and allocated per unrelated publish, snapshot CPU, dependent macro menu render count, bounded retained memory.

95. **Batch synchronous controller presentation transitions into one publication** (P2 candidate). [presentation-state.ts:25](../../src/common/editor/controller/composition/presentation-state.ts), [presentation-state.ts:40](../../src/common/editor/controller/composition/presentation-state.ts), [analysis-service.ts:349](../../src/common/editor/controller/analysis/analysis-service.ts), [snapshot-channel.ts:31](../../src/common/editor/controller/composition/internal/snapshot-channel.ts).

   setStatus and showAnalysis publish immediately. Analysis begin first sets busy, then setLocalizedStatus triggers a snapshot, then explicitly publishes an identical state again. Success publishes result, status and finally busy=false separately. SnapshotChannel rebuilds synchronously and notifies listeners on every call even when React can batch later rendering. Add explicit scoped presentation transactions or no-publish state setters so each synchronous busy/start and completion transition publishes once after all owned fields are set. Suppress identical status replacements. Preserve an initial busy publication before expensive work begins.

   Validate with snapshot builds/subscriber notifications per operation and build CPU; busy-first-paint and final-result latency; cancellation/stale-owner tests.

96. **Publish the requested specialized analysis before independent generic metrics finish** (P2 candidate). [analysis-service.ts:204](../../src/common/editor/controller/analysis/analysis-service.ts), [analysis-service.ts:333](../../src/common/editor/controller/analysis/analysis-service.ts), [AnalysisPanel.jsx:92](../../src/common/editor/ui/inspector/AnalysisPanel.jsx), [AnalysisPanel.jsx:119](../../src/common/editor/ui/inspector/AnalysisPanel.jsx).

   Plot Spectrum and Find Clipping await renderAndAnalyze, including complete EBU/true-peak/generic metrics, before starting their independent report computation. The specialized report cannot become visible until both serial phases finish. After the single authored mix render, start specialized reporting and generic metrics as independent owned tasks; publish the specialized report as soon as ready, then publish the completed generic metrics/visuals. Retain all existing metrics and disable/export or mark incomplete payloads until they are complete.

   Validate with click-to-specialized-report first paint versus click-to-complete-analysis, total CPU, extra buffer bytes and renderer frame gaps; report equality and project-change cancellation.

97. **Persist completed analysis after displaying the result** (P2 candidate). [analysis-service.ts:174](../../src/common/editor/controller/analysis/analysis-service.ts), [analysis-service.ts:177](../../src/common/editor/controller/analysis/analysis-service.ts), [analysis-service.ts:184](../../src/common/editor/controller/analysis/analysis-service.ts).

   On a levels-analysis cache miss, the complete result and visuals are ready but the service awaits cache persistence before showAnalysis. Slow analysis-store writes delay result visibility; a cache write failure prevents the computed report from being shown. Assert ownership and publish the complete result first, then schedule bounded tracked cache persistence outside the display critical path with captured revision/key and explicit failure handling. Preserve flush/disposal semantics where required.

   Validate with time from DSP completion to analysis first paint, injected cache-write latency versus UI completion, persistence queue depth and retry/error behavior.

98. **Run spectrum, clipping and delivery loudness reporting off the renderer** (P1 candidate). [analysis-service.ts:412](../../src/common/editor/controller/analysis/analysis-service.ts), [analysis-service.ts:429](../../src/common/editor/controller/analysis/analysis-service.ts), [analysis-service.ts:301](../../src/common/editor/controller/analysis/analysis-service.ts), [audio-spectrum.ts:29](../../src/common/editor/audio-spectrum.ts), [waveform-analysis.ts:238](../../src/common/editor/controller/source/waveform-analysis.ts).

   After rendering, specialized spectrum averages every half-overlapping FFT window synchronously; clipping scans every sample synchronously; Measure Loudness calls synchronous EBU measurement. These direct calls run in the renderer despite generic levels analysis already having a worker implementation. Extend a bounded analysis worker protocol with specialized report jobs, ordered chunking/backpressure and cancellation; keep numerical reporting algorithms unchanged. Borrow/copy/transfer PCM according to explicit ownership, since the same channels may feed generic metrics and visuals.

   Validate with renderer long-task maximum and p95 animation frame interval during each analyzer, click-to-report latency, worker CPU and peak memory; exact bins/regions/loudness equivalence.

99. **Cache specialized reports by authored content and normalized analysis options** (P2 candidate). [analysis-service.ts:155](../../src/common/editor/controller/analysis/analysis-service.ts), [analysis-service.ts:196](../../src/common/editor/controller/analysis/analysis-service.ts), [analysis-service.ts:284](../../src/common/editor/controller/analysis/analysis-service.ts).

   The levels path uses a project/revision/scope/track/range cache, while spectrum, clipping and loudness commands always rerender and recompute. Repeating an unchanged specialized request pays the full offline rendering, generic analysis and report cost again. Use a bounded revision-keyed complete-report cache for spectrum/clipping/loudness, including normalized effective FFT size, threshold/consecutive count, selected scope, ADM weighting and relevant render/runtime settings. Reuse the generic results/visuals where keys match. Validate admission before lookup and invalidate on any audible-content/settings change.

   Validate with offline renders and sample/FFT passes per identical repeat, repeat click-to-report p50/p95, cache hit rate/bytes and invalidation correctness.

100. **Retain command projections within the admitted immutable controller document** (P1 candidate). [controller-project-queries.ts:16](../../src/common/editor/controller/composition/controller-project-queries.ts), [editor-project-commands.ts:268](../../src/soundscaper/editor-project-commands.ts), [runtime-clip-projection.ts:165](../../src/common/editor/runtime-clip-projection.ts), [runtime-clip-projection.ts:174](../../src/common/editor/runtime-clip-projection.ts).

   Each controller command read calls the product command projection again. Soundscaper validates the complete canonical document, then resolves and freezes all timeline clips, tracks, project-bin clips and annotations. Runtime projection branding only avoids resolving an already projected result; the controller reader does not retain that result for its unchanged canonical identity. Memoize the product command/runtime projection in the controller reader for the admitted immutable project identity (plus any projection-relevant runtime policy), invalidating on document replacement. Retain uncached validation for arbitrary mutable external inputs and preserve product-owned extension fields.

   Validate with canonical validation/projection invocations and projected clip allocations per current identity, controller preparation CPU and command-to-result latency on 10,000-100,000 clips.

## Reproduction and correctness checks

Use the prescribed Node and npm versions. For a normal desktop artifact, prepare the app with the repository's desktop workflow and committed test-runtime snapshots; this audit does not compile or publish AI archives. The Electron script expects a staged Soundscaper app under `.desktop-build/app` and creates and removes an isolated profile. It verifies the default Speed preference through the existing menu.

```sh
xvfb-run -a node --import tsx scripts/performance/measure-electron-editing.mjs
node --import tsx scripts/performance/measure-editing-kernels.mjs
node --import tsx scripts/performance/measure-pcm-helpers.mjs
node --import tsx scripts/performance/measure-timeline-work.mjs
node --import tsx scripts/performance/measure-controller-work.mjs
```

The work probes depend on the cited baseline mechanisms, and the kernel substitution harness deliberately asserts the audited source pattern before creating a prototype. Update fixtures deliberately when those mechanisms change. Wall-clock values are observations, not CI thresholds. Start an implementation with a failing behavior/operation-count regression for its scenario, then establish parity before comparing timing on the same host, fixture and desktop preference. Compare total completion separately from first useful feedback and renderer scheduling; shorter compute can coexist with a foreground storage or publication stall.

Validation for this audit passed the production web build and its chunk/runtime guards, fresh desktop compilation/staging and production renderer build, all 17 Electron measurements with real playback advancement, the numerical/operation probes, and 66 focused existing tests for generation, snapshots, presets, snapping and selection-worker lifecycle. Changed-file lint and the repository size check passed. No application, dependency, budget, translation or runtime source was changed; full Node and multi-engine browser suites were not rerun for this audit-only change.

A manual **Update AI assets** run is **not required** for this audit and its reproduction tools. Implementing proposals that alter generated assistance runtime bytes or target inventories must reassess that requirement.
