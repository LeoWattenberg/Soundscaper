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

ROOT-008 follow-through, without an additional count: the Source container
leaves Shift+Space untouched, but its enclosing Clip properties body still
intercepts it. Import a normal five-second WAV, focus Source waveform and
press the default Shift+Space play-from-cursor binding. On immutable green13,
source audition starts instead of timeline playback
(`/tmp/soundscaper-r5-root-source-shift-space-green13-red.log`, 7.4 seconds).
The enclosing owner now likewise reserves only plain Space. Its mounted
production regression is RED before that guard and GREEN afterward with
16/16 panel/source support; targeted lint and size gates pass. The extended
ordinary shortcut spec passes together with read-only source audition in
Chromium, Firefox and WebKit on immutable green14 `562e54fa4` (9/9, 51.0
seconds, no skips or failures;
`/tmp/soundscaper-r5-root-source-shortcuts-readonly-green14.log`). This
follow-through adds no count.

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
first-party dispatch branches count once. The final ordinary workflow compares
the untouched mono export with its processed export, preserving the existing
center-pan law rather than assuming raw mono amplitude at Master. The same
comparison fails at a 0.1414 amplitude loss on the baseline
(`/tmp/soundscaper-r5-root-selection-spectral-baseline3.log`) and passes all
three engines on immutable `da291bc0f` (3/3, 27.4 seconds, no skips or failures;
`/tmp/soundscaper-r5-root-selection-spectral-green12-final.log`). Earlier
absolute amplitude assertions omitted that normal pan law and are excluded
from the proof. ROOT-009 is now counted once.

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
`/tmp/soundscaper-r5-root-spectral-spectrum-green11.log`. ROOT-009 failed its
separate initial production check in that run; its subsequent correction and
verification are recorded above. That failure did not affect these measured
amplitude/report checks.

## R5-ROOT-011 — Source audition is disabled when another tab owns the project

Import an ordinary WAV, open its Clip properties and wait for the project to
save. Open the same editor in another tab, which takes editing ownership of
the saved project. Return to the first tab: its Source Play button is disabled,
although listening does not change the project. The source ruler incorrectly
uses persistent editing admission for audition.

Pass the existing busy admission separately to source playback, retaining
editing admission for trim, fades and stretch markers. Recording and other
busy operations still block source audition. This is the Source editor's own
playback presentation boundary, separate from take-list editing ownership.

The ordinary two-tab Chromium baseline fails at the disabled Play button
(`/tmp/soundscaper-r5-root-source-audition-readonly-baseline.log`, 8.3 seconds).
The production panel regression independently fails for an idle read-only tab,
while recording and writable-tab controls pass. Corrected panel, source
keyboard and runtime-projection support passes 16/16. Targeted type-aware lint
and the maintained-file size gate pass. An initial SSR fixture
omitted the effects port and is excluded from the defect evidence. Regressions
are `audio-editor-round5-source-audition-readonly.test.tsx` and
`audio-editor-round5-source-audition-readonly.spec.js`. The unchanged ordinary
two-tab workflow passes Chromium, Firefox and WebKit on immutable `a3d463c31`
(3/3, 26.9 seconds, no skips or failures;
`/tmp/soundscaper-r5-root-source-audition-readonly-green13.log`). Both normal
guarded product builds pass. ROOT-011 is counted once.

## R5-ROOT-012 — Source effects reject an ordinary surround recording

Import a normal six-channel WAV recording. Open Clip properties, focus Source
waveform and select all. Effect → Special → Invert refuses the operation with
“The effect did not produce valid audio.” Spectral Delete in the Source editor
shares the result publication failure. The existing importer, source editor
and DSP retain all six native channels, but the result service admits two.

Admit the existing source format's bounded 1–32 channel layout for source
results. Require the same original channel count and preserve native sample
rate, samples outside the source selection and timeline placements. The
timeline selection result retains its stereo bound. These effects share one
source result admission root.

