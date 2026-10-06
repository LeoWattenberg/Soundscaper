# Generator, macro, mixer and label bug audit

Only ordinary editor workflows count. Each entry below was reproduced before its
fix through menus, fields, or the user-authored macro editor.
Variations of the same defect count once.

## ROOT-001 — Macro commands do not await asynchronous editor actions

Import two ordinary WAV files. Open **Tools > Macros palette > New program** and
enter `await sound.select.all(); await sound.command('MixAndRender');
sound.log.info('tracks ' + (await sound.project.tracks()).length);`. Run the program.
Before the fix it reports three tracks and completion while mixing is still in
flight. It should wait and report two tracks: the initial empty track and the
single rendered track. The command adapter
now returns the action's result; both macro runners await it.

## ROOT-002 — A step-list macro requires multiple Undos

Import a WAV, then use **Tools > Macros palette > Import macro** to open an ordinary
Audacity macro text file containing two `NewMonoTrack:` lines. Run it, close the
palette, and press **Undo** once. Previously only one of its two tracks disappeared.
Bare editing commands now share the macro's undo transaction, including macros
with no effect steps.

## ROOT-003 — Selection commands open an unnamed effect settings dialog

Open **Tools > Macros palette**, select **Fade ends**, and click its first
**Select effect** step button (`Select: start 0, end 1`). The original opens an
unnamed dialog containing no command controls. It now opens **Select**, retains
the command's identity, and edits its own optional parameters without converting
it into an audio effect. Clearing a parameter keeps it absent.

## ROOT-004 — Generators discard the selected duration

Import a 0.8-second WAV, choose **Select > Select all**, then **Generate > Tone**.
The duration previously read 30 seconds, so accepting defaults replaced the
short selection with 30 seconds of tone. Generator defaults and range replacement
now resolve the selected duration, including a clip selected through its header.
Morse continues to derive its duration from the message.

## ROOT-005 — Generator numeric fields accept values they cannot generate

Open **Generate > Tone**, replace **Amplitude** with `1.5`, leave the field, and
press **Generate**. Previously the field retained the invalid amplitude and
generation failed. Numeric generator fields now clamp to their declared bounds
while preserving intermediate typing and resetting an empty draft on blur.
The same adapter owns amplitude, frequency and duty-cycle drafts; these are one
numeric-bound defect.

## ROOT-006 — Generator frequency bounds exceed the project limit

In a default 48 kHz project, open **Generate > Tone** and enter `30000` in
**Frequency (Hz)**. The original advertised a 96 kHz ceiling although the engine
rejects anything above the project's 24 kHz Nyquist limit. Tone, Chirp and Morse
now use half the active project sample rate as their frequency ceiling.
This is separate from ROOT-005: numeric clamping alone would still accept 30 kHz
under the original incorrect maximum.

## ROOT-007 — Silence audio leaves other selected tracks audible

Import two ordinary WAV files, choose **Select > Select all**, then
**Edit > Remove special > Silence audio**. Export WAV with dither **None**.
Originally the output still contained one original tone because only the focused
track was silenced. The command now silences the occupied spans of every selected
audio track in one edit. The browser regression reads the downloaded WAV's PCM
and verifies that the entire selected mix is silent.

## ROOT-008 — Label title keyboard drafts do not commit or cancel correctly

Open **Edit > Manage labels**, create a label, and save its title as `Original`.
Replace the text with `Cancelled draft`, press Escape, and leave the field.
Previously that draft was saved. Enter also left a completed draft uncommitted.
The title field now handles Enter and Escape through its existing blur commit
guard. Both symptoms share one missing keyboard draft lifecycle.

## ROOT-009 — Track-creation macros cannot run in an empty project

In a fresh project, open **Tools > Macros palette > Import macro** and import a
text macro containing two `NewMonoTrack:` lines. Previously **Run macro** was
disabled because the project had no audio selection, even though the commands
create their own targets. A command-first macro can now establish its target.

## ROOT-010 — Master mixer effect slots do nothing

Import a WAV, choose **Window > Mixer**, and click **Select effect** in the Master
strip. Previously no rack opened because the master callback was absent. Master
and bus strips now open their own effects racks through the existing control.

## ROOT-011 — Mixer replacement menus leave the original effect in place

Add Reverb to an audio track's rack, close its settings and rack, then choose
**Window > Mixer**. Open the Reverb slot's **Select effect > Audacity > Compressor**
menu. Previously Reverb remained because no replacement callback was connected.
The slot now changes to Compressor with its default parameters and fresh context.

## ROOT-012 — Manage labels creates a new label at zero instead of the playhead

Import a 0.8-second WAV, click **Jump to project end**, open **Edit > Manage labels**,
and click **New label**. Previously the point label appeared at zero despite the
playhead being at 0.8 seconds. New labels now use a positive selected range or,
when there is none, read the live playhead position at the moment of creation.

