---
title: "Makro-ohjelmat"
description: "JavaScript API, jonka makro-ohjelma ajaa, rajoitukset, joiden alaisena se toimii, ja tiedosto, jonka sisällä se kulkee."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"fi"} -->

Makro-ohjelma on makro, joka on kirjoitettu JavaScriptinä sen sijaan, että se olisi askelista koostuva lista.
Se ajetaan editorin sisällä pienen API:n `sound` kautta, jonka avulla se voi lukea
aukeaman projektin, siirtää valintaa ja soveltaa samoja efektejä ja komennoita, joita
askelista koostuva makro voi soveltaa. Kaikki muu, kuten tiedostot ja verkko sekä
muut projektisi, ovat sen ulottuvuuden ulkopuolella.

Ohjelmat ovat Soundscaper-ominaisuus. Framescaperissa ei ole makrohallintaa.

## Missä ohjelmat sijaitsevat

Valitse **Työkalut → Makrohallinta**. Dialogi luetellaan askelista koostuvat makrot ja
**Ohjelmat** -osion alla ohjelmat, jotka olet tallentanut. Paina **+ (Uusi ohjelma)**
Ohjelmat-otsikossa luodaksesi ohjelman. Samassa toimintapalkissa on valitulle ohjelmalle
**Tuo ohjelma**,
**Vie ohjelma** ja **Poista ohjelma** -toiminnot.
Yksityiskohtapaneelissa näkyy **Ohjelman nimi**, **Ohjelma** -teksti ja **Suorita
ohjelma** -painike. Teksti tallentuu kirjoittaessasi; erillistä tallennusaskelta ei ole.

