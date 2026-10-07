---
title: "Exportar vídeo"
description: "Valida la secuencia compuesta y crea una entrega en MP4 o WebM."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"es"} -->

## Antes de exportar

- Reproduce la secuencia completa y cada límite de edición.
- Confirma que las pistas visibles y en modo solo produzcan la imagen prevista.
- Comprueba que el audio vinculado permanezca sincronizado.
- Confirma el rango de exportación y si deben incluirse subtítulos o audio.

## Crear el archivo

Abre el cuadro de diálogo de exportación y selecciona un formato de video. Framescaper admite la entrega en MP4 y
WebM a través del tiempo de ejecución de video configurado. Elige las dimensiones,
el fotograma por segundo y otras opciones adecuadas para el destino.

La codificación de video es más intensiva en recursos que la reproducción ordinaria de la línea de tiempo.
Mantén el editor abierto hasta que la exportación informe de su finalización.

## Exportar clips de audio por separado {#export-audio-clips}

Elige **Archivo → Exportar vídeo**, selecciona un formato de audio como **WAV** y establece **Salida** en **Clips individuales (dividir por clips)**. La exportación descarga un archivo comprimido con un archivo por cada clip de audio. Se excluyen los clips de vídeo y cada archivo de audio contiene solo su clip, incluidos sus recortes y ediciones.

Los archivos empiezan en el inicio audible del clip, sin relleno hasta su posición en el proyecto ni cola de efectos. Los nombres numerados distinguen los clips con el mismo nombre.

Se incluyen los efectos de pista; los efectos maestros, el silencio y el solo no afectan a esta exportación. Consulta el flujo de audio común en [Exportar clips como archivos separados](/soundscaper/edit-mix-and-export/#export-clips).

## Verificar la entrega

Abre el archivo exportado en un reproductor separado. Comprueba su duración, el primer y el último
fotograma, la orientación de la imagen, la sincronización de audio y los subtítulos esperados.

El video renderizado no puede reemplazar el proyecto editable. Exporta también una copia de `.fscape`
cuando necesites preservar la línea de tiempo y los medios del proyecto.
