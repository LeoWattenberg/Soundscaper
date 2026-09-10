---
title: "תוכניות מקרו"
description: "ממשק ה־JavaScript API מולו רצה תוכנית מקרו, הגבולות שבהם היא פועלת, והקובץ שבו היא מועברת."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","targetLocale":"he"} -->

תוכנית מקרו היא מקרו שנכתב כ-JavaScript במקום כרשימת שלבים.
היא מריצה בתוך העורך מול API קטן בשם `sound`, המאפשר לה לקרוא
את הפרויקט הפתוח, להזיז את הבחירה, ולחולל את אותם אפקטים ופקודות שמקרו
רשימת-שלבים יכול לחולל. כל השאר, החל מקבצים ורשת ועד הפרויקטים האחרים שלך,
מחוץ להישג ידה.

תוכניות הן תכונה של Soundscaper. ל-Framescaper אין מנהל מקרו.

## איפה התוכניות נמצאות

בחרו **כלים → מנהל מקרו**. הדיאלוג מציג מקרו רשימת-שלבים, ותחת
**תוכניות**, את התוכניות ששמרתם. **תוכנית חדשה** יוצרת תוכנית, ופאנל
הפרטים מציג את **שם התוכנית**, את טקסט ה-**תוכנית**, וכפתור **הרצת
תוכנית**. הטקסט נשמר כשאתם מקלידים; אין שלב שמירה נפרד.

