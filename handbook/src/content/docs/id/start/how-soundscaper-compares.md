---
title: "Perbandingan Soundscaper"
description: "Bandingkan Soundscaper Web dan Desktop dengan Audacity 4 dan Adobe Audition untuk merekam, mengedit, mencampur, menyelesaikan, dan bertukar proyek."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"id"} -->

Soundscaper menerapkan ulang Audacity 4 di web dan menambahkan lapisan produksi. Adobe Audition adalah alat pascaproduksi komersial yang biasanya menjadi tolok ukur keduanya. Halaman ini membandingkan Soundscaper Web dan Desktop, Audacity 4, serta Audition agar Anda dapat melihat edisi mana yang sudah memenuhi kebutuhan.

## Cara membaca halaman ini

Setiap sel diawali simbol berwarna, lalu detail penjelasnya:

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — didukung atau berlaku
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — cakupan terbatas, bergantung platform, atau memerlukan solusi sementara
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — tidak tersedia atau tidak berlaku

Baca catatan bersama simbolnya. Memasang plug-in, model, atau codec opsional saja tidak membuat kemampuan desktop yang didukung menjadi terbatas; catatan menyebutkan yang perlu dipasang. Web dan Desktop memiliki kolom terpisah, jadi batasan browser tidak mengurangi penilaian Desktop.

Baris-baris menggambarkan kemampuan, bukan perintah menu. Untuk inventaris perintah yang tepat, lihat [Perintah dan pintasan](/reference/generated/commands/), dan untuk apa yang diaktifkan oleh masing-masing produk, lihat
[Kemampuan produk](/reference/generated/product-capabilities/).

### Dari mana klaim-klaim ini berasal

- Baris **Soundscaper** berasal dari repositori ini: profil kemampuan produk, manifes tindakan runtime, registri format ekspor, serta gerbang kemampuan codec browser dan desktop.
  CI repositori atau pengemasan target menghasilkan muatan target desktop native. Paket mengaktifkan kemampuan setelah hasil yang benar-benar cocok disiapkan dan diverifikasi; baris menunjukkan kapan muatan masih diperlukan.
