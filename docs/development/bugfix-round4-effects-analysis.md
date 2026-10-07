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

## R4-ROOT-002 — Source effect controls use the project frequency limit

Import an ordinary 11,025 Hz recording into the 48 kHz editor. Open its Clip
properties, select the entire Source waveform with Ctrl+A, then choose
Effect → EQ and filters → High-pass filter. Enter 6,000 Hz in Cutoff frequency.
The baseline accepted the value as valid even though the selected source's
Nyquist limit is 5,512.5 Hz and its processor cannot accept that cutoff.

Expose the source selection's native sample rate through its existing effect
service and action facade, and use it for the selection dialog's controls and
graphs. The ordinary timeline selection continues to use the project rate.
The public baseline accepts 6,000 Hz without an invalid indication; the corrected
dialog marks it invalid, accepts 5,512.4 Hz, and applies the filter successfully.
This differs from the earlier unsupported Change Pitch parameter bug: here the
dialog used the wrong clock for an independently selected source.

The complete public workflow passes Chromium, Firefox, and WebKit on the clean
owned `source-effect-rate-clean1` build, which retains the production startup
limits. All 21 focused source, action-boundary, and mounted selection-dialog tests
pass. Regression files are `audio-editor-round4-source-effect-rate.test.ts` and
`audio-editor-round4-source-effect-controls.spec.js`; local evidence is recorded
in `/tmp/soundscaper-r4-root-source-effect-*`.

## R4-ROOT-003 — Source Auto Duck reads its control at the wrong timeline position

Import ordinary two-second music and voice recordings. In each clip's Media
settings, move Start to one second. Mute the voice track, open the music clip's
Source waveform, select all with Ctrl+A, then choose Effect → Volume and
compression → Auto Duck and select voice as its Control track. Apply the effect
and export WAV. The baseline reads the voice at source-relative project frames
rather than at the music clip's actual placement, so the first phrase receives
the wrong attenuation. At 1.7–1.8 seconds the public baseline export peaks at
0.14235 rather than the expected approximately 0.062 after the default fade.

Resolve control samples through the source clip's timeline mapping, retaining
native sample-rate conversion, reversal, warp segments and bounded render
windows. Apply and Preview share this control renderer; ordinary timeline
selections retain their original range. This is independent of round three's
replacement-dialog choice of a label track as the default control.

The same public workflow fails on immutable baseline `a0322d6e4` and passes
Chromium, Firefox and WebKit on the clean owned `source-duck-clean1` build.
Five new strict mapping cases and existing effect-selection/source regressions
pass, 46 tests altogether. The regression measures beyond the intentional
500 ms fade-down without changing its gain bounds. Regression files are
`audio-editor-round4-source-duck-control.test.ts` and
`audio-editor-round4-source-duck-placement.spec.js`; evidence is recorded in
`/tmp/soundscaper-r4-root-source-duck-*`.

## R4-ROOT-004 — Reimporting a program disables its authored original

Choose Tools → Macros palette → New program and enter
`sound.log.info('Original authored program ran');`. Export program, import that
unchanged download without deleting the original, and select the authored
original again. Its Run program button remains enabled, but the baseline run
fails without executing its source: an unreviewed duplicate incorrectly revokes
the existing permission for those exact authored bytes.

The source gate now permits an exact source when any retained copy has its
authored or explicitly reviewed permission. The imported record still requires
review in the palette. Removing the permitted original, or changing the only
reviewed copy, restores the block for the unreviewed source. This differs from
the earlier review-checkbox and import-feedback presentation defects.

The ordinary export/chooser/import/run workflow fails on immutable baseline
`a0322d6e4` and passes Chromium, Firefox and WebKit on the clean owned
`authored-import-clean2` build. Two strict service regressions and existing
library/program cases pass, 18 tests altogether; targeted lint also passes.
Regression files are `audio-editor-round4-authored-program-import.test.ts` and
`audio-editor-round4-authored-program-import.spec.js`; evidence is recorded in
`/tmp/soundscaper-r4-root-authored-program-import-*`.

## R4-ROOT-005 — Macro selection reads report a selected clip as empty

Import an ordinary 800 ms WAV and select its clip header. Choose Tools → Macros
palette → New program and read `await sound.project.selection()`. Log its start
and end frames. The baseline reports `0..0` despite the selected clip occupying
`0..38400` project samples. The documented program reader copied only collapsed
stored time fields and omitted the clip identities that define the selection.

Resolve the effective selection in the macro host before returning its existing
frame/track shape. Snapshot reads share this correction, disjoint clips bracket
their actual range, and explicit time selections remain authoritative. Reading
does not change selection or document state. This differs from previous label
creation and track-scope consumers that independently lost clip-derived bounds.

The explicit clip-header workflow fails on immutable baseline `a0322d6e4` and
passes Chromium, Firefox and WebKit on the clean owned `selection-read-clean3`
build. Three strict reader cases and existing host/program support pass, 22 tests
altogether; targeted lint passes. Regression files are
`audio-editor-round4-program-selection-read.test.ts` and
`audio-editor-round4-program-selection-read.spec.js`; evidence is recorded in
`/tmp/soundscaper-r4-root-program-selection-read-*`.

## R4-ROOT-006 — Macro Select all omits labels after the last recording

Import an ordinary 800 ms WAV and an ordinary Audacity label text file containing
a point cue at two seconds. Choose Tools → Macros palette → New program, run
`const selected = await sound.select.all();`, and log `selected.endFrame`.
The baseline selects only through sample 38400 instead of including the cue at
96000, contrary to the command's documented whole-project selection.

The macro's separate Select all mutator now includes label endpoints in its
already resolved project-sample duration calculation. It retains any longer
declared duration, every track ID, and one selection write. This is independent
of 005's read-only conversion of existing clip-header selections.

The unchanged label-file chooser and program workflow fails on immutable
baseline `a0322d6e4` and passes Chromium, Firefox and WebKit on the clean owned
`all-labels-clean5` build. Two strict mixed/label-only cases and existing macro
reader/host/program tests pass, 24 tests altogether. Regression files are
`audio-editor-round4-program-select-all-labels.test.ts` and
`audio-editor-round4-program-select-all-labels.spec.js`; evidence is recorded in
`/tmp/soundscaper-r4-root-program-select-all-labels-*`.

These browser DSP, UI, and regression changes retain the assistance runtime closure.
A manual **Update AI assets** run is not required.
