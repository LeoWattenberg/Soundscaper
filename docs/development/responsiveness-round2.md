# Editor responsiveness and render work

This register indexes 100 new reductions in production work during editing,
Apply and Generate operations, audio rendering, automation scheduling and
interactive timeline updates. It excludes initial loading, including the web
editor's expected lazy-loading bottleneck, and the 74 implemented changes in the
[earlier responsiveness audit](editing-performance-opportunities.md).
The comparison starts from revision
`1b9a6ce76b66b810a6dd30b94ad0f50559fbddab`.

The numbered entries identify separate avoided costs at production call sites.
Several share a helper or workflow probe; those probes establish the combined
work reduction, not an isolated latency contribution from each entry. A shared
DSP optimization used by both live and offline processing is counted once.
The machine-readable registers own each finding's exact test, evidence,
limitations and implementation status.

| Entries | Production area | Findings and evidence |
| --- | --- | --- |
| 1–30 | Editing commands and rendered-result publication | [Editing register](performance-round2-editing.json) |
| 31–60 | Timeline presentation and pointer updates | [Timeline register](performance-round2-timeline.json) |
| 61–70 | Metering, automation and playback preparation | [Runtime register](performance-round2-runtime.json) |
| 71–100 | Effects, generation, spectrum and resampling | [DSP register](performance-round2-dsp.json) |

The [measurement artifact](performance-round2-measurements.json) retains the
complete Electron observations, host context and warmed runtime kernel pairs.

## Interpret the evidence

Accessor counts, eliminated scans, allocations, mathematical calls, React commits
and DOM writes make the removed work reviewable. They do not establish an equal
percentage change in elapsed time. Allocation behavior, JIT compilation,
worker preparation, storage and raster work can dominate a complete operation.
Some proposed reductions were discarded after representative warmed timing
showed a slowdown; the registers record that decision rather than counting them.

The checks preserve PCM arithmetic and deterministic ordering, caller ownership,
validation, cancellation and final publication. Invocation-local editing indexes
retain mutable direct-caller semantics. Unaffected authored track membership
order is preserved; touched tracks are sorted. Ambiguous duplicate identity or
ownership uses compatibility fallbacks, and persisted command admission still
rejects malformed documents. The editing register describes the direct-helper
boundary explicitly. Retained timeline and runtime results depend on admitted
immutable identity or a detached private snapshot; arbitrary mutable caller
objects do not qualify for a global identity cache.

## Measure with Electron's default Speed preference

Use the [Electron editing harness](../../scripts/performance/measure-electron-editing.mjs)
with freshly rebuilt baseline and changed desktop renderer artifacts and the
same staged native assets. Each launch uses a fresh temporary profile, verifies
**Optimize for: Speed** in General preferences, and waits for
`data-desktop-speed-warmup="ready"` with zero warmup failures. Record revision,
Node/Electron versions, CPU, viewport, device-pixel ratio and GPU feature status.
The harness exercises the real preload, SQLite, PCM and worker paths in the
Electron development app.

Apply and Generate clocks start at the actual button click. Completion requires
the dialog to close, success status, no pending waveform, a successful Audacity
waveform canvas and two animation frames. Menu navigation, fixture construction
and startup stay outside that clock. Report the first-use trial separately from
subsequent warm trials; Undo restores the same input between effect trials.
The default cases cover 30-second Tone, 30- and 120-second pink Noise, and
120-second Amplify and Compressor. `--extended` adds Chirp and Normalize and
expands the timeline fixture from eight clips to 64.

Timeline observations sample three seconds of idle, active playback and, in the
extended run, trusted mouse sweeps and bidirectional wheel scrolling. Assertions
require a positive playhead advance, changing hover positions and more than
100 pixels of scroll movement. Under Xvfb, animation-frame intervals describe
renderer scheduling responsiveness; they are not GPU presentation framerate.
Alternate baseline and changed runs on the same host, retain the raw reports,
and describe local variability. A few local trials do not estimate a population
p95. Separate work-count assertions from end-to-end timings and isolated kernels.
The [runtime comparison harness](../../scripts/performance/measure-responsiveness-runtime.mjs)
checks result parity before alternating warmed baseline/current kernel trials.

The final comparison used baseline `1b9a6ce76` and production source
`150ba92fd`, harness Node 26.5.0, Electron 43.7.7 (embedded Node 24.21.0),
Chromium 150 and a 1280×900 viewport at device-pixel ratio 1 on an AMD Ryzen
9 9900X under Linux/WSL. Application
runtime JavaScript and the renderer were rebuilt for each revision; the same
staged native assets were reused. Two fresh-profile pairs ran in opposite
orders: baseline/current, then current/baseline. All four profiles passed
the completion, Speed, warmup, playback and gesture assertions.

These are the medians of four warm observations per revision; first-use
observations remain separate in the raw artifact:

| Operation | Audio length | Baseline, ms | Changed, ms |
| --- | ---: | ---: | ---: |
| Generate Tone | 30 s | 700.7 | 534.9 |
| Generate Chirp | 30 s | 731.1 | 621.8 |
| Generate pink Noise | 30 s | 671.0 | 595.2 |
| Generate pink Noise | 120 s | 1204.7 | 1086.3 |
| Apply Amplify | 120 s | 3672.7 | 3088.2 |
| Apply Compressor | 120 s | 3566.3 | 3301.5 |
| Apply Normalize | 120 s | 4960.5 | 2800.4 |

Other tasks were active on this shared host, and load changed during the runs.
Amplify's DSP was unchanged, so its whole-operation variation also exposes
storage, renderer and host effects. These measurements establish observations
for the combined branch, not a stable percentage gain attributable to each
numbered cost. Normalize showed a reduction in both run orders.

The 64-clip idle frame p95 stayed about 16.67 ms and playback about 33.33 ms.
During dense scroll/hover, baseline sample p95 values were 100.00 and 83.33 ms;
changed samples were 83.33 and 83.32 ms. Their maximum gaps were respectively
133.32/100.00 and 116.65/116.67 ms. That does not establish a consistent
framerate improvement across both pairs. Timeline operation-count and retained
presentation tests establish the removed work independently.

The final runtime harness compared exact results outside timing, followed by
32 alternating warmups and seven measured alternating trials. Its medians were:

| Isolated runtime case | Baseline, ms | Changed, ms |
| --- | ---: | ---: |
| Unchanged 128-strip snapshots, 10,000 queries | 3.782 | 0.046 |
| Curved musical automation, 200 tempo events | 1003.680 | 13.966 |
| Latency plan, 20,000 tracks | 2.787 | 1.677 |

