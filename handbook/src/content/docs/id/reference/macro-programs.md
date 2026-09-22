---
title: "Program makro"
description: "API JavaScript yang dijalankan program makro, batasan yang dijalankannya, dan berkas yang ditempuhnya."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"id"} -->

Sebuah program makro adalah makro yang ditulis dalam bentuk JavaScript bukan sebagai daftar langkah.
Ini berjalan di dalam editor melawan API kecil yang disebut `sound`, yang membiarkannya membaca
proyek yang terbuka, memindahkan pilihan, dan menerapkan efek dan perintah yang sama seperti yang dapat diterapkan oleh makro daftar langkah. Segala sesuatu lainnya, dari berkas dan jaringan hingga proyek Anda yang lain, berada di luar jangkauannya.

Program adalah fitur Soundscaper. Framescaper tidak memiliki manajer makro.

## Dimana program berada

Pilih **Alat → Manajer Makro**. Dialog tersebut mencantumkan makro daftar langkah dan, di bawah **Program**, program yang telah Anda simpan. Tekan **+ (Program Baru)** di header Program untuk membuat salah satu. Bar aksi yang sama menawarkan **Impor Program**, **Ekspor Program**, dan **Hapus Program** untuk program yang dipilih. Panel detail menampilkan **Nama Program**, **Program** teks, dan tombol **Jalankan Program**. Teks disimpan saat Anda mengetiknya; tidak ada langkah simpan terpisah.

