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

Zero-count Firefox observer completion: the 50-fix full-suite run delivers the
correct new maximum peak 0.00010000570182455704, but its early interval also
contains old healthy peak 0.000009999081157729961. A main-thread port timestamp
does not establish which already queued ScriptProcessor blocks have received
the edit. Keep the entire early overshoot limit and the same-node assertion;
require the final requested floor in four physically delivered recent blocks
separately. The exact corrected witness passes Firefox on unchanged prepared
capture 68 in 7.0 seconds, after a passive-observer diagnostic pass in 7.1
seconds. Its first replay is excluded before the causal edit because the healthy
pre-edit audio stayed silent. No product source or timeout changes. The inspected
original failure folder, temporary passive listeners, and all focused replay
logs and output folders were removed immediately after recording these receipts.

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

## R7-EFFECT-012 — Parametric EQ cuts off its actual matched cascade release

Import an ordinary one-second bass recording, add Parametric EQ to the track
rack, and set its first band to High cut at 10 Hz with a 12 dB/oct slope. Export
with Include tails. The actual pinned WASM TPT processor retains a 0.35355 peak
in its first silent quantum, but the EQ family declares no release. Export
therefore stops at sample 48000. This matched state-variable cascade has its
own section geometry and histories, distinct from the native biquad and
complementary-crossover families. Cut slopes and bell variants share this root.

Extract the existing matched-section arithmetic into a strict, dependency-closed
coefficient owner and reuse it in the original designer and the release
contract. Bound the entire active cascade, including output gain, through the
existing normalized-IIR envelope. Transparent bands and output-only gain retain
their dry duration. Constant authored band values also enter the bound; changing
semantic curves conservatively retain the existing ten-second rack budget to
cover their smoothing histories. Refresh the moved JavaScript source pins,
pin the extracted leaf, and add its emitted JavaScript desktop inventory entry.
Root assigns that exact leaf to the existing editor and worker contract groups.
The native source pins, fixed-memory WASM bytes and assistance closure stay unchanged.

Three actual-WASM charged cases are causally RED with declared release zero;
the neutral control already passes. Two same-root authored-automation cases are
also RED against the initial static-only correction and GREEN after completion.
The corrected actual cascade, analytic response, semantic automation and source
authority support passes 23/23; the pinned WASM reproducibility audit, generic
editor/worker closure guards and release cases pass 40/40. Target type-aware
lint passes. The unchanged production capture `48b` is publicly RED (6.6 seconds):
healthy dry length and bass pass, then the ordinary low-pass export still has
48000 samples instead of more than 48128. The later physical release assertions
were not reached; corrected public GREEN is pending the shared build.

The first public attempt used custom wrapped labels and timed out before the
Type selection. It is excluded; the corrected witness uses the observed
accessible combobox and spinbutton names. Owned setup and causal diagnostics
are inspected and removed immediately. The short combined causal log remains
with its I/O owner until that parallel failure is read. All PCM stays bounded
in memory. No manual Update AI assets run is required.

An in-memory comparison against the original designer matches all 1620 ordinary
rate/type/frequency/gain/Q/slope configurations exactly, including the same
refusals. The size guard passes. Complete strict test compilation reports no
errors in owned files; two concurrent I/O/navigation fixtures await their owners'
corrections before the shared type gate can pass.

## R7-EFFECT-013 — Audacity tone filters discard their remaining rack audio

Import a normal one-second stereo bass recording, add Bass and Treble to the
track Effects rack, set Bass to +30 dB and Output volume to −30 dB, then export
with Include tails. The charged shelf cascade retains a 0.205 peak after the
recording, but its declared release is zero. The ordinary Wahwah rack shares
that missing residual-filter contract: Depth 0, Resonance 10, Frequency offset
0 and Output gain −24 dB leave an audible low-frequency biquad release. Both
variants count as one independently owned Audacity filter family; the earlier
Classic Filters coefficient cascade and native/Parametric processors remain
separate owners.

Move the existing pure shelf coefficients unchanged into a strict contract
leaf, retain its GPL notice, and use the actual normalized poles and output
gain to reserve a conservative −80 dB release plus one quiet quantum. Fixed
Wahwah controls use their actual biquad; an active LFO conservatively retains
the existing combined ten-second rack budget because stationary poles cannot
bound its changing recurrence. Neutral/output-only shelves, Nyquist identity
transfers and disabled effects retain the original dry duration. Root assigns
the exact dependency-closed leaf to the existing editor and worker contract
groups; its emitted desktop inventory entry is maintained alongside the fix.

Four actual-processor cases are causally RED at zero declared release after
healthy audible state, while neutral and bypass controls pass. Corrected
native-rate, physical release, varying LFO, shared shelf kernels, live controls
and Classic support passes 47/47. The actual desktop compile/import and
inventory checks pass 3/3 and remove their temporary runtime immediately.
An in-memory comparison matches all 84 moved coefficient configurations
exactly. Target type-aware lint, complete size and owned diff checks pass.
Complete strict test compilation reports zero owned errors and one concurrent
caption fixture awaiting its owner's target-compatible Promise correction.

Both normal public workflows are causally RED on unchanged prepared capture
60: dry and bypassed 48000-sample audible exports pass, then enabled Include
tails still produces 48000 samples instead of more than 48128 (8.5/8.6 seconds).
Later physical-release assertions were not reached. Guarded prepared capture
68 passes both complete Chromium workflows, including the physical release,
quiet ending and restored bypass duration (7.7/8.5 seconds); all 15 shared
public cases pass, and complete source/test strict compilation is GREEN. A first 96 kHz Wahwah test used a recording outside
its rate-scaled resonant band and is excluded; the corrected fixture reaches
the causal declaration assertion. Owned public diagnostic directories are read
and removed immediately; the short shared log remains only until its other
owners finish reading. PCM stays bounded in memory. No manual Update AI assets
run is required.

## R7-EFFECT-014 — Mono ADM playback loses its live Spectrum lease

Import an ordinary mono recording, open Analyze → Analysis and Spectrum, then
play it. Stop, open Edit → Metadata editor → ADM, enable ADM, choose the Mono
bed and play again. Scalar peak meters continue to show the recording, but
Spectrum stops receiving FFT data. The master splitter now has one output;
the live-analysis lease unconditionally connects its stereo side tap to output
one. Native Web Audio throws an IndexSizeError and the entire lease is released.

Admit only the existing splitter outputs to the stereo side taps. The mono
spectrum bank remains one channel; unavailable stereo correlation and scope
remain null/empty, and stereo/surround behavior retains its existing contract.
The faithful native-output regression is causally RED for mono before the fix,
while the stereo, six-channel and 32-channel controls pass. Corrected lease,
channel-power and Spectrogram regressions pass 11/11, including reuse and full
side-tap disposal.

The strengthened ordinary Chromium witness is causally RED on unchanged
prepared capture 68 in 9.1 seconds: healthy original Spectrum performs 14 native
4096-point FFT reads, the Mono scalar meter remains audible, and the new
Spectrum read count stays at 14. Guarded prepared capture 73b99f5b8 passes the
complete corrected public workflow in 5.2 seconds. A preboot failure is excluded;
an earlier canvas-only check retained its
old drawing and was insufficient evidence. The corrected witness passively
observes actual native FFT reads as well as playback and canvas data. Owned
diagnostic directories are inspected and removed immediately. No manual
Update AI assets run is required.

## R7-EFFECT-015 — Parametric EQ spectra erase opposite microphone polarity

Import an ordinary stereo recording whose right microphone has opposite
polarity, open the track Effects rack, add Parametric EQ and play. Actual
programme peak meters remain audible, but both the Input and Output spectrum
overlays disappear. Each rack analyser receives the complete multichannel
programme and its native mono FFT downmix cancels the two signals. A quiet
second channel also reports amplitude attenuation instead of average energy.

Build per-channel Input and Output side taps from the rack's declared width,
then average FFT-bin power before converting back to decibels. Programme audio
connects directly to its existing worklet, with its channels preserved. Keep
the single-channel and legacy analyser-entry reader contracts, metadata and
buffer refusal behavior. Extract the focused spectrum owner into the existing
engine directory; that semantic chunk already admits it and it introduces no
desktop/assistance runtime dependency.

The actual rack graph and reader are causally RED in three ordinary stereo/
surround configurations after healthy mono/matching controls. Corrected
channel-power, silent-channel, full-width, rack-worklet, preview and spectrum
projection controls pass 30/30. Target type-aware lint, changed lint, size and
diff checks pass. Complete strict source/test compilation is GREEN after the
concurrent recording timestamp fixture's owner corrected its narrowing.
The independent ordinary Chromium baseline on
unchanged prepared capture 68 passes matching microphone polarity in 5.2
seconds; opposite polarity is causally RED in 9.0 seconds after a healthy
actual master peak, with the Input spectrum empty (alpha position 1 instead of
less than 0.35). Output has the same independently observed graph construction
and shares this one root. Guarded prepared capture 73b99f5b8 passes both complete
matching and opposite-polarity public workflows in 8.9/8.3 seconds.
The bounded failure trace is read and its short log removed immediately; the
owned diagnostic folder had already been replaced by the next shared run.
No manual Update AI assets run is required.

## R7-EFFECT-016 — Sound Visualizer understates ordinary high recorded tones

Import an ordinary two-second mono recording whose 468.75 Hz and 14062.5 Hz
sections have equal amplitude. In Framescaper, Generate → Video Generators →
Add Sound Visualizer, then Effect → Video Finishing → Selected Visual Inspector.
Choose Spectrum, select that audio source and Apply. Seek into each section.
At the default 1280-pixel canvas, the high-frequency peak appears 6 dB below
the low reference. The actual calibrated FFT contains its complete peak, but
the generated raster takes one rounded bin per logarithmic pixel and skips
the central high-frequency bin. At an ordinary 720-pixel canvas another tone
almost disappears. This generated native raster has an independent projection
owner from the earlier Plot Spectrum and Parametric EQ graph repairs.

Preserve the strongest averaged bin power across each pixel's complete
half-pixel logarithmic frequency interval. Keep the FFT, time averaging,
source clock, colors, marker and waveform rendering contracts.
The actual renderer is causally RED in four normal canvas/frequency cases,
after the low reference and every independent FFT amplitude control pass.
Corrected rendering, packed-window, selected-preview and materializer controls
pass 21/21. Target type-aware lint, changed lint, size and owned diff checks
pass. Complete strict test compilation is GREEN with an explicit 8 GiB heap;
the first default-heap run exhausted 4 GiB before diagnostics and is excluded
as an environment failure. No compiler diagnostics or local dump files remain.

The normal menu workflow is causally RED on unchanged guarded prepared capture
73b99f5b8 in 18.4 seconds. It verifies equal recorded RMS, a healthy low-tone
peak and complete new native raster delivery at the high-tone seek, with the
preview ready and no pending/error state. Its passively observed actual
putImageData peak is at row 0.0722222222 instead of less than 0.03. Native calls
and argument types remain intact; no editor state or internal action is
installed. Corrected guarded capture b04e692b7 passes the complete public workflow
in 8.2 seconds, including the healthy reference and actual high-tone projection.
Owned
failure context and bounded logs are read and removed immediately; recording
PCM stays in memory. No manual Update AI assets run is required.

### Excluded visualizer pitch candidate — no bug or production change

The window reader does not consume independent clip pitch, but the published
Framescaper Clip properties intentionally omits Pitch and tempo when its audio
effects capability is unavailable. An ordinary Soundscaper project opens as
an opaque read-only foreign document and has no Framescaper visual preview.
The attempted menu witness passes the original visualizer frequency control
and then cannot author pitch; it is an excluded setup failure. Remove that
verification spec and its diagnostics immediately. No internal model state or
altered project archive supplies qualification.

## R7-EFFECT-017 — Include tails truncates ordinary Phaser feedback

Import an ordinary one-second stereo bass recording, add Phaser through the
track Effects menu and set Depth to 0, Feedback to 100%, Dry/wet to 255 and
Output gain to −30 dB. Export with Include tails. Dry and normally bypassed
exports contain their healthy 48,000 source frames; enabling the effect still
exports only those frames, cutting an audible feedback release. Even when
zero-depth all-pass stages cancel to identity, the independent feedback loop
delays one sample. Its live release contract declares zero frames. This
delayed feedback owner is distinct from FX013's shelf and Wahwah filter poles;
all Phaser depth, modulation, feedback and stage variants share this one root.

Bound the stationary feedback pole and accumulated wet gain, leaving a quiet
render quantum. Modulated all-pass state retains the existing ten-second rack
budget. Dry-only, bypassed and neutral processing retain the original duration;
the audio processor and supported parameter limits remain unchanged.

Focused physical DSP is causally RED at both 8 kHz mono and 48 kHz stereo,
after actual healthy audio and audible post-source state are demonstrated.
The independent delayed recurrence agrees at negative, zero and positive
feedback. Corrected physical endings, supported stage/depth/gain variants,
adjacent filter and live-control tests and chunk ownership pass 61/61. Target
type-aware lint, changed lint, size and owned diff checks pass.

The ordinary menu/export witness is causally RED on guarded capture b04e692b7
in 8.3 seconds: 48,000 exported frames instead of more than 48,128, after dry
and bypass controls pass. Guarded wave82, captured from a21e21974 plus this
unchanged release helper, passes the same complete workflow in 10.8 seconds.
Its actual exported PCM contains audible release and a quiet ending. All
owned failure diagnostics and bounded logs are read and removed immediately;
recording PCM remains in memory. No manual Update AI assets run is required.

### Excluded native-rate visualizer interpolation — no additional root

An ordinary 44.1 kHz recording's 18 kHz tone projects below the matching 48 kHz
reference in Sound Visualizer. The first menu witness reaches that actual
native raster after equal recorded RMS and healthy low-tone controls. Its
linear PCM window contains a 0.27944 primary amplitude instead of 0.5, plus
an interpolation image. However, the independent native OfflineAudioContext
delivery control also changes the recording's RMS from 0.35355 to 0.21999.
The evidence therefore does not establish a visualizer defect distinct from
the browser's own sample-rate conversion approximation. Exclude the candidate,
remove its verification spec, logs and diagnostics immediately, and retain
the existing production reader without any source change or extra count.

