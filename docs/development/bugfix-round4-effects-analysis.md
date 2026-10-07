# Round four: effects and analysis

Only new defects beyond the preceding 303 fixes count here. Reproductions use
ordinary editor controls and media on immutable baseline `a0322d6e4`; fixture or
test setup failures do not count.

## R4-ROOT-001 — Loudness Normalization skips the first native-rate block

Import an ordinary 11,025 Hz mono WAV with a 400 ms phrase followed by a pause.
Open Clip properties, focus Source waveform, and press Ctrl+A. Choose
Effect → Volume and compression → Loudness Normalization and apply its defaults.
Export the result. The normalization measures too little of the phrase and leaves
it louder than the requested target.

The baseline public workflow measured the centred mono export's left channel at
−28.373 LUFS rather than approximately −29.021 LUFS. A strict regression using
the independent delivery meter also measured −22.218 LUFS for a −23 LUFS request
without dual-mono compensation. The ring's write position incorrectly scheduled
measurement windows: at 11,025 Hz, a 400 ms ring contains 4,410 samples while four
rounded 100 ms hops contain 4,412 samples, so its first complete window was missed.

Schedule the first measurement after one complete 400 ms window and later
measurements after each rounded 100 ms hop, independently of ring wraparound.
Six native-rate phrase/pause cases and three existing loudness regressions pass.
The strict cases use the existing 0.2 LU delivery tolerance for the adapted
Audacity coefficients; the baseline 11,025 Hz cases exceed it by approximately
0.78 LU. The full public workflow passes Chromium, Firefox, and WebKit on the
immutable `root-loudness-clock1` build.

Regression files: `audacity-effects-round4-loudness-clock.test.ts` and
`audio-editor-round4-loudness-clock.spec.js`. Local baseline, strict, build, and
browser evidence is recorded in `/tmp/soundscaper-r4-root-loudness-clock-*`.

These browser DSP and regression changes retain the assistance runtime closure.
A manual **Update AI assets** run is not required.
