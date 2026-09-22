---
title: "Edit, campur, dan ekspor"
description: "Susun klip, seimbangkan trek, terapkan efek, dan buat file pengiriman."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","targetLocale":"id"} -->

## Atur klip

Pilih klip atau rentang waktu sebelum memilih perintah edit. Split membuat batas edit di posisi playhead. Varian Gap-preserving dan ripple menentukan apakah materi yang lebih akhir tetap di tempatnya atau bergerak untuk menutupi area yang dihapus.

Gunakan folder trek, grup klip, dan Project Bin untuk menjaga proyek yang lebih besar tetap terorganisir.

### Sesuaikan fade klip {#clip-fades}

Pilih klip audio untuk menampilkan pegangan segitiga kecil di sepanjang bagian atas bentuk gelombangnya, tepat di bawah header klip.
Tarik segitiga kiri ke dalam untuk fade-in, atau segitiga kanan ke dalam untuk fade-out. Bentuk gelombang berubah saat Anda menarik, dan area di atas kurva fade menjadi lebih gelap. Segitiga mengikuti batas fade; menarik salah satunya kembali ke sudutnya menghapus fade tersebut. Hanya klip yang Anda tarik yang berubah, bahkan ketika beberapa klip dipilih.

Pegangan menghilang saat Anda membatalkan pilihan klip, tetapi bentuk gelombang yang di-fade dan penanganannya tetap ada. Fade ini mempertahankan audio asli dan tetap dapat disesuaikan setelah menyimpan dan membuka ulang proyek. Lepaskan untuk mengonfirmasi fade, atau tekan **Escape** saat menarik untuk membatalkan. **Undo** membalikkan satu penarikan lengkap. Pemutaran dan ekspor menggunakan pengaturan fade yang dikonfirmasi.

Dengan klip terpilih difokuskan, tekan **Tab** untuk mencapai pegangan fade-nya. Tombol panah menyesuaikan durasi sebesar 10 milidetik, atau 100 milidetik dengan **Shift**. **Home** menghapus fade; **End** memperluasnya di seluruh klip.
Untuk input numerik, pilih **Edit → Audio clips → Clip properties** dan gunakan **Fading**.

## Bangun mix

Gunakan kontrol gain trek, pan, mute, dan solo untuk menyeimbangkan proyek. Panel Mixer menampilkan status proyek yang sama dalam tata letak yang berorientasi pada mix. Efek real-time tetap dapat disesuaikan; operasi destruktif atau yang dirender menciptakan perubahan proyek yang dapat dibatalkan selama riwayat tersedia.

Gunakan meter pemutaran dan analisis loudness untuk memeriksa hasil. Hindari menganggap target meter sebagai pengganti mendengarkan ekspor lengkap.

### Kurangi sibilansi {#reduce-sibilance}

Pilih **Effect → Noise removal and repair → De-esser**. Atur **Frequency** di dekat bagian kasar dari suara, lalu turunkan **Threshold** hingga sibilan melembut.
**Maximum reduction** membatasi pemotongan; mulai sekitar 6–9 dB. **Attack** yang lebih pendek menangkap awal konsonan, sedangkan **Release** mengontrol seberapa cepat frekuensi tinggi pulih. Hanya pita atas yang dikurangi.

### Kompres pita frekuensi terpisah {#multiband-compression}

Pilih **Effect → Volume and compression → Multiband compressor**. Dua crossover membagi sinyal menjadi pita rendah, menengah, dan tinggi. Setiap pita memiliki threshold, rasio, dan gain outputnya sendiri. Rasio 1 membuat dinamika pita tersebut tidak berubah. Attack dan release berlaku untuk ketiga pita. Crossover memiliki kemiringan 6 dB/oktaf yang lembut dan tumpang tindih; dengan semua rasio pada 1 dan gain pita pada 0 dB, sinyal asli lolos tanpa perubahan.

Kedua efek ini menautkan kanal mereka untuk mempertahankan keseimbangan stereo dan juga tersedia di rak efek trek dan master. Pengaturan rak disimpan dengan proyek dan dapat disesuaikan selama pemutaran. **Apply to selection** merender efek ke audio yang dipilih dan mendukung Undo. Otomasi timeline tidak tersedia untuk kedua efek ini.

### Gunakan efek LADSPA dan penganalisis Vamp {#native-audio-plugins}

Aplikasi desktop hanya dapat memindai plug-in pihak ketiga setelah Anda mengizinkan
suatu format dan salah satu foldernya di **Efek → Manajer Plug-in**. Pemindaian tidak
pernah otomatis. Izinkan setiap instalasi yang ditemukan sebelum menggunakannya, dan
instal hanya plug-in yang Anda percayai: plug-in native menjalankan kode yang dapat
dieksekusi meskipun Soundscaper menampungnya dalam proses pembantu yang diawasi.

Efek LADSPA tersedia di Linux. Buka efek tersebut dari **Efek → Plug-in Audio**
setelah mengaktifkannya di manajer. Soundscaper membuat kontrol dari port LADSPA
karena format ini tidak memiliki antarmuka vendor. Nilai kontrol tersebut serta status
efek (diaktifkan atau dilewati) disimpan bersama proyek.

Plug-in Vamp menganalisis audio, bukan mengubahnya. Setelah mengaktifkan instalasi Vamp,
pilih trek audio untuk menganalisis trek itu, atau jangan pilih trek audio apa pun untuk
menganalisis mix master. Seleksi waktu membatasi analisis; jika tidak, Soundscaper
menggunakan seluruh proyek. Pilih **Analisis → Plug-in Vamp**, pilih keluaran penganalisis
dan pengaturannya, lalu jalankan. Soundscaper menambahkan cap waktu yang dikembalikan
sebagai trek label baru hanya setelah seluruh analisis berhasil, sehingga pembatalan atau
perubahan proyek tidak meninggalkan label sebagian.

## Ekspor

Pilih **File → Export audio** untuk pengiriman mix atau **Export selected audio** ketika hanya seleksi yang harus dirender. Soundscaper juga dapat mengekspor stem dan label.

Format terkompresi menggunakan runtime FFmpeg. Format yang tepat dan ketersediaan kondisional tercantum dalam [referensi format yang dihasilkan](/reference/).

Putar file yang diekspor di aplikasi lain sebelum mengirimkan atau menghapus materi sumber.

Untuk pekerjaan gambar — menyusun urutan, efek video, dan pengiriman MP4 atau WebM — serahkan proyek ke [Framescaper](/framescaper/) dan lihat
[ekspor video](/framescaper/video-export/).