Ordinary immutable-baseline Chromium Invert and Spectral Delete fail
(`/tmp/soundscaper-r5-root-source-multichannel-effects-baseline.log` and
`/tmp/soundscaper-r5-root-source-multichannel-spectral-baseline.log`). A separate
read-only toast observer records the exact refusal in four seconds
(`/tmp/soundscaper-r5-root-source-multichannel-toast-observer.log`). Six- and
32-channel strict source→DSP→persistence→real product command cases fail at
that admission; mono, stereo and bounded-layout controls pass
(`/tmp/soundscaper-r5-root-source-multichannel-node-red3.log`). Early test
loader and wrong command-profile fixture failures are excluded. Corrected
source result, PCM and command support passes 31/31. Regressions are
`audio-editor-round5-source-multichannel-effects.test.ts` and
`audio-editor-round5-source-multichannel-effects.spec.js`. Targeted lint,
`lint:changed`, strict owning test types and the size gate pass. Immutable
`92984139e` passes ordinary stereo and six-channel inversion, downloaded PCM
polarity, Undo/Redo and six-channel spectral deletion across Chromium, Firefox
and WebKit (9/9, 1.7 minutes, no skips or failures;
`/tmp/soundscaper-r5-root-source-multichannel-green16.log`). Both guarded
production builds pass. ROOT-012 is counted once; assistance runtime assets
are unchanged.

## R5-ROOT-013 — Changing source BPM silently replaces the chosen destination

Import an ordinary WAV and open Effect → Pitch and tempo → Change tempo.
Set From BPM to 120 and To BPM to 240, then change From BPM to 100.
The baseline silently substitutes 200 for the user's chosen 240 BPM because
the implied 140% tempo change exceeds the existing 100% processor ceiling.
The reciprocal case changes a chosen 60 BPM to 75 when From BPM becomes 150.

Bound edits of an established source BPM by the chosen destination and the
existing effect parameter limits. Refuse the unsupported reference in the
ordinary field validation before publishing another percent or destination.
An initial reference retains its existing 1–1000 BPM bounds. A valid subsequent
160 → 240 edit still produces 50% and the expected 0.8/1.5-second audio.

The ordinary immutable-baseline Chromium workflow fails at 200 versus 240
(`/tmp/soundscaper-r5-root-tempo-reference-destination-baseline.log`). Both
mounted production controls independently fail at the changed destination
(`/tmp/soundscaper-r5-root-tempo-reference-node-red2.log`); the initial loader
attempt without the repository's CSS loader is excluded. Corrected new and
existing rate, duration and derived-control checks pass 11/11. Target lint
and strict test types pass. Immutable `b40d2db8b` passes the complete field
refusal, valid 160 → 240 recovery, Apply and actual 25600-frame WAV download
across Chromium, Firefox and WebKit (3/3, 18.6 seconds, no skips or failures;
`/tmp/soundscaper-r5-root-tempo-reference-green18.log`). Both guarded product
builds pass. ROOT-013 is counted once.
Regressions are `audio-editor-round5-tempo-reference-admission.test.tsx` and
`audio-editor-round5-tempo-reference-admission.spec.js`. Assistance runtime
assets are unchanged.

## R5-ROOT-014 — Nyquist source clip bounds use timeline coordinates

Import an ordinary 0.8-second WAV, open Clip properties → Media settings and
move Start to five seconds. Focus Source waveform and select all. Tools →
Nyquist prompt with `(format nil "bounds=~a" (get '*track* 'clips))` reports
5–5.8 seconds while its selected native sound is 0–0.8. Effect → Nyquist →
Crossfade Clips → Apply therefore refuses this continuous recording with
“Empty space at start/ end of the selection.” The built-in explicitly supports
crossfading the halves of a continuous selection.

Expose the authenticated complete native source as this Source editor's clip,
using its frame count and sample rate. Keep ordinary timeline clip metadata and
per-channel layouts unchanged. This host clip inventory is separate from the
earlier native selection clock, output label placement and project tempo lookup.

The immutable Chromium prompt reproduces 5–5.8 instead of 0–0.8
(`/tmp/soundscaper-r5-root-nyquist-source-clip-bounds-baseline.log`), and the
actual built-in Apply reproduces its refusal
(`/tmp/soundscaper-r5-root-nyquist-source-crossfade-baseline2.log`). An initial
probe incorrectly looked for Run instead of the plug-in's Apply and is excluded.
Two strict actual Source editor target cases fail before correction; both
native clocks and stereo layout pass afterward with unchanged timeline controls.
New and existing host/source/tempo support passes 22/22. The old source-host
assertion now expects the native 0–0.8 bounds. Target lint, strict test types and
the size gate pass. Regressions are
`audio-editor-round5-nyquist-source-clip-bounds.test.ts` and
`audio-editor-round5-nyquist-source-clip-bounds.spec.js`. Immutable `cf64e5829`
passes both ordinary prompt and actual Crossfade Clips → Apply → WAV download
→ Undo workflows in Chromium, Firefox and WebKit (6/6, 1.2 minutes, no skips
or failures; `/tmp/soundscaper-r5-root-nyquist-source-clip-bounds-green19.log`).
The delivered extent is 5.4 seconds and Undo restores 5.8. Both guarded product
builds pass. ROOT-014 is counted once. Assistance runtime assets are unchanged.

