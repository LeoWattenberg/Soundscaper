# Third generator, macro, mixer and analysis bug audit

Only distinct defects with ordinary public editor steps count. This register
excludes the first two audits; related manifestations share one entry.

## R3-ROOT-001 — Loudness Normalization leaves a generated square tone unchanged

Open **Generate > Tone**, choose **Square**, enter frequency **10000 Hz** and
duration **1 second**, and generate at the default 0.8 amplitude. Choose
**Select > Select all**, then **Effect > Volume and compression > Loudness
Normalization**, and apply its default −23 LUFS target. Export WAV.

Previously the downloaded peak stayed at 0.8 and the measured integrated level
stayed at about +1.34 LUFS. K weighting put the ordinary, unclipped signal's
blocks above the loudness histogram's upper bound, which discarded them all and
treated the selection as unmeasurable. The histogram now retains those higher
bins sparsely while preserving its existing spacing, gates and normal-bin
summation. Normalization reaches the requested level and Undo restores the tone.

Proof: `audio-editor-round3-hot-loudness.spec.js` failed against the immutable
pre-audit site at the unchanged downloaded peak, then passed against green
build 2 in Chromium, Firefox and WebKit. Three strict regressions measure the
result with the independent EBU meter, preserve stereo balance and compare the
same waveform before and after a preceding gain. All 26 focused loudness, basic
effect and realtime effect tests pass. Gain and stereo variants count once.

These changes do not require a manual **Update AI assets** run.
