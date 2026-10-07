# Round four: dialogs, preferences, and keyboard controls

This register counts only new defects beyond the previous three audits. Each
entry has an ordinary menu, keyboard, pointer, or field reproduction on the
immutable `a0322d6e4` baseline. Sibling symptoms of earlier roots and test-harness
failures are excluded from the count.

| ID | Ordinary reproduction | Before / expected behavior | Correction and evidence |
| --- | --- | --- | --- |
| R4-DIALOG-001 | Framescaper → Edit → Preferences → Workspace. Enter Picture review in Workspace name, click Create from current layout, then Delete. Close Preferences and reload. | Deletion switched the editor to Soundscaper's unsupported modern layout. Framescaper should recover its supported Video editor layout and persist that choice. | Pass the product's configured default workspace through the custom-workspace deletion operation. The public Chromium baseline reproduced modern instead of video-editor; the complete create/delete/reload workflow passes Chromium, Firefox, and WebKit on immutable dialogs-batch1. Three strict real-composition regressions preserve Soundscaper's default, exact restored panels/toolbars, saved preferences, and inactive-custom deletion; all 26 focused preference/project tests pass. |

Browser regression: `audio-editor-round4-workspace-delete-fallback.spec.js`.
Strict regression: `audio-editor-round4-workspace-delete-fallback.test.ts`.

These UI/preference changes do not change generated assistance runtime bytes or
target inventories. A manual **Update AI assets** run is not required.
