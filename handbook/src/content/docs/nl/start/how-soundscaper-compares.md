---
title: "Hoe Soundscaper zich verhoudt"
description: "Vergelijk Soundscaper met Audacity 4 en Adobe Audition op het gebied van opnemen, bewerken, mixen, leveren en uitwisselen."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","targetLocale":"nl"} -->

Soundscaper implementeert Audacity 4 opnieuw op het web en voegt daar een productielayer bovenop toe. Adobe Audition is het commerciële nabewerkingsinstrument waartegen beide meestal worden vergeleken. Deze pagina vergelijkt alle drie, zodat u kunt bepalen welk van de drie al het werk doet dat u heeft.

## Hoe u deze pagina leest

Elke cel bevat **Ja**, **Gedeeltelijk** of **Nee**, gevolgd door het detail dat dit kwalificeert.

**Gedeeltelijk** dekt drie verschillende situaties, en de opmerking geeft aan welke van toepassing is: de functionaliteit bestaat, maar is beperkter dan elders; deze bestaat, maar hangt af van iets dat u moet aanleveren; of deze is alleen bereikbaar door een afwezigheid te omzeilen.

Rijen beschrijven functionaliteiten, geen menucommando's. Voor de exacte inventaris van commando's, zie [Commando's en sneltoetsen](/reference/generated/commands/), en voor wat elk product mogelijk maakt, zie
[Productfunctionaliteiten](/reference/generated/product-capabilities/).

### Waar deze claims vandaan komen

- Rijen voor **Soundscaper** komen uit deze repository: de profielen van productfunctionaliteiten, het manifest van runtime-acties en het register van exportformaten.
  Doel-payloads voor desktop-native doelen worden gegenereerd door repository-CI of doelverpakking. Een pakket activeert dit alleen na het stagen en verifiëren van het exact overeenkomende resultaat; die rijen geven aan wanneer een payload nog steeds vereist is.
- Rijen voor **Audacity 4** komen uit de upstream-inventaris die in deze repository is vastgelegd, `4.0.0` op commit `4c177d43`. Een functionaliteit die upstream registreert maar uitgeschakeld laat of uit het menu commenteert, wordt zo genoteerd, en een functionaliteit zonder registratie in de vastgelegde build wordt gerapporteerd als afwezig in die build, in plaats van als permanent afwezig.
- Rijen voor **Audition** komen uit de gepubliceerde documentatie van Adobe voor de huidige release. Deze zijn niet geverifieerd tegen een draaiende build.

## Platform en termen

| Functionaliteit | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Licentie | Ja — AGPL-3.0-only | Ja — GPL, open source | Nee — proprietair en gesloten |
| Kosten | Ja — gratis | Ja — gratis | Nee — Creative Cloud-abonnement |
| Werkt in een browser | Ja — Chromium, Firefox en WebKit | Nee — alleen desktop | Nee — alleen desktop |
| Desktop-builds | Ja — Windows en Linux op x64 en ARM64, macOS op ARM64 | Ja — Windows, macOS, Linux | Gedeeltelijk — Windows en macOS, geen Linux |
| Werkt zonder account | Ja — er bestaat geen account | Ja — inloggen alleen voor audio.com | Nee — ingelogd abonnement vereist |
| Cloudprojectopslag | Nee — uitgesloten door het local-first-ontwerp | Ja — opslaan en delen via audio.com | Gedeeltelijk — Creative Cloud-bestanden, sessies synchroniseren niet |
| Systeemvereisten | Ja — draait overal waar een actuele browser draait | Gedeeltelijk — aanzienlijk verhoogd ten opzichte van Audacity 3 | Gedeeltelijk — professionele workstation-klasse |

## Project- en sessiemodel

| Mogelijkheid | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Eigen projectformaat | Ja — `.sscape`, een verliesvrij draagbaar archief | Ja — `.aup4` | Ja — `.sesx` |
| Opent Audacity-projecten | Ja — AUP4-import en -export | Ja — eigen formaat | Nee |
| Niet-destructieve clip-tijdlijn | Ja | Ja | Ja — multitrack-editor |
| Toegewijde single-file-editor | Gedeeltelijk — sample-bewerking gebeurt in de tijdlijn | Gedeeltelijk — bewerkingen worden ter plaatse toegepast in de tijdlijn | Ja — golfvorm-editor |
| Mono- en stereomateriaal op één spoor | Ja — een spoor bevat het ene of het andere | Nee — een spoor is mono of stereo | Nee — kanaalformaat is vast per spoor |
| Geneste spoorfolders | Ja — elke diepte, ongedaan te maken, met routing | Nee | Gedeeltelijk — alleen submix-bussen, geen foldersporen |
| Projectmap | Ja — organiseert bestanden en fungeert als klembord | Nee | Gedeeltelijk — het paneel Bestanden toont open bestanden |
| Automatisch opslaan en crashherstel | Ja — automatisch opslaan, vergrendelingen en herstelpakketten | Ja | Ja |
| Markers en benoemde regio's | Ja — eerste klasse, met navigatie en ripple-gedrag | Gedeeltelijk — labelsporen | Ja — markers en bereiken |
| Tempo- en maatsoortkaarten | Ja — geordende kaarten, opgelost met sample-accurate precisie | Gedeeltelijk — één projecttempo en maatsoort | Gedeeltelijk — één sessietempo |

## Opname

| Mogelijkheid | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Multitrack-opname | Ja — meerdere bronnen tegelijk | Gedeeltelijk — één invoerapparaat tegelijk | Ja — multi-invoer- en multikanaalinterfaces |
| Microfoon en desktopaudio tegelijk | Ja — ingebouwd | Nee | Gedeeltelijk — vereist een besturingssysteem-loopbackapparaat |
| Getijde opname | Ja | Ja | Nee |
| Geluidsgestuurde opname | Ja — met instelbare drempelwaarde | Ja — met instelbare drempelwaarde | Nee |
| Telling vóór de take | Ja — tempo-kaartbewust, behandelt samengesteld maatsoort | Gedeeltelijk — lead-in-opname | Gedeeltelijk — pre-roll als onderdeel van punch and roll |
| Punch-opname | Ja — één transactie, standaard- en gerouteerde opname | Nee | Ja — punch and roll |
| Loop-opname naar takes | Ja — één lane per passage, toegevoegd aan dezelfde groep | Nee | Gedeeltelijk — takes op één clip, gekozen uit een lijst |
| Take comping | Ja — beluisteren, promoveren, comp-regio's bewerken, vlakmaken als één ongedaan te maken bewerking | Nee | Nee — geen comp-editor |
| Invoermonitoring en metering | Ja | Ja | Ja |

## Tijdlijn-bewerking

| Mogelijkheid | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Ripple-bewerkingsopties | Ja — per clip, per spoor en alle sporen, bij knippen en verwijderen | Ja — dezelfde drie, bij knippen en verwijderen | Gedeeltelijk — ripple-verwijderen op een selectie of leegte |
| Splitsen, samenvoegen en splitsen op stiltes | Ja | Ja | Gedeeltelijk — splitsen en bijsnijden, geen clip-samenvoegen |
| Clipgroepen | Ja | Ja | Ja |
| Clipvolume | Ja | Ja | Ja |
| Toonhoogte en snelheid per clip | Ja — aanpassen, renderen of resetten | Ja — aanpassen, renderen of resetten | Gedeeltelijk — stretch blijft bewerkbaar, toonhoogte is een effect |
| Tempo-wijzigingen volgen | Ja — clips strekken wanneer de kaart beweegt | Ja | Nee |
| Beat-bewuste kwantisering en groove | Ja — warp-kaarten met instelbare groove-sterkte | Nee | Nee |
| Vastzetten op nulovergangen | Ja | Ja | Ja |
| Tekenen op sample-niveau | Ja | Gedeeltelijk — geen tekenactie geregistreerd in de vastgepinde build | Ja — in de golfvorm-editor |
| Alleen met toetsenbord bewerken | Ja — elke bewerkingsoptie heeft een navigatieactie | Ja — elke bewerkingsoptie heeft een navigatieactie | Gedeeltelijk — uitgebreide sneltoetsen, sommige panelen hebben de muis nodig |

## Spectraal werk en herstel

| Mogelijkheid | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Spectrogramweergave | Ja — met instellingen per spoor | Ja — met instellingen per spoor | Ja — frequentie- en toonhoogte-weergaven |
| Frequentiebegrensde selectie | Ja | Ja | Ja — marquee en lasso |
| Spectrale penseel | Ja | Ja | Ja — penseel en spot healing |
| Spectraal gebied verwijderen of versterken | Ja — beide als directe acties | Ja — beide als directe acties | Gedeeltelijk — effect toepassen op de selectie |
| Korte schade herstellen | Ja — Repair | Ja — Repair | Ja — Auto Heal en Spot Healing Brush |
| Breedbandige ruisreductie | Ja — met een vastgelegd profiel | Ja — met een vastgelegd profiel | Ja — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| De-reverb | Nee | Nee | Ja — DeReverb |
| Gereedschap voor klikken, brommen en sibilantie | Gedeeltelijk — alleen Click Removal | Gedeeltelijk — alleen Click Removal | Ja — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Diagnostiekpaneel | Gedeeltelijk — Find Clipping als analyzer | Gedeeltelijk — Find Clipping als analyzer | Ja — diagnostiek met herstel per probleem |

## Effecten en plug-ins

| Mogelijkheid | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Ingebouwde effectsuite | Ja — de 30 Audacity-effecten, gebundelde Nyquist-plug-ins en first-party-effecten zonder upstream-equivalent, zoals de bitcrusher | Ja — dezelfde ingebouwde collectie van 30 effecten | Ja — ongeveer vijftig, waaronder multiband dynamica |
| Real-time effectrack per track | Ja — een bredere real-time-set dan upstream | Ja | Ja — zestien slots per clip, track en master |
| Parametrische EQ | Ja — een nieuwe parametrische EQ met automatiseerbare bands | Gedeeltelijk — Filter Curve en Graphic EQ | Ja — parametrische, grafische en FFT-filters |
| Effectpresets | Ja — toepassen, opslaan, importeren, exporteren | Ja — toepassen, opslaan, importeren, exporteren | Ja |
| Macro's en batchketens | Ja — opgeslagen macrobibliotheek met sjablonen | Nee — de gepinde build commenteert het Macro's-menu uit | Ja — Favorites en Batch Process |
| Derde-partij plug-informaten | Gedeeltelijk — VST3, CLAP, AU en LV2 op desktop achter toestemming en isolatie, geen in de browser | Ja — VST3, AU, LV2 en Nyquist, met een plug-inbeheerder | Gedeeltelijk — VST3 en AU op macOS, geen CLAP of LV2 |
| Nyquist-scripting | Ja — gebundelde plug-ins en de Nyquist-prompt | Ja — gebundelde plug-ins en de Nyquist-prompt | Nee |
| Gesandboxte effectpakketten | Gedeeltelijk — gecontroleerde WebAssembly-pakketten, één wordt meegeleverd en externe zijn afgezet | Nee | Nee |
| Virtuele instrumenten | Nee — na 1.0 | Nee | Nee |

## Mixing, routing en automatisering

| Mogelijkheid | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mixer met kanaalstrips | Ja | Gedeeltelijk — trackbesturing en een mastertrack | Ja |
| Bussen en submixes | Ja — genest, met cyclusvalidatie | Nee | Ja — bustacks |
| Sends | Ja — pre- en post-fader, meerdere toewijzingen | Nee | Ja — pre- en post-fader |
| VCA-groepen | Ja | Nee | Nee |
| Sidechain-ingang | Ja | Nee | Ja — via sends |
| Cue- en controlroom-mixes | Ja | Nee | Nee |
| Plug-in vertragingcompensatie | Ja — afspelen, monitoring, bussen, sidechains, renderen en bevriezen | Gedeeltelijk — niet blootgesteld in de gepinde bronnen | Ja |
| Automatiseringsbanen | Ja — gain, pan, mute, sends, bussen en plug-inparameters | Nee — geen banen en geen enveloppe-tool in de gepinde build | Ja — volume, pan en effectparameters |
| Automatiseringsmodi | Ja — read, trim, touch, latch en write | Nee | Gedeeltelijk — read, write, latch en touch, geen trim |
| Curvevormen | Ja — lijn, houd en curve | Nee | Ja — lineair en spline |
| Track bevriezen | Ja — bevriezen, ontdooien en commit zonder verlies van staat | Nee | Gedeeltelijk — bounce naar een nieuwe track |

## Metering en analyse

| Mogelijkheid | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Luide meter | Ja — EBU R 128-stijl, met geschiedenis | Nee — een effect voor luidtenormalisatie, maar geen meter | Ja — Loudness Radar conform ITU-R BS.1770 |
| Fase- en correlatiemeter | Ja | Nee | Ja — fasemeter en analyse |
| Surround-meting | Ja | Nee | Gedeeltelijk — tot 5.1 |
| Spectrumplot | Ja — Plot Spectrum | Gedeeltelijk — geregistreerd, maar de vastgepinde build commenteert dit uit in het Analyze-menu | Ja — Frequency Analysis |
| Clipping en RMS in de golfvorm | Ja — beide, per project in/uit te schakelen | Ja — beide, per project in/uit te schakelen | Gedeeltelijk — clip-indicatoren, RMS in Amplitude Statistics |
| Spraakintelligibiliteitscontrast | Ja — Contrast-analyzer | Gedeeltelijk — geregistreerd, maar de vastgepinde build commenteert dit uit in het Analyze-menu | Nee |

## Kanalen en immersive audio

| Mogelijkheid | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Kanalen per bestand | Ja — tot 32 voor PCM-formaten | Gedeeltelijk — mono- en stereosporen | Ja — tot 32 in de golfvormeditor |
| Surround-mixing | Ja — beds tot 7.1.4 | Nee | Gedeeltelijk — tot 5.1 |
| Objectgebaseerde audio | Ja — objecten naast beds | Nee | Nee |
| ADM-authoring en passthrough | Ja — BW64/ADM met conformiteitscontroles | Nee | Nee |
| Binaurale render | Ja — een genummerd binauraal model | Nee | Gedeeltelijk — binauraliser voor ambisonics |
| Ambisonics | Nee | Nee | Ja — eerste orde, met een VR-panner |

## Export en levering

| Mogelijkheid | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Verliesloze output | Ja — WAV, AIFF, BWF en BW64 natief geschreven | Ja — WAV, AIFF en FLAC | Ja — WAV, AIFF, FLAC en meer |
| Verliesbevatte output | Gedeeltelijk — MP3, AAC, Opus, Vorbis, MP2, FLAC en WavPack, allemaal via de FFmpeg-runtime | Gedeeltelijk — MP3 ingebouwd, de rest via een optionele FFmpeg-installatie | Ja — ingebouwd |
| Aangepaste encoderinstellingen | Ja — een aangepast FFmpeg-doel | Ja — een aangepast FFmpeg-doel | Ja — opties per formaat |
| Exportwachtrij | Ja — pauzeren, annuleren, opnieuw proberen en herschikken | Nee — één export tegelijk | Gedeeltelijk — Batch Process zonder wachtrijbeheer |
| Stems en alternatieven in één pass | Ja — samen in de wachtrij met de mix | Nee | Gedeeltelijk — één mixdown per stem |
| Levering per regio | Ja — masteringsequenties met metadata per regio, gaten en fades | Gedeeltelijk — exportlabels, geen multi-bestandsexport in de vastgepinde build | Ja — exportmarkers naar aparte bestanden |
| Luidtenormalisatie bij export | Ja — onderdeel van het leveringsplan | Gedeeltelijk — eerst het effect uitvoeren | Ja — Match Loudness |
| Dither en kanaalmapping | Ja — expliciete besturingen | Gedeeltelijk — dither in voorkeuren | Ja — expliciete besturingen |
| Leveringsrapport | Ja — gedetailleerd per taak | Nee | Nee |
| Renderwachtrij overleeft een herstart | Ja — op desktop, herstarten vanaf byte nul met een crashjournaal | Nee | Nee |

## Uitwisseling met andere tools

| Mogelijkheid | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Audacity-projecten | Ja — AUP4 in en uit, met een rapport over weglatingen | Ja — natief | Nee |
| EDL | Gedeeltelijk — export van CMX3600-niveau, geen import | Nee | Nee |
| OpenTimelineIO | Gedeeltelijk — alleen export | Nee | Nee |
| FCPXML | Gedeeltelijk — alleen export | Nee | Ja — import en export |
| DAWproject | Ja — import en export, met een uitwisselingsrapport | Nee | Nee |
| OMF | Nee | Nee | Gedeeltelijk — import en export |
| Round-trip met een videobewerker | Gedeeltelijk — geeft hetzelfde project door aan Framescaper zonder media te kopiëren | Nee | Ja — Dynamic Link met Premiere Pro |
| Uitwisseling van labels en markeringen | Ja — import en export | Ja — import en export | Ja — lijsten met markeringen |

## Video

| Mogelijkheid | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Video importeren voor referentie | Ja — op de tijdlijn, met gekoppelde audio | Nee | Gedeeltelijk — één videotrack, alleen preview |
| Bewerken van de videotijdlijn | Gedeeltelijk — basisbewerking, het volledige oppervlak is Framescaper | Nee | Nee |
| Video exporteren | Ja — MP4 en WebM via de FFmpeg-runtime | Nee | Nee — alleen audio |
| Compositing, grading en effecten | Gedeeltelijk — in Framescaper, op hetzelfde project | Nee | Nee |

## Machine-ondersteuning

| Mogelijkheid | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Spraakverbetering | Gedeeltelijk — alleen desktop, nadat de modelpayload is geïnstalleerd | Nee | Ja — Enhance Speech |
| Transcriptie en diarisation | Gedeeltelijk — alleen desktop, optionele modellen | Nee | Nee — transcripts bevinden zich in Premiere Pro |
| Bronscheiding in stems | Gedeeltelijk — alleen desktop, optionele modellen | Nee | Nee |
| Automatisch ducking | Ja — Auto Duck-effect | Ja — Auto Duck-effect | Ja — Essential Sound ducking |
| Detectie van beat en shot | Gedeeltelijk — alleen desktop, optionele modellen | Nee | Gedeeltelijk — Remix herbeleidt muziek automatisch |
| Werkt volledig op uw machine | Ja — inferentie is alleen desktop en offline na installatie | Ja — geen inferentie | Gedeeltelijk — sommige functies verwerken in de cloud van Adobe |
| Modellen zijn optioneel en verwijderbaar | Ja — apart gedownload, digest-gepind, verwijderbaar | Ja — niets te installeren | Nee — gebundeld met de applicatie |

## Wat de verschillen betekenen

Audacity 4 is een editor voor een enkele pass. Het heeft geen bussen, geen sends, geen
automatiseringsbanen en geen macros in de vastgepinde build. Soundscaper behoudt dat
bewerkingsmodel en voegt de mix-, automatiserings- en leveringslaag daarboven toe,
plus opname, video en uitwisselingswerk dat Audacity niet probeert.

Audition blijft leiden op het gebied van herstel diepte, round-trips met Premiere Pro en
ambisonics. Waar Soundscaper leidt, is immersive levering, projectbeheer en het feit dat het
in een browser draait op hardware die geen van de anderen ondersteunt.

Als u al werkt in Audacity, zie
[projectbestanden en Audacity-uitwisseling](/projects-and-data/project-files/) voor
hoe u een project overzet.
