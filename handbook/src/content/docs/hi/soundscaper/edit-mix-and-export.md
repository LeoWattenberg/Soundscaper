---
title: "संपादित करें, मिश्रण करें और निर्यात करें"
description: "क्लिप व्यवस्थित करें, ट्रैक संतुलित करें, प्रभाव लागू करें और डिलीवरी फ़ाइल बनाएं।"
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"d4b354ffb5d6a4d35fcb20ac6bb1e0191746badd98ca8f5b476a286e068a3c26","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"d4b354ffb5d6a4d35fcb20ac6bb1e0191746badd98ca8f5b476a286e068a3c26","targetLocale":"hi"} -->

## क्लिप व्यवस्थित करें

कोई भी संपादन कमांड चुनने से पहले क्लिप या समय सीमा का चयन करें। Split playhead पर एक संपादन सीमा बनाता है। Gap-preserving और ripple variants यह निर्धारित करते हैं कि बाद का सामग्री अपनी जगह पर रहता है या हटाए गए क्षेत्र को बंद करने के लिए हिलता है।

बड़े प्रोजेक्ट्स को व्यवस्थित रखने के लिए track folders, clip groups, और Project Bin का उपयोग करें।

### क्लिप फेड्स समायोजित करें {#clip-fades}

एक ऑडियो क्लिप का चयन करें ताकि इसके waveform के ऊपरी हिस्से के साथ छोटे त्रिकोणीय हैंडल्स दिखाई दें, जो सीधे क्लिप हेडर के नीचे होते हैं।
Fade-in के लिए बाएं त्रिकोण को अंदर की ओर खींचें, या fade-out के लिए दाएं त्रिकोण को अंदर की ओर खींचें। खींचने के दौरान waveform बदलता है, और fade curve के ऊपर का क्षेत्र गहरा होता जाता है। त्रिकोण fade सीमाओं का पालन करते हैं; किसी एक को उसके कोने में वापस खींचने से वह fade हट जाता है। कई क्लिप चयनित होने पर भी, केवल वही क्लिप बदलती है जिसे आप खींच रहे हैं।

जब आप क्लिप का चयन हटाते हैं, तो हैंडल्स गायब हो जाते हैं, लेकिन faded waveform और shading बनी रहती है। ये fades मूल ऑडियो को सुरक्षित रखते हैं और प्रोजेक्ट को सहेजने और फिर से खोलने के बाद भी समायोजित किए जा सकते हैं। Fade को commit करने के लिए छोड़ दें, या खींचते समय **Escape** दबाएं ताकि रद्द किया जा सके। **Undo** एक पूर्ण drag को उलट देता है।
Playback और export committed fade settings का उपयोग करते हैं।

चयनित क्लिप पर focus के साथ, उसके fade handles तक पहुंचने के लिए **Tab** दबाएं। तीर कुंजियां अवधि को 10 मिलीसेकंड से समायोजित करती हैं, या **Shift** के साथ 100 मिलीसेकंड। **Home** fade को हटा देता है; **End** इसे क्लिप के पूरे हिस्से तक बढ़ा देता है।
संख्यात्मक प्रविष्टि के लिए, **Edit → Audio clips → Clip properties** चुनें और **Fading** का उपयोग करें।

## मिक्स बनाएं

प्रोजेक्ट को संतुलित करने के लिए track gain, pan, mute, और solo नियंत्रणों का उपयोग करें। Mixer पैनल एक mix-oriented layout में समान प्रोजेक्ट स्थिति को प्रकट करता है। Real-time effects समायोजित किए जा सकते हैं; destructive या rendered operations प्रोजेक्ट परिवर्तन बनाते हैं जिन्हें history उपलब्ध रहने तक undo किया जा सकता है।

परिणाम की जांच के लिए playback meter और loudness analysis का उपयोग करें। पूर्ण export को सुनने के स्थान पर meter target को एक विकल्प के रूप में उपयोग करने से बचें।

### Sibilance कम करें {#reduce-sibilance}

**Effect → Noise removal and repair → De-esser** चुनें। आवाज़ के कठोर हिस्से के पास **Frequency** सेट करें, फिर **Threshold** को कम करें जब तक कि sibilants नरम न हो जाएं।
**Maximum reduction** कट को सीमित करता है; लगभग 6–9 dB से शुरू करें। छोटा **Attack** एक consonant की शुरुआत को पकड़ता है, जबकि **Release** नियंत्रित करता है कि उच्च आवृत्तियां कितनी तेजी से पुनर्प्राप्त होती हैं। केवल ऊपरी बैंड कम किया जाता है।

### अलग-अलग आवृत्ति बैंड्स को संपीड़ित करें {#multiband-compression}

**Effect → Volume and compression → Multiband compressor** चुनें। दो crossovers संकेत को low, mid, और high बैंड्स में विभाजित करते हैं। प्रत्येक बैंड की अपनी threshold, ratio, और output gain होती है। 1 की ratio उस बैंड की dynamics को अपरिवर्तित छोड़ देती है। Attack और release तीनों बैंड्स पर लागू होते हैं। Crossovers की gentle, overlapping 6 dB/octave slopes होती हैं; सभी ratios 1 पर और band gains 0 dB पर होने पर, मूल संकेत बिना बदलाव के गुजर जाता है।

दोनों effects अपने channels को link करते हैं ताकि stereo balance सुरक्षित रहे और ये track और master effect racks में भी उपलब्ध हैं। Rack settings प्रोजेक्ट के साथ सहेजी जाती हैं और playback के दौरान समायोजित की जा सकती हैं। **Apply to selection** effect को चयनित ऑडियो में render करता है और Undo का समर्थन करता है। इन दो effects के लिए Timeline automation उपलब्ध नहीं है।

## निर्यात

मिक्स्ड डिलीवरी के लिए **File → Export audio** चुनें या केवल चयन को render करने के लिए **Export selected audio**। Soundscaper stems और labels का निर्यात भी कर सकता है।

Compressed formats FFmpeg runtime का उपयोग करते हैं। सटीक formats और शर्तों पर उपलब्धता [generated format reference](/reference/) में सूचीबद्ध हैं।

डिलीवर करने या source सामग्री को हटाने से पहले किसी अन्य application में exported file चलाएं।

Picture work — एक sequence का निर्माण, video effects, और MP4 या WebM डिलीवरी — के लिए प्रोजेक्ट को [Framescaper](/framescaper/) को सौंपें और [export video](/framescaper/video-export/) देखें।
