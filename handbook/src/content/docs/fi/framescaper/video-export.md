---
title: "Videon vienti"
description: "Validoi koostettu sekvenssi ja luo MP4- tai WebM-toimitus."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"fi"} -->

## Ennen vientiä

- Toista koko sekvenssi ja jokainen muokkausraja.
- Varmista, että näkyvät ja sooloitetyt raidat tuottavat tarkoitetun kuvan.
- Tarkista, että linkitetty ääni pysyy synkronoituna.
- Varmista vientialue ja tulkitse, sisältääkö viennin tekstit tai äänen.

## Tiedoston luominen

Avaa vientidialogi ja valitse videoformaatti. Framescaper tukee MP4- ja
WebM-toimitusta konfiguroitua videoajonaikaa käyttäen. Valitse määräpaikkaan sopivat
mitat, ruutunopeus ja muut vaihtoehdot.

Videon koodaus on resurssivaativampaa kuin tavallinen aikajanan toisto.
Pidä muokkaja auki, kunnes vienti ilmoittaa valmiudesta.

## Äänileikkeiden vieminen erillisinä tiedostoina {#export-audio-clips}

Valitse **Tiedosto → Vie video**, valitse äänimuoto, kuten **WAV**, ja aseta **Tuloste** -arvoksi **Yksittäiset leikkeet (jaa leikkeiden mukaan)**. Vienti lataa arkiston, jossa on tiedosto jokaiselle äänileikkeelle. Videoleikkeet jätetään pois, ja kukin äänitiedosto sisältää vain oman leikkeensä, leikkaukset ja leikkeen muokkaukset mukaan lukien.

Tiedostot alkavat leikkeen kuuluvasta alusta ilman täytettä projektin aikajanapaikkaan tai tehostehäntää. Numeroidut leikenimet erottavat samannimiset leikkeet toisistaan.

Raitatehosteet sisältyvät; master-tehosteet, mykistys ja soolo eivät vaikuta tähän vientiin. Katso yhteinen äänityönkulku kohdasta [Leikkeiden vienti erillisinä tiedostoina](/soundscaper/edit-mix-and-export/#export-clips).

## Toimituksen tarkistus

Avaa viety tiedosto erillisessä soittimessa. Tarkista sen kesto, ensimmäinen ja viimeinen
ruutu, kuvan suunta, äänen synkronointi ja odotetut tekstit.

Renderöity video ei voi korvata muokattavaa projektia. Vie myös `.fscape`-kopio,
kun aikajana ja projektin media on säilytettävä.
