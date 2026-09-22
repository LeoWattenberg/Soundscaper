---
title: "Vergleich von Soundscaper"
description: "Vergleichen Sie Soundscaper mit Audacity 4 und Adobe Audition in Bezug auf Aufnahme, Bearbeitung, Mischen, Bereitstellung und Austausch."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","targetLocale":"de"} -->

Soundscaper implementiert Audacity 4 im Web neu und ergänzt es um eine Produktionsebene. Adobe Audition ist das kommerzielle Postproduktionswerkzeug, mit dem beide üblicherweise verglichen werden. Diese Seite vergleicht alle drei, damit Sie erkennen, welches bereits die Aufgabe erfüllt, die Sie erledigen möchten.

## So lesen Sie diese Seite

Jede Zelle enthält **Ja**, **Teilweise** oder **Nein**, gefolgt von der Angabe, die dies qualifiziert.

**Teilweise** deckt drei verschiedene Situationen ab, und die Anmerkung gibt an, welche zutrifft: Die Funktion ist vorhanden, aber enger gefasst als anderswo, sie ist vorhanden, hängt aber von etwas ab, das Sie bereitstellen müssen, oder sie ist nur durch Umgehung eines Mangels erreichbar.

Die Zeilen beschreiben Funktionen, keine Menübefehle. Eine genaue Befehlsliste finden Sie unter [Befehle und Tastenkürzel](/reference/generated/commands/); welche Funktionen jedes Produkt ermöglicht, steht unter
[Produktfunktionen](/reference/generated/product-capabilities/).

### Herkunft dieser Angaben

- Die Zeilen für **Soundscaper** stammen aus diesem Repository: aus den Produktfähigkeitsprofilen, dem Laufzeit-Aktionsmanifest und dem Register der Exportformate.
  Desktop-native Zielartefakte werden durch die Repository-CI oder die Zielpaketierung generiert.
  Ein Paket aktiviert eine Funktion erst nach Bereitstellung und Verifizierung des exakt passenden Ergebnisses; diese Zeilen geben an, wann ein Artefakt noch erforderlich ist.
- Die Zeilen für **Audacity 4** stammen aus dem in diesem Repository festgelegten Upstream-Inventar, `4.0.0` bei Commit `4c177d43`. Eine Funktion, die Upstream registriert, aber deaktiviert lässt oder aus dem Menü auskommentiert,
  wird entsprechend dokumentiert, und eine Funktion ohne Registrierung im festgelegten Build wird als in diesem Build nicht vorhanden gemeldet, nicht als dauerhaft abwesend.
- Die Zeilen für **Audition** stammen aus der veröffentlichten Dokumentation von Adobe für die aktuelle
  Version. Sie wurden nicht gegen einen laufenden Build verifiziert.

## Plattform und Begriffe

| Funktion | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Lizenz | Ja — AGPL-3.0-only | Ja — GPL, Open Source | Nein — proprietär und geschlossen |
| Kosten | Ja — kostenlos | Ja — kostenlos | Nein — Creative Cloud-Abonnement |
| Läuft im Browser | Ja — Chromium, Firefox und WebKit | Nein — nur Desktop | Nein — nur Desktop |
| Desktop-Builds | Ja — Windows und Linux auf x64 und ARM64, macOS auf ARM64 | Ja — Windows, macOS, Linux | Teilweise — Windows und macOS, kein Linux |
| Funktioniert ohne Konto | Ja — es existiert kein Konto | Ja — Anmeldung nur für audio.com | Nein — angemeldetes Abonnement erforderlich |
| Cloud-Projekt-Speicher | Nein — durch das Local-First-Design ausgeschlossen | Ja — speichern und teilen über audio.com | Teilweise — Creative Cloud-Dateien, Sitzungen werden nicht synchronisiert |
| Systemanforderungen | Ja — läuft überall, wo ein aktueller Browser läuft | Teilweise — erheblich erhöht gegenüber Audacity 3 | Teilweise — professionelle Workstation-Klasse |

## Projekt- und Sitzungsmodell

