---
title: "Projectbestanden"
description: "Kies tussen de lokale bibliotheek, Scape-projectbestanden, AUP4 en gerenderde back-ups."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"nl"} -->

## Lokale projectbibliotheek

De editor slaat werkende projecten op in zijn lokale bibliotheek. In een browser is dit origin-private opslag; in de desktopversie is het toepassingsgegevens. Dit is de handige werkkopie, niet de enige kopie die je moet bewaren.

## Scape-projectbestanden

Gebruik **Bestand → Exporteer projectbestand** voor een verliesloze draagbare versie van het project. Elk product schrijft zijn eigen achtervoegsel: Soundscaper slaat `.sscape` op en Framescaper slaat `.fscape` op, en de menu-invoer noemt het toepasselijke achtervoegsel. Het formaat achter beide is hetzelfde, dus het is de juiste keuze wanneer je de gemengde media-bewerkingsstatus moet behouden.

Elk product opent beide achtervoegsels. `.sscape`, `.fscape`, het gereserveerde `.liscape` en de oudere `.scape`-bestanden die zijn geëxporteerd voordat de producten hun eigen achtervoegsels hadden, openen overal, en het opslaan van een bestand van een ander product hernoemt het eenvoudigweg — bijvoorbeeld een `Mix.sscape` die is opgeslagen vanuit Framescaper wordt `Mix.fscape`. Niets aan het project verandert met de naam.

Bij het importeren of openen van een Scape-kopie kan een bestaand project met dezelfde ID worden aangetroffen. Gebruik de aangeboden kopieerwerkstroom wanneer beide versies in de lokale bibliotheek moeten blijven.

## AUP4

AUP4 bestaat voor compatibele audio-uitwisseling met Audacity. Bij het exporteren wordt een compatibiliteitsrapport gegenereerd dat conversies, niet-beschikbare effecten en overgeslagen Soundscaper-specifieke status beschrijft.

AUP4 is alleen audio. Video wordt overgeslagen, en browservoorkeuren, ongedaan-geschiedenis, mixer-routering en de projectbibliotheek van de browser worden niet overgedragen. Gebruik AUP4 niet als de enige back-up van een Soundscaper- of Framescaper-project.

## Gerenderde back-up

Voor belangrijk werk, bewaar beide:

1. Een Scape-projectkopie (`.sscape` of `.fscape`) voor toekomstige bewerkingen.
2. Een gerenderde audio- of videobestand dat zonder de editor kan worden afgespeeld.

Bewaar deze bestanden buiten de browser- of toepassingsgegevensmap.
