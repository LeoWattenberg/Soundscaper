---
title: "आवाज़ की रिकॉर्डिंग को साफ़ करें"
description: "रिकॉर्डिंग से हम् (hum) हटाएं, रम्बल (rumble) काटें, इसे पॉडकास्ट की लोडनेस (loudness) पर लाएं और MP3 निर्यात करें।"
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"hi"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

घर पर की गई अधिकांश रिकॉर्डिंग के लिए तीन समान मरम्मतों की आवश्यकता होती है: हटाने के लिए एक स्थिर बैकग्राउंड शोर, फ़िल्टर करने के लिए एक निम्न गड़गड़ाहट, और एक मानक तक ले जाने के लिए एक लेवल। यह ट्यूटोरियल एक तीन सेकंड के उदाहरण टेक पर इन तीनों में से सभी करता है, जिसके पहले आधा सेकंड केवल रूम नॉइज़ है, और फिर परिणाम को MP3 के रूप में निर्यात करता है।

:::tip[आपको क्या चाहिए]
- डाउनलोड करें [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — एक छोटा टेक जिसके पहले आधा सेकंड आवाज़ शुरू होने से पहले रूम नॉइज़ है।

नीचे दिए गए हर चरण इन फ़ाइलों पर ठीक वैसे ही काम करता है जैसे वे हैं, इसलिए जो आप देखते हैं वह ट्यूटोरियल में कहा गया है उससे मेल खाना चाहिए। Soundscaper ब्राउज़र में चलता है; कुछ भी इंस्टॉल करने की आवश्यकता नहीं है।
:::

## आप क्या सीखेंगे

- Noise Reduction को एक प्रोफ़ाइल की आवश्यकता क्यों होती है, और इसे कैसे दें।
- हाई-पास फ़िल्टर क्या हटाता है और बोलचाल के लिए इसे कहाँ सेट करना चाहिए।
- पीक लेवल और लॉउडनेस के बीच का अंतर, और लॉउडनेस लक्ष्य कैसे प्राप्त करें।
- MP3 को कैसे निर्यात करें।

## चरण

1. Soundscaper खोलें। एडिटर लोड होते ही एक नया, खाली प्रोजेक्ट तैयार है।
2. **File → Import audio** चुनें और `guide-noisy-take.wav` चुनें — एक छोटा टेक जिसके पहले आधा सेकंड आवाज़ शुरू होने से पहले रूम नॉइज़ है। फ़ाइल अपने स्वयं के ट्रैक पर एक क्लिप के रूप में आती है।
3. सुनने के लिए **Play** दबाएं, फिर **Stop** दबाएं।
   *आपको यह दिखना चाहिए:* आधा सेकंड का हिस, फिर आवाज़ का प्रतिनिधित्व करने वाला एक स्थिर टोन, जिसके नीचे हिस है।
4. क्लिप के ऊपर रूलर में खींचें, शुरुआत से 15% चिह्न तक, ताकि नॉइज़-ओनली लीड-इन का चयन हो। प्रोफ़ाइल में उस शोर के अलावा कुछ भी नहीं होना चाहिए जिसे आप हटाना चाहते हैं — बिल्कुल कोई आवाज़ नहीं।
5. **Effect → Noise removal and repair → Noise Reduction** चुनें और **Get noise profile** दबाएं। स्टेटस लाइन रिपोर्ट करती है कि प्रोफ़ाइल तैयार है। अभी के लिए डायलॉग छोड़ने के लिए **Close** दबाएं।
6. **Select → Select all** चुनें। प्रोफ़ाइल रखी जाती है; अब इफेक्ट को यह जानने की आवश्यकता है कि क्या साफ़ करना है।
7. **Effect → Noise removal and repair → Noise Reduction** चुनें। **Noise Reduction** डायलॉग में, **Noise reduction** को `12` पर सेट करें, फिर **Apply to selection** दबाएं। बारह डेसिबल एक अच्छा प्रारंभिक सेटिंग है। अधिक शोर हटाता है लेकिन आवाज़ें खोखली लगती हैं।
   *आपको यह दिखना चाहिए:* लीड-इन लगभग फ्लैट है और टोन प्रभावित नहीं है।
8. **Effect → Legacy effects → Classic Filters** चुनें। **Classic Filters** डायलॉग में, **Filter type** के लिए **High-pass** चुनें और **Cutoff frequency** को `100` पर सेट करें, फिर **Apply to selection** दबाएं। 100 Hz से नीचे की सभी चीज़ें — ट्रैफ़िक, हैंडलिंग, एयर कंडीशनिंग — रोल ऑफ़ कर दी जाती हैं। बोलचाल इससे बहुत ऊपर रहती है।
9. **Effect → Volume and compression → Loudness Normalization** चुनें। **Loudness Normalization** डायलॉग में, **Target loudness** को `-16` पर सेट करें, फिर **Apply to selection** दबाएं। −16 LUFS स्टीरियो पॉडकास्ट के लिए सामान्य लक्ष्य है। लॉउडनेस मापता है कि पूरा टेक कितना तेज़ लगता है, न कि इसके पीक कितने ऊंचे हैं।
   *आपको यह दिखना चाहिए:* वेवफॉर्म ऊंचा है और टेक एक आरामदायक स्तर पर चलता है।
10. सुनने के लिए **Play** दबाएं, फिर **Stop** दबाएं।
   *आपको यह दिखना चाहिए:* एक साफ़, लेवल टेक जिसमें एक शांत लीड-इन है।
11. **File → Export audio** चुनें, **Format** को **MP3** पर सेट करें, और **Export** दबाएं। फ़ाइल रेंडरिंग समाप्त होते ही डाउनलोड हो जाती है, और इसका लिंक डायलॉग में रहता है। फ़ाइल ब्राउज़र में एन्कोड की जाती है; कुछ भी आपके कंप्यूटर से बाहर नहीं जाता है।

## आगे क्या करें

- हाउ-टू गाइड्स के साथ अपने स्वयं के टेक पर इसे करें: [Remove background noise](/guides/cleaning-up/remove-background-noise/), [Remove low rumble](/guides/cleaning-up/remove-low-rumble/) और [Normalize loudness for a podcast](/guides/volume/normalize-loudness-for-podcasts/).
- एक प्लेटफ़ॉर्म की तरह परिणाम की जाँच करें: [Measure how loud your mix is](/guides/analysis/measure-loudness/).

## अन्य ट्यूटोरियल

[Your first Soundscaper project](/tutorials/your-first-project/) — एक रिकॉर्डिंग आयात करें, सुनें, इसे विभाजित करें, फेड आउट करें, एक फ़ाइल निर्यात करें और प्रोजेक्ट सहेजें।
[Put music under a voice](/tutorials/put-music-under-a-voice/) — दो ट्रैक को परतदार करें, एक को दूसरे के नीचे स्वतः डक करें, उन्हें मिक्स करें और निर्यात करें।

## संदर्भ

- [यहाँ उपयोग किए गए प्रभावों के हर पैरामीटर, उसके डिफ़ॉल्ट और रेंज के साथ, ऑडियो इफेक्ट्स संदर्भ में है।](/reference/generated/audio-effects/#parameters)
- [निर्यात फ़ॉर्मेट, उनके कंटेनर और चैनल सीमाएँ निर्यात फ़ॉर्मेट संदर्भ में हैं।](/reference/generated/formats/)
- [हर मेनू कमांड और उसकी कीबोर्ड शॉर्टकट कमांड्स और शॉर्टकट्स संदर्भ में है।](/reference/generated/commands/)

## इस ट्यूटोरियल के बारे में

यह ट्यूटोरियल Soundscaper के हर बिल्ड के विरुद्ध, चरण-दर-चरण और इन ही फ़ाइलों पर, ब्राउज़र सूट (`tests/browser/soundscaper-tutorials.spec.js`) द्वारा दोहराया जाता है। यदि कोई चरण काम करना बंद कर देता है, तो ट्यूटोरियल को सही करने तक बिल्ड विफल रहता है, इसलिए जो आप पढ़ते हैं वह एडिटर करता है।