## R5-ROOT-015 — A Source selection prevents a track rack noise profile

Import an ordinary WAV, Select all and add Noise Reduction to its track rack.
Close its settings, open Clip properties, focus Source waveform and select all,
then reopen the existing rack effect and press Get noise profile. Capture refuses
the valid selected recording: the source target has a synthetic native-source
identifier, which the rack admission compares with the authored track identifier.

Admit the source target through its authenticated owning track. Resolve the rack's
channel layout over the selected timeline range, retaining the existing rack
render clock and native Source selection. The rack remains an authored track
processor; capture does not modify or replace native source audio.

The immutable-baseline Chromium workflow reaches Get noise profile and fails to
capture (`/tmp/soundscaper-r5-root-rack-source-profile-baseline2.log`). The first
probe used the empty initial track and an incorrect settings locator and is
excluded. Two strict actual Source editor target cases independently refuse
before correction (`/tmp/soundscaper-r5-root-rack-source-profile-node-red.log`).
Native 24 kHz and 48 kHz ownership cases plus existing capture, bus and muted
Master support pass 31/31 afterward. Target lint, focused strict types and size checks pass. The complete immutable
`0a7c080f8` workflow captures, enables and offers Replace noise profile in
Chromium, Firefox and WebKit (3/3, 19.0 seconds, no skips or failures;
`/tmp/soundscaper-r5-root-rack-source-profile-green21.log`). Both guarded
product builds pass. Regressions are
`audio-editor-round5-rack-source-profile.test.ts` and
`audio-editor-round5-rack-source-profile.spec.js`. ROOT-015 is counted once.
Assistance runtime assets are unchanged.

## R5-ROOT-016 — Measure loudness does not become the repeatable analyzer

Import an ordinary WAV, Select all, choose Analyze → Measure loudness, and
close its populated Delivery Report. Analyze → Repeat last analyzer remains
disabled. If another analyzer ran previously, it repeats that older analyzer
instead of the loudness measurement the user just requested.

Remember successful loudness measurements, including a valid cache hit, and
dispatch their repeat to the same measurement and Delivery Report surface.
A refused measurement retains the preceding successful analyzer. Ordinary
levels, spectrum, clipping and contrast repeat behavior is preserved.

The immutable-baseline Chromium workflow reaches the populated report and
fails at the actual disabled Repeat last analyzer menu item
(`/tmp/soundscaper-r5-root-repeat-loudness-baseline4.log`). Earlier attempts
with ambiguous Close, a toolbar button instead of the menubar, and an exact
name missing the disabled explanation are excluded setup errors. Three strict
history/cache/menu cases independently fail before correction; new and existing
measurement, cache, repeat and admission support passes 32/32 afterward.
Target lint, focused strict types and the size gate pass. Regressions extend
`audio-editor-loudness-measurement.test.ts` and
`audio-editor-measure-loudness-surface.test.ts`, with ordinary browser coverage
in `audio-editor-round5-repeat-loudness.spec.js`. Immutable `2d5177efb` passes the complete measurement → report → repeat →
report workflow across Chromium, Firefox and WebKit (3/3, 13.0 seconds, no
skips or failures; `/tmp/soundscaper-r5-root-repeat-loudness-green22.log`).
Both guarded product builds pass, and complete bounded-memory lint passes
all eleven shards. ROOT-016 is counted once. Assistance runtime assets are
unchanged.

## R5-ROOT-017 — A native-rate profile makes an incompatible rack block export

Import an ordinary 24 kHz WAV into the default 48 kHz project. Open Clip
properties, select all in Source waveform, and use Effect → Noise removal and
repair → Noise Reduction → Get noise profile. Cancel that selection effect,
close Properties and add Noise Reduction to the authored track rack. The rack
automatically enables with the native 24 kHz profile. File → Export audio
then cannot produce a download because that profile is incompatible with the
48 kHz rack processor.

