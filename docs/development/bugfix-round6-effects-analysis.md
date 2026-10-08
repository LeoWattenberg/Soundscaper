# Round six: effects and analysis

Only distinct normal-user-path defects qualify. Earlier roots, unsupported
operations, adversarial inputs and unavailable internal actions are excluded.

## R6-EFFECT-001 — A one-symbol DTMF draft resets the authored duty cycle

Open Generate → DTMF tones, set Duty cycle to 50%, replace Sequence with `1`,
then enter `123`. The baseline changes Duty cycle to 100% and removes every
inter-tone pause. A temporary sequence draft should preserve the authored
ratio. Retain that setting independently of the derived zero gap for one tone.

The ordinary Chromium baseline fails with expected 50 and displayed 100 after
the single-symbol edit (`/tmp/soundscaper-r6-effects-dtmf-red.log`). The mounted
production dialog fails the same assertion before correction; after correction
it retains 50% and sends six-second tones and pauses for the original 30-second
request. Focused generator cases pass 3/3. Ordinary Chromium passes 1/1 on
the first immutable green snapshot
(`/tmp/soundscaper-r6-effects-dtmf-green1-final.log`).

This is independent of earlier total-duration, numeric-draft and native-sample
admission roots: their admitted durations remain unchanged.

## R6-EFFECT-002 — Selecting an EQ preset leaves its editable preview unchanged

Import an ordinary recording, select its header, open Effect → EQ and filters
→ Parametric EQ, save a preset with Output gain −12 dB, return Output gain to
0 dB, start Preview and select the saved preset. The visible gain returns to
−12 dB while the playing processor retains 0 dB. Reconfigure the existing live
preview through the same path as ordinary parameter edits.

The ordinary Chromium baseline completes import, save, preview and preset
selection, then fails because no −12 dB configuration reaches the preview
worklet (`/tmp/soundscaper-r6-effects-eq-preset-red.log`). A read-only native
message observer forwards every packet unchanged; it neither alters the
project nor supplies audio. The owning-service regression fails with zero
configuration calls before correction. All 17 combined effect-control and
generator cases pass after correction, with targeted type-aware lint passing.
All three EQ/spectral browser cases pass on immutable checkpoint `48e4cbe22`
(`/tmp/soundscaper-round6-green3-browser.log`).

## R6-EFFECT-003 — Independent tempo changes transpose spectral center snapping

Import an ordinary 512 Hz mono recording, open Clip properties → Pitch and
tempo, keep Link pitch and tempo unchecked and set Speed ratio to 2. Open
its track menu → Track visualization → Spectrogram. Select all, then
Spectrogram options → Select spectral frequency range; select 100–300 Hz
and drag the center-frequency handle. The baseline snaps to 1024 Hz although
independent tempo preserves the recording's 512 Hz pitch. Read the actual
source sample clock for independent playback, retaining authored pitch shifts
and the linked playback rate.

The ordinary Chromium baseline accepts the supported speed edit without an
alert, paints its spectrogram and fails at displayed 1024 instead of 512
(`/tmp/soundscaper-r6-effects-spectral-peaks-red.log`). The strict native-rate
case fails before correction; all ten new and existing peak/center cases pass
afterward, including linked speed, repeats and split phases. Ordinary Chromium
passes on immutable checkpoint `48e4cbe22`. This is a separate frequency-analysis consumer from the
earlier source-tempo authored playback correction.

## R6-EFFECT-004 — Surround spectral snapping ignores sounding later channels

Import an ordinary six-channel WAV containing a center-channel tone, with
silent front-left and front-right channels. Through the same track/spectrogram
menus, select a frequency band and drag its center handle. The baseline does
not find the recording's 512 Hz peak: it leaves the center at the pointer's
800 Hz. Both the source-channel extraction and FFT reducer discard channels
after the first two. Average independent channel power across the admitted
recording's channels; all FFT windows and clip limits remain bounded.

The ordinary Chromium baseline completes import, spectrogram paint and band
authoring, then fails at 800 instead of 512. The strict third-channel case
fails before correction and passes afterward with all ten focused cases.
Ordinary Chromium passes on immutable checkpoint `48e4cbe22`. The independent-frequency clock defect
in 003 also reproduces with mono, and this omission reproduces at native speed.