| Funktion | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Natives Projektformat | Ja — `.sscape`, ein verlustfreies, portierbares Archiv | Ja — `.aup4` | Ja — `.sesx` |
| Öffnet Audacity-Projekte | Ja — AUP4-Import und -Export | Ja — nativ | Nein |
| Nicht destruktive Clip-Zeitleiste | Ja | Ja | Ja — Mehrspur-Editor |
| Dedizierter Einzeldatei-Editor | Teilweise — Sample-Bearbeitung erfolgt in der Zeitleiste | Teilweise — Änderungen werden direkt in der Zeitleiste angewendet | Ja — Wellenform-Editor |
| Mono- und Stereoinhalte auf einer Spur | Ja — eine Spur enthält entweder Mono oder Stereo | Nein — eine Spur ist entweder Mono oder Stereo | Nein — das Kanalformat ist pro Spur festgelegt |
| Verschachtelte Spurordner | Ja — beliebige Tiefe, rückgängig machbar, mit Routing | Nein | Teilweise — nur Submix-Busse, keine Spurordner |
| Projektordner | Ja — organisiert Dateien und dient gleichzeitig als Zwischenablage | Nein | Teilweise — das Panel „Dateien“ listet geöffnete Dateien auf |
| Automatische Speicherung und Wiederherstellung nach Abstürzen | Ja — automatische Speicherung, Sperren und Wiederherstellungsdateien | Ja | Ja |
| Marker und benannte Bereiche | Ja — erstklassig, mit Navigation und Nachrückverhalten | Teilweise — Label-Spuren | Ja — Marker und Bereiche |
| Tempo- und Taktartkarten | Ja — geordnete Karten, die samplegenau aufgelöst werden | Teilweise — ein Projektempo und eine Taktart | Teilweise — ein Session-Tempo |

## Aufnahme

| Funktion | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mehrspur-Aufnahme | Ja — mehrere Quellen gleichzeitig | Teilweise — ein Eingabegerät zur Zeit | Ja — Multi-Input- und Multichannel-Schnittstellen |
| Mikrofon- und Desktop-Audio gleichzeitig | Ja — integriert | Nein | Teilweise — erfordert ein Betriebssystem-Loopback-Gerät |
| Zeitgesteuerte Aufnahme | Ja | Ja | Nein |
| Schallaktivierte Aufnahme | Ja — mit einstellbarer Schwelle | Ja — mit einstellbarer Schwelle | Nein |
| Count-in vor dem Take | Ja — berücksichtigt die Tempokarte und behandelt zusammengesetzte Taktarten | Teilweise — Vorlaufaufnahme | Teilweise — Vorlauf als Teil von Punch and Roll |
| Punch-Aufnahme | Ja — eine Transaktion, Standardaufnahme und geroutete Aufnahme | Nein | Ja — Punch and Roll |
| Loop-Aufnahme in Takes | Ja — eine Spur pro Durchgang, an dieselbe Gruppe angehängt | Nein | Teilweise — Takes auf einem Clip, aus einer Liste ausgewählt |
| Take-Comping | Ja — Anhören, Übernehmen und Bearbeiten von Comp-Bereichen, Zusammenführen zu einer einzigen rückgängig machbaren Bearbeitung | Nein | Nein — kein Comp-Editor |
| Eingabeüberwachung und Pegelanzeige | Ja | Ja | Ja |

## Zeitleistenbearbeitung

| Funktion | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Ripple-Bearbeitungsvarianten | Ja — pro Clip, pro Spur und alle Spuren, bei Schnitt und Löschen | Ja — dieselben drei, bei Schnitt und Löschen | Teilweise — Ripple-Löschen bei einer Auswahl oder Lücke |
| Teilen, Verbinden und Teilen an Stille | Ja | Ja | Teilweise — Teilen und Zuschneiden, kein Verbinden von Clips |
| Clip-Gruppen | Ja | Ja | Ja |
| Clip-Lautstärke | Ja | Ja | Ja |
| Tonhöhe und Tempo pro Clip | Ja — anpassen, rendern oder zurücksetzen | Ja — anpassen, rendern oder zurücksetzen | Teilweise — Dehnen bleibt editierbar, Tonhöhe ist ein Effekt |
| Tempoänderungen folgen | Ja — Clips dehnen sich, wenn die Karte sich bewegt | Ja | Nein |
| Beat-bewusste Quantisierung und Groove | Ja — Warp-Karten mit einstellbarer Groove-Stärke | Nein | Nein |
| Einrasten auf Nulldurchgänge | Ja | Ja | Ja |
| Zeichnen auf Sample-Ebene | Ja | Teilweise — im festgelegten Build ist keine Zeichenaktion registriert | Ja — im Wellenform-Editor |
| Bearbeitung nur per Tastatur | Ja — jedes Bearbeitungselement hat eine Navigationsaktion | Ja — jedes Bearbeitungselement hat eine Navigationsaktion | Teilweise — umfangreiche Shortcuts, einige Panels benötigen die Maus |

