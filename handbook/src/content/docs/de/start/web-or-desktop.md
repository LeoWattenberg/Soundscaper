---
title: "Web oder Desktop"
description: "Erfahren Sie, wie Browser- und verpackte Desktop-Ausgaben Projekte speichern und auf Dateien zugreifen."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","targetLocale":"de"} -->

## Web-Editor

Die Browser-Version speichert Projekte, Aufnahmen und importierte Medien in origin-privatem Browser-Speicher. Es lädt kein Projekt auf ein Soundscaper-Konto hoch und erfordert kein Konto. 

Verwenden Sie den Web-Editor, wenn Sie sofortigen Zugriff ohne Installation einer App wünschen. Denken Sie daran, dass der Browser-Speicher den Browser-Kontingent- und Räumungsregeln unterliegt. Das Löschen von Website-Daten entfernt die lokale Projektbibliothek.

## Desktop-Vorschau

Verpackte Desktop-Vorschauen speichern eine automatisch gespeicherte lokale Bibliothek innerhalb der Desktop-Anwendung. Sie bündeln den Editor-Runtime und veröffentlichte Übersetzungen für Offline-Bearbeitung.

Desktop-Pakete sind nicht signiert. macOS wendet nur das identitätsfreie Werbe-Haftsiegel an, das sein Lader benötigt, um Electron und native Binärdateien auszuführen; dieses Siegel macht keinen Herausgeber- oder Vertrauensanspruch. Windows SmartScreen oder macOS Gatekeeper können daher eine Warnung für Vorschau- und Stabilpakete von unbekannten Entwicklern anzeigen.

Das Öffnen einer `.aup4`-Datei importiert ein unabhängiges Projekt in die Desktop-Bibliothek. Spätere Bearbeitungen überschreiben nicht die geöffnete Datei. **Speichern** aktualisiert die Bibliothekskopie; **Als... speichern** erstellt eine neue Audacity-Austauschdatei.

## Telefone und Tablets

Der Web-Editor behält sein Desktop-Layout auf jedem Bildschirm bei, aber unter 900px Breite (ein Telefon oder ein im Hochformat gehaltenes Tablet) faltet er die Oberfläche in Schubladen, so dass die Zeitleiste den Platz behält:

- Die **Menü**-Taste in der oberen linken Ecke öffnet eine Schublade mit dem vollständigen Anwendungsmenü, den Projekt-Tabs, der Aktionsleiste und der Werkzeugleiste. Abspielen, Anhalten, Aufnehmen und Suchen bleiben in der Leiste. Die Auswahl eines Befehls schließt die Schublade.
- Die Spurüberschriften gleiten über die Spuren vom **Spurüberschriften**-Griff in der oberen linken Ecke der Zeitleiste oder von **Ansicht › Spurüberschriften**. Tippen Sie auf die Spuren oder drücken Sie die Escape-Taste, um sie wieder zu verstauen.
- Die Einführung über dem Editor ist standardmäßig bei schmalen Bildschirmen zusammengeklappt; **Einführung anzeigen** bringt sie zurück.

**Bearbeiten › Einstellungen › Erscheinungsbild › Layout** wechselt zwischen Automatisch, Kompakt und Desktop, so dass ein kleines Fenster auf einem Desktop den Desktop-Oberflächen behalten kann und ein breites Tablet sich für die Schubladen entscheiden kann.

## Projekte bewegen sich nicht automatisch

Die Browser- und Desktop-Bibliotheken sind getrennt. Verschieben Sie ein Projekt absichtlich:

- Verwenden Sie eine Scape-Projektdatei — `.sscape` von Soundscaper, `.fscape` von Framescaper — für das gesamte Projekt.
- Verwenden Sie AUP4, wenn Sie speziell einen Audioaustausch mit Audacity benötigen.
- Exportieren Sie gerenderte Audio- oder Videodaten als dauerhafte Wiedergabekopie.

Siehe [Projekt-Dateien](/projects-and-data/project-files/), bevor Sie Browser-Site-Daten oder Desktop-Anwendungsdaten löschen.