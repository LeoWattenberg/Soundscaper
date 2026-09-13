---
title: "Miten Soundscaper vertautuu"
description: "Vertaa Soundscaperia Audacity 4:ään ja Adobe Auditioniin nauhoituksen, muokkauksen, miksaus, toimituksen ja vaihdon osalta."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"703e76cffbe1464f1283f6c8f45cee52c0d37faae852b7efc163879710a2ddb2","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"703e76cffbe1464f1283f6c8f45cee52c0d37faae852b7efc163879710a2ddb2","targetLocale":"fi"} -->

Soundscaper toteuttaa uudelleen Audacity 4:n webissä ja lisää tuotantokerroksen sen päälle. Adobe Audition on kaupallinen jälkikäsittelytyökalu, johon molempia verrataan yleensä. Tämä sivu vertaa kaikkia kolmea, jotta voit päätää, kumpi tekee jo sen työn, jonka tarvitset.

## Miten tämä sivu luetaan

Jokainen solu lukee **Kyllä**, **Osittain** tai **Ei**, jota seuraa yksityiskohta, joka määrittää sen.

**Osittain** kattaa kolme eri tilannetta, ja huomiossa kerrotaan, mikä niistä pätee: ominaisuus on olemassa, mutta se on kapeampi kuin muualla, se on olemassa, mutta riippuu jostakin, jonka sinun on toimitettava, tai se on saavutettavissa vain kiertämällä puuttuvaa osaa.

Rivit kuvaavat ominaisuuksia, ei valikkokomentoja. Tarkkaan komentojen luettelo on kohdassa [Komennot ja pikanäppäimet](/reference/generated/commands/), ja siitä, mitä jokainen tuote mahdollistaa, on tietoa kohdassa
[Tuotteen ominaisuudet](/reference/generated/product-capabilities/).

### Mistä nämä väitteet perustuvat

- **Soundscaper**-rivit perustuvat tähän varastoon: tuotteen ominaisuusprofiilit, ajonaikainen toimintamanifesti ja vientimuodon rekisteri.
  Työpöytäalustalle suunnatut kohdekuormat luodaan varaston CI-järjestelmällä tai kohdepakkaamisella. Paketti ottaa yhden käyttöön vasta sen jälkeen, kun täsmälleen vastaava tulos on valittu ja varmennettu; nämä rivit kertovat, milloin kuorma on edelleen vaadittava.
- **Audacity 4**-rivit perustuvat tähän varastoon kiinnitettyyn ylävirta-inventaarioon, `4.0.0` commitissa `4c177d43`. Ominaisuus, jonka ylävirta rekisteröi mutta jättää poistettuna käytöstä tai kommentoi pois valikosta, kirjataan sellaisenaan, ja ominaisuus, jolla ei ole rekisteröintiä kiinnitettyssä buildissä, raportoidaan puuttuvaksi kyseisessä buildissä eikä pysyvästi puuttuvaksi.
- **Audition**-rivit perustuvat Adoben julkaisemaan dokumentaatioon nykyisestä julkaisusta. Niitä ei ole varmennettu toimivaa buildiä vasten.

## Alusta ja termit

| Ominaisuus | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Lisenssi | Kyllä — AGPL-3.0-only | Kyllä — GPL, avoimen lähdekoodin | Ei — omistettu ja suljettu |
| Hinta | Kyllä — ilmainen | Kyllä — ilmainen | Ei — Creative Cloud -tilaus |
| Toimii selaimessa | Kyllä — Chromium, Firefox ja WebKit | Ei — vain työpöydälle | Ei — vain työpöydälle |
| Työpöytäasennukset | Kyllä — Windows ja Linux x64- ja ARM64-alustoilla, macOS ARM64-alustalla | Kyllä — Windows, macOS, Linux | Osittain — Windows ja macOS, ei Linuxia |
| Toimii ilman tiliä | Kyllä — tiliä ei ole olemassa | Kyllä — kirjautuminen vain audio.com-toiminnon vuoksi | Ei — vaatii kirjautuneen tilauksen |
| Pilvipohjainen projektin tallennus | Ei — paikallispainotteinen suunnittelu sulkee tämän pois | Kyllä — tallennus ja jakaminen audio.com-palvelun kautta | Osittain — Creative Cloud -tiedostot, istunnot eivät synkronoidu |
| Järjestelmävaatimukset | Kyllä — toimii missä tahansa, missä nykyaikainen selain toimii | Osittain — merkittävästi korkeammat kuin Audacity 3:ssa | Osittain — ammattimainen työasemaluokka |

