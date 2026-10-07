---
title: "Tuo ja vie"
description: "Erota lähdemedia, projektitiedostot, vaihtotiedostot ja renderöidyt toimitukset."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"fi"} -->

Soundscaper käyttää eri tiedostotyyppejä eri tehtäviin.

## Lähdevälineet

Käytä valintaa **Tiedosto → Tuo** äänen, videon ja etikettien tuomiseen. Nykyinen muokkajan ohjeistus luettaa
AUP/AUP3/AUP4-, WAV-, MP3-, FLAC-, Opus-, OGG-, M4A-, AIFF- ja WebM-tiedostot; lisävideoastioita tuetaan videon tuontireitillä. Käytettävyys voi riippua
aktiivisesta tuotteesta ja ajonaikaisesta ympäristöstä.

Välineiden tuonti lisää projektin omistaman lähteen. Se ei tee alkuperäisestä tiedostosta
muokattavaa projektidokumenttiasi.

Pakatun äänen vienti ja selaimessa tuonti tukevat enintään yhtä tuntia tai 1 Gt:tä (1 000 000 000 tavua tiedostoa), sen mukaan kumpi raja saavutetaan ensin. Työpöydän tiedostonvalinnalla ja pakatun äänen tuonnilla ei ole kiinteää tiedostokoko- tai kestävyyrajaa turvallisen kokonaislukuvälin alapuolella. Pitkät tehtävät lukevat, koodaavat ja tallentavat osissa; suuret selainviennit vaativat alkuperälle yksityistä tiedostotallennustilaa ja riittävästi vapaata tilaa. Suuret tuonnit vaativat riittävästi paikallista tallennustilaa puretulle äänelle. Myös muodon rakenne, dekooderin tuki ja käytettävissä oleva tallennustila voivat rajoittaa tuontia.

Selain tukee MP3:a, MP2:ta, FLACia, WavPackia, Opusta ja Ogg Vorbista. Selaimen AAC/M4A-tuki riippuu selaimen koodekista. Työpöydän suoratoistovienti kattaa kuusi mukana toimitettua muotoa sekä häviöttömän 24-bittisen FLACin ja float32-WavPackin. Työpöytätuonnit riippuvat dekooderien saatavuudesta; suuret MP2-lähteet käyttävät pakettidekooderia ja pienemmät MP2-lähteet apuohjelman yhteensopivuustasoa.

Aktiivinen tehtävä näyttää edistymispalkin myös silloin, kun **Näkymä → Tilapalkki** on piilotettu.
Valitse **Kumoa** palkin vierestä keskeyttääksesi tuonnin tai ääniexportin.

## Muokattavat projektitiedostot

- Scape (`.sscape` Soundscaperista, `.fscape` Framescaperista ja kumpikin avattavissa molemmissa) on kannettava, täyden uskollisuuden projektimuoto, jota Soundscaper
  ja Framescaper jakavat.
- AUP3 ja AUP4 mahdollistavat äänen vaihdon Audacityn kanssa. Valitse AUP3 Audacity 3.7.9:n projektiprofiilia tai AUP4 nykyistä vaihtoprofiilia varten. Kumpikaan ei ole täydellinen varmuuskopio sekoitetun median Soundscaper-projektista; tarkista yhteensopivuusraportti viennin jälkeen.
- Työpöytäversiossa voi avata Adobe Audition SESX -istuntoja (`.sesx`) ja luoda niiden viittaamista äänitiedostoista paikallisen projektin. Säilytä alkuperäinen istunto ja mediatiedostot; SESX-vientiä ei ole käytettävissä.

Katso [Projektitiedostot](/projects-and-data/project-files/) jokaisen valinnan seurauksista.

## Suoritettu toimitus

Ääniexportit luovat tiedostoja, jotka on tarkoitettu kuunteluun, julkaisuun tai lisätyöstöön. Videoexportit luovat MP4- tai WebM-toimitukset. Suoritettu tiedosto ei
säästä muokattavaa aikajanaa, reititystä, efekti tai projektihistoriaa.

Katso [viitewiite](/reference/) luodun muodon ja tuotteen kykytaulukoista.
