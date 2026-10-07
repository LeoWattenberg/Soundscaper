---
title: "Framescaper"
description: "Organize vídeos, compõe imagens e entregue um projeto de vídeo centrado no local."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"47cebc3006e44dba5569ea0c1418001989dccf3730c3421c338c340222a9c5af","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"47cebc3006e44dba5569ea0c1418001989dccf3730c3421c338c340222a9c5af","targetLocale":"pt-PT"} -->

O Framescaper é a visualização focada em vídeo do editor partilhado. Ele enfatiza a pré-visualização de vídeo, monitorização de origem, efeitos de imagem, composição, sequências aninhadas e trabalho multicâmara.

O Soundscaper e o Framescaper abrem os ficheiros de projeto um do outro: `.sscape`, `.fscape` e o mais antigo `.scape` funcionam em ambos. Utilize o Soundscaper para gravação e produção de áudio detalhada, depois devolva o projeto ao Framescaper para o trabalho de imagem.

## O que está onde

O Framescaper é responsável pela imagem: importação de vídeo, o Monitor de Origem e a Pré-visualização de Vídeo, efeitos de imagem, geometria e composição, sequências aninhadas, trabalho multicâmara e entrega de vídeo. As pistas de imagem e áudio ligadas permanecem sincronizadas aqui até que as desligue.

O Soundscaper é responsável pelo som: gravação de áudio, efeitos e análise, mistura e entrega de áudio. O Framescaper utiliza um fluxo de trabalho de captura diferente e não expõe o conjunto de ferramentas de gravação de áudio do Soundscaper, por isso grave no Soundscaper e traga o projeto de volta. Os guias passo a passo [guias](/guides/) são escritos e verificados contra o Soundscaper e cobrem também o lado de áudio de um projeto de vídeo.

## Caminho recomendado

1. [Crie um primeiro projeto Framescaper](/framescaper/first-project/).
2. [Prepare e exporte vídeo](/framescaper/video-export/).
3. Revise o comportamento de [ficheiros de projeto e backup](/projects-and-data/project-files/).

Abra o editor do navegador em [framescaper.org/en](https://framescaper.org/en/).

Para assistência de ambiente de trabalho, consulte [processamento local, modelos e plugins](/help/local-processing/).
