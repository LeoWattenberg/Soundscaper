---
title: "Bearbeiten, mischen und exportieren"
description: "Organisiere Clips, balanceiere Tracks, wende Effekte an und erstelle eine Auslieferungsdatei."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"d4b354ffb5d6a4d35fcb20ac6bb1e0191746badd98ca8f5b476a286e068a3c26","model":"aya-expanse:8b","modelDigest":"65f986688a01b456158c57b042bc48afcb85d060646a82d491d1c0a01375b10e","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"d4b354ffb5d6a4d35fcb20ac6bb1e0191746badd98ca8f5b476a286e068a3c26","targetLocale":"de"} -->

## Clips anordnen

Wählen Sie Clips oder einen Zeitbereich aus, bevor Sie einen Bearbeitungsbefehl auswählen. Split erstellt eine Bearbeitungsgrenze an der Wiedergabestelle. Gap-preserving und ripple-Varianten bestimmen, ob späteres Material an Ort und Stelle bleibt oder zum Schließen des entfernten Bereichs bewegt wird.

Verwalten Sie größere Projekte mit Track-Ordnern, Clip-Gruppen und dem Projekt-Bin.

### Clip-Faden anpassen {#clip-fades}

Wählen Sie einen Audio-Clip aus, um kleine dreieckige Griffe entlang der Oberseite seiner Wellenform direkt unter dem Clip-Header zu enthüllen.
Ziehen Sie den linken Dreieck nach innen für einen Fade-In oder den rechten Dreieck nach innen für einen Fade-Out. Die Wellenform ändert sich beim Ziehen, und der Bereich über der Fade-Kurve wird dunkler. Die Griffe folgen den Fade-Grenzen; ziehen Sie einen zurück zu seinem Eck, entfernt das Fade. Nur der ausgewählte Clip wird verändert, auch wenn mehrere Clips ausgewählt sind.

Die Griffe verschwinden, wenn Sie den Clip deaktivieren, aber die gefadete Wellenform und die Schattierung bleiben erhalten. Diese Faden bleiben nach dem Speichern und Öffnen des Projekts anpassbar. Lassen Sie zur Bestätigung los oder drücken Sie **Escape** beim Ziehen, um die Aktion abzubrechen. **Undo** rückt einen vollständigen Zug zurück.

Wählen Sie mit einem ausgewählten Clip **Tab**, um auf seine Faden zuzugreifen. Pfeiltasten passen die Dauer um 10 Millisekunden an, oder 100 Millisekunden mit **Shift**. **Home** entfernt den Fade, **End** erstreckt ihn über den gesamten Clip. Für numerische Eingaben wählen Sie **Bearbeiten → Audio-Clips → Clip-Eigenschaften** und verwenden **Fading**.

## Mix erstellen

Verwenden Sie Track-Gain, Pan, Stummschalten und Solo-Steuern, um das Projekt auszugleichen. Das Mixer-Panel zeigt den gleichen Projektzustand in einem mixorientierten Layout. Echtzeit-Effekte bleiben anpassbar; zerstörerische oder gerenderte Operationen erstellen Projektänderungen, die rückgängig gemacht werden können, solange die Historie verfügbar ist.

Überprüfen Sie das Ergebnis mit der Wiedergabemeter und Lautstärkeanalyse. Vermeiden Sie es, einen Meter-Zielwert als Ersatz für das vollständige Export-Hören zu verwenden.

### Sibilanz reduzieren {#reduce-sibilance}

Wählen Sie **Effekt → Rauschreduzierung und Reparatur → De-Esser**. Setzen Sie **Frequenz** nahe dem hartnäckigen Teil der Stimme, und senken Sie **Schwellenwert**, bis die Sibilanten abklingen. **Maximale Reduktion** begrenzt den Schnitt; beginnen Sie mit etwa 6–9 dB. **Angriff** fängt den Beginn eines Konsonanten ein, während **Freigabe** steuert, wie schnell die hohen Frequenzen wieder ansteigen.

**Maximum** reduziert nur die obere Band.

### Separate Frequenzbänder komprimieren {#multiband-compression}

Wählen Sie **Effekt → Lautstärke und Kompression → Multiband-Kompressor**. Die beiden Kreuzover teilen das Signal in niedrig, mittel und hoch ein. Jedes Band hat seinen eigenen Schwellenwert, Verhältnis und Ausgangsgewinn. Ein Verhältnis von 1 lässt die Dynamik des Bandes unberührt. **Angriff** und **Freigabe** gelten für alle drei Bänder. Die Kreuzover haben sanfte, überlappende 6 dB/Oktave-Kurven; mit allen Verhältnissen bei 1 und Bandgewinnen bei 0 dB fließt das ursprüngliche Signal unbeeinflusst weiter.

Beide Effekte sind an ihre Kanäle gebunden, um das Stereo-Gleichgewicht zu erhalten, und sind auch in Track- und Master-Effekt-Racks verfügbar. Rack-Einstellungen werden mit dem Projekt gespeichert und können während der Wiedergabe angepasst werden. **Auf Auswahl anwenden** rendert den Effekt in die ausgewählten Audiodaten und unterstützt Undo. Zeitleistenautomatisierung ist für diese beiden Effekte nicht verfügbar.

## Exportieren

Wählen Sie **Datei → Audio exportieren** für ein gemischtes Endprodukt oder **Ausgewähltes Audio exportieren**, wenn nur ein Teil exportiert werden soll. Soundscaper kann auch Stämme und Labels exportieren.

Komprimierte Formate nutzen die FFmpeg-Runtime. Genauere Formate und deren bedingte Verfügbarkeit finden Sie in der [generierten Formatreferenz](/reference/).

Überprüfen Sie das exportierte Datei in einer anderen Anwendung, bevor Sie die Quellmaterialien löschen oder übergeben.

Für Bildbearbeitung — Sequenzzusammensetzung, Videoeffekte und MP4 oder WebM-Lieferung — übergeben Sie das Projekt an [Framescaper](/framescaper/) und sehen Sie [Video exportieren](/framescaper/video-export/).