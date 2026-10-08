# Round five: dialogs, preferences, and authoring controls

Only distinct defects reachable through ordinary public editor actions enter
this register. The immutable baseline is `fe6440c81`; prior audit roots, their
sibling symptoms, unsupported capabilities, and test setup failures are excluded.
An entry remains pending until its public workflow passes the corrected build.

| ID | Ordinary reproduction | Before / expected behavior | Correction and evidence |
| --- | --- | --- | --- |
| R5-DIALOG-001 | Framescaper → Generate → Video Generators → Add Title/Text. Enable Split tool and split the Title, then disable Split tool. Select the right title with Enter, Effect → Video Finishing → Selected Visual Inspector, change Text to Independent title and Apply. Close, select the left title with Enter and reopen the inspector. | The unselected left title also reads Independent title because the selected-clip inspector changes their shared generator source. Its text should remain Title. | When another timeline or bin clip references the source, create a retained-attribute source for the selected edit and rebind only that clip in the same batch. The public Chromium baseline fails at the left title's changed text; two strict real-command cases fail before the repair and all three pass afterward, together with six existing inspector-model cases. The public regression preserves both title texts and checks one Undo/Redo; Chromium, Firefox, and WebKit all pass against immutable green1 `23070df21` (3/3). Source inventory and retained attributes are verified by the real-command cases. |