## Projektin ja istunnon malli

| Ominaisuus | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Natiiviprojektitiedosto | Kyllä — `.sscape`, häviötön siirrettävä arkisto | Kyllä — `.aup4` | Kyllä — `.sesx` |
| Avaa Audacity-projektteja | Kyllä — AUP4-tuonti ja -vienti | Kyllä — natiivi | Ei |
| Tuhoamaton leikkauksen aikajana | Kyllä | Kyllä | Kyllä — monikanavainen editor |
| Omistettu yksittäistiedostoeditori | Osittain — näytteiden muokkaus tapahtuu aikajanalla | Osittain — muokkaukset tehdään paikan päällä aikajanalla | Kyllä — aaltomuotoeditori |
| Mono- ja stereosisältö yhdellä raidalla | Kyllä — raita sisältää jomman kumman | Ei — raita on mono tai stereo | Ei — kanavamäärä on kiinteä raidetta kohti |
| Sisäkkäiset raidakansiot | Kyllä — mikä tahansa syvyys, peruutettava, reititys | Ei | Osittain — vain alisekoitussarjat, ei kansioraitoja |
| Projektiarkisto | Kyllä — järjestää tiedostoja ja toimii leikepöydänä | Ei | Osittain — Tiedostopaneeli listaa avoimet tiedostot |
| Automaattitallennus ja palautus kaatumisesta | Kyllä — automaattitallennus, lukot ja palautuskuorit | Kyllä | Kyllä |
| Merkit ja nimetyt alueet | Kyllä — ensiluokkainen, navigointi ja ripple-toiminto | Osittain — etikettiraide | Kyllä — merkit ja välit |
| Tahtitason ja tahtilajin kartat | Kyllä — järjestyksessä olevat kartat, näytetarkat | Osittain — yksi projektin tahtitaso ja tahtilaji | Osittain — yksi istunnon tahtitaso |

## Äänitys

| Ominaisuus | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Monikanavainen nauhoitus | Kyllä — useat lähteet kerralla | Osittain — yksi syöttölaitteella kerrallaan | Kyllä — monisyöttöiset ja monikanavaiset liitännäiset |
| Mikrofonin ja työpöydän ääni yhdessä | Kyllä — sisäänrakennettu | Ei | Osittain — vaatii käyttöjärjestelmän loopback-laitteen |
| Ajastettu nauhoitus | Kyllä | Kyllä | Ei |
| Äänikytkeytetty nauhoitus | Kyllä — säädettävällä kynnysarvolla | Kyllä — säädettävällä kynnysarvolla | Ei |
| Lasku ennen otosta | Kyllä — tempo-kartan tietoinen, käsittelee yhdistettyä tahtia | Osittain — johdatusnauhoitus | Osittain — esikierros osana punch and roll -toimintoa |
| Punch-nauhoitus | Kyllä — yksi toiminto, oletus- ja reititetty tallennus | Ei | Kyllä — punch and roll |
| Loop-nauhoitus ostoille | Kyllä — yksi kaista kierrosta kohti, liitetään samaan ryhmään | Ei | Osittain — ostot yhdelle leikkaukselle, valittu listasta |
| Ostojen komppaus | Kyllä — kuuntelu, edistäminen, komppausalueiden muokkaus, litteäminen yhtenä peruutettavana muokkauksena | Ei | Ei — ei komppauseditoria |
| Syöttövalvonta ja mittaus | Kyllä | Kyllä | Kyllä |

