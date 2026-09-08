---
title: "Speicher, Sicherungen und Datenschutz"
description: "Verstehen Sie die lokale Vorrangspeicherung und schützen Sie Projekte vor Browser- oder Geräteverlust."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"de"} -->

## Was 'local-first' bedeutet

Projekte, Aufnahmen und importierte Medien werden auf Ihrem
Gerät verarbeitet und gespeichert. Der Editor erfordert kein Konto oder synchronisiert Projekte mit
einem Soundscaper-Dienst.

Im Web verwenden Audio- und Medieninhalte das origin-private Dateisystem des Browsers, wenn verfügbar, mit IndexedDB als Rückfalloption. Soundscaper beantragt dauerhaften Speicher,
aber der Browser entscheidet, ob er gewährt wird.

## Was ein Projekt entfernen kann

- Das Löschen von Seitendaten entfernt die lokale Projektbibliothek des Browsers.
- Private oder eingeschränkte Browser-Kontexte können auf temporären Speicher zurückgreifen.
- Browser-Kontingent- und Räumrichtlinien bleiben verbindlich.
- Das manuelle Entfernen von Daten der Desktop-Anwendung löscht ihre lokale Bibliothek.
- Ein Geräte- oder Speicherausfall kann jede lokale Kopie auf diesem Gerät entfernen.

Die Deinstallation eines verpackten Desktop-Builds ist so konzipiert, dass sie die Bibliothek erhalten bleibt, aber
dies ist keine Sicherungsstrategie.

## Sicherungsroutine

Bei nützlichen Meilensteinen und vor dem Löschen oder Migrieren von Speicher:

1. Warten Sie, bis das lokale Speichern abgeschlossen ist.
2. Exportieren Sie eine Scape-Projektdatei (`.sscape` oder `.fscape`).
3. Exportieren und abspielen Sie eine gerenderte Lieferung.
4. Kopieren Sie beides auf einen Speicher außerhalb der lokalen Daten des Editors.

Verwenden Sie AUP4 zusätzlich, wenn der Audacity-Austausch wichtig ist, nicht anstelle der
Kopie des Scape-Projekts.

## Datenschutz auf der Dokumentationsseite

Dieses Handbuch wird als statische Dateien bereitgestellt und verwendet die lokale Suche des Browsers. Die V1
Site fügt keinen Analysedienst oder ein AI/search Backend hinzu.

Die vollständige [Soundscaper und Framescaper Datenschutzrichtlinie](https://soundscaper.org/privacy/en/)
beinhaltet auch die Anwendungslieferung, Geräteberechtigungen, optionale Downloads,
Desktop-Update-Prüfungen und Framescaper Web VCR-Verbindungen.