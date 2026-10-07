# Fourth editing bug audit

Every counted root has an ordinary user reproduction on the immutable
`a0322d6e4` baseline. Setup uses normal media imports and existing menus,
keys and pointers. Earlier roots, intentional limits and harness failures
are excluded; multiple symptoms from one cause share an entry.

| ID | Ordinary user steps | Actual before the fix | Expected and correction | Red and green evidence |
| --- | --- | --- | --- | --- |
| R4-EDIT-001 | Import a normal stereo WAV. Window → Mixer; add a group bus and a send bus. Assign the imported track's Output to Group bus 1 and its send to 0 dB. Track menu → Duplicate track; inspect the copy's mixer channel. Undo once and Redo. | The copy uses Master and has no authored send. The document duplication planner copies track processing and automation but omits mixer topology. | Restate the source track's assignment and sends after all copied clips establish the target channel width. Reuse the existing validated routing planner through a shared model and the document's authored-command preview, keeping the source unchanged and the whole duplicate in one history entry. This is a separate document planner from the earlier stereo-split route correction. | Baseline Chromium is red with the copy's Output empty instead of the group ID. A strict public-controller regression is red with a Master edge and absent send, then green with exact edge settings, unique identities and Undo/Redo. It and existing label duplication, project-view, structural and stereo-routing support pass (19/19). The ordinary menu workflow passes Chromium, Firefox and WebKit on unique `editing-duplicate-routing-green1` (3/3). Both product builds, targeted lint, controller-domain and size gates pass. |
