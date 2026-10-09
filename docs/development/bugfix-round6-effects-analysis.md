# Round six: effects and analysis

Only distinct normal-user-path defects qualify. Earlier roots, unsupported
operations, adversarial inputs and unavailable internal actions are excluded.

R6-EFFECT-001–011 pass their ordinary public workflows in Chromium, Firefox and
WebKit on immutable Green7 `e139818a9`
(`/tmp/soundscaper-round6-checkpoint50-round6-browser.log`). Firefox uses the
repository's qualified CI audio null sink. R6-EFFECT-012 remains pending public
GREEN on a later build and is not yet counted. R6-EFFECT-013 has focused GREEN
and remains pending public GREEN as well, as does R6-EFFECT-014.

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
The unchanged EQ preset workflow also passes WebKit on `c85e613cf` and Firefox
on the repository's qualified CI null sink. Its first Firefox run stalled
before preset selection because the inherited WSLg audio context never resumed;
the existing clock probe independently confirms zero advancement and four
timed-out resumes. The existing null sink advances 0.053 seconds with restarts
at most 38 ms, and all three unchanged realtime EQ/Bin/recording checks then
pass (`/tmp/soundscaper-r6-effects-io-firefox-null-sink-green5.log`). No browser
assertion, deadline or source change was made for that environment correction.

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

## R6-EFFECT-007 — A clip-authored spectral band broadens its effect target

Import ordinary 440 Hz and 880 Hz mono WAVs. Move the second recording onto
the first track with its existing Preserve time menu action. Enable Spectrogram,
select only the 440 Hz recording with Enter, and author a 100–1000 Hz band in
Spectrogram options → Select spectral frequency range. Reopen the band dialog
and apply its default 6 dB Spectral Amplify, with or without toggling Select →
Spectral → Spectral selection off/on first. Both baseline paths also raise the
unselected 880 Hz recording: its exported amplitude becomes 1.995 times its
original value.

The band needs a positive display range alongside its durable clip targets.
The effects adapter passes both into the general editing resolver, whose normal
positive-time precedence discards clip targets. Preserve the band's exact clip
scope in effect admission without changing ordinary time-selection precedence.
The frequency-only toggle also omits durable clip IDs on removal/restoration;
retain those IDs through the public selection setter. These are one public
clip-band targeting correction, with no additional count for the toggle support.

The initial strict toggle repair alone passed but the immutable Green6 public
workflow still failed in all three engines. The final control omits toggling
entirely and remains causally RED at the downloaded neighbor's amplitude,
after proving the selected recording was amplified
(`/tmp/soundscaper-r6-effects-spectral-clip-admission-browser-red.log`). Its
regression through the actual production editing resolver independently fails
at a missing exact clip target; ordinary time-selection and retained-toggle
controls pass (`/tmp/soundscaper-r6-effects-spectral-clip-admission-node-red.log`).
An earlier click on an obscured overlapping header timed out; the final workflow
uses supported clip focus/Enter and that setup failure is excluded. All 26
new/existing target-selection and spectral/tool action regressions pass after
admission repair (`/tmp/soundscaper-r6-effects-spectral-clip-admission-node-green.log`).
Targeted type-aware lint and strict types pass. Both exported-audio workflows
pass in all three engines on Green7 `e139818a9`. This effects-admission owner is independent of the
earlier macro frequency command's metadata correction.

## R6-EFFECT-008 — Macro effects overwrite frequencies outside the authored band

Import an ordinary mono WAV containing 1 kHz and 6 kHz tones. Select all, enable
Spectrogram and author a 900–1100 Hz band. Tools → Macros palette → New program:
run `await sound.effect('audacity-amplify', {gainDb:-12, allowClipping:true});`.
The baseline attenuates the 6 kHz tone too, although its frequency is outside
the band. The exported amplitude changes by 0.10589 instead of remaining within
0.001 of its original value.

The independently owned macro runner never supplies spectral context to its
offline workers or composes its realtime rack output. Resolve the authored band
for each actual target, apply it to each offline effect, and compose each
realtime step through the existing lazy spectral primitive. Each step receives
the preceding step's unchanged unselected bins, including chains with nonlinear
detectors. Keep the existing full-band Parametric EQ policy; refuse unsupported
length-changing steps before async ownership or publication. Preserve the
context-free batching port for unbanded audio and account for spectral FFT
scratch in peak admission.

