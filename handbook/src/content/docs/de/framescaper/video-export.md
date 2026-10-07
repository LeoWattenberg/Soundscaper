---
title: "Video exportieren"
description: "Die zusammengesetzte Sequenz validieren und eine MP4- oder WebM-Lieferdatei erstellen."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"de"} -->

## Vor dem Export

- Durchlaufen Sie die vollständige Sequenz und jede Schnittgrenze.
- Stellen Sie sicher, dass sichtbare und solo-aktivierte Spuren das beabsichtigte Bild erzeugen.
- Prüfen Sie, ob verknüpfte Audiospuren synchron bleiben.
- Bestätigen Sie den Exportbereich und ob Untertitel oder Audio enthalten sein sollen.

## Datei erstellen

Öffnen Sie den Export-Dialog und wählen Sie ein Videoformat. Framescaper unterstützt die Bereitstellung von MP4 und WebM über die konfigurierte Video-Runtime. Wählen Sie die für das Ziel geeigneten Abmessungen, Bildrate und anderen Optionen.

Die Video-Kodierung ist ressourcenintensiver als die normale Timeline-Wiedergabe.
Halten Sie den Editor geöffnet, bis der Export die Fertigstellung meldet.

## Audioclips separat exportieren {#export-audio-clips}

Wählen Sie **Datei → Video exportieren**, ein Audioformat wie **WAV** und setzen
Sie **Ausgabe** auf **Einzelne Clips (nach Clips aufteilen)**. Der Export lädt ein
Archiv mit einer Datei für jeden Audioclip herunter. Videoclips werden
ausgelassen, und jede Audiodatei enthält nur den jeweiligen Clip einschließlich
seiner Schnitte und Clip-Bearbeitungen.
Die Dateien beginnen am hörbaren Anfang des Clips, ohne Auffüllung bis zur
Projektposition oder Effekt-Ausklang. Nummerierte Clipnamen unterscheiden auch
wiederholte Namen.

Spureffekte sind enthalten; Mastereffekte, Stummschaltung und Solo wirken sich
nicht auf diesen Export aus. Siehe [Clips als separate Dateien exportieren](/soundscaper/edit-mix-and-export/#export-clips)
für den gemeinsamen Audio-Workflow.

## Lieferung überprüfen

Öffnen Sie die exportierte Datei in einem separaten Player. Prüfen Sie die Dauer, den ersten und letzten Frame, die Bildausrichtung, die Audio-Synchronisation und die erwarteten Untertitel.

Das gerenderte Video kann das bearbeitbare Projekt nicht ersetzen. Exportieren Sie auch eine `.fscape`-Kopie, wenn Sie die Timeline und die Projektdatenmedien beibehalten müssen.
