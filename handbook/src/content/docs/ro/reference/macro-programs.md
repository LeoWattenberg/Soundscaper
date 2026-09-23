---
title: "Programe macro"
description: "API-ul JavaScript folosit de programele macro, limitele sale și fișierul prin care sunt transferate."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"ro"} -->

O macrocomandă este scrisă în JavaScript, nu ca o listă de pași. Rulează
în editor printr-un API restrâns numit `sound`, care îi permite să citească
proiectul deschis, să mute selecția și să aplice aceleași efecte și comenzi ca o
macrocomandă bazată pe pași. Nu poate accesa nimic altceva: nici fișierele,
rețeaua sau celelalte proiecte.

Programele sunt o funcție Soundscaper. Framescaper nu are un manager de macrocomenzi.

## Unde se găsesc programele

Selectează **Tools → Macro manager**. Dialogul listează macrocomenzile bazate pe pași și, sub
**Programs**, programele salvate. Apasă **+ (New program)** în antetul acestei
secțiuni pentru a crea unul. Aceeași bară de acțiuni oferă **Import program**,
**Export program** și **Delete program** pentru programul selectat. Panoul
detaliilor afișează **Program name**, textul **Program** și butonul **Run
program**. Textul se salvează pe măsură ce scrii; nu există un pas separat de salvare.

