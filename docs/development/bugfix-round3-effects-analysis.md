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

## R3-ROOT-005 — Live Analysis understates a stereo recording's peak

Import an ordinary stereo WAV whose left channel peaks at 0.8 and whose right
channel is silent. Choose **Analyze > Analysis**, play it and read **Peak** in
the live Levels section.

Previously the displayed level was about −8 dBFS instead of −1.94 dBFS. The
legacy scalar reader measured the analyser's mono downmix even though the
engine already had independent channel measurements. Published scalar peak now
uses the greatest channel peak, and RMS summarizes channel power. Track and
bus readings use their own channel banks. Existing analysis metadata and the
legacy fallback when no channel bank is available remain intact.

Proof: `audio-editor-round3-live-levels.spec.js` failed on the immutable baseline
at −8 dBFS and passes on green build 7 in Chromium, Firefox and WebKit. Two
strict regressions use the real channel meter store to verify master, track,
group and send aggregation, metadata preservation and the fallback. All 18
focused live/master/playback/worker meter tests pass. This scalar measurement
defect differs from the earlier duplicate per-channel meter display and static
Plot Spectrum transform; its channel variants count once.

## R3-ROOT-006 — Nyquist controls discard a typed negative number

Import a WAV, choose **Select > Select all**, then **Effect > Nyquist >
Adjustable Fade**. Clear **Mid-fade Adjust (%)**, type `-0.5`, and tab away.

Previously the displayed and bound value became positive `0.5`. The Nyquist
control converted each incomplete input event directly into a numeric binding,
discarding the minus prefix. Its focused strict field now keeps the text draft
through live echoes, publishes complete numbers, and commits or restores a
bounded canonical value on Enter, blur or Escape. Integer controls retain their
rounding behavior.

Proof: the immutable baseline failed with `0.5` after the actual negative
keystrokes. Both that workflow and the positive Risset Drum fraction pass in
Chromium, Firefox and WebKit on green build 8. A strict mounted regression covers
prefixes, live echoes and cancellation; all three focused numeric-field and
existing Nyquist-dialog lifecycle tests pass. This is the Nyquist binding
owner's defect, independent of the earlier video-effect numeric control.

## R3-ROOT-007 — Nyquist preview pulls staggered clips to the same start

Import two ordinary 0.8-second WAVs. Open the second clip's **Clip properties**,
expand **Media settings**, and set **Start** to 0.4 seconds. Close Properties,
select both clip headers, choose **Tools > Nyquist prompt**, enter the identity
expression `*track*`, and click **Preview**.

Previously both clips played from the beginning of a 0.8-second preview. Their
authored placement calls for a 1.2-second mix, with the second clip entering
after 0.4 seconds. The preview mixer now carries each evaluated target's offset
relative to the selection's earliest target and retains its complete extent
within the existing six-second preview window.

Proof: `audio-editor-round3-nyquist-preview-placement.spec.js` failed on the
immutable baseline with an observed 0.8-second playback buffer and passes on
green build 8 in Chromium, Firefox and WebKit at 1.2 seconds. The audio observer
only records buffers started by the actual Preview control. Two strict pulse
regressions verify the gap, overlap, unchanged inputs, mono/stereo expansion,
and omission of audio positioned beyond the preview window.

## R3-ROOT-008 — Rhythm Track silently truncates a valid 128-second request

Choose **Generate > Nyquist > Rhythm Track**, set **Tempo (bpm)** to **30**, keep
the default **16 bars** and **4 beats per bar**, and apply. Open the generated
clip's **Clip properties** and inspect its duration.

Previously the clip contained only one minute, although the requested 64 beats
at 30 beats per minute last 128 seconds. Generator output inherited the
process-effect inference of 60 seconds when there was no input sound. Generator
evaluation now uses its existing 300-second hard ceiling instead of that
input-based inference. Explicit smaller ceilings, process inference and the
six-second preview ceiling remain intact.

Proof: the immutable baseline's public Properties readout was **00h01m00.000s**;
the same workflow reads **00h02m08.000s** on green build 8 in Chromium, Firefox
and WebKit. Two strict regressions cover generator inference, previews, explicit
limits, and unchanged process inference. All 25 focused Nyquist preview,
controller, host and ownership tests pass for these two extent fixes.

## R3-ROOT-009 — One mixed Nyquist result requires two Undos

Import two ordinary WAVs, choose **Select > Select all**, and open **Tools >
Nyquist prompt**. Run `(if (= (get '*track* 'index) 1) (mult *track* -1)
'((0 "Analysis")))`, which inverts the first track and returns a label for the
second. Close the prompt, choose **Edit > Undo** once, and export WAV.

Previously Undo removed the label but left the first track inverted. One Run
published its audio and labels as two independent history entries. Mixed results
now use the document's existing checkpoint transaction to settle into one history
operation. Cancellation during publication restores the opening document, and
the transaction's existing project and controller fences remain in force.

Proof: the public regression failed against the immutable baseline with a
0.69995 maximum difference from the original exported PCM after one Undo. The
same test passes on green build 9 in Chromium, Firefox and WebKit. Two strict
regressions exercise real history commands, collapse, Undo and cancellation;
all 36 focused Nyquist, mutation and transaction checkpoint/fence tests pass.
The internal metadata union describes the completed Nyquist operation without
adding a public controller action or changing macro command execution.

These changes do not require a manual **Update AI assets** run.

## R3-ROOT-010 — Source-editor Nyquist labels lose their clip placement

Import an ordinary WAV, open **Edit > Audio clips > Clip properties**, and set
its **Start** to one second. Focus the source waveform, select all with Ctrl+A,
then choose **Tools > Nyquist prompt**, enter `'((0.2 0.4 "Analysis"))`, and run.
Open **Tools > Manage labels**.

