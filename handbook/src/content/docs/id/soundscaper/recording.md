---
title: "Merekam audio"
description: "Berikan izin input ke editor, pilih rute, dan lindungi hasil rekaman yang sudah selesai."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","targetLocale":"id"} -->

## Menyiapkan masukan

1. Buka kontrol perangkat perekam dan pilih masukan yang tersedia.
2. Izinkan izin mikrofon atau penangkapan saat browser meminta.
3. Aktifkan pemantauan masukan jika Anda perlu memeriksa tingkat masuk sebelum
   perekaman.
4. Periksa meter perekaman dan sesuaikan tingkat perangkat atau masukan untuk menghindari
   pemotongan.

Izin browser berlaku untuk situs dan perangkat. Jika tidak ada masukan yang muncul,
periksa kembali izin sistem operasi dan browser.

## Merekam satu atau beberapa trek

Untuk perekaman normal, gunakan menu **Rekam** atau tindakan perekaman transportasi.

Untuk rute multitrack, pilih **Lihat → Aktifkan perekaman multitrack**, bekukan trek yang ingin Anda rekam, dan tetapkan masukan untuk setiap trek yang dibekukan. Perekaman
tidak akan dimulai jika tidak ada masukan yang tersedia yang ditetapkan.

Soundscaper juga mengekspos alur kerja perekaman yang diatur waktu, punch/count-in, loop/take, dan diaktifkan suara melalui menu-nya. Mulailah dengan take normal sebelum menambahkan
persyaratan ini.

## Setelah take

Hentikan perekaman dan putar klip baru sebelum melanjutkan. Tunggu status proyek melaporkan bahwa penyimpanan selesai. Untuk materi yang tidak dapat diganti, ekspor salinan audio yang dirender dan proyek `.sscape` daripada hanya mengandalkan
pustaka lokal.