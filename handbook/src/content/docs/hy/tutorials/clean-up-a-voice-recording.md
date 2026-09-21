---
title: "Մաքրել ձայնային ձայնագրությունը"
description: "Հեռացրեք ձայնագրության թրթռումը, կտրեք ցնցումը, հասցրեք այն պոդկաստի ձայնային մակարդակին և արտահանեք MP3 ձևաչափով։"
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. It lands as a clip on its own track.\",\"text\":\"Choose File → Import and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. It lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"96727487ae82c7f76b646047856630f73eb756ee7832615587e24e1e6db0b0ee","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"96727487ae82c7f76b646047856630f73eb756ee7832615587e24e1e6db0b0ee","targetLocale":"hy"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

Դեմոնստրացիաների մեծ մասը, որոնք կատարվում են տանը, պահանջում նույն երեք շտկումները. հեռացման համար կայուն ֆոնային աղմուկ, ֆիլտրացման համար ցածր շշուկ և ստանդարտին հասցնելու համար մակարդակ։ Այս ուղեցույցը կատարում է բոլոր երեքը երեք վայրկյանանոց օրինակային ձայնագրության վրա, որի առաջին կես վայրկյանը միայն սենյակային աղմուկ է, ապա արդյունքը արտահանվում է որպես MP3։

