---
title: "Muokkaa, sekoita ja vie"
description: "Järjestä klippejä, tasaa raidoja, soita efektit ja luo toimitustiedosto."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","targetLocale":"fi"} -->

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

### Muokkaa leikkeen lähdettä {#clip-source-properties}

Avaa lähde-editori valitsemalla **Muokkaa → Äänileikkeet → Leikkeen ominaisuudet**. Koko tallenne näkyy leikkeen takana. Muuta lähteen alkua ja kestoa vetämällä leikkeen reunoja niin, että leikkeen alku pysyy projektin aikajanalla paikallaan. **Normalisointi**-paneelissa ovat leikkeen vahvistus sekä huippu- ja äänekkyystoiminnot.

Avaa **Sävelkorkeus ja tempo** ja valitse **Linkitä sävelkorkeus ja tempo**, jos haluat muuttaa nopeutta ja sävelkorkeutta yhdessä. Nopeussuhde `1` ja sävelkorkeuden muutos `0%` eivät muuta ääntä. Suhde `2` toistaa kaksinkertaisella nopeudella oktaavia korkeammalta; `0.5` puolittaa nopeuden ja laskee sävelkorkeutta oktaavin. Yhden linkitetyn säätimen muuttaminen päivittää myös toisen. Linkin poistaminen palauttaa sävelkorkeuden erillisen säädön säilyttäen nykyisen nopeussuhteen.

Lisää lähdenäytteeseen sidottu venytysmerkki napsauttamalla aaltomuotoa **Ctrl** painettuna. Sen vetäminen muuttaa ajoitusta molemmin puolin, ja peite näyttää molemmat toistonopeudet. Leikkeen säätimet koskevat edelleen vain kyseistä leikettä. Lähdeäänen valitseminen ja tehosteen käyttäminen päivittää kaikki leikkeet, jotka käyttävät tätä lähdettä.

### Muokkaa leikkeitä taulukossa {#clip-spreadsheet}

Näytä projektin kaikki leikkeet valitsemalla **Näkymä → Paneelit → Leiketaulukko**. Paneeli avautuu aikajanan alle. Paneelivalikosta sen voi siirtää toiseen telakointiin, irrottaa kelluvaksi tai sulkea. Koko ja sijainti tallentuvat työtilan mukana. Rivi näyttää raidan, aikajanapaikan, lähdetiedoston, lähdesiirtymän, keston, sävelkorkeuden, nopeuden, vahvistuksen, häivytykset ja toistoasetukset. Ajat ovat sekunteja, sävelkorkeus puolisävelaskelia ja nopeus suhde: `1` on normaali ja `2` kaksinkertainen nopeus.

Muokkaa arvoa kaksoisnapsauttamalla solua tai valitsemalla solu ja painamalla **Enter**. Ota muutos käyttöön painamalla **Enter** tai peruuta **Escape**-näppäimellä. Raita- ja lähdesolut näyttävät todelliset tunnisteensa. Siirrä leike olemassa olevalle ääniraidalle muuttamalla raidatunnistetta. Korvaa ääni muuttamalla lähdetunnistetta tai syöttämällä paikallinen tiedostopolku; aikajanapaikka, kesto, nopeus ja lähdesiirtymä sekunteina säilyvät. Uuden tiedoston on sisällettävä ilmoitettu lähdealue. **Käänteinen** ja **Vaiheenkääntö** ovat valintaruutuja; vaihda niiden tila valitsemalla solu ja painamalla **Välilyönti**. Lukittujen raitojen leikkeet ja videoleikkeet ovat vain luku -tilassa.

Keston muuttaminen lyhentää tai pidentää lähdealuetta nykyisestä siirtymästä. Nopeuden muuttaminen säilyttää lähdealueen, ellei samalla liitetä kestoa. Poista leikkeiden ryhmittely tai linkitys ennen ajoituksen muuttamista tässä; muokkaa venytettyjen leikkeiden ajoitusta lähde-editorissa.

Valitse solu, vedä alueen yli tai laajenna valintaa napsauttamalla toista solua **Shift** painettuna. Valitse koko rivi tai sarake napsauttamalla rivinumeroa tai sarakeotsikkoa. Vaihda valinta taulukkolaskentaohjelman kanssa komennoilla **Ctrl+C** ja **Ctrl+V** (macOS:ssä **Cmd+C** ja **Cmd+V**). Sarakkeet erotetaan sarkaimilla ja rivit rivinvaihdoilla. Liittäminen alkaa valitusta solusta ja päivittää olemassa olevat leikkeet. Olemassa olevat rivit ylittävä liittäminen hylätään. Kun valinta on aktiivinen, poista se painamalla **Escape** tai napsauttamalla taulukon alla olevaa tyhjää aluetta. Ilman valintaa liittäminen lisää uusia rivejä myös tyhjään projektiin. Toistoasetukset kopioidaan muodossa `true` tai `false`, ja ne hyväksytään myös liitettäessä. Uudet rivit noudattavat taulukon sarakejärjestystä ja tarvitsevat lähdetiedoston nimen tai lähdetunnisteen. Yksikäsitteinen olemassa oleva raidan nimi sijoittaa leikkeen kyseiselle raidalle; uusi nimi luo ääniraidan. Tyhjä raidan nimi käyttää lähteen nimeä. Tyhjät lukusolut saavat oletusarvot: paikka ja siirtymä `0`, nopeus `1`, sävelkorkeus ja vahvistus `0`, eikä häivytyksiä. Tyhjä kesto käyttää jäljellä olevan äänen pyydetyllä nopeudella.

