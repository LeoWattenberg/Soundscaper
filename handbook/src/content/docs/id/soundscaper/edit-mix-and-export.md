---
title: "Edit, campur, dan ekspor"
description: "Susun klip, seimbangkan trek, terapkan efek, dan buat file pengiriman."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","targetLocale":"id"} -->

## Atur klip

Pilih klip atau rentang waktu sebelum memilih perintah edit. Split membuat batas edit di posisi playhead. Varian Gap-preserving dan ripple menentukan apakah materi yang lebih akhir tetap di tempatnya atau bergerak untuk menutupi area yang dihapus.

Gunakan folder trek, grup klip, dan Project Bin untuk menjaga proyek yang lebih besar tetap terorganisir.

### Sesuaikan fade klip {#clip-fades}

Pilih klip audio untuk menampilkan pegangan segitiga kecil di sepanjang bagian atas bentuk gelombangnya, tepat di bawah header klip.
Tarik segitiga kiri ke dalam untuk fade-in, atau segitiga kanan ke dalam untuk fade-out. Bentuk gelombang berubah saat Anda menarik, dan area di atas kurva fade menjadi lebih gelap. Segitiga mengikuti batas fade; menarik salah satunya kembali ke sudutnya menghapus fade tersebut. Hanya klip yang Anda tarik yang berubah, bahkan ketika beberapa klip dipilih.

Pegangan menghilang saat Anda membatalkan pilihan klip, tetapi bentuk gelombang yang di-fade dan penanganannya tetap ada. Fade ini mempertahankan audio asli dan tetap dapat disesuaikan setelah menyimpan dan membuka ulang proyek. Lepaskan untuk mengonfirmasi fade, atau tekan **Escape** saat menarik untuk membatalkan. **Undo** membalikkan satu penarikan lengkap. Pemutaran dan ekspor menggunakan pengaturan fade yang dikonfirmasi.

Dengan klip terpilih difokuskan, tekan **Tab** untuk mencapai pegangan fade-nya. Tombol panah menyesuaikan durasi sebesar 10 milidetik, atau 100 milidetik dengan **Shift**. **Home** menghapus fade; **End** memperluasnya di seluruh klip.
Untuk input numerik, pilih **Edit → Audio clips → Clip properties** dan gunakan **Fading**.

### Edit sumber klip {#clip-source-properties}

Pilih **Edit → Klip audio → Properti klip** untuk membuka editor sumber. Rekaman lengkap tampil di belakang klip. Seret tepi klip untuk mengubah awal dan durasi sumber sambil mempertahankan awal klip pada garis waktu proyek. Panel **Normalisasi** memuat gain klip serta tindakan puncak dan loudness.

Buka **Pitch dan tempo**, lalu centang **Tautkan pitch dan tempo** untuk mengubah kecepatan dan pitch bersama-sama. Rasio kecepatan `1` dan perubahan pitch `0%` tidak mengubah suara. Rasio `2` memutar dua kali lebih cepat dan satu oktaf lebih tinggi; `0.5` memutar setengah kecepatan dan satu oktaf lebih rendah. Mengedit salah satu kontrol tertaut akan memperbarui kontrol lainnya. Memutus tautan mengembalikan pengaturan pitch independen sambil mempertahankan rasio kecepatan saat ini.

**Ctrl+klik** bentuk gelombang untuk menambahkan penanda peregangan yang terikat ke sampel sumber tersebut. Menyeretnya mengubah pengaturan waktu di kedua sisi; overlay menampilkan kedua laju pemutaran. Kontrol klip tetap berlaku per klip. Memilih audio sumber dan menerapkan efek akan memperbarui setiap klip yang menggunakan sumber tersebut.

### Edit klip dalam spreadsheet {#clip-spreadsheet}

