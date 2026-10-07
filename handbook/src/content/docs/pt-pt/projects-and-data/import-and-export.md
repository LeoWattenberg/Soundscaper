---
title: "Importação e exportação"
description: "Distinga ficheiros multimédia de origem, ficheiros de projeto, ficheiros de intercâmbio e entregas renderizadas."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"pt-PT"} -->

O Soundscaper usa diferentes tipos de ficheiro para diferentes finalidades.

## Multimédia de origem

Use **Ficheiro → Importar** para áudio, vídeo e etiquetas. A indicação atual do
editor apresenta AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF e WebM; o
percurso de importação de vídeo também suporta outros contentores. A
disponibilidade pode depender do produto ativo e dos recursos de execução.

Ao importar multimédia, adiciona uma origem pertencente ao projeto. O ficheiro
original não passa a ser o documento de projeto editável.

As exportações de áudio comprimido e as importações no navegador suportam até uma hora ou 1 GB
(1 000 000 000 bytes de ficheiro), consoante o limite atingido primeiro. A seleção de ficheiros na aplicação para computador e a importação de áudio comprimido não têm um limite fixo de tamanho ou duração abaixo do intervalo de inteiros seguros. Os trabalhos demorados leem, codificam e guardam em blocos; as grandes exportações no navegador requerem armazenamento privado da origem e espaço livre suficiente. As grandes importações requerem armazenamento local suficiente para o áudio descodificado. A estrutura do formato, o suporte do descodificador e o espaço disponível também podem limitar uma importação.

A versão para navegador abrange MP3, MP2, FLAC, WavPack, Opus e Ogg Vorbis. O
suporte AAC/M4A no navegador depende do codec do navegador. As exportações em
streaming da aplicação para computador abrangem os seis formatos incluídos, com
FLAC de 24 bits e WavPack sem perdas em float32. As importações na aplicação para computador dependem da disponibilidade dos descodificadores; as fontes MP2 grandes usam o descodificador por pacotes, enquanto as fontes MP2 mais pequenas usam o nível de compatibilidade da ferramenta.

Uma tarefa ativa mostra uma barra de progresso, mesmo quando **Ver → Barra de
estado** está oculta. Selecione **Cancelar** junto à barra para parar uma
importação ou exportação de áudio.

## Ficheiros de projeto editáveis

- Scape (`.sscape` do Soundscaper, `.fscape` do Framescaper; ambos podem ser abertos nos dois produtos) é o formato de projeto portátil e sem perda de qualidade partilhado pelo Soundscaper e pelo Framescaper.
- AUP3 e AUP4 permitem o intercâmbio de áudio com o Audacity. Escolha AUP3 para o perfil de projeto do Audacity 3.7.9 ou AUP4 para o perfil de intercâmbio atual. Nenhum dos formatos constitui uma cópia de segurança completa de um projeto Soundscaper com vários tipos de multimédia; consulte o relatório de compatibilidade após a exportação.
- A edição para computador pode abrir sessões Adobe Audition SESX (`.sesx`) para criar um projeto local a partir dos ficheiros de áudio referenciados. Guarde a sessão e os ficheiros multimédia originais; não é possível exportar para SESX.

Consulte [Ficheiros de projeto](/projects-and-data/project-files/) para conhecer
as consequências de cada opção.

## Entregas renderizadas

As exportações de áudio criam ficheiros destinados à audição, publicação ou
processamento posterior. As exportações de vídeo criam entregas MP4 ou WebM. Um
ficheiro renderizado não conserva a linha temporal editável, o encaminhamento,
os efeitos nem o histórico do projeto.

Consulte a [secção de referência](/reference/) para ver as tabelas geradas dos
formatos e das capacidades dos produtos.