:::tip[Ինչպիսի օբյեկտներ եք անհրաժեշտ]
- Ներբեռնեք [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — կարճ ձայնագրություն, որի առաջին կես վայրկյանը սենյակային աղմուկ է՝ ձայնի սկսվելուց առաջ։

Ցածքում նշված բոլոր քայլերը աշխատում են այս ֆայլերի վրա ճիշտ այնպես, ինչպես դրանք կան, ուստի ինչը դուք տեսնում եք, պետք է համընկնի ուղեցույցի ասածի հետ։ Soundscaper-ը աշխատում է բրաուզերում. ոչինչ չի պահանջվում տեղադրել։
:::

## Ինչ կսովորեք

- Ինչու է Աղմուկի նվազեցումը պահանջում պրոֆիլ և ինչպես տալ այն։
- Ինչ է հեռացնում բարձր անցիչ ֆիլտրը և որտեղ է այն կարգավորել խոսքի համար։
- Փայկ մակարդակի և լսելիության տարբերությունը և ինչպես հասնել լսելիության նպատակին։
- Ինչպես արտահանել MP3։

## Քայլեր

1. Բացեք Soundscaper-ը։ Նոր, դատարկ նախագիծ պատրաստ է, հենց երբ խմբագիրը բեռնվում է։
2. Ընտրեք **File → Import** և ընտրեք `guide-noisy-take.wav` — կարճ ձայնագրություն, որի առաջին կես վայրկյանը սենյակային աղմուկ է՝ ձայնի սկսվելուց առաջ։ Այն տեղադրվում է որպես կլիպ իր սեփական հոսքի վրա։
3. Սեղմեք **Play**՝ լսելու համար, ապա **Stop**։
   *Ինչպիսի օբյեկտներ եք տեսնում.* Կես վայրկյան շշուկ, ապա կայուն տոն, որը փոխարինում է ձայնին, իսկ շշուկը՝ նրա տակ։
4. Ընտրեք կլիպի վերևի կանոնավորիչը՝ սկզբից մինչև 15%-անոց նշումը, որպեսզի ընտրեք միայն աղմուկի նախնական մասը։ Պրոֆիլը պետք է պարունակի միայն այն աղմուկը, որը ցանկանում եք հեռացնել — ոչ մի ձայն։
5. Ընտրեք **Effect → Noise removal and repair → Noise Reduction** և սեղմեք **Get noise profile**։ Կարգավիճակի տողը հաղորդում է, որ պրոֆիլը պատրաստ է։ Սեղմեք **Close**՝ ժամանակավորապես փակելու համար։
6. Ընտրեք **Select → Select all**։ Պրոֆիլը պահվում է. հիմա էֆեկտը պետք է իմանա, թե ինչ մաքրել։
7. Ընտրեք **Effect → Noise removal and repair → Noise Reduction**։ **Noise Reduction** երկխոսության մեջ կարգավորեք **Noise reduction**-ը `12`-ի, ապա սեղմեք **Apply to selection**։ Երկու տասնյակ դեցիբելը լավ առաջնային կարգավորում է։ Ավելին ավելի շատ աղմուկ է հեռացնում, բայց ձայները դառնում են փոսպատյանային։
   *Ինչպիսի օբյեկտներ եք տեսնում.* Նախնական մասը գրեթե հարթ է, և տոնը չի դիպված։
8. Ընտրեք **Effect → Legacy effects → Classic Filters**։ **Classic Filters** երկխոսության մեջ ընտրեք **High-pass** **Filter type**-ի համար և կարգավորեք **Cutoff frequency**-ը `100`-ի, ապա սեղմեք **Apply to selection**։ 100 Հց-ից ցածր ամեն ինչը — շարժաքայքայում, ձեռքի աղմուկ, օդային կոնդիցիոներ — հեռացվում է։ Խոսքը գտնվում է շատ ավելի բարձր։
9. Ընտրեք **Effect → Volume and compression → Loudness Normalization**։ **Loudness Normalization** երկխոսության մեջ կարգավորեք **Target loudness**-ը `-16`-ի, ապա սեղմեք **Apply to selection**։ −16 LUFS-ը ստերեո պոդկաստների համար տարածված նպատակ է։ Լսելիությունը չափում է, թե ինչպես է ամբողջ ձայնագրությունը լսվում, ոչ թե ինչքան բարձր են դրա փայկերը։
   *Ինչպիսի օբյեկտներ եք տեսնում.* Կիլիոգրամային ալիքը ավելի բարձր է, և ձայնագրությունը խաղում է հարմար մակարդակով։
10. Սեղմեք **Play**՝ լսելու համար, ապա **Stop**։
   *Ինչպիսի օբյեկտներ եք տեսնում.* Մաքուր, հավասար ձայնագրություն թույլ նախնական մասով։
11. Ընտրեք **File → Export audio**, կարգավորեք **Format**-ը **MP3** և սեղմեք **Export**։ Ֆայլը ներբեռնվում է, հենց երբ ռենդերինգը ավարտվում է, և դրա հղումը մնում է երկխոսության մեջ։ Ֆայլը կոդավորվում է բրաուզերում. ոչինչ չի լքում ձեր համակարգիչը։

## Ինչպիսի օբյեկտներ եք գտնում

- Կատարեք ձեր սեփական ձայնագրության վրա ուղեցույցների միջոցով. [Հեռացնել ֆոնային աղմուկը](/guides/cleaning-up/remove-background-noise/), [Հեռացնել ցածր շշուկը](/guides/cleaning-up/remove-low-rumble/) և [Նորմալացնել լսելիությունը պոդկաստի համար](/guides/volume/normalize-loudness-for-podcasts/)։
- Ստուգեք արդյունքը այնպես, ինչպես կանում է պլատֆորմը. [Չափել, թե ինչքան լսելի է ձեր խառնուրդը](/guides/analysis/measure-loudness/)։

## Այլ ուղեցույցներ

[Ձեր առաջին Soundscaper նախագիծը](/tutorials/your-first-project/) — Իմպորտեք ձայնագրություն, լսեք, բաժանեք, մեղմեք, արտահանեք ֆայլ և պահպանեք նախագիծը։
[Տեղադրել երաժշտություն ձայնի տակ](/tutorials/put-music-under-a-voice/) — Ստեղծեք երկու հոսքեր, ավտոմատ կերպով մեղմեք մեկը մյուսի տակ, խառնեք և արտահանեք։

## Հղում

- [Այստեղ օգտագործված էֆեկտների բոլոր պարամետրերը, դրանց չափերով և տիրույթներով, գտնվում են ձայնային էֆեկտների հղումներում։](/reference/generated/audio-effects/#parameters)
- [Արտահանման ձևաչափերը, դրանց փաթեթները և ալիքների սահմանափակումները գտնվում են արտահանման ձևաչափերի հղումներում։](/reference/generated/formats/)
- [Ամեն մի մենյու հրամանը և դրա ստեղնաշարտի չափը գտնվում են հրամանների և չափերի հղումներում։](/reference/generated/commands/)

## Այս ուղեցույցի մասին

Այս ուղեցույցը կրկնվում է, քայլ առ քայլ և այս ճիշտ ֆայլերի վրա, Soundscaper-ի յուրաքանչյուր կառուցվածքի դեմ բրաուզերային հավաքածուի (`tests/browser/soundscaper-tutorials.spec.js`) միջոցով։ Եթե քայլը դադարում է աշխատել, կառուցվածքը ձախողվում է, մինչև ուղեցույցը շտկվի, ուստի ինչը դուք կարդում եք, այն է, ինչը խմբագիրը անում է։
