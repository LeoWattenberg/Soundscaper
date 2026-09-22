---
title: "Impor dan ekspor"
description: "Membedakan media sumber, berkas proyek, berkas pertukaran, dan hasil rendering."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","targetLocale":"id"} -->

Soundscaper menggunakan berbagai jenis file untuk pekerjaan yang berbeda.

## Media Sumber

Gunakan **File → Import** untuk audio, video, dan label. Petunjuk editor saat ini mencantumkan
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF, dan WebM; kontainer video tambahan didukung oleh jalur impor video. Ketersediaan dapat bergantung pada
produk aktif dan runtime.

Mengimpor media menambahkan sumber yang dimiliki proyek. Ini tidak membuat file asli
dokument proyek yang dapat diedit.

Impor dan ekspor audio terkompresi mendukung hingga satu jam atau 1 GB
(1.000.000.000 byte berkas), mana pun yang tercapai lebih dahulu. Berkas stereo
48 kHz berdurasi satu jam didukung jika masih memenuhi batas berkas tersebut. Pekerjaan
panjang membaca, menyandikan, dan menyimpan dalam beberapa bagian; ekspor browser
berukuran besar memerlukan penyimpanan file privat-origin dan ruang kosong yang cukup.
Impor besar memerlukan penyimpanan lokal persisten untuk audio yang telah didekodekan.
Format PCM memiliki batasnya sendiri.

Tingkat browser mencakup MP3, MP2, FLAC, WavPack, Opus, dan Ogg Vorbis. Dukungan
AAC/M4A di browser bergantung pada codec browser. Ekspor streaming desktop mencakup
keenam format bawaan tersebut, dengan FLAC 24-bit dan WavPack lossless float32.
Impor desktop bergantung pada ketersediaan dekoder native; MP2 memakai tingkat
kompatibilitas utilitas yang lebih kecil. AAC desktop dan penyedia kompatibilitas
memiliki batasnya sendiri.

Pekerjaan aktif menampilkan bilah kemajuan meskipun **Tampilan → Bilah status**
disembunyikan. Pilih **Batal** di samping bilah untuk menghentikan impor atau ekspor audio.

## File proyek yang dapat diedit

- Scape (`.sscape` dari Soundscaper, `.fscape` dari Framescaper, dan keduanya dapat dibuka) adalah format proyek portabel, fidelitas penuh yang dibagikan oleh Soundscaper
  dan Framescaper.
- AUP4 adalah pertukaran audio-only dengan Audacity. Ini bukan cadangan penuh dari
  proyek Soundscaper multimedia campuran.

Lihat [File Proyek](/projects-and-data/project-files/) untuk konsekuensi dari
tiap pilihan.

## Pengiriman yang dirender

Ekspor audio membuat file yang dimaksudkan untuk mendengarkan, menerbitkan, atau pemrosesan lebih
lanjut. Ekspor video membuat pengiriman MP4 atau WebM. File yang dirender tidak
mempertahankan garis waktu yang dapat diedit, routing, efek, atau riwayat proyek.

Konsultasi bagian [referensi](/reference/) untuk tabel format yang dihasilkan dan
kepampuan produk.
