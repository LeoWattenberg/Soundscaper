---
title: "Muokkaa, sekoita ja vie"
description: "Järjestä klippejä, tasaa raidoja, soita efektit ja luo toimitustiedosto."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","targetLocale":"fi"} -->

## Klipsujen järjestäminen

Valitse klipsuja tai aikaväli ennen muokkauskomennon valintaa. Split-komento luo
muokkausrajan toiston osoittimen kohdalla. Gap-preserving- ja ripple-variantit määräävät,
valitaako myöhemmät materiaalit paikoillaan vai liikkuvatko ne sulkeakseen poistettua aluetta.

Käytä kansiokansioita, klipsuryhmiä ja Project Bin -paneelia pidempien projektien
järjestämiseen.

### Klipsujen fade-asetusten säätö {#clip-fades}

Valitse ääniklipsi näyttääksesi pienet kolmiot muotoiset kahvat aaltomuodon yläreunassa,
klipsin otsikon alapuolella.
Vedä vasenta kolmiota sisäänpäin fade-in-efektiksi tai oikeaa kolmiota sisäänpäin
fade-out-efektiksi. Aaltomuoto muuttuu vetäessä, ja fade-käyrän yläpuolelle jäävä alue
muuttuu tummemmaksi. Kolmiot seuraavat fade-rajapintoja; vetäminen kolmiota takaisin
kulmaan poistaa kyseisen faden. Vain vedetty klipsi muuttuu, vaikka useita klipseja
on valittuna.

Kahvat katoavat, kun klipsi poistetaan valinnasta, mutta fade-efektin aaltomuoto ja
varjostus säilyvät. Nämä fade-efektit säilyttävät alkuperäisen äänen ja ovat säädettävissä
myös projektin tallentamisen ja uudelleenauksen jälkeen. Vapauta hiiri commitoidaksesi
faden tai paina **Escape** vetäessä peruuttaaksesi. **Undo** kumoo yhden täydellisen
vedon. Toisto ja vienti käyttävät commitoidut fade-asetukset.

Kun valittu klipsi on fokusoitu, paina **Tab** -näppäintä siirtyäksesi sen fade-kahvoihin.
Nuolinäppäimet säätävät keston 10 millisekunnin askelin tai 100 millisekunnin askelin
**Shift** -näppäimen kanssa. **Home** poistaa faden; **End** laajentaa sen koko klipsin
pituisuudelle. Numeraalista syöttöä varten valitse **Edit → Audio clips → Clip properties**
ja käytä **Fading** -asetusta.

## Sekoitteen rakentaminen

Käytä raidan vahvuutta, panoraamaa, mykistystä ja solo-ohjaimia projektin tasapainottamiseen.
Mixer-paneeli paljastaa saman projektin tilan sekoitukseen suunnitellulla asettelulla.
Reaaliaikaiset efektit ovat säädettävissä; tuhoavat tai renderöidyt operaatiot luovat
projektin muutoksia, jotka voidaan kumota, kun historia on käytettävissä.

Käytä toiston mittaria ja loudness-analyysia tuloksen tarkasteluun. Vältä mittarin
kohdetason käyttämistä kuuntelemisen korvikkeena täydellisessä viennissä.

### Sibilanssin vähentäminen {#reduce-sibilance}

Valitse **Effect → Noise removal and repair → De-esser**. Aseta **Frequency** -arvo
äänen karhean osan lähelle ja laske **Threshold** -arvoa, kunnes sibilanssit pehmenevät.
**Maximum reduction** rajoittaa leikkausta; aloita noin 6–9 dB:n kohdalta. Lyhyempi
**Attack** -asetus kiinnittää konsonantin alun, kun taas **Release** -asetus ohjaa, kuinka
nopeasti korkeat taajuudet palautuvat. Vain ylätaajuusalue vähenee.

### Eri taajuusalueiden kompressointi {#multiband-compression}

Valitse **Effect → Volume and compression → Multiband compressor**. Kaksi ristiota jakaa
signaalin mataliin, keskisiin ja korkeisiin taajuusalueisiin. Jokaisella alueella on oma
kynnysarvo, suhde ja ulostulovahvuus. Suhde 1 jättää kyseisen alueen dynamiikan
muuttumattomaksi. Attack- ja release-asetukset koskevat kaikkia kolmea aluetta. Ristojen
kulmat ovat lempeitä ja päällekkäisiä 6 dB/oktaavin kaltevuudella; kun kaikki suhteet ovat
1 ja alueiden vahvuudet 0 dB, alkuperäinen signaali kulkee läpi muuttumattomana.

Molemmat efektit linkittävät kanavansa stereotaseen säilyttämiseksi ja ovat myös
käytettävissä raidan ja master-efektirakenteissa. Rakenteen asetukset tallennetaan
projektin mukana ja niitä voidaan säätää toiston aikana. **Apply to selection** -toiminto
renderöi efektin valittuun ääneen ja tukee Undo-toimintoa. Aikajanan automaatio ei ole
käytettävissä näille kahdelle efektille.

### LADSPA-efektien ja Vamp-analysaattoreiden käyttö {#native-audio-plugins}

Työpöytäsovellus voi skannata kolmannen osapuolen liitännäiset vasta sen jälkeen, kun olet
sallinut muodon ja sen kansioista yhden **Effect → Plugin Manager** -valikossa. Skannaus
eikä koskaan automaattista. Salli jokainen havaittu asennus ennen käyttöä ja asenna vain
liitännäisiä, joita luotat: natiivit liitännäiset suorittavat suorituskykykoodia, vaikka
Soundscaper isännöisi niitä valvotuissa apuprosesseissa.

LADSPA-efektit ovat käytettävissä Linuxissa. Avaa yksi **Effect → Audio Plugins** -valikosta
sen jälkeen, kun olet ottanut sen käyttöön hallitsijassa. Soundscaper rakentaa ohjaimet
LADSPA-porteista, koska tällä muodolla ei ole valmistajan käyttöliittymää. Nämä ohjaimen
arvot ja efektin käytössä tai ohitettuna oleva tila tallennetaan projektin mukana.

Vamp-liitännäiset analysoivat ääntä sen sijaan, että muuttaisivat sitä. Sen jälkeen, kun
olet ottanut Vamp-asennuksen käyttöön, valitse ääniraita analysoitavaksi, tai jätä ääniraita
valitsematta analysoitaksesi master-sekoituksen. Aikavalinta rajoittaa analyysia; muuten
Soundscaper käyttää koko projektia. Valitse **Analyze → Vamp Plugins**, valitse analysoijan
ulostulo ja sen asetukset, ja suorita se. Soundscaper lisää palautetut aikaleimat uudeksi
label-raidaksi vasta sen jälkeen, kun analyysi on onnistunut kokonaan, jotta peruutus tai
projektin muutos ei jätä osittaisia label-merkintöjä jäljelle.

## Vienti

Valitse **File → Export audio** sekoitetun toimituksen varten tai **Export selected audio**,
kun vain valinta tulisi renderöidä. Soundscaper voi myös viedä stemmejä ja label-merkintöjä.

Paketoitujen muotojen vienti käyttää FFmpeg-runtime-ympäristöä. Tarkat muodot ja ehdollinen
käytettävyys on lueteltu [generoidussa muotoviitteessä](/reference/).

Toista viety tiedosto toisessa sovelluksessa ennen toimitusta tai lähtöaineiston poistamista.

Kuvatyötä varten — sekvenssin koostaminen, videoefektit ja MP4- tai WebM-toimitus — siirrä
projekti [Framescaperiin](/framescaper/) ja katso
[videojen vienti](/framescaper/video-export/).
