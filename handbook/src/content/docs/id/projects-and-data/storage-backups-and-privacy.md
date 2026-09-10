---
title: "Penyimpanan, cadangan, dan privasi"
description: "Pahami penyimpanan lokal-terutama dan lindungi proyek dari kehilangan browser atau perangkat."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"id"} -->

## Apa arti local-first

Proyek, rekaman, dan media impor diproses dan disimpan di perangkat Anda. Editor tidak memerlukan akun atau menyinkronkan proyek ke layanan Soundscaper.

Di web, audio dan media menggunakan sistem file privat asal browser jika tersedia, dengan fallback IndexedDB. Soundscaper meminta penyimpanan persisten, tetapi browser yang memutuskan apakah akan memberikannya.

## Apa yang dapat menghapus proyek

- Membersihkan data situs menghapus pustaka proyek lokal browser.
- Konteks browser privat atau terbatas dapat kembali ke memori sementara.
- Kuota browser dan kebijakan eviksi tetap menjadi otoritatif.
- Menghapus data aplikasi desktop secara manual menghapus pustaka lokalnya.
- Kegagalan perangkat atau penyimpanan dapat menghapus semua salinan lokal di perangkat tersebut.

Menghapus instalasi build desktop yang dikemas dirancang untuk mempertahankan pustakanya, tetapi itu bukan strategi cadangan.

## Rutinitas cadangan

Pada tonggak yang berguna dan sebelum membersihkan atau memigrasikan penyimpanan:

1. Tunggu hingga penyimpanan lokal selesai.
2. Ekspor file proyek Scape (`.sscape` atau `.fscape`).
3. Ekspor dan putar pengiriman yang dirender.
4. Salin keduanya ke penyimpanan di luar data lokal editor.

Gunakan AUP4 sebagai tambahan ketika pertukaran Audacity penting, bukan sebagai pengganti salinan proyek Scape.

## Privasi situs dokumentasi

Buku panduan ini disajikan sebagai file statis dan menggunakan pencarian lokal browser. Situs V1 tidak menambahkan layanan analitik atau backend AI/pencarian.

[Kebijakan privasi Soundscaper dan Framescaper](https://soundscaper.org/privacy/en/) lengkap juga mencakup pengiriman aplikasi, izin perangkat, unduhan opsional, pemeriksaan pembaruan desktop, dan koneksi Framescaper Web VCR.
