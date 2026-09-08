---
title: "Fehlerbehebung"
description: "Beheben Sie häufige Probleme bei der Aufnahme, Speicherung, beim Import und Export."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","targetLocale":"de"} -->

## Es fehlt ein Aufnahmeeingang

Überprüfen Sie die Mikrofonberechtigungen des Betriebssystems und des Browsers und öffnen Sie dann erneut den Geräteausswahl-Dialog. Für Multitrack-Aufnahmen stellen Sie sicher, dass jeder bewaffnete Track eine verfügbare Eingabezuweisung hat.

## Ein Befehl ist deaktiviert

Viele Befehle hängen vom aktuellen Zustand ab. Wählen Sie das erforderliche Projekt, die Spur, das Element oder den Zeitbereich aus und versuchen Sie es erneut. Ein Feature kann auch absichtlich auf Soundscaper oder Framescaper beschränkt sein.

## Ein Import verwendet zu viel Speicher

Komprimiertes Decodieren und einige große Operationen können selbst wenn das gespeicherte Projektaudio in Blöcken gespeichert ist, erheblichen temporären Speicher benötigen. Schließen Sie nicht verwandte Registerkarten oder Anwendungen, versuchen Sie es mit einer kleineren Quelle oder verwenden Sie die Desktop-Ausgabe, wenn dies angemessen ist.

## Ein Projekt ist aus dem Browser verschwunden

Stellen Sie sicher, dass Sie dasselbe Browser-Profil, denselben Ursprung und dieselbe Produktseite geöffnet haben. Soundscaper und Framescaper teilen sich die Bibliothek am selben `soundscaper.org`
Ursprung, aber ein anderer Bereich, Browser-Profil oder gelöschter Seiten-Speicher hat eine
unterschiedliche Bibliothek. Wenn die Seitendaten gelöscht wurden und keine Scape-Projekt-Exportdatei vorhanden ist, hat der Editor keine Cloud-Kopie zum Wiederherstellen.

## AUP4 hat einen Teil des Projekts ausgelassen

Lesen Sie den Kompatibilitätsbericht. AUP4 trägt kompatible Audio-Bearbeitungsstatus, lässt aber Video aus und kann Effekte oder Soundscaper-only-Mixstatus konvertieren oder auslassen. Verwenden Sie eine Scape-Projekt-Datei – `.sscape` oder `.fscape`, die sich beide in jedem Produkt öffnen lassen – für den vollständigen Projekttransfer.

## Ein Export schlägt fehl oder wird nicht abgespielt

Versuchen Sie es erneut, nachdem Sie bestätigt haben, dass der ausgewählte Bereich abspielbares Material enthält. Für komprimiertes Audio oder Video überprüfen Sie, ob die Laufzeit-Assets geladen werden können. Nach einem erfolgreichen Export testen Sie die tatsächliche Datei in einem anderen Player.

Für ungelöste Probleme verwenden Sie **Hilfe → Support**, um den Administrator zu kontaktieren und geben Sie das Produkt, die Plattform, den Browser oder die Desktop-Version, die Schritte und den genauen Fehler an.