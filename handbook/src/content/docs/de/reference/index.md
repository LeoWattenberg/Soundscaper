---
title: "Referenz"
description: "Generierte Befehle, Tastenkombinationen, Formate, Effekte und Tabellen zu den Produktdaten."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b7e4df92cd36126d4ce3865383043516972e9aca463c3449b731085cafc4050e","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b7e4df92cd36126d4ce3865383043516972e9aca463c3449b731085cafc4050e","targetLocale":"de"} -->

Referenzseiten werden aus überprüften Laufzeitregistern generiert und in das Repository eingecheckt. Sie beschreiben das implementierte Verhalten, nicht die Roadmap-Einträge oder das bloße Vorhandensein von Quelldateien und Tests.

Verwenden Sie diesen Abschnitt, um Fragen wie diese zu beantworten:

- Welcher Standard-Verknüpfung löst einen Befehl aus?
- Ist ein Befehl in Soundscaper, Framescaper oder in beiden verfügbar?
- Welche Audio- und Videoformate können exportiert werden?
- Auf welchen Wert ist der Parameter eines Effekts standardmäßig gesetzt, und welche Werte werden akzeptiert?
- Welche Effekte können während der Audiowiedergabe ausgeführt werden, und welche benötigen eine Auswahl?
- Welche lokalen Assistenz-Workflows existieren, und welche Modelle benötigen sie?
- Welche Panels zeigt jeder Arbeitsbereich an?
- Welche Sprachen, Browser und Desktop-Pakete werden erstellt und getestet?
- Welche Funktionen hängen von einem Produkt, einer Plattform oder einer FFmpeg-Laufzeit ab?

Die generierten Seiten enthalten ihre Quellherkunft und werden im Qualitäts-Gate des Repositories auf Abweichungen überprüft.

[Makro-Programme](/reference/macro-programs/) ist die einzige Seite hier, die von Hand geschrieben wurde. Sie dokumentiert die JavaScript-API, gegen die ein Makro-Programm ausgeführt wird, und ihre Aussagen sind diejenigen, an die die eigenen Tests des Editors das Sandbox-Umfeld messen.