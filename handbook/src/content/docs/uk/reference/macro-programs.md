---
title: "Макропрограми"
description: "JavaScript API, проти якого працює макропрограма, обмеження, в яких вона працює, та файл, у якому вона подорожує."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","targetLocale":"uk"} -->

Макропрограма — це макрос, написаний на JavaScript, а не як список кроків.
Вона виконується всередині редактора за допомогою невеликого API під назвою `sound`, який дозволяє їй читати
відкритий проект, переміщати вибірку та застосовувати ті самі ефекти та команди, що й макрос на основі списку кроків. Все інше, від файлів та мережі до ваших
інших проектів, недоступне для неї.

Програми — це функція Soundscaper. Framescaper не має менеджера макросів.

## Місцезнаходження програм

Виберіть **Інструменти → Менеджер макросів**. Діалогове вікно містить список макросів на основі списку кроків та, під
**Програми**, збережені вами програми. **Нова програма** створює одну, а панель деталей показує **Назва програми**, **Програма** та кнопку **Запустити
програму**. Текст зберігається під час набору; окремого кроку збереження немає.

Програма зберігається з налаштуваннями редактора, а не всередині проекту, тому вона доступна для кожного відкритого вами проекту в цьому редакторі. Використовуйте **Експорт програми** та
**Імпорт програми**, щоб перемістити її на інший комп'ютер або передати іншій особі; див. [Спільне використання програм](#sharing-programs) для інформації про цей процес.

Посібник [Застосування того самого ланцюга ефектів кожного разу](/guides/effects/apply-the-same-effects-every-time/)
охоплює сторону списку кроків того самого діалогового вікна.

## Написання програми

Програма — це тіло функції `async`, яка виконується в режимі суворого контролю. Це означає, що ви
можете `await` на верхньому рівні, оголошувати змінні та функції та використовувати кожну
звичайну мовну функцію. Об'єкт `sound` — це єдине з'єднання програми з редактором, і кожне звернення до нього повертає обіцянку.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Tab вставляє два пробіли в полі програми. Натисніть Escape, а потім Tab, щоб вийти з поля.

### Що може використовувати програма

Звичайна бібліотека JavaScript присутня: `Object`, `Array`, `Map`, `Set`, `Math`, `JSON`, `RegExp`, `Promise`, типізовані масиви, `Intl`, `TextEncoder`, `TextDecoder`, `structuredClone` та `queueMicrotask`. `console` також присутній, і все, що записується в нього, потрапляє в журнал програми.

### Що не може використовувати програма

Програма виконується в робочому процесі, якому позбавили його можливостей до виконання першої рядка. Жодна з наступних речей не існує всередині програми: `fetch`, `XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`, `location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`, `setTimeout` та `setInterval`. Читання будь-якого з них призводить до `undefined`.

Програма не може `import` модуля; статичний `import` є синтаксичною помилкою на рядку, що містить його. Все, що програма потребує, має бути в самій програмі.

Границя безпеки - це не відсутні глобальні змінні, а сам редактор: він відповідає лише на виклики, перераховані на цій сторінці, і відхиляє все інше за назвою, незалежно від того, що програма намагається йому надіслати.

## Виконання програми

Натисніть **Виконати програму**. Весь процес виконання стає одним записом в історії проекту, тому один **Скасувати** відкриває все, що зробила програма, незалежно від кількості змін, які вона внесла.

**Скасувати виконання** зупиняє програму відразу. Програма, яка виконувалась більше двох хвилин, зупиняється таким же чином, з повідомленням *Макрос виконувався довше 120 секунд.*

Після виконання панель показує журнал програми, за яким слідує *Програма застосована.* при успішному завершенні виконання. Невдале виконання показує *Програма зазнала невдачі на рядку N:* та повідомлення про помилку, де номер рядка - це рядок вашої програми, який викинув помилку.

### Який аудіо впливає ефект

