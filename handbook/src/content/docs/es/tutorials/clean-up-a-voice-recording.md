---
title: "Limpiar una grabación de voz"
description: "Elimina el zumbido de una toma, recorta el ruido grave, ajusta el volumen al nivel de un podcast y exporta un MP3."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"es"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

La mayoría de las grabaciones realizadas en casa necesitan las mismas tres reparaciones: un ruido de fondo constante que eliminar, un zumbido grave que filtrar y un nivel que necesita elevarse a un estándar. Este tutorial realiza las tres en una toma de ejemplo de tres segundos cuya primera mitad de segundo es solo ruido de sala, y luego exporta el resultado como MP3.

:::tip[Lo que necesitarás]
- Descarga [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — una toma corta cuya primera mitad de segundo es ruido de sala antes de que comience la voz.

Cada paso a continuación funciona con estos archivos exactamente como están, por lo que lo que veas debería coincidir con lo que dice el tutorial. Soundscaper se ejecuta en el navegador; no es necesario instalar nada.
:::

## Lo que aprenderás

- Por qué la Reducción de Ruido necesita un perfil y cómo proporcionarle uno.
- Qué elimina un filtro paso alto y dónde configurarlo para el habla.
- La diferencia entre nivel de pico y sonoridad, y cómo alcanzar un objetivo de sonoridad.
- Cómo exportar un MP3.

## Pasos

1. Abre Soundscaper. Un proyecto nuevo y vacío está listo en cuanto se carga el editor.
2. Elige **Archivo → Importar audio** y selecciona `guide-noisy-take.wav` — una toma corta cuya primera mitad de segundo es ruido de sala antes de que comience la voz. El archivo aparece como un clip en su propia pista.
3. Presiona **Reproducir** para escuchar y luego **Detener**.
   *Deberías ver:* Media segunda de siseo, luego un tono constante que representa a una voz, con el siseo debajo.
4. Arrastra en la regla sobre el clip, desde el inicio hasta la marca del 15%, para seleccionar la introducción de solo ruido. El perfil debe contener nada más que el ruido que deseas eliminar — ninguna voz en absoluto.
5. Elige **Efecto → Eliminación y reparación de ruido → Reducción de Ruido** y presiona **Obtener perfil de ruido**. La línea de estado informa de que el perfil está listo. Presiona **Cerrar** para salir del cuadro de diálogo por ahora.
6. Elige **Seleccionar → Seleccionar todo**. El perfil se mantiene; ahora el efecto necesita saber qué limpiar.
7. Elige **Efecto → Eliminación y reparación de ruido → Reducción de Ruido**. En el cuadro de diálogo **Reducción de Ruido**, configura **Reducción de ruido** en `12`, luego presiona **Aplicar a la selección**. Doce decibelios es una buena configuración inicial. Más elimina más ruido pero hace que las voces suenen huecas.
   *Deberías ver:* La introducción es casi plana y el tono no está tocado.
8. Elige **Efecto → Efectos heredados → Filtros clásicos**. En el cuadro de diálogo **Filtros clásicos**, elige **Paso alto** para **Tipo de filtro** y configura **Frecuencia de corte** en `100`, luego presiona **Aplicar a la selección**. Todo por debajo de 100 Hz — tráfico, manipulación, aire acondicionado — se atenúa. El habla vive bien por encima de eso.
9. Elige **Efecto → Volumen y compresión → Normalización de sonoridad**. En el cuadro de diálogo **Normalización de sonoridad**, configura **Sonoridad objetivo** en `-16`, luego presiona **Aplicar a la selección**. −16 LUFS es el objetivo común para podcasts estéreo. La sonoridad mide cuán fuerte se siente la toma completa, no cuán altos son sus picos.
   *Deberías ver:* La forma de onda es más alta y la toma se reproduce a un nivel cómodo.
10. Presiona **Reproducir** para escuchar y luego **Detener**.
   *Deberías ver:* Una toma limpia y nivelada con una introducción silenciosa.
11. Elige **Archivo → Exportar audio**, configura **Formato** en **MP3** y presiona **Exportar**. El archivo se descarga en cuanto termina la renderización, y su enlace permanece en el cuadro de diálogo. El archivo se codifica en el navegador; nada sale de tu computadora.

## Dónde seguir

- Hazlo con tu propia toma con las guías de cómo hacer: [Eliminar ruido de fondo](/guides/cleaning-up/remove-background-noise/), [Eliminar zumbido grave](/guides/cleaning-up/remove-low-rumble/) y [Normalizar sonoridad para un podcast](/guides/volume/normalize-loudness-for-podcasts/).
- Comprueba el resultado de la manera en que lo haría una plataforma: [Medir cuán fuerte es tu mezcla](/guides/analysis/measure-loudness/).

## Otros tutoriales

[Tu primer proyecto en Soundscaper](/tutorials/your-first-project/) — Importa una grabación, escúchala, divídela, atenua el final, exporta un archivo y guarda el proyecto.
[Colocar música bajo una voz](/tutorials/put-music-under-a-voice/) — Superpone dos pistas, atenúa una bajo la otra automáticamente, mezcla hacia abajo y exporta.

## Referencia

- [Cada parámetro de los efectos utilizados aquí, con su valor predeterminado y rango, está en la referencia de efectos de audio.](/reference/generated/audio-effects/#parameters)
- [Los formatos de exportación, sus contenedores y límites de canales están en la referencia de formatos de exportación.](/reference/generated/formats/)
- [Cada comando de menú y su atajo de teclado están en la referencia de comandos y atajos.](/reference/generated/commands/)

## Acerca de este tutorial

Este tutorial se reproduce, paso a paso y con estos mismos archivos, contra cada compilación de Soundscaper por la suite del navegador (`tests/browser/soundscaper-tutorials.spec.js`). Si un paso deja de funcionar, la compilación falla hasta que el tutorial se corrige, por lo que lo que lees es lo que hace el editor.
