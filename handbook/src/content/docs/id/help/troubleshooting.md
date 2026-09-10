---
title: "Pemecahan Masalah"
description: "Selesaikan masalah umum terkait perekaman, penyimpanan, impor, dan ekspor."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","targetLocale":"id"} -->

## Input rekaman tidak ada

Periksa izin mikrofon sistem operasi dan browser, lalu buka kembali
pemilih perangkat. Untuk rekaman multitrack, pastikan setiap track yang diaktifkan memiliki
penugasan input yang tersedia.

## Perintah dinonaktifkan

Banyak perintah bergantung pada keadaan saat ini. Pilih proyek, track,
klip, atau rentang waktu yang diperlukan dan coba lagi. Fitur juga dapat dibatasi secara sengaja
hanya untuk Soundscaper atau Framescaper.

## Impor menggunakan terlalu banyak memori

Dekompresi dan beberapa operasi besar dapat memerlukan memori sementara yang substansial
meskipun audio proyek yang disimpan dipecah. Tutup tab atau
aplikasi yang tidak terkait, coba lagi dengan sumber yang lebih kecil, atau gunakan edisi desktop saat
sesuai.

## Proyek hilang dari browser

Pastikan Anda membuka profil browser, origin, dan situs produk yang sama.
Soundscaper dan Framescaper berbagi pustaka pada `soundscaper.org`
yang sama, tetapi domain lain, profil browser, atau situs yang dibersihkan memiliki
pustaka yang berbeda.

Jika data situs dibersihkan dan tidak ada ekspor proyek Scape, editor tidak memiliki salinan cloud
untuk dipulihkan.

## AUP4 mengabaikan sebagian proyek

Baca laporan kompatibilitas. AUP4 membawa keadaan pengeditan audio yang kompatibel tetapi
mengabaikan video dan dapat mengonversi atau mengabaikan efek dan keadaan mixing khusus Soundscaper.
Gunakan file proyek Scape — `.sscape` atau `.fscape`, keduanya dapat dibuka di salah satu produk — untuk transfer proyek lengkap.

## Ekspor gagal atau tidak dapat diputar

Coba lagi setelah memastikan bahwa rentang yang dipilih berisi materi yang dapat diputar. Untuk
audio atau video terkompresi, verifikasi bahwa aset runtime dapat dimuat. Setelah
ekspor berhasil, uji file sebenarnya di pemutar lain.

Untuk masalah yang belum terselesaikan, gunakan **Bantuan → Dukungan** untuk menghubungi pemelihara dan
sertakan produk, platform, build browser atau desktop, langkah-langkah, dan error yang persis.
