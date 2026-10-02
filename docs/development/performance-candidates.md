# Smaller performance candidates

These candidates remain after the October 2, 2026 performance audit. They are
potential P3 improvements or areas needing a representative profile before
implementation. The measured P1 and P2 problems are addressed in the performance
branch; the entries below do not have evidence of comparable user impact.

| Candidate | Location | Evidence needed before a change |
| --- | --- | --- |
| Batch canvas geometry and computed-style reads before painting | Editor timeline canvas renderers | A trace showing repeated forced layout during playback or scrolling. Preserve resize handling and device-pixel-ratio changes. |
| Stabilize row callbacks and narrow visual subscriptions | Audio and video track rows | React commit counts showing unchanged rows rerendering during unrelated edits. Preserve selection, meters, live recording, and drag previews. |
| Index recording previews by track | Track row view models | A simultaneous multitrack recording profile showing preview-array searches consume meaningful frame time. Ordinary projects have few previews. |
| Reuse mapped ruler buffers across redraws | Timeline ruler adapters | Allocation and paint measurements at high zoom. Retain correct tempo, frame-rate, and viewport invalidation. |
| Construct offscreen row children only when their slots mount | Timeline track virtualization | A very large track-count trace showing React element construction dominates, after accounting for the existing mounted-row virtualization. Preserve accessible focus and row height. |
| Share catalog validation between site and editor consumers | `src/common/i18n/translation-catalog.js` | A localized cold-load profile showing repeated validation of the same catalog is material. Preserve English-based retirement, origin filtering, and fallback behavior. |
| Preload the selected editor font subset | Editor startup and font stylesheets | A throttled network trace showing late font discovery delays a useful paint. Load only the subset and family actually used by the selected locale and skin. |
| Move additional small helpers to their deferred feature owners | `scripts/lib/build-chunk-tests.mjs` | Confirm every value importer is deferred and measure compressed startup savings. Some desktop and cross-product consumers deliberately keep shared contracts eager. |

The browser measurements in this audit use local production previews. They do
not establish field interaction latency, production caching behavior, or GPU
performance on every supported machine. Reproduce suspected costs on the
affected workload before promoting a candidate to P2 or changing its behavior.
