# Smaller performance candidates

Use a current representative profile to establish the remaining cost before
implementing one of these proposals. Existing indexes, caches, and bounded work
may already cover part of a candidate; inspect the owning code and regressions
first. [Editing performance boundaries](editing-performance-opportunities.md)
record the constraints on broader extensions.

| Candidate | Location | Evidence needed before a change |
| --- | --- | --- |
| Batch canvas geometry and computed-style reads before painting | Editor timeline canvas renderers | A trace showing repeated forced layout during playback or scrolling. Preserve resize handling and device-pixel-ratio changes. |
| Stabilize row callbacks and narrow visual subscriptions | Audio and video track rows | React commit counts showing unchanged rows rerendering during unrelated edits. Preserve selection, meters, live recording, and drag previews. |
| Index recording previews by track | Track row view models | A simultaneous multitrack recording profile showing preview-array searches consume meaningful frame time. Ordinary projects have few previews. |
| Share catalog validation between site and editor consumers | `src/common/i18n/translation-catalog.js` | A localized cold-load profile showing repeated validation of the same catalog is material. Preserve English-based retirement, origin filtering, and fallback behavior. |
| Preload the selected editor font subset | Editor startup and font stylesheets | A throttled network trace showing late font discovery delays a useful paint. Load only the subset and family actually used by the selected locale and skin. |
| Move additional small helpers to their deferred feature owners | `scripts/lib/build-chunk-tests.mjs` | Confirm every value importer is deferred and measure compressed startup savings. Some desktop and cross-product consumers deliberately keep shared contracts eager. |
| Batch pending-project metadata updates during autosave | Storage publication repositories | A storage trace showing serial source and media metadata reads dominate save time. Bound concurrency and preserve atomic publication and retention protection. |
| Combine cold retention-index admission scans | `src/common/editor/session-retention-index.ts` | A cold large-history profile showing separate clip and assistance scans matter. Preserve optional validation at the existing query boundary. |
| Reuse resampler input and history buffers | `src/common/editor/resample.js` | Worker allocation and garbage-collection measurements showing bounded input/history concatenation dominates. Preserve input ownership, partial feeds, and exact chunk parity. |

Local production previews cannot establish field interaction latency,
production caching behavior, or GPU performance on every supported machine.
Measure the affected workload and preserve its correctness contracts before
promoting a candidate into planned work.
