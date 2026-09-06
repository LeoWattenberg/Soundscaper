---
title: "Macro programs"
description: "The JavaScript API a macro program runs against, the limits it runs under, and the file it travels in."
sidebar:
  order: 7
---

A macro program is a macro written as JavaScript instead of as a list of steps.
It runs inside the editor against a small API called `sound`, which lets it read
the open project, move the selection, and apply the same effects and commands a
step-list macro can apply. Everything else, from files and the network to your
other projects, is out of its reach.

Programs are a Soundscaper feature. Framescaper has no macro manager.

## Where programs live

Choose **Tools → Macro manager**. The dialog lists step-list macros and, under
**Programs**, the programs you have saved. **New program** creates one, and the
detail pane shows its **Program name**, the **Program** text, and a **Run
program** button. The text is saved as you type; there is no separate save step.

A program is stored with the editor's settings, not inside a project, so it is
available in every project you open in this editor. Use **Export program** and
**Import program** to move one to another machine or another person; see
[Sharing programs](#sharing-programs) for what that involves.

The [Apply the same chain of effects every time](/guides/effects/apply-the-same-effects-every-time/)
guide covers the step-list side of the same dialog.

## Writing a program

A program is the body of an `async` function, run in strict mode. That means you
can `await` at the top level, declare variables and functions, and use every
ordinary language feature. The `sound` object is the program's only connection to
the editor, and every call on it returns a promise.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Tab inserts two spaces in the program field. Press Escape and then Tab to leave
the field.

### What a program can use

The usual JavaScript standard library is present: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, the typed arrays, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` and `queueMicrotask`. `console`
is present too, and everything written to it lands in the program's log.

### What a program cannot use

A program runs in a worker that has had its capabilities taken away before the
first line runs. None of the following exist inside a program: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` and `setInterval`. Reading any of them gives `undefined`.

A program cannot `import` a module; a static `import` is a syntax error on the
line that contains it. Whatever the program needs has to be in the program.

The security boundary is not the missing globals but the editor itself: it
answers only the calls listed on this page and refuses everything else by name,
whatever a program manages to send it.

## Running a program

Press **Run program**. The whole run is one entry in the project's history, so
one **Undo** reverses everything the program did, however many changes it made.
If the program throws, or is cancelled, or runs past its deadline, the project is
put back exactly as it was before the run began.

**Cancel run** stops a program at once. A program that has been running for two
minutes is stopped the same way, with the message *The macro ran for longer than
120 seconds.*

After the run the pane shows the program's log, followed by *Program applied.*
when the run completed. A failed run shows *The program failed on line N:* and
the error's message, where the line number is the line of your program that
threw.

### Which audio an effect touches

An effect applied by a program runs over the current time selection on the
focused track, which is the track whose header you last clicked or whose clip
you last selected. When there is no time selection but a clip is selected, the
effect covers that clip. A program's selection calls change the time range and
the set of selected tracks, but not which track has focus, so one run processes
one track. If nothing is focused or the selection is empty, the run fails with
the same message the Effect menu gives.

## The `sound` API

Every method below returns a promise unless it says otherwise. Await each call
before making the next; a program that starts more than eight calls without
awaiting them has the ninth refused.

### `sound.env`

A plain object describing the run.

| Field | Meaning |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | The editor's interface language, such as `"en"` or `"de"`. |
| `seed` | The seed the run's random numbers come from. New for every run. |
| `startedAt` | The wall-clock time the run began, as an ISO 8601 string. |
| `dryRun` | Always `false` at present. Reserved. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` and `sound.log.debug(...values)` write one line
each to the run's log. `console.log`, `console.info`, `console.warn`,
`console.error` and `console.debug` do the same. Values that are not strings are
written as JSON. These methods return nothing and do not need to be awaited.

A log holds at most 1,000 lines or 256 KiB, whichever comes first, and each line
is cut at 4,096 characters. Lines beyond that are dropped and counted; the count
is reported as a final warning.

### `sound.project`

Reading the project never changes it and does not count against the run's
change budget.

`sound.project.snapshot()` returns `{ sampleRate, tracks, selection }`, with
`tracks` and `selection` as the two calls below return them. `sampleRate` is the
project's sample rate in hertz, which is what every frame count on this page is
measured in.

`sound.project.tracks()` returns an array of tracks in timeline order:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` returns the clips on one track, or on every track
when `trackId` is omitted:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` returns the current selection:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Each selection call counts as one change and returns the selection it produced,
in the shape `sound.project.selection()` returns.

`sound.select.time(start, end, options)` sets the time range in seconds. It is
Audacity's `SelectTime` command, and `options.relativeTo` chooses where each
edge is measured from. Both edges may be as low as -100 seconds.

| `relativeTo` | Start edge | End edge |
| --- | --- | --- |
| `'project-start'` (default) | `start` seconds from the project start | `end` seconds from the project start |
| `'project'` | `start` seconds from the project start | `end` seconds past the project end |
| `'project-end'` | `start` seconds before the project end | `end` seconds before the project end |
| `'selection-start'` | `start` seconds after the selection start | `end` seconds after the selection start |
| `'selection'` | `start` seconds after the selection start | `end` seconds after the selection end |
| `'selection-end'` | `start` seconds before the selection end | `end` seconds before the selection end |

The project end is the last frame any clip reaches. The selected tracks are left
as they were.

`sound.select.frames(startFrame, endFrame, options)` sets the time range in
frames at the project sample rate. `options.trackIds` names the tracks to
select; when it is omitted the tracks that are already selected stay selected.
The range is clamped to the timeline and the edges are swapped if reversed.

`sound.select.tracks(options)` is Audacity's `SelectTracks` command. It selects
the tracks whose index (counted from 0) is in the range from `options.track`
(default 0) spanning `options.trackCount` tracks (default 1). `options.mode` is
`'set'` to replace the track selection, `'add'` to widen it, or `'remove'` to
take those tracks out of it. The time range is left as it was.

`sound.select.frequencies(options)` is Audacity's `SelectFrequencies` command.
It sets the spectral selection to `options.low` and `options.high` in hertz;
an edge you omit keeps its current value.

`sound.select.all()` selects the whole project on every track.
`sound.select.none()` clears the selection.

### `sound.effect(type, params)`

Applies one effect over the current selection, on the focused track. `type` is
an effect ID from [Effects a program can apply](#effects-a-program-can-apply),
and `params` is an object of that effect's parameters. Parameters you omit take
the effect's defaults; values are checked against the ranges in the
[audio effects reference](/reference/generated/audio-effects/). Resolves to
`null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Applies a chain of effects over the current selection in one pass, exactly as a
step-list macro with those steps would. Each step is `{ type, params }`, and the
chain needs at least one step. Resolves to `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Runs one of the Audacity macro commands listed under
[Commands a program can run](#commands-a-program-can-run). The four selection
commands take the parameters described there; the others take none. Resolves to
the selection afterwards.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Runs a step-list macro saved in the same macro manager, by its exact name,
including any selection commands it contains. A saved macro cannot itself be a
program, so programs do not nest. Resolves to `null`; an unknown name rejects.

### Time and randomness

A run is reproducible: two runs of the same program over the same project read
the same, because the clock and the random numbers are not the machine's.

`Date.now()` and `new Date()` with no arguments return a virtual clock that
starts at 0 and advances by one for every answered call to the editor, and by
`ms` for every `sound.wait(ms)`. `sound.wait` resolves immediately; there is no
way for a program to pause for real time, and none is needed, because every call
to the editor completes before its promise resolves.

`Math.random()` and `sound.random()` are the same generator, seeded from
`sound.env.seed`. Log the seed if you need to know which sequence a run used.

### Checking your assumptions

`sound.assert(condition, message)` throws `message` when `condition` is false.
`sound.assertEqual(actual, expected, message)` compares the two values as JSON
and throws when they differ, with a message that names both values if you give
none. Because a thrown error ends the run and rolls back everything before it, a
failed assertion leaves the project untouched. Neither method returns a promise.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Values that cross to the editor

Every argument a program passes and every value it receives is plain data:
`null`, booleans, finite numbers, strings, and arrays and plain objects of
those. `NaN`, `Infinity`, functions, class instances, typed arrays and `Date`
objects are refused with an error, as is any value larger than 1 MiB, nested more
than 12 levels deep, or holding more than 4,096 entries in one array or object.
`undefined` properties are dropped.

## Limits

| Limit | Value |
| --- | --- |
| Program length | 256 KiB |
| Calls to the editor per run | 4,096 |
| Changes to the project per run (selection calls, effects, commands) | 256 |
| Calls waiting for an answer at once | 8 |
| Run time | 120 seconds |
| One value crossing to or from the editor | 1 MiB, 12 levels deep, 4,096 entries per array or object |
| Log | 1,000 lines or 256 KiB; 4,096 characters per line |
| Programs in the library | 128 |
| Program name | 256 characters |
| Imported program file | 1 MiB |

A loop that selects each clip and applies one effect spends two changes per
clip, so it can cover 128 clips before the budget runs out.

## Errors

A call the editor refuses rejects its promise with an `Error` whose `message`
says why: a command outside the vocabulary, an effect over an empty selection,
a parameter out of range. The error also carries a `code`, which is
`MACRO_CALL_FAILED` unless the editor supplied a more specific one. A program
may catch these and carry on:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

That program completes, and its log reads *refused: Unsupported macro command:
ExportWav.*

An error the program does not catch ends the run, rolls the project back, and is
shown in the pane with the line it came from. A program that will not compile is
reported the same way before anything runs.

## Effects a program can apply

These are the effect IDs `sound.effect` and `sound.effects` accept, with the
parameter keys each one takes and their defaults. Ranges and units are in the
[audio effects reference](/reference/generated/audio-effects/). Nyquist
plug-ins cannot be applied from a program.

| Effect | Effect ID | Parameters and defaults |
| --- | --- | --- |
| Amplify | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Auto Duck | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Bass and Treble | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Change Pitch | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Change Speed and Pitch | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Change Tempo | `audacity-change-tempo` | `tempoPercent: 0` |
| Classic Filters | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Click Removal | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Compressor | `compressor` | `threshold: -24`, `knee: 30`, `ratio: 4`, `attack: 0.003`, `release: 0.25`, `makeupGain: 0` |
| Compressor (Audacity) | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Delay | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Distortion | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Echo | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Fade In | `audacity-fade-in` | none |
| Fade Out | `audacity-fade-out` | none |
| Filter Curve EQ | `audacity-filter-curve-eq` | `points`: an array of `{ frequency, gain }`, default two flat points at 20 Hz and 20 kHz; `linearFrequencyScale: false`; `filterLength: 8191` |
| Four-band parametric EQ | `eq` | `outputGain: 0`; `bands`: four `{ id, enabled, type, frequency, gain, q, slope }` objects, peaking at 100, 500, 2000 and 8000 Hz with `gain: 0`, `q: 1`, `slope: 12` |
| Gate | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Graphic EQ | `audacity-graphic-eq` | `gains`: 31 band gains in dB, all 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| High-pass filter | `highpass` | `frequency: 80`, `q: 0.707` |
| Invert | `audacity-invert` | none |
| Legacy Compressor | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limiter | `limiter` | `ceiling: -1`, `lookahead: 0.005`, `release: 0.1` |
| Limiter (Audacity) | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Loudness Normalization | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Low-pass filter | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Noise Reduction | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalize | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Remove DC Offset | `audacity-remove-dc-offset` | none |
| Repair | `audacity-repair` | none |
| Repeat | `audacity-repeat` | `count: 1` |
| Reverb | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Reverb (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Reverse | `audacity-reverse` | none |
| Sliding Stretch | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Truncate Silence | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Utility Gain (Reviewed) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Two effects need something a program cannot supply. Noise Reduction needs a
noise profile captured in the effect's own dialog, and Auto Duck needs a control
track below the focused one.

## Commands a program can run

`sound.command` accepts the Audacity macro command names below. They are the
same names a step-list macro can hold, so a program and a step list have exactly
the same reach. Each command runs the editor action that the
[commands reference](/reference/generated/commands/) describes.

### Selection commands with parameters

| Command | Parameters |
| --- | --- |
| `SelectTime` | `start`, `end` in seconds; `relativeTo` as for `sound.select.time` |
| `SelectFrequencies` | `low`, `high` in hertz |
| `SelectTracks` | `track`, `trackCount` (0 to 100); `mode` of `'set'`, `'add'` or `'remove'` |
| `Select` | Any combination of the three sets above |

A parameter you leave out leaves that part of the selection alone, which is how
Audacity reads them too.

### Commands without parameters

| Group | Commands |
| --- | --- |
| Selection | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Editing | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Tracks | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Labels | `AddLabel` |
| Analysis | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### What is deliberately missing

`Undo` and `Redo` are absent because a run is already one history entry and a
step that walked the history would reach past the run into your own edits.
Transport and recording commands are absent because a program has nothing to
wait for and cannot be rolled back out of a recording. Opening, saving, closing,
importing, exporting and preferences are absent because a program's reach is the
one project that was open when it started. Commands that only open a dialog or
change the view are absent because they change nothing in the project.

## Sharing programs

**Export program** writes the selected program as a `.soundscapemacro` file, and
**Import program** reads one. The file is JSON rather than a bare `.js` file, so
nothing on the receiving computer will mistake it for something to run outside
the editor:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

Importing stores the text and nothing more. An imported program has no **Run
program** button; in its place the pane shows the program, the file it came from,
a note on what a program can do to the open project, and a checkbox reading *I
have read this program and want to run it.* Ticking it enables **Enable this
program**, and only then can the program run.

That permission is for the exact text you read. If the program changes
afterwards, whether you edit it or import a newer copy over it, the review
appears again until you enable the new text. Programs you write in the manager
yourself need no review.

## Examples

Fade in every clip on the first track that has any. Click that track's header
before running, so the effect lands on the track the program is reading:

```js
let target = null;
let clips = [];
for (const track of await sound.project.tracks()) {
  clips = await sound.project.clips(track.id);
  if (clips.length) {
    target = track;
    break;
  }
}
sound.assert(target, 'There are no clips to fade.');
for (const clip of clips) {
  await sound.select.frames(clip.startFrame, clip.startFrame + clip.durationFrames, {
    trackIds: [target.id],
  });
  await sound.effect('audacity-fade-in');
  sound.log.info(`Faded in ${clip.name} on ${target.name}`);
}
```

Report the project without changing it:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Run a saved step-list macro only when the selection is long enough:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## About this page

Every program on this page, from the one-line snippets to the worked examples,
is run against each build of Soundscaper by the browser suite
(`tests/browser/handbook-macro-program-examples.spec.js`), which reads the
programs out of this page's own text. A program that stops completing, or stops
producing what this page says it produces, fails the build until the page or the
editor is corrected.