- Baris **Audacity 4** berawal dari inventaris upstream yang dipatok di repositori ini, `4.0.0` pada commit `4c177d43`, dan mencakup perubahan yang terlihat pengguna hingga [rilis resmi `4.0.1`](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt) pada commit `d82386ce`. Kemampuan yang didaftarkan upstream tetapi dinonaktifkan atau dikomentari dari menu dicatat demikian. Jika tidak ada dalam inventaris yang diaudit dan catatan rilis, kemampuannya disebut tidak ada di sana, bukan absen selamanya. Penggambaran sampel, envelope gain klip, dan impor proyek lama juga didokumentasikan dalam [catatan perubahan resmi 4.0](https://www.audacityteam.org/changelog/) dan [panduan gain klip](https://www.audacityteam.org/manual/clips/clip-gain/).
- Baris **Audition** berasal dari dokumentasi yang dipublikasikan Adobe untuk rilis saat ini. Mereka tidak diverifikasi terhadap build yang berjalan.

## Platform dan istilah

| Kemampuan | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Lisensi | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL, open source | / — proprietary dan tertutup |
| Biaya | + — gratis | + — gratis | + — gratis | / — langganan Creative Cloud |
| Berjalan di browser | + — Chromium, Firefox, dan WebKit | / — aplikasi dalam paket | / — hanya desktop | / — hanya desktop |
| Build desktop | / — gunakan edisi browser | + — Windows dan Linux pada x64 dan ARM64, macOS pada ARM64 | + — Windows (installer atau portabel), macOS, dan Linux | ~ — Windows dan macOS, tidak ada Linux |
| Berfungsi tanpa akun | + — tidak ada akun | + — tidak ada akun | + — masuk hanya untuk audio.com | / — langganan yang masuk diperlukan |
| Penyimpanan proyek cloud | / — dikecualikan oleh desain local-first | / — dikecualikan oleh desain local-first | + — menyimpan dan berbagi melalui audio.com | ~ — file Creative Cloud, sesi tidak disinkronkan |
| Kebutuhan sistem | + — berjalan di mana pun browser saat ini berjalan | + — Windows, Linux, atau macOS pada arsitektur desktop yang didukung | ~ — meningkat secara signifikan dari Audacity 3 | ~ — kelas workstation profesional |

## Model proyek dan sesi

| Kemampuan | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Format proyek native | + — `.sscape`, arsip portabel lossless | + — `.sscape`, arsip portabel lossless | + — `.aup4` | + — `.sesx` |
| Membuka proyek Audacity | + — impor AUP, AUP3, dan AUP4; ekspor AUP3 dan AUP4 | + — impor AUP, AUP3, dan AUP4; ekspor AUP3 dan AUP4 | + — impor AUP, AUP3, dan AUP4; ekspor AUP4, tanpa ekspor AUP3 | / |
| Timeline klip non-destruktif | + | + | + | + — editor multitrack |
| Editor file tunggal khusus | + — editor gelombang sumber di Properti klip | + — editor gelombang sumber di Properti klip | ~ — edit diterapkan langsung di timeline | + — editor waveform |
| Konten mono dan stereo di satu trek | + — satu trek memegang salah satunya | + — satu trek memegang salah satunya | / — satu trek adalah mono atau stereo | / — format kanal tetap per trek |
| Folder trek bersarang | + — kedalaman apa pun, dapat dibatalkan, dengan routing | + — kedalaman apa pun, dapat dibatalkan, dengan routing | / | ~ — hanya bus submix, tidak ada trek folder |
| Baki proyek | + — mengatur file dan berfungsi sebagai clipboard | + — mengatur file dan berfungsi sebagai clipboard | / | ~ — panel Files mencantumkan file yang terbuka |
| Penyimpanan otomatis dan pemulihan crash | + — penyimpanan otomatis, kunci, dan amplop pemulihan | + — penyimpanan otomatis, kunci, dan amplop pemulihan | + | + |
| Penanda dan region bernama | + — kelas pertama, dengan navigasi dan perilaku ripple | + — kelas pertama, dengan navigasi dan perilaku ripple | ~ — trek label | + — penanda dan rentang |
| Peta tempo dan tanda waktu | + — peta berurutan yang diselesaikan secara akurat per sampel | + — peta berurutan yang diselesaikan secara akurat per sampel | ~ — satu tempo dan tanda proyek | ~ — satu tempo sesi |

## Perekaman

| Kemampuan | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Perekaman multitrack | + — beberapa sumber sekaligus | + — beberapa sumber sekaligus | ~ — satu perangkat input pada satu waktu | + — antarmuka multi-input dan multichannel |
| Audio mikrofon dan desktop bersamaan | ~ — tersedia bawaan saat browser dan sistem operasi menyediakan audio layar | + — mikrofon plus loopback desktop Windows; sistem lain memakai input loopback | / | ~ — membutuhkan perangkat loopback sistem operasi |
| Perekaman terjadwal | + | + | + | / |
| Perekaman yang diaktifkan suara | + — dengan ambang yang dapat diatur | + — dengan ambang yang dapat diatur | + — dengan ambang yang dapat diatur | / |
| Hitung mundur sebelum take | + — sadar peta tempo, menangani metrum majemuk | + — sadar peta tempo, menangani metrum majemuk | ~ — perekaman lead-in | ~ — pre-roll sebagai bagian dari punch and roll |
| Perekaman punch | + — satu transaksi, tangkapan default dan terarah | + — satu transaksi, tangkapan default dan terarah | / | + — punch and roll |
| Perekaman loop ke take | + — satu jalur per pass, ditambahkan ke grup yang sama | + — satu jalur per pass, ditambahkan ke grup yang sama | / | ~ — take pada satu klip, dipilih dari daftar |
| Comping take | + — audisi, promosikan, edit region comp, ratakan sebagai satu edit yang dapat dibatalkan | + — audisi, promosikan, edit region comp, ratakan sebagai satu edit yang dapat dibatalkan | / | / — tidak ada editor comp |
| Pemantauan dan metering input | + | + | + | + |

## Pengeditan timeline

| Kemampuan | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Varian edit ripple | + — per klip, per trek, dan semua trek, pada pemotongan dan penghapusan | + — per klip, per trek, dan semua trek, pada pemotongan dan penghapusan | + — tiga yang sama, pada pemotongan dan penghapusan | ~ — hapus ripple pada seleksi atau celah |
| Pemisahan, penggabungan, dan pemisahan pada keheningan | + | + | + | ~ — pemisahan dan pemotongan, tanpa penggabungan klip |
| Grup klip | + | + | + | + |
| Gain klip | + | + | + | + |
| Pitch dan kecepatan per klip | + — sesuaikan, render, atau atur ulang | + — sesuaikan, render, atau atur ulang | + — sesuaikan, render, atau atur ulang | ~ — stretch tetap dapat diedit, pitch adalah efek |
| Mengikuti perubahan tempo | + — klip stretch ketika peta bergerak | + — klip stretch ketika peta bergerak | + | / |
| Kuantisasi dan groove yang sadar beat | + — peta warp dengan kekuatan groove yang dapat disesuaikan | + — peta warp dengan kekuatan groove yang dapat disesuaikan | / | / |
| Snap ke nol persimpangan | + | + | + | + |
| Penggambaran tingkat sampel | + | + | + — tersedia saat diperbesar hingga sampel individual | + — di editor waveform |
| Penyuntingan hanya keyboard | + — setiap primitif edit memiliki tindakan navigasi | + — setiap primitif edit memiliki tindakan navigasi | + — tindakan edit, garis waktu, dan penggaris vertikal trek dapat dinavigasi dengan keyboard | ~ — pintasan luas, beberapa panel membutuhkan mouse |

## Kerja spektral dan pemulihan

| Kemampuan | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Tampilan spektrogram | + — dengan pengaturan per trek | + — dengan pengaturan per trek | + — dengan pengaturan per trek | + — tampilan frekuensi dan pitch |
| Seleksi yang dibatasi frekuensi | + | + | + | + — marquee dan lasso |
| Kuas spektral | + | + | + | + — kuas cat dan penyembuhan spot |
| Menghapus atau memperkuat wilayah spektral | + — keduanya sebagai tindakan langsung | + — keduanya sebagai tindakan langsung | + — keduanya sebagai tindakan langsung | ~ — terapkan efek pada seleksi |
| Memperbaiki kerusakan pendek | + — Repair | + — Repair | + — Repair | + — Auto Heal dan Spot Healing Brush |
| Reduksi noise broadband | + — dengan profil yang ditangkap | + — dengan profil yang ditangkap | + — dengan profil yang ditangkap | + — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| De-reverb | / — bantuan hanya tersedia di Desktop | + — Reduce Reverb setelah model dan mesin opsional dipasang | / | + — DeReverb |
| Alat klik, dengung, dan sibilansi | ~ — Click Removal dan De-esser; tidak ada penghapus dengung khusus | ~ — Click Removal dan De-esser; tidak ada penghapus dengung khusus | ~ — hanya Click Removal | + — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Panel diagnostik | ~ — Find Clipping sebagai analis | ~ — Find Clipping sebagai analis | ~ — Find Clipping sebagai analis | + — diagnostik dengan perbaikan per masalah |

## Efek dan plug-in

| Kemampuan | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Peralatan efek bawaan | + — efek turunan Audacity, plug-in Nyquist bawaan, dan efek buatan sendiri seperti Bitcrusher dan De-esser | + — efek turunan Audacity, plug-in Nyquist bawaan, dan efek buatan sendiri seperti Bitcrusher dan De-esser | + — 30 efek bawaan dalam build yang dipatok | + — sekitar lima puluh, termasuk dinamika multiband |
| Rak efek real-time per trek | + — set real-time yang lebih luas daripada upstream | + — set real-time yang lebih luas daripada upstream | + | + — enam belas slot per klip, trek, dan master |
| EQ parametrik | + — EQ parametrik baru dengan band yang dapat diotomasikan | + — EQ parametrik baru dengan band yang dapat diotomasikan | ~ — Filter Curve dan Graphic EQ | + — filter parametrik, grafik, dan FFT |
| Preset efek | + — terapkan, simpan, impor, ekspor | + — terapkan, simpan, impor, ekspor | + — terapkan, simpan, impor, ekspor | + |
| Makro dan rantai batch | + — pustaka makro tersimpan dengan templat | + — pustaka makro tersimpan dengan templat | / — build yang dipatok mengomentari menu Macros | + — Favorites dan Batch Process |
| Format plug-in pihak ketiga | / — plug-in native memerlukan Desktop | + — VST3, CLAP, AU, LV2, Linux LADSPA, dan Vamp; khusus platform, dengan persetujuan dan isolasi | + — VST3, AU, LV2, dan Nyquist, dengan manajer plug-in | ~ — VST3, dan AU di macOS, tidak ada CLAP atau LV2 |
| Skrip Nyquist | + — plug-in yang dibundel dan prompt Nyquist | + — plug-in yang dibundel dan prompt Nyquist | + — plug-in yang dibundel dan prompt Nyquist | / |
| Paket efek terisolasi | ~ — paket WebAssembly yang ditinjau, satu dikirim dan yang eksternal dibatasi | ~ — paket WebAssembly yang ditinjau, satu dikirim dan yang eksternal dibatasi | / | / |
| Instrumen virtual | / | / | / | / |

## Mixing, routing, dan otomasi

| Kemampuan | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Mixer dengan channel strips | + | + | ~ — kontrol trek dan trek master | + |
| Bus dan submix | + — bersarang, dengan validasi siklus | + — bersarang, dengan validasi siklus | / | + — trek bus |
| Sends | + — pre dan post fader, beberapa penugasan | + — pre dan post fader, beberapa penugasan | / | + — pre dan post fader |
| Grup VCA | + | + | / | / |
| Input sidechain | + | + | / | + — melalui sends |
| Mix cue dan control-room | + | + | / | / |
| Kompensasi delay plug-in | + — playback, monitoring, bus, sidechain, render, dan freeze | + — playback, monitoring, bus, sidechain, render, dan freeze | ~ — tidak diekspos di sumber yang dipatok | + |
| Jalur otomasi | + — gain, pan, mute, sends, bus, dan parameter plug-in | + — gain, pan, mute, sends, bus, dan parameter plug-in | ~ — envelope gain klip; tanpa jalur otomatisasi trek atau efek | + — volume, pan, dan parameter efek |
| Mode otomasi | + — baca, trim, sentuh, latch, dan tulis | + — baca, trim, sentuh, latch, dan tulis | / | ~ — baca, tulis, latch, dan sentuh, tidak ada trim |
| Bentuk kurva | + — garis, tahan, dan kurva | + — garis, tahan, dan kurva | ~ — hanya envelope gain klip | + — linear dan spline |
| Freeze trek | + — freeze, unfreeze, dan commit tanpa kehilangan state | + — freeze, unfreeze, dan commit tanpa kehilangan state | / | ~ — bounce ke trek baru |

## Metering dan analisis

| Kemampuan | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Meter kebisingan | + — gaya EBU R 128, dengan riwayat | + — gaya EBU R 128, dengan riwayat | / — efek Normalisasi Kebisingan tetapi tidak ada meter | + — Loudness Radar ke ITU-R BS.1770 |
| Meter fase dan korelasi | + | + | / | + — meter fase dan analisis |
| Pengukuran surround | + | + | / | ~ — hingga 5.1 |
| Plot spektrum | + — Plot Spectrum | + — Plot Spectrum | ~ — terdaftar, tetapi build yang dipinang mengomentari keluar dari menu Analyze | + — Frequency Analysis |
| Clipping dan RMS dalam waveform | + — toggle proyek dengan penggantian RMS per trek | + — toggle proyek dengan penggantian RMS per trek | + — keduanya, diaktifkan per proyek | ~ — indikator clip, RMS dalam Amplitude Statistics |
| Kontras kecerdasan ucapan | + — analis Contrast | + — analis Contrast | ~ — terdaftar, tetapi build yang dipinang mengomentari keluar dari menu Analyze | / |

Di Soundscaper, buka menu **Visualisasi trek** untuk mengaktifkan atau menonaktifkan **Setengah gelombang** atau **Tampilkan RMS pada gelombang**. Tampilan default, frekuensi crossover 3-band, dan pengaturan spektrogram ada di **Edit → Preferensi → Visualisasi trek**.

## Saluran dan audio imersif

| Kemampuan | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Saluran per file | + — hingga 32 untuk format PCM | + — hingga 32 untuk format PCM | ~ — trek mono dan stereo | + — hingga 32 di editor waveform |
| Pencampuran surround | + — bed hingga 7.1.4 | + — bed hingga 7.1.4 | / | ~ — hingga 5.1 |
| Audio berbasis objek | + — objek di samping bed | + — objek di samping bed | / | / |
| Pembuatan dan passthrough ADM | + — BW64/ADM dengan pemeriksaan kepatuhan | + — BW64/ADM dengan pemeriksaan kepatuhan | / | / |
| Render binaural | + — model binaural bernama | + — model binaural bernama | / | ~ — binauraliser untuk ambisonics |
| Ambisonics | / | / | / | + — ordo pertama, dengan VR panner |

## Ekspor dan pengiriman

| Kemampuan | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Output lossless | + — WAV, AIFF, BWF, dan BW64 native; FLAC dan WavPack melalui codec khusus | + — WAV, AIFF, BWF, dan BW64 native; FLAC dan WavPack melalui codec khusus | + — WAV, AIFF, dan FLAC | + — WAV, AIFF, FLAC, dan lainnya |
| Output lossy | ~ — MP3, MP2, Opus, dan Ogg Vorbis; AAC bergantung pada browser | + — MP3, MP2, Opus, Ogg Vorbis, dan AAC melalui penyedia codec yang didukung, termasuk FFmpeg yang dikonfigurasi | + — MP3, Opus, dan Ogg Vorbis; format tambahan melalui FFmpeg opsional | ~ — MP2, MP3, dan Ogg Vorbis; format lainnya melalui Adobe Media Encoder, tanpa target FFmpeg umum |
| Pengaturan encoder kustom | ~ — kontrol per format; argumen FFmpeg khusus tidak tersedia | ~ — kontrol per format; argumen FFmpeg khusus tidak tersedia | + — target FFmpeg kustom | + — opsi per format |
| Antrean ekspor | + — jeda, batalkan, coba lagi, dan urutkan ulang | + — jeda, batalkan, coba lagi, dan urutkan ulang | / — Export Multiple adalah satu operasi berurutan, bukan antrean tugas | ~ — Batch Process tanpa kontrol antrean |
| Stems dan alternatif dalam satu kali jalan | + — diantrekan bersama dengan mix | + — diantrekan bersama dengan mix | ~ — Export Multiple menulis tiap trek secara terpisah, tetapi tidak mengantrekan mix dan render alternatif bersama | ~ — satu mixdown per stem |
| Pengiriman per wilayah | + — urutan mastering dengan metadata per wilayah, celah, dan fade | + — urutan mastering dengan metadata per wilayah, celah, dan fade | + — Export Multiple menulis tiap wilayah berlabel ke file tersendiri | + — ekspor penanda ke file terpisah |
| Normalisasi kebisingan saat ekspor | + — bagian dari rencana pengiriman | + — bagian dari rencana pengiriman | ~ — jalankan efek terlebih dahulu | + — Match Loudness |
| Dither dan pemetaan saluran | + — kontrol eksplisit | + — kontrol eksplisit | ~ — dither di preferensi | + — kontrol eksplisit |
| Laporan pengiriman | + — terperinci per tugas | + — terperinci per tugas | / | / |
| Antrean render bertahan setelah restart | / — pemulihan render persisten memerlukan Desktop | + — memulai ulang dari byte nol dengan jurnal crash | / | / |

Soundscaper Desktop dapat memakai FFmpeg yang dikonfigurasi untuk format ekspor yang didukung; editor saat ini tidak menyediakan argumen FFmpeg sembarang atau semua encoder FFmpeg. Lihat [Format ekspor](/reference/generated/formats/) untuk target yang terdaftar. [Alur ekspor](https://www.audacityteam.org/manual/getting-started/export-your-audio/) Audacity menambahkan format melalui pemasangan FFmpeg opsional. Audition menyediakan sekumpulan penulis file tetap dan [transfer ke Adobe Media Encoder](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html).

## Pertukaran dengan alat lain

| Kemampuan | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Proyek Audacity | + — impor AUP, AUP3, dan AUP4; ekspor AUP3 dan AUP4 dengan laporan kompatibilitas | + — impor AUP, AUP3, dan AUP4; ekspor AUP3 dan AUP4 dengan laporan kompatibilitas | + — impor AUP, AUP3, dan AUP4; ekspor AUP4, tanpa ekspor AUP3 | / |
| Sesi Audition | / — impor SESX memerlukan Desktop | ~ — impor audio `.sesx` dengan laporan yang dihilangkan; tanpa ekspor | / — tidak ada impor SESX pada build yang dipatok | + — native |
| EDL | ~ — ekspor kelas CMX3600, tanpa impor | ~ — ekspor kelas CMX3600, tanpa impor | / | / |
| OpenTimelineIO | ~ — hanya ekspor | ~ — hanya ekspor | / | / |
| FCPXML | ~ — hanya ekspor | ~ — hanya ekspor | / | + — impor dan ekspor |
| DAWproject | + — impor dan ekspor, dengan laporan pertukaran | + — impor dan ekspor, dengan laporan pertukaran | / | / |
| OMF | / | / | / | ~ — impor dan ekspor |
| Round-trip dengan editor video | ~ — menyerahkan proyek yang sama ke Framescaper tanpa menyalin media | ~ — menyerahkan proyek yang sama ke Framescaper tanpa menyalin media | / | + — Dynamic Link dengan Premiere Pro |
| Pertukaran label dan penanda | + — impor dan ekspor | + — impor dan ekspor | + — impor dan ekspor | + — daftar penanda |

Untuk mengimpor `.sesx` dari Audition, lihat [File proyek](/projects-and-data/project-files/) untuk mengetahui pengaturan audio yang dipindahkan dan yang ditandai sebagai dilewati oleh laporan.

## Video

| Kemampuan | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Impor video untuk referensi | + — di timeline, dengan audio terkait | + — di timeline, dengan audio terkait | / | ~ — satu trek video, pratinjau saja |
| Penyuntingan timeline video | ~ — penyuntingan dasar, permukaan penuh ada di Framescaper | ~ — penyuntingan dasar, permukaan penuh ada di Framescaper | / | / |
| Ekspor video | ~ — MP4 dan WebM jika WebCodecs browser mendukung codec yang diperlukan | + — MP4 dan WebM dengan penyedia codec desktop terverifikasi | / | / — hanya audio |
| Kompositing, grading, dan efek | ~ — di Framescaper, pada proyek yang sama | ~ — di Framescaper, pada proyek yang sama | / | / |

## Bantuan mesin

Bantuan desktop tersedia setelah memasang bobot model opsional dan mesin native yang sesuai; alur kerja ini tidak tersedia di Web. Model Manager memasang keduanya. Lihat [Bantuan lokal](/reference/generated/local-assistance/) untuk alur kerja dan model yang tersedia.

| Kemampuan | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Peningkatan ucapan | / — bantuan hanya tersedia di Desktop | + — setelah model dan mesin opsional dipasang | / | + — Enhance Speech |
| Transkripsi dan diarisation | / — bantuan hanya tersedia di Desktop | + — setelah model dan mesin opsional dipasang | / | / — transkrip ada di Premiere Pro |
| Pemisahan sumber menjadi stem | / — bantuan hanya tersedia di Desktop | + — setelah model dan mesin opsional dipasang | / | / |
| Ducking otomatis | + — efek Auto Duck | + — efek Auto Duck | + — efek Auto Duck | + — ducking Essential Sound |
| Deteksi beat dan shot | / — deteksi ketukan memerlukan Desktop; deteksi shot tersedia di Framescaper | ~ — deteksi ketukan dengan model opsional; deteksi shot di Framescaper | / | ~ — Remix mengatur ulang waktu musik secara otomatis |
| Berjalan sepenuhnya di mesin Anda | + — pemrosesan lokal di browser; tanpa inferensi model | + — pemrosesan lokal dan inferensi luring setelah model dipasang | + — tidak ada inferensi sama sekali | ~ — beberapa fitur diproses di cloud Adobe |
| Model opsional dan dapat dihapus | / — tidak ada instalasi model di Web | + — diunduh terpisah, terpin digest, dapat dihapus | + — tidak ada yang perlu diinstal | / — dibundel dengan aplikasi |

## Apa yang ditambahkan oleh perbedaan-perbedaan ini

Audacity 4 adalah editor satu lintasan. Build yang dipatok tidak memiliki bus, send, jalur otomatisasi trek atau efek, maupun makro. Envelope gain klip menyediakan otomatisasi volume di dalam klip. Soundscaper mempertahankan model edit ini dan menambahkan otomatisasi trek dan efek, mixing dan delivery, serta fitur perekaman, video, dan pertukaran yang tidak ditangani Audacity.

Audition tetap unggul dalam kedalaman pemulihan, pertukaran dengan Premiere Pro, dan audio ambisonik. Soundscaper unggul dalam delivery imersif, pengelolaan proyek, serta kemampuan berjalan di browser pada perangkat keras yang tidak didukung dua produk lainnya.

Jika Anda sudah menggunakan Audacity, lihat [File proyek dan pertukaran Audacity](/projects-and-data/project-files/) untuk mengetahui cara memindahkan proyek.
