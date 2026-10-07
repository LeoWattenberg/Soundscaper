---
title: "Vergleich von Soundscaper"
description: "Vergleichen Sie Soundscaper Web und Desktop mit Audacity 4 und Adobe Audition in Bezug auf Aufnahme, Bearbeitung, Mischung, Bereitstellung und Austausch."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"de"} -->

Soundscaper setzt Audacity 4 für das Web neu um und ergänzt es um eine Produktionsebene. Adobe Audition ist das kommerzielle Postproduktionswerkzeug, an dem beide üblicherweise gemessen werden. Diese Seite vergleicht Soundscaper Web und Desktop, Audacity 4 und Audition, damit Sie erkennen können, welche Edition Ihre Aufgabe bereits erfüllt.

## So lesen Sie diese Seite

Jede Zelle beginnt mit einem farbigen Symbol, gefolgt von einer Erläuterung:

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — unterstützt oder zutreffend
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — eingeschränkter Umfang, plattformabhängig oder nur mit einem Workaround verfügbar
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — nicht verfügbar oder nicht zutreffend

Lesen Sie die Hinweise zusammen mit den Symbolen. Ein optional zu installierendes Plug-in, Modell oder Codec macht eine unterstützte Desktop-Funktion nicht automatisch zu einer eingeschränkten Funktion; im Hinweis steht, was installiert werden muss. Web und Desktop haben getrennte Spalten, sodass eine Browser-Einschränkung die Bewertung der Desktop-Version nicht mindert.

Die Zeilen beschreiben Funktionen, keine Menübefehle. Eine genaue Befehlsliste finden Sie unter [Befehle und Tastenkürzel](/reference/generated/commands/); welche Funktionen jedes Produkt ermöglicht, steht unter
[Produktfunktionen](/reference/generated/product-capabilities/).

### Herkunft dieser Angaben

- Die Zeilen zu **Soundscaper** stammen aus diesem Repository: den Produktfähigkeitsprofilen, dem Laufzeit-Aktionsmanifest, dem Exportformat-Register sowie den Codec-Freigaben für Browser und Desktop.
  Native Desktop-Zielartefakte werden durch die Repository-CI oder das Packaging des jeweiligen Ziels erstellt. Ein Paket aktiviert eine Funktion erst, nachdem das exakt passende Ergebnis bereitgestellt und geprüft wurde; die Zeilen nennen, wann ein Artefakt noch benötigt wird.
