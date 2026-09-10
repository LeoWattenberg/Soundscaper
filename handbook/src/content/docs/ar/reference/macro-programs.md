---
title: "برامج الماكرو"
description: "واجهة برمجة تطبيقات JavaScript التي يعمل ضدها برنامج الماكرو، والحدود التي يعمل ضمنها، والملف الذي يُنقل فيه."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","targetLocale":"ar"} -->

برنامج الماكرو هو ماكرو مكتوب بلغة JavaScript بدلاً من كونه قائمة خطوات.
يُنفَّذ داخل المحرر مقابل واجهة برمجة تطبيقات صغيرة تسمى `sound`, مما يتيح له قراءة
المشروع المفتوح، وتحريك التحديد، وتطبيق نفس التأثيرات والأوامر التي يمكن
لماكرو قائمة الخطوات تطبيقها. كل شيء آخر، من الملفات والشبكة إلى مشاريعك
الأخرى، خارج نطاق وصوله.

البرامج ميزة في Soundscaper. لا يحتوي Framescaper على مدير ماكرو.

## مكان وجود البرامج

اختر **أدوات → مدير الماكرو**. يعرض مربع الحوار ماكرو قائمة الخطوات، وتحت
**البرامج**، البرامج التي قمت بحفظها. ينشئ **برنامج جديد** برنامجًا، ويعرض
لوحة التفاصيل **اسم البرنامج**، ونص **البرنامج**، وزر **تشغيل
البرنامج**. يُحفظ النص أثناء الكتابة؛ لا توجد خطوة حفظ منفصلة.

