---
title: "Bewerken, mixen en exporteren"
description: "Orden clips, balanceer tracks, pas effecten toe en maak een leveringsbestand."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","targetLocale":"nl"} -->

## Clips ordenen

Selecteer clips of een tijdbereik voordat je een bewerkingscommando kiest. Splitsen maakt bij de afspeelkop een bewerkingsgrens. Varianten die openingen behouden of ripple gebruiken bepalen of later materiaal op zijn plaats blijft of opschuift om de verwijderde regio te sluiten.

Gebruik trackmappen, clipgroepen en de Project Bin om grotere projecten georganiseerd te houden.

### Clipfades aanpassen {#clip-fades}

Selecteer een audioclip om kleine driehoekige handgrepen boven aan de golfvorm te tonen, direct onder de clipkop. Sleep de linkerdriehoek naar binnen voor een fade-in of de rechterdriehoek voor een fade-out. De golfvorm verandert tijdens het slepen en het gebied boven de fadecurve wordt donkerder. De driehoeken volgen de fadegrenzen; sleep er één terug naar de hoek om die fade te verwijderen. Alleen de clip die je sleept verandert, ook wanneer meerdere clips zijn geselecteerd.

De handgrepen verdwijnen wanneer je de clip deselecteert, maar de vervaagde golfvorm en arcering blijven. Deze fades behouden de oorspronkelijke audio en blijven aanpasbaar nadat je het project opslaat en opnieuw opent. Laat los om een fade vast te leggen of druk tijdens het slepen op **Escape** om te annuleren. **Ongedaan maken** keert één volledige sleepactie terug. Afspelen en exporteren gebruiken de vastgelegde fade-instellingen.

Met een geselecteerde clip in focus druk je op **Tab** om de fadehandgrepen te bereiken. Pijltoetsen wijzigen de duur met 10 milliseconden, of met 100 milliseconden met **Shift**. **Home** verwijdert de fade; **End** breidt hem over de clip uit. Kies voor numerieke invoer **Edit → Audio clips → Clip properties** en gebruik **Fading**.

## De mix opbouwen

Gebruik trackversterking, panning, dempen en solo om het project te balanceren. Het Mixer-paneel toont dezelfde projectstatus in een mixgerichte indeling. Realtime-effecten blijven aanpasbaar; destructieve of gerenderde bewerkingen maken projectwijzigingen die je zolang de geschiedenis beschikbaar is ongedaan kunt maken.

Gebruik de afspeelmeter en luidheidsanalyse om het resultaat te controleren. Behandel een meterdoel niet als vervanging voor luisteren naar de volledige export.

### Sibilantie verminderen {#reduce-sibilance}

Kies **Effect → Noise removal and repair → De-esser**. Stel **Frequency** in rond het harde deel van de stem en verlaag **Threshold** tot de s-klanken zachter worden. **Maximum reduction** begrenst de vermindering; begin rond 6–9 dB. Een kortere **Attack** vangt het begin van een medeklinker; **Release** bepaalt hoe snel de hoge frequenties terugkeren. Alleen de bovenste band wordt verminderd.

### Afzonderlijke frequentiebanden comprimeren {#multiband-compression}

Kies **Effect → Volume and compression → Multiband compressor**. De twee crossovers verdelen het signaal in lage, midden- en hoge banden. Elke band heeft een eigen drempel, ratio en uitgangsversterking. Een ratio van 1 laat de dynamiek van die band ongewijzigd. Attack en release gelden voor alle drie banden. De crossovers hebben zachte, overlappende hellingen van 6 dB per octaaf; wanneer alle ratio's 1 en bandversterkingen 0 dB zijn, gaat het oorspronkelijke signaal onveranderd door.

Beide effecten koppelen hun kanalen om de stereobalans te bewaren en zijn ook beschikbaar in track- en master-effectracks. Rackinstellingen worden met het project opgeslagen en kunnen tijdens afspelen worden aangepast. **Apply to selection** rendert het effect in de geselecteerde audio en ondersteunt Ongedaan maken. Tijdlijnautomatisering is voor deze twee effecten niet beschikbaar.

### LADSPA-effecten en Vamp-analysers gebruiken {#native-audio-plugins}

De desktopapp kan plug-ins van derden alleen scannen nadat je een indeling en een van de mappen toestaat in **Effect → Plugin Manager**. Scannen gebeurt nooit automatisch. Sta elke gevonden installatie toe voordat je die gebruikt en installeer alleen plug-ins die je vertrouwt: native plug-ins voeren uitvoerbare code uit, ook al host Soundscaper ze in bewaakte helperprocessen.

LADSPA-effecten zijn beschikbaar op Linux. Open er één via **Effect → Audio Plugins** nadat je die in de manager hebt ingeschakeld. Soundscaper bouwt regelaars uit de LADSPA-poorten omdat deze indeling geen leveranciersinterface heeft. Die regelwaarden en de ingeschakelde of omzeilde toestand van het effect worden met het project opgeslagen.

Vamp-plug-ins analyseren audio in plaats van die te wijzigen. Selecteer na het inschakelen van een Vamp-installatie een audiotrack om die track te analyseren, of selecteer geen audiotrack om de mastermix te analyseren. Een tijdbereik beperkt de analyse; anders gebruikt Soundscaper het volledige project. Kies **Analyze → Vamp Plugins**, selecteer de analyzeruitvoer en instellingen en voer die uit. Soundscaper voegt de teruggegeven tijdstempels pas als nieuwe labeltrack toe nadat de volledige analyse is geslaagd, zodat annuleren of wijzigen van het project geen gedeeltelijke labels achterlaat.

## Exporteren

Kies **File → Export audio** voor een gemixte levering of **Export selected audio** wanneer alleen een selectie moet worden gerenderd. Soundscaper kan ook stems en labels exporteren.

Gecomprimeerde indelingen gebruiken de FFmpeg-runtime. Exacte indelingen en voorwaardelijke beschikbaarheid staan in de [gegenereerde indelingenreferentie](/reference/).

Speel het geëxporteerde bestand in een andere toepassing af voordat je het levert of bronmateriaal verwijdert.

Voor beeldwerk — een reeks samenstellen, video-effecten en een MP4- of WebM-levering — geef je het project aan [Framescaper](/framescaper/) en bekijk je [video exporteren](/framescaper/video-export/).
