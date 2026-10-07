---
title: "Ekspor video"
description: "Validasi urutan yang disusun dan buat pengiriman MP4 atau WebM."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"id"} -->

## Sebelum mengekspor

- Mainkan seluruh urutan dan batas edit.
- Konfirmasikan bahwa trek yang terlihat dan disolo menghasilkan gambar yang diinginkan.
- Periksa apakah audio yang terhubung tetap sinkron.
- Konfirmasikan rentang ekspor dan apakah keterangan atau audio harus disertakan.

## Membuat berkas

Buka dialog ekspor dan pilih format video. Framescaper mendukung pengiriman MP4 dan WebM melalui runtime video yang dikonfigurasi. Pilih dimensi, kecepatan bingkai, dan opsi lainnya yang sesuai dengan tujuan.

Pengkodean video lebih intensif sumber daya daripada pemutaran garis waktu biasa. 
Jaga agar editor tetap terbuka hingga ekspor melaporkan penyelesaian.

## Mengekspor klip audio secara terpisah {#export-audio-clips}

Pilih **File → Ekspor video**, pilih format audio seperti **WAV**, lalu atur **Output** ke **Klip individual (pisahkan menurut klip)**. Ekspor mengunduh satu arsip yang berisi satu file untuk setiap klip audio. Klip video tidak disertakan, dan setiap file audio hanya berisi klipnya sendiri, termasuk pemangkasan dan edit klipnya.

File dimulai dari awal klip yang terdengar, tanpa ruang tambahan hingga posisi klip di proyek atau ekor efek. Nama klip bernomor membedakan klip yang namanya sama.

Efek trek disertakan; efek master, bisu, dan solo tidak memengaruhi ekspor ini. Lihat alur audio bersama di [Ekspor klip sebagai file terpisah](/soundscaper/edit-mix-and-export/#export-clips).

## Verifikasi pengiriman

Buka berkas yang diekspor di pemutar terpisah. Periksa durasinya, bingkai pertama dan terakhir, orientasi gambar, sinkronisasi audio, dan keterangan yang diharapkan.

Video yang dirender tidak dapat menggantikan proyek yang dapat diedit. Ekspor salinan `.fscape` juga ketika Anda perlu menjaga garis waktu dan media proyek.