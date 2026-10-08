# Round five: effects and analysis

The immutable baseline is `fe6440c81`. Only distinct defects with ordinary
public editor steps count. Earlier fixes, unsupported operations, and test
setup failures are excluded. Corrected public verification remains explicit.

## R5-ROOT-001 — Clip normalization silently substitutes its gain ceiling

Import an ordinary quiet microphone WAV (the regression uses a 0.8-second
440 Hz mono recording at amplitude 0.002). Open Clip properties, expand
Normalize, and choose Normalize to −1 dBFS. The baseline sets Clip gain to
24.08 dB without an error, although the recording needs approximately 53 dB
of gain to meet that target. The action silently delivers another result.
Loudness normalization shares this gain publication path and ceiling.

Retain the existing maximum linear clip gain of 16. Reject an unattainable
normalization before publishing a substitute, preserve the preceding gain,
and explain that the user can apply Amplify to the recording. English and
German error copy use the existing inspector error presentation.

The ordinary baseline workflow fails because no error appears; its captured
accessible tree records the substituted 24.08 dB. Two strict owning-service
regressions fail before the correction. They and the attainable controls pass
afterward; all 11 new and existing normalization cases pass. Target lint passes.
The corrected workflow passes Chromium, Firefox and WebKit on immutable
checkpoint `5948d84d0` (the combined four-root run is 12/12;
`/tmp/soundscaper-r5-root-green2.log`, exit 0).

Regression files: `audio-editor-round5-clip-normalization-limit.test.ts` and
`audio-editor-round5-clip-normalization-limit.spec.js`. Evidence is under
`/tmp/soundscaper-r5-root-normalization-limit-*`. This correction does not
change the assistance runtime closure or require **Update AI assets**.

## R5-ROOT-002 — Nyquist source processing reads tempo at the source offset

In the Music workspace, import a WAV and add a 90 BPM tempo event at beat 8
(four seconds after the initial 120 BPM). Open Clip properties and set Start
to five seconds. Focus Source waveform, select all, open Tools → Nyquist
prompt, and run `(format nil "~a" (get '*project* 'tempo))`.

The baseline reports 120 instead of the placed clip's 90 BPM. Its host evaluates
the tempo map at native source frame zero, rather than at the selected audio's
project placement. Tempo-dependent scripts therefore use the wrong tempo.

Project the source selection through the existing authenticated source-to-clip
geometry before looking up the active project tempo. Preserve native source
selection timestamps and the project sample rate. This is a placement consumer
separate from the earlier division of source-selection seconds by project rate.

The ordinary Chromium baseline reports 120 after all setup assertions pass
(`/tmp/soundscaper-r5-root-nyquist-source-tempo-red2.*`). Two strict canonical
project cases reproduce both a moved recording and a late source offset placed
at project zero. All 19 new and existing host/controller cases pass after
correction, and target type-aware lint passes. The ordinary workflow passes
Chromium, Firefox and WebKit on immutable checkpoint `5948d84d0`; the four-root
run is 12/12 with exit 0 (`/tmp/soundscaper-r5-root-green2.log`). Focused evidence remains in
`/tmp/soundscaper-r5-root-nyquist-source-tempo-*`.

## R5-ROOT-003 — Source-analysis labels stretch across repetitions

Import a normal 0.8-second WAV, select its header, and press Right once on
Looped clip length to create two repeats. Open Clip properties, focus Source
waveform and select all. Tools → Nyquist prompt: run
`'((0.2 0.4 "Source cue"))`, close the prompt, and Edit → Manage labels.

The baseline places the source cue at 0.4–0.8 seconds instead of 0.2–0.4.
The mapper scales one source pass across the repeated clip's complete extent,
placing the cue over different sound. Read the authored repeat period and
phase, and retain the cue's first complete occurrence after the clip's start.
Ordinary source positions and authenticated warp projection remain intact.

