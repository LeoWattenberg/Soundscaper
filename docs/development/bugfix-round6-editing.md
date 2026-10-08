# Round six editing audit

Only defects reached by ordinary menu, keyboard and pointer workflows qualify.
Variants sharing one correction are grouped under one root. Earlier audit roots,
disabled public actions, and arbitrary internal inputs are excluded.

| ID | Ordinary user steps | Failure before correction | Correction | Evidence and status |
| --- | --- | --- | --- | --- |
| R6-EDIT-001 | Import an ordinary mono WAV containing an internal pause and another continuous WAV. Shift-select their headers; Edit → Audio clips → Group clips, then Split clips at silences. Undo and Redo. | All recordings disappear. The silent temporary segment inherits the authored group, and ordinary clip removal expands that identity through every nonsilent survivor and companion. | Ungroup only the temporary silent segment immediately before removal. Keep the original group on all surviving material and retain one atomic edit. Selected and labeled detachment share this root. | Baseline `ee0d3fabd` public Chromium RED: 0 clips instead of 3 (`/tmp/soundscaper-r6-edit-grouped-disjoin-red.log`). Two strict production-command selected/labeled regressions independently RED at the same 0-versus-3 assertion (`/tmp/soundscaper-r6-edit-grouped-disjoin-node-red.log`). Corrected regressions and existing clipboard, selection authority, loop-silence and warp-silence support pass 32/32 (`/tmp/soundscaper-r6-edit-grouped-disjoin-node-green.log`), preserving exact survivor bounds and untouched grouped companions. Targeted type-aware lint passes. Immutable green1 public Chromium Split/Undo/Redo passes 1/1 in 15.4 seconds (`/tmp/soundscaper-r6-edit-grouped-disjoin-green1.log`). |

Excluded hypotheses: Half-wave is intentionally an independent menu toggle, so
switching waveform style does not retire its flag. No tracks → Split clips at
silences is disabled in the public menu; the scanner's internal empty-scope
fallback is therefore outside this audit. Frozen labeled removal is follow-through
of the existing R5-EDIT-005 empty-freeze root and is not counted again.

No manual **Update AI assets** run is required: the assistance runtime closure
and target inventories are unchanged.
