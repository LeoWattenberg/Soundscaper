---
title: "Tallennus, varmuuskopioinnit ja yksityisyydensuoja"
description: "Ymmärrä paikallinen ensisijainen tallennus ja suojaa projekteja selaimen tai laitteen menetykseltä."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"fi"} -->

## Mikä local-first tarkoittaa

Hankkeet, nauhoitukset ja tuodut mediat käsitellään ja tallennetaan laitteellesi. Editori ei vaadi tiliä eikä synkronoi hankkeita Soundscaper-palveluun.

Verkkopalvelussa ääni- ja mediadata käyttää selaimen alkuperäisprivaa tiedostojärjestelmää, jos se on käytettävissä, ja IndexedDB-varavaihtoehtoja. Soundscaper pyytää pysyvää tallennustilaa, mutta selain päättää, myöntääkö sen.

## Mitkä voivat poistaa hankkeen

- Sivutietojen tyhjennys poistaa selaimen paikallisen hankekirjaston.
- Yksityiset tai rajoitetut selaintekstit voivat palautua väliaikaiseen muistiin.
- Selaimen kiintiö- ja evikointikäytännöt ovat edelleen päteviä.
- Työpöytäsovelluksen tietojen manuaalinen poisto poistaa sen paikallisen kirjaston.
- Laitteen tai tallennustilan vika voi poistaa kaikki paikalliset kopiot kyseiseltä laitteelta.

Paketoitun työpöytäasennuksen poisto on suunniteltu säilyttämään sen kirjasto, mutta se ei ole varmuuskopiointistrategia.

## Varmuuskopiointirutiini

Hyödyllisissä vaiheissa ja ennen tallennustilan tyhjennystä tai siirtoa:

1. Odota, että paikallinen tallennus on valmis.
2. Vie Scape-hankketiedosto (`.sscape` tai `.fscape`).
3. Vie ja toista renderöity toimitus.
4. Kopioi molemmat tallennustilaan, joka on editorin paikallisten tietojen ulkopuolella.

Käytä AUP4-tiedostomuotoa lisäksi, jos Audacity-yhteensopivuus on tärkeää, ei Scape-hankkeenkopion sijaan.

## Dokumentaatiopalvelun yksityisyydensuoja

Tämä käsikirja toimitetaan staattisina tiedostoina ja käyttää selaimen paikallista hakuominaisuutta. V1-sivusto ei lisää analytiikkapalvelua tai tekoäly-/haku-taustapalvelinta.

Koko [Soundscaperin ja Framescaperin yksityisyydensuojakäytäntö](https://soundscaper.org/privacy/en/)
kattaa myös sovellusten toimituksen, laitelupien, valinnaisen latauksen, työpöydän päivitystarkistusten ja Framescaper Web VCR-yhteyksien.
