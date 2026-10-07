---
title: "Hoe Soundscaper zich verhoudt"
description: "Vergelijk Soundscaper Web en Desktop met Audacity 4 en Adobe Audition voor opnemen, bewerken, mixen, opleveren en uitwisselen."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"nl"} -->

Soundscaper implementeert Audacity 4 opnieuw op het web en voegt daar een productielaag aan toe. Adobe Audition is het commerciële nabewerkingsprogramma waarmee beide doorgaans worden vergeleken. Op deze pagina worden Soundscaper Web, Soundscaper Desktop, Audacity 4 en Audition naast elkaar gezet, zodat u kunt zien welke editie uw werk al aankan.

## Hoe u deze pagina leest

Elke cel begint met een kleurgecodeerd symbool, gevolgd door een toelichting:

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — wordt ondersteund of is van toepassing
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — beperkt, afhankelijk van het platform of alleen beschikbaar via een omweg
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — niet beschikbaar of niet van toepassing

Lees de toelichtingen samen met de symbolen. Een optionele plug-in, model- of codecinstallatie maakt een ondersteunde desktopfunctie op zichzelf niet beperkt; de toelichting noemt wat u moet installeren. Web en Desktop hebben aparte kolommen, zodat een browserbeperking de beoordeling van Desktop niet verlaagt.

