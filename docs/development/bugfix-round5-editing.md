# Round five editing audit

Only ordinary menu, keyboard and pointer workflows qualify. Every counted root
has a failing public reproduction on immutable `fe6440c81`; source-only probes,
unsupported actions and earlier roots are excluded. Variants sharing a correction
are grouped under one ID. Browser green evidence is recorded when available.

| ID | Ordinary user steps | Failure before correction | Correction | Evidence |
| --- | --- | --- | --- | --- |
| R5-EDIT-001 | Import an ordinary WAV. Window → Mixer: add a group bus and send bus; assign the recording's Output to Group bus 1 and its send to 0 dB. Click the recording header and Edit → Duplicate. Undo and Redo. | The copy changes Output to Master and loses its send. Edit Duplicate uses its own selection planner, which never restates outgoing routing; the earlier R4-EDIT-001 correction applies to the separate track-menu document planner. | Pass the already-owned routing-preservation port into the selection planner. Restate derived audio routing after its clipboard command materializes clips, before publishing the final selection. Keep original routes, independent identities and one history entry. Header and range selection variants share this one root. | Immutable Chromium public RED at the copy's exact Output combobox (`/tmp/soundscaper-r5-edit-duplicate-routing-browser-red.log`). Two strict actual-controller route-map cases RED → GREEN; complete selection/document/image Duplicate support passes 11/11, checking source preservation, unique route IDs and complete Undo/Redo. Targeted type-aware lint passes. All-engine public GREEN pending the coordinated build; this entry is not yet a completed fix. |
