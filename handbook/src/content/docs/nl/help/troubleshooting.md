---
title: "Problemen oplossen"
description: "Los veelvoorkomende problemen met opnemen, opslag, importeren en exporteren op."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","targetLocale":"nl"} -->

## Een opname-ingang ontbreekt

Controleer de microfoonrechten van het besturingssysteem en de browser en open daarna de apparaatkiezer opnieuw. Zorg bij multitrackopname dat elke gewapende track een beschikbare ingang heeft.

## Een commando is uitgeschakeld

Veel commando's hangen af van de huidige toestand. Selecteer het vereiste project, de track, clip of het tijdbereik en probeer opnieuw. Een functie kan ook opzettelijk tot Soundscaper of Framescaper beperkt zijn.

## Een import gebruikt te veel geheugen

Gecomprimeerde decodering en sommige grote bewerkingen kunnen veel tijdelijk geheugen nodig hebben, ook al wordt projectaudio in brokken opgeslagen. Sluit andere tabbladen of toepassingen, probeer opnieuw met een kleinere bron of gebruik indien passend de desktopversie.

## Een project is uit de browser verdwenen

Controleer of je hetzelfde browserprofiel, dezelfde origin en dezelfde productsite hebt geopend. Soundscaper en Framescaper delen de bibliotheek op dezelfde `soundscaper.org`-origin, maar een ander domein, browserprofiel of gewiste siteopslag heeft een andere bibliotheek.

Als sitegegevens zijn gewist en er geen Scape-projectexport bestaat, heeft de editor geen cloudkopie om te herstellen.

## AUP4 liet een deel van het project weg

Lees het compatibiliteitsrapport. AUP4 bevat compatibele audiobewerkingsstatus maar laat video weg en kan effecten of Soundscaper-specifieke mixstatus converteren of weglaten. Gebruik een Scape-projectbestand — `.sscape` of `.fscape`, die beide in elk product openen — voor volledige projectoverdracht.

## Een export mislukt of speelt niet af

Probeer opnieuw nadat je hebt gecontroleerd of het geselecteerde bereik afspeelbaar materiaal bevat. Controleer bij gecomprimeerde audio of video of de runtime-assets kunnen worden geladen. Test het echte bestand na een geslaagde export in een andere speler.

Gebruik voor onopgeloste problemen **Help → Support** om contact op te nemen met de beheerder en vermeld product, platform, browser of desktopbuild, stappen en de exacte fout.
