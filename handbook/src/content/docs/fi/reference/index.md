---
title: "Viite"
description: "Luodut komennot, pikanäppäimet, muodot, efektit ja tuotteen ominaisuuksia kuvaavat taulukot."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b7e4df92cd36126d4ce3865383043516972e9aca463c3449b731085cafc4050e","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b7e4df92cd36126d4ce3865383043516972e9aca463c3449b731085cafc4050e","targetLocale":"fi"} -->

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

[Macro programs](/reference/macro-programs/) on ainoa täällä käsin kirjoitettu
sivu. Se dokumentoi JavaScript API:n, jonka vasten makro-ohjelma ajetaan, ja
sen väitteet ovat ne, joihin editorin omat testit sitovat hiekkalaatikon.
