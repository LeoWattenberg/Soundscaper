# Round four: dialogs, preferences, and keyboard controls

This register counts only new defects beyond the previous three audits. Each
entry has an ordinary menu, keyboard, pointer, or field reproduction on the
immutable `a0322d6e4` baseline. Sibling symptoms of earlier roots and test-harness
failures are excluded from the count.

| ID | Ordinary reproduction | Before / expected behavior | Correction and evidence |
| --- | --- | --- | --- |
| R4-DIALOG-001 | Framescaper → Edit → Preferences → Workspace. Enter Picture review in Workspace name, click Create from current layout, then Delete. Close Preferences and reload. | Deletion switched the editor to Soundscaper's unsupported modern layout. Framescaper should recover its supported Video editor layout and persist that choice. | Pass the product's configured default workspace through the custom-workspace deletion operation. The public Chromium baseline reproduced modern instead of video-editor; the complete create/delete/reload workflow passes Chromium, Firefox, and WebKit on immutable dialogs-batch1. Three strict real-composition regressions preserve Soundscaper's default, exact restored panels/toolbars, saved preferences, and inactive-custom deletion; all 26 focused preference/project tests pass. |
| R4-DIALOG-002 | Window → History; Window → Markers. From Markers' panel menu choose Arrange panel → History → As tab. Activate Markers, open its panel menu with Enter, and activate Close with Enter. | Markers disappeared and History remained visible, but the removed tab/menu left keyboard focus outside the surviving panel. Closing an active tab should hand keyboard use to its remaining sibling. | Capture the next sibling before closing and focus its mounted panel-menu control after layout publication. The original Chromium workflow failed at History's inactive menu button; the corrected two-tab and three-tab workflows focus the surviving control and reopen its menu with Enter in Chromium, Firefox, and WebKit on immutable ready-clean1 (6/6). Three strict lifecycle regressions check deferred replacement mounting, next-sibling position, and last-tab/unrelated-focus behavior; all 23 focused panel/header/clock tests pass. |
| R4-DIALOG-003 | Edit → Preferences → Editing. Replace Mouse zoom precision with 12 and press Escape, then Tab. Also Track display: replace Low/mid crossover 250 with 300 and press Escape. Close and reopen Preferences. | Both active drafts dismissed Preferences instead of restoring the saved values; blur could publish the abandoned number. An active preference draft should own cancellation, with idle Escape still available to close the dialog. | Add guarded cancellation to the shared bounded-preference number owner and its atomic crossover-pair sibling. The two ordinary Chromium workflows fail on the baseline and pass all three engines on ready-clean1 (6/6), retaining Enter commit and reopen assertions. Three mounted regressions preserve canceled blur, invalid numeric admission, idle Escape and later valid edits; all nine focused new/existing preference cases pass. Count these preference cancellation paths once; R3-DIALOG-003 fixed the separate recording-offset owner, while D04 addressed incomplete numeric typing. |

Browser regression: `audio-editor-round4-workspace-delete-fallback.spec.js`.
Strict regression: `audio-editor-round4-workspace-delete-fallback.test.ts`.

These UI/preference changes do not change generated assistance runtime bytes or
target inventories. A manual **Update AI assets** run is not required.
