---
title: "Limpar unha gravación de voz"
description: "Elimina o zumbido dunha toma, corta o rumor, adáptao ao volume dun podcast e exporta un MP3."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"gl"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

A maioría das gravacións feitas en casa necesitan as mesmas tres reparacións: un ruído de fondo constante para eliminar, un zumbido grave para filtrar e un nivel que precisa subirse ata un estándar. Este tutorial realiza as tres nunha toma de exemplo de tres segundos cuxo primeiro medio segundo é só ruído da sala, e despois exporta o resultado como MP3.

:::tip[O que necesitarás]
- Descarga [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — unha toma curta cuxo primeiro medio segundo é ruído da sala antes de que comece a voz.

Cada paso seguinte funciona con estes ficheiros exactamente como están, polo que o que veas debería coincidir con o que di o tutorial. Soundscaper funciona no navegador; non é necesario instalar nada.
:::

## O que aprenderás

- Por que a Redución de ruído necesita un perfil e como dárselle un.
- Que elimina un filtro de paso alto e onde configuralo para a fala.
- A diferenza entre o nivel de pico e a sonoridade, e como alcanzar un obxectivo de sonoridade.
- Como exportar un MP3.

## Pasos

1. Abre Soundscaper. Un proxecto novo e baleiro está listo en canto carga o editor.
2. Escolle **Ficheiro → Importar audio** e selecciona `guide-noisy-take.wav` — unha toma curta cuxo primeiro medio segundo é ruído da sala antes de que comece a voz. O ficheiro aparece como un clip na súa propia pista.
3. Prema **Reproducir** para escoitar e despois **Deter**.
   *O que debería ver:* Medio segundo de siseo, e despois un ton constante que representa a voz, co siseo por debaixo dela.
4. Arrastra na regra sobre o clip, desde o inicio ata a marca do 15%, para seleccionar a introdución só de ruído. O perfil debe conter nada máis que o ruído que queres eliminar — sen voz en absoluto.
5. Escolle **Efecto → Eliminación e reparación de ruído → Redución de ruído** e prema **Obter perfil de ruído**. A liña de estado informa de que o perfil está listo. Prema **Pechar** para deixar a caixa de diálogo por agora.
6. Escolle **Seleccionar → Seleccionar todo**. O perfil mantense; agora o efecto necesita saber que limpar.
7. Escolle **Efecto → Eliminación e reparación de ruído → Redución de ruído**. Na caixa de diálogo de **Redución de ruído**, establece **Redución de ruído** en `12`, e despois prema **Aplicar á selección**. Doce decibelios é un bo primeiro axuste. Máis elimina máis ruído pero fai que as vozes sonen ocoas.
   *O que debería ver:* A introdución case está plana e o ton non está tocado.
8. Escolle **Efecto → Efectos herdados → Filtros clásicos**. Na caixa de diálogo de **Filtros clásicos**, escolhe **Paso alto** para **Tipo de filtro** e establece **Frecuencia de corte** en `100`, e despois prema **Aplicar á selección**. Todo por debaixo de 100 Hz — tráfico, manipulación, aire acondicionado — é atenuado. A fala está ben por riba diso.
9. Escolle **Efecto → Volume e compresión → Normalización de sonoridade**. Na caixa de diálogo de **Normalización de sonoridade**, establece **Sonoridade obxectivo** en `-16`, e despois prema **Aplicar á selección**. −16 LUFS é o obxectivo común para podcasts en estéreo. A sonoridade mide como de forte se sente a toma completa, non como de altos son os seus picos.
   *O que debería ver:* A forma de onda é máis alta e a toma reprodúcese a un nivel cómodo.
10. Prema **Reproducir** para escoitar e despois **Deter**.
   *O que debería ver:* Unha toma limpa e nivelada cunha introdución silenciosa.
11. Escolle **Ficheiro → Exportar audio**, establece **Formato** en **MP3** e prema **Exportar**. O ficheiro descárgase en canto remata a renderización, e o seu enlace permanece na caixa de diálogo. O ficheiro codifícase no navegador; nada sae do teu ordenador.

## A onde ir a seguir

- Fao na túa propia toma cos guías de como facelo: [Eliminar ruído de fondo](/guides/cleaning-up/remove-background-noise/), [Eliminar zumbido grave](/guides/cleaning-up/remove-low-rumble/) e [Normalizar a sonoridade para un podcast](/guides/volume/normalize-loudness-for-podcasts/).
- Comproba o resultado da maneira que o faría unha plataforma: [Medir como de forte é a túa mestura](/guides/analysis/measure-loudness/).

## Outros tutoriais

[O teu primeiro proxecto en Soundscaper](/tutorials/your-first-project/) — Importa unha gravación, escoita, divídelle, atenua a saída, exporta un ficheiro e garda o proxecto.
[Colocar música baixo unha voz](/tutorials/put-music-under-a-voice/) — Superpón dúas pistas, atenúa unha baixo a outra automaticamente, mestúralas e exporta.

## Referencia

- [Cada parámetro dos efectos usados aquí, co seu valor predeterminado e rango, está na referencia de efectos de audio.](/reference/generated/audio-effects/#parameters)
- [Os formatos de exportación, os seus contedores e límites de canles están na referencia de formatos de exportación.](/reference/generated/formats/)
- [Cada comando de menú e o seu atallo de teclado están na referencia de comandos e atallos.](/reference/generated/commands/)

## Sobre este tutorial

Este tutorial reprodúcese, paso a paso e con estes mesmos ficheiros, contra cada compilación de Soundscaper pola suite do navegador (`tests/browser/soundscaper-tutorials.spec.js`). Se un paso deixa de funcionar, a compilación falla ata que o tutorial se corrixe, polo que o que lees é o que fai o editor.
