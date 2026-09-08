---
title: "Importieren und Exportieren"
description: "Unterscheiden Sie zwischen Quellmedien, Projektdateien, Austauschdateien und gerenderten Auslieferungen."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"fd6f45277d29c1bf8e2d17b2265b46483362e3c945300ee8420ac6676ca7d878","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fd6f45277d29c1bf8e2d17b2265b46483362e3c945300ee8420ac6676ca7d878","targetLocale":"de"} -->

Soundscaper verwendet verschiedene Dateitypen für unterschiedliche Aufgaben.

## Quellmedien

Verwenden Sie **Datei → Importieren** für Audio, Video und Beschriftungen. Die aktuelle Editor-Hinweisliste enthält
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF und WebM; zusätzliche Video-Container werden über den Video-Importpfad unterstützt. Die Verfügbarkeit kann von
dem aktiven Produkt und der Laufzeit abhängen.

Das Importieren von Medien fügt eine projektbesitze Quelle hinzu. Es macht die Originaldatei
nicht zu Ihrem bearbeitbaren Projektdokument.

## Bearbeitbare Projektdateien

- Scape (`.sscape` von Soundscaper, `.fscape` von Framescaper und beide in beiden öffnbar) ist das tragbare, vollwertige Projektformat, das von Soundscaper
  und Framescaper geteilt wird.
- AUP4 ist ein Audio-only-Austauschformat mit Audacity. Es ist kein vollständiger Backup eines
  gemischten Medien-Soundscaper-Projekts.

Siehe [Projektdateien](/projects-and-data/project-files/) für die Folgen
jeder Wahl.

## Gerenderte Auslieferungen

Audio-Exporte erstellen Dateien, die zum Anhören, Veröffentlichen oder für weitere
Verarbeitung gedacht sind. Video-Exporte erstellen MP4- oder WebM-Auslieferungen. Eine gerenderte Datei
behält nicht die bearbeitbare Zeitleiste, Routing, Effekte oder Projektverlauf.

Konsultieren Sie den [Referenzabschnitt](/reference/) für die generierte Format- und
Produktfähigkeits-Tabellen.