These fixtures stress specific production costs and do not represent typical
project sizes or whole-workflow latency. DSP kernel observations and their
uncounted compatibility work are recorded separately in the DSP register.

To repeat the comparisons, provide baseline and changed checkouts with matching
staged `.desktop-build` applications, rebuilding their application runtime and
renderer from their own sources. Run the same current harness from each checkout:

```sh
xvfb-run -a node --import tsx /path/to/changed/scripts/performance/measure-electron-editing.mjs /tmp/electron.json --extended
node --import tsx scripts/performance/measure-responsiveness-runtime.mjs /path/to/baseline /path/to/changed /tmp/runtime.json
```

## Validation and runtime assets

`npm run check` passed with Node 26.5.0 and npm 12.0.1. That includes the full
repository lint, source/product/test/tooling TypeScript, architecture and size
gates, runtime and notice audits, handbook checks, production build and the full
Node suite: 22,701 passed, 32 skipped, zero failed. The skips are opt-in reference
tests and native fixtures unavailable on this host, including the pinned Boost
closure; they are not new exclusions introduced by this branch. The isolated
Electron protocol test ran under a private Xvfb display. Fresh Node-only coverage
was produced; CI checks coverage floors over the merged Node and Chromium
profiles, so this local Node report was not used to change those floors.

`npm run lint:changed` passed at handoff. Production chunks stay below the
500,000-byte ceiling, and `npm run check:startup-graph:tighten` found no initial
graph byte ceiling to tighten. `npm run check:size:tighten` found no recovered
ratchet belonging to this change; unrelated existing ratchets were left intact.

The full `npm run test:browser` run completed all 4,281 cases across Chromium,
Firefox and WebKit: 4,084 passed, 188 skipped and nine failed, so the command
exited 1. It ran on the shared host with the existing WSLg PulseAudio server,
four Playwright workers and loopback ports 4362/4363. All nine failed cases
passed subsequent isolated runs against the same production build, without
changing their source or assertions. These reruns establish that the workflows
can complete; they do not make the original full-suite result a clean pass.

| Original failure | Stage and isolated result |
| --- | --- |
| Chromium pinned device routes and realtime dialog navigation | Both stopped at the initial 20-second editor-mount wait, before their interaction. Both passed together on rerun. |
| Chromium parallel effect preview/cancel | Stopped at initial worker readiness before Tremolo controls or Escape. Passed twice in separate reruns. |
| Chromium AIFF-C import | Stopped at editor mounting before import. The complete two-case AIFF import file passed on rerun. |
| Firefox folder mute delivery | The first muted export contained audible signal. Passed on rerun. Existing export UI retains the previous download link while rendering; reading that link before replacement is a plausible race, but the original run did not retain enough evidence to prove it. |
| WebKit spreadsheet boolean paste | Paste assertions passed, then the first keyboard Undo did not restore the value within five seconds. Passed on rerun. Paste completion/focus timing remains a possible cause, not an established diagnosis. |
| WebKit paste into an existing clip | Paste, Undo and Redo passed. After reload, the broad `[data-clip-id]` selector matched both the timeline clip and an inspector fade target. This is a confirmed test-selector ambiguity in unchanged code. Passed on rerun. |
| WebKit compound-meter punch recording | Scheduling, exact clip geometry, persistence and the surrounding audio passed. The captured 440 Hz amplitude was 0.0515 against a 0.06 threshold. Passed on rerun; the original capture's amplitude cause remains unresolved. |
| WebKit generated visual inspector | Both Apply operations and the rendered-frame digest checks passed. After reload, the inspector showed Noise when the test expected Test Image. Passed on rerun. Relevant selection/inspector code is unchanged; restored-selection timing is plausible but unproven. |

The original assertions and screenshots were inspected in `test-results/`;
isolated reruns also recorded traces. Those generated diagnostics are not
committed. No browser expectations, retries or timeouts were relaxed.

All 96 observations across the four final Electron profiles passed the actual
Apply/Generate completion, default Speed, warmup, playback and gesture assertions.
The committed tests include 162 exact pre-change DSP hashes and deterministic
work counts. Independent supplemental comparisons covered 612 runtime cases,
121 adversarial DSP scenarios and three actual StaffPad cases. They preserve
successful arithmetic and publication behavior within the documented caller
boundaries; they do not turn the local timing observations into causal estimates
for each numbered change.

A manual **Update AI assets** run is not required. These changes retain the
existing assistance-runtime closure, recipes, pins, archives and target inventories.
The application desktop-effect inventory gained `prepared-distortion.js` for
the compiled Audacity helper; that inventory belongs to the application runtime
and does not change the generated assistance archives.

## Editing commands and rendered publication: 1–30

Each entry below links its production source and checks. Detailed evidence and
compatibility limits are keyed by ID in the [editing register](performance-round2-editing.json).

