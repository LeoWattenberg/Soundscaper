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
twenty-one verified roots. R6-EFFECT-022 has focused GREEN and await a later
build.

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
targeted type-aware lint and size/diff checks pass. Public GREEN awaits
the next immutable product build. No assistance runtime assets change and no
manual **Update AI assets** run is required.
