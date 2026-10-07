---
title: "Tuodun tiedoston korvaaminen työpöytäversiossa"
description: "Tallenna muokattu projekti Soundscaperissa tai Framescaperissa alkuperäisen mediatiedoston päälle."
sidebar:
  order: 10
---
<!-- docs-ai-provenance: {"factPacketSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","targetLocale":"fi"} -->

Soundscaperin ja Framescaperin Electron-versioissa komento **Tiedosto → Korvaa tiedostonimi** vie koko muokatun projektin alun perin tuotuun mediatiedostoon. Se käyttää alkuperäisen tiedoston tukemia vientiasetuksia ja tallentaa heti avaamatta vienti-ikkunaa tai tiedostonvalitsinta. Ääni säilyttää lähdemuodon, näytteenottotaajuuden ja kanavamäärän. Tuetut MP4- ja WebM-videot säilyttävät lähdesäiliön, mitat ja kuvataajuuden.

Tuo yksi mediatiedosto komennolla **Tiedosto → Tuo**, tee muokkaukset ja valitse sitten **Tiedosto → Korvaa tiedostonimi**. Voit toistaa tämän lisämuokkausten jälkeen. Aikavalinta ei rajoita korvausta: koko projekti renderöidään aina. Projekti säilyttää tuodun median ja muokkaushistorian.

Komento ei ole käytettävissä, jos projektissa ei ole tuettua alkuperäistä tiedostoa, jos alkuperäisiä tiedostoja on tuotu useita tai tuonnin, tallennuksen tai käsittelyn aikana. Selainversiot käyttävät tavallista vienti-ikkunaa.

Valitse Soundscaperissa **Tiedosto → Vie ääni** tai Framescaperissa **Tiedosto → Vie video**, jos haluat valita toisen kohteen tai muuttaa vientiasetuksia. Korvaus vaihtaa alkuperäisen tiedoston sisällön; säilytä erillinen kopio, jos tarvitset muokkaamattoman tallenteen.
