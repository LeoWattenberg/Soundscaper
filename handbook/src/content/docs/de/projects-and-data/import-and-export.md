---
title: "Importieren und Exportieren"
description: "Unterscheiden Sie zwischen Quellmedien, Projektdateien, Austauschdateien und gerenderten Auslieferungen."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"de"} -->

Soundscaper verwendet verschiedene Dateitypen für unterschiedliche Aufgaben.

## Quellmedien

Verwenden Sie **Datei → Importieren** für Audio, Video und Beschriftungen. Die aktuelle Editor-Hinweisliste enthält
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF und WebM; zusätzliche Video-Container werden über den Video-Importpfad unterstützt. Die Verfügbarkeit kann von
dem aktiven Produkt und der Laufzeit abhängen.

Der Import von Medien fügt eine projektbesitze Quelle hinzu. Es macht die Originaldatei
nicht zu Ihrem bearbeitbaren Projektdokument.

Komprimierte Audio-Exporte und Browser-Importe unterstützen bis zu eine Stunde oder 1 GB
(1.000.000.000 Dateibyte), je nachdem, welches Limit zuerst erreicht wird. Bei der
Desktop-Dateiauswahl und beim Import komprimierter Audiodateien gibt es unterhalb der sicheren
Ganzzahlgrenze keine feste Datei- oder Dauergrenze. Lange Aufgaben lesen, codieren und speichern
in Blöcken; große Browser-Exporte erfordern origin-privaten Dateispeicher und genügend freien
Speicherplatz. Große Importe erfordern ausreichend lokalen Speicher für das decodierte Audio.
Dateiaufbau, Decoderunterstützung und verfügbarer Speicher können einen Import weiterhin
begrenzen.

Die Browser-Ebene deckt MP3, MP2, FLAC, WavPack, Opus und Ogg Vorbis ab. Die Unterstützung von Browser-AAC/M4A hängt vom Browser-Codec ab. Desktop-Streaming-Exporte decken
die sechs gebündelten Formate ab, mit 24-Bit-FLAC und float32-lossless WavPack. Desktop-Importe
hängen von der Decoderverfügbarkeit ab; große MP2-Quellen verwenden den Paketdecoder, kleinere
MP2-Quellen die Hilfsprogramm-Kompatibilitätsebene.

Eine aktive Aufgabe zeigt eine Fortschrittsleiste an, auch wenn **Ansicht → Statusleiste** versteckt ist. Wählen Sie **Abbrechen** neben der Leiste, um einen Import oder einen Audio-Export zu stoppen.

## Bearbeitbare Projektdateien

- Scape (`.sscape` von Soundscaper, `.fscape` von Framescaper und beide öffnbar) ist das tragbare, vollwertige Projektformat, das von Soundscaper
  und Framescaper geteilt wird.
- AUP3 und AUP4 sind reine Audio-Austauschformate für Audacity. Wählen Sie AUP3 für das
  Audacity-3.7.9-Projektprofil oder AUP4 für das aktuelle Austauschprofil. Keines der Formate
  ist eine vollständige Sicherung eines gemischten Soundscaper-Projekts; prüfen Sie nach dem
  Export den Kompatibilitätsbericht.
- Adobe Audition SESX (`.sesx`) kann in der Desktop-Ausgabe geöffnet werden, um aus den
  referenzierten Audiodateien ein lokales Projekt zu erstellen. Bewahren Sie die ursprüngliche
  Sitzung und die Medien auf; ein SESX-Export ist nicht verfügbar.

Weitere Informationen finden Sie unter [Projektdateien](/projects-and-data/project-files/).

## Gerenderte Lieferungen

Audio-Exporte erstellen Dateien, die zum Anhören, Veröffentlichen oder für weitere
Verarbeitung gedacht sind. Video-Exporte erstellen MP4- oder WebM-Lieferungen. Eine gerenderte Datei
behält nicht die bearbeitbare Zeitleiste, Routing, Effekte oder Projektverlauf.

Weitere Informationen finden Sie im [Referenzabschnitt](/reference/).
