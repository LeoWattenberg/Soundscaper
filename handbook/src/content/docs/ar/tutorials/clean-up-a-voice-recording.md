---
title: "تنظيف تسجيل صوتي"
description: "إزالة الضجيج من التسجيل، وقص الاهتزاز، وضبط مستوى الصوت ليناسب البودكاست، وتصدير ملف MP3."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"ar"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

معظم التسجيلات المنجزة في المنزل تحتاج إلى نفس الإصلاحات الثلاث: ضجيج خلفية ثابت يجب إزالته، وخرخشة منخفضة يجب تصفيتها، ومستوى يحتاج إلى رفعه إلى معيار. يقوم هذا الشرح بجميع العمليات الثلاث على تسجيل تجريبي مدته ثلاث ثوانٍ، تكون نصف الثانية الأولى منه ضجيج غرفة فقط، ثم يقوم بتصدير النتيجة بصيغة MP3.

:::tip[ما ستحتاجه]
- حمّل [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — تسجيل قصير تكون نصف الثانية الأولى منه ضجيج غرفة قبل بدء الصوت.

تعمل كل خطوة أدناه على هذه الملفات كما هي تمامًا، لذا يجب أن يطابق ما تراه ما يقوله الشرح. يعمل Soundscaper في المتصفح؛ لا حاجة لتثبيت أي شيء.
:::

## ما ستتعلمه

- لماذا يحتاج تقليل الضجيج إلى ملف تعريف، وكيف تمنحه واحدًا.
- ما الذي تزيله مرشح التمرير العالي، وأين تضبطه للكلام.
- الفرق بين مستوى الذروة والوضوح، وكيف تصل إلى هدف الوضوح.
- كيفية تصدير ملف MP3.

## الخطوات

1. افتح Soundscaper. يكون مشروع جديد فارغًا جاهزًا بمجرد تحميل المحرر.
2. اختر **File → Import audio** واختر `guide-noisy-take.wav` — تسجيل قصير تكون نصف الثانية الأولى منه ضجيج غرفة قبل بدء الصوت. يظهر الملف كقطعة على مسار مستقل.
3. اضغط **Play** للاستماع، ثم اضغط **Stop**.
   *ما يجب أن تراه:* نصف ثانية من الهسهسة، ثم نغمة ثابتة تمثل الصوت، مع الهسهسة تحتها.
4. اسحب في المسطرة فوق القطعة، من البداية إلى علامة 15%، لتحديد المقدمة التي تحتوي على الضجيج فقط. يجب أن يحتوي ملف التعريف على الضجيج الذي تريد إزالته فقط — دون أي صوت.
5. اختر **Effect → Noise removal and repair → Noise Reduction** واضغط **Get noise profile**. يبلغ سطر الحالة أن ملف التعريف جاهز. اضغط **Close** لمغادرة مربع الحوار مؤقتًا.
6. اختر **Select → Select all**. يتم الاحتفاظ بملف التعريف؛ الآن يحتاج التأثير إلى معرفة ما يجب تنظيفه.
7. اختر **Effect → Noise removal and repair → Noise Reduction**. في مربع حوار **Noise Reduction**، اضبط **Noise reduction** على `12`, ثم اضغط **Apply to selection**. اثنا عشر ديسيبل هي إعداد أولي جيد. المزيد يزيل المزيد من الضجيج لكنه يجعل الأصوات تبدو مجوفة.
   *ما يجب أن تراه:* تكون المقدمة شبه مسطحة والنغمة غير متأثرة.
8. اختر **Effect → Legacy effects → Classic Filters**. في مربع حوار **Classic Filters**، اختر **High-pass** لـ **Filter type** واضبط **Cutoff frequency** على `100`, ثم اضغط **Apply to selection**. كل ما هو أقل من 100 هرتز — المرور، التعامل، تكييف الهواء — يتم تخفيضه. الكلام يعيش فوقه بكثير.
9. اختر **Effect → Volume and compression → Loudness Normalization**. في مربع حوار **Loudness Normalization**، اضبط **Target loudness** على `-16`, ثم اضغط **Apply to selection**. −16 LUFS هو الهدف الشائع للبودكاستات المجسمة. يقيس الوضوح مدى شعور التسجيل بأكمله بالعلو، وليس مدى ارتفاع ذرواته.
   *ما يجب أن تراه:* تكون الموجة أعلى ويشتغل التسجيل بمستوى مريح.
10. اضغط **Play** للاستماع، ثم اضغط **Stop**.
   *ما يجب أن تراه:* تسجيل نظيف ومستوٍ بمقدمة هادئة.
11. اختر **File → Export audio**، اضبط **Format** على **MP3**، واضغط **Export**. يتم تنزيل الملف بمجرد انتهاء العرض، ويبقى رابطه في مربع الحوار. يتم ترميز الملف في المتصفح؛ لا شيء يغادر حاسوبك.

## أين تذهب بعد ذلك

- قم بذلك على تسجيلك الخاص باستخدام أدلة كيفية: [إزالة ضجيج الخلفية](/guides/cleaning-up/remove-background-noise/), [إزالة الخرخرة المنخفضة](/guides/cleaning-up/remove-low-rumble/) و [تطبيع الوضوح لبودكاست](/guides/volume/normalize-loudness-for-podcasts/).
- تحقق من النتيجة بالطريقة التي تفعلها بها المنصة: [قياس مدى علو مزيجك](/guides/analysis/measure-loudness/).

## شروحات أخرى

[مشروعك الأول في Soundscaper](/tutorials/your-first-project/) — استورد تسجيلًا، استمع، قسّمه، خفّفه، صدّر ملفًا واحفظ المشروع.
[ضع موسيقى تحت صوت](/tutorials/put-music-under-a-voice/) — طبّق مسارين، اخفض أحدهما تحت الآخر تلقائيًا، اخلطهما وصدّر.

## مرجع

- [كل معامل من التأثيرات المستخدمة هنا، مع قيمته الافتراضية ونطاقه، موجود في مرجع التأثيرات الصوتية.](/reference/generated/audio-effects/#parameters)
- [صيغ التصدير، حاوياتها وحدود قنواتها موجودة في مرجع صيغ التصدير.](/reference/generated/formats/)
- [كل أمر قائمة واختصار لوحة المفاتيح الخاص به موجود في مرجع الأوامر والاختصارات.](/reference/generated/commands/)

## حول هذا الشرح

يتم إعادة تشغيل هذا الشرح، خطوة بخطوة وعلى هذه الملفات بالذات، مقابل كل إصدار من Soundscaper بواسطة مجموعة أدوات المتصفح (`tests/browser/soundscaper-tutorials.spec.js`). إذا توقف عمل خطوة، يفشل الإصدار حتى يتم تصحيح الشرح، لذا ما تقرأه هو ما يفعله المحرر.
