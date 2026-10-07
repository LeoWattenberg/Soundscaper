---
title: "Eine importierte Datei auf dem Desktop überschreiben"
description: "Speichere das bearbeitete Projekt in Soundscaper oder Framescaper über der ursprünglichen Mediendatei."
sidebar:
  order: 10
---
<!-- docs-ai-provenance: {"factPacketSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","targetLocale":"de"} -->

In den Electron-Versionen von Soundscaper und Framescaper exportiert **Datei → Dateiname überschreiben** das vollständig bearbeitete Projekt in die ursprüngliche importierte Mediendatei. Der Befehl verwendet die unterstützten Exporteinstellungen der Originaldatei und speichert sofort, ohne den Exportdialog oder einen Dateiauswahldialog zu öffnen. Audio behält sein Quellformat, seine Abtastrate und seine Kanalzahl. Unterstützte MP4- und WebM-Videos behalten ihren Quellcontainer, ihre Abmessungen und ihre Bildrate.

Importiere eine Mediendatei über **Datei → Importieren**, nimm deine Änderungen vor und wähle dann **Datei → Dateiname überschreiben**. Nach weiteren Änderungen kannst du den Vorgang wiederholen. Eine Zeitauswahl begrenzt das Überschreiben nicht: Es wird immer das vollständige Projekt gerendert. Das Projekt behält seine importierten Medien und den Bearbeitungsverlauf.

Der Befehl ist nicht verfügbar, wenn das Projekt keine unterstützte Originaldatei enthält, wenn mehrere Originaldateien importiert wurden oder während des Importierens, Aufnehmens oder Verarbeitens. Browser-Versionen verwenden den normalen Exportdialog.

Wähle in Soundscaper **Datei → Audio exportieren** oder in Framescaper **Datei → Video exportieren**, wenn du ein anderes Ziel wählen oder die Ausgabeinstellungen ändern möchtest. Beim Überschreiben wird der Inhalt der Originaldatei ersetzt. Bewahre eine separate Kopie auf, wenn du die unbearbeitete Aufnahme benötigst.
