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

## R3-ROOT-015 — Macro helper errors point to their caller instead of the throw

Open **Tools > Macros palette > New program**. Write a four-line program with
`function checkSelection() {` on line 1, `throw new Error('Choose an audio region
first.');` on line 2, its closing brace on line 3, and `checkSelection();` on
line 4. Click **Run program**.

Previously the failure reported line 4, which called the helper, instead of
line 2, where the authored error occurred. The sandbox now identifies the
program module and selects its first authored stack frame within the fixed
program wrapper. API implementation frames remain excluded, including the
single-file VM harness, and message text is never parsed as a stack location.

Proof: the unchanged public workflow fails on the immutable baseline at line 4
and passes on green build 15 in Chromium, Firefox and WebKit at line 2. Strict
regressions verify exact throw locations for single-line and multiline helpers;
all 16 focused prelude, line-offset and dynamic-coverage tests pass. Targeted
lint passes. No manual **Update AI assets** run is required.

## R3-ROOT-016 — Mix and Render applies a retained VCA gain twice

Import an ordinary mono recording. Open **Window > Mixer > Routing graph**,
add a **VCA**, select its node, enter gain **0.5**, check the recording's track
under Members, and click **Save VCA**. Export WAV, select the recording, then
choose **Tracks > Mix & Render** and apply its default options. Export again.

Previously the second download's peak was half the first one's peak. Combined
rendering baked the VCA gain into PCM, but the retained track identity remained
a member and applied that gain again. Routing restatement now removes combined
outputs from their baked VCA memberships. Individual rendering keeps external
VCA controls; when creating an individual sibling, it copies the appropriate
membership. Unrelated members, master controls and VCA settings stay intact.

Proof: the ordinary picker, graph and menu workflow fails on the immutable
baseline with a peak ratio of 0.5. Green build 16 passes in Chromium, Firefox
and WebKit with a ratio of 1 and preserves the original peak after Undo. Three
strict regressions verify combined exclusion, individual retention and sibling
membership inheritance using canonical production projects and real commands.
All 18 focused render, commit and production-routing tests and targeted lint
pass. These membership variants count once. No manual **Update AI assets** run
is required.

## R3-ROOT-017 — Tone generation leaves other selected audio tracks unchanged

Import two ordinary recordings with different audio into separate tracks.
Select the first clip, choose **Select > Select all**, then **Generate > Tone**.
Set Amplitude to zero and generate. Select all and export WAV.

