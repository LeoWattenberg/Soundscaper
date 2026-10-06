# Third dialog and control bug audit

These entries are distinct defects beyond the previous 202 fixes. Each failed
through ordinary public menus, pointer gestures, or keyboard input on the immutable
round-three baseline. Tests do not install editor state or require malformed files.

| ID | Ordinary reproduction | Before / expected behavior | Fix and regression |
| --- | --- | --- | --- |
| R3-DIALOG-001 | Framescaper → Generate → Video Generators → Add Solid. Select its clip, Effect → Edit Video Mask/Matte. Choose Ellipse, Width 0.5, Height 0.25, then Create and attach mask. Change Width to 0.6 and click Update attached mask. | The valid update failed with “A finishing visual presentation command must mutate state; no-op commands are unsupported.” The mask geometry should update while its existing attachment stays intact. | Omit the unchanged presentation command when the chosen mask is already attached. The public browser regression reached the error on the original build; the new workflow saves 0.6, reopens it, and restores 0.5 with one Undo. Strict command tests also submit every resulting command through its real normalizer. |
| R3-DIALOG-002 | Create the same Ellipse mask with Width 0.5 and Height 0.25. Close the mask dialog and reopen Effect → Edit Video Mask/Matte. | The fields displayed Rectangle, Width 0.75, Height 0.75 instead of the saved geometry. A later change therefore also replaced untouched geometry. | Carry attached vector-mask geometry in the dialog model and initialize the selected mask's fields from it. The original public browser workflow displayed Rectangle; the corrected workflow displays Ellipse, 0.5, and 0.25. Strict model regression verifies the saved geometry. This is field initialization, separate from 001's command admission failure. |
| R3-DIALOG-003 | Edit → Preferences → Audio settings. In the recording offset field, replace 0 with 123 and press Escape, then Tab. Close and reopen Preferences. | Escape closed Preferences instead of canceling the field draft; a subsequent blur could publish the discarded 123. The active field should restore its saved 0 before Escape is allowed to close its parent. | Extract the recording offset's guarded draft lifecycle. Consume Escape, restore the saved value, and prevent the canceled draft's blur from committing. The original public workflow lost the dialog after Escape; the corrected workflow remains open and still shows 0 after reopening. A mounted regression reproduces the stale blur and verifies a later valid fractional offset still commits. |
| R3-DIALOG-004 | Window → Markers. Use the panel menu to choose Floating. Drag its Resize: Markers grip to shrink the panel; while holding the mouse button, press Escape, then release. | Escape left the panel at its preview size: the baseline workflow changed its width from 360 to 310 pixels. Cancellation should restore the original dimensions and the later release should publish nothing. | Give the dock resize owner an Escape listener and cancel its preview during teardown. The strict lifecycle regression also verifies idle Escape remains available and a later mouse release cannot commit a canceled session. This resize owner is separate from the title-movement owner fixed in R2-DIALOG-024. |
| R3-DIALOG-005 | Framescaper → Tracks → Caption Tracks. Set Track name to French dialogue and Language to fr, paste a normal one-cue SRT into Sidecar text, and Import sidecar text. Close and reopen Caption Tracks, then import edited cue text into the same track. | The reopened fields displayed Captions and und. The next import silently replaced the authored track metadata with those defaults. | Seed destination fields from the saved caption track, including its sequence, and refresh when the chosen track changes. Unrelated project updates preserve a local name draft. The public baseline failed at the displayed Captions; the corrected workflow retains French dialogue/fr both in the fields and in its visible canonical document after reimport. |
| R3-DIALOG-006 | Framescaper → Generate → Video Generators → Add Solid. Select the clip, Generate → Video Generators → Save Visual Preset. Save My solid, select it in Saved visual preset, then Remove visual preset. | The chooser displayed None, but Apply and Remove stayed enabled with the deleted ID, so another action addressed a nonexistent preset. | Reconcile selected visual and finishing preset IDs when their inventories change, preserving surviving choices and clearing an empty inventory. The baseline public workflow reached the enabled obsolete action; the corrected workflow disables both actions after deletion. A mounted regression also verifies fallback to a surviving preset. Count both preset kinds as one inventory-lifecycle defect. |
| R3-DIALOG-007 | Edit → Preferences. Drag Resize: Editor preferences to shrink the window; while holding the mouse button, press Escape, then release. | Escape dismissed Preferences with an active resize instead of canceling that preview. The first Escape should restore its original dimensions and keep the dialog open; a later idle Escape should close it. | Let the live modal-resize owner take Escape before its underlying modal. Restore the original inline dimensions, cancel queued preview frames, and prevent later release publication. The baseline public workflow lost the dialog; the corrected workflow restores its original width, survives mouse release, and closes on the second Escape. Strict listener-lifecycle tests also cover teardown and idle modal ownership. Group all uses of this shared modal-resize owner once; it is separate from 004's dock-panel resize session. |
| R3-DIALOG-008 | Edit → Preferences → Playback/Recording. Hover Help: Keep input devices open between recordings, then move diagonally toward the right side of its explanation. | The explanation disappeared while crossing the gap from its trigger, before the pointer reached its text. Users reading hover content with magnification or a large pointer should be able to enter that content. | Preserve hover visibility within the bounded path connecting the trigger and tooltip, and dismiss it when the pointer leaves that path. The original public workflow lost the explanation; the corrected workflow reaches its text, dismisses on pointer exit, and dismisses with Escape while leaving Preferences open. Mounted and geometry regressions preserve click-toggle and focus behavior. Group all uses of this shared tooltip once. |
| R3-DIALOG-009 | File → Import a normal WAV. Analyze → Contrast. Drag its title left while holding the mouse button, press Escape, then release. | Escape closed Contrast during its active title move. Cancellation should restore its original position and keep the dialog open, with a later idle Escape available to close it. | Give the shared dialog title's move session Escape ownership until completion or cancellation. The baseline public workflow lost Contrast; the regression checks restored coordinates, no effect from later release, and idle dismissal. Strict lifecycle tests preserve normal completion and listener teardown. This title owner is independent of the modal resize owner in 007 and the workspace-panel title owner in R2-DIALOG-024. |
| R3-DIALOG-010 | Framescaper → Project bin → Import two ordinary video files. Open a source with its Source monitor button, click Play, then Mark in after playback advances. | Mark in recorded the old stopped frame zero instead of the frame currently playing. Frame stepping and playback completion also used that stale stopped authority. | Publish the live media clock through the source monitor's authenticated media-time action before marking, stepping, or ending. Marks retain ongoing playback; stopped operations preserve their exact authored ordinal without resampling the decoder. The public baseline kept Mark in at zero after more than 0.25 seconds of playback. A mounted regression was red at the omitted clock publication and verifies operation order, exact stopped marks, and completion. Group these live-clock handoffs once. |
| R3-DIALOG-011 | Framescaper → Project bin → Import two ordinary videos. Open the first Source monitor, click Play, then open the second with its Source monitor button. | The new media was stopped, but the panel still showed Pause and retained the preceding source's playing state. | End the UI playback session whenever the source identity changes, then position the new stopped media. The baseline public workflow changed sources without restoring Play. The mounted regression also verifies one pause and the new media's zero position. This target-session lifecycle is separate from 010's live-clock publication and IO-005's variable-rate conversion. |

