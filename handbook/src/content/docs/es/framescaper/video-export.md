---
title: "Exportar vídeo"
description: "Valida la secuencia compuesta y crea una entrega en MP4 o WebM."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","targetLocale":"es"} -->

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

## Verificar la entrega

Abre el archivo exportado en un reproductor separado. Comprueba su duración, el primer y el último
fotograma, la orientación de la imagen, la sincronización de audio y los subtítulos esperados.

El video renderizado no puede reemplazar el proyecto editable. Exporta también una copia de `.fscape`
cuando necesites preservar la línea de tiempo y los medios del proyecto.
