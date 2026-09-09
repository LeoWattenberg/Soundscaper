---
title: "ניקוי הקלטת קול"
description: "הסרת הרעש מההקלטה, חיתוך הרעם, הגעה לרמת עוצמת קול של פודקאסט וייצוא כקובץ MP3."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"he"} -->

>
<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

רוב ההקלטות שנעשות בבית דורשות שלוש תיקונים זהים: רעש רקע קבוע להסרה, רעש רעידה נמוך לסינון ורמה שצריך להעלות לסטנדרט. מדריך זה מבצע את שלושת התיקונים הללו על קטע דוגמה בן שלוש שניות, שחציו הראשון הוא רק רעש חדר, ואז מייצא את התוצאה כקובץ MP3.

:::tip[מה תזדקקו לו]
- הורידו את [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — קטע קצר שחציו הראשון הוא רעש חדר לפני שהקול מתחיל.

כל שלב למטה עובד על הקבצים הללו בדיוק כפי שהם, אז מה שאתם רואים צריך להתאים למה שמדריך אומר. Soundscaper פועל בדפדפן; אין צורך בהתקנה.
:::

## מה תלמדו

- מדוע הפחתת רעש זקוקה לפרופיל, ואיך לתת לה אחד.
- מה מסנן מעבר גבוה מסיר ואיפה להגדיר אותו עבור דיבור.
- ההבדל בין רמת שיא ללודיות, ואיך לפגוע במטרה של לודיות.
- איך לייצא קובץ MP3.

## שלבים

1. פתחו את Soundscaper. פרויקט חדש וריק מוכן ברגע שהעורך נטען.
2. בחרו **קובץ → יבוא אודיו** ובחרו ב-`guide-noisy-take.wav` — קטע קצר שחציו הראשון הוא רעש חדר לפני שהקול מתחיל. הקובץ נוחת כקליפ על מסלול משלו.
3. לחצו על **הפעלה** להאזנה, ואז על **עצירה**.
   *אתם צריכים לראות:* חצי שנייה של שיהוק, ואז צליל קבוע שמחליף קול, עם השיהוק מתחתיו.
4. גררו את הסרגל מעל הקליפ, מההתחלה לסימן 15%, כדי לבחור את ההקדמה של הרעש בלבד. הפרופיל חייב להכיל רק את הרעש שאתה רוצה להסיר — ללא קול כלל.
5. בחרו **אפקט → הסרת תיקונים של רעש → הפחתת רעש** ולחצו על **קבלת פרופיל רעש**. שורת המצב מדווחת שהפרופיל מוכן. לחצו על **סגירה** כדי לעזוב את הדיאלוג לעת עתה.
6. בחרו **בחירה → בחר הכל**. הפרופיל נשמר; כעת האפקט צריך לדעת מה לנקות.
7. בחרו **אפקט → הסרת תיקונים של רעש → הפחתת רעש**. בדיאלוג **הפחתת רעש**, הגדירו **הפחתת רעש** ל-`12`, ואז לחצו על **החל על הבחירה**. שתים-עשרה דציבלים הם הגדרה טובה ראשונית. יותר מסיר יותר רעש אך גורם לקולות להישמע חלולים.
   *אתם צריכים לראות:* ההקדמה שטוחה כמעט והטון לא נפגע.
8. בחרו **אפקט → אפקטים ישנים → מסננים קלאסיים**. בדיאלוג **מסננים קלאסיים**, בחרו **מעבר גבוה** עבור **סוג מסנן** והגדירו **תדירות חיתוך** ל-`100`, ואז לחצו על **החל על הבחירה**. הכל מתחת ל-100 הרץ — תנועה, טיפול, מיזוג אוויר — נמוג. דיבור חי מעליו היטב.
9. בחרו **אפקט → נפח ודחיסה → נורמליזציה של לודיות**. בדיאלוג **נורמליזציה של לודיות**, הגדירו **לודיות יעד** ל-`-16`, ואז לחצו על **החל על הבחירה**. −16 LUFS הוא היעד הנפוץ לפודקאסטים סטריאו. לודיות מודדת כמה חזק כל הקטע מרגיש, לא כמה גבוהים השיאים שלו.
   *אתם צריכים לראות:* הגלומה גבוהה יותר והקטע מנוגן ברמה נוחה.
10. לחצו על **הפעלה** להאזנה, ואז על **עצירה**.
   *אתם צריכים לראות:* קטע נקי ורמתי עם הקדמה שקטה.
11. בחרו **קובץ → ייצוא אודיו**, הגדירו **פורמט** ל**MP3**, ולחצו על **ייצוא**. הקובץ יורד ברגע שהעיבוד מסתיים, וקישורו נשאר בדיאלוג. הקובץ מקודד בדפדפן; שום דבר לא עוזב את המחשב שלך.

## לאן הלאה

- עשו זאת על הקטע שלכם עם מדריכי ה-how-to: [הסרת רעש רקע](/guides/cleaning-up/remove-background-noise/), [הסרת רעש רעידה נמוך](/guides/cleaning-up/remove-low-rumble/) ו-[נורמליזציה של לודיות עבור פודקאסט](/guides/volume/normalize-loudness-for-podcasts/).
- בדקו את התוצאה בדרך שבה פלטפורמה הייתה: [מדידת כמה חזק המקס שלך הוא](/guides/analysis/measure-loudness/).

## מדריכים נוספים

[פרויקט Soundscaper הראשון שלך](/tutorials/your-first-project/) — יבאו הקלטה, האזינו לה, פיצלו אותה, דעכו אותה החוצה, ייצאו קובץ ושמרו את הפרויקט.
[שים מוזיקה מתחת לקול](/tutorials/put-music-under-a-voice/) — שכבו שני מסלולים, הכניסו אחד מתחת לשני באופן אוטומטי, ערבבו אותם וייצאו אותם.

## הפניות

- [כל פרמטר של האפקטים המשמשים כאן, עם ברירת המחדל והטווח שלו, נמצא בהפניות האפקטים האודיו.](/reference/generated/audio-effects/#parameters)
- [פורמטי הייצוא, המכולות שלהם ומגבלות הערוצים שלהם נמצאים בהפניות פורמטי הייצוא.](/reference/generated/formats/)
- [כל פקודה בתפריט והקיצור שלה נמצאים בהפניות הפקודות והקיצורים.](/reference/generated/commands/)

## על מדריך זה

מדריך זה מופעל, שלב אחר שלב ועל קבצים אלה בדיוק, כנגד כל בניית Soundscaper על ידי סוויטת הדפדפן (`tests/browser/soundscaper-tutorials.spec.js`). אם שלב מפסיק לעבוד, הבנייה נכשלת עד שהמדריך מתוקן, אז מה שאתם קוראים הוא מה שהעורך עושה.