Programul este stocat în setările editorului, nu într-un proiect, deci este
disponibil în toate proiectele deschise în acest editor. Folosește **Export program** și
**Import program** pentru a-l transfera pe alt computer sau altei persoane; consultă
[Partajarea programelor](#sharing-programs) pentru detalii.

The [Apply the same chain of effects every time](/guides/effects/apply-the-same-effects-every-time/)
ghidul descrie comenzile bazate pe pași din același dialog.

## Scrierea unui program

Un program este corpul unei funcții `async`, rulată în mod strict. Poți folosi
`await` la nivel superior, declara variabile și funcții și folosi funcțiile
obișnuite ale limbajului. Obiectul `sound` este singura legătură a programului
cu editorul, iar fiecare apel al său returnează o promisiune.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Tasta Tab inserează două spații în câmpul programului. Apasă Escape, apoi Tab,
pentru a ieși din câmp.

### Ce poate folosi un program

Biblioteca standard JavaScript este disponibilă: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, the typed arrays, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` and `queueMicrotask`. `console`
este disponibil și el, iar tot ce scrii acolo apare în jurnalul programului.

### Ce nu poate folosi un program

Programul rulează într-un worker căruia i se elimină capabilitățile înainte de
executarea primei linii. Într-un program nu există niciunul dintre următoarele: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` and `setInterval`. Reading any of them gives `undefined`.

Un program nu poate utiliza `import` pentru un modul; un `import` static este o eroare de
sintaxă pe linia respectivă. Tot ce îi trebuie trebuie inclus în program.

Limita de securitate nu este reprezentată de variabilele globale absente, ci de
editor: acesta acceptă doar apelurile listate pe această pagină și respinge
orice alt apel după nume, indiferent ce încearcă programul să-i trimită.

## Rularea unui program

Apasă **Run program**. Întreaga execuție este o singură intrare în istoricul proiectului, deci
one **Undo** reverses everything the program did, however many changes it made.
Dacă programul generează o eroare, este anulat sau depășește limita de timp,
proiectul revine exact la starea de dinaintea execuției.

**Cancel run** oprește programul imediat. Un program care rulează de două
minute este oprit în același mod, cu mesajul *The macro ran for longer than
120 seconds.*

După execuție, panoul afișează jurnalul programului, urmat de *Program applied.*
when the run completed. A failed run shows *The program failed on line N:* and
the error's message, where the line number is the line of your program that
threw.

### Asupra cărui sunet se aplică efectul

Un efect aplicat de un program operează asupra selecției de timp curente de pe
focused track, which is the track whose header you last clicked or whose clip
you last selected. When there is no time selection but a clip is selected, the
effect covers that clip. A program's selection calls change the time range and
the set of selected tracks, but not which track has focus, so one run processes
one track. If nothing is focused or the selection is empty, the run fails with
the same message the Effect menu gives.

## API-ul `sound`

Fiecare metodă de mai jos returnează o promisiune, cu excepția cazurilor
menționate. Așteaptă fiecare apel înainte de următorul; al nouălea apel este
refuzat dacă programul pornește mai mult de opt fără să le aștepte.

### `sound.env`

Un obiect simplu care descrie execuția.

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

Jurnalul păstrează cel mult 1.000 de linii sau 256 KiB, oricare limită este
atinsă prima, iar fiecare linie este trunchiată la 4.096 de caractere. Liniile
suplimentare sunt eliminate și numărate; numărul apare într-un avertisment final.

### `sound.project`

Citirea proiectului nu îl modifică și nu consumă bugetul de modificări al execuției.

`sound.project.snapshot()` returnează `{ sampleRate, tracks, selection }`, cu
`tracks` și `selection` în formele returnate de cele două apeluri de mai jos.
`sampleRate` este frecvența de eșantionare a proiectului în hertzi, unitatea
folosită pentru fiecare număr de cadre de pe această pagină.

`sound.project.tracks()` returnează un tablou cu pistele în ordinea de pe linia temporală:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` returnează clipurile de pe o pistă sau de pe
toate pistele dacă omiti `trackId`:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` returnează selecția curentă:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Fiecare apel de selecție contează ca o modificare și returnează selecția creată,
în același format ca `sound.project.selection()`.

`sound.select.time(start, end, options)` setează intervalul de timp în secunde.
Este comanda Audacity `SelectTime`, iar `options.relativeTo` stabilește
punctul de referință al fiecărei margini. Ambele pot coborî până la -100 de secunde.

| `relativeTo` | Start edge | End edge |
| --- | --- | --- |
| `'project-start'` (default) | `start` seconds from the project start | `end` seconds from the project start |
| `'project'` | `start` seconds from the project start | `end` seconds past the project end |
| `'project-end'` | `start` seconds before the project end | `end` seconds before the project end |
| `'selection-start'` | `start` seconds after the selection start | `end` seconds after the selection start |
| `'selection'` | `start` seconds after the selection start | `end` seconds after the selection end |
| `'selection-end'` | `start` seconds before the selection end | `end` seconds before the selection end |

Sfârșitul proiectului este ultimul cadru atins de orice clip. Pistele selectate
rămân neschimbate.

`sound.select.frames(startFrame, endFrame, options)` setează intervalul în
cadre, la frecvența de eșantionare a proiectului. `options.trackIds` indică
pistele de selectat; dacă este omis, rămân selectate pistele curente. Intervalul
este limitat la linia temporală, iar marginile sunt inversate dacă ordinea lor e inversă.

`sound.select.tracks(options)` este comanda Audacity `SelectTracks`. Selectează
pistele cu indici (numărați de la 0) începând de la `options.track`
(default 0) spanning `options.trackCount` tracks (default 1). `options.mode` is
`'set'` to replace the track selection, `'add'` to widen it, or `'remove'` to
pentru a le elimina din selecție. Intervalul de timp rămâne neschimbat.

`sound.select.frequencies(options)` este comanda Audacity `SelectFrequencies`.
Setează selecția spectrală la `options.low` și `options.high`, în hertzi; o
valoare omisă păstrează marginea curentă.

`sound.select.all()` selectează întregul proiect de pe fiecare pistă.
`sound.select.none()` șterge selecția.

### `sound.effect(type, params)`

Aplică un efect selecției curente de pe pista focalizată. `type` este un ID de
efect din [Efecte pe care le poate aplica programul](#effects-a-program-can-apply),
iar `params` este un obiect cu parametrii săi. Parametrii omiși folosesc
valorile implicite; cele introduse sunt verificate față de intervalele din
[referința efectelor audio](/reference/generated/audio-effects/). Returnează
`null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Aplică dintr-un singur pas o succesiune de efecte selecției curente, exact ca o
macrocomandă bazată pe aceiași pași. Fiecare pas este `{ type, params }`, iar
succesiunea trebuie să conțină cel puțin un pas. Returnează `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Rulează una dintre comenzile macro Audacity din secțiunea
[Comenzi pe care le poate rula un program](#commands-a-program-can-run). Cele
patru comenzi de selecție folosesc parametrii descriși acolo; celelalte nu
primesc parametri. Returnează selecția rezultată.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Rulează după numele exact o macrocomandă bazată pe pași, salvată în același
manager, inclusiv comenzile de selecție din aceasta. O macrocomandă salvată nu
poate fi program, deci programele nu se pot imbrica. Returnează `null`; un nume
necunoscut respinge promisiunea.

### Timp și aleatoriu

O execuție este reproductibilă: două rulări ale aceluiași program pe același
proiect obțin aceleași rezultate, deoarece ceasul și numerele aleatorii nu
depind de mașină.

`Date.now()` și `new Date()` fără argumente returnează un ceas virtual care
pornește de la 0 și avansează cu unu la fiecare apel rezolvat de editor și cu
`ms` pentru fiecare `sound.wait(ms)`. `sound.wait` se rezolvă imediat; programul
nu poate face pauză în timp real și nici nu este nevoie, deoarece fiecare apel
către editor se încheie înainte ca promisiunea sa să se rezolve.

`Math.random()` și `sound.random()` folosesc același generator, inițializat cu
`sound.env.seed`. Înregistrează seed-ul dacă vrei să afli ce secvență a folosit execuția.

### Verificarea presupunerilor

`sound.assert(condition, message)` aruncă `message` când `condition` este fals.
`sound.assertEqual(actual, expected, message)` compară valorile ca JSON și
aruncă o eroare dacă diferă; fără mesaj furnizat, eroarea numește ambele valori.
Deoarece o eroare oprește execuția și anulează modificările, o aserțiune eșuată
lasă proiectul neschimbat. Niciuna dintre metode nu returnează o promisiune.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Valorile transferate către editor

Fiecare argument trimis de program și fiecare valoare primită este o valoare simplă:
`null`, booleans, finite numbers, strings, and arrays and plain objects of
those. `NaN`, `Infinity`, functions, class instances, typed arrays and `Date`
objects are refused with an error, as is any value larger than 1 MiB, nested more
than 12 levels deep, or holding more than 4,096 entries in one array or object.
`undefined` properties are dropped.

## Limite

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

O buclă care selectează fiecare clip și aplică un efect consumă două modificări
per clip, deci poate procesa 128 de clipuri înainte de epuizarea bugetului.

## Erori

Un apel refuzat de editor respinge promisiunea cu o eroare `Error`, al cărei
`message` explică motivul: o comandă necunoscută, un efect aplicat unei selecții
goale sau un parametru în afara intervalului. Eroarea include și un `code`, care este
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

O eroare neprinsă de program oprește execuția, anulează modificările proiectului
și este afișată în panou împreună cu linia de origine. Un program care nu se
compilează este raportat la fel, înainte să ruleze ceva.

## Efecte pe care le poate aplica un program {#effects-a-program-can-apply}

Acestea sunt ID-urile de efect acceptate de `sound.effect` și `sound.effects`,
împreună cu cheile parametrilor și valorile implicite. Intervalele și unitățile
se găsesc în [referința efectelor audio](/reference/generated/audio-effects/).
Pluginurile Nyquist nu pot fi aplicate dintr-un program.

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
| Compressor | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
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
| Limiter | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
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

## Comenzi pe care le poate rula un program {#commands-a-program-can-run}

`sound.command` acceptă numele comenzilor macro Audacity de mai jos. Sunt
aceleași nume folosite de macrocomenzile bazate pe pași, deci un program și o
listă de pași au exact aceleași posibilități. Fiecare comandă rulează acțiunea
descrisă în [referința comenzilor](/reference/generated/commands/).

### Comenzi de selecție cu parametri

| Command | Parameters |
| --- | --- |
| `SelectTime` | `start`, `end` in seconds; `relativeTo` as for `sound.select.time` |
| `SelectFrequencies` | `low`, `high` in hertz |
| `SelectTracks` | `track`, `trackCount` (0 to 100); `mode` of `'set'`, `'add'` or `'remove'` |
| `Select` | Any combination of the three sets above |

Un parametru omis lasă neschimbată partea respectivă a selecției, la fel ca în Audacity.

### Comenzi fără parametri

| Group | Commands |
| --- | --- |
| Selection | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Editing | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Tracks | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Labels | `AddLabel` |
| Analysis | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Ce lipsește în mod intenționat

`Undo` și `Redo` lipsesc deoarece o execuție este deja o singură intrare în
istoric, iar o comandă care parcurge istoricul ar ajunge la editările tale.
Transport and recording commands are absent because a program has nothing to
wait for and cannot be rolled back out of a recording. Opening, saving, closing,
importing, exporting and preferences are absent because a program's reach is the
one project that was open when it started. Commands that only open a dialog or
change the view are absent because they change nothing in the project.

## Partajarea programelor {#sharing-programs}

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

## Exemple

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

## Despre această pagină

Every program on this page, from the one-line snippets to the worked examples,
is run against each build of Soundscaper by the browser suite
(`tests/browser/handbook-macro-program-examples.spec.js`), which reads the
programs out of this page's own text. A program that stops completing, or stops
producing what this page says it produces, fails the build until the page or the
editor is corrected.
