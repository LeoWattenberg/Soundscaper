---
title: "Programy makr"
description: "Interfejs JavaScript API udostępniany programowi makra, obowiązujące go ograniczenia oraz format pliku, w którym jest przenoszony."
sidebar:
  order: 7
---

<!-- docs-ai-provenance: {"factPacketSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"pl"} -->

Program makra to makro zapisane w JavaScript zamiast w postaci listy kroków.
Działa wewnątrz edytora za pośrednictwem niewielkiego interfejsu API o nazwie
`sound`, który pozwala odczytywać otwarty projekt, zmieniać zaznaczenie i
stosować te same efekty oraz polecenia co makro z listą kroków. Wszystko inne —
od plików i sieci po pozostałe projekty — pozostaje poza jego zasięgiem.

Programy są funkcją Soundscapera. Framescaper nie ma menedżera makr.

## Gdzie znajdują się programy

Wybierz **Narzędzia → Zarządca makr**. Okno dialogowe zawiera makra z listą
kroków oraz zapisane programy w sekcji **Programy**. Naciśnij **+ (Nowy
program)** w nagłówku sekcji Programy, aby utworzyć program. Ten sam pasek
działań zawiera polecenia **Importuj program**, **Eksportuj program** i
**Usuń program** dla wybranego programu. W panelu szczegółów widoczne są jego
**Nazwa programu**, tekst w polu **Program** oraz przycisk **Uruchom program**. Tekst
jest zapisywany podczas pisania; nie trzeba go zapisywać osobno.

Program jest przechowywany w ustawieniach edytora, a nie w projekcie, więc jest
dostępny we wszystkich projektach otwieranych w tym edytorze. Użyj poleceń
**Eksportuj program** i **Importuj program**, aby przenieść go na inny komputer
lub przekazać innej osobie. Więcej informacji znajdziesz w sekcji
[Udostępnianie programów](#sharing-programs).

Przewodnik [Za każdym razem stosuj ten sam zestaw efektów](/guides/effects/apply-the-same-effects-every-time/)
omawia makra z listą kroków w tym samym oknie.

## Pisanie programu

Program jest treścią funkcji `async` uruchamianej w trybie ścisłym. Oznacza to,
że na najwyższym poziomie można używać `await`, deklarować zmienne i funkcje
oraz korzystać ze wszystkich zwykłych funkcji języka. Obiekt `sound` jest
jedynym łącznikiem programu z edytorem, a każde wywołanie jego metod zwraca
obietnicę.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Klawisz Tab wstawia dwa odstępy w polu programu. Naciśnij Escape, a następnie
Tab, aby opuścić to pole.

### Z czego może korzystać program

Dostępna jest zwykła biblioteka standardowa JavaScript: `Object`, `Array`,
`Map`, `Set`, `Math`, `JSON`, `RegExp`, `Promise`, tablice typowane, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` i `queueMicrotask`. Dostępny
jest też `console`, a wszystko, co zostanie do niego zapisane, trafia do
dziennika programu.

### Z czego program nie może korzystać

Program działa w procesie roboczym, któremu odebrano możliwości jeszcze przed
uruchomieniem pierwszej linii. W programie nie istnieją: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` ani `setInterval`. Odczytanie dowolnej z tych wartości zwraca
`undefined`.

Program nie może użyć `import` do zaimportowania modułu; statyczna instrukcja `import` jest błędem
składni w wierszu, w którym się znajduje. Wszystko, czego potrzebuje program,
musi być zawarte w nim samym.

Granicy bezpieczeństwa nie wyznacza brakujące zmienne globalne, lecz sam edytor:
obsługuje on tylko wywołania wymienione na tej stronie i odrzuca każde inne,
niezależnie od tego, co program spróbuje mu przekazać.

## Uruchamianie programu

Naciśnij **Uruchom program**. Całe uruchomienie jest jednym wpisem w historii
projektu, więc jedno polecenie **Cofnij** odwraca wszystkie zmiany wprowadzone
przez program, niezależnie od ich liczby. Jeśli program zgłosi wyjątek, zostanie
anulowany albo przekroczy limit czasu, projekt wróci dokładnie do stanu sprzed
uruchomienia.

Polecenie **Anuluj uruchomienie** natychmiast zatrzymuje program. Program
działający przez dwie minuty zostaje zatrzymany w ten sam sposób, a komunikat
brzmi *Makro działało dłużej niż 120 sekund.*

Po zakończeniu uruchomienia w panelu pojawia się dziennik programu, a po
pomyślnym wykonaniu komunikat *Program zastosowano.* Nieudane uruchomienie
wyświetla komunikat *Program zakończył się błędem w wierszu N:* oraz treść
błędu; numer wiersza wskazuje wiersz programu, w którym wystąpił wyjątek.

### Na jaką część dźwięku działa efekt

Efekt zastosowany przez program obejmuje bieżące zaznaczenie czasu na aktywnej
ścieżce, czyli tej, której nagłówek kliknięto jako ostatni albo na której jako
ostatni wybrano klip. Jeśli nie ma zaznaczenia czasu, ale wybrano klip, efekt
obejmuje ten klip. Wywołania zaznaczania w programie zmieniają zakres czasu i
zestaw zaznaczonych ścieżek, ale nie zmieniają aktywnej ścieżki, dlatego jedno
uruchomienie przetwarza jedną ścieżkę. Jeśli żadna ścieżka nie jest aktywna lub
zaznaczenie jest puste, uruchomienie kończy się takim samym komunikatem, jaki
wyświetla menu Efekt.

## Interfejs API `sound`

Każda z poniższych metod zwraca obietnicę, o ile nie zaznaczono inaczej. Przed
następnym wywołaniem zaczekaj na zakończenie bieżącego za pomocą await;
program, który rozpocznie więcej niż osiem wywołań bez oczekiwania, nie otrzyma
odpowiedzi na dziewiąte.

### `sound.env`

Zwykły obiekt opisujący uruchomienie.

| Pole | Znaczenie |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | Język interfejsu edytora, na przykład `"en"` lub `"de"`. |
| `seed` | Wartość początkowa generatora liczb losowych programu. Nowa przy każdym uruchomieniu. |
| `startedAt` | Czas zegarowy rozpoczęcia uruchomienia jako ciąg ISO 8601. |
| `dryRun` | Obecnie zawsze `false`. Zarezerwowane. |

### `sound.log`

Wywołania `sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` i `sound.log.debug(...values)` zapisują po jednym
wierszu w dzienniku uruchomienia. To samo robią `console.log`, `console.info`,
`console.warn`, `console.error` i `console.debug`. Wartości inne niż ciągi
znaków są zapisywane jako JSON. Metody te niczego nie zwracają i nie trzeba
na nie czekać.

Dziennik mieści najwyżej 1000 wierszy lub 256 KiB — zależnie od tego, co nastąpi
w pierwszej kolejności — a każdy wiersz jest obcinany do 4096 znaków. Kolejne
wiersze są odrzucane i zliczane; liczba ta jest podawana w końcowym
ostrzeżeniu.

### `sound.project`

Odczytywanie projektu nigdy go nie zmienia i nie wlicza się do limitu zmian
dopuszczalnych podczas uruchomienia.

`sound.project.snapshot()` zwraca `{ sampleRate, tracks, selection }`, gdzie
`tracks` i `selection` mają taką samą postać jak wartości zwracane przez dwa
poniższe wywołania. `sampleRate` to częstotliwość próbkowania projektu w
hercach; w tej jednostce podawana jest każda liczba klatek na tej stronie.

`sound.project.tracks()` zwraca tablicę ścieżek w kolejności na osi czasu:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` zwraca klipy z jednej ścieżki, a jeśli pominięto
`trackId` — klipy ze wszystkich ścieżek:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` zwraca bieżące zaznaczenie:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Każde wywołanie zaznaczania liczy się jako jedna zmiana i zwraca utworzone
zaznaczenie w takiej postaci, jaką zwraca `sound.project.selection()`.

`sound.select.time(start, end, options)` ustawia zakres czasu w sekundach. To
polecenie Audacity `SelectTime`; `options.relativeTo` określa punkt odniesienia
dla każdej krawędzi. Obie wartości krawędzi mogą wynosić zaledwie -100 sekund.

| `relativeTo` | Krawędź początkowa | Krawędź końcowa |
| --- | --- | --- |
| `'project-start'` (domyślnie) | `start` sekund od początku projektu | `end` sekund od początku projektu |
| `'project'` | `start` sekund od początku projektu | `end` sekund za końcem projektu |
| `'project-end'` | `start` sekund przed końcem projektu | `end` sekund przed końcem projektu |
| `'selection-start'` | `start` sekund za początkiem zaznaczenia | `end` sekund za początkiem zaznaczenia |
| `'selection'` | `start` sekund za początkiem zaznaczenia | `end` sekund za końcem zaznaczenia |
| `'selection-end'` | `start` sekund przed końcem zaznaczenia | `end` sekund przed końcem zaznaczenia |

Koniec projektu to ostatnia klatka osiągana przez dowolny klip. Zaznaczone
ścieżki pozostają bez zmian.

`sound.select.frames(startFrame, endFrame, options)` ustawia zakres czasu w
klatkach przy częstotliwości próbkowania projektu. `options.trackIds` wskazuje
ścieżki do zaznaczenia; jeśli ten argument pominięto, zaznaczone pozostają
dotychczasowe ścieżki. Zakres jest ograniczany do osi czasu, a odwrócone
krawędzie są zamieniane miejscami.

`sound.select.tracks(options)` to polecenie Audacity `SelectTracks`. Zaznacza
ścieżki o indeksach (liczonych od 0) w zakresie rozpoczynającym się od
`options.track` (domyślnie 0) i obejmującym `options.trackCount` ścieżek
(domyślnie 1). Wartość `options.mode` to `'set'`, aby zastąpić zaznaczenie
ścieżek, `'add'`, aby je rozszerzyć, albo `'remove'`, aby usunąć z niego te
ścieżki. Zakres czasu pozostaje bez zmian.

`sound.select.frequencies(options)` to polecenie Audacity `SelectFrequencies`.
Ustawia zaznaczenie widma na częstotliwości `options.low` i `options.high` w
hercach; pominięta krawędź zachowuje dotychczasową wartość.

`sound.select.all()` zaznacza cały projekt na wszystkich ścieżkach.
`sound.select.none()` usuwa zaznaczenie.

### `sound.effect(type, params)`

Stosuje jeden efekt do bieżącego zaznaczenia na aktywnej ścieżce. `type` to
identyfikator efektu z sekcji [Efekty dostępne dla programu](#effects-a-program-can-apply),
a `params` to obiekt zawierający parametry tego efektu. Pominięte parametry
przyjmują wartości domyślne efektu; wartości są sprawdzane względem zakresów
podanych w [dokumentacji efektów audio](/reference/generated/audio-effects/).
Zwraca `null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Stosuje w jednym przebiegu łańcuch efektów do bieżącego zaznaczenia, dokładnie
tak, jak zrobiłoby to makro z listą tych kroków. Każdy krok ma postać
`{ type, params }`, a łańcuch musi zawierać co najmniej jeden krok. Zwraca
`null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Uruchamia jedno z poleceń makr Audacity wymienionych w sekcji
[Polecenia dostępne dla programu](#commands-a-program-can-run). Cztery
polecenia zaznaczania przyjmują opisane tam parametry; pozostałe nie przyjmują
żadnych. Zwraca stan zaznaczenia po wykonaniu polecenia.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Uruchamia makro z listą kroków zapisane w tym samym menedżerze makr, wskazane
jego dokładną nazwą, wraz ze wszystkimi zawartymi w nim poleceniami
zaznaczania. Zapisane makro nie może samo być programem, więc programy nie mogą
wywoływać innych programów. Zwraca `null`; nieznana nazwa powoduje odrzucenie
obietnicy.

### Czas i liczby losowe

Uruchomienie jest powtarzalne: dwa uruchomienia tego samego programu w tym
samym projekcie dają ten sam odczyt, ponieważ zegar i liczby losowe nie
pochodzą z komputera.

`Date.now()` i `new Date()` bez argumentów zwracają wirtualny zegar, który
zaczyna od 0 i przesuwa się o jeden przy każdej odpowiedzi na wywołanie edytora
oraz o `ms` przy każdym `sound.wait(ms)`. `sound.wait` rozwiązuje obietnicę
natychmiast; program nie może czekać w czasie rzeczywistym i nie musi tego
robić, ponieważ każde wywołanie edytora kończy się przed rozwiązaniem jego
obietnicy.

`Math.random()` i `sound.random()` korzystają z tego samego generatora,
zainicjowanego wartością `sound.env.seed`. Zapisz ziarno w dzienniku, jeśli
chcesz wiedzieć, jakiej sekwencji użyło uruchomienie.

### Sprawdzanie założeń

`sound.assert(condition, message)` zgłasza wyjątek z komunikatem `message`, gdy
`condition` jest fałszywe. `sound.assertEqual(actual, expected, message)`
porównuje obie wartości jako JSON i zgłasza wyjątek, gdy się różnią, z
komunikatem zawierającym obie wartości, jeśli podasz — i zgłasza wyjątek, gdy
się różnią, z komunikatem zawierającym obie wartości, jeśli nie podasz żadnego
komunikatu. Ponieważ zgłoszony wyjątek kończy uruchomienie i cofa wszystkie
wcześniejsze zmiany, nieudane sprawdzenie pozostawia projekt nietknięty. Żadna z
tych metod nie zwraca obietnicy.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Wartości przekazywane do edytora i z niego

Każdy argument przekazywany przez program i każda odbierana przez niego
wartość muszą być zwykłymi danymi: `null`, wartościami logicznymi, skończonymi
liczbami, ciągami znaków oraz tablicami i zwykłymi obiektami zawierającymi te
typy. `NaN`, `Infinity`, funkcje, instancje klas, tablice typowane i obiekty
`Date` są odrzucane z błędem. To samo dotyczy każdej wartości większej niż
1 MiB, zagnieżdżonej na więcej niż 12 poziomach lub zawierającej więcej niż
4096 elementów w jednej tablicy albo obiekcie. Właściwości `undefined` są
usuwane.

## Limity

| Limit | Wartość |
| --- | --- |
| Długość programu | 256 KiB |
| Liczba wywołań edytora na uruchomienie | 4096 |
| Liczba zmian projektu na uruchomienie (wywołania zaznaczania, efekty, polecenia) | 256 |
| Liczba wywołań oczekujących jednocześnie na odpowiedź | 8 |
| Czas uruchomienia | 120 sekund |
| Pojedyncza wartość przekazywana do edytora lub z niego | 1 MiB, maks. 12 poziomów zagnieżdżenia i 4096 elementów na tablicę lub obiekt |
| Dziennik | 1000 wierszy lub 256 KiB; maks. 4096 znaków w wierszu |
| Programy w bibliotece | 128 |
| Nazwa programu | 256 znaków |
| Importowany plik programu | 1 MiB |

Pętla zaznaczająca każdy klip i stosująca jeden efekt zużywa dwie zmiany na
klip, więc przed wyczerpaniem limitu może objąć 128 klipów.

## Błędy

Jeśli edytor odrzuci wywołanie, odrzucona zostaje jego obietnica, a treść
`Error`, którego `message` wyjaśnia przyczynę: polecenie spoza dozwolonego
zestawu, efekt dla pustego zaznaczenia albo parametr poza zakresem. Błąd ma też
właściwość `code`, której wartość to `MACRO_CALL_FAILED`, chyba że edytor
przekaże bardziej szczegółowy kod. Program może przechwycić takie błędy i
kontynuować działanie:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Program zostanie uznany za zakończony, a dziennik będzie zawierać komunikat
*refused: Unsupported macro command: ExportWav.*

Nieprzechwycony błąd kończy uruchomienie, cofa zmiany w projekcie i pojawia się
w panelu wraz z numerem wiersza, w którym wystąpił. Program, którego nie można
skompilować, jest zgłaszany w ten sam sposób, zanim cokolwiek zostanie
uruchomione.

## Efekty dostępne dla programu {#effects-a-program-can-apply}

Poniżej wymieniono identyfikatory efektów akceptowane przez `sound.effect` i
`sound.effects`, klucze parametrów każdego efektu oraz ich wartości domyślne.
Zakresy i jednostki podano w [dokumentacji efektów audio](/reference/generated/audio-effects/).
Z poziomu programu nie można stosować wtyczek Nyquist.

| Efekt | Identyfikator efektu | Parametry i wartości domyślne |
| --- | --- | --- |
| Wzmacnianie | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Automatyczne obniżanie głośności | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Bas i sopran | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Zmiana tonacji | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Zmiana prędkości i tonacji | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Zmiana tempa | `audacity-change-tempo` | `tempoPercent: 0` |
| Filtry klasyczne | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Usuwanie kliknięć | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Kompresor | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Opóźnienie | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Zniekształcenie | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Echo | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Włączanie | `audacity-fade-in` | brak |
| Wyłączanie | `audacity-fade-out` | brak |
| Równanie krzywej filtru | `audacity-filter-curve-eq` | `points`: tablica wartości `{ frequency, gain }`, domyślnie dwa płaskie punkty przy 20 Hz i 20 kHz; `linearFrequencyScale: false`; `filterLength: 8191` |
| Czteropasmowy korektor parametryczny | `eq` | `outputGain: 0`; `bands`: cztery obiekty `{ id, enabled, type, frequency, gain, q, slope }` z częstotliwościami szczytowymi 100, 500, 2000 i 8000 Hz oraz wartościami `gain: 0`, `q: 1`, `slope: 12` |
| Bramka szumów | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Korektor graficzny | `audacity-graphic-eq` | `gains`: 31 wzmocnień pasm w dB, wszystkie 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| Filtr górnoprzepustowy | `highpass` | `frequency: 80`, `q: 0.707` |
| Odwrócenie | `audacity-invert` | brak |
| Starszy kompresor | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Ogranicznik | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Normalizacja głośności | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Filtr dolnoprzepustowy | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Redukcja szumów | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalizuj | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Usuń składową stałą | `audacity-remove-dc-offset` | brak |
| Naprawa | `audacity-repair` | brak |
| Powtarzaj | `audacity-repeat` | `count: 1` |
| Pogłos | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Pogłos (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Odwróć | `audacity-reverse` | brak |
| Rozciąganie ze zmiennym tempem | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Skróć ciszę | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Wzmocnienie (zweryfikowane) | `reviewed-utility-gain` | `gain: 1` |
| Wah-wah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Dwa efekty wymagają czegoś, czego program nie może dostarczyć. Redukcja
szumów wymaga profilu szumu zapisanego w osobnym oknie dialogowym efektu, a
Automatyczne obniżanie głośności — ścieżki sterującej poniżej aktywnej ścieżki.

## Polecenia dostępne dla programu {#commands-a-program-can-run}

`sound.command` przyjmuje poniższe nazwy poleceń makr Audacity. Są to te same
nazwy, które może zawierać makro z listą kroków, więc program i lista kroków
mają dokładnie taki sam zakres działania. Każde polecenie uruchamia działanie
edytora opisane w [dokumentacji poleceń](/reference/generated/commands/).

### Polecenia zaznaczania z parametrami

| Polecenie | Parametry |
| --- | --- |
| `SelectTime` | `start`, `end` w sekundach; `relativeTo` jak dla `sound.select.time` |
| `SelectFrequencies` | `low`, `high` w hercach |
| `SelectTracks` | `track`, `trackCount` (od 0 do 100); `mode` o wartości `'set'`, `'add'` lub `'remove'` |
| `Select` | Dowolna kombinacja powyższych trzech zestawów |

Pominięty parametr pozostawia daną część zaznaczenia bez zmian, tak samo jak
interpretuje je Audacity.

### Polecenia bez parametrów

| Grupa | Polecenia |
| --- | --- |
| Zaznaczanie | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Edycja | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Ścieżki | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Etykiety | `AddLabel` |
| Analiza | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Czego celowo brakuje

Polecenia `Undo` i `Redo` są niedostępne, ponieważ całe uruchomienie stanowi
już jeden wpis w historii, a krok cofający historię sięgnąłby poza uruchomienie
i cofnął własne zmiany użytkownika. Polecenia odtwarzania i nagrywania są
niedostępne, ponieważ program nie ma na co czekać, a nagrania nie można cofnąć.
Niedostępne są też otwieranie, zapisywanie, zamykanie, importowanie,
eksportowanie i ustawienia, ponieważ program ma dostęp tylko do projektu
otwartego w chwili jego uruchomienia. Polecenia, które jedynie otwierają okno
dialogowe lub zmieniają widok, są niedostępne, bo nie zmieniają projektu.

## Udostępnianie programów {#sharing-programs}

Polecenie **Eksportuj program** zapisuje wybrany program jako plik
`.soundscapemacro`, a **Importuj program** wczytuje taki plik. Plik jest
zapisany w formacie JSON, a nie jako zwykły plik `.js`, dzięki czemu na
komputerze odbiorcy nic nie pomyli go z czymś przeznaczonym do uruchomienia poza
edytorem:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

Import powoduje zapisanie wyłącznie tekstu. Przy zaimportowanym programie nie ma
przycisku **Uruchom program**; zamiast niego panel pokazuje program, plik, z
którego pochodzi, informację o tym, co program może zrobić z otwartym
projektem, oraz pole wyboru z tekstem *Przeczytałem ten program i chcę go
uruchomić.* Zaznaczenie pola uaktywnia przycisk **Włącz ten program** i dopiero
wtedy można go uruchomić.

To zezwolenie dotyczy dokładnie przeczytanego tekstu. Jeśli program zostanie
później zmieniony — przez edycję lub zastąpienie nowszą kopią z importu —
ponownie pojawi się prośba o sprawdzenie, dopóki nie włączysz nowego tekstu.
Programy napisane samodzielnie w menedżerze nie wymagają sprawdzenia.

## Przykłady

Zastosuj narastanie do każdego klipu na pierwszej ścieżce, która zawiera klipy.
Przed uruchomieniem kliknij nagłówek tej ścieżki, aby efekt trafił na ścieżkę,
którą odczytuje program:

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

Zapisz raport o projekcie bez wprowadzania zmian:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Uruchom zapisane makro z listą kroków tylko wtedy, gdy zaznaczenie jest
wystarczająco długie:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## O tej stronie

Każdy program opisany na tej stronie — od jednolinijkowych fragmentów kodu po
pełne przykłady — jest uruchamiany w ramach testów przeglądarkowych na każdej
kompilacji Soundscapera (`tests/browser/handbook-macro-program-examples.spec.js`),
które odczytują programy bezpośrednio z tekstu tej strony. Jeśli program
przestanie się kończyć albo przestanie dawać opisany tu wynik, kompilacja
zakończy się niepowodzeniem, dopóki nie zostanie poprawiona strona lub edytor.
