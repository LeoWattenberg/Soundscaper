---
title: "Opslag, back-ups en privacy"
description: "Begrijp lokale-eerst opslag en bescherm projecten tegen verlies van browser of apparaat."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"nl"} -->

## Wat lokaal-eerst betekent

Projecten, opnames en geïmporteerde media worden verwerkt en opgeslagen op uw
apparaat. De editor vereist geen account of synchroniseert projecten met een
Soundscaper-service.

Op het web gebruiken audio- en mediabestanden het origin-private bestandsysteem van de browser wanneer
beschikbaar, met IndexedDB als terugvaloptie. Soundscaper vraagt om permanente opslag,
maar de browser beslist of dit wordt toegestaan.

## Wat een project kan verwijderen

- Het wissen van sitegegevens verwijdert de lokale projectbibliotheek van de browser.
- Privé of beperkte browsercontexten kunnen terugvallen op tijdelijk geheugen.
- Browserquota en verwijderingsbeleid blijven autoritatief.
- Handmatig verwijderen van gegevens van de desktoptoepassing verwijdert zijn lokale bibliotheek.
- Een apparaat- of opslagfout kan elke lokale kopie op dat apparaat verwijderen.

Het de-installeren van een verpakte desktopversie is ontworpen om zijn bibliotheek te behouden, maar
dat is geen back-upstrategie.

## Back-uproutine

Op nuttige mijlpalen en voor het wissen of migreren van opslag:

1. Wacht tot het lokale opslaan is voltooid.
2. Exporteer een Scape-projectbestand (`.sscape` of `.fscape`).
3. Exporteer en speel een gerenderde levering af.
4. Kopieer beide naar opslag buiten de lokale gegevens van de editor.

Gebruik AUP4 ook wanneer de Audacity-uitwisseling ertoe doet, niet in plaats van de
kopie van het Scape-project.

## Privacy van de documentatiesite

Dit handboek wordt geserveerd als statische bestanden en gebruikt lokale zoekopdrachten in de browser. De V1
site voegt geen analyse-service of AI/zoekbackend toe.

De volledige [Soundscaper en Framescaper privacybeleid](https://soundscaper.org/privacy/en/)
dekt ook de toepassingslevering, apparaatmachtigingen, optionele downloads,
controle van desktopupdates en Framescaper Web VCR-verbindingen.
