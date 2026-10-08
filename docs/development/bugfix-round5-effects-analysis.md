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