Previously the download retained the second recording, with a measured peak of
0.24747 in the public regression. The generator prepared a replacement only
for the focused track. Its selected-range planner now prepares every selected
audio lane in one atomic command, with distinct source descriptors sharing the
one published PCM body. Explicit single-track requests retain their scope.
This follows the selected-track behavior in the [Audacity Generate manual](https://manual.audacityteam.org/man/generate_menu.html).

Proof: the unchanged picker/menu/download workflow fails on the immutable
baseline and passes on green build 18 in Chromium, Firefox and WebKit, including
an Undo restoring the original mixed peak. Two strict canonical-command tests
verify selected lanes, unrelated-track preservation, shared storage ownership,
source immutability and explicit single-track scope. All 27 focused generator
tests and targeted lint pass; source checks pass for all four product builds.
No manual **Update AI assets** run is required.

## R3-ROOT-018 — Linked Truncate Silence independently processes aligned clip headers

Import two ordinary two-second dialogue recordings on separate tracks. Give
the first a pause at 0.3–1.3 seconds and the second one at 0.7–1.7 seconds.
Select both clip headers using Shift, choose **Effect > Special > Truncate
Silence**, leave **Truncate tracks independently** off, set **Truncate to** to
zero and apply. Select all and export WAV.

Previously each track lost its own one-second pause and the download lasted
about one second. Only their shared 0.6-second pause should be removed. The
controller's linked detection excluded every clip target. It now admits aligned
clip spans to the existing joint worker and preserves the clip-target command
authority. The [Audacity Truncate Silence manual](https://manual.audacityteam.org/man/truncate_silence.html)
defines this synchronization for the unchecked option.

Proof: the exact public baseline workflow delivers 0.99977 seconds instead of
1.4. Green build 19 delivers 1.4 seconds in Chromium, Firefox and WebKit and
Undo restores two seconds. Two strict actual-DSP regressions verify joint clip
and range detection, original channel ownership and retained clip identities.
All 12 focused multitrack, result and preview cases and targeted lint pass.
No manual **Update AI assets** run is required.

## R3-ROOT-019 — Independent track truncation desynchronizes a stereo recording

Import an ordinary two-second stereo dialogue recording with a left-channel
pause at 0.3–1.3 seconds and a right-channel pause at 0.7–1.7 seconds. Select
its clip, choose **Effect > Special > Truncate Silence**, check **Truncate
tracks independently**, set **Truncate to** to zero and apply. Export WAV.

Previously the two microphones each lost a different one-second span, leaving
one second of desynchronized audio. Independent track jobs incorrectly passed
their track-level option to a legacy DSP flag that splits individual channels.
Each already isolated track request now retains linked stereo detection, while
the dialog and remembered operation keep their independent-track choice. This
is separate from ROOT-018's admission of joint jobs for aligned clip headers.
The [Audacity Truncate Silence manual](https://manual.audacityteam.org/man/truncate_silence.html)
defines independence between tracks and preservation of a synchronized mix.

Proof: the exact public baseline delivers one second instead of 1.4. Green
build 19 passes Chromium, Firefox and WebKit at 1.4 seconds, with Undo restoring
two seconds. Serial and concurrent strict actual-DSP cases verify both stereo
channels retain their shared 1.4-second clock and sample alignment, while a
separate mono track independently shortens to one second. Original PCM and
remembered parameters remain unchanged. All eight focused multitrack cases and
targeted lint pass. No manual **Update AI assets** run is required.

## R3-ROOT-020 — Mix and Render cuts the tail through serial group buses

Import an ordinary 0.8-second recording. Open **Window > Mixer**, add two
group buses, route the recording to the first, and add **Feedback delay** to
each bus with time 0.5 seconds, feedback zero and mix one. Open **Routing graph**
and rewire the first group's assignment connection from Master to the second
group. Select the recording and apply **Tracks > Mix & Render** with its
defaults. Inspect the rendered clip's duration and export WAV.

Previously the clip lasted 1.3 seconds and lost the final echo. The planner
took the greatest individual bus tail even though the signal traversed both
serial effects. Production mix rendering now uses the existing graph's longest
audible path, including successive bus tails. Parallel paths retain their
maximum, master effects remain outside the rendered scope, and the existing
ten-second tail ceiling remains intact.

Proof: the unchanged picker, mixer, graph and menu workflow fails on the
immutable baseline at **00h00m01.300s**. Green build 20 passes in Chromium,
Firefox and WebKit at **00h00m01.800s**, with 86400 downloaded sample frames
and a nonzero final echo. Two strict canonical-command regressions verify
serial and parallel routing, effects-disabled behavior and source immutability.
All 29 focused mix-render cases and targeted lint pass; source typechecks pass
for all four product builds. No manual **Update AI assets** run is required.

## R3-ROOT-021 — Calling Date aborts an ordinary macro

Open **Tools > Macros**, create a program, and run
`console.log('Run started:', Date());`. Previously the program failed because
the sandbox replaced the standard callable Date constructor with a class that
requires `new`. This affects normal timestamp logging without any private API
or prepared input file.

The virtual Date now preserves its ordinary callable form while using the
same deterministic clock as `Date.now()` and `new Date()`. Explicit dates,
parsing, UTC helpers, and subclasses retain their existing behavior.

Proof: the public immutable-baseline program fails before logging its
completion. Green build 21 completes in Chromium, Firefox and WebKit.
Two strict real-sandbox regressions check callable timestamps as the virtual
clock advances, ignored call arguments, explicit constructors, and subclasses.
All 18 focused sandbox and authored-line cases and targeted lint pass.
No manual **Update AI assets** run is required.
