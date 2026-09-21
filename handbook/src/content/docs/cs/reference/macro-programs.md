---
title: "Makro programy"
description: "JavaScript API, proti kterému makro program běží, limity, pod kterými běží, a soubor, ve kterém cestuje."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"cs"} -->

Makro program je makro napsané v JavaScriptu namísto jako seznam kroků.
Spouští se uvnitř editoru proti malému API zvanému `sound`, které mu umožňuje číst
otevřený projekt, přesouvat výběr a aplikovat stejné efekty a příkazy jako makro se seznamem kroků.
Vše ostatní, od souborů a sítě po vaše ostatní projekty, je mimo jeho dosah.

Programy jsou funkcí Soundscaperu. Framescaper nemá správce makro.

## Kde programy žijí

Vyberte **Nástroje → Správce makro**. Dialogový rámeček obsahuje seznam makro se seznamem kroků a pod
**Programy** programy, které jste uložili. Stiskněte **+ (Nový program)** v záhlaví Programy pro vytvoření jednoho.
Stejná panelová akce nabízí **Import programu**, **Export programu** a **Odstranit program** pro vybraný program.
Podrobnostní panel zobrazuje **Název programu**, **Program** text a tlačítko **Spustit program**. Text je ukládán při psaní; neexistuje žádný samostatný krok ukládání.

