---
title: "Bearbeiten, mischen und exportieren"
description: "Clips anordnen, Spuren ausbalancieren, Effekte anwenden und eine Ausgabedatei erstellen."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","targetLocale":"de"} -->

## Clips anordnen

Wählen Sie Clips oder einen Zeitbereich aus, bevor Sie einen Bearbeitungsbefehl wählen. Mit „Teilen“ wird am Abspielkopf eine Bearbeitungsgrenze erstellt. Varianten zum Beibehalten von Lücken und zum Nachrücken bestimmen, ob späteres Material an seinem Platz bleibt oder die entfernte Region schließt.

Verwenden Sie Track-Ordner, Clip-Gruppen und die Projektablage, um größere Projekte übersichtlich zu halten.

### Clip-Fades anpassen {#clip-fades}

Wählen Sie einen Audio-Clip aus, damit kleine dreieckige Griffe oben auf seiner Wellenform direkt unter der Clip-Kopfzeile sichtbar werden.
Ziehen Sie das linke Dreieck für ein Einblenden nach innen oder das rechte Dreieck für ein Ausblenden nach innen. Die Wellenform ändert sich beim Ziehen, und der Bereich oberhalb der Fade-Kurve wird dunkler. Die Dreiecke folgen den Fade-Grenzen; wenn Sie eines zurück in seine Ecke ziehen, wird der betreffende Fade entfernt. Auch wenn mehrere Clips ausgewählt sind, wird nur der Clip geändert, den Sie ziehen.

Die Griffe verschwinden, sobald Sie die Auswahl des Clips aufheben, aber die ausgeblendete Wellenform und die Schattierung bleiben erhalten. Diese Fades bewahren das Originalaudio und bleiben nach dem Speichern und erneuten Öffnen des Projekts anpassbar. Lassen Sie los, um einen Fade zu übernehmen, oder drücken Sie beim Ziehen **Escape**, um abzubrechen. **Rückgängig** macht einen vollständigen Ziehvorgang rückgängig. Wiedergabe und Export verwenden die übernommenen Fade-Einstellungen.

Wenn ein Clip ausgewählt und fokussiert ist, drücken Sie **Tab**, um seine Fade-Griffe zu erreichen. Mit den Pfeiltasten ändern Sie die Dauer um 10 Millisekunden oder mit **Umschalt** um 100 Millisekunden. **Pos1** entfernt den Fade, **Ende** verlängert ihn über den gesamten Clip. Für eine numerische Eingabe wählen Sie **Bearbeiten → Audioclips → Clip-Eigenschaften** und verwenden **Fading**.

## Den Mix erstellen

Verwenden Sie Track-Gain sowie die Regler für Panorama, Stummschalten und Solo, um das Projekt auszubalancieren. Das Mixer-Panel zeigt denselben Projektzustand in einer auf das Mischen ausgerichteten Ansicht. Echtzeiteffekte bleiben anpassbar; destruktive oder gerenderte Vorgänge erzeugen Projektänderungen, die sich in der verfügbaren Historie rückgängig machen lassen.

Prüfen Sie das Ergebnis mit dem Wiedergabepegelmesser und der Lautheitsanalyse. Behandeln Sie einen Zielwert des Pegelmessers nicht als Ersatz dafür, den vollständigen Export anzuhören.

### Sibilanz reduzieren {#reduce-sibilance}

Wählen Sie **Effekt → Rauschentfernung und Reparatur → De-Esser**. Setzen Sie **Frequenz** nahe an den scharfen Bereich der Stimme und senken Sie **Schwellenwert**, bis die Zischlaute weicher werden. **Maximale Reduktion** begrenzt die Absenkung; beginnen Sie mit etwa 6–9 dB. Ein kürzerer **Angriff** erfasst den Beginn eines Konsonanten, während **Freigabe** steuert, wie schnell sich die hohen Frequenzen erholen. Nur das obere Band wird reduziert.

### Separate Frequenzbänder komprimieren {#multiband-compression}