## Spektrale Arbeit und Restaurierung

| Funktion | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Spektrogramm-Ansicht | Ja — mit Einstellungen pro Spur | Ja — mit Einstellungen pro Spur | Ja — Frequenz- und Tonhöhenanzeigen |
| Frequenzbegrenzte Auswahl | Ja | Ja | Ja — Markierauswahl und Lasso |
| Spektralpinsel | Ja | Ja | Ja — Pinsel und Spot-Heilung |
| Spektralen Bereich löschen oder verstärken | Ja — beide als direkte Aktionen | Ja — beide als direkte Aktionen | Teilweise — Effekt auf die Auswahl anwenden |
| Kurze Schäden reparieren | Ja — Reparatur | Ja — Reparatur | Ja — automatische Reparatur und Reparaturpinsel |
| Breitband-Rauschunterdrückung | Ja — mit einem erfassten Profil | Ja — mit einem erfassten Profil | Ja — Rauschunterdrückung, Adaptive Rauschunterdrückung, DeNoise |
| Hall entfernen | Nein | Nein | Ja — DeReverb |
| Werkzeuge für Klicks, Brummen und Sibilanz | Teilweise — nur Klickentfernung | Teilweise — nur Klickentfernung | Ja — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Diagnose-Panel | Teilweise — Find Clipping als Analyser | Teilweise — Find Clipping als Analyser | Ja — Diagnosen mit Reparatur pro Problem |

## Effekte und Plug-ins

| Funktion | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Integrierte Effekt-Suite | Ja — die 30 Audacity-Effekte, gebündelte Nyquist-Plug-ins und First-Party-Effekte ohne Upstream-Äquivalent, etwa der Bitcrusher | Ja — dieselbe integrierte Sammlung von 30 Effekten | Ja — etwa fünfzig, einschließlich Multiband-Dynamik |
| Echtzeit-Effekt-Rack pro Spur | Ja — ein umfangreicheres Echtzeit-Effektset als Upstream | Ja | Ja — sechzehn Slots pro Clip, Spur und Master |
| Parametrischer EQ | Ja — ein neuer parametrischer EQ mit automatisierbaren Bändern | Teilweise — Filterkurve und grafischer EQ | Ja — parametrische, grafische und FFT-Filter |
| Effekt-Presets | Ja — anwenden, speichern, importieren, exportieren | Ja — anwenden, speichern, importieren, exportieren | Ja |
| Makros und Batch-Ketten | Ja — gespeicherte Makro-Bibliothek mit Vorlagen | Nein — der gepinnte Build kommentiert das Makro-Menü aus | Ja — Favoriten und Batch Process |
| Drittanbieter-Plug-in-Formate | Teilweise — VST3, CLAP, AU und LV2 auf dem Desktop nach Zustimmung und mit Abschirmung, im Browser keine | Ja — VST3, AU, LV2 und Nyquist mit einem Plug-in-Manager | Teilweise — VST3 und AU auf macOS, kein CLAP oder LV2 |
| Nyquist-Skripting | Ja — gebündelte Plug-ins und der Nyquist-Prompt | Ja — gebündelte Plug-ins und der Nyquist-Prompt | Nein |
| Sandbox-Effektpakete | Teilweise — geprüfte WebAssembly-Pakete, eines wird ausgeliefert und externe sind eingezäunt | Nein | Nein |
| Virtuelle Instrumente | Nein — nach 1.0 | Nein | Nein |

## Mischen, Routing und Automatisierung

