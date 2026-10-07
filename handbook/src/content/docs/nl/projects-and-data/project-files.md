---
title: "Projectbestanden"
description: "Kies tussen de lokale bibliotheek, Scape-bestanden, Audacity-uitwisseling, SESX-import en gerenderde back-ups."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","targetLocale":"nl"} -->

## Lokale projectbibliotheek

De editor slaat werkende projecten op in zijn lokale bibliotheek. In een browser is dit origin-private opslag; in de desktopversie is het toepassingsgegevens. Dit is de handige werkkopie, niet de enige kopie die je moet bewaren.

## Scape-projectbestanden

Op desktop blijven geïmporteerde audio en video standaard verwijzingen naar hun oorspronkelijke bestanden. Bewaar die bestanden op hun oorspronkelijke locaties wanneer je het project opnieuw opent. De lokale bibliotheek bewaart ook bewerkingscaches. Opnamen en gemaakte of verwerkte media worden opgenomen omdat ze geen ongewijzigd extern origineel hebben.

Kies **Bestand → Projectbeheer → Media consolideren** om de verwezen media in het projectbestand op te nemen. Consolideren slaat het project meteen op; kies een bestemming in het opslagvenster. Na het opslaan kan de geconsolideerde kopie zonder de oorspronkelijke mediabestanden worden verplaatst of gedeeld. Als media niet kan worden geconsolideerd of het opslaan mislukt, meldt de editor het probleem.

Browserexporten nemen media automatisch op. Consolideer een desktopproject met externe verwijzingen op desktop voordat je het in een browser opent.


Gebruik **Bestand → Exporteer projectbestand** om het bewerkingsproject op te slaan. Elk product schrijft zijn eigen achtervoegsel: Soundscaper slaat `.sscape` op en Framescaper slaat `.fscape` op, en de menu-invoer noemt het toepasselijke achtervoegsel. Het formaat achter beide is hetzelfde, dus het is de juiste keuze wanneer je de gemengde media-bewerkingsstatus moet behouden.

Elk product opent beide achtervoegsels. `.sscape`, `.fscape`, het gereserveerde `.liscape` en de oudere `.scape`-bestanden die zijn geëxporteerd voordat de producten hun eigen achtervoegsels hadden, openen overal, en het opslaan van een bestand van een ander product hernoemt het eenvoudigweg — bijvoorbeeld een `Mix.sscape` die is opgeslagen vanuit Framescaper wordt `Mix.fscape`. Niets aan het project verandert met de naam.

Bij het importeren of openen van een Scape-kopie kan een bestaand project met dezelfde ID worden aangetroffen. Gebruik de aangeboden kopieerwerkstroom wanneer beide versies in de lokale bibliotheek moeten blijven.

## Audacity AUP3 en AUP4

Audacity-projecten exporteren kan via **Bestand → Overige exporteren**. Kies **AUP3 exporteren** voor het projectprofiel van Audacity 3.7.9 of **AUP4 exporteren** voor het huidige uitwisselingsprofiel van Audacity. Elke export maakt een compatibiliteitsrapport met conversies, niet-beschikbare effecten en weggelaten Soundscaper-specifieke status.

Beide indelingen bevatten alleen audio. Video wordt weggelaten en browservoorkeuren, ongedaan-geschiedenis, mixerroutering en de projectbibliotheek van de browser worden niet overgedragen. Gebruik geen van beide als enige back-up van een Soundscaper- of Framescaper-project.

## Adobe Audition SESX

Gebruik in de desktopversie **Bestand → Openen** om een Adobe Audition-sessie `.sesx` te importeren. Bewaar de verwezen audiobestanden in de relatieve mappenstructuur onder de sessiemap, of kies een mediamap wanneer daarom wordt gevraagd. De import maakt een nieuw lokaal project met ondersteunde audiosporen, clips, plaatsing, bijsnijden, eenvoudige fades en statische mixerinstellingen.

SESX-import werkt één kant op. Audition-effecten, automatisering, routering, video, markeringen, loops, uitrekken, gekoppelde crossfades en exacte fadecurves worden niet overgedragen. Open na het importeren **Bestand → Leveringsrapport** om ontbrekende media en andere weggelaten inhoud te bekijken. Bewaar het oorspronkelijke SESX-bestand en de media voor verder werk in Audition.

## Gerenderde back-up

Voor belangrijk werk, bewaar beide:

1. Een Scape-projectkopie (`.sscape` of `.fscape`) voor toekomstige bewerkingen.
2. Een gerenderde audio- of videobestand dat zonder de editor kan worden afgespeeld.

Bewaar deze bestanden buiten de browser- of toepassingsgegevensmap.
