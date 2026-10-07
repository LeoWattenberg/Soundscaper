# Round four: effects and analysis

Only new defects beyond the preceding 303 fixes count here. Reproductions use
ordinary editor controls and media on immutable baseline `a0322d6e4`; fixture or
test setup failures do not count.

## R4-ROOT-001 — Loudness Normalization skips the first native-rate block

Import an ordinary 11,025 Hz mono WAV with a 400 ms phrase followed by a pause.
Open Clip properties, focus Source waveform, and press Ctrl+A. Choose
Effect → Volume and compression → Loudness Normalization and apply its defaults.
Export the result. The normalization measures too little of the phrase and leaves
it louder than the requested target.

The baseline public workflow measured the centred mono export's left channel at
−28.373 LUFS rather than approximately −29.021 LUFS. A strict regression using
the independent delivery meter also measured −22.218 LUFS for a −23 LUFS request
without dual-mono compensation. The ring's write position incorrectly scheduled
measurement windows: at 11,025 Hz, a 400 ms ring contains 4,410 samples while four
rounded 100 ms hops contain 4,412 samples, so its first complete window was missed.

Schedule the first measurement after one complete 400 ms window and later
measurements after each rounded 100 ms hop, independently of ring wraparound.
Six native-rate phrase/pause cases and three existing loudness regressions pass.
The strict cases use the existing 0.2 LU delivery tolerance for the adapted
Audacity coefficients; the baseline 11,025 Hz cases exceed it by approximately
0.78 LU. The full public workflow passes Chromium, Firefox, and WebKit on the
immutable `root-loudness-clock1` build.

Regression files: `audacity-effects-round4-loudness-clock.test.ts` and
`audio-editor-round4-loudness-clock.spec.js`. Local baseline, strict, build, and
browser evidence is recorded in `/tmp/soundscaper-r4-root-loudness-clock-*`.

## R4-ROOT-002 — Source effect controls use the project frequency limit

Import an ordinary 11,025 Hz recording into the 48 kHz editor. Open its Clip
properties, select the entire Source waveform with Ctrl+A, then choose
Effect → EQ and filters → High-pass filter. Enter 6,000 Hz in Cutoff frequency.
The baseline accepted the value as valid even though the selected source's
Nyquist limit is 5,512.5 Hz and its processor cannot accept that cutoff.

Expose the source selection's native sample rate through its existing effect
service and action facade, and use it for the selection dialog's controls and
graphs. The ordinary timeline selection continues to use the project rate.
The public baseline accepts 6,000 Hz without an invalid indication; the corrected
dialog marks it invalid, accepts 5,512.4 Hz, and applies the filter successfully.
This differs from the earlier unsupported Change Pitch parameter bug: here the
dialog used the wrong clock for an independently selected source.

The complete public workflow passes Chromium, Firefox, and WebKit on the clean
owned `source-effect-rate-clean1` build, which retains the production startup
limits. All 21 focused source, action-boundary, and mounted selection-dialog tests
pass. Regression files are `audio-editor-round4-source-effect-rate.test.ts` and
`audio-editor-round4-source-effect-controls.spec.js`; local evidence is recorded
in `/tmp/soundscaper-r4-root-source-effect-*`.

## R4-ROOT-003 — Source Auto Duck reads its control at the wrong timeline position

Import ordinary two-second music and voice recordings. In each clip's Media
settings, move Start to one second. Mute the voice track, open the music clip's
Source waveform, select all with Ctrl+A, then choose Effect → Volume and
compression → Auto Duck and select voice as its Control track. Apply the effect
and export WAV. The baseline reads the voice at source-relative project frames
rather than at the music clip's actual placement, so the first phrase receives
the wrong attenuation. At 1.7–1.8 seconds the public baseline export peaks at
0.14235 rather than the expected approximately 0.062 after the default fade.