Wählen Sie **Effekt → Lautstärke und Kompression → Multiband-Kompressor**. Die beiden Übergangsfrequenzen teilen das Signal in tiefe, mittlere und hohe Bänder. Jedes Band hat einen eigenen Schwellenwert, ein eigenes Verhältnis und eine eigene Ausgangsverstärkung. Ein Verhältnis von 1 lässt die Dynamik des jeweiligen Bands unverändert. Angriff und Freigabe gelten für alle drei Bänder. Die Übergangsfrequenzen haben sanfte, überlappende Flanken von 6 dB pro Oktave; bei einem Verhältnis von 1 und einer Bandverstärkung von 0 dB für alle Bänder wird das ursprüngliche Signal unverändert durchgelassen.

Beide Effekte koppeln ihre Kanäle, um die Stereobalance zu erhalten, und sind auch in Effekt-Racks von Tracks und Master verfügbar. Rack-Einstellungen werden mit dem Projekt gespeichert und können während der Wiedergabe angepasst werden. **Auf Auswahl anwenden** rendert den Effekt in das ausgewählte Audiomaterial und unterstützt **Rückgängig**. Für diese beiden Effekte steht keine Timeline-Automation zur Verfügung.

### LADSPA-Effekte und Vamp-Analysatoren verwenden {#native-audio-plugins}

Die Desktop-App kann Plug-ins von Drittanbietern erst scannen, nachdem Sie in **Effekt → Plugin-Manager** ein Format und einen seiner Ordner freigegeben haben. Das Scannen erfolgt nie automatisch. Geben Sie jede gefundene Installation frei, bevor Sie sie verwenden, und installieren Sie nur Plug-ins, denen Sie vertrauen: Native Plug-ins führen ausführbaren Code aus, auch wenn Soundscaper sie in überwachten Hilfsprozessen hostet.

LADSPA-Effekte sind unter Linux verfügbar. Öffnen Sie einen solchen Effekt über **Effekt → Audio-Plugins**, nachdem Sie ihn im Manager aktiviert haben. Soundscaper erstellt die Bedienelemente aus den LADSPA-Ports, weil dieses Format keine Herstelleroberfläche besitzt. Diese Steuerwerte und der aktivierte oder umgangene Zustand des Effekts werden mit dem Projekt gespeichert.

Vamp-Plug-ins analysieren Audio, statt es zu verändern. Aktivieren Sie eine Vamp-Installation und wählen Sie einen Audiotrack aus, um diesen Track zu analysieren, oder lassen Sie keinen Audiotrack ausgewählt, um den Master-Mix zu analysieren. Eine Zeitauswahl begrenzt die Analyse; andernfalls verwendet Soundscaper das gesamte Projekt. Wählen Sie **Analysieren → Vamp-Plugins**, wählen Sie die Ausgabe des Analysators und dessen Einstellungen und starten Sie ihn. Soundscaper fügt die zurückgegebenen Zeitstempel erst nach erfolgreicher vollständiger Analyse als neue Label-Spur hinzu, sodass Abbrechen oder eine Projektänderung keine unvollständigen Labels hinterlassen kann.

## Exportieren

Wählen Sie **Datei → Audio exportieren** für eine gemischte Ausgabedatei oder **Ausgewähltes Audio exportieren**, wenn nur eine Auswahl gerendert werden soll. Soundscaper kann auch Stems und Labels exportieren.

Komprimierte Formate verwenden die FFmpeg-Laufzeit. Die genauen Formate und ihre bedingte Verfügbarkeit sind in der [generierten Format-Referenz](/reference/) aufgeführt.

Spielen Sie die exportierte Datei in einer anderen Anwendung ab, bevor Sie sie ausliefern oder das Ausgangsmaterial löschen.

Für Arbeiten mit Bildern – das Zusammenstellen einer Sequenz, Videoeffekte und eine MP4- oder WebM-Ausgabe – übergeben Sie das Projekt an [Framescaper](/framescaper/) und lesen Sie [Video exportieren](/framescaper/video-export/).
