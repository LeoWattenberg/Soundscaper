# Second dialog and control bug audit

Each numbered entry is a new, distinct underlying defect, beyond the first
round's 102 fixes. Reproductions use ordinary menus, pointer interaction, and
keyboard input. No entry requires modified application state or malformed files.

| ID | Ordinary reproduction | Before / expected behavior | Fix and regression |
| --- | --- | --- | --- |
| R2-DIALOG-001 | Window → Markers → Add marker at playhead. With the new marker focused, press F2 and type its name. | F2 entered rename state but left focus on the marker button, so typing could not edit its name. Focus should enter the Name field. | Focus and select the docked rename input when editing begins. Browser: `F2 in the docked Markers list focuses the annotation name for renaming` failed on the original build and passed after the fix. |
| R2-DIALOG-002 | Import ordinary audio, open its Clip properties, expand Media settings, type a new Clip name and press Enter. Then edit the name again and press Escape before leaving it. | Enter left the draft uncommitted; Escape did not cancel it. Single-line inspector fields should commit on Enter and restore the saved value on Escape without the following blur committing the canceled draft. | Add the existing guarded draft lifecycle to the shared inspector CommitField. Browser: `Enter commits an inspector name and Escape discards a later rename draft` failed at the unchanged clip title on the original build and passed after the fix; Node: `audio-editor-inspector-draft-keyboard.test.tsx`. Commit/cancel are one underlying lifecycle defect, counted once. |

The initial two browser regressions passed in Chromium, Firefox, and WebKit against the production
build. UI, tests, and documentation retain the existing assistance runtime
closure; a manual **Update AI assets** run is not required.
