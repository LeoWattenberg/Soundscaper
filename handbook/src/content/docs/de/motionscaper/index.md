---
title: "Motionscaper"
description: "Erstelle animierte Kompositionen und bewahre bearbeitbare Motion-Projekte lokal auf."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","targetLocale":"de"} -->

Motionscaper ist der Motion-Graphics-Editor der Scaper-Familie. Ein Projekt
enthält Kompositionen, Ebenen, Animationen und gespeicherte Medien. Seine
Projektdateien haben die Erweiterung `.mscape`.

Dies ist eine Entwicklungsversion. Beginne mit einer Kopie wichtiger
Quelldateien und bewahre exportierte Projektarchive neben deiner
Arbeitsbibliothek auf.

## Eine Komposition starten {#start-a-composition}

Wähle **Datei → Neue Komposition**. Das Menü **Ebene** öffnet Werkzeuge für
Text, Formen, Animation, Compositing, Tracking, Ausdrücke und 3D-Szenen.
**Ansicht → Kompositionsvorschau** öffnet die Wiedergabe. Neue
Bearbeitungsflächen erscheinen erst, wenn du sie über ein Menü auswählst.

Wähle **Ansicht → Kompositions-Canvas**, um Ebenen mit statischen
2D-Transformationen auszuwählen, zu verschieben, zu skalieren oder zu drehen.
Animierte Transformationen bearbeitest du weiterhin über die Eigenschaften
und die Zeitleiste.

Unter **Ansicht → Zeitleiste** kannst du vorhandene Ebenen auswählen und
umbenennen, aktivieren, deaktivieren oder entfernen. Beim Umbenennen bleiben
Eigenschaftsverweise und Animationen erhalten. Auch beim Entfernen einer Ebene
bleiben ihre Originalmedien gespeichert. Wähle abhängige Ebenen mit aus oder
löse zuvor ihre Verknüpfungen. **Rückgängig** stellt entfernte Ebenen wieder her.
Für eine ausgewählte Videoebene gibt es außerdem ein Audio-Kontrollkästchen,
wenn ihre gespeicherte Quelle Audio enthält.

Folge der Anleitung [Dein erstes Motion-Projekt](/motionscaper/first-project/),
um eine Komposition zu erstellen, zu animieren, zu speichern und zu rendern.

## Speichern und ausgeben {#save-and-deliver}

**Datei → Speichern** veröffentlicht eine gespeicherte Revision.
**Kopie speichern** exportiert den aktuellen Stand als `.mscape`-Archiv,
ohne eine neue gespeicherte Revision zu veröffentlichen. Importierte
Originalmedien und Schriftarten werden im Archiv mitgeführt. Die
**Projektbibliothek** öffnet Projekte, die auf diesem Gerät gespeichert sind.

**Datei → Rendern** bietet transparente PNG-Bilder in einem TAR-Archiv,
MP4- oder WebM-Video ohne Transparenz sowie ProRes 4444, wenn der Desktop-Encoder
verfügbar ist. PNG-Sequenzen enthalten kein Audio. Browser-Video enthält das im
Projekt verwendete Audio, sofern der Encoder das angeforderte Format unterstützt.
Bei nativem ProRes zeigt der Render-Dialog die effektive Farb- und
Alpha-Präzision an. **Datei → Render-Warteschlange** hält Aufträge auch nach dem
Schließen des Dialogs und bei Projektwechseln verfügbar. Sie bewahrt bis zu acht
Aufträge und insgesamt 128 MiB an Browser-Downloads auf; ein einzelner Download
darf bis zu 64 MiB groß sein. Wähle für größere Ausgaben ein Dateiziel, in das
direkt geschrieben wird. Entferne abgeschlossene Aufträge, um gespeicherte
Downloads freizugeben. Wenn die Bereinigung einer nativen Ausgabe fehlschlägt,
wähle in der Warteschlange **Ausgabe-Bereinigung erneut versuchen**. Der Auftrag
behält sein Ziel, bis die Bereinigung erfolgreich ist. Danach kannst du ihn
entfernen oder die eingereichte Revision mit einem neuen Ziel erneut rendern.

## Mit Framescaper verknüpfen {#link-to-framescaper}

Verknüpfte Kompositionen benötigen die separate Framescaper-1.1-Entwicklungslinie.
Erstelle dort unter **Datei → Verknüpfte Kompositionen** eine Verbindungs-URL.
Füge sie in Motionscaper unter **Datei → Komposition an Framescaper senden** ein,
stelle die Verbindung her und lasse die Editoren und Brückenfenster geöffnet.
Spätere **Speichern**-Vorgänge senden neue Revisionen automatisch;
**Kopie speichern** tut dies nicht.

Framescaper bewahrt jede akzeptierte Revision mit allen zugehörigen Medien für
die Offline-Nutzung auf. **Rückgängig** fixiert eine frühere Revision, bis du die
Aktualisierungen fortsetzt. Änderungen an Ausgabegröße, Zeitverhalten oder
Audio-Raster erfordern eine ausdrückliche Prüfung der Anpassung (Conform).
Der Desktop-Empfänger kann stattdessen eine gespeicherte `.mscape`-Datei
beobachten, die du auswählst.

## Nach Desktop-Updates suchen {#check-desktop-updates}

Wähle in der Desktop-App **Hilfe → Nach Updates suchen**. Diese manuelle Prüfung
sucht im GitHub-Repository des Projekts nach kompatiblen Motionscaper-Releases.
Vorschauversionen können neuere Vorschau-Releases erhalten; stabile Versionen
erhalten stabile Releases. Wähle **Release ansehen**, um die geprüfte
Release-Seite zu öffnen. Die Prüfung lädt kein Update herunter und installiert
keines. In der Browser-Version gibt es diesen Menübefehl nicht.

## Austausch mit After Effects {#after-effects-exchange}

**Datei → After-Effects-Austausch** bietet lesbare Skripte und eine Prüfung der
unterstützten Austauschdaten vor dem Import. `.aep`- und `.aepx`-Dateien werden
über eine installierte Version von After Effects und die Austausch-Skripte
geöffnet. Der Austausch befindet sich in Entwicklung und wurde noch nicht mit
einer installierten After-Effects-Version qualifiziert. Prüfe den Bericht;
nicht unterstützte Szeneneinstellungen und Originalmedien bleiben im Projekt
zur späteren Wiederverwendung erhalten.

Der Dialog bietet getrennte Import- und Exportoptionen für unterstützte skalare
Deckkraft-Ausdrücke mit Arithmetik, Kompositionszeit, dem Wert vor der
Auswertung des Ausdrucks und Standard-Math-Funktionen. Beide Optionen sind
anfangs deaktiviert. Prüfe nach jeder Änderung einer Option den neuen Bericht.
Andere Ausdrucksformen erfordern eine ausdrücklich gewählte Abtastung oder ein
Rendering. Der ursprüngliche Ausdruckstext bleibt in den aufbewahrten
Austauschdaten oder im Archiv `original.mscape` erhalten.

Der Renderer unterstützt SDR-Farbe und Alpha mit 2,5D-Ebenen, Kameras, Lichtern,
Abtastung innerhalb der Verschlusszeit und Schärfentiefe. Er beansprucht keine
Unterstützung für HDR, vollständige 3D-Netze, fortgeschrittene KI-Maskierung oder
beliebige After-Effects-Plug-ins.
