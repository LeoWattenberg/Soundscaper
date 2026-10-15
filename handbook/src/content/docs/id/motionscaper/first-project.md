---
title: "Proyek Animasi Pertama Anda"
description: "Buat komposisi, animasikan lapisan, dan ekspor proyek tersimpan."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","targetLocale":"id"} -->

## Buat dan tambah lapisan {#create-and-add-a-layer}

1. Pilih **Berkas → Komposisi Baru** dan masukkan judul, dimensi, laju bingkai,
   dan durasi dalam bingkai.
2. Pilih **Lapisan → Teks baru** atau **Lapisan → Warna solid baru**. Pilih komposisi
   target ketika proyek memuat beberapa komposisi.
3. Buka **Lapisan → Teks dan Tampilan** untuk menyunting lapisan teks yang ada atau
   isian dan goresan bentuk. Font yang diimpor di sini dipertahankan bersama proyek.

Gunakan **Berkas → Impor Media** untuk sumber gambar, video, atau audio. Impor yang
melebihi batas decoder atau memori saat ini akan ditolak dengan penjelasan;
berkas sumber asli tetap tidak berubah.

## Animasikan dan pratinjau {#animate-and-preview}

Buka **Lapisan → Properti dan Bingkai Kunci** untuk memilih properti lapisan dan menambahkan
bingkai kunci pada posisi bingkai yang tepat. Kontrol kurva mengubah interpolasi; penyuntingan
spasial mengubah jalur posisi. **Tampilan → Linimasa** membuka kontrol pengaturan waktu,
pengurutan, pengelompokan, dan area kerja lapisan.

Buka **Tampilan → Kanvas Komposisi** untuk memilih dan memindahkan lapisan 2D statis.
Persegi mengubah skalanya dan lingkaran memutarnya mengelilingi jangkar yang ditetapkan. Setiap
seretan yang selesai menjadi satu langkah pengurungan; Escape membatalkan seretan. Transformasi beranimasi dan
yang digerakkan ekspresi tetap berada dalam Properti dan Bingkai Kunci.

Buka **Tampilan → Pratinjau Komposisi** untuk mencari posisi atau memutar komposisi. Pratinjau
memakai media sumber yang dipertahankan. Pengaturan adegan yang tidak didukung atau tidak valid menghasilkan
kesalahan, bukan gambar pengganti. Tutup pratinjau untuk melepaskan sumber daya
render aktifnya.

## Simpan salinan portabel {#save-a-portable-copy}

Pilih **Berkas → Simpan** untuk menerbitkan revisi saat ini, lalu **Berkas → Simpan Salinan**
untuk mengunduh arsip `.mscape`. Arsip menyertakan proyek dan media asli
yang diperlukan untuk membukanya kembali. Buka dengan **Berkas → Buka** pada perangkat lain atau
dari pustaka browser baru.

## Render {#render}

Pilih **Berkas → Render**. Pilih komposisi, format output, dan
rentang bingkai. Bingkai akhir tidak termasuk: bingkai 0 hingga 29 memakai rentang
`0` sampai `30`. Area kerja pecahan memilih waktu sampel bilangan bulat yang terkandung di dalamnya;
area tanpa sampel output harus diubah sebelum merender.

Gunakan **Urutan PNG transparan (.tar)** untuk alfa. Ekstrak arsip TAR untuk
mendapatkan gambar PNG normal dan metadata pengaturan waktu. MP4 dan WebM memakai warna
latar belakang yang dipilih dalam dialog. Render mematok revisi yang dikirim sehingga suntingan
berikutnya tidak mengubah output yang sudah berlangsung. Menutup dialog render
membiarkan tugas tetap berjalan. **Berkas → Antrean Render** menampilkan kemajuan, pembatalan,
percobaan ulang revisi yang dikirim, dan unduhan yang selesai. Menutup editor
membatalkan tugas yang belum selesai.

Kembali ke [buku panduan Motionscaper](/motionscaper/).
