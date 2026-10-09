# Round 7 effects and analysis bug register

Only ordinary menu/control paths qualify. Each entry counts one causal root,
including every manifestation repaired through that same owner. Unreachable
legacy UI and hypotheses without failing regressions are excluded.

## R7-EFFECT-001 — Compatible Audacity rack controls restart sounding audio

Import an ordinary 16-second mono recording, Select all, open its track Effects
and add Noise Reduction. Get noise profile, set Noise reduction to zero, Play,
then change Sensitivity from 6 to 7. The baseline rebuilds the live rack and
discards its pending rendered audio even though the processor's geometry and
latency are unchanged. Its shared base also unconditionally resets compatible
filter, modulation, DC-blocker and Auto Duck histories when controls publish.

Admit the remaining compatible Audacity inserts through the existing rack
gesture and engine message paths. A focused geometry policy preserves their
running state after coefficient/level edits, and retains explicit reset and
topology/latency rebuild boundaries. Phaser/Wahwah rate edits retain the current
LFO phase through multiple edits and repeated values. All seven insert families count
once under this common missing live-control admission/continuity root.

The initial strict owning-DSP/control regressions fail 15/15 before the fix,
including silent queued Noise Reduction PCM and exact history loss. They pass
15/15 afterward; five real rack-engine routing/topology cases also pass. The
new regressions plus existing Echo, live EQ and dynamics continuity pass 40/40.
Two additional phase-clock regressions pass, including repeated and multiple
frequency edits. No on-disk fixtures, archives or raw coverage were created. Public Chromium
witness: `audio-editor-round7-live-compatible-controls.spec.js` (root owns its
build/run and final evidence).

The ordinary native-message/node-retention witness passes Chromium on immutable
`220719574` in the root-owned public wave 2 (3.7 seconds); DSP continuity is established by
the strict sample-history regressions above.

The assistance runtime closure is unchanged; no manual **Update AI assets** run
is required.

## R7-EFFECT-002 — Classic Filters substitutes a lower supported cutoff

Import an ordinary 48 kHz recording or generate a tone at 23,999 Hz, Select all,
then Effect → Legacy effects → Classic Filters. Keep Butterworth/Low-pass,
Order 1, set Cutoff frequency to the supported 23,999 Hz and Apply. The cutoff
should attenuate that tone by 3 dB; the baseline attenuates it by about 8.3 dB.
The shared coefficient owner silently caps every normalized frequency at
0.9999, replacing this authored cutoff with 23,997.6 Hz. Its live rack and graph
share the same coefficient error. High-pass is the same root.

Honor every finite authored cutoff below Nyquist while keeping the historical
fallback for unsupported inputs. Four strict actual selection/live DSP cases
fail before correction at measured amplitudes 0.1923077 (low-pass) and
0.4615385 (high-pass), rather than 0.3535534. They and the existing Audacity
live/realtime regressions pass 27/27 after correction. The ordinary
Apply/decoded WAV witness is
`audio-editor-round7-classic-filter-cutoff.spec.js`; its root-owned browser
verification passes Chromium on immutable `220719574` (6.2 seconds, root-owned
public wave 2 retry). The one four-second input occupies under one MiB in
memory and creates no on-disk fixture. No AI runtime asset update is required.

## R7-EFFECT-003 — Export clips the audible Classic Filters release

Import a normal one-second 10 Hz recording, open track Effects, add Classic
Filters, set Cutoff frequency to 10 Hz, then Export with the default Include
effect tails enabled. Its charged IIR filter keeps sounding after the recording
ends, but the baseline declares zero tail frames and truncates the WAV there.

Classic Filters now publishes a conservative release bound from its actual
stable cascade coefficients. The existing standard filter estimator moves to
one focused shared module without changing its calculations. The ordinary
10-second rack release cap remains intact for very long ringing settings.
Five focused cases fail before correction and pass afterward; together with
the existing standard filter and Audacity live cases they pass 22/22. The
public export/decoded-WAV witness is
`audio-editor-round7-classic-filter-tail.spec.js` passes Chromium on immutable
`220719574` (4.2 seconds, root-owned
public wave 2 retry). All small PCM fixtures live in memory and create no disk files.
No AI runtime asset update is required.

## R7-EFFECT-004 — A muted insert pads Export with an irrelevant release