| Funktion | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mixer mit Kanalstreifen | Ja | Teilweise — Spur-Steuerungen und eine Master-Spur | Ja |
| Busse und Submixes | Ja — verschachtelt, mit Zyklusprüfung | Nein | Ja — Bus-Spuren |
| Sends | Ja — Pre- und Post-Fader, mehrere Zuweisungen | Nein | Ja — Pre- und Post-Fader |
| VCA-Gruppen | Ja | Nein | Nein |
| Sidechain-Eingang | Ja | Nein | Ja — über Sends |
| Cue- und Control-Room-Mixe | Ja | Nein | Nein |
| Plug-in-Latenzkompensation | Ja — Wiedergabe, Monitoring, Busse, Sidechains, Rendering und Einfrieren | Teilweise — in den festgelegten Quellen nicht offengelegt | Ja |
| Automatisierungsspuren | Ja — Gain, Pan, Stummschalten, Sends, Busse und Plug-in-Parameter | Nein — keine Spuren und kein Hüllkurvenwerkzeug im festgelegten Build | Ja — Lautstärke, Pan und Effektparameter |
| Automatisierungsmodi | Ja — Lesen, Trimmen, Berühren, Halten und Schreiben | Nein | Teilweise — Lesen, Schreiben, Halten und Berühren, kein Trimmen |
| Kurvenformen | Ja — Linie, Halten und Kurve | Nein | Ja — linear und Spline |
| Spur einfrieren | Ja — einfrieren, auftauen und festschreiben, ohne den Zustand zu verlieren | Nein | Teilweise — auf eine neue Spur übertragen |

## Pegel und Analyse

| Funktion | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Lautheitsmessgerät | Ja — nach EBU R 128, mit Verlauf | Nein — ein Lautheitsnormalisierungseffekt, aber kein Messgerät | Ja — Loudness Radar nach ITU-R BS.1770 |
| Phasen- und Korrelationsmessgerät | Ja | Nein | Ja — Phasenmessgerät und Analyse |
| Surround-Messung | Ja | Nein | Teilweise — bis zu 5.1 |
| Spektraldiagramm | Ja — Plot Spectrum | Teilweise — registriert, aber der gepinnte Build kommentiert es im Menü „Analysieren“ aus | Ja — Frequenzanalyse |
| Clipping und RMS in der Wellenform | Ja — beide, pro Projekt umschaltbar | Ja — beide, pro Projekt umschaltbar | Teilweise — Clipping-Anzeigen, RMS in Amplitudenstatistik |
| Sprachverständlichkeitskontrast | Ja — Kontrastanalysator | Teilweise — registriert, aber der gepinnte Build kommentiert es im Menü „Analysieren“ aus | Nein |

## Kanäle und immersives Audio

| Funktion | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Kanäle pro Datei | Ja — bis zu 32 für PCM-Formate | Teilweise — Mono- und Stereospuren | Ja — bis zu 32 im Wellenformeditor |
| Surround-Mixing | Ja — Audio-Betten bis zu 7.1.4 | Nein | Teilweise — bis zu 5.1 |
| Objektbasiertes Audio | Ja — Objekte neben Audio-Betten | Nein | Nein |
| ADM-Autoring und Durchleitung | Ja — BW64/ADM mit Konformitätsprüfungen | Nein | Nein |
| Binaurale Wiedergabe | Ja — ein benanntes binaurales Modell | Nein | Teilweise — Binauraliser für Ambisonics |
| Ambisonics | Nein | Nein | Ja — erste Ordnung, mit VR-Panner |

## Export und Lieferung

| Funktion | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Verlustfreie Ausgabe | Ja — WAV, AIFF, BWF und BW64 nativ geschrieben | Ja — WAV, AIFF und FLAC | Ja — WAV, AIFF, FLAC und mehr |
| Verlustbehaftete Ausgabe | Teilweise — MP3, AAC, Opus, Vorbis, MP2, FLAC und WavPack, alle über die FFmpeg-Laufzeit | Teilweise — MP3 integriert, der Rest über eine optionale FFmpeg-Installation | Ja — integriert |
| Benutzerdefinierte Encoder-Einstellungen | Ja — ein benutzerdefiniertes FFmpeg-Ziel | Ja — ein benutzerdefiniertes FFmpeg-Ziel | Ja — Formatoptionen |
| Export-Warteschlange | Ja — Pause, Abbrechen, Wiederholen und Neuordnen | Nein — nur ein Export gleichzeitig | Teilweise — Stapelverarbeitung ohne Warteschlangenkontrolle |
| Stems und Alternativen in einem Durchgang | Ja — gemeinsam mit dem Mix in der Warteschlange | Nein | Teilweise — ein Mixdown pro Stem |
| Lieferung Region für Region | Ja — Mastering-Sequenzen mit Metadaten, Lücken und Fades pro Region | Teilweise — Export-Labels, kein Mehrdatei-Export im gepinnten Build | Ja — Export-Marker zu separaten Dateien |
| Lautheitsnormalisierung beim Export | Ja — Teil des Lieferplans | Teilweise — Effekt zuerst ausführen | Ja — Match Loudness |
| Dither und Kanalzuordnung | Ja — explizite Steuerelemente | Teilweise — Dither in den Einstellungen | Ja — explizite Steuerelemente |
| Lieferbericht | Ja — detailliert pro Auftrag | Nein | Nein |
| Render-Warteschlange übersteht einen Neustart | Ja — auf dem Desktop, Neustart ab Byte null mit Absturzprotokoll | Nein | Nein |

