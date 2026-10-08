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

Rack materialization correctly chooses the voice, but a source macro's
one-clip temporary render discards every other track. A realtime step after an
offline macro step uses the same staging boundary. Stage the bounded control
PCM beside the processed selection, preserving the authored control ID without
mixing it into the output. Source targets use the existing placement and native
sample-rate renderer; timeline targets retain their ordinary window. Existing
memory estimates already account for Auto Duck control channels. Each await
retains the macro's ownership check.

The ordinary Chromium baseline fails with the visible valid-control refusal
(`/tmp/soundscaper-r5-root-source-macro-duck-red2.log`). Two strict chain cases
fail because the actual temporary engine project cannot resolve the control.
Those and the existing source/mixed-rack/lifetime regressions pass after the
correction (23/23). Target lint passes; public corrected verification is pending.
This temporary graph ownership defect is independent of earlier regular
Source Auto Duck placement and selection-edge fade corrections.