Paneeli etsii lähdettä ensin projektista, myös projektikorista. Jos sitä ei löydy, valitse **Lataa viitatut tiedostot** ja valitse valintaikkunassa luetellut äänitiedostot. Myös levypolut vaativat tämän tiedostovalinnan: polun liittäminen ei anna sovellukselle pääsyä tiedostoon. Valittujen tiedostojen on vastattava viitattuja nimiä yksiselitteisesti. Paneeli tuo äänen, tarkistaa lähderajat ja leikkeen ominaisuudet ja sijoittaa uudet leikkeet määritettyihin kohtiin. **Ctrl+Z** (**Cmd+Z** macOS:ssä) peruu koko liittämisen yhdellä kertaa; **Ctrl+Shift+Z** (**Cmd+Shift+Z**) tekee sen uudelleen. Jos liittäminen sisältää virheellisen arvon, leikkeet eivät muutu.

## Sekoitteen rakentaminen

Käytä raidan vahvuutta, panoraamaa, mykistystä ja solo-ohjaimia projektin tasapainottamiseen.
Mixer-paneeli paljastaa saman projektin tilan sekoitukseen suunnitellulla asettelulla.
Reaaliaikaiset efektit ovat säädettävissä; tuhoavat tai renderöidyt operaatiot luovat
projektin muutoksia, jotka voidaan kumota, kun historia on käytettävissä.

Käytä toiston mittaria ja loudness-analyysia tuloksen tarkasteluun. Vältä mittarin
kohdetason käyttämistä kuuntelemisen korvikkeena täydellisessä viennissä.

### Kuuntele valittuja taajuuksia {#listen-to-selected-frequencies}

Valitse kuunneltava kohta. Valitse raitavalikosta **Raidan visualisointi → Spektrogrammi** ja avaa sitten **Spektrogrammin asetukset → Valitse spektrin taajuusalue**. Anna minimi- ja maksimitaajuus ja valitse **Valitse alue**, tai säädä valintakahvoja spektrogrammissa.

Valitse **Toiston asetukset → Toista valitut taajuudet** tai **Valitse → Spektri → Toista valitut taajuudet**. Valittu aikaväli toistetaan kerran normaalilla nopeudella, vaikka aiemmin olisi valittu toinen nopeus tai jatkuva toisto. Kuuntelusuodatin koskee nykyistä miksausta ja sen mykistys-, soolo-, vahvistus- ja tehosteasetuksia. Spektrisuorakulmio näyttää taajuuskaistan ja aikavälin, mutta ei aseta raitaa sooloon. Jos toisto on jo käynnissä, komento keskeyttää sen; valitse komento uudelleen käynnistääksesi taajuuksien kuuntelun.

Reaaliaikaisten taajuussuodattimien reunat ovat pehmeät. Kaistan ulkopuoliset taajuudet hiljenevät, ja myös sen rajojen lähellä olevat taajuudet voivat hiljentyä. **Tauko** tai **Pysäytä** poistaa suodattimen, joten seuraava tavallinen toisto käyttää koko taajuusaluetta. Ääni, valinnat, kumoamishistoria ja viedyt tiedostot säilyvät ennallaan.

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

### Vie leikkeet erillisinä tiedostoina {#export-clips}

Valitse **Tiedosto → Vie ääni** ja aseta **Tuloste** arvoon **Yksittäiset leikkeet (jaa leikkeiden mukaan)**. Valitse äänimuoto ja lataa **Vie**-painikkeella arkisto, jossa on yksi tiedosto projektin ääniraitojen kutakin äänileikettä kohti. Tiedosto alkaa leikkeen kuultavasta alusta ja päättyy kuultavaan loppuun ilman täytettä projektin aikajanaan asti tai tehosteen jälkisointia. Rajaukset, leikkeen vahvistus, häivytykset sekä nopeuden ja sävelkorkeuden muutokset sisältyvät. Päällekkäiset leikkeet pysyvät erillisinä.

Tiedostot käyttävät leikkeiden nimiä numeroiduilla etuliitteillä. Tiedostonimien tuemattomat merkit korvataan, ja numerot erottavat samannimiset leikkeet. Raitatehosteet sisältyvät; master-tehosteet, mykistys ja soolo eivät vaikuta vientiin. Poista jäädytettyjen raitojen jäädytys ennen niiden muokattavien leikkeiden vientiä erikseen.

Paketoitujen muotojen vienti käyttää FFmpeg-runtime-ympäristöä. Tarkat muodot ja ehdollinen
käytettävyys on lueteltu [generoidussa muotoviitteessä](/reference/).

### Upota lukumerkinnät {#embedded-chapters}

Valitse selaineditorissa **Tiedosto → Vie ääni**, valitse **MP3** tai **AAC / M4A** ja ota **Upota merkinnät lukuina** käyttöön kohdassa **Ääniasetukset**. Asetus on aluksi poissa käytöstä ja lisää merkintöjen otsikot ja ajat yhteen miksattuun tiedostoon. Lisää merkinnät ennen vientiä; stemit, lukujen erottelu ja masterointijaksot eivät tarjoa tätä asetusta.

Mukaan tulevat vain toimitettavan alueen kanssa leikkaavat merkinnät. Valinnan vieminen siirtää lukujen ajat tulostetun tiedoston alkuun. MP3 säilyttää aluemerkintöjen loppuajat; pistemerkintä päättyy seuraavan luvun kohdalla tai tiedoston lopussa. M4A tallentaa lukujen alut, ja kukin luku jatkuu seuraavaan alkuun tai tiedoston loppuun. M4A tukee enintään 255 lukua ja 255 UTF-8-tavua otsikkoa kohti. Upotettujen lukujen näyttäminen riippuu soittimesta.

Toista viety tiedosto toisessa sovelluksessa ennen toimitusta tai lähtöaineiston poistamista.