## R6-EFFECT-005 — A first lower-only macro spectral selection is rejected

Import an ordinary recording, select its header, open Tools → Macros palette
→ New program and run `await sound.select.frequencies({low:500});`. No earlier
spectral selection exists, so its unspecified upper edge should retain the
recording's full project bandwidth. The baseline constructs 500–0 Hz and the
public selection validator rejects the program. Use project Nyquist for the
omitted upper edge when no frequency band has been authored.

The ordinary Chromium baseline fails at the first program line with
“Selection frequency range is outside the project bandwidth”
(`/tmp/soundscaper-r6-effects-macro-upper-browser-red.log`). The strict focused
case fails with upper edge zero instead of 24,000 Hz. It passes after correction
with all twelve focused command cases and targeted type-aware lint. Ordinary
Chromium passes on immutable checkpoint `e13343495`, including visible 500 and
24,000 Hz frequency fields after a real Ctrl+A time selection
(`/tmp/soundscaper-r6-effects-macro-upper-browser-green5.log`). Header-only
selections also complete the program; their zero time span is omitted from
the dialog snapshot. Existing spectral bands retain their omitted edge;
this admission defect is independent of earlier header-target and frequency
preservation roots.

## R6-EFFECT-006 — Authored warp segments snap to their unwarped frequency

Import an ordinary four-second 512 Hz mono WAV at 8192 Hz. Through Effect →
Pitch and tempo → Audio warp and transients, create an identity map and add
its midpoint with Outer position 96,000 and Source sample 24,576. The first
segment plays at 768 Hz; the second plays at 256 Hz. Switch the track to
Spectrogram, select all and author a 100–300 Hz band. Drag its center toward
800 Hz: the baseline snaps to the source's unwarped 512 Hz.

The ordinary Chromium baseline first exports WAV through File → Export and
verifies its audible 768 Hz component exceeds 0.1 while the 512 Hz component
is below 0.01. Its supported map, real PFFFT paint and handle drag then fail
at 512 instead of 768 (`/tmp/soundscaper-r6-effects-spectral-warp-browser-red2.log`).
The initial run stopped at the five-second PFFFT setup budget; preserve it
separately. The second run extends only that slow setup wait and fails the
unchanged snapping assertion. The strict case verifies the production exact
warp renderer's 768 Hz peak before its baseline snap assertion fails.

Use the shared production warp segment evaluator for both source ranges and
local audible frequency. Sample at most three segments per clip, retaining
the bounded FFT windows. All eleven focused spectral cases pass and targeted
type-aware lint passes. Ordinary Chromium passes on immutable checkpoint
`e13343495` (`/tmp/soundscaper-round6-green4-browser.log`). This is an
independent authored-map projection branch from unlinked uniform tempo in
003; its exported pitch is independently verified rather than inferred.

## R6-EFFECT-007 — Toggling a spectral band broadens its selected clip target

Import ordinary 440 Hz and 880 Hz mono WAVs. Move the second recording onto
the first track with its existing Preserve time menu action. Enable Spectrogram,
select only the 440 Hz recording with Enter, and author a 100–1000 Hz band in
Spectrogram options → Select spectral frequency range. Choose Select → Spectral
→ Spectral selection twice, then reopen the band dialog and apply its default
6 dB Spectral Amplify. The baseline also raises the unselected 880 Hz recording:
its exported amplitude becomes 1.995 times its original value.

The frequency-only toggle omits durable clip IDs on both its removal and
restoration branches. The public selection setter then clears those IDs,
turning the same time span into a complete track target. Retain the authored
clip targets alongside the unchanged time and track selection.

The strict regression fails at empty clip IDs before repair. The immutable
public workflow fails at the downloaded neighbor's amplitude, after proving
the selected recording was amplified (`/tmp/soundscaper-r6-effects-spectral-toggle-browser-red2.log`).
An earlier click on an obscured overlapping header timed out; the final workflow
uses the supported clip focus/Enter path, and that setup failure is excluded.
All seven new/existing spectral/tool action regressions pass after repair
(`/tmp/soundscaper-r6-effects-spectral-toggle-node-green.log`). Public GREEN is
pending the next immutable product build. This toggle adapter is independent
of the earlier macro frequency command's retained-target correction.

These corrections do not change the assistance runtime closure or require a
manual **Update AI assets** run.
