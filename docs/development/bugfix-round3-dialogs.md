# Third dialog and control bug audit

These entries are distinct defects beyond the previous 202 fixes. Each failed
through ordinary public menus, pointer gestures, or keyboard input on the immutable
round-three baseline. Tests do not install editor state or require malformed files.

| ID | Ordinary reproduction | Before / expected behavior | Fix and regression |
| --- | --- | --- | --- |
| R3-DIALOG-001 | Framescaper → Generate → Video Generators → Add Solid. Select its clip, Effect → Edit Video Mask/Matte. Choose Ellipse, Width 0.5, Height 0.25, then Create and attach mask. Change Width to 0.6 and click Update attached mask. | The valid update failed with “A finishing visual presentation command must mutate state; no-op commands are unsupported.” The mask geometry should update while its existing attachment stays intact. | Omit the unchanged presentation command when the chosen mask is already attached. The public browser regression reached the error on the original build; the new workflow saves 0.6, reopens it, and restores 0.5 with one Undo. Strict command tests also submit every resulting command through its real normalizer. |
| R3-DIALOG-002 | Create the same Ellipse mask with Width 0.5 and Height 0.25. Close the mask dialog and reopen Effect → Edit Video Mask/Matte. | The fields displayed Rectangle, Width 0.75, Height 0.75 instead of the saved geometry. A later change therefore also replaced untouched geometry. | Carry attached vector-mask geometry in the dialog model and initialize the selected mask's fields from it. The original public browser workflow displayed Rectangle; the corrected workflow displays Ellipse, 0.5, and 0.25. Strict model regression verifies the saved geometry. This is field initialization, separate from 001's command admission failure. |
| R3-DIALOG-003 | Edit → Preferences → Audio settings. In the recording offset field, replace 0 with 123 and press Escape, then Tab. Close and reopen Preferences. | Escape closed Preferences instead of canceling the field draft; a subsequent blur could publish the discarded 123. The active field should restore its saved 0 before Escape is allowed to close its parent. | Extract the recording offset's guarded draft lifecycle. Consume Escape, restore the saved value, and prevent the canceled draft's blur from committing. The original public workflow lost the dialog after Escape; the corrected workflow remains open and still shows 0 after reopening. A mounted regression reproduces the stale blur and verifies a later valid fractional offset still commits. |

All three workflows passed Chromium, Firefox, and WebKit against immutable green
batch 1. The existing Chromium mask validation, preset, and removal workflow also
passed; its invalid Height 0 validation remains intact. Focused Node regressions
passed 38 tests. Changed source and tests passed targeted lint.

UI, tests, and documentation keep the same assistance runtime closure. A manual
**Update AI assets** run is not required.
