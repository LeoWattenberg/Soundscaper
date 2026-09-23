---
title: "Makro programları"
description: "Makro programının kullandığı JavaScript API, çalışma sınırları ve taşındığı dosya."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","model":"gpt-6-astra","modelProvider":"codex-session","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"tr"} -->

Makro programı, adım listesi yerine JavaScript ile yazılmış bir makrodur. Editörde `sound` adlı küçük bir API üzerinden çalışır; bu API açık projeyi okumaya, seçimi değiştirmeye ve adım listesindeki makroyla aynı efekt ve komutları uygulamaya izin verir. Dosyalara, ağa ve diğer projelerinize erişemez.

Programlar Soundscaper özelliğidir. Framescaper'da makro yöneticisi yoktur.

## Programların bulunduğu yer

**Araçlar → Makro yöneticisi** komutunu seçin. İletişim kutusunda adım listesi makroları ve **Programlar** altında kayıtlı programlar bulunur. Yeni bir program oluşturmak için Programlar başlığındaki **+ (Yeni program)** düğmesine basın. Aynı işlem çubuğunda seçili program için **Programı içe aktar**, **Programı dışa aktar** ve **Programı sil** seçenekleri vardır. Ayrıntı bölmesinde **Program adı**, **Program** metni ve **Programı çalıştır** düğmesi gösterilir. Metin yazıldıkça kaydedilir; ayrıca kaydetmeniz gerekmez.