The normal Chromium workflow fails at its displayed 0.400-second start
(`/tmp/soundscaper-r5-root-nyquist-loop-label-red.*`). Two strict repeat cases
fail before correction while ordinary controls pass. Eight corrected native-rate,
ordinary, reversed-repeat and split-phase cases pass, together with existing
Nyquist host/controller and source-tempo support: 27/27. Target lint passes.
The ordinary workflow passes Chromium, Firefox and WebKit on immutable
checkpoint `5948d84d0` (combined four-root run 12/12, exit 0;
`/tmp/soundscaper-r5-root-green2.log`). This is a repeat transform,
separate from the earlier source-label placement offset and 002's tempo lookup.

## R5-ROOT-004 — In-progress normalization overwrites a later gain edit

Import an ordinary 30-second recording. Open Clip properties → Normalize,
click Normalize to −1 dBFS, then immediately set Clip gain to −6 dB and press
Enter. Export audio and return to Properties. The baseline initially saves
−6.00 dB, then its earlier normalization job silently overwrites it with +19.00 dB.
The last explicit edit should survive the earlier asynchronous operation.

The operation's existing ownership check tracks source bounds and render
revision, while gain, fades and envelopes can change without that revision.
Capture and compare the actual clip-processing inputs and gain before every
asynchronous handoff and before publication. Reject the stale result; preserve
decorative title edits that leave the processing unchanged.

The ordinary Chromium workflow fails after its −6.00 dB setup assertion and
actual download succeed (`/tmp/soundscaper-r5-root-normalization-race-red.*`).
Four strict owning-service cases using real canonical gain/fade/envelope/polarity
commands fail before correction; they and the title control pass afterward.
All 28 focused new and existing property/normalization cases and target lint
pass. The ordinary workflow passes Chromium, Firefox and WebKit on immutable
checkpoint `5948d84d0` (combined four-root run 12/12, exit 0;
`/tmp/soundscaper-r5-root-green2.log`). This missing asynchronous
processing fence is independent of 001's gain-ceiling validation.

## R5-ROOT-005 — Normalize preview promises a different gain from Apply

Import an ordinary eight-second recording that has a quiet first six seconds
and a louder final passage. Select its clip header, choose Effect → Volume and
compression → Normalize, click Preview, then Apply to selection and export WAV.
The baseline preview reaches amplitude 0.891 while the same first phrase after
Apply reaches 0.099 on its native mono clock: a ninefold, roughly 19 dB, gain
difference. The actual stereo download is measured with the existing
constant-power mono pan accounted for. The read-only native buffer observer
forwards playback unchanged and neither alters project state nor supplies audio.

The preview measures only its six-second excerpt, missing the later peak and
whole-selection DC/loudness statistics. Process the complete selected recording
for Normalize and Loudness Normalization before bounding the audition to six
seconds. The existing effect memory admission measures those full inputs.
Peak, RMS and DC-only settings share this missing selection boundary and count
once. Stateless effects retain their existing short preview path.