Resolve control samples through the source clip's timeline mapping, retaining
native sample-rate conversion, reversal, warp segments and bounded render
windows. Apply and Preview share this control renderer; ordinary timeline
selections retain their original range. This is independent of round three's
replacement-dialog choice of a label track as the default control.

The same public workflow fails on immutable baseline `a0322d6e4` and passes
Chromium, Firefox and WebKit on the clean owned `source-duck-clean1` build.
Five new strict mapping cases and existing effect-selection/source regressions
pass, 46 tests altogether. The regression measures beyond the intentional
500 ms fade-down without changing its gain bounds. Regression files are
`audio-editor-round4-source-duck-control.test.ts` and
`audio-editor-round4-source-duck-placement.spec.js`; evidence is recorded in
`/tmp/soundscaper-r4-root-source-duck-*`.

## R4-ROOT-004 — Reimporting a program disables its authored original

Choose Tools → Macros palette → New program and enter
`sound.log.info('Original authored program ran');`. Export program, import that
unchanged download without deleting the original, and select the authored
original again. Its Run program button remains enabled, but the baseline run
fails without executing its source: an unreviewed duplicate incorrectly revokes
the existing permission for those exact authored bytes.

The source gate now permits an exact source when any retained copy has its
authored or explicitly reviewed permission. The imported record still requires
review in the palette. Removing the permitted original, or changing the only
reviewed copy, restores the block for the unreviewed source. This differs from
the earlier review-checkbox and import-feedback presentation defects.

The ordinary export/chooser/import/run workflow fails on immutable baseline
`a0322d6e4` and passes Chromium, Firefox and WebKit on the clean owned
`authored-import-clean2` build. Two strict service regressions and existing
library/program cases pass, 18 tests altogether; targeted lint also passes.
Regression files are `audio-editor-round4-authored-program-import.test.ts` and
`audio-editor-round4-authored-program-import.spec.js`; evidence is recorded in
`/tmp/soundscaper-r4-root-authored-program-import-*`.

## R4-ROOT-005 — Macro selection reads report a selected clip as empty

Import an ordinary 800 ms WAV and select its clip header. Choose Tools → Macros
palette → New program and read `await sound.project.selection()`. Log its start
and end frames. The baseline reports `0..0` despite the selected clip occupying
`0..38400` project samples. The documented program reader copied only collapsed
stored time fields and omitted the clip identities that define the selection.

Resolve the effective selection in the macro host before returning its existing
frame/track shape. Snapshot reads share this correction, disjoint clips bracket
their actual range, and explicit time selections remain authoritative. Reading
does not change selection or document state. This differs from previous label
creation and track-scope consumers that independently lost clip-derived bounds.

The explicit clip-header workflow fails on immutable baseline `a0322d6e4` and
passes Chromium, Firefox and WebKit on the clean owned `selection-read-clean3`
build. Three strict reader cases and existing host/program support pass, 22 tests
altogether; targeted lint passes. Regression files are
`audio-editor-round4-program-selection-read.test.ts` and
`audio-editor-round4-program-selection-read.spec.js`; evidence is recorded in
`/tmp/soundscaper-r4-root-program-selection-read-*`.

## R4-ROOT-006 — Macro Select all omits labels after the last recording

Import an ordinary 800 ms WAV and an ordinary Audacity label text file containing
a point cue at two seconds. Choose Tools → Macros palette → New program, run
`const selected = await sound.select.all();`, and log `selected.endFrame`.
The baseline selects only through sample 38400 instead of including the cue at
96000, contrary to the command's documented whole-project selection.

The macro's separate Select all mutator now includes label endpoints in its
already resolved project-sample duration calculation. It retains any longer
declared duration, every track ID, and one selection write. This is independent
of 005's read-only conversion of existing clip-header selections.

