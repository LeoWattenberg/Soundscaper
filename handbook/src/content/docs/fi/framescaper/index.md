---
title: "Framescaper"
description: "Järjestele videota, yhdistä kuva ja toimita paikallinen video-ohjelmistoprojekti."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"47cebc3006e44dba5569ea0c1418001989dccf3730c3421c338c340222a9c5af","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"47cebc3006e44dba5569ea0c1418001989dccf3730c3421c338c340222a9c5af","targetLocale":"fi"} -->

Framescaper on jaetun editorin video-ohjattu näkymä. Se korostaa videoesikatselua, lähdevalvontaa, kuvatehosteita, kompositoimista, sisäkkäisiä sekvenssejä ja monikameratyötä.

Soundscaper ja Framescaper avaavat toistensa projektitiedostot: `.sscape`,
`.fscape` ja vanhempi `.scape` toimivat molemmissa. Käytä Soundscaperia
äänitykseen ja yksityiskohtaiseen äänituotantoon, ja palauta sitten projekti
Framescaperiin kuvatyötä varten.

## Missä mikäkin toiminto sijaitsee

Framescaper hallitsee kuvaa: videoimportti, lähdevalvonta ja videoesikatselu,
kuvatehosteet, geometria ja kompositoiminen, sisäkkäiset sekvenssit, monikameratyö
ja videotoimitus. Linkitetyt kuva- ja ääniraiteet pysyvät synkronoituina täällä,
kunnes poistat linkin.

Soundscaper hallitsee ääntä: äänitys, tehosteet ja analyysi, miksaus ja ääntoimitus.
Framescaper käyttää erilaista tallennusprosessia eikä paljasta Soundscaperin
äänitystyökaluja, joten tee äänitys Soundscaperissa ja tuo projekti takaisin.
Vaiheittaiset [ohjeet](/guides/) on kirjoitettu ja vahvistettu
Soundscaperia varten, ja ne kattavat myös video-ohjelman äänipuolen.

## Suositeltu polku

1. [Luo ensimmäinen Framescaper-projekti](/framescaper/first-project/).
2. [Valmista ja vie video](/framescaper/video-export/).
3. Tarkista [projektitiedoston ja varmuuskopioiden toiminta](/projects-and-data/project-files/).

Avaa selaimen editori osoitteessa
[framescaper.org/en](https://framescaper.org/en/).

Tietokoneen apuvälineistä, ks. [paikallinen käsittely, mallit ja lisäosat](/help/local-processing/).
