# Round seven import and export bugs

Only distinct defects reached through ordinary menus and ordinary authored media
qualify. Parser grammar variants and output variants of one owner count once.
Verification records below retain small receipts; generated media, browser output
and raw coverage are removed immediately after verification by the owning runner.

| ID | Ordinary user workflow | Defect and repair | Evidence |
| --- | --- | --- | --- |
| R7-IO-001 | Framescaper → Tracks → Caption tracks → import an ordinary WebVTT transcript containing header text, a NOTE comment and whitespace around its timing arrow. | Passive WebVTT syntax was classified as invalid or active content. Accept the standard passive header/NOTE/timing grammar while preserving the existing closed content policy. Header, NOTE and whitespace variants count once. | Three causal RED tests: INVALID_HEADER, INVALID_TIMING and ACTIVE_CONTENT. Caption import/profile/closed-voice focused suite GREEN 27/27. Public menu regression `tests/browser/audio-editor-round7-io-caption-webvtt.spec.js` GREEN on the root's fresh Chromium product build; actual authored cue text and 4800–24000 frame timing verified. |
| R7-IO-002 | File → Open a normal Audition SESX session after overlapping clips and choosing Bring Clip to Front. | The importer ignored SESX zOrder and mixed every overlapping clip. Convert non-crossfaded stacking into audible source spans, preserving source offsets and original fade gain across fragments; discard fully occluded source leases. | Causal RED expected three audible spans, received two overlapping full clips. Corrected public native Open service, explicit zOrder, source cleanup and fade sample regressions GREEN 4/4; SESX/native service support GREEN 20/20 before the additional fade regression. [Adobe's ordinary clip stacking rule](https://helpx.adobe.com/ca/audition/desktop/mixing-multitrack-sessions/arranging-editing-multitrack-clips.html). |
| R7-IO-003 | Desktop File → Import an ordinary Broadcast WAVE named Dialogue.wav, then File → Overwrite Dialogue.wav. | Extension-only format inference re-exported plain WAV and silently discarded Broadcast WAVE metadata. Use the validated RIFF metadata to select the existing BWF delivery. | Causal RED preserved `wav` instead of `bwf`; corrected original import recorder and real export plan preserve description and time reference. Original precision/service/lease support GREEN 27/27. Public original-overwrite browser witness added; runner verification pending. |
| R7-IO-004 | Desktop File → Import a 32-bit integer WAV created by Export audio, then File → Overwrite Integer32.wav. | The shortcut whitelist omitted supported int32 WAV, leaving Overwrite disabled for its own exported media. Retain the validated 32-bit integer source precision. | Causal RED original authority was null; corrected public import recorder returns int32/32. Original precision/service/lease support GREEN 27/27. Public original-overwrite browser witness added; runner verification pending. |

The strict Node witnesses use ordinary WAVs generated in memory and ordinary
authored SESX XML. They call the normal import recorder or native File Open
service; they do not introduce a private application action or adversarial media.
No large verification files or runtime archives were generated. These changes do
not require a manual **Update AI assets** run.
