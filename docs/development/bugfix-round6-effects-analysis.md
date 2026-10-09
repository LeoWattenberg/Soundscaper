# Round six: effects and analysis

Only distinct normal-user-path defects qualify. Earlier roots, unsupported
operations, adversarial inputs and unavailable internal actions are excluded.

R6-EFFECT-001–011 pass their ordinary public workflows in Chromium, Firefox and
WebKit on immutable Green7 `e139818a9`
(`/tmp/soundscaper-round6-checkpoint50-round6-browser.log`). Firefox uses the
repository's qualified CI audio null sink. R6-EFFECT-012–014 pass their complete
ordinary workflows in all three engines on immutable Green9 `81a707b96`
(`/tmp/soundscaper-round6-green9-public-browser.log`), bringing this register to
fourteen verified roots.
R6-EFFECT-015–016 and the INDEX follow-through of R6-EFFECT-011 pass all three
engines on immutable Green10 `68655eafb`
(`/tmp/soundscaper-round6-green10-public-browser.log`), bringing this register to
sixteen verified roots. The INDEX follow-through adds no root.
R6-EFFECT-017–018 pass their complete normal workflows in all three engines on
immutable Green11 `a870804cd`
(`/tmp/soundscaper-round6-green11-public-browser.log`), bringing this register to
eighteen verified roots. R6-EFFECT-019 passes its complete ordinary carrier
comparison in all three engines on immutable Green12 `8d9d45ff4`
(`/tmp/soundscaper-round6-green12-public-browser.log`), bringing this register to
nineteen verified roots. R6-EFFECT-018's dependent tail-estimator repair is
included in that snapshot. R6-EFFECT-020 passes Chromium/WebKit on immutable
Green13 `3dfdeb038` and
the unchanged Firefox retry on the same assets
(`/tmp/soundscaper-r6-effects-bitcrusher-hold-boundary-green13-firefox-retry.log`),
bringing this register to twenty verified roots. R6-EFFECT-021 passes its complete
ordinary Source/menu/Apply/WAV workflow in all three engines on immutable
Green14 `756da708e`
(`/tmp/soundscaper-round6-green14-public-browser.log`), bringing this register to
twenty-one verified roots. R6-EFFECT-022 passes both complete normal Chromium
workflows on immutable Green15 `de04b82c9`
(`/tmp/soundscaper-round6-green15-public-browser.log`), bringing this register to
twenty-two verified roots; Firefox/WebKit verification remains pending after
the retained failed runs. R6-EFFECT-023 passes its complete normal Chromium
workflow on immutable Green16 `9bd6730b2`
(`/tmp/soundscaper-r6-effects-legacy-compressor-green16-float-export.log`),
bringing this register to twenty-three verified roots. R6-EFFECT-024–025 pass
their complete normal Chromium workflows on immutable Green17 `449787703`
(`/tmp/soundscaper-round6-green17-chromium.log`), bringing this register to
twenty-five verified roots. R6-EFFECT-026–027 pass both complete normal
Chromium tone workflows on immutable Green18 `d7cb58183`
(`/tmp/soundscaper-round6-green18-chromium.log`), bringing this register to
twenty-seven verified roots. R6-EFFECT-028 passes its complete normal Chromium
Echo playback/edit workflow on immutable Green19 `18a33ffa1`
(`/tmp/soundscaper-round6-green19-chromium.log`), bringing this register to
twenty-eight verified roots. R6-EFFECT-029 passes both complete normal Chromium
Warp quantization/groove workflows on immutable Green20 `0b272a361`
(`/tmp/soundscaper-round6-green20-chromium.log`), bringing this register to
twenty-nine verified roots. R6-EFFECT-030 passes both complete normal Chromium
short-selection/refusal/recovery workflows on immutable Green22 `e2e2b5112`
(`/tmp/soundscaper-r6-effects-spectrum-short-selection-browser-green22.log`),
bringing this register to thirty verified roots.

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
types, targeted lint and size checks pass. The complete prompt PCM and Crossfade
controls pass Chromium, Firefox and WebKit on immutable Green10 `68655eafb`
(`/tmp/soundscaper-round6-green10-public-browser.log`). This is follow-through of R6-EFFECT-011,
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
types and targeted type-aware lint pass. Both ordinary workflows pass Chromium,
Firefox and WebKit on immutable Green9 `81a707b96`
(`/tmp/soundscaper-round6-green9-public-browser.log`), checking both replaced
tones and both originals restored by one Undo. R3-ROOT-017 and EDIT012 concern the independently owned
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
Strict types, targeted type-aware lint and the file-size gate pass. The complete
ordinary program and Contrast measurement controls pass Chromium, Firefox and
WebKit on immutable Green9 `81a707b96`
(`/tmp/soundscaper-round6-green9-public-browser.log`).

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
types, targeted type-aware lint and the file-size gate pass. Both ordinary
program variants pass Chromium, Firefox and WebKit on immutable Green9
`81a707b96` (`/tmp/soundscaper-round6-green9-public-browser.log`).

These corrections do not change the assistance runtime closure or require a
manual **Update AI assets** run.

## R6-EFFECT-015 — An open generator ignores a normal editing lease takeover

Import an ordinary WAV and wait for autosave, then open Generate → Tone. Open
the same editor in a second normal tab so it acquires the saved project's
editing lease. The first editor becomes read-only, but its existing generator
still offers Generate. Its handler admits the operation and closes the draft
after the domain correctly refuses generation, giving no generated result.

Pass the current workspace snapshot to the generator dialog. Use the existing
canonical editing-block selector for the footer and shared form/button handler,
preserving ordinary generation, pending-job ownership and cancellation. The
live lease and other canonical editing blockers share this one missing dialog
admission boundary; no extra roots are counted per state or generator type.

The unchanged actual second-tab workflow is causally RED at the enabled
Generate button after the editor reports `read-only`
(`/tmp/soundscaper-r6-effects-generator-live-lease-browser-red.log`). The strict
mounted production dialog separately fails before repair
(`/tmp/soundscaper-r6-effects-generator-live-lease-node-red.log`). After repair,
all twelve new/existing lease, pending, DTMF draft, duration and generator
presentation cases pass, including both blocked native form/footer handlers,
restored editable admission and available Cancel
(`/tmp/soundscaper-r6-effects-generator-live-lease-focused-green.log`). Focused
strict types, targeted type-aware lint and the file-size gate pass. Public
GREEN passes in Chromium, Firefox and WebKit on immutable Green10 `68655eafb`
(`/tmp/soundscaper-round6-green10-public-browser.log`). No assistance runtime assets
change and no manual **Update AI assets** run is required.

## R6-EFFECT-016 — An explicitly empty macro track selection retains an edit target

Import an ordinary WAV, open Tools → Macros palette → New program, and run
`await sound.select.all();` followed by
`await sound.select.tracks({track: 0, trackCount: 100, mode: 'remove'});`.
The documented read API reports zero selected tracks. A subsequent
`await sound.command('Delete');` nevertheless removes the recording. The
unchanged native Select → Tracks → No tracks → Edit → Delete → Delete control
preserves it.

The macro selection adapter publishes empty track IDs but retains the focused
track, which supplies a valid fallback to the existing edit dispatcher. Native
No tracks also clears that focus. After an explicitly empty track-change
command, reuse the existing native action, retaining the exact time and
frequency range. Ordinary nonempty track commands and unrelated unscoped time
commands keep their existing focus behavior. No global selection schema or
run-local shadow state is introduced. Remove-all, zero-count and out-of-range
track selections share this one publication owner.

