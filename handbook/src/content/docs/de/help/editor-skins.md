---
title: "Editor-Häute"
description: "Wählen Sie eine visuelle Haut oder testen Sie eine vorübergehend über eine URL."
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"de"} -->

Skins ändern die Farben, Schriftarten, Rahmen und dekorativen Hintergründe des Editors.
Sie sind in Soundscaper und Framescaper verfügbar. Jedes Produkt merkt sich
die eigene Auswahl. Arbeitsbereiche steuern weiterhin die Anordnung von Panels und Werkzeugen.

## Skin auswählen {#choose-a-skin}

Öffnen Sie **Bearbeiten → Einstellungen → Erscheinungsbild** und wählen Sie eine Skin aus:

- **Standard** behält das ursprüngliche Editor-Design bei.
- **Sakura** kombiniert Kirschblüten, rosa Akzente und abgerundete Schriftzüge.
- **Lilac** verwendet kühle Lila-Töne und mehrschichtige Violett-Texturen.
- **Techno** kombiniert blaue Schaltkreis-Grafiken mit monospace-Schriftzügen.

Wählen Sie **Hell**, **Dunkel** oder **Systemthema folgen** separat. Jede Skin hat
eine helle und eine dunkle Version. **Clip-Stil** bleibt eine separate Auswahl; die
bunte Palette ist auf jede Skin abgestimmt, wobei die Clip-Farben unterschiedlich bleiben.

Hoher Kontrast hat Vorrang vor Skin-Dekoration. Das Deaktivieren des hohen Kontrasts
stellt die ausgewählte Skin wieder her. Das Ändern einer Skin ändert niemals die Clip-Audio,
Projektinhalte oder die Arbeitsbereichsanordnung.

## Skin über einen Link testen {#try-a-skin-from-a-link}

Fügen Sie `?useskin=sakura` zu einer Editor-URL hinzu, um Sakura vorübergehend zu previewen. Verwenden
Sie `default`, `sakura`, `lilac` oder `techno` als Wert. Wenn die URL bereits einen
Abfrageparameter hat, fügen Sie stattdessen `&useskin=sakura` an. Unbekannte Werte werden ignoriert.

Eine URL-Vorschau ersetzt Ihre gespeicherte Skin nicht, selbst wenn Sie eine andere
Einstellung ändern. Das Neuladen der Vorschau-URL behält die Vorschau bei; der Besuch ohne den
Parameter verwendet Ihre gespeicherte Auswahl. Der Parameter wählt nicht Hell oder Dunkel.

Wählen Sie in **Einstellungen → Erscheinungsbild** **Diese Skin beibehalten**, um die Vorschau zu speichern,
oder **Vorschau beenden**, um zu Ihrer gespeicherten Skin zurückzukehren. Die Auswahl einer beliebigen Skin speichert
auch diese Auswahl und beendet die Vorschau. Diese Aktionen entfernen nur den Skin-Parameter
aus der aktuellen URL, ohne den Editor neu zu laden.
