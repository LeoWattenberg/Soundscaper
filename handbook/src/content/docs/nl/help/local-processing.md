---
title: "Lokale verwerking, modellen en plug-ins"
description: "Vind lokale hulp op taak en beheer modellen en plug-ins in de bureaublad-editors."
---
<!-- docs-ai-provenance: {"factPacketSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","targetLocale":"nl"} -->

Lokale assistentie werkt op je apparaat in de Soundscaper en Framescaper desktop
editors. Selecteer media, kies vervolgens de taak uit het menu. Het dialoogvenster toont de
selectie, de taakinstellingen en of de modellen geïnstalleerd zijn.

Desktoppakketten bevatten de native verwerkingsmotoren voor de gepubliceerde lokale
modellen. Installeer de modelgewichten via Modelbeheer, voer vervolgens de taak uit op
die geselecteerde media. Zie de [gids](/reference/local-models/) van elk model voor de
ondersteunde platforms, menu-optie en vereisten.

## Een taak vinden {#find-a-task}

| Menu | Taken |
| --- | --- |
| Effect → Ruis verwijderen en repareren | Dialoog verbeteren, Reverb verminderen, Filler & Stilte opschonen |
| Effect → Bron scheiden | Dialoog / Muziek / Effecten scheiden |
| Analyseren → Spraak | Transcriberen & Ondertiteling, Sprekers identificeren, Reacties markeren |
| Analyseren → Muziek | Beats & Tempo detecteren |
| Analyseren → Video | Snijpunten markeren |
| Effect → Video-effecten | Reframen |
| Bewerken | Hoogtepunten maken |
| Genereren | Redactionele tekst genereren |
| Gereedschappen → Zoeken | Geïndexeerde zoekopdracht, Transcript indexeren, Video indexeren |

Videotaken behoren tot Framescaper. Beschikbare opdrachten zijn afhankelijk van de desktop
runtime en productmogelijkheden. De alfabetische optie voor het effectmenu in Soundscaper sorteert ook lokale verwerkings-effecten op naam.

Kies **Lokaal uitvoeren** om de verwerking te starten en te reageren op de lokale toestemming
prompt. Je kunt de verwerking annuleren. Kies **Resultaat bekijken**, selecteer de
gewenste resultaten en kies **Geselecteerde toepassen**. Geaccepteerde projectwijzigingen kunnen worden ongedaan gemaakt. Het sluiten van een taak past zijn voorstellen niet toe.

**Gereedschappen → Geavanceerde lokale verwerking** behoudt de individuele bewerkings- en model
selectors. Technische details in taakdialoogvensters tonen de onderliggende stappen en exacte
instellingen indien nodig.

## Modellen beheren {#manage-models}

Open **Gereedschappen → Modelbeheer**, of gebruik **Modellen beheren** binnen een taak. De taak
link filtert de lijst naar compatibele modelidentiteiten; **Alle modellen tonen** verwijdert
die beperking. Zoek op naam of taak en filter op installatie-status.

Installeer modellen expliciet. Downloads tonen voortgang en kunnen worden geannuleerd. Terugkeren
naar een taak behoudt zijn instellingen en vernieuwt de modelbeschikbaarheid; het start geen
verwerking. Breid **Opslag en verificatie** uit voor reparatie, opschoning, verplaatsing van
opslag, licentiemeldingen en offline installatie vanuit een map.

Zie de [gidsen voor individuele modellen](/reference/local-models/) voor het doel, menu-optie, downloadgrootte, vereisten, beperkingen en de
reële inferentiecontroles die worden uitgevoerd door het nightly-with-tests desktoppakket.

## Plug-ins en apparaten beheren {#manage-plugins-and-devices}

**Effect → Plug-inbeheer** toont een lijst van audio-plug-ins in Soundscaper en OpenFX-plug-ins
in Framescaper. Zoek of filter de lijst en selecteer een plug-in voor zijn versie,
toestemming en herstelbesturingen. **Scannen & Instellingen** bevat ontdekkingsinstellingen. Beheer blijft toegankelijk wanneer verwerking is uitgeschakeld.

Gebruik audio-plug-ins via **Effect → Audio-plug-ins**. De opdrachten voor het toevoegen/bewerken van video-effecten in Framescaper blijven onder **Effect → Video-effecten**.

Open **Bewerken → Voorkeuren → Audio-instellingen** voor native audio-apparaten en hulpbesturingen. **Media** bevat native media-instellingen; **Effecten** linkt naar Plug-inbeheer en bevat de plug-in-ontdekkingsschakelaar. Plug-in-machtigingen en
quarantaineherstel vereisen nog steeds expliciete acties.
