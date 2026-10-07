---
title: "Soundscaper-vertailu"
description: "Vertaa Soundscaper Webiä ja Desktopia Audacity 4:ään ja Adobe Auditioniin tallennuksessa, muokkauksessa, miksauksessa, viennissä ja tiedonsiirrossa."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"fi"} -->

Soundscaper toteuttaa Audacity 4:n uudelleen verkossa ja lisää siihen tuotantokerroksen. Adobe Audition on kaupallinen jälkituotantotyökalu, johon molempia tavallisesti verrataan. Tällä sivulla verrataan Soundscaper Webiä ja Desktopia, Audacity 4:ää sekä Auditionia, jotta näet, mikä versio jo täyttää tarpeesi.

## Miten tämä sivu luetaan

Kunkin solun alussa on värikoodattu symboli, jota seuraa tarkentava selite:

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — tuettu tai soveltuu
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — rajallinen, alustasta riippuva tai kiertotapaa vaativa
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — ei käytettävissä tai ei sovellu

Lue huomautukset symbolien rinnalla. Valinnaisen liitännäisen, mallin tai koodekin asennus ei yksin rajoita tuettua työpöytäominaisuutta; huomautus kertoo tarvittavan asennuksen. Webillä ja Desktopilla on omat sarakkeensa, joten selainrajoitus ei heikennä Desktopin arviota.

Rivit kuvaavat ominaisuuksia, ei valikkokomentoja. Tarkkaan komentojen luettelo on kohdassa [Komennot ja pikanäppäimet](/reference/generated/commands/), ja siitä, mitä jokainen tuote mahdollistaa, on tietoa kohdassa
[Tuotteen ominaisuudet](/reference/generated/product-capabilities/).

### Mistä nämä väitteet perustuvat

- **Soundscaper**-rivit perustuvat tähän repositorioon: tuotteen toimintoprofiileihin, ajonaikaisten toimintojen manifestiin, vientimuotorekisteriin sekä selaimen ja työpöydän koodekkitukien ehtoihin.
  Repositorion CI tai kohteen pakkaus tuottaa työpöydän natiivien kohteiden hyötykuormat. Paketti ottaa ominaisuuden käyttöön vasta, kun täsmälleen vastaava tulos on valmisteltu ja tarkistettu; riveillä kerrotaan, milloin hyötykuorma tarvitaan vielä.
