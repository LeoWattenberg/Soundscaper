---
title: "Web atau desktop"
description: "Memahami bagaimana edisi browser dan desktop yang dikemas menyimpan proyek dan mengakses berkas."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","targetLocale":"id"} -->

Kedua edisi memproses proyek secara lokal. Penyimpanan dan akses berkasnya berbeda.

## Editor Web

Edisi browser menyimpan proyek, rekaman, dan media impor dalam penyimpanan browser pribadi-asal. Ini tidak mengunggah proyek ke akun Soundscaper, dan tidak memerlukan akun.

Gunakan editor web ketika Anda ingin akses segera tanpa menginstal aplikasi. Ingatlah bahwa penyimpanan browser tetap tunduk pada kuota browser dan aturan pengusiran. Membersihkan data situs menghapus perpustakaan proyek lokal.

## Pratinjau Desktop

Pratinjau desktop yang dikemas menyimpan perpustakaan lokal yang diselamatkan secara otomatis di dalam aplikasi desktop. Mereka mengelompokkan runtime editor dan terjemahan yang dirilis untuk penyuntingan offline.

Paket desktop tidak ditandatangani. macOS hanya menerapkan segel kode ad-hoc tanpa identitas yang diperlukan oleh pemuatnya untuk menjalankan Electron dan biner asli; segel itu tidak membuat klaim penerbit atau kepercayaan. Oleh karena itu, Windows SmartScreen atau macOS Gatekeeper dapat menampilkan peringatan pengembang yang tidak diketahui untuk pratinjau dan paket stabil.

Membuka berkas `.aup4` mengimpor proyek independen ke perpustakaan desktop. Edit selanjutnya tidak menulis ulang berkas yang dibuka. **Simpan** memperbarui salinan perpustakaan; **Simpan Sebagai** membuat berkas pertukaran Audacity baru.

## Telepon dan Tablet

Editor web mempertahankan tata letak desktopnya di setiap layar, tetapi di bawah 900px lebar (sebuah telepon, atau tablet yang dipegang secara vertikal) ia melipat krom ke laci sehingga garis waktu tetap memiliki ruang:

- Tombol **Menu** di sudut kiri atas membuka laci dengan menu aplikasi lengkap, tab proyek, bilah tindakan, dan kotak alat alat. Mainkan, berhenti, rekam, dan cari tetap berada di bilah. Memilih perintah menutup laci.
- Header trek meluncur di atas jalur dari penangan **Header Trek** di sudut kiri atas garis waktu, atau dari **Lihat › Header Trek**. Mengetuk jalur atau menekan Escape menyembunyikannya lagi.
- Pengenalan di atas editor dilipat secara default pada layar sempit; **Tampilkan pengenalan** mengembalikannya.

**Edit › Preferensi › Penampilan › Tata Letak** beralih antara Otomatis, Kompak, dan Desktop, sehingga jendela kecil di desktop dapat mempertahankan krom desktop dan tablet lebar dapat memilih laci.

## Proyek Tidak Bergerak Secara Otomatis

Perpustakaan browser dan desktop terpisah. Pindahkan proyek dengan sengaja:

- Gunakan berkas proyek Soundscaper - `.sscape`, Framescaper - `.fscape` untuk proyek lengkap.
- Gunakan AUP4 ketika Anda membutuhkan pertukaran audio khusus dengan Audacity.
- Ekspor audio atau video yang dirender sebagai salinan pemutaran yang tahan lama.

Lihat [Berkas Proyek](/projects-and-data/project-files/) sebelum menghapus data situs browser atau data aplikasi desktop.