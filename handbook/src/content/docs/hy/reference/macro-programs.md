---
title: "Մակրո ծրագրեր"
description: "JavaScript API-ն, որի նկատմամբ գործում է մակրո ծրագիրը, դրա գործունեության սահմանափակումները և այն ֆայլը, որի մեջ այն տեղափոխվում է։"
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","targetLocale":"hy"} -->

Մակրո ծրագիրը մակրո է, որը գրված է JavaScript-ով՝ քայլերի ցանկի փոխարեն։
Այն աշխատում է խմբագրիչի ներսում՝ փոքրիկ API-ի դեմ, որը կոչվում է `sound`, և թույլ է տալիս կարդալ
բաց նախագիծը, տեղափոխել ընտրությունը և կիրառել նույն ազդեցություններն ու հրամանները, որոնք կարող է կիրառել
քայլերի ցանկի մակրոն։ Այլ ամեն ինչ, սկսած ֆայլերից և ցանցից մինչև ձեր
այլ նախագծերը, գտնվում է դրա հասանելիության սահմաններից դուրս։

Ծրագրերը Soundscaper-ի հատկանիշն են։ Framescaper-ը չունի մակրո մենեջեր։

## Ծրագրերի տեղակայումը

Ընտրեք **Tools → Macro manager**։ Դիալոգային պատուհանը ցուցադրում է քայլերի ցանկի մակրոները և, **Programs**
բաժնում, ձեր պահպանած ծրագրերը։ **New program**-ը ստեղծում է մեկը, իսկ
մանրամասն թվաքարտը ցուցադրում է դրա **Program name**-ը, **Program** տեքստը և **Run
program** կոճակը։ Տեքստը պահպանվում է ձեր գրելիս. առանձին պահպանման քայլ չկա։