Reuse a captured profile automatically only when its clock matches the rack's
project clock. Otherwise add the existing disabled, uncaptured rack so export
continues and Get noise profile can capture compatible audio. Retain the valid
native profile for native source processing. Source-selection macro
materialization is unchanged, since it legitimately runs at the source clock.

The immutable-baseline Chromium workflow reaches the ordinary export and
fails to produce its Download link
(`/tmp/soundscaper-r5-root-native-profile-rack-export-baseline.log`). A separate
baseline run confirms the incorrectly enabled rack already offers Replace
noise profile. Initial probes missing PFFFT initialization, using the wrong
factory sample rate or raw rather than serialized macro context are excluded
setup errors. The final strict regression independently fails at automatic
reuse before correction, with all three matching-clock/native-macro controls
passing (`/tmp/soundscaper-r5-root-native-profile-rack-node-red4.log`). New and
existing rack admission and macro support passes 37/37 afterward. Regressions
are `audio-editor-round5-native-noise-profile-rack.test.ts` and
`audio-editor-round5-native-noise-profile-rack.spec.js`. Target lint, strict
test types and the size gate pass. Immutable `c1fb08c11` passes the complete
initial export → compatible profile capture → processed export workflow in
Chromium, Firefox and WebKit (3/3, 43.8 seconds, no skips or failures;
`/tmp/soundscaper-r5-root-native-profile-rack-green23.log`). Both guarded
product builds pass. ROOT-017 is counted once. Assistance runtime assets
are unchanged.

## R5-ROOT-018 — A suspended shortcut changes a Parametric EQ band

In Preferences → Keyboard shortcuts, assign Ctrl+Alt+Up to New label track.
Import an ordinary WAV, Select all, then open the Parametric EQ selection
effect. Focus its first graph band and press the assigned chord. Although
the modal correctly suspends the project command, the graph changes the
band's gain from 0 to 1 dB. Its independently implemented key handler
ignores modifier and already-handled event ownership.

Leave modified and already-handled band keys to their owner. Preserve exact
plain and Shift arrow adjustments, band selection, deletion and focus
restoration. The source file remains the same size. This is the separate
Parametric EQ graph handler from earlier Graphic EQ, Filter Curve and mixer
fader fixes; modifier and deletion siblings are grouped into this one root.

The ordinary immutable-baseline Chromium workflow changes the visible band
label from 0.0 to 1.0 dB and fails its unchanged-gain assertion
(`/tmp/soundscaper-r5-root-parametric-eq-shortcut-baseline.log`). Four mounted
production modifier/event cases independently fail while the plain/Shift
control passes (`/tmp/soundscaper-r5-root-parametric-eq-shortcut-node-red2.log`).
The first Node attempt omitted the repository's CSS asset loader and is
excluded as a harness failure. Those regressions and existing band selection,
deletion and automation gestures pass 14/14 afterward. Regressions are
`audio-editor-round5-parametric-eq-shortcut.test.tsx` and
`audio-editor-round5-parametric-eq-shortcut.spec.js`. Target lint, changed-file
lint, strict test types and the size gate pass. Immutable `a2b649a5c` passes
the complete configured-command → unchanged modified band → ordinary arrow
edit → command after closing the dialog workflow in Chromium, Firefox and
WebKit. The original keyboard-band-selection control also passes all three
engines (6/6 combined, 1.3 minutes, no skips or failures;
`/tmp/soundscaper-r5-root-parametric-eq-shortcut-green24.log`). Both guarded
product builds pass. ROOT-018 is counted once. Assistance runtime assets
are unchanged.

## R5-ROOT-019 — A Source tempo change alters a looped recording's pitch

Import an ordinary 750 Hz, 0.8-second WAV. Extend Looped clip length by one
repetition, open Properties, focus Source waveform and select all. Effect →
Pitch and tempo → Change tempo from 120 to 240 BPM → Apply. The export has
the expected 0.8-second extent but the recording plays at 375 Hz: source
processing changes its native sample count and total clip extent while
retaining the original 0.8-second repeat period and split phase.

