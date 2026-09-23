---
title: "برنامه‌های ماکرو"
description: "رابط JavaScript برنامهٔ ماکرو، محدودیت‌های اجرا و فایلی که برای انتقال به‌کار می‌رود."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"fa"} -->

برنامهٔ ماکرو، ماکرویی است که به‌جای فهرستی از گام‌ها با JavaScript نوشته می‌شود. این برنامه در ویرایشگر و با API کوچکی به نام `sound` اجرا می‌شود؛ API می‌تواند پروژهٔ باز را بخواند، انتخاب را جابه‌جا کند و همان افکت‌ها و فرمان‌هایی را اجرا کند که ماکروی فهرست‌گام اجرا می‌کند. به هر چیز دیگری، از فایل‌ها و شبکه گرفته تا پروژه‌های دیگر، دسترسی ندارد.

برنامه‌ها از ویژگی‌های Soundscaper هستند. Framescaper مدیر ماکرو ندارد.

## محل نگهداری برنامه‌ها

گزینهٔ **Tools → Macro manager** را انتخاب کنید. پنجره ماکروهای فهرست‌گام و در بخش **برنامه‌ها** برنامه‌های ذخیره‌شده را نشان می‌دهد. برای ساخت برنامه، در سربرگ Programs دکمهٔ **+ (برنامهٔ جدید)** را بزنید. نوار کنش همان‌جا برای برنامهٔ انتخاب‌شده گزینه‌های **وارد کردن برنامه**، **خروجی گرفتن از برنامه** و **حذف برنامه** را دارد. پنل جزئیات **نام برنامه**، متن **برنامه** و دکمهٔ **اجرای برنامه** را نشان می‌دهد. متن هنگام تایپ ذخیره می‌شود و نیازی به ذخیرهٔ جداگانه نیست.

