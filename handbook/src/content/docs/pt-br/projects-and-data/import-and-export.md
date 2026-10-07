---
title: "Importação e exportação"
description: "Distinga mídias de origem, arquivos de projeto, arquivos de intercâmbio e entregas renderizadas."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"pt-BR"} -->

O Soundscaper utiliza diferentes tipos de arquivos para diferentes tarefas.

## Mídia de origem

Utilize **Arquivo → Importar** para áudio, vídeo e rótulos. A dica do editor atual lista
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF e WebM; contêineres de vídeo adicionais são suportados pelo caminho de importação de vídeo. A disponibilidade pode depender
do produto ativo e do tempo de execução.

A importação de mídia adiciona uma fonte de propriedade do projeto. Não torna o arquivo original
o documento editável do seu projeto.

Exportações de áudio compactado e importações no navegador suportam até uma hora ou 1 GB
(1.000.000.000 bytes de arquivo), o limite que for atingido primeiro. A seleção de arquivos no desktop e a importação de áudio compactado não têm limite fixo de tamanho ou duração abaixo da faixa de inteiros seguros. Trabalhos longos leem, codificam e salvam em blocos; exportações grandes no navegador exigem armazenamento privado da origem e espaço livre suficiente. Importações grandes exigem armazenamento local suficiente para o áudio decodificado. A estrutura do formato, o suporte do decodificador e o espaço disponível também podem limitar uma importação.

A camada do navegador abrange MP3, MP2, FLAC, WavPack, Opus e Ogg Vorbis. O suporte AAC/M4A do navegador depende do codec do navegador. As exportações de streaming de desktop cobrem os seis formatos agrupados, com FLAC de 24 bits e WavPack sem perdas float32. As importações no desktop dependem da disponibilidade do decodificador; fontes MP2 grandes usam o decodificador por pacotes, enquanto fontes MP2 menores usam a camada de compatibilidade do utilitário.

Um trabalho ativo mostra uma barra de progresso mesmo quando **Visualizar → Barra de status** está oculto. Escolha **Cancelar** ao lado da barra para interromper uma importação ou exportação de áudio.

## Arquivos de projeto editáveis

- Scape (`.sscape` do Soundscaper, `.fscape` do Framescaper e qualquer um deles pode ser aberto em ambos) é o formato de projeto portátil de alta fidelidade compartilhado pelo Soundscaper
e Framescaper.
- AUP3 e AUP4 permitem intercâmbio de áudio com o Audacity. Escolha AUP3 para o perfil de projeto do Audacity 3.7.9 ou AUP4 para o perfil de intercâmbio atual. Nenhum dos dois é um backup completo de um projeto Soundscaper com mídia mista; confira o relatório de compatibilidade após a exportação.
- A edição de desktop pode abrir sessões Adobe Audition SESX (`.sesx`) para criar um projeto local a partir dos arquivos de áudio referenciados. Guarde a sessão e as mídias originais; não é possível exportar para SESX.

Consulte [Arquivos do projeto](/projects-and-data/project-files/) para as consequências
de cada escolha.

## Entregas renderizadas

As exportações de áudio criam arquivos destinados à escuta, publicação ou processamento adicional. As exportações de vídeo criam entregas MP4 ou WebM. Um arquivo renderizado não
retém a linha do tempo editável, roteamento, efeitos ou histórico do projeto.

Consulte a seção [referência](/reference/) para as tabelas de formato gerado e
capacidade do produto.
