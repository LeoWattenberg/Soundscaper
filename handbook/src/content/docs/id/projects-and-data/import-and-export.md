---
title: "Impor dan ekspor"
description: "Membedakan media sumber, berkas proyek, berkas pertukaran, dan hasil rendering."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"id"} -->

Soundscaper menggunakan berbagai jenis file untuk pekerjaan yang berbeda.

## Media Sumber

Gunakan **File → Import** untuk audio, video, dan label. Petunjuk editor saat ini mencantumkan
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF, dan WebM; kontainer video tambahan didukung oleh jalur impor video. Ketersediaan dapat bergantung pada
produk aktif dan runtime.

Mengimpor media menambahkan sumber yang dimiliki proyek. Ini tidak membuat file asli
dokument proyek yang dapat diedit.

Ekspor audio terkompresi dan impor browser mendukung hingga satu jam atau 1 GB
(1.000.000.000 byte berkas), mana pun yang tercapai lebih dahulu. Pemilihan berkas desktop dan impor audio terkompresi tidak memiliki batas tetap ukuran atau durasi di bawah rentang bilangan bulat aman. Pekerjaan panjang membaca, menyandikan, dan menyimpan dalam beberapa bagian; ekspor browser yang besar memerlukan penyimpanan berkas privat-origin dan ruang kosong yang cukup. Impor besar memerlukan penyimpanan lokal yang cukup untuk audio hasil dekode. Struktur format, dukungan dekoder, dan penyimpanan yang tersedia juga dapat membatasi impor.

Tingkat browser mencakup MP3, MP2, FLAC, WavPack, Opus, dan Ogg Vorbis. Dukungan
AAC/M4A di browser bergantung pada codec browser. Ekspor streaming desktop mencakup
keenam format bawaan tersebut, dengan FLAC 24-bit dan WavPack lossless float32.
Impor desktop bergantung pada ketersediaan dekoder; sumber MP2 besar menggunakan dekoder paket, sedangkan sumber MP2 yang lebih kecil menggunakan tingkat kompatibilitas utilitas.

Pekerjaan aktif menampilkan bilah kemajuan meskipun **Tampilan → Bilah status**
disembunyikan. Pilih **Batal** di samping bilah untuk menghentikan impor atau ekspor audio.

## File proyek yang dapat diedit

- Scape (`.sscape` dari Soundscaper, `.fscape` dari Framescaper, dan keduanya dapat dibuka) adalah format proyek portabel, fidelitas penuh yang dibagikan oleh Soundscaper
  dan Framescaper.
- AUP3 dan AUP4 menyediakan pertukaran audio dengan Audacity. Pilih AUP3 untuk profil proyek Audacity 3.7.9 atau AUP4 untuk profil pertukaran saat ini. Keduanya bukan cadangan penuh proyek Soundscaper dengan media campuran; periksa laporan kompatibilitas setelah ekspor.
- Edisi desktop dapat membuka sesi Adobe Audition SESX (`.sesx`) untuk membuat proyek lokal dari berkas audio yang dirujuk. Simpan sesi dan media asli; ekspor SESX tidak tersedia.

Lihat [File Proyek](/projects-and-data/project-files/) untuk konsekuensi dari
tiap pilihan.

## Pengiriman yang dirender

Ekspor audio membuat file yang dimaksudkan untuk mendengarkan, menerbitkan, atau pemrosesan lebih
lanjut. Ekspor video membuat pengiriman MP4 atau WebM. File yang dirender tidak
mempertahankan garis waktu yang dapat diedit, routing, efek, atau riwayat proyek.

Konsultasi bagian [referensi](/reference/) untuk tabel format yang dihasilkan dan
kepampuan produk.