## R7-EFFECT-018 — Noise Reduction truncates its spectral release

Import an ordinary one-second 48 kHz mono 1 kHz recording, Select all, open
its track rack and add Noise Reduction. Capture the normal noise profile,
set Reduction to 24 dB and Frequency smoothing to three bands, then export
with Include tails. The downloaded file stops at 48,000 frames even though
the actual spectral processor emits an audible release after the source fade.

Nonuniform frequency gains spread that ending across the overlap/add window.
The rack declares no release, so its buffered latency cannot reserve those
post-source samples. Declare the bounded 2,047-frame window release whenever
reduction is positive. Zero reduction and disabled effects retain their
original duration; destructive selection processing keeps its existing extent.
Reduce and residue modes share this one spectral owner, independently of the
earlier recursive filter and Phaser feedback release roots.

Strict real-processor regressions fail twice solely at the zero-frame tail
declaration after verifying audible source audio, release above 0.01, and an
exactly silent ending beyond one window. The zero-reduction and bypass control
passes. All 49 new and adjacent live, filter and feedback cases pass after
correction. Targeted type-aware lint and owned diff checks pass.

The ordinary menu/profile/export witness is causally RED on guarded capture
24cbd04c0 in 7.2 seconds: actual 48,000 versus more than 48,128 frames after
healthy dry and zero-reduction exports. The initial healthy amplitude assertion
omitted the ordinary mono pan law and is excluded as a fixture error. Corrected
complete public verification passes on authenticated capture 678a672d0 in
8.2 seconds, including audible release, a quiet ending and normal bypass.
Owned logs
and diagnostics are read and removed immediately; PCM remains in memory.
No manual Update AI assets run is required.

### Existing effects replay — no additional roots

The checkpoint-100 older native 24 kHz noise-profile workflow completes its
disabled incompatible-profile control and fresh 48 kHz profile capture, then
expects the previously truncated 38,400-frame enabled export. The corrected
physical FFT release makes that file 40,447 frames. Keep the initial 38,400-frame
disabled-profile assertion, update only the final expected extent, and require
an audible first 128 release frames plus a quiet final 128 frames. The complete
workflow passes Chromium on authenticated 8fba4b346 in 8.1 seconds, 1/1 in 9.8
seconds total. Its old completed diagnostic and bounded replay output are read
and removed immediately. This fixture follow-through adds no root or source
change.

The same unchanged corrected native-profile workflow passes Firefox on
authenticated prepared 1fb50c54d in 10.1 seconds, 1/1 in 12.4 seconds total,
using the qualified local audio server. Its disabled-profile extent, fresh
capture, audible release and quiet ending all pass. The completed bounded
replay log and owned diagnostics are read and removed immediately. This
resolves the identical checkpoint-100 Firefox stale-length failure without
another source change or bug count.

The two ordinary Framescaper finishing exports now contain the already verified
3,385-frame release of the default 80 Hz native high-pass. All six original
browser failures expected the old truncated length. Update only their exact
duration fixtures and additionally verify the actual final 128 PCM frames are
quiet. Preserve the automation, routing, frequency response, loudness,
persistence and reload assertions. Both finishing cases pass in WebKit
(14.0/13.1 seconds), Chromium (9.3/10.6 seconds) and Firefox (10.5/11.3 seconds).
The last replay overlaps the root's guarded Framescaper refresh from 24cbd04c0
to 54016848b; this zero-count fixture verification does not claim immutable
baseline bytes or prove a new source defect.

Unchanged WebKit Compressor, stereo mixer and both Parametric EQ raster cases
pass their complete focused workflows. The already corrected gate-floor
observer passes with actual recent peak 0.0001000057. Unchanged Chromium
Nyquist, both EQ raster cases and touch ownership pass; Firefox Nyquist cases
also pass. The two current Firefox EQ attempts stop before their healthy
native FFT assertion, with no observed FFT value and transport still stopped.
Independent Firefox clock diagnostics subsequently identify an inherited
nonadvancing PulseAudio server, so these healthy-control attempts remain
environment failures and do not demonstrate the target raster defect.
With the qualified CI null sink, both unchanged Firefox EQ cases pass on
authenticated capture db368adda in 7.5 seconds each (17.4 seconds total).
Their actual 48 kHz, 4,096-point FFT controls read bins 1,667 and 1,682 at
−19.83 and −20.49 dB; the original raster assertions also pass. Their
diagnostics are read and removed immediately. Original startup failures and the post-export
Nyquist Close timeout likewise do not establish additional effects roots.
Owned focused replay logs and artifacts are removed immediately. These
browser fixtures change no runtime closure and require no Update AI assets.

## R7-EFFECT-019 — Dialogue Chain omits native compressor delay

Import an ordinary 250 Hz mono recording in Framescaper, select its audio
track and choose Window → Dialogue Chain → Apply dialogue chain. The downloaded
WAV reverses the recording's phase, disrupting alignment with parallel material.
The recipe's native compressor owns a fixed six-millisecond pre-delay, while
the shared rack compensation declares zero for that processor. Its adjacent
limiter preview is already compensated. This native Web Audio owner is distinct
from earlier Audacity lookahead dispatch and live-control defects.

