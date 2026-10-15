---
title: "Motionscaper"
description: "Maak geanimeerde composities en bewaar bewerkbare animatieprojecten lokaal."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","targetLocale":"nl"} -->

Motionscaper is de editor voor bewegende vormgeving in de Scaper-familie. Een
project bevat composities, lagen, animatie en bewaarde media. De extensie van
het projectbestand is `.mscape`.

Dit is een ontwikkelversie. Begin met een kopie van belangrijk bronmateriaal
en bewaar geëxporteerde projectarchieven naast uw werkbibliotheek.

## Een compositie beginnen {#start-a-composition}

Kies **Bestand → Nieuwe compositie**. Het menu **Laag** opent gereedschap voor
tekst, vormen, animatie, compositing, tracking, expressies en 3D-scènes.
**Beeld → Compositievoorbeeld** opent afspelen; nieuwe bewerkingsvlakken
verschijnen wanneer u ze uit een menu kiest.

Kies **Beeld → Compositiecanvas** om lagen met statische 2D-transformaties te
selecteren, verplaatsen, schalen of draaien. Geanimeerde transformaties blijven
bewerkbaar via de eigenschappen- en tijdlijngereedschappen.

Selecteer in **Beeld → Tijdlijn** bestaande lagen om ze te hernoemen, in of uit
te schakelen of te verwijderen. Hernoemen behoudt eigenschapsverwijzingen en
animatie. Een laag verwijderen behoudt de oorspronkelijke media; neem de
afhankelijke lagen mee of koppel hun verbindingen eerst los. **Ongedaan maken**
herstelt verwijderde lagen. Een geselecteerde videolaag biedt ook een
audiokeuzevak wanneer de bewaarde bron audio bevat.

Volg [uw eerste Motion-project](/motionscaper/first-project/) om een compositie
te maken, animeren, opslaan en renderen.

## Opslaan en opleveren {#save-and-deliver}

**Bestand → Opslaan** publiceert een opgeslagen revisie. **Kopie opslaan**
exporteert de huidige momentopname als `.mscape`-archief zonder een nieuwe
opgeslagen revisie te publiceren. Geïmporteerde oorspronkelijke media en
lettertypen gaan mee met het archief. De **Projectbibliotheek** opent projecten
die op dit apparaat zijn bewaard.

**Bestand → Renderen** biedt transparante PNG-frames in een TAR-archief,
ondoorzichtige MP4- of WebM-video en ProRes 4444 wanneer de desktopencoder
beschikbaar is. PNG-reeksen bevatten geen audio. Browservideo bewaart de
ingestelde audio wanneer de encoder het gevraagde formaat ondersteunt. Native
ProRes meldt de effectieve kleur- en alfaprecisie in het renderdialoogvenster.
**Bestand → Renderwachtrij** houdt taken beschikbaar na het sluiten van
dialoogvensters en wisselen van project. De wachtrij bewaart maximaal acht taken
en 128 MiB aan browserdownloads; elke download staat maximaal 64 MiB toe.
Kies voor grotere uitvoer een streamingbestand als bestemming en verwijder
voltooide taken om bewaarde downloads vrij te geven. Als opruimen van native
uitvoer mislukt, gebruikt u **Uitvoer opnieuw opruimen** in deze wachtrij.
De taak houdt de bestemming vast tot opruimen slaagt; daarna kunt u de taak
verwijderen of de ingediende revisie met een nieuwe bestemming opnieuw proberen.

## Koppelen aan Framescaper {#link-to-framescaper}

Gekoppelde composities vereisen de aparte Framescaper 1.1-ontwikkellijn.
Maak in het dialoogvenster **Bestand → Gekoppelde composities** een koppel-URL.
Plak die in Motionscapers dialoogvenster **Bestand → Compositie naar Framescaper
verzenden**, maak verbinding en houd de editors en brugvensters open. Latere
**Opslaan**-bewerkingen verzenden automatisch nieuwe revisies; **Kopie opslaan** niet.

Framescaper bewaart elke geaccepteerde revisie en alle bijbehorende media voor
offlinegebruik. Ongedaan maken zet een eerdere revisie vast totdat u updates
hervat. Wijzigingen in uitvoergrootte, timing of audioraster vereisen een
expliciete beoordeling voor aanpassing. De desktopontvanger kan in plaats
daarvan een door u geselecteerd opgeslagen `.mscape`-bestand bewaken.

## Naar desktopupdates zoeken {#check-desktop-updates}

Kies **Help → Naar updates zoeken** in de desktopapp. Deze handmatige controle
zoekt naar compatibele Motionscaper-releases in de GitHub-repository van het
project. Voorlopige versies kunnen nieuwere voorlopige releases ontvangen;
stabiele versies ontvangen stabiele releases. Kies **Release bekijken** om de
geverifieerde releasepagina te openen. De controle downloadt of installeert
geen update. Browserbuilds bevatten deze menuopdracht niet.

## Uitwisseling met After Effects {#after-effects-exchange}

**Bestand → After Effects-brug** biedt leesbare scripts en beoordeelt
ondersteunde uitwisselingsgegevens vóór import. Bestanden met `.aep` en `.aepx`
worden geopend via een geïnstalleerde After Effects en de brugscripts.
De ontwikkelbrug is nog niet gevalideerd met geïnstalleerde After Effects.
Beoordeel het rapport; niet-ondersteunde scène-instellingen en oorspronkelijke
media blijven in het project bewaard.

Het dialoogvenster biedt aparte import- en exportopties voor ondersteunde
scalaire dekkingsexpressies met rekenen, compositietijd, de waarde vóór de
expressie en standaardfuncties van Math. Beide opties staan aanvankelijk uit.
Beoordeel het nieuwe rapport nadat u een optie wijzigt; andere expressievormen
vereisen expliciete bemonstering of renderen. De oorspronkelijke expressiebroncode
blijft in de bewaarde uitwisseling of het archief `original.mscape` behouden.

De renderer ondersteunt SDR-kleur en alfa met 2.5D-lagen, camera’s, lichten,
sluiterbemonstering en scherptediepte. Er wordt geen ondersteuning geclaimd
voor HDR, volledige 3D-meshes, geavanceerde AI-maskering of willekeurige After Effects-plug-ins.
