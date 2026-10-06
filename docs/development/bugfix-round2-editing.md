# Second editing bug audit

Only distinct failures reached through ordinary editor controls are counted.
Browser regressions import normal PCM WAV recordings through the file picker,
then use menus, keyboard navigation, and existing clip controls. They do not
inject editor state or use malicious documents. Each accepted entry failed in
the browser before its corresponding source fix.

| ID | Ordinary user steps | Actual before the fix | Expected and correction | Regression |
| --- | --- | --- | --- | --- |
| R2-EDIT-001 | Import a short recording and a longer recording. Select the short recording's header, jump to project end, Select → Region → Cursor to track end, then View → Skip to → Selection start. | Selection starts at the short track's start, frame 0. | Select between its end and the later cursor. Always anchor this command at the selected track's end, including when the cursor is beyond it. | Strict TypeScript controller test covers cursors before, at, and after the track end. Browser: `Cursor to track end selects from the end when the cursor is beyond the selected track`, also verifies the other endpoint. |
| R2-EDIT-002 | Import two recordings. On the first track, open its menu → Track visualization → Spectrogram. | Both tracks become spectrograms. | Change only the requested track. Stop rewriting the global timeline visualization as a side effect of a track command. | Updated strict TypeScript visualization test; browser: `changing one track visualization leaves other tracks in their existing view`, including Undo and the global Spectrogram toggle. |
| R2-EDIT-003 | Move a track into a new folder, right-click that folder → New folder, select the child folder, and collapse its parent. | Every visible folder has tabindex −1, so Tab cannot reach the tree. | Give the nearest visible ancestor the active tab stop. When the active folder no longer exists, recover the first visible folder. | Strict TypeScript folder-plan tests cover hidden and removed active folders. Browser: `collapsing a parent keeps its visible folder in the keyboard tab order`, including actual Shift+Tab navigation. |
| R2-EDIT-004 | Move a track into a new folder. Focus its row, press F2, type a name, and press Enter. Press Left to collapse it. | Rename succeeds, but focus falls to the document body and Left cannot navigate the folder. | Restore focus to the connected folder row after the rename input is removed. Enter commits and Escape cancels; ordinary Tab and outside-click behavior remain available. | Strict TypeScript keyboard-lifecycle tests cover Enter, Escape, Tab, and removed rows. Browser: `committing a folder rename keeps keyboard navigation on the folder row`. |

Initial four fixes: 12 browser cases passed across Chromium, Firefox, and WebKit.
Focused Node regressions also passed. Broader checks are coordinated with the
other audit owners.

No manual **Update AI assets** run is required: the assistance runtime closure
and target inventories are unchanged.
