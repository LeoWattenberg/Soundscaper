---
title: "Makroprogramme"
description: "Die JavaScript-API, gegen die ein Makroprogramm ausgeführt wird, die Grenzen, unter denen es läuft, und die Datei, in der es transportiert wird."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","targetLocale":"de"} -->

Ein Makroprogramm ist ein Makro, das als JavaScript geschrieben wird, anstatt als Liste von Schritten.
Es wird im Editor gegen eine kleine API namens `sound` ausgeführt, die es ermöglicht, das
gesöffnete Projekt zu lesen, die Auswahl zu verschieben und dieselben Effekte und Befehle anzuwenden, die
ein Makro mit Schrittliste anwenden kann. Alles andere, von Dateien und dem Netzwerk bis hin zu Ihren
anderen Projekten, ist außerhalb seiner Reichweite.

Programme sind eine Funktion von Soundscaper. Framescaper hat keinen Makro-Manager.

## Wo Programme gespeichert werden

Wählen Sie **Werkzeuge → Makro-Manager**. Der Dialog listet Makros mit Schrittliste und unter
**Programme** die von Ihnen gespeicherten Programme auf. **Neues Programm** erstellt eines, und das
Detailfeld zeigt den **Programmnamen**, den **Programmtext** und eine **Programm ausführen**
-Schaltfläche. Der Text wird beim Tippen gespeichert; es gibt keinen separaten Speicherschritt.