1. **Expand each clip relationship once.** Replace complete-document rescans per relationship-chain hop with one traversal of each group and A/V link.

   Evidence: 600 alternating-chain clips: 1439400 relationship reads before, 2400 after.
   [Source](../../src/common/editor/commands/editing-selection-authority.ts) (`collectRelatedClipIds / expandRelatedClipIds`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-01`.

2. **Reuse the selection availability map.** Pass the existing availableClips map into relationship expansion instead of indexing every clip twice.

   Evidence: One availability map per authority resolution; same graph helper consumes it.
   [Source](../../src/common/editor/commands/editing-selection-authority.ts) (`resolveEditingSelectionAuthority`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-02`.

3. **Index owners for selection authority.** Build first-owner membership lookup once instead of searching track clipIds for every selected clip.

   Evidence: 250 clips in 250 tracks: 31375 membership reads before, 250 after.
   [Source](../../src/common/editor/commands/editing-selection-authority.ts) (`resolveEditingSelectionAuthority`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-03`.

4. **Index owners for resolved selections.** Resolve every selected clip owner through one membership table instead of a track search per clip.

   Evidence: Full selection resolution uses at most three reads per track; preserves missing-owner refusal.
   [Source](../../src/common/editor/commands/editing-selection-authority.ts) (`resolveEditingSelection`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-04`.

5. **Resolve clips before sorting.** Resolve clip IDs once before sorting rather than performing two linear project searches per comparison.

   Evidence: 1000 reversed clips: 999999 identity reads before, 1000 after. A two-clip early track visits only its two records, avoiding a scan of the unrelated 10000-clip tail.
   [Source](../../src/common/editor/commands/shared-runtime.js) (`sortTrack`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-05`.

6. **Capture sort geometry once.** Capture each participating clip start and stable tie ID once, eliminating repeated clip property reads in comparisons.

   Evidence: Comparator accesses local geometry records; deterministic code-unit tie behavior verified.
   [Source](../../src/common/editor/commands/shared-runtime.js) (`sortTrack`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-06`.

7. **Skip unused selection-pruning indexes.** Construct track, clip and annotation identity sets only for identity dimensions actually present in selections.

   Evidence: Range-only selection: four project collection reads before, zero after.
   [Source](../../src/common/editor/commands/shared-runtime.js) (`pruneMissingProjectSelections`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-07`.

8. **Omit removed timing without track ripple.** Skip collecting and resolving removed clip objects when deletion does not need track ripple geometry.

   Evidence: Non-ripple removal of two clips from one dense track: two removed timing reads before, zero after.
   [Source](../../src/common/editor/commands/clip-basic-runtime.js) (`removeClips`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-08`.

9. **Index removed clips for ripple.** Resolve removed clips through one local map instead of linearly searching the project for each removal.

   Evidence: Removed membership conversion uses clipById.get once per removed ID.
   [Source](../../src/common/editor/commands/clip-basic-runtime.js) (`removeClips removedByTrack`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-09`.

10. **Remove the redundant deletion sort.** Remove the initial removed-clip sort because mergeEditingRanges sorts and merges the ranges itself.

   Evidence: One range sort replaces two sorting passes on removed material.
   [Source](../../src/common/editor/commands/clip-basic-runtime.js) (`removeClips removedByTrack`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-10`.

11. **Reuse indexed surviving clips.** Reuse the deletion map for survivor timing and track sorting instead of project searches per survivor.

   Evidence: Survivor and sort lookups use the same invocation map after filtered publication.
   [Source](../../src/common/editor/commands/clip-basic-runtime.js) (`removeClips surviving clip loop`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-11`.

12. **Query completed removals through prefix sums.** Replace a full removed-range reduction per survivor with a cumulative completed-boundary lookup.

   Evidence: 1000 removals: hot queries read no original entry properties and match reductions including coincident boundaries.
   [Source](../../src/common/editor/commands/clip-basic-runtime.js) (`removeClips shiftAt`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-12`.

13. **Sort a same-track move once.** Sort a same-track move once instead of sorting the identical track through both old and destination references.

   Evidence: Guard targetTrack !== oldTrack removes the second identical sort.
   [Source](../../src/common/editor/commands/clip-basic-runtime.js) (`moveClip`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-13`.

14. **Sort a same-track overwrite once.** Avoid sorting the same track twice after an overwrite that stays on its original track.

   Evidence: Guard targetTrack !== oldTrack removes duplicate sort invocation.
   [Source](../../src/common/editor/commands/clip-transform-runtime.js) (`overwriteClip`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-14`.

15. **Index transform input clip IDs.** Resolve each transformed clip using one local ID map instead of searching all clips per transform.

   Evidence: One clip map serves the complete transform list.
   [Source](../../src/common/editor/commands/clip-transform-runtime.js) (`buildClipTransformState clips`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-15`.

16. **Index transform destination tracks.** Resolve destination tracks through one track map instead of repeated linear track searches.

   Evidence: Destination selection uses tracks.get(trackId); missing IDs still throw.
   [Source](../../src/common/editor/commands/clip-transform-runtime.js) (`buildClipTransformState tracks`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-16`.

17. **Index transform original owners.** Resolve original clip tracks through one membership table rather than scanning track clipIds per transform.

   Evidence: Owner lookup uses one clipOwnerIndex for the full transform list.
   [Source](../../src/common/editor/commands/clip-transform-runtime.js) (`buildClipTransformState owners`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-17`.

18. **Index transform source bounds.** Reuse source ID lookup for every transformed clip source-bound assertion instead of linear source searches.

   Evidence: assertClipSourceBounds receives the resolved source; unknown source retains existing fallback/refusal.
   [Source](../../src/common/editor/commands/clip-transform-runtime.js) (`buildClipTransformState sources`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-18`.

19. **Group transformed clips by destination.** Group changed clips by destination once rather than filtering the full transform list separately for every track.

   Evidence: Track reconstruction reads updatesByTrack.get(track.id).
   [Source](../../src/common/editor/commands/clip-transform-runtime.js) (`transformClips updatesByTrack`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-19`.

20. **Retain unaffected track memberships.** Keep unaffected track memberships instead of reconstructing and sorting every media track after a local transform.

   Evidence: A one-clip transform retains all 39 unrelated membership arrays and reads zero unrelated geometry fields.
   [Source](../../src/common/editor/commands/clip-transform-runtime.js) (`transformClips changedTrackIds`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-20`.

21. **Index post-transform survivors.** Read post-publication surviving clips through a local map rather than searching the new project array per track member.

   Evidence: Survivor reconstruction uses clipById.get once per surviving member on affected tracks.
   [Source](../../src/common/editor/commands/clip-transform-runtime.js) (`transformClips clipById`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-21`.

22. **Index rendered target clips.** Resolve rendered targets through one local clip map rather than searching the complete document for each target.

   Evidence: Combined 200-clip / 25-target fixture: 20625 identity reads before, 875 after.
   [Source](../../src/common/editor/commands/clip-basic-runtime.js) (`replaceRenderedClips entries`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-22`.

23. **Index existing replacement source IDs.** Build the current source ID set once for all generated replacement source uniqueness checks.

   Evidence: One sources.map replaces entries.length complete source scans.
   [Source](../../src/common/editor/commands/clip-basic-runtime.js) (`replaceRenderedClips sourceIds`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-23`.

24. **Reuse the relationship graph across rendered components.** Build relationship indexes once for an entire rendered operation instead of rebuilding them for every independent component.

   Evidence: createRelatedClipReader shares one local graph across 25 component queries.
   [Source](../../src/common/editor/commands/clip-basic-runtime.js) (`replaceRenderedClips readRelated`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-24`.

25. **Index rendered component targets.** Select each component target from an entry index instead of filtering every rendered entry for every component.

   Evidence: Entries are grouped by clip ID and sorted by original ordinal within a component.
   [Source](../../src/common/editor/commands/clip-basic-runtime.js) (`replaceRenderedClips entryById`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-25`.

26. **Index rendered component owners.** Resolve related clip track IDs through one owner table instead of linear track membership searches per component clip.

   Evidence: One ownership table handles all independent components; existing grouped ripple parity tests pass.
   [Source](../../src/common/editor/commands/clip-basic-runtime.js) (`replaceRenderedClips owners`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-26`.

27. **Ripple only rendered component tracks.** Ripple only memberships on component tracks rather than scanning every project clip and resolving every owner.

   Evidence: Unrelated track clip objects remain identical and at their original geometry.
   [Source](../../src/common/editor/commands/clip-basic-runtime.js) (`replaceRenderedClips relatedTracks`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-27`.

28. **Index related replacement entries.** Resolve the replacement entry of each related clip through a component map rather than searching its target list.

   Evidence: One targetById map per component preserves the first matching entry.
   [Source](../../src/common/editor/commands/clip-basic-runtime.js) (`replaceRenderedClips targetById`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-28`.

29. **Write rendered replacements through known array slots.** Write normalized replacement clips to recorded slots instead of running findIndex for each replaced clip.

   Evidence: Each replacement updates its slot and local clip map in O(1); earlier-component ripple test passes.
   [Source](../../src/common/editor/commands/clip-basic-runtime.js) (`replaceRenderedClips clipSlots`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-29`.

30. **Sort only tracks affected by rendered replacement.** Sort only tracks touched by rendered components and share the operation clip map instead of sorting every media track.

   Evidence: Only affectedTracks feed sortTrack; unrelated memberships and clip objects are preserved.
   [Source](../../src/common/editor/commands/clip-basic-runtime.js) (`replaceRenderedClips affectedTracks`); [checks](../../tests/audio-editor-editing-work-performance.test.ts); register ID `editing-round2-30`.

## Timeline presentation and input: 31–60

Detailed dependency, invalidation and pointer-lifecycle limits are keyed by ID
in the [timeline register](performance-round2-timeline.json).

31. **Retain timeline recording/automation track counts.**

   Evidence: Thirty unrelated React publications perform zero repeated track-type reads; one combined audio-track pass replaces two filter allocations.
   [Source](../../src/common/editor/ui/timeline/useTimelineViewportDerived.ts); [checks](../../tests/audio-editor-timeline-derived-performance.test.tsx); register ID `TL01`.

32. **Retain timeline frequency-ruler presence.**

   Evidence: Thirty unrelated publications perform zero repeated display-mode scans.
   [Source](../../src/common/editor/ui/timeline/useTimelineViewportDerived.ts); [checks](../../tests/audio-editor-timeline-derived-performance.test.tsx); register ID `TL02`.

33. **Retain output dock content height.**

   Evidence: Thirty unrelated publications perform zero repeated bus collapsed-state reads.
   [Source](../../src/common/editor/ui/timeline/useTimelineViewportDerived.ts); [checks](../../tests/audio-editor-timeline-derived-performance.test.tsx); register ID `TL03`.

34. **Retain total timeline lane height.**

   Evidence: Thirty unrelated publications perform zero repeat lane-height callback invocations.
   [Source](../../src/common/editor/ui/timeline/useTimelineViewportDerived.ts); [checks](../../tests/audio-editor-timeline-derived-performance.test.tsx); register ID `TL04`.

35. **Retain time-selection identity from frame endpoints.**

   Evidence: Selection object stays identical over thirty unrelated renders, preventing selection-dependent ruler/canvas effects.
   [Source](../../src/common/editor/ui/timeline/useTimelineViewportDerived.ts); [checks](../../tests/audio-editor-timeline-derived-performance.test.tsx); register ID `TL05`.

36. **Prune waveform caches only on clip-membership publications.**

   Evidence: Thirty unrelated publications perform zero repeated waveform-cache enumerations; removed clips are deleted.
   [Source](../../src/common/editor/ui/timeline/useTimelineViewportDerived.ts); [checks](../../tests/audio-editor-timeline-derived-performance.test.tsx); register ID `TL06`.

37. **Retain ruler scale from timing authority.**

   Evidence: Replacing the containing project thirty times preserves ruler-scale identity and its downstream tick memo.
   [Source](../../src/common/editor/ui/timeline/useTimelineRulerModels.ts); [checks](../../tests/audio-editor-timeline-derived-performance.test.tsx); register ID `TL07`.

38. **Reuse one crossfade overlap analysis.**

   Evidence: Range preparation accepts owner-supplied overlaps with zero repeat start/duration accessor reads; exact range parity passes.
   [TrackOverlapOverlays.jsx](../../src/common/editor/ui/timeline/TrackOverlapOverlays.jsx), [audio-clip-overlap.ts](../../src/common/editor/audio-clip-overlap.ts); [checks](../../tests/audio-editor-timeline-projection-performance.test.ts); register ID `TL08`.

39. **Separate annotation timing/order preparation from selection.**

   Evidence: Thirty selection/focus publications perform zero repeat annotation timing reads, validation/sort/Intl preparation.
   [Source](../../src/common/editor/ui/timeline/useTimelineAnnotationModels.ts); [checks](../../tests/audio-editor-timeline-retained-presentation.test.tsx); register ID `TL09`.

40. **Index annotation viewport queries.**

   Evidence: Queries inspect fewer than twenty exact-geometry candidates among ten thousand annotations, preserving order, tiny-region width, marker margins and retained focus.
   [Source](../../src/common/editor/ui/timeline/timeline-annotation-viewport-index.ts); [checks](../../tests/audio-editor-timeline-projection-performance.test.ts); register ID `TL10`.

41. **Coalesce hover-indicator layout reads to a display frame.**

   Evidence: Ten raw pointer samples create one pending RAF and two rectangle reads using the latest coordinates.
   [Source](../../src/common/editor/ui/timeline/timeline-pointer-indicator-runtime.ts); [checks](../../tests/audio-editor-timeline-pointer-indicator-performance.test.ts); register ID `TL11`.

42. **Suppress repeated hover-indicator DOM mutations.**

   Evidence: An unchanged position and visibility perform zero hidden/style writes; geometry reads precede mutations.
   [Source](../../src/common/editor/ui/timeline/timeline-pointer-indicator-runtime.ts); [checks](../../tests/audio-editor-timeline-pointer-indicator-performance.test.ts); register ID `TL12`.

43. **Coalesce annotation drag previews with a final flush.**

   Evidence: Three raw moves create one RAF and one React commit; release flushes the latest delta and cancellation discards it.
   [Source](../../src/common/editor/ui/timeline/TimelineAnnotationLayer.jsx); [checks](../../tests/audio-editor-annotation-pointer-performance.test.tsx); register ID `TL13`.

44. **Skip unchanged annotation drag deltas.**

   Evidence: Repeating the quantized delta creates no additional React commit.
   [Source](../../src/common/editor/ui/timeline/TimelineAnnotationLayer.jsx); [checks](../../tests/audio-editor-annotation-pointer-performance.test.tsx); register ID `TL14`.

45. **Exclude ordinary waveform rows from FFT subscriptions.**

   Evidence: Ordinary waveform rows subscribe zero listeners and receive zero FFT-triggered rerenders; entering FFT view reads the current revision.
   [Source](../../src/common/editor/ui/timeline/useSpectrogramCanvasRevision.ts); [checks](../../tests/audio-editor-spectrogram-subscription-performance.test.tsx); register ID `TL15`.

46. **Retain normalized row spectrogram options.**

   Evidence: The fallback normalization/frozen options object is prepared only when its settings or sample-rate dependencies change.
   [Source](../../src/common/editor/ui/timeline/useAudioTrackRowViewModel.js); [checks](../../tests/audio-editor-track-row-view-model-hook.test.tsx); register ID `TL16`.

47. **Restrict and retain clip fade geometry.**

   Evidence: Two thousand inactive unselected clips skip curve geometry; selecting one keeps existing faded-clip geometry without extra shape reads.
   [Source](../../src/common/editor/ui/timeline/clip-overlay-presentation.ts); [checks](../../tests/audio-editor-timeline-overlay-performance.test.ts); register ID `TL17`.

48. **Skip fade portal discovery for empty eligible sets.**

   Evidence: Rows with zero eligible fades/selected audio clips perform zero data-clip-id DOM discovery; targets retain only eligible IDs.
   [Source](../../src/common/editor/ui/timeline/ClipFadeOverlays.tsx); [checks](../../tests/audio-editor-clip-fade-shape-field.test.tsx); register ID `TL18`.

49. **Index loop-overlay DOM clip lookup.**

   Evidence: One clipById construction replaces per-target clips.find scans, changing target resolution from quadratic to linear work.
   [Source](../../src/common/editor/ui/timeline/ClipLoopOverlays.tsx); [checks](../../tests/audio-editor-clip-loop-overlays.test.ts); register ID `TL19`.

50. **Suppress unchanged loop-trim inline writes.**

   Evidence: Repeated placement writes zero right/visibility properties; shrinking repeats resets the properties.
   [Source](../../src/common/editor/ui/timeline/clip-overlay-presentation.ts); [checks](../../tests/audio-editor-timeline-overlay-performance.test.ts); register ID `TL20`.

51. **Retain loop boundary and normalization presentation.**

   Evidence: Selection-only renders reuse normalized period/source geometry and visible loop-boundary arrays.
   [Source](../../src/common/editor/ui/timeline/ClipLoopOverlays.tsx); [checks](../../tests/audio-editor-clip-loop-overlays.test.ts); register ID `TL21`.

52. **Retain automation SVG path strings.**

   Evidence: Thirty unrelated publications perform zero repeat sample-coordinate reads or path-string construction.
   [Source](../../src/common/editor/ui/timeline/useTrackAutomationDrawModels.ts); [checks](../../tests/audio-editor-timeline-retained-presentation.test.tsx); register ID `TL22`.

53. **Retain automation point deduplication.**

   Evidence: Thirty unrelated publications perform zero repeated authored-point-list reads and retain handle model identity.
   [Source](../../src/common/editor/ui/timeline/useTrackAutomationDrawModels.ts); [checks](../../tests/audio-editor-timeline-retained-presentation.test.tsx); register ID `TL23`.

54. **Retain automation target groups.**

   Evidence: Thirty disabled/control-state publications perform zero repeated target group-label reads.
   [Source](../../src/common/editor/ui/timeline/TrackAutomationSelectors.tsx); [checks](../../tests/audio-editor-timeline-static-controls-performance.test.tsx); register ID `TL24`.

55. **Retain static audio-track ruler children.**

   Evidence: Thirty unrelated control publications retain exact React child elements, avoiding child-ruler reexecution and tick preparation.
   [Source](../../src/common/editor/ui/timeline/AudioTrackRuler.jsx); [checks](../../tests/audio-editor-timeline-static-controls-performance.test.tsx); register ID `TL25`.

56. **Index video-thumbnail timestamp matching.**

   Evidence: One hundred timestamp lookups against ten thousand catalog entries perform zero repeat timestamp-property reads; authored-first and strict 0.05-second tolerance parity passes.
   [Source](../../src/common/editor/ui/timeline/video-thumbnail-timestamp-index.ts); [checks](../../tests/audio-editor-video-thumbnail-performance.test.ts); register ID `TL26`.

57. **Retain video rate-badge timing derivation.**

   Evidence: Rate badge rational timing/BigInt preparation runs only when clip/source/rate dependencies change, instead of every exact-thumbnail publication.
   [Source](../../src/common/editor/ui/timeline/VideoFilmstrip.jsx); [checks](../../tests/audio-editor-timeline-image-ui.test.tsx); register ID `TL27`.

58. **Prepare audio-row shared model inputs in one pass.**

   Evidence: Two hundred clips resolve shared track color with two coercions instead of four hundred; shared geometry/selection/render flags and envelope previews avoid the second mapped array.
   [Source](../../src/common/editor/ui/timeline/audio-track-row-view-model.js); [checks](../../tests/audio-editor-timeline-static-controls-performance.test.tsx); register ID `TL28`.

59. **Retain filmstrip cell geometry and labels.**

   Evidence: Thirty unrelated publications perform zero repeated thumbnail-frame reads, rectangle preparation or timestamp formatting.
   [Source](../../src/common/editor/ui/timeline/video-filmstrip-cell-model.ts); [checks](../../tests/audio-editor-timeline-retained-presentation.test.tsx); register ID `TL29`.

60. **Retain document duration across unrelated project publications.**

   Evidence: Thirty unrelated project replacements perform zero repeated document-duration calculations; primary-sequence switching explicitly invalidates.
   [Source](../../src/common/editor/ui/timeline/useTimelineViewportDerived.ts); [checks](../../tests/audio-editor-timeline-derived-performance.test.tsx); register ID `TL30`.

## Metering and playback preparation: 61–70

Detailed admission and ownership limits are keyed by ID in the
[runtime register](performance-round2-runtime.json).

61. **Retain spectrum bucket geometry.** Retain logarithmic bucket boundaries per analyser until its bounded FFT geometry changes.

   Evidence: A warm tick computes zero bucket powers/floors/ceilings instead of 256 powers and 128 floor/ceil pairs. Changed geometry rebuilds once.
   [Source](../../src/common/editor/engine/engine-meter-reading.ts) (`readSpectrum`); [checks](../../tests/audio-editor-responsiveness-meter-work.test.ts); register ID `runtime-round2-01`.

62. **Combine scope and correlation traversal.** Accumulate stereo correlation during the existing scope-extrema traversal, avoiding a second complete stereo PCM scan.

   Evidence: Exact correlation and scope points agree with independent former algorithms for seven input geometries, including partial buckets.
   [Source](../../src/common/editor/engine/engine-meter-reading.ts) (`createStereoScopePoints`); [checks](../../tests/audio-editor-responsiveness-meter-work.test.ts); register ID `runtime-round2-02`.

63. **Aggregate channel meters in one pass.** Calculate aggregate peak and RMS in one channel traversal without a mapped peak array or argument spread.

   Evidence: Regression rejects any mapped channel array and verifies exact original scalar arithmetic.
   [Source](../../src/common/editor/engine/engine-channel-meter-aggregate.ts) (`reconcileEngineChannelMeters`); [checks](../../tests/audio-editor-responsiveness-meter-work.test.ts); register ID `runtime-round2-03`.

64. **Reuse privately normalized automation lanes.** Reuse privately normalized frozen lanes instead of detaching and recompiling their interpolation curves again. Recheck descriptor ranges and persisted/capture point caps.

   Evidence: Known normalized lanes retain identity; arbitrary changed external input still detaches; a restrictive descriptor and oversized capture still reject.
   [Source](../../src/common/editor/automation-lane-v21.ts) (`prepareAutomationLaneForSchedulingV21`); [checks](../../tests/audio-editor-responsiveness-tempo-inverse.test.ts); register ID `runtime-round2-04`.

65. **Index automation tempo-boundary windows.** Binary-search the first relevant tempo boundary and visit only boundaries inside each automation segment instead of filtering the whole tempo map per segment.

   Evidence: Ten linear segments over 200 tempos remove 2000 full-filter element examinations; all eleven exact scheduled events remain identical.
   [Source](../../src/common/editor/engine/automation-lane-scheduler-v21.ts) (`tempoWindow`); [checks](../../tests/audio-editor-responsiveness-tempo-inverse.test.ts); register ID `runtime-round2-05`.

66. **Retain frozen strip snapshots.** Reuse the frozen strip snapshot array between updates rather than copying the store on every query.

   Evidence: Repeated queries retain identity; successful update/reset invalidate; failed admission retains prior publication; eviction preserves detached earlier results.
   [Source](../../src/common/editor/production-audio/strip-meter-session.ts) (`snapshot`); [checks](../../tests/audio-editor-responsiveness-meter-work.test.ts); register ID `runtime-round2-06`.

67. **Retain unchanged loudness-history publications.** Retain a frozen loudness-history publication while the engine's loudness reading is unchanged.

   Evidence: Ten unchanged meter ticks share one publication instead of ten history copies; changed reading appends once and reset clears it.
   [Source](../../src/common/editor/engine/production-meter-runtime-session-v21.ts) (`createLoudnessSnapshotHistory`); [checks](../../tests/audio-editor-responsiveness-meter-work.test.ts); register ID `runtime-round2-07`.

68. **Prepare inverse-tempo facts once per schedule.** Prepare detached exact tempo frame/beat/rate facts once per schedule and binary-search active segments for adaptive curve evaluations.

   Evidence: 100 prepared queries on 1000 tempos read zero authored events; musical/sample-locked/rounded-coincident boundaries retain exact parity. Curved scheduling keeps preparation reads bounded regardless of recursive evaluations.
   [Source](../../src/common/editor/timeline-tempo-inverse.ts) (`createSampleFrameBeatProjector`); [caller](../../src/common/editor/automation-lane-v21.ts) (`createAutomationLaneFrameEvaluatorV21`); [checks](../../tests/audio-editor-responsiveness-tempo-inverse.test.ts); register ID `runtime-round2-08`.

69. **Evaluate the first adaptive probe once.** Evaluate the first adaptive curve probe once rather than once during initialization and again in the probe loop.

   Evidence: Each subdivision removes one interpolation query; existing scheduler and exact curved event-value tests pass.
   [Source](../../src/common/editor/engine/automation-lane-scheduler-v21.ts) (`appendCurvedInterval`); [checks](../../tests/audio-editor-automation-lane-scheduler-v21.test.ts); register ID `runtime-round2-09`.

70. **Build PDC latency maps directly.** Build track/bus latency maps directly, avoiding filter/map projections and spread-based maximum materialization.

   Evidence: Preparation rejects intermediate track filtering in the regression; 150000-track plan no longer overflows an argument list. Filtered fallback indexes and standard-effect latency parity pass.
   [Source](../../src/common/editor/engine/project-pdc-plan.ts) (`compileProjectPdcPlan / maximumLatency`); [checks](../../tests/audio-editor-responsiveness-pdc-work.test.ts); register ID `runtime-round2-10`.

## Effects, generation and resampling: 71–100

Detailed arithmetic, buffer-ownership and workload limits are keyed by ID in
the [DSP register](performance-round2-dsp.json). Exact before-change PCM hashes
and focused operation probes support the listed changes; they are distinct
from the whole-workflow timing observations above.

71. **Fuse Normalize DC sum and peak extrema in one PCM pass.** Peak-enabled DC normalization no longer traverses the input separately for the sum and extrema.

   Evidence: Iterator fixture reads fall from twelve to four after also replacing the mapper; only the separate measurement pass is counted here.
   [Source](../../src/common/editor/audacity-effects/basic.js); [audio-editor-round2-audacity-dsp-performance.test.ts](../../tests/audio-editor-round2-audacity-dsp-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-01-normalize-dc-peak-pass`.

72. **Skip unused Normalize peak measurement for DC-only jobs.** DC-only Normalize never needs extrema; the unified measurement loop omits those comparisons and extent arithmetic.

   Evidence: DC-only source is visited once, and all DC-only baseline fixtures retain exact samples.
   [Source](../../src/common/editor/audacity-effects/basic.js); [audio-editor-round2-audacity-dsp-performance.test.ts](../../tests/audio-editor-round2-audacity-dsp-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-02-normalize-dc-only-peak`.

73. **Normalize the owned Legacy Compressor result in place.** The follower output belongs to this invocation, so post-normalization can write it without allocating and retaining replacement channels.

   Evidence: Float32 allocations fall from two to one for a normalized mono selection.
   [Source](../../src/common/editor/audacity-effects/basic.js); [audio-editor-round2-audacity-dsp-performance.test.ts](../../tests/audio-editor-round2-audacity-dsp-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-03-legacy-owned-normalization`.

74. **Build Repeat by doubling the already-copied prefix.** Native typed-array copy invocations scale logarithmically with repetition count rather than once per repeat.

   Evidence: A 128-copy job uses eight set calls instead of 128, preserving signed-zero bytes.
   [Source](../../src/common/editor/audacity-effects/basic.js); [audio-editor-round2-audacity-dsp-performance.test.ts](../../tests/audio-editor-round2-audacity-dsp-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-04-repeat-prefix-doubling`.

75. **Calculate the medium-overdrive table logarithm once.** Each medium-overdrive table entry shares the same logarithm and scale.

   Evidence: Math.log calls fall from 1026 to two for one table, including the decibel conversion.
   [Source](../../src/common/editor/audacity-effects/distortion-table.js); [audio-editor-round2-audacity-dsp-performance.test.ts](../../tests/audio-editor-round2-audacity-dsp-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-05-distortion-medium-log`.

76. **Calculate the hard-overdrive table denominator once.** The denominator logarithm is invariant across every hard-overdrive table entry.

   Evidence: Math.log calls fall from 2050 to 1026.
   [Source](../../src/common/editor/audacity-effects/distortion-table.js); [audio-editor-round2-audacity-dsp-performance.test.ts](../../tests/audio-editor-round2-audacity-dsp-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-06-distortion-hard-log`.

77. **Calculate the even-harmonics table normalization once.** One shape normalization replaces a repeated invariant tanh and division in this separate waveshaper mode.

   Evidence: Math.tanh calls fall from 4098 to 2050.
   [Source](../../src/common/editor/audacity-effects/distortion-table.js); [audio-editor-round2-audacity-dsp-performance.test.ts](../../tests/audio-editor-round2-audacity-dsp-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-07-distortion-even-tanh`.

78. **Prepare the chosen Distortion sample shaper before PCM.** The hard-clipping input-gain branch and gain construction leave the per-sample path in both live and selection processing.

   Evidence: Source structure selects one shaper per configuration; 66 before-change distortion PCM hashes remain exact.
   [Source](../../src/common/editor/audacity-effects/prepared-distortion.ts); [checks](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-08-distortion-shaper-preparation`.

79. **Prepare the chosen Distortion output mixer before PCM.** The eleven-mode output switch and fixed gain combinations leave the per-sample output-mixing path.

   Evidence: Source structure selects one mixer per configuration; all live/offline and DC/mix update hashes remain exact.
   [Source](../../src/common/editor/audacity-effects/prepared-distortion.ts); [checks](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-09-distortion-mix-preparation`.

80. **Retain live Distortion tables on DC or mix updates.** An update that changes output mix or DC blocking does not alter waveshaper geometry and no longer rebuilds 2049 entries.

   Evidence: Medium-overdrive DC/mix update exponentials fall from 1026 to zero; shape update still redesigns the table.
   [Source](../../src/common/editor/audacity-effects/live.js); [audio-editor-round2-audacity-dsp-performance.test.ts](../../tests/audio-editor-round2-audacity-dsp-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-10-distortion-retained-table`.

81. **Retain the fixed Phaser LFO normalization.** The fixed expm1(4) denominator is shared by offline and realtime phaser modulation rather than reevaluated at each LFO update.

   Evidence: A 1024-frame offline plus realtime fixture reduces fixed-denominator calls from 104 to zero after module initialization.
   [Source](../../src/common/editor/audacity-effects/live.js); [audio-editor-round2-audacity-dsp-performance.test.ts](../../tests/audio-editor-round2-audacity-dsp-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-11-phaser-fixed-normalization`.

82. **Advance live Echo history with a bounded wrap.** The Echo history pointer advances by one and wraps only at its known length, removing remainder operations from every sample.

   Evidence: Exact partitioned Echo hashes cover delay wraparound and multi-channel history.
   [Source](../../src/common/editor/audacity-effects/live.js); [checks](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-12-live-echo-ring-wrap`.

83. **Advance the Distortion DC-block ring with a bounded wrap.** The rolling DC average pointer advances by one, so a length comparison replaces every remainder operation.

   Evidence: All eleven modes with DC enabled retain exact offline/live Float32 fixtures.
   [Source](../../src/common/editor/audacity-effects/distortion-table.js); [checks](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-13-distortion-dc-ring-wrap`.

84. **Advance Reverb delay lines with bounded wraps.** The pre-delay, comb and all-pass ring pointers all advance by one; each avoids remainder in the wet DSP path.

   Evidence: Mono/stereo/three-channel 12031-frame hashes exercise wraps and tails with unchanged rounding.
   [Source](../../src/common/editor/audacity-effects/reverb-live-processor.ts); [checks](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-14-reverb-delay-ring-wrap`.

85. **Skip standard-filter design on normalized identical updates.** Live gesture/control repetitions retain current coefficients and double-precision history when all admitted effective parameters are identical.

   Evidence: Repeated equivalent string/number controls produce zero coefficient cosine calls; changed controls still redesign.
   [Source](../../src/common/editor/first-party-effects/standard/filters-dsp.ts); [audio-editor-round2-realtime-dsp-performance.test.ts](../../tests/audio-editor-round2-realtime-dsp-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-15-filter-unchanged-design`.

86. **Reuse the angular cosine while designing vocoder biquads.** Each low-pass envelope biquad previously called the same cosine separately for numerator and denominator coefficients.

   Evidence: A twelve-band bank decreases Math.cos calls from 192 to 144; mono/stereo/surround PCM hashes remain exact.
   [Source](../../src/common/editor/first-party-effects/standard/vocoder-dsp.ts); [audio-editor-round2-realtime-dsp-performance.test.ts](../../tests/audio-editor-round2-realtime-dsp-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-16-vocoder-cosine-reuse`.

87. **Skip nonlinear gain math for neutral band compression.** Ratio-one or zero-maximum compression continues updating detector energy while avoiding logarithm, knee and exponentiation for known unity gain.

   Evidence: 2048 neutral gain calls produce zero logarithms; enabling compression still sees the retained detector history.
   [Source](../../src/common/editor/first-party-effects/dynamics/core.ts); [audio-editor-round2-realtime-dsp-performance.test.ts](../../tests/audio-editor-round2-realtime-dsp-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-17-band-neutral-gain`.

88. **Skip crossover redesign for an unchanged target.** Repeating the same crossover target does not need another tangent/design call and does not interrupt coefficient smoothing.

   Evidence: An unchanged in-progress target causes zero tangent calls; NaN still throws.
   [Source](../../src/common/editor/complementary-crossover.ts); [audio-editor-round2-realtime-dsp-performance.test.ts](../../tests/audio-editor-round2-realtime-dsp-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-18-crossover-unchanged-design`.

89. **Skip Reverb redesign for an unchanged configuration.** Identical normalized controls reuse existing gain/tone/tail geometry rather than solving the reverb release bound and rebuilding tone coefficients.

   Evidence: An identical room-size update causes zero exponentials instead of fifty; changed tone still redesigns.
   [Source](../../src/common/editor/audacity-effects/reverb-live-processor.ts); [audio-editor-round2-realtime-dsp-performance.test.ts](../../tests/audio-editor-round2-realtime-dsp-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-19-reverb-unchanged-design`.

90. **Select the Tone and Chirp oscillator before visiting PCM.** The immutable waveform choice no longer requires square/sawtooth string dispatch for each generated frame.

   Evidence: Twelve separate tone/chirp waveform and interpolation fixtures plus existing stateful hashes retain exact PCM.
   [Source](../../src/common/editor/signal-generator-renderer.ts); [checks](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-20-generator-waveform-preparation`.

91. **Advance generator phase with a bounded wrap.** Admitted oscillator increments are at most half a cycle, so each positive phase needs at most one subtraction instead of remainder.

   Evidence: Tone/Chirp exact hashes include near-Nyquist frequency and arbitrary block boundaries.
   [Source](../../src/common/editor/signal-generator-renderer.ts); [checks](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-21-generator-phase-wrap`.

92. **Prepare the chosen Chirp interpolation once.** The interpolation string branch and invariant frequency difference/ratio leave the per-frame sweep loop.

   Evidence: Linear/logarithmic waveform fixtures preserve exact samples and phase partitions.
   [Source](../../src/common/editor/signal-generator-renderer.ts); [checks](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-22-chirp-interpolation-preparation`.

93. **Skip raised-cosine evaluation inside flat Morse keying.** The plateau has an exact unity raised-cosine envelope and does not need another cosine for every keyed sample.

   Evidence: One 480-frame dot drops cosine calls from 480 to 78 edge calls.
   [Source](../../src/common/editor/signal-generator-renderer.ts); [audio-editor-round2-generator-spectrum-performance.test.ts](../../tests/audio-editor-round2-generator-spectrum-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-23-morse-flat-envelope`.

94. **Select Noise color outside the frame loop.** White, brown and pink states use separate bounded frame loops; color tests occur once per block/channel instead of for every random draw.

   Evidence: Seeded three-channel color fixtures and existing 32-channel jump fixtures retain exact channel-major RNG and PCM.
   [Source](../../src/common/editor/signal-generator-noise.ts); [checks](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-24-noise-color-block-dispatch`.

95. **Retain bounded private spectrum Hann windows.** Repeated spectral gestures/report computation at an accepted FFT size reuse its immutable Hann coefficients.

   Evidence: The second 64-point report has six FFT-root cosine calls instead of seventy total cosine calls.
   [Source](../../src/common/editor/audio-spectrum.ts); [audio-editor-round2-generator-spectrum-performance.test.ts](../../tests/audio-editor-round2-generator-spectrum-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-25-spectrum-private-hann`.

96. **Retain PFFFT plan heap views across transforms.** Warm plans reuse input/output typed-array views instead of allocating two wrapper objects per FFT.

   Evidence: Ten warm transforms allocate zero heap views instead of twenty; a large-plan heap-growth fixture refreshes old views safely.
   [Source](../../src/common/editor/pffft.js); [audio-editor-round2-pffft-performance.test.ts](../../tests/audio-editor-round2-pffft-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-26-pffft-retained-views`.

97. **Consume initial sinc input without cloning the full chunk.** The production windowed-sinc resampler synchronously borrows input when no retained history exists, avoiding a complete append allocation/copy before convolution.

   Evidence: A 1024-frame initial downsample feed allocates zero full 1024-frame input clones instead of one. Nine small/large/rate ownership cases mutate caller input and transfer output after push; future samples match independent private-input execution. Sixteen independent frozen-baseline sinc hashes remain exact.
   [Source](../../src/common/editor/resample.js); [audio-editor-round2-resample-delay-performance.test.ts](../../tests/audio-editor-round2-resample-delay-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts), [audio-editor-resample-borrowed-input.test.ts](../../tests/audio-editor-resample-borrowed-input.test.ts), [audio-editor-take-cycle-routed-capture-service.test.ts](../../tests/audio-editor-take-cycle-routed-capture-service.test.ts), [audio-editor-local-assistance-audio-preparation.test.ts](../../tests/audio-editor-local-assistance-audio-preparation.test.ts); register ID `dsp-27-sinc-initial-feed-borrow`.

98. **Return exact-fit sinc output without remapping its channels.** Each exact-fit output chunk already owns the result array and channel buffers. Returning it directly omits a second array allocation and one callback per channel.

   Evidence: Finishing a stereo 1024-frame 48 kHz → 44.1 kHz feed calls channel map once for history pruning instead of twice; output/channel ownership is unchanged. Sixteen independent sinc PCM hashes and production offline/live/recording caller tests pass.
   [Source](../../src/common/editor/resample.js); [audio-editor-round2-resample-delay-performance.test.ts](../../tests/audio-editor-round2-resample-delay-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts), [audio-editor-streaming-resample-kernel.test.ts](../../tests/audio-editor-streaming-resample-kernel.test.ts), [audio-editor-resample-borrowed-input.test.ts](../../tests/audio-editor-resample-borrowed-input.test.ts), [audio-editor-runtime-long-sources.test.js](../../tests/audio-editor-runtime-long-sources.test.js); register ID `dsp-28-sinc-exact-output-array`.

99. **Read ordinary integer delay taps without interpolation.** Every admitted tap/compensation is an integer frame offset; nonzero finite ring samples need one read rather than floor/fraction/neighbor arithmetic.

   Evidence: A stereo three-tap 1024-frame fixture eliminates 8192 interpolation floors. Nine exact delay fixtures include mix zero and signed zeros. Actual StaffPad normal amplitude, constant maximal finite and finite-to-overflow transitions retain value/NaN-position parity.
   [Source](../../src/common/editor/first-party-effects/standard/delay-dsp.ts); [audio-editor-round2-resample-delay-performance.test.ts](../../tests/audio-editor-round2-resample-delay-performance.test.ts), [audio-editor-round2-dsp-exact-parity.test.ts](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-29-delay-integer-reads`.

100. **Share delay read positions across channels.** Each frame computes one tap position per echo and one dry position, replacing duplicate channel-wise offset/compensation/modulo work.

   Evidence: For the stereo three-tap fixture, source-confirmed position calculations drop from eight to four per frame; multichannel and StaffPad compensation suites pass.
   [Source](../../src/common/editor/first-party-effects/standard/delay-dsp.ts); [checks](../../tests/audio-editor-round2-dsp-exact-parity.test.ts); register ID `dsp-30-delay-shared-read-positions`.