## Aikajanan muokkaus

| Ominaisuus | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Ripple-edit-variantit | Kyllä — leikkauksikohtaisesti, raidakohtaisesti ja kaikille raiteille, leikkauksessa ja poistossa | Kyllä — samat kolme, leikkauksessa ja poistossa | Osittain — ripple-poisto valinnasta tai välistä |
| Jakaminen, yhdistäminen ja jakaminen hiljaisuuksissa | Kyllä | Kyllä | Osittain — jakaminen ja leikkaus, ei leikkauksen yhdistämistä |
| Leikkausryhmät | Kyllä | Kyllä | Kyllä |
| Leikkauksen voimakkuus | Kyllä | Kyllä | Kyllä |
| Leikkauksikohtainen sävelkorkeus ja nopeus | Kyllä — säädä, renderöi tai nollaa | Kyllä — säädä, renderöi tai nollaa | Osittain — venytys pysyy muokattavana, sävelkorkeus on efekti |
| Seuraa tahtimuutoksia | Kyllä — leikkaukset venyvät, kun kartta liikkuu | Kyllä | Ei |
| Tahtitietoinen kvantisointi ja groove | Kyllä — warp-kartat säädettävällä groove-vahvuudella | Ei | Ei |
| Kiinnitys nollaylsäytyksiin | Kyllä | Kyllä | Kyllä |
| Näytetasoisen piirtäminen | Kyllä | Osittain — piirto-toimintoa ei ole rekisteröity kiinnitettyssä versiossa | Kyllä — aaltomuotoeditorissa |
| Pelkkä näppäimistöllä muokkaaminen | Kyllä — jokaisella muokkausprimiitivillä on navigointitoiminto | Kyllä — jokaisella muokkausprimiitivillä on navigointitoiminto | Osittain — laajat pikanäppäimet, jotkin paneelit vaativat hiiren |

## Spektraalinen työ ja palautus

| Ominaisuus | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Spektrograminäkymä | Kyllä — raidakohtaiset asetukset | Kyllä — raidakohtaiset asetukset | Kyllä — taajuus- ja sävelkoruanäkymät |
| Taajuusrajoitettu valinta | Kyllä | Kyllä | Kyllä — valintarektanguli ja lasso |
| Spektraali harja | Kyllä | Kyllä | Kyllä — maaliharja ja pistehojennus |
| Spektraalialueen poisto tai vahvistus | Kyllä — molemmat suorina toimina | Kyllä — molemmat suorina toimina | Osittain — soita efekti valintaan |
| Lyhyen vaurion korjaus | Kyllä — Korjaa | Kyllä — Korjaa | Kyllä — Automaattinen korjaus ja pistehojennusharja |
| Laajakaistan kohinan vähennys | Kyllä — otetulla profiililla | Kyllä — otetulla profiililla | Kyllä — Kohinan vähennys, adaptiivinen kohinan vähennys, DeNoise |
| Kaikuksen poisto | Ei | Ei | Kyllä — DeReverb |
| Klikkaus-, humina- ja sibilanssityökalut | Osittain — vain Klikkauksen poisto | Osittain — vain Klikkauksen poisto | Kyllä — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Diagnostiikkapaneeli | Osittain — Find Clipping analyysorina | Osittain — Find Clipping analyysorina | Kyllä — diagnostiikka ongelma-kohtaisella korjauksella |

## Efektit ja liitännäiset

