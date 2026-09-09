---
title: "Berkas proyek"
description: "Pilih antara perpustakaan lokal, berkas proyek Scape, AUP4, dan cadangan yang telah dirender."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"id"} -->

## Perpustakaan proyek lokal

Editor menyimpan proyek kerja ke perpustakaan lokalnya. Pada peramban ini adalah penyimpanan pribadi asal; pada edisi desktop ini adalah data aplikasi. Ini adalah salinan kerja yang nyaman, bukan satu-satunya salinan yang harus Anda simpan.

## Berkas proyek Scape

Gunakan **Berkas → Ekspor berkas proyek** untuk proyek portabel tanpa kehilangan. Setiap produk menulis akhiran sendiri: Soundscaper menyimpan `.sscape` dan Framescaper menyimpan `.fscape`, dan entri menu menamakan yang berlaku. Format di balik keduanya sama, jadi ini adalah pilihan yang tepat saat Anda perlu menjaga keadaan penyuntingan media campuran.

Produk apa pun dapat membuka kedua akhiran tersebut. `.sscape`, `.fscape`, `.liscape` yang dilindungi, dan berkas `.scape` yang lebih lama yang diekspor sebelum produk memiliki akhiran mereka sendiri dapat dibuka di mana saja, dan menyimpan satu dari produk yang berbeda hanya mengubah namanya — misalnya, `Mix.sscape` yang disimpan dari Framescaper menjadi `Mix.fscape`. Tidak ada yang berubah pada proyek dengan nama tersebut.

Mengimpor atau membuka salinan Scape dapat menemukan proyek yang ada dengan ID yang sama. Gunakan alur kerja salinan yang ditawarkan saat kedua versi harus tetap ada di perpustakaan lokal.

## AUP4

AUP4 ada untuk pertukaran audio yang kompatibel dengan Audacity. Ekspor menghasilkan laporan kompatibilitas yang menggambarkan konversi, efek yang tidak tersedia, dan keadaan Soundscaper-hanya yang diabaikan.

AUP4 hanya audio. Video diabaikan, dan preferensi peramban, riwayat pembatalan, penataan mixer, dan perpustakaan proyek peramban tidak ditransfer. Jangan gunakan AUP4 sebagai cadangan satu-satunya proyek Soundscaper atau Framescaper.

## Cadangan yang dirender

Untuk pekerjaan penting, simpan kedua hal berikut:

1. Salinan proyek Scape (`.sscape` atau `.fscape`) untuk penyuntingan di masa mendatang.
2. Berkas audio atau video yang dirender yang dapat diputar tanpa editor.

Simpan berkas tersebut di luar direktori peramban atau data aplikasi.