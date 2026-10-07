---
title: "Bewerken, mixen en exporteren"
description: "Orden clips, balanceer tracks, pas effecten toe en maak een leveringsbestand."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","targetLocale":"nl"} -->

## Clips ordenen

Selecteer clips of een tijdbereik voordat je een bewerkingscommando kiest. Splitsen maakt bij de afspeelkop een bewerkingsgrens. Varianten die openingen behouden of ripple gebruiken bepalen of later materiaal op zijn plaats blijft of opschuift om de verwijderde regio te sluiten.

Gebruik trackmappen, clipgroepen en de Project Bin om grotere projecten georganiseerd te houden.

### Clipfades aanpassen {#clip-fades}

Selecteer een audioclip om kleine driehoekige handgrepen boven aan de golfvorm te tonen, direct onder de clipkop. Sleep de linkerdriehoek naar binnen voor een fade-in of de rechterdriehoek voor een fade-out. De golfvorm verandert tijdens het slepen en het gebied boven de fadecurve wordt donkerder. De driehoeken volgen de fadegrenzen; sleep er één terug naar de hoek om die fade te verwijderen. Alleen de clip die je sleept verandert, ook wanneer meerdere clips zijn geselecteerd.

De handgrepen verdwijnen wanneer je de clip deselecteert, maar de vervaagde golfvorm en arcering blijven. Deze fades behouden de oorspronkelijke audio en blijven aanpasbaar nadat je het project opslaat en opnieuw opent. Laat los om een fade vast te leggen of druk tijdens het slepen op **Escape** om te annuleren. **Ongedaan maken** keert één volledige sleepactie terug. Afspelen en exporteren gebruiken de vastgelegde fade-instellingen.

Met een geselecteerde clip in focus druk je op **Tab** om de fadehandgrepen te bereiken. Pijltoetsen wijzigen de duur met 10 milliseconden, of met 100 milliseconden met **Shift**. **Home** verwijdert de fade; **End** breidt hem over de clip uit. Kies voor numerieke invoer **Edit → Audio clips → Clip properties** en gebruik **Fading**.

### De bron van een clip bewerken {#clip-source-properties}

Kies **Bewerken → Audioclips → Clip-eigenschappen** om de broneditor te openen. De volledige opname wordt achter de clip weergegeven. Sleep de clipranden om het begin en de duur van de bron te wijzigen terwijl het begin van de clip op de projecttijdlijn gelijk blijft. Het venster **Normaliseren** bevat de clipversterking en acties voor pieken en loudness.

Open **Toonhoogte en tempo** en schakel **Toonhoogte en tempo koppelen** in om snelheid en toonhoogte samen te wijzigen. Een snelheidsverhouding van `1` en een toonhoogteverandering van `0%` laten het geluid onveranderd. Verhouding `2` speelt twee keer zo snel en een octaaf hoger; `0.5` speelt half zo snel en een octaaf lager. Als u een gekoppelde regelaar wijzigt, wordt de andere bijgewerkt. Door de koppeling uit te schakelen wordt de onafhankelijke toonhoogte-instelling hersteld, terwijl de huidige snelheidsverhouding behouden blijft.

**Ctrl+klik** op de golfvorm om een uitrekmarkering toe te voegen die aan dat bronvoorbeeld is gekoppeld. Verslepen wijzigt de timing aan beide kanten; de overlay toont beide afspeelsnelheden. Clipregelaars blijven per clip gelden. Als u bronaudio selecteert en er een effect op toepast, wordt elke clip bijgewerkt die deze bron gebruikt.

### Clips in een spreadsheet bewerken {#clip-spreadsheet}

Kies **Beeld → Panelen → Clip-spreadsheet** om alle clips in het project te zien. Het paneel opent onder de tijdlijn. Via het paneelmenu kunt u het naar een ander dock verplaatsen, laten zweven of sluiten. Grootte en plaatsing worden met de werkruimte opgeslagen. Elke rij toont track, tijdlijnpositie, bronbestand, bronoffset, duur, toonhoogte, snelheid, versterking, fades en afspeelopties. Tijden zijn seconden, toonhoogte is in halve tonen en snelheid is een verhouding: `1` is normaal en `2` is twee keer zo snel.

