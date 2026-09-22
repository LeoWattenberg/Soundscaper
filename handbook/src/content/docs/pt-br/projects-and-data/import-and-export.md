---
title: "Importação e exportação"
description: "Distinga mídias de origem, arquivos de projeto, arquivos de intercâmbio e entregas renderizadas."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","targetLocale":"pt-BR"} -->

O Soundscaper utiliza diferentes tipos de arquivos para diferentes tarefas.

## Mídia de origem

Utilize **Arquivo → Importar** para áudio, vídeo e rótulos. A dica do editor atual lista
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF e WebM; contêineres de vídeo adicionais são suportados pelo caminho de importação de vídeo. A disponibilidade pode depender
do produto ativo e do tempo de execução.

A importação de mídia adiciona uma fonte de propriedade do projeto. Não torna o arquivo original
o documento editável do seu projeto.

As importações e exportações de áudio compactado suportam até uma hora ou 1 GB
(1.000.000.000 bytes de arquivo), o que for alcançado primeiro. Um arquivo estéreo de 48 kHz de uma hora é suportado quando se encaixa nesse limite de arquivo. Trabalhos longos leem,
codificam e salvam em partes; exportações grandes do navegador exigem armazenamento de arquivos particulares de origem e espaço livre suficiente. Importações grandes exigem armazenamento local persistente
para o áudio decodificado. Os formatos PCM mantêm seus limites separados.

A camada do navegador abrange MP3, MP2, FLAC, WavPack, Opus e Ogg Vorbis. O suporte AAC/M4A do navegador depende do codec do navegador. As exportações de streaming de desktop cobrem os seis formatos agrupados, com FLAC de 24 bits e WavPack sem perdas float32. As importações de desktop dependem da disponibilidade do decodificador nativo; o MP2 utiliza a camada de compatibilidade utilitária menor. Os provedores AAC e de compatibilidade do desktop mantêm seus
limites separados.

Um trabalho ativo mostra uma barra de progresso mesmo quando **Visualizar → Barra de status** está oculto. Escolha **Cancelar** ao lado da barra para interromper uma importação ou exportação de áudio.

## Arquivos de projeto editáveis

- Scape (`.sscape` do Soundscaper, `.fscape` do Framescaper e qualquer um deles pode ser aberto em ambos) é o formato de projeto portátil de alta fidelidade compartilhado pelo Soundscaper
e Framescaper.
- AUP4 é uma troca apenas de áudio com o Audacity. Não é um backup completo de um
projeto de mídia mista do Soundscaper.

Consulte [Arquivos do projeto](/projects-and-data/project-files/) para as consequências
de cada escolha.

## Entregas renderizadas

As exportações de áudio criam arquivos destinados à escuta, publicação ou processamento adicional. As exportações de vídeo criam entregas MP4 ou WebM. Um arquivo renderizado não
retém a linha do tempo editável, roteamento, efeitos ou histórico do projeto.

Consulte a seção [referência](/reference/) para as tabelas de formato gerado e
capacidade do produto.
