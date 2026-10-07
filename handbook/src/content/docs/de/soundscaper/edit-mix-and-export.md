---
title: "Bearbeiten, mischen und exportieren"
description: "Clips anordnen, Spuren ausbalancieren, Effekte anwenden und eine Ausgabedatei erstellen."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","targetLocale":"de"} -->

## Clips anordnen

Wählen Sie Clips oder einen Zeitbereich aus, bevor Sie einen Bearbeitungsbefehl wählen. Mit „Teilen“ wird am Abspielkopf eine Bearbeitungsgrenze erstellt. Varianten zum Beibehalten von Lücken und zum Nachrücken bestimmen, ob späteres Material an seinem Platz bleibt oder die entfernte Region schließt.

Verwenden Sie Track-Ordner, Clip-Gruppen und die Projektablage, um größere Projekte übersichtlich zu halten.

### Clip-Fades anpassen {#clip-fades}

Wählen Sie einen Audio-Clip aus, damit kleine dreieckige Griffe oben auf seiner Wellenform direkt unter der Clip-Kopfzeile sichtbar werden.
Ziehen Sie das linke Dreieck für ein Einblenden nach innen oder das rechte Dreieck für ein Ausblenden nach innen. Die Wellenform ändert sich beim Ziehen, und der Bereich oberhalb der Fade-Kurve wird dunkler. Die Dreiecke folgen den Fade-Grenzen; wenn Sie eines zurück in seine Ecke ziehen, wird der betreffende Fade entfernt. Auch wenn mehrere Clips ausgewählt sind, wird nur der Clip geändert, den Sie ziehen.

Die Griffe verschwinden, sobald Sie die Auswahl des Clips aufheben, aber die ausgeblendete Wellenform und die Schattierung bleiben erhalten. Diese Fades bewahren das Originalaudio und bleiben nach dem Speichern und erneuten Öffnen des Projekts anpassbar. Lassen Sie los, um einen Fade zu übernehmen, oder drücken Sie beim Ziehen **Escape**, um abzubrechen. **Rückgängig** macht einen vollständigen Ziehvorgang rückgängig. Wiedergabe und Export verwenden die übernommenen Fade-Einstellungen.

Wenn ein Clip ausgewählt und fokussiert ist, drücken Sie **Tab**, um seine Fade-Griffe zu erreichen. Mit den Pfeiltasten ändern Sie die Dauer um 10 Millisekunden oder mit **Umschalt** um 100 Millisekunden. **Pos1** entfernt den Fade, **Ende** verlängert ihn über den gesamten Clip. Für eine numerische Eingabe wählen Sie **Bearbeiten → Audioclips → Clip-Eigenschaften** und verwenden **Fading**.

### Clipquelle bearbeiten {#clip-source-properties}

Öffnen Sie **Bearbeiten → Audioclips → Clip-Eigenschaften**, um den Quelleneditor aufzurufen.
Die vollständige Aufnahme erscheint hinter dem Clip. Ziehen Sie die Clipkanten, um den
Quellanfang und die Dauer zu ändern, während der Clipstart auf der Projektzeitleiste gleich
bleibt. **Normalisieren** enthält die Clip-Verstärkung sowie Aktionen für Spitzenpegel und
Lautheit.

Öffnen Sie **Tonhöhe und Tempo** und aktivieren Sie **Tonhöhe und Tempo verknüpfen**, um
Geschwindigkeit und Tonhöhe gemeinsam zu ändern. Mit Geschwindigkeit `1` und einer
Tonhöhenänderung von `0%` bleibt der Klang unverändert. Verhältnis `2` gibt Audio doppelt
so schnell und eine Oktave höher wieder; `0.5` halbiert die Geschwindigkeit und senkt die
Tonhöhe um eine Oktave. Wenn Sie einen verknüpften Regler bearbeiten, wird der andere
aktualisiert. Wenn Sie die Verknüpfung lösen, wird die Tonhöhe wieder unabhängig eingestellt,
während das aktuelle Geschwindigkeitsverhältnis erhalten bleibt.

Klicken Sie mit **Strg** auf die Wellenform, um einen Dehnungsmarker zu setzen, der an das
Quell-Sample gebunden ist. Ziehen ändert das Timing auf beiden Seiten; die Überlagerung zeigt
beide Wiedergabegeschwindigkeiten. Die Clip-Steuerelemente gelten weiterhin pro Clip. Wenn
Sie Quellaudio auswählen und einen Effekt anwenden, wird jeder Clip aktualisiert, der diese
Quelle nutzt.

### Clips in einer Tabelle bearbeiten {#clip-spreadsheet}