## Austausch mit anderen Tools

| Funktion | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Audacity-Projekte | Ja — AUP4 als Import und Export, mit Auslassungsbericht | Ja — nativ | Nein |
| EDL | Teilweise — Export auf CMX3600-Ebene, kein Import | Nein | Nein |
| OpenTimelineIO | Teilweise — nur Export | Nein | Nein |
| FCPXML | Teilweise — nur Export | Nein | Ja — Import und Export |
| DAWproject | Ja — Import und Export, mit Austauschbericht | Nein | Nein |
| OMF | Nein | Nein | Teilweise — Import und Export |
| Rückweg mit einem Videoeditor | Teilweise — übergibt dasselbe Projekt an Framescaper, ohne Medien zu kopieren | Nein | Ja — Dynamic Link mit Premiere Pro |
| Austausch von Labels und Markern | Ja — Import und Export | Ja — Import und Export | Ja — Markerlisten |

## Video

| Funktion | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Video als Referenz importieren | Ja — auf der Timeline, mit verknüpftem Audio | Nein | Teilweise — eine Videospur, nur Vorschau |
| Videotimeline-Bearbeitung | Teilweise — grundlegende Bearbeitung, die vollständige Oberfläche ist Framescaper | Nein | Nein |
| Videoexport | Ja — MP4 und WebM über die FFmpeg-Laufzeitumgebung | Nein | Nein — nur Audio |
| Compositing, Color Grading und Effekte | Teilweise — in Framescaper, im selben Projekt | Nein | Nein |

## Maschinenunterstützung

| Funktion | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Sprachverbesserung | Teilweise — nur Desktop, nach Installation der Modell-Datei | Nein | Ja — Enhance Speech |
| Transkription und Diarisation | Teilweise — nur Desktop, optionale Modelle | Nein | Nein — Transkripte befinden sich in Premiere Pro |
| Quellen-Trennung in Stems | Teilweise — nur Desktop, optionale Modelle | Nein | Nein |
| Automatisches Ducking | Ja — Auto Duck-Effekt | Ja — Auto Duck-Effekt | Ja — Essential Sound Ducking |
| Beat- und Shot-Erkennung | Teilweise — nur Desktop, optionale Modelle | Nein | Teilweise — Remix passt Musik automatisch an das Tempo an |
| Läuft vollständig auf Ihrem Gerät | Ja — die Inferenz läuft nur auf dem Desktop und nach der Installation offline | Ja — keine Inferenz | Teilweise — einige Funktionen werden in der Adobe-Cloud verarbeitet |
| Modelle sind optional und entfernbar | Ja — separat heruntergeladen, mit Digest festgeschrieben und löschbar | Ja — nichts zu installieren | Nein — mit der Anwendung gebündelt |

## Was die Unterschiede insgesamt bedeuten

Audacity 4 ist ein Editor für einzelne Durchläufe. Es hat keine Busse, keine Sends, keine
Automatisierungsspur und keine Makros in der gepinnten Build. Soundscaper behält
dieses Bearbeitungsmodell bei und fügt die Misch-, Automatisierungs- und
Lieferungsschicht darüber hinzu, plus Aufnahme, Video und Austauschfunktionen,
die Audacity nicht anbietet.

Audition führt weiterhin bei der Restaurierungstiefe, bei Rückwegen zu
Premiere Pro und bei Ambisonics. Wo Soundscaper führt, ist die immersive
Lieferung, die Projektbehandlung und die Tatsache, dass es in einem Browser auf
Hardware läuft, die keiner der anderen unterstützt.

Wenn Sie bereits in Audacity arbeiten, siehe
[Projektdateien und Audacity-Austausch](/projects-and-data/project-files/) für
Informationen dazu, wie man ein Projekt überträgt.
