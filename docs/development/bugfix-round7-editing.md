# Round seven editing audit

Only distinct causal roots on existing ordinary user paths count. Setup errors,
unreachable internal APIs, intentionally unsupported formats, and sibling
symptoms are excluded. Temporary verification output is removed after recording
the result here; permanent regression tests remain.

| ID | Ordinary user path | Root and correction | Focused evidence |
| --- | --- | --- | --- |
| R7-EDIT-001 | Import two recordings, draw an off-grid time range, enable Snap, focus the first track row and Shift+Down. Alternatively select a recording's header before extending its track scope. | The track-scope adapter rebuilds a range from collapsed stored clip coordinates and reapplies the snap grid; selection becomes zero. Resolve the effective selection, adjust only track scope with snapping disabled, and retain the independent playhead. Both symptoms count once. | Two actual-controller causal RED cases: 0 vs 9,600 start and 0 vs 38,400 end. Corrected new and existing focused Node checks: 6/6 PASS. Public Chromium causal RED: both workflows reset to zero; corrected complete workflows plus the existing keyboard track regression: 3/3 PASS, 11.4 s. Verified. |
| R7-EDIT-002 | Preferences: assign Ctrl+Alt+Up to New label track. Create sibling folders, focus the later folder and press the assigned chord. | The folder tree treats modified arrows as its own navigation/movement before the workspace dispatcher. Release Ctrl/Meta and already handled keys while retaining plain tree navigation and ordinary Alt movement. | Three mounted production-handler causal RED modifier cases consume the event; corrected mounted and folder-model checks: 9/9 PASS. Public Chromium causal RED: zero label tracks. Corrected plain navigation, configured command and Undo/Redo workflow PASS. |
| R7-EDIT-003 | Move a track into a folder, F2 to rename it, type a draft and right-click the text field to use its native text menu. | The row's context-menu handler captures events from its rename input and opens folder actions, interfering with text editing. Release editable descendants to their native context menu while retaining folder actions on the row. | Mounted production-handler causal RED: prevention count 1 vs 0. Corrected mounted/name-composition/rename checks: 5/5 PASS. Public Chromium causal RED: folder menu opens while editing. Corrected text-menu, unchanged draft, rename and Undo workflow PASS. |
| R7-EDIT-004 | Import an ordinary recording, select its header, Ctrl+B to add a label, finish the title, F2 to edit it and right-click the draft. | The independently implemented native label marker captures its title input's context menu, opens label actions and selects the label. Release editable descendants while retaining the marker's own context menu. | Mounted production-handler causal RED: prevention count 1 vs 0; corrected title/context and existing composition/lock checks pass 6/6. Public Chromium causal RED: label actions appear instead of retaining text editing. Corrected native text editing, rename, Undo and ordinary marker context menu PASS on immutable 220719574. |
| R7-EDIT-005 | Import a recording, select its header, enable Snap and focus Playhead. Press Ctrl+Right to move the selected clip through global command dispatch. Alternatively drag a recording off the grid, enable Snap and use Ctrl+Up from Playhead to move it to the previous track. | This independent global item-placement adapter requests a small sample delta that snaps back to the same grid cell; its vertical branch also resnaps an unchanged horizontal position. Share the existing directional grid step with the header owner and explicitly preserve time during vertical moves. Both adapter branches count once, independently from R3-EDIT-024's header callback. | Two actual-controller causal RED cases: zero instead of 48,000 for horizontal movement and zero instead of 12,000 for vertical placement. New and existing item/grid/native geometry regressions pass 16/16. Public Chromium horizontal causal RED: unchanged 12-pixel placement; vertical causal RED also reproduced. Corrected public workflows pending. |
| R7-EDIT-006 | Import an ordinary one-minute recording, switch to Music workspace, set 6/8, choose Beats & measures on the ruler and use View → Zoom → Zoom out. | The map-aware ruler marks every bar as labelled regardless of available pixels, unlike the ordinary fixed-meter ruler. At the lowest ordinary zoom, actual glyphs overlap. Choose globally aligned power-of-two bar intervals for readable labels and visible ticks, retaining exact native bar/pulse frames and shared grid projection. | Three owning viewport-model causal RED cases show labels 9, 22.5 and 45 pixels apart while the zoomed-in control passes. Public Chromium first confirms readable 6/8 labels, then actual canvas text overlaps: next label starts at 21.6 while its predecessor ends at 22.116. Corrected new/owning/map/grid/canvas checks pass 20/20. Old dense-count performance fixtures now assert visible density and the unchanged timing bound. Corrected public workflow pending. |

The potential stale session-folder creation candidate is excluded: the only
published New folder entry supplies an explicit surviving parent. The suspect
default-parent internal call is unreachable through that menu.

Native image boundary resizing in `applyAudacityItemNavigationAction` is also
excluded: published Extend/Contract commands call the selection controller
directly, and only item movement reaches this helper. Its failing internal
image trim tests and browser verification files were removed without a source
change or count.

