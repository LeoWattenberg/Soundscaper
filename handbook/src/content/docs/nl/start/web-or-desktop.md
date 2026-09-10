---
title: "Web of desktop"
description: "Begrijp hoe browser- en verpakte desktopuitgaven projecten opslaan en bestanden toegankelijk maken."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","targetLocale":"nl"} -->

Beide edities verwerken projecten lokaal. Hun opslag en bestandstoegang verschillen.

## Webeditor

De browsereditie bewaart projecten, opnames en geïmporteerde media in origin-private browserverslag. Het uploadt geen project naar een Soundscaper-account en er is geen account vereist.

Gebruik de webeditor wanneer u onmiddellijke toegang wilt zonder een app te installeren. Houd er rekening mee dat browserverslag onderhevig is aan browserverbeperkingen en verwijderingsregels. Het wissen van sitedata verwijdert de lokale projectbibliotheek.

## Desktopvoorvertoning

Verpakte desktopvoorvertoningen houden een automatisch opgeslagen lokale bibliotheek binnen de desktopapplicatie. Ze bundelen de editor runtime en uitgebrachte vertalingen voor offline bewerken.

Desktoppakketten zijn niet ondertekend. macOS past alleen de identiteitsvrije advertentie-hoc code aan die zijn loader nodig heeft om Electron en native binaire bestanden uit te voeren; die afdichting maakt geen uitspraak over de uitgever of vertrouwelijkheid. Windows SmartScreen of macOS Gatekeeper kan daarom een waarschuwing voor onbekende ontwikkelaars weergeven voor voorvertoning en stabiele pakketten.

Het openen van een `.aup4`-bestand importeert een onafhankelijk project in de desktopbibliotheek. Later bewerkingen herschrijven niet het bestand dat u hebt geopend. **Opslaan** werkt de bibliotheekkopie bij; **Opslaan als** maakt een nieuw Audacity-uitwisselingsbestand.

## Telefoons en tablets

De webeditor behoudt zijn desktopindeling op elk scherm, maar onder 900px breed (een telefoon of een tablet in verticale stand) vouwt hij het chrome in lades zodat de tijdlijn de ruimte behoudt:

- De **Menu**-knop in de linkerbovenhoek opent een lade met het volledige toepassingsmenu, de projecttabbladen, de actiebalk en de gereedschapbalk. Afspelen, stoppen, opnemen en zoeken blijven in de balk. Het kiezen van een opdracht sluit de lade.
- Trackkoppen schuiven in over de banen vanuit het **Trackkoppen**-handvat in de linkerbovenhoek van de tijdlijn of vanuit **Weergave › Trackkoppen**. Op de banen tikken of Escape drukken zet ze weer weg.
- De inleiding boven de editor is standaard ingeklapt op smalle schermen; **Inleiding weergeven** haalt deze terug.

**Bewerken › Voorkeuren › Uiterlijk › Indeling** schakelt tussen Automatisch, Compact en Desktop, zodat een klein venster op een desktop de desktopchrome kan behouden en een breed tablet kan kiezen voor de lades.

## Projecten bewegen niet automatisch

De browser- en desktopbibliotheken zijn gescheiden. Verplaats een project bewust:

- Gebruik een Scape-projectbestand - `.sscape` van Soundscaper, `.fscape` van Framescaper - voor het volledige project.
- Gebruik AUP4 wanneer u specifiek audio-uitwisseling met Audacity nodig hebt.
- Exporteer gerenderde audio of video als een duurzame afspeelkopie.

Zie [Projectbestanden](/projects-and-data/project-files/) voordat u browservergegevens of desktoptoepassingsgegevens verwijdert.