All three workflows passed Chromium, Firefox, and WebKit against immutable green
batch 1. The existing Chromium mask validation, preset, and removal workflow also
passed; its invalid Height 0 validation remains intact. Focused Node regressions
passed 38 tests. Changed source and tests passed targeted lint.

Entries 004–006 passed all nine browser cases in Chromium, Firefox, and WebKit
against immutable green batch 2. Their four focused strict Node regressions and
changed-file lint also passed.

Entry 007 passed Chromium, Firefox, and WebKit against immutable green batch 3.
Its two strict lifecycle regressions and the existing modal Escape regressions
passed, and all changed source and tests passed targeted lint.

Entry 008 passed Chromium, Firefox, and WebKit against immutable green batch 5.
Its two focused mounted/geometry regressions and five existing help-tooltip
regressions passed, and all changed source and tests passed targeted lint.
The expected hover behavior follows [W3C's content-on-hover guidance](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html),
which covers custom informational tooltips and users of magnification.

Entries 009–011 passed all nine public browser cases in Chromium, Firefox, and
WebKit against immutable green batch 7. The seven focused dialog ownership/bounds
cases and two mounted source-monitor regressions passed, with targeted lint.
IO-005's ordinary variable-rate source-monitor workflow also passed all three
engines against the same shared panel; its domain conversion remains counted in
the I/O ledger.

Uncounted follow-through to R2-DIALOG-012: in Framescaper, import a normal WebM,
select its clip, then Edit → Audio clips → Video keyframes. Choose Scale X,
enter `/2` as Start and 20 as End, and Add curve. The baseline created a curve
starting at zero; the exact-position grammar must reject the omitted numerator.
Both creation and anchor editing now use one strict parser. The regression keeps
valid `0/2` input working, refuses `/2`, and verifies the saved anchor values are
unchanged after refusal. All three engines passed against green batch 3, with
strict parser and targeted lint checks. This is the earlier omitted-fraction-token
defect's sibling surface and adds no new ID or count.

UI, tests, and documentation keep the same assistance runtime closure. A manual
**Update AI assets** run is not required.