Ein Programm wird mit den Einstellungen des Editors gespeichert, nicht innerhalb eines Projekts, sodass es
in jedem Projekt verfügbar ist, das Sie in diesem Editor öffnen. Verwenden Sie **Programm exportieren** und
**Programm importieren**, um es auf einen anderen Computer oder an eine andere Person zu übertragen; siehe
[Programme teilen](#sharing-programs) für die damit verbundenen Schritte.

Die Anleitung [Denselben Effekt-Ketten jedes Mal anwenden](/guides/effects/apply-the-same-effects-every-time/)
behandelt die Seite mit der Schrittliste desselben Dialogs.

## Ein Programm schreiben

Ein Programm ist der Körper einer `async`-Funktion, die im strikten Modus ausgeführt wird. Das bedeutet, dass Sie
`await` auf der obersten Ebene verwenden können, Variablen und Funktionen deklarieren und jede
gewöhnliche Sprachfunktion nutzen können. Das Objekt `sound` ist die einzige Verbindung des Programms zum
Editor, und jeder Aufruf darauf gibt ein Promise zurück.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Tab fügt zwei Leerzeichen im Programmfeld ein. Drücken Sie Escape und dann Tab, um das Feld zu verlassen.

### Was ein Programm verwenden kann

Die übliche JavaScript-Standardbibliothek ist vorhanden: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, die typisierten Arrays, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` und `queueMicrotask`. `console`
ist ebenfalls vorhanden, und alles, was daran geschrieben wird, landet im Protokoll des Programms.

### Was ein Programm nicht verwenden kann

Ein Programm läuft in einem Worker, dem seine Fähigkeiten vor der Ausführung der ersten Zeile entzogen wurden. Keines der folgenden Elemente existiert innerhalb eines Programms: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` und `setInterval`. Das Lesen eines beliebigen davon ergibt `undefined`.

Ein Programm kann kein Modul `import`; ein statisches `import` ist ein Syntaxfehler auf der
Zeile, die es enthält. Alles, was das Programm benötigt, muss im Programm vorhanden sein.

Die Sicherheitsgrenze sind nicht die fehlenden Globalen, sondern der Editor selbst: Er
antwortet nur auf die auf dieser Seite aufgeführten Aufrufe und lehnt alles andere namentlich ab,
was auch immer ein Programm ihm zu senden versucht.

## Ausführen eines Programms

Drücken Sie **Programm ausführen**. Der gesamte Lauf ist ein Eintrag in der Projektverlaufshistorie, sodass
ein **Rückgängig** alles, was das Programm getan hat, rückgängig macht, unabhängig davon, wie viele Änderungen es vorgenommen hat.
Wenn das Programm eine Ausnahme wirft, abgebrochen wird oder seine Frist überschreitet, wird das Projekt
genauso wiederhergestellt, wie es vor Beginn des Laufs war.

**Lauf abbrechen** stoppt ein Programm sofort. Ein Programm, das seit zwei Minuten läuft, wird auf dieselbe Weise gestoppt, mit der Meldung *Die Makro lief länger als
120 Sekunden.*

Nach dem Lauf zeigt das Pane das Protokoll des Programms, gefolgt von *Programm angewendet.*
wenn der Lauf abgeschlossen wurde. Ein fehlgeschlagener Lauf zeigt *Das Programm ist in Zeile N fehlgeschlagen:* und
die Fehlermeldung an, wobei die Zeilennummer die Zeile Ihres Programms ist, die die Ausnahme geworfen hat.

### Welchen Audio ein Effekt berührt

Ein von einem Programm angewendeter Effekt wird über die aktuelle Zeitmarkierung auf der
fokussierten Spur ausgeführt, das ist die Spur, deren Kopf Sie zuletzt angeklickt oder deren Clip
Sie zuletzt ausgewählt haben. Wenn keine Zeitmarkierung, aber ein Clip ausgewählt ist, deckt der
effekt diesen Clip ab. Die Auswahlaufrufe eines Programms ändern den Zeitbereich und
die Menge der ausgewählten Spuren, aber nicht, welche Spur fokussiert ist, sodass ein Lauf eine Spur verarbeitet. Wenn nichts fokussiert ist oder die Auswahl leer ist, schlägt der Lauf fehl mit
der gleichen Meldung, die das Effektmenü gibt.

## Die `sound` API

Jede Methode unten gibt ein Promise zurück, es sei denn, es wird anders angegeben. Warten Sie auf jeden Aufruf
bevor Sie den nächsten ausführen; ein Programm, das mehr als acht Aufrufe ohne Warten startet, hat den neunten abgelehnt.

### `sound.env`

Ein einfaches Objekt, das den Lauf beschreibt.

| Feld | Bedeutung |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | Die Schnittsprache des Editors, wie `"en"` oder `"de"`. |
| `seed` | Der Seed, aus dem die Zufallszahlen des Laufs stammen. Neu für jeden Lauf. |
| `startedAt` | Die Uhrzeit, zu der der Lauf begann, als ISO-8601-Zeichenfolge. |
| `dryRun` | Derzeit immer `false`. Vorbehalten. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` und `sound.log.debug(...values)` schreiben jeweils eine Zeile
ins Protokoll des Laufs. `console.log`, `console.info`, `console.warn`,
`console.error` und `console.debug` tun dasselbe. Werte, die keine Zeichenfolgen sind,
werden als JSON geschrieben. Diese Methoden geben nichts zurück und müssen nicht abgewartet werden.

Ein Protokoll enthält höchstens 1.000 Zeilen oder 256 KiB, je nachdem, was zuerst erreicht wird, und jede Zeile
wird bei 4.096 Zeichen abgeschnitten. Zeilen darüber hinaus werden verworfen und gezählt; die Anzahl
wird als letzte Warnung gemeldet.

### `sound.project`

Das Lesen des Projekts ändert es nie und zählt nicht gegen das Änderungsbudget des Laufs.

`sound.project.snapshot()` gibt `{ sampleRate, tracks, selection }`, mit
`tracks` und `selection` zurück, wie die beiden Aufrufe unten sie zurückgeben. `sampleRate` ist die
Abtastrate des Projekts in Hertz, in der jede Rahmenzahl auf dieser Seite gemessen wird.

`sound.project.tracks()` gibt ein Array von Spuren in Zeitachsendaten zurück:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` gibt die Clips auf einer Spur oder auf allen Spuren zurück,
wenn `trackId` weggelassen wird:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` gibt die aktuelle Auswahl zurück:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Jeder Auswahlaufruf zählt als eine Änderung und gibt die erzeugte Auswahl zurück,
in der Form, die `sound.project.selection()` zurückgibt.

`sound.select.time(start, end, options)` setzt den Zeitbereich in Sekunden. Es ist
die `SelectTime`-Befehl von Audacity, und `options.relativeTo` bestimmt, von wo aus jede
Kante gemessen wird. Beide Kanten können so niedrig wie -100 Sekunden sein.

| `relativeTo` | Startkante | Endkante |
| --- | --- | --- |
| `'project-start'` (Standard) | `start` Sekunden ab Projektstart | `end` Sekunden ab Projektstart |
| `'project'` | `start` Sekunden ab Projektstart | `end` Sekunden nach Projektende |
| `'project-end'` | `start` Sekunden vor Projektende | `end` Sekunden vor Projektende |
| `'selection-start'` | `start` Sekunden nach Auswahlstart | `end` Sekunden nach Auswahlstart |
| `'selection'` | `start` Sekunden nach Auswahlstart | `end` Sekunden nach Auswahlschluss |
| `'selection-end'` | `start` Sekunden vor Auswahlschluss | `end` Sekunden vor Auswahlschluss |

Das Projektende ist der letzte Frame, den ein Clip erreicht. Die ausgewählten Spuren bleiben
wie sie waren.

`sound.select.frames(startFrame, endFrame, options)` setzt den Zeitbereich in
Frames bei der Projektabtastrate. `options.trackIds` benennt die Spuren, die
ausgewählt werden sollen; wenn es weggelassen wird, bleiben die bereits ausgewählten Spuren ausgewählt.
Der Bereich wird auf die Zeitleiste begrenzt und die Kanten werden getauscht, wenn sie umgekehrt sind.

`sound.select.tracks(options)` ist der `SelectTracks`-Befehl von Audacity. Er wählt
die Spuren aus, deren Index (gezählt ab 0) im Bereich von `options.track`
(Standard 0) über `options.trackCount` Spuren (Standard 1) liegt. `options.mode` ist
`'set'` zum Ersetzen der Spurauswahl, `'add'` zum Erweitern oder `'remove'` zum
Entfernen dieser Spuren daraus. Der Zeitbereich bleibt wie er war.

`sound.select.frequencies(options)` ist der `SelectFrequencies`-Befehl von Audacity.
Er setzt die Spektralauswahl auf `options.low` und `options.high` in Hertz;
eine weggelassene Kante behält ihren aktuellen Wert.

`sound.select.all()` wählt das gesamte Projekt auf jeder Spur aus.
`sound.select.none()` löscht die Auswahl.

### `sound.effect(type, params)`

Wendet einen Effekt auf die aktuelle Auswahl auf der fokussierten Spur an. `type` ist
eine Effekt-ID aus [Effekte, die ein Programm anwenden kann](#effects-a-program-can-apply),
und `params` ist ein Objekt mit den Parametern dieses Effekts. Weggelassene Parameter nehmen
die Standardwerte des Effekts an; die Werte werden gegen die Bereiche in der
[Audio-Effekt-Referenz](/reference/generated/audio-effects/) geprüft. Löst auf
`null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Wendet eine Kette von Effekten in einem Durchgang auf die aktuelle Auswahl an, genau so wie eine
Schrittlisten-Makro mit diesen Schritten. Jeder Schritt ist `{ type, params }`, und die
Kette benötigt mindestens einen Schritt. Löst auf `null` auf.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Führt einen der Audacity-Makrokommandos aus, die unter
[Befehle, die ein Programm ausführen kann](#commands-a-program-can-run) aufgelistet sind. Die vier Auswahlbefehle akzeptieren die dort beschriebenen Parameter; die anderen akzeptieren keine. Löst anschließend die Auswahl auf.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Führt eine in demselben Makro-Manager gespeicherte Schrittlisten-Makro unter ihrem exakten Namen aus, einschließlich aller darin enthaltenen Auswahlbefehle. Ein gespeichertes Makro kann selbst kein Programm sein, daher verschachteln sich Programme nicht. Wird aufgelöst zu `null`; ein unbekannter Name wird abgelehnt.

### Zeit und Zufall

Eine Ausführung ist reproduzierbar: Zwei Ausführungen desselben Programms über dasselbe Projekt lesen dieselben Werte, da die Uhr und die Zufallszahlen nicht die des Systems sind.

`Date.now()` und `new Date()` ohne Argumente geben eine virtuelle Uhr zurück, die bei 0 startet und sich für jede beantwortete Anfrage an den Editor um eins erhöht und sich um `ms` für jedes `sound.wait(ms)`. `sound.wait` wird sofort aufgelöst; es gibt keine Möglichkeit für ein Programm, auf echte Zeit zu pausieren, und auch keine Notwendigkeit dafür, da jeder Aufruf an den Editor abgeschlossen ist, bevor sein Promise aufgelöst wird.

`Math.random()` und `sound.random()` sind derselbe Generator, der aus `sound.env.seed` initialisiert wird. Protokollieren Sie den Seed, wenn Sie wissen müssen, welche Sequenz eine Ausführung verwendet hat.

### Überprüfung Ihrer Annahmen

`sound.assert(condition, message)` wirft `message` aus, wenn `condition` falsch ist.
`sound.assertEqual(actual, expected, message)` vergleicht die beiden Werte als JSON
und wirft eine Ausnahme aus, wenn sie sich unterscheiden, mit einer Meldung, die beide Werte benennt, wenn Sie keine angeben. Da ein geworfener Fehler die Ausführung beendet und alles zuvor zurückrollt, bleibt das Projekt bei einer fehlgeschlagenen Assertion unberührt. Keine der beiden Methoden gibt ein Promise zurück.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Werte, die zum Editor übertragen werden

Jedes Argument, das ein Programm übergibt, und jeder Wert, den es empfängt, sind einfache Daten:
`null`, Boolesche Werte, endliche Zahlen, Zeichenfolgen sowie Arrays und einfache Objekte aus
diesen. `NaN`, `Infinity`, Funktionen, Klasseninstanzen, typisierte Arrays und `Date`
Objekte werden mit einem Fehler abgelehnt, ebenso wie jeder Wert, der größer als 1 MiB ist, tiefer als 12 Ebenen verschachtelt ist oder in einem Array oder Objekt mehr als 4.096 Einträge enthält.
`undefined`-Eigenschaften werden verworfen.

## Grenzen

| Grenze | Wert |
| --- | --- |
| Programmumfang | 256 KiB |
| Aufrufe an den Editor pro Ausführung | 4.096 |
| Änderungen am Projekt pro Ausführung (Auswahlaufrufe, Effekte, Befehle) | 256 |
| Gleichzeitig wartende Aufrufe auf eine Antwort | 8 |
| Laufzeit | 120 Sekunden |
| Ein einzelner Wert, der zum oder vom Editor übertragen wird | 1 MiB, 12 Ebenen tief, 4.096 Einträge pro Array oder Objekt |
| Protokoll | 1.000 Zeilen oder 256 KiB; 4.096 Zeichen pro Zeile |
| Programme in der Bibliothek | 128 |
| Programmname | 256 Zeichen |
| Importierte Programmdatei | 1 MiB |

Eine Schleife, die jeden Clip auswählt und einen Effekt anwendet, verbraucht zwei Änderungen pro
Clip und kann daher 128 Clips abdecken, bevor das Kontingent erschöpft ist.

## Fehler

Ein Aufruf, den der Editor ablehnt, lehnt sein Promise mit einem `Error` ab, dessen `message`
die Begründung angibt: ein Befehl außerhalb des Vokabulars, ein Effekt auf einer leeren Auswahl,
ein Parameter außerhalb des zulässigen Bereichs. Der Fehler enthält außerdem einen `code`, der
`MACRO_CALL_FAILED` ist, es sei denn, der Editor hat einen spezifischeren bereitgestellt. Ein Programm
kann diese abfangen und weiterlaufen:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Das Programm wird abgeschlossen und sein Protokoll lautet *refused: Unsupported macro command:
ExportWav.*

Ein Fehler, den das Programm nicht abfängt, beendet die Ausführung, rollt das Projekt zurück und wird im Paneel zusammen mit der Zeile angezeigt, aus der er stammt. Ein Programm, das nicht kompiliert wird, wird auf dieselbe Weise gemeldet, bevor etwas ausgeführt wird.

## Effekte, die ein Programm anwenden kann {#effects-a-program-can-apply}

Dies sind die Effekt-IDs, die `sound.effect` und `sound.effects` akzeptieren, einschließlich der Parameter-Schlüssel, die jeder von ihnen übernimmt, und ihrer Standardwerte. Bereiche und Einheiten finden Sie in der
[audio effects reference](/reference/generated/audio-effects/). Nyquist-Plug-ins können nicht aus einem Programm heraus angewendet werden.

| Effekt | Effekt-ID | Parameter und Standardwerte |
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
| Fade In | `audacity-fade-in` | keine |
| Fade Out | `audacity-fade-out` | keine |
| Filter Curve EQ | `audacity-filter-curve-eq` | `points`: ein Array von `{ frequency, gain }`, Standard zwei flache Punkte bei 20 Hz und 20 kHz; `linearFrequencyScale: false`; `filterLength: 8191` |
| Four-band parametric EQ | `eq` | `outputGain: 0`; `bands`: vier `{ id, enabled, type, frequency, gain, q, slope }`-Objekte, mit Spitzen bei 100, 500, 2000 und 8000 Hz mit `gain: 0`, `q: 1`, `slope: 12` |
| Gate | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Graphic EQ | `audacity-graphic-eq` | `gains`: 31 Band-Gewinne in dB, alle 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| High-pass filter | `highpass` | `frequency: 80`, `q: 0.707` |
| Invert | `audacity-invert` | keine |
| Legacy Compressor | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limiter | `limiter` | `ceiling: -1`, `lookahead: 0.005`, `release: 0.1` |
| Limiter (Audacity) | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Loudness Normalization | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Low-pass filter | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Noise Reduction | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalize | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Remove DC Offset | `audacity-remove-dc-offset` | keine |
| Repair | `audacity-repair` | keine |
| Repeat | `audacity-repeat` | `count: 1` |
| Reverb | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Reverb (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Reverse | `audacity-reverse` | keine |
| Sliding Stretch | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Truncate Silence | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Utility Gain (Reviewed) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Zwei Effekte benötigen etwas, das ein Programm nicht bereitstellen kann. Noise Reduction benötigt ein Rauschprofil, das im eigenen Dialog des Effekts erfasst wird, und Auto Duck benötigt eine Steuerspur unterhalb der fokussierten Spur.

## Befehle, die ein Programm ausführen kann {#commands-a-program-can-run}

`sound.command` akzeptiert die folgenden Audacity-Makrobefehlsnamen. Es handelt sich um dieselben Namen, die eine Makro-Schrittauflistung enthalten kann, sodass ein Programm und eine Schrittauflistung genau denselben Zugriffsbereich haben. Jeder Befehl führt die Editoraktion aus, die in der [Befehlsreferenz](/reference/generated/commands/) beschrieben wird.

### Auswahlbefehle mit Parametern

| Befehl | Parameter |
| --- | --- |
| `SelectTime` | `start`, `end` in Sekunden; `relativeTo` wie bei `sound.select.time` |
| `SelectFrequencies` | `low`, `high` in Hertz |
| `SelectTracks` | `track`, `trackCount` (0 bis 100); `mode` von `'set'`, `'add'` oder `'remove'` |
| `Select` | Beliebige Kombination der drei oben genannten Gruppen |

Ein Parameter, den Sie weglassen, lässt den entsprechenden Teil der Auswahl unverändert, was Audacity ebenfalls so interpretiert.

### Befehle ohne Parameter

| Gruppe | Befehle |
| --- | --- |
| Auswahl | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Bearbeitung | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Spuren | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Beschriftungen | `AddLabel` |
| Analyse | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Was bewusst fehlt

`Undo` und `Redo` fehlen, da eine Ausführung bereits einen Eintrag in der Verlaufshistorie darstellt und ein Schritt, der die Historie durchläuft, über die Ausführung hinaus in Ihre eigenen Bearbeitungen greifen würde. Transport- und Aufnahmefunktionen fehlen, da ein Programm nichts abwarten muss und aus einer Aufnahme nicht zurückgerollt werden kann. Öffnen, Speichern, Schließen, Importieren, Exportieren und Einstellungen fehlen, da der Zugriffsbereich eines Programms auf das eine Projekt beschränkt ist, das beim Start geöffnet war. Befehle, die nur einen Dialog öffnen oder die Ansicht ändern, fehlen, da sie nichts im Projekt verändern.

## Programme teilen {#sharing-programs}

**Programm exportieren** schreibt das ausgewählte Programm als `.soundscapemacro`-Datei, und **Programm importieren** liest eine solche Datei. Die Datei ist JSON und keine bloße `.js`-Datei, damit auf dem empfangenden Computer nichts versehentlich als außerhalb des Editors ausführbar interpretiert wird:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

Das Importieren speichert nur den Text und nichts weiter. Ein importiertes Programm hat keine **Programm ausführen**-Schaltfläche; an deren Stelle zeigt das Paneel das Programm, die Datei, aus der es stammt, einen Hinweis dazu, was ein Programm mit dem offenen Projekt tun kann, sowie ein Kontrollkästchen mit der Aufschrift *Ich habe dieses Programm gelesen und möchte es ausführen.* Wenn Sie es aktivieren, wird **Dieses Programm aktivieren** freigegeben, und erst dann kann das Programm ausgeführt werden.

Diese Berechtigung gilt für den exakten Text, den Sie gelesen haben. Wenn sich das Programm anschließend ändert, ob Sie es bearbeiten oder eine neuere Version darüber importieren, erscheint die Überprüfung erneut, bis Sie den neuen Text aktivieren. Programme, die Sie selbst im Manager schreiben, benötigen keine Überprüfung.

## Beispiele

Jeden Clip auf der ersten Spur, die welche enthält, einblenden. Klicken Sie vor der Ausführung auf den Kopf dieser Spur, damit der Effekt auf die Spur trifft, die das Programm liest:

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

Das Projekt melden, ohne es zu ändern:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Führen Sie eine gespeicherte Makro-Steuerliste nur aus, wenn die Auswahl lang genug ist:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## Über diese Seite

Jedes Programm auf dieser Seite, von den Einzeilensnippets bis zu den ausgearbeiteten Beispielen,
wird bei jedem Build von Soundscaper von der Browser-Suite
(`tests/browser/handbook-macro-program-examples.spec.js`) ausgeführt, die die
Programme aus dem eigenen Text dieser Seite liest. Ein Programm, das die Ausführung nicht mehr abschließt oder nicht mehr das erzeugt, was diese Seite als Ergebnis angibt, führt zu einem fehlgeschlagenen Build, bis die Seite oder der Editor korrigiert wird.
