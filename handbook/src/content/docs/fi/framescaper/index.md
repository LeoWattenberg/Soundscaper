---
title: "Framescaper"
description: "Järjestele videota, yhdistä kuva ja toimita paikallispainotteinen videoprojekti."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"6193de9a731d010659be03c1372890bf230bb54161c79a2aa1e3ffe4a63c51bd","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"6193de9a731d010659be03c1372890bf230bb54161c79a2aa1e3ffe4a63c51bd","targetLocale":"fi"} -->

Framescaper on jaetun editorin video-ohjattu näkymä. Se korostaa videoesikatselua, lähdevalvontaa, kuvatehosteita, kompositoimista, sisäkkäisiä sekvenssejä ja monikameratyötä.

Soundscaper ja Framescaper avaavat toistensa projektitiedostot: `.sscape`,
`.fscape` ja vanhempi `.scape` toimivat molemmissa. Käytä Soundscaperia
äänitykseen ja yksityiskohtaiseen äänituotantoon, ja palauta sitten projekti
Framescaperiin kuvatyötä varten.

## Missä mikä on

Framescaper hallitsee kuvaa: videoimportti, Source Monitor ja Video Preview,
kuvatehosteet, geometria ja kompositoiminen, sisäkkäiset sekvenssit, monikameratyö
ja videotoimitus. Linkitetyt kuva- ja ääniraiteet pysyvät tässä synkronoituna,
kunnes poistat linkin.

Soundscaper hallitsee ääntä: äänitys, tehosteet ja analyysi, miksaus ja ääntoimitus.
Framescaper käyttää erilaista tallennusprosessia eikä paljasta Soundscaperin
äänitystyökaluja, joten tee äänitys Soundscaperissa ja tuo projekti takaisin.
Vaiheittaiset [opastukset](/guides/) on kirjoitettu ja vahvistettu
Soundscaperia varten, ja ne kattavat myös video-ohjelman äänipuolen.

## Suositeltu polku

1. [Luo ensimmäinen Framescaper-projekti](/framescaper/first-project/).
2. [Valmista ja vie video](/framescaper/video-export/).
3. Tarkista [projektitiedoston ja varmuuskopioiden toiminta](/projects-and-data/project-files/).

Avaa selaimen editori osoitteessa
[soundscaper.org/framescaper/en](https://soundscaper.org/framescaper/en/).