Pilih **Tampilan → Panel → Spreadsheet klip** untuk melihat semua klip dalam proyek. Panel terbuka di bawah garis waktu. Menu panel dapat memindahkannya ke dok lain, menjadikannya jendela mengambang, atau menutupnya. Ukuran dan posisinya disimpan bersama ruang kerja. Setiap baris menampilkan trek, posisi garis waktu, berkas sumber, offset sumber, durasi, pitch, kecepatan, gain, fade, dan opsi pemutaran. Waktu dalam detik, pitch dalam semiton, dan kecepatan berupa rasio: `1` berarti normal dan `2` berarti dua kali lebih cepat.

Klik dua kali sel atau pilih lalu tekan **Enter** untuk mengedit nilainya. Tekan **Enter** untuk menerapkan perubahan atau **Escape** untuk membatalkan. Sel trek dan sumber menampilkan ID sebenarnya. Ubah ID trek untuk memindahkan klip ke trek audio yang sudah ada. Ubah ID sumber atau masukkan jalur berkas lokal untuk mengganti audionya sambil mempertahankan posisi garis waktu, durasi, kecepatan, dan offset sumber dalam detik. Berkas baru harus berisi rentang sumber tersebut. **Dibalik** dan **Terbalik** adalah kotak centang; pilih sel dan tekan **Spasi** untuk mengubahnya. Klip di trek terkunci dan klip video bersifat hanya-baca.

Mengubah durasi memangkas atau memperpanjang rentang sumber dari offset saat ini. Mengubah kecepatan mempertahankan rentang sumber, kecuali jika durasi juga ditempel. Lepaskan grup atau tautan klip sebelum mengubah waktunya di sini; atur waktu klip yang diregangkan melalui editor sumber.

Pilih sel, seret melintasi rentang, atau **Shift+klik** sel lain untuk memperluas pilihan. Klik nomor baris atau judul kolom untuk memilih seluruh baris atau kolom. Gunakan **Ctrl+C** dan **Ctrl+V** (**Cmd+C** dan **Cmd+V** di macOS) untuk bertukar pilihan dengan spreadsheet. Kolom dipisahkan tab dan baris dipisahkan baris baru. Penempelan dimulai di sel yang dipilih dan memperbarui klip yang ada. Penempelan yang melewati baris yang tersedia akan ditolak. Saat ada pilihan, tekan **Escape** atau klik ruang kosong di bawah tabel untuk menghapus pilihan. Tanpa pilihan, penempelan menyisipkan baris baru, termasuk dalam proyek kosong. Opsi pemutaran disalin sebagai `true` atau `false` dan menerima nilai tersebut saat ditempel. Baris baru mengikuti urutan kolom tabel dan memerlukan nama berkas sumber atau ID sumber. Nama trek yang sudah ada dan unik menempatkan klip di trek tersebut; nama baru membuat trek audio. Nama trek kosong menggunakan nama sumber. Sel angka kosong memakai nilai default: posisi dan offset `0`, kecepatan `1`, pitch dan gain `0`, tanpa fade. Durasi kosong menggunakan sisa audio pada kecepatan yang diminta.

Panel lebih dahulu mencari sumber dalam proyek, termasuk Bin Proyek. Jika tidak ada, pilih **Muat berkas yang dirujuk** dan pilih berkas audio yang tercantum dalam dialog. Jalur berkas di disk juga memerlukan pemilihan ini: menempelkan jalur tidak memberi aplikasi akses ke berkas. Berkas yang dipilih harus cocok secara unik dengan nama rujukan. Panel mengimpor audio, memvalidasi batas sumber dan properti klip, lalu menempatkan klip baru pada posisi yang ditentukan. **Ctrl+Z** (**Cmd+Z** di macOS) membatalkan seluruh penempelan dalam satu langkah; **Ctrl+Shift+Z** (**Cmd+Shift+Z**) mengulanginya. Jika penempelan berisi nilai tidak valid, klip tidak berubah.

## Bangun mix

Gunakan kontrol gain trek, pan, mute, dan solo untuk menyeimbangkan proyek. Panel Mixer menampilkan status proyek yang sama dalam tata letak yang berorientasi pada mix. Efek real-time tetap dapat disesuaikan; operasi destruktif atau yang dirender menciptakan perubahan proyek yang dapat dibatalkan selama riwayat tersedia.