- **Audacity 4** -rivit pohjautuvat tähän repositorioon lukittuun upstream-luetteloon, versioon `4.0.0` commitissa `4c177d43`, ja sisältävät käyttäjälle näkyvät muutokset viralliseen [`4.0.1`-julkaisuun](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt) commitissa `d82386ce` asti. Upstreamiin rekisteröity mutta käytöstä poistettu tai valikosta kommentoitu ominaisuus merkitään sellaiseksi. Jos ominaisuutta ei ole tarkistetussa luettelossa eikä julkaisutiedoissa, sanomme ettei sitä ole niissä, emme että se puuttuisi pysyvästi. Näytteiden piirtäminen, leikkeen vahvistusvaipat ja vanhojen projektien tuonti kuvataan myös virallisessa [4.0-muutoslokissa](https://www.audacityteam.org/changelog/) ja [leikkeen vahvistuksen oppaassa](https://www.audacityteam.org/manual/clips/clip-gain/).
- **Audition**-rivit perustuvat Adoben julkaisemaan dokumentaatioon nykyisestä julkaisusta. Niitä ei ole varmennettu toimivaa buildiä vasten.

## Alusta ja termit

| Ominaisuus | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Lisenssi | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL, avoimen lähdekoodin | / — omistettu ja suljettu |
| Hinta | + — ilmainen | + — ilmainen | + — ilmainen | / — Creative Cloud -tilaus |
| Toimii selaimessa | + — Chromium, Firefox ja WebKit | / — paketoitu sovellus | / — vain työpöydälle | / — vain työpöydälle |
| Työpöytäasennukset | / — käytä selainversiota | + — Windows ja Linux x64- ja ARM64-alustoilla, macOS ARM64-alustalla | + — Windows (asennusohjelma tai siirrettävä versio), macOS ja Linux | ~ — Windows ja macOS, ei Linuxia |
| Toimii ilman tiliä | + — tiliä ei ole olemassa | + — tiliä ei ole olemassa | + — kirjautuminen vain audio.com-toiminnon vuoksi | / — vaatii kirjautuneen tilauksen |
| Pilvipohjainen projektin tallennus | / — paikallispainotteinen suunnittelu sulkee tämän pois | / — paikallispainotteinen suunnittelu sulkee tämän pois | + — tallennus ja jakaminen audio.com-palvelun kautta | ~ — Creative Cloud -tiedostot, istunnot eivät synkronoidu |
| Järjestelmävaatimukset | + — toimii missä tahansa, missä nykyaikainen selain toimii | + — Windows, Linux tai macOS tuetuilla työpöytäarkkitehtuureilla | ~ — merkittävästi korkeammat kuin Audacity 3:ssa | ~ — ammattimainen työasemaluokka |

## Projektin ja istunnon malli

| Ominaisuus | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Natiiviprojektitiedosto | + — `.sscape`, häviötön siirrettävä arkisto | + — `.sscape`, häviötön siirrettävä arkisto | + — `.aup4` | + — `.sesx` |
| Avaa Audacity-projektteja | + — AUP-, AUP3- ja AUP4-tuonti; AUP3- ja AUP4-vienti | + — AUP-, AUP3- ja AUP4-tuonti; AUP3- ja AUP4-vienti | + — AUP-, AUP3- ja AUP4-tuonti; AUP4-vienti, ei AUP3-vientiä | / |
| Tuhoamaton leikkauksen aikajana | + | + | + | + — monikanavainen editor |
| Omistettu yksittäistiedostoeditori | + — lähdeaaltomuodon muokkain Leikkeen ominaisuuksissa | + — lähdeaaltomuodon muokkain Leikkeen ominaisuuksissa | ~ — muokkaukset tehdään paikan päällä aikajanalla | + — aaltomuotoeditori |
| Mono- ja stereosisältö yhdellä raidalla | + — raita sisältää jomman kumman | + — raita sisältää jomman kumman | / — raita on mono tai stereo | / — kanavamäärä on kiinteä raidetta kohti |
| Sisäkkäiset raidakansiot | + — mikä tahansa syvyys, peruutettava, reititys | + — mikä tahansa syvyys, peruutettava, reititys | / | ~ — vain alisekoitussarjat, ei kansioraitoja |
| Projektiarkisto | + — järjestää tiedostoja ja toimii leikepöydänä | + — järjestää tiedostoja ja toimii leikepöydänä | / | ~ — Tiedostopaneeli listaa avoimet tiedostot |
| Automaattitallennus ja palautus kaatumisesta | + — automaattitallennus, lukot ja palautuskuorit | + — automaattitallennus, lukot ja palautuskuorit | + | + |
| Merkit ja nimetyt alueet | + — ensiluokkainen, navigointi ja ripple-toiminto | + — ensiluokkainen, navigointi ja ripple-toiminto | ~ — etikettiraide | + — merkit ja välit |
| Tahtitason ja tahtilajin kartat | + — järjestyksessä olevat kartat, näytetarkat | + — järjestyksessä olevat kartat, näytetarkat | ~ — yksi projektin tahtitaso ja tahtilaji | ~ — yksi istunnon tahtitaso |

## Äänitys

| Ominaisuus | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Monikanavainen nauhoitus | + — useat lähteet kerralla | + — useat lähteet kerralla | ~ — yksi syöttölaitteella kerrallaan | + — monisyöttöiset ja monikanavaiset liitännäiset |
| Mikrofonin ja työpöydän ääni yhdessä | ~ — sisäänrakennettu, kun selain ja käyttöjärjestelmä tarjoavat näyttöäänen | + — mikrofoni ja Windowsin työpöydän loopback; muissa järjestelmissä käytetään loopback-tuloa | / | ~ — vaatii käyttöjärjestelmän loopback-laitteen |
| Ajastettu nauhoitus | + | + | + | / |
| Äänikytkeytetty nauhoitus | + — säädettävällä kynnysarvolla | + — säädettävällä kynnysarvolla | + — säädettävällä kynnysarvolla | / |
| Lasku ennen otosta | + — tempo-kartan tietoinen, käsittelee yhdistettyä tahtia | + — tempo-kartan tietoinen, käsittelee yhdistettyä tahtia | ~ — johdatusnauhoitus | ~ — esikierros osana punch and roll -toimintoa |
| Punch-nauhoitus | + — yksi toiminto, oletus- ja reititetty tallennus | + — yksi toiminto, oletus- ja reititetty tallennus | / | + — punch and roll |
| Loop-nauhoitus ostoille | + — yksi kaista kierrosta kohti, liitetään samaan ryhmään | + — yksi kaista kierrosta kohti, liitetään samaan ryhmään | / | ~ — ostot yhdelle leikkaukselle, valittu listasta |
| Ostojen komppaus | + — kuuntelu, edistäminen, komppausalueiden muokkaus, litteäminen yhtenä peruutettavana muokkauksena | + — kuuntelu, edistäminen, komppausalueiden muokkaus, litteäminen yhtenä peruutettavana muokkauksena | / | / — ei komppauseditoria |
| Syöttövalvonta ja mittaus | + | + | + | + |

## Aikajanan muokkaus

| Ominaisuus | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Ripple-edit-variantit | + — leikkauksikohtaisesti, raidakohtaisesti ja kaikille raiteille, leikkauksessa ja poistossa | + — leikkauksikohtaisesti, raidakohtaisesti ja kaikille raiteille, leikkauksessa ja poistossa | + — samat kolme, leikkauksessa ja poistossa | ~ — ripple-poisto valinnasta tai välistä |
| Jakaminen, yhdistäminen ja jakaminen hiljaisuuksissa | + | + | + | ~ — jakaminen ja leikkaus, ei leikkauksen yhdistämistä |
| Leikkausryhmät | + | + | + | + |
| Leikkauksen voimakkuus | + | + | + | + |
| Leikkauksikohtainen sävelkorkeus ja nopeus | + — säädä, renderöi tai nollaa | + — säädä, renderöi tai nollaa | + — säädä, renderöi tai nollaa | ~ — venytys pysyy muokattavana, sävelkorkeus on efekti |
| Seuraa tahtimuutoksia | + — leikkaukset venyvät, kun kartta liikkuu | + — leikkaukset venyvät, kun kartta liikkuu | + | / |
| Tahtitietoinen kvantisointi ja groove | + — warp-kartat säädettävällä groove-vahvuudella | + — warp-kartat säädettävällä groove-vahvuudella | / | / |
| Kiinnitys nollaylsäytyksiin | + | + | + | + |
| Näytetasoisen piirtäminen | + | + | + — käytettävissä, kun lähennetään yksittäisiin näytteisiin | + — aaltomuotoeditorissa |
| Pelkkä näppäimistöllä muokkaaminen | + — jokaisella muokkausprimiitivillä on navigointitoiminto | + — jokaisella muokkausprimiitivillä on navigointitoiminto | + — muokkaustoimintoja, aikajanaa ja raitojen pystysuuntaisia viivaimia voi käyttää näppäimistöllä | ~ — laajat pikanäppäimet, jotkin paneelit vaativat hiiren |

## Spektraalinen työ ja palautus

| Ominaisuus | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Spektrograminäkymä | + — raidakohtaiset asetukset | + — raidakohtaiset asetukset | + — raidakohtaiset asetukset | + — taajuus- ja sävelkoruanäkymät |
| Taajuusrajoitettu valinta | + | + | + | + — valintarektanguli ja lasso |
| Spektraali harja | + | + | + | + — maaliharja ja pistehojennus |
| Spektraalialueen poisto tai vahvistus | + — molemmat suorina toimina | + — molemmat suorina toimina | + — molemmat suorina toimina | ~ — soita efekti valintaan |
| Lyhyen vaurion korjaus | + — Korjaa | + — Korjaa | + — Korjaa | + — Automaattinen korjaus ja pistehojennusharja |
| Laajakaistan kohinan vähennys | + — otetulla profiililla | + — otetulla profiililla | + — otetulla profiililla | + — Kohinan vähennys, adaptiivinen kohinan vähennys, DeNoise |
| Kaikuksen poisto | / — avustustoiminnot vain Desktopissa | + — Reduce Reverb, kun valinnainen malli ja moottori on asennettu | / | + — DeReverb |
| Klikkaus-, humina- ja sibilanssityökalut | ~ — napsahdusten poisto ja De-esser; ei erillistä hurinanpoistajaa | ~ — napsahdusten poisto ja De-esser; ei erillistä hurinanpoistajaa | ~ — vain Klikkauksen poisto | + — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Diagnostiikkapaneeli | ~ — Find Clipping analyysorina | ~ — Find Clipping analyysorina | ~ — Find Clipping analyysorina | + — diagnostiikka ongelma-kohtaisella korjauksella |

## Efektit ja liitännäiset

| Ominaisuus | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Sisäänrakennettu efektivalikoima | + — Audacity-pohjaiset tehosteet, mukana toimitettavat Nyquist-liitännäiset ja omat tehosteet, kuten Bitcrusher ja De-esser | + — Audacity-pohjaiset tehosteet, mukana toimitettavat Nyquist-liitännäiset ja omat tehosteet, kuten Bitcrusher ja De-esser | + — 30 sisäänrakennettua tehostetta lukitussa versiossa | + — noin viisikymmentä, mukaan lukien monitaajuusalueinen dynamiikka |
| Reaaliaikainen efektiteline jokaiselle raidalle | + — laajempi reaaliaikainen valikoima kuin ylävirtaisessa | + — laajempi reaaliaikainen valikoima kuin ylävirtaisessa | + | + — kuusitoista paikkaa leikettä, raidetta ja masteria kohti |
| Parametrinen EQ | + — uusi parametrinen EQ automaattisilla taajuusalueilla | + — uusi parametrinen EQ automaattisilla taajuusalueilla | ~ — Filter Curve ja Graphic EQ | + — parametrinen, graafinen ja FFT-suodatin |
| Efektiesiasetukset | + — sovellus, tallennus, tuonti, vienti | + — sovellus, tallennus, tuonti, vienti | + — sovellus, tallennus, tuonti, vienti | + |
| Makrot ja eräketjut | + — tallennettu makrokirjasto mallineineen | + — tallennettu makrokirjasto mallineineen | / — kiinnitetty versio kommentoi Macros-valikon pois | + — Favorites ja Batch Process |
| Kolmannen osapuolen liitännäismuodot | / — natiiviliitännäiset vaativat Desktopin | + — VST3, CLAP, AU, LV2, Linux LADSPA ja Vamp; alustakohtaisia, suostumuksella ja eristyksellä | + — VST3, AU, LV2 ja Nyquist, liitännäisten hallintatyökalulla | ~ — VST3 ja AU macOS:lla, ei CLAP:ia tai LV2:ta |
| Nyquist-skriptaus | + — mukana toimitetut liitännäiset ja Nyquist-prompt | + — mukana toimitetut liitännäiset ja Nyquist-prompt | + — mukana toimitetut liitännäiset ja Nyquist-prompt | / |
| Eristetyt efektipaketit | ~ — tarkastetut WebAssembly-paketit, yksi toimitetaan ja ulkoiset ovat eristettyjä | ~ — tarkastetut WebAssembly-paketit, yksi toimitetaan ja ulkoiset ovat eristettyjä | / | / |
| Virtuaalisovittimet | / | / | / | / |

## Sekoitus, reititys ja automaatio

| Ominaisuus | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Sekoitin kanavakaistoilla | + | + | ~ — kappaleohjaimet ja master-kappale | + |
| Bussit ja alisekoitukset | + — sisäkkäiset, syklin validoinnilla | + — sisäkkäiset, syklin validoinnilla | / | + — bussikappaleet |
| Lähetysreitit | + — pre- ja post-fader, useat osoitukset | + — pre- ja post-fader, useat osoitukset | / | + — pre- ja post-fader |
| VCA-ryhmät | + | + | / | / |
| Sidechain-syöttö | + | + | / | + — lähetysreittien kautta |
| Cue- ja ohjaushuoneen sekoitukset | + | + | / | / |
| Liitännäisten viivekorvaus | + — toisto, monitorointi, bussit, sidechainit, renderöinti ja jäädytys | + — toisto, monitorointi, bussit, sidechainit, renderöinti ja jäädytys | ~ — ei paljastettu kiinnitetyissä lähteissä | + |
| Automaatio-uramat | + — äänenvoimakkuus, panoraama, mykistys, lähetysreitit, bussit ja liitännäisten parametrit | + — äänenvoimakkuus, panoraama, mykistys, lähetysreitit, bussit ja liitännäisten parametrit | ~ — leikkeen vahvistuksen vaipat; ei raita- tai tehosteautomaatioraitoja | + — äänenvoimakkuus, panoraama ja efektien parametrit |
| Automaatiotilat | + — luku, trimmaus, kosketus, lukitus ja kirjoitus | + — luku, trimmaus, kosketus, lukitus ja kirjoitus | / | ~ — luku, kirjoitus, lukitus ja kosketus, ei trimmausta |
| Käyrän muodot | + — viiva, pidätys ja käyrä | + — viiva, pidätys ja käyrä | ~ — vain leikkeen vahvistuksen vaipat | + — lineaarinen ja spline |
| Kappaleen jäädytys | + — jäädytä, sulata ja sitoa menettämättä tilaa | + — jäädytä, sulata ja sitoa menettämättä tilaa | / | ~ — bounce uuteen kappaleeseen |

## Mittaus ja analyysi

| Ominaisuus | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Äänenvoimakkuuden mittari | + — EBU R 128-tyylinen, historian kanssa | + — EBU R 128-tyylinen, historian kanssa | / — Loudness Normalization -efekti, mutta ei mittaria | + — Loudness Radar ITU-R BS.1770 -standardin mukaisesti |
| Faasi- ja korrelaatiomittari | + | + | / | + — faasimittari ja analyysi |
| Surround-mittaus | + | + | / | ~ — enintään 5.1 |
| Spektrikaavio | + — Plot Spectrum | + — Plot Spectrum | ~ — rekisteröity, mutta kiinnitetty build kommentoi sen pois Analyze-valikosta | + — Frequency Analysis |
| Leikkaus ja RMS aaltomuodossa | + — projektikytkimet ja raitakohtaiset RMS-ohitukset | + — projektikytkimet ja raitakohtaiset RMS-ohitukset | + — molemmat, kytkettävä projekti kerrallaan | ~ — leikkausindikaattorit, RMS Amplitude Statistics -toiminnossa |
| Puheen ymmärrettävyyden kontrasti | + — Contrast analyser | + — Contrast analyser | ~ — rekisteröity, mutta kiinnitetty build kommentoi sen pois Analyze-valikosta | / |

Avaa Soundscaperissa raidan **Raidan visualisointi** -valikko ja ota käyttöön tai poista käytöstä **Puoliaalto** tai **Näytä RMS aaltomuodossa**. Oletusnäkymä, 3-kaistaisen jakosuotimen taajuudet ja spektrogrammin asetukset ovat kohdassa **Muokkaa → Asetukset → Raidan visualisointi**.

## Kanavat ja immersioääni

| Ominaisuus | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Kanavat tiedostoa kohti | + — enintään 32 PCM-muodoissa | + — enintään 32 PCM-muodoissa | ~ — mono- ja stereokanavat | + — enintään 32 aaltomuodon muokkajassa |
| Surround-sekoitus | + — sängyt enintään 7.1.4 | + — sängyt enintään 7.1.4 | / | ~ — enintään 5.1 |
| Objektipohjainen ääni | + — objektit sängyjen rinnalla | + — objektit sängyjen rinnalla | / | / |
| ADM-luonti ja läpäisy | + — BW64/ADM, joidenkin tarkistusten kanssa | + — BW64/ADM, joidenkin tarkistusten kanssa | / | / |
| Binaurinen renderöinti | + — nimetty binaurinen malli | + — nimetty binaurinen malli | / | ~ — binaurisaaja ambisoniikalle |
| Ambisoniikka | / | / | / | + — ensimmäinen kertaluku, VR-pannerin kanssa |

## Vienti ja toimitus

| Ominaisuus | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Menettämätön tulostus | + — natiivit WAV, AIFF, BWF ja BW64; FLAC ja WavPack erillisillä koodekeilla | + — natiivit WAV, AIFF, BWF ja BW64; FLAC ja WavPack erillisillä koodekeilla | + — WAV, AIFF ja FLAC | + — WAV, AIFF, FLAC ja muita |
| Menettävä tulostus | ~ — MP3, MP2, Opus ja Ogg Vorbis; AAC riippuu selaimesta | + — MP3, MP2, Opus, Ogg Vorbis ja AAC tuettujen koodekkipalvelujen, myös määritetyn FFmpegin, kautta | + — MP3, Opus ja Ogg Vorbis; lisämuodot valinnaisella FFmpegillä | ~ — MP2, MP3 ja Ogg Vorbis; lisää Adobe Media Encoderin kautta, ei yleistä FFmpeg-kohdetta |
| Mukautetut koodausasetukset | ~ — muotokohtaiset asetukset; mukautettuja FFmpeg-argumentteja ei voi käyttää | ~ — muotokohtaiset asetukset; mukautettuja FFmpeg-argumentteja ei voi käyttää | + — mukautettu FFmpeg-kohteena | + — muotoikohtaiset vaihtoehdot |
| Vienti-jono | + — keskeytä, peruuta, yritä uudelleen ja järjestä uudelleen | + — keskeytä, peruuta, yritä uudelleen ja järjestä uudelleen | / — Export Multiple on yksi peräkkäinen toiminto, ei tehtäväjono | ~ — Batch Process ilman jonon hallintaa |
| Stemmat ja vaihtoehdot yhdellä kerralla | + — jonossa sekoituksen kanssa | + — jonossa sekoituksen kanssa | ~ — Export Multiple kirjoittaa jokaisen raidan erikseen, mutta ei jonota miksausta ja vaihtoehtoisia renderöintejä yhdessä | ~ — yksi mixdown stemmaa kohden |
| Alueittain toimitus | + — masterointijonot alueittain metatiedoilla, väleillä ja fadeilla | + — masterointijonot alueittain metatiedoilla, väleillä ja fadeilla | + — Export Multiple kirjoittaa jokaisen merkityn alueen omaan tiedostoonsa | + — vientimerkinnät erillisiin tiedostoihin |
| Loudness-normitus viennissä | + — osa toimitussuunnitelmaa | + — osa toimitussuunnitelmaa | ~ — aja efekti ensin | + — Match Loudness |
| Dither ja kanavakartta | + — eksplisiittiset ohjaimet | + — eksplisiittiset ohjaimet | ~ — dither asetuksissa | + — eksplisiittiset ohjaimet |
| Toimitusraportti | + — eriteltynä työtä kohden | + — eriteltynä työtä kohden | / | / |
| Renderöintijono selviää uudelleenkäynnistyksestä | / — renderöinnin pysyvä palautus vaatii Desktopin | + — aloittaa uudelleen tavusta nolla kaatumislokin avulla | / | / |

Soundscaper Desktop voi käyttää määritettyä FFmpegiä tuetuissa vientimuodoissaan; nykyisessä editorissa ei voi antaa mielivaltaisia FFmpeg-argumentteja eikä käyttää kaikkia FFmpeg-koodaimia. Rekisteröidyt kohteet ovat [vientimuodoissa](/reference/generated/formats/). Audacityn [vientitoiminto](https://www.audacityteam.org/manual/getting-started/export-your-audio/) lisää muotoja valinnaisella FFmpeg-asennuksella. Audition tarjoaa rajatun tiedostokirjoittimien joukon ja [siirron Adobe Media Encoderiin](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html).

## Vaihto muiden työkalujen kanssa

| Ominaisuus | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Audacity-työt | + — AUP-, AUP3- ja AUP4-tuonti; AUP3- ja AUP4-vienti yhteensopivuusraportin kanssa | + — AUP-, AUP3- ja AUP4-tuonti; AUP3- ja AUP4-vienti yhteensopivuusraportin kanssa | + — AUP-, AUP3- ja AUP4-tuonti; AUP4-vienti, ei AUP3-vientiä | / |
| Audition-istunnot | / — SESX-tuonti vaatii Desktopin | ~ — `.sesx`-äänen tuonti puuteraportin kanssa; ei vientiä | / — lukitussa versiossa ei ole SESX-tuontia | + — natiivi |
| EDL | ~ — CMX3600-luokan vienti, ei tuontia | ~ — CMX3600-luokan vienti, ei tuontia | / | / |
| OpenTimelineIO | ~ — vain vienti | ~ — vain vienti | / | / |
| FCPXML | ~ — vain vienti | ~ — vain vienti | / | + — tuonti ja vienti |
| DAWproject | + — tuonti ja vienti, vaihtoraportilla | + — tuonti ja vienti, vaihtoraportilla | / | / |
| OMF | / | / | / | ~ — tuonti ja vienti |
| Round-trip videoeditorin kanssa | ~ — antaa saman työn Framescaperille ilman median kopioimista | ~ — antaa saman työn Framescaperille ilman median kopioimista | / | + — Dynamic Link Premiere Pron kanssa |
| Labelien ja markkereiden vaihto | + — tuonti ja vienti | + — tuonti ja vienti | + — tuonti ja vienti | + — markerilistat |

Auditionin `.sesx`-tuonnista ja siirtyvistä ääniasetuksista sekä raportin pois jättämistä asioista kerrotaan [Projektitiedostoissa](/projects-and-data/project-files/).

## Video

| Ominaisuus | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Videon tuonti viitteeksi | + — aikajana-akselilla, linkitettyä ääntä | + — aikajana-akselilla, linkitettyä ääntä | / | ~ — yksi videotrack, vain esikatselu |
| Videoaikajanan muokkaus | ~ — perusmuokkaus, koko pinta-ala on Framescaperissa | ~ — perusmuokkaus, koko pinta-ala on Framescaperissa | / | / |
| Videon vienti | ~ — MP4 ja WebM, kun selaimen WebCodecs tukee tarvittavia koodekkeja | + — MP4 ja WebM varmennetulla työpöytäkoodekkipalvelulla | / | / — vain ääni |
| Kompositoiminen, sävytys ja efektit | ~ — Framescaperissa, samassa työssä | ~ — Framescaperissa, samassa työssä | / | / |

## Machine assistance

Työpöytäavustus toimii valinnaisten mallipainojen ja vastaavan natiivimoottorin asennuksen jälkeen; nämä työnkulut eivät ole käytettävissä Webissä. Mallinhallinta asentaa molemmat. Katso käytettävissä olevat työnkulut ja mallit kohdasta [Paikallinen avustus](/reference/generated/local-assistance/).

| Ominaisuus | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Puheen parannus | / — avustustoiminnot vain Desktopissa | + — valinnaisen mallin ja moottorin asennuksen jälkeen | / | + — Enhance Speech |
| Transkriptio ja puhujatunnistus | / — avustustoiminnot vain Desktopissa | + — valinnaisten mallien ja moottorien asennuksen jälkeen | / | / — transkriptiot ovat Premiere Prossa |
| Lähdeerottelu stemmeiksi | / — avustustoiminnot vain Desktopissa | + — valinnaisen mallin ja moottorin asennuksen jälkeen | / | / |
| Automaattinen hiljennys | + — Auto Duck -efekti | + — Auto Duck -efekti | + — Auto Duck -efekti | + — Essential Sound -hiljennys |
| Tahtien ja otosten tunnistus | / — iskuntunnistus vaatii Desktopin; otostunnistus on Framescaperissa | ~ — iskuntunnistus valinnaisella mallilla; otostunnistus Framescaperissa | / | ~ — Remix aikataulua musiikkia automaattisesti |
| Toimii kokonaan omalla koneellasi | + — paikallinen selainkäsittely; ei mallipäättelyä | + — paikallinen käsittely ja offline-päättely mallin asentamisen jälkeen | + — ei päättelyä ollenkaan | ~ — jotkin ominaisuudet käsitellään Adoben pilvessä |
| Mallit ovat valinnaisia ja poistettavissa | / — Webissä ei asenneta malleja | + — ladattuja erikseen, tiivistelmäkiinnitettyjä, poistettavissa | + — ei asennettavaa | / — sisällytetty sovellukseen |

## Miten erot kumuloituvat

Audacity 4 on yhden käsittelykierroksen editori. Lukitussa versiossa ei ole väyliä, lähetyksiä, raitojen tai tehosteiden automaatiouria eikä makroja. Leikkeen vahvistusvaipoilla voi automatisoida äänenvoimakkuutta leikkeen sisällä. Soundscaper säilyttää tämän muokkausmallin ja lisää raita- ja tehosteautomaation, miksauksen ja jakelun sekä tallennus-, video- ja vaihtotoiminnot, joita Audacity ei tarjoa.

Audition on edelleen vahvoilla palautuksen laajuudessa, Premiere Pro -siirroissa ja ambisonisessa äänessä. Soundscaperin vahvuuksia ovat immersiivinen jakelu, projektinhallinta ja toiminta selaimessa laitteistolla, jota kaksi muuta eivät tue.

Jos työskentelet jo Audacityssä, katso [Projektitiedostot ja Audacity-yhteensopivuus](/projects-and-data/project-files/) projektin siirtämistä varten.