## ROOT-013 — Keyboard navigation skips populated mixer effects

Add Reverb to the second audio track and open **Window > Mixer**. Click the first
track's Solo button, then press Tab. Previously focus skipped the Reverb control
because its apparent button was an unfocusable div. The name is now a native
button; Enter opens its rack, and keyboard focus reveals its power/menu controls.

## ROOT-014 — Mixer fader Home and End reverse slider bounds

Open **Window > Mixer**, focus an audio track's volume fader, and press Home.
Previously the gain jumped to maximum +12 dB instead of minimum -60 dB. End did
the reverse. Both keys now follow the slider's minimum/maximum conventions.

## ROOT-015 — Clicking the program review checkbox toggles it twice

Create a program in **Tools > Macros palette**, export it, delete it, and import
that exact download. In a tall window, click its review checkbox. Previously it
remained unchecked because the checkbox and enclosing text wrapper both toggled
the same state. The wrapper now handles only clicks outside the checkbox.

## ROOT-016 — The documented Escape/Tab program exit closes the palette

Create a program, focus its source, and follow the visible hint: press Escape,
then Tab to leave the textarea. Previously Escape closed the entire palette.
The source editor now consumes its own Escape before enabling native Tab exit.

## ROOT-017 — Import feedback covers the program review controls

In a normal 1280 × 720 window, export and reimport a program through the palette.
The import status previously overlapped its review checkbox and intercepted
ordinary clicks. The program detail now scrolls as a column, placing feedback
after the program instead of in a shrinking overlapping grid row. This is
independent of ROOT-015: resizing exposed a checkbox that still toggled twice.

## ROOT-018 — Canceling a program is presented as failure

Create a program in **Tools → Macros palette** with
`for (let i = 0; i < 10000; i++) await sound.project.tracks();`, run it, and
click **Cancel run**. Previously the log said the program failed and displayed
a failure alert. Cancellation now has its own outcome and leaves Run available.

## ROOT-019 — Program errors discard preceding diagnostic logs

Create and run a program containing
`sound.log.info('before error'); throw new Error('example error');`.
Previously only the error survived. The sandbox error now carries the captured
log, and the palette displays it before the failure message.

## ROOT-020 — Plot Spectrum examines only the beginning of the selection

Import an ordinary tone WAV, open its **Clip properties > Media settings**, and
set its start to 24000 frames in a 48 kHz project. Choose **Select > Select all**,
then **Analyze > Plot spectrum**. Previously the report showed 0 Hz at −120 dB
because it examined only the silent first 2048 frames. The report now averages
overlapping FFT windows throughout the selected audio.

## ROOT-021 — Generator knobs apply arrow keys twice

Open **Generate > Morse code**, focus the first knob, and press Arrow Up once.
Previously the value changed from 20 to 22 because both its native adapter and
the shared knob handled the same arrow. The adapter now owns only Home/End;
the knob changes by one step per arrow press.

## ROOT-022 — Opposite-polarity stereo disappears from Plot Spectrum

Import a mono tone, duplicate its track, select the copy, and apply
**Effect > Special > Invert**. Select both and use **Track channels > Make stereo
track**, then **Analyze > Plot spectrum**. The audible stereo tone previously
reported 0 Hz because channels were summed before the FFT and canceled each
other. The spectrum now combines channel powers after transforming each channel.
This is independent of ROOT-020 and also affects a single FFT window.

## Regression coverage

- `tests/browser/audio-editor-bug-audit-macros.spec.js`
- `tests/browser/audio-editor-bug-audit-generators.spec.js`
- `tests/browser/audio-editor-bug-audit-label-manager.spec.js`
- `tests/browser/audio-editor-bug-audit-macro-availability.spec.js`
- `tests/browser/audio-editor-bug-audit-mixer.spec.js`
- `tests/browser/audio-editor-mixer-keyboard-regressions.spec.js`
- `tests/browser/audio-editor-macro-program-controls-regressions.spec.js`
- `tests/browser/audio-editor-macro-program-outcomes-regressions.spec.js`
- `tests/browser/audio-editor-analysis-selection-regressions.spec.js`
- `tests/audio-editor-audio-spectrum.test.ts`
- `tests/audio-editor-macro-command-service.test.ts`
- `tests/audio-editor-macro-program-service.test.ts`
- `tests/audio-editor-macro-script-sandbox-client.test.ts`
- `tests/audio-editor-generator-service.test.ts`
- `tests/audio-editor-mixer-effect-replacement.test.ts`
- `tests/audio-editor-new-label-range.test.ts`

Macro clip-query timing and macro Select All timing passed against the original
build and are not counted. A hidden macro bypass control was excluded because it
has no user-accessible entry point. Optional Audacity time-edge defaults were
checked against the pinned upstream implementation and were correct.

These changes do not alter the assistance runtime closure and do not require a
manual **Update AI assets** run.
