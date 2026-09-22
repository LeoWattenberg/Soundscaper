---
title: "Macroprogramma's"
description: "De JavaScript-API waartegen een macroprogramma draait, de beperkingen en het bestand waarin het wordt uitgewisseld."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"nl"} -->


Een macroprogramma is een macro die als JavaScript is geschreven in plaats van als een lijst stappen.
Het draait in de editor tegen een kleine API met de naam `sound`, waarmee het
het geopende project kan lezen, de selectie kan verplaatsen en dezelfde effecten
en opdrachten kan toepassen als een stappenlijstmacro. Al het andere, van
bestanden en het netwerk tot je andere projecten, valt buiten zijn bereik.

Programma's zijn een functie van Soundscaper. Framescaper heeft geen macrobeheerder.

## Waar programma's staan

Kies **Tools → Macro manager**. Het dialoogvenster toont stappenlijstmacro's en
onder **Programs** de programma's die je hebt opgeslagen. Druk op **+ (New
program)** in de kop van Programs om er een te maken. Dezelfde actiebalk biedt
**Import program**, **Export program** en **Delete program** voor het geselecteerde
programma. Het detailvenster toont de **Programmanaam**, de tekst van het
**Program** en een knop **Run program**. De tekst wordt tijdens het typen
opgeslagen; er is geen aparte opslagstap.

