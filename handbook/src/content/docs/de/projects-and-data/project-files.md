---
title: "Projektdateien"
description: "Wählen Sie zwischen der lokalen Bibliothek, Scape-Projektdateien, AUP4 und gerenderten Sicherungen."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"de"} -->

## Lokale Projektbibliothek

Der Editor speichert Arbeitsprojekte in seiner lokalen Bibliothek. In einem Browser ist dies der origin-private Speicher; in der Desktop-Ausgabe handelt es sich um Anwenderdaten. Dies ist die bequeme Arbeitskopie, nicht die einzige Kopie, die Sie aufbewahren sollten.

## Scape-Projektdateien

Verwenden Sie **Datei → Projekt-Datei exportieren** für ein verlustfreies, tragbares Projekt. Jedes Produkt schreibt seinen eigenen Suffix: Soundscaper speichert `.sscape` und Framescaper speichert `.fscape`, und der Menü-Eintrag nennt den jeweils zutreffenden. Das Format hinter beiden ist dasselbe, daher ist es die richtige Wahl, wenn Sie den gemischten Medien-Bearbeitungsstatus erhalten müssen.

Jedes Produkt kann beide Suffixe öffnen. `.sscape`, `.fscape`, das reservierte `.liscape` und die älteren `.scape` Dateien, die vor der Einführung der eigenen Suffixe der Produkte exportiert wurden, können überall geöffnet werden, und das Speichern einer solchen Datei aus einem anderen Produkt benennt sie einfach um – beispielsweise wird eine `Mix.sscape` Datei, die aus Framescaper gespeichert wurde, zu `Mix.fscape`. Nichts am Projekt ändert sich mit dem Namen.

Beim Importieren oder Öffnen einer Scape-Kopie kann es zu einer bereits vorhandenen Projekt-ID kommen. Verwenden Sie den angebotenen Kopier-Workflow, wenn beide Versionen in der lokalen Bibliothek verbleiben müssen.

## AUP4

AUP4 existiert für einen kompatiblen Audio-Austausch mit Audacity. Der Export erstellt einen Kompatibilitätsbericht, der Konvertierungen, nicht verfügbare Effekte und ausgelassenen Soundscaper-spezifischen Status beschreibt.

AUP4 ist nur Audio. Video wird ausgelassen, und Browser-Einstellungen, Rückgängig-Historie, Mixer-Routing und die Projektbibliothek des Browsers werden nicht übertragen. Verwenden Sie AUP4 nicht als einzige Sicherung eines Soundscaper- oder Framescaper-Projekts.

## Gerenderte Sicherung

Für wichtige Arbeiten sollten Sie Folgendes aufbewahren:

1. Eine Scape-Projektkopie (`.sscape` oder `.fscape`) für zukünftige Bearbeitungen.
2. Eine gerenderte Audio- oder Videodatei, die ohne den Editor abgespielt werden kann.

Speichern Sie diese Dateien außerhalb des Browser- oder Anwenderdatenverzeichnisses.