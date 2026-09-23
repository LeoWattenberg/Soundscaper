---
title: "Importação e exportação"
description: "Distinga ficheiros multimédia de origem, ficheiros de projeto, ficheiros de intercâmbio e entregas renderizadas."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","targetLocale":"pt-PT"} -->

O Soundscaper usa diferentes tipos de ficheiro para diferentes finalidades.

## Multimédia de origem

Use **Ficheiro → Importar** para áudio, vídeo e etiquetas. A indicação atual do
editor apresenta AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF e WebM; o
percurso de importação de vídeo também suporta outros contentores. A
disponibilidade pode depender do produto ativo e dos recursos de execução.

Ao importar multimédia, adiciona uma origem pertencente ao projeto. O ficheiro
original não passa a ser o documento de projeto editável.

As importações e exportações de áudio comprimido suportam até uma hora ou 1 GB
(1 000 000 000 bytes de ficheiro), consoante o limite atingido primeiro. Um
ficheiro estéreo de uma hora a 48 kHz é suportado se respeitar esse limite de
tamanho. Os trabalhos demorados leem, codificam e guardam em blocos; as grandes
exportações no navegador requerem armazenamento privado da origem e espaço
livre suficiente. As grandes importações requerem armazenamento local
persistente para o áudio descodificado. Os formatos PCM mantêm os seus limites
próprios.

A versão para navegador abrange MP3, MP2, FLAC, WavPack, Opus e Ogg Vorbis. O
suporte AAC/M4A no navegador depende do codec do navegador. As exportações em
streaming da aplicação para computador abrangem os seis formatos incluídos, com
FLAC de 24 bits e WavPack sem perdas em float32. As importações na aplicação
para computador dependem da disponibilidade de descodificadores nativos; o MP2
usa o nível de compatibilidade da ferramenta mais pequena. O AAC para
computador e os fornecedores de compatibilidade mantêm os seus próprios
limites.

Uma tarefa ativa mostra uma barra de progresso, mesmo quando **Ver → Barra de
estado** está oculta. Selecione **Cancelar** junto à barra para parar uma
importação ou exportação de áudio.

## Ficheiros de projeto editáveis

- Scape (`.sscape` do Soundscaper, `.fscape` do Framescaper; ambos podem ser abertos nos dois produtos) é o formato de projeto portátil e sem perda de qualidade partilhado pelo Soundscaper e pelo Framescaper.
- AUP4 é um formato de intercâmbio apenas de áudio com o Audacity. Não constitui uma cópia de segurança completa de um projeto do Soundscaper com vários tipos de multimédia.

Consulte [Ficheiros de projeto](/projects-and-data/project-files/) para conhecer
as consequências de cada opção.

## Entregas renderizadas

As exportações de áudio criam ficheiros destinados à audição, publicação ou
processamento posterior. As exportações de vídeo criam entregas MP4 ou WebM. Um
ficheiro renderizado não conserva a linha temporal editável, o encaminhamento,
os efeitos nem o histórico do projeto.

Consulte a [secção de referência](/reference/) para ver as tabelas geradas dos
formatos e das capacidades dos produtos.
