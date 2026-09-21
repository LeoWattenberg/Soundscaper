---
title: "Importación e exportación"
description: "Distinga entre medios de orixe, ficheiros de proxecto, ficheiros de intercambio e entregas renderizadas."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","targetLocale":"gl"} -->

Soundscaper usa diferentes tipos de ficheiros para diferentes tarefas.

## Medios de orixe

Use **Ficheiro → Importar** para audio, vídeo e etiquetas. A pista do editor actual lista
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF e WebM; contéineres de vídeo
adicionais son admitidos pola ruta de importación de vídeo. A dispoñibilidade pode depender do
produto activo e do tempo de execución.

Importar medios engade unha fonte propiedade do proxecto. Non converte o ficheiro orixinal
no seu documento de proxecto editable.

As importacións e exportacións de audio comprimido admiten ata unha hora ou 1 GB
(1.000.000.000 bytes de ficheiro), calquera dos dous límites que se alcance primeiro. Un ficheiro
de unha hora a 48 kHz estéreo admítese cando cabe dentro dese límite de ficheiro. As tarefas longas lén,
codifican e gardan en fragmentos; as exportacións grandes do navegador requiren almacenamento de ficheiros
privado da orixe e suficiente espazo libre. As importacións grandes requiren almacenamento local persistente
para o audio decodificado. Os formatos PCM manteñen os seus límites separados.

O nivel do navegador cobre MP3, MP2, FLAC, WavPack, Opus e Ogg Vorbis. O soporte de
AAC/M4A no navegador depende do códec do navegador. As exportacións por streaming de escritorio cubren
os seis formatos incluídos, con FLAC de 24 bits e WavPack lossless float32. As importacións de escritorio
dependen da dispoñibilidade do decodificador nativo; MP2 usa o nivel de compatibilidade de utilidade máis pequeno. Os
proveedores de AAC e compatibilidade de escritorio manteñen os seus límites separados.

Unha tarefa activa mostra unha barra de progreso aínda cando **Vista → Barra de estado** estea oculta.
Elixa **Cancelar** ao lado da barra para deter unha importación ou unha exportación de audio.

## Ficheiros de proxecto editables

- Scape (`.sscape` de Soundscaper, `.fscape` de Framescaper, e calquera dos dous abrible en ambos) é o formato de proxecto portátil e de fidelidade completa compartido por Soundscaper
  e Framescaper.
- AUP4 é intercambio só de audio con Audacity. Non é unha copia de seguridade completa dun
  proxecto de Soundscaper con medios mesturados.

Vexa [Ficheiros de proxecto](/projects-and-data/project-files/) para as consecuencias de
cada elección.

## Entregas renderizadas

As exportacións de audio crean ficheiros destinados a escoitar, publicar ou procesar máis adiante. As exportacións de vídeo crean entregas MP4 ou WebM. Un ficheiro renderizado non retén a liña de tempo editable, o encamiñamento, os efectos ou o historial do proxecto.

Consulte a [sección de referencia](/reference/) para as táboas de formato xerado e
capacidade do produto.
