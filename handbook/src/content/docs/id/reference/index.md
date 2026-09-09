---
title: "Referensi"
description: "Tabel perintah, pintasan, format, efek, dan kemampuan produk yang dihasilkan."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b7e4df92cd36126d4ce3865383043516972e9aca463c3449b731085cafc4050e","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b7e4df92cd36126d4ce3865383043516972e9aca463c3449b731085cafc4050e","targetLocale":"id"} -->

Halaman referensi dibuat dari registri runtime yang ditinjau dan disimpan di
repositori. Mereka menggambarkan perilaku yang diimplementasikan, bukan entri roadmap atau
sederhana kehadiran file sumber dan tes.

Gunakan bagian ini untuk menjawab pertanyaan seperti:

- Apa pintasan default yang memanggil perintah?
- Apakah perintah tersedia di Soundscaper, Framescaper, atau keduanya?
- Format audio dan video apa yang dapat diekspor?
- Apa nilai default parameter efek, dan nilai apa yang akan diterima?
- Efek mana yang dapat berjalan saat audio diputar, dan mana yang membutuhkan pemilihan?
- Aliran kerja bantuan lokal mana yang ada, dan model mana yang mereka butuhkan?
- Panel mana yang ditampilkan di setiap ruang kerja?
- Bahasa, peramban, dan paket desktop mana yang dibangun dan diuji?
- Fitur mana yang bergantung pada produk, platform, atau runtime FFmpeg?

Halaman yang dihasilkan mencakup asal usul sumbernya dan diperiksa untuk drift dalam
gate kualitas repositori.

[Program Makro](/reference/macro-programs/) adalah satu-satunya halaman di sini yang ditulis dengan
tangan. Halaman ini mendokumentasikan API JavaScript yang dijalankan program makro, dan klaimnya
adalah yang dipegang oleh tes editor sendiri terhadap sandbox.