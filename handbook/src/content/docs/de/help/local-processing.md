---
title: "Lokale Verarbeitung, Modelle und Plugins"
description: "Finden Sie lokale Unterstützung nach Aufgabe und verwalten Sie Modelle und Plugins in den Desktop-Editoren."
---
<!-- docs-ai-provenance: {"factPacketSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","targetLocale":"de"} -->

Die lokale Unterstützung läuft auf Ihrem Gerät in den Desktop-Editoren Soundscaper und Framescaper. Wählen Sie Medien aus und dann die Aufgabe aus ihrem Menü. Das Dialogfeld zeigt die Auswahl, die Aufgaben-Einstellungen und ob die Modelle installiert sind.

Desktop-Pakete enthalten die nativen Verarbeitungs-Engines für die veröffentlichten lokalen Modelle. Installieren Sie die Modellgewichte über den Modell-Manager und führen Sie dann die Aufgabe auf Ihren ausgewählten Medien aus. Siehe die [Anleitung](/reference/local-models/) für jedes Modell, um seine unterstützten Plattformen, Menü-Eintrag und Anforderungen zu erfahren.

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

Installieren Sie Modelle explizit. Downloads zeigen Fortschritt und können abgebrochen werden. Die Rückkehr zu einer Aufgabe bewahrt ihre Einstellungen und aktualisiert die Modellverfügbarkeit; es startet keine Verarbeitung. Erweitern Sie **Speicher und Verifizierung** für Reparaturen, Bereinigung, Speicherumzug, Lizenzhinweise und Offline-Installation aus einem Ordner.

Siehe die [Einzelnen Modell-Anleitungen](/reference/local-models/) für den Zweck, den Menü-Eintrag, die Download-Größe, Anforderungen, Einschränkungen und die echten Inferenzprüfungen, die von dem Desktop-Paket mit Nachtests durchgeführt werden, für jedes veröffentlichte Modell.

## Plug-Ins und Geräte verwalten {#manage-plugins-and-devices}

**Effekt → Plug-In-Manager** listet Audio-Plug-Ins in Soundscaper und OpenFX-Plug-Ins in Framescaper auf. Suchen oder filtern Sie die Liste und wählen Sie dann ein Plug-In für seine Version, Berechtigungen und Wiederherstellungssteuerelemente aus. **Scannen & Einstellungen** enthält Entdeckungseinstellungen. Die Verwaltung bleibt erreichbar, auch wenn die Verarbeitung deaktiviert ist.

Verwenden Sie Audio-Plug-Ins über **Effekt → Audio-Plug-Ins**. Die Befehle zum Hinzufügen/Bearbeiten von Videoeffekten in Framescaper befinden sich weiterhin unter **Effekt → Videoeffekte**.

Öffnen Sie **Bearbeiten → Einstellungen → Audioeinstellungen** für native Audio-Geräte und Hilfssteuerelemente. **Medien** enthält native Medieneinstellungen; **Effekte** verlinkt zum Plug-In-Manager und enthält den Plug-In-Entdeckungsschalter. Plug-In-Berechtigungen und Quarantäne-Wiederherstellung erfordern immer noch explizite Aktionen.
