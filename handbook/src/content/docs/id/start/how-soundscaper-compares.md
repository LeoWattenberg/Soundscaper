---
title: "Perbandingan Soundscaper"
description: "Bandingkan Soundscaper dengan Audacity 4 dan Adobe Audition dalam hal perekaman, penyuntingan, pencampuran, pengiriman, dan pertukaran."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","targetLocale":"id"} -->

Soundscaper mengimplementasikan ulang Audacity 4 di web dan menambahkan lapisan produksi di atasnya. Adobe Audition adalah alat pasca-produksi komersial yang biasanya menjadi acuan perbandingan bagi keduanya. Halaman ini membandingkan ketiganya agar Anda dapat menentukan mana yang sudah dapat melakukan pekerjaan yang Anda miliki.

## Cara membaca halaman ini

Setiap sel berisi **Ya**, **Sebagian**, atau **Tidak**, diikuti oleh detail yang melengkapinya.

**Sebagian** mencakup tiga situasi yang berbeda, dan catatan tersebut menyatakan mana yang berlaku: kemampuan tersebut ada tetapi lebih sempit dibandingkan di tempat lain, ada tetapi bergantung pada sesuatu yang harus Anda sediakan, atau hanya dapat dicapai dengan cara menghindari ketiadaan fitur.

Baris-baris menggambarkan kemampuan, bukan perintah menu. Untuk inventaris perintah yang tepat, lihat [Perintah dan pintasan](/reference/generated/commands/), dan untuk apa yang diaktifkan oleh masing-masing produk, lihat
[Kemampuan produk](/reference/generated/product-capabilities/).

### Dari mana klaim-klaim ini berasal

- Baris **Soundscaper** berasal dari repositori ini: profil kemampuan produk, manifest aksi runtime, dan registri format ekspor. Payload target native desktop dihasilkan oleh CI repositori atau pengemasan target. Sebuah paket hanya mengaktifkan satu setelah menstaging dan memverifikasi hasil yang persis cocok; baris-baris tersebut menyatakan kapan payload masih diperlukan.
- Baris **Audacity 4** berasal dari inventaris upstream yang dipatok di repositori ini, `4.0.0` pada commit `4c177d43`. Kemampuan yang didaftarkan oleh upstream tetapi dibiarkan nonaktif atau dikomentari keluar dari menu dicatat demikian, dan kemampuan yang tidak memiliki pendaftaran dalam build yang dipatok dilaporkan sebagai tidak ada dalam build tersebut, bukan sebagai ketiadaan permanen.
- Baris **Audition** berasal dari dokumentasi yang dipublikasikan Adobe untuk rilis saat ini. Mereka tidak diverifikasi terhadap build yang berjalan.

## Platform dan istilah

| Kemampuan | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Lisensi | Ya — AGPL-3.0-only | Ya — GPL, open source | Tidak — proprietary dan tertutup |
| Biaya | Ya — gratis | Ya — gratis | Tidak — langganan Creative Cloud |
| Berjalan di browser | Ya — Chromium, Firefox, dan WebKit | Tidak — hanya desktop | Tidak — hanya desktop |
| Build desktop | Ya — Windows dan Linux pada x64 dan ARM64, macOS pada ARM64 | Ya — Windows, macOS, Linux | Sebagian — Windows dan macOS, tidak ada Linux |
| Berfungsi tanpa akun | Ya — tidak ada akun | Ya — masuk hanya untuk audio.com | Tidak — langganan yang masuk diperlukan |
| Penyimpanan proyek cloud | Tidak — dikecualikan oleh desain local-first | Ya — menyimpan dan berbagi melalui audio.com | Sebagian — file Creative Cloud, sesi tidak disinkronkan |
| Kebutuhan sistem | Ya — berjalan di mana pun browser saat ini berjalan | Sebagian — meningkat secara signifikan dari Audacity 3 | Sebagian — kelas workstation profesional |

## Model proyek dan sesi