Import two normal one-second recordings, add Feedback delay to the second
track, set Time to one second, Feedback to zero and Mix to one. Export includes
the sounding release and contains 96,000 frames. Mute that track and Export
again: the baseline still appends the same second of digital silence rather
than delivering the audible dry recording's 48,000 frames. The production tail
path owner follows structural routes but ignores the strip gates that silence
post-fader audio. Track/bus mute, solo, zero gain, VCA and zero routing level are
manifestations of this one omitted audibility decision.

Tail traversal now filters static silent paths through the same production
solo/VCA logic as the engine. Pre-fader taps remain audible before those gates;
authored mute/gain/edge automation conservatively retains a possible release.
Ungated stems and neutral/Mix & Render calls carry their existing mute/solo
policy through every tail query, including exact warp and native render paths.

Four focused owning export/engine/model cases are causally RED with 48,000
irrelevant tail frames. Thirteen corrected tail/control/safeguard cases plus
existing serial/parallel topology and the live control regressions pass 34/34.
The focused exact-warp, Mix & Render, clip/chapter export and routing cases pass
64/64, retaining their ordinary stem and neutral-render behavior.
The exact public healthy-unmuted/muted WAV workflow is causally RED on immutable
`220719574`: the healthy control passes at 96,000 frames, then the muted export
is still 96,000 rather than 48,000. Evidence:
`/tmp/soundscaper-r7-public-wave2-retry.log`. The root-owned corrected Chromium
verification passes on immutable `5c9787bec`, retaining the healthy unmuted
export, exact muted duration and restored release after unmuting.
The two one-second WAV inputs live in memory and
temporary browser outputs are cleaned by the root runner. No AI runtime asset
update is required.

## R7-EFFECT-005 — Live stereo linking keeps unequal Noise gate attenuation

Import an ordinary stereo recording with a loud left channel and a quieter
right channel. Open track Effects, add Noise gate, set Attack to one second and
Stereo linking to Independent channels, then Play. Change Stereo linking to
Link channels while the loud channel is open. The baseline changes its peak
detector but preserves separate channel envelope histories, so the right
channel remains attenuated during the authored attack/hold/release while the
left channel stays open. Reversing which channel is louder is the same root.

Joining channels now copies the most open channel's current gain and attack
history and shares the maximum remaining hold. The change preserves the
sounding envelope and existing lookahead/crossover history; unlinking resumes
the separate detectors. Four strict output cases fail before correction,
including 0.00000631 versus 0.0001 on the first linked quiet sample. All six
transition/block/reset cases pass afterward, including preservation of the
ordinary default lookahead buffer. Together with existing gate, lookahead,
tail, fixed offline and actual worklet regressions they pass 45/45.
The fixed offline hashes remain exact; the live relinking snapshot that
encoded unequal gains now verifies equal attenuation of the delayed source.

The ordinary live control/native stereo output witness is
`audio-editor-round7-noise-gate-linking.spec.js` is causally RED on immutable
`220719574`: the healthy independent channel ratio is 0.0006177, then supported
Attack 1,000 ms reaches native one-second controls and the newly linked channel
ratios remain 0.00254–0.00493 instead of the common 0.01. Earlier attempts with
an unexpanded advanced field or Attack 1 ms are excluded setup/settled controls.
The corrected Chromium witness passes on immutable `5c9787bec`, with native
linked ratios 0.00978–0.01023. Its small observations and 16-second input are held only
in memory, and no raw coverage or disk fixture is created. No AI runtime asset
update is required.

## R7-EFFECT-006 — Native resonant filters apply quality factor as decibels

Import a normal three-second 1,000 Hz stereo recording with peak amplitude
0.5. Open track Effects, add Resonant low-pass filter, set Frequency to 1,000 Hz
and keep the authored default Q 0.707. Export the recording. Its cutoff should
have gain 0.707 and RMS 0.24996, but the baseline writes 0.707 directly into the
native filter's Q AudioParam. Web Audio interprets low/high-pass Q in decibels,
making the effective quality factor 1.0848008. Resonant high-pass and authored
Q automation share this one unit-conversion root.

