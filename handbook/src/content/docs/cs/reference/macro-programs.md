---
title: "Programy makr"
description: "JavaScript API, proti kterému program makr běží, omezení, v nichž běží, a soubor, ve kterém je přenášeno."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","targetLocale":"cs"} -->

Makroprogram je makro psaný v JavaScriptu místo seznamu kroků.
Spouští se v editoru proti malé API označované jako `sound`, která mu umožňuje číst
otevřený projekt, posouvat výběr a aplikovat stejné efekty a příkazy, které může
aplikovat makro se seznamem kroků. Všechno ostatní, od souborů a sítě po vaše
jiné projekty, je mimo jeho dosah.

Programy jsou funkcí Soundscaperu. Framescaper nemá správce makr.

## Kde se programy nacházejí

Vyberte **Nástroje → Správce makr**. V dialogu jsou uvedena makra se seznamem kroků a pod
**Programy** programy, které jste uložili. Tlačítko **Nový program** vytvoří nový program a v
podrobnostech se zobrazí **Název programu**, text **Programu** a tlačítko **Spustit
program**. Text se ukládá při psaní; neexistuje samostatný krok pro uložení.

Program je uložen společně s nastavením editoru, nikoli uvnitř projektu, takže je
dostupný ve všech projektech, které otevřete v tomto editoru. K přenosu programu na jiný
počítač nebo jinému uživateli použijte **Export programu** a
**Import programu**; podrobnosti najdete v
[Sdílení programů](#sharing-programs).

Průvodce [Aplikace stejného řetězce efektů pokaždé](/guides/effects/apply-the-same-effects-every-time/)
se zabývá stranou se seznamem kroků ve stejném dialogu.

## Psaní programu

Program je tělo funkce `async`, která se spouští v přísném režimu. To znamená, že
můžete `await` na nejvyšší úrovni, deklarovat proměnné a funkce a používat všechny
běžné jazykové funkce. Objekt `sound` je jediným spojení programu s
editorem a každý volání na něm vrací promise.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Tab vloží do pole programu dvě mezery. Stisknutím Escape a následně Tab opustíte pole.

### Co může program používat

Je přítomna běžná standardní knihovna JavaScriptu: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, typovaná pole, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` a `queueMicrotask`. Přítomen je také `console`,
což znamená, že vše, co je do něj zapsáno, skončí v logu programu.

### Co program nemůže používat

Program běží ve workeru, jehož schopnosti byly odebrány před spuštěním prvního řádku. Žádná z následujících věcí neexistuje uvnitř programu: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` a `setInterval`. Čtení kteréhokoli z nich vrací `undefined`.

Program nemůže `import` modul; statické `import` je chyba syntaxe na řádku, který ho obsahuje. Vše, co program potřebuje, musí být v programu.

Bezpečnostní hranice nejsou chybějící globální proměnné, ale samotný editor: odpovídá pouze na volání uvedená na této stránce a vše ostatní odmítá podle jména, bez ohledu na to, co se programu podaří poslat.

## Spuštění programu

Stiskněte **Spustit program**. Celé spuštění je jednou položkou v historii projektu, takže jedno **Zpět** vrátí vše, co program udělal, bez ohledu na to, kolik změn provedl.
Pokud program vyhodí výjimku, je zrušen nebo běží nad svůj časový limit, projekt se vrátí přesně do stavu, v jakém byl před spuštěním.

**Zrušit spuštění** okamžitě zastaví program. Program, který běžel dvě minuty, se zastaví stejným způsobem, se zprávou *Makro běželo déle než 120 sekund.*

Po spuštění zobrazí panel log programu, následovaný zprávou *Program byl aplikován.*
když spuštění dokončilo. Neúspěšné spuštění zobrazí *Program selhal na řádku N:* a
zprávu o chybě, kde číslo řádku je řádek vašeho programu, který vyhodil výjimku.

### Který zvuk efekt zasáhne

Efekt aplikovaný programem běží nad aktuálním časovým výběrem na zaměřené stopě, což je stopa, jejíž hlavičku jste naposledy klikli, nebo jejíž klip jste naposledy vybrali. Pokud není žádný časový výběr, ale je vybrán klip, efekt pokrývá tento klip. Volby výběru programu mění časový rozsah a množinu vybraných stop, ale ne to, která stopa je zaměřena, takže jedno spuštění zpracovává jednu stopu. Pokud nic není zaměřeno nebo je výběr prázdný, spuštění selže se stejnou zprávou, jakou dává menu Efekt.

## API `sound`

Každá metoda níže vrací promise, pokud není uvedeno jinak. Každé volání vyčkejte, než provedete další; program, který spustí více než osm volání bez vyčkání, má deváté odmítnuto.

### `sound.env`

Běžný objekt popisující spuštění.

| Pole | Význam |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | Jazyk rozhraní editoru, například `"en"` nebo `"de"`. |
| `seed` | Semeno, ze kterého pocházejí náhodná čísla spuštění. Nové pro každé spuštění. |
| `startedAt` | Čas podle hodin, kdy spuštění začalo, jako řetězec ISO 8601. |
| `dryRun` | Zatím vždy `false`. Rezervováno. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` a `sound.log.debug(...values)` zapíší každý jeden řádek
do logu spuštění. `console.log`, `console.info`, `console.warn`,
`console.error` a `console.debug` dělají totéž. Hodnoty, které nejsou řetězci, se
zapíší jako JSON. Tyto metody nevracejí nic a nemusí být vyčkány.

Log obsahuje maximálně 1 000 řádků nebo 256 KiB, podle toho, co nastane dříve, a každý řádek
je oříznut na 4 096 znaků. Řádky nad tuto hranici jsou zahodeny a počítány; počet
je hlášen jako závěrečné upozornění.

### `sound.project`

Čtení projektu ho nikdy nemění a nepočítá se proti rozpočtu změn spuštění.

`sound.project.snapshot()` vrací `{ sampleRate, tracks, selection }`, s
`tracks` a `selection` tak, jak je vrací dvě volání níže. `sampleRate` je
vzorkovací frekvence projektu v hertzech, což je jednotka, v níž je měřeno každé počítání snímků na této stránce.

`sound.project.tracks()` vrací pole stop v pořadí časové osy:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` vrací klipy na jednom stopě, nebo na všech stopách, pokud je `trackId` vynechán:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` vrací aktuální výběr:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Každý volací výběr se počítá jako jedna změna a vrací výběr, který vytvořil,
v podobě, kterou vrací `sound.project.selection()`.

`sound.select.time(start, end, options)` nastaví časový rozsah v sekundách. Jedná se
o příkaz `SelectTime` v Audacity a `options.relativeTo` určuje, odkud se měří
každý okraj. Oba okraje mohou být až -100 sekund.

| `relativeTo` | Začátek okraje | Konec okraje |
| --- | --- | --- |
| `'project-start'` (výchozí) | `start` sekund od začátku projektu | `end` sekund od začátku projektu |
| `'project'` | `start` sekund od začátku projektu | `end` sekund za koncem projektu |
| `'project-end'` | `start` sekund před koncem projektu | `end` sekund před koncem projektu |
| `'selection-start'` | `start` sekund po začátku výběru | `end` sekund po začátku výběru |
| `'selection'` | `start` sekund po začátku výběru | `end` sekund po konci výběru |
| `'selection-end'` | `start` sekund před koncem výběru | `end` sekund před koncem výběru |

Konec projektu je poslední snímek, kterého dosáhne jakýkoli klip. Vybrané stopy zůstanou
nezměněné.

`sound.select.frames(startFrame, endFrame, options)` nastaví časový rozsah v
snímcích při vzorkovací frekvenci projektu. `options.trackIds` určuje stopy, které se
mají vybrat; pokud je vynechán, vybrané zůstanou stopy, které jsou již vybrány.
Rozsah je omezen na časovou osu a okraje jsou vyměněny, pokud jsou obráceny.

`sound.select.tracks(options)` je příkaz `SelectTracks` v Audacity. Vybere
stopy, jejichž index (počítán od 0) je v rozsahu od `options.track`
(výchozí 0) pokrývající `options.trackCount` stop (výchozí 1). `options.mode` je
`'set'` pro nahrazení výběru stop, `'add'` pro jeho rozšíření nebo `'remove'` pro
vyloučení těchto stop z něj. Časový rozsah zůstává nezměněn.

`sound.select.frequencies(options)` je příkaz `SelectFrequencies` v Audacity.
Nastaví spektrální výběr na `options.low` a `options.high` v hertzech;
okraj, který vynecháte, si zachová svou aktuální hodnotu.

`sound.select.all()` vybere celý projekt na všech stopách.
`sound.select.none()` zruší výběr.

### `sound.effect(type, params)`

Použije jeden efekt na aktuální výběr na zaměřené stopě. `type` je
ID efektu z [Efekty, které může program použít](#effects-a-program-can-apply),
a `params` je objekt parametrů tohoto efektu. Parametry, které vynecháte, nabudou
výchozích hodnot efektu; hodnoty jsou ověřovány podle rozsahů v
[referenci zvukových efektů](/reference/generated/audio-effects/). Vyhodnotí se na
`null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Použije řetězec efektů na aktuální výběr v jednom průchodu, přesně tak, jak by to udělala makro se seznamem kroků s těmito kroky. Každý krok je `{ type, params }`, a řetězec vyžaduje alespoň jeden krok. Vyhodnotí se na `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Spustí jeden z makro příkazů Audacity uvedených v sekci
[Příkazy, které může program spustit](#commands-a-program-can-run). Čtyři příkazy pro výběr přijímají parametry popsané v této sekci; ostatní žádné parametry nepřijímají. Následně se vyhodnotí na aktuální výběr.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Spustí makro se seznamem kroků uložené ve stejném správci makr podle jeho přesného názvu,
včetně všech příkazů pro výběr, které obsahuje. Uložené makro samo o sobě nemůže být
programem, takže programy se nenestují. Vyřeší se na `null`; neznámý název je zamítnut.

### Čas a náhoda

Provedení je reprodukovatelné: dvě provedení stejného programu nad stejným projektem čtou
stejné hodnoty, protože hodiny a náhodná čísla nepatří stroji.

`Date.now()` a `new Date()` bez argumentů vrací virtuální hodiny, které
začínají na 0 a posouvají se o jedno pro každou zodpovězenou volání editoru a o
`ms` pro každé `sound.wait(ms)`. `sound.wait` se vyřeší okamžitě; neexistuje
žádný způsob, jak by program mohl čekat na reálný čas, a není to potřeba, protože každé volání
editoru se dokončí, než se jeho slib vyřeší.

`Math.random()` a `sound.random()` jsou stejný generátor, se semínkem z
`sound.env.seed`. Zaznamenejte semínko, pokud potřebujete vědět, kterou posloupnost provedení použilo.

### Kontrola vašich předpokladů

`sound.assert(condition, message)` vyhodí `message`, když `condition` je false.
`sound.assertEqual(actual, expected, message)` porovná dvě hodnoty jako JSON
a vyhodí výjimku, když se liší, se zprávou, která pojmenuje obě hodnoty, pokud žádnou
neposkytnete. Protože vyhozená chyba ukončí provedení a vrátí vše před ní zpět, neúspěšná
asercce ponechá projekt nedotčený. Žádná z metod nevrací slib.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Hodnoty přecházející do editoru

Každý argument, který program předá, a každá hodnota, kterou přijme, jsou prostá data:
`null`, booleovské hodnoty, konečná čísla, řetězce a pole a prosté objekty
z těchto typů. `NaN`, `Infinity`, funkce, instance tříd, typovaná pole a `Date`
objekty jsou odmítnuty s chybou, stejně jako jakákoliv hodnota větší než 1 MiB, vnořená hlouběji než
12 úrovní, nebo obsahující více než 4 096 položek v jednom poli nebo objektu.
Vlastnosti `undefined` jsou odstraněny.

## Omezení

| Omezení | Hodnota |
| --- | --- |
| Délka programu | 256 KiB |
| Volání do editoru za běh | 4 096 |
| Změny projektu za běh (volání výběru, efekty, příkazy) | 256 |
| Volání čekající na odpověď najednou | 8 |
| Doba běhu | 120 sekund |
| Jedna hodnota přecházející do editoru nebo z něj | 1 MiB, 12 úrovní hloubky, 4 096 položek na pole nebo objekt |
| Protokol | 1 000 řádků nebo 256 KiB; 4 096 znaků na řádek |
| Programy v knihovně | 128 |
| Název programu | 256 znaků |
| Soubor importovaného programu | 1 MiB |

Smyčka, která vybere každý klip a aplikuje jeden efekt, spotřebuje dvě změny na
klip, takže může pokrýt 128 klipů, než se rozpočet vyčerpá.

## Chyby

Volání, které editor odmítne, zamítne svůj slib s `Error`, jehož `message`
uvádí důvod: příkaz mimo slovní zásobu, efekt nad prázdným výběrem,
parametr mimo rozsah. Chyba také nese `code`, který je
`MACRO_CALL_FAILED`, pokud editor neposkytl konkrétnější. Program
je může chytit a pokračovat:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Tento program se dokončí a jeho protokol obsahuje *refused: Unsupported macro command:
ExportWav.*

Chybu, kterou program nezachytí, ukončí běh, vrátí projekt do předchozího stavu a zobrazí se v panelu spolu s řádkem, ze kterého pochází. Program, který se nepodačí zkompilovat, se hlásí stejným způsobem před spuštěním.

## Efekty, které může program aplikovat {#effects-a-program-can-apply}

Tyto jsou identifikátory efektů, které přijímají `sound.effect` a `sound.effects`, včetně klíčů parametrů, které každý z nich přijímá, a jejich výchozích hodnot. Rozsahy a jednotky jsou uvedeny v [referenci k audio efektům](/reference/generated/audio-effects/). Plug-iny Nyquist nelze aplikovat z programu.

| Efekt | ID efektu | Parametry a výchozí hodnoty |
| --- | --- | --- |
| Zesílení | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Automatické utlumení | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Bas a výšky | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Změna výšky tónu | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Změna rychlosti a výšky tónu | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Změna tempa | `audacity-change-tempo` | `tempoPercent: 0` |
| Klasické filtry | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Odstranění klikání | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Kompressor | `compressor` | `threshold: -24`, `knee: 30`, `ratio: 4`, `attack: 0.003`, `release: 0.25`, `makeupGain: 0` |
| Kompressor (Audacity) | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Zpoždění | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Zkreslení | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Echa | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Plynulé zesílení | `audacity-fade-in` | žádné |
| Plynulé zeslabení | `audacity-fade-out` | žádné |
| EQ křivky filtru | `audacity-filter-curve-eq` | `points`: pole `{ frequency, gain }`, výchozí dvě ploché body na 20 Hz a 20 kHz; `linearFrequencyScale: false`; `filterLength: 8191` |
| Čtyřpásmový parametrický EQ | `eq` | `outputGain: 0`; `bands`: čtyři objekty `{ id, enabled, type, frequency, gain, q, slope }`, s vrcholy na 100, 500, 2000 a 8000 Hz s `gain: 0`, `q: 1`, `slope: 12` |
| Brána | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Grafický EQ | `audacity-graphic-eq` | `gains`: zisky 31 pásem v dB, všechny 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| Filtr vysokých frekvencí | `highpass` | `frequency: 80`, `q: 0.707` |
| Invertovat | `audacity-invert` | žádné |
| Kompressor (starší verze) | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Omezovač | `limiter` | `ceiling: -1`, `lookahead: 0.005`, `release: 0.1` |
| Omezovač (Audacity) | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Normalizace hlasitosti | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Filtr nízkých frekvencí | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Redukce šumu | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalizace | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Fázový modulátor | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Odstranění DC posunu | `audacity-remove-dc-offset` | žádné |
| Oprava | `audacity-repair` | žádné |
| Opakování | `audacity-repeat` | `count: 1` |
| Reverberace | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Reverb (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Reverse | `audacity-reverse` | žádné |
| Sliding Stretch | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Truncate Silence | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Utility Gain (Reviewed) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Dvě efekty vyžadují něco, co program nemůže poskytnout. Odstranění šumu vyžaduje
profil šumu zachycený ve vlastním dialogu efektu a Auto Duck vyžaduje ovládací stopu
pod zaměřenou stopou.

## Příkazy, které může program spustit {#commands-a-program-can-run}

`sound.command` přijímá níže uvedené názvy příkazů makra Audacity. Jsou to
stejné názvy, které může obsahovat makro se seznamem kroků, takže program a seznam kroků
mají přesně stejný rozsah. Každý příkaz spustí akci editoru, kterou popisuje
[reference příkazů](/reference/generated/commands/).

### Příkazy výběru s parametry

| Příkaz | Parametry |
| --- | --- |
| `SelectTime` | `start`, `end` v sekundách; `relativeTo` jako u `sound.select.time` |
| `SelectFrequencies` | `low`, `high` v hertzích |
| `SelectTracks` | `track`, `trackCount` (0 až 100); `mode` z `'set'`, `'add'` nebo `'remove'` |
| `Select` | Libovolná kombinace výše uvedených tří sad |

Parametr, který vynecháte, ponechá danou část výběru beze změny, což je také způsob, jak je
Audacity interpretuje.

### Příkazy bez parametrů

| Skupina | Příkazy |
| --- | --- |
| Výběr | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Úpravy | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Stopy | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Popisky | `AddLabel` |
| Analýza | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Co je záměrně chybí

`Undo` a `Redo` chybí, protože běh je již jednou položkou historie a
krok procházející historií by zasáhl za běh do vašich vlastních úprav.
Příkazy přehrávání a nahrávání chybí, protože program nemá na co čekat a nelze ho
zpětně vyjmout z nahrávání. Otevírání, ukládání, zavírání, import, export a nastavení
chybí, protože rozsah programu je ten jeden projekt, který byl otevřen při jeho spuštění.
Příkazy, které pouze otevřou dialog nebo změní zobrazení, chybí, protože nic v projektu
nezmění.

## Sdílení programů {#sharing-programs}

**Export programu** zapíše vybraný program jako soubor `.soundscapemacro`, a
**Import programu** ho přečte. Soubor je ve formátu JSON, nikoli holý soubor `.js`, takže
nic na přijímajícím počítači ho nepřemění za něco, co má být spuštěno mimo editor:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

Importování uloží pouze text a nic dalšího. Importovaný program nemá tlačítko **Spustit
program**; na jeho místě panel zobrazuje program, soubor, ze kterého pochází,
poznámku o tom, co může program udělat s otevřeným projektem, a zaškrtávací
políčko s textem *Přečetl jsem si tento program a chci ho spustit.* Zaškrtnutím
tohoto políčka se aktivuje možnost **Povolit tento program** a teprve pak lze
program spustit.

Toto oprávnění platí pro přesný text, který jste přečetli. Pokud se program
později změní, ať už ho upravíte, nebo nad něj importujete novější kopii,
kontrola se znovu zobrazí, dokud nepovolíte nový text. Programy, které si
v správči sami napíšete, nevyžadují kontrolu.

## Příklady

Zjemnit každý klip na první stopě, která nějaké klipy obsahuje. Před spuštěním
klikněte na hlavičku této stopy, aby efekt zasáhl stopu, kterou program čte:

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

Nahlásit na projekt bez jeho změny:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Spusťte makro se uloženým seznamem kroků pouze tehdy, když je výběr dostatečně dlouhý:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## O této stránce

Každý program na této stránce, od jednořádkových úryvků po ukázkové příklady,
se spouští u každé sestavení Soundscaper prostřednictvím sadou testů prohlížeče
(`tests/browser/handbook-macro-program-examples.spec.js`), která čte programy přímo z textu této stránky. Program, který přestane dokončovat, nebo přestane produkovat to, co tato stránka uvádí, že produkuje, způsobí selhání sestavení, dokud není stránka nebo editor opravena.