| Kemampuan | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Format proyek native | Ya — `.sscape`, arsip portabel lossless | Ya — `.aup4` | Ya — `.sesx` |
| Membuka proyek Audacity | Ya — impor dan ekspor AUP4 | Ya — native | Tidak |
| Timeline klip non-destruktif | Ya | Ya | Ya — editor multitrack |
| Editor file tunggal khusus | Sebagian — pengeditan sampel terjadi di timeline | Sebagian — edit diterapkan langsung di timeline | Ya — editor waveform |
| Konten mono dan stereo di satu trek | Ya — satu trek memegang salah satunya | Tidak — satu trek adalah mono atau stereo | Tidak — format kanal tetap per trek |
| Folder trek bersarang | Ya — kedalaman apa pun, dapat dibatalkan, dengan routing | Tidak | Sebagian — hanya bus submix, tidak ada trek folder |
| Baki proyek | Ya — mengatur file dan berfungsi sebagai clipboard | Tidak | Sebagian — panel Files mencantumkan file yang terbuka |
| Penyimpanan otomatis dan pemulihan crash | Ya — penyimpanan otomatis, kunci, dan amplop pemulihan | Ya | Ya |
| Penanda dan region bernama | Ya — kelas pertama, dengan navigasi dan perilaku ripple | Sebagian — trek label | Ya — penanda dan rentang |
| Peta tempo dan tanda waktu | Ya — peta berurutan yang diselesaikan secara akurat per sampel | Sebagian — satu tempo dan tanda proyek | Sebagian — satu tempo sesi |

## Perekaman

| Kemampuan | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Perekaman multitrack | Ya — beberapa sumber sekaligus | Sebagian — satu perangkat input pada satu waktu | Ya — antarmuka multi-input dan multichannel |
| Audio mikrofon dan desktop bersamaan | Ya — bawaan | Tidak | Sebagian — membutuhkan perangkat loopback sistem operasi |
| Perekaman terjadwal | Ya | Ya | Tidak |
| Perekaman yang diaktifkan suara | Ya — dengan ambang yang dapat diatur | Ya — dengan ambang yang dapat diatur | Tidak |
| Hitung mundur sebelum take | Ya — sadar peta tempo, menangani metrum majemuk | Sebagian — perekaman lead-in | Sebagian — pre-roll sebagai bagian dari punch and roll |
| Perekaman punch | Ya — satu transaksi, tangkapan default dan terarah | Tidak | Ya — punch and roll |
| Perekaman loop ke take | Ya — satu jalur per pass, ditambahkan ke grup yang sama | Tidak | Sebagian — take pada satu klip, dipilih dari daftar |
| Comping take | Ya — audisi, promosikan, edit region comp, ratakan sebagai satu edit yang dapat dibatalkan | Tidak | Tidak — tidak ada editor comp |
| Pemantauan dan metering input | Ya | Ya | Ya |

## Pengeditan timeline

| Kemampuan | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Varian edit ripple | Ya — per klip, per trek, dan semua trek, pada pemotongan dan penghapusan | Ya — tiga yang sama, pada pemotongan dan penghapusan | Sebagian — hapus ripple pada seleksi atau celah |
| Pemisahan, penggabungan, dan pemisahan pada keheningan | Ya | Ya | Sebagian — pemisahan dan pemotongan, tanpa penggabungan klip |
| Grup klip | Ya | Ya | Ya |
| Gain klip | Ya | Ya | Ya |
| Pitch dan kecepatan per klip | Ya — sesuaikan, render, atau atur ulang | Ya — sesuaikan, render, atau atur ulang | Sebagian — stretch tetap dapat diedit, pitch adalah efek |
| Mengikuti perubahan tempo | Ya — klip stretch ketika peta bergerak | Ya | Tidak |
| Kuantisasi dan groove yang sadar beat | Ya — peta warp dengan kekuatan groove yang dapat disesuaikan | Tidak | Tidak |
| Snap ke nol persimpangan | Ya | Ya | Ya |
| Penggambaran tingkat sampel | Ya | Sebagian — tidak ada tindakan gambar yang terdaftar dalam build yang dipin | Ya — di editor waveform |
| Penyuntingan hanya keyboard | Ya — setiap primitif edit memiliki tindakan navigasi | Ya — setiap primitif edit memiliki tindakan navigasi | Sebagian — pintasan luas, beberapa panel membutuhkan mouse |