The unchanged label-file chooser and program workflow fails on immutable
baseline `a0322d6e4` and passes Chromium, Firefox and WebKit on the clean owned
`all-labels-clean5` build. Two strict mixed/label-only cases and existing macro
reader/host/program tests pass, 24 tests altogether. Regression files are
`audio-editor-round4-program-select-all-labels.test.ts` and
`audio-editor-round4-program-select-all-labels.spec.js`; evidence is recorded in
`/tmp/soundscaper-r4-root-program-select-all-labels-*`.

## R4-ROOT-007 — A group or send rack cannot capture its noise profile

Import an ordinary recording, choose Select → Select all and Window → Mixer.
Add a group bus, route the recording's Output to that bus, open its effect rack,
add Noise Reduction and press Get noise profile. The baseline never captures a
profile or enables the effect: its controller looks for the bus ID among audio
tracks. Send racks use the same incorrect scope normalization and count once.

Retain the actual rack scope and render its pre-fader prefix. The temporary
render preserves upstream processing and routing, removes later rack processing,
neutralizes the target fader and downstream master, and suppresses other output
paths without editing the authored project. The resulting profile is committed
once to that bus's effect. Track and master capture retain their existing paths.

The unchanged public group-bus workflow fails on immutable baseline `a0322d6e4`
and captures, enables, and offers Replace noise profile in Chromium, Firefox and
WebKit on clean owned `bus-noise-clean6` (3/3). Five strict owner/render/update
cases and existing controls/audio support pass, 41 tests altogether. Regression
files are `audio-editor-round4-bus-noise-profile.test.ts` and
`audio-editor-round4-bus-noise-profile.spec.js`; evidence is recorded in
`/tmp/soundscaper-r4-root-bus-noise-*`.

## R4-ROOT-008 — Group and send effect dialogs identify themselves as Master

Import audio, choose Window → Mixer, add a group bus, open that bus's effect
rack and add Feedback delay. The baseline dialog title says
`Feedback delay - Master effects` although changes are applied to Group bus 1.
Every non-track scope took the master-only title branch; send racks share that
presentation defect and count once.

Use the actual selected rack owner's name for track and bus effects, reserving
Master effects for the master rack. This title-only correction is independent
of 007's profile-capture controller and rendering path. The unchanged ordinary
group-bus workflow fails on immutable baseline `a0322d6e4` and displays
`Feedback delay - Group bus 1` in Chromium, Firefox and WebKit on clean owned
`bus-owner-clean7` (3/3). The ratcheted overlay retains its exact line count.
Regression file: `audio-editor-round4-bus-effect-owner.spec.js`; evidence is
recorded in `/tmp/soundscaper-r4-root-bus-owner-*`.

## R4-ROOT-009 — Live Spectrum loses opposite-polarity stereo audio

Import an ordinary stereo recording with opposite left/right polarity. Choose
Analyze → Analysis, expand Spectrum and play. The live peak remains above
−15 dBFS, but the baseline spectrum is empty: the FFT analyser downmixes the two
channels before measuring their energy. The public canvas has zero signal
pixels above the lower quarter of its plot.

Split the declared master channels into FFT side taps while the existing
visible-panel lease is held. Pool their power per frequency bin before taking
the existing logarithmic buckets. Keep the scalar compatibility path and stereo
correlation, reuse the cached bucket geometry, and release every side tap when
the lease ends. Spectrum and Spectrogram share this one live FFT input root.
The earlier offline Plot Spectrum fix uses an independent stored-PCM analyser
and never touched these playback nodes.

The unchanged chooser/menu/playback workflow fails on immutable baseline
`a0322d6e4` and retains its visible spectrum in Chromium, Firefox and WebKit on
clean owned `live-phase-clean8`. The new workflow and existing realtime panel
responsiveness workflow pass 6/6. Three strict power/lease cases and existing
meter, responsiveness and actual engine support pass, 20 tests altogether.
Regression files are `audio-editor-round4-live-spectrum-phase.test.ts` and
`audio-editor-round4-live-spectrum-phase.spec.js`; evidence is recorded in
`/tmp/soundscaper-r4-root-live-phase-*`.