The immutable public workflow is causally RED at the delivered unselected
6 kHz tone (`/tmp/soundscaper-r6-effects-macro-spectral-browser-red.log`). Actual
DSP service regressions separately fail for offline Amplify, realtime Invert,
mixed Amplify/Invert and length-changing Repeat; a double-Invert control passes
before repair (`/tmp/soundscaper-r6-effects-macro-spectral-node-red2.log`). All
31 new/existing macro and spectral compositor regressions pass after repair,
including per-step realtime inputs, context-free batch isolation, input PCM
immutability and one result publication
(`/tmp/soundscaper-r6-effects-macro-spectral-node-green2.log`). Targeted
type-aware lint passes. The unchanged public workflow passes Chromium, Firefox
and WebKit on immutable Green6 `1a269a3fa`
(`/tmp/soundscaper-round6-green6-browser-all-engines.log`).
Offline/realtime/chain variants share this one macro targeting root; the earlier
reviewed-effect dispatcher repair never owned this macro service.

## R6-EFFECT-009 — Separately generated noise layers replay the same recording

Create an Audio track with Tracks → Add new track → Audio track. Generate →
Noise, amplitude 0.2, duration one second; export its WAV. Create another Audio
track and independently generate noise with those same normal settings. Export
the two-track mix. Its power is 3.99999998 times the first recording's power:
the supposedly independent layers are copies, adding 6 dB instead of the
approximately 3 dB expected from independent noise. A separate normal Generate,
export, Undo, Generate, export workflow also measures correlation 1 between the
two complete audible recordings. The UI has no seed or repeat-recording choice.

The generator restarts every unseeded job from one fixed PRNG seed. Draw one
fresh seed at job construction, retaining the existing bounded PRNG and its
per-channel and per-block state. Explicit seed requests keep their exact
reproducible output.

The strict independence regression is RED while the explicit seed/block-boundary
control passes (`/tmp/soundscaper-r6-effects-noise-independent-node-red.log`).
The immutable downloaded-recording and two-track-mix workflows are causally RED
at correlation 0.9999999999999423 and power ratio 3.9999999809979605 respectively
(`/tmp/soundscaper-r6-effects-noise-independent-browser-red.log` and
`/tmp/soundscaper-r6-effects-noise-layers-browser-red2.log`). An earlier layer
fixture used a spinbutton locator for a text input and is excluded. All 23
new/existing generator, streaming and worker regressions pass after repair
(`/tmp/soundscaper-r6-effects-noise-independent-node-green.log`). Both unchanged
public workflows pass Chromium, Firefox and WebKit on immutable Green6
`1a269a3fa` (`/tmp/soundscaper-round6-green6-browser-all-engines.log`).
All noise colors use the same job-seed
root; the earlier pink-noise spectral balance correction is independent.

## R6-EFFECT-010 — A linked Truncate Silence macro removes different track pauses

Import ordinary two-second mono dialogue recordings with pauses at 0.3–1.3
and 0.7–1.7 seconds. Shift-select both clip headers. Tools → Macros palette →
New macro → Add effect → Truncate Silence. Open its settings, leave Truncate
tracks independently unchecked and set Truncate to zero. Run macro, select all
and export WAV. The baseline reports completion but delivers 0.99977 seconds
instead of 1.4: each microphone loses its own full pause rather than their
shared 0.6-second pause.

The macro service unconditionally runs each complete chain on one target.
Partition its chains at linked silence detection, process aligned tracks
together at that barrier, and restore their exact channel ownership before
continuing each track's effects. Preserve independent requests, unaligned clip
targets, per-track prefix/suffix effects and one final atomic result batch.

The unchanged normal menu workflow is causally RED at its delivered duration
(`/tmp/soundscaper-r6-effects-macro-linked-truncate-browser-red.log`). Four
actual-DSP service regressions fail for a single barrier, multiple barriers,
prefix/suffix effects and mixed mono/stereo ownership, while independent and
unaligned controls pass
(`/tmp/soundscaper-r6-effects-macro-linked-truncate-node-red.log`). All 32
new/existing macro service, stereo-truncation and spectral-targeting regressions
pass after repair (`/tmp/soundscaper-r6-effects-macro-linked-truncate-node-green.log`).
Targeted type-aware lint, strict types and the file-size gate pass. The exported
shared-pause duration passes in all three engines on Green7 `e139818a9`.
R3-ROOT-018 corrected the ordinary
effect/Preview joint-job admission; R3-ROOT-019's macro follow-through corrected
the separate per-channel independence flag. This macro-service multi-track
barrier owner remained independent of both.

