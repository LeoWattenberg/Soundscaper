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
of the authored 0.249962. Root owns their pending corrected browser verification.
Small PCM stays in memory and no verification fixture
or raw coverage is written. No AI runtime asset update is required.

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
samples instead of more than 48,128. Corrected public verification is pending.
PCM stays in memory; no generated verification files are retained. Assistance
runtime assets are unchanged.