The unchanged EDIT005 horizontal and vertical placement/history workflows pass
on prepared Chromium capture `5c9787bec` (2.4 seconds each); EDIT006's complete
compound-meter control and readable zoomed-out labels pass in 3.6 seconds. The
whole accompanying corrected batch passes 21/21.

| ID | Ordinary user path | Root and correction | Focused evidence |
| --- | --- | --- | --- |
| R7-EDIT-007 | Add a Send track, assign Ctrl+Alt+Tab to New label track in Preferences, focus the output header and use the assigned command after ordinary Tab traversal. | The independent output-header capture handler consumes every Tab before the workspace dispatcher, even when modified or already handled. Release claimed and modified keys before its existing local traversal. This is distinct from R5-EDIT-025's output-lane handler. | Four actual mounted capture cases causally RED with prevention/traversal instead of no consumption; ordinary Tab/Shift+Tab control passes. Corrected output-header/lane/name/composition regressions pass 16/16. Public Chromium first completes plain Tab traversal, then causally RED at zero label tracks after the assigned command. Corrected public workflow pending. |
| R7-EDIT-008 | Import an ordinary two-minute recording, choose Beats & measures in its source ruler, then author 960 BPM followed by 30 BPM at beat 40 through Musical timeline. | The independent source ruler chooses label stride from average bar count and viewport width. A tempo change clusters those chosen bars in sample space. Admit labels by their actual projected distance while preserving exact native frames and musical origins. | Constant-tempo control passes, but the owning model causally RED shows labels only 3.75 pixels apart. The public healthy source ruler passes before authoring the tempo change, then actual SVG labels overlap: next starts at 872.375 while its predecessor ends at 873. Corrected new and existing source-origin/signature regressions pass 7/7. Corrected public workflow pending. |
| R7-EDIT-009 | Import an ordinary stereo WAV, enable Spectrogram, choose Select → Spectral → Spectral brush and click the same frequency position halfway down each channel. | The spectral authoring surface treats both channels as one frequency axis. Forward actual display channel count/ratio, resolve the stroke in its originating channel and present the resulting band at the matching position in both channels. Keep one set of editing handles and existing mono/keyboard/pointer ownership. | Two actual mounted stereo cases causally RED at 18,000/20,400 Hz instead of the displayed 12,000 Hz; mono control passes. Public Chromium ordinary upper/lower clicks select centers 7,231.44 Hz apart. Corrected mounted/model/channel/cancellation/touch support passes 35/35. Corrected public workflow pending. |

Prepared Chromium capture `fef78921b` passes EDIT008's complete tempo-change
workflow in 4.7 seconds and EDIT009's upper/lower channel authoring and displayed
selection placement in 2.5 seconds.

EDIT007's first header correction exposed the same modified-Tab consumption
in its nested design-system panel under the published grouped navigation
profile. The complete public workflow remained RED at zero label tracks.
Four mounted panel-handler cases with that profile also causally RED at one
prevented event instead of zero. Release handled events and modified Tab in
that nested owner as well; panel/header/lane/name/composition and existing
vendor checks now pass 23/23. This follow-through adds no count. The shared
vendor file retains its previous line count. Corrected public proof is pending.

No assistance runtime closure or target inventory changes. No manual **Update
AI assets** run is required.

| ID | Ordinary user path | Root and correction | Focused evidence |
| --- | --- | --- | --- |
| R7-EDIT-010 | Framescaper: Generate → Add video still twice to create two picture tracks. Select the first image, focus Playhead and press Ctrl+Down, then Ctrl+Up. Generated Titles use the same published command. | The global vertical item dispatcher compares native image/still/generator clip kinds with track types. No track has those kinds, so it silently skips compatible picture destinations. Classify those visual leaves as video before finding the destination; retain the existing exact time-preserving move command. This destination search is independent from R3-EDIT-021's context menu and R4-EDIT-010's horizontal clock conversion. | Actual canonical image history and the published Title action/controller both causally RED at unchanged track ownership. The public horizontal move/Undo control passes, then Ctrl+Down causally RED at the original track instead of the next picture track on fef78921b (8.8 seconds). Corrected native clock, source identity, bidirectional movement, Undo/Redo and existing horizontal/grid/generator support pass 11/11; target lint passes. Initial Title test setup used the wrong runtime return field and is excluded. Corrected complete public proof pending. |

Complete repository lint passed all eight bounded shards during this wave.
Size checks pass for 11,078 maintained files. Later source additions receive
their own focused lint and will be included again in the checkpoint gates.

Prepared Chromium capture `e2a38ecb5` completes EDIT007's plain Tab, configured
shortcut and Undo/Redo workflow in 2.9 seconds, and EDIT010's horizontal
dispatch control, both picture-track directions and Undo/Redo in 4.7 seconds.
Both complete public regressions pass. The native Title regression's track
inventory uses the same validated-array narrowing as its existing controller
tests; focused checks and type-aware lint pass after that typing correction.