The ordinary Chromium baseline fails on preview0.891 versus applied0.099
(`/tmp/soundscaper-r5-root-normalize-preview-red3.log`). Three strict cases using
the actual normalization processors fail before correction; the stateless
control passes. All 11 new and existing preview regressions pass afterward,
with target lint passing. The ordinary workflow passes all three engines on
immutable `8ef90da46` (3/3, exit 0; `/tmp/soundscaper-r5-root-normalize-preview-green3b.log`).
The first corrected run exhausted the old 30-second overall test budget; these
timeouts are excluded. The unchanged download/audio assertions pass with a
90-second budget for the import, Preview, Apply, export, download and decoding flow.
Regressions are `audio-editor-round5-normalize-preview-gain.test.ts` and
`audio-editor-round5-normalize-preview-gain.spec.js`. Complete-selection
statistics follow the existing processor policy and the
[Normalize definition](https://www.audacityteam.org/manual/effects/volume-and-compression/normalize/).
## R5-ROOT-006 — A staged Auto Duck macro loses its real control track

Import ordinary music (24 kHz in the regression) and voice (48 kHz) WAVs. Mute the voice for listening, open the
music's Clip properties, select all in Source waveform, and choose Tools →
Macros palette → New macro → Add effect → Auto Duck → Run macro. A valid
second audio track exists and the ordinary Auto Duck effect can use it. The
baseline refuses the macro: “Auto Duck requires a valid control track.”

Rack materialization correctly chooses the voice, but the temporary render
discards its control track and explicit mixer sidechain edge. A leading timeline
macro and a realtime step after an offline step have the same missing graph
dependency. Stage the bounded control PCM beside the processed selection and
connect it to the actual Auto Duck instance, preserving the authored control ID
without mixing it into the output. Source targets use the existing placement and
native sample-rate renderer; timeline targets retain their ordinary window.
Existing memory estimates already account for Auto Duck control channels. Each
await retains the macro's ownership check.

Both ordinary Chromium baseline workflows fail with the visible valid-control
refusal (`/tmp/soundscaper-r5-root-source-macro-duck-red2.log` and
`/tmp/soundscaper-r5-root-timeline-macro-duck-red.log`). Two strict chain cases
fail because the actual temporary engine project cannot resolve the control.
The first correction added the control PCM but still failed public verification
on checkpoint `5832abef0`; those failures exposed the required explicit sidechain
connection and the leading timeline path. The corrected strict cases assert that
connection and pass alongside existing source/mixed-rack/lifetime regressions
(23/23). Target lint passes; final public corrected verification is pending.
Checkpoint `e476d5766` then exposed a canonical graph reachability refusal because
the staged control's normal output assignment was removed. Retain every valid
assignment: the existing selected-track renderer already excludes other tracks'
programme edges while admitting sidechains. Both strict cases now also run the
actual graph validator before processing; they fail on the incomplete graph and
pass with its restored output routes. These corrections complete the same macro
graph root and add no count.
Checkpoint `b628c8f9d` accepts the graph and applies the macro, but all six
ordinary Source/timeline cases across Chromium, Firefox and WebKit still fail
the exported-audio assertion: peak 0.247 remains unducked. A forwarding native
buffer observer finds the staged control PCM is zero. This attempt remains
uncounted; the final control-render correction and public proof are pending.
The dry renderer passes only currently retained media to its isolated engine;
without the control buffer or provider, the scheduler silently creates no voice
plan. Admit that snapshot's required clip sources through the existing source
lifecycle before rendering, merge any transient buffers, and reassert operation
ownership after the read. A strict canonical-project case reproduces the empty
voice schedule before this correction and now verifies one real schedule plan,
neutralized mute, exact required-source IDs and the retained control buffer.
Focused macro/effect/spectral support passes 26/26; targeted lint, size and the
complete source/product type checks pass. Public PCM verification remains pending.
This temporary graph ownership defect is independent of earlier regular
Source Auto Duck placement and selection-edge fade corrections.

## R5-ROOT-007 — Source Spectral Delete uses the project frequency clock

Import an ordinary one-second 24 kHz recording containing a 1 kHz tone into
the default 48 kHz project. Select its clip, enable Spectrogram, open Clip
properties and select all in Source waveform. Choose Effect → Spectral editing
→ Spectral box select, enter 900–1100 Hz, and click Spectral Delete in that
dialog. Close Properties and export WAV. The baseline reports no error but
leaves the selected tone: the exported middle passage has RMS 0.174.

Source rendering supplies native-rate PCM, while spectral processing labels
that PCM with the project rate. Use the source target's existing sample rate,
with the project rate retained for timeline selections. This corrects the
shared spectral processing boundary and counts once across its operations.

The ordinary Chromium baseline fails on the exported audio assertion
(`/tmp/soundscaper-r5-root-source-spectral-red2.log`). The strict owning-service
test uses the actual Source editor and PFFFT processor: its 24 kHz case fails
before correction while the 48 kHz control passes. Both pass afterward, with
the selected tone removed, the unselected 6 kHz tone preserved, unchanged frame
counts and one publication. New and existing spectral/effect/document support
passes 31/31; target lint and coordinated test/tooling type checks pass.
The unchanged ordinary workflow passes Chromium, Firefox and WebKit on
immutable `5c194daa1` (3/3, exit 0, 21.9 seconds;
`/tmp/soundscaper-r5-root-source-spectral-green7.log`). Regressions are
`audio-editor-round5-source-spectral-clock.test.ts` and
`audio-editor-round5-source-spectral-clock.spec.js`.