Previously the annotation appeared at project time 0.2–0.4 seconds instead of
1.2–1.4 seconds. Annotation publication used a project-clock offset even though
the prompt ran over native source samples. Labels now retain their actual source
target and use the owning clip's runtime projection, including trimmed source
windows, native sample rates, stretch, reversal and authored warp markers.
Timeline-only labels retain their existing placement.

Proof: `audio-editor-round3-nyquist-source-labels.spec.js` fails on the immutable
baseline at 0.2 seconds and passes on green build 10 in Chromium, Firefox and
WebKit at 1.2 seconds. Two strict host regressions cover a moved, trimmed
44.1 kHz source and nonlinear warp projection; all 23 focused Nyquist tests pass.
This is the annotation publication defect, distinct from the earlier host
property timestamp correction. No manual **Update AI assets** run is required.

## R3-ROOT-011 — A canceled Amplify dialog changes Repeat last effect

Import ordinary mono WAVs with peaks 0.35 and 0.175. Select the louder clip and
apply **Effect > Volume and compression > Amplify** with its automatic gain.
Mute that track, select the quieter clip, reopen Amplify, and close it without
applying. Choose **Effect > Repeat last effect**, then export WAV.

Previously Repeat rescanned the quieter clip and normalized it, instead of
reapplying the earlier gain. Preparing the canceled dialog had cleared the
automatic-gain marker, and Repeat did not mark its remembered parameters as
explicit. Repeat now supplies the previously applied values explicitly; opening
a fresh Amplify dialog still derives its default from the current selection.

Proof: the ordinary canceled-dialog workflow fails on the immutable baseline
with exported peak 0.7071 instead of 0.35355, accounting for the existing centered
mono pan law. The same workflow passes on green build 12 in all three browsers.
A strict regression verifies the remembered gain after the new dialog's default
marker is cleared, and all 13 effect-control tests pass. The direct Repeat
control without reopening already passed before the fix and adds no count.
No manual **Update AI assets** run is required.

## R3-ROOT-012 — Playback volume cannot mute the metronome

Import an ordinary recording. Open **Customize toolbar**, enable **Metronome**,
close the menu, and turn the metronome on. Set **Playback volume** to zero and
press **Play**.

Previously the recording was muted while metronome clicks still sounded: their
envelope node connected directly to the audio destination. Clicks now pass
through the engine's existing listening output, so volume changes also apply
while playback continues. The existing fallback for minimal engine hosts and
the metronome's audio-clock scheduling remain intact.

Proof: the unchanged public workflow fails on the immutable baseline because
every observed oscillator path bypasses the zero listening gain. Green build 12
passes in Chromium, Firefox and WebKit, checking muted clicks and unmuting during
the same playback. The observer only records native audio connections and
parameter writes. A strict scheduler regression checks the output destination;
all 28 focused rhythm, playback-rate and transport tests pass, including loop
phase, delayed audible starts and pending-click cancellation. No manual
**Update AI assets** run is required.

## R3-ROOT-014 — Macro project reads report video clips as empty

Import an ordinary camera recording. Open **Tools > Macros palette > New
program**, read the video track with `sound.project.tracks()`, then print the
first result of `sound.project.clips(video.id)`.

Previously `durationFrames` was zero for the nonempty video. The documented
program API promises project sample frames, but its reader accessed the raw
sequence-backed record. Program reads now resolve current project geometry
before exposing clip positions, durations and selection extents. Legacy sample
hosts retain their existing read shape, and the authored document stays intact.

Proof: the ordinary public program prints `video durationFrames=0` on the
immutable baseline and `video durationFrames=104000` on green build 14 in all
three browsers. A strict canonical camera-project regression verifies a
48000-frame clip without changing its persisted video ordinals. All 19 focused
program/host tests and all 14 runtime-consumer audit cases pass; the audit
register includes this actual projection boundary and its private downstream
extent reducer. No manual **Update AI assets** run is required.

### Stored-loop selection follow-through (no additional bug count)

The authored-range snapping defect recorded as R3-EDIT-009 also affected
**Select > Loop region > Set selection to loop**. Set a 0.2–0.4-second loop,
clear the selection, enable whole-second snapping, and recall the loop: the
selection previously collapsed to zero. This command now uses the same exact
selection authority as other stored ranges. The public workflow fails on the
immutable baseline and passes in all three browsers on green build 13; all 29
focused transport, rhythm and playback-rate tests pass. This adds no audit ID
and requires no manual **Update AI assets** run.

## R3-ROOT-013 — Resampling camera audio refuses its intact A/V link

Import an ordinary camera WebM recording with audio. Select its audio clip,
open **Clip properties > Media settings > Resample**, enter 24000 Hz and apply.
Reopen the audio properties to inspect its sample rate, then Undo.

Previously the action failed with “A/V link … must contain one audio and one
video clip,” leaving the original 48000-Hz source. Its remove-and-replace batch
expanded the audio clip's A/V membership and removed the video too. The batch
now temporarily unlinks the pair, replaces only the audio, and restores the
original link. Video content, grouped companions and authored warp positions
remain intact.

Proof: the ordinary picker/menu workflow fails on the immutable baseline and
passes on green build 14 in Chromium, Firefox and WebKit, checking both clips,
the new native rate and Undo's original rate. The strict regression applies the
actual replacement batch to a canonical linked camera project and preserves
the exact video record; all 16 focused resampling tests pass. The inspector can
select the surviving video tab after replacement, so the test explicitly
reopens the audio properties before reading their rate. No manual
**Update AI assets** run is required.