Scale the repeat period and phase by the processed source-window ratio
through the existing loop transform primitive. Preserve the processed
source identity, authored clip processing, anchors, ordinary non-loop
geometry and hidden stretch-memory updates. This is the Source processing
command's own metadata remap, separate from earlier loop clipboard, source
trim, effect selection and interchange consumers.

The immutable-baseline Chromium workflow successfully applies Change tempo
and exports the exact expected extent, then fails at decoded pitch 375 Hz
instead of 750 Hz (`/tmp/soundscaper-r5-root-source-tempo-loop-baseline.log`).
Five canonical production-command cases independently fail on the retained
period/phase, while the non-loop/equal-length control passes. New and
existing native-clock, reversed-loop, split-phase, Source processing and
loop/trim support passes 39/39 after correction. Target lint, focused strict
test types and the size gate pass. Regressions are
`audio-editor-round5-source-tempo-loop.test.ts` and
`audio-editor-round5-source-tempo-loop.spec.js`. Immutable `b92c1f339` passes
the exact exported extent and pitch across both repetitions, visible scaled
repeat boundary, Undo and Redo in Chromium, Firefox and WebKit (3/3,
1.8 minutes; `/tmp/soundscaper-r5-root-source-tempo-loop-green25-final.log`).
Initial corrected browser attempts retained the original file-name locator
after ordinary Source processing renamed the clip to its source stem. Those
locator failures are excluded; the final workflow reacquires the visible
processed clip and uses ordinary Zoom to selection for its repeat boundary.
No audio assertion or original 60-second per-test deadline was weakened.
Both guarded product builds pass. ROOT-019 is counted once. Assistance
runtime assets are unchanged.

## R5-ROOT-020 — Track noise profiling drops the earlier filter's automation

Import an ordinary 750 Hz mono WAV. Add a Resonant low-pass filter to its
track, set Frequency to 750 Hz, and author a flat Q automation lane at
1.707. Select all, add Noise Reduction after the filter and Get noise profile.
Delete the Q lane, set the filter's static Q to the same 1.707, then Replace
noise profile. The two profiles differ materially, although the two authored
filter settings are equivalent: track rack capture clears every automation
lane while retaining its earlier processors.

Build a focused rack-prefix render projection that retains only automation
owned by that track's earlier effects. Preserve exact lane timing and points,
neutralize listening gain/pan/mute/solo, and continue excluding later effects
and other tracks. Reconcile the transient feature inventory through its
existing projection. Keep destructive dry rendering's separate contract.

The complete immutable-baseline Chromium workflow fails on the captured
profile comparison (`/tmp/soundscaper-r5-root-rack-prefix-automation-baseline.log`).
Its owning production-service test independently fails on the empty lane
list, while the destructive dry-render control passes. New and existing
effect-audio, bus/master profile, native Source profile and isolated folder
support passes 35/35 after correction. Target and changed-file lint, strict
test types and the size gate pass.
An initial Node fixture omitted the ordinary audio selection; a compiler
command omitted the repository's Vite declarations. Those setup failures
are excluded. Regressions are `audio-editor-round5-rack-prefix-automation.test.ts`
and `audio-editor-round5-rack-prefix-automation.spec.js`. Immutable `04a70d3fa`
passes the complete automated-prefix → equivalent static-prefix capture and
existing Source-rack control in Chromium, Firefox and WebKit (6/6, no skips
or failures; `/tmp/soundscaper-r5-root-rack-prefix-automation-green28.log`).
The exact complete profile comparison and original 90-second deadline remain
unchanged. Both guarded product builds pass. ROOT-020 is counted once.
Assistance runtime assets are unchanged.

## R5-ROOT-021 — Routing navigation swallows a configured project shortcut

Import an ordinary WAV. In Preferences → Keyboard shortcuts, assign
Ctrl+Alt+Right to New label track. Open Window → Mixer → Routing graph,
focus the recording's node and press that chord. Instead of executing the
configured command, the graph moves focus to another node and prevents the
event; no label track appears. Its independent node, port, connection and
cancellation handlers claim modified and already-handled keys.

Keep the graph's plain navigation, port connection, deletion and Escape
cancellation with its local owner. Leave Ctrl/Meta/Alt commands and keys
already handled by another owner available for project/browser dispatch.
Node, wire, port and cancellation manifestations share this graph root;
earlier EQ, timeline, fader and spreadsheet handlers are separate owners.

