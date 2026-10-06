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

These changes do not require a manual **Update AI assets** run.