Dubbelklik op een cel of selecteer die en druk op **Enter** om de waarde te bewerken. Druk op **Enter** om toe te passen of op **Escape** om te annuleren. Track- en broncellen tonen hun echte ID's. Wijzig de track-ID om een clip naar een bestaande audiotrack te verplaatsen. Wijzig de bron-ID of voer een lokaal bestandspad in om de audio te vervangen, met behoud van tijdlijnpositie, duur, snelheid en bronoffset in seconden. Het nieuwe bestand moet het opgegeven bronbereik bevatten. **Omgekeerd** en **Geïnverteerd** zijn selectievakjes; selecteer een cel en druk op **Spatie** om deze om te schakelen. Clips op vergrendelde tracks en videoclips zijn alleen-lezen.

Als u de duur wijzigt, wordt het bronbereik vanaf de huidige offset ingekort of verlengd. Een snelheidswijziging behoudt het bronbereik, tenzij u ook een duur plakt. Hef de groepering of koppeling op voordat u de timing hier wijzigt; bewerk de timing van uitgerekte clips in de broneditor.

Selecteer een cel, sleep over een bereik of gebruik **Shift+klik** op een andere cel om de selectie uit te breiden. Klik op een rijnummer of kolomkop om de hele rij of kolom te selecteren. Gebruik **Ctrl+C** en **Ctrl+V** (**Cmd+C** en **Cmd+V** op macOS) om de selectie met een spreadsheet uit te wisselen. Kolommen worden gescheiden door tabs en rijen door regeleinden. Plakken begint bij de geselecteerde cel en werkt bestaande clips bij. Plakken buiten de bestaande rijen wordt geweigerd. Druk met een selectie op **Escape** of klik in de lege ruimte onder de tabel om de selectie te wissen. Zonder selectie voegt plakken nieuwe rijen in, ook in een leeg project. Afspeelopties worden gekopieerd als `true` of `false` en accepteren deze waarden bij het plakken. Nieuwe rijen volgen de kolomvolgorde van de tabel en hebben een bronbestandsnaam of bron-ID nodig. Een unieke bestaande tracknaam plaatst de clip op die track; een nieuwe naam maakt een audiotrack. Lege tracknamen gebruiken de bronnaam. Lege numerieke cellen gebruiken standaardwaarden: positie en offset `0`, snelheid `1`, toonhoogte en versterking `0`, zonder fades. Een lege duur gebruikt de resterende audio op de gevraagde snelheid.

Het paneel zoekt de bron eerst in het project, ook in de projectprullenbak. Als de bron ontbreekt, kiest u **Gerefereerde bestanden laden** en selecteert u de audiobestanden in het dialoogvenster. Ook bestandspaden op schijf vereisen deze selectie: een pad plakken geeft de app geen toegang tot het bestand. Geselecteerde bestanden moeten ondubbelzinnig overeenkomen met de gerefereerde namen. Het paneel importeert de audio, controleert bronlimieten en clip-eigenschappen en plaatst nieuwe clips op de opgegeven posities. **Ctrl+Z** (**Cmd+Z** op macOS) maakt een volledige plakactie in één stap ongedaan; **Ctrl+Shift+Z** (**Cmd+Shift+Z**) herstelt die. Als een plakactie een ongeldige waarde bevat, blijven de clips ongewijzigd.

## De mix opbouwen

Gebruik trackversterking, panning, dempen en solo om het project te balanceren. Het Mixer-paneel toont dezelfde projectstatus in een mixgerichte indeling. Realtime-effecten blijven aanpasbaar; destructieve of gerenderde bewerkingen maken projectwijzigingen die je zolang de geschiedenis beschikbaar is ongedaan kunt maken.

Gebruik de afspeelmeter en luidheidsanalyse om het resultaat te controleren. Behandel een meterdoel niet als vervanging voor luisteren naar de volledige export.

