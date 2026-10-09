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

The potential stale session-folder creation candidate is excluded: the only
published New folder entry supplies an explicit surviving parent. The suspect
default-parent internal call is unreachable through that menu.

No assistance runtime closure or target inventory changes. No manual **Update
AI assets** run is required.
