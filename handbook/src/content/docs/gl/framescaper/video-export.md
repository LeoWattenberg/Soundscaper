---
title: "Exportar vídeo"
description: "Validar a secuencia composta e crear unha entrega en MP4 ou WebM."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"gl"} -->

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

## Exportar clips de audio por separado {#export-audio-clips}

Escolle **Ficheiro → Exportar vídeo**, selecciona un formato de audio como **WAV** e define **Saída** como **Clips individuais (separados por clips)**. A exportación descarga un arquivo cun ficheiro por cada clip de audio. Exclúense os clips de vídeo e cada ficheiro de audio contén só o seu clip, cos recortes e edicións correspondentes.

Os ficheiros comezan no inicio audible do clip, sen recheo ata a súa posición no proxecto nin cola de efectos. Os nomes numerados distinguen os clips que teñen o mesmo nome.

Inclúense os efectos da pista; os efectos mestres, o silencio e o solo non afectan a esta exportación. Consulta o fluxo de audio común en [Exportar clips como ficheiros separados](/soundscaper/edit-mix-and-export/#export-clips).

## Verifica a entrega

Abre o ficheiro exportado nun reprodutor separado. Comproba a súa duración, os primeiros e últimos
fotogramas, a orientación da imaxe, a sincronización do audio e os subtítulos esperados.

O vídeo renderizado non pode substituír o proxecto editable. Exporta tamén unha copia `.fscape`
cando necesites conservar a liña temporal e os medios do proxecto.