The actual ordinary macro and native-control comparison is causally RED at
one deleted recording versus one preserved recording, while the native control
passes
(`/tmp/soundscaper-r6-effects-macro-empty-tracks-browser-control-red.log`). Three
strict cases using the real native navigation service independently fail
before repair, with two controls passing
(`/tmp/soundscaper-r6-effects-macro-empty-tracks-node-red.log`). All forty-four
new/existing macro command, actual-controller selection, spectral/time edges,
Select All and native navigation cases pass afterward
(`/tmp/soundscaper-r6-effects-macro-empty-tracks-node-green.log`). Focused strict
types, targeted type-aware lint and the size gate pass. Both complete native
and macro workflows pass Chromium, Firefox and WebKit on immutable Green10
`68655eafb` (`/tmp/soundscaper-round6-green10-public-browser.log`). The earlier EDIT-010 dispatcher correction
remains intact; this independently implemented macro publication adapter must
retire the focus it previously preserved. No assistance runtime assets change
and no manual **Update AI assets** run is required.

## R6-EFFECT-017 — Sliding Stretch previews compress the selected pitch and tempo ramps

Import an ordinary twelve-second 440 Hz WAV, select its header, open Effect →
Pitch and tempo → Sliding stretch, set Final pitch shift to twelve semitones,
and use Preview followed by Apply to selection and WAV export. At the same
two-second playback position the baseline preview is about 81 Hz above the
applied recording. The six-second preview input is incorrectly treated as the
complete selection over which the initial and final parameters interpolate.

When Sliding Stretch's pitch or tempo endpoints differ, process the complete
selected extent and retain the existing six-second audition cap. Admit the
complete processing extent through the existing peak-memory guard before
rendering. Constant Sliding Stretch transforms keep their bounded preview render. This pitch
and tempo ramp geometry is one defect, separate from R5-ROOT-005's whole-selection
peak, DC and loudness statistics. Setting-free Fade In/Out previews are excluded:
their ordinary menu entries apply immediately and do not expose Preview.

The actual ordinary preview/apply/export workflow is causally RED at a
preview/applied frequency discrepancy of 80.70 Hz versus a five-Hz tolerance
(`/tmp/soundscaper-r6-effects-sliding-preview-duration-browser-red2.log`). An
earlier menu-label case mismatch never reached the processor and is excluded.
Two strict tests using the committed StaffPad WASM independently fail: the
long pitch ramp differs by 0.2782 PCM amplitude, and the long tempo ramp previews
only four seconds where the full applied result supplies six. Short-selection
and constant-pitch controls pass before correction
(`/tmp/soundscaper-r6-effects-sliding-preview-duration-node-red.log`). All
seventeen new/existing preview, whole-selection normalization, worker-context,
placement, cancellation and gain cases pass afterward, including exact PCM
agreement with the applied ramp and full-extent memory admission
(`/tmp/soundscaper-r6-effects-sliding-preview-duration-node-green.log`). Focused
strict types, targeted type-aware lint and the file-size gate pass. The complete
ordinary preview/apply/export workflow passes Chromium, Firefox and WebKit on
immutable Green11 `a870804cd`
(`/tmp/soundscaper-round6-green11-public-browser.log`). No assistance runtime assets change
and no manual **Update AI assets** run is required.

The same preview-input extent also shortened a faster finite Speed Delay echo.
With an ordinary twelve-second mono tone, select Delay → Pitch/Tempo (change
speed), set Pitch shift per echo to the supported two semitones, Number of
echoes to one, Gain per echo to zero and Delay time to 0.1 seconds. In the last
quarter-second of the six-second audition the shortened input has already
lost its echo, while the full applied recording retains it. Read the required
selected input prefix for audible positive speed echoes, carrying the audition
horizon and pinned FFT/block/resampler support backwards through each audible
echo stage. Keep the six-second audition and admission over the actual input;
slower, dry and short controls retain their bounded behavior. This follows the
same preview-extent owner and adds no root.

The normal menu/Preview/Apply/WAV workflow is causally RED at echo/dry ratios
0.022174 versus 0.943426
(`/tmp/soundscaper-r6-effects-speed-delay-preview-duration-browser-red2.log`).
The strict actual StaffPad/preview regression fails at peak PCM residual
0.188234 while three controls pass
(`/tmp/soundscaper-r6-effects-speed-delay-preview-duration-node-red2.log`).
The initial missing TypeScript loader and wrong echo-gain label are excluded.
All seventeen new/existing Delay, Sliding Stretch and whole-selection
normalization preview cases pass after correction
(`/tmp/soundscaper-r6-effects-speed-delay-preview-duration-node-green.log`),
including full memory admission and exact PCM. Focused strict compilation,
targeted type-aware lint, the size gate and diff checks pass. The original
complete-input repair passes the normal Preview/Apply/WAV comparison in all
three engines on immutable Green14 `756da708e`, with preview/applied echo ratios
both 0.943426
(`/tmp/soundscaper-round6-green14-public-browser.log`).

The first complete-input repair preserves the echo, but needlessly admits and
loads an entire long recording. The strict hour-long range then refuses a
six-second audition on memory admission, while a normal twelve-second range
reads all 96,000 native frames. Both are causally RED against bounded input;
three slower/dry/short controls pass
(`/tmp/soundscaper-r6-effects-speed-delay-preview-prefix-node-red.log`).
The corrected one-echo audition reads under ten seconds and the three-stage
echo control under twelve seconds, independent of the selected recording's
length. Exact Preview/Apply PCM and memory/render-extent assertions remain in
place. All nineteen actual Delay, Sliding Stretch and whole-selection normalization
preview/support cases pass, including the exact PCM comparison through three
successive echoes
(`/tmp/soundscaper-r6-effects-speed-delay-preview-prefix-node-support2.log`).
Focused strict compilation and targeted type-aware lint pass; public GREEN
awaits the next immutable product build.

Paulstretch has the same shortened preview-input boundary. An ordinary
twelve-second mono recording accepts an eight-second Time resolution with
Stretch factor one when applied, but Preview rejects it as too short because
only six input seconds reach the processor. With the ordinary 0.25-second
resolution, the shortened future FFT window also changes the last part of the
audition. Read the complete contributing FFT input windows, honor the existing
minimum input, and move the processor's endpoint fade beyond the six-second
audition. Clamp the prefix to the selected extent, retain refusal for genuinely
short selections, and keep ordinary windows bounded for long recordings.
This is another manifestation of R6-EFFECT-017, with no additional root.

The complete public menu, visible Time resolution entry, Preview, Apply and
WAV workflow is causally RED: Preview reports a minimum of 524,289 samples,
while Apply successfully exports 576,000 finite samples
(`/tmp/soundscaper-r6-effects-paulstretch-preview-window-browser-red2.log`).
The strict actual preview/DSP regression rejects the valid long window and
differs from applied PCM by 0.109613 at ordinary resolution; the stretched
short-selection and genuinely insufficient input controls pass
(`/tmp/soundscaper-r6-effects-paulstretch-preview-window-node-red.log`).
All 37 new/existing Paulstretch, spectral, Delay, Sliding Stretch, normalization
and preview-context cases pass afterward, including exact PCM, the six-second
audition, selected input limits, the hour-long bounded-prefix control and actual
render/memory admission
(`/tmp/soundscaper-r6-effects-paulstretch-preview-window-node-support.log`).
Focused strict compilation, targeted type-aware lint and file-size/diff checks
pass. Public GREEN awaits the next immutable build.

## R6-EFFECT-018 — A valid native crossover is silently lowered before processing

Import an ordinary one-second 8 kHz WAV containing a 3,800 Hz tone. Select its
Source waveform and apply a neutral Multiband compressor with all three ratios
at one. Reopen the same source effect, set High crossover to 3,800 Hz, Low and
Mid gain to −12 dB, and retain unity ratios. The authored crossover is below the
recording's 4,000 Hz Nyquist limit, but the applied/exported response uses a
3,600 Hz cutoff: measured gain is 0.90248 rather than the bilinear crossover's
0.72907. The neutral pass makes both delivered comparisons use the same source
rendering path, avoiding unrelated import streaming resampling differences.