Wählen Sie **Ansicht → Bedienfelder → Clip-Tabelle**, um alle Clips des Projekts anzuzeigen.
Das Bedienfeld öffnet sich unterhalb der Zeitleiste. Im Bedienfeldmenü können Sie es an eine
andere Position verschieben, schweben lassen oder schließen. Größe und Position werden mit
dem Arbeitsbereich gespeichert. Jede Zeile zeigt Spur, Timeline-Position, Quelldatei,
Quellversatz, Dauer, Tonhöhe, Geschwindigkeit, Verstärkung, Fades und Wiedergabeoptionen.
Zeiten sind Sekunden, Tonhöhe sind Halbtöne und Geschwindigkeit ist ein Verhältnis: `1`
steht für normales Tempo und `2` für doppelte Geschwindigkeit.

Doppelklicken Sie auf eine Zelle oder wählen Sie sie aus und drücken **Eingabe**, um den Wert
zu bearbeiten. Drücken Sie **Eingabe**, um die Änderung anzuwenden, oder **Escape**, um sie
abzubrechen. Spur- und Quellzellen zeigen ihre tatsächlichen IDs. Ändern Sie die Spur-ID, um
einen Clip auf eine vorhandene Audiospur zu verschieben. Ändern Sie die Quellen-ID oder geben
Sie einen lokalen Dateipfad ein, um das Audio zu ersetzen; Timeline-Position, Dauer,
Geschwindigkeit und Quellversatz in Sekunden bleiben erhalten. Die neue Datei muss den
angegebenen Quellbereich enthalten. „Umgekehrt“ und „Invertiert“ sind Kontrollkästchen;
wählen Sie eine Zelle aus und drücken **Leertaste**, um sie umzuschalten. Clips auf gesperrten
Spuren und Videoclips können nicht bearbeitet werden.

Wenn Sie die Dauer ändern, wird der Quellbereich am aktuellen Versatz gekürzt oder verlängert.
Eine Geschwindigkeitsänderung behält den Quellbereich bei, außer wenn Sie auch eine Dauer
einfügen. Heben Sie Gruppierung oder Verknüpfung von Clips auf, bevor Sie deren Timing hier
ändern; das Timing gedehnter Clips bearbeiten Sie im Quelleneditor.

Wählen Sie eine Zelle aus, ziehen Sie über einen Bereich oder halten Sie **Umschalt** gedrückt
und klicken Sie auf eine weitere Zelle, um die Auswahl zu erweitern. Klicken Sie auf eine
Zeilennummer oder Spaltenüberschrift, um die ganze Zeile oder Spalte auszuwählen. Mit
**Strg+C** und **Strg+V** (**Cmd+C** und **Cmd+V** auf macOS) tauschen Sie die Auswahl mit
einem Tabelleneditor aus. Werte werden in Spalten durch Tabulatoren und in Zeilen durch
Zeilenumbrüche getrennt. Beim Einfügen beginnt die Aktion an der ausgewählten Zelle und
aktualisiert vorhandene Clips. Wenn die Einfügung über die vorhandenen Zeilen hinausgeht,
wird sie abgewiesen. Drücken Sie bei einer Auswahl **Escape** oder klicken Sie unterhalb der
Tabelle in einen leeren Bereich, um die Auswahl aufzuheben. Ohne Auswahl fügt das Einfügen
neue Zeilen ein, auch in einem leeren Projekt. Wiedergabeoptionen werden als `true` oder
`false` kopiert und akzeptieren diese Werte beim Einfügen. Neue Zeilen folgen der
Spaltenreihenfolge der Tabelle und brauchen einen Quelldateinamen oder eine Quellen-ID. Ein
eindeutiger vorhandener Spurname platziert den Clip auf dieser Spur; ein neuer Name erstellt
eine Audiospur. Leere Spurnamen verwenden den Quellnamen. Leere Zahlenfelder nehmen die
Standardwerte an: Position und Versatz `0`, Geschwindigkeit `1`, Tonhöhe und Verstärkung `0`
und keine Fades. Ohne Dauer wird das verbleibende Audio bei der gewählten Geschwindigkeit
verwendet.

Das Bedienfeld sucht die Quelle zuerst im Projekt, auch im Projektkorb. Fehlt sie, wählen Sie
**Referenzierte Dateien laden** und wählen die im Dialog aufgeführten Audiodateien aus. Auch
für Dateipfade auf dem Datenträger ist diese Auswahl nötig: Das Einfügen eines Pfads gibt der
App keinen Dateizugriff. Die ausgewählten Dateien müssen eindeutig zu den referenzierten
Namen passen. Das Bedienfeld importiert Audio, prüft Quellbereiche und Clip-Eigenschaften
und platziert neue Clips an den angegebenen Positionen. **Strg+Z** (**Cmd+Z** auf macOS)
macht ein vollständiges Einfügen mit einem Schritt rückgängig; **Strg+Umschalt+Z**
(**Cmd+Umschalt+Z**) stellt es wieder her. Enthält ein Einfügevorgang einen ungültigen Wert,
bleiben die Clips unverändert.

## Den Mix erstellen

Verwenden Sie Track-Gain sowie die Regler für Panorama, Stummschalten und Solo, um das Projekt auszubalancieren. Das Mixer-Panel zeigt denselben Projektzustand in einer auf das Mischen ausgerichteten Ansicht. Echtzeiteffekte bleiben anpassbar; destruktive oder gerenderte Vorgänge erzeugen Projektänderungen, die sich in der verfügbaren Historie rückgängig machen lassen.