برنامه همراه تنظیمات ویرایشگر ذخیره می‌شود، نه درون پروژه؛ بنابراین در هر پروژه‌ای که با این ویرایشگر باز کنید در دسترس است. برای انتقال برنامه به رایانه‌ای دیگر یا شخصی دیگر از **خروجی گرفتن از برنامه** و **وارد کردن برنامه** استفاده کنید؛ جزئیات را در بخش [اشتراک‌گذاری برنامه‌ها](#sharing-programs) ببینید.

راهنمای [اعمال هر بارِ همان زنجیرهٔ افکت‌ها](/guides/effects/apply-the-same-effects-every-time/) بخش فهرست‌گام همین پنجره را توضیح می‌دهد.

## نوشتن برنامه

برنامه، بدنهٔ تابع `async` است که در حالت strict اجرا می‌شود. یعنی می‌توانید در سطح بالایی از `await` استفاده کنید، متغیرها و توابع تعریف کنید و از همهٔ ویژگی‌های معمول زبان بهره ببرید. شیء `sound` تنها راه ارتباط برنامه با ویرایشگر است و هر فراخوانی آن یک promise برمی‌گرداند.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

کلید Tab در فیلد برنامه دو فاصله درج می‌کند. برای خروج از فیلد Escape و سپس Tab را بزنید.

### مواردی که برنامه می‌تواند استفاده کند

کتابخانهٔ استاندارد معمول JavaScript در دسترس است: `Object`، `Array`، `Map`، `Set`، `Math`، `JSON`، `RegExp`، `Promise`، آرایه‌های نوع‌دار، `Intl`، `TextEncoder`، `TextDecoder`، `structuredClone` و `queueMicrotask`. `console` نیز در دسترس است و هرچه در آن بنویسید در گزارش برنامه ثبت می‌شود.

### مواردی که برنامه نمی‌تواند استفاده کند

برنامه در workerای اجرا می‌شود که پیش از اجرای نخستین خط، قابلیت‌هایش از آن گرفته شده است. هیچ‌یک از موارد زیر در برنامه وجود ندارند: `fetch`، `XMLHttpRequest`، `WebSocket`، `indexedDB`، `caches`، `crypto`، `navigator`، `location`، `Worker`، `WebAssembly`، `SharedArrayBuffer`، `Atomics`، `eval`، `setTimeout` و `setInterval`. خواندن هرکدام مقدار `undefined` می‌دهد.

برنامه نمی‌تواند ماژولی را `import` کند؛ یک `import` ایستا در همان خط خطای نحوی ایجاد می‌کند. هرچه برنامه نیاز دارد باید درون خود برنامه باشد.

مرز امنیتی در متغیرهای سراسریِ حذف‌شده نیست، بلکه خود ویرایشگر آن را اعمال می‌کند: ویرایشگر فقط به فراخوانی‌های فهرست‌شده در این صفحه پاسخ می‌دهد و هر چیز دیگری را، با هر نامی که برنامه بفرستد، رد می‌کند.

## اجرای برنامه

**اجرای برنامه** را بزنید. کل اجرا یک مدخل در تاریخچهٔ پروژه است؛ بنابراین یک **Undo** همهٔ کارهای برنامه را برمی‌گرداند، هرچند تغییرهای زیادی انجام داده باشد. اگر برنامه خطا بدهد، لغو شود یا از مهلت اجرا بگذرد، پروژه دقیقاً به وضعیت پیش از آغاز اجرا بازمی‌گردد.

**لغو اجرا** برنامه را فوراً متوقف می‌کند. برنامه‌ای که دو دقیقه در حال اجرا بوده نیز به همین شکل و با پیام *The macro ran for longer than 120 seconds.* متوقف می‌شود.

پس از اجرا پنل گزارش برنامه را نشان می‌دهد و اگر اجرا کامل شده باشد در پایان *Program applied.* می‌آید. اجرای ناموفق پیام *The program failed on line N:* و سپس متن خطا را نشان می‌دهد؛ شمارهٔ خط به خط برنامه‌ای اشاره می‌کند که خطا داده است.

### کدام صدا را افکت پردازش می‌کند

افکتی که برنامه اعمال می‌کند روی انتخاب زمانی فعلی در ترک متمرکز اجرا می‌شود؛ یعنی ترکی که آخرین بار سربرگش را کلیک کرده‌اید یا کلیپش را انتخاب کرده‌اید. اگر انتخاب زمانی وجود نداشته باشد اما کلیپی انتخاب شده باشد، افکت همان کلیپ را پردازش می‌کند. فراخوانی‌های انتخاب در برنامه بازهٔ زمانی و مجموعهٔ ترک‌های انتخاب‌شده را تغییر می‌دهند، اما ترک متمرکز را عوض نمی‌کنند؛ بنابراین هر اجرا یک ترک را پردازش می‌کند. اگر هیچ ترکی متمرکز نباشد یا انتخاب خالی باشد، اجرا با همان پیامی که منوی Effect می‌دهد ناموفق می‌شود.

## APIِ `sound`

هر روشی در ادامه promise برمی‌گرداند، مگر آنکه خلافش گفته شده باشد. پیش از فراخوانی بعدی، نتیجهٔ هر فراخوانی را await کنید؛ اگر برنامه بیش از هشت فراخوانی را بدون await آغاز کند، فراخوانی نهم رد می‌شود.

### `sound.env`

شیء ساده‌ای که اجرا را توصیف می‌کند.

| فیلد | معنا |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | زبان رابط ویرایشگر، مانند `"en"` یا `"de"`. |
| `seed` | مقداری که اعداد تصادفی اجرا از آن آغاز می‌شوند؛ در هر اجرا تازه است. |
| `startedAt` | زمان واقعی آغاز اجرا، به‌شکل رشتهٔ ISO 8601. |
| `dryRun` | اکنون همیشه `false` است. برای استفادهٔ آینده رزرو شده است. |

### `sound.log`

`sound.log.info(...values)`، `sound.log.warn(...values)`، `sound.log.error(...values)` و `sound.log.debug(...values)` هرکدام یک خط در گزارش اجرا می‌نویسند. `console.log`، `console.info`، `console.warn`، `console.error` و `console.debug` نیز همین کار را می‌کنند. مقدارهای غیررشته‌ای به‌شکل JSON نوشته می‌شوند. این روش‌ها مقداری برنمی‌گردانند و نیازی به await ندارند.

گزارش حداکثر ۱۰۰۰ خط یا ۲۵۶ KiB را نگه می‌دارد، هرکدام زودتر برسد؛ هر خط نیز پس از ۴۰۹۶ نویسه کوتاه می‌شود. خط‌های اضافی حذف و شمارش می‌شوند و تعدادشان در هشدار پایانی گزارش می‌شود.

### `sound.project`

خواندن پروژه آن را تغییر نمی‌دهد و از بودجهٔ تغییرهای اجرا کم نمی‌کند.

`sound.project.snapshot()` مقدار `{ sampleRate, tracks, selection }` را برمی‌گرداند؛ `tracks` و `selection` همان خروجی دو فراخوانی زیر هستند. `sampleRate` نرخ نمونه‌برداری پروژه بر حسب هرتز است و همهٔ شمارش فریم‌های این صفحه با آن سنجیده می‌شوند.

`sound.project.tracks()` آرایه‌ای از ترک‌ها را به‌ترتیب خط زمانی برمی‌گرداند:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` کلیپ‌های یک ترک را برمی‌گرداند؛ اگر `trackId` حذف شود، کلیپ‌های همهٔ ترک‌ها را برمی‌گرداند:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` انتخاب فعلی را برمی‌گرداند:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

هر فراخوانی انتخاب یک تغییر به‌شمار می‌آید و انتخابی را که ایجاد کرده، با همان ساختاری که `sound.project.selection()` برمی‌گرداند، تحویل می‌دهد.

`sound.select.time(start, end, options)` بازهٔ زمانی را بر حسب ثانیه تعیین می‌کند. این همان فرمان `SelectTime` در Audacity است و `options.relativeTo` مشخص می‌کند هر لبه از کجا اندازه‌گیری شود. هر دو لبه می‌توانند تا ‎-100 ثانیه پایین بروند.

| `relativeTo` | Start edge | End edge |
| --- | --- | --- |
| `'project-start'` (پیش‌فرض) | `start` ثانیه پس از آغاز پروژه | `end` ثانیه پس از آغاز پروژه |
| `'project'` | `start` ثانیه پس از آغاز پروژه | `end` ثانیه پس از پایان پروژه |
| `'project-end'` | `start` ثانیه پیش از پایان پروژه | `end` ثانیه پیش از پایان پروژه |
| `'selection-start'` | `start` ثانیه پس از آغاز انتخاب | `end` ثانیه پس از آغاز انتخاب |
| `'selection'` | `start` ثانیه پس از آغاز انتخاب | `end` ثانیه پس از پایان انتخاب |
| `'selection-end'` | `start` ثانیه پیش از پایان انتخاب | `end` ثانیه پیش از پایان انتخاب |

پایان پروژه آخرین فریمی است که هر کلیپی به آن می‌رسد. ترک‌های انتخاب‌شده بدون تغییر می‌مانند.

`sound.select.frames(startFrame, endFrame, options)` بازهٔ زمانی را بر حسب فریم و با نرخ نمونه‌برداری پروژه تعیین می‌کند. `options.trackIds` شناسهٔ ترک‌هایی را می‌دهد که باید انتخاب شوند؛ اگر حذف شود، ترک‌های ازپیش‌انتخاب‌شده همچنان انتخاب می‌مانند. بازه به خط زمانی محدود می‌شود و اگر لبه‌ها وارونه باشند جایشان عوض می‌شود.

`sound.select.tracks(options)` همان فرمان `SelectTracks` در Audacity است. ترک‌هایی را انتخاب می‌کند که شمارهٔ اندیسشان (با شمارش از ۰) در بازه‌ای باشد که از `options.track` (پیش‌فرض ۰) آغاز می‌شود و `options.trackCount` ترک (پیش‌فرض ۱) را دربرمی‌گیرد. مقدار `options.mode` می‌تواند `'set'` برای جایگزینی انتخاب ترک‌ها، `'add'` برای گسترش آن یا `'remove'` برای حذف آن ترک‌ها از انتخاب باشد. بازهٔ زمانی بدون تغییر می‌ماند.

`sound.select.frequencies(options)` همان فرمان `SelectFrequencies` در Audacity است. انتخاب طیفی را با `options.low` و `options.high` بر حسب هرتز تعیین می‌کند؛ لبه‌ای را که وارد نکنید، مقدار فعلی‌اش را حفظ می‌کند.

`sound.select.all()` کل پروژه را در همهٔ ترک‌ها انتخاب می‌کند. `sound.select.none()` انتخاب را پاک می‌کند.

### `sound.effect(type, params)`

یک افکت را روی انتخاب فعلی در ترک متمرکز اعمال می‌کند. `type` شناسهٔ افکتی از [افکت‌هایی که برنامه می‌تواند اعمال کند](#effects-a-program-can-apply) است و `params` شیئی از پارامترهای همان افکت است. پارامترهایی که حذف کنید مقدار پیش‌فرض افکت را می‌گیرند؛ مقدارها با بازه‌های [مرجع افکت‌های صوتی](/reference/generated/audio-effects/) سنجیده می‌شوند. خروجی `null` است.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

زنجیره‌ای از افکت‌ها را در یک گذر روی انتخاب فعلی اعمال می‌کند، دقیقاً همان‌طور که ماکروی فهرست‌گام با همان گام‌ها انجام می‌دهد. هر گام `{ type, params }` است و زنجیره باید دست‌کم یک گام داشته باشد. خروجی `null` است.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

یکی از فرمان‌های ماکروی Audacity را که در بخش [فرمان‌هایی که برنامه می‌تواند اجرا کند](#commands-a-program-can-run) آمده اجرا می‌کند. چهار فرمان انتخاب پارامترهای شرح‌داده‌شده در آن بخش را می‌گیرند؛ بقیه پارامتری ندارند. انتخاب پس از اجرا برگردانده می‌شود.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

ماکروی فهرست‌گامی را که در همان مدیر ماکرو ذخیره شده، با نام دقیقش اجرا می‌کند و فرمان‌های انتخاب موجود در آن را نیز اجرا می‌کند. ماکروی ذخیره‌شده نمی‌تواند خودش برنامه باشد، پس برنامه‌ها تو‌در‌تو نمی‌شوند. خروجی `null` است؛ نام ناشناخته باعث ردشدن فراخوانی می‌شود.

### زمان و تصادفی‌بودن

اجرا بازتولیدپذیر است: اجرای یک برنامه روی همان پروژه دو بار نتیجهٔ یکسانی می‌خواند، زیرا ساعت و اعداد تصادفی متعلق به ماشین نیستند.

`Date.now()` و `new Date()` بدون آرگومان، ساعتی مجازی را برمی‌گردانند که از ۰ آغاز می‌شود و با هر فراخوانی پاسخ‌داده‌شده به ویرایشگر یک واحد و با `ms` در هر فراخوانی `sound.wait(ms)` جلو می‌رود. `sound.wait` فوراً resolve می‌شود؛ برنامه نمی‌تواند در زمان واقعی مکث کند و نیازی هم نیست، زیرا هر فراخوانی ویرایشگر پیش از resolve شدن promise آن کامل می‌شود.

`Math.random()` و `sound.random()` از یک مولد استفاده می‌کنند که seed آن از `sound.env.seed` می‌آید. اگر لازم است بدانید اجرا از کدام دنباله استفاده کرده، seed را در گزارش بنویسید.

### بررسی فرض‌ها

فراخوانی `sound.assert(condition, message)` مقدار `message` را پرتاب می‌کند، اگر `condition` نادرست باشد. `sound.assertEqual(actual, expected, message)` دو مقدار را به‌صورت JSON مقایسه می‌کند و اگر متفاوت باشند خطا می‌دهد؛ اگر پیامی ندهید، پیام خطا هر دو مقدار را نام می‌برد. چون خطای پرتاب‌شده اجرا را پایان می‌دهد و همه‌چیز را به قبل برمی‌گرداند، assertion ناموفق پروژه را دست‌نخورده می‌گذارد. هیچ‌یک از این دو روش promise برنمی‌گرداند.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## مقدارهایی که به ویرایشگر فرستاده و از آن دریافت می‌شوند

هر آرگومانی که برنامه می‌فرستد و هر مقداری که دریافت می‌کند باید دادهٔ ساده باشد: `null`، مقدار بولی، عدد متناهی، رشته، و آرایه‌ها و اشیای ساده‌ای از این‌ها. `NaN`، `Infinity`، تابع‌ها، نمونه‌های کلاس، آرایه‌های نوع‌دار و اشیای `Date` با خطا رد می‌شوند؛ همین‌طور هر مقداری که بزرگ‌تر از ۱ MiB باشد، بیش از ۱۲ سطح تو‌در‌تو شود یا در یک آرایه یا شیء بیش از ۴۰۹۶ مدخل داشته باشد. ویژگی‌های `undefined` حذف می‌شوند.

## محدودیت‌ها

| محدودیت | مقدار |
| --- | --- |
| طول برنامه | 256 KiB |
| تعداد فراخوانی ویرایشگر در هر اجرا | 4,096 |
| تغییرهای پروژه در هر اجرا (فراخوانی‌های انتخاب، افکت‌ها، فرمان‌ها) | 256 |
| فراخوانی‌های هم‌زمانِ در انتظار پاسخ | 8 |
| مدت اجرا | 120 ثانیه |
| یک مقدار رفت‌وبرگشتی با ویرایشگر | 1 MiB، حداکثر 12 سطح تو‌در‌تو، 4,096 مدخل برای هر آرایه یا شیء |
| گزارش | 1,000 خط یا 256 KiB؛ هر خط حداکثر 4,096 نویسه |
| برنامه‌ها در کتابخانه | 128 |
| نام برنامه | 256 نویسه |
| فایل برنامهٔ واردشده | 1 MiB |

حلقه‌ای که هر کلیپ را انتخاب و یک افکت اعمال می‌کند، برای هر کلیپ دو تغییر مصرف می‌کند؛ بنابراین پیش از تمام‌شدن بودجه می‌تواند ۱۲۸ کلیپ را پوشش دهد.

## خطاها

اگر ویرایشگر فراخوانی‌ای را رد کند، promise آن با `Error` رد می‌شود و `message` دلیل را می‌گوید: فرمانی بیرون از واژگان مجاز، افکتی روی انتخاب خالی، یا پارامتری خارج از بازه. خطا همچنین `code` دارد که اگر ویرایشگر کد مشخص‌تری نداده باشد `MACRO_CALL_FAILED` است. برنامه می‌تواند این خطاها را بگیرد و ادامه دهد:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

آن برنامه کامل می‌شود و گزارشش می‌گوید *refused: Unsupported macro command: ExportWav.*

خطایی که برنامه نگیرد، اجرا را پایان می‌دهد، پروژه را به حالت قبل برمی‌گرداند و در پنل همراه با شمارهٔ خط نشان می‌دهد. برنامه‌ای که کامپایل نمی‌شود نیز پیش از هر اجرایی به همین شکل گزارش می‌شود.

## افکت‌هایی که برنامه می‌تواند اعمال کند {#effects-a-program-can-apply}

این‌ها شناسه‌های افکتی هستند که `sound.effect` و `sound.effects` می‌پذیرند، به‌همراه کلیدهای پارامتر و مقدارهای پیش‌فرض هر افکت. بازه‌ها و واحدها در [مرجع افکت‌های صوتی](/reference/generated/audio-effects/) آمده‌اند. از برنامه نمی‌توان افزونه‌های Nyquist را اعمال کرد.

| افکت | شناسهٔ افکت | پارامترها و پیش‌فرض‌ها |
| --- | --- | --- |
| تقویت | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| کاهش خودکار موسیقی | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| بم و زیر | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| تغییر زیر و بمی | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| تغییر سرعت و زیر و بمی | `audacity-change-speed-pitch` | `speedPercent: 0` |
| تغییر تمپو | `audacity-change-tempo` | `tempoPercent: 0` |
| فیلترهای کلاسیک | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| حذف کلیک | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| کمپرسور | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Delay | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| اعوجاج | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| اکو | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| محوشدن تدریجی ورودی | `audacity-fade-in` | none |
| محوشدن تدریجی خروجی | `audacity-fade-out` | none |
| EQ منحنی فیلتر | `audacity-filter-curve-eq` | `points`: آرایه‌ای از `{ frequency, gain }`؛ پیش‌فرض شامل دو نقطهٔ تخت در 20 Hz و 20 kHz است؛ `linearFrequencyScale: false`; `filterLength: 8191` |
| EQ پارامتری چهاربانده | `eq` | `outputGain: 0`; `bands`: چهار شیء `{ id, enabled, type, frequency, gain, q, slope }` با قله در 100، 500، 2000 و 8000 Hz و با `gain: 0`، `q: 1`، `slope: 12` |
| گیت | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| EQ گرافیکی | `audacity-graphic-eq` | `gains`: 31 بهرهٔ باند بر حسب dB که همگی 0 هستند؛ `interpolation: 'bspline'`; `filterLength: 8191` |
| فیلتر high-pass | `highpass` | `frequency: 80`, `q: 0.707` |
| وارون‌سازی | `audacity-invert` | none |
| کمپرسور قدیمی | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| محدودکننده | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| نرمال‌سازی بلندی صدا | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| فیلتر low-pass | `lowpass` | `frequency: 18000`, `q: 0.707` |
| کاهش نویز | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| نرمال‌سازی | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| کشش Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| حذف جابه‌جایی DC | `audacity-remove-dc-offset` | none |
| ترمیم | `audacity-repair` | none |
| تکرار | `audacity-repeat` | `count: 1` |
| ریورب | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| ریورب (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| وارونه‌سازی | `audacity-reverse` | none |
| کشش تدریجی | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| کوتاه‌کردن سکوت | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| بهرهٔ کاربردی (بازبینی‌شده) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

دو افکت به چیزی نیاز دارند که برنامه نمی‌تواند فراهم کند. Noise Reduction به نمایهٔ نویزی نیاز دارد که در پنجرهٔ خود افکت گرفته شده باشد و Auto Duck به ترک کنترلی زیر ترک متمرکز نیاز دارد.

## فرمان‌هایی که برنامه می‌تواند اجرا کند {#commands-a-program-can-run}

`sound.command` نام‌های فرمان ماکروی Audacity در ادامه را می‌پذیرد. این‌ها همان نام‌هایی هستند که ماکروی فهرست‌گام می‌تواند داشته باشد؛ بنابراین برنامه و فهرست‌گام دقیقاً قابلیت‌های یکسانی دارند. هر فرمان کنش ویرایشگری را اجرا می‌کند که در [مرجع فرمان‌ها](/reference/generated/commands/) توضیح داده شده است.

### فرمان‌های انتخاب دارای پارامتر

| فرمان | پارامترها |
| --- | --- |
| `SelectTime` | `start`، `end` بر حسب ثانیه؛ `relativeTo` مانند `sound.select.time` |
| `SelectFrequencies` | `low`، `high` بر حسب هرتز |
| `SelectTracks` | `track`، `trackCount` (از 0 تا 100)؛ `mode` از میان `'set'`، `'add'` یا `'remove'` |
| `Select` | هر ترکیبی از سه مجموعهٔ بالا |

پارامتری را که وارد نکنید، آن بخش از انتخاب را بدون تغییر می‌گذارد؛ Audacity نیز آن‌ها را همین‌طور می‌خواند.

### فرمان‌های بدون پارامتر

| گروه | فرمان‌ها |
| --- | --- |
| انتخاب | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| ویرایش | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| ترک‌ها | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| برچسب‌ها | `AddLabel` |
| تحلیل | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### مواردی که عمداً وجود ندارند

`Undo` و `Redo` وجود ندارند، چون اجرا خودش یک مدخل تاریخچه است و گامی که در تاریخچه حرکت کند از اجرا عبور می‌کند و به ویرایش‌های خودتان می‌رسد. فرمان‌های پخش و ضبط هم وجود ندارند، چون برنامه چیزی ندارد که منتظرش بماند و ضبط را نمی‌توان به عقب برگرداند. بازکردن، ذخیره‌کردن، بستن، واردکردن، صادرکردن و تنظیمات وجود ندارند، چون دسترسی برنامه به همان پروژه‌ای محدود است که هنگام شروع باز بوده است. فرمان‌هایی که فقط پنجره‌ای باز می‌کنند یا نما را عوض می‌کنند نیز وجود ندارند، چون چیزی در پروژه تغییر نمی‌دهند.

## اشتراک‌گذاری برنامه‌ها {#sharing-programs}

**خروجی گرفتن از برنامه** برنامهٔ انتخاب‌شده را در قالب فایل `.soundscapemacro` می‌نویسد و **وارد کردن برنامه** آن را می‌خواند. این فایل JSON است، نه فایل `.js` خالی؛ بنابراین رایانهٔ دریافت‌کننده آن را با چیزی که باید بیرون از ویرایشگر اجرا شود اشتباه نمی‌گیرد:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

واردکردن فقط متن را ذخیره می‌کند. برنامهٔ واردشده دکمهٔ **اجرای برنامه** ندارد؛ به‌جای آن پنل خود برنامه، فایل مبدأ آن، توضیحی دربارهٔ کارهایی که برنامه می‌تواند با پروژهٔ باز انجام دهد و کادر انتخاب *I have read this program and want to run it.* را نشان می‌دهد. با علامت‌زدن آن، گزینهٔ **فعال کردن این برنامه** فعال می‌شود و تنها پس از آن برنامه را می‌توان اجرا کرد.

این اجازه فقط برای همان متنی است که خوانده‌اید. اگر برنامه بعداً تغییر کند — چه خودتان ویرایشش کنید و چه نسخهٔ تازه‌تری روی آن وارد کنید — بازبینی دوباره ظاهر می‌شود تا متن تازه را فعال کنید. برنامه‌هایی را که خودتان در مدیر می‌نویسید نیازی به بازبینی نیست.

## نمونه‌ها

روی هر کلیپ در نخستین ترکی که کلیپ دارد fade-in اعمال کنید. پیش از اجرا سربرگ همان ترک را کلیک کنید تا افکت روی ترکی اعمال شود که برنامه می‌خواند:

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

گزارشی از پروژه تهیه کنید، بی‌آنکه آن را تغییر دهید:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

ماکروی ذخیره‌شدهٔ فهرست‌گام را فقط وقتی اجرا کنید که انتخاب به‌اندازهٔ کافی طولانی باشد:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## دربارهٔ این صفحه

مجموعهٔ مرورگر (`tests/browser/handbook-macro-program-examples.spec.js`) هر برنامهٔ این صفحه، از قطعه‌کدهای یک‌خطی تا نمونه‌های کامل، را در هر بیلد Soundscaper اجرا می‌کند و متن برنامه‌ها را از خود این صفحه می‌خواند. اگر برنامه‌ای دیگر کامل نشود یا نتیجه‌ای جز آنچه صفحه می‌گوید تولید کند، بیلد تا اصلاح صفحه یا ویرایشگر ناموفق می‌ماند.