The complete immutable-baseline Chromium workflow passes ordinary arrow
navigation, then fails at zero label tracks after the configured chord
(`/tmp/soundscaper-r5-root-routing-shortcuts-baseline.log`). Four faithfully
mounted production modifier/ownership cases independently fail while the
plain navigation/connection/cancellation control passes. New and existing
routing view, inspector, mixer integration and command support passes 21/21
after correction. The initial mounted test used a compound selector absent
from the test DOM and is excluded as a harness failure. Target lint,
changed-file lint, focused strict test types and the size gate pass. Regressions are
`audio-editor-round5-routing-shortcuts.test.tsx` and
`audio-editor-round5-routing-shortcuts.spec.js`. Immutable `0338e893d` passes
the configured command, unchanged focused graph node and one Undo across
Chromium, Firefox and WebKit. The existing pointer/keyboard graph editing,
validation and inspector workflow passes alongside it (6/6, 35.8 seconds;
`/tmp/soundscaper-r5-root-routing-shortcuts-green29.log`). Both guarded
product builds pass. ROOT-021 is counted once. Assistance runtime assets
are unchanged.

## R5-ROOT-022 — Warp authoring publishes an unsupported repeated-clip map

Import an ordinary 0.8-second mono recording. Select its header, press Right
once on Looped clip length, then Effect → Pitch and tempo → Audio warp and
transients → Create identity warp map. The dialog reports success, but File
→ Export audio fails with “Audio warp outer endpoints must match the clip
anchor extent.” The authoring service publishes a full-clip map although
the existing renderer schedules individual loop periods. The opposite order
already refuses looping through its unwarped-clip admission contract.

Refuse a map while the clip retains looping before publishing a command, and
explain how to recover by turning off clip looping. Leave map clearing
available. Preserve the repeat period, phase, source and history. Returning
the loop handle to one repeat restores ordinary warp authoring.

The complete immutable-baseline Chromium workflow reaches identity-map
success and then the exact export error
(`/tmp/soundscaper-r5-root-loop-identity-warp-baseline.log`). Two strict
ordinary-command-created loop cases fail before correction while the
remove-loop recovery control passes. New and existing authoring, controller
composition and loop support now pass 40/40. Target lint and the size gate
pass, as does the focused strict compiler using the repository test settings.
Immutable `a26a52e78` passes the complete public refusal, repeated WAV export,
unchanged Undo/Redo and return-to-one-repeat identity-map recovery in Chromium,
Firefox and WebKit (3/3, 1.3 minutes;
`/tmp/soundscaper-r5-root-loop-warp-green31.log`). Both guarded product builds
pass. ROOT-022 is counted once. The assistance runtime closure is unchanged.

## R5-ROOT-023 — Filter Curve EQ silently substitutes a limited inverse

Import an ordinary recording, Select all, then Effect → EQ and filters →
Filter Curve EQ. Expand Curve points and enter `100:-80, 10000:-80`. Invert
changes the curve to +60 dB, silently substituting the gain limit for +80 dB;
another Invert returns -60 dB and loses the original authored curve. The
native curve domain admits -120..60 dB, so this inverse cannot be represented.

Disable the existing Invert action when its result would exceed that domain,
explain the boundary through its existing action area, and preserve the
authored points. Exact supported inverses no longer use a clipping substitute.
The mathematical inverse and its admission live in a focused strict helper.

The immutable-baseline Chromium action records the substituted +60 dB
(`/tmp/soundscaper-r5-root-filter-invert-limit-baseline.log`), and the final
admission workflow fails at its enabled button
(`/tmp/soundscaper-r5-root-filter-invert-admission-baseline.log`). The production
mounted case fails before correction, then new and existing curve, point-focus,
keyboard, axis and gesture support passes 11/11. Its exact -60/+60 boundary
and second-inversion round trip pass. Target lint, focused strict compiler and
the size gate pass. Immutable `9ac41696b` passes the unchanged public inverse
admission, exact supported double-inversion round trip and existing curve
interactions plus realtime-rack persistence in Chromium, Firefox and WebKit
(12/12, 55.0 seconds; `/tmp/soundscaper-r5-root-filter-invert-green33.log`).
Both guarded product builds pass. ROOT-023 is counted once. The assistance
runtime closure is unchanged.

## R5-ROOT-024 — Spectral handles consume configured editor commands

