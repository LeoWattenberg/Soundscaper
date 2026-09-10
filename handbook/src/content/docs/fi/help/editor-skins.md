---
title: "Editorin ulkoasu"
description: "Valitse visuaalinen ulkoasu tai kokeile sitä tilapäisesti URL-osoitteen kautta."
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"fi"} -->

Ihoteemat muuttavat editorin värejä, fontteja, reunuksia ja koristeellisia taustoja.
Ne ovat saatavilla Soundscaperissa ja Framescaperissa. Jokainen tuote muistaa
oman valintansa. Työtilat jatkavat paneelien ja työkalujen asettelun hallintaa.

## Valitse ihoteema {#choose-a-skin}

Avaa **Muokkaa → Asetukset → Ulkonäkö** ja valitse ihoteema:

- **Oletus** säilyttää alkuperäisen editorin suunnittelun.
- **Sakura** yhdistää kirsikkakukintoja, vaaleanpunaisia korostuksia ja pyöristettyjä kirjaimia.
- **Lilac** käyttää viileitä violetteja ja kerrostettuja violetteja tekstuureja.
- **Techno** yhdistää sinisiä piirrigrafiikoita ja monoleveitä kirjaimia.

Valitse **Vaalea**, **Tumma** tai **Seuraa järjestelmän teemaa** erikseen. Jokaisella
ihoteemalla on sekä vaalea että tumma versio. **Leikkauksen tyyli** on edelleen erillinen valinta; värikartta on
sovitetukin jokaisen ihoteeman kanssa, mutta leikkausten värit pysyvät erottuvina.

Korkea kontrasti on etusijalla ihoteeman koristeisiin nähden. Korkean kontrastin
poistaminen palauttaa valitun ihoteeman. Ihoteeman muuttaminen ei koskaan muuta leikkauksen ääntä, projektin
sisältöä tai työtilan asettelua.

## Kokeile ihoteemaa linkistä {#try-a-skin-from-a-link}

Lisää `?useskin=sakura` editorin URL-osoitteeseen, jotta voit esikatsella Sakuraa tilapäisesti. Käytä
`default`, `sakura`, `lilac`, tai `techno` arvona. Jos URL-osoitteessa on jo
kyselyparametri, lisää `&useskin=sakura` sen sijaan. Tuntematon arvo jätetään huomiotta.

URL-esikatselu ei korvaa tallennettua ihoteemaasi, vaikka muuttaisitkin toisen
asetuksen. Esikatselu-URL:n uudelleenlataaminen jatkaa esikatselua; vierailu ilman
parametria käyttää tallennettua valintaasi. Parametri ei valitse vaaleaa tai tummaa.

**Asetukset → Ulkonäkö** -osiossa valitse **Säilytä tämä ihoteema** tallentaaksesi esikatselun,
tai **Lopeta esikatselu** palataksesi tallennettuun ihoteemaasi. Minkä tahansa ihoteeman valinta tallentaa
myös sen valinnan ja lopettaa esikatselun. Nämä toimet poistavat vain ihoteeman parametrin
nykyisestä URL-osoitteesta, ilman editorin uudelleenlataamista.
