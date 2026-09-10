---
title: "Makro-ohjelmat"
description: "JavaScript API, jonka suhteen makro-ohjelma ajetaan, sen rajoitukset ja tiedosto, jossa se kulkee."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","targetLocale":"fi"} -->

Makro-ohjelma on makro, joka on kirjoitettu JavaScriptinä sen sijaan, että se olisi vaiheiden lista.
Se ajetaan editorin sisällä pienen API:n `sound` kautta, jonka avulla se voi lukea
aukeaman projektin, siirtää valintaa ja soveltaa samoja efektejä ja komentoja, joita
vaihelistan makro voi soveltaa. Kaikki muu, kuten tiedostot ja verkko sekä muut
projektisi, ovat sen ulottumattomissa.

Ohjelmat ovat Soundscaper-ominaisuus. Framescaperissa ei ole makrohallintaa.

## Missä ohjelmat sijaitsevat

Valitse **Työkalut → Makrohallinta**. Ikkunassa luetellaan vaihelistan makrot ja
**Ohjelmat** -osiossa tallentamasi ohjelmat. **Uusi ohjelma** luo uuden ohjelman, ja
yksityiskohtapaneelissa näkyy **Ohjelman nimi**, **Ohjelma** -teksti ja **Suorita
ohjelma** -painike. Teksti tallentuu kirjoittaessasi; erillistä tallennusvaihetta ei ole.

