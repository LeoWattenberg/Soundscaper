---
title: "Muokkaa, sekoita ja vie"
description: "Järjestä klippejä, tasaa raidoja, soita efektit ja luo toimitustiedosto."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"d4b354ffb5d6a4d35fcb20ac6bb1e0191746badd98ca8f5b476a286e068a3c26","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"d4b354ffb5d6a4d35fcb20ac6bb1e0191746badd98ca8f5b476a286e068a3c26","targetLocale":"fi"} -->

## Klipsujen järjestäminen

Valitse klipit tai aikaväli ennen muokkauskomennon valintaa. Split-komento luo
muokkausrajan toiston osoittimen kohdalla. Gap-preserving- ja ripple-variantit
määrittävät, pysyykö myöhemmät materiaali paikallaan vai siirtyykö se sulkemaan
poistettua aluetta.

Käytä raidakansioita, klippiryhmiä ja Project Bin -paneelia pidempien projektien
järjestämiseen.

### Klippien fade-asetusten säätäminen {#clip-fades}

Valitse ääniklippi näyttääksesi pienet kolmiot muotoiset kahvat aaltomuodon
ylälaidassa, suoraan klippin otsikon alla.
Vedä vasenta kolmiota sisäänpäin fade-in-efektin saamiseksi tai oikeaa kolmiota
sisäänpäin fade-out-efektin saamiseksi. Aaltomuoto muuttuu vetäessä, ja fade-käyrän
yläpuolella oleva alue tummuu. Kolmiot seuraavat fade-rajapintoja; kun vedät
kolmion takaisin kulmaan, kyseinen fade poistuu. Vain vedetty klippi muuttuu,
vaikka useita klippejä olisi valittuna.

Kahvat katoavat, kun klippi poistetaan valinnasta, mutta fade-efektillä varustettu
aaltomuoto ja varjostus säilyvät. Nämä fade-efektit säilyttävät alkuperäisen
äänimateriaalin ja ovat säädettävissä myös projektin tallentamisen ja uudelleen
aukaisemisen jälkeen. Vapauta hiiri commitoidaksesi fade-efektin tai paina
**Escape** -näppäintä vetäessä peruuttaaksesi. **Kumoa** -toiminto kumoaa yhden
kokonaisen veto-operaation. Toisto ja vienti käyttävät commitoidut fade-asetukset.

Kun valittu klippi on fokusoitu, paina **Tab** -näppäintä siirtyäksesi sen
fade-kahvoihin. Nuolinäppäimet säätävät kestoa 10 millisekunnin askelin tai
100 millisekunnin askelin **Shift** -näppäimen kanssa. **Home** -näppäin
poistaa fade-efektin; **End** -näppäin laajentaa sen koko klipin yli.
Numeerista syöttöä varten valitse **Muokkaa → Ääniklipit → Klippin ominaisuudet**
ja käytä **Fade** -asetusta.

## Sekoitteen rakentaminen

Käytä raidan vahvistusta, panoraamaa, mykistystä ja solo-ohjaimia projektin
tasapainottamiseen. Mixer-paneeli paljastaa saman projektin tilan
sekoitukseen suunnitellussa asettelussa. Reaaliaikaiset efektit ovat
säädettävissä; tuhoavat tai renderöidyt operaatiot luovat projektin muutoksia,
joita voi kumota, kun historia on käytettävissä.

Käytä toiston mittaria ja loudness-analyysia tuloksen tarkasteluun. Vältä
mittarin tavoitteen käyttämistä korvaan kuuntelemisen korvikkeena täydellisessä
viennissä.

### Sibilaansien vähentäminen {#reduce-sibilance}

Valitse **Efekti → Kohinan poisto ja korjaus → De-esser**. Aseta **Taajuus**
äänen karhean osan lähelle ja laske **Kynnysarvoa**, kunnes sibilaanit pehmenevät.
**Maksimivähennys** rajoittaa leikkausta; aloita noin 6–9 dB:n kohdalta. Lyhyempi
**Attack** -asetus tarttuu konsonantin alkuun, kun taas **Release** -asetus
kontrolloi, kuinka nopeasti korkeat taajuudet palautuvat. Vain ylätaajuusalue
vähennetään.

### Eri taajuusalueiden kompressointi {#multiband-compression}

Valitse **Efekti → Vahvuus ja kompressio → Multiband-kompressori**. Kaksi
risteytystä jakaa signaalin mataliin, keskisiin ja korkeisiin taajuusalueisiin.
Jokaisella alueella on oma kynnysarvonsa, suhteensa ja ulostulovahvistuksensa.
Suhteen ollessa 1 kyseisen alueen dynamiikka ei muutu. Attack- ja release-asetukset
koskevat kaikkia kolmea aluetta. Risteytysten kaltevuudet ovat lempeitä ja
yleensuoria 6 dB/oktaavin kaltevuksia; kun kaikki suhteet ovat 1 ja alueiden
vahvistukset 0 dB, alkuperäinen signaali kulkee läpi muuttumattomana.

Molemmat efektit linkittävät kanavansa stereotaseen säilyttämiseksi, ja ne ovat
myös saatavilla raidan ja master-efektirakkeissa. Rakin asetukset tallennetaan
projektin mukana ja niitä voi säätää toiston aikana. **Sovella valintaan** -toiminto
renderöi efektin valittuun ääneen ja tukee Kumoa -toimintoa. Aikajanan automaatio
eivä ole käytettävissä näille kahdelle efektille.

## Vienti

Valitse **Tiedosto → Vie ääni** sekoitetun toimituksen vientiin tai **Vie valittu
ääni**, kun vain valinta on renderöitävä. Soundscaper voi myös viedä stemit ja
labelit.

Paketoitujen formaattien käyttöön vaaditaan FFmpeg-runtime. Tarkat formaatit ja
ehdollinen saatavuus on lueteltu [generoidussa formaattiviitteessä](/reference/).

Toista viety tiedosto toisessa sovelluksessa ennen toimitusta tai lähtöaineiston
poistamista.

Kuvatyön osalta — sekvenssin koostaminen, videoefektit ja MP4- tai WebM-toimitus —
luovuta projekti [Framescaperille](/framescaper/) ja katso
[videojen vienti](/framescaper/video-export/).
