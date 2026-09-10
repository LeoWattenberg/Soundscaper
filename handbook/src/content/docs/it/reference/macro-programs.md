---
title: "Programmi macro"
description: "L'API JavaScript su cui viene eseguito un programma macro, i limiti entro cui opera e il file in cui è contenuto."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","targetLocale":"it"} -->

Un programma macro è una macro scritta in JavaScript anziché come un elenco di passaggi.
Viene eseguito all'interno dell'editor contro una piccola API denominata `sound`, che consente di leggere
il progetto aperto, spostare la selezione e applicare gli stessi effetti e comandi che una
macro a elenco di passaggi può applicare. Tutto il resto, dai file e la rete agli
altri progetti, è fuori dalla sua portata.

I programmi sono una funzione di Soundscaper. Framescaper non dispone di un gestore macro.

## Dove risiedono i programmi

Scegliere **Strumenti → Gestore macro**. La finestra di dialogo elenca le macro a elenco di passaggi e, sotto
**Programmi**, i programmi salvati. **Nuovo programma** ne crea uno e il
pannello dei dettagli mostra il **Nome programma**, il testo del **Programma** e un pulsante **Esegui
programma**. Il testo viene salvato durante la digitazione; non esiste un passaggio di salvataggio separato.

Un programma viene salvato insieme alle impostazioni dell'editor, non all'interno di un progetto, quindi è
disponibile in ogni progetto aperto in questo editor. Utilizzare **Esporta programma** e
**Importa programma** per spostarlo su un altro computer o per un'altra persona; vedere
[Condivisione dei programmi](#sharing-programs) per i dettagli.


La guida [Applicare la stessa catena di effetti ogni volta](/guides/effects/apply-the-same-effects-every-time/)
tratta l'aspetto a elenco di passaggi della stessa finestra di dialogo.

## Scrittura di un programma

Un programma è il corpo di una funzione `async`, eseguito in modalità strict. Ciò significa che è
possibile `await` a livello superiore, dichiarare variabili e funzioni e utilizzare ogni
funzionalità linguistica ordinaria. L'oggetto `sound` è l'unico collegamento del programma con
l'editor e ogni chiamata su di esso restituisce una promise.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Tab inserisce due spazi nel campo del programma. Premi Escape e poi Tab per uscire
dal campo.

### Cosa può usare un programma

È presente la solita libreria standard di JavaScript: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, le typed array, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` e `queueMicrotask`. `console`
è presente anche, e tutto ciò che viene scritto in essa finisce nel log del programma.

### Cosa non può usare un programma

Un programma viene eseguito in un worker a cui sono state rimosse le capacità prima che
venga eseguita la prima riga. Nessuno dei seguenti elementi esiste all'interno di un programma: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` e `setInterval`. La lettura di uno di questi restituisce `undefined`.

Un programma non può `import` un modulo; un `import` statico è un errore di sintassi nella
riga che lo contiene. Tutto ciò di cui il programma ha bisogno deve essere nel programma.

Il confine di sicurezza non sono i globali mancanti, ma l'editor stesso: risponde
solo alle chiamate elencate in questa pagina e rifiuta tutto il resto per nome,
indipendentemente da ciò che un programma riesce a inviargli.

## Esecuzione di un programma

Premi **Esegui programma**. L'intera esecuzione è una sola voce nella cronologia del progetto, quindi
un solo **Annulla** inverte tutto ciò che il programma ha fatto, indipendentemente da quante modifiche ha apportato.
Se il programma genera un errore, viene annullato o supera la scadenza, il progetto viene
ripristinato esattamente come era prima dell'inizio dell'esecuzione.

**Annulla esecuzione** interrompe immediatamente un programma. Un programma che è in esecuzione da due
minuti viene interrotto allo stesso modo, con il messaggio *La macro è stata eseguita per più di
120 secondi.*

Dopo l'esecuzione, il pannello mostra il log del programma, seguito da *Programma applicato.*
quando l'esecuzione è completata. Un'esecuzione fallita mostra *Il programma è fallito alla riga N:* e
il messaggio dell'errore, dove il numero di riga è la riga del programma che ha generato l'errore.

### Quale audio un effetto modifica

Un effetto applicato da un programma viene eseguito sull'intervallo di tempo corrente nella
traccia focalizzata, che è la traccia la cui intestazione è stata cliccata per ultima o il cui clip
è stato selezionato per ultimo. Quando non c'è una selezione di tempo ma un clip è selezionato, l'
effetto copre quel clip. Le chiamate di selezione di un programma modificano l'intervallo di tempo e
l'insieme delle tracce selezionate, ma non quale traccia ha il focus, quindi un'esecuzione elabora
una sola traccia. Se nulla è focalizzato o la selezione è vuota, l'esecuzione fallisce con
lo stesso messaggio fornito dal menu Effetto.

## L'API `sound`

Ogni metodo riportato di seguito restituisce una promise a meno che non sia indicato diversamente. Attendi ciascuna chiamata
prima di farne un'altra; un programma che avvia più di otto chiamate senza
attenderle ha la nona rifiutata.

### `sound.env`

Un oggetto semplice che descrive l'esecuzione.

| Campo | Significato |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | La lingua dell'interfaccia dell'editor, ad esempio `"en"` o `"de"`. |
| `seed` | Il seed da cui derivano i numeri casuali dell'esecuzione. Nuovo per ogni esecuzione. |
| `startedAt` | L'ora reale in cui l'esecuzione è iniziata, come stringa ISO 8601. |
| `dryRun` | Attualmente sempre `false`. Riservato. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` e `sound.log.debug(...values)` scrivono una riga
ciascuna nel log dell'esecuzione. `console.log`, `console.info`, `console.warn`,
`console.error` e `console.debug` fanno la stessa cosa. I valori che non sono stringhe vengono
scritti come JSON. Questi metodi non restituiscono nulla e non devono essere attesi.

Un log contiene al massimo 1.000 righe o 256 KiB, a seconda di quale limite viene raggiunto per primo, e ogni riga
viene troncata a 4.096 caratteri. Le righe oltre tale limite vengono scartate e conteggiate; il conteggio
viene riportato come un avviso finale.

### `sound.project`

La lettura del progetto non lo modifica mai e non conta contro il budget di modifiche
dell'esecuzione.

`sound.project.snapshot()` restituisce `{ sampleRate, tracks, selection }`, con
`tracks` e `selection` come le due chiamate riportate di seguito li restituiscono. `sampleRate` è la
tasso di campionamento del progetto in hertz, che è l'unità in cui viene misurato ogni conteggio di frame in questa pagina.

`sound.project.tracks()` restituisce un array di tracce in ordine di timeline:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` restituisce le clip su una traccia, o su tutte le tracce
quando `trackId` è omesso:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` restituisce la selezione corrente:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Ogni chiamata di selezione conta come una modifica e restituisce la selezione prodotta,
nella forma restituita da `sound.project.selection()`.

`sound.select.time(start, end, options)` imposta l'intervallo di tempo in secondi. È
il comando `SelectTime` di Audacity e `options.relativeTo` sceglie da dove viene misurato ciascun
bordo. Entrambi i bordi possono essere bassi fino a -100 secondi.

| `relativeTo` | Bordo iniziale | Bordo finale |
| --- | --- | --- |
| `'project-start'` (predefinito) | `start` secondi dall'inizio del progetto | `end` secondi dall'inizio del progetto |
| `'project'` | `start` secondi dall'inizio del progetto | `end` secondi oltre la fine del progetto |
| `'project-end'` | `start` secondi prima della fine del progetto | `end` secondi prima della fine del progetto |
| `'selection-start'` | `start` secondi dopo l'inizio della selezione | `end` secondi dopo l'inizio della selezione |
| `'selection'` | `start` secondi dopo l'inizio della selezione | `end` secondi dopo la fine della selezione |
| `'selection-end'` | `start` secondi prima della fine della selezione | `end` secondi prima della fine della selezione |

La fine del progetto è l'ultimo frame raggiunto da qualsiasi clip. Le tracce selezionate restano
come erano.

`sound.select.frames(startFrame, endFrame, options)` imposta l'intervallo di tempo in
frame alla frequenza di campionamento del progetto. `options.trackIds` specifica le tracce da
selezionare; se omesso, le tracce già selezionate restano selezionate.
L'intervallo viene limitato alla timeline e i bordi vengono scambiati se invertiti.

`sound.select.tracks(options)` è il comando `SelectTracks` di Audacity. Seleziona
le tracce il cui indice (contato da 0) rientra nell'intervallo da `options.track`
(predefinito 0) che copre `options.trackCount` tracce (predefinito 1). `options.mode` è
`'set'` per sostituire la selezione delle tracce, `'add'` per ampliarla o `'remove'` per
escludere quelle tracce da essa. L'intervallo di tempo resta come era.

`sound.select.frequencies(options)` è il comando `SelectFrequencies` di Audacity.
Imposta la selezione spettrale su `options.low` e `options.high` in hertz;
un bordo omesso mantiene il suo valore attuale.

`sound.select.all()` seleziona l'intero progetto su ogni traccia.
`sound.select.none()` cancella la selezione.

### `sound.effect(type, params)`

Applica un effetto sulla selezione corrente, sulla traccia attiva. `type` è
un ID effetto da [Effetti applicabili da un programma](#effects-a-program-can-apply),
e `params` è un oggetto dei parametri di quell'effetto. I parametri omessi assumono
i valori predefiniti dell'effetto; i valori vengono verificati rispetto agli intervalli nella
[referenza degli effetti audio](/reference/generated/audio-effects/). Si risolve in
`null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Applica una catena di effetti alla selezione corrente in un'unica passata, esattamente come farebbe una macro con un elenco di passaggi contenente tali passaggi. Ogni passaggio è `{ type, params }`, e la catena richiede almeno un passaggio. Si risolve in `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Esegue uno dei comandi macro di Audacity elencati sotto
[Comandi che un programma può eseguire](#commands-a-program-can-run). I quattro comandi di selezione accettano i parametri descritti lì; gli altri non ne accettano. Si risolve sulla selezione successivamente.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Esegue una macro di elenco di passaggi salvata nello stesso gestore di macro, tramite il suo nome esatto,
inclusi eventuali comandi di selezione che contiene. Una macro salvata non può essere essa stessa un
programma, quindi i programmi non si annidano. Si risolve in `null`; un nome sconosciuto viene rifiutato.

### Tempo e casualità

Un'esecuzione è riproducibile: due esecuzioni dello stesso programma sullo stesso progetto leggono
lo stesso, perché l'orologio e i numeri casuali non sono quelli della macchina.

`Date.now()` e `new Date()` senza argomenti restituiscono un orologio virtuale che
parte da 0 e avanza di uno per ogni chiamata all'editor a cui viene risposto, e di
`ms` per ogni `sound.wait(ms)`. `sound.wait` si risolve immediatamente; non c'è
modo per un programma di fare una pausa per il tempo reale, e non è necessario, perché ogni chiamata
all'editor si completa prima che la sua promessa si risolva.

`Math.random()` e `sound.random()` sono lo stesso generatore, inizializzato da
`sound.env.seed`. Registra il seme se hai bisogno di sapere quale sequenza ha usato un'esecuzione.

### Verifica delle tue assunzioni

`sound.assert(condition, message)` genera `message` quando `condition` è falso.
`sound.assertEqual(actual, expected, message)` confronta i due valori come JSON
e genera un errore quando differiscono, con un messaggio che nomina entrambi i valori se non ne fornisci
nessuno. Poiché un errore generato termina l'esecuzione e annulla tutto ciò che l'ha preceduto, un
assert fallito lascia il progetto intatto. Nessun metodo restituisce una promessa.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Valori che passano all'editor

Ogni argomento che un programma passa e ogni valore che riceve è un semplice dato:
`null`, booleani, numeri finiti, stringhe e matrici e oggetti semplici di
questi tipi. `NaN`, `Infinity`, funzioni, istanze di classi, matrici tipizzate e oggetti `Date`
vengono rifiutati con un errore, così come qualsiasi valore superiore a 1 MiB, annidato a più
di 12 livelli di profondità o contenente più di 4.096 voci in una singola matrice o oggetto.
Le proprietà `undefined` vengono scartate.

## Limiti

| Limite | Valore |
| --- | --- |
| Lunghezza del programma | 256 KiB |
| Chiamate all'editor per esecuzione | 4.096 |
| Modifiche al progetto per esecuzione (chiamate di selezione, effetti, comandi) | 256 |
| Chiamate in attesa di risposta simultanee | 8 |
| Tempo di esecuzione | 120 secondi |
| Un singolo valore che passa a o dall'editor | 1 MiB, 12 livelli di profondità, 4.096 voci per matrice o oggetto |
| Registro | 1.000 righe o 256 KiB; 4.096 caratteri per riga |
| Programmi nella libreria | 128 |
| Nome del programma | 256 caratteri |
| File di programma importato | 1 MiB |

Un ciclo che seleziona ogni clip e applica un effetto consuma due modifiche per
clip, quindi può coprire 128 clip prima che il budget si esaurisca.

## Errori

Una chiamata rifiutata dall'editor rifiuta la sua promessa con un `Error` il cui `message`
dichiara il motivo: un comando al di fuori del vocabolario, un effetto su una selezione vuota,
un parametro fuori intervallo. L'errore include anche un `code`, che è
`MACRO_CALL_FAILED` a meno che l'editor non ne fornisca uno più specifico. Un programma
può catturare questi errori e continuare:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Il programma si completa e il suo log riporta *refused: Unsupported macro command:
ExportWav.*

Un errore che il programma non intercetta termina l'esecuzione, ripristina il progetto e viene
visualizzato nel pannello con la riga da cui proviene. Un programma che non viene compilato viene
segnalato allo stesso modo prima che qualsiasi cosa venga eseguita.

## Effetti applicabili da un programma {#effects-a-program-can-apply}

Questi sono gli ID degli effetti `sound.effect` e `sound.effects` accettati, con le
cle dei parametri che ciascuno accetta e i relativi valori predefiniti. Gli intervalli e le unità sono nel
[reference degli effetti audio](/reference/generated/audio-effects/). I plug-in Nyquist
non possono essere applicati da un programma.

| Effetto | ID effetto | Parametri e valori predefiniti |
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
| Fade In | `audacity-fade-in` | nessuno |
| Fade Out | `audacity-fade-out` | nessuno |
| Filter Curve EQ | `audacity-filter-curve-eq` | `points`: un array di `{ frequency, gain }`, predefinito due punti piatti a 20 Hz e 20 kHz; `linearFrequencyScale: false`; `filterLength: 8191` |
| Four-band parametric EQ | `eq` | `outputGain: 0`; `bands`: quattro oggetti `{ id, enabled, type, frequency, gain, q, slope }`, con picco a 100, 500, 2000 e 8000 Hz con `gain: 0`, `q: 1`, `slope: 12` |
| Gate | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Graphic EQ | `audacity-graphic-eq` | `gains`: 31 guadagni di banda in dB, tutti 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| High-pass filter | `highpass` | `frequency: 80`, `q: 0.707` |
| Invert | `audacity-invert` | nessuno |
| Legacy Compressor | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limiter | `limiter` | `ceiling: -1`, `lookahead: 0.005`, `release: 0.1` |
| Limiter (Audacity) | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Loudness Normalization | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Low-pass filter | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Noise Reduction | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalize | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Remove DC Offset | `audacity-remove-dc-offset` | nessuno |
| Repair | `audacity-repair` | nessuno |
| Repeat | `audacity-repeat` | `count: 1` |
| Reverb | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Reverb (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Reverse | `audacity-reverse` | none |
| Sliding Stretch | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Truncate Silence | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Utility Gain (Reviewed) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Due effects necessitano di qualcosa che un programma non può fornire. Noise Reduction richiede un profilo del rumore acquisito nella finestra di dialogo dell'effetto stesso, e Auto Duck richiede una traccia di controllo sotto quella focalizzata.

## Comandi che un programma può eseguire {#commands-a-program-can-run}

`sound.command` accetta i nomi dei comandi macro di Audacity riportati di seguito. Sono gli stessi nomi che una macro a elenco di passi può contenere, quindi un programma e un elenco di passi hanno esattamente la stessa portata. Ogni comando esegue l'azione dell'editor descritta dai
[comandi di riferimento](/reference/generated/commands/).

### Comandi di selezione con parametri

| Comando | Parametri |
| --- | --- |
| `SelectTime` | `start`, `end` in secondi; `relativeTo` come per `sound.select.time` |
| `SelectFrequencies` | `low`, `high` in hertz |
| `SelectTracks` | `track`, `trackCount` (da 0 a 100); `mode` di `'set'`, `'add'` o `'remove'` |
| `Select` | Qualsiasi combinazione dei tre gruppi di cui sopra |

Un parametro che si omette lascia invariata quella parte della selezione, ed è così che Audacity li interpreta anch'esso.

### Comandi senza parametri

| Gruppo | Comandi |
| --- | --- |
| Selezione | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Modifica | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Tracce | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Etichette | `AddLabel` |
| Analisi | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Cosa è deliberatamente assente

`Undo` e `Redo` sono assenti perché un'esecuzione è già una voce della cronologia e un passo che percorresse la cronologia andrebbe oltre l'esecuzione fino alle proprie modifiche. I comandi di trasporto e di registrazione sono assenti perché un programma non ha nulla su cui attendere e non può essere annullato da una registrazione. L'apertura, il salvataggio, la chiusura, l'importazione, l'esportazione e le preferenze sono assenti perché la portata di un programma è il singolo progetto che era aperto al momento dell'avvio. I comandi che aprono solo una finestra di dialogo o modificano la visualizzazione sono assenti perché non modificano nulla nel progetto.

## Condivisione dei programmi {#sharing-programs}

**Esporta programma** scrive il programma selezionato come file `.soundscapemacro`, e
**Importa programma** ne legge uno. Il file è JSON e non un semplice file `.js`, in modo
che nulla sul computer di destinazione lo scambi per qualcosa da eseguire al di fuori
dell'editor:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

L'importazione salva solo il testo e nient'altro. Un programma importato non ha il pulsante **Esegui
programma**; al suo posto, il pannello mostra il programma, il file da cui proviene,
una nota su ciò che un programma può fare al progetto aperto e una casella di controllo con la dicitura *Ho
letto questo programma e desidero eseguirlo.* Selezionandola viene abilitato **Abilita questo
programma** e solo allora il programma può essere eseguito.

Tale autorizzazione vale per il testo esatto che hai letto. Se il programma viene
modificato in seguito, che tu lo modifichi tu stesso o che tu ne importi una copia più recente al suo posto, la revisione
riappare finché non abiliti il nuovo testo. I programmi che scrivi tu stesso nel gestore
non richiedono alcuna revisione.

## Esempi

Effettua il dissolvenza in di ogni clip sulla prima traccia che ne contiene. Prima di eseguire, fai clic sull'intestazione di quella traccia,
in modo che l'effetto venga applicato alla traccia che il programma sta leggendo:

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

Segnala il progetto senza modificarlo:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Eseguire una macro di elenco di passaggi salvati solo quando la selezione è sufficientemente lunga:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## Informazioni su questa pagina

Ogni programma presente in questa pagina, dai frammenti di una riga agli esempi pratici,
viene eseguito su ogni build di Soundscaper dalla suite del browser
(`tests/browser/handbook-macro-program-examples.spec.js`), che legge i
programmi dal testo stesso di questa pagina. Un programma che smette di completare, o smette
di produrre ciò che questa pagina afferma di produrre, fa fallire la build finché la pagina o l'
editor non vengono corretti.
