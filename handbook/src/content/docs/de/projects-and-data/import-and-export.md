---
title: "Importieren und Exportieren"
description: "Unterscheiden Sie zwischen Quellmedien, Projektdateien, Austauschdateien und gerenderten Auslieferungen."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","targetLocale":"de"} -->

Soundscaper verwendet verschiedene Dateitypen für unterschiedliche Aufgaben.

## Quellmedien

Verwenden Sie **Datei → Importieren** für Audio, Video und Beschriftungen. Die aktuelle Editor-Hinweisliste enthält
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF und WebM; zusätzliche Video-Container werden über den Video-Importpfad unterstützt. Die Verfügbarkeit kann von
dem aktiven Produkt und der Laufzeit abhängen.

Der Import von Medien fügt eine projektbesitze Quelle hinzu. Es macht die Originaldatei
nicht zu Ihrem bearbeitbaren Projektdokument.

Komprimierte Audio-Importe und -Exporte unterstützen bis zu eine Stunde oder 1 GB
(1.000.000.000 Dateibyte), je nachdem, welches Limit zuerst erreicht wird. Eine einstündige
48-kHz-Stereo-Datei wird unterstützt, wenn sie dieses Dateilimit einhält. Lange Aufgaben lesen,
codieren und speichern in Blöcken; große Browser-Exporte erfordern origin-privaten Dateispeicher und
genügend freien Speicherplatz. Große Importe erfordern eine persistente lokale Speicherung
für das decodierte Audio. PCM-Formate behalten ihre separaten Grenzen.

Die Browser-Ebene deckt MP3, MP2, FLAC, WavPack, Opus und Ogg Vorbis ab. Die Unterstützung von Browser-AAC/M4A hängt vom Browser-Codec ab. Desktop-Streaming-Exporte decken
die sechs gebündelten Formate ab, mit 24-Bit-FLAC und float32-lossless WavPack. Desktop-Importe hängen von der Verfügbarkeit des nativen Decoders ab; MP2 verwendet die kleinere Dienstprogramm-Kompatibilitätsebene. Desktop-AAC und Kompatibilitätsanbieter behalten ihre
separaten Grenzen.

Eine aktive Aufgabe zeigt eine Fortschrittsleiste an, auch wenn **Ansicht → Statusleiste** versteckt ist. Wählen Sie **Abbrechen** neben der Leiste, um einen Import oder einen Audio-Export zu stoppen.

## Bearbeitbare Projektdateien

- Scape (`.sscape` von Soundscaper, `.fscape` von Framescaper und beide öffnbar) ist das tragbare, vollwertige Projektformat, das von Soundscaper
  und Framescaper geteilt wird.
- AUP4 ist ein Audio-only-Austausch mit Audacity. Es ist kein vollständiger Backup eines
  gemischten Medien-Soundscaper-Projekts.

Weitere Informationen finden Sie unter [Projektdateien](/projects-and-data/project-files/).

## Gerenderte Lieferungen

Audio-Exporte erstellen Dateien, die zum Anhören, Veröffentlichen oder für weitere
Verarbeitung gedacht sind. Video-Exporte erstellen MP4- oder WebM-Lieferungen. Eine gerenderte Datei
behält nicht die bearbeitbare Zeitleiste, Routing, Effekte oder Projektverlauf.

Weitere Informationen finden Sie im [Referenzabschnitt](/reference/).