Import an ordinary recording. In Preferences → Keyboard shortcuts, assign
Ctrl+Alt+Right to New label track. Enable Spectrogram and Select → Spectral
→ Spectral brush, then draw a band. Focus its maximum-frequency or start-time
handle and press the assigned command. No label track appears; the handle
instead changes the selected frequency or time. Both handle families share
this independently implemented spectral-band keyboard owner.

Leave handled and Ctrl/Meta/Alt keys available to the workspace command
owner before interpreting ordinary spectral edits. Preserve plain and Shift
editing, pointer cancellation, the existing selection and focus.

Both unchanged public workflows fail on the immutable baseline at the absent
label track (`/tmp/soundscaper-r5-root-spectral-handle-red.log`). All five mounted
production-handle cases independently fail at consuming Ctrl; after correction
they preserve Ctrl/Meta/Alt and already-handled events while retaining plain
edits. New and existing spectral gesture, cancellation and effect support
passes 10/10 (`/tmp/soundscaper-r5-root-spectral-handle-support.log`). Targeted
type-aware lint, focused strict compiler, lint:changed and the size gate pass.
Immutable `15416e48c` passes command dispatch, one-entry Undo restoring the
exact band, continued plain editing and the existing pointer Escape workflow
in Chromium, Firefox and WebKit (9/9, 35.3 seconds;
`/tmp/soundscaper-r5-root-spectral-handle-green35-retry.log`). The first corrected
browser run expected New label track to retain the current spectral selection;
the command deliberately selects its new track, so the test now verifies the
original band through its ordinary Undo. That setup expectation adds no count
and changes no product assertion about dispatch or unintended spectral edits.
Both guarded builds pass. ROOT-024 is counted once, separately from prior brush
creation/pointer cancellation and other independently implemented command
consumers. The assistance runtime closure is unchanged.

## R5-ROOT-025 — A suspended command changes modal window dimensions

Import an ordinary recording. Preferences → Keyboard shortcuts: assign
Ctrl+Alt+Up to New label track. Focus Resize: Editor preferences and press
the binding. The modal suspends project commands, but its resize grip treats
the modified key as a local arrow and changes the window height from
600.1875 to 584 pixels. Modified command keys should leave window geometry
unchanged; ordinary arrows should retain the existing 16-pixel resize.

Return already handled and Ctrl/Meta/Alt events before the editor-owned modal
surface applies its resize. Preserve the ordinary bounds, pixel rounding and
existing mouse Escape cancellation. This surface is independent of the dock
and floating panel geometry owner repaired in R4-DIALOG-029.

The immutable-baseline Chromium workflow fails at its changed height
(`/tmp/soundscaper-r5-root-modal-resize-shortcut-red.log`). Four mounted actual
surface cases fail before correction while testing both vertical and horizontal
keys. Those cases and existing mouse cancellation/lifecycle support pass 6/6
(`/tmp/soundscaper-r5-root-modal-resize-shortcut-support-retry.log`). Targeted
type-aware lint, focused strict compiler, lint:changed and the size gate pass.
The first focused compiler found incomplete fixture declarations; the fixture
now supplies its exact mounted public props and rectangle/style types without
changing source behavior or counting those diagnostics. Immutable `1672be43a`
passes unchanged geometry, plain-arrow resizing and resumed command dispatch
in Chromium, Firefox and WebKit (3/3, 13.9 seconds;
`/tmp/soundscaper-r5-root-modal-resize-shortcut-green37.log`). Both guarded
product builds pass. ROOT-025 is counted once. The assistance runtime closure
is unchanged.

## R5-ROOT-026 — Cancel dismisses an effect while its audio replacement continues

Import an ordinary 30-second mono WAV. Select all, Effect → Delay and reverb
→ Reverb, Apply to selection, then press the still-enabled Cancel button while
the progress indicator is visible. The dialog closes, but the background work
finishes and replaces the recording. Export WAV: its PCM differs from the
original by a peak 0.0368758 despite that explicit cancellation.

Give the submitted selection-effect task an owned cancellation action. The
dialog's Cancel, Close and idle Escape cancel that task and its worker, clear
its busy presentation and invalidate its eventual completion. Existing task
and project assertions fence audio loading, processing and persistence, so a
late result cannot replace the document or update Repeat last effect. Preserve
preview cancellation and successful applications. This execution owner is
independent of generator insertion cancellation and canceled Amplify draft
configuration fixed in earlier rounds.

