---
title: "Berkas proyek"
description: "Pilih antara perpustakaan lokal, berkas proyek Scape, AUP4, dan cadangan yang telah dirender."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","targetLocale":"id"} -->

## Perpustakaan proyek lokal

Editor menyimpan proyek kerja ke perpustakaan lokalnya. Pada peramban ini adalah penyimpanan pribadi asal; pada edisi desktop ini adalah data aplikasi. Ini adalah salinan kerja yang nyaman, bukan satu-satunya salinan yang harus Anda simpan.

## Berkas proyek Scape

Gunakan **Berkas → Ekspor berkas proyek** untuk menyimpan proyek penyuntingan. Setiap produk menulis akhiran sendiri: Soundscaper menyimpan `.sscape` dan Framescaper menyimpan `.fscape`, dan entri menu menamakan yang berlaku. Format di balik keduanya sama, jadi ini adalah pilihan yang tepat saat Anda perlu menjaga keadaan penyuntingan media campuran.

Di desktop, audio dan video yang diimpor secara default tetap merujuk ke berkas aslinya. Simpan berkas tersebut di lokasi aslinya saat membuka kembali proyek. Perpustakaan lokal juga menyimpan cache penyuntingan. Rekaman serta media yang dibuat atau diproses disertakan karena tidak memiliki sumber eksternal yang tidak berubah.

Pilih **Berkas → Manajemen proyek → Konsolidasikan media** untuk mengemas media yang dirujuk ke dalam berkas proyek. Konsolidasi langsung menyimpan proyek; pilih tujuan pada dialog penyimpanan. Setelah disimpan, salinan yang dikonsolidasikan dapat dipindahkan atau dibagikan tanpa berkas media asli. Jika ada media yang tidak dapat dikonsolidasikan atau penyimpanan gagal, editor akan melaporkan masalahnya.

Ekspor browser mengemas medianya secara otomatis. Sebelum membuka proyek desktop dengan referensi eksternal di browser, konsolidasikan proyek tersebut di desktop.

Produk apa pun dapat membuka kedua akhiran tersebut. `.sscape`, `.fscape`, `.liscape` yang dilindungi, dan berkas `.scape` yang lebih lama yang diekspor sebelum produk memiliki akhiran mereka sendiri dapat dibuka di mana saja, dan menyimpan satu dari produk yang berbeda hanya mengubah namanya — misalnya, `Mix.sscape` yang disimpan dari Framescaper menjadi `Mix.fscape`. Tidak ada yang berubah pada proyek dengan nama tersebut.

Mengimpor atau membuka salinan Scape dapat menemukan proyek yang ada dengan ID yang sama. Gunakan alur kerja salinan yang ditawarkan saat kedua versi harus tetap ada di perpustakaan lokal.

## Audacity AUP3 dan AUP4

Ekspor proyek Audacity tersedia melalui **Berkas → Ekspor lainnya**. Pilih **Ekspor AUP3** untuk profil proyek Audacity 3.7.9, atau **Ekspor AUP4** untuk profil pertukaran Audacity saat ini. Setiap ekspor menghasilkan laporan kompatibilitas yang menjelaskan konversi, efek yang tidak tersedia, dan status khusus Soundscaper yang dihilangkan.

Kedua format hanya berisi audio. Video dihilangkan, begitu pula preferensi browser, riwayat urung, perutean mixer, dan perpustakaan proyek browser. Jangan gunakan salah satunya sebagai satu-satunya cadangan proyek Soundscaper atau Framescaper.

## Adobe Audition SESX

Pada edisi desktop, gunakan **Berkas → Buka** untuk mengimpor sesi Adobe Audition `.sesx`. Simpan berkas audio yang dirujuk dalam struktur folder relatif di bawah folder sesi, atau pilih folder media saat diminta. Impor membuat proyek lokal baru dengan trek audio, klip, penempatan, pemangkasan, fade sederhana, serta pengaturan mixer statis yang didukung.

Impor SESX hanya satu arah. Efek Audition, otomatisasi, perutean, video, penanda, loop, peregangan, crossfade tertaut, dan kurva fade yang persis tidak ditransfer. Buka **Berkas → Laporan pengiriman** setelah impor untuk memeriksa media yang hilang dan konten lain yang dihilangkan. Simpan berkas SESX dan media aslinya untuk pekerjaan berikutnya di Audition.

## Cadangan yang dirender

Untuk pekerjaan penting, simpan kedua hal berikut:

1. Salinan proyek Scape (`.sscape` atau `.fscape`) untuk penyuntingan di masa mendatang.
2. Berkas audio atau video yang dirender yang dapat diputar tanpa editor.

Simpan berkas tersebut di luar direktori peramban atau data aplikasi.