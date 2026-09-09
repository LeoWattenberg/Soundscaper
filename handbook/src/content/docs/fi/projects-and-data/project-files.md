---
title: "Projektitiedostot"
description: "Valitse paikallisen kirjaston, Scape-projektitiedostojen, AUP4:n ja renderöityjen varakopioiden väliltä."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"fi"} -->

## Paikallinen projektikirjasto

Editori tallentaa työskentelyprojektit paikalliseen kirjastoonsa. Selaimessa tämä on alkuperäkohtainen tallennus; työpöytäversiossa se on sovellusdata. Tämä on kätevä työskentelykopio, ei ainoa kopio, jonka tulisi säilyttää.

## Scape-projektitiedostot

Käytä valikkoa **Tiedosto → Vie projektitiedosto** häviöttömän ja siirrettävän projektin luomiseen. Jokainen tuote kirjoittaa oman pääteensä: Soundscaper tallentaa `.sscape` ja Framescaper tallentaa `.fscape`, ja valikkotavassa näkyy kumpi pätee. Molempien takana oleva muoto on sama, joten se on sopiva valinta, kun sekoitetun median muokkaustila on säilytettävä.

Molemmat tuotteet avaavat kummankin päätteet. `.sscape`, `.fscape`, varattu `.liscape` ja vanhemmat `.scape` -tiedostot, jotka vietiin ennen kuin tuotteilla oli omat päätteensä, avautuvat kaikkialla, ja eri tuotteen tallentaminen nimittää sen vain uudelleen — esimerkiksi `Mix.sscape` muuttuu `Mix.fscape`:ksi, kun se tallennetaan Framescaperista. Nimi ei muuta mitään projektissa.

Scape-kopion tuominen tai avaaminen voi kohdata olemassa olevan projektin, jolla on sama ID. Käytä tarjottua kopiointityövaihetta, jos molempien versioiden on pysyttävä paikallisessa kirjastossa.

## AUP4

AUP4 on olemassa Audacityn kanssa yhteensopivaa äänen vaihtoa varten. Viennin tuottama yhteensopivuusraportti kuvaa muunnoksia, käytettämättömiä efektejä ja jätettyä Soundscaper-erikoista tilaa.

AUP4 on pelkkää ääntä. Video jätetään pois, eikä selaimen asetuksia, peruutushistoriaa, mikserin reititystä tai selaimen projektikirjastoa siirretä. Älä käytä AUP4:ää ainoana varmuuskopiona Soundscaper- tai Framescaper-projektista.

## Renderöity varmuuskopio

Tärkeän työn osalta säilytä molemmat:

1. Scape-projektikopio (`.sscape` tai `.fscape`) tulevaa muokkausta varten.
2. Renderöity ääni- tai videotiedosto, joka voidaan toistaa ilman editoria.

Tallenna nämä tiedostot selaimen tai sovellusdatan hakemiston ulkopuolelle.
