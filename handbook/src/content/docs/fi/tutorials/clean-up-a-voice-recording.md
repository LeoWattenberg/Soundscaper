---
title: "Siivoa äänitallennusta"
description: "Poista humina otoksesta, leikkaa rumpu pois, säädä äänenvoimakkuus podcast-tasolle ja vie tiedosto MP3-muodossa."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"fi"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

Useimmat kotona tehdyt nauhoitukset vaativat kolmea samaa korjausta: tasaisen taustamelun poistamista, matalan matalan taajuuden suodattamista ja tason nostamista standardiin. Tämä opastus suorittaa kaikki kolme kolmen sekunnin esimerkkinauhoitukselle, jonka ensimmäinen puoli sekuntia on pelkkää huonemelua, ja vie tuloksen MP3-tiedostona.

:::tip[Mitä tarvitset]
- Lataa [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — lyhyt nauhoitus, jonka ensimmäinen puoli sekuntia on huonemelua ennen kuin ääni alkaa.

Jokainen alla oleva vaihe toimii näillä tiedostoilla sellaisenaan, joten näkemäsi tulisi vastata opastuksen sisältöä. Soundscaper toimii selaimessa; asennusta ei tarvita.
:::

## Mitä opit

- Miksi kohinanpoisto profiilin ja miten sen antaa.
- Mitä korkeapääsuodatin poistaa ja missä asettaa se puheelle.
- Ero huipputason ja äänenvoimakkuuden välillä ja miten saavuttaa äänenvoimakkuustavoitteen.
- Miten viedä MP3-tiedosto.

## Vaiheet

1. Avaa Soundscaper. Uusi, tyhjä projekti on valmis heti, kun muokkaja latautuu.
2. Valitse **Tiedosto → Tuo ääni** ja valitse `guide-noisy-take.wav` — lyhyt nauhoitus, jonka ensimmäinen puoli sekuntia on huonemelua ennen kuin ääni alkaa. Tiedosto tulee leikkeenä omalle raidalleen.
3. Paina **Toista** kuuntelemaan, sitten **Pysäytä**.
   *Sinun tulisi nähdä:* Puoli sekuntia hissiä, sitten tasainen sävy, joka edustaa ääntä, hissin alla.
4. Vedä viivoittimen päällä leikkeen yläpuolella alusta 15 %:n merkkiin valitaksesi pelkän kohinan johdannon. Profiilin tulee sisältää ainoastaan poistettava kohina — ei lainkaan ääntä.
5. Valitse **Efekti → Kohinanpoisto ja korjaus → Kohinanpoisto** ja paina **Hae kohinaprofiili**. Tilarivi ilmoittaa, että profiili on valmis. Paina **Sulje** poistumaaksesi dialogista toistaiseksi.
6. Valitse **Valinta → Valitse kaikki**. Profiili säilyy; nyt efekti tarvitsee tietää, mitä puhdistaa.
7. Valitse **Efekti → Kohinanpoisto ja korjaus → Kohinanpoisto**. **Kohinanpoisto**-dialogissa aseta **Kohinanpoisto** arvoon `12`, paina sitten **Sovita valintaan**. Kymmenen desibeliä on hyvä alkuperäinen asetus. Enemmän poistaa enemmän kohinaa, mutta tekee äänistä tyhjiä.
   *Sinun tulisi nähdä:* Johdanto on lähes tasainen ja sävy on koskematon.
8. Valitse **Efekti → Perinteiset efektit → Klassiset suodattimet**. **Klassiset suodattimet**-dialogissa valitse **Korkeapää** **Suodattimen tyyppi** -kenttään ja aseta **Leikkaustajuus** arvoon `100`, paina sitten **Sovita valintaan**. Kaikki alle 100 Hz:n — liikenne, käsittely, ilmastointi — karsiin. Puhe elää hyvin sen yläpuolella.
9. Valitse **Efekti → Taso ja kompressio → Äänenvoimakkuuden normalisointi**. **Äänenvoimakkuuden normalisointi**-dialogissa aseta **Tavoiteäänenvoimakkuus** arvoon `-16`, paina sitten **Sovita valintaan**. −16 LUFS on yleinen tavoite stereopodcasteille. Äänenvoimakkuus mittaa, kuinka kovaa koko nauhoitus tuntuu, ei kuinka korkeat sen huiput ovat.
   *Sinun tulisi nähdä:* Aaltomuoto on korkeampi ja nauhoitus soittaa mukavalla tasolla.
10. Paina **Toista** kuuntelemaan, sitten **Pysäytä**.
   *Sinun tulisi nähdä:* Puhdas, tasainen nauhoitus hiljaisella johdolla.
11. Valitse **Tiedosto → Vie ääni**, aseta **Muoto** arvoon **MP3** ja paina **Vie**. Tiedosto ladataan heti, kun renderöinti on valmis, ja sen linkki pysyy dialogissa. Tiedosto koodataan selaimessa; mitään ei lähetetä tietokoneeltasi.

## Mihin seuraavaksi

- Tee se omalla nauhoituksellasi ohjeiden avulla: [Poista taustamelu](/guides/cleaning-up/remove-background-noise/), [Poista matala matala taajuus](/guides/cleaning-up/remove-low-rumble/) ja [Normalisoi äänenvoimakkuus podcastille](/guides/volume/normalize-loudness-for-podcasts/).
- Tarkista tulos siten kuin alusta tekisi: [Mittaa, kuinka kovaa miksaus on](/guides/analysis/measure-loudness/).

## Muut opastukset

[Ensimmäinen Soundscaper-projekti](/tutorials/your-first-project/) — Tuo nauhoitus, kuuntele, jaa se, fadea se pois, vie tiedosto ja tallenna projekti.
[Laita musiikki äänen alle](/tutorials/put-music-under-a-voice/) — Kerroja kaksi raidetta, duckaa toinen toisen alle automaattisesti, mikkaa ne alas ja vie.

## Viitteet

- [Kaikki tässä käytettyjen efektien parametrit, niiden oletusarvot ja alueet, ovat ääniefektien viitteessä.](/reference/generated/audio-effects/#parameters)
- [Vientimuodot, niiden kontit ja kanavarajoitukset ovat vientimuotojen viitteessä.](/reference/generated/formats/)
- [Kaikki valikkokomennot ja niiden näppäimistön lyhenteet ovat komentojen ja lyhenteiden viitteessä.](/reference/generated/commands/)

## Tämän opastuksen tietoa

Tämä opastus toistetaan vaihe vaiheelta ja näillä tiedostoilla jokaisen Soundscaper-rakennuksen kohdalla selaimen testisarjalla (`tests/browser/soundscaper-tutorials.spec.js`). Jos vaihe lakkaa toimimasta, rakennus epäonnistuu, kunnes opastus on korjattu, joten mitä luet, on se, mitä muokkaja tekee.
