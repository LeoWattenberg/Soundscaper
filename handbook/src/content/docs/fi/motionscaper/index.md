---
title: "Motionscaper"
description: "Luo animoituja sommitelmia ja säilytä muokattavat animaatioprojektit paikallisesti."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","targetLocale":"fi"} -->

Motionscaper on Scaper-perheen liikegrafiikkaeditori. Projekti
sisältää sommitelmia, tasoja, animaatiota ja säilytettyä mediaa. Sen projektitiedoston
pääte on `.mscape`.

Tämä on kehitysversio. Aloita tärkeän lähdeaineiston kopiosta
ja säilytä viedyt projektiarkistot työkirjastosi rinnalla.

## Aloita sommitelma {#start-a-composition}

Valitse **Tiedosto → Uusi sommitelma**. **Taso**-valikko avaa tekstin, muotojen,
animaation, koostamisen, seurannan, lausekkeiden ja 3D-kohtauksen työkalut. **Näytä →
Sommitelman esikatselu** avaa toiston; uudet muokkausnäkymät tulevat esiin, kun
valitset ne valikosta.

Valitse **Näytä → Sommitelman piirtoalue**, kun haluat valita, siirtää, skaalata tai kiertää tasoja,
joilla on staattiset 2D-muunnokset. Animoidut muunnokset pysyvät muokattavina ominaisuus-
ja aikajanatyökaluilla.

Valitse **Näytä → Aikajana** -näkymässä nykyisiä tasoja nimetäksesi ne uudelleen, ottaaksesi ne käyttöön,
poistaaksesi ne käytöstä tai poistaaksesi ne. Uudelleennimeäminen säilyttää ominaisuusviittaukset ja animaation. Tason
poistaminen säilyttää sen alkuperäisen median; sisällytä riippuvaiset tasot tai irrota niiden
linkit ensin. **Kumoa** palauttaa poistetut tasot. Valittu videotaso
tarjoaa myös äänivalintaruudun, kun sen säilytetty lähde sisältää ääntä.

Seuraa ohjetta [ensimmäiseen animaatioprojektiisi](/motionscaper/first-project/), kun haluat luoda,
animoida, tallentaa ja renderöidä sommitelman.

## Tallenna ja toimita {#save-and-deliver}

**Tiedosto → Tallenna** julkaisee tallennetun version. **Tallenna kopio** vie nykyisen
tilannevedoksen `.mscape`-arkistona julkaisematta uutta tallennettua versiota.
Tuotu alkuperäinen media ja kirjasimet kulkevat arkiston mukana. **Projektikirjasto**
avaa tällä laitteella säilytetyt projektit.

**Tiedosto → Renderöi** tarjoaa läpinäkyviä PNG-ruutuja TAR-arkistossa,
peittäviä MP4- tai WebM-videoita ja ProRes 4444:n, kun työpöytäenkooderi on käytettävissä.
PNG-sarjat eivät sisällä ääntä. Selainvideo säilyttää määritetyn äänen, kun sen
enkooderi tukee pyydettyä muotoa. Natiivi ProRes ilmoittaa värin ja alfan todellisen
tarkkuuden renderöintivalintaikkunassa. **Tiedosto → Renderöintijono** pitää
työt saatavilla valintaikkunoiden sulkemisesta ja projektinvaihdoista huolimatta. Se säilyttää enintään kahdeksan
työtä ja 128 MiB selainlatauksia; yhden latauksen raja on 64 MiB. Valitse
suoratoistava tiedostokohde suuremmalle tulosteelle ja poista valmiit työt
vapauttaaksesi säilytetyt lataukset. Jos natiivin tulosteen siivous epäonnistuu, käytä **Yritä tulosteen
siivousta uudelleen** tässä jonossa. Työ pitää kohteensa, kunnes siivous onnistuu;
sitten voit poistaa sen tai yrittää lähetettyä versiota uudelleen uudella kohteella.

## Linkitä Framescaperiin {#link-to-framescaper}

Linkitetyt sommitelmat vaativat erillisen Framescaper 1.1 -kehityslinjan.
Luo paritusosoite sen **Tiedosto → Linkitetyt sommitelmat** -valintaikkunassa. Liitä se
Motionscaperin **Tiedosto → Lähetä sommitelma Framescaperiin** -valintaikkunaan, yhdistä
ja pidä editorit sekä siltaikkunat avoinna. Myöhemmät **Tallenna**-toiminnot lähettävät
uudet versiot automaattisesti; **Tallenna kopio** ei lähetä.

Framescaper säilyttää jokaisen hyväksytyn version ja sen koko media-aineiston
offline-käyttöä varten. Kumoa kiinnittää aiemman version, kunnes jatkat päivityksiä.
Tulosteen koon, ajoituksen tai ääniruudukon muutokset vaativat nimenomaisen mukautustarkistuksen.
Työpöytävastaanotin voi sen sijaan tarkkailla valitsemaasi tallennettua `.mscape`-tiedostoa.

## Tarkista työpöytäpäivitykset {#check-desktop-updates}

Valitse työpöytäsovelluksessa **Ohje → Tarkista päivitykset**. Tämä manuaalinen tarkistus etsii
yhteensopivia Motionscaper-julkaisuja projektin GitHub-tietovarastosta. Esikatseluversiot
voivat saada uudempia esikatselujulkaisuja; vakaat versiot saavat vakaita
julkaisuja. Avaa varmennettu julkaisusivu valitsemalla **Näytä julkaisu**. Tarkistus
ei lataa tai asenna päivitystä. Selainkoonnit eivät sisällä tätä valikkokomentoa.

## After Effects -tiedonsiirto {#after-effects-exchange}

**Tiedosto → After Effects -silta** tarjoaa luettavia komentosarjoja ja tarkistaa tuetun
siirtoaineiston ennen tuontia. `.aep`- ja `.aepx`-tiedostot avataan asennetun
After Effectsin ja siltakomentosarjojen kautta. Kehitysvaiheen siltaa
ei ole vielä varmennettu asennetussa After Effectsissä. Tarkista sen raportti;
tukematon kohtauksen tarkoitus ja alkuperäinen media pysyvät projektin hallussa.

Valintaikkuna tarjoaa erilliset tuonti- ja vientivalinnat tuetuille peittävyyden
skalaarilausekkeille, jotka käyttävät aritmetiikkaa, sommitelman aikaa, lauseketta edeltävää
arvoa ja tavanomaisia Math-funktioita. Molemmat valinnat ovat aluksi pois käytöstä. Tarkista uusi
raportti valinnan muuttamisen jälkeen; muut lausekemuodot vaativat erillisen
näytteistyksen tai renderöinnin. Alkuperäinen lausekelähde pysyy säilytetyssä
siirtoaineistossa tai `original.mscape`-arkistossa.

Renderöijä tukee SDR-väriä ja alfaa 2.5D-tasoilla, kameroilla, valoilla,
suljinnäytteistyksellä ja syväterävyydellä. Se ei lupaa HDR:ää, täysiä 3D-verkkoja,
edistynyttä AI-maskausta tai mielivaltaisten After Effects -liitännäisten yhteensopivuutta.