## R4-ROOT-010 — Muting Master makes its captured noise profile silent

Import an ordinary recording, select all and open Window → Mixer. Mute Master,
add Noise Reduction to its rack and press Get noise profile. Close the effect,
unmute Master and export WAV. The baseline captures the post-mute silence,
leaving the default reduction ineffective: the steady exported peak is 0.24747
instead of the expected approximately 0.124.

Neutralize the master listening mute in the existing detached prefix render,
alongside the already-neutral gain. Retain upstream mixer state and earlier
effects, exclude the profiled effect and its successors, and leave the authored
project unchanged. This existing master renderer is independent of 007's bus
scope admission and isolated bus capture.

The unchanged public picker/menu/download workflow fails on immutable baseline
`a0322d6e4` and passes in Chromium, Firefox and WebKit on clean owned
`muted-master-clean9` (3/3). The strict pre-fader/prefix/immutability regression
was red before the fix; it and existing bus, audio and control cases pass 40/40.
Targeted lint passes. Regression files are
`audio-editor-round4-muted-master-profile.test.ts` and
`audio-editor-round4-muted-master-profile.spec.js`; evidence is recorded in
`/tmp/soundscaper-r4-root-muted-master-*`.

These browser DSP, UI, and regression changes retain the assistance runtime closure.
A manual **Update AI assets** run is not required.


## R4-ROOT-011 — Spectrogram retains the previous project’s history

Import an ordinary recording, choose Analyze → Analysis, expand Spectrogram,
and play until its canvas shows signal. Stop and press New project. The baseline
shows the previous recording’s colored history in the empty project.

Give the history canvas its actual project identity without closing its expanded
section or restarting the visual-analysis lease. Before activating another
project, clear and publish the previous meter snapshot through its transport
owner, so the new canvas cannot paint an old telemetry column. Same-project
updates preserve history. A canvas-only correction was insufficient and is not
counted separately; a direct assignment to the read-only compatibility state was
also rejected by the real controller/browser checks and removed.

The unchanged public workflow fails on immutable baseline `a0322d6e4` with 93
signal pixels after New project. The final `spectrogram-project-clean14` build
passes all three engines with zero, alongside the established realtime analysis
workflow (6/6). Its mounted history regression and real controller/activation
support pass, 32 tests altogether; targeted lint passes. Regression files are
`audio-editor-round4-spectrogram-project-history.test.tsx` and
`audio-editor-round4-spectrogram-project-history.spec.js`; evidence is recorded
in `/tmp/soundscaper-r4-root-spectrogram-*`.


## R4-ROOT-012 — A one-edge macro time command overwrites its omitted edge

Import an ordinary 800 ms WAV. Choose Tools → Macros palette → New program and
run `await sound.select.frames(0, 38400);` followed by
`await sound.command('SelectTime', { start: 0.2 });`. Log the returned selection.
The baseline selects `0..9600` instead of `9600..38400`: the command replaces an
omitted End with zero, then the editor sorts its reversed edges.

Apply the command's relative-origin arithmetic only to an edge the author
actually supplied. Preserve the other edge exactly; explicitly supplied zero
continues to update it. This applies to SelectTime and the combined Select
command, and is independent of 005's read-only clip selection conversion.

The same authored-program workflow fails on immutable baseline `a0322d6e4` and
passes Chromium, Firefox and WebKit on `spectrogram-project-clean14` (3/3).
Two strict regressions cover both omitted edges through all six origins and an
explicit zero in combined Select; existing command codec/controller support
passes with them, 19/19. Targeted lint passes. Regression files are
`audio-editor-round4-macro-time-omitted-edge.test.ts` and
`audio-editor-round4-macro-time-omitted-edge.spec.js`; evidence is recorded in
`/tmp/soundscaper-r4-root-macro-time-edge-*`.


## R4-ROOT-013 — Relative macro commands treat a selected clip as an empty range

