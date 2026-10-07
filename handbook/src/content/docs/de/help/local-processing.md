---
title: "Lokale Verarbeitung, Modelle und Plugins"
description: "Finden Sie lokale Unterstützung nach Aufgabe und verwalten Sie Modelle und Plugins in den Desktop-Editoren."
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","targetLocale":"de"} -->

Die lokale Unterstützung läuft auf Ihrem Gerät in den Desktop-Editoren Soundscaper und Framescaper. Wählen Sie Medien aus und dann die Aufgabe aus ihrem Menü. Das Dialogfeld zeigt die Auswahl, die Aufgaben-Einstellungen und ob die Modelle installiert sind.

Desktop-Pakete enthalten weder die optionalen nativen Verarbeitungs-Engines noch die Modellgewichte. Installieren Sie ein Modell über den Modell-Manager, um die benötigte Engine und die Gewichte herunterzuladen, und führen Sie dann die Aufgabe auf den ausgewählten Medien aus. Für die erste Installation ist eine Netzwerkverbindung erforderlich; spätere Verarbeitung läuft lokal. Siehe die [Anleitung](/reference/local-models/) für jedes Modell, um unterstützte Plattformen, Menüeintrag und Anforderungen zu erfahren.

Installieren Sie Modelle ausdrücklich. Bei der ersten Installation wird auch eine noch fehlende native Laufzeitumgebung heruntergeladen, die das Modell benötigt. Downloads zeigen den Fortschritt an und können abgebrochen werden. Wenn Sie zu einer Aufgabe zurückkehren, bleiben ihre Einstellungen erhalten und die Modellverfügbarkeit wird aktualisiert; die Verarbeitung startet dadurch nicht. Erweitern Sie **Speicher und Verifizierung** für Reparaturen, Bereinigung, Speicherumzug, Lizenzhinweise und die Offline-Installation aus einem Ordner. Ein aus Offline-Dateien installiertes Modell benötigt vor seiner ersten Verwendung weiterhin die passende Laufzeitumgebung.



## Aufgabe finden {#find-a-task}

| Menü | Aufgaben |
| --- | --- |
| Effekt → Rauschentfernung und Reparatur | Dialog verbessern, Nachhall reduzieren, Füller und Stille bereinigen |
| Effekt → Quellentrennung | Dialog/Musik/Effekte trennen |
| Analyse → Sprache | Transkribieren & Untertitel, Sprecher identifizieren, Reaktionen markieren |
| Analyse → Musik | Beats & Tempo erkennen |
| Analyse → Video | Schnitte markieren |
| Effekt → Videoeffekte | Umrahmen |
| Bearbeiten | Highlights erstellen |
| Generieren | Redaktionellen Text generieren |
| Werkzeuge → Suche | Indexsuche, Index-Transkript, Index-Video |

Videoaufgaben gehören zu Framescaper. Die verfügbaren Befehle hängen von der Desktop-Laufzeit und den Produktfunktionen ab. Die alphabetische Effektmenü-Option von Soundscaper sortiert auch die lokalen Verarbeitungseffekte nach Namen.

Wählen Sie **Lokal ausführen**, um die Verarbeitung zu starten und auf die lokale Zustimmungsdialogfeld zu reagieren. Sie können die Verarbeitung abbrechen. Wählen Sie **Ergebnis überprüfen**, wählen Sie die gewünschten Ergebnisse aus und wählen Sie **Ausgewähltes anwenden**. Akzeptierte Projektänderungen können rückgängig gemacht werden. Das Schließen einer Aufgabe wendet ihre Vorschläge nicht an.

**Werkzeuge → Erweitertes lokales Verarbeiten** behält die individuelle Operation und die Modellauswahl bei. Technische Details in den Aufgabendialogfeldern zeigen die zugrunde liegenden Schritte und genauen Einstellungen an, wenn erforderlich.

## Modelle verwalten {#manage-models}

Öffnen Sie **Werkzeuge → Modell-Manager** oder verwenden Sie **Modelle verwalten** innerhalb einer Aufgabe. Der Aufgaben-Link filtert die Liste nach kompatiblen Modellidentitäten; **Alle Modelle anzeigen** hebt diese Einschränkung auf. Suchen Sie nach Namen oder Aufgaben und filtern Sie nach Installationsstatus.

Installieren Sie Modelle ausdrücklich. Bei der ersten Installation wird auch eine noch fehlende native Laufzeitumgebung heruntergeladen, die das Modell benötigt. Downloads zeigen den Fortschritt an und können abgebrochen werden. Wenn Sie zu einer Aufgabe zurückkehren, bleiben ihre Einstellungen erhalten und die Modellverfügbarkeit wird aktualisiert; die Verarbeitung startet dadurch nicht. Erweitern Sie **Speicher und Verifizierung** für Reparaturen, Bereinigung, Speicherumzug, Lizenzhinweise und die Offline-Installation aus einem Ordner. Ein aus Offline-Dateien installiertes Modell benötigt vor seiner ersten Verwendung weiterhin die passende Laufzeitumgebung.

Siehe die [Einzelnen Modell-Anleitungen](/reference/local-models/) für den Zweck, den Menü-Eintrag, die Download-Größe, Anforderungen, Einschränkungen und die echten Inferenzprüfungen, die von dem Desktop-Paket mit Nachtests durchgeführt werden, für jedes veröffentlichte Modell.

## Plug-Ins und Geräte verwalten {#manage-plugins-and-devices}

**Effekt → Plug-In-Manager** listet Audio-Plug-Ins in Soundscaper und OpenFX-Plug-Ins in Framescaper auf. Suchen oder filtern Sie die Liste und wählen Sie dann ein Plug-In für seine Version, Berechtigungen und Wiederherstellungssteuerelemente aus. **Scannen & Einstellungen** enthält Entdeckungseinstellungen. Die Verwaltung bleibt erreichbar, auch wenn die Verarbeitung deaktiviert ist.

Verwenden Sie Audio-Plug-Ins über **Effekt → Audio-Plug-Ins**. Die Befehle zum Hinzufügen/Bearbeiten von Videoeffekten in Framescaper befinden sich weiterhin unter **Effekt → Videoeffekte**.

Öffnen Sie **Bearbeiten → Einstellungen → Audioeinstellungen** für native Audio-Geräte und Hilfssteuerelemente. **Medien** enthält native Medieneinstellungen; **Effekte** verlinkt zum Plug-In-Manager und enthält den Plug-In-Entdeckungsschalter. Plug-In-Berechtigungen und Quarantäne-Wiederherstellung erfordern immer noch explizite Aktionen.
