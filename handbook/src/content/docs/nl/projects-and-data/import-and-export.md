---
title: "Import en export"
description: "Maak onderscheid tussen bronmedia, projectbestanden, uitwisselingsbestanden en gerenderde leveringen."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"nl"} -->

Soundscaper gebruikt verschillende bestandsindelingen voor verschillende taken.

## Bronmedia

Gebruik **Bestand → Importeren** voor audio, video en labels. De huidige editor-hint vermeldt
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF en WebM; aanvullende videobestandsindelingen worden ondersteund via het videopad voor import. Beschikbaarheid kan afhangen van
die actief product en runtime.

Het importeren van media voegt een project-eigendom bron toe. Het maakt het originele bestand
niet uw bewerkbare projectdocument.

Exporteren van gecomprimeerde audio en importeren in de browser ondersteunt tot één uur of 1 GB (1.000.000.000 bestandsbytes), afhankelijk van welke limiet het eerst wordt bereikt. De desktopbestandskeuze en import van gecomprimeerde audio hebben geen vaste limiet voor bestandsgrootte of duur onder het bereik van veilige gehele getallen. Lange taken lezen, coderen en opslaan in delen; grote browserexporten vereisen origin-private bestandsopslag en voldoende vrije ruimte. Grote importen vereisen voldoende lokale opslag voor de gedecodeerde audio. Ook de formaatstructuur, decoderondersteuning en beschikbare opslag kunnen een import beperken.

De browserlaag ondersteunt MP3, MP2, FLAC, WavPack, Opus en Ogg Vorbis. AAC/M4A-ondersteuning in de browser hangt af van de browsercodec. Desktopstreaming-exporten omvatten de zes gebundelde formaten en lossless FLAC van 24 bits en WavPack float32. Desktopimporten zijn afhankelijk van beschikbare decoders; grote MP2-bronnen gebruiken de pakketdecoder, kleinere MP2-bronnen de compatibiliteitslaag van het hulpprogramma.

Een actieve taak toont een voortgangsbalk, zelfs wanneer **Weergave → Statusbalk** is verborgen. Kies **Annuleren** naast de balk om een import of audio-export te stoppen.

## Bewerkbare projectbestanden

- Scape (`.sscape` van Soundscaper, `.fscape` van Framescaper, en beide openbaar in beide) is de draagbare, full-fidelity projectindeling die wordt gedeeld door Soundscaper
  en Framescaper.
- AUP3 en AUP4 maken audio-uitwisseling met Audacity mogelijk. Kies AUP3 voor het projectprofiel van Audacity 3.7.9 of AUP4 voor het huidige uitwisselingsprofiel. Geen van beide is een volledige back-up van een Soundscaper-project met gemengde media; controleer na het exporteren het compatibiliteitsrapport.
- De desktopversie kan Adobe Audition SESX-sessies (`.sesx`) openen om een lokaal project te maken van de audio waarnaar wordt verwezen. Bewaar de oorspronkelijke sessie en media; exporteren naar SESX is niet beschikbaar.

Zie [Projectbestanden](/projects-and-data/project-files/) voor de gevolgen van
iedere keuze.

## Gerenderde leveringen

Audio-exporten maken bestanden die bedoeld zijn voor luisteren, publiceren of verdere
verwerking. Video-exporten maken MP4- of WebM-leveringen. Een gerenderd bestand behoudt
niet de bewerkbare tijdlijn, routing, effecten of projectgeschiedenis.

Raadpleeg de [referentiedelen](/reference/) voor de gegenereerde indeling en
tabellen met productmogelijkheden.