| Ominaisuus | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Sisäänrakennettu efektivalikoima | Kyllä — 30 Audacity-efektia, mukana toimitettavat Nyquist-liitännäiset ja ensisijaiset efektit, joilla ei ole vastaavaa ylävirtaista versiota, kuten bitcrusher | Kyllä — sama 30-efektinen sisäänrakennettu kokoelma | Kyllä — noin viisikymmentä, mukaan lukien monitaajuusalueinen dynamiikka |
| Reaaliaikainen efektiteline jokaiselle raidalle | Kyllä — laajempi reaaliaikainen valikoima kuin ylävirtaisessa | Kyllä | Kyllä — kuusitoista paikkaa leikettä, raidetta ja masteria kohti |
| Parametrinen EQ | Kyllä — uusi parametrinen EQ automaattisilla taajuusalueilla | Osittain — Filter Curve ja Graphic EQ | Kyllä — parametrinen, graafinen ja FFT-suodatin |
| Efektiesiasetukset | Kyllä — sovellus, tallennus, tuonti, vienti | Kyllä — sovellus, tallennus, tuonti, vienti | Kyllä |
| Makrot ja eräketjut | Kyllä — tallennettu makrokirjasto mallineineen | Ei — kiinnitetty versio kommentoi Macros-valikon pois | Kyllä — Favorites ja Batch Process |
| Kolmannen osapuolen liitännäismuodot | Osittain — VST3, CLAP, AU ja LV2 työpöydällä suostumuksen ja eristämisen takana, ei selaimessa | Kyllä — VST3, AU, LV2 ja Nyquist, liitännäisten hallintatyökalulla | Osittain — VST3 ja AU macOS:lla, ei CLAP:ia tai LV2:ta |
| Nyquist-skriptaus | Kyllä — mukana toimitetut liitännäiset ja Nyquist-prompt | Kyllä — mukana toimitetut liitännäiset ja Nyquist-prompt | Ei |
| Eristetyt efektipaketit | Osittain — tarkastetut WebAssembly-paketit, yksi toimitetaan ja ulkoiset ovat eristettyjä | Ei | Ei |
| Virtuaalisovittimet | Ei — 1.0-version jälkeen | Ei | Ei |

## Sekoitus, reititys ja automaatio

| Ominaisuus | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Sekoitin kanavakaistoilla | Kyllä | Osittain — kappaleohjaimet ja master-kappale | Kyllä |
| Bussit ja alisekoitukset | Kyllä — sisäkkäiset, syklin validoinnilla | Ei | Kyllä — bussikappaleet |
| Lähetysreitit | Kyllä — pre- ja post-fader, useat osoitukset | Ei | Kyllä — pre- ja post-fader |
| VCA-ryhmät | Kyllä | Ei | Ei |
| Sidechain-syöttö | Kyllä | Ei | Kyllä — lähetysreittien kautta |
| Cue- ja ohjaushuoneen sekoitukset | Kyllä | Ei | Ei |
| Liitännäisten viivekorvaus | Kyllä — toisto, monitorointi, bussit, sidechainit, renderöinti ja jäädytys | Osittain — ei paljastettu kiinnitetyissä lähteissä | Kyllä |
| Automaatio-uramat | Kyllä — äänenvoimakkuus, panoraama, mykistys, lähetysreitit, bussit ja liitännäisten parametrit | Ei — ei uramia eikä äänenvoimakkuuskäyrätyökalua kiinnitetyssä versiossa | Kyllä — äänenvoimakkuus, panoraama ja efektien parametrit |
| Automaatiotilat | Kyllä — luku, trimmaus, kosketus, lukitus ja kirjoitus | Ei | Osittain — luku, kirjoitus, lukitus ja kosketus, ei trimmausta |
| Käyrän muodot | Kyllä — viiva, pidätys ja käyrä | Ei | Kyllä — lineaarinen ja spline |
| Kappaleen jäädytys | Kyllä — jäädytä, sulata ja sitoa menettämättä tilaa | Ei | Osittain — bounce uuteen kappaleeseen |

## Mittaus ja analyysi