Ohjelma tallennetaan editorin asetusten yhteyteen, ei projektin sisään, joten se on
käytettävissä kaikissa tässä editorissa avaamissasi projekteissa. Käytä **Vie ohjelma** - ja
**Tuo ohjelma** -toimintoja siirtääksesi ohjelman toiseen koneeseen tai toiselle henkilölle; lue
[Ohjelmien jakaminen](#sharing-programs) siitä, mitä tämä vaatii.

[Samat efektit ketjutettuna joka kerta](/guides/effects/apply-the-same-effects-every-time/)
-oppaan kautta voit tutustua saman ikkunan vaihelistan puoleen.

## Ohjelman kirjoittaminen

Ohjelma on `async` -funktion runko, joka ajetaan tiukassa tilassa. Tämä tarkoittaa, että
voit `await` ylimpällä tasolla, määritellä muuttujia ja funktioita sekä käyttää kaikkia
yleisiä kielen ominaisuuksia. `sound` -objekti on ohjelman ainoa yhteys
editoriin, ja jokainen sen kautta tehty kutsu palauttaa lupauksen (promise).

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Tab-silmukka lisää ohjelmakenttään kaksi välilyöntiä. Poistu kentästä painamalla Escape-näppäintä ja sen jälkeen Tab-silmukkaa.

### Mitä ohjelma voi käyttää

Tavallinen JavaScriptin standardikirjasto on käytettävissä: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, tyyppitetyt taulukot, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` ja `queueMicrotask`. `console`
On myös käytettävissä, ja siihen kirjoitettu data tallennetaan ohjelman lokkiin.

### Mitä ohjelma ei voi käyttää

Ohjelma ajetaan työntekijässä, jolta on poistettu sen mahdollisuudet ennen ensimmäisen rivin suorittamista. Ohjelman sisällä ei ole olemassa mitään seuraavista: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` tai `setInterval`. Minkään näiden lukeminen palauttaa `undefined`.

Ohjelma ei voi `import` moduulia; staattinen `import` on syntaksivirhe rivillä, jossa se esiintyy. Kaikki, mitä ohjelma tarvitsee, on oltava ohjelman sisällä.

Turvaraja ei ole puuttuvat globaalit muuttujat, vaan itse editor: se vastaa vain tällä sivulla lueteltuihin kutsuihin ja hylkää kaiken muun nimen perusteella, riippumatta siitä, mitä ohjelma yrittää lähettää sille.

## Ohjelman suorittaminen

Paina **Suorita ohjelma**. Koko suoritus on yksi merkintä projektin historiassa, joten yhdellä **Kumoa**-toiminnolla kumotaan kaikki, mitä ohjelma teki, riippumatta siitä, kuinka monta muutosta se teki.
Jos ohjelma heittää poikkeaman, se peruutetaan tai se ylittää aikarajansa, projekti palautetaan täsmälleen siihen tilaan, jossa se oli ennen suorituksen alkua.

**Peruuta suoritus** pysäyttää ohjelman välittömästi. Ohjelma, joka on ollut käynnissä kaksi minuuttia, pysäytetään samalla tavalla viestillä *Makro toimi yli 120 sekuntia.*

Suorituksen jälkeen paneelissa näkyy ohjelman lokki, ja sen jälkeen *Ohjelma sovellettiin.*
kun suoritus on valmis. Epäonnistunut suoritus näyttää viestin *Ohjelma epäonnistui rivillä N:* ja
virheen viestin, jossa rivinumero on ohjelman rivi, joka heitti poikkeaman.

### Minkä äänen efekti koskee

Ohjelman soveltama efekti suoritetaan nykyiselle aikavalinnalle fokusoitua raidetta kohtaan, eli sitä raidetta, jonka otsikkoa viimeksi napsautit tai jonka leikkausta viimeksi valitsit. Jos aikavalintaa ei ole mutta leikkaus on valittu, efekti kattaa sen leikkauksen. Ohjelman valintakutsut muuttavat aikaväliä ja valittujen raiteiden joukon, mutta eivät sitä, kumpi raita on fokusoitu, joten yksi suoritus käsittelee yhden raidan. Jos mitään ei ole fokusoitu tai valinta on tyhjä, suoritus epäonnistuu samalla viestillä kuin Efekti-valikko antaa.

## `sound` API

Jokainen alla oleva menetelmä palauttaa lupauksen, ellei toisin mainita. Odota jokainen kutsu ennen seuraavan tekemistä; ohjelmasta, joka aloittaa yli kahdeksan kutsua ilman odotusta, hylätään yhdeksäs.

### `sound.env`

Tavallinen objekti, joka kuvaa suoritusta.

| Kenttä | Merkitys |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | Editorin käyttökieli, kuten `"en"` tai `"de"`. |
| `seed` | Siemen, josta suorituksen satunnaisluvut tulevat. Uusi jokaiselle suoritukselle. |
| `startedAt` | Suorituksen alkamisaika seinä kellonaikana ISO 8601 -merkkijonona. |
| `dryRun` | Tällä hetkellä aina `false`. Varattu. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` ja `sound.log.debug(...values)` kirjoittavat jokainen yhden rivin
suorituksen lokkiin. `console.log`, `console.info`, `console.warn`,
`console.error` ja `console.debug` tekevät saman. Merkkijonoiksi eivät ole arvot
kirjoitetaan JSON-muodossa. Nämä menetelmät eivät palauta mitään eikä niitä tarvitse odottaa.

Loki sisältää enintään 1 000 riviä tai 256 KiB, kumpi tulee ensin, ja jokainen rivi
katkaistaan 4 096 merkin kohdalla. Sen ylittävät rivit hylätään ja lasketaan; lukumäärä
raportoidaan lopullisena varoituksena.

### `sound.project`

Projektin lukeminen ei koskaan muuta sitä eikä se vähennä suorituksen muutosbudjettia.

`sound.project.snapshot()` palauttaa `{ sampleRate, tracks, selection }`, jossa
`tracks` ja `selection` ovat sellaisia, kuin kaksi seuraavaa kutsua ne palauttavat. `sampleRate` on
projektin näytetaajuus hertzeinä, jolla kaikki tämän sivun kehysluvut mitataan.

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
Audacityn `SelectTime`-komento, ja `options.relativeTo` valitsee, mistä
jokainen reuna mitataan. Molemmat reunat voivat olla niin alhaisia kuin -100 sekuntia.

| `relativeTo` | Alku-reuna | Loppu-reuna |
| --- | --- | --- |
| `'project-start'` (oletus) | `start` sekuntia projektin alusta | `end` sekuntia projektin alusta |
| `'project'` | `start` sekuntia projektin alusta | `end` sekuntia projektin lopun jälkeen |
| `'project-end'` | `start` sekuntia ennen projektin loppua | `end` sekuntia ennen projektin loppua |
| `'selection-start'` | `start` sekuntia valinnan alun jälkeen | `end` sekuntia valinnan alun jälkeen |
| `'selection'` | `start` sekuntia valinnan alun jälkeen | `end` sekuntia valinnan lopun jälkeen |
| `'selection-end'` | `start` sekuntia ennen valinnan loppua | `end` sekuntia ennen valinnan loppua |

Projektin loppu on viimeinen kehys, jonka jokin klippi saavuttaa. Valitut raidat jätetään
sellaisiksi kuin ne olivat.

`sound.select.frames(startFrame, endFrame, options)` asettaa aikavälin kehyksinä
projektin näytteenotostaajuudella. `options.trackIds` nimittää valittavat raidat;
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

`sound.select.all()` valitsee koko projektin jokaisella raidalla.
`sound.select.none()` tyhjentää valinnan.

### `sound.effect(type, params)`

Sovettaa yhden efektin nykyiseen valintaan fokusoitulla raidalla. `type` on
efektin tunnus osoitteesta [Effects a program can apply](#effects-a-program-can-apply),
ja `params` on objektin, joka sisältää sen efektin parametrit. Parametrit, jotka jätät pois, ottavat
efektin oletusarvot; arvot tarkistetaan välien suhteen
[audio effects reference](/reference/generated/audio-effects/). Ratkeaa
`null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Soveltaa efektit ketjun nykyiseen valintaan yhdellä kerralla, täsmälleen niin kuin
askel-lista-makro, jossa on kyseiset askeleet. Jokainen askel on `{ type, params }`, ja
ketjun on oltava vähintään yksi askel. Palauttaa `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Suorittaa yhden Audacityn makrokomennoista, jotka on lueteltu kohdassa
[Komennot, joita ohjelma voi suorittaa](#commands-a-program-can-run). Nämä neljä valintakomentoa ottavat siellä kuvatut parametrit; muut eivät ota parametreja. Palauttaa valinnan sen jälkeen.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Suorittaa samassa makrohallinnassa tallennetun vaihelistan makron sen tarkan nimen mukaan, mukaan lukien kaikki siinä sisältämät valintakomennot. Tallennettu makro ei voi itse olla ohjelma, joten ohjelmat eivät sisälly toisiinsa. Ratkeaa arvoon `null`; tuntematon nimi hylätään.

### Aika ja satunnaisuus

Suoritus on toistettava: saman ohjelman kaksi suoritusta samassa projektissa lukevat saman, koska kello ja satunnaisluvut eivät ole koneen. `Date.now()` ja `new Date()` ilman argumentteja palauttavat virtuaalikellon, joka alkaa arvosta 0 ja etenee yhdellä jokaiselle muokkajalle tehtyä vastausta kohti sekä `ms` jokaiselle `sound.wait(ms)`. `sound.wait` ratkeaa välittömästi; ohjelmalla ei ole tapaa pysähtyä todelliseen aikaan, eikä sitä tarvita, koska jokainen muokkajalle tehty kutsu on valmis ennen kuin sen lupaus ratkeaa.

`Math.random()` ja `sound.random()` ovat sama generattori, joka on siemenetty arvolla `sound.env.seed`. Kirjaa siemen, jos haluat tietää, mitä jonoa suoritus käytti.

### Oletustesi tarkistaminen

`sound.assert(condition, message)` heittää `message` kun `condition` on epätosi. `sound.assertEqual(actual, expected, message)` vertaa kaksi arvoa JSON:ina ja heittää virheen, jos ne eroavat toisistaan, viestillä, joka nimittää molemmat arvot, jos et anna omaa. Koska heitetty virhe lopettaa suorituksen ja kumoo kaiken sen edeltävän, epäonnistunut väite jättää projektin koskemattomaksi. Kumpikaan menetelmä ei palauta lupauksen objektia.

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
`NaN`, `Infinity`, funktiot, luokkien instanssit, tyyppitaulukot ja `Date`
objektit hylätään virheen kera, samoin kuin mikä tahansa arvo, joka on suurempi kuin 1 MiB, syvempi kuin 12 tasoa tai sisältää enemmän kuin 4 096 kohdetta yhdessä taulukossa tai objektissa.
`undefined`-ominaisuudet poistetaan.

## Rajat

| Raja | Arvo |
| --- | --- |
| Ohjelman pituus | 256 KiB |
| Kutsuja editoria kohti ajossa | 4 096 |
| Muutoksia projektiin ajossa (valintakutsut, efektit, komennot) | 256 |
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
selittää syyn: komento sanaston ulkopuolelta, efekti tyhjälle valinnalle, parametri väärällä alueella. Virhe sisältää myös `code`, joka on
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

Virhe, jonka ohjelma ei käsittele, keskeyttää ajon, kumoo projektin ja näytetään paneelissa sen rivillä, josta se tuli. Ohjelma, joka ei käännä, ilmoitetaan samalla tavalla ennen kuin mitään ajetaan.

## Vaikutukset, joita ohjelma voi soveltaa {#effects-a-program-can-apply}

Nämä ovat vaikutus-ID:t, joita `sound.effect` ja `sound.effects` hyväksyvät, sekä parametrit, joita kukin niistä käyttää, ja niiden oletusarvot. Arvovälit ja yksiköt löytyvät
[äänivaikutusten viiteasiakirjasta](/reference/generated/audio-effects/). Nyquist-liitännäisiä ei voi soveltaa ohjelmasta.

| Vaikutus | Vaikutus-ID | Parametrit ja oletusarvot |
| --- | --- | --- |
| Vahvista | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Automaattinen hiljennys | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Basso ja diskantti | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Sävelkorkeuden muutos | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Nopeuden ja sävelkorkeuden muutos | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Tahtin muutos | `audacity-change-tempo` | `tempoPercent: 0` |
| Klassiset suodattimet | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Klikkien poisto | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Kompressori | `compressor` | `threshold: -24`, `knee: 30`, `ratio: 4`, `attack: 0.003`, `release: 0.25`, `makeupGain: 0` |
| Kompressori (Audacity) | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Viive | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Vääristymä | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Kaiku | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Fade In | `audacity-fade-in` | ei parametreja |
| Fade Out | `audacity-fade-out` | ei parametreja |
| Suodatin käyrä EQ | `audacity-filter-curve-eq` | `points`: taulukko `{ frequency, gain }`, oletusarvoisesti kaksi tasaa pistettä 20 Hz:n ja 20 kHz:n kohdalla; `linearFrequencyScale: false`; `filterLength: 8191` |
| Neljän kaistan parametrisointi EQ | `eq` | `outputGain: 0`; `bands`: neljä `{ id, enabled, type, frequency, gain, q, slope }` -objektia, huiput 100, 500, 2000 ja 8000 Hz:n kohdalla `gain: 0`, `q: 1`, `slope: 12` |
| Gate | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Graafinen EQ | `audacity-graphic-eq` | `gains`: 31 kaistan vahvistukset dB:ssä, kaikki 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| Korkean taajuuden suodatin | `highpass` | `frequency: 80`, `q: 0.707` |
| Käännä | `audacity-invert` | ei parametreja |
| Legacy-kompressori | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limittari | `limiter` | `ceiling: -1`, `lookahead: 0.005`, `release: 0.1` |
| Limittari (Audacity) | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Äänenvoimakkuuden normalisointi | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Matalan taajuuden suodatin | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Melun vähennys | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalisoi | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| DC-poiston poisto | `audacity-remove-dc-offset` | ei parametreja |
| Korjaa | `audacity-repair` | ei parametreja |
| Toista | `audacity-repeat` | `count: 1` |
| Jälkikaiku | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Reverb (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Reverse | `audacity-reverse` | none |
| Sliding Stretch | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Truncate Silence | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Utility Gain (Reviewed) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Kahdella efektillä on tarve, jota ohjelma ei voi tarjota. Melunvaimennus vaatii meluprofiilin, joka on tallennettu efektin omaan dialogiin, ja Automaattinen hiljennys vaatii ohjausraidan, joka on fokusoitua raistaa alempana.

## Ohjelman suorittamat komennot {#commands-a-program-can-run}

`sound.command` hyväksyy seuraavat Audacityn makrokomennot. Ne ovat samoja nimiä, joita vaiheittainen makro voi sisältää, joten ohjelman ja vaihelistan toimintapiiri on täsmälleen sama. Jokainen komento suorittaa toiminnon, jonka [komennot viittaus](/reference/generated/commands/) kuvaa.

### Valintakomennot parametreineen

| Komento | Parametrit |
| --- | --- |
| `SelectTime` | `start`, `end` sekunteina; `relativeTo` kuten `sound.select.time` |
| `SelectFrequencies` | `low`, `high` hertseinä |
| `SelectTracks` | `track`, `trackCount` (0–100); `mode` `'set'`, `'add'` tai `'remove'` |
| `Select` | Minkä tahansa yhdistelmä yllä olevista kolmesta joukosta |

Jos jätät parametrin pois, valinnan kyseinen osa jää muuttumattomaksi, mikä on myös Audacityn tapa lukea ne.

### Komennot ilman parametreja

| Ryhmä | Komennot |
| --- | --- |
| Valinta | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Muokkaus | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Raidat | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Tunnisteet | `AddLabel` |
| Analyysi | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Mitä on tarkoituksella jätetty pois

`Undo` ja `Redo` puuttuvat, koska suoritus on jo yksi historiankirjamerkintä ja vaihe, joka kulki historian läpi, ulottuisi suorituksen yli omiin muokkauksiisi. Toistoa ja nauhoitusta koskevat komennot puuttuvat, koska ohjelmalla ei ole mitään, jolle odottaa, eikä sitä voi kumota nauhoituksen ulkopuolelle. Avaa, tallenna, sulje, tuota, vie ja asetukset puuttuvat, koska ohjelman toimintapiiri on se yksi projekti, joka oli auki sen käynnistyessä. Komennot, jotka ainoastaan avaavat dialogin tai muuttavat näkymän, puuttuvat, koska ne eivät muuta mitään projektissa.

## Ohjelmien jakaminen {#sharing-programs}

**Vie ohjelma** kirjoittaa valitun ohjelman `.soundscapemacro`-tiedostoksi, ja **Tuo ohjelma** lukee yhden. Tiedosto on JSON eikä pelkkä `.js`-tiedosto, jotta vastaanottava tietokone ei sekoita sitä johonkin, joka on suoritettava muualla kuin muokkajessa:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

Tuo tallentaa tekstin ja ei mitään muuta. Tuotu ohjelma ei sisällä **Suorita
ohjelma** -painiketta; sen sijaan paneelissa näkyy ohjelma, tiedosto, josta se on
peräisin, huomautus siitä, mitä ohjelma voi tehdä avoimeen projektiin, sekä
valintaruutu, jossa lukee *Olen lukenut tämän ohjelman ja haluan suorittaa sen.*
Valintaruudun valitseminen ottaa käyttöön **Ota tämä ohjelma käyttöön** -toiminnon,
ja vasta sitten ohjelma voidaan suorittaa.

Tämä lupa koskee tarkkaa tekstiä, jonka luit. Jos ohjelma muuttuu myöhemmin,
oli kyseessä sitten muokkaus tai uudemman kopion tuonti sen päälle, tarkistus
näkyy uudelleen, kunnes otat uuden tekstin käyttöön. Ohjelmat, jotka kirjoitat
itse hallitsijassa, eivät vaadi tarkistusta.

## Esimerkkejä

Vaimenna sisään jokainen leikkaus ensimmäisellä raidalla, jolla on leikkauksia.
Valitse raidan otsake ennen suorittamista, jotta efekti osuu siihen raitaan, jota
ohjelma lukee:

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

Suorita tallennettu askel-listamakro vain, jos valinta on tarpeeksi pitkä:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## Tietoja tästä sivusta

Jokainen ohjelma tässä sivussa, yksirivisistä kappaleista valmiisiin esimerkkeihin,
ajoitetaan Soundscaperin jokaisen buildin kohdalla selaimen testisarjalla
(`tests/browser/handbook-macro-program-examples.spec.js`), joka lukee ohjelmat tämän sivun omasta tekstistä. Ohjelma, joka lopettaa suorittamisen tai lopettaa tämän sivun mukaan tuottaman tuloksen tuottamisen, epäonnistuttaa buildin, kunnes sivu tai editor on korjattu.