Import an ordinary 800 ms WAV and select its clip header. Choose Tools → Macros
palette → New program and run
`await sound.select.time(0.2, 0, { relativeTo: 'selection-end' });`.
The baseline selects `0..0` instead of the clip’s last 200 ms, `28800..38400`.
Unlike the corrected read-only project reader, this independently implemented
command mutator still measures from collapsed stored time fields and then drops
the selected clip identities.

Resolve the effective selected clip span before the time/track command replaces
those identities. Retain explicit time ranges, spectral bounds and track
selection. A frequency-only command keeps its original clip-target semantics.
This consumer remains broken after 005 and 012 and counts once across selection
origins and command forms.

The same public header/program workflow fails on immutable baseline `a0322d6e4`
and passes all three engines on `macro-header-time-clean16`, alongside 005 and
012 (9/9). The strict selected/disjoint/explicit-range regressions and existing
command support pass 21/21; targeted lint passes. Regression files are
`audio-editor-round4-macro-time-header-range.test.ts` and
`audio-editor-round4-macro-time-header-range.spec.js`; evidence is recorded in
`/tmp/soundscaper-r4-root-macro-header-time-*`.


## R4-ROOT-014 — Auto Duck fades up while voice still spans the selection

Import ordinary three-second music and voice WAVs. Mute the voice track, select
the music clip and choose Effect → Volume and compression → Auto Duck with the
voice as control and default fades. Apply and export WAV. Despite voice
throughout the selection, baseline music fades back toward its original level
in the last half-second; its leading boundary also starts insufficiently ducked.
The late exported peak is 0.18732 instead of the expected attenuated range
0.04–0.08. The offline processor clips its logical duck regions before
calculating fades, incorrectly moving both fade endpoints into the selection.

Calculate the curve from the original region endpoints, clipping only writes to
the selection. This agrees with the existing live processor and the logical
fade calculation in the pinned upstream AutoDuckBase.cpp. Selection-edge
variants count once and remain independent of 003’s control-track placement.

The actual import/menu/apply/download workflow fails on immutable baseline
`a0322d6e4` and passes Chromium, Firefox and WebKit on
`duck-boundary-clean17` (3/3). The earlier Source duck-placement workflow also
passes all three engines (3/3). Two strict boundary regressions and existing
basic, live and dispatcher support pass 34/34; targeted lint passes. Regression
files are `audacity-effects-round4-duck-boundary-fades.test.ts` and
`audio-editor-round4-duck-boundary-fades.spec.js`; evidence is recorded in
`/tmp/soundscaper-r4-root-duck-boundary-*`.


## R4-ROOT-015 — A macro frame selection silently clears its spectral band

Import an ordinary WAV, select its clip header and open Tools → Macros palette
→ New program. Run `await sound.select.frequencies({low:100,high:1000});` then
`await sound.select.frames(4800,33600);`. Close the palette and open Play options.
Baseline has disabled Play selected frequencies: setting the time endpoints
silently discards the existing frequency axis. The independently implemented
frame verb bypasses the selection-command adapter corrected in R2-ROOT-001.

Carry the captured spectral range through the exact frame setter, both with
retained and explicitly supplied track IDs. Keep normal endpoint admission and
clip-target replacement. This frame-verb consumer counts once.

The same public program/menu workflow fails on immutable baseline `a0322d6e4`
and passes Chromium, Firefox and WebKit on `frame-spectral-clean18` (3/3). The
R2 frequency-only macro workflow also passes all three engines. Two strict
regressions and existing host, selection-reader and Select all support pass
17/17; targeted lint passes. Regression files are
`audio-editor-round4-program-frame-spectral-range.test.ts` and
`audio-editor-round4-program-frame-spectral-range.spec.js`; evidence is recorded
in `/tmp/soundscaper-r4-root-frame-spectral-*`. An additional unrelated live
Spectrogram check failed on Firefox’s initial signal observation and is excluded
from these six passing macro cases; its prior all-engine proof remains recorded
under 011.