תוכנית נשמרת עם הגדרות העורך, ולא בתוך פרויקט, ולכן היא זמינה בכל פרויקט
שאתם פותחים בעורך זה. השתמשו ב-**ייצוא תוכנית** וב-**ייבוא תוכנית** כדי
להעביר תוכנית למכשיר אחר או לאדם אחר; ראו
[שיתוף תוכניות](#sharing-programs) לפרטים על מה כרוך בכך.

המדריך [חילול שרשרת האפקטים האותה בכל פעם](/guides/effects/apply-the-same-effects-every-time/)
מכסה את צד רשימת השלבים של אותו דיאלוג.

## כתיבת תוכנית

תוכנית היא גוף של פונקציית `async`, המורצת במצב קפדני. כלומר, אתם
יכולים `await` ברמה העליונה, להגדיר משתנים ופונקציות, ולהשתמש בכל
תכונה שוטפת של השפה. אובייקט ה-`sound` הוא הקשר היחיד של התוכנית אל
העורך, וכל קריאה אליו מחזירה הבטחה (promise).

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

לחצת Tab מוסיפה שני רווחים בשדה התוכנית. לחצו Escape ואז Tab כדי לעזוב
את השדה.

### מה תוכנית יכולה להשתמש

ספריית ה-JavaScript הסטנדרטית הרגילה נוכחת: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, מערכות הטיפוסים, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` ו-`queueMicrotask`. `console`
גם נוכח, וכל מה שנכתב אליו נופל ליומן התוכנית.

### מה תוכנית אינה יכולה להשתמש

תוכנית רצה ב-worker שגולתיו נלקחו ממנו לפני ששורת הראשונה רצה. אף אחד מהדברים הבאים אינו קיים בתוך תוכנית: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` ו-`setInterval`. קריאה לכל אחד מהם מחזירה `undefined`.

תוכנית אינה יכולה `import` מודול; `import` סטטי הוא שגיאת תחביר בשורה
המכילה אותו. כל מה שהתוכנית צריכה חייב להיות בתוכנית.

גבול האבטחה אינו הגלובלים החסרים אלא העורך עצמו: הוא
מענה רק לקריאות המפורטות בעמוד זה ומדחה את כל השאר לפי שם,
לא משנה מה התוכנית מצליחה לשלוח אליו.

## הרצת תוכנית

לחצו **Run program**. ההרצה כולה היא רשומה אחת בהיסטוריה של הפרויקט, כך
ש-<strong>Undo</strong> אחד הפוך את כל מה שהתוכנית עשתה, כמה שיותר שינויים היא ביצעה.
אם התוכנית זורקת, או מבוטלת, או רצה מעבר למועד היעד, הפרויקט
מוחזר בדיוק כמו שהיה לפני שההרצה החלה.

**Cancel run** עוצר תוכנית מיד. תוכנית שרצה במשך שתי
דקות נעצרת באותו אופן, עם ההודעה *The macro ran for longer than
120 seconds.*

אחרי ההרצה, החלונית מציגה את יומן התוכנית, ולאחריה *Program applied.*
כשההרצה הושלמה. הרצה שנכשלה מציגה *The program failed on line N:* ואת
הודעת השגיאה, כאשר מספר השורה הוא השורה בתוכנית שלך שזרקה.

### איזה אודיו אפקט פוגע

אפקט המיושם על ידי תוכנית רצה על בחירת הזמן הנוכחית בעקב
המוקד, שהיא העקב שבה כותרת האחרונה שנקלקה או הקליפ שבו נבחר לאחרונה. כאשר אין בחירת זמן אך קליפ נבחר, ה-
אפקט מכסה את הקליפ ההוא. קריאות בחירה של תוכנית משנות את טווח הזמן ואת
קבוצת העקבים הנבחרים, אך לא את העקב בעל המיקוד, כך שהרצה אחת מעבדת
עקב אחד. אם אין מיקוד או שהבחירה ריקה, ההרצה נכשלת עם
ההודעה שתיקית האפקטים נותנת.

## ה-API של `sound`

כל שיטה להלן מחזירה promise אלא אם כן מצוין אחרת. יש להמתין לכל קריאה
לפני ביצוע הבאה; תוכנית שמחלה יותר משמונה קריאות ללא
המתנה להן, התשיעית נדחית.

### `sound.env`

אובייקט פשוט המתאר את ההרצה.

| שדה | משמעות |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | שפת הממשק של העורך, כגון `"en"` או `"de"`. |
| `seed` | הזרע שממנו נובעות המספרים האקראיים של ההרצה. חדש לכל הרצה. |
| `startedAt` | זמן השעון שההרצה החלה, כמחרוזת ISO 8601. |
| `dryRun` | תמיד `false` כרגע. שמור. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` ו-`sound.log.debug(...values)` כותבים שורה אחת
כל אחד ליומן ההרצה. `console.log`, `console.info`, `console.warn`,
`console.error` ו-`console.debug` עושים את אותו הדבר. ערכים שאינם מחרוזות נכתבים כ-JSON. שיטות אלו אינן מחזירות דבר ואין צורך להמתין להן.

יומן מכיל לכל היותר 1,000 שורות או 256 KiB, לפי מה שקורה קודם, וכל שורה
נחתכת ב-4,096 תווים. שורות מעבר לכך נפלטות ומוספרות; המספר
מדווח כאזהרה אחרונה.

### `sound.project`

קריאת הפרויקט לעולם אינה משנה אותו ואינה נספרת מול תקציב השינויים של ההרצה.

`sound.project.snapshot()` מחזירה `{ sampleRate, tracks, selection }`, עם
`tracks` ו-`selection` כפי שהשתיים הקריאות להלן מחזירות אותם. `sampleRate` היא
קצב הדגימה של הפרויקט בהרץ, שזהו מה שכל ספירת פריימים בעמוד זה נמדדת בו.

`sound.project.tracks()` מחזירה מערך של עקבים בסדר ציר הזמן:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` מחזיר את הקטעים על מסלול אחד, או על כל המסלולים
כאשר `trackId` מושמט:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` מחזיר את הבחירה הנוכחית:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

כל קריאת בחירה נספרת כשינוי אחד ומחזירה את הבחירה שהיא יצרה,
בצורה ש`sound.project.selection()` מחזיר.

`sound.select.time(start, end, options)` מגדיר את טווח הזמן בשניות. זהו
פקודת `SelectTime` של Audacity, ו`options.relativeTo` בוחר מאיפה נמדדת כל
קצה. שני הקצוות יכולים להיות נמוכים עד -100 שניות.

| `relativeTo` | קצה התחלה | קצה סיום |
| --- | --- | --- |
| `'project-start'` (ברירת מחדל) | `start` שניות מתחילת הפרויקט | `end` שניות מתחילת הפרויקט |
| `'project'` | `start` שניות מתחילת הפרויקט | `end` שניות אחרי סוף הפרויקט |
| `'project-end'` | `start` שניות לפני סוף הפרויקט | `end` שניות לפני סוף הפרויקט |
| `'selection-start'` | `start` שניות אחרי תחילת הבחירה | `end` שניות אחרי תחילת הבחירה |
| `'selection'` | `start` שניות אחרי תחילת הבחירה | `end` שניות אחרי סוף הבחירה |
| `'selection-end'` | `start` שניות לפני סוף הבחירה | `end` שניות לפני סוף הבחירה |

סוף הפרויקט הוא הפריים האחרון שכל קטע מגיע אליו. המסלולים שנבחרו נשארים
כפי שהיו.

`sound.select.frames(startFrame, endFrame, options)` מגדיר את טווח הזמן ב
פריימים בקצב הדגימה של הפרויקט. `options.trackIds` קובע את המסלולים לבחירה; כאשר הוא מושמט, המסלולים שכבר נבחרו נשארים נבחרים.
הטווח מוגבל לציר הזמן והקצוות מוחלפים אם הם הפוכים.

`sound.select.tracks(options)` היא פקודת `SelectTracks` של Audacity. היא בוחרת
במסלולים שהאינדקס שלהם (ספירה מ-0) נמצא בטווח מ`options.track`
(ברירת מחדל 0) ומכסה `options.trackCount` מסלולים (ברירת מחדל 1). `options.mode` הוא
`'set'` להחלפת בחירת המסלולים, `'add'` להרחבתה, או `'remove'` ל
הוצאת המסלולים האלה ממנה. טווח הזמן נשאר כפי שהיה.

`sound.select.frequencies(options)` היא פקודת `SelectFrequencies` של Audacity.
היא מגדירה את הבחירה הספקטרלית ל`options.low` ו`options.high` בהרץ;
קצה שאתה משמיט שומר על ערכו הנוכחי.

`sound.select.all()` בוחרת את כל הפרויקט בכל מסלול.
`sound.select.none()` מנקה את הבחירה.

### `sound.effect(type, params)`

מחיל אפקט אחד על הבחירה הנוכחית, במסלול הממוקד. `type` הוא
מזהה אפקט מ[Effects a program can apply](#effects-a-program-can-apply),
ו`params` הוא אובייקט של פרמטרים של האפקט הזה. פרמטרים שאתה משמיט מקבלים
את ברירות המחדל של האפקט; הערכים נבדקים מול הטווחים ב
[audio effects reference](/reference/generated/audio-effects/). פותר ל
`null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

מחיל שרשרת של אפקטים על הבחירה הנוכחית בביצוע אחד, בדיוק כפי שיישום מקרו רשימת צעדים עם צעדים אלו. כל צעד הוא `{ type, params }`, ולשרשרת נדרש צעד אחד לפחות. פותר ל־`null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

מריץ אחת מתוך פקודות המאקרו של Audacity המפורטות תחת
[פקודות שניתן להריץ מתוך תוכנה](#commands-a-program-can-run). ארבע פקודות הבחירה מקבלות את הפרמטרים המפורטים שם; השאר אינן מקבלות פרמטרים. פותרת לבחירה לאחר מכן.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

מריץ מקרו של רשימת צעדים שנשמר באותו מנהל מקרו, לפי שמו המדויק,
כולל פקודות בחירה כלשהן שהוא מכיל. מקרו שנשמר אינו יכול להיות תוכנית,
לכן תוכניות אינן מקוננות. מתורגם ל-`null`; שם לא ידוע נדחה.

### זמן ואקראיות

הרצה היא רפרודוקטיבית: שתי הרצות של אותה תוכנית על אותו פרויקט קוראות
אותו דבר, מכיוון שהשעון והמספרים האקראיים אינם של המכשיר.

`Date.now()` ו-`new Date()` ללא ארגומנטים מחזירים שעון וירטואלי
שמתחיל ב-0 ומתקדם באחד לכל קריאה שהעורך ענה עליה, וב-`ms` לכל `sound.wait(ms)`. `sound.wait` מתורגם מיד; אין
דרך לתוכנית לעצור לזמן אמיתי, ואין צורך בכך, מכיוון שכל קריאה
לעורך מסתיימת לפני שההבטחה שלה מתממשת.

`Math.random()` ו-`sound.random()` הם אותו יצרן, מוזרע מ-`sound.env.seed`. רשום את הזרע אם אתה צריך לדעת איזו רצף הרצה השתמשה בו.

### בדיקת ההנחות שלך

`sound.assert(condition, message)` זורק `message` כאשר `condition` הוא כוזב.
`sound.assertEqual(actual, expected, message)` משווה את שני הערכים כ-JSON
וזורק כאשר הם שונים, עם הודעה שמציין את שני הערכים אם אינך נותן
אף אחד. מכיוון ששגיאה שזורקה מסתיימת בהרצה ומבטלת את כל מה שקדם לה, טענה
שנכשלה משאירה את הפרויקט ללא שינוי. שום שיטה אינה מחזירה הבטחה.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## ערכים העוברים לעורך

כל ארגומנט שמעביר תוכנה וכל ערך שהיא מקבלת הם נתונים רגילים:
`null`, ערכים לוגיים, מספרים סופיים, מחרוזות, ומערכים ואובייקטים רגילים של
אלה. `NaN`, `Infinity`, פונקציות, מופעים של מחלקות, מערכים טיפוסיים ו`Date`
אובייקטים נדחים עם שגיאה, כמו גם כל ערך גדול מ-1 MiB, מקונן יותר מ-12 רמות, או מכיל יותר מ-4,096 רשומות במערך או באובייקט אחד.
`undefined` תכונות נפלטות.

## מגבלות

| מגבלה | ערך |
| --- | --- |
| אורך התוכנה | 256 KiB |
| קריאות לעורך בכל הרצה | 4,096 |
| שינויים בפרויקט בכל הרצה (קריאות בחירה, אפקטים, פקודות) | 256 |
| קריאות המתנות לתשובה בו-זמנית | 8 |
| זמן הרצה | 120 שניות |
| ערך אחד העובר לעורך או ממנו | 1 MiB, 12 רמות, 4,096 רשומות למערך או לאובייקט |
| יומן | 1,000 שורות או 256 KiB; 4,096 תווים לשורה |
| תוכניות בספרייה | 128 |
| שם התוכנה | 256 תווים |
| קובץ תוכנה יובא | 1 MiB |

לולאה הבוחרת כל קליפ ומחילה אפקט אחד מוציאה שני שינויים לכל
קליפ, ולכן היא יכולה לכסות 128 קליפים לפני שהתקציב נגמר.

## שגיאות

קריאה שהעורך דוחה דוחה את הבטחתה עם `Error` ש`message`
מסביר למה: פקודה מחוץ למילון, אפקט על בחירה ריקה,
פרמטר מחוץ לטווח. השגיאה נושאת גם `code`, שהוא
`MACRO_CALL_FAILED` אלא אם כן העורך סיפק אחד ספציפי יותר. תוכנה
עשויה לכפוף אותם ולהמשיך:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

התוכנית מסתיימת, והיומן שלה קורא *refused: Unsupported macro command:
ExportWav.*

שגיאה שהתוכנית אינה תופסת מסיימת את הרצון, מחזירה את הפרויקט, ומוצגת בלוח יחד עם השורה ממנה הגיעה. תוכנית שאינה מתקמפלת מדווחת באותו אופן לפני שכל דבר מריץ.

## אפקטים שתוכנית יכולה להחיל {#effects-a-program-can-apply}

אלה הם מזהי האפקטים `sound.effect` ו-`sound.effects` מקבלים, עם מפתחות הפרמטרים שכל אחד מהם לוקח והערכים המוגדרים כברירת מחדל. טווחים ויחידות נמצאים ב[הפניה לאפקטי אודיו](/reference/generated/audio-effects/). תוספים של Nyquist אינם ניתנים להחלה מתוכנית.

| אפקט | מזהה אפקט | פרמטרים וערכים מוגדרים כברירת מחדל |
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
| Fade In | `audacity-fade-in` | אין |
| Fade Out | `audacity-fade-out` | אין |
| Filter Curve EQ | `audacity-filter-curve-eq` | `points`: מערך של `{ frequency, gain }`, ברירת מחדל שתי נקודות שטוחות ב-20 הרץ ו-20 קילוהרץ; `linearFrequencyScale: false`; `filterLength: 8191` |
| Four-band parametric EQ | `eq` | `outputGain: 0`; `bands`: ארבעה אובייקטים `{ id, enabled, type, frequency, gain, q, slope }`, עם שיא ב-100, 500, 2000 ו-8000 הרץ עם `gain: 0`, `q: 1`, `slope: 12` |
| Gate | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Graphic EQ | `audacity-graphic-eq` | `gains`: 31 תחומי הגברה בדציבלים, כולם 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| High-pass filter | `highpass` | `frequency: 80`, `q: 0.707` |
| Invert | `audacity-invert` | אין |
| Legacy Compressor | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limiter | `limiter` | `ceiling: -1`, `lookahead: 0.005`, `release: 0.1` |
| Limiter (Audacity) | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Loudness Normalization | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Low-pass filter | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Noise Reduction | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalize | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Remove DC Offset | `audacity-remove-dc-offset` | אין |
| Repair | `audacity-repair` | אין |
| Repeat | `audacity-repeat` | `count: 1` |
| Reverb | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Reverb (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Reverse | `audacity-reverse` | none |
| Sliding Stretch | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Truncate Silence | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Utility Gain (Reviewed) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

שני אפקטים דורשים משהו שתוכנה אינה יכולה לספק. הפחתת רעש דורשת פרופיל רעש שנלכד בחלון האפקט עצמו, ו-Auto Duck דורש עקב בקרה מתחת לעקב הממוקד.

## פקודות שתוכנה יכולה להפעיל {#commands-a-program-can-run}

`sound.command` מקבל את שמות פקודות המאקרו של Audacity המפורטות להלן. אלו הם אותם שמות שרשימת צעדים יכולה להחזיק, ולכן לתוכנה ולרשימת צעדים יש היקף פעולה זהה לחלוטין. כל פקודה מפעילה את פעולת העורך ש[ההפניה לפקודות](/reference/generated/commands/) מתארת.

### פקודות בחירה עם פרמטרים

| פקודה | פרמטרים |
| --- | --- |
| `SelectTime` | `start`, `end` בשניות; `relativeTo` כפי ש-`sound.select.time` |
| `SelectFrequencies` | `low`, `high` בהרץ |
| `SelectTracks` | `track`, `trackCount` (0 עד 100); `mode` של `'set'`, `'add'` או `'remove'` |
| `Select` | כל שילוב של שלושת הקבוצות לעיל |

פרמטר שאתה משאיר מן הסתם משאיר את חלק זה של הבחירה כפי שהוא, וזהו גם האופן שבו Audacity קוראת אותם.

### פקודות ללא פרמטרים

| קבוצה | פקודות |
| --- | --- |
| בחירה | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| עריכה | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| עקבים | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| תוויות | `AddLabel` |
| ניתוח | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### מה חסר במכוון

`Undo` ו-`Redo` חסרים משום שריצה היא כבר רשומת היסטוריה אחת, וצעד שחלף על פני ההיסטוריה היה מגיע מעבר לריצה ועד לעריכות שלך. פקודות תעבורה והקלטה חסרות משום שלתוכנה אין מה לחכות לו ואינה יכולה להתבטל מההקלטה. פתיחה, שמירה, סגירה, ייבוא, ייצוא והעדפות חסרות משום שההיקף של התוכנה הוא הפרויקט היחיד שהיה פתוח כשהיא התחילה. פקודות שפותחות חלון בלבד או משנות את התצוגה חסרות משום שהן אינן משנות דבר בפרויקט.

## שיתוף תוכניות {#sharing-programs}

**ייצוא תוכנית** כותב את התוכנית הנבחרת כקובץ `.soundscapemacro`, ו-**ייבוא תוכנית** קורא אחד. הקובץ הוא JSON ולא קובץ `.js` גולמי, כך ששום דבר במחשב המקבל לא יטעה אותו למשהו שיש להריץ מחוץ לעורך:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

ייבוא שומר את הטקסט בלבד. לתוכנית שייובאה אין כפתור **הרצת תוכנית**; במקומו, החלונית מציגה את התוכנית, את הקובץ ממנו הגיעה, הערה על מה שתוכנית יכולה לעשות לפרויקט הפתוח, ותיבת בחירה המציגה *קראתי תוכנית זו ורוצה להריץ אותה.* סימון תיבה זו מאפשר את **הפעלת תוכנית זו**, ורק אז ניתן להריץ את התוכנית.

הרשאה זו מתייחסת לטקסט המדויק שקראת. אם התוכנית משתנה בהמשך, בין אם אתה עורך אותה או מייבא עותק חדש יותר במקומה, הביקורת מופיעה שוב עד שתאשר את הטקסט החדש. תוכניות שאתה כותב בעצמך במנהל אינן דורשות ביקורת.

## דוגמאות

הבהה כל קליפ בעקבה הראשונה שבה יש קליפים. לחץ על כותרת העקבה לפני ההרצה, כדי שהאפקט יופיע בעקבה שהתוכנית קוראת:

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

דווח על הפרויקט ללא שינוי:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

הרצת מקרו של רשימת צעדים ששמורה רק כאשר הבחירה ארוכה מספיק:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## אודות דף זה

כל תוכנית בדף זה, מהקטעים בשורה אחת ועד לדוגמאות המפורטות,
נבדקת מול כל בנייה של Soundscaper באמצעות סוויטת הדפדפן
(`tests/browser/handbook-macro-program-examples.spec.js`), הקוראת את התוכניות מתוך הטקסט של הדף עצמו. תוכנית שפוסקת להשלים, או שפוסקת לייצר את מה שהדף מצהיר שהוא מייצר, גורמת לכישלון הבנייה עד שהדף או העורך יתוקנו.
