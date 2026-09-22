---
title: "मैक्रो प्रोग्राम"
description: "मैक्रो प्रोग्राम जिस JavaScript API पर चलता है, उसकी सीमाएँ और जिस फ़ाइल में वह चलता है।"
sidebar:
  order: 7
---

<!-- docs-ai-provenance: {"factPacketSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"hi"} -->

मैक्रो प्रोग्राम चरणों की सूची के बजाय JavaScript में लिखा गया मैक्रो होता है।
यह एडिटर के भीतर `sound` नामक छोटी API के माध्यम से चलता है, जिससे यह खुले प्रोजेक्ट को पढ़ सकता है, चयन को बदल सकता है और वही इफ़ेक्ट व कमांड लागू कर सकता है जो चरणों वाली मैक्रो लागू कर सकती है। फ़ाइलों और नेटवर्क से लेकर आपके दूसरे प्रोजेक्ट तक बाकी सब इसकी पहुँच से बाहर है।

प्रोग्राम Soundscaper की सुविधा है। Framescaper में मैक्रो मैनेजर नहीं है।

## प्रोग्राम कहाँ रहते हैं

**टूल्स → मैक्रो मैनेजर** चुनें। डायलॉग में चरणों वाली मैक्रो और **प्रोग्राम** के नीचे आपके सहेजे हुए प्रोग्राम दिखते हैं। नया प्रोग्राम बनाने के लिए प्रोग्राम हेडर में **+ (नया प्रोग्राम)** दबाएँ। उसी एक्शन बार में चुने गए प्रोग्राम के लिए **प्रोग्राम आयात करें**, **प्रोग्राम निर्यात करें** और **प्रोग्राम हटाएँ** मिलते हैं। विवरण पैनल में **प्रोग्राम का नाम**, **प्रोग्राम** टेक्स्ट और **प्रोग्राम चलाएँ** बटन दिखता है। टाइप करते ही टेक्स्ट सहेजा जाता है; अलग से सहेजने का चरण नहीं है।

प्रोग्राम एडिटर की सेटिंग के साथ सहेजा जाता है, प्रोजेक्ट के भीतर नहीं, इसलिए इस एडिटर में खोले गए हर प्रोजेक्ट में उपलब्ध रहता है। किसी दूसरे कंप्यूटर या व्यक्ति को भेजने के लिए **प्रोग्राम निर्यात करें** और **प्रोग्राम आयात करें** का उपयोग करें; इसमें क्या शामिल है, इसके लिए [प्रोग्राम साझा करना](#sharing-programs) देखें।

[हर बार वही इफ़ेक्ट शृंखला लागू करें](/guides/effects/apply-the-same-effects-every-time/) गाइड इसी डायलॉग के चरणों वाली मैक्रो वाले हिस्से को समझाती है।

## प्रोग्राम लिखना

प्रोग्राम `async` फ़ंक्शन का बॉडी होता है और strict mode में चलता है। इसलिए आप सबसे ऊपरी स्तर पर `await` कर सकते हैं, वैरिएबल और फ़ंक्शन घोषित कर सकते हैं और भाषा की सभी सामान्य सुविधाओं का उपयोग कर सकते हैं। `sound` ऑब्जेक्ट ही प्रोग्राम का एडिटर से एकमात्र संपर्क है और इसकी हर कॉल एक प्रॉमिस लौटाती है।

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

प्रोग्राम फ़ील्ड में Tab दो स्पेस डालता है। फ़ील्ड से बाहर निकलने के लिए Escape और फिर Tab दबाएँ।

### प्रोग्राम क्या उपयोग कर सकता है

सामान्य JavaScript मानक लाइब्रेरी उपलब्ध है: `Object`, `Array`, `Map`, `Set`, `Math`, `JSON`, `RegExp`, `Promise`, typed arrays, `Intl`, `TextEncoder`, `TextDecoder`, `structuredClone` और `queueMicrotask`। `console` भी उपलब्ध है और उसमें लिखा सब कुछ प्रोग्राम के लॉग में पहुँचता है।

### प्रोग्राम क्या उपयोग नहीं कर सकता

प्रोग्राम ऐसे worker में चलता है जिसकी क्षमताएँ पहली पंक्ति चलने से पहले हटा दी गई हैं। प्रोग्राम के भीतर इनमें से कोई मौजूद नहीं होता: `fetch`, `XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`, `location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`, `setTimeout` और `setInterval`। इनमें से किसी को पढ़ने पर `undefined` मिलता है।

प्रोग्राम किसी मॉड्यूल को `import` नहीं कर सकता; जिस पंक्ति में static `import` हो, वहाँ syntax error होता है। प्रोग्राम को जिसकी आवश्यकता है, वह उसी प्रोग्राम में होना चाहिए।

सुरक्षा सीमा गायब globals नहीं बल्कि स्वयं एडिटर है: यह केवल इस पेज पर दी गई कॉल का उत्तर देता है और प्रोग्राम चाहे जो भेज पाए, नाम के आधार पर बाकी सब अस्वीकार करता है।

## प्रोग्राम चलाना

**प्रोग्राम चलाएँ** दबाएँ। पूरा रन प्रोजेक्ट की हिस्ट्री में एक ही एंट्री होता है, इसलिए एक **पूर्ववत करें** प्रोग्राम द्वारा किए गए सभी बदलावों को उलट देता है, चाहे बदलाव कितने भी हों। प्रोग्राम त्रुटि दे, रद्द हो या समय-सीमा पार कर जाए, तो प्रोजेक्ट रन शुरू होने से ठीक पहले की स्थिति में लौट जाता है।

**रन रद्द करें** प्रोग्राम को तुरंत रोकता है। दो मिनट से चल रहे प्रोग्राम को भी इसी तरह रोका जाता है और संदेश मिलता है *मैक्रो 120 सेकंड से अधिक चला।*

रन के बाद पैनल प्रोग्राम का लॉग दिखाता है और रन पूरा होने पर उसके बाद *प्रोग्राम लागू किया गया।* दिखाता है। असफल रन में *प्रोग्राम पंक्ति N पर विफल हुआ:* और त्रुटि का संदेश दिखता है; पंक्ति संख्या उस प्रोग्राम की पंक्ति होती है जहाँ त्रुटि हुई।

### इफ़ेक्ट किस ऑडियो पर लगता है

प्रोग्राम से लागू इफ़ेक्ट फ़ोकस किए गए ट्रैक के वर्तमान समय-चयन पर चलता है। फ़ोकस किया गया ट्रैक वह है जिसके हेडर पर आपने आख़िरी बार क्लिक किया या जिसकी क्लिप आपने आख़िरी बार चुनी। समय-चयन न हो लेकिन कोई क्लिप चुनी हो, तो इफ़ेक्ट उसी क्लिप पर लगता है। प्रोग्राम की चयन कॉल समय-सीमा और चुने गए ट्रैक बदलती हैं, लेकिन फ़ोकस ट्रैक नहीं बदलतीं, इसलिए एक रन एक ही ट्रैक को प्रोसेस करता है। कुछ भी फ़ोकस न हो या चयन खाली हो, तो रन उसी संदेश के साथ विफल होता है जो इफ़ेक्ट मेनू देता है।

## `sound` API

नीचे दी गई हर विधि, जब तक अलग से न कहा गया हो, प्रॉमिस लौटाती है। अगली कॉल करने से पहले हर कॉल पर await करें; जो प्रोग्राम आठ से अधिक कॉल को await किए बिना शुरू करता है, उसकी नौवीं कॉल अस्वीकार कर दी जाती है।

### `sound.env`

रन का वर्णन करने वाला साधारण ऑब्जेक्ट।

| फ़ील्ड | अर्थ |
| --- | --- |
| `productId` | `"soundscaper"`। |
| `locale` | एडिटर की इंटरफ़ेस भाषा, जैसे `"en"` या `"de"`। |
| `seed` | रन की यादृच्छिक संख्याओं का स्रोत seed। हर रन के लिए नया। |
| `startedAt` | रन शुरू होने का wall-clock समय, ISO 8601 स्ट्रिंग के रूप में। |
| `dryRun` | इस समय हमेशा `false`। आरक्षित। |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`, `sound.log.error(...values)` और `sound.log.debug(...values)` रन के लॉग में एक-एक पंक्ति लिखते हैं। `console.log`, `console.info`, `console.warn`, `console.error` और `console.debug` भी यही करते हैं। जो मान स्ट्रिंग नहीं हैं, वे JSON के रूप में लिखे जाते हैं। ये विधियाँ कुछ नहीं लौटातीं और इनके लिए await करना आवश्यक नहीं है।

लॉग में अधिकतम 1,000 पंक्तियाँ या 256 KiB, जो पहले आए, रखी जाती हैं और हर पंक्ति 4,096 अक्षरों पर काट दी जाती है। इसके बाद की पंक्तियाँ हटा दी जाती हैं और उनकी गिनती की जाती है; यह गिनती अंतिम चेतावनी में बताई जाती है।

### `sound.project`

प्रोजेक्ट पढ़ने से वह कभी नहीं बदलता और रन के बदलाव बजट में नहीं गिना जाता।

`sound.project.snapshot()` `{ sampleRate, tracks, selection }` लौटाता है; `tracks` और `selection` वही होते हैं जो नीचे की दो कॉल लौटाती हैं। `sampleRate` प्रोजेक्ट की हर्ट्ज में सैंपल दर है, जिसके आधार पर इस पेज की हर फ़्रेम गिनती मापी जाती है।

`sound.project.tracks()` टाइमलाइन क्रम में ट्रैक की एरे लौटाता है:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` एक ट्रैक की क्लिप लौटाता है, या `trackId` न दिए जाने पर हर ट्रैक की क्लिप लौटाता है:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` वर्तमान चयन लौटाता है:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

हर selection कॉल एक बदलाव गिनी जाती है और `sound.project.selection()` के आकार में बनाया गया चयन लौटाती है।

`sound.select.time(start, end, options)` समय-सीमा सेकंड में सेट करता है। यह Audacity का `SelectTime` कमांड है और `options.relativeTo` तय करता है कि हर किनारा कहाँ से मापा जाए। दोनों किनारे -100 सेकंड तक कम हो सकते हैं।

| `relativeTo` | आरंभ किनारा | अंत किनारा |
| --- | --- | --- |
| `'project-start'` (डिफ़ॉल्ट) | प्रोजेक्ट के आरंभ से `start` सेकंड | प्रोजेक्ट के आरंभ से `end` सेकंड |
| `'project'` | प्रोजेक्ट के आरंभ से `start` सेकंड | प्रोजेक्ट के अंत के बाद `end` सेकंड |
| `'project-end'` | प्रोजेक्ट के अंत से `start` सेकंड पहले | प्रोजेक्ट के अंत से `end` सेकंड पहले |
| `'selection-start'` | चयन के आरंभ से `start` सेकंड बाद | चयन के आरंभ से `end` सेकंड बाद |
| `'selection'` | चयन के आरंभ से `start` सेकंड बाद | चयन के अंत से `end` सेकंड बाद |
| `'selection-end'` | चयन के अंत से `start` सेकंड पहले | चयन के अंत से `end` सेकंड पहले |

प्रोजेक्ट का अंत वह अंतिम फ़्रेम है जहाँ कोई क्लिप पहुँचती है। चुने हुए ट्रैक जैसे थे वैसे ही रहते हैं।

`sound.select.frames(startFrame, endFrame, options)` प्रोजेक्ट की सैंपल दर पर फ़्रेम में समय-सीमा सेट करता है। `options.trackIds` उन ट्रैक के नाम देता है जिन्हें चुनना है; इसे न देने पर पहले से चुने ट्रैक चुने हुए ही रहते हैं। सीमा को टाइमलाइन के भीतर रखा जाता है और उलटे क्रम में दिए गए किनारे आपस में बदल दिए जाते हैं।

`sound.select.tracks(options)` Audacity का `SelectTracks` कमांड है। यह उन ट्रैक को चुनता है जिनका index (0 से गिना गया) `options.track` (डिफ़ॉल्ट 0) से शुरू होने वाली `options.trackCount` ट्रैक (डिफ़ॉल्ट 1) की सीमा में है। `options.mode` ट्रैक चयन बदलने के लिए `'set'`, उसे बढ़ाने के लिए `'add'` या उन ट्रैक को निकालने के लिए `'remove'` हो सकता है। समय-सीमा जैसी थी वैसी रहती है।

`sound.select.frequencies(options)` Audacity का `SelectFrequencies` कमांड है। यह स्पेक्ट्रल चयन को हर्ट्ज में `options.low` और `options.high` पर सेट करता है; जिस किनारे को छोड़ दें, उसका वर्तमान मान बना रहता है।

`sound.select.all()` हर ट्रैक पर पूरा प्रोजेक्ट चुनता है।
`sound.select.none()` चयन साफ़ करता है।

### `sound.effect(type, params)`

फ़ोकस किए गए ट्रैक पर वर्तमान चयन में एक इफ़ेक्ट लागू करता है। `type` [प्रोग्राम जिन इफ़ेक्ट को लागू कर सकता है](#effects-a-program-can-apply) में दिया गया इफ़ेक्ट ID है और `params` उस इफ़ेक्ट के पैरामीटर का ऑब्जेक्ट है। छोड़े गए पैरामीटर इफ़ेक्ट के डिफ़ॉल्ट लेते हैं; मान [ऑडियो इफ़ेक्ट संदर्भ](/reference/generated/audio-effects/) में दी गई सीमाओं के अनुसार जाँचे जाते हैं। यह `null` पर resolve होता है।

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

वर्तमान चयन पर इफ़ेक्ट की शृंखला एक ही पास में लागू करता है, ठीक वैसे जैसे उन्हीं चरणों वाली सूची-मैक्रो करती। हर चरण `{ type, params }` होता है और शृंखला में कम से कम एक चरण होना चाहिए। यह `null` पर resolve होता है।

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

[प्रोग्राम द्वारा चलाए जा सकने वाले कमांड](#commands-a-program-can-run) में दिए गए Audacity मैक्रो कमांड में से एक चलाता है। चार selection कमांड वहाँ बताए पैरामीटर लेते हैं; बाकी कोई पैरामीटर नहीं लेते। इसके बाद यह चयन पर resolve होता है।

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

उसी मैक्रो मैनेजर में सहेजी गई चरणों वाली मैक्रो को उसके सटीक नाम से चलाता है, जिसमें उसके selection कमांड भी शामिल होते हैं। सहेजी गई मैक्रो स्वयं प्रोग्राम नहीं हो सकती, इसलिए प्रोग्राम एक-दूसरे के भीतर नहीं चल सकते। यह `null` पर resolve होता है; अज्ञात नाम अस्वीकार होता है।

### समय और यादृच्छिकता

रन पुनरुत्पाद्य होता है: एक ही प्रोजेक्ट पर उसी प्रोग्राम के दो रन एक ही चीज़ पढ़ते हैं, क्योंकि घड़ी और यादृच्छिक संख्याएँ मशीन की नहीं होतीं।

बिना तर्क वाले `Date.now()` और `new Date()` एक virtual clock लौटाते हैं जो 0 से शुरू होती है, एडिटर की हर उत्तरित कॉल पर एक से और हर `ms` मिलीसेकंड वाली `sound.wait(ms)` कॉल पर उतनी ही आगे बढ़ती है। `sound.wait` तुरंत resolve होता है; प्रोग्राम को वास्तविक समय के लिए रोकने का कोई तरीका नहीं है और इसकी आवश्यकता भी नहीं, क्योंकि एडिटर की हर कॉल का प्रॉमिस resolve होने से पहले वह पूरी हो जाती है।

`Math.random()` और `sound.random()` एक ही जनरेटर हैं, जिसे `sound.env.seed` से seed किया जाता है। किसी रन ने कौन-सी शृंखला उपयोग की, जानना हो तो seed लॉग करें।

### अपनी धारणाएँ जाँचें

`sound.assert(condition, message)` तब `message` throw करता है जब `condition` false हो। `sound.assertEqual(actual, expected, message)` दोनों मानों की JSON के रूप में तुलना करता है और अलग होने पर throw करता है; message न देने पर दोनों मानों का नाम बताने वाला संदेश बनाता है। Throw हुआ error रन समाप्त कर देता है और उससे पहले के सभी बदलाव वापस कर देता है, इसलिए विफल assertion प्रोजेक्ट को नहीं बदलता। कोई भी विधि प्रॉमिस नहीं लौटाती।

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## एडिटर तक जाने वाले मान

प्रोग्राम द्वारा भेजा गया हर आर्ग्युमेंट और प्राप्त किया गया हर मान साधारण डेटा होता है: `null`, boolean, finite संख्या, स्ट्रिंग और इनके एरे व साधारण ऑब्जेक्ट। `NaN`, `Infinity`, फ़ंक्शन, class instance, typed array और `Date` ऑब्जेक्ट error के साथ अस्वीकार होते हैं। 1 MiB से बड़ा, 12 स्तर से अधिक गहरा या किसी एक एरे या ऑब्जेक्ट में 4,096 से अधिक प्रविष्टियाँ रखने वाला मान भी अस्वीकार होता है। `undefined` प्रॉपर्टी हटा दी जाती हैं।

## सीमाएँ

| सीमा | मान |
| --- | --- |
| प्रोग्राम लंबाई | 256 KiB |
| हर रन में एडिटर को कॉल | 4,096 |
| हर रन में प्रोजेक्ट में बदलाव (selection कॉल, इफ़ेक्ट, कमांड) | 256 |
| एक साथ उत्तर की प्रतीक्षा कर रही कॉल | 8 |
| रन समय | 120 सेकंड |
| एडिटर तक या वहाँ से जाने वाला एक मान | 1 MiB, 12 स्तर गहरा, हर एरे या ऑब्जेक्ट में 4,096 प्रविष्टियाँ |
| लॉग | 1,000 पंक्तियाँ या 256 KiB; प्रति पंक्ति 4,096 अक्षर |
| लाइब्रेरी में प्रोग्राम | 128 |
| प्रोग्राम नाम | 256 अक्षर |
| आयातित प्रोग्राम फ़ाइल | 1 MiB |

हर क्लिप चुनने और एक इफ़ेक्ट लगाने वाला लूप प्रति क्लिप दो बदलाव खर्च करता है, इसलिए बजट समाप्त होने से पहले वह 128 क्लिप तक संभाल सकता है।

## त्रुटियाँ

एडिटर द्वारा अस्वीकार की गई कॉल कारण बताने वाले `Error` के साथ अपना प्रॉमिस reject करती है, जिसका `message` बताता है कि क्यों: शब्दावली से बाहर का कमांड, खाली चयन पर इफ़ेक्ट या सीमा से बाहर का पैरामीटर। Error में `code` भी होता है, जो एडिटर द्वारा अधिक विशिष्ट code न देने पर `MACRO_CALL_FAILED` होता है। प्रोग्राम इन्हें catch करके आगे चल सकता है:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

यह प्रोग्राम पूरा हो जाता है और इसका लॉग पढ़ता है *अस्वीकृत: असमर्थित मैक्रो कमांड: ExportWav.*

जिस error को प्रोग्राम catch नहीं करता, वह रन समाप्त करता है, प्रोजेक्ट को वापस लौटाता है और जिस पंक्ति से आया है उसके साथ पैनल में दिखाया जाता है। जो प्रोग्राम compile नहीं हो सकता, उसके बारे में भी कुछ चलने से पहले इसी तरह बताया जाता है।

## प्रोग्राम जिन इफ़ेक्ट को लागू कर सकता है {#effects-a-program-can-apply}

ये वे इफ़ेक्ट ID हैं जिन्हें `sound.effect` और `sound.effects` स्वीकार करते हैं, साथ में हर इफ़ेक्ट के पैरामीटर की और उनके डिफ़ॉल्ट की कुंजियाँ। सीमाएँ और इकाइयाँ [ऑडियो इफ़ेक्ट संदर्भ](/reference/generated/audio-effects/) में हैं। Nyquist प्लग-इन प्रोग्राम से लागू नहीं किए जा सकते।

| इफ़ेक्ट | इफ़ेक्ट ID | पैरामीटर और डिफ़ॉल्ट |
| --- | --- | --- |
| एम्प्लीफ़ाई | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| ऑटो डक | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| बास और ट्रेबल | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| बिटक्रशर | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| पिच बदलें | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| गति और पिच बदलें | `audacity-change-speed-pitch` | `speedPercent: 0` |
| टेम्पो बदलें | `audacity-change-tempo` | `tempoPercent: 0` |
| क्लासिक फ़िल्टर | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| क्लिक हटाना | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| कम्प्रेसर | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| डिले | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| डिस्टॉर्शन | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| इको | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| फ़ेड इन | `audacity-fade-in` | कोई नहीं |
| फ़ेड आउट | `audacity-fade-out` | कोई नहीं |
| फ़िल्टर कर्व EQ | `audacity-filter-curve-eq` | `points`: `{ frequency, gain }` की एरे, 20 Hz और 20 kHz पर दो समतल बिंदु डिफ़ॉल्ट; `linearFrequencyScale: false`; `filterLength: 8191` |
| चार-बैंड पैरामीट्रिक EQ | `eq` | `outputGain: 0`; `bands`: चार `{ id, enabled, type, frequency, gain, q, slope }` ऑब्जेक्ट, 100, 500, 2000 और 8000 Hz पर peak, `gain: 0`, `q: 1`, `slope: 12` के साथ |
| गेट | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| ग्राफ़िक EQ | `audacity-graphic-eq` | `gains`: dB में 31 बैंड गेन, सभी 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| हाई-पास फ़िल्टर | `highpass` | `frequency: 80`, `q: 0.707` |
| उलटें | `audacity-invert` | कोई नहीं |
| पुराना कम्प्रेसर | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| लिमिटर | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| लाउडनेस नॉर्मलाइज़ेशन | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| लो-पास फ़िल्टर | `lowpass` | `frequency: 18000`, `q: 0.707` |
| नॉइज़ रिडक्शन | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| नॉर्मलाइज़ | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| फ़ेज़र | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| DC ऑफ़सेट हटाएँ | `audacity-remove-dc-offset` | कोई नहीं |
| रिपेयर | `audacity-repair` | कोई नहीं |
| दोहराएँ | `audacity-repeat` | `count: 1` |
| रिवर्ब | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| रिवर्ब (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| रिवर्स | `audacity-reverse` | कोई नहीं |
| स्लाइडिंग स्ट्रेच | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| साइलेंस ट्रंकेट करें | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| यूटिलिटी गेन (समीक्षित) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

दो इफ़ेक्ट के लिए ऐसी चीज़ चाहिए जो प्रोग्राम नहीं दे सकता। नॉइज़ रिडक्शन को उसके अपने डायलॉग में कैप्चर की गई नॉइज़ प्रोफ़ाइल चाहिए और ऑटो डक को फ़ोकस किए गए ट्रैक के नीचे एक कंट्रोल ट्रैक चाहिए।

## प्रोग्राम द्वारा चलाए जा सकने वाले कमांड {#commands-a-program-can-run}

`sound.command` नीचे दिए गए Audacity मैक्रो कमांड नाम स्वीकार करता है। ये वही नाम हैं जिन्हें चरणों वाली मैक्रो में रखा जा सकता है, इसलिए प्रोग्राम और चरण-सूची की पहुँच बिल्कुल समान है। हर कमांड वह एडिटर क्रिया चलाता है जिसका वर्णन [कमांड संदर्भ](/reference/generated/commands/) में है।

### पैरामीटर वाले चयन कमांड

| कमांड | पैरामीटर |
| --- | --- |
| `SelectTime` | सेकंड में `start`, `end`; `relativeTo`, जैसा `sound.select.time` में है |
| `SelectFrequencies` | हर्ट्ज में `low`, `high` |
| `SelectTracks` | `track`, `trackCount` (0 से 100); `mode` में `'set'`, `'add'` या `'remove'` |
| `Select` | ऊपर के तीन सेट का कोई भी संयोजन |

जो पैरामीटर छोड़ दिया जाता है, वह चयन के उस हिस्से को जस का तस रखता है; Audacity भी उन्हें इसी तरह पढ़ता है।

### बिना पैरामीटर वाले कमांड

| समूह | कमांड |
| --- | --- |
| चयन | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| संपादन | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| ट्रैक | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| लेबल | `AddLabel` |
| विश्लेषण | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### जानबूझकर अनुपस्थित चीज़ें

`Undo` और `Redo` अनुपस्थित हैं, क्योंकि एक रन पहले ही हिस्ट्री की एक एंट्री है और हिस्ट्री पर चलने वाला चरण रन से बाहर आपके अपने संपादन तक पहुँच जाएगा। ट्रांसपोर्ट और रिकॉर्डिंग कमांड अनुपस्थित हैं, क्योंकि प्रोग्राम के पास प्रतीक्षा करने के लिए कुछ नहीं है और रिकॉर्डिंग से बाहर उन्हें वापस नहीं लिया जा सकता। खोलना, सहेजना, बंद करना, आयात, निर्यात और प्राथमिकताएँ अनुपस्थित हैं, क्योंकि प्रोग्राम की पहुँच शुरू होने के समय खुले एक ही प्रोजेक्ट तक है। जो कमांड केवल डायलॉग खोलते या दृश्य बदलते हैं, वे भी अनुपस्थित हैं, क्योंकि वे प्रोजेक्ट में कुछ नहीं बदलते।

## प्रोग्राम साझा करना {#sharing-programs}

**प्रोग्राम निर्यात करें** चुने गए प्रोग्राम को `.soundscapemacro` फ़ाइल के रूप में लिखता है और **प्रोग्राम आयात करें** उसे पढ़ता है। फ़ाइल केवल `.js` नहीं बल्कि JSON होती है, इसलिए प्राप्त करने वाले कंप्यूटर पर एडिटर के बाहर इसे चलाने योग्य चीज़ नहीं समझा जाएगा:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

आयात करने पर केवल टेक्स्ट सहेजा जाता है। आयातित प्रोग्राम में **प्रोग्राम चलाएँ** बटन नहीं होता; उसकी जगह पैन में प्रोग्राम, वह फ़ाइल जिससे यह आया, खुले प्रोजेक्ट पर प्रोग्राम क्या कर सकता है इसका नोट और *मैंने यह प्रोग्राम पढ़ लिया है और इसे चलाना चाहता हूँ।* वाला चेकबॉक्स दिखता है। इसे चुनने पर **यह प्रोग्राम सक्षम करें** सक्षम होता है और तभी प्रोग्राम चल सकता है।

यह अनुमति उसी सटीक टेक्स्ट के लिए है जिसे आपने पढ़ा है। बाद में प्रोग्राम बदल जाए—आप उसे संपादित करें या उसके ऊपर नई कॉपी आयात करें—तो नए टेक्स्ट को सक्षम करने तक समीक्षा फिर दिखती है। मैनेजर में स्वयं लिखे प्रोग्राम की समीक्षा आवश्यक नहीं होती।

## उदाहरण

जिस पहले ट्रैक में कोई क्लिप हो, उसकी हर क्लिप पर फ़ेड-इन करें। चलाने से पहले उस ट्रैक के हेडर पर क्लिक करें, ताकि इफ़ेक्ट उसी ट्रैक पर लगे जिसे प्रोग्राम पढ़ रहा है:

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

प्रोजेक्ट को बदले बिना उसकी रिपोर्ट बनाएँ:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

सहेजी गई चरण-सूची मैक्रो तभी चलाएँ जब चयन पर्याप्त लंबा हो:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## इस पेज के बारे में

इस पेज का हर प्रोग्राम—एक-पंक्ति स्निपेट से लेकर काम किए गए उदाहरणों तक—ब्राउज़र सूट (`tests/browser/handbook-macro-program-examples.spec.js`) द्वारा Soundscaper के हर बिल्ड पर चलाया जाता है; सूट प्रोग्राम इसी पेज के टेक्स्ट से पढ़ता है। जो प्रोग्राम पूरा होना या इस पेज में बताए परिणाम देना बंद कर दे, वह पेज या एडिटर ठीक होने तक बिल्ड को विफल करता है।
