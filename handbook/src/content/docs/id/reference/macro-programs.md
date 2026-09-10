---
title: "Program makro"
description: "API JavaScript yang dijalankan oleh program makro, batasan yang berlaku, dan file yang memuatnya."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","targetLocale":"id"} -->

Program makro adalah makro yang ditulis sebagai JavaScript, bukan sebagai daftar langkah.
Program ini berjalan di dalam editor terhadap API kecil yang disebut `sound`, yang memungkinkannya membaca
proyek yang terbuka, memindahkan seleksi, dan menerapkan efek serta perintah yang sama yang dapat diterapkan oleh
makro daftar-langkah. Segala hal lainnya, mulai dari file dan jaringan hingga proyek
lain Anda, berada di luar jangkauannya.

Program adalah fitur Soundscaper. Framescaper tidak memiliki manajer makro.

## Di mana program disimpan

Pilih **Tools → Macro manager**. Dialog ini mencantumkan makro daftar-langkah dan, di bawah
**Programs**, program yang telah Anda simpan. **New program** membuat satu program, dan panel
detail menampilkan **Program name**, teks **Program**, dan tombol **Run
program**. Teks disimpan saat Anda mengetik; tidak ada langkah penyimpanan terpisah.

Program disimpan bersama pengaturan editor, bukan di dalam proyek, sehingga tersedia
di setiap proyek yang Anda buka di editor ini. Gunakan **Export program** dan
**Import program** untuk memindahkannya ke mesin lain atau orang lain; lihat
[Sharing programs](#sharing-programs) untuk apa yang terlibat.

Panduan [Apply the same chain of effects every time](/guides/effects/apply-the-same-effects-every-time/)
mencakup sisi daftar-langkah dari dialog yang sama.

## Menulis program

Program adalah badan fungsi `async`, dijalankan dalam mode ketat. Artinya Anda
dapat `await` di tingkat atas, mendeklarasikan variabel dan fungsi, serta menggunakan setiap
fitur bahasa biasa. Objek `sound` adalah satu-satunya koneksi program ke
editor, dan setiap panggilan di atasnya mengembalikan promise.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Tab menyisipkan dua spasi di bidang program. Tekan Escape lalu Tab untuk keluar
dari bidang tersebut.

### Apa yang dapat digunakan oleh program

Pustaka standar JavaScript yang umum ada: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, typed arrays, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` dan `queueMicrotask`. `console`
juga ada, dan apa pun yang ditulis ke dalamnya akan masuk ke log program.

### Apa yang tidak dapat digunakan oleh program

Program berjalan di worker yang kemampuannya telah dihapus sebelum baris pertama dijalankan. Tidak ada satu pun dari berikut ini yang ada di dalam program: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` dan `setInterval`. Membaca salah satu dari mereka menghasilkan `undefined`.

Program tidak dapat `import` modul; `import` statis adalah kesalahan sintaks pada
baris yang memuatnya. Apa pun yang dibutuhkan program harus ada di dalam program.

Batas keamanan bukan global yang hilang, melainkan editor itu sendiri: ia
hanya menjawab panggilan yang tercantum di halaman ini dan menolak semua yang lain berdasarkan nama,
apa pun yang berhasil dikirim oleh program.

## Menjalankan program

Tekan **Run program**. Seluruh eksekusi adalah satu entri dalam riwayat proyek, jadi
satu **Undo** membatalkan semua yang dilakukan program, berapa pun perubahan yang dibuatnya.
Jika program melempar kesalahan, dibatalkan, atau melewati batas waktunya, proyek akan
dikembalikan persis seperti sebelum eksekusi dimulai.

**Cancel run** menghentikan program seketika. Program yang telah berjalan selama dua
menit dihentikan dengan cara yang sama, dengan pesan *The macro ran for longer than
120 seconds.*

Setelah eksekusi, panel menampilkan log program, diikuti oleh *Program applied.*
saat eksekusi selesai. Eksekusi yang gagal menampilkan *The program failed on line N:* dan
pesan kesalahannya, di mana nomor baris adalah baris program Anda yang
melempar kesalahan.

### Audio mana yang disentuh oleh efek

Efek yang diterapkan oleh program berjalan di atas seleksi waktu saat ini pada
track yang difokuskan, yaitu track yang header-nya terakhir Anda klik atau klipnya
terakhir Anda pilih. Jika tidak ada seleksi waktu tetapi ada klip yang dipilih, efek
menutupi klip tersebut. Panggilan seleksi program mengubah rentang waktu dan
set track yang dipilih, tetapi tidak mengubah track mana yang difokuskan, jadi satu eksekusi memproses
satu track. Jika tidak ada yang difokuskan atau seleksinya kosong, eksekusi gagal dengan
pesan yang sama yang diberikan oleh menu Effect.

## API `sound`

Setiap metode di bawah mengembalikan promise kecuali dinyatakan lain. Tunggu setiap panggilan
sebelum membuat panggilan berikutnya; program yang memulai lebih dari delapan panggilan tanpa
menunggunya akan ditolak pada panggilan kesembilan.

### `sound.env`

Objek biasa yang menggambarkan eksekusi.

| Field | Arti |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | Bahasa antarmuka editor, seperti `"en"` atau `"de"`. |
| `seed` | Benih yang menjadi sumber angka acak eksekusi. Baru untuk setiap eksekusi. |
| `startedAt` | Waktu jam dinding saat eksekusi dimulai, sebagai string ISO 8601. |
| `dryRun` | Selalu `false` saat ini. Dipesan. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` dan `sound.log.debug(...values)` menulis satu baris
masing-masing ke log eksekusi. `console.log`, `console.info`, `console.warn`,
`console.error` dan `console.debug` melakukan hal yang sama. Nilai yang bukan string ditulis
sebagai JSON. Metode-metode ini tidak mengembalikan apa pun dan tidak perlu ditunggu.

Log menyimpan paling banyak 1.000 baris atau 256 KiB, mana pun yang tercapai lebih dulu, dan setiap baris
dipotong pada 4.096 karakter. Baris di luar itu dibuang dan dihitung; hitungannya
dilaporkan sebagai peringatan akhir.

### `sound.project`

Membaca proyek tidak pernah mengubahnya dan tidak dihitung terhadap anggaran perubahan eksekusi.

`sound.project.snapshot()` mengembalikan `{ sampleRate, tracks, selection }`, dengan
`tracks` dan `selection` seperti yang dikembalikan oleh dua panggilan di bawah. `sampleRate` adalah
laju sampel proyek dalam hertz, yang merupakan satuan pengukuran setiap jumlah frame di halaman ini.

`sound.project.tracks()` mengembalikan array track dalam urutan timeline:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` mengembalikan klip pada satu trek, atau pada setiap trek
ketika `trackId` diabaikan:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` mengembalikan seleksi saat ini:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Setiap panggilan seleksi dihitung sebagai satu perubahan dan mengembalikan seleksi yang dihasilkannya,
dalam bentuk yang dikembalikan oleh `sound.project.selection()`.

`sound.select.time(start, end, options)` mengatur rentang waktu dalam detik. Ini adalah
perintah `SelectTime` Audacity, dan `options.relativeTo` memilih dari mana setiap
sisi diukur. Kedua sisi dapat serendah -100 detik.

| `relativeTo` | Sisi awal | Sisi akhir |
| --- | --- | --- |
| `'project-start'` (default) | `start` detik dari awal proyek | `end` detik dari awal proyek |
| `'project'` | `start` detik dari awal proyek | `end` detik setelah akhir proyek |
| `'project-end'` | `start` detik sebelum akhir proyek | `end` detik sebelum akhir proyek |
| `'selection-start'` | `start` detik setelah awal seleksi | `end` detik setelah awal seleksi |
| `'selection'` | `start` detik setelah awal seleksi | `end` detik setelah akhir seleksi |
| `'selection-end'` | `start` detik sebelum akhir seleksi | `end` detik sebelum akhir seleksi |

Akhir proyek adalah frame terakhir yang dicapai oleh klip mana pun. Trek yang dipilih tetap
tetap seperti semula.

`sound.select.frames(startFrame, endFrame, options)` mengatur rentang waktu dalam
frame pada laju sampel proyek. `options.trackIds` menamai trek yang akan
dipilih; jika diabaikan, trek yang sudah dipilih tetap terpilih.
Rentang dibatasi ke garis waktu dan sisi ditukar jika terbalik.

`sound.select.tracks(options)` adalah perintah `SelectTracks` Audacity. Ini memilih
 trek yang indeksnya (dihitung dari 0) berada dalam rentang dari `options.track`
(default 0) yang mencakup `options.trackCount` trek (default 1). `options.mode` adalah
`'set'` untuk mengganti seleksi trek, `'add'` untuk memperluasnya, atau `'remove'` untuk
mengeluarkan trek tersebut darinya. Rentang waktu tetap seperti semula.

`sound.select.frequencies(options)` adalah perintah `SelectFrequencies` Audacity.
Ini mengatur seleksi spektral ke `options.low` dan `options.high` dalam hertz;
sisi yang Anda abaikan mempertahankan nilai saat ini.

`sound.select.all()` memilih seluruh proyek di setiap trek.
`sound.select.none()` menghapus seleksi.

### `sound.effect(type, params)`

Menerapkan satu efek pada seleksi saat ini, di trek yang difokuskan. `type` adalah
ID efek dari [Efek yang dapat diterapkan program](#effects-a-program-can-apply),
dan `params` adalah objek parameter efek tersebut. Parameter yang Anda abaikan mengambil
nilai default efek; nilai diperiksa terhadap rentang dalam
[referensi efek audio](/reference/generated/audio-effects/). Menyelesaikan ke
`null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Menerapkan rangkaian efek pada seleksi saat ini dalam satu kali proses, persis seperti makro daftar langkah dengan langkah-langkah tersebut. Setiap langkah adalah `{ type, params }`, dan rangkaian membutuhkan setidaknya satu langkah. Menyelesaikan menjadi `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Menjalankan salah satu perintah makro Audacity yang tercantum di bawah
[Perintah yang dapat dijalankan oleh program](#commands-a-program-can-run). Keempat perintah seleksi mengambil parameter yang dijelaskan di sana; yang lainnya tidak mengambil parameter. Menyelesaikan ke seleksi setelahnya.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Menjalankan makro daftar langkah yang disimpan di manajer makro yang sama, berdasarkan nama persisnya,
termasuk perintah seleksi apa pun yang dikandungnya. Makro yang disimpan tidak dapat menjadi
program, sehingga program tidak bersarang. Menyelesaikan ke `null`; nama yang tidak dikenal ditolak.

### Waktu dan keacakan

Sebuah eksekusi dapat direproduksi: dua eksekusi program yang sama pada proyek yang sama membaca
yang sama, karena jam dan angka acak bukan milik mesin.

`Date.now()` dan `new Date()` tanpa argumen mengembalikan jam virtual yang
mulai dari 0 dan maju satu untuk setiap panggilan yang dijawab ke editor, dan
`ms` untuk setiap `sound.wait(ms)`. `sound.wait` menyelesaikan segera; tidak ada
cara bagi program untuk jeda untuk waktu nyata, dan tidak diperlukan, karena setiap panggilan
ke editor selesai sebelum janji (promise)nya diselesaikan.

`Math.random()` dan `sound.random()` adalah generator yang sama, ditanam (seeded) dari
`sound.env.seed`. Catat benih (seed) jika Anda perlu mengetahui urutan mana yang digunakan oleh eksekusi.

### Memeriksa asumsi Anda

`sound.assert(condition, message)` melempar `message` ketika `condition` adalah palsu.
`sound.assertEqual(actual, expected, message)` membandingkan dua nilai sebagai JSON
dan melempar ketika mereka berbeda, dengan pesan yang menyebutkan kedua nilai jika Anda tidak
memberikan pesan. Karena kesalahan yang dilempar mengakhiri eksekusi dan membatalkan (rollback) semua yang sebelumnya, asersi
gagal meninggalkan proyek tidak tersentuh. Tidak ada metode yang mengembalikan janji (promise).

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Nilai yang melintasi ke editor

Setiap argumen yang diteruskan oleh program dan setiap nilai yang diterimanya adalah data polos:
`null`, boolean, angka terbatas, string, serta array dan objek polos dari
jenis tersebut. `NaN`, `Infinity`, fungsi, instans kelas, array bertipe, dan `Date`
objek ditolak dengan error, begitu pula nilai apa pun yang lebih besar dari 1 MiB, bersarang lebih
dari 12 tingkat kedalaman, atau memiliki lebih dari 4.096 entri dalam satu array atau objek.
Properti `undefined` dibuang.

## Batasan

| Batasan | Nilai |
| --- | --- |
| Panjang program | 256 KiB |
| Panggilan ke editor per eksekusi | 4.096 |
| Perubahan pada proyek per eksekusi (pemanggilan seleksi, efek, perintah) | 256 |
| Panggilan yang menunggu jawaban sekaligus | 8 |
| Waktu eksekusi | 120 detik |
| Satu nilai yang melintasi ke atau dari editor | 1 MiB, 12 tingkat kedalaman, 4.096 entri per array atau objek |
| Log | 1.000 baris atau 256 KiB; 4.096 karakter per baris |
| Program di pustaka | 128 |
| Nama program | 256 karakter |
| File program yang diimpor | 1 MiB |

Loop yang memilih setiap klip dan menerapkan satu efek menghabiskan dua perubahan per
klip, sehingga dapat mencakup 128 klip sebelum anggaran habis.

## Error

Panggilan yang ditolak oleh editor akan menolak promisnya dengan `Error` yang `message`
menyatakan alasannya: perintah di luar kosakata, efek pada seleksi kosong,
parameter di luar rentang. Error juga membawa `code`, yang
`MACRO_CALL_FAILED` kecuali editor menyediakan yang lebih spesifik. Program
dapat menangkap ini dan melanjutkan:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Program tersebut selesai, dan lognya membaca *refused: Unsupported macro command:
ExportWav.*

Kesalahan yang tidak ditangkap oleh program akan mengakhiri eksekusi, membatalkan proyek, dan ditampilkan di panel dengan baris tempat kesalahan berasal. Program yang tidak dapat dikompilasi dilaporkan dengan cara yang sama sebelum apa pun dijalankan.

## Efek yang dapat diterapkan oleh program {#effects-a-program-can-apply}

Berikut adalah ID efek yang diterima oleh `sound.effect` dan `sound.effects`, beserta kunci parameter yang diambil oleh masing-masing efek dan nilai defaultnya. Rentang dan satuan terdapat di [referensi efek audio](/reference/generated/audio-effects/). Plug-in Nyquist tidak dapat diterapkan dari program.

| Efek | ID Efek | Parameter dan nilai default |
| --- | --- | --- |
| Amplify | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Auto Duck | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Bass and Treble | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Change Pitch | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Change Speed and Pitch | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Change Tempo | `audacity-change-tempo` | `tempoPercent: 0` |
| Classic Filters | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Click Removal | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Compressor | `compressor` | `threshold: -24`, `knee: 30`, `ratio: 4`, `attack: 0.003`, `release: 0.25`, `makeupGain: 0` |
| Compressor (Audacity) | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Delay | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Distortion | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Echo | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Fade In | `audacity-fade-in` | tidak ada |
| Fade Out | `audacity-fade-out` | tidak ada |
| Filter Curve EQ | `audacity-filter-curve-eq` | `points`: array dari `{ frequency, gain }`, default dua titik datar pada 20 Hz dan 20 kHz; `linearFrequencyScale: false`; `filterLength: 8191` |
| Four-band parametric EQ | `eq` | `outputGain: 0`; `bands`: empat objek `{ id, enabled, type, frequency, gain, q, slope }`, puncak pada 100, 500, 2000, dan 8000 Hz dengan `gain: 0`, `q: 1`, `slope: 12` |
| Gate | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Graphic EQ | `audacity-graphic-eq` | `gains`: 31 gain band dalam dB, semuanya 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| High-pass filter | `highpass` | `frequency: 80`, `q: 0.707` |
| Invert | `audacity-invert` | tidak ada |
| Legacy Compressor | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limiter | `limiter` | `ceiling: -1`, `lookahead: 0.005`, `release: 0.1` |
| Limiter (Audacity) | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Loudness Normalization | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Low-pass filter | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Noise Reduction | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalize | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Remove DC Offset | `audacity-remove-dc-offset` | tidak ada |
| Repair | `audacity-repair` | tidak ada |
| Repeat | `audacity-repeat` | `count: 1` |
| Reverb | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Reverb (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Reverse | `audacity-reverse` | tidak ada |
| Sliding Stretch | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Truncate Silence | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Utility Gain (Reviewed) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Dua efek memerlukan sesuatu yang tidak dapat disediakan oleh program. Noise Reduction memerlukan profil noise yang diambil di dialog efek itu sendiri, dan Auto Duck memerlukan track kontrol di bawah track yang difokuskan.

## Perintah yang dapat dijalankan program {#commands-a-program-can-run}

`sound.command` menerima nama perintah makro Audacity di bawah. Nama-nama ini sama dengan nama yang dapat dipegang oleh makro daftar langkah, sehingga program dan daftar langkah memiliki jangkauan yang persis sama. Setiap perintah menjalankan aksi editor yang dijelaskan oleh [rujukan perintah](/reference/generated/commands/).

### Perintah seleksi dengan parameter

| Perintah | Parameter |
| --- | --- |
| `SelectTime` | `start`, `end` dalam detik; `relativeTo` seperti untuk `sound.select.time` |
| `SelectFrequencies` | `low`, `high` dalam hertz |
| `SelectTracks` | `track`, `trackCount` (0 hingga 100); `mode` dari `'set'`, `'add'` atau `'remove'` |
| `Select` | Kombinasi apa pun dari tiga set di atas |

Parameter yang Anda tinggalkan akan membiarkan bagian tersebut dari seleksi tetap utuh, yang juga merupakan cara Audacity membacanya.

### Perintah tanpa parameter

| Grup | Perintah |
| --- | --- |
| Seleksi | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Penyuntingan | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Track | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Label | `AddLabel` |
| Analisis | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Apa yang sengaja tidak ada

`Undo` dan `Redo` tidak ada karena satu eksekusi sudah merupakan satu entri riwayat dan langkah yang menyusuri riwayat akan mencapai melampaui eksekusi ke penyuntingan Anda sendiri. Perintah transport dan perekaman tidak ada karena program tidak memiliki sesuatu untuk ditunggu dan tidak dapat dibatalkan dari perekaman. Membuka, menyimpan, menutup, mengimpor, mengekspor, dan preferensi tidak ada karena jangkauan program adalah satu proyek yang terbuka saat program dimulai. Perintah yang hanya membuka dialog atau mengubah tampilan tidak ada karena mereka tidak mengubah apa pun di proyek.

## Berbagi program {#sharing-programs}

**Ekspor program** menulis program yang dipilih sebagai file `.soundscapemacro`, dan **Impor program** membacanya. File tersebut adalah JSON, bukan file `.js` polos, sehingga tidak ada di komputer penerima yang akan salah mengira itu sebagai sesuatu untuk dijalankan di luar editor:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

Impor menyimpan teks dan tidak ada yang lain. Program yang diimpor tidak memiliki tombol **Jalankan
program**; sebagai gantinya, panel menampilkan program, file asalnya,
catatan tentang apa yang dapat dilakukan program terhadap proyek yang terbuka, dan kotak centang bertuliskan *Saya telah membaca program ini dan ingin menjalankannya.* Mencentangnya mengaktifkan **Aktifkan program
ini**, dan hanya setelah itu program dapat dijalankan.

Izin tersebut berlaku untuk teks persis yang Anda baca. Jika program berubah
kemudian, baik Anda mengeditnya atau mengimpor salinan yang lebih baru di atasnya, tinjauan
muncul lagi hingga Anda mengaktifkan teks baru. Program yang Anda tulis sendiri di manajer
tidak memerlukan tinjauan.

## Contoh

Fade in setiap klip di trek pertama yang memilikinya. Klik header trek tersebut
sebelum menjalankan, sehingga efek mendarat di trek yang sedang dibaca program:

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

Laporkan proyek tanpa mengubahnya:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Jalankan makro daftar langkah yang disimpan hanya ketika seleksi cukup panjang:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## Tentang halaman ini

Setiap program di halaman ini, mulai dari potongan kode satu baris hingga contoh yang dikerjakan,
dijalankan terhadap setiap build Soundscaper oleh suite browser
(`tests/browser/handbook-macro-program-examples.spec.js`), yang membaca program dari teks halaman ini sendiri. Program yang berhenti menyelesaikan, atau berhenti
menghasilkan apa yang dikatakan halaman ini, akan gagal dalam build hingga halaman atau
editor diperbaiki.
