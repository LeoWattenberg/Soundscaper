# Third dialog and control bug audit

These entries are distinct defects beyond the previous 202 fixes. Each failed
through ordinary public menus, pointer gestures, or keyboard input on the immutable
round-three baseline. Tests do not install editor state or require malformed files.

| ID | Ordinary reproduction | Before / expected behavior | Fix and regression |
| --- | --- | --- | --- |
| R3-DIALOG-001 | Framescaper → Generate → Video Generators → Add Solid. Select its clip, Effect → Edit Video Mask/Matte. Choose Ellipse, Width 0.5, Height 0.25, then Create and attach mask. Change Width to 0.6 and click Update attached mask. | The valid update failed with “A finishing visual presentation command must mutate state; no-op commands are unsupported.” The mask geometry should update while its existing attachment stays intact. | Omit the unchanged presentation command when the chosen mask is already attached. The public browser regression reached the error on the original build; the new workflow saves 0.6, reopens it, and restores 0.5 with one Undo. Strict command tests also submit every resulting command through its real normalizer. |
| R3-DIALOG-002 | Create the same Ellipse mask with Width 0.5 and Height 0.25. Close the mask dialog and reopen Effect → Edit Video Mask/Matte. | The fields displayed Rectangle, Width 0.75, Height 0.75 instead of the saved geometry. A later change therefore also replaced untouched geometry. | Carry attached vector-mask geometry in the dialog model and initialize the selected mask's fields from it. The original public browser workflow displayed Rectangle; the corrected workflow displays Ellipse, 0.5, and 0.25. Strict model regression verifies the saved geometry. This is field initialization, separate from 001's command admission failure. |
| R3-DIALOG-003 | Edit → Preferences → Audio settings. In the recording offset field, replace 0 with 123 and press Escape, then Tab. Close and reopen Preferences. | Escape closed Preferences instead of canceling the field draft; a subsequent blur could publish the discarded 123. The active field should restore its saved 0 before Escape is allowed to close its parent. | Extract the recording offset's guarded draft lifecycle. Consume Escape, restore the saved value, and prevent the canceled draft's blur from committing. The original public workflow lost the dialog after Escape; the corrected workflow remains open and still shows 0 after reopening. A mounted regression reproduces the stale blur and verifies a later valid fractional offset still commits. |
| R3-DIALOG-004 | Window → Markers. Use the panel menu to choose Floating. Drag its Resize: Markers grip to shrink the panel; while holding the mouse button, press Escape, then release. | Escape left the panel at its preview size: the baseline workflow changed its width from 360 to 310 pixels. Cancellation should restore the original dimensions and the later release should publish nothing. | Give the dock resize owner an Escape listener and cancel its preview during teardown. The strict lifecycle regression also verifies idle Escape remains available and a later mouse release cannot commit a canceled session. This resize owner is separate from the title-movement owner fixed in R2-DIALOG-024. |
| R3-DIALOG-005 | Framescaper → Tracks → Caption Tracks. Set Track name to French dialogue and Language to fr, paste a normal one-cue SRT into Sidecar text, and Import sidecar text. Close and reopen Caption Tracks, then import edited cue text into the same track. | The reopened fields displayed Captions and und. The next import silently replaced the authored track metadata with those defaults. | Seed destination fields from the saved caption track, including its sequence, and refresh when the chosen track changes. Unrelated project updates preserve a local name draft. The public baseline failed at the displayed Captions; the corrected workflow retains French dialogue/fr both in the fields and in its visible canonical document after reimport. |
| R3-DIALOG-006 | Framescaper → Generate → Video Generators → Add Solid. Select the clip, Generate → Video Generators → Save Visual Preset. Save My solid, select it in Saved visual preset, then Remove visual preset. | The chooser displayed None, but Apply and Remove stayed enabled with the deleted ID, so another action addressed a nonexistent preset. | Reconcile selected visual and finishing preset IDs when their inventories change, preserving surviving choices and clearing an empty inventory. The baseline public workflow reached the enabled obsolete action; the corrected workflow disables both actions after deletion. A mounted regression also verifies fallback to a surviving preset. Count both preset kinds as one inventory-lifecycle defect. |
| R3-DIALOG-007 | Edit → Preferences. Drag Resize: Editor preferences to shrink the window; while holding the mouse button, press Escape, then release. | Escape dismissed Preferences with an active resize instead of canceling that preview. The first Escape should restore its original dimensions and keep the dialog open; a later idle Escape should close it. | Let the live modal-resize owner take Escape before its underlying modal. Restore the original inline dimensions, cancel queued preview frames, and prevent later release publication. The baseline public workflow lost the dialog; the corrected workflow restores its original width, survives mouse release, and closes on the second Escape. Strict listener-lifecycle tests also cover teardown and idle modal ownership. Group all uses of this shared modal-resize owner once; it is separate from 004's dock-panel resize session. |
| R3-DIALOG-008 | Edit → Preferences → Playback/Recording. Hover Help: Keep input devices open between recordings, then move diagonally toward the right side of its explanation. | The explanation disappeared while crossing the gap from its trigger, before the pointer reached its text. Users reading hover content with magnification or a large pointer should be able to enter that content. | Preserve hover visibility within the bounded path connecting the trigger and tooltip, and dismiss it when the pointer leaves that path. The original public workflow lost the explanation; the corrected workflow reaches its text, dismisses on pointer exit, and dismisses with Escape while leaving Preferences open. Mounted and geometry regressions preserve click-toggle and focus behavior. Group all uses of this shared tooltip once. |
| R3-DIALOG-009 | File → Import a normal WAV. Analyze → Contrast. Drag its title left while holding the mouse button, press Escape, then release. | Escape closed Contrast during its active title move. Cancellation should restore its original position and keep the dialog open, with a later idle Escape available to close it. | Give the shared dialog title's move session Escape ownership until completion or cancellation. The baseline public workflow lost Contrast; the regression checks restored coordinates, no effect from later release, and idle dismissal. Strict lifecycle tests preserve normal completion and listener teardown. This title owner is independent of the modal resize owner in 007 and the workspace-panel title owner in R2-DIALOG-024. |
| R3-DIALOG-010 | Framescaper → Project bin → Import two ordinary video files. Open a source with its Source monitor button, click Play, then Mark in after playback advances. | Mark in recorded the old stopped frame zero instead of the frame currently playing. Frame stepping and playback completion also used that stale stopped authority. | Publish the live media clock through the source monitor's authenticated media-time action before marking, stepping, or ending. Marks retain ongoing playback; stopped operations preserve their exact authored ordinal without resampling the decoder. The public baseline kept Mark in at zero after more than 0.25 seconds of playback. A mounted regression was red at the omitted clock publication and verifies operation order, exact stopped marks, and completion. Group these live-clock handoffs once. |
| R3-DIALOG-011 | Framescaper → Project bin → Import two ordinary videos. Open the first Source monitor, click Play, then open the second with its Source monitor button. | The new media was stopped, but the panel still showed Pause and retained the preceding source's playing state. | End the UI playback session whenever the source identity changes, then position the new stopped media. The baseline public workflow changed sources without restoring Play. The mounted regression also verifies one pause and the new media's zero position. This target-session lifecycle is separate from 010's live-clock publication and IO-005's variable-rate conversion. |
| R3-DIALOG-012 | Window → Markers → Add marker at playhead. Click the last Start sample digit, type 1, then Enter. Continue editing that field. | The marker moved to sample 48, but its time control lost focus after saving. The frame value formed the React key, replacing the focused control on every change. | Keep the start and end controls mounted when their saved times change; their existing value synchronization updates the digits. The public baseline reached the successful sample-48 move and failed the retained-focus assertion. A mounted regression verifies stable control identity and focus for both marker start and region end publication. |
| R3-DIALOG-013 | Framescaper → Tracks → Caption Tracks. Import a normal one-cue SRT using Sidecar text, let the project save, then open the same editor in another browser tab. Return to the first tab and export the caption track, or close and reopen Caption Tracks. | The second tab took the editing lease, making the first tab read-only. Export selected track became disabled and Caption Tracks could not reopen, preventing a read operation on existing captions. | Separate sidecar export admission from caption authoring admission and keep the caption menu reachable for read-only export. The public baseline reached a disabled export button after an ordinary lease takeover. The corrected workflow reopens the dialog, keeps its authoring fields disabled, and downloads the existing cue. Mounted and menu regressions verify export reaches the file service without admitting a document edit; other finishing authoring menus stay disabled. |
| R3-DIALOG-014 | Framescaper → File → Import a normal 25 fps video. Select its clip, move the program playhead to 00:00:00:12 on the default 30 fps sequence, then Edit → Audio clips → Trim left edge to playhead. Open Clip properties → Media settings and inspect or edit Source in. | The 0.400-second source offset displayed 00:00:00.000. The field treated its native source ordinal 10 as ten project audio samples, so time edits also supplied sample counts as video ordinals. | Give Source in a focused boundary that reads authenticated video presentation times and translates edited seconds back to the source's ordinal. Audio source offsets retain their own sample clock. The public baseline displayed 000 instead of 400 milliseconds; the corrected workflow displays 400, saves a valid edit to 240 milliseconds, and reopens that value. Mounted CFR and authenticated VFR regressions verify the exact displayed boundary, native ordinal commits, and no edit on untouched blur. |

