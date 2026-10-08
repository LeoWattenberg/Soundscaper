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
Corrected-build public browser verification is pending.

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
correction, and target type-aware lint passes. Corrected-build public browser
verification is pending; detailed focused-suite and lint evidence remains in
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
Corrected-build public verification is pending. This is a repeat transform,
separate from the earlier source-label placement offset and 002's tempo lookup.
