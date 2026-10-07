---
title: "Projektdateien"
description: "Wählen Sie zwischen der lokalen Bibliothek, Scape-Projektdateien, dem Audacity-Austauschformat, SESX-Import und gerenderten Sicherungen."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","targetLocale":"de"} -->

## Lokale Projektbibliothek

Der Editor speichert Arbeitsprojekte in seiner lokalen Bibliothek. In einem Browser ist dies der origin-private Speicher; in der Desktop-Ausgabe handelt es sich um Anwenderdaten. Dies ist die bequeme Arbeitskopie, nicht die einzige Kopie, die Sie aufbewahren sollten.

## Scape-Projektdateien

Verwenden Sie **Datei → Projektdatei exportieren**, um das Bearbeitungsprojekt zu speichern. Jedes Produkt verwendet eine eigene Dateiendung: Soundscaper speichert `.sscape` und Framescaper `.fscape`; der Menüeintrag nennt die jeweils passende. Beiden liegt dasselbe Format zugrunde. Es eignet sich daher, um den Bearbeitungsstand mit gemischten Medien zu erhalten.

In der Desktop-Ausgabe bleiben importiertes Audio und Video standardmäßig Verweise auf ihre Originaldateien. Lassen Sie diese Dateien beim erneuten Öffnen des Projekts an ihrem ursprünglichen Speicherort. Die lokale Bibliothek bewahrt außerdem Bearbeitungscaches auf. Aufnahmen sowie erzeugte oder verarbeitete Medien werden eingebettet, da es dafür kein unverändertes externes Original gibt.

Wählen Sie **Datei → Projektverwaltung → Medien zusammenführen**, um referenzierte Medien in die Projektdatei einzubetten. Dadurch wird das Projekt sofort gespeichert; wählen Sie im Speicherdialog ein Ziel. Nach dem Speichern lässt sich die zusammengeführte Kopie ohne die Originaldateien verschieben oder teilen. Wenn Medien nicht eingebettet werden können oder das Speichern fehlschlägt, meldet der Editor das Problem.

Browser-Exporte betten ihre Medien automatisch ein. Bevor Sie ein Desktop-Projekt mit externen Verweisen im Browser öffnen, führen Sie die Medien auf dem Desktop zusammen.

Jedes Produkt kann beide Suffixe öffnen. `.sscape`, `.fscape`, das reservierte `.liscape` und die älteren `.scape` Dateien, die vor der Einführung der eigenen Suffixe der Produkte exportiert wurden, können überall geöffnet werden, und das Speichern einer solchen Datei aus einem anderen Produkt benennt sie einfach um – beispielsweise wird eine `Mix.sscape` Datei, die aus Framescaper gespeichert wurde, zu `Mix.fscape`. Nichts am Projekt ändert sich mit dem Namen.

Beim Importieren oder Öffnen einer Scape-Kopie kann es zu einer bereits vorhandenen Projekt-ID kommen. Verwenden Sie den angebotenen Kopier-Workflow, wenn beide Versionen in der lokalen Bibliothek verbleiben müssen.

## Audacity AUP3 und AUP4

Der Audacity-Projektexport ist über **Datei → Sonstiges exportieren** verfügbar. Wählen Sie **AUP3 exportieren**, um das Audacity-3.7.9-Projektprofil zu verwenden, oder **AUP4 exportieren** für das aktuelle Audacity-Austauschprofil. Jeder Export erstellt einen Kompatibilitätsbericht zu Konvertierungen, nicht verfügbaren Effekten und ausgelassenem Soundscaper-spezifischem Zustand.

Beide Formate enthalten nur Audio. Video wird ausgelassen; Browsereinstellungen, Rückgängig-Verlauf, Mixer-Routing und die Projektbibliothek des Browsers werden nicht übertragen. Verwenden Sie keines der beiden Formate als einzige Sicherung eines Soundscaper- oder Framescaper-Projekts.

## Adobe Audition SESX

Verwenden Sie in der Desktop-Ausgabe **Datei → Öffnen**, um eine Adobe-Audition-Sitzung im Format `.sesx` zu importieren. Lassen Sie die referenzierten Audiodateien in ihrer relativen Ordnerstruktur unterhalb des Sitzungsordners oder wählen Sie bei entsprechender Aufforderung einen Medienordner aus. Der Import erstellt ein neues lokales Projekt mit unterstützten Audiospuren, Clips, Positionen, Schnitten, einfachen Fades und statischen Mixer-Einstellungen.

Der SESX-Import ist einseitig. Audition-Effekte, Automatisierung, Routing, Video, Marker, Schleifen, Time-Stretching, verknüpfte Crossfades und exakte Fade-Kurven werden nicht übernommen. Öffnen Sie nach dem Import **Datei → Auslieferungsbericht**, um fehlende Medien und andere ausgelassene Inhalte zu prüfen. Bewahren Sie die ursprüngliche SESX-Datei und ihre Medien für die weitere Arbeit in Audition auf.

## Gerenderte Sicherung

Für wichtige Arbeiten sollten Sie Folgendes aufbewahren:

1. Eine Scape-Projektkopie (`.sscape` oder `.fscape`) für zukünftige Bearbeitungen.
2. Eine gerenderte Audio- oder Videodatei, die ohne den Editor abgespielt werden kann.

Speichern Sie diese Dateien außerhalb des Browser- oder Anwenderdatenverzeichnisses.
