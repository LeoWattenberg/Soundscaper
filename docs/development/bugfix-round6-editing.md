# Round six editing audit

Only defects reached by ordinary menu, keyboard and pointer workflows qualify.
Variants sharing one correction are grouped under one root. Earlier audit roots,
disabled public actions, and arbitrary internal inputs are excluded.

| ID | Ordinary user steps | Failure before correction | Correction | Evidence and status |
| --- | --- | --- | --- | --- |
| R6-EDIT-001 | Import an ordinary mono WAV containing an internal pause and another continuous WAV. Shift-select their headers; Edit → Audio clips → Group clips, then Split clips at silences. Undo and Redo. | All recordings disappear. The silent temporary segment inherits the authored group, and ordinary clip removal expands that identity through every nonsilent survivor and companion. | Ungroup only the temporary silent segment immediately before removal. Keep the original group on all surviving material and retain one atomic edit. Selected and labeled detachment share this root. | Baseline `ee0d3fabd` public Chromium RED: 0 clips instead of 3 (`/tmp/soundscaper-r6-edit-grouped-disjoin-red.log`). Two strict production-command selected/labeled regressions independently RED at the same 0-versus-3 assertion (`/tmp/soundscaper-r6-edit-grouped-disjoin-node-red.log`). Corrected regressions and existing clipboard, selection authority, loop-silence and warp-silence support pass 32/32 (`/tmp/soundscaper-r6-edit-grouped-disjoin-node-green.log`), preserving exact survivor bounds and untouched grouped companions. Targeted type-aware lint passes. Immutable green1 public Chromium Split/Undo/Redo passes 1/1 in 15.4 seconds (`/tmp/soundscaper-r6-edit-grouped-disjoin-green1.log`). |
| R6-EDIT-002 | Framescaper: import an ordinary camera WebM through Project Bin and Add to timeline. Tracks → Mute all tracks, Undo, Redo, then Unmute all tracks. | Picture remains visible and its header still offers Hide video. The global structural planner writes the legacy audio `mute` field on a video track, whose renderer owns `hidden`. | Use `hidden` for video tracks and retain `mute` for audio tracks and folders. Skip already satisfied controls and label tracks, and retain one history entry. Mute/Unmute and camera/generated/image picture siblings share this global owner, independently from R4-EDIT-024's selected/focused shortcut adapter. | Public Chromium RED at unchanged picture visibility (`/tmp/soundscaper-r6-edit-video-mute-all-red.log`). Strict actual Framescaper controller RED at `hidden: false` versus expected true (`/tmp/soundscaper-r6-edit-video-mute-all-node-red.log`). Corrected actual-controller, existing focused/selected-camera shortcut, folder mute and structural planner support pass 13/13 (`/tmp/soundscaper-r6-edit-video-mute-all-node-green.log`), proving complete Undo/Redo and no redundant history. Existing planner expectations now check video visibility rather than repeating the erroneous audio field. Targeted type-aware lint passes. Public browser GREEN pending coordinated rebuild. |

Excluded hypotheses: Half-wave is intentionally an independent menu toggle, so
switching waveform style does not retire its flag. No tracks → Split clips at
silences is disabled in the public menu; the scanner's internal empty-scope
fallback is therefore outside this audit. Frozen labeled removal is follow-through
of the existing R5-EDIT-005 empty-freeze root and is not counted again.

No manual **Update AI assets** run is required: the assistance runtime closure
and target inventories are unchanged.
