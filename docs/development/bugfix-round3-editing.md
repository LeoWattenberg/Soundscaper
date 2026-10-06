# Third editing bug audit

Every counted entry has a reproduced ordinary user workflow. Browser setup uses
normal media imports and existing menus, keys, and pointers. Earlier audit roots,
unsupported controls, private state injection, and harness failures are excluded.

| ID | Ordinary user steps | Actual before the fix | Expected and correction | Red and green evidence |
| --- | --- | --- | --- | --- |
| R3-EDIT-001 | Import a short mono WAV. Select its clip, Effect → Pitch and tempo → Audio warp and transients → Create identity warp map. Add a marker at Outer position 32 and Source sample 64. Close, View → Zoom → Zoom to selection, and draw with Pencil at timeline sample 32. Clear the warp map through its dialog and export WAV to inspect the edited raw source. | Source sample 64 remains unchanged; a different source sample, 32, changes. The point writer assumes uniform clip stretch although the displayed waveform follows the authored nonlinear map. | Resolve sample coordinates through the existing audio-warp evaluator, pass its project clock from the sample-edit service, and interpolate drawn strokes in timeline space across rate changes. The shared coordinate helper also preserves warped smoothing ranges; that support is one root and adds no count. | Baseline Chromium `sample pencil edits the source sample addressed by an authored warp marker` failed with an exact zero change at source sample 64. Strict TypeScript point, stroke, smoothing, musical-clock, backward-stroke, and unchanged ordinary mapping regressions pass (21 focused cases including existing sample editing, loop Pencil, and controller contracts). The public workflow passes Chromium, Firefox, and WebKit on green1 (3/3). |

No manual **Update AI assets** run is required. The assistance runtime closure,
recipes, signing, archives, and target inventories are unchanged.