| Ominaisuus | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Äänenvoimakkuuden mittari | Kyllä — EBU R 128-tyylinen, historian kanssa | Ei — Loudness Normalization -efekti, mutta ei mittaria | Kyllä — Loudness Radar ITU-R BS.1770 -standardin mukaisesti |
| Faasi- ja korrelaatiomittari | Kyllä | Ei | Kyllä — faasimittari ja analyysi |
| Surround-mittaus | Kyllä | Ei | Osittain — enintään 5.1 |
| Spektrikaavio | Kyllä — Plot Spectrum | Osittain — rekisteröity, mutta kiinnitetty build kommentoi sen pois Analyze-valikosta | Kyllä — Frequency Analysis |
| Leikkaus ja RMS aaltomuodossa | Kyllä — molemmat, kytkettävä projekti kerrallaan | Kyllä — molemmat, kytkettävä projekti kerrallaan | Osittain — leikkausindikaattorit, RMS Amplitude Statistics -toiminnossa |
| Puheen ymmärrettävyyden kontrasti | Kyllä — Contrast analyser | Osittain — rekisteröity, mutta kiinnitetty build kommentoi sen pois Analyze-valikosta | Ei |

## Kanavat ja immersioääni

| Ominaisuus | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Kanavat tiedostoa kohti | Kyllä — enintään 32 PCM-muodoissa | Osittain — mono- ja stereokanavat | Kyllä — enintään 32 aaltomuodon muokkajassa |
| Surround-sekoitus | Kyllä — sängyt enintään 7.1.4 | Ei | Osittain — enintään 5.1 |
| Objektipohjainen ääni | Kyllä — objektit sängyjen rinnalla | Ei | Ei |
| ADM-luonti ja läpäisy | Kyllä — BW64/ADM, joidenkin tarkistusten kanssa | Ei | Ei |
| Binaurinen renderöinti | Kyllä — nimetty binaurinen malli | Ei | Osittain — binaurisaaja ambisoniikalle |
| Ambisoniikka | Ei | Ei | Kyllä — ensimmäinen kertaluku, VR-pannerin kanssa |

## Vienti ja toimitus

| Ominaisuus | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Menettämätön tulostus | Kyllä — WAV, AIFF, BWF ja BW64 kirjoitetaan natiivisti | Kyllä — WAV, AIFF ja FLAC | Kyllä — WAV, AIFF, FLAC ja muita |
| Menettävä tulostus | Osittain — MP3, AAC, Opus, Vorbis, MP2, FLAC ja WavPack, kaikki FFmpeg-runtimea käyttäen | Osittain — MP3 sisäänrakennettu, loput valinnaisen FFmpeg-asennuksen kautta | Kyllä — sisäänrakennettu |
| Mukautetut koodausasetukset | Kyllä — mukautettu FFmpeg-kohteena | Kyllä — mukautettu FFmpeg-kohteena | Kyllä — muotoikohtaiset vaihtoehdot |
| Vienti-jono | Kyllä — keskeytä, peruuta, yritä uudelleen ja järjestä uudelleen | Ei — yksi vienti kerrallaan | Osittain — Batch Process ilman jonon hallintaa |
| Stemmat ja vaihtoehdot yhdellä kerralla | Kyllä — jonossa sekoituksen kanssa | Ei | Osittain — yksi mixdown stemmaa kohden |
| Alueittain toimitus | Kyllä — masterointijonot alueittain metatiedoilla, väleillä ja fadeilla | Osittain — vienti-merkinnät, ei monitiedostovientiä kiinnitettyssä versiossa | Kyllä — vientimerkinnät erillisiin tiedostoihin |
| Loudness-normitus viennissä | Kyllä — osa toimitussuunnitelmaa | Osittain — aja efekti ensin | Kyllä — Match Loudness |
| Dither ja kanavakartta | Kyllä — eksplisiittiset ohjaimet | Osittain — dither asetuksissa | Kyllä — eksplisiittiset ohjaimet |
| Toimitusraportti | Kyllä — eriteltynä työtä kohden | Ei | Ei |
| Renderöintijono selviää uudelleenkäynnistyksestä | Kyllä — työpöydällä, uudelleenkäynnistys tavun nollasta kaatopäiväkirjan kanssa | Ei | Ei |