Ohjelma tallennetaan editorin asetusten yhteyteen, ei projektin sisään, joten se on
käytettävissä jokaisessa tässä editorissa avaamassasi projektissa. Käytä **Vie ohjelma** - ja
**Tuo ohjelma** -toimintoja siirtääksesi ohjelman toiseen koneeseen tai toiselle henkilölle; katso
[Ohjelmien jakaminen](#sharing-programs) tietääksesi, mitä tämä sisältää.

[Samat efektit ketjutettuna joka kerta](/guides/effects/apply-the-same-effects-every-time/)
-oppaan käsittelee saman dialogin askelista koostuvan puolen.

## Ohjelman kirjoittaminen

Ohjelma on `async` -funktion runko, joka ajetaan tiukassa tilassa. Tämä tarkoittaa, että voit
`await` ylimpällä tasolla, määritellä muuttujat ja funktiot ja käyttää kaikkia
yleisiä kielen ominaisuuksia. `sound` -objekti on ohjelman ainoa yhteys
editoriin, ja jokainen sen kutsu palauttaa lupauksen.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Tab-silmukka lisää kaksi välilyöntiä ohjelmakenttään. Paina Escapeta ja sen jälkeen Tab-silmukkaa poistumaaksesi kentästä.

### Minkä ohjelma voi käyttää

Tavallinen JavaScript-standaardikirjasto on käytettävissä: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, tyyppitetyt taulukot, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` ja `queueMicrotask`. `console`
On myös käytettävissä, ja siihen kirjoitettu päätyy ohjelman lokkiin.

### Minkä ohjelma ei voi käyttää

Ohjelma ajetaan työntekijässä, jolta on poistettu sen kyvykkyydet ennen ensimmäisen rivin suorittamista. Mikään seuraavista ei ole ohjelman sisällä: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` ja `setInterval`. Minkään näiden lukeminen antaa `undefined`.

Ohjelma ei voi `import` moduulia; staattinen `import` on syntaksivirhe rivillä, jossa se esiintyy. Kaikki, mitä ohjelma tarvitsee, on oltava ohjelman sisällä.

Turvaraja ei ole puuttuvat globaalit muuttujat, vaan itse editor: se
vastaa vain tämän sivun lueteltuihin kutsuihin ja hylkää kaiken muun nimen perusteella,
riippumatta siitä, mitä ohjelma onnistuu lähettämään sille.

## Ohjelman suorittaminen

Paina **Suorita ohjelma**. Koko suoritus on yksi merkintä projektin historiassa, joten
yksi **Kumoa** kumoo kaiken, mitä ohjelma teki, riippumatta siitä, kuinka monta muutosta se teki.
Jos ohjelma heittää poikkeaman, se peruutetaan tai se ylittää aikarajansa, projekti palautetaan
täsmälleen siihen tilaan, jossa se oli ennen suorituksen alkua.

**Peruuta suoritus** pysäyttää ohjelman välittömästi. Ohjelma, joka on ollut käynnissä kaksi
minuuttia, pysäytetään samalla tavalla viestillä *Makro ajoi pidempään kuin
120 sekuntia.*

Suorituksen jälkeen paneeli näyttää ohjelman lokin, jota seuraa *Ohjelma sovellettiin.*
kun suoritus on valmis. Epäonnistunut suoritus näyttää *Ohjelma epäonnistui rivillä N:* ja
virheen viestin, jossa rivinumero on ohjelmasi rivi, joka heitti poikkeaman.

### Minkä äänen efekti koskee

Ohjelman soveltama efekti suoritetaan nykyiselle aikavalinnalle
aktiivisella raidalla, joka on se raita, jonka otsikon viimeksi napsautit tai jonka leikkeen
viimeksi valitsit. Kun aikavalintaa ei ole mutta leike on valittu, efekti
kattaa sen leikkeen. Ohjelman valintakutsut muuttavat aikaväliä ja
valittujen raiteiden joukon, mutta eivät sitä, kumpi raita on aktiivinen, joten yksi suoritus käsittelee
yhden raidan. Jos mitään ei ole aktiivisena tai valinta on tyhjä, suoritus epäonnistuu
samalla viestillä, jonka Efekti-valikko antaa.

## `sound` API

Jokainen alla oleva menetelmä palauttaa lupauksen, ellei toisin mainita. Odota jokainen kutsu
ennen seuraavaa; ohjelma, joka aloittaa yli kahdeksan kutsua ilman odotusta, hylätään yhdeksännen kohdalla.

### `sound.env`

Tavallinen objekti, joka kuvaa suoritusta.

| Kenttä | Merkitys |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | Editorin käyttökieli, kuten `"en"` tai `"de"`. |
| `seed` | Siemen, josta suorituksen satunnaisluvut tulevat. Uusi jokaiselle suoritukselle. |
| `startedAt` | Kellonaika, jolloin suoritus alkoi, ISO 8601 -merkkijonona. |
| `dryRun` | Tällä hetkellä aina `false`. Varattu. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` ja `sound.log.debug(...values)` kirjoittavat yhden rivin
kukin suorituksen lokiin. `console.log`, `console.info`, `console.warn`,
`console.error` ja `console.debug` tekevät saman. Arvot, jotka eivät ole merkkijonoja,
kirjoitetaan JSON-muodossa. Nämä menetelmät eivät palauta mitään eikä niitä tarvitse odottaa.

Loki sisältää enintään 1 000 riviä tai 256 KiB, kumpi tulee ensin, ja jokainen rivi
katkaistaan 4 096 merkin kohdalla. Rivit, jotka ylittävät tämän, hylätään ja lasketaan; lukumäärä
raportoidaan lopullisena varoituksena.

### `sound.project`

Projektin lukeminen ei muuta sitä eikä se lasuta suorituksen muutosbudjettia.

`sound.project.snapshot()` palauttaa `{ sampleRate, tracks, selection }`, jossa
`tracks` ja `selection` ovat ne, jotka kaksi seuraavaa kutsua palauttavat. `sampleRate` on
projektin näytetaajuus hertzeinä, mikä on se, jolla kaikki tämän sivun kehysluvut mitataan.

`sound.project.tracks()` palauttaa raiteiden taulukon aikajanan järjestyksessä:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` palauttaa leikkaukset yhdellä raidalla tai kaikilla radoilla, kun `trackId` on jätetty pois:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` palauttaa nykyisen valinnan:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Jokainen valintakutsu lasketaan yhteen muutokseksi ja palauttaa tuottamansa valinnan
muodossa, jonka `sound.project.selection()` palauttaa.

`sound.select.time(start, end, options)` asettaa aikavälin sekunteina. Se on
Audacityn `SelectTime`-komento, ja `options.relativeTo` valitsee, mistä jokainen
reuna mitataan. Molemmat reunat voivat olla korkeintaan -100 sekuntia.

| `relativeTo` | Alku-reuna | Loppu-reuna |
| --- | --- | --- |
| `'project-start'` (oletus) | `start` sekuntia projektin alusta | `end` sekuntia projektin alusta |
| `'project'` | `start` sekuntia projektin alusta | `end` sekuntia projektin lopun jälkeen |
| `'project-end'` | `start` sekuntia ennen projektin loppua | `end` sekuntia ennen projektin loppua |
| `'selection-start'` | `start` sekuntia valinnan alun jälkeen | `end` sekuntia valinnan alun jälkeen |
| `'selection'` | `start` sekuntia valinnan alun jälkeen | `end` sekuntia valinnan lopun jälkeen |
| `'selection-end'` | `start` sekuntia ennen valinnan loppua | `end` sekuntia ennen valinnan loppua |

Projektin loppu on viimeinen kehys, jonka jokin leike saavuttaa. Valitut raidat jätetään
sellaisiksi kuin ne olivat.

`sound.select.frames(startFrame, endFrame, options)` asettaa aikavälin
kehyksinä projektin näytteenottotaajuudella. `options.trackIds` nimittää valittavat raidat;
kun se jätetään pois, jo valitut raidat pysyvät valittuina.
Aikaväli rajataan aikajanaan, ja reunat vaihdetaan, jos ne ovat käänteisessä järjestyksessä.

`sound.select.tracks(options)` on Audacityn `SelectTracks`-komento. Se valitsee
raidat, joiden indeksi (laskettuna 0:sta) on välillä `options.track`
(oletus 0) kattavassa `options.trackCount` raidassa (oletus 1). `options.mode` on
`'set'` korvaamaan raidanvalinta, `'add'` laajentamaan sitä tai `'remove'` poistamaan
ne raidat siitä. Aikaväli jätetään sellaiseksi kuin se oli.

`sound.select.frequencies(options)` on Audacityn `SelectFrequencies`-komento.
Se asettaa spektrivalinnan `options.low` ja `options.high` hertseissä;
reuna, jonka jätät pois, säilyttää nykyisen arvonsa.

`sound.select.all()` valitsee koko projektin kaikilla radoilla.
`sound.select.none()` tyhjentää valinnan.

### `sound.effect(type, params)`

Sovettaa yhden efektin nykyiseen valintaan fokusoitulla radalla. `type` on
efektin tunnus osoitteesta [Effects a program can apply](#effects-a-program-can-apply),
ja `params` on objektin, joka sisältää sen efektin parametrit. Parametrit, jotka jätät pois, ottavat
efektin oletusarvot; arvot tarkistetaan välien mukaan
[ääniefektien viitteen](/reference/generated/audio-effects/). Ratkeaa
`null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Soveltaa efektit ketjun nykyiseen valintaan yhdellä kerralla, täsmälleen samalla tavalla kuin askel-lista-makro, jossa on kyseiset askeleet. Jokainen askel on `{ type, params }`, ja ketjun on sisällettävä vähintään yksi askel. Palauttaa `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Suorittaa yhden Audacityn makrokomennoista, jotka on lueteltu kohdassa
[Komennot, jotka ohjelma voi suorittaa](#commands-a-program-can-run). Nämä neljä valintakomentoa ottavat siellä kuvatut parametrit; muut eivät ota parametreja. Palauttaa valinnan sen jälkeen.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Suorittaa samassa makrohallinnassa tallennetun vaihelistan makron sen tarkan nimen perusteella, mukaan lukien kaikki siinä olevat valintakomennot. Tallennettu makro ei voi itse olla ohjelma, joten ohjelmat eivät sisälly toisiinsa. Ratkeaa arvoon `null`; tuntematon nimi hylätään.

### Aika ja satunnaisuus

Suoritus on toistettava: saman ohjelman kaksi suoritusta samassa projektissa lukevat saman, koska kello ja satunnaisluvut eivät ole koneen. `Date.now()` ja `new Date()` ilman argumentteja palauttavat virtuaalikellon, joka alkaa arvosta 0 ja etenee yhdellä jokaiselle muokkajalle tehtyä vastausta kohti sekä `ms` jokaiselle `sound.wait(ms)`. `sound.wait` ratkeaa välittömästi; ohjelmalla ei ole tapaa pysähtyä todelliseen aikaan, eikä sitä tarvita, koska jokainen muokkajalle tehty kutsu on valmis ennen lupauksen ratkeamista.

`Math.random()` ja `sound.random()` ovat sama generattori, joka on siemenetty arvolla `sound.env.seed`. Kirjaa siemen, jos haluat tietää, mitä jonoa suoritus käytti.

### Oletustesi tarkistaminen

`sound.assert(condition, message)` heittää `message` kun `condition` on epätosi. `sound.assertEqual(actual, expected, message)` vertaa kaksi arvoa JSON:ina ja heittää virheen, jos ne eroavat toisistaan, viestillä, joka nimittää molemmat arvot, jos et anna omaa viestiä. Koska heitetty virhe lopettaa suorituksen ja kumoo kaiken sen edeltäneen, epäonnistunut väite jättää projektin koskemattomaksi. Kumpikaan menetelmä ei palauta lupauksen objektia.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Arvot, jotka siirtyvät editoriin

Jokainen argumentti, jonka ohjelma välittää, ja jokainen arvo, jonka se vastaanottaa, on pelkkää dataa:
`null`, totuusarvot, äärelliset luvut, merkkijonot sekä näiden taulukot ja pelkät objektit.
`NaN`, `Infinity`, funktiot, luokkien instanssit, tyypitetyt taulukot ja `Date`
objektit hylätään virheellä, samoin kuin mikä tahansa arvo, joka on suurempi kuin 1 MiB, syvempi kuin 12 tasoa tai sisältää enemmän kuin 4 096 kohdetta yhdessä taulukossa tai objektissa.
`undefined`-ominaisuudet jätetään pois.

## Rajat

| Raja | Arvo |
| --- | --- |
| Ohjelman pituus | 256 KiB |
| Kutsuja editoria kohti ajokerran aikana | 4 096 |
| Muutoksia projektiin ajokerran aikana (valintakutsut, efektit, komennot) | 256 |
| Vastauksen odottavia kutsuja kerralla | 8 |
| Suoritusaika | 120 sekuntia |
| Yksi arvo, joka siirtyy editoriin tai siitä pois | 1 MiB, 12 tasoa syvällä, 4 096 kohdetta taulukkoa tai objektia kohti |
| Loki | 1 000 riviä tai 256 KiB; 4 096 merkkiä riviä kohti |
| Ohjelmia kirjastossa | 128 |
| Ohjelman nimi | 256 merkkiä |
| Tuotu ohjelmatiedosto | 1 MiB |

Silmukka, joka valitsee jokaisen leikkauksen ja soittaa yhden efektin, käyttää kahta muutosta leikkausta kohti, joten se voi kattaa 128 leikkausta ennen kuin budjetti loppuu.

## Virheet

Kutsu, jonka editori hylkää, hylkää sen luvauksen `Error`-virheellä, jonka `message`
selittää syyn: komento sanaston ulkopuolelta, efekti tyhjälle valinnalle, parametri alueen ulkopuolella. Virhe sisältää myös `code`, joka on
`MACRO_CALL_FAILED`, ellei editori ole toimittanut tarkempaa. Ohjelma
voi ottaa nämä virheet ja jatkaa:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Ohjelma päättyy, ja sen lokissa lukee *refused: Unsupported macro command:
ExportWav.*

Virhe, jonka ohjelma ei käsittele, keskeyttää ajon, palauttaa projektin ja näytetään paneelissa yhdessä sen rivin kanssa, josta se tuli. Ohjelma, joka ei käännä, ilmoitetaan samalla tavalla ennen kuin mitään ajetaan.

## Ohjelman soveltamat efektit {#effects-a-program-can-apply}

Nämä ovat efektitunnisteet `sound.effect` ja `sound.effects` hyväksyvät, yhdessä niiden parametritunnisteiden ja oletusarvojen kanssa. Arvovälit ja yksiköt löytyvät
[ääniefektien viiteasiakirjasta](/reference/generated/audio-effects/). Nyquist-liitännäisiä ei voi soveltaa ohjelmasta.

| Efekti | Efektitunniste | Parametrit ja oletusarvot |
| --- | --- | --- |
| Vahvenna | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Automaattinen hiljennys | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Basso ja diskantti | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Sävelkorkeuden muutos | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Nopeuden ja sävelkorkeuden muutos | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Tahtitason muutos | `audacity-change-tempo` | `tempoPercent: 0` |
| Klassiset suodattimet | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Klikkien poisto | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Kompressori | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Viive | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Vääristymä | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Kaiku | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Fade In | `audacity-fade-in` | ei mitään |
| Fade Out | `audacity-fade-out` | ei mitään |
| Suodatin käyrä EQ | `audacity-filter-curve-eq` | `points`: taulukko `{ frequency, gain }`, oletusarvoisesti kaksi tasoa 20 Hz:n ja 20 kHz:n kohdalla; `linearFrequencyScale: false`; `filterLength: 8191` |
| Neljän kaistan parametrisointi EQ | `eq` | `outputGain: 0`; `bands`: neljä `{ id, enabled, type, frequency, gain, q, slope }`-objektia, huiput 100, 500, 2000 ja 8000 Hz:n kohdalla `gain: 0`, `q: 1`, `slope: 12` |
| Gate | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Graafinen EQ | `audacity-graphic-eq` | `gains`: 31 kaistan vahvistukset dB:ssä, kaikki 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| Korkean taajuuden suodatin | `highpass` | `frequency: 80`, `q: 0.707` |
| Käännä | `audacity-invert` | ei mitään |
| Legacy-kompressori | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limittari | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Äänenvoimakkuuden normalisointi | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Matalan taajuuden suodatin | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Melunpoisto | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalisoi | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Faasi | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| DC-poiston poisto | `audacity-remove-dc-offset` | ei mitään |
| Korjaa | `audacity-repair` | ei mitään |
| Toista | `audacity-repeat` | `count: 1` |
| Kaiku | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Kaiku (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Käännä | `audacity-reverse` | ei mitään |
| Liukuva venytys | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Truncate Silence | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Utility Gain (Reviewed) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Kahden efektin kohdalla on tarve jostakin, mitä ohjelma ei voi tarjota. Melunvaimennus (Noise Reduction) vaatii meluprofiilin, joka on tallennettu efektin omaan dialogiin, ja Auto Duck vaatii ohjausraidan, joka on fokusoitua raidaa alempana.

## Ohjelman ajamat komennot {#commands-a-program-can-run}

`sound.command` hyväksyy alla olevat Audacityn makrokomenot. Ne ovat samoja nimiä, joita vaihelistan makro voi sisältää, joten ohjelman ja vaihelistan toimintapiiri on täsmälleen sama. Jokainen komento suorittaa toiminnon, jonka [komentoviittaus](/reference/generated/commands/) kuvaa.

### Valintakomennot parametreineen

| Komento | Parametrit |
| --- | --- |
| `SelectTime` | `start`, `end` sekunteina; `relativeTo` kuten `sound.select.time` |
| `SelectFrequencies` | `low`, `high` hertseissä |
| `SelectTracks` | `track`, `trackCount` (0–100); `mode` joko `'set'`, `'add'` tai `'remove'` |
| `Select` | Mikä tahansa yhdistelmä yllä olevista kolmesta joukosta |

Jos jätät parametrin pois, valinnan kyseinen osa jää koskematta, mikä on myös se tapa, jolla Audacity lukee ne.

### Komennot ilman parametreja

| Ryhmä | Komennot |
| --- | --- |
| Valinta | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Muokkaus | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Raidat | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Tunnisteet | `AddLabel` |
| Analyysi | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Mitä on tarkoituksella jätetty pois

`Undo` ja `Redo` puuttuvat, koska suoritus on jo yksi historiankirjamerkintä ja vaihe, joka kulki historian läpi, ulottuisi suorituksen yli omiin muokkauksiisi. Kuljetus- ja tallennuskomennot puuttuvat, koska ohjelmalla ei ole mitään, jolle odottaa, eikä sitä voi kumota tallennuksen ulkopuolelle. Avaa, tallenna, sulje, tuota, vie ja asetukset puuttuvat, koska ohjelman toimintapiiri on se yksi projekti, joka oli auki sen käynnistyessä. Komennot, jotka ainoastaan avaavat dialogin tai muuttavat näkymää, puuttuvat, koska ne eivät muuta mitään projektissa.

## Ohjelmien jakaminen {#sharing-programs}

**Vie ohjelma** kirjoittaa valitun ohjelman `.soundscapemacro`-tiedostoksi, ja
**Tuo ohjelma** lukee yhden. Tiedosto on JSON eikä pelkkä `.js`-tiedosto, jotta
vastaanottavan tietokoneen ei tulisi sekoittaa sitä johonkin, joka ajetaan muualla kuin muokkajassa:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

Tuonti tallentaa vain tekstin. Tuodulla ohjelmalla ei ole **Suorita
ohjelma** -painiketta; sen sijaan paneelissa näkyy ohjelma, tiedosto, josta se on peräisin,
huomautus siitä, mitä ohjelma voi tehdä avoimeen projektiin, ja valintaruutu, jossa lukee *Olen
lukenut tämän ohjelman ja haluan suorittaa sen.* Valintaruudun valitseminen ottaa käyttöön **Ota tämä
ohjelma käyttöön**, ja vasta sitten ohjelma voidaan suorittaa.

Tämä lupa koskee tarkkaa tekstiä, jonka luit. Jos ohjelma muuttuu
myöhemmin, olitpa sitten muokkaamassa sitä tai tuomassa uudemman kopion sen päälle, tarkistus
näkyy uudelleen, kunnes otat uuden tekstin käyttöön. Ohjelmat, jotka kirjoitat itse hallitsijassa,
eivät vaadi tarkistusta.

## Esimerkkejä

Vaimenna kaikki leikkaukset ensimmäisellä raidalla, jolla niitä on. Valitse sen raidan otsake
ennen suorittamista, jotta efekti osuu siihen raitaan, jota ohjelma lukee:

```js
let target = null;
let clips = [];
for (const track of await sound.project.tracks()) {
  clips = await sound.project.clips(track.id);
  if (clips.length) {
    target = track;
    break;
  }
}
sound.assert(target, 'There are no clips to fade.');
for (const clip of clips) {
  await sound.select.frames(clip.startFrame, clip.startFrame + clip.durationFrames, {
    trackIds: [target.id],
  });
  await sound.effect('audacity-fade-in');
  sound.log.info(`Faded in ${clip.name} on ${target.name}`);
}
```

Raportoi projektista muuttamatta sitä:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Suorita tallennettu vaihelistomakro vain, jos valinta on tarpeeksi pitkä:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## Tietoja tästä sivusta

Jokainen ohjelma tässä sivussa, yksirivisistä kappaleista valmiisiin esimerkkeihin,
ajoitetaan Soundscaperin jokaisen buildin yhteydessä selaimen testisarjalla
(`tests/browser/handbook-macro-program-examples.spec.js`), joka lukee ohjelmat tämän sivun omasta tekstistä. Ohjelma, joka ei enää valmiinny tai ei enää tuota sitä, mitä tämä sivu väittää sen tuottavan, epäonnistuttaa buildin, kunnes sivu tai editor on korjattu.
