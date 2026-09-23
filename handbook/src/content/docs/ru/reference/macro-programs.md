---
title: "Макропрограммы"
description: "API JavaScript для макропрограмм, ограничения их работы и формат переносимого файла."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","model":"gpt-6-astra","modelProvider":"codex-session","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"ru"} -->

Макропрограмма — это макрос, написанный на JavaScript, а не в виде списка шагов. Она работает внутри редактора через небольшой API `sound`, который позволяет читать открытый проект, менять выделение и применять те же эффекты и команды, что доступны пошаговому макросу. Файлы, сеть и другие ваши проекты ей недоступны.

Программы поддерживаются в Soundscaper. В Framescaper менеджера макросов нет.

## Где находятся программы

Выберите **Инструменты → Менеджер макросов**. В диалоге показаны пошаговые макросы, а в разделе **Программы** — сохранённые программы. Чтобы создать программу, нажмите **+ (Новая программа)** в заголовке раздела. На той же панели действий доступны **Импортировать программу**, **Экспортировать программу** и **Удалить программу** для выбранной программы. В области сведений отображаются **Название программы**, текст **Программы** и кнопка **Запустить программу**. Текст сохраняется по мере ввода; отдельное сохранение не требуется.

Программа хранится в настройках редактора, а не внутри проекта, поэтому она доступна в любом проекте этого редактора. Команды **Экспортировать программу** и **Импортировать программу** позволяют передать её на другой компьютер или другому человеку; подробности см. в разделе [«Обмен программами»](#sharing-programs).

[Руководство по применению одной цепочки эффектов](/guides/effects/apply-the-same-effects-every-time/) описывает пошаговые макросы в том же диалоге.

## Написание программы

Программа представляет собой тело функции `async`, выполняемой в строгом режиме. Поэтому на верхнем уровне можно использовать `await`, объявлять переменные и функции и применять обычные возможности языка. Объект `sound` — единственный способ программы обратиться к редактору, и каждый его вызов возвращает промис.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Клавиша Tab вставляет в поле программы два пробела. Чтобы выйти из поля, нажмите Escape, затем Tab.

### Доступные возможности

Доступна стандартная библиотека JavaScript: `Object`, `Array`, `Map`, `Set`, `Math`, `JSON`, `RegExp`, `Promise`, типизированные массивы, `Intl`, `TextEncoder`, `TextDecoder`, `structuredClone` и `queueMicrotask`. Также доступен `console`: всё записанное в него попадает в журнал программы.

### Недоступные возможности

Программа выполняется в рабочем процессе, у которого возможности отключены до выполнения первой строки. В программе недоступны `fetch`, `XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`, `location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`, `setTimeout` и `setInterval`. При чтении любого из этих имён получается `undefined`.

Программа не может выполнить `import` модуля; статический `import` вызывает синтаксическую ошибку в соответствующей строке. Всё необходимое должно находиться в тексте самой программы.

Граница доступа обеспечивается самим редактором, а не только отсутствием глобальных объектов: он отвечает лишь на вызовы, перечисленные на этой странице, и отклоняет все остальные имена, которые программа ему передаст.

## Запуск программы

Нажмите **Запустить программу**. Весь запуск считается одной записью в истории проекта, поэтому одна команда **Отменить** откатывает все изменения программы независимо от их числа. Если программа выдаёт ошибку, отменяется или превышает отведённое время, проект возвращается точно к состоянию до запуска.

Кнопка **Отменить запуск** немедленно останавливает программу. Программа, работавшая две минуты, останавливается так же с сообщением *Время выполнения макроса превысило 120 секунд.*

После запуска область показывает журнал программы, а при успешном завершении — сообщение *Программа применена.* При ошибке отображаются *Ошибка программы в строке N:* и сообщение ошибки; номер указывает на строку вашей программы, где она возникла.

### К какому аудио применяется эффект

Эффект программы применяется к текущему выделению времени на активной дорожке — той, по заголовку которой вы щёлкнули последней или чей клип выделили. Если время не выделено, но выбран клип, эффект охватывает этот клип. Вызовы выделения меняют временной диапазон и набор выделенных дорожек, но не активную дорожку, поэтому один запуск обрабатывает одну дорожку. Если активной дорожки нет или выделение пусто, выводится та же ошибка, что и из меню «Эффект».

## API `sound`

Каждый описанный ниже метод возвращает промис, если не указано иное. Дождитесь завершения каждого вызова, прежде чем делать следующий: если программа начнёт больше восьми вызовов без ожидания, девятый будет отклонён.

### `sound.env`

Обычный объект с описанием запуска.

| Поле | Значение |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | Язык интерфейса редактора, например `"en"` или `"de"`. |
| `seed` | Начальное значение генератора случайных чисел. Новое для каждого запуска. |
| `startedAt` | Время начала запуска по системным часам в формате ISO 8601. |
| `dryRun` | Сейчас всегда `false`. Зарезервировано. |

### `sound.log`

Методы `sound.log.info(...values)`, `sound.log.warn(...values)`, `sound.log.error(...values)` и `sound.log.debug(...values)` записывают по одной строке в журнал запуска. Так же работают `console.log`, `console.info`, `console.warn`, `console.error` и `console.debug`. Значения, не являющиеся строками, записываются как JSON. Эти методы ничего не возвращают, поэтому их не нужно ожидать.

Журнал содержит не более 1 000 строк или 256 KiB — в зависимости от того, какой предел достигнут первым. Каждая строка обрезается после 4 096 символов. Лишние строки отбрасываются и подсчитываются; их число выводится в последнем предупреждении.

### `sound.project`

Чтение проекта не меняет его и не расходует лимит изменений запуска.

`sound.project.snapshot()` возвращает `{ sampleRate, tracks, selection }`, где `tracks` и `selection` имеют вид результатов двух описанных ниже вызовов. `sampleRate` — частота дискретизации проекта в герцах; все числа кадров на этой странице измеряются относительно неё.

`sound.project.tracks()` возвращает массив дорожек в порядке временной шкалы:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` возвращает клипы одной дорожки либо всех дорожек, если `trackId` не указан:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` возвращает текущее выделение:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Каждый вызов выделения считается одним изменением и возвращает созданное выделение в формате результата `sound.project.selection()`.

`sound.select.time(start, end, options)` задаёт временной диапазон в секундах. Это команда Audacity `SelectTime`; параметр `options.relativeTo` определяет, откуда отсчитываются обе границы. Границы могут достигать -100 секунд.

| `relativeTo` | Начальная граница | Конечная граница |
| --- | --- | --- |
| `'project-start'` (по умолчанию) | `start` секунд от начала проекта | `end` секунд от начала проекта |
| `'project'` | `start` секунд от начала проекта | `end` секунд после конца проекта |
| `'project-end'` | `start` секунд до конца проекта | `end` секунд до конца проекта |
| `'selection-start'` | `start` секунд после начала выделения | `end` секунд после начала выделения |
| `'selection'` | `start` секунд после начала выделения | `end` секунд после конца выделения |
| `'selection-end'` | `start` секунд до конца выделения | `end` секунд до конца выделения |

Конец проекта — последний кадр любого клипа. Набор выделенных дорожек не меняется.

`sound.select.frames(startFrame, endFrame, options)` задаёт диапазон в кадрах при частоте дискретизации проекта. `options.trackIds` задаёт выделяемые дорожки; если он опущен, остаются выделенными прежние дорожки. Диапазон ограничивается временной шкалой, а границы меняются местами, если указаны в обратном порядке.

`sound.select.tracks(options)` соответствует команде Audacity `SelectTracks`. Она выделяет дорожки, чьи индексы, начиная с 0, попадают в диапазон от `options.track` (по умолчанию 0) длиной `options.trackCount` дорожек (по умолчанию 1). Значение `options.mode` — `'set'` для замены выделения дорожек, `'add'` для расширения или `'remove'` для исключения. Временной диапазон не меняется.

`sound.select.frequencies(options)` соответствует команде Audacity `SelectFrequencies`. Она устанавливает спектральное выделение между `options.low` и `options.high` в герцах; пропущенная граница сохраняет текущее значение.

`sound.select.all()` выделяет весь проект на всех дорожках. `sound.select.none()` снимает выделение.

### `sound.effect(type, params)`

Применяет один эффект к текущему выделению на активной дорожке. `type` — идентификатор из раздела [«Эффекты, доступные программе»](#effects-a-program-can-apply), а `params` — объект параметров эффекта. Для неуказанных параметров используются значения по умолчанию; диапазоны проверяются по [справочнику аудиоэффектов](/reference/generated/audio-effects/). Результат — `null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Применяет цепочку эффектов к текущему выделению за один проход точно так же, как пошаговый макрос с этими шагами. Каждый шаг имеет вид `{ type, params }`; цепочка должна содержать хотя бы один шаг. Результат — `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Запускает одну из команд макросов Audacity, перечисленных в разделе [«Команды, доступные программе»](#commands-a-program-can-run). Четыре команды выделения принимают описанные там параметры; остальные не принимают параметров. Возвращает итоговое выделение.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Запускает по точному имени пошаговый макрос, сохранённый в том же менеджере, вместе со всеми содержащимися в нём командами выделения. Сохранённый макрос не может быть программой, поэтому программы не вкладываются друг в друга. Результат — `null`; неизвестное имя вызывает ошибку.

### Время и случайность

Запуск воспроизводим: два запуска одной программы на одном проекте читают одинаковые данные, поскольку часы и случайные числа не берутся у компьютера.

`Date.now()` и вызов `new Date()` без аргументов используют виртуальные часы: они начинаются с 0 и продвигаются на единицу за каждый завершённый вызов редактора, а также на `ms` за каждый `sound.wait(ms)`. Вызов `sound.wait` завершается сразу; программа не может ждать реального времени, поскольку каждый вызов редактора завершается до разрешения его промиса.

`Math.random()` и `sound.random()` используют один генератор с начальным значением `sound.env.seed`. Запишите это значение в журнал, если нужно узнать, какую последовательность использовал запуск.

### Проверка предположений

`sound.assert(condition, message)` выдаёт `message`, если `condition` ложно. `sound.assertEqual(actual, expected, message)` сравнивает два значения как JSON и выдаёт ошибку при различии; без заданного сообщения в ней указываются оба значения. Поскольку ошибка завершает запуск и откатывает все предшествующие изменения, неудачная проверка оставляет проект без изменений. Ни один метод не возвращает промис.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Значения, передаваемые редактору

Каждый аргумент программы и каждое полученное значение — простые данные: `null`, логические значения, конечные числа, строки, массивы и обычные объекты из них. `NaN`, `Infinity`, функции, экземпляры классов, типизированные массивы и объекты `Date` отклоняются с ошибкой. Также отклоняются значения размером более 1 MiB, с глубиной вложения более 12 уровней или более чем 4 096 элементами в одном массиве либо объекте. Свойства со значением `undefined` отбрасываются.

## Ограничения

| Ограничение | Значение |
| --- | --- |
| Длина программы | 256 KiB |
| Вызовы редактора за один запуск | 4 096 |
| Изменения проекта за один запуск (выделение, эффекты, команды) | 256 |
| Одновременно ожидающие ответа вызовы | 8 |
| Время выполнения | 120 секунд |
| Одно значение, передаваемое редактору или получаемое от него | 1 MiB, глубина 12 уровней, 4 096 элементов в массиве или объекте |
| Журнал | 1 000 строк или 256 KiB; 4 096 символов в строке |
| Программы в библиотеке | 128 |
| Название программы | 256 символов |
| Импортируемый файл программы | 1 MiB |

Цикл, выделяющий каждый клип и применяющий один эффект, расходует два изменения на клип, поэтому лимита хватит на 128 клипов.

## Ошибки

Если редактор отклоняет вызов, его промис завершается ошибкой `Error`, а `message` объясняет причину: неизвестная команда, эффект на пустом выделении или параметр вне диапазона. Ошибка также содержит `code`, равный `MACRO_CALL_FAILED`, если редактор не указал более точный код. Программа может перехватить такие ошибки и продолжить работу:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Такая программа завершится, а в журнале появится *отклонено: неподдерживаемая команда макроса: ExportWav.*

Неперехваченная ошибка завершает запуск, откатывает проект и показывается в области сведений вместе с номером строки. Ошибка компиляции сообщается так же до начала выполнения.

## Эффекты, доступные программе {#effects-a-program-can-apply}

Здесь перечислены идентификаторы эффектов, принимаемые `sound.effect` и `sound.effects`, а также ключи их параметров и значения по умолчанию. Диапазоны и единицы указаны в [справочнике аудиоэффектов](/reference/generated/audio-effects/). Программа не может применять плагины Nyquist.

| Эффект | Идентификатор эффекта | Параметры и значения по умолчанию |
| --- | --- | --- |
| Усиление | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Автоматическая утихание | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Басы и требл | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Бит-крушер | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Изменение высоты тона | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Изменение скорости и высоты тона | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Изменение темпа | `audacity-change-tempo` | `tempoPercent: 0` |
| Классические фильтры | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Удаление кликов | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Компрессор | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Задержка | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Дисторсия | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Эхо | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Фейд-ин | `audacity-fade-in` | нет |
| Фейд-аут | `audacity-fade-out` | нет |
| Эквалайзер кривой фильтра | `audacity-filter-curve-eq` | `points`: массив `{ frequency, gain }`, по умолчанию две точки с нулевым усилением на 20 Hz и 20 kHz; `linearFrequencyScale: false`; `filterLength: 8191` |
| Четырехполосный параметрический эквалайзер | `eq` | `outputGain: 0`; `bands`: четыре `{ id, enabled, type, frequency, gain, q, slope }` объекта с пиками на 100, 500, 2000 и 8000 Hz с `gain: 0`, `q: 1`, `slope: 12` |
| Шлюз | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Графический эквалайзер | `audacity-graphic-eq` | `gains`: усиление 31 полосы в dB, все значения 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| Фильтр верхних частот | `highpass` | `frequency: 80`, `q: 0.707` |
| Инверсия | `audacity-invert` | нет |
| Компрессор (старый) | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Лимитер | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Нормализация громкости | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Фильтр нижних частот | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Уменьшение шума | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Нормализация | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Полустретч | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Фазер | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Удаление смещения DC | `audacity-remove-dc-offset` | нет |
| Восстановление | `audacity-repair` | нет |
| Повтор | `audacity-repeat` | `count: 1` |
| Реверберация | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Реверберация (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Обратное воспроизведение | `audacity-reverse` | нет |
| Слайдинг Стретч | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Обрезка тишины | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Полезный усилитель (проверенный) | `reviewed-utility-gain` | `gain: 1` |
| Вав-вав | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Для двух эффектов требуются данные, которые программа не может предоставить. «Снижение шума» требует профиль, записанный в собственном диалоге эффекта, а «Автоматическое приглушение» — управляющую дорожку ниже активной.

## Команды, доступные программе {#commands-a-program-can-run}

`sound.command` принимает перечисленные ниже имена команд макросов Audacity. Пошаговый макрос использует те же имена, поэтому программа и список шагов имеют одинаковые возможности. Каждая команда выполняет действие редактора, описанное в [справочнике команд](/reference/generated/commands/).

### Команды выделения с параметрами

| Команда | Параметры |
| --- | --- |
| `SelectTime` | `start`, `end` в секундах; `relativeTo` как у `sound.select.time` |
| `SelectFrequencies` | `low`, `high` в герцах |
| `SelectTracks` | `track`, `trackCount` (от 0 до 100); `mode` принимает `'set'`, `'add'` или `'remove'` |
| `Select` | Любое сочетание трёх перечисленных наборов |

Пропущенный параметр не меняет соответствующую часть выделения — так же его понимает Audacity.

### Команды без параметров

| Группа | Команды |
| --- | --- |
| Выделение | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Редактирование | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Дорожки | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Метки | `AddLabel` |
| Анализ | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Что намеренно отсутствует

Команды `Undo` и `Redo` отсутствуют, поскольку весь запуск уже является одной записью истории, а переход по истории позволил бы затронуть ваши правки до запуска. Команды транспорта и записи отсутствуют, поскольку программе нечего ждать и запись нельзя откатить. Открытие, сохранение, закрытие, импорт, экспорт и настройки недоступны: программа работает только с проектом, который был открыт при запуске. Команды, лишь открывающие диалог или меняющие вид, отсутствуют, потому что они не меняют проект.

## Обмен программами {#sharing-programs}

Команда **Экспортировать программу** записывает выбранную программу в файл `.soundscapemacro`, а **Импортировать программу** считывает такой файл. Это файл JSON, а не просто `.js`, поэтому на принимающем компьютере его не примут за код для запуска вне редактора:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

При импорте сохраняется только текст. У импортированной программы нет кнопки **Запустить программу**. Вместо неё область показывает программу, исходный файл, предупреждение о возможном влиянии на открытый проект и флажок *Я прочитал эту программу и хочу её запустить.* Флажок активирует кнопку **Включить эту программу**; только после её нажатия запуск станет возможным.

Разрешение относится именно к прочитанному тексту. Если затем изменить программу вручную или импортировать поверх неё новую версию, проверку потребуется повторить. Программы, которые вы сами пишете в менеджере, проверки не требуют.

## Примеры

Примените плавное нарастание к каждому клипу первой дорожки, на которой есть клипы. Перед запуском щёлкните по заголовку этой дорожки, чтобы эффект применился к дорожке, которую программа читает:

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

Выведите сведения о проекте, не меняя его:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Запустите сохранённый пошаговый макрос, только если выделение достаточно длинное:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## Об этой странице

Каждая программа на этой странице — от однострочных примеров до подробных сценариев — запускается при каждой сборке Soundscaper браузерным набором (`tests/browser/handbook-macro-program-examples.spec.js`). Набор читает программы непосредственно из текста страницы. Если программа перестанет выполняться или давать описанный здесь результат, сборка не пройдёт проверку, пока страницу или редактор не исправят.