Program bir projenin içinde değil, editör ayarlarında saklanır. Bu editörde açtığınız her projede kullanılabilir. Başka bir bilgisayara veya kişiye taşımak için **Programı dışa aktar** ve **Programı içe aktar** komutlarını kullanın; ayrıntılar için [Programları paylaşma](#sharing-programs) bölümüne bakın.

[Aynı efekt zincirini her seferinde uygula](/guides/effects/apply-the-same-effects-every-time/) kılavuzu, aynı iletişim kutusundaki adım listesi makrolarını açıklar.

## Program yazma

Program, sıkı kipte çalıştırılan bir `async` işlevinin gövdesidir. Üst düzeyde `await` kullanabilir, değişken ve işlev tanımlayabilir, sıradan dil özelliklerinden yararlanabilirsiniz. Editörle tek bağlantı `sound` nesnesidir ve bu nesnedeki her çağrı bir promise döndürür.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Program alanında Tab iki boşluk ekler. Alandan çıkmak için Escape, ardından Tab tuşuna basın.

### Programın kullanabildikleri

Standart JavaScript kitaplığı kullanılabilir: `Object`, `Array`, `Map`, `Set`, `Math`, `JSON`, `RegExp`, `Promise`, türlenmiş diziler, `Intl`, `TextEncoder`, `TextDecoder`, `structuredClone` ve `queueMicrotask`. `console` da kullanılabilir; oraya yazılanlar program günlüğüne eklenir.

### Programın kullanamadıkları

Program, ilk satırı çalışmadan önce yetenekleri kaldırılmış bir worker içinde yürütülür. Programda `fetch`, `XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`, `location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`, `setTimeout` ve `setInterval` bulunmaz. Bunlardan birini okumak `undefined` verir.

Program bir modülü `import` edemez; statik `import`, bulunduğu satırda sözdizimi hatası oluşturur. Gereken her şey programın kendi metninde olmalıdır.

Erişim sınırını eksik küresel nesnelerden çok editör uygular: program ne göndermeyi başarırsa başarsın, editör yalnızca bu sayfada listelenen çağrıları kabul eder ve diğer adları reddeder.

## Programı çalıştırma

**Programı çalıştır** düğmesine basın. Çalışmanın tamamı proje geçmişinde tek bir kayıt sayılır; kaç değişiklik yapmış olursa olsun bir **Geri Al** işlemi hepsini geri alır. Program hata verirse, iptal edilirse veya süre sınırını aşarsa proje çalışmadan önceki hâline döner.

**Çalışmayı iptal et** programı hemen durdurur. İki dakika çalışan program da aynı biçimde durdurulur ve *Makro 120 saniyeden uzun sürdü.* iletisi gösterilir.

Çalışma sonunda bölmede program günlüğü görünür; başarılıysa ardından *Program uygulandı.* iletisi gelir. Başarısızsa *Program N. satırda başarısız oldu:* ve hata iletisi gösterilir; satır numarası programınızda hatanın çıktığı yeri gösterir.

### Efektin hangi sese uygulandığı

Programın uyguladığı efekt, odaklı pistteki geçerli zaman seçimine uygulanır. Odaklı pist, başlığına en son tıkladığınız veya klibini en son seçtiğiniz pisttir. Zaman seçimi yoksa ancak bir klip seçiliyse efekt o klibi kapsar. Programın seçim çağrıları zaman aralığını ve seçili pistleri değiştirir, ancak odaklı pisti değiştirmez; dolayısıyla bir çalışma tek bir pisti işler. Odaklı pist yoksa veya seçim boşsa Efekt menüsündekiyle aynı hata oluşur.

## `sound` API'si

Aksi belirtilmedikçe aşağıdaki her yöntem promise döndürür. Sonraki çağrıdan önce her birini await ile bekleyin. Beklemeden sekizden fazla çağrı başlatılırsa dokuzuncusu reddedilir.

### `sound.env`

Çalışmayı tanımlayan sıradan bir nesne.

| Alan | Anlamı |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | Editörün arayüz dili; örneğin `"en"` veya `"de"`. |
| `seed` | Çalışmanın rastgele sayı başlangıç değeri. Her çalışmada yenidir. |
| `startedAt` | Çalışmanın başladığı sistem zamanı; ISO 8601 dizgesi. |
| `dryRun` | Şimdilik her zaman `false`. İlerisi için ayrılmıştır. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`, `sound.log.error(...values)` ve `sound.log.debug(...values)` çalışma günlüğüne birer satır yazar. `console.log`, `console.info`, `console.warn`, `console.error` ve `console.debug` de aynı işi yapar. Dizge olmayan değerler JSON olarak yazılır. Bu yöntemler değer döndürmez ve beklenmeleri gerekmez.

Günlük en fazla 1.000 satır veya 256 KiB tutar; önce hangisi dolarsa o sınır geçerlidir. Her satır 4.096 karakterde kesilir. Aşan satırlar atılır ve sayılır; sayı son uyarıda bildirilir.

### `sound.project`

Projeyi okumak onu değiştirmez ve çalışmanın değişiklik bütçesinden harcamaz.

`sound.project.snapshot()` `{ sampleRate, tracks, selection }` döndürür; `tracks` ile `selection` aşağıdaki iki çağrının sonucuyla aynı biçimdedir. `sampleRate`, projenin hertz cinsinden örnekleme hızıdır; bu sayfadaki bütün kare sayıları ona göre ölçülür.

`sound.project.tracks()` pistleri zaman çizelgesi sırasına göre bir dizi olarak döndürür:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` tek pistteki klipleri, `trackId` verilmezse tüm pistlerdeki klipleri döndürür:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` geçerli seçimi döndürür:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Her seçim çağrısı bir değişiklik sayılır ve `sound.project.selection()` sonucuyla aynı biçimde oluşan seçimi döndürür.

`sound.select.time(start, end, options)` zaman aralığını saniye cinsinden ayarlar. Audacity'nin `SelectTime` komutudur; `options.relativeTo` her sınırın nereden ölçüleceğini belirler. Her iki sınır da -100 saniyeye kadar inebilir.

| `relativeTo` | Başlangıç sınırı | Bitiş sınırı |
| --- | --- | --- |
| `'project-start'` (varsayılan) | Proje başlangıcından `start` saniye sonra | Proje başlangıcından `end` saniye sonra |
| `'project'` | Proje başlangıcından `start` saniye sonra | Proje bitiminden `end` saniye sonra |
| `'project-end'` | Proje bitiminden `start` saniye önce | Proje bitiminden `end` saniye önce |
| `'selection-start'` | Seçim başlangıcından `start` saniye sonra | Seçim başlangıcından `end` saniye sonra |
| `'selection'` | Seçim başlangıcından `start` saniye sonra | Seçim bitiminden `end` saniye sonra |
| `'selection-end'` | Seçim bitiminden `start` saniye önce | Seçim bitiminden `end` saniye önce |

Projenin sonu, herhangi bir klibin ulaştığı son karedir. Seçili pistler değişmez.

`sound.select.frames(startFrame, endFrame, options)` zaman aralığını proje örnekleme hızındaki karelerle ayarlar. `options.trackIds` seçilecek pistleri belirtir; verilmezse önceden seçili pistler seçili kalır. Aralık zaman çizelgesine sığdırılır; sınırlar ters sıradaysa yerleri değiştirilir.

`sound.select.tracks(options)`, Audacity'nin `SelectTracks` komutudur. İndeksi 0'dan başlayan pistler arasından `options.track` (varsayılan 0) ile başlayıp `options.trackCount` (varsayılan 1) kadar pist seçer. `options.mode` değeri seçimi değiştirmek için `'set'`, genişletmek için `'add'`, pistleri çıkarmak için `'remove'` olabilir. Zaman aralığı değişmez.

`sound.select.frequencies(options)`, Audacity'nin `SelectFrequencies` komutudur. Spektral seçimi hertz cinsinden `options.low` ile `options.high` arasına ayarlar; atlanan sınırın geçerli değeri korunur.

`sound.select.all()` tüm projeyi ve tüm pistleri seçer. `sound.select.none()` seçimi temizler.

### `sound.effect(type, params)`

Odaklı pistteki geçerli seçime bir efekt uygular. `type`, [Programın uygulayabildiği efektler](#effects-a-program-can-apply) bölümündeki bir efekt kimliğidir; `params` efektin parametre nesnesidir. Verilmeyen parametreler varsayılanlarını kullanır; değerler [ses efektleri başvurusundaki](/reference/generated/audio-effects/) aralıklara göre doğrulanır. Sonuç `null` olur.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Geçerli seçime, aynı adımları içeren adım listesi makrosuyla bire bir aynı şekilde, tek geçişte bir efekt zinciri uygular. Her adım `{ type, params }` biçimindedir ve zincirde en az bir adım olmalıdır. Sonuç `null` olur.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

[Programın çalıştırabildiği komutlar](#commands-a-program-can-run) bölümündeki Audacity makro komutlarından birini yürütür. Dört seçim komutu orada açıklanan parametreleri alır; diğerleri parametre almaz. Ardından oluşan seçimi döndürür.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Aynı makro yöneticisine kaydedilmiş adım listesi makrosunu, içerdiği seçim komutlarıyla birlikte, tam adıyla çalıştırır. Kayıtlı makro kendi başına bir program olamaz; programlar iç içe geçmez. Sonuç `null` olur; bilinmeyen ad hata verir.

### Zaman ve rastgelelik

Çalışmalar yeniden üretilebilir: aynı program aynı projede iki kez çalıştırıldığında aynı verileri okur; saat ve rastgele sayılar bilgisayardan alınmaz.

Argümansız `Date.now()` ve `new Date()` 0'dan başlayan sanal bir saat kullanır. Editöre yapılan her yanıtlanmış çağrıda bir birim, her `ms` değerinde `sound.wait(ms)` çağrısında o değer kadar ilerler. `sound.wait` hemen tamamlanır; program gerçek zamanlı olarak bekleyemez ve gerek de yoktur, çünkü editörün her çağrısı kendi promise'i sonuçlanmadan önce tamamlanır.

`Math.random()` ve `sound.random()`, başlangıç değerini `sound.env.seed` içinden alan aynı üreticiyi kullanır. Hangi dizinin kullanıldığını bilmeniz gerekiyorsa başlangıç değerini günlüğe yazın.

### Varsayımlarınızı denetleme

`sound.assert(condition, message)`, `message` ile hata verir; bunun koşulu `condition` değerinin yanlış olmasıdır. `sound.assertEqual(actual, expected, message)` iki değeri JSON olarak karşılaştırır; farklıysa ve özel ileti verilmemişse iki değeri de belirten hata verir. Hata çalışmayı bitirip önceki değişiklikleri geri aldığı için başarısız doğrulama projeye dokunmaz. İki yöntem de promise döndürmez.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Editöre aktarılan değerler

Programın gönderdiği her argüman ve aldığı her değer yalın veridir: `null`, boole değerleri, sonlu sayılar, dizgeler ve bunların dizileri ile sıradan nesneleri. `NaN`, `Infinity`, işlevler, sınıf örnekleri, türlenmiş diziler ve `Date` nesneleri hata ile reddedilir. 1 MiB'tan büyük, 12 düzeyden derin veya bir dizi ya da nesnede 4.096'dan fazla öğe içeren değerler de reddedilir. `undefined` değerli özellikler atılır.

## Sınırlar

| Sınır | Değer |
| --- | --- |
| Program uzunluğu | 256 KiB |
| Çalışma başına editör çağrıları | 4.096 |
| Çalışma başına proje değişiklikleri (seçim çağrıları, efektler, komutlar) | 256 |
| Aynı anda yanıt bekleyen çağrılar | 8 |
| Çalışma süresi | 120 saniye |
| Editöre gönderilen veya editörden gelen tek değer | 1 MiB, en fazla 12 düzey derinlik, dizi veya nesnede 4.096 öğe |
| Günlük | 1.000 satır veya 256 KiB; satır başına 4.096 karakter |
| Kitaplıktaki programlar | 128 |
| Program adı | 256 karakter |
| İçe aktarılan program dosyası | 1 MiB |

Her klibi seçip bir efekt uygulayan döngü, klip başına iki değişiklik harcar; bütçe bitmeden 128 klibi işleyebilir.

## Hatalar

Editörün reddettiği çağrının promise'i, bir `Error` ile reddedilir; `message` alanında neden açıklanır: bilinmeyen komut, boş seçime efekt uygulama veya aralık dışı parametre gibi. Editör daha özel bir kod vermediyse `code` alanı `MACRO_CALL_FAILED` olur. Program bu hataları yakalayıp devam edebilir:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Bu program tamamlanır ve günlüğe *refused: Unsupported macro command: ExportWav.* yazılır.

Programın yakalamadığı hata çalışmayı sonlandırır, projeyi geri alır ve çıktığı satırla birlikte bölmede gösterilir. Derlenemeyen program da yürütme başlamadan aynı biçimde bildirilir.

## Programın uygulayabildiği efektler {#effects-a-program-can-apply}

Burada `sound.effect` ve `sound.effects` çağrılarının kabul ettiği efekt kimlikleri, parametre anahtarları ve varsayılanları listelenir. Aralıklar ve birimler [ses efektleri başvurusundadır](/reference/generated/audio-effects/). Programdan Nyquist eklentisi uygulanamaz.

| Efekt | Efekt kimliği | Parametreler ve varsayılanlar |
| --- | --- | --- |
| Yükselt | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Otomatik Kısma | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Bas ve Tiz | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bit Kırıcı | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Perdeyi Değiştir | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Hızı ve Perdeyi Değiştir | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Tempoyu Değiştir | `audacity-change-tempo` | `tempoPercent: 0` |
| Klasik Filtreler | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Tıklama Giderme | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Sıkıştırıcı | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Geri Beslemeli Gecikme | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Distorsiyon | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Yankı | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Yumuşak Giriş | `audacity-fade-in` | yok |
| Yumuşak Çıkış | `audacity-fade-out` | yok |
| Filtre Eğrisi EQ | `audacity-filter-curve-eq` | `points`: bir dizi `{ frequency, gain }`, varsayılan olarak sıfır kazançlı iki nokta: 20 Hz ve 20 kHz; `linearFrequencyScale: false`; `filterLength: 8191` |
| Dört Bantlı Parametrik EQ | `eq` | `outputGain: 0`; `bands`: dört `{ id, enabled, type, frequency, gain, q, slope }` nesnesi; tepe noktaları 100, 500, 2000 ve 8000 Hz; `gain: 0`, `q: 1`, `slope: 12` |
| Kapı | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Grafik EQ | `audacity-graphic-eq` | `gains`: dB cinsinden 31 bant kazancı; hepsi 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| Rezonanslı Yüksek Geçiren Filtre | `highpass` | `frequency: 80`, `q: 0.707` |
| Ters Kutup | `audacity-invert` | yok |
| Klasik Sıkıştırıcı | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Sınırlayıcı | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Gürlük Normalleştirme | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Rezonanslı Alçak Geçiren Filtre | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Gürültü Azaltma | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalleştir | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Fazör | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| DC Kaymasını Gider | `audacity-remove-dc-offset` | yok |
| Onar | `audacity-repair` | yok |
| Tekrarla | `audacity-repeat` | `count: 1` |
| Yankılanma | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Yankılanma (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Ters Çevir | `audacity-reverse` | yok |
| Kayarak Esnetme | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Sessizliği Kısalt | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Yardımcı Kazanç (İncelendi) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

İki efekt, programın sağlayamayacağı verilere ihtiyaç duyar. Gürültü Azaltma kendi iletişim kutusunda alınmış bir gürültü profili, Otomatik Kısma ise odaklı pistin altında bir denetim pisti gerektirir.

## Programın çalıştırabildiği komutlar {#commands-a-program-can-run}

`sound.command` aşağıdaki Audacity makro komut adlarını kabul eder. Adım listesi makrosu da aynı adları kullanır; programın ve adım listesinin erişimi eşittir. Her komut [komut başvurusunda](/reference/generated/commands/) açıklanan editör işlemini yürütür.

### Parametreli seçim komutları

| Komut | Parametreler |
| --- | --- |
| `SelectTime` | Saniye cinsinden `start`, `end`; `relativeTo`, `sound.select.time` yöntemindeki gibi |
| `SelectFrequencies` | Hertz cinsinden `low`, `high` |
| `SelectTracks` | `track`, `trackCount` (0 ila 100); `mode`, `'set'`, `'add'` veya `'remove'` değerlerinden biri |
| `Select` | Yukarıdaki üç kümenin herhangi bir birleşimi |

Atladığınız parametre seçimin o bölümünü değiştirmez; Audacity de onu böyle yorumlar.

### Parametresiz komutlar

| Grup | Komutlar |
| --- | --- |
| Seçim | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Düzenleme | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Pistler | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Etiketler | `AddLabel` |
| Analiz | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Bilerek kapsam dışında bırakılanlar

`Undo` ve `Redo` yoktur; çalışma zaten tek bir geçmiş kaydıdır ve geçmişte gezinmek çalışma öncesindeki düzenlemelerinize erişebilir. Taşıma ve kayıt komutları yoktur; programın onları beklemesi gerekmez ve kaydı geri alamaz. Açma, kaydetme, kapatma, içe ve dışa aktarma ile tercihler de yoktur; program yalnızca başladığında açık olan projeye erişir. Sadece iletişim kutusu açan veya görünümü değiştiren komutlar projeyi değiştirmedikleri için bulunmaz.

## Programları paylaşma {#sharing-programs}

**Programı dışa aktar** seçili programı `.soundscapemacro` dosyasına yazar; **Programı içe aktar** böyle bir dosyayı okur. Dosya yalın bir `.js` dosyası değil JSON'dur; böylece alıcının bilgisayarında editör dışında çalıştırılacak bir kod sanılmaz:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

İçe aktarma yalnızca metni saklar. İçe aktarılan programda **Programı çalıştır** düğmesi yoktur. Bölmede bunun yerine program, geldiği dosya, açık projeye olası etkisine ilişkin uyarı ve *Bu programı okudum ve çalıştırmak istiyorum.* onay kutusu gösterilir. Kutuyu işaretlemek **Bu programı etkinleştir** düğmesini kullanılabilir yapar; program ancak buna basıldıktan sonra çalıştırılabilir.

İzin, okuduğunuz metnin tam hâli içindir. Programı daha sonra düzenlerseniz veya üzerine yeni bir sürüm içe aktarırsanız yeni metni etkinleştirene kadar inceleme yeniden gösterilir. Yöneticide kendiniz yazdığınız programların incelemeye ihtiyacı yoktur.

## Örnekler

Klip içeren ilk pistteki her klibe yumuşak giriş uygulayın. Çalıştırmadan önce o pistin başlığına tıklayın; böylece efekt programın okuduğu piste uygulanır:

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

Projeyi değiştirmeden bilgilerini günlüğe yazın:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Kayıtlı bir adım listesi makrosunu yalnızca seçim yeterince uzunsa çalıştırın:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## Bu sayfa hakkında

Bu sayfadaki tek satırlık örneklerden kapsamlı programlara kadar her program, Soundscaper'ın her derlemesinde tarayıcı test paketi (`tests/browser/handbook-macro-program-examples.spec.js`) tarafından çalıştırılır. Paket programları bu sayfanın metninden okur. Bir program tamamlanmaz veya burada anlatılan sonucu üretmezse sayfa ya da editör düzeltilene kadar derleme başarısız olur.
