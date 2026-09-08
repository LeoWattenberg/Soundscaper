---
title: "Eine Sprachaufnahme bereinigen"
description: "Entfernen Sie das Brummen aus einer Aufnahme, schneiden Sie das Grollen heraus, bringen Sie es auf Podcast-Lautstärke und exportieren Sie es als MP3."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"de"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

Die meisten Aufnahmen, die zu Hause gemacht werden, benötigen drei Reparaturen: ein konstantes Hintergrundrauschen, das entfernt werden muss, ein tiefes Brummen, das herausgefiltert werden muss, und ein Pegel, der auf einen Standard angehoben werden muss. Dieses Tutorial führt alle drei Schritte an einem dreisekündigen Beispiel durch, dessen erste halbe Sekunde nur Rauschen enthält, und exportiert das Ergebnis als MP3.

:::tip[Was Sie benötigen]
- Laden Sie [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) herunter — eine kurze Aufnahme, deren erste halbe Sekunde nur Rauschen enthält, bevor die Stimme einsetzt.

Jeder Schritt unten funktioniert mit diesen Dateien genau so, wie sie sind, also sollte das, was Sie sehen, mit dem Tutorial übereinstimmen. Soundscaper läuft im Browser; es muss nichts installiert werden.
:::

## Was Sie lernen werden

- Warum eine Profil für die Rauschreduzierung benötigt wird und wie Sie es erstellen.
- Was ein Hochpassfilter entfernt und wo Sie es für Sprache einstellen.
- Der Unterschied zwischen Spitzenpegel und Lautstärke und wie Sie ein Lautstärkeziel erreichen.
- Wie Sie eine MP3 exportieren.

## Schritte

1. Öffnen Sie Soundscaper. Ein neues, leeres Projekt ist bereit, sobald der Editor geladen ist.
2. Wählen Sie **Datei → Audio importieren** und wählen Sie `guide-noisy-take.wav` — eine kurze Aufnahme, deren erste halbe Sekunde nur Rauschen enthält, bevor die Stimme einsetzt. Die Datei wird als Clip auf einer eigenen Spur abgelegt.
3. Drücken Sie **Wiedergabe**, um zuzuhören, und dann **Stopp**.
   *Sie sollten sehen:* Eine halbe Sekunde Rauschen, gefolgt von einem konstanten Ton, der eine Stimme darstellt, mit Rauschen darunter.
4. Ziehen Sie im Lineal über dem Clip vom Anfang bis zum 15% Markierer, um den rauschenden Anfangsabschnitt auszuwählen. Das Profil darf nur das Rauschen enthalten, das Sie entfernen möchten — keine Stimme.
5. Wählen Sie **Effekt → Rauschentfernung und -reparatur → Rauschreduzierung** und drücken Sie **Rauschprofil erstellen**. Die Statuszeile meldet, dass das Profil bereit ist. Drücken Sie **Schließen**, um das Dialogfeld vorerst zu verlassen.
6. Wählen Sie **Auswahl → Alles auswählen**. Das Profil wird beibehalten; nun muss der Effekt wissen, was gereinigt werden soll.
7. Wählen Sie **Effekt → Rauschentfernung und -reparatur → Rauschreduzierung**. Im **Rauschreduzierung**-Dialog setzen Sie **Rauschreduzierung** auf `12` und drücken Sie dann **Auf Auswahl anwenden**. Zwölf Dezibel sind eine gute erste Einstellung. Mehr entfernt mehr Rauschen, macht aber Stimmen hohl klingend.
   *Sie sollten sehen:* Der Anfangsabschnitt ist fast eben und der Ton bleibt unverändert.
8. Wählen Sie **Effekt → Legacy-Effekte → Klassische Filter**. Im **Klassische Filter**-Dialog wählen Sie **Hochpass** als **Filtertyp** und setzen **Abtastfrequenz** auf `100`, dann drücken Sie **Auf Auswahl anwenden**. Alles unter 100 Hz — Verkehr, Handhabung, Klimaanlage — wird abgeschwächt. Sprache liegt gut darüber.
9. Wählen Sie **Effekt → Lautstärke und Kompression → Lautstärkenormalisierung**. Im **Lautstärkenormalisierung**-Dialog setzen Sie **Ziel-Lautstärke** auf `-16` und drücken Sie dann **Auf Auswahl anwenden**. −16 LUFS ist das übliche Ziel für Stereo-Podcasts. Lautstärke misst, wie laut die gesamte Aufnahme wirkt, nicht wie hoch ihre Spitzen sind.
   *Sie sollten sehen:* Die Wellenform ist höher und die Aufnahme wird auf einem angenehmen Pegel abgespielt.
10. Drücken Sie **Wiedergabe**, um zuzuhören, und dann **Stopp**.
   *Sie sollten sehen:* Eine saubere, ebene Aufnahme mit einem ruhigen Anfangsabschnitt.
11. Wählen Sie **Datei → Audio exportieren**, setzen Sie **Format** auf **MP3** und drücken Sie **Exportieren**. Die Datei wird heruntergeladen, sobald die Rendern abgeschlossen ist, und der Link bleibt im Dialogfeld. Die Datei wird im Browser codiert; es verlässt nichts Ihren Computer.

## Als Nächstes

- Führen Sie es mit Ihrer eigenen Aufnahme durch, mit den How-to-Guides: [Entfernen von Hintergrundgeräuschen](/guides/cleaning-up/remove-background-noise/), [Entfernen von tiefem Brummen](/guides/cleaning-up/remove-low-rumble/) und [Lautstärke für einen Podcast normalisieren](/guides/volume/normalize-loudness-for-podcasts/).
- Überprüfen Sie das Ergebnis so, wie es eine Plattform tun würde: [Messen, wie laut Ihre Mischung ist](/guides/analysis/measure-loudness/).

## Weitere Tutorials

[Ihr erstes Soundscaper-Projekt](/tutorials/your-first-project/) — Importieren Sie eine Aufnahme, hören Sie sie an, teilen Sie sie auf, blenden Sie sie aus, exportieren Sie eine Datei und speichern Sie das Projekt.
[Musik unter einer Stimme legen](/tutorials/put-music-under-a-voice/) — Legen Sie zwei Spuren übereinander, lassen Sie eine automatisch unter der anderen ducken, mischen Sie sie ab und exportieren Sie sie.

## Referenz

- [Jeder Parameter der hier verwendeten Effekte, mit seinem Standardwert und seinem Bereich, befindet sich in der Audioeffekt-Referenz.](/reference/generated/audio-effects/#parameters)
- [Die Exportformate, ihre Container und Kanallimits befinden sich in der Exportformate-Referenz.](/reference/generated/formats/)
- [Jeder Menübefehl und seine Tastenkombination befindet sich in der Referenz für Befehle und Tastenkombinationen.](/reference/generated/commands/)

## Über dieses Tutorial

Dieses Tutorial wird Schritt für Schritt und auf diesen Dateien gegen jede Version von Soundscaper im Browser-Suite (`tests/browser/soundscaper-tutorials.spec.js`) wiederholt. Wenn ein Schritt aufhört zu funktionieren, schlägt der Build fehl, bis das Tutorial korrigiert wird, also ist das, was Sie lesen, das, was der Editor tut.