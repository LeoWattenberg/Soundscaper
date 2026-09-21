---
title: "Paikallinen käsittely, mallit ja lisäosat"
description: "Etsi paikallista apua tehtävän mukaan ja hallitse malleja ja lisäosia työpöytätoimittimissa."
---
<!-- docs-ai-provenance: {"factPacketSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","targetLocale":"fi"} -->

Paikallinen avustus toimii laitteellasi Soundscaper- ja Framescaper-pöytätietokoneiden muokkaustyökaluissa. Valitse media ja valitse sitten tehtävä sen valikosta. Dialogi näyttää valinnan, tehtävän asetukset ja sen, onko sen mallit asennettu.

Pöytätietokoneen paketteihin sisältyvät natiivit käsittelymoottorit julkaistuille paikallisille malleille. Asenna mallin painot Model Manager -työkalun kautta ja suorita sitten tehtävä valitsemallasi medialla. Katso kunkin mallin [opas](/reference/local-models/) tuetuista alustoista, valikkotavasta ja vaatimuksista.

## Etsi tehtävä {#find-a-task}

| Valikko | Tehtävät |
| --- | --- |
| Effect → Noise removal and repair | Enhance Dialogue, Reduce Reverb, Clean Filler & Silence |
| Effect → Source Separation | Separate Dialogue / Music / Effects |
| Analyze → Speech | Transcribe & Captions, Identify Speakers, Mark Reactions |
| Analyze → Music | Detect Beats & Tempo |
| Analyze → Video | Mark Cuts |
| Effect → Video effects | Reframe |
| Edit | Make Highlights |
| Generate | Generate Editorial Text |
| Tools → Search | Indexed Search, Index Transcript, Index Video |

Video-tehtävät kuuluvat Framescaperiin. Käytettävissä olevat komennot riippuvat pöytätietokoneen ajonaikaisesta ympäristöstä ja tuotteen ominaisuuksista. Soundscaperin aakkosjärjestyksessä oleva efektivalikkovaihtoehto järjestää myös paikalliset käsittelyefektit nimen mukaan.

Valitse **Run locally** käynnistääksesi käsittelyn ja vastataksesi paikalliseen suostumuksen pyyntöön. Voit peruuttaa käsittelyn aikana. Valitse **Review result**, valitse haluamasi tulokset ja valitse **Apply selected**. Hyväksytyt projektimuutokset voi kumota. Tehtävän sulkeminen ei sovelleta sen ehdotuksia.

**Tools → Advanced Local Processing** säilyttää yksittäiset operaatio- ja mallivalitsimet. Tekniset tiedot tehtävän dialogeissa näyttävät taustalla olevat vaiheet ja tarkat asetukset tarvittaessa.

## Hallitse malleja {#manage-models}

Avaa **Tools → Model Manager** tai käytä **Manage Models** -toimintoa tehtävän sisällä. Tehtävän linkki suodattaa listan yhteensopiviin mallitunnisteisiin; **Show all models** poistaa tämän rajoituksen. Hae nimen tai tehtävän mukaan ja suodata asennustilan mukaan.

Asenna mallit eksplisiittisesti. Lataukset näyttävät edistymisen ja ne voi peruuttaa. Paluu tehtävään säilyttää sen asetukset ja päivittää mallien saatavuuden; se ei käynnistä käsittelyä. Laajenna **Storage and verification** korjausta, siivousta, tallennustilan siirtoa, lisenssitiedoksia ja offline-asennusta kansioista varten.

Katso [yksittäiset malliohjeet](/reference/local-models/) kunkin julkaistun mallin tarkoituksesta, valikkotavasta, latauskokosta, vaatimuksista, rajoituksista ja yöllä testeillä suoritettavasta pöytätietokoneen paketin todellisista päättelytarkistuksista.

## Hallitse liitännäisiä ja laitteita {#manage-plugins-and-devices}

**Effect → Plugin Manager** listaa ääniliitännäiset Soundscaperissa ja OpenFX-liitännäiset Framescaperissa. Hae tai suodata listaa ja valitse sitten liitännäinen sen version, luvan ja palautuksen hallintaa varten. **Scanning & Settings** sisältää havaitsemisasetukset. Hallinta on edelleen saatavilla, vaikka käsittely olisi poistettu käytöstä.

Käytä ääniliitännäisiä **Effect → Audio Plugins** -toiminnolla. Framescaperin Add/Edit video effect -komennot ovat edelleen **Effect → Video effects** -valikossa.

Avaa **Edit → Preferences → Audio settings** natiiveja äänilaitteita ja apukontrollia varten. **Media** sisältää natiivit media-asetukset; **Effects** linkittyy Plugin Manageriin ja sisältää liitännäishavaintokytkimen. Liitännäisluvat ja karanteenipalautus vaativat silti eksplisiittisiä toimia.
