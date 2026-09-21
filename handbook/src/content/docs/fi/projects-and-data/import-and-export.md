---
title: "Tuo ja vie"
description: "Erota lähdemedia, projektitiedostot, vaihtotiedostot ja renderöidyt toimitukset."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","targetLocale":"fi"} -->

Soundscaper käyttää eri tiedostotyyppejä eri tehtäviin.

## Lähdevälineet

Käytä valintaa **Tiedosto → Tuo** äänen, videon ja etikettien tuomiseen. Nykyinen muokkajan ohjeistus luettaa
AUP/AUP3/AUP4-, WAV-, MP3-, FLAC-, Opus-, OGG-, M4A-, AIFF- ja WebM-tiedostot; lisävideoastioita tuetaan videon tuontireitillä. Käytettävyys voi riippua
aktiivisesta tuotteesta ja ajonaikaisesta ympäristöstä.

Välineiden tuonti lisää projektin omistaman lähteen. Se ei tee alkuperäisestä tiedostosta
muokattavaa projektidokumenttiasi.

Paketoitujen ääntien tuonti ja vienti tukevat enintään yhtä tuntia tai 1 Gt:tä
(1 000 000 000 tiedostobytia), kumpi rajoitus saavutetaan ensin. Yhden tunnin
48 kHz:n stereotiedosto tuetaan, kun se mahtuu kyseiseen tiedostorajaan. Pitkät tehtävät lukevat,
koodaavat ja tallentavat paloin; suuret selaimen vientit vaativat alkuperäiselle yksityistä tiedostovarastoa
ja riittävästi vapaata tilaa. Suuret tuonnit vaativat pysyvän paikallisen tallennustilan
dekoodatulle äänelle. PCM-muodot säilyttävät omat erilliset rajansa.

Selaimen taso kattaa MP3:n, MP2:n, FLAC:n, WavPackin, Opuksen ja Ogg Vorbisin. Selaimen
AAC/M4A-tuki riippuu selaimen koodikista. Työpöydän virtausvientit kattavat
kuusi mukana toimitettua muotoa, mukaan lukien 24-bittisen FLAC:n ja float32-häviöttömän WavPackin. Työpöydän
tuonnit riippuvat natiivien dekoodereiden saatavuudesta; MP2 käyttää pienempää yhteensopivuustasoa. Työpöydän AAC ja yhteensopivuuspalveluntarjoajat säilyttävät
omat erilliset rajansa.

Aktiivinen tehtävä näyttää edistymispalkin myös silloin, kun **Näkymä → Tilapalkki** on piilotettu.
Valitse **Kumoa** palkin vierestä keskeyttääksesi tuonnin tai ääniexportin.

## Muokattavat projektitiedostot

- Scape (`.sscape` Soundscaperista, `.fscape` Framescaperista ja kumpikin avattavissa molemmissa) on kannettava, täyden uskollisuuden projektimuoto, jota Soundscaper
  ja Framescaper jakavat.
- AUP4 on vain ääntien vaihto Audacityn kanssa. Se ei ole täysi varmuuskopio
  monimediallisesta Soundscaper-projektista.

Katso [Projektitiedostot](/projects-and-data/project-files/) jokaisen valinnan seurauksista.

## Suoritettu toimitus

Ääniexportit luovat tiedostoja, jotka on tarkoitettu kuunteluun, julkaisuun tai lisätyöstöön. Videoexportit luovat MP4- tai WebM-toimitukset. Suoritettu tiedosto ei
säästä muokattavaa aikajanaa, reititystä, efekti tai projektihistoriaa.

Katso [viitewiite](/reference/) luodun muodon ja tuotteen kykytaulukoista.
