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

These changes do not require a manual **Update AI assets** run.