The shared complementary crossover clamps every requested cutoff to 45% of
sample rate. Honor valid frequencies below Nyquist in its actual filter design;
preserve the exact existing finite fallback for unsupported frequencies at or
above Nyquist. Static and live changes across native source rates share this
one DSP design owner. R4-ROOT-002 supplied the source clock to controls; this
processor receives the correct clock but substitutes a different valid cutoff.

The complete ordinary menu, native source processing and WAV downloads are
causally RED at gain 0.9024827 versus 0.7290733
(`/tmp/soundscaper-r6-effects-crossover-frequency-browser-red4.log`). Earlier
direct imported/processed-buffer comparisons were confounded by resampling,
and a follow-up fixture retained a clip name after source processing renamed
it; both are excluded. Four strict actual DSP cases independently fail, while
the normal 48 kHz cutoff and explicit unsupported-frequency safety controls
pass (`/tmp/soundscaper-r6-effects-crossover-frequency-node-red.log`). All
twenty-two new/existing crossover, de-esser, Multiband compressor and real
worklet cases pass after repair
(`/tmp/soundscaper-r6-effects-crossover-frequency-node-green.log`). Focused
strict types, targeted type-aware lint and the size gate pass. The next full
Node suite checkpoint will include this shared helper. The complete normal
Source-effect/apply/export workflow passes Chromium, Firefox and WebKit on
immutable Green11 `a870804cd`
(`/tmp/soundscaper-round6-green11-public-browser.log`). No assistance runtime assets change and no
manual **Update AI assets** run is required.

The Noise Gate release estimator also derived its crossover poles through the
old clamp. Derive its tail from the corrected valid cutoff so the rack cannot
stop while a genuine near-Nyquist release remains audible. The existing strict
8 kHz/3,999 Hz tail regression now excites the actual corrected high cutoff
with an ordinary 3,990 Hz tone; its former 1,000 Hz tone no longer supplies the
same end-of-source amplitude after the cutoff correction. The estimator's
52-frame tail is causally RED at residual amplitude 0.07404 where the retained
−80 dB bound requires less than 0.0001
(`/tmp/soundscaper-r6-effects-crossover-tail-node-red2.log`). All thirty-two
tail, lookahead, valid-crossover and actual-worklet support cases pass after
the dependent repair (`/tmp/soundscaper-r6-effects-crossover-tail-node-green.log`),
with narrow strict types and targeted lint passing. This is required
follow-through of R6-EFFECT-018 and adds no root. Immutable Green12 `8d9d45ff4`
includes the repaired estimator and passes the complete normal native-cutoff
workflow in Chromium, Firefox and WebKit
(`/tmp/soundscaper-round6-green12-public-browser.log`).

## R6-EFFECT-019 — Mono Vocoder filters an incomplete synthesized carrier

Import an ordinary mono recording containing several voice-band tones and a
stereo recording with the same modulator on the left and the documented full
ten-tone synthesized carrier on the right. Apply Effect → Distortion and
modulation → Vocoder with ten bands and Output set to Vocoded audio to each,
using the normal track Mute controls to export their results separately.
Equivalent carrier inputs should produce the same vocoded signal, but the
baseline mono export has correlation 0.98671 with the explicit full-carrier
export instead of greater than 0.999. Scale-independent correlation accounts
for ordinary mono/stereo track pan gains and WAV quantization.

The mono oscillator sum was built inside the analysis/synthesis loop. Its
first filter saw only the first oscillator, while each subsequent filter saw
one additional tone. Assemble the complete carrier before running any band so
every analysis/synthesis pair receives the same signal. Explicit stereo,
noise and radar carriers retain their existing routing and deterministic
behavior. This is one carrier-assembly defect, unrelated to R6-EFFECT-009's
fresh Noise-generator job seeds.

The ordinary menu/apply/export workflow is causally RED at correlation
0.9867059 (`/tmp/soundscaper-r6-effects-vocoder-mono-carrier-browser-red2.log`).
An earlier fixture retained a clip-name locator after the effect renamed that
clip and is excluded. Two strict actual-DSP cases independently fail at peak
sample residuals 0.16692 and 0.29562 for ten and forty bands; block-continuity,
stereo-routing and silent-modulator controls pass before correction
(`/tmp/soundscaper-r6-effects-vocoder-mono-carrier-node-red.log`). All thirty-six
new/existing modulation, actual worklet, selection-tail and effect-integration
cases pass after repair
(`/tmp/soundscaper-r6-effects-vocoder-mono-carrier-node-green.log`). Focused
strict types, targeted type-aware lint and the size gate pass. The complete
ordinary equivalent-carrier workflow passes Chromium, Firefox and WebKit on
immutable Green12 `8d9d45ff4`
(`/tmp/soundscaper-round6-green12-public-browser.log`). No assistance runtime assets change
and no manual **Update AI assets** run is required.

The full 100-fix Node checkpoint exposes two stale exact-parity expectations,
one `vocoder-1` signature in each of the round-two and round-three maps.
Focused unchanged replay reproduces only those differences; every other
signature, including explicit stereo/surround Vocoder, remains exact
(`/tmp/soundscaper-r6-effects-exact-parity-diagnostic.log`). Substituting only
the pre-repair Vocoder into isolated ignored copies restores both complete
old maps while the corrected owner's independent full-carrier, continuity,
routing and silence controls pass
(`/tmp/soundscaper-r6-effects-exact-parity-owner-control.log`). Correct only
the two mono expectations and document their owning behavioral regression;
both complete exact maps and all four independent controls pass, 6/6
(`/tmp/soundscaper-r6-effects-exact-parity-green.log`). Targeted type-aware
lint passes. This is uncounted test support for the existing carrier repair.

## R6-EFFECT-020 — Bitcrusher misses an exact authored sample-hold boundary

Import an ordinary one-second 48 kHz mono WAV containing a 1,200 Hz tone.
Select its Source waveform and apply Effect → Distortion and modulation →
Bitcrusher with Sample rate reduction set to ten, retaining Sample and hold.
Export the WAV. Past the editor's ordinary onset ramp, the hold ending at frame
1,010 should capture the positive sine peak. The baseline still holds the
previous near-zero sample and captures frame 1,011 instead. Factors six and
seven exhibit the same one-sample offset.

Adding the reciprocal hold increment can leave an exact mathematical boundary
slightly below one. Admit the boundary within its bounded floating-point
summation error and clamp only the corresponding tiny negative phase remainder.
Retain the capture phase across blocks and live changes, all reconstruction
and dither behavior, the initial frame-zero capture, and the authored interval.
Integer and fractional manifestations share this one decimation-phase owner.

The complete ordinary menu/apply/export workflow is causally RED at a zero
frame-1,010 output transition where the tone requires more than 0.2
(`/tmp/soundscaper-r6-effects-bitcrusher-hold-boundary-browser-red4.log`). Earlier
first-boundary absolute-gain assertions did not account for the ordinary onset
ramp and are excluded; the retained assertion's bound remains unchanged. Three
strict interval cases fail at factors six, seven and ten while the exact binary
eight-frame grid and fractional 2.5-frame/block-continuity controls pass before
repair (`/tmp/soundscaper-r6-effects-bitcrusher-hold-boundary-node-red.log`).
All twenty-three new/existing Bitcrusher DSP, seeded dither, reset, interpolation, destructive
selection and render-partition parity cases pass after correction
(`/tmp/soundscaper-r6-effects-bitcrusher-hold-boundary-node-green.log`). Focused
strict types, targeted type-aware lint and the size gate pass. The complete
ordinary WAV boundary workflow passes Chromium and WebKit on immutable Green13
`3dfdeb038`
(`/tmp/soundscaper-round6-green13-public-browser.log`). Its initial Firefox run
prints correct PCM before exceeding the unchanged thirty-second total budget;
the unchanged isolated Firefox retry on the same built assets passes in
13 seconds
(`/tmp/soundscaper-r6-effects-bitcrusher-hold-boundary-green13-firefox-retry.log`).
No assertion, fixture, source or deadline changes were made for that retry.
No assistance runtime assets change
and no manual **Update AI assets** run is required.

