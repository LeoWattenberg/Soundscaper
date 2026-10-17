---
title: "Ensimmäinen animaatioprojektisi"
description: "Luo sommitelma, animoi taso ja vie tallennettu projekti."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","targetLocale":"fi"} -->

## Luo ja lisää taso {#create-and-add-a-layer}

1. Valitse **Tiedosto → Uusi sommitelma** ja anna nimi, mitat, ruutunopeus
   ja kesto ruutuina.
2. Valitse **Taso → Uusi teksti** tai **Taso → Uusi väritaso**. Valitse
   kohdesommitelma, jos projektissa on useita sommitelmia.
3. Avaa **Taso → Teksti ja ulkoasu**, kun haluat muokata nykyistä tekstitasoa tai
   muodon täyttöjä ja reunaviivoja. Tässä tuodut kirjasimet säilytetään projektin mukana.

Käytä **Tiedosto → Tuo mediaa** kuva-, video- tai äänilähteille. Tuonti, joka
ylittää nykyiset dekooderi- tai muistirajat, hylätään selityksen kera;
alkuperäinen lähdetiedosto pysyy muuttumattomana.

## Animoi ja esikatsele {#animate-and-preview}

Avaa **Taso → Ominaisuudet ja avainruudut** valitaksesi tason ominaisuuden ja lisätäksesi
avaimia tarkkoihin ruutusijainteihin. Käyräsäätimet muuttavat interpolointia; spatiaalinen
muokkaus muuttaa sijaintipolkuja. **Näytä → Aikajana** avaa tason ajoituksen,
järjestyksen, ryhmittelyn ja työalueen säätimet.

Avaa **Näytä → Sommitelman piirtoalue** valitaksesi ja siirtääksesi staattista 2D-tasoa.
Neliö skaalaa tasoa ja ympyrä kiertää sitä määritetyn ankkurin ympäri. Jokainen
valmis veto on yksi kumoamisaskel; Escape peruuttaa vedon. Animoidut ja
lausekeohjatut muunnokset pysyvät kohdassa Ominaisuudet ja avainruudut.

Avaa **Näytä → Sommitelman esikatselu** hakeaksesi kohtaa tai toistaaksesi sommitelmaa. Esikatselu
käyttää säilytettyä lähdemediaa. Tukemattomat tai virheelliset kohtausasetukset tuottavat
virheen korvaavan kuvan sijaan. Sulje esikatselu vapauttaaksesi sen aktiiviset
renderöintiresurssit.

## Tallenna siirrettävä kopio {#save-a-portable-copy}

Valitse **Tiedosto → Tallenna** julkaistaksesi nykyisen version ja sitten **Tiedosto → Tallenna kopio**
ladataksesi `.mscape`-arkiston. Arkisto sisältää projektin ja sen uudelleenavaamiseen tarvittavan
alkuperäisen median. Avaa se **Tiedosto → Avaa** -komennolla toisella laitteella tai
uudesta selainkirjastosta.

## Renderöi {#render}

Valitse **Tiedosto → Renderöi**. Valitse sommitelma, tulostusmuoto ja
ruutuväli. Loppuruutu ei sisälly: ruudut 0–29 käyttävät väliä
`0`–`30`. Murto-osainen työalue valitsee sisältämänsä kokonaislukuiset näyteajat;
aluetta, jossa ei ole tulosnäytteitä, on muutettava ennen renderöintiä.

Käytä alfalle **Läpinäkyvä PNG-sarja (.tar)** -muotoa. Pura TAR-arkisto
saadaksesi tavalliset PNG-kuvat ja ajoitusmetatiedot. MP4 ja WebM käyttävät valintaikkunassa
valittua taustaväriä. Renderöinti kiinnittää lähetetyn version, jotta myöhemmät
muokkaukset eivät muuta jo käynnissä olevaa tulostetta. Renderöintivalintaikkunan sulkeminen
jättää työn käyntiin. **Tiedosto → Renderöintijono** näyttää edistymisen, peruutuksen,
lähetetyn version uudelleenyrityksen ja valmiit lataukset. Editorin sulkeminen
peruuttaa keskeneräiset työt.

Palaa [Motionscaper-käsikirjaan](/motionscaper/).
