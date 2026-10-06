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

These changes do not require a manual **Update AI assets** run.
