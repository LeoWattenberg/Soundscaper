---
title: "Motionscaper"
description: "Buat komposisi beranimasi dan simpan proyek animasi yang dapat disunting secara lokal."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","targetLocale":"id"} -->

Motionscaper adalah editor grafis gerak dalam keluarga Scaper. Sebuah proyek
memuat komposisi, lapisan, animasi, dan media yang dipertahankan. Ekstensi berkas
proyeknya adalah `.mscape`.

Ini merupakan rilis pengembangan. Mulailah dengan salinan bahan sumber yang penting
dan simpan arsip proyek yang diekspor bersama pustaka kerja Anda.

## Mulai komposisi {#start-a-composition}

Pilih **Berkas → Komposisi Baru**. Menu **Lapisan** membuka alat teks, bentuk,
animasi, komposit, pelacakan, ekspresi, dan adegan 3D. **Tampilan →
Pratinjau Komposisi** membuka pemutaran; antarmuka penyuntingan baru muncul ketika Anda
memilihnya dari menu.

Pilih **Tampilan → Kanvas Komposisi** untuk memilih, memindahkan, mengubah skala, atau memutar lapisan dengan
transformasi 2D statis. Transformasi beranimasi tetap dapat disunting melalui alat properti
dan linimasa.

Dalam **Tampilan → Linimasa**, pilih lapisan yang ada untuk mengganti nama, mengaktifkan, menonaktifkan, atau
menghapusnya. Penggantian nama mempertahankan referensi properti dan animasi. Menghapus
lapisan mempertahankan media aslinya; sertakan lapisan dependennya atau lepaskan
tautannya terlebih dahulu. **Urungkan** memulihkan lapisan yang dihapus. Lapisan video terpilih juga
menawarkan kotak centang audio ketika sumber yang dipertahankan mengandung audio.

Ikuti [proyek animasi pertama Anda](/motionscaper/first-project/) untuk membuat,
menganimasikan, menyimpan, dan merender komposisi.

## Simpan dan distribusikan {#save-and-deliver}

**Berkas → Simpan** menerbitkan revisi tersimpan. **Simpan Salinan** mengekspor cuplikan
saat ini sebagai arsip `.mscape` tanpa menerbitkan revisi tersimpan baru.
Media dan font asli yang diimpor turut disertakan dalam arsip. **Pustaka
Proyek** membuka proyek yang disimpan pada perangkat ini.

**Berkas → Render** menawarkan bingkai PNG transparan dalam arsip TAR,
video opak MP4 atau WebM, dan ProRes 4444 jika encoder desktop tersedia.
Urutan PNG tidak menyertakan audio. Video browser mempertahankan audio yang dibuat jika
encodernya mendukung format yang diminta. ProRes native melaporkan presisi efektif
warna dan alfa dalam dialog render. **Berkas → Antrean Render** menjaga tugas tetap
tersedia ketika dialog ditutup atau proyek diganti. Antrean menyimpan hingga delapan
tugas dan 128 MiB unduhan browser; setiap unduhan mengizinkan hingga 64 MiB. Pilih
tujuan berkas streaming untuk output yang lebih besar dan hapus tugas yang selesai untuk
melepaskan unduhan tersimpan. Jika pembersihan output native gagal, gunakan **Coba lagi pembersihan
output** dalam antrean ini. Tugas mempertahankan tujuannya hingga pembersihan berhasil;
setelah itu Anda dapat menghapusnya atau mencoba lagi revisi yang dikirim dengan tujuan baru.

## Tautkan ke Framescaper {#link-to-framescaper}

Komposisi tertaut memerlukan lini pengembangan Framescaper 1.1 yang terpisah.
Dalam dialog **Berkas → Komposisi tertaut** di sana, buat URL pemasangan. Tempelkan
ke dialog **Berkas → Kirim Komposisi ke Framescaper** pada Motionscaper, hubungkan,
dan biarkan editor beserta jendela penghubungnya terbuka. Operasi **Simpan** berikutnya mengirim
revisi baru secara otomatis; **Simpan Salinan** tidak.

Framescaper mempertahankan setiap revisi yang diterima dan seluruh media yang diperlukan untuk
penggunaan luring. Urungkan mematok revisi sebelumnya sampai Anda melanjutkan pembaruan. Perubahan
ukuran output, pengaturan waktu, atau kisi audio memerlukan tinjauan Konformasi yang eksplisit.
Penerima desktop juga dapat memantau berkas `.mscape` tersimpan yang Anda pilih.

## Periksa pembaruan desktop {#check-desktop-updates}

Pilih **Bantuan → Periksa Pembaruan** dalam aplikasi desktop. Pemeriksaan manual ini mencari
rilis Motionscaper yang kompatibel dalam repositori GitHub proyek. Versi
pratinjau dapat menerima rilis pratinjau yang lebih baru; versi stabil menerima rilis
stabil. Pilih **Lihat rilis** untuk membuka halaman rilis yang diverifikasi. Pemeriksaan ini
tidak mengunduh atau memasang pembaruan. Build browser tidak menyertakan perintah menu ini.

## Pertukaran After Effects {#after-effects-exchange}

**Berkas → Penghubung After Effects** menyediakan skrip yang dapat dibaca dan meninjau data pertukaran
yang didukung sebelum diimpor. Berkas `.aep` dan `.aepx` dibuka melalui
salinan After Effects terpasang dan skrip penghubung. Penghubung pengembangan
belum divalidasi terhadap After Effects terpasang. Tinjau laporannya;
maksud adegan yang tidak didukung dan media asli tetap dipertahankan dalam proyek.

Dialog menawarkan opsi impor dan ekspor terpisah untuk ekspresi skalar
opasitas yang didukung dengan aritmetika, waktu komposisi, nilai sebelum
ekspresi, dan fungsi Math standar. Kedua opsi awalnya nonaktif. Tinjau laporan
baru setelah mengubah opsi; bentuk ekspresi lain memerlukan pengambilan sampel
atau render secara eksplisit. Sumber ekspresi asli tetap ada dalam pertukaran
yang dipertahankan atau arsip `original.mscape`.

Renderer mendukung warna dan alfa SDR dengan lapisan 2.5D, kamera, cahaya,
pengambilan sampel rana, dan kedalaman bidang. Tidak ada klaim dukungan HDR, mesh 3D penuh,
masking AI tingkat lanjut, atau kompatibilitas sembarang plug-in After Effects.