Rijen beschrijven functionaliteiten, geen menucommando's. Voor de exacte inventaris van commando's, zie [Commando's en sneltoetsen](/reference/generated/commands/), en voor wat elk product mogelijk maakt, zie
[Productfunctionaliteiten](/reference/generated/product-capabilities/).

### Waar deze claims vandaan komen

- Rijen voor **Soundscaper** zijn gebaseerd op deze repository: de productfunctieprofielen, het runtime-actiemanifest, het register van exportformaten en de codeccontroles voor browser en desktop.
  Native payloads voor desktopdoelen worden gegenereerd door repository-CI of de doelverpakking. Een pakket schakelt een functie pas in nadat het exact overeenkomende resultaat is klaargezet en geverifieerd; de betreffende rijen vermelden wanneer een payload nog vereist is.
- Rijen voor **Audacity 4** beginnen bij de upstream-inventaris die in deze repository is vastgelegd: `4.0.0` op commit `4c177d43`, aangevuld met zichtbare wijzigingen tot en met de officiële [`4.0.1`-release](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt) op commit `d82386ce`. Een functie die upstream is geregistreerd maar uitgeschakeld is of met commentaar uit het menu is gehaald, wordt als zodanig vermeld. Een functie zonder registratie in de gecontroleerde inventaris of releaseopmerkingen wordt aangemerkt als niet aanwezig in dat materiaal, niet als definitief afwezig. Sampletekenen, clip-volume-enveloppen en het importeren van oude projecten worden ook beschreven in de officiële [4.0-wijzigingslijst](https://www.audacityteam.org/changelog/) en de [handleiding voor clipvolume](https://www.audacityteam.org/manual/clips/clip-gain/).
- Rijen voor **Audition** komen uit de gepubliceerde documentatie van Adobe voor de huidige release. Deze zijn niet geverifieerd tegen een draaiende build.

## Platform en termen

| Functionaliteit | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Licentie | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL, open source | / — proprietair en gesloten |
| Kosten | + — gratis | + — gratis | + — gratis | / — Creative Cloud-abonnement |
| Werkt in een browser | + — Chromium, Firefox en WebKit | / — verpakte toepassing | / — alleen desktop | / — alleen desktop |
| Desktop-builds | / — gebruik de browsereditie | + — Windows en Linux op x64 en ARM64, macOS op ARM64 | + — Windows (installatieprogramma of draagbaar), macOS, Linux | ~ — Windows en macOS, geen Linux |
| Werkt zonder account | + — er bestaat geen account | + — er bestaat geen account | + — inloggen alleen voor audio.com | / — ingelogd abonnement vereist |
| Cloudprojectopslag | / — uitgesloten door het local-first-ontwerp | / — uitgesloten door het local-first-ontwerp | + — opslaan en delen via audio.com | ~ — Creative Cloud-bestanden, sessies synchroniseren niet |
| Systeemvereisten | + — draait overal waar een actuele browser draait | + — Windows, Linux of macOS op de ondersteunde desktoparchitecturen | ~ — aanzienlijk verhoogd ten opzichte van Audacity 3 | ~ — professionele workstation-klasse |

## Project- en sessiemodel

| Mogelijkheid | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Eigen projectformaat | + — `.sscape`, een verliesvrij draagbaar archief | + — `.sscape`, een verliesvrij draagbaar archief | + — `.aup4` | + — `.sesx` |
| Opent Audacity-projecten | + — import van AUP, AUP3 en AUP4; export van AUP3 en AUP4 | + — import van AUP, AUP3 en AUP4; export van AUP3 en AUP4 | + — import van AUP, AUP3 en AUP4; export van AUP4, geen export van AUP3 | / |
| Niet-destructieve clip-tijdlijn | + | + | + | + — multitrack-editor |
| Toegewijde single-file-editor | + — golfvormeditor voor de bron in Clip-eigenschappen | + — golfvormeditor voor de bron in Clip-eigenschappen | ~ — bewerkingen worden ter plaatse toegepast in de tijdlijn | + — golfvorm-editor |
| Mono- en stereomateriaal op één spoor | + — een spoor bevat het ene of het andere | + — een spoor bevat het ene of het andere | / — een spoor is mono of stereo | / — kanaalformaat is vast per spoor |
| Geneste spoorfolders | + — elke diepte, ongedaan te maken, met routing | + — elke diepte, ongedaan te maken, met routing | / | ~ — alleen submix-bussen, geen foldersporen |
| Projectmap | + — organiseert bestanden en fungeert als klembord | + — organiseert bestanden en fungeert als klembord | / | ~ — het paneel Bestanden toont open bestanden |
| Automatisch opslaan en crashherstel | + — automatisch opslaan, vergrendelingen en herstelpakketten | + — automatisch opslaan, vergrendelingen en herstelpakketten | + | + |
| Markers en benoemde regio's | + — eerste klasse, met navigatie en ripple-gedrag | + — eerste klasse, met navigatie en ripple-gedrag | ~ — labelsporen | + — markers en bereiken |
| Tempo- en maatsoortkaarten | + — geordende kaarten, opgelost met sample-accurate precisie | + — geordende kaarten, opgelost met sample-accurate precisie | ~ — één projecttempo en maatsoort | ~ — één sessietempo |

## Opname

| Mogelijkheid | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Multitrack-opname | + — meerdere bronnen tegelijk | + — meerdere bronnen tegelijk | ~ — één invoerapparaat tegelijk | + — multi-invoer- en multikanaalinterfaces |
| Microfoon en desktopaudio tegelijk | ~ — ingebouwd wanneer de browser en het besturingssysteem audio van het scherm beschikbaar maken | + — microfoon plus desktop-loopback op Windows; andere systemen gebruiken een loopbackingang | / | ~ — vereist een besturingssysteem-loopbackapparaat |
| Opname met timer | + | + | + | / |
| Geluidsgestuurde opname | + — met instelbare drempelwaarde | + — met instelbare drempelwaarde | + — met instelbare drempelwaarde | / |
| Telling vóór de take | + — tempo-kaartbewust, behandelt samengesteld maatsoort | + — tempo-kaartbewust, behandelt samengesteld maatsoort | ~ — lead-in-opname | ~ — pre-roll als onderdeel van punch and roll |
| Punch-opname | + — één transactie, standaard- en gerouteerde opname | + — één transactie, standaard- en gerouteerde opname | / | + — punch and roll |
| Loop-opname naar takes | + — één lane per passage, toegevoegd aan dezelfde groep | + — één lane per passage, toegevoegd aan dezelfde groep | / | ~ — takes op één clip, gekozen uit een lijst |
| Take comping | + — beluisteren, promoveren, comp-regio's bewerken, vlakmaken als één ongedaan te maken bewerking | + — beluisteren, promoveren, comp-regio's bewerken, vlakmaken als één ongedaan te maken bewerking | / | / — geen comp-editor |
| Invoermonitoring en metering | + | + | + | + |

## Tijdlijn-bewerking

| Mogelijkheid | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Ripple-bewerkingsopties | + — per clip, per spoor en alle sporen, bij knippen en verwijderen | + — per clip, per spoor en alle sporen, bij knippen en verwijderen | + — dezelfde drie, bij knippen en verwijderen | ~ — ripple-verwijderen op een selectie of leegte |
| Splitsen, samenvoegen en splitsen op stiltes | + | + | + | ~ — splitsen en bijsnijden, geen clip-samenvoegen |
| Clipgroepen | + | + | + | + |
| Clipvolume | + | + | + | + |
| Toonhoogte en snelheid per clip | + — aanpassen, renderen of resetten | + — aanpassen, renderen of resetten | + — aanpassen, renderen of resetten | ~ — stretch blijft bewerkbaar, toonhoogte is een effect |
| Tempo-wijzigingen volgen | + — clips strekken wanneer de kaart beweegt | + — clips strekken wanneer de kaart beweegt | + | / |
| Beat-bewuste kwantisering en groove | + — warp-kaarten met instelbare groove-sterkte | + — warp-kaarten met instelbare groove-sterkte | / | / |
| Vastzetten op nulovergangen | + | + | + | + |
| Tekenen op sample-niveau | + | + | + — beschikbaar wanneer is ingezoomd tot afzonderlijke samples | + — in de golfvorm-editor |
| Alleen met toetsenbord bewerken | + — elke bewerkingsoptie heeft een navigatieactie | + — elke bewerkingsoptie heeft een navigatieactie | + — bewerkingsacties, tijdlijn en verticale spoorlinialen zijn met het toetsenbord te bedienen | ~ — uitgebreide sneltoetsen, sommige panelen hebben de muis nodig |

## Spectraal werk en herstel

| Mogelijkheid | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Spectrogramweergave | + — met instellingen per spoor | + — met instellingen per spoor | + — met instellingen per spoor | + — frequentie- en toonhoogte-weergaven |
| Frequentiebegrensde selectie | + | + | + | + — marquee en lasso |
| Spectrale penseel | + | + | + | + — penseel en spot healing |
| Spectraal gebied verwijderen of versterken | + — beide als directe acties | + — beide als directe acties | + — beide als directe acties | ~ — effect toepassen op de selectie |
| Korte schade herstellen | + — Repair | + — Repair | + — Repair | + — Auto Heal en Spot Healing Brush |
| Breedbandige ruisreductie | + — met een vastgelegd profiel | + — met een vastgelegd profiel | + — met een vastgelegd profiel | + — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| De-reverb | / — alleen desktopondersteuning | + — Reduce Reverb, met optioneel model en engine geïnstalleerd | / | + — DeReverb |
| Gereedschap voor klikken, brommen en sibilantie | ~ — Click Removal en De-esser; geen speciale bromverwijderaar | ~ — Click Removal en De-esser; geen speciale bromverwijderaar | ~ — alleen Click Removal | + — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Diagnostiekpaneel | ~ — Find Clipping als analyzer | ~ — Find Clipping als analyzer | ~ — Find Clipping als analyzer | + — diagnostiek met herstel per probleem |

## Effecten en plug-ins

| Mogelijkheid | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Ingebouwde effectsuite | + — van Audacity afgeleide effecten, meegeleverde Nyquist-plug-ins en eigen effecten zoals Bitcrusher en De-esser | + — van Audacity afgeleide effecten, meegeleverde Nyquist-plug-ins en eigen effecten zoals Bitcrusher en De-esser | + — 30 ingebouwde effecten in de vastgelegde build | + — ongeveer vijftig, waaronder multiband dynamica |
| Real-time effectrack per track | + — een bredere real-time-set dan upstream | + — een bredere real-time-set dan upstream | + | + — zestien slots per clip, track en master |
| Parametrische EQ | + — een nieuwe parametrische EQ met automatiseerbare bands | + — een nieuwe parametrische EQ met automatiseerbare bands | ~ — Filter Curve en Graphic EQ | + — parametrische, grafische en FFT-filters |
| Effectpresets | + — toepassen, opslaan, importeren, exporteren | + — toepassen, opslaan, importeren, exporteren | + — toepassen, opslaan, importeren, exporteren | + |
| Macro's en batchketens | + — opgeslagen macrobibliotheek met sjablonen | + — opgeslagen macrobibliotheek met sjablonen | / — de gepinde build commenteert het Macro's-menu uit | + — Favorites en Batch Process |
| Derde-partij plug-informaten | / — native plug-ins vereisen Desktop | + — VST3, CLAP, AU, LV2, Linux LADSPA en Vamp; afhankelijk van het platform, met toestemming en afscherming | + — VST3, AU, LV2 en Nyquist, met een plug-inbeheerder | ~ — VST3 en AU op macOS, geen CLAP of LV2 |
| Nyquist-scripting | + — gebundelde plug-ins en de Nyquist-prompt | + — gebundelde plug-ins en de Nyquist-prompt | + — gebundelde plug-ins en de Nyquist-prompt | / |
| Gesandboxte effectpakketten | ~ — gecontroleerde WebAssembly-pakketten, één wordt meegeleverd en externe zijn afgezet | ~ — gecontroleerde WebAssembly-pakketten, één wordt meegeleverd en externe zijn afgezet | / | / |
| Virtuele instrumenten | / | / | / | / |

## Mixing, routing en automatisering

| Mogelijkheid | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Mixer met kanaalstrips | + | + | ~ — trackbesturing en een mastertrack | + |
| Bussen en submixes | + — genest, met cyclusvalidatie | + — genest, met cyclusvalidatie | / | + — bustacks |
| Sends | + — pre- en post-fader, meerdere toewijzingen | + — pre- en post-fader, meerdere toewijzingen | / | + — pre- en post-fader |
| VCA-groepen | + | + | / | / |
| Sidechain-ingang | + | + | / | + — via sends |
| Cue- en controlroom-mixes | + | + | / | / |
| Plug-in vertragingcompensatie | + — afspelen, monitoring, bussen, sidechains, renderen en bevriezen | + — afspelen, monitoring, bussen, sidechains, renderen en bevriezen | ~ — niet blootgesteld in de gepinde bronnen | + |
| Automatiseringsbanen | + — gain, pan, mute, sends, bussen en plug-inparameters | + — gain, pan, mute, sends, bussen en plug-inparameters | ~ — clip-volume-enveloppen; geen spoor- of effectbanen | + — volume, pan en effectparameters |
| Automatiseringsmodi | + — read, trim, touch, latch en write | + — read, trim, touch, latch en write | / | ~ — read, write, latch en touch, geen trim |
| Curvevormen | + — lijn, houd en curve | + — lijn, houd en curve | ~ — alleen clip-volume-enveloppen | + — lineair en spline |
| Track bevriezen | + — bevriezen, ontdooien en commit zonder verlies van staat | + — bevriezen, ontdooien en commit zonder verlies van staat | / | ~ — bounce naar een nieuwe track |

## Metering en analyse

| Mogelijkheid | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Luide meter | + — EBU R 128-stijl, met geschiedenis | + — EBU R 128-stijl, met geschiedenis | / — een effect voor luidtenormalisatie, maar geen meter | + — Loudness Radar conform ITU-R BS.1770 |
| Fase- en correlatiemeter | + | + | / | + — fasemeter en analyse |
| Surround-meting | + | + | / | ~ — tot 5.1 |
| Spectrumplot | + — Plot Spectrum | + — Plot Spectrum | ~ — geregistreerd, maar de vastgepinde build commenteert dit uit in het Analyze-menu | + — Frequency Analysis |
| Clipping en RMS in de golfvorm | + — projectinstelling met RMS-uitzonderingen per spoor | + — projectinstelling met RMS-uitzonderingen per spoor | + — beide, per project in/uit te schakelen | ~ — clip-indicatoren, RMS in Amplitude Statistics |
| Spraakintelligibiliteitscontrast | + — Contrast-analyzer | + — Contrast-analyzer | ~ — geregistreerd, maar de vastgepinde build commenteert dit uit in het Analyze-menu | / |

Open in Soundscaper het menu **Track visualization** van een spoor om **Half-wave** of **Show RMS in waveform** in of uit te schakelen. De standaardweergave, crossoverfrequenties voor 3 banden en spectrograminstellingen staan bij **Edit → Preferences → Track display**.

## Kanalen en immersive audio

| Mogelijkheid | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Kanalen per bestand | + — tot 32 voor PCM-formaten | + — tot 32 voor PCM-formaten | ~ — mono- en stereosporen | + — tot 32 in de golfvormeditor |
| Surround-mixing | + — beds tot 7.1.4 | + — beds tot 7.1.4 | / | ~ — tot 5.1 |
| Objectgebaseerde audio | + — objecten naast beds | + — objecten naast beds | / | / |
| ADM-authoring en passthrough | + — BW64/ADM met conformiteitscontroles | + — BW64/ADM met conformiteitscontroles | / | / |
| Binaurale render | + — een genummerd binauraal model | + — een genummerd binauraal model | / | ~ — binauraliser voor ambisonics |
| Ambisonics | / | / | / | + — eerste orde, met een VR-panner |

## Export en levering

| Mogelijkheid | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Verliesloze output | + — native WAV, AIFF, BWF en BW64; FLAC en WavPack via speciale codecs | + — native WAV, AIFF, BWF en BW64; FLAC en WavPack via speciale codecs | + — WAV, AIFF en FLAC | + — WAV, AIFF, FLAC en meer |
| Verliesbevatte output | ~ — MP3, MP2, Opus en Ogg Vorbis; AAC is afhankelijk van de browser | + — MP3, MP2, Opus, Ogg Vorbis en AAC via ondersteunde codecproviders, waaronder geconfigureerde FFmpeg | + — MP3, Opus en Ogg Vorbis; extra formaten via optionele FFmpeg | ~ — MP2, MP3 en Ogg Vorbis; meer via Adobe Media Encoder, geen algemene FFmpeg-doeloptie |
| Aangepaste encoderinstellingen | ~ — instellingen per formaat; aangepaste FFmpeg-argumenten zijn niet beschikbaar | ~ — instellingen per formaat; aangepaste FFmpeg-argumenten zijn niet beschikbaar | + — een aangepast FFmpeg-doel | + — opties per formaat |
| Exportwachtrij | + — pauzeren, annuleren, opnieuw proberen en herschikken | + — pauzeren, annuleren, opnieuw proberen en herschikken | / — Export Multiple is één opeenvolgende bewerking, geen taakwachtrij | ~ — Batch Process zonder wachtrijbeheer |
| Stems en alternatieven in één pass | + — samen in de wachtrij met de mix | + — samen in de wachtrij met de mix | ~ — Export Multiple schrijft elk spoor afzonderlijk, maar plaatst de mix en alternatieve renders niet samen in de wachtrij | ~ — één mixdown per stem |
| Levering per regio | + — masteringsequenties met metadata per regio, gaten en fades | + — masteringsequenties met metadata per regio, gaten en fades | + — Export Multiple schrijft elke benoemde regio naar een eigen bestand | + — exportmarkers naar aparte bestanden |
| Luidtenormalisatie bij export | + — onderdeel van het leveringsplan | + — onderdeel van het leveringsplan | ~ — eerst het effect uitvoeren | + — Match Loudness |
| Dither en kanaalmapping | + — expliciete besturingen | + — expliciete besturingen | ~ — dither in voorkeuren | + — expliciete besturingen |
| Leveringsrapport | + — gedetailleerd per taak | + — gedetailleerd per taak | / | / |
| Renderwachtrij overleeft een herstart | / — blijvend herstel van renders vereist Desktop | + — wordt vanaf byte nul hervat met een crashlogboek | / | / |

Soundscaper Desktop kan geconfigureerde FFmpeg gebruiken voor de ondersteunde exportformaten; de huidige editor biedt geen aangepaste FFmpeg-argumenten of toegang tot elke FFmpeg-encoder. Bekijk [Exportformaten](/reference/generated/formats/) voor de geregistreerde doelen. Audacity voegt via een optionele FFmpeg-installatie formaten toe aan de [exportworkflow](https://www.audacityteam.org/manual/getting-started/export-your-audio/). Audition biedt een vaste reeks bestandsschrijvers en een [overdracht naar Adobe Media Encoder](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html).

## Uitwisseling met andere tools

| Mogelijkheid | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Audacity-projecten | + — AUP, AUP3 en AUP4 als invoer; AUP3 en AUP4 als uitvoer met compatibiliteitsrapport | + — AUP, AUP3 en AUP4 als invoer; AUP3 en AUP4 als uitvoer met compatibiliteitsrapport | + — import van AUP, AUP3 en AUP4; export van AUP4, geen export van AUP3 | / |
| Audition-sessies | / — SESX-import vereist Desktop | ~ — audio-import uit `.sesx` met een rapport over weglatingen; geen export | / — geen SESX-import in de vastgelegde build | + — native |
| EDL | ~ — export van CMX3600-niveau, geen import | ~ — export van CMX3600-niveau, geen import | / | / |
| OpenTimelineIO | ~ — alleen export | ~ — alleen export | / | / |
| FCPXML | ~ — alleen export | ~ — alleen export | / | + — import en export |
| DAWproject | + — import en export, met een uitwisselingsrapport | + — import en export, met een uitwisselingsrapport | / | / |
| OMF | / | / | / | ~ — import en export |
| Round-trip met een videobewerker | ~ — geeft hetzelfde project door aan Framescaper zonder media te kopiëren | ~ — geeft hetzelfde project door aan Framescaper zonder media te kopiëren | / | + — Dynamic Link met Premiere Pro |
| Uitwisseling van labels en markeringen | + — import en export | + — import en export | + — import en export | + — lijsten met markeringen |

Voor import van een Audition-`.sesx`-sessie in Soundscaper leest u bij [Projectbestanden](/projects-and-data/project-files/) welke audio-instellingen worden overgenomen en wat het rapport als weggelaten markeert.

## Video

| Mogelijkheid | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Video importeren voor referentie | + — op de tijdlijn, met gekoppelde audio | + — op de tijdlijn, met gekoppelde audio | / | ~ — één videotrack, alleen preview |
| Bewerken van de videotijdlijn | ~ — basisbewerking, het volledige oppervlak is Framescaper | ~ — basisbewerking, het volledige oppervlak is Framescaper | / | / |
| Video exporteren | ~ — MP4 en WebM wanneer WebCodecs in de browser de vereiste codecs ondersteunt | + — MP4 en WebM met een geverifieerde desktopcodecprovider | / | / — alleen audio |
| Compositing, grading en effecten | ~ — in Framescaper, op hetzelfde project | ~ — in Framescaper, op hetzelfde project | / | / |

## Machine-ondersteuning

Desktopondersteuning is beschikbaar nadat u optionele modelgewichten en een bijpassende native engine hebt geïnstalleerd; deze workflows zijn niet beschikbaar in Web. Model Manager installeert beide. Zie [Lokale ondersteuning](/reference/generated/local-assistance/) voor beschikbare workflows en modellen.

| Mogelijkheid | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Spraakverbetering | / — alleen desktopondersteuning | + — met optioneel model en engine geïnstalleerd | / | + — Enhance Speech |
| Transcriptie en diarisation | / — alleen desktopondersteuning | + — met optionele modellen en engines geïnstalleerd | / | / — transcripts bevinden zich in Premiere Pro |
| Bronscheiding in stems | / — alleen desktopondersteuning | + — met optioneel model en engine geïnstalleerd | / | / |
| Automatisch ducking | + — Auto Duck-effect | + — Auto Duck-effect | + — Auto Duck-effect | + — Essential Sound ducking |
| Detectie van beat en shot | / — beatdetectie vereist Desktop; shotdetectie zit in Framescaper | ~ — beatdetectie met een optioneel model; shotdetectie zit in Framescaper | / | ~ — Remix herbeleidt muziek automatisch |
| Werkt volledig op uw machine | + — lokale verwerking in de browser; geen modelinferentie | + — lokale verwerking en offline inferentie na installatie van modellen | + — geen inferentie | ~ — sommige functies verwerken in de cloud van Adobe |
| Modellen zijn optioneel en verwijderbaar | / — geen modelinstallatie in Web | + — apart gedownload, digest-gepind, verwijderbaar | + — niets te installeren | / — gebundeld met de applicatie |

## Wat de verschillen betekenen

Audacity 4 is een editor die in één doorgang werkt. In de vastgelegde build heeft het geen bussen, sends, automatiseringsbanen voor sporen of effecten en geen macro's. De clip-volume-enveloppen bieden volumeregeling binnen een clip. Soundscaper behoudt dit bewerkingsmodel en voegt daar sporen- en effectautomatisering, mixen en oplevering aan toe, plus opname, video en uitwisseling die Audacity niet probeert te bieden.

Audition blijft leiden op het gebied van herstel diepte, round-trips met Premiere Pro en
ambisonics. Waar Soundscaper leidt, is immersive levering, projectbeheer en het feit dat het
in een browser draait op hardware die geen van de anderen ondersteunt.

Als u al werkt in Audacity, zie
[projectbestanden en Audacity-uitwisseling](/projects-and-data/project-files/) voor
hoe u een project overzet.