## R6-EFFECT-021 — Native surround Loudness Normalization counts the wrong channel roles

Import ordinary one-second 5.1 WAV recordings containing the same left-channel
1 kHz programme, with and without a separate 100 Hz LFE signal. Select each
Source waveform and choose Effect → Volume and compression → Loudness
Normalization, retaining the default linked perceived-loudness target. Mute
the other recording for each ordinary WAV export. Adding only LFE content
changes the audible programme's normalized RMS from 0.0707411 to 0.0208734,
even though LFE is excluded from canonical programme loudness and monitoring.
A surround-only channel likewise lands near −21.54 LUFS against the authored
−23 LUFS target.

The linked normalization measurement gives every native channel unity weight.
Reuse the analyzer's existing canonical 5.0/5.1 channel weights before adding
filtered channel power, excluding LFE and applying the surround contribution.
Preserve all native samples, linked channel balance, mono/stereo dual-mono and
independent-channel behavior, unknown discrete layouts, RMS mode and the
existing upstream filter, gate, histogram and sample-clock ordering. LFE and
surround manifestations share this one channel-role weighting owner.

The complete ordinary Source/menu/apply/WAV workflow is causally RED at an
audible programme RMS ratio of 0.295068 instead of one
(`/tmp/soundscaper-r6-effects-loudness-channel-weighting-browser-red2.log`). An
earlier run timed out during export under resource pressure and is excluded.
Four strict actual-DSP cases fail at the LFE gain change, 5.0/5.1 surround
target and LFE-only normalization while mono/stereo controls pass
(`/tmp/soundscaper-r6-effects-loudness-channel-weighting-node-red2.log`). The
initial mismatching-array failure diff exhausted memory and was stopped; the
retained scalar maximum-difference assertion checks the same exact PCM
contract. All twenty-seven new/existing basic-effect, loudness histogram,
dual-mono, RMS and native-rate loudness cases pass after repair
(`/tmp/soundscaper-r6-effects-loudness-channel-weighting-node-green.log`).
Focused strict compilation, targeted type-aware lint and size/diff checks pass.
The complete ordinary Source/menu/Apply/WAV workflow passes Chromium, Firefox
and WebKit on immutable Green14 `756da708e`
(`/tmp/soundscaper-round6-green14-public-browser.log`). No assistance runtime
assets change and no manual **Update AI assets** run is required.

## R6-EFFECT-022 — Live Spectrogram loses narrow tones between its visible rows

Import an ordinary mono WAV with a steady tone, open Analyze → Analysis,
expand Spectrum and Spectrogram, and play it. A tone in the ninety-fifth live
frequency bucket remains audible and visible in Spectrum but disappears from
the current Spectrogram column. A neighboring bucket displays normally.
At the ordinary local device's 44.1 kHz playback clock these two recordings
contain 3,186.914 Hz and 2,993.115 Hz tones respectively.

The live renderer point-samples 128 frequency buckets into 96 rows, omitting
one bucket in each group of four, including the highest bucket. Retain the
strongest bucket covered by each visible row instead. Preserve the logarithmic
frequency order, palette, scrolling history, project replacement and the
existing expanded-section subscription/analysis-lease lifecycle. This live
heatmap owner is independent of R2-ROOT-018's offline Plot Spectrum renderer.

The complete ordinary playback workflow is causally RED at maximum current
column RGB 34 against a required visible signal above 190, after the real
native FFT peak at bin 296 reaches −22.5867 dB and Spectrum controls pass.
The neighboring bin-278 tone passes at RGB 243
(`/tmp/soundscaper-r6-effects-live-spectrogram-frequency-buckets-browser-red3.log`).
The fixtures use the native device's default playback clock to choose their
normal frequencies; the passive native analyser observer forwards every real
read. The initial 48 kHz assumption selected a different, retained bucket on
this 44.1 kHz device and is excluded. Two strict mounted production-renderer
cases fail at lightness 7 instead of 59 for buckets 95 and 127, while the
neighboring-bucket and silence controls pass
(`/tmp/soundscaper-r6-effects-live-spectrogram-frequency-buckets-node-red2.log`).
All nine new/existing renderer, native stereo-spectrum, section lifecycle and
project-history cases pass after repair
(`/tmp/soundscaper-r6-effects-live-spectrogram-frequency-buckets-node-green.log`).
The initial missing style-asset loader is excluded. Focused strict types,
targeted type-aware lint and size/diff checks pass. Both complete ordinary
Chromium workflows pass on immutable Green15 `de04b82c9`, with current-column
RGB 243 and native bin/clock/Spectrum controls retained
(`/tmp/soundscaper-round6-green15-public-browser.log`). The batch's Firefox
cases exceed their unchanged 30-second deadline, one before playback and one
after printing the correct RGB 243. WebKit's neighboring control loses its
signal and its skipped-bucket case paints correct RGB 243 but reads a decaying
native spectrum at −38.52 dB. The unchanged isolated Firefox/WebKit retry also
fails under host load above 100 and full swap
(`/tmp/soundscaper-r6-effects-live-spectrogram-green15-isolated-retry.log`).
Those engines remain pending; no assertion, deadline or fixture was relaxed.
No assistance runtime assets change and no manual **Update AI assets** run is
required.

## R6-EFFECT-023 — Legacy Compressor refuses ordinary audio followed by silence

Import an ordinary IEEE float WAV with one second of a 330 Hz tone and a
half-second digital pause. Open its Source waveform, Select all and choose
Effect → Legacy effects → Legacy Compressor. Applying its defaults refuses
the finite recording: output channel zero contains a non-finite sample at
frame 48,099. The recording itself contains only normal finite audio samples.

The RMS follower subtracts squares from its rolling window. Once the last
real tone samples leave the window, ordinary floating-point cancellation can
leave a tiny negative power remainder. Taking its square root produces NaN
and poisons the remaining gain envelope. Bound measured power at zero before
the square root; preserve the accumulated window, detector/follower ordering,
per-channel and second-pass normalization, peak mode and upstream seed window.

The complete Source/menu/Apply workflow is causally RED at the retained dialog
and its exact non-finite-output alert
(`/tmp/soundscaper-r6-effects-legacy-compressor-silent-tail-browser-red3.log`).
Initial incorrect menu paths are excluded. Two strict actual-DSP tone/pause
cases fail at first non-finite frame 48,099; the 440 Hz, peak-detector and
all-silence controls pass
(`/tmp/soundscaper-r6-effects-legacy-compressor-silent-tail-node-red.log`).
All twenty new/existing basic-effect, legacy seed/follower and finite-silence
cases pass after repair
(`/tmp/soundscaper-r6-effects-legacy-compressor-silent-tail-node-support.log`).
Focused strict compilation and targeted type-aware lint pass. The complete
Source/menu/Apply/WAV workflow passes Chromium on immutable Green16 `9bd6730b2`
(`/tmp/soundscaper-r6-effects-legacy-compressor-green16-float-export.log`).
The first Green16 run completes Apply and exports finite audio, then finds a
single quantization step of default 24-bit export dither in its digital-silence
control. Explicitly choosing the ordinary 32-bit Float export preserves the
exact-zero control, all-finite assertion, audible tone and unchanged deadline;
the corrected fixture passes on the same product bytes. No assistance runtime
assets change and no manual **Update AI assets** run is required.

