---
title: "Impor dan ekspor"
description: "Membedakan media sumber, berkas proyek, berkas pertukaran, dan hasil rendering."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"fd6f45277d29c1bf8e2d17b2265b46483362e3c945300ee8420ac6676ca7d878","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fd6f45277d29c1bf8e2d17b2265b46483362e3c945300ee8420ac6676ca7d878","targetLocale":"id"} -->

Soundscaper menggunakan berbagai jenis file untuk pekerjaan yang berbeda.

## Media Sumber

Gunakan **File → Import** untuk audio, video, dan label. Petunjuk editor saat ini mencantumkan
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF, dan WebM; kontainer video tambahan didukung oleh jalur impor video. Ketersediaan dapat bergantung pada
produk aktif dan runtime.

Mengimpor media menambahkan sumber yang dimiliki proyek. Ini tidak membuat file asli
dokument proyek yang dapat diedit.

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