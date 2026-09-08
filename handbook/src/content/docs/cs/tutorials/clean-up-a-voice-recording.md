---
title: "Vyčistěte zvukovou nahrávku"
description: "Odstraňte hučení z nahrávky, snižte dunění, upravte hlasitost na úroveň podcastu a vyveďte MP3."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"cs"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

Většina nahrávek provedených doma vyžaduje stejné tři opravy: odstranění stálého pozadí šumu, odstranění nízkofrekvenčního bručení a úpravu úrovně na standardní. Tento návod provede všechny tři kroky na třísekundovém ukázkovém záznamu, jehož první půlsekunda je pouze šum místnosti, a poté výsledek vyexportuje jako MP3.

:::tip[Co budete potřebovat]
- Stáhněte [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — krátký záznam, jehož první půlsekunda je šum místnosti před začátkem hlasu.

Každý krok níže funguje na těchto souborech přesně tak, jak jsou, takže to, co vidíte, by mělo odpovídat tomu, co návod popisuje. Soundscaper běží v prohlížeči; nic nemusíte instalovat.
:::

## Co se naučíte

- Proč je pro redukci šumu potřeba profil a jak ho vytvořit.
- Co odstraňuje vysokopásmový filtr a kde ho nastavit pro řeč.
- Rozdíl mezi vrcholovou úrovní a hlasitostí a jak dosáhnout cílové hlasitosti.
- Jak vyexportovat MP3.

## Kroky

1. Otevřete Soundscaper. Nový prázdný projekt je připraven ihned po načtení editoru.
2. Zvolte **Soubor → Importovat audio** a vyberte `guide-noisy-take.wav` — krátký záznam, jehož první půlsekunda je šum místnosti před začátkem hlasu. Soubor se umístí jako klip na vlastní stopu.
3. Stiskněte **Přehrát** pro poslech, poté **Zastavit**.
   *Mělo by se zobrazit:* Půlsekunda šumu, poté stálý tón zastupující hlas, s šumem pod ním.
4. Přetáhněte v pravítku nad klipem od začátku do značky 15 %, abyste vybrali pouze šumový úvod. Profil musí obsahovat pouze šum, který chcete odstranit — žádný hlas.
5. Zvolte **Úpravy → Odstranění a oprava šumu → Redukce šumu** a stiskněte **Získat profil šumu**. Stavový řádek hlásí, že profil je připraven. Stiskněte **Zavřít**, abyste dialog zatím opustili.
6. Zvolte **Vybrat → Vybrat vše**. Profil je zachován; nyní je třeba efektu říct, co má vyčistit.
7. Zvolte **Úpravy → Odstranění a oprava šumu → Redukce šumu**. V dialogu **Redukce šumu** nastavte **Redukce šumu** na `12` a poté stiskněte **Použít na výběr**. Dvanáct decibelů je dobrá počáteční hodnota. Více odstraní více šumu, ale hlasy zní dutě.
   *Mělo by se zobrazit:* Úvod je téměř plochý a tón zůstává nezměněn.
8. Zvolte **Úpravy → Legacy efekty → Klasické filtry**. V dialogu **Klasické filtry** zvolte **Vysokopásmový** pro **Typ filtru** a nastavte **Časovou frekvenci** na `100`, poté stiskněte **Použít na výběr**. Vše pod 100 Hz — doprava, manipulace, klimatizace — je potlačeno. Řeč žije dobře nad touto hranicí.
9. Zvolte **Úpravy → Úroveň a komprese → Normalizace hlasitosti**. V dialogu **Normalizace hlasitosti** nastavte **Cílovou hlasitost** na `-16`, poté stiskněte **Použít na výběr**. −16 LUFS je běžný cíl pro stereo podcasty. Hlasitost měří, jak hlasitý celkový dojem záznamu je, nikoli jak vysoké jsou jeho vrcholy.
   *Mělo by se zobrazit:* Vlnovka je vyšší a záznam hraje na pohodlné úrovni.
10. Stiskněte **Přehrát** pro poslech, poté **Zastavit**.
   *Mělo by se zobrazit:* Čistý, vyrovnaný záznam s tichým úvodem.
11. Zvolte **Soubor → Exportovat audio**, nastavte **Formát** na **MP3** a stiskněte **Exportovat**. Soubor se stáhne, jakmile se renderování dokončí, a jeho odkaz zůstane v dialogu. Soubor se kóduje v prohlížeči; nic neopouští váš počítač.

## Co dál

- Udělejte to na vlastní nahrávce s návody: [Odstranění pozadí šumu](/guides/cleaning-up/remove-background-noise/), [Odstranění nízkofrekvenčního bručení](/guides/cleaning-up/remove-low-rumble/) a [Normalizace hlasitosti pro podcast](/guides/volume/normalize-loudness-for-podcasts/).
- Zkontrolujte výsledek tak, jak by to udělala platforma: [Změřte, jak hlasitý je váš mix](/guides/analysis/measure-loudness/).

## Další návody

[Váš první projekt Soundscaper](/tutorials/your-first-project/) — Importujte nahrávku, poslouchejte ji, rozdělte ji, vybledněte ji, vyexportujte soubor a uložte projekt.
[Dejte hudbu pod hlas](/tutorials/put-music-under-a-voice/) — Vrstvěte dvě stopy, automaticky jednu stiskněte pod druhou, smíchejte je a vyexportujte.

## Referenční materiály

- [Každý parametr použitých efektů, s jeho výchozí hodnotou a rozsahem, naleznete v referenci audio efektů.](/reference/generated/audio-effects/#parameters)
- [Exportované formáty, jejich kontejnery a limity kanálů jsou v referenci exportovaných formátů.](/reference/generated/formats/)
- [Každé menu a jeho klávesové zkratky jsou v referenci příkazů a zkratek.](/reference/generated/commands/)

## O tomto návodu

Tento návod je přehráván krok za krokem na těchto souborech při každém sestavení Soundscaperu v prohlížeči (`tests/browser/soundscaper-tutorials.spec.js`). Pokud přestane některý krok fungovat, sestavení selže, dokud nebude návod opraven, takže to, co čtete, je to, co editor dělá.