---
title: "Web vai työpöytä"
description: "Ymmärrä, miten selain- ja paketoidut työpöytäversiot tallentavat projektit ja käyttävät tiedostoja."
sidebar:
  order: 2
---

<!-- docs-ai-provenance: {"model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","targetLocale":"fi"} -->

Molemmat versiot käsittelevät projektit paikallisesti. Niiden tallennus ja tiedostojen käyttö eroavat toisistaan.

## Selaineditori

Selainversio säilyttää projektit, tallenteet ja tuodun median alkuperäkohtaisessa yksityisessä selaintallennuksessa. Se ei lataa projektia Soundscaper-tilille, eikä tiliä tarvita.

Käytä selaineditoria, kun haluat aloittaa heti asentamatta sovellusta. Muista, että selaimen tallennukseen vaikuttavat selaimen kiintiö- ja poistamissäännöt. Sivuston tietojen tyhjentäminen poistaa paikallisen projektikirjaston.

## Työpöytäesikatselu

Paketoidut työpöytäesikatselut säilyttävät automaattisesti tallennetun paikallisen kirjaston työpöytäsovelluksessa. Ne sisältävät editorin ajonaikaisen ympäristön ja julkaistut käännökset offline-muokkausta varten.

Työpöytäpaketteja ei ole allekirjoitettu. macOS käyttää vain tunnisteetonta ad hoc -koodisinettiä, jota lataaja tarvitsee Electronin ja natiivien binäärien suorittamiseen; sinetti ei väitä mitään julkaisijasta tai luotettavuudesta. Siksi Windows SmartScreen tai macOS Gatekeeper voi näyttää tuntemattoman kehittäjän varoituksen esikatselu- ja vakaissa paketeissa.

`.aup4`-tiedoston avaaminen tuo erillisen projektin työpöytäkirjastoon. Myöhemmät muokkaukset eivät kirjoita avaamaasi tiedostoa uudelleen. **Save** päivittää kirjastokopion; **Save As** luo uuden Audacity-vaihtotiedoston.

## Puhelimet ja tabletit

Selaineditori säilyttää työpöytäasettelunsa kaikilla näytöillä, mutta alle 900 pikselin levyisenä (puhelimessa tai pystyasennossa pidetyllä tabletilla) se kokoaa käyttöliittymän laatikoiksi, jotta aikajanalle jää tilaa:

- Vasemman yläkulman **Menu**-painike avaa laatikon, jossa ovat koko sovellusvalikko, projektivälilehdet, toimintopalkki ja työkalupalkki. Toisto, pysäytys, tallennus ja haku pysyvät palkissa. Komennon valitseminen sulkee laatikon.
- Raitojen otsikot liukuvat kaistojen päälle aikajanan vasemman yläkulman **Track headers** -kahvasta tai kohdasta **View › Track headers**. Kaistojen napauttaminen tai Escapen painaminen piilottaa ne jälleen.
- Editorin yläpuolinen johdanto on kapeilla näytöillä oletuksena supistettu; **Show introduction** tuo sen takaisin näkyviin.

**Edit › Preferences › Appearance › Layout** vaihtaa tilojen Automatic, Compact ja Desktop välillä, joten pieni työpöytäikkuna voi säilyttää työpöytänäkymän ja leveä tabletti voi käyttää laatikoita.

## Projektit eivät siirry automaattisesti

Selain- ja työpöytäkirjastot ovat erilliset. Siirrä projekti tarkoituksella:

- Käytä Scape-projektitiedostoa — Soundscaperin `.sscape` tai Framescaperin `.fscape` — koko projektia varten.
- Käytä AUP4:ää, kun tarvitset nimenomaan äänen vaihtoa Audacityn kanssa.
- Vie renderöity ääni tai video kestävää toistokopiota varten.

Katso [Projektitiedostot](/projects-and-data/project-files/) ennen selaimen sivustotietojen tai työpöytäsovelluksen tietojen poistamista.