The ordinary immutable-baseline workflow reaches Cancel during real rendering
and fails its decoded WAV equality assertion (53.9 seconds;
`/tmp/soundscaper-r5-root-selection-effect-cancel-red.log`). Three strict
production-service cases independently fail at publishing one replacement
after cancellation during rendering, worker processing and persistence. The
correction passes those and existing selection-effect, project-ownership,
linked silence and mounted dialog support, 39/39
(`/tmp/soundscaper-r5-root-selection-effect-cancel-support.log`). Targeted
type-aware lint, focused strict compiler and file-size checks pass. Immutable `7c3977b10` preserves the complete original PCM after cancellation
in Chromium, Firefox and WebKit; the combined new cancellation, saved-detector
and existing Amplify workflows pass 9/9 (3.8 minutes;
`/tmp/soundscaper-r5-root-effect-cancel-repeat-green39.log`).
Both guarded product builds pass. ROOT-026 is counted once.
The composition support caught an omitted idle cancellation stand-in for
Framescaper, which intentionally excludes selection effects. That stand-in
is restored before checkpoint capture; all 37 controller/action/absence
controls pass, adding no separate count.
The assistance runtime closure is unchanged.

## R5-ROOT-027 — Repeat silently substitutes a canceled Auto Duck control

Import ordinary music, a silent quiet take and an audible voice take. Mute
voice's output, select music, apply Auto Duck using quiet as its control, then
remove quiet. Reopen Auto Duck, choose voice and Cancel. Effect → Repeat last
effect now ducks music using that canceled draft instead of refusing its
removed saved detector. Exported PCM changes by a peak 0.1058885.

Restore the remembered control, including an explicit absent control, through
its existing validator before changing Repeat's effect configuration. A
missing saved detector refuses without applying audio or replacing the draft;
a surviving detector retains normal Repeat behavior. Undo the removal and
Repeat works again with the restored quiet control. This saved-detector
admission is separate from the earlier Amplify automatic-gain marker repair.

The immutable baseline reaches the complete ordinary workflow and fails its
decoded WAV equality assertion (22.1 seconds;
`/tmp/soundscaper-r5-root-repeat-missing-control-red3.log`). Two strict cases
fail before correction while a surviving-control case passes; all three and
existing effect configuration, automatic gain, previews and public-controller
support pass 26/26 (`/tmp/soundscaper-r5-root-repeat-missing-control-support.log`).
Initial public setup incorrectly expected mono output to omit its center pan
attenuation and reused a retired clip-name locator; those fixture errors are
excluded. The final proof uses normal public track identity and the unchanged
PCM assertion/deadline. Target lint, focused strict types and size pass.
Immutable `7c3977b10` refuses the missing saved control without changing PCM
or adding history, then restores valid Repeat after Undo, in Chromium, Firefox
and WebKit. The combined cancellation, saved-detector and existing Amplify
workflows pass 9/9 (3.8 minutes;
`/tmp/soundscaper-r5-root-effect-cancel-repeat-green39.log`). Both guarded builds
pass. ROOT-027 is counted once. The assistance runtime closure is unchanged.

## R5-ROOT-028 — Native effect sliders swallow configured commands

Import an ordinary video in Framescaper. Assign Ctrl+Alt+Up to New label track
in Preferences, open its Properties, add Color adjust and focus Brightness.
Press the assigned chord: no label track appears and the native slider changes
Brightness from zero to 0.01. The workspace classifies every input, including
a native range, as a text editor and never dispatches the accepted command.

Treat modified range keys as commands while retaining native plain arrows,
Home/End and Page Up/Down. Keep text and number editing and modal suspension
unchanged. This shared eligibility owner is distinct from custom control
handlers repaired earlier; all native range variants count once.

The complete ordinary immutable-baseline workflow fails at the absent label
track (`/tmp/soundscaper-r5-root-native-range-command-red.log`); a second probe
confirms the unintended native parameter change. Three strict production-owner
cases independently fail dispatch before correction, while native editing
controls pass. New and existing keyboard/cancellation support passes 12/12
(`/tmp/soundscaper-r5-root-native-range-support-retry.log`). Focused strict
types, type-aware lint and the size gate pass. Corrected immutable browser
verification is pending; ROOT-028 is not yet counted. The assistance runtime
closure is unchanged.
