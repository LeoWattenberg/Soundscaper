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
