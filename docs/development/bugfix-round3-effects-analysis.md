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

## R3-ROOT-002 — Auto Duck replacement chooses a label track as its audio control

In a fresh project choose **Tracks > Remove tracks**, then **Tracks > Add new
track > New label track**. Import two ordinary WAVs. Open the first audio track's
**Effects** rack, add **Invert**, open its **More options**, and choose **Auto
Duck**. Open that slot's **Select effect** settings.

Previously **Control track** selected the preceding **Labels** track, even
though the second audio track was available. An annotation track supplies no
sidechain signal, so the resulting effect could not render. Replacement defaults
and the shared control-track chooser now admit audio tracks and omit the effect's
own audio track. Both manifestations count as this one admission defect.

Proof: `audio-editor-round3-auto-duck-replacement.spec.js` failed on the immutable
baseline with **Labels**, then passed on green build 4 in Chromium, Firefox and
WebKit with the other imported audio track selected. Two strict regressions
verify candidate order, omission of nonsignal tracks and the effect's own track,
and the absence of a usable control when only one audio track and labels exist.
All 25 focused control-track, overlay, rack and effect-control tests pass.

## R3-ROOT-003 — Reopening Contrast hides its captured report

Import a WAV, choose **Select > Select all**, then **Analyze > Contrast**.
Click **Measure foreground** and **Measure background**, close Contrast, and
reopen it through the same menu.

Previously the saved measurements disappeared and **Export** became disabled,
although the controller still retained the report. Contrast now restores its
current saved report when opened, without recapturing either range. A different
project or another report kind does not restore those measurements; explicit
**Repeat last analyzer** still performs its remembered capture.

Proof: `audio-editor-round3-contrast-reopen.spec.js` failed on the immutable
baseline because its reopened report was absent. The same final regression
passes on green build 6 in Chromium, Firefox and WebKit, comparing all displayed
measurements and checking Export. Its strict mounted regression verifies report
restoration, project replacement, and omission of another analysis kind. Both
existing repeat regressions pass, for three focused Node tests. The initial
green-run whitespace assertion mistake was corrected and adds no defect count.

## R3-ROOT-004 — Truncate Silence refuses a completely silent selection

Choose **Generate > Silence** and create one second. Choose **Select > Select
all**, then **Effect > Special > Truncate Silence**, set **Truncate to** to zero,
and apply. Selecting the clip through its header reproduces the same defect.

Previously the effect stayed open with **The effect did not produce valid
audio**, because its valid zero-frame result failed the persistence validator.
Time selections now ripple-delete their occupied range, and exact clip
selections remove their clip without creating an empty audio source. The
operation remains undoable. Related clips with inconsistent duration ratios
retain their existing refusal.

Proof: both public selection workflows failed against the immutable baseline
and pass on green build 6 in Chromium, Firefox and WebKit, checking removal and
Undo. Four strict regressions cover time selection, exact clip selection, a
zero-frame macro result and related-clip refusal. All 24 focused persistence and
source-effect tests pass. The existing large test's unchanged harness moved to
a focused strict helper so the frozen file shrinks. The two selection variants
count as one result-admission defect.

These changes do not require a manual **Update AI assets** run.
