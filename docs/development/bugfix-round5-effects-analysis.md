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

Remove the empty starter track through Tracks → Remove tracks, then import
ordinary music (24 kHz in the regression) and voice (48 kHz) WAVs. Mute voice
for listening. Select music's header, or open its Clip properties and select all
in Source waveform. Tools → Macros palette → New macro → Add effect → Auto
Duck → Run macro refuses with “Auto Duck requires a valid control track,” even
though the second recording is available.

The macro's temporary render discards the materialized control track and its
explicit mixer sidechain edge. Stage bounded control PCM beside the processed
selection and connect it to the actual Auto Duck instance. Keep valid output
assignments; the existing selected-track render excludes the control's programme
output while retaining its detector input. Source targets use the existing
placement and native-rate control renderer. Each await retains the macro's
ownership check, and the memory estimates already include control channels.

Both public workflows reproduce the missing-control refusal on the unchanged
baseline. The corrected staging tests validate the actual canonical mixer graph,
resolve the real control, and verify detector processing; focused macro support
passes 20/20. The normal guarded product builds pass. Source and timeline
workflows pass Chromium, Firefox and WebKit on immutable green9 `004e07463`
(6/6, zero skips, 1.3 minutes). Exported PCM confirms the expected ducking,
with peak between 0.04 and 0.08 instead of the unducked 0.247.
Evidence is `/tmp/soundscaper-r5-root-macro-duck-real-voice-baseline.log` and
`/tmp/soundscaper-r5-root-macro-duck-real-voice-green9-all.log`.

The initial PCM probe left the empty starter track available as a default
control. Read-only observations exposed that setup error; it adds no bug and
its speculative source-loading change was removed. This staged graph defect is
independent of earlier regular Auto Duck placement and selection-edge fades.

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

## R5-ROOT-008 — Source waveform consumes a configured modified-Space command

Import an ordinary WAV. In Edit → Preferences → Keyboard shortcuts, bind
New label track to Ctrl+Alt+Space. Open the recording's Clip properties, focus
Source waveform and press that binding. The baseline starts source audition
and creates no label track. The waveform's container claims every Space event
before the configured command can receive it.

Reserve plain Space for source audition; leave modifier-bearing Space and
already-handled events to their existing command owners. Native input and
button handling remains intact. This container-level Space owner is separate
from the earlier source trim and source ruler arrow navigation owners.

The ordinary Chromium baseline fails at the absent new label track
(`/tmp/soundscaper-r5-root-source-waveform-shortcut-baseline.log`). The mounted
production component independently fails because Ctrl+Space starts audition;
the corrected test covers Ctrl, Meta, Alt, Shift and handled events, plus plain
Space's original behavior. Source selection, trim, ruler and marker support
passes 13/13. Regressions are
`audio-editor-round5-source-waveform-shortcut.test.tsx` and
`audio-editor-round5-source-waveform-shortcut.spec.js`. The same configured
binding workflow passes Chromium, Firefox and WebKit on immutable green10
`459027ddc`, with both earlier source-key owners (9/9, zero skips, 51.4 seconds;
`/tmp/soundscaper-r5-root-source-waveform-shortcut-green10.log`). Both normal
guarded product builds, targeted type-aware lint and size checks pass.

## R5-ROOT-009 — First-party selection effects overwrite unselected frequencies

Import a normal mono WAV containing 1 kHz and 6 kHz tones. Select all, enable
Spectrogram and choose Effect → Spectral editing → Spectral box select with
900–1100 Hz → Select range. Apply Effect → Special → Utility Gain (Reviewed)
with gain zero, then export WAV. The baseline silences both tones: the 6 kHz
amplitude falls from 0.2 to approximately 3e-10, although that frequency is
outside the authored band.

The generalized dispatcher returns reviewed, Bitcrusher and band-dynamics
output before the existing spectral compositor can combine the selected bins
with unchanged audio. Reuse that compositor for these branches and the reviewed
processor's dedicated worker owner. Preserve the terminating package worker,
input PCM, frame/channel layout and cancellation fences. Account for the
replacement buffer and FFT scratch in their existing peak admission. Keep
execution behind the existing optional FFT/spectral primitive owner. The first
production checkpoint exposed a cold-import initialization cycle when the new
compositor shared the whole selection-dispatch chunk and entered the Delay
facade early. Correct its ownership with the spectral primitives; this
introduced correction remains part of ROOT-009 and adds no bug count.

The unchanged Chromium workflow fails on its actual downloaded PCM
(`/tmp/soundscaper-r5-root-selection-spectral-baseline2.log`, 6.1 seconds).
Four actual DSP branches and the reviewed owning service independently fail
before correction; their selected-tone and unchanged-neighbor checks pass
afterward. New and existing worker, DSP, FFT loading and chunk ownership support
passes 58/58; the follow-through worker/ownership support passes 52/52. Targeted
type-aware lint and size checks pass. Regressions are
`audio-editor-round5-selection-effect-spectral-band.test.ts` and
`audio-editor-round5-selection-effect-spectral-band.spec.js`. These omitted
first-party dispatch branches count once. Final immutable public verification
is pending, so this entry is not counted yet.

## R5-ROOT-010 — Plot Spectrum understates a recording's amplitude by 6 dB

Import an ordinary 750 Hz stereo WAV with peak amplitude 0.5. Select all and
open Analyze → Analyze selection: its peak is -6.02 dBFS. Close that dialog
and open Analyze → Plot spectrum → Export. The downloaded spectrum identifies
750 Hz correctly, but its peak is 6.09 dB below the measured recording.

The FFT multiplies the recording by a Hann window, then normalizes as if it
had used a rectangular window. Normalize against the retained Hann coefficient
sum. Double only interior bins in the one-sided spectrum; DC and Nyquist
remain undoubled. Average the available complete windows without appending
partially zero-filled windows after them; retain the single bounded padded
window for shorter input. Preserve channel-power pooling, cached windows and
immutable reports. This amplitude calibration follows the
[documented Plot Spectrum convention](https://manual.audacityteam.org/man/plot_spectrum.html)
that a full-scale sine appears at approximately 0 dB. It is separate from the
earlier plot-column peak preservation and live opposite-polarity channel mixing.

The ordinary menu/dialog/report download is Chromium RED at the measured
6.09 dB discrepancy (`/tmp/soundscaper-r5-root-spectrum-level-baseline.log`,
3.4 seconds). Nine bin-centered sine/FFT-size cases and the DC/Nyquist endpoint
case independently fail before correction; the channel-pooling control passes.
The same calibration case with averaging over a single complete FFT window
exposes an extra 2.04 dB reduction from the trailing artificial half-window.
New and existing FFT, analysis, window reuse and pink-noise support passes
28/28. The older spectrum assertion which expected half a full-scale sine's
amplitude now asserts the calibrated value. Regressions are
`audio-editor-round5-spectrum-level-calibration.test.ts` and
`audio-editor-round5-spectrum-level-calibration.spec.js`. Both ordinary long
and one-window recordings pass in Chromium, Firefox and WebKit on immutable
`41e0214e0` (6/6, no skips or failures), as recorded in
`/tmp/soundscaper-r5-root-spectral-spectrum-green11.log`. ROOT-009 fails its
separate production check in that same run and remains uncounted; it does not
affect these measured amplitude/report checks.
