---
title: "Dein erstes Motion-Projekt"
description: "Erstelle eine Komposition, animiere eine Ebene und exportiere ein gespeichertes Projekt."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","targetLocale":"de"} -->

## Eine Komposition erstellen und eine Ebene hinzufügen {#create-and-add-a-layer}

1. Wähle **Datei → Neue Komposition** und gib einen Titel, Abmessungen,
   Bildrate und Dauer in Bildern ein.
2. Wähle **Ebene → Neuer Text** oder **Ebene → Neue Farbfläche**. Wähle die
   Zielkomposition aus, wenn das Projekt mehrere Kompositionen enthält.
3. Öffne **Ebene → Text und Aussehen**, um eine vorhandene Textebene oder die
   Füllungen und Konturen einer Form zu bearbeiten. Hier importierte
   Schriftarten werden mit dem Projekt gespeichert.

Verwende **Datei → Medien importieren** für Bild-, Video- oder Audioquellen.
Überschreitet ein Import die aktuellen Decoder- oder Speichergrenzen, wird er
mit einer Erklärung abgelehnt. Die ursprüngliche Quelldatei bleibt unverändert.

## Animieren und Vorschau ansehen {#animate-and-preview}

Öffne **Ebene → Eigenschaften und Schlüsselbilder**, um eine Ebeneneigenschaft
zu wählen und Schlüsselbilder an exakten Bildpositionen hinzuzufügen. Mit den
Kurvenwerkzeugen änderst du die Interpolation; mit der räumlichen Bearbeitung
die Positionspfade. **Ansicht → Zeitleiste** öffnet die Werkzeuge für
Ebenenzeit, Reihenfolge, Gruppierung und Arbeitsbereich.

Öffne **Ansicht → Kompositions-Canvas**, um eine statische 2D-Ebene auszuwählen
und zu verschieben. Das Quadrat skaliert sie; der Kreis dreht sie um ihren
festgelegten Ankerpunkt. Jeder abgeschlossene Ziehvorgang ist ein
Rückgängig-Schritt. Escape bricht das Ziehen ab. Animierte und durch Ausdrücke
gesteuerte Transformationen bearbeitest du weiterhin unter
**Eigenschaften und Schlüsselbilder**.

Öffne **Ansicht → Kompositionsvorschau**, um zu einer Position zu springen oder
die Komposition abzuspielen. Die Vorschau verwendet die gespeicherten
Quellmedien. Nicht unterstützte oder ungültige Szeneneinstellungen führen zu
einer Fehlermeldung statt zu einem Ersatzbild. Schließe die Vorschau, um ihre
aktiven Rendering-Ressourcen freizugeben.

## Eine portable Kopie speichern {#save-a-portable-copy}

Wähle **Datei → Speichern**, um die aktuelle Revision zu veröffentlichen, und
anschließend **Datei → Kopie speichern**, um ein `.mscape`-Archiv
herunterzuladen. Das Archiv enthält das Projekt und die Originalmedien, die zum
erneuten Öffnen benötigt werden. Öffne es über **Datei → Öffnen** auf einem
anderen Gerät oder in einer neuen Browserbibliothek.

## Rendern {#render}

Wähle **Datei → Rendern** und dann eine Komposition, ein Ausgabeformat und
einen Bildbereich. Das Endbild ist ausgeschlossen: Für die Bilder 0 bis 29
verwendest du den Bereich `0` bis `30`. Bei einem Arbeitsbereich mit gebrochenen
Grenzen werden die darin liegenden ganzzahligen Bildzeitpunkte ausgewählt.
Enthält er keine Ausgabezeitpunkte, musst du ihn vor dem Rendern ändern.

Verwende **Transparente PNG-Sequenz (.tar)** für Alpha. Entpacke das TAR-Archiv,
um normale PNG-Bilder und Metadaten zum zeitlichen Ablauf zu erhalten. MP4 und
WebM verwenden die im Dialog ausgewählte Hintergrundfarbe. Beim Rendern wird
die eingereichte Revision fixiert; spätere Änderungen beeinflussen eine bereits
laufende Ausgabe nicht. Nach dem Schließen des Render-Dialogs läuft der Auftrag
weiter. **Datei → Render-Warteschlange** zeigt den Fortschritt, ermöglicht das
Abbrechen oder erneute Rendern der eingereichten Revision und bietet fertige
Downloads an. Das Schließen des Editors bricht unfertige Aufträge ab.

Zurück zum [Motionscaper-Handbuch](/motionscaper/).
