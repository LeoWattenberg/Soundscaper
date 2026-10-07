---
title: "Viite"
description: "Luodut komennot, pikanäppäimet, muodot, efektit ja tuotteen ominaisuuksia kuvaavat taulukot."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"27ac617a3293f4d301daf72bed0b9f3e9127f4516531c320703c36e7afe8658c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"27ac617a3293f4d301daf72bed0b9f3e9127f4516531c320703c36e7afe8658c","targetLocale":"fi"} -->

Viitesivut luodaan tarkastetuista ajonaikarekistereistä ja sitoutetaan
varastoon. Ne kuvaavat toteutettua toimintaa, eivät tiekarttakohtia tai pelkkää
lähdekooditiedostojen ja testien olemassaoloa.

Käytä tätä osiota vastaamaan kysymyksiin, kuten:

- Mikä oletuslyhennetyö käynnistää komennon?
- Onko komento käytettävissä Soundscaperissa, Framescaperissa vai molemmissa?
- Mitä ääni- ja videotiedostomuotoja voi viedä?
- Mikä on efektin parametrien oletusarvo ja mitä arvoja se hyväksyy?
- Mitä efektejä voi ajaa, kun ääni soittaa, ja mitkä vaativat valinnan?
- Mitä paikallisia avustustyövirtoja on olemassa ja mitä malleja ne vaativat?
- Mitä paneleja jokainen työtila näyttää?
- Mitä kieliä, selaimia ja työpöytäpaketteja on rakennettu ja testattu?
- Mitä ominaisuuksia riippuu tuotteesta, alustasta tai FFmpeg-ajonaikaympäristöstä?

Luoduissa sivuissa on lähdeperä ja niitä tarkistetaan poikkeamien varalta
varaston laadunvalvontavaiheessa.

Käsin kirjoitettu [Makro-ohjelmat](/reference/macro-programs/) -sivu kuvaa JavaScript-rajapinnan, jota makro-ohjelma käyttää. [Tuodun tiedoston korvaaminen työpöytäsovelluksessa
](/reference/overwrite-original-file/) kuvaa molempien tuotteiden yhteisen Electron-tiedostokomennon. Editorin testit tarkistavat niiden toiminnan.
