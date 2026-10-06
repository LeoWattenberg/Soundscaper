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