يُخزَّن البرنامج مع إعدادات المحرر، وليس داخل مشروع، لذا فهو
متاح في كل مشروع تفتحه في هذا المحرر. استخدم **تصدير البرنامج** و
**استيراد البرنامج** لنقله إلى جهاز آخر أو شخص آخر؛ راجع
[مشاركة البرامج](#sharing-programs) لمعرفة ما ينطوي عليه ذلك.

يغطي دليل [تطبيق نفس سلسلة التأثيرات في كل مرة](/guides/effects/apply-the-same-effects-every-time/)
جانب قائمة الخطوات في نفس مربع الحوار.

## كتابة برنامج

البرنامج هو جسم دالة `async`، يُنفَّذ في الوضع الصارم. هذا يعني أنه يمكنك
`await` على المستوى العلوي، وإعلان المتغيرات والدوال، واستخدام كل
ميزة لغة عادية. كائن `sound` هو الوصلة الوحيدة للبرنامج مع
المحرر، ويعيد كل استدعاء عليه وعدًا (promise).

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

تضيف مفتاح Tab مسافتين في حقل البرنامج. اضغط Escape ثم Tab للخروج من الحقل.

### ما يمكن للبرنامج استخدامه

مكتبة JavaScript القياسية المعتادة متوفرة: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, المصفوفات المصنّفة، `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` و `queueMicrotask`. `console`
متوفر أيضًا، وكل ما يُكتب فيه يصل إلى سجل البرنامج.

### ما لا يمكن للبرنامج استخدامه

يعمل البرنامج في عامل (worker) تم تجريده من قدراته قبل تنفيذ السطر الأول. لا يوجد أي مما يلي داخل البرنامج: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` و `setInterval`. قراءة أي منها تعطي `undefined`.

لا يمكن للبرنامج `import` وحدة؛ `import` الثابت هو خطأ صياغة في
السطر الذي يحتويه. يجب أن يكون كل ما يحتاجه البرنامج داخل البرنامج نفسه.

حدود الأمان ليست المتغيرات العامة المفقودة بل المحرر نفسه: فهو
يجيب فقط على الاستدعاءات المدرجة في هذه الصفحة ويرفض كل ما عداها بالاسم،
مهما حاول البرنامج إرساله إليه.

## تشغيل البرنامج

اضغط **تشغيل البرنامج**. التشغيل بأكمله هو إدخال واحد في سجل المشروع، لذا
يعكس **تراجع** واحد كل ما قام به البرنامج، مهما كان عدد التغييرات التي أجراها.
إذا ألقى البرنامج استثناءً، أو أُلغي، أو تجاوز مهلة التنفيذ، يُعاد المشروع
إلى حالته تمامًا كما كانت قبل بدء التشغيل.

**إلغاء التشغيل** يوقف البرنامج فورًا. البرنامج الذي كان يعمل لمدة دقيقتين
يُوقف بالطريقة نفسها، مع رسالة *استغرق تشغيل الماكرو أكثر من
120 ثانية.*

بعد التشغيل، يعرض اللوح سجل البرنامج، متبوعًا بـ *تم تطبيق البرنامج.*
عند اكتمال التشغيل. يعرض التشغيل الفاشل *فشل البرنامج في السطر N:* و
رسالة الخطأ، حيث رقم السطر هو سطر برنامجك الذي ألقى الاستثناء.

### أي صوت يلمسه التأثير

التأثير المطبق بواسطة البرنامج يعمل على تحديد الوقت الحالي في المسار
التركيز، وهو المسار الذي نقرت على ترويسته آخر مرة أو حددت مقطعك فيه آخر مرة. عندما لا يكون هناك تحديد للوقت لكن يوجد مقطع محدد، يغطي التأثير ذلك المقطع. تغييرات تحديد البرنامج تغيّر نطاق الوقت ومجموعة المسارات المحددة، لكن ليس المسار الذي يملك التركيز، لذا يعالج تشغيل واحد مسارًا واحدًا. إذا لم يكن أي شيء في وضع التركيز أو كان التحديد فارغًا، يفشل التشغيل مع نفس الرسالة التي يعطيها قائمة التأثيرات.

## واجهة `sound` API

يعيد كل طريقة أدناه وعدًا (promise) ما لم يُذكر خلاف ذلك. انتظر كل استدعاء
قبل إجراء التالي؛ البرنامج الذي يبدأ أكثر من ثمانية استدعاءات دون انتظارها يُرفض التاسع.

### `sound.env`

كائن عادي يصف التشغيل.

| الحقل | المعنى |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | لغة واجهة المحرر، مثل `"en"` أو `"de"`. |
| `seed` | البذرة التي تأتي منها الأرقام العشوائية للتشغيل. جديدة لكل تشغيل. |
| `startedAt` | الوقت الفعلي الذي بدأ فيه التشغيل، كسلسلة ISO 8601. |
| `dryRun` | دائمًا `false` حاليًا. محجوز. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` و `sound.log.debug(...values)` تكتب سطرًا واحدًا
لكل منها في سجل التشغيل. `console.log`, `console.info`, `console.warn`,
`console.error` و `console.debug` تفعل الشيء نفسه. القيم التي ليست نصوصًا تُكتب
كـ JSON. هذه الطرق لا تعيد شيئًا ولا تحتاج إلى الانتظار.

يحتوي السجل على ما يصل إلى 1,000 سطر أو 256 KiB، أيهما يأتي أولاً، ويُقطع كل سطر
عند 4,096 حرفًا. الأسطر التي تتجاوز ذلك تُسقط وتُحسب؛ يُبلّغ عن العدد كتحذير نهائي.

### `sound.project`

قراءة المشروع لا تغيّره أبدًا ولا تُحتسب ضمن ميزانية التغييرات للتشغيل.

`sound.project.snapshot()` يعيد `{ sampleRate, tracks, selection }`, مع
`tracks` و `selection` كما تعيدهما الاستدعاءان أدناه. `sampleRate` هو
معدل أخذ العينات للمشروع بالهرتز، وهو ما تُقاس به كل عدد الإطارات في هذه الصفحة.

`sound.project.tracks()` يعيد مصفوفة من المسارات بترتيب الخط الزمني:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` يعيد المقاطع على مسار واحد، أو على كل المسارات
عند إغفال `trackId`:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` يعيد التحديد الحالي:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

يُحتسب كل استدعاء تحديد كتغيير واحد ويعيد التحديد الذي أنتجه،
بشكل `sound.project.selection()` يعيده.

يضبط `sound.select.time(start, end, options)` النطاق الزمني بالثواني. إنه
أمر `SelectTime` في Audacity، ويحدد `options.relativeTo` المكان الذي يُقاس منه كل
حافة. يمكن أن تكون كلتا الحافتين منخفضة حتى -100 ثانية.

| `relativeTo` | حافة البداية | حافة النهاية |
| --- | --- | --- |
| `'project-start'` (الافتراضي) | `start` ثانية من بداية المشروع | `end` ثانية من بداية المشروع |
| `'project'` | `start` ثانية من بداية المشروع | `end` ثانية بعد نهاية المشروع |
| `'project-end'` | `start` ثانية قبل نهاية المشروع | `end` ثانية قبل نهاية المشروع |
| `'selection-start'` | `start` ثانية بعد بداية التحديد | `end` ثانية بعد بداية التحديد |
| `'selection'` | `start` ثانية بعد بداية التحديد | `end` ثانية بعد نهاية التحديد |
| `'selection-end'` | `start` ثانية قبل نهاية التحديد | `end` ثانية قبل نهاية التحديد |

نهاية المشروع هي آخر إطار تصل إليه أي لقطة. تُترك المسارات المحددة
كما هي.

يضبط `sound.select.frames(startFrame, endFrame, options)` النطاق الزمني في
إطارات بمعدل عينات المشروع. يسمّي `options.trackIds` المسارات التي
يجب تحديدها؛ عند حذفه، تبقى المسارات المحددة بالفعل محددة.
يُقيَّد النطاق بخط الزمن وتُبدَل الحواف إذا كانت معكوسة.

`sound.select.tracks(options)` هو أمر `SelectTracks` في Audacity. يحدد
المسارات التي يقع فهرسها (المعدود من 0) في النطاق من `options.track`
(الافتراضي 0) ويمتد عبر `options.trackCount` مسارات (الافتراضي 1). `options.mode` هو
`'set'` لاستبدال تحديد المسارات، أو `'add'` لتوسيعه، أو `'remove'` لـ
إخراج تلك المسارات منه. يُترك النطاق الزمني كما هو.

`sound.select.frequencies(options)` هو أمر `SelectFrequencies` في Audacity.
يضبط التحديد الطيفي إلى `options.low` و `options.high` بالهرتز؛
الحافة التي تحذفها تحتفظ بقيمتها الحالية.

يحدد `sound.select.all()` المشروع بأكمله على كل مسار.
يمسح `sound.select.none()` التحديد.

### `sound.effect(type, params)`

يطبّق تأثيرًا واحدًا على التحديد الحالي، على المسار المركّز عليه. `type` هو
معرّف تأثير من [التأثيرات التي يمكن لبرنامج تطبيقها](#effects-a-program-can-apply),
و `params` هو كائن من معاملات ذلك التأثير. المعاملات التي تحذفها تتخذ
قيم الافتراضي للتأثير؛ تُفحص القيم مقابل النطاقات في
[مرجع تأثيرات الصوت](/reference/generated/audio-effects/). يحل إلى
`null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

يطبّق سلسلة من التأثيرات على التحديد الحالي في مرّة واحدة، تمامًا كما تفعل
ماكرو قائمة الخطوات التي تحتوي على تلك الخطوات. كل خطوة هي `{ type, params }`،
وتحتاج السلسلة إلى خطوة واحدة على الأقل. تُحل إلى `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

ينفّذ أحد أوامر ماكرو Audacity المدرجة تحت
[الأوامر التي يمكن لبرنامج تشغيلها](#commands-a-program-can-run). تأخذ أوامر التحديد الأربعة المعاملات الموصوفة هناك؛ بينما لا تأخذ الأوامر الأخرى أي معاملات. يحل إلى التحديد بعد ذلك.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

ينفّذ ماكرو قائمة خطوات محفوظًا في نفس مدير الماكرو، باسمه الدقيق،
بما في ذلك أي أوامر تحديد يحتويها. لا يمكن أن يكون الماكرو المحفوظ برنامجًا بحد ذاته،
لذلك لا تتداخل البرامج. يُحل إلى `null`؛ وتُرفض الأسماء غير المعروفة.

### الوقت والعشوائية

التشغيل قابل للتكرار: تشغيلان للبرنامج نفسه على نفس المشروع يقرآن
نفس الشيء، لأن الساعة والأرقام العشوائية ليستا خاصتين بالجهاز.

`Date.now()` و `new Date()` بدون حُجج يعيدان ساعة افتراضية تبدأ
عند 0 وتتقدم بمقدار واحد لكل استدعاء مُجاب للمحرر، وبـ
`ms` لكل `sound.wait(ms)`. `sound.wait` يُحل فورًا؛ لا يوجد
طريقة للبرنامج للإيقاف المؤقت للوقت الحقيقي، ولا حاجة لذلك، لأن كل استدعاء
للمحرر يكتمل قبل حل وعودته.

`Math.random()` و `sound.random()` هما المولّد نفسه، مُبذّر من
`sound.env.seed`. سجّل البذرة إذا كنت بحاجة لمعرفة أي تسلسل استخدمه التشغيل.

### التحقق من افتراضاتك

`sound.assert(condition, message)` يرمي `message` عندما يكون `condition` كاذبًا.
`sound.assertEqual(actual, expected, message)` يقارن القيمتين كـ JSON
ويرمي استثناءً عندما تختلفان، مع رسالة تسمي القيمتين إذا لم تقدم
واحدة. نظرًا لأن الخطأ المُرمي ينهي التشغيل ويعيد التراجع عن كل ما قبله،
يترك فشل الادعاء المشروع دون تغيير. لا يعيد أي من الطريقتين وعدًا.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## القيم التي تعبر إلى المحرر

كل حجة تمررها البرنامج وكل قيمة يستقبلها هي بيانات عادية:
`null`، القيم المنطقية، الأعداد المحدودة، النصوص، والمصفوفات والكائنات العادية المكونة من
هذه. `NaN`، `Infinity`، الدوال، أمثلة الفئات، المصفوفات المصنفة و`Date`
الكائنات مرفوضة مع خطأ، وكذلك أي قيمة أكبر من 1 ميغابايت، أو متداخلة بأكثر من 12 مستوى، أو تحتوي على أكثر من 4,096 مدخلاً في مصفوفة أو كائن واحد.
تُحذف خصائص `undefined`.

## الحدود

| الحد | القيمة |
| --- | --- |
| طول البرنامج | 256 كيلوبايت |
| استدعاءات المحرر لكل تشغيل | 4,096 |
| التغييرات على المشروع لكل تشغيل (استدعاءات التحديد، التأثيرات، الأوامر) | 256 |
| استدعاءات تنتظر إجابة في نفس الوقت | 8 |
| وقت التشغيل | 120 ثانية |
| قيمة واحدة تعبر إلى المحرر أو منه | 1 ميغابايت، 12 مستوى عمقاً، 4,096 مدخلاً لكل مصفوفة أو كائن |
| السجل | 1,000 سطر أو 256 كيلوبايت؛ 4,096 حرفاً لكل سطر |
| البرامج في المكتبة | 128 |
| اسم البرنامج | 256 حرفاً |
| ملف البرنامج المستورد | 1 ميغابايت |

حلقة تختار كل مقطع وتطبق تأثيراً واحداً تستهلك تغييرين لكل
مقطع، لذا يمكنها تغطية 128 مقطعاً قبل نفاد الميزانية.

## الأخطاء

استدعاء يرفضه المحرر يرفض وعودته مع `Error` حيث يقول `message`
السبب: أمر خارج نطاق المفردات، تأثير على تحديد فارغ،
معامل خارج النطاق. يحمل الخطأ أيضاً `code`، وهو
`MACRO_CALL_FAILED` ما لم يوفر المحرر واحداً أكثر تحديداً. يمكن للبرنامج
التقاط هذه الأخطاء والمضي قدماً:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

تُكتمل تلك البرنامج، ويقرأ سجله *مرفوض: أمر ماكرو غير مدعوم:
ExportWav.*

تُنهي الخطأ الذي لا يلتقطه البرنامج التشغيل، وتعيد المشروع إلى الوراء، وتُعرض في اللوحة مع السطر الذي جاء منه. يُبلَّغ عن برنامج لا يمكن تجميعه بنفس الطريقة قبل أي تشغيل.

## التأثيرات التي يمكن للبرنامج تطبيقها {#effects-a-program-can-apply}

هذه هي معرّفات التأثيرات التي تقبلها `sound.effect` و`sound.effects`، مع مفاتيح المعاملات التي يقبلها كل منها وقيمها الافتراضية. النطاقات والوحدات موجودة في
[مرجع تأثيرات الصوت](/reference/generated/audio-effects/). لا يمكن تطبيق إضافات Nyquist من برنامج.

| التأثير | معرّف التأثير | المعاملات والقيم الافتراضية |
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
| Fade In | `audacity-fade-in` | لا شيء |
| Fade Out | `audacity-fade-out` | لا شيء |
| Filter Curve EQ | `audacity-filter-curve-eq` | `points`: مصفوفة من `{ frequency, gain }`, افتراضيًا نقطتان مسطحتان عند 20 هرتز و20 كيلو هرتز؛ `linearFrequencyScale: false`؛ `filterLength: 8191` |
| Four-band parametric EQ | `eq` | `outputGain: 0`؛ `bands`: أربعة كائنات `{ id, enabled, type, frequency, gain, q, slope }`، تبلغ ذروتها عند 100 و500 و2000 و8000 هرتز مع `gain: 0`, `q: 1`, `slope: 12` |
| Gate | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Graphic EQ | `audacity-graphic-eq` | `gains`: مكاسب 31 نطاقًا بالديسيبل، جميعها 0؛ `interpolation: 'bspline'`؛ `filterLength: 8191` |
| High-pass filter | `highpass` | `frequency: 80`, `q: 0.707` |
| Invert | `audacity-invert` | لا شيء |
| Legacy Compressor | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limiter | `limiter` | `ceiling: -1`, `lookahead: 0.005`, `release: 0.1` |
| Limiter (Audacity) | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Loudness Normalization | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Low-pass filter | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Noise Reduction | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalize | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Remove DC Offset | `audacity-remove-dc-offset` | لا شيء |
| Repair | `audacity-repair` | لا شيء |
| Repeat | `audacity-repeat` | `count: 1` |
| Reverb | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| الصدى (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| عكس | `audacity-reverse` | لا شيء |
| التمدد المنزلق | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| تقصير الصمت | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| كسب المرافق (مُراجَع) | `reviewed-utility-gain` | `gain: 1` |
| واهواه | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

تحتاج تأثيران إلى شيء لا يمكن لبرنامج توفيره. يحتاج تقليل الضوضاء إلى ملف ضوضاء يُلتقط في مربع حوار التأثير نفسه، ويحتاج الخفض التلقائي إلى مسار تحكم أسفل المسار المركّز عليه.

## الأوامر التي يمكن لبرنامج تشغيلها {#commands-a-program-can-run}

يقبل `sound.command` أسماء أوامر ماكرو Audacity أدناه. وهي نفس الأسماء التي يمكن لقائمة خطوات ماكرو الاحتفاظ بها، لذا فإن لبرنامج وقائمة خطوات نفس النطاق تمامًا. يشغّل كل أمر إجراء المحرر الذي يصفه [مرجع الأوامر](/reference/generated/commands/).

### أوامر التحديد مع المعاملات

| الأمر | المعاملات |
| --- | --- |
| `SelectTime` | `start`, `end` بالثواني؛ `relativeTo` كما في `sound.select.time` |
| `SelectFrequencies` | `low`, `high` بالهرتز |
| `SelectTracks` | `track`, `trackCount` (من 0 إلى 100)؛ `mode` من `'set'`, `'add'` أو `'remove'` |
| `Select` | أي مجموعة من المجموعات الثلاث أعلاه |

المعامل الذي تتركه فارغًا يترك ذلك الجزء من التحديد كما هو، وهذا هو ما يقرؤه Audacity أيضًا.

### أوامر بدون معاملات

| المجموعة | الأوامر |
| --- | --- |
| التحديد | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| التحرير | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| المسارات | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| التسميات | `AddLabel` |
| التحليل | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### ما هو مفقود عمدًا

`Undo` و `Redo` غير موجودين لأن التشغيل هو بالفعل إدخال واحد في السجل، والخطوة التي تتنقل في السجل ستصل إلى ما بعد التشغيل إلى تعديلاتك الخاصة. أوامر النقل والتسجيل غير موجودة لأن البرنامج ليس لديه ما ينتظره ولا يمكن التراجع عنه من التسجيل. فتح، حفظ، إغلاق، استيراد، تصدير والتفضيلات غير موجودة لأن نطاق البرنامج هو المشروع الواحد الذي كان مفتوحًا عند بدء التشغيل. الأوامر التي تفتح فقط مربع حوار أو تغيّر العرض غير موجودة لأنها لا تغيّر شيئًا في المشروع.

## مشاركة البرامج {#sharing-programs}

**تصدير البرنامج** يكتب البرنامج المحدد كملف `.soundscapemacro`، و**استيراد البرنامج** يقرأ ملفًا واحدًا. الملف هو JSON وليس ملف `.js` عاريًا، لذا لن يخطئ أي شيء على الحاسوب المستلم في اعتباره شيئًا يُنفَّذ خارج المحرر:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

يقوم الاستيراد بتخزين النص ولا شيء آخر. لا يحتوي البرنامج المستورد على زر **تشغيل
البرنامج**؛ بدلاً من ذلك، يعرض اللوح البرنامج، والملف الذي جاء منه، وملاحظة حول ما يمكن للبرنامج فعله للمشروع المفتوح، بالإضافة إلى مربع اختيار ينص على *لقد قرأت هذا البرنامج وأرغب في تشغيله.* يؤدي تحديد هذا المربع إلى تفعيل **تفعيل هذا
البرنامج**، وحينها فقط يمكن تشغيل البرنامج.

تلك الإذن مخصصة للنص الدقيق الذي قرأته. إذا تغيّر البرنامج بعد ذلك، سواء قمت بتعديله أو استوردت نسخة أحدث فوقه، فسيظهر المراجعة مرة أخرى حتى تقوم بتفعيل النص الجديد. البرامج التي تكتبها بنفسك في المدير لا تحتاج إلى مراجعة.

## أمثلة

تلاشي كل مقطع في المسار الأول الذي يحتوي على مقاطع. انقر على رأس ذلك المسار
قبل التشغيل، حتى يقع التأثير على المسار الذي يقرأه البرنامج:

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

أبلغ عن المشروع دون تغييره:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

تشغيل ماكرو قائمة الخطوات المحفوظة فقط عندما يكون التحديد طويلًا بما يكفي:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## حول هذه الصفحة

يتم تشغيل كل برنامج على هذه الصفحة، بدءًا من المقاطع السطر الواحد وصولاً إلى الأمثلة العملية،
ضد كل إصدار من Soundscaper بواسطة مجموعة المتصفح
(`tests/browser/handbook-macro-program-examples.spec.js`)، التي تقرأ
البرامج من نص هذه الصفحة نفسه. أي برنامج يتوقف عن الإكمال، أو يتوقف عن
إنتاج ما تقوله هذه الصفحة إنه ينتجه، يُفشل الإصدار حتى يتم تصحيح الصفحة أو
المحرر.