- Die Zeilen zu **Audacity 4** beruhen auf dem in diesem Repository festgelegten Upstream-Inventar, Version `4.0.0` bei Commit `4c177d43`, und berücksichtigen sichtbare Änderungen bis zur offiziellen [Version `4.0.1`](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt) bei Commit `d82386ce`. Eine Funktion, die Upstream registriert, aber deaktiviert lässt oder aus dem Menü auskommentiert, wird entsprechend erfasst. Fehlt eine Registrierung im geprüften Inventar und in den Release-Hinweisen, wird die Funktion dort als nicht vorhanden gemeldet und nicht als dauerhaft abwesend. Sample-Zeichnung, Clip-Verstärkungshüllkurven und der Import älterer Projekte sind auch im offiziellen [Änderungsprotokoll zu 4.0](https://www.audacityteam.org/changelog/) und im [Handbuch zur Clip-Verstärkung](https://www.audacityteam.org/manual/clips/clip-gain/) dokumentiert.
- Die Zeilen für **Audition** stammen aus der veröffentlichten Dokumentation von Adobe für die aktuelle
  Version. Sie wurden nicht gegen einen laufenden Build verifiziert.

## Plattform und Begriffe

| Funktion | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Lizenz | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL, Open Source | / — proprietär und geschlossen |
| Kosten | + — kostenlos | + — kostenlos | + — kostenlos | / — Creative Cloud-Abonnement |
| Läuft im Browser | + — Chromium, Firefox und WebKit | / — Paketierte Anwendung | / — nur Desktop | / — nur Desktop |
| Desktop-Builds | / — Verwenden Sie die Web-Version | + — Windows und Linux auf x64 und ARM64, macOS auf ARM64 | + — Windows (Installationsprogramm oder portabel), macOS, Linux | ~ — Windows und macOS, kein Linux |
| Funktioniert ohne Konto | + — es existiert kein Konto | + — es existiert kein Konto | + — Anmeldung nur für audio.com | / — angemeldetes Abonnement erforderlich |
| Cloud-Projekt-Speicher | / — durch das Local-First-Design ausgeschlossen | / — durch das Local-First-Design ausgeschlossen | + — speichern und teilen über audio.com | ~ — Creative Cloud-Dateien, Sitzungen werden nicht synchronisiert |
| Systemanforderungen | + — läuft überall, wo ein aktueller Browser läuft | + — Windows, Linux oder macOS auf den unterstützten Desktop-Architekturen | ~ — erheblich erhöht gegenüber Audacity 3 | ~ — professionelle Workstation-Klasse |

## Projekt- und Sitzungsmodell

| Funktion | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Natives Projektformat | + — `.sscape`, ein verlustfreies, portierbares Archiv | + — `.sscape`, ein verlustfreies, portierbares Archiv | + — `.aup4` | + — `.sesx` |
| Öffnet Audacity-Projekte | + — AUP-, AUP3- und AUP4-Import; AUP3- und AUP4-Export | + — AUP-, AUP3- und AUP4-Import; AUP3- und AUP4-Export | + — AUP-, AUP3- und AUP4-Import; AUP4-Export, kein AUP3-Export | / |
| Nicht destruktive Clip-Zeitleiste | + | + | + | + — Mehrspur-Editor |
| Dedizierter Einzeldatei-Editor | + — Wellenform-Editor der Quelle in den Clip-Eigenschaften | + — Wellenform-Editor der Quelle in den Clip-Eigenschaften | ~ — Änderungen werden direkt in der Zeitleiste angewendet | + — Wellenform-Editor |
| Mono- und Stereoinhalte auf einer Spur | + — eine Spur enthält entweder Mono oder Stereo | + — eine Spur enthält entweder Mono oder Stereo | / — eine Spur ist entweder Mono oder Stereo | / — das Kanalformat ist pro Spur festgelegt |
| Verschachtelte Spurordner | + — beliebige Tiefe, rückgängig machbar, mit Routing | + — beliebige Tiefe, rückgängig machbar, mit Routing | / | ~ — nur Submix-Busse, keine Spurordner |
| Projektordner | + — organisiert Dateien und dient gleichzeitig als Zwischenablage | + — organisiert Dateien und dient gleichzeitig als Zwischenablage | / | ~ — das Panel „Dateien“ listet geöffnete Dateien auf |
| Automatische Speicherung und Wiederherstellung nach Abstürzen | + — automatische Speicherung, Sperren und Wiederherstellungsdateien | + — automatische Speicherung, Sperren und Wiederherstellungsdateien | + | + |
| Marker und benannte Bereiche | + — erstklassig, mit Navigation und Nachrückverhalten | + — erstklassig, mit Navigation und Nachrückverhalten | ~ — Label-Spuren | + — Marker und Bereiche |
| Tempo- und Taktartkarten | + — geordnete Karten, die samplegenau aufgelöst werden | + — geordnete Karten, die samplegenau aufgelöst werden | ~ — ein Projektempo und eine Taktart | ~ — ein Session-Tempo |

## Aufnahme

| Funktion | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Mehrspur-Aufnahme | + — mehrere Quellen gleichzeitig | + — mehrere Quellen gleichzeitig | ~ — ein Eingabegerät zur Zeit | + — Multi-Input- und Multichannel-Schnittstellen |
| Mikrofon- und Desktop-Audio gleichzeitig | ~ — integriert, sofern Browser und Betriebssystem die Audioausgabe des Bildschirms bereitstellen | + — Mikrofon plus Windows-Desktop-Loopback; auf anderen Systemen ist ein Loopback-Eingang erforderlich | / | ~ — erfordert ein Betriebssystem-Loopback-Gerät |
| Zeitgesteuerte Aufnahme | + | + | + | / |
| Schallaktivierte Aufnahme | + — mit einstellbarer Schwelle | + — mit einstellbarer Schwelle | + — mit einstellbarer Schwelle | / |
| Count-in vor dem Take | + — berücksichtigt die Tempokarte und behandelt zusammengesetzte Taktarten | + — berücksichtigt die Tempokarte und behandelt zusammengesetzte Taktarten | ~ — Vorlaufaufnahme | ~ — Vorlauf als Teil von Punch and Roll |
| Punch-Aufnahme | + — eine Transaktion, Standardaufnahme und geroutete Aufnahme | + — eine Transaktion, Standardaufnahme und geroutete Aufnahme | / | + — Punch and Roll |
| Loop-Aufnahme in Takes | + — eine Spur pro Durchgang, an dieselbe Gruppe angehängt | + — eine Spur pro Durchgang, an dieselbe Gruppe angehängt | / | ~ — Takes auf einem Clip, aus einer Liste ausgewählt |
| Take-Comping | + — Anhören, Übernehmen und Bearbeiten von Comp-Bereichen, Zusammenführen zu einer einzigen rückgängig machbaren Bearbeitung | + — Anhören, Übernehmen und Bearbeiten von Comp-Bereichen, Zusammenführen zu einer einzigen rückgängig machbaren Bearbeitung | / | / — kein Comp-Editor |
| Eingabeüberwachung und Pegelanzeige | + | + | + | + |

## Zeitleistenbearbeitung

| Funktion | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Ripple-Bearbeitungsvarianten | + — pro Clip, pro Spur und alle Spuren, bei Schnitt und Löschen | + — pro Clip, pro Spur und alle Spuren, bei Schnitt und Löschen | + — dieselben drei, bei Schnitt und Löschen | ~ — Ripple-Löschen bei einer Auswahl oder Lücke |
| Teilen, Verbinden und Teilen an Stille | + | + | + | ~ — Teilen und Zuschneiden, kein Verbinden von Clips |
| Clip-Gruppen | + | + | + | + |
| Clip-Lautstärke | + | + | + | + |
| Tonhöhe und Tempo pro Clip | + — anpassen, rendern oder zurücksetzen | + — anpassen, rendern oder zurücksetzen | + — anpassen, rendern oder zurücksetzen | ~ — Dehnen bleibt editierbar, Tonhöhe ist ein Effekt |
| Tempoänderungen folgen | + — Clips dehnen sich, wenn die Karte sich bewegt | + — Clips dehnen sich, wenn die Karte sich bewegt | + | / |
| Beat-bewusste Quantisierung und Groove | + — Warp-Karten mit einstellbarer Groove-Stärke | + — Warp-Karten mit einstellbarer Groove-Stärke | / | / |
| Einrasten auf Nulldurchgänge | + | + | + | + |
| Zeichnen auf Sample-Ebene | + | + | + — verfügbar, wenn bis auf einzelne Samples gezoomt wird | + — im Wellenform-Editor |
| Bearbeitung nur per Tastatur | + — jedes Bearbeitungselement hat eine Navigationsaktion | + — jedes Bearbeitungselement hat eine Navigationsaktion | + — Bearbeitungsaktionen, Zeitleiste und vertikale Spurenlineale lassen sich per Tastatur bedienen | ~ — umfangreiche Shortcuts, einige Panels benötigen die Maus |

## Spektrale Arbeit und Restaurierung

| Funktion | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Spektrogramm-Ansicht | + — mit Einstellungen pro Spur | + — mit Einstellungen pro Spur | + — mit Einstellungen pro Spur | + — Frequenz- und Tonhöhenanzeigen |
| Frequenzbegrenzte Auswahl | + | + | + | + — Markierauswahl und Lasso |
| Spektralpinsel | + | + | + | + — Pinsel und Spot-Heilung |
| Spektralen Bereich löschen oder verstärken | + — beide als direkte Aktionen | + — beide als direkte Aktionen | + — beide als direkte Aktionen | ~ — Effekt auf die Auswahl anwenden |
| Kurze Schäden reparieren | + — Reparatur | + — Reparatur | + — Reparatur | + — automatische Reparatur und Reparaturpinsel |
| Breitband-Rauschunterdrückung | + — mit einem erfassten Profil | + — mit einem erfassten Profil | + — mit einem erfassten Profil | + — Rauschunterdrückung, Adaptive Rauschunterdrückung, DeNoise |
| Hall entfernen | / — nur Desktop-Unterstützung | + — „Reverb reduzieren“ mit installiertem optionalem Modell und Engine | / | + — DeReverb |
| Werkzeuge für Klicks, Brummen und Sibilanz | ~ — Klickentfernung und De-Esser; kein eigener Netzbrummen-Entferner | ~ — Klickentfernung und De-Esser; kein eigener Netzbrummen-Entferner | ~ — nur Klickentfernung | + — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Diagnose-Panel | ~ — Find Clipping als Analyser | ~ — Find Clipping als Analyser | ~ — Find Clipping als Analyser | + — Diagnosen mit Reparatur pro Problem |

## Effekte und Plug-ins

| Funktion | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Integrierte Effekt-Suite | + — von Audacity abgeleitete Effekte, enthaltene Nyquist-Plug-ins und eigene Effekte wie Bitcrusher und De-Esser | + — von Audacity abgeleitete Effekte, enthaltene Nyquist-Plug-ins und eigene Effekte wie Bitcrusher und De-Esser | + — 30 integrierte Effekte im festgelegten Build | + — etwa fünfzig, einschließlich Multiband-Dynamik |
| Echtzeit-Effekt-Rack pro Spur | + — ein umfangreicheres Echtzeit-Effektset als Upstream | + — ein umfangreicheres Echtzeit-Effektset als Upstream | + | + — sechzehn Slots pro Clip, Spur und Master |
| Parametrischer EQ | + — ein neuer parametrischer EQ mit automatisierbaren Bändern | + — ein neuer parametrischer EQ mit automatisierbaren Bändern | ~ — Filterkurve und grafischer EQ | + — parametrische, grafische und FFT-Filter |
| Effekt-Presets | + — anwenden, speichern, importieren, exportieren | + — anwenden, speichern, importieren, exportieren | + — anwenden, speichern, importieren, exportieren | + |
| Makros und Batch-Ketten | + — gespeicherte Makro-Bibliothek mit Vorlagen | + — gespeicherte Makro-Bibliothek mit Vorlagen | / — der gepinnte Build kommentiert das Makro-Menü aus | + — Favoriten und Batch Process |
| Drittanbieter-Plug-in-Formate | / — native Plug-ins benötigen die Desktop-Version | + — VST3, CLAP, AU, LV2, Linux-LADSPA und Vamp; plattformspezifisch, mit Einwilligung und Abschottung | + — VST3, AU, LV2 und Nyquist mit einem Plug-in-Manager | ~ — VST3 und AU auf macOS, kein CLAP oder LV2 |
| Nyquist-Skripting | + — gebündelte Plug-ins und der Nyquist-Prompt | + — gebündelte Plug-ins und der Nyquist-Prompt | + — gebündelte Plug-ins und der Nyquist-Prompt | / |
| Sandbox-Effektpakete | ~ — geprüfte WebAssembly-Pakete, eines wird ausgeliefert und externe sind eingezäunt | ~ — geprüfte WebAssembly-Pakete, eines wird ausgeliefert und externe sind eingezäunt | / | / |
| Virtuelle Instrumente | / | / | / | / |

## Mischen, Routing und Automatisierung

| Funktion | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Mixer mit Kanalstreifen | + | + | ~ — Spur-Steuerungen und eine Master-Spur | + |
| Busse und Submixes | + — verschachtelt, mit Zyklusprüfung | + — verschachtelt, mit Zyklusprüfung | / | + — Bus-Spuren |
| Sends | + — Pre- und Post-Fader, mehrere Zuweisungen | + — Pre- und Post-Fader, mehrere Zuweisungen | / | + — Pre- und Post-Fader |
| VCA-Gruppen | + | + | / | / |
| Sidechain-Eingang | + | + | / | + — über Sends |
| Cue- und Control-Room-Mixe | + | + | / | / |
| Plug-in-Latenzkompensation | + — Wiedergabe, Monitoring, Busse, Sidechains, Rendering und Einfrieren | + — Wiedergabe, Monitoring, Busse, Sidechains, Rendering und Einfrieren | ~ — in den festgelegten Quellen nicht offengelegt | + |
| Automatisierungsspuren | + — Gain, Pan, Stummschalten, Sends, Busse und Plug-in-Parameter | + — Gain, Pan, Stummschalten, Sends, Busse und Plug-in-Parameter | ~ — Clip-Verstärkungshüllkurven; keine Spuren- oder Effektautomationsspuren | + — Lautstärke, Pan und Effektparameter |
| Automatisierungsmodi | + — Lesen, Trimmen, Berühren, Halten und Schreiben | + — Lesen, Trimmen, Berühren, Halten und Schreiben | / | ~ — Lesen, Schreiben, Halten und Berühren, kein Trimmen |
| Kurvenformen | + — Linie, Halten und Kurve | + — Linie, Halten und Kurve | ~ — nur Clip-Verstärkungshüllkurven | + — linear und Spline |
| Spur einfrieren | + — einfrieren, auftauen und festschreiben, ohne den Zustand zu verlieren | + — einfrieren, auftauen und festschreiben, ohne den Zustand zu verlieren | / | ~ — auf eine neue Spur übertragen |

## Pegel und Analyse

| Funktion | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Lautheitsmessgerät | + — nach EBU R 128, mit Verlauf | + — nach EBU R 128, mit Verlauf | / — ein Lautheitsnormalisierungseffekt, aber kein Messgerät | + — Loudness Radar nach ITU-R BS.1770 |
| Phasen- und Korrelationsmessgerät | + | + | / | + — Phasenmessgerät und Analyse |
| Surround-Messung | + | + | / | ~ — bis zu 5.1 |
| Spektraldiagramm | + — Plot Spectrum | + — Plot Spectrum | ~ — registriert, aber der gepinnte Build kommentiert es im Menü „Analysieren“ aus | + — Frequenzanalyse |
| Clipping und RMS in der Wellenform | + — projektweite Umschalter mit RMS-Überschreibungen pro Spur | + — projektweite Umschalter mit RMS-Überschreibungen pro Spur | + — beide, pro Projekt umschaltbar | ~ — Clipping-Anzeigen, RMS in Amplitudenstatistik |
| Sprachverständlichkeitskontrast | + — Kontrastanalysator | + — Kontrastanalysator | ~ — registriert, aber der gepinnte Build kommentiert es im Menü „Analysieren“ aus | / |

Öffnen Sie in Soundscaper das Menü **Spurvisualisierung** einer Spur, um **Halbwelle** oder **RMS in Wellenform anzeigen** umzuschalten. Die Standardansicht, die Frequenzen der 3-Band-Weiche und die Spektrogrammeinstellungen finden Sie unter **Bearbeiten → Einstellungen → Spuranzeige**.

## Kanäle und immersives Audio

| Funktion | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Kanäle pro Datei | + — bis zu 32 für PCM-Formate | + — bis zu 32 für PCM-Formate | ~ — Mono- und Stereospuren | + — bis zu 32 im Wellenformeditor |
| Surround-Mixing | + — Audio-Betten bis zu 7.1.4 | + — Audio-Betten bis zu 7.1.4 | / | ~ — bis zu 5.1 |
| Objektbasiertes Audio | + — Objekte neben Audio-Betten | + — Objekte neben Audio-Betten | / | / |
| ADM-Autoring und Durchleitung | + — BW64/ADM mit Konformitätsprüfungen | + — BW64/ADM mit Konformitätsprüfungen | / | / |
| Binaurale Wiedergabe | + — ein benanntes binaurales Modell | + — ein benanntes binaurales Modell | / | ~ — Binauraliser für Ambisonics |
| Ambisonics | / | / | / | + — erste Ordnung, mit VR-Panner |

## Export und Lieferung

| Funktion | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Verlustfreie Ausgabe | + — WAV, AIFF, BWF und BW64 nativ; FLAC und WavPack über dedizierte Codecs | + — WAV, AIFF, BWF und BW64 nativ; FLAC und WavPack über dedizierte Codecs | + — WAV, AIFF und FLAC | + — WAV, AIFF, FLAC und mehr |
| Verlustbehaftete Ausgabe | ~ — MP3, MP2, Opus und Ogg Vorbis; AAC hängt vom Browser ab | + — MP3, MP2, Opus, Ogg Vorbis und AAC über unterstützte Codec-Anbieter, einschließlich konfiguriertem FFmpeg | + — MP3, Opus und Ogg Vorbis; weitere Formate über optionales FFmpeg | ~ — MP2, MP3 und Ogg Vorbis; weitere über Adobe Media Encoder, kein allgemeines FFmpeg-Ziel |
| Benutzerdefinierte Encoder-Einstellungen | ~ — Steuerelemente je Format; eigene FFmpeg-Argumente sind nicht verfügbar | ~ — Steuerelemente je Format; eigene FFmpeg-Argumente sind nicht verfügbar | + — ein benutzerdefiniertes FFmpeg-Ziel | + — Formatoptionen |
| Export-Warteschlange | + — Pause, Abbrechen, Wiederholen und Neuordnen | + — Pause, Abbrechen, Wiederholen und Neuordnen | / — „Mehrere exportieren“ ist ein einzelner sequenzieller Vorgang, keine Auftragswarteschlange | ~ — Stapelverarbeitung ohne Warteschlangenkontrolle |
| Stems und Alternativen in einem Durchgang | + — gemeinsam mit dem Mix in der Warteschlange | + — gemeinsam mit dem Mix in der Warteschlange | ~ — „Mehrere exportieren“ schreibt jede Spur einzeln, stellt den Mix und alternative Renderings aber nicht gemeinsam in eine Warteschlange | ~ — ein Mixdown pro Stem |
| Lieferung Region für Region | + — Mastering-Sequenzen mit Metadaten, Lücken und Fades pro Region | + — Mastering-Sequenzen mit Metadaten, Lücken und Fades pro Region | + — „Mehrere exportieren“ schreibt jeden beschrifteten Bereich in eine eigene Datei | + — Export-Marker zu separaten Dateien |
| Lautheitsnormalisierung beim Export | + — Teil des Lieferplans | + — Teil des Lieferplans | ~ — Effekt zuerst ausführen | + — Match Loudness |
| Dither und Kanalzuordnung | + — explizite Steuerelemente | + — explizite Steuerelemente | ~ — Dither in den Einstellungen | + — explizite Steuerelemente |
| Lieferbericht | + — detailliert pro Auftrag | + — detailliert pro Auftrag | / | / |
| Render-Warteschlange übersteht einen Neustart | / — dauerhafte Wiederherstellung von Renderaufträgen erfordert die Desktop-Version | + — setzt nach einem Neustart ab Byte null mit einem Absturzprotokoll fort | / | / |

Soundscaper Desktop kann für unterstützte Exportformate konfiguriertes FFmpeg verwenden. Der aktuelle Editor bietet keine beliebigen FFmpeg-Argumente und nicht jeden FFmpeg-Encoder an. Die registrierten Ziele finden Sie unter [Exportformate](/reference/generated/formats/). Audacitys [Export-Workflow](https://www.audacityteam.org/manual/getting-started/export-your-audio/) ergänzt Formate durch eine optionale FFmpeg-Installation. Audition bietet eine feste Auswahl an Dateischreibern und eine [Übergabe an Adobe Media Encoder](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html).

## Austausch mit anderen Tools

| Funktion | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Audacity-Projekte | + — AUP, AUP3 und AUP4 als Import; AUP3 und AUP4 als Export mit Kompatibilitätsbericht | + — AUP, AUP3 und AUP4 als Import; AUP3 und AUP4 als Export mit Kompatibilitätsbericht | + — AUP-, AUP3- und AUP4-Import; AUP4-Export, kein AUP3-Export | / |
| Audition-Sitzungen | / — SESX-Import erfordert die Desktop-Version | ~ — `.sesx`-Audioimport mit Auslassungsbericht; kein Export | / — kein SESX-Import im festgelegten Build | + — nativ |
| EDL | ~ — Export auf CMX3600-Ebene, kein Import | ~ — Export auf CMX3600-Ebene, kein Import | / | / |
| OpenTimelineIO | ~ — nur Export | ~ — nur Export | / | / |
| FCPXML | ~ — nur Export | ~ — nur Export | / | + — Import und Export |
| DAWproject | + — Import und Export, mit Austauschbericht | + — Import und Export, mit Austauschbericht | / | / |
| OMF | / | / | / | ~ — Import und Export |
| Rückweg mit einem Videoeditor | ~ — übergibt dasselbe Projekt an Framescaper, ohne Medien zu kopieren | ~ — übergibt dasselbe Projekt an Framescaper, ohne Medien zu kopieren | / | + — Dynamic Link mit Premiere Pro |
| Austausch von Labels und Markern | + — Import und Export | + — Import und Export | + — Import und Export | + — Markerlisten |

Informationen zum Import einer aus Audition stammenden `.sesx`-Datei findest du unter [Projektdateien](/projects-and-data/project-files/): Dort wird erklärt, welche Audioeinstellungen in Soundscaper übernommen und was im Bericht als ausgelassen gekennzeichnet wird.

## Video

| Funktion | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Video als Referenz importieren | + — auf der Timeline, mit verknüpftem Audio | + — auf der Timeline, mit verknüpftem Audio | / | ~ — eine Videospur, nur Vorschau |
| Videotimeline-Bearbeitung | ~ — grundlegende Bearbeitung, die vollständige Oberfläche ist Framescaper | ~ — grundlegende Bearbeitung, die vollständige Oberfläche ist Framescaper | / | / |
| Videoexport | ~ — MP4 und WebM, sofern WebCodecs im Browser die erforderlichen Codecs unterstützen | + — MP4 und WebM mit einem verifizierten Desktop-Codec-Anbieter | / | / — nur Audio |
| Compositing, Color Grading und Effekte | ~ — in Framescaper, im selben Projekt | ~ — in Framescaper, im selben Projekt | / | / |

## Maschinenunterstützung

Die Desktop-Unterstützung ist verfügbar, nachdem optionale Modellgewichte und eine passende native Engine installiert wurden; diese Workflows gibt es in der Web-Version nicht. Der Modell-Manager installiert beides. Unter [Lokale Unterstützung](/reference/generated/local-assistance/) finden Sie die verfügbaren Workflows und Modelle.

| Funktion | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Sprachverbesserung | / — nur Desktop-Unterstützung | + — mit installiertem optionalem Modell und Engine | / | + — Enhance Speech |
| Transkription und Diarisation | / — nur Desktop-Unterstützung | + — mit installierten optionalen Modellen und Engines | / | / — Transkripte befinden sich in Premiere Pro |
| Quellen-Trennung in Stems | / — nur Desktop-Unterstützung | + — mit installiertem optionalem Modell und Engine | / | / |
| Automatisches Ducking | + — Auto Duck-Effekt | + — Auto Duck-Effekt | + — Auto Duck-Effekt | + — Essential Sound Ducking |
| Beat- und Shot-Erkennung | / — Beat-Erkennung erfordert die Desktop-Version; Schnitterkennung ist in Framescaper verfügbar | ~ — Beat-Erkennung mit optionalem Modell; Schnitterkennung ist in Framescaper verfügbar | / | ~ — Remix passt Musik automatisch an das Tempo an |
| Läuft vollständig auf Ihrem Gerät | + — lokale Verarbeitung im Browser; keine Modellinferenz | + — lokale Verarbeitung und Offline-Inferenz nach der Modellinstallation | + — keine Inferenz | ~ — einige Funktionen werden in der Adobe-Cloud verarbeitet |
| Modelle sind optional und entfernbar | / — keine Modellinstallation in der Web-Version | + — separat heruntergeladen, mit Digest festgeschrieben und löschbar | + — nichts zu installieren | / — mit der Anwendung gebündelt |

## Was die Unterschiede insgesamt bedeuten

Audacity 4 ist ein Editor mit einem einzelnen Durchlauf. Im festgelegten Build gibt es keine Busse, Sends, Automationsspuren für Spuren oder Effekte und keine Makros. Clip-Verstärkungshüllkurven ermöglichen Lautstärkeautomation innerhalb eines Clips. Soundscaper behält dieses Bearbeitungsmodell bei und ergänzt Spur- und Effektautomation, Mischen und Bereitstellung sowie Aufnahme-, Video- und Austauschfunktionen, die Audacity nicht bietet.

Audition führt weiterhin bei der Restaurierungstiefe, bei Rückwegen zu
Premiere Pro und bei Ambisonics. Wo Soundscaper führt, ist die immersive
Lieferung, die Projektbehandlung und die Tatsache, dass es in einem Browser auf
Hardware läuft, die keiner der anderen unterstützt.

Wenn Sie bereits in Audacity arbeiten, siehe
[Projektdateien und Audacity-Austausch](/projects-and-data/project-files/) für
Informationen dazu, wie man ein Projekt überträgt.