| R3-DIALOG-015 | Framescaper → Generate → Video Generators → Add Still Image. Choose a normal PNG, select its image clip, then Edit → Audio clips → Clip properties. Open Media settings and change Duration to two seconds. | Opening Properties failed with “clip.timelineStartFrame must be a safe integer,” so none of its fields could appear. The enabled image Properties entry should expose the still image's supported sequence timing. | Carry the selected product's existing image-aware runtime projection into the panel and give native image timing its own body. Duration and Start submit existing image-clip/set commands; unsupported audio, rename, and effect fields are omitted. The public baseline failed before the panel drew. The corrected workflow saves two seconds and reopens it. A mounted regression submits the duration command through the real Framescaper runtime and verifies exact Undo restoration. Group the entry crash and its image-body classification follow-through as one consumer-boundary defect. |

| R3-DIALOG-016 | File → Import a normal WAV. Edit → Preferences → General. Choose Program start: New project, then Language: Deutsch. | The ordinary language navigation reopened a different empty project. Interface language should preserve the document being edited; Program start should govern a later launch. | Flush the project and carry its ID through a bounded, one-use, product-scoped handoff in this tab. Bootstrap consumes it only at the chosen destination, then the saved next-session policy resumes. The public baseline changed the project ID and lost the visible clip. The corrected workflow retains both. Mounted and strict resource tests verify save-before-navigation, no startup-preference rewrite, destination/product separation, expiry, and one-use consumption. |

