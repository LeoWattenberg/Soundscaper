---
title: "Import en export"
description: "Maak onderscheid tussen bronmedia, projectbestanden, uitwisselingsbestanden en gerenderde leveringen."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","targetLocale":"nl"} -->

Soundscaper gebruikt verschillende bestandsindelingen voor verschillende taken.

## Bronmedia

Gebruik **Bestand → Importeren** voor audio, video en labels. De huidige editor-hint vermeldt
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF en WebM; aanvullende videobestandsindelingen worden ondersteund via het videopad voor import. Beschikbaarheid kan afhangen van
die actief product en runtime.

Het importeren van media voegt een project-eigendom bron toe. Het maakt het originele bestand
niet uw bewerkbare projectdocument.

Gecomprimeerde audio-import en -export ondersteunen tot één uur of 1 GB
(1.000.000.000 bestandsbytes), afhankelijk van welke limiet eerst wordt bereikt. Een uur durend
48 kHz stereo-bestand wordt ondersteund wanneer het binnen die bestandslimiet past. Lange taken lezen,
coderen en opslaan in delen; grote browser-exporten vereisen origin-private bestandsopslag en voldoende vrije ruimte. Grote importen vereisen persistente lokale opslag
voor de gedecodeerde audio. PCM-formaten behouden hun afzonderlijke limieten.

De browserafdeling dekt MP3, MP2, FLAC, WavPack, Opus en Ogg Vorbis. Browser
AAC/M4A-ondersteuning is afhankelijk van de browsercodec. Desktop streaming-exporten dekken
de zes gebundelde formaten, met 24-bits FLAC en float32 lossless WavPack. Desktop
importen zijn afhankelijk van de beschikbaarheid van de native decoder; MP2 gebruikt de kleinere utiliteit
compatibiliteitstier. Desktop AAC en compatibiliteitsproviders behouden hun
afzonderlijke limieten.

Een actieve taak toont een voortgangsbalk, zelfs wanneer **Weergave → Statusbalk** is verborgen. Kies **Annuleren** naast de balk om een import of audio-export te stoppen.

## Bewerkbare projectbestanden

- Scape (`.sscape` van Soundscaper, `.fscape` van Framescaper, en beide openbaar in beide) is de draagbare, full-fidelity projectindeling die wordt gedeeld door Soundscaper
  en Framescaper.
- AUP4 is audio-only-uitwisseling met Audacity. Het is geen volledige back-up van een
gemengde media Soundscaper-project.

Zie [Projectbestanden](/projects-and-data/project-files/) voor de gevolgen van
iedere keuze.

## Gerenderde leveringen

Audio-exporten maken bestanden die bedoeld zijn voor luisteren, publiceren of verdere
verwerking. Video-exporten maken MP4- of WebM-leveringen. Een gerenderd bestand behoudt
niet de bewerkbare tijdlijn, routing, effecten of projectgeschiedenis.

Raadpleeg de [referentiedelen](/reference/) voor de gegenereerde indeling en
tabellen met productmogelijkheden.