Ефект, застосований програмою, працює над поточним вибором часу на зосередженій доріжці, яка є доріжкою, заголовок якої ви останнім часом натиснули або кліп якого ви останнім часом вибрали. Коли немає вибору часу, але вибрано кліп, ефект охоплює цей кліп. Виклики вибору програми змінюють часовий діапазон та набір вибраних доріжок, але не впливають на те, яка доріжка зосереджена, тому одна виконання обробляє одну доріжку. Якщо нічого не зосереджено або вибір порожній, виконання завершується з тим самим повідомленням, що і меню Ефект.

## API `sound`

Кожен метод нижче повертає обіцянку, якщо не вказано інше. Очікувати на кожен виклик перед наступним; програма, яка починає більше восьми викликів без очікування, має дев'ятий відхилений.

### `sound.env`

Простий об'єкт, що описує виконання.

| Поле | Значення |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | Мова інтерфейсу редактора, наприклад, `"en"` або `"de"`. |
| `seed` | Насіння випадкових чисел, що використовуються в ході виконання. Нове для кожного виконання. |
| `startedAt` | Час початку виконання на стіні, як рядок ISO 8601. |
| `dryRun` | Завжди `false` на даний момент. Зарезервовано. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`, `sound.log.error(...values)` та `sound.log.debug(...values)` записують по одному рядку в журнал виконання. `console.log`, `console.info`, `console.warn`, `console.error` та `console.debug` роблять те саме. Значення, які не є рядками, записуються як JSON. Ці методи не повертають нічого і не потребують очікування.

Журнал утримує не більше 1000 рядків або 256 KiB, залежно від того, що настане першим, і кожен рядок обрізаний до 4096 символів. Рядки за межами цього діапазону відкидаються та підраховуються; підрахунок повідомляється як остаточне попередження.

### `sound.project`

Читання проекту ніколи не змінює його і не впливає на бюджет змін виконання.

`sound.project.snapshot()` повертає `{ sampleRate, tracks, selection }`, з `tracks` та `selection`, як повертають їх два виклики нижче. `sampleRate` - це частота дискретизації проекту в герцах, яка є тим, в чому вимірюється кожен кадр на цій сторінці.

`sound.project.tracks()` повертає масив доріжок в хронологічному порядку:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

Функція `sound.project.clips(trackId)` повертає кліпи на одній доріжці або на всіх доріжках, коли `trackId` пропущено:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` повертає поточний вибір:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Кожен виклик вибору рахується як одна зміна і повертає вибір, який він створив, у форматі, що `sound.project.selection()` повертає.

`sound.select.time(start, end, options)` встановлює часовий діапазон у секундах. Це команда `SelectTime` Audacity, і `options.relativeTo` обирає, від якої межі вимірюється кожна крайка. Обидві крайки можуть бути не менше -100 секунд.

| `relativeTo` | Початкова крайка | Кінцева крайка |
| --- | --- | --- |
| `'project-start'` (за замовчуванням) | `start` секунд від початку проекту | `end` секунд від початку проекту |
| `'project'` | `start` секунд від початку проекту | `end` секунд після закінчення проекту |
| `'project-end'` | `start` секунд до закінчення проекту | `end` секунд до закінчення проекту |
| `'selection-start'` | `start` секунд після початку вибору | `end` секунд після початку вибору |
| `'selection'` | `start` секунд після початку вибору | `end` секунд після закінчення вибору |
| `'selection-end'` | `start` секунд до закінчення вибору | `end` секунд до закінчення вибору |

Кінець проекту - це остання кадр, до якого досягає будь-який кліп. Вибрані доріжки залишаються такими, якими були.

`sound.select.frames(startFrame, endFrame, options)` встановлює часовий діапазон у кадрах за зразковою частотою проекту. `options.trackIds` називає доріжки для вибору; коли він пропущений, залишаються вибраними доріжки, які вже були вибрані. Діапазон обмежується часовою шкалою, а крайки міняються місцями, якщо вони перевернуті.