## Kerja spektral dan pemulihan

| Kemampuan | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Tampilan spektrogram | Ya — dengan pengaturan per trek | Ya — dengan pengaturan per trek | Ya — tampilan frekuensi dan pitch |
| Seleksi yang dibatasi frekuensi | Ya | Ya | Ya — marquee dan lasso |
| Kuas spektral | Ya | Ya | Ya — kuas cat dan penyembuhan spot |
| Menghapus atau memperkuat wilayah spektral | Ya — keduanya sebagai tindakan langsung | Ya — keduanya sebagai tindakan langsung | Sebagian — terapkan efek pada seleksi |
| Memperbaiki kerusakan pendek | Ya — Repair | Ya — Repair | Ya — Auto Heal dan Spot Healing Brush |
| Reduksi noise broadband | Ya — dengan profil yang ditangkap | Ya — dengan profil yang ditangkap | Ya — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| De-reverb | Tidak | Tidak | Ya — DeReverb |
| Alat klik, dengung, dan sibilansi | Sebagian — hanya Click Removal | Sebagian — hanya Click Removal | Ya — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Panel diagnostik | Sebagian — Find Clipping sebagai analis | Sebagian — Find Clipping sebagai analis | Ya — diagnostik dengan perbaikan per masalah |

## Efek dan plug-in

| Kemampuan | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Peralatan efek bawaan | Ya — 30 efek Audacity, plug-in Nyquist yang dibundel, dan efek pihak pertama yang tidak memiliki padanan upstream, seperti bitcrusher | Ya — koleksi bawaan 30-efek yang sama | Ya — sekitar lima puluh, termasuk dinamika multiband |
| Rak efek real-time per trek | Ya — set real-time yang lebih luas daripada upstream | Ya | Ya — enam belas slot per klip, trek, dan master |
| EQ parametrik | Ya — EQ parametrik baru dengan band yang dapat diotomasikan | Sebagian — Filter Curve dan Graphic EQ | Ya — filter parametrik, grafik, dan FFT |
| Preset efek | Ya — terapkan, simpan, impor, ekspor | Ya — terapkan, simpan, impor, ekspor | Ya |
| Makro dan rantai batch | Ya — pustaka makro tersimpan dengan templat | Tidak — build yang dipatok mengomentari menu Macros | Ya — Favorites dan Batch Process |
| Format plug-in pihak ketiga | Sebagian — VST3, CLAP, AU, LV2, serta efek LADSPA Linux dan penganalisis Vamp di desktop dengan persetujuan dan containment; tidak ada di browser | Ya — VST3, AU, LV2, dan Nyquist, dengan manajer plug-in | Sebagian — VST3, dan AU di macOS, tidak ada CLAP atau LV2 |
| Skrip Nyquist | Ya — plug-in yang dibundel dan prompt Nyquist | Ya — plug-in yang dibundel dan prompt Nyquist | Tidak |
| Paket efek terisolasi | Sebagian — paket WebAssembly yang ditinjau, satu dikirim dan yang eksternal dibatasi | Tidak | Tidak |
| Instrumen virtual | Tidak — setelah 1.0 | Tidak | Tidak |

## Mixing, routing, dan otomasi