Ծրագիրը պահվում է խմբագրիչի կարգավորումների հետ միասին, ոչ թե նախագծի ներսում, ուստի այն
հասանելի է յուրաքանչյուր նախագծում, որը բացում եք այս խմբագրիչում։ Կիրառեք **Export program** և
**Import program**-ը՝ այն տեղափոխելու համար մեկ այլ մեքենա կամ մեկ այլ անձ. տե՛ս
[Sharing programs](#sharing-programs)՝ դրանից բխողը հասկանալու համար։

[Apply the same chain of effects every time](/guides/effects/apply-the-same-effects-every-time/)
մեկնաբանությունը ծածկում է նույն դիալոգային պատուհանի քայլերի ցանկի կողմը։

## Ծրագրի գրումը

Ծրագիրը `async` ֆունկցիայի մարմինն է, որը գործարկվում է խիստ ռեժիմում։ Սա նշանակում է, որ
կարող եք `await` վերին մակարդակում, հայտարարել փոփոխականներ և ֆունկցիաներ, և օգտագործել բոլոր
սովորական լեզվական հատկանիշները։ `sound` օբյեկտը ծրագրի միակ կապն է
խմբագրիչի հետ, և դրա վրա կատարված յուրաքանչյուր կանչը վերադարձնում է խոստում (promise)։

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Tab-ը ինսերտում է երկու տարածություն ծրագրի դաշտում։ Սեղմեք Escape-ը, ապա Tab-ը՝ դաշտից դուրս գալու համար։

### Ի՞նչ կարող է օգտագործել ծրագիրը

Սովորական JavaScript-ի ստանդարտ գրադարանը ներկայացված է. `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, տիպավորված զանգվածները, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` և `queueMicrotask`։ `console`
նաև ներկայացված է, և ամեն ինչ, ինչ գրվում է դրա վրա, հայտնվում է ծրագրի օրագրում։

### Ի՞նչ չի կարող օգտագործել ծրագիրը

Ծրագիրը գործարկվում է աշխատողի (worker) մեջ, որի հնարավորությունները հանված են առաջին տողի գործարկումից առաջ։ Ցանկից ոչ մի բան չի գոյություն ունենում ծրագրի ներսում. `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` և `setInterval`։ Դրանցից ցանկացածը կարդալը տալիս է `undefined`։

Ծրագիրը չի կարող `import` մոդուլ. ստատիկ `import`-ը սինտակսիսի սխալ է այն
տողում, որտեղ այն գտնվում է։ Ինչ-որ բան, որի կարիք ունի ծրագիրը, պետք է լինի ծրագրի ներսում։

Անվտանգության սահմանը բացակայող գլոբալները չեն, այլ ինքն իսկ խմբագրիչը. այն
պատասխանում է միայն այս էջում ցուցակացված կանչերին և մերժում է ամեն ինչ անունով,
ինչ կարող է ուղարկել ծրագիրը։

## Ծրագրի գործարկումը

Սեղմեք **Run program**։ Ամբողջ գործարկումը նախագծի պատմության մեկ գրառումն է, ուստի
մեկ **Undo**-ն հակադարձում է ամեն ինչ, ինչ արել է ծրագիրը, անկախ փոփոխությունների քանակից։
Եթե ծրագիրը բացառություն է նետում, կամ չեղարկվում է, կամ գերազանցում է իր ժամկետը, նախագիծը
վերականգնվում է ճիշտ նույն վիճակում, ինչպես գործարկումից առաջ։

**Cancel run**-ը անմիջապես կանգնեցնում է ծրագիրը։ Ծրագիրը, որը գործարկված է երկու
րոպե, կանգնեցվում է նույն կերպ, *The macro ran for longer than
120 seconds.* հաղորդագրությամբ։

Գործարկումից հետո թվաքարտը ցուցադրում է ծրագրի օրագիրը, իսկ գործարկումն ավարտվելու դեպքում՝ *Program applied.*
հաղորդագրությունը։ Չարդյունավետ գործարկումը ցուցադրում է *The program failed on line N:* և
սխալի հաղորդագրությունը, որտեղ տողի համարը ձեր ծրագրի այն տողն է, որը բացառություն է նետել։

### Ի՞նչ ձայնային տվյալների վրա է ազդում ազդեցությունը

Ծրագրի կողմից կիրառված ազդեցությունը գործում է ֆոկուսավորված հոսքի ներկայիս ժամանակային ընտրության վրա, որը այն հոսքն է, որի վերնագիրը վերջին անգամ սեղմել եք կամ որի կլիպը վերջին անգամ ընտրել եք։ Եթե ժամանակային ընտրություն չկա, բայց կլիպ է ընտրված, ազդեցությունը ծածկում է այդ կլիպը։ Ծրագրի ընտրության կանչերը փոխում են ժամանակային տիրույթը և ընտրված հոսքերի հավաքածուն, բայց ոչ թե ֆոկուսավորված հոսքը, ուստի մեկ գործարկումը մշակում է մեկ հոսք։ Եթե ոչինչ չի ֆոկուսավորված կամ ընտրությունը դատարկ է, գործարկումը ձախողվում է նույն հաղորդագրությամբ, ինչը տալիս է Effect մենյուն։

## `sound` API

Ցանկից յուրաքանչյուր մեթոդը վերադարձնում է խոստում (promise), եթե այլ կերպ չի նշված։ Սպասեք յուրաքանչյուր կանչին՝ հաջորդը կատարելուց առաջ. ծրագիրը, որը սկսում է ավելի քան ութ կանչ՝ դրանք սպասելու առանց, ութերորդը մերժվում է։

### `sound.env`

Պարզ օբյեկտ, որը նկարագրում է գործարկումը։

| Դաշտ | Նշանակություն |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | Խմբագրիչի ինտերֆեյսի լեզուն, օրինակ՝ `"en"` կամ `"de"`։ |
| `seed` | Բազան, որից գալիս են գործարկման պատահական թվերը։ Նոր է յուրաքանչյուր գործարկման համար։ |
| `startedAt` | Գործարկման սկսած պահը, որպես ISO 8601 տեքստ։ |
| `dryRun` | Ներկայումս միշտ `false`։ Պահուստ։ |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` և `sound.log.debug(...values)` գրում են մեկական տող
gործարկման օրագրին։ `console.log`, `console.info`, `console.warn`,
`console.error` և `console.debug` անում են նույնը։ Ոչ տեքստային արժեքները
գրվում են որպես JSON։ Այս մեթոդները ոչինչ չեն վերադարձնում և չեն պահանջում սպասում։

Օրագիրը պահում է առավելագույնը 1,000 տող կամ 256 KiB, ինչը նախապես լինի, և յուրաքանչյուր տողը կտրվում է 4,096 նիշից։ Այդ սահմանից ավելի տողերը թափանցվում և հաշվարկվում են. հաշվարկը հաղորդվում է որպես վերջնական զգուշացում։

### `sound.project`

Կարգավորման կարդալը երբեք չի փոխում այն և չի հաշվարկվում գործողության փոփոխությունների բյուջեի հաշվին։

`sound.project.snapshot()` վերադարձնում է `{ sampleRate, tracks, selection }`, որտեղ `tracks` և `selection` ներկայացված են ներքևի երկու կանչերի կողմից վերադարձված ձևով։ `sampleRate` կարգավորման նմուշավորման հաճախությունն է հերցով, ինչը այս էջի վրա բոլոր կադրերի հաշվարկի միավորն է։

`sound.project.tracks()` վերադարձնում է ժամանակագրության կարգով հոսանքների զանգված։

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` վերադարձնում է մեկ հոսանքի կլիպերը կամ բոլոր հոսանքների կլիպերը, երբ `trackId` բաց թողնվում է։

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` վերադարձնում է ընթացիկ ընտրությունը։

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Յուրաքանչյուր ընտրության կանչը հաշվարկվում է որպես մեկ փոփոխություն և վերադարձնում է ստեղծված ընտրությունը `sound.project.selection()` վերադարձրած ձևով։

`sound.select.time(start, end, options)` սահմանում է ժամանակային միջակայքը վայրկյաններով։ Այն Audacity-ի `SelectTime` հրամանն է, և `options.relativeTo` ընտրում է, թե որտեղից է չափվում յուրաքանչյուր եզրը։ Երկու եզրերն էլ կարող են լինել -100 վայրկյանից ցածր։

| `relativeTo` | Սկզբնական եզր | Ավարտի եզր |
| --- | --- | --- |
| `'project-start'` (լռելյայն) | `start` վայրկյան կարգավորման սկզբից | `end` վայրկյան կարգավորման սկզբից |
| `'project'` | `start` վայրկյան կարգավորման սկզբից | `end` վայրկյան կարգավորման ավարտից հետո |
| `'project-end'` | `start` վայրկյան կարգավորման ավարտից առաջ | `end` վայրկյան կարգավորման ավարտից առաջ |
| `'selection-start'` | `start` վայրկյան ընտրության սկզբից հետո | `end` վայրկյան ընտրության սկզբից հետո |
| `'selection'` | `start` վայրկյան ընտրության սկզբից հետո | `end` վայրկյան ընտրության ավարտից հետո |
| `'selection-end'` | `start` վայրկյան ընտրության ավարտից առաջ | `end` վայրկյան ընտրության ավարտից առաջ |

Կարգավորման ավարտը վերջին կադրն է, որին ցանկացած կլիպ հասնում է։ Ընտրված հոսանքները մնում են իրենց նախկին վիճակում։

`sound.select.frames(startFrame, endFrame, options)` սահմանում է ժամանակային միջակայքը կադրերով՝ կարգավորման նմուշավորման հաճախությամբ։ `options.trackIds` անվանում է ընտրվող հոսանքները. երբ այն բաց թողնվում է, արդեն ընտրված հոսանքները մնում են ընտրված։ Միջակայքը սահմանափակվում է ժամանակագրությամբ, և եզրերը փոխանջատվում են, եթե հակադարձ են։

`sound.select.tracks(options)` Audacity-ի `SelectTracks` հրամանն է։ Այն ընտրում է հոսանքները, որոնց ինդեքսը (հաշվված 0-ից) գտնվում է `options.track` (լռելյայն 0) միջակայքում՝ ընդգրկելով `options.trackCount` հոսանք (լռելյայն 1)։ `options.mode` է `'set'`՝ հոսանքների ընտրությունը փոխարինելու համար, `'add'`՝ լայնացնելու համար, կամ `'remove'`՝ այդ հոսանքները դրանից հանելու համար։ Ժամանակային միջակայքը մնում է իր նախկին վիճակում։

`sound.select.frequencies(options)` Audacity-ի `SelectFrequencies` հրամանն է։ Այն սահմանում է սպեկտրալ ընտրությունը `options.low` և `options.high` հերցով. բաց թողնված եզրը պահպանում է իր ընթացիկ արժեքը։

`sound.select.all()` ընտրում է ամբողջ կարգավորումը բոլոր հոսանքներում։
`sound.select.none()` մաքրում է ընտրությունը։

### `sound.effect(type, params)`

Կիրառում է մեկ էֆեկտ ընթացիկ ընտրության վրա՝ կենտրոնացված հոսանքի վրա։ `type` էֆեկտի ID է [Էֆեկտներ, որոնք ծրագիրը կարող է կիրառել](#effects-a-program-can-apply) բաժնից,
և `params` այդ էֆեկտի պարամետրերի օբյեկտն է։ Բաց թողնված պարամետրերը վերցնում են էֆեկտի լռելյայն արժեքները. արժեքները ստուգվում են [Ձայնային էֆեկտների հղում](/reference/generated/audio-effects/) բաժնի միջակայքերի համաձայն։ Վերադարձնում է
`null`։

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Կիրառում է էֆեկտների շղթա ընթացիկ ընտրության վրա մեկ անցումով, ճիշտ այնպես, ինչպես քայլերի ցանկի մակրոն այդ քայլերով կանի։ Յուրաքանչյուր քայլը `{ type, params }` է, և շղթան պահանջում է առնվազն մեկ քայլ։ Վերադարձնում է `null`։

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Գործարկում է Audacity-ի մակրո հրամաններից մեկը, որոնք ցուցակված են
[Հրամաններ, որոնք ծրագիրը կարող է գործարկել](#commands-a-program-can-run) բաժնում։ Չորս ընտրության հրամանները վերցնում են այնտեղ նկարագրված պարամետրերը. մյուսները պարամետրեր չեն վերցնում։ Վերադարձնում է
ընտրությունը հետո։

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Գործարկում է քայլերի ցանկի մակրո, որը պահված է նույն մակրո կառավարիչում, ըստ իր ճշգրիտ անվան,
ներառյալ դրանում պարունակվող ցանկացած ընտրության հրամանները։ Պահված մակրոն ինքնուրույն ծրագիր չի կարող լինել, ուստի ծրագրերը չեն նստվում։ Վերադարձնում է `null`. անհայտ անունը մերժվում է։

### Ժամանակ և պատահականություն

Գործողությունը վերարտադրելի է. նույն ծրագրի երկու գործողությունները նույն կարգավորման վրա կարդում են նույնը, քանի որ ժամացույցը և պատահական թվերը մեքենայինը չեն։

`Date.now()` և `new Date()` առանց արգումենտների վերադարձնում են վիրտուալ ժամացույց, որը սկսվում է 0-ից և աճում է մեկով յուրաքանչյուր պատասխանված կանչի համար խմբագրիչին, և `ms`-ով յուրաքանչյուր `sound.wait(ms)`-ի համար։ `sound.wait` անմիջապես լուծվում է. ծրագրի համար իրական ժամանակի համար կանգ առնելու ուղի չկա, և այն անհրաժեշտ չէ, քանի որ խմբագրիչին ուղղված յուրաքանչյուր կանչն ավարտվում է նրա խոստումից առաջ։

`Math.random()` և `sound.random()` նույն գեներատորն են, սերիավորված `sound.env.seed`-ից։ Օրագրեք սերիան, եթե անհրաժեշտ է իմանալ, թե որ հաջորդականությունն է օգտագործվել գործողության ընթացքում։

### Ձեր ենթադրությունների ստուգում

`sound.assert(condition, message)` նետում է `message` երբ `condition` կեղծ է։
`sound.assertEqual(actual, expected, message)` համեմատում է երկու արժեքները որպես JSON
և նետում է, երբ դրանք տարբեր են, հաղորդագրությամբ, որը անվանում է երկու արժեքները, եթե դուք
չեք տվել ոչինչ։ Քանի որ նետված սխալը ավարտում է գործընթացը և վերադարձնում է ամեն ինչ նախքան այն, ձախողված
հաստատումը թողնում է նախագիծը չպատճառված։ Երկու մեթոդն էլ չեն վերադարձնում խոստում։

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Արժեքներ, որոնք անցնում են խմբագրիչ

Ինչպես յուրաքանչյուր արգումենտը, որը ծրագիրը փոխանցում է, այնպես էլ յուրաքանչյուր արժեքը, որը այն ստանում է, պարզ տվյալներ են՝
`null`, զրոյականներ, վերջավոր թվեր, շարքեր և այդ տեսակի զանգվածներ և պարզ օբյեկտներ։ `NaN`, `Infinity`, ֆունկցիաներ, դասերի օրինակներ, տիպավոր զանգվածներ և `Date`
օբյեկտները մերժվում են սխալի հետ, ինչպես նաև ցանկացած արժեք, որը ավելի մեծ է, քան 1 MiB, ավելի խորը, քան 12 մակարդակ, կամ պարունակում է ավելի քան 4,096 մուտք մեկ զանգվածում կամ օբյեկտում։
`undefined` հատկանիշները ջնջվում են։

## Սահմանափակումներ

| Սահմանափակում | Արժեք |
| --- | --- |
| Ծրագրի երկարություն | 256 KiB |
| Խմբագրիչին կանչեր մեկ գործընթացում | 4,096 |
| Նախագծի փոփոխություններ մեկ գործընթացում (ընտրության կանչեր, էֆեկտներ, հրամաններ) | 256 |
| Պատասխանի սպասող կանչեր միաժամանակ | 8 |
| Գործընթացի ժամանակ | 120 վայրկյան |
| Մեկ արժեք, որը անցնում է խմբագրիչ կամ դրանից | 1 MiB, 12 մակարդակ խորությամբ, 4,096 մուտք յուրաքանչյուր զանգվածի կամ օբյեկտի համար |
| Օրագիր | 1,000 տող կամ 256 KiB; 4,096 նիշ յուրաքանչյուր տողի համար |
| Ծրագրեր գրադարանում | 128 |
| Ծրագրի անուն | 256 նիշ |
| Իմպորտված ծրագրի ֆայլ | 1 MiB |

Կրկնությունը, որը ընտրում է յուրաքանչյուր կլիպը և կիրառում է մեկ էֆեկտ, ծախսում է երկու փոփոխություն յուրաքանչյուր կլիպի համար, ուստի այն կարող է ծածկել 128 կլիպ, մինչև բյուջեն սպառվի։

## Սխալներ

Կանչը, որը խմբագրիչը մերժում է, մերժում է իր խոստումը `Error`-ով, որի `message`
ասում է, թե ինչու՝ վոկաբուլյարից դուրս հրաման, դատարկ ընտրության վրա էֆեկտ,
պարամետր միջակայքից դուրս։ Սխալը նաև կրում է `code`, որը
`MACRO_CALL_FAILED` է, եթե խմբագրիչը չի տրամադրել ավելի կոնկրետ մեկը։ Ծրագիրը
կարող է բռնել դրանք և շարունակել։

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Այդ ծրագիրը ավարտում է, և նրա օրագիրը կարդում է *refused: Unsupported macro command:
ExportWav.*

Սխալը, որը ծրագիրը չի բռնում, ավարտում է գործընթացը, վերադարձնում է նախագիծը և ցուցադրվում է վահանակում՝ նրա տողով, որտեղից այն եկել է։ Ծրագիրը, որը չի կարող կոմպիլացվել, հաղորդվում է նույն կերպ, նախքան ցանկացած բան գործարկվելը։

## Էֆեկտներ, որոնք ծրագիրը կարող է կիրառել {#effects-a-program-can-apply}

Այս օրինակներն են էֆեկտների ID-ները, որոնք `sound.effect` և `sound.effects` ընդունում են, յուրաքանչյուրի պարամետրերի բանալիներով և դրանց լռելյայն արժեքներով։ Միջակայքերը և միավորները գտնվում են
[ձայնային էֆեկտների հղում](/reference/generated/audio-effects/)-ում։ Nyquist
ստեղծվածները չեն կարող կիրառվել ծրագրից։

| Էֆեկտ | Էֆեկտի ID | Պարամետրեր և լռելյայն արժեքներ |
| --- | --- | --- |
| Ամպլիֆայ | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Ավտո Դաք | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Բաս և Տրեբլ | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Բիթկրաշեր | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Փոխել Տոնը | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Փոխել Արագությունը և Տոնը | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Փոխել Տեմպը | `audacity-change-tempo` | `tempoPercent: 0` |
| Կլասիկ Ֆիլտրեր | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Կլիկի հեռացում | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Կոմպրեսոր | `compressor` | `threshold: -24`, `knee: 30`, `ratio: 4`, `attack: 0.003`, `release: 0.25`, `makeupGain: 0` |
| Կոմպրեսոր (Audacity) | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Կանգնեցում | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Դիստորշն | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Էխո | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Ֆեյդ Ին | `audacity-fade-in` | ոչինչ |
| Ֆեյդ Աուտ | `audacity-fade-out` | ոչինչ |
| Ֆիլտրի Կորի EQ | `audacity-filter-curve-eq` | `points`: `{ frequency, gain }`-ի զանգված, լռելյայն երկու հարթ կետ 20 Հց և 20 կՀց; `linearFrequencyScale: false`; `filterLength: 8191` |
| Չորս շերտանի պարամետրիկ EQ | `eq` | `outputGain: 0`; `bands`: չորս `{ id, enabled, type, frequency, gain, q, slope }` օբյեկտ, գագաթնակետեր 100, 500, 2000 և 8000 Հց-ում `gain: 0`, `q: 1`, `slope: 12` |
| Գեյթ | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Գրաֆիկական EQ | `audacity-graphic-eq` | `gains`: 31 շերտանի ամպլիֆիկացիա դեցիբելներով, բոլորը 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| Բարձր անցուցիչ | `highpass` | `frequency: 80`, `q: 0.707` |
| Փոխարինում | `audacity-invert` | ոչինչ |
| Պատմական սեղմիչ | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Սահմանափակիչ | `limiter` | `ceiling: -1`, `lookahead: 0.005`, `release: 0.1` |
| Սահմանափակիչ (Audacity) | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Լարվածության նորմալացում | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Ցածր անցուցիչ | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Շփոթի կրճատում | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Նորմալացում | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Ֆազեր | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| DC շեղման հեռացում | `audacity-remove-dc-offset` | ոչինչ |
| Վերականգնում | `audacity-repair` | ոչինչ |
| Վերադարձ | `audacity-repeat` | `count: 1` |
| Էխո | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Էխո (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Հակադարձ | `audacity-reverse` | ոչինչ |
| Շարժվող ձգում | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Խաղաղության կրճատում | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Օգտակար ամպլիտուդ (Դիտարկված) | `reviewed-utility-gain` | `gain: 1` |
| Ուաուա | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Երկու էֆեկտների համար անհրաժեշտ է այն, ինչը ծրագիրը չի կարող ապահովել։ Շփոթի կրճատման համար անհրաժեշտ է շփոթի պրոֆիլ, որը գրանցված է էֆեկտի սեփական զրուցակալում, իսկ Auto Duck-ի համար՝ կառավարիչ հոսք, որը գտնվում է կենտրոնացվածից ցածր։

## Ծրագրի կողմից կատարվող հրամաններ {#commands-a-program-can-run}

`sound.command` ընդունում է ներքևում նշված Audacity-ի մակրո հրամանների անունները։ Դրանք նույն անուններն են, որոնք կարող է պարունակել քայլերի ցանկի մակրոն, ուստի ծրագիրը և քայլերի ցանկը ունեն ճիշտ նույն հասանելիությունը։ Յուրաքանչյուր հրաման կատարում է խմբագրիչի գործողությունը, որը նկարագրվում է [հրամանների հղումներում](/reference/generated/commands/)։

### Պարամետրերով ընտրության հրամաններ

| Հրաման | Պարամետրեր |
| --- | --- |
| `SelectTime` | `start`, `end` վայրկյաններով։ `relativeTo` նույնը, ինչ `sound.select.time` |
| `SelectFrequencies` | `low`, `high` հերցով |
| `SelectTracks` | `track`, `trackCount` (0-ից 100)։ `mode` `'set'`, `'add'` կամ `'remove'` |
| `Select` | Վերը նշված երեք խմբերից ցանկացած համադրություն |

Եթե թողնում եք պարամետրը դատարկ, ապա ընտրության այդ մասը մնում է անփոփոխ, ինչպես Audacity-ն էլ կարդում է դրանք։

### Պարամետրերից զուրկ հրամաններ

| Խումբ | Հրամաններ |
| --- | --- |
| Ընտրություն | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Խմբագրում | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Հոսքեր | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Պիտակներ | `AddLabel` |
| Վերլուծություն | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Ինչ է ինքնաբուխ բացակայում

`Undo` և `Redo` բացակա են, քանի որ գործողությունը արդեն մեկ պատմության գրառում է, և պատմությունը քայլող քայլը գործողությունից անց կհասնի ձեր սեփական խմբագրումներին։
Տրանսպորտային և գրանցման հրամանները բացակա են, քանի որ ծրագիրը ոչինչ չի սպասում և չի կարող փոխարինվել գրանցումից դուրս բերելիս։
Բացումը, պահպանումը, փակումը, ներմուծումը, արտահանումը և կարգավորումները բացակա են, քանի որ ծրագրի հասանելիությունը այն մեկ նախագիծն է, որը բաց էր, երբ այն սկսվեց։
Հրամանները, որոնք միայն բացում են երկխոսության պատուհան կամ փոխում են տեսքը, բացակա են, քանի որ դրանք ոչինչ չեն փոխում նախագծում։

## Ծրագրերի կիսում {#sharing-programs}

**Ծրագրի արտահանումը** գրում է ընտրված ծրագիրը որպես `.soundscapemacro` ֆայլ, իսկ **Ծրագրի ներմուծումը** կարդում է մեկը։
Ֆայլը JSON է, ոչ թե մերկ `.js` ֆայլ, ուստի ընդունող համակարգիչը չի սխալի այն որպես ինչ-որ բան, որը պետք է գործարկել խմբագրիչից դուրս։

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

Ներմուծումը պահպանում է տեքստը և ոչինչ ավելի։ Ներմուծված ծրագիրը չունի **Ծրագրի գործարկում** կոճակ։
Այն փոխարենը, վահանակը ցույց է տալիս ծրագիրը, այն ֆայլը, որից այն եկել է, նշումն այն մասին, թե ինչ կարող է ծրագիրը անել բաց նախագծի հետ, և փոքրիկ փակագծով «Ես կարդացել եմ այս ծրագիրը և ցանկանում եմ այն գործարկել»։
Փակագծի նշումը ակտիվացնում է **Ակտիվացնել այս ծրագիրը**, և միայն այդ դեպքում կարող է ծրագիրը գործարկվել։

Այդ թույլտվությունը վերաբերում է ճիշտ նրան տեքստին, որը կարդացել եք։ Եթե ծրագիրը փոխվում է հետագայում, ինչպես և դուք այն խմբագրում եք, կամ ներմուծում եք ավելի նոր պատճեն, վերանայումը կրկին կհայտնվի, մինչև ակտիվացնեք նոր տեքստը։
Ծրագրերը, որոնք դուք գրում եք կառավարիչում ձեզ, չեն պահանջում վերանայում։

## Օրինակներ

Կտրուք բոլոր կլիպերը առաջին հոսանքում, որն ունի որևէ։ Կտրեք այդ հոսանքի վերնագիրը գործարկումից առաջ, որպեսզի էֆեկտը հասնի այն հոսանքին, որը ծրագիրը կարդում է։

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

Հաշվետվեք նախագծի մասին՝ այն փոխելիս։

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Գործարկեք պահպանված քայլերի ցանկի մակրոն միայն այն դեպքում, երբ ընտրությունը բավականաչափ երկար է։

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## Այս էջի մասին

Այս էջի բոլոր ծրագրերը, մեկ տողանի փոքրիկ փաստաթղթերից մինչև աշխատանքային օրինակները, գործարկվում են Soundscaper-ի յուրաքանչյուր կառուցման դեմ՝ բրաուզերային հավաքածուի կողմից (`tests/browser/handbook-macro-program-examples.spec.js`), որը կարդում է ծրագրերը այս էջի սեփական տեքստից։
Ծրագիրը, որը դադարում է ավարտել, կամ դադարում է արտադրել այն, ինչ այս էջը ասում է, որ այն արտադրում է, ձախողում է կառուցումը, մինչև էջը կամ խմբագրիչը ուղղվի։