Program disimpan dengan pengaturan editor, bukan di dalam proyek, jadi tersedia di setiap proyek yang Anda buka di editor ini. Gunakan **Ekspor Program** dan **Impor Program** untuk memindahkannya ke mesin lain atau orang lain; lihat [Berbagi program](#sharing-programs) untuk apa yang terlibat di dalamnya.

Panduan [Menerapkan rantai efek yang sama setiap kali](/guides/effects/apply-the-same-effects-every-time/) mencakup sisi daftar langkah dari dialog yang sama.

## Menulis program

Program adalah tubuh dari fungsi `async`, dijalankan dalam mode ketat. Itu berarti Anda
dapat `await` di tingkat teratas, mendeklarasikan variabel dan fungsi, dan menggunakan setiap fitur bahasa biasa. Objek `sound` adalah satu-satunya koneksi program ke editor, dan setiap panggilan padanya mengembalikan janji.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Tab memasukkan dua spasi di bidang program. Tekan Escape dan kemudian Tab untuk meninggalkan
bidang.

### Apa yang dapat digunakan oleh program

Perpustakaan standar JavaScript biasa ada: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, array berurutan, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` dan `queueMicrotask`. `console`
juga ada, dan segala sesuatu yang ditulis ke dalamnya berakhir di log program.

### Apa yang tidak dapat digunakan oleh program

Program berjalan di dalam worker yang telah kehilangan kemampuannya sebelum baris pertama dijalankan. Tidak ada yang berikut ini ada di dalam program: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` dan `setInterval`. Membaca salah satu dari mereka memberikan `undefined`.

Program tidak dapat `import` sebuah modul; sebuah `import` statis adalah kesalahan sintaks pada
baris yang mengandungnya. Apa pun yang program butuhkan harus ada di dalam program.

Batas keamanan bukan global yang hilang tetapi editor itu sendiri: ia
hanya menjawab panggilan yang tercantum di halaman ini dan menolak segala sesuatu yang lain berdasarkan nama, terlepas dari apa yang program berhasil kirimkan.

## Menjalankan program

Tekan **Jalankan program**. Seluruh proses dijalankan sebagai satu entri dalam riwayat proyek, sehingga
satu **Batalkan** membalikkan segala sesuatu yang dilakukan program, berapa pun perubahan yang dibuat.
Jika program melempar, atau dibatalkan, atau berjalan melewati batas waktunya, proyek dikembalikan persis seperti sebelum proses dimulai.

**Batalkan proses** menghentikan program segera. Program yang telah berjalan selama dua
menit dihentikan dengan cara yang sama, dengan pesan *Makro berjalan lebih lama dari
120 detik.*

Setelah proses, panel menunjukkan log program, diikuti oleh *Program diterapkan.*
ketika proses selesai. Proses yang gagal menunjukkan *Program gagal pada baris N:* dan
pesan kesalahan, di mana nomor baris adalah baris program Anda yang melempar.

### Audio mana yang disentuh efek

Efek yang diterapkan oleh program berjalan pada seleksi waktu saat ini pada
track yang difokuskan, yang merupakan track yang header terakhir Anda klik atau clip
yang Anda pilih. Ketika tidak ada seleksi waktu tetapi clip dipilih, efek mencakup clip tersebut. Panggilan seleksi program mengubah rentang waktu dan
set track yang dipilih, tetapi bukan track mana yang difokuskan, jadi satu proses menangani
satu track. Jika tidak ada yang difokuskan atau seleksi kosong, proses gagal dengan
pesan yang sama dengan yang diberikan Menu Efek.

## API `sound`

Setiap metode di bawah ini mengembalikan janji kecuali jika dinyatakan lain. Tunggu setiap panggilan
ssebelum membuat yang berikutnya; program yang memulai lebih dari delapan panggilan tanpa
menunggu mereka memiliki yang kesembilan ditolak.

### `sound.env`

Sebuah objek biasa yang menggambarkan proses.

| Bidang | Arti |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | Bahasa antarmuka editor, seperti `"en"` atau `"de"`. |
| `seed` | Benih angka acak dari proses. Baru untuk setiap proses. |
| `startedAt` | Waktu dinding saat proses dimulai, sebagai string ISO 8601. |
| `dryRun` | Selalu `false` pada saat ini. Disimpan. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` dan `sound.log.debug(...values)` menulis satu baris
ke log proses. `console.log`, `console.info`, `console.warn`,
`console.error` dan `console.debug` melakukan hal yang sama. Nilai yang bukan string
written sebagai JSON. Metode ini tidak mengembalikan apa pun dan tidak perlu ditunggu.

Log menyimpan paling banyak 1.000 baris atau 256 KiB, yang mana datang pertama, dan setiap baris
dipotong pada 4.096 karakter. Baris di luar itu dihapus dan dihitung; hitungan
dilaporkan sebagai peringatan akhir.

### `sound.project`

Membaca proyek tidak pernah mengubahnya dan tidak menghitung terhadap anggaran
perubahan proses. `sound.project.snapshot()` mengembalikan `{ sampleRate, tracks, selection }`, dengan
`tracks` dan `selection` seperti dua panggilan di bawah ini mengembalikan mereka. `sampleRate` adalah
sample rate proyek dalam hertz, yang apa pun hitungan frame di halaman ini diukur.

`sound.project.tracks()` mengembalikan array track dalam urutan garis waktu:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

Metode `sound.project.clips(trackId)` mengembalikan klip pada satu trek, atau pada setiap trek
ketika `trackId` dihilangkan:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` mengembalikan seleksi saat ini:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Setiap panggilan seleksi menghitung sebagai satu perubahan dan mengembalikan seleksi yang dihasilkan,
dalam bentuk `sound.project.selection()` mengembalikan.

`sound.select.time(start, end, options)` mengatur rentang waktu dalam detik. Ini adalah
perintah `SelectTime` Audacity, dan `options.relativeTo` memilih di mana setiap
pinggir diukur dari. Kedua tepi dapat sedekat -100 detik.

| `relativeTo` | Pinggir awal | Pinggir akhir |
| --- | --- | --- |
| `'project-start'` (default) | `start` detik dari awal proyek | `end` detik dari awal proyek |
| `'project'` | `start` detik dari awal proyek | `end` detik setelah akhir proyek |
| `'project-end'` | `start` detik sebelum akhir proyek | `end` detik sebelum akhir proyek |
| `'selection-start'` | `start` detik setelah awal seleksi | `end` detik setelah awal seleksi |
| `'selection'` | `start` detik setelah awal seleksi | `end` detik setelah akhir seleksi |
| `'selection-end'` | `start` detik sebelum akhir seleksi | `end` detik sebelum akhir seleksi |

Akhir proyek adalah frame terakhir yang dicapai oleh klip mana pun. Trek yang dipilih tetap
semula.

`sound.select.frames(startFrame, endFrame, options)` mengatur rentang waktu dalam
frame pada tingkat sampel proyek. `options.trackIds` menyebutkan trek untuk
memilih; ketika diabaikan, trek yang sudah dipilih tetap dipilih. Rentang tersebut dikunci ke garis waktu dan tepi dipertukarkan jika terbalik.

`sound.select.tracks(options)` adalah perintah `SelectTracks` Audacity. Ini memilih
trek yang indeksnya (dihitung dari 0) berada dalam rentang dari `options.track`
(default 0) mencakup `options.trackCount` trek (default 1). `options.mode` adalah
`'set'` untuk mengganti seleksi trek, `'add'` untuk memperluasnya, atau `'remove'` untuk
mengambil trek tersebut dari seleksi. Rentang waktu tetap seperti semula.

`sound.select.frequencies(options)` adalah perintah `SelectFrequencies` Audacity.
Ini mengatur seleksi spektral ke `options.low` dan `options.high` dalam hertz;
pinggir yang Anda abaikan mempertahankan nilainya saat ini.

`sound.select.all()` memilih seluruh proyek di setiap trek.
`sound.select.none()` membersihkan seleksi.

### `sound.effect(type, params)`

Menerapkan satu efek di atas seleksi saat ini, pada trek yang difokuskan. `type` adalah
ID efek dari [Efek yang dapat diterapkan program](#effects-a-program-can-apply),
dan `params` adalah objek parameter efek tersebut. Parameter yang Anda abaikan mengambil
ilai default efek; nilai-nilai diperiksa terhadap rentang dalam
[referensi efek audio](/reference/generated/audio-effects/). Menyelesaikan ke
`null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Menerapkan rantai efek atas pilihan saat ini dalam satu kali penelusuran, tepat seperti makro daftar langkah dengan langkah-langkah tersebut. Setiap langkah adalah `{ type, params }`, dan rantai memerlukan setidaknya satu langkah. Menyelesaikan `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Menjalankan salah satu perintah makro Audacity yang tercantum di bawah
[Perintah yang dapat dijalankan program](#commands-a-program-can-run). Empat perintah pemilihan
memiliki parameter yang dijelaskan di sana; yang lainnya tidak memiliki. Memecahkan masalah ke
pemilihan setelahnya.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Menjalankan makro daftar langkah yang disimpan di manajer makro yang sama, dengan nama yang tepat,
termasuk perintah seleksi yang dimilikinya. Makro yang disimpan tidak dapat sendiri menjadi program, jadi program tidak dapat bersarang. Memecahkan `null`; nama yang tidak diketahui ditolak.

### Waktu dan acak

Sebuah jalannya dapat direproduksi: dua jalannya program yang sama di atas proyek yang sama membaca
jam yang sama, karena jam dan angka acak bukan dari mesin.

`Date.now()` dan `new Date()` tanpa argumen mengembalikan jam virtual yang
mulai dari 0 dan maju satu untuk setiap panggilan ke editor, dan oleh `ms` untuk setiap `sound.wait(ms)`. `sound.wait` langsung terselesaikan; tidak ada
cara untuk program untuk berhenti untuk waktu nyata, dan tidak diperlukan, karena setiap panggilan
ke editor selesai sebelum janjinya terselesaikan.

`Math.random()` dan `sound.random()` adalah generator yang sama, bertunas dari
`sound.env.seed`. Catat benihnya jika Anda perlu tahu urutan mana yang digunakan sebuah jalannya.

### Memeriksa asumsi Anda

`sound.assert(condition, message)` melempar `message` ketika `condition` adalah salah.
`sound.assertEqual(actual, expected, message)` membandingkan dua nilai sebagai JSON
dan melempar ketika berbeda, dengan pesan yang menyebutkan kedua nilai jika Anda tidak memberikannya. Karena kesalahan yang dilemparkan mengakhiri jalannya dan mengembalikan semua yang ada sebelum, asumsi yang gagal meninggalkan proyek tanpa sentuhan. Tidak ada metode yang kembali janji.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Nilai yang melintasi ke editor

Setiap argumen yang dilewatkan program dan setiap nilai yang diterimanya adalah data polos:
`null`, boolean, angka terbatas, string, dan array serta objek polos dari
those. `NaN`, `Infinity`, fungsi, instance kelas, array bertipe dan `Date`
objek ditolak dengan kesalahan, sama seperti nilai apa pun yang lebih besar dari 1 MiB, bersarang lebih
dalam dari 12 tingkat, atau memegang lebih dari 4.096 entri dalam satu array atau objek. Properti
`undefined` dihapus.

## Batasan

| Batasan | Nilai |
| --- | --- |
| Panjang program | 256 KiB |
| Panggilan ke editor per jalannya | 4.096 |
| Perubahan pada proyek per jalannya (panggilan seleksi, efek, perintah) | 256 |
| Panggilan yang menunggu jawaban sekaligus | 8 |
| Waktu jalannya | 120 detik |
| Satu nilai yang melintasi ke atau dari editor | 1 MiB, 12 tingkat dalam, 4.096 entri per array atau objek |
| Log | 1.000 baris atau 256 KiB; 4.096 karakter per baris |
| Program di perpustakaan | 128 |
| Nama program | 256 karakter |
| Berkas program impor | 1 MiB |

Loop yang memilih setiap klip dan menerapkan satu efek menghabiskan dua perubahan per
klip, jadi itu dapat mencakup 128 klip sebelum anggaran habis.

## Kesalahan

Panggilan editor yang ditolak menolak janji dengan `Error` yang `message`
menjelaskan alasannya: perintah di luar kosakata, efek di atas seleksi kosong,
parameter di luar jangkauan. Kesalahan juga membawa `code`, yang
`MACRO_CALL_FAILED` kecuali editor menyediakan yang lebih spesifik. Program
mungkin menangkap ini dan melanjutkan:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Program tersebut selesai, dan lognya membaca *ditolak: Perintah makro tidak didukung:
ExportWav.*

Kesalahan yang tidak ditangkap program akan mengakhiri eksekusi, mengembalikan proyek, dan ditampilkan di panel dengan baris asalnya. Program yang tidak dapat dikompilasi dilaporkan dengan cara yang sama sebelum apa pun dijalankan.

## Efek yang Dapat Diaplikasikan oleh Program {#effects-a-program-can-apply}

Ini adalah ID efek `sound.effect` dan `sound.effects` yang diterima, bersama dengan kunci parameter masing-masing dan nilai defaultnya. Rentang dan unitnya ada di [referensi efek audio](/reference/generated/audio-effects/). Plugin Nyquist tidak dapat diaplikasikan dari program.

| Efek | ID Efek | Parameter dan Nilai Default |
| --- | --- | --- |
| Perbesar | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Auto Duck | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Bass dan Treble | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Ubah Pitch | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Ubah Kecepatan dan Pitch | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Ubah Tempo | `audacity-change-tempo` | `tempoPercent: 0` |
| Filter Klasik | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Penghilang Klik | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Kompresor | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Delay | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Distorsi | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Echo | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Memudar Masuk | `audacity-fade-in` | tidak ada |
| Memudar Keluar | `audacity-fade-out` | tidak ada |
| Filter Kurva EQ | `audacity-filter-curve-eq` | `points`: array dari `{ frequency, gain }`, default dua titik datar pada 20 Hz dan 20 kHz; `linearFrequencyScale: false`; `filterLength: 8191` |
| Empat-band Parametrik EQ | `eq` | `outputGain: 0`; `bands`: empat `{ id, enabled, type, frequency, gain, q, slope }` objek, memuncak pada 100, 500, 2000 dan 8000 Hz dengan `gain: 0`, `q: 1`, `slope: 12` |
| Gerbang | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| EQ Grafik | `audacity-graphic-eq` | `gains`: 31 keuntungan band dalam dB, semua 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| Filter High-pass | `highpass` | `frequency: 80`, `q: 0.707` |
| Invert | `audacity-invert` | tidak ada |
| Kompresor Legacy | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Pembatas | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Normalisasi Keras | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Filter Low-pass | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Pengurangan Noise | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalisasi | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Hapus Offset DC | `audacity-remove-dc-offset` | tidak ada |
| Perbaikan | `audacity-repair` | tidak ada |
| Ulangi | `audacity-repeat` | `count: 1` |
| Reverb | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Reverb (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Terbalik | `audacity-reverse` | tidak ada |
| Peregangan Geser | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Memotong Kesunyian | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Kenaikan Utilitas (Ditinjau) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Dua efek memerlukan sesuatu yang tidak dapat disediakan oleh program. Pengurangan Noise memerlukan profil noise yang ditangkap dalam dialog efek sendiri, dan Auto Duck memerlukan trek kontrol di bawah trek yang difokuskan.

## Perintah yang dapat dijalankan program {#commands-a-program-can-run}

`sound.command` menerima nama perintah makro Audacity di bawah ini. Mereka adalah nama makro yang sama yang dapat dipegang oleh daftar langkah, sehingga program dan daftar langkah memiliki jangkauan yang tepat sama. Setiap perintah menjalankan tindakan editor yang [referensi perintah](/reference/generated/commands/) menggambarkan.

### Perintah Seleksi dengan Parameter

| Perintah | Parameter |
| --- | --- |
| `SelectTime` | `start`, `end` dalam detik; `relativeTo` seperti untuk `sound.select.time` |
| `SelectFrequencies` | `low`, `high` dalam hertz |
| `SelectTracks` | `track`, `trackCount` (0 hingga 100); `mode` dari `'set'`, `'add'` atau `'remove'` |
| `Select` | Kombinasi apa pun dari tiga set di atas |

Parameter yang Anda tinggalkan akan meninggalkan bagian seleksi tersebut sendiri, yang merupakan cara Audacity membacanya juga.

### Perintah Tanpa Parameter

| Kelompok | Perintah |
| --- | --- |
| Seleksi | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Penyuntingan | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Trek | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Label | `AddLabel` |
| Analisis | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Apa yang sengaja hilang

`Undo` dan `Redo` tidak ada karena satu kali menjalankan sudah satu entri sejarah dan langkah yang berjalan melalui sejarah akan melewati menjalankan ke edit Anda sendiri. Perintah transportasi dan perekaman tidak ada karena program tidak ada yang ditunggu dan tidak dapat dikembalikan dari perekaman. Membuka, menyimpan, menutup, mengimpor, mengekspor, dan preferensi tidak ada karena jangkauan program adalah satu proyek yang terbuka saat dimulai. Perintah yang hanya membuka dialog atau mengubah tampilan tidak ada karena mereka tidak mengubah apa pun dalam proyek.

## Berbagi program {#sharing-programs}

**Ekspor program** menulis program yang dipilih sebagai file `.soundscapemacro`, dan **Impor program** membacanya. File ini adalah JSON daripada file `.js` polos, sehingga tidak ada yang akan salah mengartikan file di komputer penerima sebagai sesuatu yang harus dijalankan di luar editor:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

Mengimpor menyimpan teks dan tidak lebih dari itu. Program yang diimpor tidak memiliki tombol **Jalankan program**; alih-alih, panel menampilkan program, berkas asalnya, catatan tentang apa yang dapat dilakukan program terhadap proyek terbuka, dan kotak centang yang bertuliskan *Saya telah membaca program ini dan ingin menjalankannya.* Centang kotak tersebut akan mengaktifkan **Aktifkan program ini**, dan baru setelah itu program dapat dijalankan.

Izin tersebut berlaku untuk teks yang tepat yang Anda baca. Jika program berubah setelahnya, baik Anda mengeditnya atau mengimpor salinan terbaru di atasnya, tinjauan akan muncul kembali hingga Anda mengaktifkan teks baru. Program yang Anda tulis sendiri di manajer tidak memerlukan tinjauan.

## Contoh

Memudarkan setiap klip pada trek pertama yang memiliki klip. Klik header trek tersebut sebelum dijalankan, sehingga efek diterapkan pada trek yang dibaca program:

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

Setiap program di halaman ini, mulai dari snippet satu baris hingga contoh yang telah dikerjakan,
jalankan terhadap setiap pembangun Soundscaper oleh suite peramban (`tests/browser/handbook-macro-program-examples.spec.js`), yang membaca
program dari teks halaman ini sendiri. Program yang berhenti menyelesaikan, atau berhenti
menghasilkan apa yang dikatakan halaman ini, gagal dalam pembangun hingga halaman atau
editor diperbaiki.