Een programma wordt opgeslagen met de instellingen van de editor, niet in een
project, en is dus beschikbaar in elk project dat je in deze editor opent.
Gebruik **Export program** en **Import program** om er een naar een andere
computer of een andere persoon te verplaatsen; zie [Programma's delen](#sharing-programs)
voor wat daarbij komt kijken.

De handleiding [Elke keer dezelfde effectenketen toepassen](/guides/effects/apply-the-same-effects-every-time/)
behandelt de stappenlijstkant van hetzelfde dialoogvenster.

## Een programma schrijven

Een programma is de inhoud van een `async`-functie die in strikte modus wordt
uitgevoerd. Dat betekent dat je op het hoogste niveau `await` kunt gebruiken,
variabelen en functies kunt declareren en alle gewone taalfuncties kunt gebruiken.
Het object `sound` is de enige verbinding van het programma met de editor en elke
aanroep erop retourneert een promise.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Tab voegt twee spaties in het programmaveld in. Druk op Escape en daarna op Tab
om het veld te verlaten.

### Wat een programma kan gebruiken

De gebruikelijke JavaScript-standaardbibliotheek is beschikbaar: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, de getypeerde arrays, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` en `queueMicrotask`. `console`
is ook aanwezig en alles wat ernaar wordt geschreven komt in het programmaregister terecht.

### Wat een programma niet kan gebruiken

Een programma draait in een worker waarvan de mogelijkheden zijn verwijderd
voordat de eerste regel wordt uitgevoerd. Geen van het volgende bestaat binnen
een programma: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` en `setInterval`. Als je een van deze waarden leest, krijg je `undefined`.

Een programma kan geen module `import`eren; een statische `import` is een
syntaxisfout op de regel die deze bevat. Alles wat het programma nodig heeft,
moet in het programma staan.

De beveiligingsgrens bestaat niet uit ontbrekende globals maar uit de editor zelf:
die beantwoordt alleen de aanroepen die op deze pagina staan en weigert al het
andere op naam, wat een programma ook probeert te sturen.

## Een programma uitvoeren

Druk op **Run program**. De volledige uitvoering is één item in de geschiedenis
van het project, dus één **Undo** maakt alles ongedaan wat het programma deed,
ongeacht hoeveel wijzigingen het maakte. Als het programma een fout gooit, wordt
geannuleerd of de deadline overschrijdt, wordt het project exact teruggezet naar
de toestand vóór het begin van de uitvoering.

**Cancel run** stopt een programma onmiddellijk. Een programma dat twee minuten
draait, wordt op dezelfde manier gestopt, met het bericht *The macro ran for
longer than 120 seconds.*

Na afloop toont het paneel het programmaregister, gevolgd door *Program applied.*
wanneer de uitvoering is voltooid. Bij een mislukte uitvoering wordt *The
program failed on line N:* en het foutbericht getoond; het regelnummer is de
regel van je programma die de fout veroorzaakte.

### Welke audio een effect raakt

Een effect dat door een programma wordt toegepast, draait over de huidige
tijdsselectie op de track met focus. Dat is de track waarvan je de kop het laatst
hebt aangeklikt of waarvan je de clip het laatst hebt geselecteerd. Als er geen
tijdsselectie is maar wel een clip is geselecteerd, omvat het effect die clip.
De selectieaanroepen van een programma wijzigen het tijdbereik en de set
geselecteerde tracks, maar niet welke track focus heeft; één uitvoering verwerkt
dus één track. Als niets focus heeft of de selectie leeg is, mislukt de uitvoering
met hetzelfde bericht als het menu Effecten geeft.

## De `sound` API

Elke methode hieronder retourneert een promise tenzij anders vermeld. Wacht elke
aanroep af voordat je de volgende doet; als een programma meer dan acht aanroepen
start zonder erop te wachten, wordt de negende geweigerd.

### `sound.env`

Een gewoon object dat de uitvoering beschrijft.

| Veld | Betekenis |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | De interfacetaal van de editor, zoals `"en"` of `"de"`. |
| `seed` | De seed waaruit de willekeurige getallen van de uitvoering komen. Nieuw voor elke uitvoering. |
| `startedAt` | Het tijdstip waarop de uitvoering begon, als ISO 8601-string. |
| `dryRun` | Momenteel altijd `false`. Gereserveerd. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` en `sound.log.debug(...values)` schrijven elk één
regel naar het register van de uitvoering. `console.log`, `console.info`,
`console.warn`, `console.error` en `console.debug` doen hetzelfde. Waarden die
geen strings zijn, worden als JSON geschreven. Deze methoden retourneren niets en
hoeven niet te worden afgewacht.

Een register bevat maximaal 1.000 regels of 256 KiB, wat het eerst wordt bereikt,
en elke regel wordt afgekapt op 4.096 tekens. Regels daarboven worden verwijderd
en geteld; het aantal wordt als laatste waarschuwing gemeld.

### `sound.project`

Het project lezen verandert het niet en telt niet mee voor het wijzigingsbudget
van de uitvoering.

`sound.project.snapshot()` retourneert `{ sampleRate, tracks, selection }`, waarbij
`tracks` en `selection` dezelfde waarden zijn als de twee onderstaande aanroepen
retourneren. `sampleRate` is de samplefrequentie van het project in hertz; daarin
wordt elke framewaarde op deze pagina gemeten.

`sound.project.tracks()` retourneert een array met tracks in tijdlijnvolgorde:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` retourneert de clips op één track, of op elke track
wanneer `trackId` wordt weggelaten:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` retourneert de huidige selectie:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Elke selectieaanroep telt als één wijziging en retourneert de selectie die deze
heeft geproduceerd, in de vorm die `sound.project.selection()` retourneert.

`sound.select.time(start, end, options)` stelt het tijdbereik in seconden in. Het
is Audacity's opdracht `SelectTime` en `options.relativeTo` bepaalt vanaf welk
punt elke rand wordt gemeten. Beide randen mogen zo laag zijn als -100 seconden.

| `relativeTo` | Start edge | End edge |
| --- | --- | --- |
| `'project-start'` (default) | `start` seconden vanaf het begin van het project | `end` seconden vanaf het begin van het project |
| `'project'` | `start` seconden vanaf het begin van het project | `end` seconden na het einde van het project |
| `'project-end'` | `start` seconden vóór het einde van het project | `end` seconden vóór het einde van het project |
| `'selection-start'` | `start` seconden na het begin van de selectie | `end` seconden na het begin van de selectie |
| `'selection'` | `start` seconden na het begin van de selectie | `end` seconden na het einde van de selectie |
| `'selection-end'` | `start` seconden vóór het einde van de selectie | `end` seconden vóór het einde van de selectie |

Het projecteinde is het laatste frame dat een clip bereikt. De geselecteerde
tracks blijven zoals ze waren.

`sound.select.frames(startFrame, endFrame, options)` stelt het tijdbereik in
frames in bij de samplefrequentie van het project. `options.trackIds` geeft de
tracks aan die moeten worden geselecteerd; wanneer deze optie ontbreekt, blijven
de al geselecteerde tracks geselecteerd. Het bereik wordt tot de tijdlijn
begrensd en omgekeerde randen worden verwisseld.

`sound.select.tracks(options)` is Audacity's opdracht `SelectTracks`. Deze
selecteert de tracks waarvan de index (geteld vanaf 0) in het bereik ligt vanaf
`options.track` (standaard 0) over `options.trackCount` tracks (standaard 1).
`options.mode` is `'set'` om de trackselectie te vervangen, `'add'` om deze uit
te breiden of `'remove'` om die tracks eruit te halen. Het tijdbereik blijft
ongewijzigd.

`sound.select.frequencies(options)` is Audacity's opdracht `SelectFrequencies`.
Deze stelt de spectrale selectie in op `options.low` en `options.high` in hertz;
een rand die je weglaat behoudt de huidige waarde.

`sound.select.all()` selecteert het hele project op elke track.
`sound.select.none()` wist de selectie.

### `sound.effect(type, params)`

Past één effect toe op de huidige selectie op de track met focus. `type` is een
effect-ID uit [Effecten die een programma kan toepassen](#effects-a-program-can-apply)
en `params` is een object met de parameters van dat effect. Weggelaten parameters
krijgen de standaardwaarden van het effect; waarden worden gecontroleerd tegen de
bereiken in de [referentie voor audio-effecten](/reference/generated/audio-effects/).
De aanroep retourneert `null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Past in één keer een keten effecten toe op de huidige selectie, precies zoals een
stappenlijstmacro met die stappen dat zou doen. Elke stap is `{ type, params }`
en de keten heeft minstens één stap nodig. De aanroep retourneert `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Voert een van de Audacity-macroopdrachten uit die staan onder
[Commandoo's die een programma kan uitvoeren](#commands-a-program-can-run). De
vier selectieopdrachten gebruiken de daar beschreven parameters; de overige
hebben er geen. De aanroep retourneert daarna de selectie.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Voert een stappenlijstmacro uit die in dezelfde macrobeheerder is opgeslagen,
op basis van de exacte naam, inclusief eventuele selectieopdrachten. Een
opgeslagen macro kan zelf geen programma zijn, dus programma's kunnen niet worden
genest. De aanroep retourneert `null`; een onbekende naam wordt geweigerd.

### Tijd en willekeur

Een uitvoering is reproduceerbaar: twee uitvoeringen van hetzelfde programma op
hetzelfde project lezen dezelfde gegevens, omdat de klok en de willekeurige
getallen niet van de machine afkomstig zijn.

`Date.now()` en `new Date()` zonder argumenten retourneren een virtuele klok die
op 0 begint en met één toeneemt voor elke beantwoorde aanroep naar de editor, en
met `ms` voor elke `sound.wait(ms)`. `sound.wait` wordt onmiddellijk voltooid;
een programma kan niet wachten op echte tijd en dat is ook niet nodig, omdat elke
aanroep naar de editor is voltooid voordat de promise ervan wordt opgelost.

`Math.random()` en `sound.random()` gebruiken dezelfde generator, geïnitialiseerd
met `sound.env.seed`. Registreer de seed als je wilt weten welke reeks een
uitvoering gebruikte.

### Je aannames controleren

`sound.assert(condition, message)` gooit `message` wanneer `condition` false is.
`sound.assertEqual(actual, expected, message)` vergelijkt de twee waarden als
JSON en gooit een fout wanneer ze verschillen, met een bericht waarin beide
waarden worden genoemd als je geen bericht opgeeft. Omdat een gegooide fout de
uitvoering beëindigt en alles terugdraait, blijft het project bij een mislukte
assertie onaangeroerd. Geen van beide methoden retourneert een promise.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Waarden die naar de editor gaan

Elk argument dat een programma doorgeeft en elke waarde die het ontvangt is gewone
data: `null`, booleans, eindige getallen, strings, arrays en gewone objecten. `NaN`,
`Infinity`, functies, exemplaren van klassen, getypeerde arrays en `Date`-objecten
worden met een fout geweigerd. Dat geldt ook voor waarden die groter zijn dan 1
MiB, meer dan 12 niveaus diep zijn genest of meer dan 4.096 items in één array of
object bevatten. Eigenschappen met de waarde `undefined` worden verwijderd.

## Beperkingen

| Limiet | Waarde |
| --- | --- |
| Programmalengte | 256 KiB |
| Editoraanroepen per uitvoering | 4,096 |
| Wijzigingen aan het project per uitvoering (selectieaanroepen, effecten, opdrachten) | 256 |
| Aantal gelijktijdig wachtende aanroepen | 8 |
| Uitvoeringstijd | 120 seconden |
| Eén waarde van of naar de editor | 1 MiB, 12 niveaus diep, 4.096 items per array of object |
| Register | 1.000 regels of 256 KiB; 4.096 tekens per regel |
| Programma's in de bibliotheek | 128 |
| Programmanaam | 256 tekens |
| Geïmporteerd programmabestand | 1 MiB |

Een lus die elke clip selecteert en één effect toepast, gebruikt twee wijzigingen
per clip en kan dus 128 clips verwerken voordat het budget op is.

## Fouten

Als de editor een aanroep weigert, wordt de promise ervan afgewezen met een
`Error` waarvan `message` de reden vermeldt: een opdracht buiten de toegestane
woordenlijst, een effect op een lege selectie of een parameter buiten het bereik.
De fout bevat ook een `code`, die `MACRO_CALL_FAILED` is tenzij de editor een
specifiekere code heeft geleverd. Een programma kan deze fouten opvangen en
doorgaan:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Dat programma wordt voltooid en het register bevat *refused: Unsupported macro
command: ExportWav.*

Een fout die het programma niet opvangt, beëindigt de uitvoering, zet het project
terug en wordt in het paneel getoond met de regel waaruit deze afkomstig is. Een
programma dat niet kan worden gecompileerd, wordt op dezelfde manier gemeld
voordat er iets wordt uitgevoerd.

## Effecten die een programma kan toepassen {#effects-a-program-can-apply}

Dit zijn de effect-ID's die `sound.effect` en `sound.effects` accepteren, met de
parameters die elk effect gebruikt en hun standaardwaarden. Bereiken en eenheden
staan in de [audio effects reference](/reference/generated/audio-effects/).
Nyquist-plug-ins kunnen niet vanuit een programma worden toegepast.

| Effect | Effect ID | Parameters en standaardwaarden |
| --- | --- | --- |
| Versterken | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Automatisch ducking | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Bas en hoge tonen | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Toonhoogte wijzigen | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Snelheid en toonhoogte wijzigen | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Tempo wijzigen | `audacity-change-tempo` | `tempoPercent: 0` |
| Klassieke filters | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Klikken verwijderen | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Compressor | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Vertraging | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Vervorming | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Echo | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| In-faden | `audacity-fade-in` | geen |
| Uit-faden | `audacity-fade-out` | geen |
| Filtercurve-EQ | `audacity-filter-curve-eq` | `points`: een array van `{ frequency, gain }`, standaard twee vlakke punten op 20 Hz en 20 kHz; `linearFrequencyScale: false`; `filterLength: 8191` |
| Parametrische EQ met vier banden | `eq` | `outputGain: 0`; `bands`: vier objecten `{ id, enabled, type, frequency, gain, q, slope }`, met pieken op 100, 500, 2000 en 8000 Hz en `gain: 0`, `q: 1`, `slope: 12` |
| Gate | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Grafische EQ | `audacity-graphic-eq` | `gains`: 31 bandversterkingen in dB, allemaal 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| Hoogdoorlaatfilter | `highpass` | `frequency: 80`, `q: 0.707` |
| Inverteren | `audacity-invert` | geen |
| Klassieke compressor | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limiter | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Loudnessnormalisatie | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Laagdoorlaatfilter | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Ruisreductie | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normaliseren | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| DC-offset verwijderen | `audacity-remove-dc-offset` | geen |
| Herstellen | `audacity-repair` | geen |
| Herhalen | `audacity-repeat` | `count: 1` |
| Galm | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Galm (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Omkeren | `audacity-reverse` | geen |
| Glijdende rek | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Stilte afkappen | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Hulpmiddelversterking (beoordeeld) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Twee effecten hebben iets nodig dat een programma niet kan leveren. Ruisreductie
heeft een ruisprofiel nodig dat in het eigen dialoogvenster van het effect is
opgenomen, en automatisch ducking heeft een bedieningstrack onder de track met
focus nodig.

## Commandoo's die een programma kan uitvoeren {#commands-a-program-can-run}

`sound.command` accepteert de onderstaande namen van Audacity-macroopdrachten.
Het zijn dezelfde namen die een stappenlijstmacro kan bevatten, dus een
programma en een stappenlijst hebben exact hetzelfde bereik. Elke opdracht voert
de editoractie uit die in de [opdrachtenreferentie](/reference/generated/commands/)
wordt beschreven.

### Selectiecommando's met parameters

| Commando | Parameters |
| --- | --- |
| `SelectTime` | `start`, `end` in seconden; `relativeTo` zoals voor `sound.select.time` |
| `SelectFrequencies` | `low`, `high` in hertz |
| `SelectTracks` | `track`, `trackCount` (0 tot 100); `mode` als `'set'`, `'add'` of `'remove'` |
| `Select` | Elke combinatie van de drie bovenstaande sets |

Een parameter die je weglaat, laat dat deel van de selectie ongemoeid; zo leest
Audacity ze ook.

### Commandoo's zonder parameters

| Groep | Commandos |
| --- | --- |
| Selectie | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Bewerken | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Tracks | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Labels | `AddLabel` |
| Analyse | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Wat bewust ontbreekt

`Undo` en `Redo` ontbreken omdat een uitvoering al één geschiedenisitem is en een
stap die door de geschiedenis zou lopen voorbij de uitvoering bij je eigen
wijzigingen terecht zou komen. Transport- en opnameopdrachten ontbreken omdat een
programma nergens op kan wachten en niet uit een opname kan worden teruggedraaid.
Openen, opslaan, sluiten, importeren, exporteren en voorkeuren ontbreken omdat een
programma alleen toegang heeft tot het ene project dat open was toen het begon.
Opdrachten die alleen een dialoogvenster openen of de weergave wijzigen,
ontbreken omdat ze niets aan het project veranderen.

## Programma's delen {#sharing-programs}

**Export program** schrijft het geselecteerde programma naar een
`.soundscapemacro`-bestand en **Import program** leest zo'n bestand. Het bestand
is JSON in plaats van een los `.js`-bestand, zodat niets op de ontvangende
computer het aanziet voor iets dat buiten de editor moet worden uitgevoerd:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

Importeren slaat de tekst op en verder niets. Een geïmporteerd programma heeft
geen knop **Run program**; in plaats daarvan toont het paneel het programma, het
bestand waaruit het afkomstig is, een notitie over wat een programma met het
geopende project kan doen en een selectievakje met de tekst *I have read this
program and want to run it.* Als je dit aanvinkt, wordt **Enable this program**
ingeschakeld; pas daarna kan het programma worden uitgevoerd.

Die toestemming geldt voor exact de tekst die je hebt gelezen. Als het programma
daarna verandert, doordat je het bewerkt of er een nieuwere kopie overheen
importeert, verschijnt de controle opnieuw totdat je de nieuwe tekst inschakelt.
Programma's die je zelf in de beheerder schrijft, hoeven niet te worden
gecontroleerd.

## Voorbeelden

Fad elke clip in op de eerste track die er bevat. Klik vóór het uitvoeren op de
kop van die track, zodat het effect terechtkomt op de track die het programma
leest:

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

Rapporteer het project zonder het te wijzigen:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Voer een opgeslagen stappenlijstmacro alleen uit wanneer de selectie lang genoeg
is:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## Over deze pagina

Elk programma op deze pagina, van de fragmenten van één regel tot de uitgewerkte
voorbeelden, wordt tegen elke build van Soundscaper uitgevoerd door de browsersuite
(`tests/browser/handbook-macro-program-examples.spec.js`), die de programma's uit
de tekst van deze pagina leest. Een programma dat niet meer wordt voltooid of niet
meer oplevert wat deze pagina beschrijft, laat de build mislukken totdat de pagina
of de editor is gecorrigeerd.
