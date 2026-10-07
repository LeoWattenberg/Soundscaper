---
title: "Pemrosesan lokal, model, dan plugin"
description: "Temukan bantuan lokal berdasarkan tugas dan kelola model serta plugin di editor desktop."
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","targetLocale":"id"} -->

Asisten lokal berjalan di perangkat Anda di editor desktop Soundscaper dan Framescaper. Pilih media, lalu pilih tugas dari menu. Dialog menampilkan pilihan, pengaturan tugas, dan apakah modelnya terpasang.

Paket desktop tidak menyertakan mesin pemrosesan native opsional maupun bobot model. Instal model melalui Pengelola Model untuk mengunduh mesin dan bobot yang dibutuhkannya, lalu jalankan tugas pada media pilihan Anda. Instalasi pertama memerlukan koneksi jaringan; pemrosesan berikutnya berjalan secara lokal. Lihat panduan setiap model untuk platform yang didukung, entri menu, dan persyaratannya.

Lihat [panduan model individual](/reference/local-models/).

## Cari tugas {#find-a-task}

| Menu | Tugas |
| --- | --- |
| Efek → Penghapusan dan perbaikan kebisingan | Meningkatkan Dialog, Mengurangi Reverb, Membersihkan Pengisi & Kedipan |
| Efek → Pemisahan sumber | Memisahkan Dialog / Musik / Efek |
| Analisis → Pidato | Mentranskripsi & Subtitel, Mengidentifikasi Pembicara, Menandai Reaksi |
| Analisis → Musik | Mendeteksi Ketukan & Tempo |
| Analisis → Video | Menandai Potongan |
| Efek → Efek video | Reframe |
| Edit | Buat Sorotan |
| Generate | Generate Teks Editorial |
| Alat → Pencarian | Pencarian Berindeks, Indeks Transkrip, Indeks Video |

Tugas video milik Framescaper. Perintah yang tersedia tergantung pada runtime desktop dan kemampuan produk. Opsi menu efek alfabetis Soundscaper juga mengurutkan efek pemrosesan lokal berdasarkan nama.

Pilih **Jalankan secara lokal** untuk memulai pemrosesan dan merespons permintaan persetujuan lokal. Anda dapat membatalkannya saat pemrosesan. Pilih **Tinjau hasil**, pilih hasil yang diinginkan, dan pilih **Terapkan yang dipilih**. Perubahan proyek yang diterima dapat dibatalkan. Menutup tugas tidak menerapkan usulan.

**Alat → Pemrosesan Lokal Lanjutan** mempertahankan pemilih operasi dan model individu. Detail teknis dalam dialog tugas menunjukkan langkah-langkah dasar dan pengaturan yang tepat saat diperlukan.

## Kelola model {#manage-models}

Buka **Alat → Model Manager**, atau gunakan **Kelola Model** di dalam tugas. Tautan tugas menyaring daftar ke identitas model yang kompatibel; **Tampilkan semua model** menghapus pembatasan tersebut. Cari berdasarkan nama atau tugas dan filter berdasarkan status instalasi.

Instal model secara eksplisit. Instalasi pertama juga mengunduh runtime native bersama yang belum tersedia dan diperlukan oleh model tersebut. Progres unduhan ditampilkan dan unduhan dapat dibatalkan. Saat kembali ke suatu tugas, pengaturannya tetap tersimpan dan ketersediaan model diperbarui; pemrosesan tidak dimulai. Buka **Penyimpanan dan verifikasi** untuk perbaikan, pembersihan, pemindahan penyimpanan, pemberitahuan lisensi, dan instalasi luring dari folder. Model yang diinstal dari file luring tetap memerlukan runtime yang cocok sebelum penggunaan pertama.

Lihat panduan [model individu](/reference/local-models/) untuk tujuan, entri menu, ukuran unduhan, persyaratan, batasan, dan pemeriksaan inferensi nyata yang dilakukan oleh paket desktop nightly-with-tests setiap model yang diterbitkan.

## Kelola plugin dan perangkat {#manage-plugins-and-devices}

**Efek → Manajer Plugin** mencantumkan plugin audio di Soundscaper dan plugin OpenFX di Framescaper. Cari atau filter daftar, lalu pilih plugin untuk kontrol versi, izin, dan pemulihan. **Pemindaian & Pengaturan** berisi pengaturan penemuan.

Gunakan plugin audio melalui **Efek → Plugin Audio**. Perintah Tambah/Edit efek video Framescaper tetap berada di bawah **Efek → Efek video**.

Buka **Edit → Preferensi → Pengaturan Audio** untuk perangkat audio asli dan kontrol pembantu. **Media** menyimpan pengaturan media asli; **Efek** terhubung ke Manajer Plugin dan berisi sakelar penemuan plugin. Izin dan pemulihan karantina plugin masih memerlukan tindakan eksplisit.