Declare the native pre-delay using the exact 3/500-second timebase, truncating
to its physical whole sample and preserving the native 1,024-frame ring bound.
Register that exact enclosing-start conversion. Independent actual impulse
controls in Chromium, Firefox and WebKit agree: 48 frames at 8 kHz, 264 at
44.1 kHz, 288 at 48 kHz, 576 at 96 kHz and 1,023 at 192 kHz. Their bounded
recordings remain in memory. The fixed pre-delay is described by the
[Web Audio specification](https://www.w3.org/TR/webaudio-1.0/#DynamicsCompressorNode).

The normal recipe's focused compensation cases fail three times before the
fix, while its bypass control passes. Corrected clock, bypass and existing
native graph, meters, sidechain, limiter, live-analysis and time-policy cases
pass 57/57. The ordinary menu/export witness is causally RED on authenticated
678a672d0 in 6.4 seconds after native impulse, filter-response and dry-delivery
controls pass: expected phase 0.46700394, actual −2.67458667, alignment cosine
−0.999999999998 instead of more than 0.98. Corrected complete public verification
passes on authenticated db368adda in 10.0 seconds (11.9 seconds total): all five
native clock controls pass, the delivered phase 0.46700464 agrees with the
independent filter response 0.46700394, and exporting a second parallel
recording preserves their independently calculated complex sum. Own diagnostics and logs are read and
removed immediately. No manual Update AI assets run is required.

An optional Undo control in earlier setup correctly removed all five effects
from persistent state, but its delivered magnitude changed from 0.00706899 to
0.000410541. Those attempts never reached the phase assertion and are excluded
from this causal proof. A passive follow-up proves that the broad header-center
click itself changes Volume from 1 to 0.0580764417521 before the Chain opens,
accounting for exactly that attenuation. Undo of the fader edit restores 1.
Selecting the blank header corner preserves gain; twice-dry export magnitudes
0.00706899000 and 0.00706898992 then agree with Chain Undo 0.00706898950, with
identical persisted tracks, clips, mixer and unchanged raw PCM. Loudness remains
None throughout. The complete ordinary control passes on db368adda in 11.4
seconds; its temporary probe, spec, log and diagnostics are immediately removed.
The permanent phase witness now selects that blank corner. An initial blank Firefox probe filled its AudioBuffer after assigning
it to the source and produced silence; filling before assignment on the
qualified audio server restores the independent physical control. Neither
verification issue contributes another bug count.

### Full-suite verification follow-through — no additional roots

The post-fixture full Node gate identified six stale round-four averaged
Spectrum signatures. These are exactly the 32-, 256- and 2048-point full
selection and half-sample-offset averages whose final remainder window FX010
now includes. Refresh only those six signatures; all 160 other signatures,
including PCM, routing, snapshots and painted geometry, remain byte-identical.
The independent final-tone worker and calibrated amplitude assertions remain
in the focused gate.

The same gate also rejected FX011's raw seconds-to-sample release arithmetic.
Use the shared secondsToSampleFrame helper with the enclosingEnd policy and
register that exact physical crossover boundary in the existing conversion
audit. A focused intermediate audit confirms that the new consumer requires
classification; the corrected audit, chunk ownership, physical release,
Spectrum calibration and frozen parity controls pass 57/57. Target lint,
changed lint, size and owned diff checks pass. These repairs add zero bugs;
bounded verification logs are removed immediately after recording the result.


The next full Node run finds four timing expectations predating FX019's
independently measured native compressor delay. Keep the 80 ms source-start
reservation and add its 6 ms audible delay for an empty metered graph. At 2x
speed, preserve source offsets and count the 288 context-frame pre-delay as
576 project frames; after Seek the newly scheduled graph has its own pre-delay.
At unity speed retain the original heard-position and Pause assertions after
advancing that exact delay. The limiter-before-master-compressor parameter
fixture retains upstream 480-frame bindings and declares the resulting
768-frame master output. These four fixture corrections and all their source,
transport, scheduling, offline PCM and five-clock controls pass 43/43. They add
zero roots and change no production bytes. The bounded log is read and removed.

## R7-EFFECT-020 — Another finger cancels accepted EQ authoring

Import normal audio, Select all, then Effect → EQ and filters → Graphic EQ
or Filter Curve EQ. Drag a fader or curve point with one finger, briefly touch
the graph with another finger and lift that second finger. Both editors ignore
its down/move events but accept its bubbling lost-capture and cancellation
without checking the active pointer identity. The first finger's accepted edit
resets to its snapshot and cannot complete. Group these two editor manifestations
as one cancellation root; previous Parametric EQ admission fixes belong to its
separate graph owner.

Fence both cancellation handlers by the pointer already owning the edit.
Retain first-finger completion, its own cancellation, Escape, final-coordinate
commit and deferred draft publication. Four strict mounted regressions fail
before correction while four own-cancel controls pass; after correction those
and existing drafts, keyboard, deletion focus, axis and inversion controls pass
19/19. Ordinary native multi-touch witnesses are causally RED on the prepared
db368adda products in 7.2 seconds each: healthy single-finger 6 dB edits pass,
then releasing the ignored second finger resets the accepted Graphic 10 dB and
Curve 9 dB previews to zero. The protocol identifies the finger actually lifted
with touchEnd[secondary]. Corrected complete native public verification passes both unchanged cases on
authenticated 04e87c277 in 2.3 seconds each, 2/2 in 6.3 seconds total. Healthy
solo edits, retained previews, final 15 dB completion and the untouched secondary
band all pass. Its bounded success log and generated output are immediately
removed. Target ESLint, changed lint, size and owned diff checks pass.
All bounded failure logs and generated diagnostics are read and removed
immediately. This UI correction uses the same runtime closure; no manual
Update AI assets run is required.

## R7-EFFECT-021 — Finite loudness reports omit their final measured maximum

Import a normal 450 ms tone, Select all, Effect → Fading → Fade In, then
Analyze → Analyze selection → Export. The actual rendered momentary loudness
in the downloaded JSON is -13.3621953594 LUFS, while its advertised maximum is
only -14.8628056506 LUFS. A matching 400 ms workflow passes. The finite EBU
report reads the final complete sliding window but only retains maxima from
the preceding 10 Hz live update; a final short-term window has the same defect.
Group momentary and short-term extrema as this one publication owner, separate
from FX008's reconstructed true-peak FIR ending.

Include the current complete programme windows in an explicitly finite
loudness snapshot. Preserve live update history, paused measurements, sample
clock, true-peak completion and the established integrated/LRA gating grids.
[EBU Tech 3341 (2023)](https://tech.ebu.ch/docs/tech/tech3341.pdf), sections
2.1–2.3, specifies maximum M/S and their sliding
windows separately from incomplete integrated gating blocks. Advance the levels
cache namespace so existing persisted reports are recomputed.

The ordinary guarded 04e87c277 public baseline passes its healthy 400 ms control
in 3.3 seconds and fails causally at the downloaded 450 ms maximum in 3.2
seconds, after the rendered momentary and 21600-frame controls pass. Three
initial finite-analysis/BEXT focused cases are RED; chunking, complete-block
and silence controls already pass. All 30 new/existing EBU, analysis ending and
BEXT cases pass after correction, including current-window maxima, exact
integrated/LRA preservation, standby and continued live measurement. The
persisted-cache regression is independently RED before namespace correction;
corrected cache and repeated analyzer controls pass 15/15. Corrected complete
public verification passes both unchanged 400/450 ms workflows on authenticated
8fba4b346 in 2.9 seconds each, 2/2 in 7.4 seconds total; rendered loudness,
sample clocks and downloaded maxima all pass. Target ESLint, changed
lint, size and owned diff checks pass. All bounded verification
logs and generated diagnostics are read and removed immediately. This uses the
same runtime closure; no manual Update AI assets run is required.

## R7-EFFECT-022 — Preserved multichannel strips accept inaudible Pan edits

Import ordinary stereo and four-channel recordings. Use the track header Pan
control, or Window → Mixer and its Pan knob. Stereo Pan 100 correctly silences
the exported left channel. Four-channel Pan also accepts 100, yet the exported
audio is unchanged: the production graph deliberately suspends stereo Pan to
preserve the recording's channels. The visible controls do not reflect that
existing capability. Header, Mixer, shortcuts and automation share one strip
admission owner; preserved ADM and wide bus/master manifestations count once.

Share the existing native graph capability through the terminal channel-width
owner. Disable only unavailable Pan controls, refuse their static gestures and
Pan shortcuts, and mark the corresponding automation target unavailable. Keep
stereo/mono Pan, the foundation graph, all gains and audibility controls intact.
The graph uses the same pure capability without changing channel processing.

On authenticated 8fba4b346 the normal header and Mixer workflows each fail
causally in 13.3 seconds, after stereo PCM, four-channel audibility and unchanged
post-edit PCM controls pass. Both actual controls retain an enabled Pan 100.
Earlier attempts targeted the empty initial track or omitted the native-save
picker fallback; those incomplete export setups are excluded. Four strict
mounted/action cases are initially RED while four stereo controls pass. The
corrected new and existing strip gestures, Pan shortcuts, automation, native
graph, mono routing and vendor controls pass 49/49, including ADM and declared
wide bus/master capability controls. Corrected complete public verification
passes both unchanged workflows on authenticated dc8bba540: header 8.7 seconds
and Mixer 8.4 seconds, 2/2 in 19.0 seconds total. Healthy stereo Pan, actual
four-channel PCM preservation, disabled controls and unchanged Pan values all
pass. Target ESLint, changed lint, size and owned
diff checks pass. Bounded logs and generated diagnostics are read and removed
immediately. This uses the same runtime closure; no manual Update AI assets run
is required.

## R7-EFFECT-023 — Hosted stacks promise unsupported copy and macro actions

Through Effect → Audio Plugins, instantiate an ordinary installed native gain
plug-in on a recording. Open its track Effects panel → Effect stack options →
Copy effects → Paste effects: the panel reports “Unsupported audio effect:
native-plugin.” Export as macro likewise reports “Unsupported macro effect:
native-plugin.” Individual native Copy effect is already deliberately omitted,
but the independent stack menu promises both unsupported operations. Group
these stack admission manifestations as one root.

Extract the existing stack menu into a focused typed UI owner. Disable copying
when a stack contains a hosted instance, including a disabled instance which
would still be copied. Admit macro export only when every enabled portable
entry has a supported macro representation. Retain normal stack Paste,
unavailable-effect metadata, disabled native omissions from supported macros,
ordinary effect identity cloning and all existing native host behavior.

Authenticated 4fc2a8437 reproduces both causal public failures after healthy
ordinary stack Copy/Paste and exact native-writer UTF-8 macro controls pass.
The final Copy failure takes 9.8 seconds, with its preceding unsupported-type
alert observed; both unavailable actions remain aria-enabled. The initial
ambiguous Close locator and incomplete desktop save fixture are excluded setup
failures; the retained fixture supplies the real desktop streaming write
contract before boot, without application-state injection. Three focused
mounted cases are initially RED while two supported controls pass. Corrected
mounted menus, exact disabled-native macro content, existing stack identity,
gesture lifecycle and macro round-trip support pass 35/35. Targeted type-aware
ESLint, size and owned diff checks pass. Shared changed lint reports only the
unrelated newly added native-original-import fixture outside its TypeScript
project; its owner receives that exact diagnostic. The new menu keeps the
existing effect-dialog shell ownership, covered by 28 existing closure checks.
On guarded capture 9548d9a3ab267fda6f9aa6bccb493d07ecac01e7, the same complete
Chromium public cases pass: Copy/Paste in 4.5 seconds and native-writer Macro in
3.5 seconds, 2/2 in 9.6 seconds. The complete corrected test/tooling compiler and
repository lint pass. All bounded verification logs and generated diagnostics
are read and removed immediately. This uses the same runtime closure; no manual
Update AI assets run is required.

## R7-EFFECT-024 — Repair advertises ranges beyond its supported processor limit

Import an ordinary recording containing a click, mark a 64-sample damaged
range, and use Effect → Noise removal and repair → Repair. This succeeds. Undo,
extend the selection to 129 samples, and choose the still-enabled Repair:
the application displays “Unknown error” with the processor's existing
128-sample refusal. The menu admits arbitrary positive ranges despite the
effect's deliberately short-selection contract.

Share Repair's existing 128-sample limit through its definition and apply it
to the actual targets used by the menu. Preserve time-range precedence,
independently selected short clips separated by a long gap, non-audio omissions,
clip-authored spectral targets, source-editor sample coordinates, and all
other effects. Publish a current source frame count through a reader registered
only after effects composition loads, so ordinary startup does not initialize
the lazy effects owner or retain a stale copy of source selection geometry.

The complete unchanged ordinary workflow is causal RED on authenticated
56c2efd1ae48301f16c580ad99a62ec7d78fe5a6 in 12.7 seconds: the 64-sample success,
Undo, 129-sample selection and exact rendered refusal all pass before Repair
remains aria-enabled. The initial digit-entry setup failure and incorrect
status observer are excluded; the corrected observer uses the actual alert.
Five focused menu cases are initially RED while three supported controls pass.
The corrected menu, source targeting, owned state, detached snapshot, existing
Repair DSP and chunk ownership support pass 57/57 in 2.177 seconds. Targeted
type-aware lint, changed lint, size and owned diff checks pass. On authenticated
32eb4cebf5615659c4e65630a61fb14464cff4c1, the unchanged complete Chromium workflow
passes in 13.7 seconds (1/1 in 19.3 seconds), including supported 64-sample
Apply/Undo, disabled 129-sample Repair, and successful exact 128-sample Repair
without an alert. This root is fully qualified. All owned bounded logs and generated diagnostics are read and
removed immediately. This uses the same assistance runtime closure; no manual
Update AI assets run is required.

## R7-EFFECT-025 — Blender refuses ordinarily delayed audio stems

Import a one-second stereo recording in Soundscaper desktop and choose File →
Export other → Export track list for Blender. The healthy dry publication
completes with a 48,000-frame WAV. Add Feedback delay to the recording's rack,
set Time to one second, Feedback to zero and Mix to one, then repeat the same
export. The application reports that the rendered stem does not match its
published audio duration or format and aborts the publication.

The Blender publication owner advertises the base timeline plus its release,
but requests that extended timeline range with `includeTail: false`. The real
renderer clamps source ranges to the timeline and independently appends only
requested release samples, so its WAV is shorter than the advertised duration.
Pass the base range and exact release duration separately, keeping the strict
WAV geometry refusal and atomic publication. Estimate each release from the
actual detached stem projection; retaining muted or unsoloed stem audio while
publishing mute separately completes FX004's existing mute-tail contract and
adds no second root. Authored muted buses remain silent, and no detached source
snapshots are retained for the entire stem batch.

The real desktop menu workflow on authenticated
32eb4cebf5615659c4e65630a61fb14464cff4c1 passes dry publication before causally
failing at the exact rendered-duration alert in 15.3 seconds. Two earlier
attempts without that healthy publication are excluded. The strict production
renderer regression has one dry pass and three failures before correction:
the independent unmuted range refusal and the existing muted/unsoloed release
omission. Corrected dry, audible delayed, muted, unsoloed and authored muted-bus
cases, existing publication identity/WAV/capacity/abort controls, live-sync
authority, FX004 audibility, time-conversion and chunk ownership pass 62/62 in
16.469 seconds. Targeted type-aware lint, canonical changed lint and owned diff
checks pass. The complete unchanged Chromium workflow passes on authenticated
3b510658ddb254144c98e401603f23f5ba875aaf in 5.8 seconds, 1/1 in 8.1 seconds:
dry WAV has 48,000 frames, delayed WAV has 96,000 frames with audible release,
and the muted stem retains the same physical PCM while publishing mute
separately. This independent Blender range root is fully qualified. Bounded
owned logs and generated diagnostics are read and removed immediately. The
assistance runtime closure is unchanged; no manual Update AI assets is required.

The next complete compiler identifies an incomplete strict fixture boundary:
its broad persisted clip union allows optional sample coordinates. Resolve the
fixture through the actual canonical runtime projection before publication,
retain its proven audio track selection and remove the engine-load assertion
cast. No production API or behavior changes. Physical range/release, original
publication and generic chunk-ownership controls pass 38/38 in 1.164 seconds;
targeted type-aware lint and the owned diff check pass. This adds zero roots.

### Repair reference matrix — no additional root

The helper-120 full Node run reproduces a stale menu-reference expectation:
its three reference cases produce two passes and one failure because none
of the rich menu fixtures contains a supported Repair target. Add a separate
128-sample time selection for each product while retaining all existing broad,
spectral, frozen and visual fixtures. This preserves the supplemental live-leaf
and handbook/parity checks without changing the effect contract or metadata.
The corrected reference and Repair admission controls pass 11/11 in 5.974
seconds. Targeted type-aware lint and the owned diff check pass. No production
source changes, additional bug count or manual Update AI assets run is required.

### Existing native host finishing observers — no additional root

Frozen checkpoint 100's Firefox drag-through-host-reply case captures host
value 1 from its preceding healthy keyboard write because the finishing poll
only asks for a value above 0.75. The accepted drag is still queued; the visible
control subsequently reaches 0.841397849462366 and fails the stale expected 1.
The unchanged frozen replay on ee53e112619b862826b7466dc422b3c6760bba27 repeats
that observer failure in 10.5 seconds. Capture the actual visible value accepted
at pointer release and wait for exact host equality, retaining healthy keyboard,
final position, Close, Escape and visible-state controls. This changes no
production behavior or bug count.

The full run's Store state case fails its absolute persisted-count expectation
(3 rather than 12), while displaying the completed drag. Its whole unchanged
frozen replay passes in 6.1 seconds on the same authenticated source, using the
qualified Pulse sink. The Store state fixture and its actual Restore oracle
remain unchanged. Both finished full-run diagnostic directories and the bounded
frozen replay artifacts are read and removed immediately.

On unchanged prepared 56c2efd1a, the strengthened Firefox drag observer passes
all three completion paths: host reply 15.6 seconds, Close 15.3 seconds and
Escape 14.7 seconds, with exact final host value 0.841397849462366. Its targeted
lint passes. The accompanying unchanged Store state case fails before its drag
at another absolute count (2 rather than 9, 16.2 seconds); retain that failure
honestly. The renderer bridge independently registers native state quiescence
with the same persistence path, so the raw counter includes automatic captures
as well as button presses. No Store state oracle or product source is changed
in this follow-through. Current replay logs and diagnostics are read and removed
immediately.

## R7-EFFECT-026 — Sound Visualizer erases audible multichannel spectrum energy

Import an ordinary four-channel recording in Framescaper, verify its healthy
audio through File → Export video, then Generate → Video Generators → Add
Sound Visualizer. In Effect → Video Finishing → Selected Visual Inspector,
choose Spectrum and the recording, apply, and seek inside the recording.
Matching-polarity channels produce the expected peak; alternating-polarity
channels retain the same audible exported audio but produce a much smaller
visual peak. The PCM window owner averages signed samples above two channels
before analysis, discarding energy through cancellation. This is independent
of FX016's pixel-bin projection, FX015's live EQ tap and the earlier live
analysis channel-power owner.

Retain all admitted source channels in the bounded packed FFT window so the
existing analyzer combines independent channel power. Preserve the authored
surround waveform mean, source layout admission, PCM cache ceilings, clipping,
warps, fades, cancellation and timeline/window geometry. All wide-channel
Spectrum variants count once under this owner; no waveform behavior changes.

On authenticated 3b510658ddb254144c98e401603f23f5ba875aaf, the complete
Chromium matching-polarity control passes in 24.6 seconds, while the opposite
polarity case causally fails in 25.3 seconds at a completed fresh raster:
first peak row is 0.1430556 rather than below 0.03, versus the matching row
0.0111111. Both actual exported stereo WAVs contain 48,000 frames at 48 kHz
and channel RMS approximately 0.35355 and 0.35347. An earlier attempt reaching
the overall deadline during the finishing observer is excluded. The strict
reference first has three failures and two healthy passes: four- and
32-channel cancellation, and six-channel amplitude dilution. Corrected
channel-power, retained waveform and existing PCM/cache/warp/fade/raster and
chunk-ownership controls pass 70/70 in 6.343 seconds. Targeted type-aware lint,
canonical changed lint and the owned diff check pass. On authenticated
bf42180222a87f589dd41ce62b6fb8b8dba90bd7, both complete unchanged Chromium
workflows pass: matching polarity in 10.1 seconds and opposite polarity in
9.9 seconds, 2/2 in 22.4 seconds. Both retain the actual exported PCM controls
and require a newly painted correct native spectrum. Owned causal and
corrected logs and diagnostics are read and removed immediately. The
assistance runtime closure is unchanged; no manual Update AI assets run is
required.

After confirming that explicit Store state alone enables Restore and advances
the dialog generation, its zero-count finishing witness now waits for that
initial Restore authority and the corresponding real parameter-get refresh.
The delayed second Store likewise waits for its new control refresh, then
requires the exact pointer-release value in both the host and visible control.
Reset must reach 0.25 and Restore must return that same exact accepted value.
On unchanged authenticated 32eb4cebf5615659c4e65630a61fb14464cff4c1 the complete
strengthened Store workflow passes Chromium in 4.9 seconds and Firefox in
7.5 seconds, 2/2 in 16.4 seconds. This removes the unrelated automatic-capture
count assumption while preserving the actual saved-body and queue barrier
oracle. Targeted lint and the owned diff check pass. No production source or helper is changed; all bounded artifacts are
read and removed immediately.

### Frozen checkpoint 100 DSP workflow replay — no additional root

The full frozen Firefox run reaches its 30-second overall deadline at the
Dialogue Chain's final export menu and the spectrum visualizer's final seek.
Unchanged focused replays initially time out at earlier ordinary interactions;
neither establishes a failed physical DSP oracle. A temporary passive timing
copy of the original compressor workflow passes every original assertion in
21.6 seconds under that same deadline: native rate/latency probes finish at
4.164 seconds, dry export at 9.877, wet export at 14.854 and coherent parallel
export at 20.332. The temporary source and configuration are removed immediately.

The final whole unchanged original specs then pass Firefox on authenticated
ee53e112619b862826b7466dc422b3c6760bba27 with the qualified Pulse sink:
Dialogue Chain 16.4 seconds and spectrum projection 14.0 seconds, 2/2 in
33.5 seconds. All physical phase, native latency, coherent parallel mix,
equal-level raster and exact seek assertions and deadlines are retained.
This changes no fixture, production source or bug count. Finished full-run
diagnostics and every bounded owned replay log/result are read and removed
immediately.

The frozen full run's WebKit preset-skin case reports unchanged dialog x=310
instead of its expected dragged x=510. Its complete unchanged focused replay
on the same ee53e112619b862826b7466dc422b3c6760bba27 passes in 8.2 seconds,
1/1 in 10.7 seconds, retaining the drag, both menus, inherited RTL direction,
skin colors, font, border radius, prompt, advanced controls, Close and absence
of client errors under the original deadlines. No source, fixture or count
changes. The exact finished full-run diagnostic and owned replay artifacts
are read and immediately removed.

The shared strict compiler also identifies the Blender render callback's
minimal interface erasing the data-record index signature at the engine
boundary. The fixture now infers data records from shallow copies of the
actual detached project and its actual clip records, retaining all runtime
fields and sample coordinates without a cast or production API change. The
complete dry/delay/mute/solo/bus publication controls pass 10/10 in 1.019
seconds; this adds no root and produces no verification files.

## R7-EFFECT-027 — Timeline effects reject a normal surround recording

Soundscaper: import an ordinary four-channel WAV, export the original, select
its timeline header and choose Effect → Special → Invert. The audible
48,000-frame original exports successfully, but the offered effect reports
“An Audacity selection must contain one or two channels.” The complete stereo
control passes, including inverted export and Undo/Redo. This timeline
capture/result owner is independent of R5-ROOT-012's Source waveform result
admission: native timeline width resolution, private render output and timeline
result saving each still impose a stereo boundary.

Resolve the widest overlapping native source within the existing 1–32 channel
format. Give only the detached pre-master capture enough output channels and
retain every native channel when copying and saving its result. Preserve the
authored programme layout, strip settings and existing mono/stereo semantics;
refuse a render missing native channels and results beyond the format bound.
All timeline effects, clip/range targeting and native-width variants share
this one root.

The complete public baseline on authenticated
bf42180222a87f589dd41ce62b6fb8b8dba90bd7 passes stereo in 9.1 seconds and fails
causally for four channels in 8.9 seconds after the actual original audio
control. The actual-controller reference first fails seven cases while four
mono/stereo clip/range controls pass. Corrected four-, six- and 32-channel
cases retain distinct per-channel saved PCM, private engine routing, dry gain,
authored programme/strip settings and complete Undo/Redo. These cases plus
existing selection/audio/result persistence, source effects, spectral effects,
worker/chain and chunk ownership controls pass 130/130 in 4.565 seconds.
Targeted type-aware lint, canonical changed lint and the owned diff check pass. Earlier range fixture
attempts incorrectly looked for the replaced clip's old ID and are excluded;
the retained fixture follows the actual track's new clip identity.
The shared strict compiler requires the fixture to narrow its broad snapshot
at the native boundary: validate the actual product project and require its
audio track and audio clip before accessing their owned fields. The corrected
fixture retains every PCM/history assertion and passes 11/11 in 1.852 seconds
with targeted lint; this changes no production API.

Corrected public verification is pending the next guarded product capture;
027 is not counted as fully qualified yet. Owned baseline logs and diagnostics
are read and removed immediately. The assistance runtime closure is unchanged;
no manual Update AI assets run is required.

FX027 same-owner closure before its corrected public capture: normal Tools → Macros palette → New program → `await sound.effect('audacity-invert');` and the track Noise Reduction → Get noise profile control share the timeline selection width authority. On unchanged authenticated `85fca21e6bb56256161a966f864bf8bbd611486a`, the complete stereo macro and profile/export controls passed in 6.1 s and 6.3 s. Both ordinary four-channel imports had a healthy audible 48,000-frame dry WAV; macro then published `data-outcome=failed` and the real selection-required alert (14.3 s), while Get noise profile failed to publish Replace noise profile (14.2 s). The complete four-case baseline was two healthy passes and two causal failures in 43.3 s. After the direct selection fix, actual-controller focused regressions separately demonstrated the still-stereo private macro and rack-prefix renders at 4/6/32 channels: six causal failures, fifteen healthy passes, 2.141 s. These are closure of FX027, with zero additional count. Their detached programme width now matches the native target; authored project output width and listening settings remain intact. The baseline diagnostics and logs were inspected and deleted immediately. Corrected complete public evidence remains pending the coordinated capture.

The FX027 private-width closure passed 53/53 focused tests in 3.177 s (actual persisted controller/native PCM and profile spectra at 1/2/4/6/32 channels, existing rack capture controls, macro transaction/lifetime controls, and offline chain controls). Each profile equals an independent real Audacity per-channel power capture; unchanged source PCM, authored stereo programme width, and Undo/Redo are asserted. Targeted type-aware lint passed. Logs were reduced to this receipt and deleted; strict whole-test compilation was then started as the sole compiler. No assistance runtime closure or manual Update AI assets run is involved.

Canonical changed-file lint and whitespace checks also pass for the stable FX027 closure inventory. The bounded lint log was read and removed.

The sole strict whole-test compilation of the new closure exposed an opaque fixture-context read at `tests/audio-editor-round7-wide-timeline-effects.test.ts:76` and one independent new I/O fixture error. The FX027 fixture now proves the actual context is an object containing `noiseProfile` before reading it; the production API was unchanged. Its complete 21-case focused run passed in 2.739 s and targeted type-aware lint passed. The small compiler/focused/lint logs were read and deleted. Whole strict compilation is pending the stable sibling fixture inventory.

### Frozen checkpoint 100 WebKit DSP diagnostics — pending unchanged replays, no extra roots

Completed full-suite failures 32/33/34/36/37/38/39 were inspected, including each actual error context and PNG. Make stereo/sidechain (32) stopped in setup: the initial Gate Close still left the Gate dialog visible; no Make stereo or physical signal assertion ran. Native-rate Noise profile (33) completed capture and actual export but its inherited final fixture expected 38,400 instead of the real 40,447 samples, the already corrected FX018 2,047-frame release assertion. Contrast equal attenuation (34) retained the old -12.1/-42.1 report after the twice-attenuated foreground capture expected -112.1; the normal old report and muted background are visible, so an unchanged isolated replay is required before judging cause. Live Click Removal (36) and live Compressor (37) each had healthy original RMS around .296, then sampled a zero interval after parameter editing (reported 6,656 and 4,352 low frames); their screenshots show healthy meters afterward. These continuity failures remain unresolved pending the unchanged isolated physical controls. Hosted restored controls (38) failed the preliminary End key control at zero instead of one before Restore, using the desktop-host stand-in on WebKit; the supported Electron/Chromium route must remain separate from this platform fixture. EQ neighboring-bin spectrum (39) had a healthy actual native FFT and correctly placed tone, but its immediate raster top was .353896 against <.35; the retained screenshot was inspected, and no raster or tolerance change has been made. All seven consumed completed diagnostic directories were deleted immediately; the parent-owned active aggregate log is preserved. Each complete unchanged isolated replay is deferred until the full checkpoint run finishes to avoid adding load confounds.

FX027 corrected complete public qualification: on both guarded products authenticated `2241ac091538323b604c61357885b98ba8d76c27`, all six unchanged Chromium workflows passed in 40.1 s. Stereo/four-channel macro Invert passed in 6.3/5.3 s, stereo/four-channel track Get noise profile followed by the actual 50,047-frame enabled WAV passed in 6.0/6.4 s, and stereo/four-channel direct menu Invert with actual polarity-preserving WAV, Undo and Redo passed in 7.3/7.1 s. All original healthy native input controls and causal completion/PCM assertions were retained. The finished bounded log and output directory were read and deleted immediately. R7-EFFECT-027 is now fully qualified as one timeline selection-width root; macro/profile variants add zero counts. Effects verified count is 27. No manual Update AI assets run is required.

The stable whole strict test and tooling compilation then passed: `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck:tests` completed both `tsconfig.tests.json` and `tsconfig.tooling.json` with exit zero, as the sole compiler on CPU 20–23. This includes the faithfully narrowed native profile context and the sibling I/O fixture correction. Its bounded log was read and removed immediately.

### Frozen checkpoint 100 isolated WebKit DSP replay — zero additional roots

After the full run completed, the nine assigned effect workflows were replayed unchanged on frozen `ee53e112619b862826b7466dc422b3c6760bba27`, one worker with the qualified local Pulse sink. Including two healthy variants, nine of eleven tests passed in 1.6 minutes. Both Make stereo/sidechain cases passed in 11.8/10.7 s. Contrast passed in 14.4 s with actual twice-attenuated foreground -112.1 dBFS and independently measured 30.0000005 dB difference. Click Removal and Compressor passed in 6.7/7.5 s with zero low frames and post-edit RMS .296085. Restored native controls passed in 4.3 s. EQ neighboring/high-frequency bins passed in 5.9/5.9 s with actual raster tops .311688/.266234; the original <.35 assertions remain. Gate linking passed in 7.1 s, preserving healthy independent gain, early linked ratios .0097848–.0102306 and unchanged node count. These isolated successes establish no new source root and do not erase the full-run failures.

The unchanged noise-profile replay again completed capture/export and failed only the inherited 38,400-frame assertion against 40,447, the already corrected FX018 physical 2,047-frame release fixture. On authenticated `b6a6cdaafd` prepared source, the retained corrected complete WebKit fixture passes in 9.4 s, including audible release and quiet-ending controls. Generated speech repeats its preliminary clock failure before testing muted playback: the original x=16 native-control click hits WebKit's rewind icon, while the inspected PNG places its Play icon at x=56. Native audio focus plus Space also fails to activate that control and is excluded as a fixture attempt. The browser-specific visible Play hit target is being verified with all original readiness, actual clock, gain, mute and client-error assertions retained. All exact completed full/replay diagnostic directories and bounded logs are consumed and removed immediately. No production source or count changes result from these replays.

The corrected native Play target completes the entire speech preview workflow in Chromium 2.7 s and WebKit 3.9 s on the same prepared `b6a6cdaafd` bytes: actual native clock advances for both unity playback and muted playback, and the real audio element has volume one then zero. No source, deadline, signal assertion or count changes. Initial master-envelope probes on a 720-pixel-high Framescaper viewport failed their healthy gesture before the auxiliary action because the enlarged output lane was clipped by the dock; those setup attempts are excluded, and a normal taller viewport is used for the follow-through witness.

### Root EDIT036 output-strip closure — zero additional roots

The shared vendor gesture and clip publication fixes leave a separately implemented output-strip publication listener accepting every document `mouseup`. The initial public endpoint/absolute-y comparison on authenticated `b6a6cdaafd` is excluded: moving an endpoint changes which authored point becomes `.first()`, and row movement also changes absolute y. It is not valid public causality evidence. The retained witness instead drags the visible line, measures point height relative to its owning row, and observes the actual History list. Its healthy primary publication exposed the independent native finishing envelope-custody defect recorded below before reaching the auxiliary action. All inspected exact diagnostics and small logs were removed immediately.

Mounted actual output rows reproduce six causal early publications across master/group/send and middle/right releases, while three primary-only controls pass (621.9 ms). Restrict only this row's publication to primary release. All nine row cases now preserve no premature history publication, one final commit, independent expected canonical gain and late-release idempotence. With existing clip gesture and output-name controls, 18/18 pass in 1.023 s. Targeted type-aware lint and whitespace checks pass. An initial strict fixture used an incorrect <.2 gain bound; the retained healthy reference computes the independent nonlinear pointer-to-dB value and requires the exact final canonical gain instead. The corrected complete public witness awaits the next coordinated capture. This closes the existing primary-release family and adds zero roots; verified effects count remains 27. No manual Update AI assets run is required.

## R7-EFFECT-028 — Native finishing projection discards an authored master curve

Ordinary Framescaper import → File → Export video produces a healthy 48,000-frame WAV. View → Master track → Expand track → Clip gain then exposes the normal volume-envelope line. A primary line drag visibly lowers it more than 20 pixels and publishes exactly one native master/update History entry, but the following downloaded WAV remains at unity: RMS ratio 0.999999995 instead of below .4. This is causal public RED in 6.4 s on both authenticated products at `c9198813d6f922140a4b482b6e194a1fa9cd57b0`. The accepted visible gesture, actual history and physical dry/wet downloads use no internal action triggers or injected project state. The reviewed PNG/context and bounded log are immediately deleted.

The finishing foundation intentionally removes its owned strip envelopes before delegating to the inherited document. Its runtime/command reassembly never restores them; likewise, a following ordinary selection or strip update starts from the stripped foundation and erases the accepted canonical curve. Read-only actual factory/command probes preserve .25 in the authored master but return empty runtime/command curves and erase it on selection. Audio-track peer curves share this one native finishing state-custody owner. The earlier immediate autosave observation is excluded as pending storage publication, and the output-strip endpoint fixture is excluded as described above.

The strict actual native factory/command/projection/history regression is 14 causal RED with five healthy replacement/clear/unity controls passing (1.700 s). Return independently cloned authored strip curves to runtime/command views, and place them in the detached inherited command foundation so existing ordinary strip commands preserve or deliberately replace them. No other finishing state or source authority crosses that boundary. The same 19 cases all pass in 1.737 s, retaining both master/audio-strip curves, exact frames/values, accepted gain/pan/name changes, explicit replacement/clear, nested batches, input immutability and complete Undo/Redo. With existing native history families, visual commands, finishing authoring, audio automation admission, transaction shapes and output-row gestures, 85/85 pass in 4.899 s. Targeted type-aware source/test/browser lint, complete retained-tree `npm run lint:changed` and whitespace checks pass. Reviewed bounded focused/lint logs are immediately removed. Complete public GREEN is pending; effects verified count remains 27. No manual Update AI assets run is required.

FX028 corrected complete Chromium qualification on both guarded products authenticated `bd5ac4718cfcf9d53a5502cd232f135fa2639581`: the unchanged physical master-envelope workflow passes in 6.9 s, including healthy dry WAV, accepted native History, attenuated downloaded WAV and preserved curve/physical audio after a following selection. The complete output-strip primary/auxiliary gesture, Undo and Redo witness also passes in 4.7 s. Both complete cases pass in 13.2 s with one worker and the qualified local Pulse sink. All original physical gain, exact frame, history and gesture assertions remain. The bounded log and owned output directory were read and removed immediately. R7-EFFECT-028 is fully qualified as one native finishing curve-custody root; output-strip EDIT036 closure adds zero counts. Effects verified count is 28. No manual Update AI assets run is required.

## R7-EFFECT-029 — Native Mixer silently discards its existing bus controls

Framescaper: import an ordinary stereo recording and choose Window → Mixer. The actual recording Mute toggle and one Undo pass. The offered Add group bus or Add send bus then publishes Done but leaves zero corresponding channel strips. Both complete native baseline cases fail causally at zero instead of one after those healthy controls, in 9.2/9.1 s on authenticated `bd5ac4718cfcf9d53a5502cd232f135fa2639581`. Reviewed actual PNGs and contexts show the enabled controls and unchanged native channels; the finished bounded log and owned diagnostic directory are removed immediately. Group/send and other compact mixer graph mutations share one dispatch owner and add no variant counts.

Native finishing advertises audioMixerGraph and already authors its canonical graph through Window → Mixer & Routing. The compact Mixer uses the existing inherited mixer/bus and mixer/route commands, but finishing reassembly overwrites their legacy result with the prior native graph. This requires mutation of the canonical graph, separate from FX028's compatible legacy curve custody. Source repair, focused RED/GREEN and corrected complete public qualification are pending; verified effects count remains 28.

The actual native factory/command/history regression fails eight causal cases while the native canonical graph authoring and track-Mute control passes (1.343 s). Move the unchanged bounded Soundscaper compact-mixer mapper into the existing common graph-surface contract; its former import path retains the same public re-export. Native finishing dispatch applies the four existing compact graph commands directly to that canonical graph and reconciles only invalidated references. Mixed and nested batches retain command order and one history entry. The original nine cases pass in 1.550 s. With ordinary group removal, exact fallback assignment/send retention, native automation custody and complete Undo/Redo plus existing Soundscaper admission/performance, native curve, authoring and generic chunk-ownership controls, 86/86 pass in 2.947 s. Targeted type-aware source/test/browser lint and whitespace checks pass. All consumed focused/lint logs are reduced to this receipt and deleted immediately. The common leaf remains 451 lines and introduces no new chunk owner or assistance runtime closure; no manual Update AI assets run is required. Corrected complete public qualification remains pending.

Canonical changed-file lint also passes for the stable compact native mixer correction. Its bounded log is read and removed immediately; the shared whole compiler and full repository lint are coordinated with the parent.

The read-only bus-rack follow-up is excluded: both provisional normal Framescaper attempts stop in their preliminary track-rack control (7.5 s each). The product explicitly publishes audioEffects=false, and workspace admission omits the effects panel; therefore these inherited bus-rack internals are not reachable through an available effect-authoring route. No processor mutation, feature or count is added. The provisional cases are removed immediately after the exact contexts/log are inspected, and their owned diagnostics/log are deleted. The retained compact bus-control witness and correction remain unchanged.

Read-only next native-range probe: the ordinary Master gain primary drag and Undo controls complete, then primary release while middle remains held followed by a later normal drag leaves -8 dB unchanged (3.1 s). This initial immediate-value observation is not yet qualified; a settled poll and passive native event evidence are required before calling it a new source root. The exact completed log is read and its diagnostics/log immediately removed.

## R7-EFFECT-030 — A released native Master gain range blocks the next drag

Soundscaper: import an ordinary stereo recording and open its Effects panel. The normal Master gain range drag reaches -8 dB and one Undo returns to zero. Repeat it, press the middle button while holding primary, release primary, move off the range and release middle. The passive native range observer confirms primary-release pointermove button=0/buttons=4 and lostpointercapture. The next ordinary primary drag is refused: its actual range value stays -8 dB instead of below -9 through the full five-second settled poll. This is causal native Chromium RED in 7.5 s on authenticated `bd5ac4718cfcf9d53a5502cd232f135fa2639581`; the actual PNG/context and small log are read and deleted immediately. The earlier immediate value-only attempt is excluded as recorded above.

The range retains pointerActive after native primary release/capture loss; its next primary down is prevented as though the earlier pointer were still held. Earlier R6-EFFECT-042 covers foreign pointer identity in this shared range, and R4-DIALOG-018 covers Escape's canceled-draft latch, while this candidate concerns cleanup of the actual owning pointer after native completion. Focused reproduction/repair and corrected complete public verification are pending, with no count added yet.

Three strict actual mounted range cases causally fail while four foreign-pointer/touch/held-primary/Escape controls pass (400.1 ms). Complete only the owning mouse gesture when primary is no longer held, retaining its final accepted value and releasing pointer admission. Unexpected owning capture loss cancels and retires the pointer; foreign capture loss remains ignored. Own completion, subsequent primary admission, no duplicate publication, late cancellation input, fresh keyboard input and existing foreign-touch/primary/Escape/video-range controls pass 21/21 in 763.3 ms. An initial support invocation omitted the repository's required style-asset loader and failed to load two legacy CSS consumers; it is excluded and corrected without source/assertion changes. Targeted type-aware source/test/browser lint and whitespace checks pass. Consumed strict/support/lint logs are read and immediately removed. The retained public workflow also asserts exact two-entry Undo/Redo for the completed and later gestures. Corrected whole public remains pending; no count is added yet. No manual Update AI assets run is required.

Canonical changed-file lint passes for the stable range correction; the bounded log is read and removed immediately. The exact earlier identity owner is R6-EFFECT-042 (shared SteppedSlider), while R6-DIALOG-057 is the separately implemented video rack range. This candidate repairs owning completion/capture-loss cleanup, with foreign-identity and Escape assertions unchanged; count remains pending conservative family assessment and complete corrected public.

FX030 corrected complete native Chromium qualification on authenticated `8fa7d10abb51498678dcaab9d9b601324db7881a`: the unchanged Master gain workflow passes in 3.4 s. The healthy primary drag/Undo, actual owning primary-release pointermove and capture loss, later ordinary drag, and exact two-entry Undo/Redo all pass. This owns completion/capture-loss cleanup, separate from R6-EFFECT-042's foreign-pointer identity admission; no consumer variant counts are added. R7-EFFECT-030 is fully qualified. Effects verified count is 29 while FX029 remains pending its full corrected flow. No manual Update AI assets run is required.

The same guarded public run verifies FX029 bus creation but exposes its next actual Mute control: both group/send toggles reach Unknown bus and remain false through five seconds (8.6/8.8 s), after healthy imported-track Mute/Undo and actual new channel publication. Reviewed PNGs show the real legacy refusal. Native runtime execution first prepares video-transition allocations; the finishing allocator incorrectly replays these compact mixer commands against a foundation without finishing buses before the repaired native dispatch can run. Four actual prepared-command update/removal regressions fail while eleven existing/mixed controls pass (1.843 s); adding the ordinary Output/send route gives five causal failures and eleven controls (2.580 s). This is required same-owner FX029 closure, with zero extra count. The actual bounded public/focused logs and diagnostic output directory are read and removed immediately; complete corrected mixer qualification remains pending.

FX029 required allocation closure: classify the existing four compact mixer mutation commands alongside finishing-owned operations before inherited retime preparation. They cannot create visual overlaps, so their already validated command passes to its actual canonical mixer owner; mixed batches still simulate each command in order for later genuine visual overlap edits. All 50 focused native preparation/history, actual dissolve/allocation, source re-probe inheritance and generic chunk-ownership controls pass (2.988 s), with targeted type-aware lint and whitespace checks passing. The first broader support invocation omitted the required tsx loader and failed before one support fixture loaded; the subsequent transform flag is unavailable in Node 26 and is excluded. The canonical tsx/style-loader invocation above is the passing receipt. Reviewed bounded logs are removed immediately. Complete unchanged bus Mute/Undo/Redo public qualification remains pending the next shared capture; no additional root is counted.

### Checkpoint 150 runtime-consumer register closure — zero additional roots

The complete frozen Node gate identifies the newly selected DAWproject service as an unregistered interchange owner. Its actual saveDawproject entry projects selected multicamera delivery through projectForRuntimeConsumers before the interchange writer. Its distinct openDawproject entry delegates an imported document to the selected loadProject boundary without directly reading clip timing. Register these exact existing boundaries and truthful entry-point evidence; no projection behavior or exemption is changed. The focused runtime-consumer audit passes 14/14 in 2.467 s and targeted type-aware lint passes. Intermediate register probes exposed the distinct loader entry, which is represented by its actual loadProject boundary in the final passing inventory. The bounded owned logs are read and deleted immediately. No bug count or manual Update AI assets run is added.

### Checkpoint 150 Parametric output-touch diagnostic — pending unchanged replay

The complete frozen Chromium second-finger case stops at its immediate passive console-array assertion: no received message versus the expected secondary-pointer release. The reviewed actual PNG shows a healthy 2.5 dB output value after the initial normal drag and touch movement; the later touch completion, Apply, Undo and Redo assertions are not reached. No production cause or additional root is established. Preserve the entire two-case fixture for unchanged isolated replay on the next guarded products. The exact consumed error context and PNG directory is deleted immediately; the parent-owned active aggregate log remains intact.

FX029 required strict-type closure: the complete source compiler reports that finishing's inherited indexed Omit type does not retain explicit masterChannels/tracks fields for the shared mixer contract. At the actual command boundary, read the already validated numeric width and bounded inert track records into the exact mapper input, preserving all other project fields; no cast, shared type widening, audio or routing semantics changes. The 16 actual native command/preparation/history controls pass in 2.306 s, the complete application source compiler (`tsc -p tsconfig.json --noEmit`) passes, targeted type-aware lint and whitespace checks pass. The bounded owned verification logs are read and deleted immediately. This is required FX029 follow-through with zero additional count; its complete corrected public remains pending the coordinated guard.

FX029 corrected complete Chromium qualification on both guarded products authenticated bc991d5fe099b25a6224ce607b4cd05829f4cdd8: the unchanged group and send workflows pass in 4.7/4.8 s. Healthy imported-track Mute/Undo, actual Add bus, bus Mute, two exact Undo steps, two Redo steps, no alert and no client error all pass. R7-EFFECT-029 is now fully qualified as one canonical compact-mixer dispatch root, including its required native transition-preparation and strict-boundary closures. Effects verified count is 30; group/send and route variants add zero counts. No manual Update AI assets run is required.

The same guarded four-case isolated run passes the complete unchanged Parametric output-touch fixture alone/through a second finger in 3.0/2.8 s, with the original passive secondary-release evidence, accepted final gain, Apply, Undo and Redo assertions and original deadlines unchanged. Full150's immediate [] console-array failure remains recorded above; no production failure or additional count is established. The full focused run is 4/4 GREEN in 17.0 s with one worker and the qualified Pulse sink. The finished bounded log and owned output directory are read and deleted immediately.

### Excluded chronological Nyquist candidate — no additional root

On unchanged authenticated bc991d5fe099b25a6224ce607b4cd05829f4cdd8, the normal Crossfade Clips workflow passes both initial split-recording order (2.9 s) and the arrangement after moving its earlier-created half to three seconds (3.7 s), including selecting the unmoved half, actual bundled Apply completion, no alert, Undo and Redo. The full two-case baseline passes in 8.3 s. A read-only concern about host clip iteration versus the bundled early-stop algorithm therefore does not reproduce through this normal native authoring path; no production or focused fixture correction is justified. Remove the provisional public spec and all finished owned verification artifacts immediately after recording this honest exclusion. No count or manual Update AI assets run is added.

### Checkpoint 150 Amplify touch diagnostic — pending unchanged replay

The frozen Chromium second-finger case fails its immediate passive console-array check at [] versus the expected secondary release (4.0 s). The consumed actual PNG shows the initial accepted touch move has reached -5.5 dB amplification; final touch completion, physical persisted source peak, Apply and Undo/Redo assertions have not run. No new source cause or FX030 regression is established. Keep the complete original two-case fixture and deadlines for unchanged isolated replay on authenticated bc991d5fe products. Delete the exact consumed error-context/PNG directory immediately; preserve the active parent aggregate log.

The complete unchanged Amplify touch fixture passes alone/through a second finger on authenticated bc991d5fe products in 3.6/3.0 s (2/2 GREEN, 8.2 s, one Chromium worker and qualified Pulse sink). The exact passive secondary release, accepted final range value, physical persisted Amplify source peak, Apply and Undo/Redo assertions and original deadlines remain unchanged. No production change, additional root or demonstrated FX030 touch regression is needed. Its finished bounded log and owned output directory are read and deleted immediately.

FX029 zero-count fixture-type closure: the resumed full static gate passes all production compositions but reports 25 test diagnostics because the generic public FramescaperProject mixer declaration does not expose the actual selected V21 graph. Assert that each actual native factory/history/runtime mixer satisfies the existing isMixerGraphV21Surface guard before observing channel widths, destinations and edges. The retained automation array and each lane ID are likewise proved before their unchanged exact custody assertion. No production type, cast, audio, routing or history assertion is weakened. All 16 focused actual command/preparation/history controls pass in 2.569 s and target type-aware lint passes. Two complete strict test/compiler collections remove every mixer diagnostic; the later collection fails only at new sibling generator fixture sample-frame branding (87/89), so a shared whole-green compiler receipt remains pending its stable inventory. The earlier collection also recorded transient Freesound redeclaration/listener fixture errors, which their owners have corrected. Consumed own focused/lint/compiler logs and the completed parent-assigned static failure log are reduced to this receipt and deleted immediately. No additional bug or manual Update AI assets run is counted.

The final stable-inventory full `npm run typecheck:tests` completes with exit zero across both strict tests and tooling, after the sibling listener/sample-frame and Freesound fixtures are corrected. Every exact native mixer assertion remains unchanged. The bounded compiler log is read and immediately deleted. This closes the required zero-count fixture verification; effects verified count remains 30 and no manual Update AI assets run is required.

## R7-EFFECT-031 — Released primary EQ gestures lose their accepted curve

Ordinary Soundscaper stereo/mono recording → Select all → Effect → EQ and filters → Graphic EQ or Filter Curve EQ. A normal +6 dB primary drag applies to actual stored PCM with healthy amplification, and Undo restores the imported recording. Repeat the drag, hold middle and release primary, then move and release middle. The native passive observer confirms the actual primary-release pointermove with buttons=4, but Graphic EQ resets the accepted band to 0 dB and Filter Curve removes the accepted point. Both complete native baseline cases are causal RED in 8.6/8.5 seconds on authenticated prepared 2e3ad747b68944e891fa5e33cba1b8764298e999. Reviewed PNGs/context show reset faders and an empty curve. Both bounded logs and exact owned diagnostic directories are read and immediately removed. The first Graphic attempt stopped before the target at an incorrect >.6 healthy peak assumption; its default B-spline narrow-band response legitimately yields .586058, so that setup attempt is excluded and the retained independent healthy bound is >.5.

These same two curve surfaces share earlier FX020 foreign cancellation admission, whose controls preserve intentional owning cancellation. This root instead lacks the owning mouse primary-release completion transition: the browser releases native capture after the primary button ends, and the still-active curve falls into its owning cancellation handler. Completing the accepted primary value before that native capture loss is independent of refusing a foreign finger's cancellation. Group Graphic/Filter and button variants once; focused reproduction and corrected whole public remain pending, effects verified count stays 30. No manual Update AI assets run is required.

Three strict actual mounted completion/routed cases causally fail while six held-primary, native-touch, foreign-pointer and intentional-capture-loss controls pass (613.5 ms). Complete only the owning mouse when primary is no longer held, taking its final native coordinates before canceling queued presentation work and retiring capture. The existing owning cancellation and foreign-pointer guards stay intact. All 36 new completion, existing FX020 cancellation, routed automation, exact final positions, later gesture, native touch, keyboard, deferred presentation, grid and FIR controls pass in 1.744 seconds. Targeted type-aware source/test/browser lint and owned whitespace checks pass. Consumed bounded focused and target-lint logs are read and immediately removed. Corrected whole public remains pending; effects verified count remains 30, and no manual Update AI assets run is required.

Canonical changed-file lint passes on the stable shared inventory. Its first collection stopped only because a sibling removed an excluded provisional device probe after inventory collection; no source diagnostic was reported, and the current-inventory retry passes every shard. Both bounded lint logs are read and immediately deleted. Source and focused proof are ready for the next coordinated guarded product capture; corrected whole public remains pending and effects verified count stays 30.

Both complete unchanged FX031 normal native workflows pass on guarded authenticated `0f0d9ba2f`: Graphic EQ 4.2 s and Filter Curve EQ 3.7 s. Each retains its initial ordinary drag/physical stored-PCM amplification/Undo control, actual mouse primary-release buttons=4, accepted final gain, harmless later auxiliary movement, Apply and complete Undo/Redo PCM assertions. Count the two curve surfaces once: effects verified count becomes 31. The finished bounded public log and exact output directory are read and immediately removed.

### Excluded macro numeric track-order candidate — no additional root

Actual Tools → Macros palette → New program → SelectTracks(track 0) selects the initial visible first track; normal per-track Move track to top then the same authored command selects the newly displayed first track. Complete root and foldered native workflows both pass on guarded `0f0d9ba2f` in 3.5/3.4 s, preserving actual authored selection logs, native ordering and no alert. The preliminary second-run New program locator stopped at an ambiguous saved row before the target assertion and is excluded setup. No macro source change or additional root is needed; remove its provisional witness and every consumed bounded log/diagnostic immediately.


## R7-EFFECT-032 — An advertised RemoveTracks macro cannot remove a selected track

Soundscaper: import an ordinary recording, open Tools → Macros palette → New program, and run `await sound.command('NewMonoTrack');`. This healthy command completes and adds the third visible track. Author `await sound.select.tracks({ track: 2, trackCount: 1, mode: 'set' }); await sound.command('RemoveTracks');`: the actual authored selection reports one target, but the program fails with the visible error “Unknown track: undefined.” This is causal native Chromium RED in 8.4 s on authenticated `0f0d9ba2ff166ebbb3ffabcf0c6f407f92e0e0a3`. Its actual PNG/context and bounded log are read and immediately deleted. No hostile file, private entry point or missing platform capability is involved.

The advertised bare command names `track.remove`, which requires a track ID, while the macro dispatcher invokes bare actions without arguments. Route this plural command through the existing canonical selected-track removal plan and `edit.commit`, using live explicit selection and current focused-track fallback. The ordinary menu and macro retain the same dependent-state, lane-group, lock and batch semantics. Five strict actual native-controller cases reproduce the failure before correction: one/two selected targets, current focused-track fallback, ordinary No tracks and complete locked-target refusal (1.853 s). After correction, those cases and existing command ordering, atomic history, project reads, sandbox dispatch, cancellation and trust controls pass 39/39 in 3.301 s. Single and multiple removals each Undo/Redo as one action; a locked later target preserves every earlier selected track and existing history. This is one command-invocation owner, separate from prior selection arithmetic and advertised non-runnable Contrast admission. Corrected complete public qualification and final lint remain pending; effects verified count stays 31. No manual Update AI assets run is required.

Targeted type-aware lint passes for all three owning sources and both retained strict/public witnesses; the updated browser witness also passes its final focused lint. Owned whitespace checks pass. The consumed focused and target/browser-lint logs are read and immediately removed. Canonical changed-file lint is running on the stable inventory; corrected complete public and effects count remain pending the coordinated guarded capture.

Canonical changed-file lint passes all two source and two test shards on the stable shared inventory. The complete unchanged native Chromium macro workflow passes on authenticated `2541ed646` in 3.0 s (1/1 GREEN, 4.7 s whole run): healthy NewMonoTrack, actual selected target, successful RemoveTracks, retained original recording, and exact Undo/Redo track counts all pass without alerts or client errors. R7-EFFECT-032 is fully qualified; effects verified count becomes 32. The bounded canonical lint/public logs and exact owned public output directory are read and immediately deleted. No manual Update AI assets run is required.

## R7-EFFECT-033 — Selected rendering drops ordinary echoes older than ten seconds

Soundscaper: import a quiet twenty-second mono tone; its healthy Entire project WAV is 960,000 frames with audible RMS. Add the normal Delay rack, set Time to 2 s, Number of echoes to 10 and Gain per echo to 0 dB, then export the complete mix without added tails. Its interior 18–19 s RMS exceeds the healthy dry control eightfold. Set the normal Selection start/end sample controls to 864,000/912,000 and export Current selection: its exact 48,000 frames have only 0.6000000008 of the complete mix RMS (about 4.44 dB false attenuation). The actual normal Chromium workflow is causal RED in 40.5 s on authenticated `2541ed646`. The real downloaded WAV bytes establish the mismatch, independently of stored metadata or private entry points. Its actual screenshot/context and bounded log are inspected and immediately deleted. An initial thirty-second new-fixture budget stopped after the two healthy native exports before selection; that setup timeout is excluded. The retained 75-second budget accommodates three native renders, and no behavior assertion was weakened.

Selected render callers cap processor pre-roll at ten seconds although the ordinary finite-tap processor retains twenty seconds of feed-forward history. This is one input-history admission owner across selected rendering consumers, independent of added output-tail truncation and Nyquist preview prefix owners. Strict causal reproduction and correction remain pending; effects verified count remains 32. No manual Update AI assets run is required.

Two faithful 8/48 kHz native-project processor cases reproduce the 0.6 selected/full ratio while four inactive, dry, shorter and explicit longer pre-roll controls pass (1.055 s). Derive the audible preceding history at the two existing offline/realtime render boundaries from the current insert path, bounded by the actual selected start. Preserve explicit longer pre-roll, output-tail policy, selected scope, mute/solo admission and context-memory limits. The native plug-in realtime delegation uses this same boundary. After correction, all 31 new delay, existing engine runtime, offline geometry and realtime queue controls pass in 1.782 s. The exact finite DSP output matches the complete passage at both supported rates. Strict TypeScript for the retained fixture and its owning import closure, targeted type-aware lint and owned whitespace checks pass. Initial test-fixture frequency defaults and a direct Node strip-only invocation were setup errors and are excluded; the canonical tsx runner and actual lower-rate spectrogram defaults provide the reported proof. Canonical changed-file lint is finishing; complete corrected public qualification remains pending and effects count stays 32. No manual Update AI assets run is required.

Canonical changed-file lint passes both source shards and all three test shards on the stable shared inventory. Its bounded log is read and immediately removed, alongside the consumed focused/type logs and temporary narrow compiler configuration. The complete selected passage public witness is retained unchanged for the next coordinated guarded capture; this source-ready root remains uncounted until that whole workflow passes.

The complete unchanged native Chromium workflow passes on authenticated coherent `cb40131e6` in 45.0 s (1/1 GREEN, 47.0 s whole run). Its two healthy twenty-second full WAVs, exact 48,000-frame selected WAV, interior selected/full RMS ratio within 0.99–1.01, visible selection controls and absence of alerts/client errors all pass. R7-EFFECT-033 is fully qualified; effects verified count becomes 33. The bounded public log and exact generated output directory are read and immediately deleted. No manual Update AI assets run is required.

### Full-150 Firefox dissolve fixture follow-through — no new root

The completed full-150 Firefox cases for a Solid between camera clips and a normally trimmed one-frame camera both time out at the old `round7-dissolve-user-path.js` media-summary center click, after healthy transition Apply/Remove and before their candidate geometry. The exact failure contexts list Clip-properties panel/header/tab/selection-status interceptors; both actual PNGs show the short painted media-summary strip beneath the tabs. Current helper correction `c1383eea0` targets its real painted top position without forced dispatch. Consume and immediately remove the two finished diagnostic directories after inspection. An unchanged current whole two-case Firefox replay remains pending; no source, deadline, assertion or bug count change is assigned.

Both unchanged current Firefox dissolve workflows pass on authenticated `cb40131e6` with the existing painted-summary helper: Solid adjacency 28.8 s and one-frame admission 19.1 s (2/2, 50.4 s whole run), one worker and the qualified native Pulse sink. The retained 30-second individual deadlines, candidate geometry, ordinary Apply/Remove controls and Undo assertions are unchanged. This closes the two known full-150 fixture failures with zero extra roots. The completed bounded replay log and exact generated directory are read and immediately removed.

## R7-EFFECT-034 — Parametric EQ discards a completed primary gain edit while middle remains held

Soundscaper: import an ordinary 500 Hz recording and choose Effect → EQ and filters → Parametric EQ. A normal 6 dB band drag, or the normal output fader to 6.1 dB, completes and its actual downloaded WAV peak grows by the expected 1.7–2.3 ratio; Undo restores the imported recording. Reopen/reset, repeat the accepted gain drag, hold middle and release primary. The actual owning native mouse transition reports buttons=4. Later auxiliary movement/release leaves the gain at zero rather than the accepted 6/6.1 dB. Both complete native workflows causally fail on authenticated `cb40131e6` in 12.1/11.4 s, after every ordinary dry/Apply/physical PCM/Undo control. Their actual PNGs/context and bounded log are inspected and immediately removed. The initial dry-level fixture omitted the intended equal-power mono pan and failed before EQ; its corrected exact .15/√2 delivered peak is the healthy oracle, and the first setup failures are excluded.

These two private Parametric owners preserve the earlier R6-EFFECT-025/R6-DIALOG-060 foreign-contact admission, but omit the owning mouse primary-release completion transition and consequently cancel the accepted draft when native capture ends. This independently implemented terminal owner differs from FX031 Graphic/Filter completion and FX029 product mixer command routing. Group band/output and button variants once; strict reproduction, correction and complete corrected public remain pending. Effects verified count stays 33. No manual Update AI assets run is required.

Three strict actual mounted band/output/modifier-Q cases causally fail before correction while eight held-primary, native-touch, foreign-pointer and intentional owning capture-loss controls pass (615.7 ms). Complete only the owning mouse after primary ends, retain its final coordinates/value and retire the owner before releasing native capture. Subsequent auxiliary movement and capture loss cannot cancel or recommit the accepted value; a later ordinary gesture remains available. All 30 new and existing Parametric ownership, automation, deletion and keyboard controls pass in 1.295 s. Existing intentional cancellation still restores the gesture start. Initial test loading without the canonical CSS hook and teardown callback masking, plus mistaken display-rounding fixture expectations, are excluded setup errors. The retained fixture asserts full precision committed gain/Q separately from rounded display. Strict TypeScript for the actual retained fixture/import closure, targeted type-aware lint and owned whitespace pass. ParametricEqEditor remains 541 lines, below the 550-line warning boundary. Canonical changed-file lint is finishing; corrected whole public and effects count remain pending. No manual Update AI assets run is required.

Canonical changed-file lint passes both source and all three test shards on the stable current inventory. Its bounded log is read and immediately removed; all consumed focused/type logs and the temporary narrow compiler configuration are already removed. Source and retained strict/native witnesses are ready for the next coordinated guarded capture; whole corrected public remains pending, so effects count stays 33.

Both complete unchanged FX034 native Chromium workflows pass on coherent authenticated `5dd339942`: band 8.3 s and output 8.5 s (2/2 GREEN, 18.5 s whole run). Each retains healthy actual dry/ordinary gain WAV controls, the real primary-release buttons=4 transition, accepted final gain, harmless auxiliary movement, Apply and exact Undo/Redo physical PCM assertions. Count the two private Parametric completion surfaces once; effects verified count becomes 34. The finished bounded public log and exact generated output directory are read and immediately removed. No manual Update AI assets run is required.

### Full-150 WebKit compressor playback-start diagnostic — pending unchanged replay

The completed frozen live compressor case fails after 12.652 s at its five-second Pause-button assertion, before any signal/reduction telemetry assertion. Its actual context and PNG show the native alert “The streamed and buffered sources missed their shared playback start,” Play still available and playhead zero, with the ordinary long recording and configured Compressor present. This establishes a playback-start refusal during the full run, not a demonstrated compressor-meter defect. Preserve the complete existing case and deadlines for unchanged isolated replay on coherent `5dd339942` with one worker and the qualified native Pulse sink. The consumed exact PNG/context directory is immediately removed; the active parent aggregate log remains intact. No new root is counted.

The complete unchanged live Compressor WebKit case passes on coherent `5dd339942` in 6.2 s (1/1 GREEN, 8.1 s whole run), one worker and the qualified native Pulse sink. Actual Play/Pause admission, negative gain-reduction telemetry, live input/output levels and no client errors pass with original assertions and deadlines. The frozen full-run playback-start refusal is retained as an observed failure, with no demonstrated product cause or additional root. Its finished bounded replay log and exact generated directory are read and immediately removed.

### FX032 strict fixture closure — zero additional roots

The complete post-175 compiler passes main, desktop, checked JavaScript and all four product compositions, then reports two strict RemoveTracks fixture errors: an opaque history entry type and a possibly absent generic track array. Prove the actual history entry is an object containing type, and validate the current native Soundscaper project before mapping its tracks. The exact macro/history/lock assertions and production API remain unchanged. All five retained native RemoveTracks cases pass in 1.476 s; the strict fixture/import closure and targeted type-aware lint pass. The consumed bounded owned focused/type/lint logs and temporary compiler configuration are immediately removed. Effects count remains 34; no manual Update AI assets run is required.

### Full-150 WebKit Contrast attenuation triage — pending unchanged replay

The completed `audio-editor-round6-contrast-scaled-levels.spec.js:25` case fails in 22.874 s at line 66: after two offered -50 dB Amplify operations, the report still displays Foreground -12.1 dBFS, Background -42.1 dBFS and a 30 dB difference, rather than Foreground -112.1 dBFS. Its exact marker, error context and screenshot are consumed, and the completed diagnostic directory is immediately removed. The same frozen whole case passes Chromium in 13.660 s and Firefox in 24.103 s. No fresh product cause is inferred; retain its complete unchanged assertions for isolated WebKit replay. No additional root is counted.


## R7-EFFECT-035 — Warp musical grid entry uses the tempo at project zero

Soundscaper: import an ordinary five-second drum recording, choose the Music workspace and author 60 BPM initially with a 120 BPM event at beat four. Use Clip properties to place the recording at four seconds. Effect → Pitch and tempo → Audio warp and transients: set the local Grid interval to 96,000 samples and Strength to 100%, then Quantize transients. This healthy native control creates an interior marker at 96,000 and its entire-project WAV has 432,000 frames with an audible drum peak at frame 288,000 (six seconds). Undo, reopen, switch Grid interval to beats:bars and enter one bar (0011). The actual quantization instead places its marker at 192,000; the equally audible 432,000-frame WAV peaks at 384,000 (eight seconds). This is causal native Chromium RED in 19.3 s on coherent guarded `ac91f0f78`, independently measured from the real downloaded WAV bytes. The exact screenshot/context and bounded log are consumed and immediately removed. Preliminary narrow-workspace navigation and a strict healthy peak-window boundary stopped before the musical target and are excluded fixture setup; the retained whole test uses ordinary Workspace/Fit project navigation and admits the exact healthy boundary.

The grid coordinates are local outer samples for the normal imported sample-anchored recording, but its private TimeCode fields inherit the absolute musical map. Give those fields the existing relative musical clock starting at the selected recording's authoritative sample start, taking the current project from the already subscribed dialog snapshot. Plain sample authoring remains exact, and the separate musical-anchor beat-domain path is preserved. This is one private grid-clock owner across origin/interval and Quantize/Groove consumers, independent of generator duration, absolute selection display and prior warp pencil/silence/atomic-history owners. One strict actual mounted case reproduces origin and interval 192,000 rather than 96,000 after a tempo change; its zero-origin and explicit sample controls pass before correction. After correction, all nine native dialog, selected-project custody and existing generator duration/tempo/signature controls pass in 1.756 s. The same mounted workflow also retains a clip starting before and crossing the tempo change (one bar is 144,000 samples). Targeted type-aware lint, strict TypeScript for the retained fixture and owning import closure, 42 generic chunk-ownership/foundation runtime controls, and whitespace checks pass. AudioWarpDialog is 424 lines. Corrected whole public and canonical changed-file lint remain pending; effects verified count stays 34. No manual Update AI assets run is required.

Canonical changed-file lint passes the source and both test shards on the stable shared inventory. Its bounded log is read and immediately removed, alongside all consumed focused/type/ownership logs and the temporary narrow compiler configuration. The source and unchanged complete physical public witness are ready for the next coordinated guarded capture; qualification and effects count remain pending the whole corrected native workflow.

### Full-150 WebKit live Click Removal/Compressor continuity triage — pending unchanged replay

The completed native Click Removal threshold case fails in 9.419 s and the Compressor release case fails in 11.104 s: the Click Removal post-edit minimum is zero after healthy .2960850682 RMS, with 2,048 frames below .01; Compressor is zero after healthy .2961137234 RMS, with 2,560 frames below .01. Both fail the complete post-edit >.2 RMS oracle. The exact case markers, contexts and PNGs are consumed. Both screenshots show actual native playback continuing with green meters and the newly authored threshold201 /release101ms values; no fresh engine cause is inferred from a zero ScriptProcessor observer block during the full run. Retain the original entire observed-block minima and all native clock, healthy audio and changed-value controls for unchanged one-worker WebKit replay. Their exact completed diagnostic directories are immediately removed. No additional root is counted.

The complete unchanged native Chromium workflow passes on coherent authenticated `8d4cef165` in 20.8 s (1/1 GREEN, 22.5 s whole run). Both real 432,000-frame WAVs retain their audible level and peak at frame 288,000, while the musical Quantize marker is exactly 96,000. Native tempo/placement authoring, the explicit sample-grid healthy control, Undo, one-bar entry and absence of alerts/client errors all pass. Count the private origin/interval grid-clock owner once; effects verified count becomes 35. Its bounded finished public log and exact generated output directory are read and immediately removed. No manual Update AI assets run is required.

The three complete unchanged WebKit replays pass on coherent authenticated `8d4cef165`, one worker and the qualified native Pulse sink: Contrast 14.0 s, Click Removal 6.5 s and Compressor 7.4 s (3/3 GREEN, 29.9 s whole run). The actual twice-attenuated float WAV retains foreground RMS .00000247233, background RMS .0000000781819 and a 30.00000049 dB difference; the native report is Foreground -112.1 dBFS and Background -120.0 dBFS. Click Removal and Compressor retain the entire original block-minimum oracle at .2960850683 RMS with zero lost frames, after their ordinary accepted live edits. No assertion, deadline or source changed. The frozen full-run failures remain honestly recorded, with no independently demonstrated cause or additional root. The completed bounded replay log and exact generated output directory are read and immediately removed.


### Full-150 WebKit gate-linking triage — pending unchanged replay

The completed linking case fails in 10.285 s: its healthy independent-channel ratio is .0006372070, then its original early linked-channel window contains more than four blocks but their minimum and maximum ratios are NaN. The exact marker, context and actual PNG are consumed; the screenshot shows native playback, Link channels, the accepted 1000 ms attack and active green stereo meters. A zero/zero ScriptProcessor block establishes the failed ratio observer, without an independently demonstrated processor cause. Preserve every native healthy control, original early-block ratio assertion and deadline for unchanged isolated WebKit replay after the coordinated guard. The exact completed diagnostic directory is immediately removed. No additional root is counted.

## R7-EFFECT-036 — Undo leaves a held rack knob's obsolete draft visible

Soundscaper: import an ordinary recording, open its rack and add Feedback delay. Set Mix .4, Undo to .2 and Redo to .4 as healthy controls. Focus the ordinary Stop transport button outside the nonmodal effect dialog, hold the Mix knob and move it to .46, then press CtrlZ. The native saved numeric field correctly returns to .2, but its visible knob remains at .46 with an active drag. This actual normal Chromium path is causal RED in 8.4 s on authenticated `8d4cef165`; the context and PNG show the mismatched saved numeric value and obsolete held knob. Its bounded log and exact diagnostics are consumed and immediately removed. A first Noise gate probe reaches a native range rather than a knob, so its default focus correctly blocks project CtrlZ inside the dialog; that noncausal route is excluded.

The canonical rack adapter revokes old write authority, while the private numeric parameter presentation retains its held draft after the authored value changes. This differs from primary-release and foreign-cancellation ownership. Strict reproduction, correction and complete corrected public remain pending; effects verified count stays 35. No manual Update AI assets run is required.


The strict actual mounted numeric-parameter owner reproduces the obsolete .46 display after an authored .2 value arrives, while its unchanged-value held-drag control passes before repair. Cancel only a held knob whose authored parameter value changes, clear the obsolete local draft and remount that knob to retire its native capture before a late release. Preserve continuous runtime-only previews, ordinary commit focus and canonical project/write-authority refusal. All 23 new and existing native knob, rack admission, generic adapter authority, cancellation, keyboard and pointer completion controls pass in 1.121 s. The retained fixture proves harmless late release, exactly one cancellation and a successful fresh .26 gesture; the public witness also retains fresh drag and exact Undo/Redo values. Strict fixture/import-closure TypeScript and final targeted type-aware lint pass, with owning source 197 lines. Preliminary mounted missing-selector and explicit JS prop omissions are excluded fixture setup; no API was widened. Canonical changed-file lint is running and corrected whole public remains pending; effects count stays 35. Every consumed focused/type/target-lint log and the temporary narrow compiler configuration is immediately removed. No manual Update AI assets run is required.

Canonical changed-file lint passes both source and all three test shards on the stable current inventory. Its bounded finished log is read and immediately removed. The complete unchanged native Chromium workflow passes on coherent authenticated `dd877d8a8` in 3.4 s (1/1 GREEN, 5.1 s whole run). Healthy authored .4/Undo .2/Redo .4, the actual held .46 draft, CtrlZ restoring both presentations to .2, harmless late release, a fresh .26 gesture and exact Undo/Redo all pass without alerts or client errors. Count the authored-value retirement owner once; effects verified count becomes 36. The consumed bounded public log and exact generated output directory are immediately removed. No manual Update AI assets run is required.

The complete unchanged WebKit linking workflow passes on coherent authenticated `dd877d8a8` in 7.8 s (1/1 GREEN, 9.6 s whole run), one worker and the qualified native Pulse sink. The healthy independent-channel ratio is .0006453853; every original early linked-block ratio remains between .0097825061 and .0102312421, preserving the actual shared-node assertion and all deadlines. No source or behavior assertion changes. This closes the known full-150 ratio observer failure with zero additional roots. Its consumed bounded replay log and exact generated output directory are immediately removed.

## R7-EFFECT-037 — Rate effect musical durations read the tempo at project zero

Soundscaper: import an ordinary three-second recording, save 60 BPM with a 120 BPM event at beat four, and place the recording at four seconds through native Clip properties. Effect → Pitch and tempo → Change tempo or Change speed and pitch: Desired duration two seconds correctly exports an audible 288,000-frame entire-project WAV. Undo restores the original three-second current duration. Set Desired duration to one bar (0011) in its ordinary beats:bars format and Apply: both actual WAVs instead contain 384,000 frames, with healthy RMS .18817/.18823. These two complete native Chromium workflows are causal RED on coherent authenticated `dd877d8a8` in 14.5/14.7 s, after their exact healthy seconds and Undo controls. The actual contexts and PNGs show the accepted later recording and completed effect; their bounded log and exact generated directory are consumed and immediately removed.

This private current/desired-duration consumer interprets elapsed duration through the absolute project-zero musical map instead of the selected interval origin. R6-EFFECT-032 owns millisecond rounding before Samples formatting; FX035 owns the independent warp grid, and the clip-properties duration owner has a separate callback. Group both rate effects and duration presentation/editing manifestations once. Strict reproduction, correction and complete corrected public remain pending; effects verified count stays 36. No manual Update AI assets run is required.

The actual mounted selection-effect surface reproduces four late/cross-tempo percentage mismatches (-25 rather than50/0) while two project-zero and all native seconds controls pass before repair (946.5 ms). Compute the selected timeline interval's elapsed map at the existing dialog boundary, then scope only the private rate current/desired-duration section to it. Preserve independent source-editor clocks, percentage precision/ranges, seconds/sample formats, format-without-write and unrelated effect parameters. All22 new and existing native rate-duration, 44.1/48 kHz Samples, selection completion/project custody and preset controls pass in1.449 s after repair. The new mounted cases include both rate variants and a selection crossing the tempo event. Two preliminary post-repair fixture assertions expected a write for an unchanged duration or queried a native property as an attribute; these setup assertions are excluded. The retained accepted-parameter oracle preserves the original causal mismatch and intentional no-op. Targeted type-aware lint, strict TypeScript for the retained fixture/import closure, all28 semantic chunk-ownership controls and owned whitespace checks pass. Sources remain96/337 lines. Canonical changed-file lint and corrected complete public are pending, so effects count stays36. All consumed focused/type/ownership/target-lint logs and the temporary narrow compiler configuration are immediately removed. No manual Update AI assets run is required.

### Final full-150 WebKit dissolve triage — pending unchanged replay

The completed Solid-adjacency case times out in30.437 s at Edit-menu Enter; the one-frame case times out in31.246 s waiting for the Effect menu. Their exact completed JSON markers, contexts and actual PNGs are consumed. Both screenshots show the imported camera clips and completed rate/property authoring; these later whole-budget failures differ from the previously recorded Firefox media-summary interceptor. No missing transition cause is established. Preserve both complete current workflows and their original30-second budgets for unchanged one-worker native WebKit replay. The two exact completed diagnostic directories are immediately removed. No additional root is counted, and no frozen asset reader remains.

Canonical changed-file lint passes both owning source files and both populated test shards on the stable current inventory. Its bounded completed log is read and immediately removed. FX037 source and unchanged complete physical public witnesses are ready for the next coordinated guarded capture; corrected whole qualification remains pending, effects count36.

Both complete unchanged native Chromium rate workflows pass on coherent authenticated `2b94fdc97`, 12.3 s each (2/2 GREEN, 26.3 s whole run). Desired two seconds and one local bar both deliver exactly288,000 actual WAV frames; Tempo RMS .187844072 and Speed RMS .188229516 remain healthy. Native tempo/placement, restored three-second current duration after Undo, ordinary musical entry and absence of alerts/client errors all pass. Group both private current/desired rate-duration consumers once; effects verified count becomes37. The consumed bounded public log and exact generated output directory are immediately removed. No manual Update AI assets run is required.

Both complete unchanged final WebKit dissolve workflows pass on coherent authenticated `2b94fdc97`, one worker and the qualified native Pulse sink: Solid adjacency22.8 s and one-frame admission13.9 s (2/2 GREEN,38.5 s whole run). Their original30-second individual budgets, native camera/property authoring, actual transition availability, Apply/Remove and Undo behavior are preserved. No source, assertion or deadline change. This closes the final effects-owned full-150 browser failures with zero additional roots; every owned frozen diagnostic and bounded replay output has been consumed and immediately removed.

## R7-EFFECT-038 — Generic effect time parameters inherit an absolute musical clock

Soundscaper: import an ordinary six-second voice recording with a three-second pause, save60 BPM with a120 BPM event at beat four, and place the recording at four seconds. Effect → Special → Truncate Silence: Minimum silence two seconds produces the healthy audible359,997-frame entire-project WAV. Undo, reopen and enter one bar in the same existing time field's beats:bars format. The completed ordinary effect instead retains the entire pause and exports480,000 frames; both actual WAV RMS values remain .200004. The whole native Chromium workflow is causal RED in14.5 s on coherent authenticated `2b94fdc97`. Its exact context and actual PNG show the accepted later recording and retained pause; the bounded log and exact generated output directory are consumed and immediately removed.

The generic numeric effect-parameter owner inherits the absolute project map instead of the selected elapsed-duration map. FX037 supplies that map to its independently implemented rate-duration section; the generic parameter route still omits it. Group all admitted generic elapsed-time parameter manifestations once; strict reproduction, narrow correction and corrected complete public remain pending, effects verified count37. No manual Update AI assets run is required.

Four actual mounted Minimum silence/Truncate to cases reproduce4s rather than2/3s while both origin-zero and every native-seconds control pass before repair (767.0 ms). Pass the selected elapsed map into the generic Audacity numeric-parameter leaf, preserving the inherited fallback when no selection clock is supplied. Keep the original parameter element and its commit metadata visible to specialized layouts; the private rate-duration section still owns its own elapsed map. All28 new generic-duration/physical silence edits and existing rate, native Samples, selection/preset custody controls pass in1.337 s, including both generic parameters and an interval crossing the tempo event. A provisional context wrapper concealed the specialized rate control's commit metadata and was rejected by six existing mounted controls; the final narrow leaf wrapper preserves that contract. Strict retained fixture/import-closure TypeScript, targeted type-aware lint, all28 semantic chunk-ownership controls and owned whitespace checks pass; EffectParameterEditor is455 lines. Canonical changed-file lint and corrected complete public remain pending, effects count37. All consumed focused/type/ownership/target-lint logs and the temporary narrow compiler configuration are immediately removed. No manual Update AI assets run is required.

Canonical changed-file lint passes the populated owning source shard and all three test shards on the stable shared inventory. Its bounded completed log is consumed and immediately removed. The narrow generic time-parameter source and unchanged whole Truncate Silence physical public witness are ready for the next coordinated guarded capture. Corrected qualification remains pending; effects count37.

The complete unchanged native Chromium Truncate Silence workflow passes on coherent authenticated `a3a36854d`,12.8 s (1/1 GREEN,14.3 s whole run). Healthy Minimum silence two seconds and one local bar both deliver exactly359,997 fresh actual WAV frames; RMS .200004006019/.200004006032 remains healthy. Native tempo/placement, Undo, accepted musical entry, completed Apply and absence of alerts/client errors all pass. Group the generic elapsed-time parameter owner once; effects verified count becomes38. The consumed bounded public log and exact generated output directory are immediately removed. No manual Update AI assets run is required.

### Final full-200 verification artifact custody — zero additional roots

The running full-200 reporter removes attached passing artifacts but ordinary manually saved screenshots remain un-attached. Read-only Playwright discovery on frozen `684b0ca893` lists all7,098 cases without executing tests or starting servers. Use the installed worker's exact output formula and core sanitization/trimming helpers: file-relative name without the test extension, reporter titlePath after root/project/file,60-character trim, and exact project ID. All560 observed completed markers match discovery ID/file/title/project. Five concrete leftover passing folders, including both clip-fade recordings, both loop workflows and Macro Manager, match their actual output names exactly. Three shared basenames are the two literal SRT comparison captions in each engine; every alias must complete safely before its directory is eligible. This run has zero retries and repeats.

A temporary external helper tails the active log in bounded64KB UTF-8 chunks, removes only real direct child case directories after every mapped alias completed expected PASS/SKIP without errors and both marker/file clocks are quiet for2s, and preserves failures, incomplete aliases, unknown folders, symlinks and all live `.playwright-artifacts-*` directories. Its private proof passes12 controls covering active/failure history, skipped cases, shared aliases, young files, malformed/mismatched markers, ownership escape and framework custody; proof fixtures/scripts are immediately removed. Actual initial cleanup removes10 completed folders/353,564 logical bytes with zero errors while preserving all four live worker artifact folders. Helper/map/status remain only while the full run needs them, then stop and remove them before final result cleanup. No frozen/source/package changes, test restart or additional bug count; effects verified count38. No manual Update AI assets run is required.

## Full-200 Firefox Mono ADM observation — zero-count triage

The immutable 684b0ca893 full browser run reports the Mono live-analysis
workflow failed in 6.186 seconds at the immediate splitter-width assertion:
actual widths `[2, 2, 2, 2]` did not contain one. The CASE marker is
`f9db700692dd6ca72d78-b76407ebb015369fe93c`. Its PNG and error context were
read: playback peak is −9.0 dBFS, RMS is −12.3 dBFS, and Spectrum visibly
contains the tone. The later fresh FFT-read and raster assertions were not
reached. This observation alone does not prove a signal failure; the native
channel graph and completion timing remain under investigation. The exact
completed failure directory was removed immediately after this receipt.
No bug count or production source changes are made.

The exact unchanged Firefox workflow passes in an isolated one-worker replay
on the same immutable prepared 684 product bytes (8.5 seconds, 11.6 seconds
whole), with the qualified Pulse sink and original deadlines and assertions.
It reaches the mono splitter, fresh FFT-read and signal-raster assertions.
No production failure is reproduced. Its completed output and short log are
removed immediately after recording this evidence.

A bounded passive timing run on those same bytes also passes (7.9 seconds).
Immediately after the second Play click, it records only the four original
stereo splitters and 12 old FFT reads. The new mono graph constructs its first
one-output splitter 12.06 milliseconds later; fresh FFT reads subsequently
rise to 17. Native playback awaits context/worklet/meter preparation, while
the displayed scalar peak remains available from the previous playback.
The width assertion now polls the same required one-output native splitter
within the existing five-second assertion budget; the fresh FFT and physical
peak/raster checks remain. This is an observer completion correction, with
no production changes or additional bug count. The passive temporary spec,
its result directory and log are removed immediately.

The corrected complete Mono workflow passes all three native engines on
unchanged prepared 684 bytes: Chromium 5.8 seconds, Firefox 9.2 seconds and
WebKit 9.3 seconds (3/3). Targeted ESLint and whitespace checks pass. The
completed replay output/log are removed after recording the result.

## Full-200 Firefox Truncate Silence observation — zero-count triage

The immutable full-run CASE `b65fdd47accb60848052-173cd580d22a37a4f40b`
is timedOut at 30.392 seconds under its unchanged 30-second deadline. The
stack points to page.evaluate at exportedRecording line 80 during the second
(musical threshold) export. Actual PNG/context were read: a fresh WAV download
link is present and the edited clip is 3.5 seconds long at its authored
four-second start. Native decoded-audio equality/second RMS assertions were
not reached. The witness transports the entire WAV as an array of JavaScript
numbers before native decoding; no application failure is established by
this timeout alone. The exact completed failure directory is removed after
this receipt; unchanged isolated replay is next. No new bug count.

The exact unchanged isolated Firefox Silence witness also exceeds 30 seconds
at the same second page.evaluate decode boundary (one worker, immutable
prepared 684 bytes and qualified Pulse). Its PNG/context are consumed and
its completed output/log are removed immediately. The fixture changes only
the protocol representation: Node Buffer encodes the downloaded WAV as
base64 and browser atob reconstructs the identical Uint8Array before native
decodeAudioData. Both fresh downloads, both native decodes, exact frame
equality, healthy/causal RMS assertions and the original 30-second deadline
remain. No production source changes or additional bug count.

Corrected Silence whole native workflows pass all three engines on unchanged
prepared 684 bytes: Chromium 9.6 seconds, Firefox 16.3 seconds and WebKit
15.2 seconds, 3/3 in 46.1 seconds whole. Every engine physically decodes
both fresh WAVs to 359997 frames; healthy and musical-window RMS are
approximately 0.200004, and exact frame equality passes. In-memory transport
roundtrip deep-equality also passes for the actual 576044-byte authored WAV;
no files are generated for that control. Canonical lint:changed and whitespace
checks pass. Completed three-engine outputs and its log are removed
immediately. No manual Update AI assets run is required.

## Full-200 WebKit grouped timecode menus — verification-only triage

The immutable full-run CASE `de7c6be71ab2b3ef073a-43d8cb9880ceb9e8104a`
times out at 30.314 seconds under its original 30-second deadline. The local
chooseTimeCodeFormat helper tries to click PAL frames after hovering Video
frames; 40 native actionability retries report the CDDA frames submenu
intercepts the PAL item. The actual PNG/context are consumed: Video frames
and CD frames submenus are both open at the bottom/right viewport edge; the
CD submenu visibly covers the lower Video options. Earlier CD, film and
NTSC values have passed, with duration displayed in 12 digits. Full-run
Chromium and Firefox versions pass (5.0/11.202 seconds). This receipt is
verification-only; no new source root or bug count is inferred. The exact
completed diagnostic directory is removed immediately after recording the
evidence. An unchanged isolated WebKit replay waits for the coordinated
exclusive native cores.

The exact unchanged grouped-formats WebKit workflow passes its isolated
one-worker replay in 7.5 seconds (9.7 seconds whole) on immutable prepared
684 bytes, qualified Pulse and exclusive native cores. The original mouse
hover/click helper succeeds through CD, film, NTSC, PAL and drop-frame
formats, preserving every grouped format, actual digit/value and subsequent
editing assertion under the original 30-second deadline. This is the same
painted pointer route, including Playwright native pointer actionability;
no forced DOM activation or keyboard replacement is introduced. The source
already closes sibling submenus on sibling hover and ordinary pointer exit.
The original full-run simultaneous submenu overlap remains an honest
observation, but does not reproduce in the unchanged complete mouse path.
No fixture or production correction is made, and no bug count is added.
The completed replay directory and log are immediately removed.

## Full-200 WebKit live continuity observations — verification-only triage

The actual completed CASE markers, PNGs and contexts for three original
WebKit continuity workflows are consumed before their exact directories
are immediately removed. Graphic EQ (`f3e65648f5eeb37a20a6-4430b3cbdb9e87c155fb`,
10.247 seconds) passes its healthy PCM and accepts the 1000 Hz band at one
decibel, then the unchanged all-blocks minimum assertion reads
0.00008889195858696451 instead of greater than 0.2. Its final image shows
ongoing playback and positive master meters. Click Removal
(`6da8e49b00825ad4a939-5ad2f45766df48a075d5`, 12.319 seconds) fails its
pre-edit five-second healthy PCM poll: the actual page is stopped at zero
and reports “The streamed and buffered sources missed their shared playback
start.” Its threshold remains 200; no threshold-edit continuity assertion
is reached. Compressor (`12fb7fc9d7209f8bd680-37fdb0d5b2e27c438dc7`,
12.044 seconds) passes healthy PCM and accepts release 101 ms with unchanged
200 ms lookahead, then its unchanged all-blocks minimum is zero instead of
greater than 0.2. Its image shows positive meters and a transient gap in the
plot. These are original full-run failures, with no cause inferred yet.
No assertions, deadlines, fixtures or production source are changed. The
exact unchanged isolated WebKit workflows await the coordinated exclusive
native lane. No additional bug count.

All three complete unchanged WebKit continuity replays pass on immutable
prepared 684 bytes, one worker, qualified Pulse and exclusive native cores:
Click Removal 8.3 seconds, Compressor 9.1 seconds and Graphic EQ 8.3 seconds
(3/3, 27.9 seconds whole). Before/after entire-block minimum RMS values are
respectively 0.2960850682/0.2960858629, 0.2960850682/0.2960850683 and
0.2960874509/0.2960858749; every post-edit observed window has zero frames
below 0.01. All original healthy PCM, accepted parameter, elapsed-clock,
all-blocks physical continuity assertions and 30-second/five-second budgets
remain unchanged. The original aggregate failures remain recorded. These
isolated passes do not establish their cause and are not evidence for a
production repair; no source or fixture changes and no additional root are
made. After worker/server closure, the bounded replay log and generated
results are immediately removed. No manual Update AI assets run is required.
