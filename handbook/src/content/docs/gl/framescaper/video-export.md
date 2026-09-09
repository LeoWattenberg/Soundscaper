---
title: "Exportar vídeo"
description: "Validar a secuencia composta e crear unha entrega en MP4 ou WebM."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","targetLocale":"gl"} -->

## Antes de exportar

- Reproduce a secuencia completa e cada límite de edición.
- Confirma que as pistas visibles e en solo producen a imaxe prevista.
- Comproba que o audio vinculado permanece sincronizado.
- Confirma o rango de exportación e se deben incluír subtítulos ou audio.

## Crea o ficheiro

Abre o diálogo de exportación e selecciona un formato de vídeo. Framescaper admite a entrega en MP4 e
WebM a través do tempo de execución de vídeo configurado. Escolle as dimensións,
a taxa de fotogramas e outras opcións adecuadas para o destino.

A codificación de vídeo é máis intensiva en recursos que a reprodución ordinaria da liña temporal.
Mantén o editor aberto ata que a exportación informe da súa finalización.

## Verifica a entrega

Abre o ficheiro exportado nun reprodutor separado. Comproba a súa duración, os primeiros e últimos
fotogramas, a orientación da imaxe, a sincronización do audio e os subtítulos esperados.

O vídeo renderizado non pode substituír o proxecto editable. Exporta tamén unha copia `.fscape`
cando necesites conservar a liña temporal e os medios do proxecto.
