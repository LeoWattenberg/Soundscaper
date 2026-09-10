---
title: "Video exportieren"
description: "Die zusammengesetzte Sequenz validieren und eine MP4- oder WebM-Lieferdatei erstellen."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","targetLocale":"de"} -->

## Vor dem Export

- Durchlaufen Sie die vollständige Sequenz und jede Schnittgrenze.
- Stellen Sie sicher, dass sichtbare und solo-aktivierte Spuren das beabsichtigte Bild erzeugen.
- Prüfen Sie, ob verknüpfte Audiospuren synchron bleiben.
- Bestätigen Sie den Exportbereich und ob Untertitel oder Audio enthalten sein sollen.

## Datei erstellen

Öffnen Sie den Export-Dialog und wählen Sie ein Videoformat. Framescaper unterstützt die Bereitstellung von MP4 und WebM über die konfigurierte Video-Runtime. Wählen Sie die für das Ziel geeigneten Abmessungen, Bildrate und anderen Optionen.

Die Video-Kodierung ist ressourcenintensiver als die normale Timeline-Wiedergabe.
Halten Sie den Editor geöffnet, bis der Export die Fertigstellung meldet.

## Lieferung überprüfen

Öffnen Sie die exportierte Datei in einem separaten Player. Prüfen Sie die Dauer, den ersten und letzten Frame, die Bildausrichtung, die Audio-Synchronisation und die erwarteten Untertitel.

Das gerenderte Video kann das bearbeitbare Projekt nicht ersetzen. Exportieren Sie auch eine `.fscape`-Kopie, wenn Sie die Timeline und die Projektdatenmedien beibehalten müssen.
