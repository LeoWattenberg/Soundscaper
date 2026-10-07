---
title: "Projektitiedostot"
description: "Valitse paikallisen kirjaston, Scape-tiedostojen, Audacity-vaihdon, SESX-tuonnin ja renderöityjen varakopioiden väliltä."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","targetLocale":"fi"} -->

## Paikallinen projektikirjasto

Editori tallentaa työskentelyprojektit paikalliseen kirjastoonsa. Selaimessa tämä on alkuperäkohtainen tallennus; työpöytäversiossa se on sovellusdata. Tämä on kätevä työskentelykopio, ei ainoa kopio, jonka tulisi säilyttää.

## Scape-projektitiedostot

Työpöytäversiossa tuotu ääni ja video viittaavat oletusarvoisesti alkuperäisiin tiedostoihinsa. Säilytä tiedostot alkuperäisissä sijainneissaan, kun avaat projektin uudelleen. Paikallinen kirjasto säilyttää myös muokkauksen välimuistit. Tallenteet ja luotu tai käsitelty media sisällytetään, koska niillä ei ole muuttumatonta ulkoista alkuperäistiedostoa.

Valitse **Tiedosto → Projektinhallinta → Yhdistä media** pakataksesi viitatut mediat projektitiedostoon. Yhdistäminen tallentaa projektin heti; valitse kohde tallennusikkunassa. Tallentamisen jälkeen yhdistetyn kopion voi siirtää tai jakaa ilman alkuperäisiä mediatiedostoja. Jos jotakin mediaa ei voi yhdistää tai tallennus epäonnistuu, editori ilmoittaa ongelmasta.

Selainviennit pakkaavat mediat automaattisesti. Yhdistä työpöytäprojekti työpöytäversiossa ennen sen avaamista selaimessa, jos siinä on ulkoisia viittauksia.


Käytä valikkoa **Tiedosto → Vie projektitiedosto** muokattavan projektin tallentamiseen. Jokainen tuote kirjoittaa oman pääteensä: Soundscaper tallentaa `.sscape` ja Framescaper tallentaa `.fscape`, ja valikkotavassa näkyy kumpi pätee. Molempien takana oleva muoto on sama, joten se on sopiva valinta, kun sekoitetun median muokkaustila on säilytettävä.

Molemmat tuotteet avaavat kummankin päätteet. `.sscape`, `.fscape`, varattu `.liscape` ja vanhemmat `.scape` -tiedostot, jotka vietiin ennen kuin tuotteilla oli omat päätteensä, avautuvat kaikkialla, ja eri tuotteen tallentaminen nimittää sen vain uudelleen — esimerkiksi `Mix.sscape` muuttuu `Mix.fscape`:ksi, kun se tallennetaan Framescaperista. Nimi ei muuta mitään projektissa.

Scape-kopion tuominen tai avaaminen voi kohdata olemassa olevan projektin, jolla on sama ID. Käytä tarjottua kopiointityövaihetta, jos molempien versioiden on pysyttävä paikallisessa kirjastossa.

## Audacity AUP3 ja AUP4

Audacity-projektin vienti löytyy kohdasta **Tiedosto → Vie muu**. Valitse **Vie AUP3** Audacity 3.7.9:n projektiprofiilia tai **Vie AUP4** Audacityn nykyistä vaihtoprofiilia varten. Jokaisesta viennistä luodaan yhteensopivuusraportti, jossa kuvataan muunnokset, puuttuvat tehosteet ja pois jätetty Soundscaper-kohtainen tila.

Molemmat muodot sisältävät vain ääntä. Video sekä selaimen asetukset, kumoamishistoria, mikserin reititys ja selaimen projektikirjasto jätetään pois. Älä käytä kumpaakaan Soundscaper- tai Framescaper-projektin ainoana varmuuskopiona.

## Adobe Audition SESX

Tuo Adobe Audition -istunto työpöytäversiossa valitsemalla **Tiedosto → Avaa** ja `.sesx`-tiedosto. Säilytä viitatut äänitiedostot istuntokansion suhteellisessa kansiorakenteessa tai valitse pyydettäessä mediakansio. Tuonti luo uuden paikallisen projektin, jossa ovat tuetut ääniraidat, leikkeet, sijoittelu, rajaukset, yksinkertaiset häivytykset ja mikserin staattiset asetukset.

SESX-tuonti toimii vain yhteen suuntaan. Auditionin tehosteet, automaatio, reititys, video, merkit, silmukat, venytys, linkitetyt ristihäivytykset ja tarkat häivytyskäyrät eivät siirry. Avaa tuonnin jälkeen **Tiedosto → Toimitusraportti** tarkistaaksesi puuttuvat mediat ja muun pois jätetyn sisällön. Säilytä alkuperäinen SESX-tiedosto ja mediatiedostot Auditionissa jatkamista varten.

## Renderöity varmuuskopio

Tärkeän työn osalta säilytä molemmat:

1. Scape-projektikopio (`.sscape` tai `.fscape`) tulevaa muokkausta varten.
2. Renderöity ääni- tai videotiedosto, joka voidaan toistaa ilman editoria.

Tallenna nämä tiedostot selaimen tai sovellusdatan hakemiston ulkopuolelle.
