# Sixth audit: dialogs and workspace controls

Baseline: `ee0d3fabd`. Only distinct roots reproduced through ordinary public
user actions and verified after correction count. Setup failures and prior roots
are excluded. API fixtures represent normal provider responses, without project
state injection.

| ID | Ordinary workflow and defect | Correction and evidence | Status |
| --- | --- | --- | --- |
| R6-DIALOG-001 | Window → Freesound; search rain; type wind without submitting; Next. Requests page two of wind rather than the displayed rain results. | Pagination explicitly uses the displayed query and preserves the unsubmitted draft; Search still submits that draft at page one. Mounted causal regression fails at wind versus rain before repair. Chromium public regression fails at the exact request before repair and passes afterward. Focused new/existing panel and attribution cases pass. | Public GREEN |
| R6-DIALOG-002 | Help → About Soundscaper; focus About; Ctrl+End. The modal selects Enabled modules instead of leaving modified navigation to its existing owner. | Guard handled and Ctrl/Meta/Alt keys in About's independent tab handler; preserve plain arrows, Home/End and existing RTL direction. Chromium public regression fails at About's changed aria-selected before repair and passes on immutable `48e4cbe22` (`/tmp/soundscaper-round6-green3-browser.log`). This is distinct from R2-DIALOG-027's physical RTL direction correction. | Public GREEN |
| R6-DIALOG-003 | Import a WAV, Move to Project bin, open its More actions menu with Enter, choose Remove from project with Enter. Cancel never receives focus; Tab can leave the modal and Escape does not cancel it. | Extract the existing confirmation into the shared dialog shell with its alertdialog role, Cancel initial focus, owned Tab/Escape and return focus. Preserve the existing removal action and check current edit blocking before confirmation. The immutable Chromium regression fails at inactive Cancel before repair. The first correction used an unsupported data attribute on the design-system Button; its public recheck remained RED. Target the rendered Cancel button within the action group instead. | Awaiting public GREEN |