| Kemampuan | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mixer dengan channel strips | Ya | Sebagian — kontrol trek dan trek master | Ya |
| Bus dan submix | Ya — bersarang, dengan validasi siklus | Tidak | Ya — trek bus |
| Sends | Ya — pre dan post fader, beberapa penugasan | Tidak | Ya — pre dan post fader |
| Grup VCA | Ya | Tidak | Tidak |
| Input sidechain | Ya | Tidak | Ya — melalui sends |
| Mix cue dan control-room | Ya | Tidak | Tidak |
| Kompensasi delay plug-in | Ya — playback, monitoring, bus, sidechain, render, dan freeze | Sebagian — tidak diekspos di sumber yang dipatok | Ya |
| Jalur otomasi | Ya — gain, pan, mute, sends, bus, dan parameter plug-in | Tidak — tidak ada jalur dan tidak ada alat envelope di build yang dipatok | Ya — volume, pan, dan parameter efek |
| Mode otomasi | Ya — baca, trim, sentuh, latch, dan tulis | Tidak | Sebagian — baca, tulis, latch, dan sentuh, tidak ada trim |
| Bentuk kurva | Ya — garis, tahan, dan kurva | Tidak | Ya — linear dan spline |
| Freeze trek | Ya — freeze, unfreeze, dan commit tanpa kehilangan state | Tidak | Sebagian — bounce ke trek baru |

## Metering dan analisis

| Kemampuan | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Meter kebisingan | Ya — gaya EBU R 128, dengan riwayat | Tidak — efek Normalisasi Kebisingan tetapi tidak ada meter | Ya — Loudness Radar ke ITU-R BS.1770 |
| Meter fase dan korelasi | Ya | Tidak | Ya — meter fase dan analisis |
| Pengukuran surround | Ya | Tidak | Sebagian — hingga 5.1 |
| Plot spektrum | Ya — Plot Spectrum | Sebagian — terdaftar, tetapi build yang dipinang mengomentari keluar dari menu Analyze | Ya — Frequency Analysis |
| Clipping dan RMS dalam waveform | Ya — keduanya, diaktifkan per proyek | Ya — keduanya, diaktifkan per proyek | Sebagian — indikator clip, RMS dalam Amplitude Statistics |
| Kontras kecerdasan ucapan | Ya — analis Contrast | Sebagian — terdaftar, tetapi build yang dipinang mengomentari keluar dari menu Analyze | Tidak |

## Saluran dan audio imersif

| Kemampuan | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Saluran per file | Ya — hingga 32 untuk format PCM | Sebagian — trek mono dan stereo | Ya — hingga 32 di editor waveform |
| Pencampuran surround | Ya — bed hingga 7.1.4 | Tidak | Sebagian — hingga 5.1 |
| Audio berbasis objek | Ya — objek di samping bed | Tidak | Tidak |
| Pembuatan dan passthrough ADM | Ya — BW64/ADM dengan pemeriksaan kepatuhan | Tidak | Tidak |
| Render binaural | Ya — model binaural bernama | Tidak | Sebagian — binauraliser untuk ambisonics |
| Ambisonics | Tidak | Tidak | Ya — ordo pertama, dengan VR panner |

## Ekspor dan pengiriman

| Kemampuan | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Output lossless | Ya — WAV, AIFF, BWF, dan BW64 ditulis secara native | Ya — WAV, AIFF, dan FLAC | Ya — WAV, AIFF, FLAC, dan lainnya |
| Output lossy | Sebagian — MP3, AAC, Opus, Vorbis, MP2, FLAC, dan WavPack, semuanya melalui runtime FFmpeg | Sebagian — MP3 bawaan, sisanya melalui instalasi FFmpeg opsional | Ya — bawaan |
| Pengaturan encoder kustom | Ya — target FFmpeg kustom | Ya — target FFmpeg kustom | Ya — opsi per format |
| Antrean ekspor | Ya — jeda, batalkan, coba lagi, dan urutkan ulang | Tidak — satu ekspor pada satu waktu | Sebagian — Batch Process tanpa kontrol antrean |
| Stems dan alternatif dalam satu kali jalan | Ya — diantrekan bersama dengan mix | Tidak | Sebagian — satu mixdown per stem |
| Pengiriman per wilayah | Ya — urutan mastering dengan metadata per wilayah, celah, dan fade | Sebagian — ekspor label, tidak ada ekspor multi-file di build yang dipinang | Ya — ekspor penanda ke file terpisah |
| Normalisasi kebisingan saat ekspor | Ya — bagian dari rencana pengiriman | Sebagian — jalankan efek terlebih dahulu | Ya — Match Loudness |
| Dither dan pemetaan saluran | Ya — kontrol eksplisit | Sebagian — dither di preferensi | Ya — kontrol eksplisit |
| Laporan pengiriman | Ya — terperinci per tugas | Tidak | Tidak |
| Antrean render bertahan setelah restart | Ya — di desktop, memulai ulang dari byte nol dengan jurnal crash | Tidak | Tidak |