### Geselecteerde frequenties beluisteren {#listen-to-selected-frequencies}

Selecteer het fragment dat u wilt beluisteren. Kies in het trackmenu **Trackvisualisatie → Spectrogram** en open **Spectrogramopties → Spectraal frequentiebereik selecteren**. Voer de minimale en maximale frequentie in en kies **Bereik selecteren**, of pas de selectiegrepen in het spectrogram aan.

Kies **Afspeelopties → Geselecteerde frequenties afspelen** of **Selecteren → Spectraal → Geselecteerde frequenties afspelen**. Het geselecteerde tijdsbereik wordt eenmaal op normale snelheid afgespeeld, ook als eerder een andere snelheid of herhaald afspelen was gekozen. Het luisterfilter geldt voor de huidige mix, inclusief dempen, solo, versterking en effecten. Een spectrale rechthoek geeft de frequentieband en het tijdsbereik aan, maar zet de track niet op solo. Als er al wordt afgespeeld, pauzeert het commando; kies het opnieuw om de frequentievoorbeluistering te starten.

Realtime-frequentiefilters hebben zachte randen. Frequenties buiten de band worden stiller en dat kan ook gelden voor frequenties dicht bij de grenzen. **Pauzeren** of **Stoppen** verwijdert het filter, zodat de volgende normale afspeelbeurt het volledige frequentiebereik gebruikt. Audio, selecties, ongedaanmaakgeschiedenis en geëxporteerde bestanden blijven ongewijzigd.

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

### Clips exporteren als afzonderlijke bestanden {#export-clips}

Kies **Bestand → Audio exporteren** en stel **Uitvoer** in op **Afzonderlijke clips (splitsen per clip)**. Kies een audioformaat en druk op **Exporteren** om een archief te downloaden met één bestand voor elke audioclip op de audiotracks van het project. Elk bestand begint bij het hoorbare begin van de clip en eindigt aan het hoorbare einde, zonder aanvulling tot de projecttijdlijn of extra effectstaart. Bijsnijdingen, clipversterking, fades en wijzigingen in snelheid en toonhoogte worden meegenomen. Overlappende clips blijven apart.

Bestanden gebruiken de clipnamen met genummerde voorvoegsels. Niet-ondersteunde tekens in bestandsnamen worden vervangen en de nummers onderscheiden dubbele clipnamen. Trackeffecten worden meegenomen; mastereffecten, dempen en solo hebben geen invloed op deze export. Hef bevriezing van bevroren tracks eerst op om de bewerkbare clips afzonderlijk te exporteren.

Gecomprimeerde indelingen gebruiken de FFmpeg-runtime. Exacte indelingen en voorwaardelijke beschikbaarheid staan in de [gegenereerde indelingenreferentie](/reference/).

### Hoofdstuklabels insluiten {#embedded-chapters}

Kies in de browsereditor **Bestand → Audio exporteren**, selecteer **MP3** of **AAC / M4A** en schakel **Labels als hoofdstukken insluiten** in onder **Audioopties**. De optie is standaard uitgeschakeld en voegt labeltitels en -tijden toe aan één gemengd bestand. Voeg labels toe voordat u exporteert; stems, hoofdstuksplitsingen en masteringreeksen bieden deze optie niet.

Alleen labels die het geleverde bereik overlappen worden opgenomen. Bij het exporteren van een selectie worden hoofdstuktijden verschoven naar het begin van het geleverde bestand. MP3 behoudt eindtijden van regiolabels; een puntlabel eindigt bij het volgende hoofdstuk of aan het einde van het bestand. M4A slaat hoofdstukstarts op; elk hoofdstuk loopt door tot de volgende start of het einde van het bestand. M4A ondersteunt maximaal 255 hoofdstukken en 255 UTF-8-bytes per titel. Of een speler ingesloten hoofdstukken weergeeft, hangt van die speler af.

Speel het geëxporteerde bestand in een andere toepassing af voordat je het levert of bronmateriaal verwijdert.