| R3-DIALOG-017 | Record options → Timed recording. Choose a future Start date and time, set Duration to 1.500 seconds, then choose End date and time. | The linked end field truncated its milliseconds, changing the scheduled interval from 1.500 to 1.000 second. Switching scheduling modes should retain the same authored interval. | Preserve nonzero milliseconds when formatting linked local dates and permit millisecond precision in both date inputs. The public baseline reported a 1,000-millisecond interval; the corrected workflow retains 1,500 milliseconds, has no native step mismatch, and restores the same duration on switching back. Strict model regressions also preserve fractional initialization and a moved start date. |
| R3-DIALOG-018 | Framescaper → Edit → Preferences → Keyboard shortcuts. Find New mono track, assign J, close Preferences, and press J with the editor focused. | Preferences accepted the binding, but Framescaper's existing shuttle reservation handled J first, so no track appeared. Accepted configurable shortcuts should execute; a fixed reservation must be disclosed before assignment. | Check the binding against the actual Framescaper navigation matcher and refuse it with the localized “Shuttle and edit points” conflict. Soundscaper and modified chords keep their existing behavior. The public baseline accepted but ignored J; the corrected workflow refuses J, accepts Ctrl+Alt+Shift+J, and creates one track through that chord. Strict draft and rendered-row regressions preserve other-product and modified bindings. Group all fixed shuttle and edit-point keys once. |
| R3-DIALOG-019 | Soundscaper → Edit → Preferences → Workspace → Workspace preset. Select Video editor, close Preferences, then reload normally. | Preferences offered and applied video-editor, but reload changed it back to Soundscaper. Framescaper's same picker also offered four audio layouts omitted from its other switchers. The picker should offer this product's supported presets and saved custom layouts consistently. | Reuse the existing product-specific workspace inventory already used by View, the sidebar, and the action bar. The public baseline reproduced the select-and-reload loss and both incorrect option inventories. The corrected two-product workflow checks the exact supported choices, creates a custom layout, and retains it after reload. Mounted regressions preserve custom selection. Group both product variants once. |
| R3-DIALOG-020 | File → Import a normal WAV and select its clip. Click a Playhead digit so it is active, then press Backspace. | Backspace deleted the selected timeline clip while its time digit was being edited. Active composite digits should own native editing keys just as native text inputs do. | Recognize the actual active TimeCode digit in the workspace shortcut admission layer. The baseline public gesture reduced the clip count from one to zero. The corrected workflow retains the clip after both Backspace and Delete inside the digits, then leaves digit editing and confirms ordinary clip Backspace still deletes it. A mounted shared-control regression also retains printable-key ownership, non-native modified commands, and idle group commands. Group all active time-digit shortcut collisions once; this is separate from D24's toolbar arrow navigation. |
| R3-DIALOG-021 | File → Import a normal mono WAV. Edit → Metadata editor → ADM. Enable ADM, Add object, select Azimuth 0, type 145, then Tab. Choose Edit → Undo. | Undo restored the intermediate prefix 14 rather than the value 0 preceding the completed edit. Each typed valid prefix created a separate document edit. | Keep position and gain drafts local until blur or Enter confirms the complete native-valid value. Escape cancels the draft and guards its later blur. The public baseline restored 14; the corrected workflow restores 0 in one Undo. A mounted regression verifies no publication while typing 1, 14, or 145 and one publication at confirmation, plus cancellation. Group all numeric ADM fields once; this transaction defect is separate from IO-014's negative-prefix admission. |
| R3-DIALOG-022 | File → Import a normal WAV. Turn on Spectrogram, right-click a vertical frequency ruler, click Min, then press Up and Left while editing its text. | Up changed the number from 0 to 10 but moved focus to another popup control; Left likewise intercepted text caret movement. The focused field should retain its own numeric and caret arrows. | The popup respects a child's consumed event and leaves arrows to its editable frequency inputs while retaining group navigation elsewhere. The public baseline reached 10 and lost input focus. A mounted regression reproduces that event ownership and verifies native caret navigation. This popup's parent handler is independent of D24's toolbar navigation and 020's global command layer. |
| R3-DIALOG-023 | In the same frequency ruler popup on the default 48 kHz project, type Max 23000 Hz and press Enter. | The popup refused the valid value and restored 20000 Hz because its hardcoded ceiling was 22050 Hz. A 48 kHz project admits frequencies up to its 24000 Hz Nyquist. | Pass the actual geometry sample rate to the popup and derive its ceiling from that rate. The public baseline retained 20000; the corrected workflow saves 23000. Mounted regressions retain the exact 48 kHz, 44.1 kHz, and 8 kHz endpoints and refuse values above each ceiling. This ruler-boundary omission is independent of 022's key ownership. |
| R3-DIALOG-024 | Import an ordinary short WAV, Select all → Loop region → Set loop to selection, Select none, then Record options → Record loop into takes. Record across several passes and stop. Open the recorded track's Take lanes and comps, then open the same editor in another tab and return to the first tab. | The second tab took the editing lease, and Audition lane and Audition take became disabled in the first tab. Listening to existing recordings is a read operation and its isolated preview engine already permits it. | Admit take selection and audition separately from document editing. Preserve simultaneous busy and locked-track restrictions and pending operation ownership; promotion, boundaries, flattening, and removal stay blocked. The public baseline reached a disabled Audition lane after normal recording and lease takeover. The corrected workflow auditions successfully and leaves promotion disabled. A mounted red→green regression verifies the readable call, persistent-operation refusal, pending disable, recording overlap, and locked-track policy. This independently implemented audition owner is separate from 013's caption export owner. |
| R3-DIALOG-025 | In that ruler popup, select Max, type the complete scientific number `1e3`, then press Enter. | The saved ruler maximum became 1 Hz rather than 1000 Hz because the wrapper's commit parser read only an integer prefix. | Parse the complete finite number before checking bounds, preserving decimals and scientific notation and refusing omitted, incomplete, trailing, or nonfinite text. The public baseline saved 1; the corrected workflow saves 1000. A mounted wrapper regression was red at the same wrong value and checks both valid formats and refusals. This completed-field parser is independently implemented from D19's NumberStepper arrow/unit parser; its numeric-format variants count once. |
| R3-DIALOG-026 | Import an ordinary WAV, select its clip, Effect → Pitch and tempo → Audio warp and transients. Create identity warp map, type 1000 into both marker positions, Add marker, focus Delete marker 1, then press Enter. Continue with Enter again. | Removing the final marker removed its focused action and left focus on the document body, so the next Enter could not add another marker. | After the owned removal completes, hand lost focus to the adjacent surviving Delete action, or Add marker when none remain. Preserve a newly chosen focus target and reject a stale project/clip owner. The public baseline removed the marker and failed the Add marker focus assertion; the corrected workflow focuses Add marker and the next Enter adds it again. Two mounted regressions cover final and adjacent marker removal. This removal path is independent of R2-DIALOG-008's temporary disabling and R2-EDIT-012's source-waveform marker controls. |