## Pertukaran dengan alat lain

| Kemampuan | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Proyek Audacity | Ya — masuk dan keluar AUP4, dengan laporan penghapusan | Ya — native | Tidak |
| EDL | Sebagian — ekspor kelas CMX3600, tanpa impor | Tidak | Tidak |
| OpenTimelineIO | Sebagian — hanya ekspor | Tidak | Tidak |
| FCPXML | Sebagian — hanya ekspor | Tidak | Ya — impor dan ekspor |
| DAWproject | Ya — impor dan ekspor, dengan laporan pertukaran | Tidak | Tidak |
| OMF | Tidak | Tidak | Sebagian — impor dan ekspor |
| Round-trip dengan editor video | Sebagian — menyerahkan proyek yang sama ke Framescaper tanpa menyalin media | Tidak | Ya — Dynamic Link dengan Premiere Pro |
| Pertukaran label dan penanda | Ya — impor dan ekspor | Ya — impor dan ekspor | Ya — daftar penanda |

## Video

| Kemampuan | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Impor video untuk referensi | Ya — di timeline, dengan audio terkait | Tidak | Sebagian — satu trek video, pratinjau saja |
| Penyuntingan timeline video | Sebagian — penyuntingan dasar, permukaan penuh ada di Framescaper | Tidak | Tidak |
| Ekspor video | Ya — MP4 dan WebM melalui runtime FFmpeg | Tidak | Tidak — hanya audio |
| Kompositing, grading, dan efek | Sebagian — di Framescaper, pada proyek yang sama | Tidak | Tidak |

## Bantuan mesin

| Kemampuan | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Peningkatan ucapan | Sebagian — hanya desktop, setelah payload model diinstal | Tidak | Ya — Enhance Speech |
| Transkripsi dan diarisation | Sebagian — hanya desktop, model opsional | Tidak | Tidak — transkrip ada di Premiere Pro |
| Pemisahan sumber menjadi stem | Sebagian — hanya desktop, model opsional | Tidak | Tidak |
| Ducking otomatis | Ya — efek Auto Duck | Ya — efek Auto Duck | Ya — ducking Essential Sound |
| Deteksi beat dan shot | Sebagian — hanya desktop, model opsional | Tidak | Sebagian — Remix mengatur ulang waktu musik secara otomatis |
| Berjalan sepenuhnya di mesin Anda | Ya — inferensi hanya desktop dan offline setelah instalasi | Ya — tidak ada inferensi sama sekali | Sebagian — beberapa fitur diproses di cloud Adobe |
| Model opsional dan dapat dihapus | Ya — diunduh terpisah, terpin digest, dapat dihapus | Ya — tidak ada yang perlu diinstal | Tidak — dibundel dengan aplikasi |

## Apa yang ditambahkan oleh perbedaan-perbedaan ini

Audacity 4 adalah editor single-pass. Tidak memiliki bus, tidak memiliki sends, tidak memiliki jalur otomasi, dan tidak memiliki makro pada build yang terpin. Soundscaper mempertahankan model penyuntingan tersebut dan menambahkan lapisan mixing, otomasi, dan pengiriman di atasnya, plus perekaman, video, dan kerja pertukaran yang tidak dicoba oleh Audacity.

Audition masih memimpin dalam kedalaman restorasi, round-trip dengan Premiere Pro, dan ambisonics. Di mana Soundscaper memimpin adalah pengiriman imersif, penanganan proyek, dan fakta bahwa ia berjalan di browser pada perangkat keras yang tidak didukung oleh keduanya.

Jika Anda sudah bekerja di Audacity, lihat
[project files and Audacity interchange](/projects-and-data/project-files/) untuk
bagaimana memindahkan proyek.