Gunakan meter pemutaran dan analisis loudness untuk memeriksa hasil. Hindari menganggap target meter sebagai pengganti mendengarkan ekspor lengkap.

### Dengarkan frekuensi yang dipilih {#listen-to-selected-frequencies}

Pilih bagian yang ingin didengar. Dari menu trek, pilih **Visualisasi trek → Spektrogram**, lalu buka **Opsi spektrogram → Pilih rentang frekuensi spektral**. Masukkan frekuensi minimum dan maksimum lalu pilih **Pilih rentang**, atau sesuaikan gagang pilihan pada spektrogram.

Pilih **Opsi pemutaran → Putar frekuensi yang dipilih** atau **Pilih → Spektral → Putar frekuensi yang dipilih**. Rentang waktu yang dipilih diputar sekali pada kecepatan normal, meskipun sebelumnya memilih kecepatan lain atau pemutaran berulang. Filter dengar berlaku pada mix saat ini, termasuk pengaturan mute, solo, gain, dan efek. Persegi panjang spektral menandai pita frekuensi dan rentang waktu, tetapi tidak membuat trek menjadi solo. Jika pemutaran sedang berlangsung, perintah ini menjedakannya; pilih lagi untuk memulai pratinjau frekuensi.

Filter frekuensi realtime memiliki tepi bertahap. Frekuensi di luar pita menjadi lebih pelan, begitu pula frekuensi yang dekat batasnya. **Jeda** atau **Berhenti** menghapus filter sehingga pemutaran normal berikutnya memakai rentang frekuensi penuh. Audio, pilihan, riwayat urung, dan berkas ekspor tidak berubah.

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

### Ekspor klip sebagai berkas terpisah {#export-clips}

Pilih **File → Ekspor audio** dan atur **Output** ke **Klip individual (pisahkan berdasarkan klip)**. Pilih format audio lalu tekan **Ekspor** untuk mengunduh arsip berisi satu berkas untuk setiap klip audio pada trek audio proyek. Setiap berkas dimulai pada awal klip yang terdengar dan berakhir pada ujungnya, tanpa padding hingga garis waktu proyek atau tambahan ekor efek. Pemotongan, gain klip, fade, serta perubahan kecepatan dan nada disertakan. Klip yang tumpang tindih tetap terpisah.

Berkas menggunakan nama klip dengan awalan bernomor. Karakter nama berkas yang tidak didukung akan diganti, dan nomor membedakan nama klip yang berulang. Efek trek disertakan; efek master, mute, dan solo tidak memengaruhi ekspor ini. Cairkan trek yang dibekukan terlebih dahulu untuk mengekspor klip yang dapat diedit secara terpisah.

Format terkompresi menggunakan runtime FFmpeg. Format yang tepat dan ketersediaan kondisional tercantum dalam [referensi format yang dihasilkan](/reference/).

### Sematkan label bab {#embedded-chapters}

Di editor browser, pilih **Berkas → Ekspor audio**, pilih **MP3** atau **AAC / M4A**, lalu aktifkan **Sematkan label sebagai bab** pada **Opsi audio**. Opsi ini awalnya nonaktif dan menyertakan judul serta waktu label dalam satu berkas mix. Tambahkan label sebelum mengekspor; stems, pemisahan bab, dan urutan mastering tidak menyediakan opsi ini.

Hanya label yang beririsan dengan rentang hasil yang disertakan. Mengekspor pilihan akan menggeser waktu bab ke awal berkas hasil. MP3 mempertahankan waktu akhir label rentang; label titik berakhir pada bab berikutnya atau akhir berkas. M4A menyimpan awal bab, dan tiap bab berlanjut hingga awal berikutnya atau akhir berkas. M4A mendukung hingga 255 bab dan 255 byte UTF-8 per judul. Apakah pemutar menampilkan bab yang disematkan bergantung pada pemutar tersebut.

Putar file yang diekspor di aplikasi lain sebelum mengirimkan atau menghapus materi sumber.