All three workflows passed Chromium, Firefox, and WebKit against immutable green
batch 1. The existing Chromium mask validation, preset, and removal workflow also
passed; its invalid Height 0 validation remains intact. Focused Node regressions
passed 38 tests. Changed source and tests passed targeted lint.

Entries 004–006 passed all nine browser cases in Chromium, Firefox, and WebKit
against immutable green batch 2. Their four focused strict Node regressions and
changed-file lint also passed.

Entry 007 passed Chromium, Firefox, and WebKit against immutable green batch 3.
Its two strict lifecycle regressions and the existing modal Escape regressions
passed, and all changed source and tests passed targeted lint.

Entry 008 passed Chromium, Firefox, and WebKit against immutable green batch 5.
Its two focused mounted/geometry regressions and five existing help-tooltip
regressions passed, and all changed source and tests passed targeted lint.
The expected hover behavior follows [W3C's content-on-hover guidance](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html),
which covers custom informational tooltips and users of magnification.

Entries 009–011 passed all nine public browser cases in Chromium, Firefox, and
WebKit against immutable green batch 7. The seven focused dialog ownership/bounds
cases and two mounted source-monitor regressions passed, with targeted lint.
IO-005's ordinary variable-rate source-monitor workflow also passed all three
engines against the same shared panel; its domain conversion remains counted in
the I/O ledger.

Entry 012 passed Chromium, Firefox, and WebKit against immutable green batch 8.
Its mounted regression and the existing annotation component suite passed all
18 focused Node cases. Changed source and tests passed targeted lint.

Entry 013 passed Chromium, Firefox, and WebKit against immutable green batch 9.
Its two focused mounted/menu regressions and the existing finishing regressions
passed. Changed source and tests passed targeted lint.

Entry 014 passed Chromium, Firefox, and WebKit against immutable green batch 9.
Its two mounted native-video cases and the existing clip media/projection suite
passed all six focused Node cases. Changed source and tests passed targeted lint
and the file-size gate.

Entry 015 passed Chromium, Firefox, and WebKit against immutable green batch 10.
Its mounted image-runtime regression and existing panel/model-boundary tests
passed all 12 focused Node cases. Changed source and tests passed targeted lint,
source typecheck, and the file-size gate.

Entry 016 passed Chromium, Firefox, and WebKit against immutable green batch 11.
Its mounted and strict handoff cases plus existing bootstrap/startup/preferences
regressions passed all 31 focused Node cases. Changed source and tests passed
targeted lint, source typecheck, controller-domain policy, and the file-size gate.

Entry 017 passed Chromium, Firefox, and WebKit against immutable green batch 12.
Its two strict precision regressions and the five existing timed-recording model
cases passed. Changed source and tests passed targeted lint and the file-size
gate; the authoritative source and test typechecks also passed.

Entries 018–019 passed all nine public browser cases in Chromium, Firefox, and
WebKit against immutable green batch 14. Their focused Node suites passed 61
and 17 cases respectively, including the new draft/row and mounted product
inventory regressions. Changed source and tests passed targeted lint and the
file-size gate; the authoritative source and test typechecks also passed.

Entry 020 passed Chromium, Firefox, and WebKit against immutable green batch 15.
The mounted TimeCode regression and existing workspace-keyboard cases passed all
23 focused Node tests. Changed files passed targeted lint and the size gate;
authoritative source and test typechecks also passed.

Entry 021 and the unchanged negative ADM regression passed all six browser cases
in Chromium, Firefox, and WebKit against immutable green batch 16. The mounted
transaction regression, existing field validation, and ADM metadata suite passed
all 20 focused Node tests. Changed source and tests passed targeted lint.

Entries 022, 023, and 025 passed all nine public browser cases in Chromium,
Firefox, and WebKit against immutable green batch 18. The three mounted regressions
and existing NumberStepper and waveform-menu cases passed all seven focused Node
tests. Changed application files and tests passed targeted and changed-file lint
and the file-size gate.

Entry 024 passed its normal loop-recording and second-tab public workflow in
Chromium against immutable green batch 18. Firefox and WebKit skip this case
because the existing real microphone-device fixture is Chromium-specific.
Its new mounted admission regression and existing take-dialog UI and lifecycle
cases passed all 10 focused Node tests. Changed source, copy, and tests passed
targeted and changed-file lint and the size gate.

Uncounted follow-through to R3-DIALOG-003: after canceling a changed recording
offset with Escape, press Escape again while the restored field still has focus.
The clean field previously consumed that second Escape indefinitely, preventing
Preferences from closing. Only an active draft now owns cancellation; idle Escape
reaches the modal. The original cancellation workflow and the new second-Escape
workflow passed all six browser cases against green batch 18, and the mounted
regression verifies dirty cancellation, guarded blur, idle propagation, and a
later valid fractional edit. This adds no new ID or count.

Uncounted follow-through to R2-DIALOG-012: in Framescaper, import a normal WebM,
select its clip, then Edit → Audio clips → Video keyframes. Choose Scale X,
enter `/2` as Start and 20 as End, and Add curve. The baseline created a curve
starting at zero; the exact-position grammar must reject the omitted numerator.
Both creation and anchor editing now use one strict parser. The regression keeps
valid `0/2` input working, refuses `/2`, and verifies the saved anchor values are
unchanged after refusal. All three engines passed against green batch 3, with
strict parser and targeted lint checks. This is the earlier omitted-fraction-token
defect's sibling surface and adds no new ID or count.

Uncounted follow-through to R3-DIALOG-011: in Framescaper, add a normal 25 fps
video from Project bin to the timeline, select it, set the program playhead to
frame 6, open that same source in Source monitor, and click Play. After playback
advances, click Match frame. The baseline kept the source playing instead of
showing the requested stopped program frame. Explicit reopening now creates a
new viewing session even when its source ID is unchanged; ordinary clock and
mark publications preserve the current session. All three engines passed this
public workflow against green batch 13. Mounted and service regressions passed
with the existing authenticated variable-rate tests (30 focused Node cases),
and changed files passed targeted lint. This is 011's target-session lifecycle
follow-through and adds no ID or count.

Entry 026 passed all three browser engines against immutable green batch 20.
Its two mounted regressions and the existing operation-focus, Audio warp UI,
and project-state cases passed all eight focused Node tests. Changed source and
tests passed targeted lint and the size gate.

UI, tests, and documentation keep the same assistance runtime closure. A manual
**Update AI assets** run is not required.