Prüfen Sie das Ergebnis mit dem Wiedergabepegelmesser und der Lautheitsanalyse. Behandeln Sie einen Zielwert des Pegelmessers nicht als Ersatz dafür, den vollständigen Export anzuhören.

### Ausgewählte Frequenzen anhören {#listen-to-selected-frequencies}

Wählen Sie den Abschnitt aus, den Sie anhören möchten. Wählen Sie im Spurmenü
**Spurvisualisierung → Spektrogramm** und öffnen Sie **Spektrogrammoptionen → Spektralen
Frequenzbereich auswählen**. Geben Sie minimale und maximale Frequenz ein und wählen Sie
**Bereich auswählen**, oder passen Sie die Auswahlgriffe im Spektrogramm an.

Wählen Sie **Wiedergabeoptionen → Ausgewählte Frequenzen abspielen** oder **Auswählen →
Spektral → Ausgewählte Frequenzen abspielen**. Der ausgewählte Zeitbereich wird einmal mit
normaler Geschwindigkeit abgespielt, auch wenn zuvor eine andere Geschwindigkeit oder
Schleifenwiedergabe gewählt wurde. Der Hörfilter gilt für den aktuellen Mix einschließlich
Stummschaltung, Solo, Verstärkung und Effekten. Ein spektrales Rechteck markiert Frequenzband
und Zeitbereich, schaltet die Spur jedoch nicht auf Solo. Läuft die Wiedergabe bereits,
pausiert der Befehl sie; wählen Sie ihn erneut, um die Frequenzvorschau zu starten.

Die Echtzeitfilter für Frequenzen haben weiche Übergänge. Frequenzen außerhalb des Bands
werden leiser, und auch Frequenzen nahe den Grenzen können leiser werden. **Pause** oder
**Stopp** entfernt den Filter, sodass die nächste normale Wiedergabe den vollständigen
Frequenzbereich nutzt. Audio, Auswahl, Rückgängig-Verlauf und exportierte Dateien bleiben
unverändert.

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

### Clips als separate Dateien exportieren {#export-clips}

Wählen Sie **Datei → Audio exportieren** und setzen Sie **Ausgabe** auf **Einzelne Clips
(nach Clips aufteilen)**. Wählen Sie ein Audioformat und drücken Sie **Exportieren**, um ein
Archiv mit einer Datei für jeden Audioclip auf allen Audiospuren des Projekts herunterzuladen.
Jede Datei beginnt am hörbaren Anfang des Clips und endet an dessen hörbarem Ende, ohne
Auffüllung bis zur Projektzeitleiste oder zusätzlichen Effekt-Ausklang. Schnitte,
Clip-Verstärkung, Fades, Geschwindigkeit und Tonhöhenänderungen werden übernommen.
Überlappende Clips bleiben getrennt.

Die Dateien verwenden Clipnamen mit nummerierten Präfixen. Nicht unterstützte Zeichen im
Dateinamen werden ersetzt; Nummern unterscheiden wiederholte Clipnamen. Spureffekte sind
enthalten; Mastereffekte, Stummschaltung und Solo wirken sich nicht auf diesen Export aus.
Heben Sie das Einfrieren gefrorener Spuren auf, bevor Sie ihre bearbeitbaren Clips einzeln
exportieren.

Komprimierte Formate verwenden die FFmpeg-Laufzeit. Die genauen Formate und ihre bedingte Verfügbarkeit sind in der [generierten Format-Referenz](/reference/) aufgeführt.

### Kapitelmarken einbetten {#embedded-chapters}

Wählen Sie im Browsereditor **Datei → Audio exportieren**, dann **MP3** oder **AAC / M4A**,
und aktivieren Sie unter **Audiooptionen** die Einstellung **Labels als Kapitel einbetten**.
Die Option ist zunächst deaktiviert und fügt Labeltitel und -zeiten in eine gemischte Datei
ein. Legen Sie vor dem Export Labels an; Stems, Kapitelaufteilungen und Mastering-Sequenzen
bieten diese Option nicht.

Es werden nur Labels aufgenommen, die den Auslieferungsbereich schneiden. Wenn Sie eine
Auswahl exportieren, werden Kapitelzeiten an den Anfang der erzeugten Datei verschoben. MP3
erhält die Endzeiten von Bereichslabels; ein Punktlabel endet am nächsten Kapitel oder am
Dateiende. M4A speichert Kapitelanfänge. Jedes Kapitel reicht bis zum nächsten Anfang oder
zum Dateiende. M4A unterstützt bis zu 255 Kapitel und 255 UTF-8-Bytes pro Titel. Ob ein
Player eingebettete Kapitel anzeigt, hängt vom Player ab.

Spielen Sie die exportierte Datei in einer anderen Anwendung ab, bevor Sie sie ausliefern oder das Ausgangsmaterial löschen.
