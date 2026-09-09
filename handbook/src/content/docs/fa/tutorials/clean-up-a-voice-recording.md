---
title: "تمیز کردن یک ضبط صوتی"
description: "صدای زمزمه را از یک ضبط حذف کنید، لرزش را قطع کنید، آن را به صدای پادکست برسانید و یک فایل MP3 صادر کنید."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"fa"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

بیشتر ضبط‌های خانگی به سه نوع تعمیر نیاز دارند: حذف یک نویز پس‌زمینه ثابت، فیلتر کردن یک لرزش کم، و تنظیم سطحی که باید به یک استاندارد برسد. این آموزش همگی این سه مورد را بر روی یک نمونه سه ثانیه‌ای انجام می‌دهد که نیم ثانیه اول آن فقط نویز اتاق است، و سپس نتیجه را به عنوان یک فایل MP3 صادر می‌کند.

:::tip[آنچه نیاز دارید]
- دانلود [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — یک نمونه کوتاه که نیم ثانیه اول آن فقط نویز اتاق است و بعد از آن صدا شروع می‌شود.

هر مرحله زیر دقیقاً بر روی این فایل‌ها کار می‌کند، بنابراین آنچه می‌بینید باید با آنچه در آموزش گفته شده مطابقت داشته باشد. Soundscaper در مرورگر اجرا می‌شود؛ نیازی به نصب چیزی نیست.
:::

## آنچه خواهید آموخت

- چرا کاهش نویز به یک پروفایل نیاز دارد و چگونه آن را ایجاد کنیم.
- یک فیلتر گذر بالا چه چیزی را حذف می‌کند و کجا باید برای گفتار تنظیم شود.
- تفاوت بین سطح اوج و صدای بلند چیست و چگونه یک هدف صدای بلند را بزنیم.
- چگونه یک فایل MP3 صادر کنیم.

## مراحل

1. Soundscaper را باز کنید. یک پروژه خالی و جدید به محض بارگذاری ویرایشگر آماده است.
2. **فایل → وارد کردن صوت** را انتخاب کنید و [`guide-noisy-take.wav`] — یک نمونه کوتاه که نیم ثانیه اول آن فقط نویز اتاق است و بعد از آن صدا شروع می‌شود — را انتخاب کنید. فایل به عنوان یک کلیپ در یک مسیر جداگانه قرار می‌گیرد.
3. **پلی** را فشار دهید تا گوش دهید، سپس **استپ** را فشار دهید.
   *باید ببینید:* نیم ثانیه نویز، سپس یک تون ثابت به جای یک صدا، با نویز زیر آن.
4. در بالای کلیپ، از شروع تا علامت 15%، کشیده شود تا نویز اولیه انتخاب شود. پروفایل باید فقط حاوی نویز مورد نظر باشد — هیچ صدایی نداشته باشد.
5. **اثر → حذف و تعمیر نویز → کاهش نویز** را انتخاب کنید و **دریافت پروفایل نویز** را فشار دهید. خط وضعیت گزارش می‌دهد که پروفایل آماده است. **بستن** را فشار دهید تا برای حالا از این دیالوگ خارج شوید.
6. **انتخاب → انتخاب همه** را انتخاب کنید. پروفایل حفظ می‌شود؛ حالا اثر باید بداند چه چیزی را تمیز کند.
7. **اثر → حذف و تعمیر نویز → کاهش نویز** را انتخاب کنید. در دیالوگ **کاهش نویز**، **کاهش نویز** را به `12` تنظیم کنید، سپس **اعمال به انتخاب** را فشار دهید. دوازده دسی‌بل یک تنظیم اولیه خوب است. بیشتر نویز را بیشتر حذف می‌کند اما صداها را توخالی می‌کند.
   *باید ببینید:* مقدمه تقریباً صاف است و تون دست نخورده باقی می‌ماند.
8. **اثر → اثرات کلاسیک → فیلترهای کلاسیک** را انتخاب کنید. در دیالوگ **فیلترهای کلاسیک**، **گذر بالا** را برای **نوع فیلتر** انتخاب کنید و **فرکانس برش** را به `100` تنظیم کنید، سپس **اعمال به انتخاب** را فشار دهید. همه چیز زیر 100 هرتز — ترافیک، دستکاری، تهویه مطبوع — کاهش می‌یابد. گفتار خوب بالای آن زندگی می‌کند.
9. **اثر → حجم و فشرده‌سازی → نرمال‌سازی صدای بلند** را انتخاب کنید. در دیالوگ **نرمال‌سازی صدای بلند**، **صدای بلند هدف** را به `-16` تنظیم کنید، سپس **اعمال به انتخاب** را فشار دهید. -16 LUFS هدف معمول برای پادکست‌های استریو است. صدای بلند اندازه‌گیری می‌کند که کل نمونه چقدر بلند به نظر می‌رسد، نه اینکه اوج‌های آن چقدر بلند هستند.
   *باید ببینید:* موج‌نگار بلندتر است و نمونه در یک سطح راحت پخش می‌شود.
10. **پلی** را فشار دهید تا گوش دهید، سپس **استپ** را فشار دهید.
   *باید ببینید:* یک نمونه تمیز و سطحی با یک مقدمه آرام.
11. **فایل → صادر کردن صوت** را انتخاب کنید، **فرمت** را به **MP3** تنظیم کنید، و **صادرات** را فشار دهید. فایل به محض اتمام رندر دانلود می‌شود و لینک آن در دیالوگ باقی می‌ماند. فایل در مرورگر رمزگذاری می‌شود؛ هیچ چیزی از کامپیوتر شما خارج نمی‌شود.

## مراحل بعدی

- آن را بر روی نمونه خود با راهنماهای زیر انجام دهید: [حذف نویز پس‌زمینه](/guides/cleaning-up/remove-background-noise/)، [حذف لرزش کم](/guides/cleaning-up/remove-low-rumble/) و [نرمال‌سازی صدای بلند برای یک پادکست](/guides/volume/normalize-loudness-for-podcasts/).
- نتیجه را به روشی که یک پلتفرم انجام می‌دهد، بررسی کنید: [اندازه‌گیری اینکه مخلوط شما چقدر بلند است](/guides/analysis/measure-loudness/).

## آموزش‌های دیگر

[اولین پروژه Soundscaper شما](/tutorials/your-first-project/) — یک ضبط را وارد کنید، به آن گوش دهید، آن را تقسیم کنید، محو کنید، یک فایل صادر کنید و پروژه را ذخیره کنید.
[موسیقی را زیر یک صدا قرار دهید](/tutorials/put-music-under-a-voice/) — دو مسیر را لایه‌بندی کنید، یکی را زیر دیگری به طور خودکار کم کنید، آن‌ها را مخلوط کنید و صادر کنید.

## مرجع

- [هر پارامتر اثرات مورد استفاده در اینجا، با مقدار پیش‌فرض و محدوده آن، در مرجع اثرات صوتی است.](/reference/generated/audio-effects/#parameters)
- [فرمت‌های صادر شده، کانتینرهای آن‌ها و محدودیت‌های کانال آن‌ها در مرجع فرمت‌های صادر شده است.](/reference/generated/formats/)
- [هر دستور منو و میانبر صفحه‌کلید آن در مرجع دستورات و میانبرها است.](/reference/generated/commands/)

## در مورد این آموزش

این آموزش، قدم به قدم و بر روی همین فایل‌ها، در برابر هر نسخه Soundscaper توسط مجموعه مرورگر (`tests/browser/soundscaper-tutorials.spec.js`) تکرار می‌شود. اگر یک مرحله دیگر کار نکند، نسخه شکست می‌خورد تا زمانی که آموزش اصلاح شود، بنابراین آنچه می‌خوانید همان کاری است که ویرایشگر انجام می‌دهد.