## R6-EFFECT-011 — Nyquist counts selected clips as separate selected tracks

Import an ordinary mono WAV, split it at its midpoint with the Split tool, and
Shift-select both clip headers on their one audio track. Tools → Nyquist prompt:
run `(format nil "selected-tracks=~a" (length (get '*selection* 'tracks)))`.
The baseline reports `selected-tracks=2` for both evaluations although only one
track is selected. Scripts that require exactly one selected track consequently
refuse the selection. The [Audacity plug-in reference](https://plugins.audacityteam.org/contributing/developing-your-own-plugins-and-scripts/creating-your-own-nyquist-plugins/plugin-reference)
defines this property as the list of selected audio track numbers.

The host adds an owning track number for each effect target without removing
duplicates. Deduplicate those numbers while retaining native Source ownership,
distinct track entries and their existing evaluation order.

The unchanged ordinary browser workflow is causally RED at the real Nyquist
output (`/tmp/soundscaper-r6-effects-nyquist-selected-tracks-browser-red.log`).
The strict host regression separately fails with `[1,1]` instead of `[1]`,
while fourteen controls pass
(`/tmp/soundscaper-r6-effects-nyquist-selected-tracks-node-red.log`). All twenty
new/existing host, native source-bound and source-tempo cases pass
after repair, including distinct owning tracks
(`/tmp/soundscaper-r6-effects-nyquist-selected-tracks-node-green.log`). Strict
types and targeted type-aware lint pass. The ordinary split-clip Nyquist output
passes in all three engines on Green7 `e139818a9`. Earlier
native Source clock, tempo and clip-bound corrections concern independent
metadata owners.

The same track-identity boundary also exposes `TRACK.INDEX` as an effect-target
number. With those two header-selected clips, run
`(mult *track* (get '*track* 'index))` through the normal Nyquist prompt and
export WAV. The second clip gains 6 dB although it belongs to the same first
track. The public exported-PCM regression reports a second/first amplitude
ratio of `2.000000009` instead of one
(`/tmp/soundscaper-r6-effects-nyquist-track-index-browser-prompt-red2.log`).
Derive INDEX from the same distinct owning-track list, preserving the
untargeted fallback. Two strict host cases are RED before repair
(`/tmp/soundscaper-r6-effects-nyquist-track-index-node-red.log`); all sixteen
host cases pass afterward
(`/tmp/soundscaper-r6-effects-nyquist-track-index-node-green.log`). Two ordinary
Crossfade Tracks workflows passed before this follow-through and remain a
control, rather than causal evidence. An initial prompt fixture waited for a
status string instead of its actual frame output and is excluded. Strict
types, targeted lint and size checks pass; the new PCM workflow awaits public
GREEN on the next immutable build. This is follow-through of R6-EFFECT-011,
with no additional root counted.

## R6-EFFECT-012 — Nyquist generators do not replace all selected recordings

Import two ordinary one-second mono recordings containing 1 kHz and 2 kHz
tones. Shift-select both clip headers, or select all to create a positive time
range across both tracks. Generate → Nyquist → Risset Drum: set Decay to one
second and Amount of noise to zero, apply, and export WAV. The baseline leaves
the original tones audible: a header selection inserts another clip, and a
time range replaces only the focused track.

The generated-audio publisher admits only a positive active selection and one
focused target. Resolve timeline clip selections and publish the generated
channels through the existing atomic plural effect-result owner, preserving
each track's channel width and one Undo. Keep insertion without a selection and
native Source focus behavior unchanged; check storage before copying output.
Header and range variants are one selection-admission defect in this publisher.

Both unchanged menu workflows fail causally at the delivered 1 kHz amplitude,
about 0.1414 instead of below 0.005
(`/tmp/soundscaper-r6-effects-nyquist-generator-targets-browser-red.log`,
`/tmp/soundscaper-r6-effects-nyquist-generator-ranges-browser-red.log`). Two
strict regressions fail at the missing plural replacement while seven controls
pass (`/tmp/soundscaper-r6-effects-nyquist-generator-targets-node-red.log`). The
79 focused generated-audio, Nyquist controller/host, duration, native-generator,
effect-result and native Source metadata cases pass after repair, including
insertion and Source-focus controls
(`/tmp/soundscaper-r6-effects-nyquist-generator-targets-node-green2.log`). Strict
types and targeted type-aware lint pass. Public GREEN awaits the next immutable
product build; its assertions check both replaced tones and both originals
restored by one Undo. R3-ROOT-017 and EDIT012 concern the independently owned
native-generator adapter and allocator, respectively.

## R6-EFFECT-013 — An advertised Contrast macro silently reports success

Import an ordinary WAV, Select all, Tools → Macros palette → New program, and
run `await sound.command('ContrastAnalyser');`. The macro-program reference
advertises this as a supported parameterless analysis command. The baseline
reports `Program applied.` without taking any Contrast measurement. The
required foreground/background role is absent, and the ordinary analysis task
wrapper handles that error instead of rejecting the macro call.

Mark this interactive registry entry non-runnable, omit it from the executable
command inventory and correct its handbook advertisement. Refuse it before
invoking analysis. Preserve legacy step normalization, complete saved-library
loading and export, so an earlier saved macro cannot make its library unreadable.
The normal Analyze → Contrast dialog retains explicit foreground/background
measurements. The role omission and false completion report share this one
command admission correction; they are not counted separately.

The ordinary typed-program browser workflow is causally RED: it completes but
never reaches its catch log with an unsupported-command refusal
(`/tmp/soundscaper-r6-effects-macro-contrast-admission-browser-red.log`). Two
strict catalogue/dispatch regressions independently fail before correction
(`/tmp/soundscaper-r6-effects-macro-contrast-admission-node-red.log`). All 45
focused command, controller, macro-library and program cases pass after repair
(`/tmp/soundscaper-r6-effects-macro-contrast-admission-node-green.log`). The
follow-up existing-library preservation control also passes
(`/tmp/soundscaper-r6-effects-macro-contrast-admission-preservation-green.log`).
Strict types, targeted type-aware lint and the file-size gate pass. Public GREEN
awaits the next immutable product build; its ordinary Contrast measurement
controls check that the supported menu workflow remains intact.

## R6-EFFECT-014 — A macro selection command uses another Audacity command's name

Import an ordinary WAV, click its waveform to put the playhead inside it,
select its header and open Tools → Macros palette → New program. Set a
cursor-only selection with `sound.select.time`, then run
`sound.command('SelTrackStartToCursor')`. The baseline rejects this canonical
command although Select → Region → Track start to cursor implements its action.
Conversely, `SelCursorStoredCursor` is accepted and silently changes the range
to track-start–playhead, although that name means a separate stored-cursor
selection. The [pinned upstream Select menu source](https://raw.githubusercontent.com/audacity/audacity/5ef610ed23260d6d648175735bb16b32536eb30b/src/menus/SelectMenus.cpp)
registers those two separate meanings.

Bind the implemented action to `SelTrackStartToCursor` and correct the handbook
inventory. Preserve the earlier misnamed descriptor for saved-step parse/export,
but refuse executing it because this editor has no stored-cursor action. These
canonical rejection and unrelated-range manifestations share one name/path
mapping correction; no extra roots are counted per registry constant.

Both ordinary typed-program variants are causally RED
(`/tmp/soundscaper-r6-effects-macro-track-start-command-browser-red2.log`): the
canonical command fails, while the legacy one reports completion with range
0–19200 instead of preserving the cursor-only range. An initial fixture changed
the selection without moving the independent playhead; that setup is excluded
and the final workflow establishes it with a normal waveform click. Two strict
registry/dispatch cases independently fail before repair
(`/tmp/soundscaper-r6-effects-macro-track-start-command-node-red.log`). All 37
new/existing command, library, controller and program cases pass after repair
(`/tmp/soundscaper-r6-effects-macro-track-start-command-node-green.log`). Strict
types, targeted type-aware lint and the file-size gate pass; public GREEN awaits
the next immutable product build.

These corrections do not change the assistance runtime closure or require a
manual **Update AI assets** run.