## R6-EFFECT-024 — Brown noise loses its bass emphasis at ordinary project rates

Generate → Noise, choose Brown, enter sixteen seconds and generate. Export
WAV with the normal 32-bit Float option. The delivered 20–40 Hz octave has only
1.461 times the energy of 80–160 Hz. The fixed per-sample leak moves the Brown
integrator's low-frequency corner upward with sample rate, flattening its
audible bass. The same seeded ordinary jobs have octave ratios 4.398 at 8 kHz,
1.719 at 48 kHz and 0.745 at 96 kHz. Brown noise should retain its stronger low
frequency emphasis across supported recording clocks. The
[Audacity Noise manual](https://manual.audacityteam.org/man/noise.html) describes
Brown as the strongest low-frequency color; its
[3.7.7 implementation](https://raw.githubusercontent.com/audacity/audacity/Audacity-3.7.7/libraries/lib-builtin-effects/NoiseBase.cpp)
also adjusts its Brown leakage and input scaling with sample rate.

Retain the existing 8 kHz pole's physical time constant, below the audible
band, at every rendering rate. Scale the input step to preserve the existing
stationary power, amplitude bounds and streamed state. Preserve the random
draw order and the exact 8 kHz sequence. This Brown integrator is independently
implemented from R2-ROOT-006's Pink random-row bank; White/Pink and the fresh-job
seed correction in R6-EFFECT-009 remain unchanged.

The complete normal Generate/menu/timecode/WAV workflow is causally RED at
the actual exported octave ratio 1.461, with finite audio retained
(`/tmp/soundscaper-r6-effects-brown-noise-spectrum-browser-red.log`). Strict
48/96 kHz spectral cases independently fail while the 8 kHz, White and digital
silence controls pass
(`/tmp/soundscaper-r6-effects-brown-noise-spectrum-node-red.log`). All 27
new/existing generator, Pink spectrum, seed, streamed transfer and pinned RNG
cases pass after repair
(`/tmp/soundscaper-r6-effects-brown-noise-spectrum-node-green.log`), with corrected
8/48/96 kHz octave ratios 4.398/4.214/3.953. Focused strict compilation, targeted
type-aware lint and size/diff checks pass. The complete ordinary Generate/WAV
workflow passes Chromium on immutable Green17 `449787703`, with exported
octave ratio 3.602
(`/tmp/soundscaper-round6-green17-chromium.log`). No assistance runtime assets
change and no manual **Update AI assets** run is required.

## R6-EFFECT-025 — A second touch replaces the active Parametric EQ band drag

Import an ordinary WAV, Select all and open Effect → EQ and filters →
Parametric EQ. Start dragging Band 1 with one finger, put a second finger on
Band 2 and continue moving the first finger. The first finger changes Band 2
from 500 Hz at 0 dB to 162 Hz at +5.6 dB. The graph has one drag session but
admits each touch and accepts any pointer's movement, completion or cancellation.

Admit one primary pointer and retain its identity throughout that graph
session. Ignore unrelated movement, release and cancellation, and restore the
original draft if its owning capture is lost. Keep mouse, keyboard, automation
capture and ordinary one-gesture commits. The existing automation regression
now carries the same native pointer identity on its movement as on its start
and release. The graph's independent pointer lifecycle differs from the prior
Parametric EQ modified-key owner and generic native range controls.

Actual Chromium native multi-touch input reproduces the wrong-band edit after
a completed ordinary mouse drag control
(`/tmp/soundscaper-r6-effects-parametric-eq-touch-browser-red2.log`). The fixture
uses public import/menu/graph controls and native input protocol, without
installing editor state or calling internal actions. An initial setup run used
Escape while focus remained outside the graph; that run is excluded. The
Chromium native input protocol is unavailable in the other Playwright engines,
which explicitly skip this focused multi-touch case.

Five strict mounted pointer-owner cases are causally RED while the ordinary
primary drag control passes
(`/tmp/soundscaper-r6-effects-parametric-eq-pointer-node-red2.log`). All twenty
new/existing graph, automation, deletion-focus, keyboard selection and modified
command cases pass after repair
(`/tmp/soundscaper-r6-effects-parametric-eq-pointer-node-green.log`). Focused
strict compilation, targeted type-aware lint and size/diff checks pass. The
complete ordinary mouse/native-touch workflow passes Chromium on immutable
Green17 `449787703`, retaining Band 2 at 500 Hz and 0 dB while the first finger
moves Band 1
(`/tmp/soundscaper-round6-green17-chromium.log`). No assistance runtime assets
change and no manual **Update AI assets** run is required.

## R6-EFFECT-026 — Parametric EQ hides and misplaces ordinary high-frequency peaks

Import an ordinary 48 kHz mono WAV, open the track's Effects panel, add
Parametric EQ and Play. Its input spectrum samples one nearest FFT bin every
two graph pixels. At high frequencies, several intervening bins never reach
the graph: an ordinary 18,109 Hz tone measured at -19.67 dB by the actual
native analyser appears near the graph's -109 dB floor. A neighboring 17,948
Hz tone remains visible but its peak is displaced 8.61 pixels because the
48 kHz project clock was used to position the 44.1 kHz native analyser's bins.

Retain the reader's native sample-rate metadata and draw the maximum finite
FFT level in each graph point's covered interval. Preserve the published
project-frequency axis, the digital-silence floor, subscriptions, input/output
colors and existing reader fallback. This is one independently implemented
Parametric EQ spectrum projection owner; peak omission and clock displacement
are grouped as its manifestations. The live Spectrogram row owner in
R6-EFFECT-022 remains separate.

The complete ordinary import/track-effect/Play workflow is causally RED for
both the omitted high-frequency peak and the displaced neighboring control
(`/tmp/soundscaper-r6-effects-parametric-eq-spectrum-browser-red3.log`). It
passively observes the actual native FFT without supplying audio or editor
state. An earlier setup run left the floating effect window open over the
parent panel's Close button and is excluded. Four strict mounted projection
cases independently fail while the digital-silence control passes
(`/tmp/soundscaper-r6-effects-parametric-eq-spectrum-node-red2.log`). All
eighteen new/existing spectrum and graph gesture cases pass after correction
(`/tmp/soundscaper-r6-effects-parametric-eq-spectrum-node-green.log`). Focused
strict compilation and targeted type-aware lint pass. Both complete normal
tone workflows pass Chromium on immutable Green18 `d7cb58183`
(`/tmp/soundscaper-round6-green18-chromium.log`), including the omitted peak
and native-clock position control.
No assistance runtime assets change and no manual **Update AI assets** run
is required.

## R6-EFFECT-027 — Ordinary microphone meters report true peak as sample dBFS

Window → Recording meter, open Record level and enable Show mic metering when
not recording. A normal phase-shifted calibration tone has actual native
sample peak 0.424264 (-7.45 dBFS), but the ordinary meter displays -4.39 dBFS
and amplitude 0.603095. The EBU meter mixes its interpolated true peak into
the live sample-peak accumulator, then publishes that accumulator as ordinary
`peak` and `dbfs`. Intersample peak is a separate reading and must not inflate
the displayed sample level.

Keep the sample accumulator based on actual input frames. Retain the separate
true-peak FIR histories and maxima, RMS, loudness, paused/running measurement
state, arbitrary capture blocks and native worklet telemetry. This DSP meter
owner is independent of R2-ROOT-017's mixer UI display-percentage clipping
threshold.

The complete normal monitor workflow is causally RED after the sample-aligned
tone control passes
(`/tmp/soundscaper-r6-effects-input-sample-peak-browser-red2.log`). The fixture
provides a real native audio MediaStream and passively observes time-domain
samples; it neither calls editor internals nor substitutes meter readings or
track sample-rate metadata. The initial run captured the first transient
window and is excluded; the retained workflow waits for four actual native
meter windows with unchanged deadlines and level assertions. Four strict
actual-DSP cases independently fail while aligned-tone, exact true-peak/RMS/
loudness and block-continuity controls pass
(`/tmp/soundscaper-r6-effects-ebu-sample-peak-node-red.log`). All twenty-nine
new/existing EBU conformance, worklet, production analysis and BEXT silence
cases pass after correction
(`/tmp/soundscaper-r6-effects-ebu-sample-peak-node-green.log`). Focused strict
compilation, targeted type-aware lint and diff checks pass. Both complete
normal native microphone workflows pass Chromium on immutable Green18
`d7cb58183` (`/tmp/soundscaper-round6-green18-chromium.log`), retaining the
aligned sample control and the repaired phase-shifted reading.
No assistance runtime assets change and no manual **Update AI assets** run
is required.

The round-four exact snapshot gate includes nine EBU signatures. Only those
nine change for this correction; every other PCM, geometry and snapshot entry
remains exact
(`/tmp/soundscaper-r6-effects-ebu-sample-peak-parity-diagnostic.log`). An
isolated pre-repair EBU owner restores all 166 original signatures. Direct
old/new snapshot comparisons at 8/11.025/48 kHz with 1/2/6 channels retain every
RMS, true-peak and loudness field byte for byte; only ordinary `peak` and
`dbfs` change
(`/tmp/soundscaper-r6-effects-ebu-sample-peak-parity-controls.log`). Correct
only those nine expectations. This supporting expectation update adds no root.
Both the complete exact map and all seven independent sample/true-peak controls
pass, 8/8 (`/tmp/soundscaper-r6-effects-ebu-sample-peak-parity-green.log`);
targeted type-aware lint passes.

## R6-EFFECT-028 — Changing live Echo Decay erases an audible recording tail

Import an ordinary recording with a short audible opening and a quiet tail.
Track Effects → Add Echo; choose Delay 1 second and Decay 0.8, then Play.
After the first echo is audible, change Decay to 0.7 in the normal effect
window. All following echoes disappear. The parameter surface and rack engine
exclude Echo from their existing gesture/message adoption path, so the edit
rebuilds its running graph. Its live processor also clears the delay ring on
an otherwise compatible parameter update.

Admit Echo's existing parameter gestures and worklet `params` message only
when its native delay geometry is unchanged. Keep its audible ring and current
position for Decay edits. Preserve the existing graph rebuild for changed
delay geometry, explicit reset, disabled/bypassed racks, validation, stale
revisions and unrelated effect routing. The missing normal live admission
and necessary ring retention belong to this single Echo edit-continuity root;
no generic Audacity processor class is counted as a separate unreachable bug.

The complete ordinary import/track-effect/Play workflow is causally RED after
its first audible repeating-echo control passes: native output after the
Decay edit is zero instead of an audible repeat
(`/tmp/soundscaper-r6-effects-echo-live-tail-browser-probe.log`). It passively
observes actual native output without supplying editor state or processor
messages. Five strict production cases fail independently at mono/stereo ring
continuity, normal UI admission, atomic committed fields and the actual rack
engine's message route, while the explicit reset/geometry-change control passes
(`/tmp/soundscaper-r6-effects-echo-live-tail-node-red.log`). All forty-two new
and existing live DSP, rack gestures, actual engine worklets and latency-change
controls pass after repair
(`/tmp/soundscaper-r6-effects-echo-live-tail-node-green2.log`). All three exact
DSP maps remain unchanged
(`/tmp/soundscaper-r6-effects-echo-live-tail-exact-parity.log`). Focused strict
compilation, targeted type-aware lint and file-size/diff checks pass. The
complete normal native-output workflow passes Chromium on immutable Green19
`18a33ffa1` (`/tmp/soundscaper-round6-green19-chromium.log`): before-edit peak
0.4242599 and a retained following echo at 0.23758556.
No assistance runtime assets change and no manual **Update AI assets** run
is required.

## R6-EFFECT-029 — A suspended modal shortcut changes a native strength parameter

Import an ordinary recording, assign Ctrl+Alt+End to New label track in
Preferences, select its clip and open Effect → Pitch and tempo → Audio warp
and transients. Focus Quantization strength, use ordinary ArrowRight to set
51, then press that assigned shortcut. The modal correctly suspends the label
command, but the native range jumps to 100. Groove strength has the same
ordinary defect after Enable groove template. Both manifestations share the
modal shell's missing native-default ownership and count as one root.

Guard command-modified native range navigation at the shared modal capture
boundary on both key phases. Keep ordinary and Shift range editing, pointer
changes, text and number inputs, already-owned events, modal focus and resize
ownership, and nonmodal command handling. R5-ROOT-028 repaired the independent
workspace native-range command eligibility and explicitly preserved modal
suspension; it did not guard the suspended native default inside a modal.

Both complete ordinary menu workflows are causally RED on immutable Green19
after their plain ArrowRight controls pass: expected 51, received 100
(`/tmp/soundscaper-r6-effects-warp-strength-browser-red.log`). Three strict
mounted shared-shell modifier cases fail while the ordinary editing control
passes (`/tmp/soundscaper-r6-effects-warp-strength-shell-node-red2.log`). All
twenty-seven new and existing Warp, focus-owner, modal resize and workspace
range cases pass after correction
(`/tmp/soundscaper-r6-effects-warp-strength-node-green3.log`). Focused strict
compilation, targeted type-aware and canonical changed-file lint, and size/diff
checks pass. Earlier correction attempts exposed test-DOM selector and
attribute limitations and are retained as supporting setup failures, not
additional causal evidence. Both complete ordinary public workflows pass
Chromium on immutable Green20 `0b272a361`
(`/tmp/soundscaper-round6-green20-chromium.log`), retaining plain/Shift editing,
modal command suspension and the assigned command after Close.
No assistance runtime assets change and no manual **Update AI assets** run
is required.

## R6-EFFECT-030 — Plot Spectrum publishes a misleading incomplete-window level

Import an ordinary 10 or 20 millisecond stereo recording, Select all and
Analyze → Analyze selection. Its measured peak is -6 dBFS. Close that report
and choose Analyze → Plot spectrum with the normal default 2048-sample window.
The plot reports the same 750 Hz signal at -30.2 or -13.9 dB and offers Export.
It silently pads a partial prefix, applies the complete window and divides by
the complete Hann sum. That is not a valid full-window calibrated report.
[Audacity's Plot Spectrum contract](https://manual.audacityteam.org/man/plot_spectrum.html)
requires a warning when the selected region is shorter than the chosen size.

Admit the rendered recording's actual frame count against the chosen report
window before starting report workers or publishing a result. Explain the
minimum in English and German, retain the preceding repeatable analysis on
refusal and release busy state. Keep partial-window FFT consumers such as
spectral selection gestures untouched. Full-window coherent-gain correction
R5-ROOT-010 is independent and remains exact. Trailing incomplete averaging
blocks are excluded from this root.

Both complete ordinary menu workflows are causally RED on immutable Green19:
their native peak controls pass and the misleading plotted levels are captured
before the absent-warning assertion
(`/tmp/soundscaper-r6-effects-spectrum-short-selection-browser-red4.log`). The
initial mono pan-law fixture control is excluded. Two strict actual service
cases are independently RED through fallback and delegated report production,
while full-window/repeat and valid short levels/clipping controls pass
(`/tmp/soundscaper-r6-effects-spectrum-short-selection-node-red3.log`). Earlier
unsupported track-width fixture fields are excluded setup failures. All
twenty-eight new and existing service, report-worker, cache-publication,
repeat, spectrum and clipping cases pass after repair
(`/tmp/soundscaper-r6-effects-spectrum-short-selection-node-green3.log`). Two
existing publication controls now supply a complete 32-frame window instead
of four frames; every original cache, ordering and transaction assertion stays
unchanged. Focused strict compilation, targeted and canonical changed-file
lint and size/diff checks pass. The first immutable Green22 public run refuses
the misleading plot correctly but its test watches the cleared global status
instead of the actual visible warning alert
(`/tmp/soundscaper-round6-green22-chromium.log`). The exact count-aware instruction
appears in that alert; only the observer is corrected. Both complete normal
Chromium workflows then pass unchanged immutable Green22 `e2e2b5112`
(`/tmp/soundscaper-r6-effects-spectrum-short-selection-browser-green22.log`),
including ordinary 512-window recovery with the original frequency/level and
Export assertions. This register now has thirty verified roots.
No assistance runtime assets change and no manual **Update AI assets** run
is required.

## R6-EFFECT-031 — Undo leaves half of a linked Bass/Treble adjustment applied

Import an ordinary recording, open its Effects rack and add Bass and Treble.
Enable Auto-adjust volume to preserve loudness and set Bass or Treble to 12 dB.
The tone becomes 12 and its compensated output volume becomes -6. Close the
dialog and press Undo once. Only output volume returns to zero; the tone stays
at 12, leaving an unintended uncompensated boost. Both tone controls share this
one independently implemented linked-parameter publication owner.

Publish the two static parameter changes in one existing effect-update
transaction. Preserve the preceding ordinary per-parameter path when either
control belongs to live automation, and retain gesture cancellation and
failure admission. Existing mixer/fade gesture-history roots concern their
separate continuous-draft owners; this linked edit already finishes both
values successfully but publishes two complete commands.

Both actual public rack/edit/Close/Undo workflows are causally RED on immutable
Green21 after ordinary unlinked Undo controls pass: the dialog reads tone 12
and output 0 after one Undo
(`/tmp/soundscaper-r6-effects-linked-tone-browser-red.log`). Two strict mounted
production-editor cases independently create two canonical Soundscaper history
entries while unlinked, rejected-write and both live-lane controls pass
(`/tmp/soundscaper-r6-effects-linked-tone-node-red3.log`). Earlier legacy-history
schema and native-checkbox assumptions are excluded fixture setup failures.
All twenty-four new and existing linked, derived, automation-routing, layout
and rack-command cases pass after repair
(`/tmp/soundscaper-r6-effects-linked-tone-node-green2.log`), including complete
one-entry Undo/Redo and unchanged independently owned automation values.
Focused strict compilation, targeted and canonical changed-file lint, and
size/diff checks pass. Both complete native Chromium workflows pass on
immutable Green24 `97b556b6d`, including exact one-Undo and Redo restoration
(`/tmp/soundscaper-round6-green24-chromium.log`).
No assistance runtime assets change and no manual **Update AI assets** run
is required.

## R6-EFFECT-032 — Rate effects advertise an incorrect sample duration

Import a one-second 48-kHz recording, select it and open Change Tempo or Change
Speed and Pitch. Set Percent change to 50 and choose Samples from the Desired
duration format menu. The field promises 32,016 samples, but Apply followed by
the ordinary WAV export produces 32,000. The preceding 100-percent comparison
correctly promises 24,000. Both effects share this one duration-value owner.

Retain the exact derived duration until the existing time-code formatter
formats it. The owner previously rounded its value to milliseconds before
the formatter could show samples. Preserve the existing percentage precision,
limits, automation commit callback and ordinary duration editing. R2-ROOT-012
corrected absent selection context; this independent value-rounding defect
occurs with a complete, correct selection context.

Both complete normal menu, Samples, Apply and actual WAV-export workflows are
causally RED on unchanged immutable Green22
(`/tmp/soundscaper-r6-effects-rate-sample-duration-browser-red.log`). Four strict
mounted production-format cases independently show 29,414 instead of 29,400
samples at 44.1 kHz and 32,016 instead of 32,000 at 48 kHz, with exact-duration
comparisons and the two existing editable-duration controls passing
(`/tmp/soundscaper-r6-effects-rate-sample-duration-node-red.log`). All sixteen
new and existing rate-duration and time-code cases pass after repair,
including format/blur without a parameter write
(`/tmp/soundscaper-r6-effects-rate-sample-duration-node-green.log`). Focused
strict compilation, targeted and canonical changed-file lint, and size/diff
checks pass. Both complete native Chromium workflows pass on immutable
Green24 `97b556b6d`: the Samples field and delivered WAV both contain exactly
32,000 frames at a 50-percent change
(`/tmp/soundscaper-round6-green24-chromium.log`). This register now has
thirty-two verified roots.
No assistance runtime assets change and no manual **Update AI assets** run
is required.

## R6-EFFECT-033 — An idle native effect closes its own host after instantiation

With native effects enabled and an allowed stereo LADSPA installation, import
an ordinary recording and choose Effect → Audio Plugins. Open the installed
effect. Its initial state saves successfully, but its parameter section then
reports "The native plug-in host failed: topology-mismatch." The live processor
mistakes the empty input-channel array of a disconnected Web Audio source for
a changed plug-in topology and closes the bound host before its controls load.

Feed declared-width silence through the existing live processing pool when
the input is disconnected. Reuse those zero planes across blocks and continue
processing native tails. Preserve strict-render admission and every nonempty
input/output topology refusal. This independently implemented worklet owner
is separate from parameter-control gestures and earlier output-meter adapters.

The complete ordinary Chromium menu workflow is causally RED on unchanged
immutable Green24 `97b556b6d`: initial SHA/HMAC-authenticated state persistence
succeeds, then the actual worklet closes the real transferred MessagePort and
the visible alert appears before parameter reads
(`/tmp/soundscaper-r6-effects-native-plugin-idle-browser-red.log`). A production
desktop-host protocol fixture supplies installation discovery, state bytes,
authentication and processing RPC; it never injects an editor document or
calls an internal editor entrypoint. Earlier missing-consent and fixture-width
setup failures are excluded. One strict production-worklet case is RED while
strict-render and nonempty-width refusal controls pass
(`/tmp/soundscaper-r6-effects-native-plugin-idle-node-red.log`). All eleven new
and existing worklet, parameter RPC and mounted parameter controls pass after
repair, including idle native-tail output and resumed real input
(`/tmp/soundscaper-r6-effects-native-plugin-idle-node-green.log`). Focused strict
compilation, targeted and canonical changed-file lint, and size/diff checks pass.
The complete ordinary native Chromium workflow passes on immutable Green26
`f44d878b0` in 3.0 seconds
(`/tmp/soundscaper-round6-green26-chromium.log`, complete batch 4/4 PASS).
This register now has thirty-three verified roots. No assistance runtime assets
change and no manual **Update AI assets** run is required.


## R6-EFFECT-034 — Native parameter drags lose their final requested position

With an enabled, allowed native effect, import a normal recording and open it
through Effect → Audio Plugins. Drag its generated Gain slider to 80 percent
while its host takes 200 milliseconds to reply. The host stays at about 37
percent: every pending parameter write disables all generated controls and
rejects the remaining drag events. Waiting, pressing Close or pressing Escape
all leave the same incorrect host value. These manifestations share this one
parameter-write admission owner, independently of 033's idle audio processor.

Keep the native controls editable, serialize host writes and coalesce each
parameter's unsent changes to its latest requested value. Retain the latest
native draft when an earlier acknowledgement arrives. Close and Escape wait
for accepted writes before unmounting their owner; instance replacement,
forced disposal and disabled editing retire unsent changes. A genuine host
rejection stays visible and cancels its remaining queue. Preserve ordinary
settled writes, default reset, normalized parameter bounds and static native
host state custody.

The complete ordinary Chromium workflow is causally RED on unchanged Green26
`f44d878b0` after authenticated installation and a settled ArrowRight control
pass: the transferred host receives only 0.366703539823009 rather than the
final position above 0.75
(`/tmp/soundscaper-r6-effects-native-plugin-parameter-browser-red4.log`). The
retained wait, Close and Escape workflows independently reproduce that exact
incorrect value on the same built bytes
(`/tmp/soundscaper-r6-effects-native-plugin-parameter-browser-red5.log`). Two
strict mounted cases lose the last position and an independent parameter
while four disabled/lifetime controls pass before repair
(`/tmp/soundscaper-r6-effects-native-plugin-parameter-node-red.log`). All
thirty-four new and existing mounted parameter, close-drain, native dialog,
RPC and worklet cases pass afterward, including repeated Close, obsolete
Close authority and a refused host write
(`/tmp/soundscaper-r6-effects-native-plugin-parameter-node-green3.log`). Focused
strict compilation, targeted and canonical changed-file lint, and size/diff
checks pass. All three complete ordinary Chromium workflows pass on immutable
Green28 `435e1779e`: waiting 3.3 seconds, Close 3.4 seconds and Escape 4.5
seconds. The actual transferred host accepts `[0.26, 0.366703539823009,
0.842367]`, retaining the final requested value
(`/tmp/soundscaper-round6-green28-chromium.log`, complete batch 9/9 PASS).
This register now has thirty-four verified roots. No assistance runtime assets
change and no manual **Update AI assets** run is required.

## R6-EFFECT-035 — Restoring native state leaves the open controls at the previous values

With a normally enabled, allowed LADSPA installation, import a recording and
open Effect → Audio Plugins. Instantiate its Gain effect, move Gain from
0.25 to 0.26 and choose Store state. Move Gain to 0.27, then Restore state.
The transferred host correctly restores 0.26, but its enabled generated slider
still displays 0.27. The next ordinary arrow edit starts from that stale value.
The control's read lifetime depends only on the instance identity and runtime,
although restoring a saved state deliberately preserves that instance. This
read synchronization owner is independent of 034's asynchronous write admission.

Include the existing native state generation in the parameter-read lifetime
and supply it from the native effect panel. Reload all generated values after
a successful state transition, preserving ordinary writes, disabled controls,
instance replacement and stale asynchronous-read fencing. An unrelated
presentation update does not discard a parameter draft or issue extra reads.

The complete ordinary Chromium Store/edit/Restore workflow is causally RED
on unchanged Green28 `435e1779e`: authenticated state bytes are persisted and
restored through the production bridge and actual `load-state` MessagePort
RPC; the host is 0.26 while the visible slider remains 0.27
(`/tmp/soundscaper-r6-fx035-public-red.log`). Its desktop-host fixture adds
normal immutable state-body lookup and integrity checks to the existing
installation fixture; it never injects an editor document or invokes an
internal editor entrypoint. A strict same-instance parameter reload is RED
while an unrelated disabled-presentation control passes
(`/tmp/soundscaper-r6-fx035-node-red.log`). After repair, all twenty-seven new
and existing restore, drag, parameter and native dialog cases pass
(`/tmp/soundscaper-r6-fx035-node-green.log`). Focused strict compilation,
targeted and canonical changed-file lint, and size/diff checks pass.
The complete ordinary Store/edit/Restore Chromium workflow passes on immutable
Green29 `494a0a2b6`, 3.4 seconds: both the actual host and the visible control
return to 0.26, and the subsequent arrow edit starts from that restored value
(`/tmp/soundscaper-round6-green29-chromium.log`).
No assistance runtime assets change and no manual **Update AI assets** run
is required.

## R6-EFFECT-036 — Nyquist numeric keys replace an unfinished native composition

Choose Generate → Nyquist → Risset Drum and edit its ordinary Amplitude field
with a native input method. Confirm an unfinished numeric composition with
Enter or cancel the input method's current composition with Escape. The field
consumes both keys as application edits: Enter clamps the unfinished amplitude
2 to 1, while Escape replaces an unfinished 0.5 with the previous 0.8. This
independent Nyquist numeric draft handler differs from the shared modal shell
and from the existing ordinary decimal-draft and idle-Escape corrections.

Release native composing key events before this field's own completion and
cancellation handlers. Preserve ordinary Enter normalization, Escape draft
rollback, subsequent idle Escape dismissal, live numeric updates and focus.
Group Enter/Escape and installed plug-in manifestations as one owner.

Both complete ordinary Chromium menu workflows are causally RED on unchanged
Green28 `435e1779e`, after their ordinary Escape control passes
(`/tmp/soundscaper-r6-fx036-public-red.log`). The native composing keyboard
fixture targets the real numeric input and never injects project state. Both
strict composing cases fail while both completed key controls pass
(`/tmp/soundscaper-r6-fx036-node-red.log`). The repaired cases and original
negative/decimal-draft and canonical-echo support pass 5/5
(`/tmp/soundscaper-r6-fx036-node-green.log`). Focused strict compilation,
targeted and canonical changed-file lint, and size/diff checks pass.
Both complete native composing Enter and Escape Chromium workflows pass on
immutable Green29 `494a0a2b6`, 2.5 and 2.3 seconds respectively
(`/tmp/soundscaper-round6-green29-chromium.log`). This register now has thirty-six
verified roots.
No assistance runtime assets change and no manual **Update AI assets** run
is required.

## R6-EFFECT-037 — The shared numeric stepper steals modifier and native composition keys

Choose Generate → Tone, click its Frequency field and use ordinary ArrowUp.
Then press Ctrl+ArrowUp or confirm an unfinished input-method composition with
ArrowUp or Enter. The shared NumberStepper handles those owned keys as its
own numeric edit: modified and composing arrows change 1001 Hz to 1002 Hz,
while composing Enter exits numeric editing and disables the next ordinary
arrow. This independently implemented shared key handler differs from the
earlier completed-number parser/bounds correction and from parent form submission.

Release native composing, Ctrl/Meta/Alt and already handled keys before numeric
stepping or mode changes. Preserve ordinary and Shift arrows, completed Enter
and Escape, clicking to edit, disabled arrows, numeric format parsing and
declared bounds. Group all controls and key variants under this single shared
owner. Vendor deviation 62 records the narrow local correction.

The three normal Chromium menu workflows are causally RED on unchanged Green28
`435e1779e` after ordinary ArrowUp passes in each
(`/tmp/soundscaper-r6-fx037-public-red.log`). The retained final baseline also
completes a healthy ArrowUp/Down → Generate → WAV export control with 48,000
frames, a 1000 Hz amplitude above 0.5 and the adjacent 1001 Hz amplitude below
0.01, while all three key variants remain causally RED
(`/tmp/soundscaper-r6-fx037-public-red2.log`, one control PASS, three RED).
After correcting a fake DOM class observer, all seven strict owned-key cases
are causally RED while the plain/Shift and completed-key control passes
(`/tmp/soundscaper-r6-fx037-node-red2.log`).
After repair, all eleven new and existing shared-stepper parsing, bounds and
pending-generator cases pass (`/tmp/soundscaper-r6-fx037-node-green.log`).
Focused strict compilation, targeted and canonical changed-file lint, and
size/diff checks pass. Source ready.
Public GREEN remains pending the next immutable snapshot; this register retains
thirty-six verified roots. No assistance runtime assets change and no manual
**Update AI assets** run is required.
