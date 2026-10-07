---
title: "Menimpa file yang diimpor di desktop"
description: "Simpan proyek yang telah diedit di atas file media asli di Soundscaper atau Framescaper."
sidebar:
  order: 10
---
<!-- docs-ai-provenance: {"factPacketSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","targetLocale":"id"} -->

Dalam versi Electron Soundscaper dan Framescaper, **File → Timpa nama file** mengekspor seluruh proyek yang telah diedit ke file media yang pertama kali diimpor. Perintah ini menggunakan pengaturan ekspor yang didukung file asli dan langsung menyimpan tanpa membuka dialog ekspor atau pemilih file. Audio mempertahankan format sumber, laju sampel, dan jumlah kanal. Video MP4 dan WebM yang didukung mempertahankan kontainer, dimensi, dan laju bingkai sumber.

Impor satu file media melalui **File → Impor**, lakukan pengeditan, lalu pilih **File → Timpa nama file**. Anda dapat mengulanginya setelah pengeditan berikutnya. Pilihan waktu tidak membatasi penimpaan: seluruh proyek selalu dirender. Proyek tetap menyimpan media yang diimpor dan riwayat pengeditan.

Perintah ini tidak tersedia jika proyek tidak memiliki file asli yang didukung, beberapa file asli telah diimpor, atau saat impor, perekaman, maupun pemrosesan berlangsung. Versi browser menggunakan dialog ekspor biasa.

Pilih **File → Ekspor audio** di Soundscaper atau **File → Ekspor video** di Framescaper jika Anda ingin memilih tujuan lain atau mengubah pengaturan keluaran. Penimpaan mengganti isi file asli; simpan salinan terpisah jika Anda memerlukan rekaman yang belum diedit.
