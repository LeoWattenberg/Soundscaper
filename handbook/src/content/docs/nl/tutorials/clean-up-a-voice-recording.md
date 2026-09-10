---
title: "Een stemopname opschonen"
description: "Verwijder het zoemgeluid van een opname, snij het gedreun eruit, breng het naar de luidheid van een podcast en exporteer het als MP3."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"nl"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

De meeste opnames gemaakt thuis hebben dezelfde drie reparaties nodig: een constante achtergrondruis die moet worden verwijderd, een lage rommel die moet worden gefilterd en een niveau dat moet worden aangepast naar een standaard. Deze handleiding voert deze drie stappen uit op een voorbeeld van drie seconden waarvan de eerste half seconde alleen kamergeluid is, en exporteert het resultaat als een MP3.

:::tip[Wat je nodig hebt]
- Download [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — een korte opname waarvan de eerste half seconde kamergeluid is voordat de stem begint.

Elke stap hieronder werkt op deze bestanden precies zoals ze zijn, dus wat je ziet moet overeenkomen met wat de handleiding zegt. Soundscaper werkt in de browser; er hoeft niets geïnstalleerd te worden.
:::

## Wat je zult leren

- Waarom ruisreductie een profiel nodig heeft en hoe je dat profiel aanmaakt.
- Wat een hoogdoorlaatfilter verwijdert en waar je de frequentie moet instellen voor spraak.
- Het verschil tussen piekniveau en luidheid, en hoe je een luidheiddoel bereikt.
- Hoe je een MP3 exporteert.

## Stappen

1. Open Soundscaper. Een nieuw, leeg project is klaar zodra de editor is geladen.
2. Kies **Bestand → Importeer audio** en selecteer `guide-noisy-take.wav` — een korte opname waarvan de eerste half seconde kamergeluid is voordat de stem begint. Het bestand wordt een clip op zijn eigen spoor.
3. Druk op **Afspelen** om te luisteren, en dan op **Stop**.
   *Je zou moeten zien:* Een half seconde ruis, gevolgd door een constante toon die een stem vertegenwoordigt, met de ruis eronder.
4. Sleep in de regel boven de clip, van het begin tot het 15% punt, om het ruis-alleen begin te selecteren. Het profiel mag alleen de ruis bevatten die je wilt verwijderen — geen stem.
5. Kies **Effect → Ruisreductie en herstel → Ruisreductie** en druk op **Ruisprofiel ophalen**. De statusregel geeft aan dat het profiel klaar is. Druk op **Sluiten** om het dialoogvenster voor nu te verlaten.
6. Kies **Selecteren → Alles selecteren**. Het profiel wordt bewaard; nu moet het effect weten wat het moet schoonmaken.
7. Kies **Effect → Ruisreductie en herstel → Ruisreductie**. In het **Ruisreductie** dialoogvenster, stel **Ruisreductie** in op `12`, en druk dan op **Toepassen op selectie**. Twaalf decibel is een goede eerste instelling. Meer verwijdert meer ruis maar maakt stemmen hol klinken.
   *Je zou moeten zien:* Het begin is bijna plat en de toon is ongemoeid.
8. Kies **Effect → Legacy effecten → Klassieke Filters**. In het **Klassieke Filters** dialoogvenster, kies **Hoogdoorlaat** als **Filtertype** en stel **Snijfrequentie** in op `100`, en druk dan op **Toepassen op selectie**. Alles onder 100 Hz — verkeer, hantering, airconditioning — wordt weggefilterd. Spraak leeft goed erboven.
9. Kies **Effect → Volume en compressie → Luidheid Normalisatie**. In het **Luidheid Normalisatie** dialoogvenster, stel **Doelluidheid** in op `-16`, en druk dan op **Toepassen op selectie**. −16 LUFS is het gangbare doel voor stereo podcasts. Luidheid meet hoe luid de hele opname voelt, niet hoe hoog de pieken zijn.
   *Je zou moeten zien:* De waveform is hoger en de opname speelt op een comfortabel niveau.
10. Druk op **Afspelen** om te luisteren, en dan op **Stop**.
   *Je zou moeten zien:* Een schone, vlakke opname met een rustig begin.
11. Kies **Bestand → Exporteer audio**, stel **Formaat** in op **MP3**, en druk op **Exporteer**. Het bestand wordt gedownload zodra de render klaar is, en de link blijft in het dialoogvenster. Het bestand wordt in de browser gecodeerd; er verlaat niets je computer.

## Wat nu?

- Doe het bij je eigen opname met de hoe-het-moet-gidsen: [Verwijder achtergrondruis](/guides/cleaning-up/remove-background-noise/), [Verwijder lage rommel](/guides/cleaning-up/remove-low-rumble/) en [Normaliseer luidheid voor een podcast](/guides/volume/normalize-loudness-for-podcasts/).
- Controleer het resultaat zoals een platform zou doen: [Meet hoe luid je mix is](/guides/analysis/measure-loudness/).

## Andere tutorials

[Je eerste Soundscaper project](/tutorials/your-first-project/) — Importeer een opname, luister ernaar, split het, fade het uit, exporteer een bestand en sla het project op.
[Zet muziek onder een stem](/tutorials/put-music-under-a-voice/) — Leg twee sporen op elkaar, laat er automatisch één onder de ander ducken, mix ze af en exporteer.

## Referentie

- [Elke parameter van de hier gebruikte effecten, met zijn standaardwaarde en bereik, staat in de audio-effecten referentie.](/reference/generated/audio-effects/#parameters)
- [De exportformaten, hun containers en kanaalbeperkingen staan in de exportformaten referentie.](/reference/generated/formats/)
- [Elke menuopdracht en zijn sneltoets staat in de commando's en sneltoetsen referentie.](/reference/generated/commands/)

## Over deze handleiding

Deze handleiding wordt stap voor stap herhaald, op deze bestanden, tegen elke build van Soundscaper door de browsersuite (`tests/browser/soundscaper-tutorials.spec.js`). Als een stap stopt met werken, mislukt de build totdat de handleiding is gecorrigeerd, dus wat je leest is wat de editor doet.
