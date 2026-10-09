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
build/run and final evidence). Browser verification is pending.

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
verification is pending. The one four-second input occupies under one MiB in
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
`audio-editor-round7-classic-filter-tail.spec.js`; root owns its pending browser
verification. All small PCM fixtures live in memory and create no disk files.
No AI runtime asset update is required.
