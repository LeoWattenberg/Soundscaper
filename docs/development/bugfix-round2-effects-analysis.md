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

## R2-ROOT-007 — Effect macros process only the focused selected track

Import two ordinary WAVs, choose **Tools > Macros palette > New program**, and
run `await sound.select.all(); await sound.effect('audacity-invert');`. Export
WAV before and after. Previously only the focused track was inverted, leaving
the other tone in the mix. A macro now captures every selected audio target,
plans their memory together, renders them and commits one result batch.

Proof: `audio-editor-round2-macro-targets.spec.js` failed against build 7. Its
downloaded PCM comparison passes against build 9 in all three browsers. The
strict service regression verifies both renders and one atomic persistence.

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

These changes do not require a manual **Update AI assets** run.
