# Second generator, macro, mixer and analysis bug audit

This register excludes the first audit's 102 fixes. A root counts once and needs
ordinary editor steps and a failing reproduction before its fix.

## R2-ROOT-001 — Frequency-only macro commands discard selected clips

Import an ordinary WAV and select its clip header. Open **Tools > Macros palette
> New program**, enter `await sound.select.frequencies({low:100,high:1000});
await sound.effect('audacity-invert');`, and run it. Previously the frequency
command cleared the clip selection and Invert failed with a selection-required
error. Selection commands now retain clip targets when neither time nor tracks
changes, and retain spectral bounds when only another selection axis changes.
The exact selection setter honors an explicitly supplied clip target.

Proof: `audio-editor-round2-macro-selection.spec.js` failed against the prior
build and passed against round-two build 1. Strict controller regressions verify
that clip targets and spectral bounds are carried through the command adapter.

## R2-ROOT-002 — Cancel closes the generator but still adds its audio

Open **Generate > Tone**, enter ten minutes through the visible duration digits,
press **Generate**, then **Cancel** before generation finishes. Previously the
dialog disappeared but the tone was added to the project and Undo became
available. The dialog now owns an abort signal, which the generator carries into
its existing task and source cleanup. Canceling or closing cannot publish the
unfinished audio. A completed request retains only its reusable options.

Proof: `audio-editor-round2-generator-cancel.spec.js` failed on build 1 and passed
on build 2 in Chromium, Firefox and WebKit. The controller regression cancels
while writing and verifies source rollback, no edit, and released processing.
The macro target regression also passes in all three engines.

## R2-ROOT-003 — DTMF misses the requested total duration

Open **Generate > DTMF tones**, enter `1234567890`, set the visible duration
to one second, and generate. Open **Clip properties > Media settings** and
inspect its duration in samples. The old output had 48,001 samples instead of
48,000. Separately rounding every tone and gap let the sum drift from the
requested total. The generator now apportions cumulative symbol boundaries
inside that exact frame budget while preserving the requested tone/gap ratio.
Direct per-symbol generation retains its existing timing.

Proof: `audio-editor-round2-generator-duration.spec.js` failed against build 3
and passes against build 5 in Chromium, Firefox and WebKit. Strict generator
regressions cover exact totals at 8,000, 44,100 and 48,000 Hz and the unchanged
per-symbol mode.

## R2-ROOT-004 — A single static mixer drag creates several Undo entries

Import an ordinary WAV, open the track's **Effects** rack, and drag **Master
gain** continuously to a lower value. Press Undo once. It previously undid only
the final pointer move rather than restoring the gain before the drag. Static
mixer controls now preview the gesture without writing the document and commit
one history entry on release; cancellation restores the original preview.
Mixer strip faders and pans use the same lifecycle alongside the existing
parameter automation router.

Proof: `audio-editor-round2-mixer-undo.spec.js` reproduced the master-gain
failure on build 3, and its master and group-bus workflows pass on build 5 in
Chromium, Firefox and WebKit. Strict controller regressions verify one final
edit, canceled preview restoration, and no edit when returning to the original
value. Existing mixer keyboard workflows pass. The extracted master control
shares the effect-dialog shell's semantic chunk owner; the ownership test and
ordinary Export audio opening guard its lazy loading.

## R2-ROOT-005 — Video numeric fields lose a typed negative fraction

Import an ordinary video in Framescaper, open **Clip properties**, add a color
effect, clear its exact **Brightness** field, and type `-0.5`. Previously the
live numeric echo discarded the incomplete minus prefix and saved positive
`0.5`. The control now retains its string draft throughout the gesture, previews
only complete numbers, and commits or restores the original value on Enter,
blur or Escape. Its final display follows the parameter's canonical bounds.
Adjustment-layer authoring has the same draft defect and uses the same rule.

Proof: `audio-editor-round2-video-effect-input.spec.js` failed against build 5
and passes against build 7 in Chromium, Firefox and WebKit. Strict mounted
control regressions cover live echoes, cancellation, one commit and bounded
display. The existing slider keyboard/Undo workflow also passes in all engines.

## R2-ROOT-006 — Pink noise loses its low-frequency octave balance

Open **Generate > Noise**, select **Pink**, enter 16 seconds, generate, then
export WAV. Its 20–40 Hz octave previously had about 28% of the energy in
80–160 Hz rather than comparable energy per octave. The fixed seven-row
generator flattened its lower spectrum at common project sample rates. Pink
noise now chooses enough random rows for the project rate, initializes them
independently and maintains their sum without clipping its spectral shape.
White and brown noise retain their random sequences.

