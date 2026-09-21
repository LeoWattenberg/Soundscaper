---
title: "एक आवाज़ रिकॉर्डिंग को साफ़ करें"
description: "एक टेक से हम निकालें, रम्बल को काटें, इसे पॉडकास्ट लाउडनेस तक लाएं और एक एमपी3 के रूप में निर्यात करें।"
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. It lands as a clip on its own track.\",\"text\":\"Choose File → Import and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. It lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"96727487ae82c7f76b646047856630f73eb756ee7832615587e24e1e6db0b0ee","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"96727487ae82c7f76b646047856630f73eb756ee7832615587e24e1e6db0b0ee","targetLocale":"hi"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

घर पर की गई अधिकांश रिकॉर्डिंग को तीन मरम्मतों की आवश्यकता होती है: एक स्थिर बैकग्राउंड शोर को हटाना, एक कम गुर्राहट को फ़िल्टर करना और एक स्तर जिसे मानक तक लाना है। यह ट्यूटोरियल तीन सेकंड के उदाहरण के साथ तीनों को करता है, जिसका पहला आधा सेकंड केवल कमरे का शोर है, फिर परिणाम को एक MP3 के रूप में निर्यात करता है।

:::tip[आपको जिन चीजों की आवश्यकता है]
- डाउनलोड करें [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — एक छोटा टेक जिसका पहला आधा सेकंड कमरे का शोर है और फिर आवाज शुरू होती है।

नीचे दिए गए हर चरण इन फ़ाइलों पर ठीक उसी तरह काम करता है, जैसा कि ट्यूटोरियल में बताया गया है। Soundscaper ब्राउज़र में चलता है; कुछ भी इंस्टॉल करने की आवश्यकता नहीं है।
:::

## आप सीखेंगे

- क्यों नॉइज़ रिडक्शन को एक प्रोफ़ाइल की आवश्यकता होती है, और इसे कैसे दिया जाता है।
- एक हाई-पास फ़िल्टर क्या हटाता है और इसे भाषण के लिए कहाँ सेट किया जाना चाहिए।
- पीक स्तर और लाउडनेस के बीच का अंतर, और एक लाउडनेस लक्ष्य को कैसे हिट किया जाए।
- एक MP3 को कैसे निर्यात करें।

## चरण

1. Soundscaper खोलें। जैसे ही एडिटर लोड होता है, एक नया, खाली प्रोजेक्ट तैयार होता है।
2. **फ़ाइल → आयात** चुनें और `guide-noisy-take.wav` का चयन करें — एक छोटा टेक जिसका पहला आधा सेकंड कमरे का शोर है और फिर आवाज शुरू होती है। यह अपने ट्रैक पर एक क्लिप के रूप में लैंड होता है।
3. **प्ले** दबाएं ताकि सुन सकें, फिर **स्टॉप** दबाएं।
   *आपको दिखना चाहिए:* आधा सेकंड का शोर, फिर एक स्थिर टोन जो आवाज का प्रतिनिधित्व करता है, जिसके नीचे शोर है।
4. क्लिप के ऊपर शासक को खींचें, शुरुआत से 15% मार्क तक, शोर-केवल लीड-इन का चयन करने के लिए। प्रोफ़ाइल में केवल वह शोर होना चाहिए जिसे आप हटाना चाहते हैं — कोई आवाज़ बिल्कुल नहीं।
5. **प्रभाव → शोर हटाना और मरम्मत करना → शोर रिडक्शन** चुनें और **शोर प्रोफ़ाइल प्राप्त करें** दबाएं। स्थिति पंक्ति यह रिपोर्ट करती है कि प्रोफ़ाइल तैयार है। **बंद** दबाएं ताकि अभी के लिए संवाद छोड़ दें।
6. **चयन → सब चयन करें** चुनें। प्रोफ़ाइल बनी रहती है; अब प्रभाव को साफ़ करने के लिए जानना चाहिए।
7. **प्रभाव → शोर हटाना और मरम्मत करना → शोर रिडक्शन** चुनें। **शोर रिडक्शन** संवाद में, **शोर रिडक्शन** को `12` सेट करें, फिर **चयन पर लागू करें** दबाएं। बारह डेसिबल एक अच्छी पहली सेटिंग है। अधिक शोर को अधिक हटाता है लेकिन आवाजों को खोखला बनाता है।
   *आपको दिखना चाहिए:* लीड-इन लगभग फ्लैट है और टोन को छुआ नहीं गया है।
8. **प्रभाव → पुराने प्रभाव → क्लासिक फ़िल्टर** चुनें। **क्लासिक फ़िल्टर** संवाद में, **फ़िल्टर प्रकार** के लिए **हाई-पास** चुनें और **कटऑफ़ आवृत्ति** को `100` सेट करें, फिर **चयन पर लागू करें** दबाएं। 100 हर्ट्ज से नीचे सब कुछ — यातायात, हैंडलिंग, एयर कंडीशनिंग — रोल ऑफ़ हो जाता है। भाषण इसके ऊपर अच्छी तरह से रहता है।
9. **प्रभाव → वॉल्यूम और कंप्रेशन → लाउडनेस नॉर्मलाइज़ेशन** चुनें। **लाउडनेस नॉर्मलाइज़ेशन** संवाद में, **लक्ष्य लाउडनेस** को `-16` सेट करें, फिर **चयन पर लागू करें** दबाएं। −16 LUFS स्टीरियो पॉडकास्ट के लिए सामान्य लक्ष्य है। लाउडनेस पूरे टेक के स्तर को मापता है, न कि इसके पीक की ऊंचाई को।
   *आपको दिखना चाहिए:* वेवफ़ॉर्म ऊंचा है और टेक एक आरामदायक स्तर पर बजता है।
10. **प्ले** दबाएं ताकि सुन सकें, फिर **स्टॉप** दबाएं।
   *आपको दिखना चाहिए:* एक साफ़, स्तरित टेक जिसमें एक शांत लीड-इन है।
11. **फ़ाइल → ऑडियो निर्यात करें** चुनें, **फ़ॉर्मेट** को **MP3** सेट करें, और **निर्यात** दबाएं। फ़ाइल रेंडर पूरा होते ही डाउनलोड हो जाती है, और इसका लिंक संवाद में रहता है। फ़ाइल ब्राउज़र में एन्कोड की जाती है; कुछ भी आपके कंप्यूटर से बाहर नहीं जाता है।

## आगे क्या

- अपने खुद के टेक पर इसे करें: [पृष्ठभूमि शोर हटाएँ](/guides/cleaning-up/remove-background-noise/), [निचली गुर्राहट हटाएँ](/guides/cleaning-up/remove-low-rumble/) और [पॉडकास्ट के लिए लाउडनेस नॉर्मलाइज़ करें](/guides/volume/normalize-loudness-for-podcasts/)।
- एक प्लेटफ़ॉर्म की तरह परिणाम की जाँच करें: [अपने मिक्स की लाउडनेस को मापें](/guides/analysis/measure-loudness/)।

## अन्य ट्यूटोरियल

[अपना पहला Soundscaper प्रोजेक्ट](/tutorials/your-first-project/) — एक रिकॉर्डिंग आयात करें, सुनें, इसे स्प्लिट करें, फेड आउट करें, एक फ़ाइल निर्यात करें और प्रोजेक्ट सहेजें।
[आवाज़ के नीचे संगीत रखें](/tutorials/put-music-under-a-voice/) — दो ट्रैक को लेयर करें, एक को दूसरे के नीचे स्वचालित रूप से डक करें, उन्हें मिक्स करें और निर्यात करें।

## संदर्भ

- [यहाँ इस्तेमाल किए गए प्रभावों के हर पैरामीटर के साथ उनका डिफ़ॉल्ट और रेंज है.](/reference/generated/audio-effects/#parameters)
- [निर्यात फ़ॉर्मेट, उनके कंटेनर और चैनल सीमाएँ हैं.](/reference/generated/formats/)
- [हर मेनू कमांड और उसका कीबोर्ड शॉर्टकट है.](/reference/generated/commands/)

## इस ट्यूटोरियल के बारे में

यह ट्यूटोरियल, हर बिल्ड के खिलाफ कदम दर कदम और इन्हीं फ़ाइलों पर दोहराया जाता है `tests/browser/soundscaper-tutorials.spec.js`। यदि कोई कदम काम करना बंद कर देता है, तो बिल्ड विफल हो जाता है जब तक कि ट्यूटोरियल को सुधारा नहीं जाता, इसलिए जो आप पढ़ते हैं वही एडिटर करता है।
