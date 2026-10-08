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
Browser green verification pending.

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
afterward, including linked speed, repeats and split phases. Browser green
verification pending. This is a separate frequency-analysis consumer from the
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
Browser green verification pending. The independent-frequency clock defect
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
with all twelve focused command cases and targeted type-aware lint. Browser
green verification pending. Existing spectral bands retain their omitted edge;
this admission defect is independent of earlier header-target and frequency
preservation roots.

These corrections do not change the assistance runtime closure or require a
manual **Update AI assets** run.
