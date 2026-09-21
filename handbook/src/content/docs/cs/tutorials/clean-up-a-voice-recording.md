---
title: "Vyčistěte zvukovou nahrávku"
description: "Odstraňte hučení z nahrávky, redukujte dunění, upravte hlasitost na úroveň podcastu a vyveďte MP3."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. It lands as a clip on its own track.\",\"text\":\"Choose File → Import and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. It lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"96727487ae82c7f76b646047856630f73eb756ee7832615587e24e1e6db0b0ee","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"96727487ae82c7f76b646047856630f73eb756ee7832615587e24e1e6db0b0ee","targetLocale":"cs"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

Většina nahrávek vytvořených doma vyžaduje stejné tři opravy: odstranění stálého pozadí šumu, vyfiltrování nízkofrekvenčního bručení a úpravu úrovně na standardní hodnotu. Tento návod provede všechny tři kroky na třísekundovém ukázkovém záznamu, jehož první půlsekunda obsahuje pouze šum místnosti, a poté výsledek vyexportuje jako MP3.

:::tip[Co budete potřebovat]
- Stáhněte [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — krátký záznam, jehož první půlsekunda obsahuje pouze šum místnosti před začátkem hlasu.

Každý krok níže funguje na těchto souborech přesně tak, jak jsou, takže to, co vidíte, by mělo odpovídat tomu, co návod popisuje. Soundscaper běží v prohlížeči; není třeba nic instalovat.
:::

## Co se naučíte

- Proč je pro redukci šumu potřeba profil a jak ho vytvořit.
- Co odstraňuje pásmový filtr a kde nastavit frekvenci pro řeč.
- Rozdíl mezi vrcholovou úrovní a hlasitostí a jak dosáhnout cílové hlasitosti.
- Jak vyexportovat MP3.

## Kroky

1. Otevřete Soundscaper. Jakmile se načte editor, je připraven nový prázdný projekt.
2. Vyberte **Soubor → Importovat** a vyberte `guide-noisy-take.wav` — krátký záznam, jehož první půlsekunda obsahuje pouze šum místnosti před začátkem hlasu. Nahrávka se umístí jako klip na vlastní stopu.
3. Stiskněte **Přehrát** pro poslech a poté **Zastavit**.
   *Mělo by se zobrazit:* Půlsekunda šumu, poté stálý tón zastupující hlas, s šumem pod ním.
4. Přetáhněte pravítko nad klipem od začátku do značky 15 %, abyste vybrali pouze úvodní šum. Profil nesmí obsahovat žádný hlas, pouze šum, který chcete odstranit.
5. Vyberte **Účinek → Odstranění a oprava šumu → Redukce šumu** a stiskněte **Získat profil šumu**. Stavový řádek oznámí, že profil je připraven. Stiskněte **Zavřít**, abyste dialogové okno zatím opustili.
6. Vyberte **Vybrat → Vybrat vše**. Profil je zachován; nyní je třeba efektu říct, co má vyčistit.
7. Vyberte **Účinek → Odstranění a oprava šumu → Redukce šumu**. V dialogovém okně **Redukce šumu** nastavte **Redukce šumu** na `12` a poté stiskněte **Použít na výběr**. Dvanáct decibelů je dobrá počáteční hodnota. Větší hodnota odstraní více šumu, ale hlasy budou znít dutě.
   *Mělo by se zobrazit:* Úvodní část je téměř plochá a tón zůstává nezměněn.
8. Vyberte **Účinek → Legacy efekty → Klasické filtry**. V dialogovém okně **Klasické filtry** zvolte **Pásmový filtr** jako **Typ filtru** a nastavte **Frekvenční limit** na `100`, poté stiskněte **Použít na výběr**. Vše pod 100 Hz — doprava, manipulace, klimatizace — je potlačeno. Řeč se nachází dobře nad touto frekvencí.
9. Vyberte **Účinek → Úroveň a komprese → Normalizace hlasitosti**. V dialogovém okně **Normalizace hlasitosti** nastavte **Cílovou hlasitost** na `-16` a poté stiskněte **Použít na výběr**. −16 LUFS je běžný cíl pro stereo podcasty. Hlasitost měří, jak hlasitě celá nahrávka zní, nikoli jak vysoké jsou její vrcholy.
   *Mělo by se zobrazit:* Vlnovka je vyšší a nahrávka se přehrává na pohodlné úrovni.
10. Stiskněte **Přehrát** pro poslech a poté **Zastavit**.
   *Mělo by se zobrazit:* Čistá, vyrovnaná nahrávka s tichým úvodem.
11. Vyberte **Soubor → Exportovat audio**, nastavte **Formát** na **MP3** a stiskněte **Exportovat**. Soubor se stáhne, jakmile se renderování dokončí, a jeho odkaz zůstane v dialogovém okně. Soubor se kóduje v prohlížeči; nic neopouští váš počítač.

## Co dál

- Použijte návody: [Odstranění pozadí šumu](/guides/cleaning-up/remove-background-noise/), [Odstranění nízkofrekvenčního bručení](/guides/cleaning-up/remove-low-rumble/) a [Normalizace hlasitosti pro podcast](/guides/volume/normalize-loudness-for-podcasts/) na vaši vlastní nahrávku.
- Zkontrolujte výsledek tak, jak by to udělala platforma: [Změřte hlasitost vašeho mixu](/guides/analysis/measure-loudness/).

## Další návody

[Váš první projekt Soundscaper](/tutorials/your-first-project/) — Importujte nahrávku, poslouchejte ji, rozdělte ji, vybledněte ji, vyexportujte soubor a uložte projekt.
[Dejte hudbu pod hlas](/tutorials/put-music-under-a-voice/) — Vrstvěte dvě stopy, automaticky jednu stiskněte pod druhou, smíchejte je a vyexportujte.

## Referenční materiály

- [Každý parametr použitých efektů, včetně výchozích hodnot a rozsahů, naleznete v referenci audio efektů.](/reference/generated/audio-effects/#parameters)
- [Exportované formáty, jejich kontejnery a limity kanálů jsou uvedeny v referenci exportovaných formátů.](/reference/generated/formats/)
- [Každé menu a jeho klávesové zkratky naleznete v referenci příkazů a zkratek.](/reference/generated/commands/)

## O tomto návodu

Tento návod je krok za krokem přehráván na každém sestavení Soundscaperu v prohlížeči (`tests/browser/soundscaper-tutorials.spec.js`). Pokud přestane fungovat některý krok, sestavení selže, dokud nebude návod opraven, takže to, co čtete, odpovídá tomu, co editor dělá.
