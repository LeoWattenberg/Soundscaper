---
title: "Skin editor"
description: "Pilih skin visual atau coba sementara melalui URL."
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"id"} -->

Skins mengubah warna, font, batas, dan latar belakang dekoratif editor.
Mereka tersedia di Soundscaper dan Framescaper. Setiap produk mengingat
pilihannya sendiri. Workspace tetap mengontrol penataan panel dan alat.

## Pilih skin {#choose-a-skin}

Buka **Edit → Preferences → Appearance** dan pilih skin:

- **Default** mempertahankan desain editor asli.
- **Sakura** menggabungkan bunga sakura, aksen merah muda, dan huruf bulat.
- **Lilac** menggunakan ungu dingin dan tekstur ungu berlapis.
- **Techno** menggabungkan grafik sirkuit biru dengan huruf monospace.

Pilih **Light**, **Dark**, atau **Follow system theme** secara terpisah. Setiap skin memiliki
versi terang dan gelap. **Clip style** tetap menjadi pilihan terpisah; palet
Colorful dikoordinasikan dengan setiap skin sambil tetap mempertahankan warna klip yang berbeda.

Kontras tinggi memiliki prioritas di atas dekorasi skin. Mematikan kontras tinggi
memulihkan skin yang dipilih. Mengubah skin tidak pernah mengubah audio klip, konten
proyek, atau tata letak workspace.

## Coba skin dari tautan {#try-a-skin-from-a-link}

Tambahkan `?useskin=sakura` ke URL editor untuk pratinjau Sakura secara sementara. Gunakan
`default`, `sakura`, `lilac`, atau `techno` sebagai nilainya. Jika URL sudah memiliki
parameter kueri, tambahkan `&useskin=sakura` sebagai gantinya. Nilai yang tidak dikenal akan diabaikan.

Pratinjau URL tidak menggantikan skin yang disimpan, bahkan jika Anda mengubah preferensi
lain. Memuat ulang URL pratinjau tetap melakukan pratinjau; mengunjungi tanpa parameter
menggunakan pilihan yang disimpan. Parameter ini tidak memilih terang atau gelap.

Di **Preferences → Appearance**, pilih **Keep this skin** untuk menyimpan pratinjau,
atau **End preview** untuk kembali ke skin yang disimpan. Memilih skin apa pun juga menyimpan
pilihan tersebut dan mengakhiri pratinjau. Tindakan ini hanya menghapus parameter skin
dari URL saat ini, tanpa memuat ulang editor.