The expected octave balance follows the [original Voss–McCartney implementation
discussion](https://www.firstpr.com.au/dsp/pink-noise/) and the
[Audacity noise manual](https://manual.audacityteam.org/man/noise.html).

Proof: `audio-editor-round2-pink-noise.spec.js` measured the actual UI-exported
WAV and failed against build 5. It passes against builds 6 and 7 in Chromium,
Firefox and WebKit. Strict generator regressions compare low-frequency octave
energy at 8,000, 48,000 and 96,000 Hz and verify the requested amplitude bound.

## R2-ROOT-007 — Step-list macros process only the focused selected track

Import two ordinary WAVs, choose **Select > Select all**, then **Tools > Macros
palette > New macro > Add effect > Invert**, and run the macro. Export WAV
before and after. Previously only the focused track was inverted, leaving the
other tone in the mix. A step-list macro now captures every selected audio
target, plans their memory together, renders them and commits one result batch.
Direct program `sound.effect` and `sound.effects` calls retain their documented
focused-track contract; invoking a saved step-list macro uses its selection.

Proof: the strict service regression failed before the fix because only one
target rendered. The ordinary step-list UI workflow in
`audio-editor-round2-macro-targets.spec.js` failed against baseline build 10
with a 0.69995 peak residual in downloaded PCM. It passes against build 11 in
Chromium, Firefox and WebKit. The initial direct-program variant is excluded
because its focused-track scope is documented; the strict host regression
preserves that contract.

## R2-ROOT-008 — Concurrent awaited macro calls silently drop an effect

Import a WAV and run a new program containing `await sound.select.all();
await Promise.all([sound.effect('audacity-invert'),
sound.effect('audacity-invert')]);`. Previously the program reported completion
but the second effect was dropped by the editor's busy guard, leaving the audio
inverted once. The host now dispatches calls in message order and waits for
each effect, including reads that follow it. Two Inverts restore the original.

Proof: the second `audio-editor-round2-macro-targets.spec.js` workflow failed
against build 7 and passes its exported PCM comparison in Chromium, Firefox
and WebKit against build 9. The strict host regression gates the first effect
and verifies that the second starts after it finishes.

## R2-ROOT-009 — Macro effects apply new fades to already faded audio

Import a WAV with the editor's default edge microfades, export it, then run
`await sound.select.all(); await sound.effect('audacity-invert');` through a
new macro program and export again. Previously the result's first and last
two milliseconds were quieter: range replacement applied fresh microfades to
audio whose authored fades the macro had already rendered. Rendered effect
results now opt out of that new-clip policy while ordinary edits retain it.

Proof: `audio-editor-round2-macro-edge-level.spec.js` failed against build 8
with a peak residual of 0.08678. The full exported PCM comparison passes against
build 9 in all three browsers. The strict mutation regression verifies that
the rendered-audio option reaches command execution alongside its playhead.

## R2-ROOT-010 — A clip-targeted macro mixes an unselected overlapping clip

Import two WAVs and move one onto the other's track with **Move to track
(preserve time)**. Select the incoming clip's header. Compare **Effect > Special
> Invert** with Undo followed by a new macro program containing
`await sound.effect('audacity-invert');`. Previously the macro baked the
unselected overlapping neighbor into the selected clip. Its leading realtime
render now filters the track by the captured clip IDs.

Proof: `audio-editor-round2-macro-clip-isolation.spec.js` failed against build 8
with a peak residual of 0.24747 against the ordinary effect's export. It passes
against build 9 in all three browsers. The strict service regression verifies
that the render contains only the selected clip.

## R2-ROOT-011 — Escape saves a canceled program name and closes the palette

Choose **Tools > Macros palette > New program**, edit **Program name**, and
press Escape. Previously Escape bubbled to the palette and its resulting blur
saved the canceled draft. The program name now handles Enter and Escape at its
own field: Enter commits, Escape restores the saved name and keeps the palette
open. This name input is separate from the previously fixed source-editor exit.

Proof: `audio-editor-round2-program-name.spec.js` failed against build 9 because
the palette closed. It passes against build 11 in Chromium, Firefox and WebKit,
including a library check that the canceled name was never saved. The mounted
strict regression covers both commit and cancel through the input handlers.

## R2-ROOT-012 — Change Tempo hides duration controls for a selected clip

Import a WAV, click its clip header, then choose **Effect > Pitch and tempo >
Change tempo**. Previously **Current duration** and **Desired duration** were
missing because the dialog read the empty time-range selection instead of the
selected clip. The dialog now resolves the actual effect range, including a
source-editor selection using its native media clock.

Proof: `audio-editor-round2-effect-duration.spec.js` failed against build 10
with the missing fields. It passes against build 11 in Chromium, Firefox and
WebKit, verifies the imported 800-ms duration and that entering 400 ms sets the
tempo change to 100%. Strict source-selection tests retain the native 44.1-kHz
duration through replacement and Undo. The selection dialog suite also passes.

## R2-ROOT-013 — A slower effect preview cuts off the processed audio

Import a 0.8-second WAV, **Select > Select all**, open **Effect > Pitch and tempo
> Change tempo**, set **Percent change** to -50 and click **Preview**. The
result should last 1.6 seconds. Previously playback stopped at 0.8 seconds,
because preview alignment used the input length instead of the rendered length.
Previews now align and mix the processed lengths, retaining the six-second
audition limit. Faster effects also avoid an appended silent tail.

Proof: `audio-editor-round2-effect-preview-length.spec.js` uses only the normal
menus and observes the browser's played audio-buffer duration. Its baseline
build 11 failed at 0.8 seconds; build 12 passes at 1.6 seconds in Chromium,
Firefox and WebKit. Strict regressions cover expansion, contraction, and the
six-second limit alongside existing Repair context and cancellation checks.

## R2-ROOT-014 — Escape saves a canceled macro-step drag

Choose **Tools > Macros palette > New macro**, add Invert, Fade In and Fade Out,
then drag the first step over the third. While holding the mouse button, press
Escape and release. Previously the changed order was already saved during
Drag Over, so canceling the native drag could not restore the macro. The list
now keeps its target as a local gesture draft, highlights that target, and
commits exactly once on Drop. Canceling discards the draft without a write.

Proof: `audio-editor-round2-macro-drag-cancel.spec.js` reproduced the saved
canceled order against build 12. Build 16 passes cancellation, a completed
native drop, and closing/reopening the library in Chromium, Firefox and WebKit.
Two mounted strict regressions verify no library write before a completed drop.

## R2-ROOT-015 — Change Pitch silently substitutes an unsupported frequency

Import a WAV, **Select > Select all**, open **Effect > Pitch and tempo > Change
pitch**, and change **To frequency** from 440 to 1760 Hz. Previously the field
accepted that value, but silently replaced it with 880 Hz when the semitone
model clamped the requested two-octave change to its one-octave limit. Alternate
frequency and note/octave inputs now offer only the supported interval around
the retained other pitch. An unsupported draft is marked invalid and leaves
the effect unchanged; Escape restores the saved frequency.

Proof: `audio-editor-round2-pitch-target-bounds.spec.js` failed against build 12
because the entered 1760 Hz became 880 Hz. Build 13 passes in Chromium, Firefox
and WebKit, including cancellation and a valid 880-Hz/12-semitone change.
Nine strict helper and derived-value regressions pass.

## R2-ROOT-016 — Stereo meters duplicate one aggregate level

Import an ordinary stereo WAV whose left channel has a tone and whose right
channel is silent. Open **Window > Mixer** and play it. Previously both channel
bars showed the same level because the UI repeated the aggregate scalar meter.
The mixer and track-header meters now read the existing per-channel strip
telemetry, so the silent channel stays empty. Master and bus strips use the
same channel-aware path; scalar telemetry remains supported.

Proof: the first `audio-editor-round2-mixer-meters.spec.js` workflow failed
against build 14 because the silent right bar had a nonzero level. Build 15
passes in Chromium, Firefox and WebKit, checking both mixer and track-header
bars. The strict rendered-component regression covers tracks, buses and master.

## R2-ROOT-017 — Mixer clipping lights turn on below full scale

Import a stereo tone with 0.9 peak amplitude, open **Window > Mixer** and play
it. Previously both clipping lights turned on even though the audio was below
full scale: the UI tested whether the meter reached 95% of its displayed range,
which corresponds to -3 dBFS. Clipping now tests each channel's actual peak
against full scale, independently of the meter's display range.

Proof: the second `audio-editor-round2-mixer-meters.spec.js` workflow failed
against build 14 with two active clipping indicators. Build 15 passes in
Chromium, Firefox and WebKit. The strict rendered regression also verifies
that only the channel with a 1.01 peak lights its indicator.

These changes do not require a manual **Update AI assets** run.
