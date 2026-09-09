---
title: "Bersihkan rekaman suara"
description: "Hilangkan suara berisik dari rekaman, potong suara gemuruh, tingkatkan ke volume podcast dan ekspor dalam format MP3."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"id"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

Sebagian besar rekaman yang dibuat di rumah membutuhkan tiga perbaikan yang sama: kebisingan latar belakang yang konsisten untuk dihapus, gema rendah untuk disaring, dan tingkat yang perlu ditingkatkan ke standar. Tutorial ini melakukan ketiganya pada contoh ambil tiga detik di mana setengah detik pertamanya adalah kebisingan ruangan, kemudian mengekspor hasilnya sebagai MP3.

:::tip[Apa yang Anda butuhkan]
- Unduh [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — ambil singkat di mana setengah detik pertamanya adalah kebisingan ruangan sebelum suara dimulai.

Setiap langkah di bawah ini berfungsi pada file ini persis seperti yang ada, jadi apa yang Anda lihat harus sesuai dengan apa yang dikatakan tutorial. Soundscaper berjalan di browser; tidak ada yang perlu diinstal.
:::

## Apa yang akan Anda pelajari

- Mengapa Pengurangan Kebisingan membutuhkan profil, dan bagaimana memberikannya.
- Apa yang dihapus oleh filter high-pass dan di mana untuk mengatur untuk pidato.
- Perbedaan antara tingkat puncak dan keras, dan bagaimana untuk mencapai target keras.
- Bagaimana mengekspor MP3.

## Langkah-langkah

1. Buka Soundscaper. Proyek baru yang kosong siap segera setelah editor dimuat.
2. Pilih **Berkas → Impor audio** dan pilih `guide-noisy-take.wav` — ambil singkat di mana setengah detik pertamanya adalah kebisingan ruangan sebelum suara dimulai. File mendarat sebagai klip di lintasan sendiri.
3. Tekan **Putar** untuk mendengarkan, lalu **Hentikan**.
   *Anda harus melihat:* Setengah detik desisan, kemudian nada yang konsisten yang mewakili suara, dengan desisan di bawahnya.
4. Seret di pengukur di atas klip, dari awal ke tanda 15%, untuk memilih pendahuluan kebisingan saja. Profil harus berisi hanya kebisingan yang ingin Anda hilangkan — tidak ada suara sama sekali.
5. Pilih **Efek → Penghapusan dan perbaikan kebisingan → Pengurangan Kebisingan** dan tekan **Dapatkan profil kebisingan**. Bar status melaporkan bahwa profil siap. Tekan **Tutup** untuk meninggalkan dialog untuk saat ini.
6. Pilih **Pilih → Pilih semua**. Profil disimpan; sekarang efek perlu tahu apa yang harus dibersihkan.
7. Pilih **Efek → Penghapusan dan perbaikan kebisingan → Pengurangan Kebisingan**. Di dialog **Pengurangan Kebisingan**, atur **Pengurangan kebisingan** ke `12`, lalu tekan **Terapkan ke pilihan**. Dua belas desibel adalah pengaturan pertama yang baik. Lebih banyak menghapus lebih banyak kebisingan tetapi membuat suara terdengar kosong.
   *Anda harus melihat:* Pendahuluan hampir datar dan nada tidak tersentuh.
8. Pilih **Efek → Efek warisan → Filter Klasik**. Di dialog **Filter Klasik**, pilih **High-pass** untuk **Tipe filter** dan atur **Frekuensi pemotongan** ke `100`, lalu tekan **Terapkan ke pilihan**. Segala sesuatu di bawah 100 Hz — lalu lintas, penanganan, pendingin udara — digulung. Pidato hidup dengan baik di atasnya.
9. Pilih **Efek → Volume dan kompresi → Normalisasi Keras**. Di dialog **Normalisasi Keras**, atur **Target keras** ke `-16`, lalu tekan **Terapkan ke pilihan**. −16 LUFS adalah target umum untuk podcast stereo. Keras mengukur seberapa keras keseluruhan ambil terasa, bukan seberapa tinggi puncaknya.
   *Anda harus melihat:* Gelombang lebih tinggi dan ambil diputar pada tingkat yang nyaman.
10. Tekan **Putar** untuk mendengarkan, lalu **Hentikan**.
   *Anda harus melihat:* Ambil yang bersih dan rata dengan pendahuluan yang tenang.
11. Pilih **Berkas → Ekspor audio**, atur **Format** ke **MP3**, dan tekan **Ekspor**. File diunduh segera setelah render selesai, dan tautannya tetap ada di dialog. File dikodekan di browser; tidak ada yang meninggalkan komputer Anda.

## Langkah selanjutnya

- Lakukan hal ini pada ambil Anda sendiri dengan panduan bagaimana cara: [Hapus kebisingan latar belakang](/guides/cleaning-up/remove-background-noise/), [Hapus gema rendah](/guides/cleaning-up/remove-low-rumble/) dan [Normalisasi keras untuk podcast](/guides/volume/normalize-loudness-for-podcasts/).
- Periksa hasilnya seperti yang dilakukan platform: [Ukur seberapa keras campuran Anda](/guides/analysis/measure-loudness/).

## Tutorial lainnya

[Proyek Soundscaper pertama Anda](/tutorials/your-first-project/) — Impor rekaman, dengarkan, pecah, redupkan, ekspor file dan simpan proyek.
[Letakkan musik di bawah suara](/tutorials/put-music-under-a-voice/) — Lapisi dua trek, menganggukkan satu di bawah yang lain secara otomatis, campurkan dan ekspor.

## Referensi

- [Setiap parameter efek yang digunakan di sini, dengan default dan rentangnya, ada di referensi efek audio.](/reference/generated/audio-effects/#parameters)
- [Format ekspor, kontainer mereka, dan batas saluran mereka ada di referensi format ekspor.](/reference/generated/formats/)
- [Setiap perintah menu dan pintasan keyboardnya ada di referensi perintah dan pintasan.](/reference/generated/commands/)

## Tentang tutorial ini

Tutorial ini diputar ulang, langkah demi langkah dan pada file ini, terhadap setiap build Soundscaper oleh suite browser (`tests/browser/soundscaper-tutorials.spec.js`). Jika suatu langkah berhenti berfungsi, build gagal sampai tutorial diperbaiki, jadi apa yang Anda baca adalah apa yang dilakukan editor.