Convert the authored quality factor to native decibels at graph construction
and at every scheduled parameter event. The document, control ranges and
automation descriptors retain their quality factor values. This follows the
[primary Web Audio coefficient and Q contract](https://webaudio.github.io/web-audio-api/#dom-biquadfilternode-q).
Ten strict actual graph/scheduling cases fail before correction and pass
afterward; with the existing parameter registry and rack-width safeguards they
pass 21/21. The tests evaluate the native coefficient equations independently
and cover supported Q 0.1, 0.707, 1, 10 and automated 30.

The public native-render/decoded-WAV witnesses in
`audio-editor-round7-native-filter-q.spec.js` are causally RED on immutable
`5c9787bec`: both native low/high-pass decoded WAVs measure RMS 0.383523 instead
of the authored 0.249962. Both corrected native LP/HP witnesses pass on the
root-owned immutable `fef78921b` capture.
Small PCM stays in memory and no verification fixture
or raw coverage is written. No AI runtime asset update is required.

Q automation follow-through also preserves authored Linear interpolation.
Converting only its endpoints makes native decibel ramps interpolate quality
geometrically: a supported Q 0.1 → 10 curve reads 0.158489 at 10% instead of
the authored 1.09. Independent native LP/HP interior gain regressions are RED
after the endpoint repair, then GREEN with bounded native subdivisions whose
quality-factor error stays within the descriptor tolerance. Ordinary ascending
and descending 0.1 → 10/30 sweeps remain below 2,048 subdivisions. Native Q,
registry, real lane compiler and tail support passes 39/39. This completes
R7-EFFECT-006 without another count.

## R7-EFFECT-007 — Native Resonant filters truncate their audible export release

Import an ordinary one-second, 48 kHz, 10 Hz stereo recording. Open its track
Effects, add Resonant low-pass filter, set Frequency to 10 Hz, and Export with
Include tails retained. Export ends at exactly 48,000 samples even though the
native filter retains audible energy. Resonant high-pass uses the same owner.
The stock BiquadFilter graph has no tail declaration: the shared effect tail
dispatcher falls through to zero. Classic Filters has a separate coefficient
and live-processor owner repaired by R7-EFFECT-003.

Derive the native low/high-pass release from the browser's actual coefficient
contract and the common stable-pole bound. Reserve release below −80 dB,
preserve native Nyquist identity/zero behavior, bypass, and the existing
ten-second rack ceiling. Include authored Frequency/Q points and Bézier control
values when determining the conservative parameter bounds. Thread those lanes
through Export, Mix and Render, and Make stereo so existing destructive paths
capture the same release before removing their processors. All manifestations
count once as the native release owner.

Seven initial focused regressions are causally RED at a zero declaration,
after independent reference processing of the actually installed native node
establishes audible release. Additional Mix and Render and Make stereo lane
cases are RED at 153 reserved samples instead of the authored 15,128. Twelve
new cases include independent native DSP and an authored Bézier interior Q;
with native Q, filter/project tail, serial buses, actual controller Make stereo,
Mix and Render, and track transform support they pass 93/93. Type-aware target
lint passes.
`audio-editor-round7-native-filter-tail.spec.js` is causally RED on immutable
`5c9787bec` after the normal import/rack/export flow: the WAV contains 48,000
samples instead of more than 48,128. On the corrected immutable `fef78921b`
capture the reserved length passes, but the first 128 physical release samples
still peak at only 0.0000001192 instead of above 0.1. The subsequent explicit
width correction completes that normal render flow.
PCM stays in memory; no generated verification files are retained. Assistance
runtime assets are unchanged.

The bounded diagnostic render confirms charged output −0.35319045 at frame
47,999 followed by exact zero at frame 48,000, before WAV encoding. The native
Biquad's default `max` input width narrows from stereo to mono when the source
ends, which [reinitializes the native channel histories](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webaudio/biquad_filter_handler.cc).
Pin the actual rack channel width in explicit mode so silence preserves those
histories. Six mono/stereo/surround LP/HP graph-width cases are RED before the
repair; corrected native Q/tail/actual-worker/rack support passes 40/40.
This completes the physical release owner without another count. Its unchanged
public length, audible first release samples and settled ending assertions all
pass on the root-owned immutable `e2a38ecb5` capture (4.1 seconds).

## R7-EFFECT-008 — Analyze selection loses an ordinary crescendo's ending true peak

Import a normal one-second, 48 kHz, 12 kHz mono tone with amplitude 0.5.
Select all, choose Effect → Fading → Fade In, then set Selection end to
0.750 seconds and choose Analyze → Analyze selection. The displayed sample
peak is −11.5 dBFS after the ordinary mono pan law. The unfinished meter also
reports true peak −11.5 dBTP, although that finite selection's reconstructed end
reaches −11.4 dBTP. The analyzer takes the EBU meter snapshot before the 12-tap,
four-phase true-peak interpolator has emitted its pending ending response.

Resolve that finite response on copied FIR histories when finishing offline
analysis. Keep the programme's exact frame count, RMS and loudness windows,
realtime snapshots and later live continuation. Cached finish remains
idempotent; paused live input cannot contribute to the completed programme.
Advance the persisted levels cache namespace so previous incomplete true peaks
cannot survive an ordinary app update and Analyze selection on the same clip.
This is one offline true-peak finalization root, independent of R6-EFFECT-027's
sample-peak telemetry field mapping.

Five causal focused cases fail before correction, while paused/silent guards
already pass. The fixtures use the actual Tone generator and Fade In at
supported 0.001, 0.01 and one-second durations; an independent complete finite
programme with twelve zero frames establishes the missed 0.083–0.089 dB peak.
All six new ending/history/cadence/chunk cases and existing worker, analysis,
EBU Tech 3341/3342 conformance and audit support pass 41/41. The persisted cache
case independently fails before its namespace correction; new ending, cache
and actual analysis-composition support passes 24/24. Target type-aware lint
passes. The first whole-clip browser attempt is excluded as a causal meter
witness: the existing source edge taper makes its expected −8.9 dBTP invalid,
as confirmed by bounded native render observations on `fef78921b`. Its earlier
nonexistent Apply dialog setup is also excluded; parameter-free Fade In applies
directly from its menu. The corrected witness edits the ordinary visible
Selection end format to samples and edits its digits from 48,000 through
38,000 to 36,000, retaining exact range, sample-peak and
true-peak assertions. The exact quantized WAV/Fade In/interior PCM reference
proves the unfinished meter reports −11.5304 instead of −11.4418 dBTP, and the
actual analysis worker now resolves that peak while preserving 36,000 frames.
The corrected exact interior-selection public sample-peak/true-peak workflow
passes on the root-owned immutable `e2a38ecb5` capture (2.6 seconds).
The actual worker and analysis owners from immutable `5c9787bec`, executed
directly in memory on that same quantized ordinary recording/Fade In/interior
selection, retain 36,000 frames but report sample peak and true peak both
−11.5303984047. The independently padded finite reference and corrected actual
worker both report true peak −11.4418123249. No verification files are created
and the maintained worker regression does not depend on repository history.
The first interior digit attempt is excluded setup: changing the seconds digit
to zero collapses the selection before its following millisecond digits can
publish. Sample-format edits keep a positive selection throughout.
PCM remains in memory and no verification fixture or raw coverage is created.
No AI runtime asset update is required.

The same finite-programme caller in `broadcast-loudness.ts` also completes
pending true-peak interpolation before publishing BEXT/Loudness measurements
or planning normalized export. Its actual normal crescendo regression is RED
at −6.02078 dBTP instead of −5.93218; the one-line caller correction keeps
integrated/momentary loudness unchanged. Ending/BEXT/normalized-render/export
plan support passes 35/35. This closes R7-EFFECT-008 without another count.

## R7-EFFECT-009 — A closed live Noise gate opens when its attenuation is reduced

Import a normal quiet recording with peak amplitude 0.1. Track Effects → Add
Noise gate, set Gate threshold to −6 dB, Attack to 1 ms, Release to 4 seconds,
Hold to zero and Level reduction to −80 dB. Play, then change
Level reduction to −60 dB. The recording never crosses the gate threshold,
but the accepted floor edit attacks toward unity instead of the new 0.001
closed-gate gain, briefly amplifying the output far beyond that floor.

Use the actual envelope target in the existing attack interpolation and its
completed endpoint. Preserve normal unity opening, held audio, delayed audio,
release, linked/independent detection and unchanged controls. This attack-target
root is separate from R7-EFFECT-005's live channel-state joining.

Six actual processor regressions fail before correction at the supported
−80 → −60/−24/−6 dB floor edits in both linking modes; genuine open/hold/release
and block cadence controls already pass. Corrected floor, linking, default
lookahead and physical crossover-tail support passes 24/24. Target type-aware
lint passes. The actual native running-rack control witness in
`audio-editor-round7-noise-gate-floor.spec.js` is causally RED on immutable
`e2a38ecb5` (4.2 seconds): the healthy closed output passes, then the normal
attenuation edit produces peak 0.00345497485 instead of at most 0.000102. The
accepted actual running-node update and at least four measured changed blocks
also pass. The corrected public workflow is GREEN on immutable `58264ec46`
(3.9 seconds): actual peak 0.0001000057018 remains within the 0.000102 bound,
and the healthy baseline and final unchanged node identity assertion pass.
PCM and observations remain bounded in memory, with no generated
verification files or raw coverage. Assistance runtime assets are unchanged.
The initial browser setup attempted a Lookahead field omitted by the shipped
Noise gate layout and is excluded before playback or the causal edit; the
corrected witness retains the ordinary default preview buffer.

The earlier uncounted native surround Reverb candidate is excluded. Its normal
export is deliberately refused by the existing stereo-width admission owner;
its corrected ordinary playback/front-pair control passes on immutable
`e2a38ecb5` (4.1 seconds), so the wider mocked input is not established through
that available route. Both uncounted verification specs were removed immediately
and no Reverb source or admission contract was changed.

## Zero-count filter release chunk-ownership completion

The 50-fix checkpoint's worker contract guard rejects the release-bound leaf
outside its explicitly owned effect-contract closure. Move the unchanged
normalized-IIR type and pole/release calculations into the existing
`first-party-effects/standard/filters-coefficients.ts` owner, already included
in both editor and worker contract groups and desktop staging. Import the leaf
from that exact module in standard filters, Classic Filters and native filters;
remove the redundant flat module. No release arithmetic or public behavior is
changed, and this adds no bug count. Root separately assigns the existing
Classic coefficient and compatible-live-admission leaves to their semantic
editor contract group without changing guards or chunk ceilings.

The actual worker-closure guard is RED before the move and GREEN after it.
Forty focused worker-ownership, Classic/standard/native release and native-Q
regressions pass after correction; targeted type-aware lint passes. No temporary
verification files are created. This effect-contract ownership completion does
not change the assistance runtime closure and requires no Update AI assets run.

## R7-EFFECT-010 — Plot Spectrum omits the final selection remainder

Import an ordinary one-second mono recording containing a 1500 Hz whistle near
its end, choose Select → Select all, then Analyze → Plot spectrum. The averaged
FFT visits only hop-aligned full windows; at 48000 samples and size 2048, the
last window ends at sample 47104. A tone at samples 47200–47799 is audible in
Analyze selection but entirely absent from Plot Spectrum. This differs from
R5's level calibration and R6's admission of selections shorter than one window.

Include one complete, end-aligned window when a selection has a final hop
remainder. Do not append a duplicate to aligned selections or pad extra silence.
Three focused cases are causally RED before correction, including the actual
report worker; the aligned-weighting control already passes. Corrected spectrum,
calibration and short-selection support passes 27/27. The unchanged production
capture `48b` is publicly RED (6.6 seconds): the healthy level-analysis peak
passes, then the downloaded spectrum report gives peak frequency 0 instead of
1500 Hz. Corrected public GREEN is pending the shared production build.
The bounded WAV remains in memory; failed-run diagnostics and the short log are
removed immediately after inspection. Assistance runtime assets are unchanged.

## R7-EFFECT-011 — Band dynamics truncate their complementary crossover release

Import a normal one-second stereo bass recording, add Multiband compressor in
the track Effects rack, set Low/High crossover to 40/2500 Hz, all ratios to one,
and Low/Mid gain to +12/−12 dB. Export with Include tails. The actual
complementary crossover retains audible state after the recording, but this
processor family has no release contract and Export stops at 48000 samples.
De-esser's upper-band correction uses the same independently owned crossover
state and shares this one root. This differs from native biquad release and
Classic Filters' cascaded IIR release.

Derive a conservative silent-release bound from the actual one-pole crossover
and maximum band corrections, including a negative pole near Nyquist; retain
one quiet render quantum after the −80 dB bound. Neutral and disabled controls
retain their original dry duration. Four charged actual-processor cases are
causally RED with declared release zero, while the neutral control passes.
Corrected release, native-rate, de-esser, Multiband and valid crossover support
passes 26/26. The unchanged production capture `48b` is publicly RED (7.2
seconds): healthy dry length and audible bass pass, then the configured rack's
export length is 48000 rather than greater than 48128. The subsequent physical
release assertions were not reached; corrected public GREEN is pending the
shared build. The bounded PCM stays in memory and owned failed-run diagnostics
and log are removed immediately after inspection. Assistance assets are unchanged.