Program je uložen s nastavením editoru, nikoli uvnitř projektu, takže je k dispozici v každém projektu, který otevřete v tomto editoru. Použijte **Export programu** a
**Import programu** pro přesun na jiný počítač nebo jiné osobě; viz
[Sdílení programů](#sharing-programs) pro to, co to obnáší.

Průvodce [Použijte stejný řetězec efektů pokaždé](/guides/effects/apply-the-same-effects-every-time/)
pokrývá stranu seznamu kroků stejného dialogu.

## Psaní programu

Program je tělem funkce `async`, která se spouští v přísném režimu. To znamená, že můžete `await` na nejvyšší úrovni,
deklarovat proměnné a funkce a používat každou obyčejnou jazykovou funkci. Objekt `sound` je jediným spojením programu s
editorem a každý volání na něj vrací slib.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Klávesa Tab vloží do pole programu dvě mezery. Stiskněte Escape a poté Tab pro opuštění pole.

### Co může program použít

Obvyklá JavaScriptová standardní knihovna je přítomna: `Object`, `Array`, `Map`, `Set`, `Math`, `JSON`, `RegExp`, `Promise`, typované pole, `Intl`, `TextEncoder`, `TextDecoder`, `structuredClone` a `queueMicrotask`. `console` je také přítomen a vše, co je do něj napsáno, se objeví v protokolu programu.

### Co program použít nemůže

Program běží v pracovním procesu, kterému byly odebrány všechny schopnosti před spuštěním první řádky. Žádná z následujících položek neexistuje uvnitř programu: `fetch`, `XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`, `location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`, `setTimeout` a `setInterval`. Čtení kterékoli z nich vrátí `undefined`.

Program nemůže `import` modul; statický `import` je syntaktická chyba na řádku, kde se nachází. Vše, co program potřebuje, musí být v programu.

Bezpečnostní hranice není definována chybějícími globálními proměnnými, ale samotným editorem: odpovídá pouze voláním uvedeným na této stránce a odmítá vše ostatní podle názvu, bez ohledu na to, co program dokáže poslat.

## Spuštění programu

Stiskněte **Spustit program**. Celý spuštěný program představuje jeden záznam v historii projektu, takže jedno **Zrušit** vrátí vše, co program udělal, bez ohledu na počet provedených změn. Pokud program vyhodí výjimku, je zrušen nebo překročí časový limit, projekt se vrátí přesně do stavu před zahájením spuštění.

**Zrušit spuštění** okamžitě zastaví program. Program, který běží déle než dvě minuty, je zastaven stejným způsobem s zprávou *Makro běželo déle než 120 sekund.*

Po spuštění se v okně zobrazí protokol programu, za nímž následuje *Program byl aplikován.* v případě úspěšného dokončení spuštění. Neúspěšné spuštění zobrazí *Program selhal na řádku N:* a zprávu chyby, kde číslo řádku odpovídá řádku vašeho programu, který vyhodil výjimku.

### Který zvukový efekt se dotkne

Efekt aplikovaný programem se spustí na aktuálním výběru času na zaměřené stopě, což je stopa, jejíž záhlaví jste naposledy klikli nebo jejíž klip jste naposledy vybrali. Pokud není vybrán žádný čas, ale je vybrán klip, efekt pokrývá tento klip. Volání výběru programu mění časový rozsah a sadu vybraných stop, ale ne které stopě je zaměřena, takže jeden spuštěný program zpracovává jednu stopu. Pokud není zaměřeno nic nebo je výběr prázdný, spuštění selže se stejnou zprávou, kterou menu Efekt poskytuje.

## `sound` API

Každá metoda níže vrací slib, pokud není uvedeno jinak. Každé volání čekejte před provedením dalšího; program, který zahájí více než osm volání bez čekání na jejich dokončení, bude deváté volání odmítnuto.

### `sound.env`

Obyčejný objekt popisující spuštění.

| Pole | Význam |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | Jazyk rozhraní editoru, například `"en"` nebo `"de"`. |
| `seed` | Semínko pro náhodná čísla spuštění. Nové pro každé spuštění. |
| `startedAt` | Čas zahájení spuštění na stěně, jako řetězec ISO 8601. |
| `dryRun` | Vždy `false` v současné době. Rezervováno. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`, `sound.log.error(...values)` a `sound.log.debug(...values)` zapíšou do protokolu spuštění po jedné řádce. `console.log`, `console.info`, `console.warn`, `console.error` a `console.debug` dělají totéž. Hodnoty, které nejsou řetězci, jsou zapsány jako JSON. Tyto metody nevracejí nic a nemusí být čekány.

Protokol uchovává maximálně 1 000 řádků nebo 256 KiB, podle toho, co nastane dříve, a každá řádka je oříznuta na 4 096 znaků. Řádky za tímto limitem jsou vynechány a započítány; počet je hlášen jako konečné varování.

### `sound.project`

Čtení projektu ho nikdy nemění a nepočítá se do rozpočtu změn spuštění.

`sound.project.snapshot()` vrátí `{ sampleRate, tracks, selection }`, přičemž `tracks` a `selection` vrátí volání níže. `sampleRate` je vzorkovací frekvence projektu v hertzech, což je to, na čem je měřeno každý počet snímků na této stránce.

`sound.project.tracks()` vrátí pole stop v pořadí časové osy:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

Metoda `sound.project.clips(trackId)` vrací klipy na jedné stopě, nebo na všech stopách, pokud je `trackId` vynechán:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` vrací aktuální výběr:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Každé volání výběru se počítá jako jedna změna a vrací výběr, který vytvořilo, ve tvaru, který `sound.project.selection()` vrací.

`sound.select.time(start, end, options)` nastavuje časový rozsah v sekundách. Je to příkaz `SelectTime` programu Audacity a `options.relativeTo` volí, odkud se měří každý okraj. Oba okraje mohou být tak nízké jako -100 sekund.

| `relativeTo` | Okraj začátku | Okraj konce |
| --- | --- | --- |
| `'project-start'` (výchozí) | `start` sekund od začátku projektu | `end` sekund od začátku projektu |
| `'project'` | `start` sekund od začátku projektu | `end` sekund po konci projektu |
| `'project-end'` | `start` sekund před koncem projektu | `end` sekund před koncem projektu |
| `'selection-start'` | `start` sekund po začátku výběru | `end` sekund po začátku výběru |
| `'selection'` | `start` sekund po začátku výběru | `end` sekund po konci výběru |
| `'selection-end'` | `start` sekund před koncem výběru | `end` sekund před koncem výběru |

Konec projektu je poslední rámec, kterého jakýkoli klip dosahuje. Vybrané stopy zůstávají tak, jak byly.

`sound.select.frames(startFrame, endFrame, options)` nastavuje časový rozsah v bodech při vzorkovací frekvenci projektu. `options.trackIds` pojmenovává stopy, které je třeba vybrat; když je opomenuto, zůstanou vybrány již vybrané stopy. Rozsah je omezen na časovou osu a okraje jsou vyměněny, pokud jsou obráceny.

`sound.select.tracks(options)` je příkaz `SelectTracks` programu Audacity. Vybírá stopy, jejichž index (počítaný od 0) je v rozsahu od `options.track` (výchozí hodnota 0) po `options.trackCount` stop (výchozí hodnota 1). `options.mode` je `'set'` pro nahrazení výběru stop, `'add'` pro rozšíření výběru nebo `'remove'` pro vyjmutí těchto stop z výběru. Časový rozsah zůstává takový, jaký byl.

`sound.select.frequencies(options)` je příkaz `SelectFrequencies` programu Audacity. Nastavuje spektrální výběr na `options.low` a `options.high` v hertzech; okraj, který opomenete, si ponechá svou aktuální hodnotu.

`sound.select.all()` vybírá celý projekt na každé stopě.
`sound.select.none()` maže výběr.

### `sound.effect(type, params)`

Použije jeden efekt na aktuální výběr, na zaměřené stopě. `type` je ID efektu z [Efekty, které může program použít](#effects-a-program-can-apply) a `params` je objekt parametrů tohoto efektu. Parametry, které opomenete, si vezmou výchozí hodnoty efektu; hodnoty jsou zkontrolovány proti rozsahům v [referenci audio efektů](/reference/generated/audio-effects/). Rozliší se na `null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Použije řetězec efektů na aktuální výběr v jednom kroku, přesně tak, jak by to udělal makro se seznamem kroků s těmito kroky. Každý krok je `{ type, params }` a řetězec musí mít alespoň jeden krok. Vyřeší se `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Spustí jednu z makro příkazů Audacity uvedených v části
[Příkazy, které může program spustit](#commands-a-program-can-run). Čtyři příkazy pro výběr
berou parametry popsané tam; ostatní žádné. Vrátí výběr poté.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Spustí makro seznamu kroků uložené ve stejném správci makro, přesně podle jeho názvu,
včetně jakýchkoli příkazů výběru, které obsahuje. Uložené makro nemůže samo o sobě být programem, takže programy se nehnízdí. Rozliší se na `null`; neznámý název je zamítnut.

### Čas a náhoda

Spustit je reprodukovatelné: dva spustit stejného programu na stejném projektu čtou
stejné, protože hodiny a náhodná čísla nejsou od stroje. 

`Date.now()` a `new Date()` bez argumentů vrací virtuální hodiny, které
začínají na 0 a posunou se o jednu pro každou zodpovězenou výzvu editoru, a o
`ms` pro každou `sound.wait(ms)`. `sound.wait` se okamžitě vyřeší; neexistuje
žádný způsob, jak program pozastavit pro skutečný čas, a žádný není potřeba, protože každá výzva
editoru je dokončena před tím, než se jeho slib vyřeší.

`Math.random()` a `sound.random()` jsou stejný generátor, zasazený ze
`sound.env.seed`. Zaznamenejte semínko, pokud potřebujete vědět, která sekvence byla použita pro spustit.

### Kontrola vašich předpokladů

`sound.assert(condition, message)` hodí `message` když `condition` je nepravdivé.
`sound.assertEqual(actual, expected, message)` porovnává dvě hodnoty jako JSON
a hodí, když se liší, s zprávou, která pojmenuje obě hodnoty, pokud žádnou nedáte. Protože chyba vržená ukončí spustit a vrátí všechno před ním, neúspěšné tvrzení ponechá projekt nezměněný. Žádná z metod nevrátí slib.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Hodnoty, které přecházejí do editoru

Každý argument, který program předává, a každá hodnota, kterou přijímá, jsou prostá data: 
`null`, logické hodnoty, konečná čísla, řetězce a pole a jednoduché objekty
techto. `NaN`, `Infinity`, funkce, instance tříd, typizovaná pole a `Date`
objekty jsou odmítnuty s chybou, stejně jako jakákoli hodnota větší než 1 MiB, vnořená více
ež 12 úrovní hluboko, nebo obsahující více než 4 096 položek v jednom poli nebo objektu. 
`undefined` vlastnosti jsou ignorovány.

## Omezení

| Omezení | Hodnota |
| --- | --- |
| Délka programu | 256 KiB |
| Volání editoru za spuštění | 4 096 |
| Změny v projektu za spuštění (výběry, efekty, příkazy) | 256 |
| Čekající volání najednou | 8 |
| Doba spuštění | 120 sekund |
| Jedna hodnota přecházející do nebo z editoru | 1 MiB, 12 úrovní hluboko, 4 096 položek na pole nebo objekt |
| Protokol | 1 000 řádků nebo 256 KiB; 4 096 znaků na řádek |
| Programy v knihovně | 128 |
| Název programu | 256 znaků |
| Importovaný soubor programu | 1 MiB |

Smyčka, která vybere každý klip a aplikuje jeden efekt, spotřebuje dvě změny na
klip, takže může pokrýt 128 klipů, než rozpočet vyprší.

## Chyby

Volání, které editor odmítne, odmítne svůj slib s `Error`, jehož `message`
uvádí důvod: příkaz mimo slovní zásobu, efekt nad prázdným výběrem,
parametr mimo rozsah. Chyba také nese `code`, který je
`MACRO_CALL_FAILED`, pokud editor neposkytl konkrétnější. Program
může tyto chyby zachytit a pokračovat:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Program dokončí a jeho protokol bude obsahovat *odmítnuto: Nepodporovaný makro příkaz:
ExportWav.*

Chyba, kterou program nechytí, ukončí běh, vrátí projekt zpět a bude
zobrazen v panelu s řádkem, ze kterého pochází. Program, který se nepodaří zkompilovat,
je hlášen stejným způsobem před spuštěním jakékoli části.

## Efekty, které může program použít {#effects-a-program-can-apply}

Toto jsou ID efektů `sound.effect` a `sound.effects`, které přijímají,
spolu s klíči parametrů, které každý z nich bere a jejich výchozími hodnotami. Rozsahy a jednotky
sou v [referenci audio efektů](/reference/generated/audio-effects/). Plug-iny Nyquist
elze použít z programu.

| Efekt | ID efektu | Parametry a výchozí hodnoty |
| --- | --- | --- |
| Zvětšit | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Automatická kachna | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Basy a výšku | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Změna tóniny | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Změna rychlosti a tóniny | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Změna tempa | `audacity-change-tempo` | `tempoPercent: 0` |
| Klasické filtry | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Odstranění kliku | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Kompresor | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Zpoždění | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Zkreslení | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Ozvěna | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Vyblednutí | `audacity-fade-in` | žádné |
| Vyblednutí | `audacity-fade-out` | žádné |
| Filtr křivky EQ | `audacity-filter-curve-eq` | `points`: pole `{ frequency, gain }`, výchozí dvě ploché body při 20 Hz a 20 kHz; `linearFrequencyScale: false`; `filterLength: 8191` |
| Čtyřpásmový parametr. EQ | `eq` | `outputGain: 0`; `bands`: čtyři `{ id, enabled, type, frequency, gain, q, slope }` objekty, vrcholící při 100, 500, 2000 a 8000 Hz s `gain: 0`, `q: 1`, `slope: 12` |
| Brána | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Grafické EQ | `audacity-graphic-eq` | `gains`: 31 zisků pásem v dB, všechny 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| Vysokopásmový filtr | `highpass` | `frequency: 80`, `q: 0.707` |
| Invertovat | `audacity-invert` | žádné |
| Kompresor (starý) | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limitér | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Normalizace hlasitosti | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Nízkopásmový filtr | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Snížení šumu | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalizovat | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Fázový posun | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Odstranění DC offsetu | `audacity-remove-dc-offset` | žádné |
| Oprava | `audacity-repair` | žádné |
| Opakování | `audacity-repeat` | `count: 1` |
| Reverb | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Reverb (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Obrátit | `audacity-reverse` | žádné |
| Skluzové natažení | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Ořezat ticho | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Získat užitečnost (zkontrolováno) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Dva efekty vyžadují něco, co program nemůže poskytnout. Redukce šumu potřebuje profil šumu zachycený v dialogu samotného efektu a automatické kachny potřebují řídicí stopu pod zaměřenou. 

## Příkazy, které může program spustit {#commands-a-program-can-run}

`sound.command` přijímá následující názvy makropříkazů Audacity. Jsou to stejné názvy, které může obsahovat seznam kroků makra, takže program a seznam kroků mají přesně stejný dosah. Každý příkaz spouští editorovou akci, kterou popisuje [odkaz na příkazy](/reference/generated/commands/).

### Příkazy výběru s parametry

| Příkaz | Parametry |
| --- | --- |
| `SelectTime` | `start`, `end` v sekundách; `relativeTo` jako pro `sound.select.time` |
| `SelectFrequencies` | `low`, `high` v hertzech |
| `SelectTracks` | `track`, `trackCount` (0 až 100); `mode` z `'set'`, `'add'` nebo `'remove'` |
| `Select` | Jakákoliv kombinace výše uvedených tří sad |

Parametr, který vynecháte, ponechá příslušnou část výběru beze změny, což je také způsob, jakým Audacity tyto parametry čte.

### Příkazy bez parametrů

| Skupina | Příkazy |
| --- | --- |
| Výběr | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Úprava | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Stopky | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Popisky | `AddLabel` |
| Analýza | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Co záměrně chybí

`Undo` a `Redo` chybí, protože jedno spuštění je již jeden záznam historie a krok, který prochází historií, by se dostal za spuštění do vlastních úprav.
Přepravní a záznamové příkazy chybí, protože program nemá nic na čekání a nemůže být vrácen zpět ze záznamu. Otevírání, ukládání, zavírání, dovozy, vývozy a preference chybí, protože dosah programu je pouze jeden projekt, který byl otevřen, když začal. Příkazy, které pouze otevírají dialog nebo mění zobrazení, chybí, protože nic nezmění v projektu.

## Sdílení programů {#sharing-programs}

**Export programu** zapíše vybraný program jako soubor `.soundscapemacro` a **Import programu** jej přečte. Soubor je ve formátu JSON, nikoli v čistém formátu `.js`, takže nic na cílovém počítači jej nespustí mimo editor:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

Importování ukládá text a nic víc. Importovaný program nemá tlačítko **Spustit program**; místo toho panel zobrazuje program, soubor, ze kterého pochází, poznámku o tom, co program může udělat s otevřeným projektem, a zaškrtávací políčko *Přečetl jsem tento program a chci ho spustit*. Zaškrtnutím se aktivuje **Povolit tento program** a teprve poté může program běžet.

Toto oprávnění platí přesně pro text, který jste četli. Pokud se program později změní, ať už jej upravíte nebo importujete novější kopii, objeví se opět přezkum, dokud neaktivujete nový text. Programy, které napíšete v manažeru sami, nepotřebují přezkum.

## Příklady

Vybledněte všechny klipy na první stopě, která má nějaký. Před spuštěním klikněte na záhlaví této stopy, aby se efekt aplikoval na stopu, kterou program čte:

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

Nahlásit projekt bez jeho změny:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Spusťte uloženou makro se seznamem kroků pouze v případě, že je výběr dostatečně dlouhý:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## O této stránce

Každý program na této stránce, od jednorázových úryvků po zpracované příklady, je spuštěn proti každé verzi Soundscaperu prohlížečovou sadou testů (`tests/browser/handbook-macro-program-examples.spec.js`), která čte programy z textu této stránky. Program, který přestane dokončovat nebo přestane produkovat to, co tato stránka uvádí, že produkuje, selže při sestavení, dokud nebude stránka nebo editor opraven.