`sound.select.tracks(options)` - це команда `SelectTracks` Audacity. Вона вибирає доріжки, індекс яких (рахується від 0) знаходиться в діапазоні від `options.track` (за замовчуванням 0) на `options.trackCount` доріжок (за замовчуванням 1). `options.mode` - це `'set'` для заміни вибору доріжок, `'add'` для розширення його, або `'remove'` для виключення цих доріжок з нього. Часовий діапазон залишається таким, яким був.

`sound.select.frequencies(options)` - це команда `SelectFrequencies` Audacity. Вона встановлює спектральний вибір до `options.low` і `options.high` в герцах; крайку, яку ви пропускаєте, зберігає своє поточне значення.

`sound.select.all()` вибирає весь проект на кожній доріжці.
`sound.select.none()` очищує вибір.

### `sound.effect(type, params)`

Застосовує один ефект до поточного вибору, на фокусній доріжці. `type` - це ідентифікатор ефекту з [Ефекти, які може застосувати програма](#effects-a-program-can-apply), а `params` - це об'єкт параметрів цього ефекту. Параметри, які ви пропускаєте, беруть значення за замовчуванням ефекту; значення перевіряються на відповідність діапазонам у [довіднику аудіо ефектів](/reference/generated/audio-effects/). Повертає `null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Застосовує ланцюг ефектів до поточного вибору за один прохід, точно так само, як макрос списку кроків з цими кроками. Кожен крок є `{ type, params }`, а ланцюг повинен містити принаймні один крок. Розв'язується до `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Виконує одну з команд макросів Audacity, перерахованих у розділі
[Команди, які може виконати програма](#commands-a-program-can-run). Чотири команди вибору приймають параметри, описані там; інші не приймають жодних. Повертає вибір після виконання.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Виконує список кроків макросу, збереженого в тому ж менеджері макросів, за точною назвою, включаючи будь-які команди вибору, які він містить. Зберіганий макрос не може бути програмою, тому програми не вкладені. Розв'язується до `null`; невідома назва відхиляється.

### Час і випадковість

Виконання відтворюване: два виконання того самого програмного коду над тим самим проектом читають однаково, оскільки годинник і випадкові числа не належать машині.

`Date.now()` та `new Date()` без аргументів повертають віртуальний годинник, який починається з 0 і просувається на один для кожного відповілого виклику редактора, і на `ms` для кожного `sound.wait(ms)`. `sound.wait` розв'язується негайно; немає способу для програми призупинитись у реальному часі, і він не потрібен, оскільки кожен виклик до редактора завершується до того, як його обіцянка розв'язується.

`Math.random()` та `sound.random()` є тим самим генератором, згенерованим від `sound.env.seed`. Зафіксуйте насіння, якщо вам потрібно знати, яку послідовність використовувало виконання.

### Перевірка ваших припущень

`sound.assert(condition, message)` кидає `message`, коли `condition` є хибним. `sound.assertEqual(actual, expected, message)` порівнює два значення як JSON і кидає, коли вони відрізняються, з повідомленням, що називає обидва значення, якщо ви не надали жодного. Оскільки помилка, кинута під час виконання, завершує виконання і відкочує все перед ним, невдале твердження залишає проект незмінним. Жоден із методів не повертає обіцянку.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Значення, що передаються редактору

Кожен аргумент, який програма передає, і кожне значення, яке вона отримує, є простими даними: 
`null`, булеві значення, скінченні числа, рядки та масиви та прості об'єкти
тих. `NaN`, `Infinity`, функції, екземпляри класів, типізовані масиви та `Date`
об'єкти відхиляються з помилкою, як і будь-яке значення, більше за 1 МБ, вкладене більш ніж на 12 рівнів, або що містить
bільше 4096 елементів у масиві чи об'єкті. `undefined` Властивості, що не використовуються, видаляються.

## Обмеження

| Обмеження | Значення |
| --- | --- |
| Довжина програми | 256 КБ |
| Виклики редактора за один запуск | 4096 |
| Зміни в проекті за один запуск (виклики вибору, ефекти, команди) | 256 |
| Виклики, що очікують відповіді одночасно | 8 |
| Час виконання | 120 секунд |
| Одне значення, що передається до або від редактора | 1 МБ, 12 рівнів глибини, 4096 елементів на масив або об'єкт |
| Журнал | 1000 рядків або 256 КБ; 4096 символів на рядок |
| Програми в бібліотеці | 128 |
| Назва програми | 256 символів |
| Файл імпортованої програми | 1 МБ |

Цикл, який вибирає кожен кліп і застосовує один ефект, витрачає два зміни на
kліп, тому він може охопити 128 кліпів, перш ніж бюджет вичерпається.

## Помилки

Якщо редактор відхиляє виклик, він відхиляє обіцянку з `Error`, чий `message`
пояснює причину: команда за межами словника, ефект над порожнім вибором,
параметр за межами діапазону. Помилка також несе `code`, який є
`MACRO_CALL_FAILED`, якщо редактор не надав більш конкретного. Програма
може зловити ці помилки і продовжити роботу:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Ця програма завершується, і її журнал містить *відхилено: Непідтримувана макро-команда:
ExportWav.*

Помилка, яку програма не обробляє, завершує виконання, відкочує проект і відображається у вікні з рядком, з якого вона виникла. Програма, яка не може бути скомпільована, повідомляється таким же чином до запуску.

## Ефекти, які може застосувати програма {#effects-a-program-can-apply}

Це ідентифікатори ефектів `sound.effect` та `sound.effects`, які приймають, з ключами параметрів та їхніми значеннями за замовчуванням. Діапазони та одиниці вимірювання наведені в [довіднику аудіо ефектів](/reference/generated/audio-effects/). Плагіни Nyquist не можуть бути застосовані з програми.

| Ефект | Ідентифікатор ефекту | Параметри та значення за замовчуванням |
| --- | --- | --- |
| Підсилення | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Автоматичне зниження гучності | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Бас і требл | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Біт-крушер | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Зміна висоти тону | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Зміна швидкості та висоти тону | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Зміна темпу | `audacity-change-tempo` | `tempoPercent: 0` |
| Класичні фільтри | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Видалення клацань | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Компресор | `compressor` | `threshold: -24`, `knee: 30`, `ratio: 4`, `attack: 0.003`, `release: 0.25`, `makeupGain: 0` |
| Компресор (Audacity) | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Затримка | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Дисторсія | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Ехо | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Затихання входу | `audacity-fade-in` | немає |
| Затихання виходу | `audacity-fade-out` | немає |
| Фільтр кривої EQ | `audacity-filter-curve-eq` | `points`: масив `{ frequency, gain }`, за замовчуванням дві плоскі точки при 20 Гц і 20 кГц; `linearFrequencyScale: false`; `filterLength: 8191` |
| Чотириполосний параметричний EQ | `eq` | `outputGain: 0`; `bands`: чотири `{ id, enabled, type, frequency, gain, q, slope }` об'єкти, що пікають при 100, 500, 2000 і 8000 Гц з `gain: 0`, `q: 1`, `slope: 12` |
| Шлюз | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Графічний EQ | `audacity-graphic-eq` | `gains`: 31 збільшення смуги в дБ, всі 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| Фільтр високих частот | `highpass` | `frequency: 80`, `q: 0.707` |
| Інверсія | `audacity-invert` | немає |
| Легасі компресор | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Лімітер | `limiter` | `ceiling: -1`, `lookahead: 0.005`, `release: 0.1` |
| Лімітер (Audacity) | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Нормалізація гучності | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Фільтр низьких частот | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Зменшення шуму | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Нормалізація | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Полустретч | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Фазер | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Видалення постійного зміщення | `audacity-remove-dc-offset` | немає |
| Ремонт | `audacity-repair` | немає |
| Повторення | `audacity-repeat` | `count: 1` |
| Реверберація | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Реверберація (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Зворотне відтворення | `audacity-reverse` | ні |
| Слайдінг Стретч | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Обрізання мовчання | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Утилітарний зиск (переглянуто) | `reviewed-utility-gain` | `gain: 1` |
| Вавах | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Дві ефекти потребують чогось, що програма не може надати. Зменшення шуму потребує профілю шуму, захопленого в діалоговому вікні ефекту, а Автоматична качка потребує контрольної доріжки нижче зосередженої. 

## Команди, які може виконати програма {#commands-a-program-can-run}

`sound.command` приймає команди макросів Audacity, перелічені нижче. Вони є тими самими іменами, що і в списку кроків макросу, тому програма та список кроків мають однаковий діапазон дій. Кожна команда запускає редакторську дію, яку описує [посібник з команд](/reference/generated/commands/).

### Команди вибору з параметрами

| Команда | Параметри |
| --- | --- |
| `SelectTime` | `start`, `end` в секундах; `relativeTo` як для `sound.select.time` |
| `SelectFrequencies` | `low`, `high` в герцах |
| `SelectTracks` | `track`, `trackCount` (0 до 100); `mode` з `'set'`, `'add'` або `'remove'` |
| `Select` | Будь-яка комбінація трьох наборів вище |

Параметр, який ви пропускаєте, залишає цю частину вибору без змін, що також стосується того, як Audacity їх читає.

### Команди без параметрів

| Група | Команди |
| --- | --- |
| Вибір | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Редагування | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Доріжки | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Мітки | `AddLabel` |
| Аналіз | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Що навмисно відсутнє

`Undo` та `Redo` відсутні, оскільки запуск вже є одним записом історії та кроком, який пройшов історію, вийде за межі запуску до власних редагувань. Команди транспортування та запису відсутні, оскільки програма не має нічого чекати і не може бути відкликана з запису. Відкриття, збереження, закриття, імпорт, експорт та налаштування відсутні, оскільки діапазон дій програми - це один проект, який був відкритий при її запуску. Команди, які відкривають лише діалогове вікно або змінюють вигляд, відсутні, оскільки вони не змінюють нічого в проекті.

## Спільне використання програм {#sharing-programs}

**Експорт програми** записує вибрану програму як файл `.soundscapemacro`, а **Імпорт програми** читає такий файл. Файл є JSON, а не простим файлом `.js`, тому нічого на комп'ютері-отримувачі не сплутає його з чимось, що має запускатися поза редактором:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

Імпортування зберігає лише текст. Імпортована програма не має кнопки **Запустити програму**; замість цього панель відображає програму, файл, з якого вона була імпортована, примітку про те, що програма може зробити з відкритим проектом, та галочку *Я прочитав цю програму і хочу запустити її*. Поставивши галочку, ви активуєте **Дозволити цю програму**, і лише після цього програма може бути запущена.

Ця дозволи стосується точного тексту, який ви прочитали. Якщо програма змінюється пізніше, незалежно від того, редагуєте ви її чи імпортуєте нову копію, перегляд знову з'являється, доки ви не дозволите новий текст. Програми, які ви пишете в менеджері самостійно, не потребують перегляду.

## Приклади

Зробіть згасання для кожного кліпу на першій доріжці, яка містить будь-який. Натисніть заголовок цієї доріжки перед запуском, щоб ефект застосувався до доріжки, яку читає програма:

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

Звіт про проект без його зміни:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Запустіть збережений макрос списку кроків лише тоді, коли виділення достатньо довге:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## Про цю сторінку

Кожна програма на цій сторінці, від однорядкових фрагментів коду до прикладів з поясненнями,
виконується для кожної збірки Soundscaper браузерним набором тестів (`tests/browser/handbook-macro-program-examples.spec.js`), який читає
програми з тексту цієї сторінки. Програма, яка припиняє виконання або перестає
виробляти те, що вказано на цій сторінці, блокує збірку до виправлення сторінки або редактора.
