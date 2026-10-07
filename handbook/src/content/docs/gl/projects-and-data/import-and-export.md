---
title: "Importación e exportación"
description: "Distinga entre medios de orixe, ficheiros de proxecto, ficheiros de intercambio e entregas renderizadas."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"gl"} -->

Soundscaper usa diferentes tipos de ficheiros para diferentes tarefas.

## Medios de orixe

Use **Ficheiro → Importar** para audio, vídeo e etiquetas. A pista do editor actual lista
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF e WebM; contéineres de vídeo
adicionais son admitidos pola ruta de importación de vídeo. A dispoñibilidade pode depender do
produto activo e do tempo de execución.

Importar medios engade unha fonte propiedade do proxecto. Non converte o ficheiro orixinal
no seu documento de proxecto editable.

As exportacións de audio comprimido e as importacións no navegador admiten ata unha hora ou 1 GB (1.000.000.000 bytes de ficheiro), o límite que se alcance primeiro. A selección de ficheiros no escritorio e a importación de audio comprimido non teñen un límite fixo de tamaño nin de duración por debaixo do rango de enteiros seguros. As tarefas longas len, codifican e gardan en fragmentos; as exportacións grandes do navegador requiren almacenamento privado da orixe e espazo libre suficiente. As importacións grandes precisan almacenamento local suficiente para o audio descodificado. A estrutura do formato, a compatibilidade do descodificador e o espazo dispoñible tamén poden limitar unha importación.

O nivel do navegador cobre MP3, MP2, FLAC, WavPack, Opus e Ogg Vorbis. O soporte de AAC/M4A no navegador depende do códec do navegador. As exportacións por streaming de escritorio cobren os seis formatos incluídos, ademais de FLAC sen perdas de 24 bits e WavPack float32. As importacións de escritorio dependen da dispoñibilidade dos descodificadores; as fontes MP2 grandes usan o descodificador de paquetes, e as fontes máis pequenas usan o nivel de compatibilidade da utilidade.

Unha tarefa activa mostra unha barra de progreso aínda cando **Vista → Barra de estado** estea oculta.
Elixa **Cancelar** ao lado da barra para deter unha importación ou unha exportación de audio.

## Ficheiros de proxecto editables

- Scape (`.sscape` de Soundscaper, `.fscape` de Framescaper, e calquera dos dous abrible en ambos) é o formato de proxecto portátil e de fidelidade completa compartido por Soundscaper
  e Framescaper.
- AUP3 e AUP4 permiten o intercambio de audio con Audacity. Escolle AUP3 para o perfil de proxecto de Audacity 3.7.9 ou AUP4 para o perfil de intercambio actual. Ningún é unha copia de seguridade completa dun proxecto de Soundscaper con medios mesturados; revisa o informe de compatibilidade despois de exportar.
- A edición de escritorio pode abrir sesións Adobe Audition SESX (`.sesx`) para crear un proxecto local a partir dos ficheiros de audio referenciados. Garda a sesión e os medios orixinais; non se pode exportar a SESX.

Vexa [Ficheiros de proxecto](/projects-and-data/project-files/) para as consecuencias de
cada elección.

## Entregas renderizadas

As exportacións de audio crean ficheiros destinados a escoitar, publicar ou procesar máis adiante. As exportacións de vídeo crean entregas MP4 ou WebM. Un ficheiro renderizado non retén a liña de tempo editable, o encamiñamento, os efectos ou o historial do proxecto.

Consulte a [sección de referencia](/reference/) para as táboas de formato xerado e
capacidade do produto.