## Vaihto muiden työkalujen kanssa

| Ominaisuus | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Audacity-työt | Kyllä — AUP4 sisään ja ulos, jättämättömyysraportilla | Kyllä — natiivi | Ei |
| EDL | Osittain — CMX3600-luokan vienti, ei tuontia | Ei | Ei |
| OpenTimelineIO | Osittain — vain vienti | Ei | Ei |
| FCPXML | Osittain — vain vienti | Ei | Kyllä — tuonti ja vienti |
| DAWproject | Kyllä — tuonti ja vienti, vaihtoraportilla | Ei | Ei |
| OMF | Ei | Ei | Osittain — tuonti ja vienti |
| Round-trip videoeditorin kanssa | Osittain — antaa saman työn Framescaperille ilman median kopioimista | Ei | Kyllä — Dynamic Link Premiere Pron kanssa |
| Labelien ja markkereiden vaihto | Kyllä — tuonti ja vienti | Kyllä — tuonti ja vienti | Kyllä — markerilistat |

## Video

| Ominaisuus | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Videon tuonti viitteeksi | Kyllä — aikajana-akselilla, linkitettyä ääntä | Ei | Osittain — yksi videotrack, vain esikatselu |
| Videoaikajanan muokkaus | Osittain — perusmuokkaus, koko pinta-ala on Framescaperissa | Ei | Ei |
| Videon vienti | Kyllä — MP4 ja WebM FFmpeg-runtimea käyttäen | Ei | Ei — vain ääni |
| Kompositoiminen, sävytys ja efektit | Osittain — Framescaperissa, samassa työssä | Ei | Ei |

## Machine assistance

| Ominaisuus | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Puheen parannus | Osittain — vain työpöydällä, kun mallipaketti on asennettu | Ei | Kyllä — Enhance Speech |
| Transkriptio ja puhujatunnistus | Osittain — vain työpöydällä, valinnaiset mallit | Ei | Ei — transkriptiot ovat Premiere Prossa |
| Lähdeerottelu stemmeiksi | Osittain — vain työpöydällä, valinnaiset mallit | Ei | Ei |
| Automaattinen hiljennys | Kyllä — Auto Duck -efekti | Kyllä — Auto Duck -efekti | Kyllä — Essential Sound -hiljennys |
| Tahtien ja otosten tunnistus | Osittain — vain työpöydällä, valinnaiset mallit | Ei | Osittain — Remix aikataulua musiikkia automaattisesti |
| Toimii kokonaan omalla koneellasi | Kyllä — päättely tapahtuu vain työpöydällä ja offline-tilassa asennuksen jälkeen | Kyllä — ei päättelyä ollenkaan | Osittain — jotkin ominaisuudet käsitellään Adoben pilvessä |
| Mallit ovat valinnaisia ja poistettavissa | Kyllä — ladattuja erikseen, tiivistelmäkiinnitettyjä, poistettavissa | Kyllä — ei asennettavaa | Ei — sisällytetty sovellukseen |

## Miten erot kumuloituvat

Audacity 4 on yksivaiheinen muokkaja. Siinä ei ole busseja, lähetyskanavia, automaatiojälkiä eikä makroja kiinnitettyssä versiossa. Soundscaper säilyttää tämän muokkausmallin ja lisää sen päälle sekoitus-, automaatio- ja toimituskerroksen sekä nauhoitusta, videoa ja vaihtotyötä, joita Audacity ei yritä tehdä.

Audition on edelleen parempi palautuksen syvyydessä, Premiere Pro -siirtymissä ja ambisoniikassa. Soundscaperin vahvuudet ovat upottava toimitus, projektinhallinta ja se, että se toimii selaimessa laitteistolla, jota kumpikaan muista ei tue.

Jos työskentelet jo Audacityssä, katso
[project files and Audacity interchange](/projects-and-data/project-files/) saadaksesi tietoa projektin siirtämisestä.
