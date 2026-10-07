---
title: "Arquivos do projeto"
description: "Escolha entre a biblioteca local, arquivos Scape, intercâmbio com o Audacity, importação SESX e backups renderizados."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","targetLocale":"pt-BR"} -->

## Biblioteca local do projeto

O editor salva os projetos em trabalho em sua biblioteca local. Em um navegador, isso é armazenamento privado de origem; na edição de desktop, é dado do aplicativo. Esta é a cópia de trabalho conveniente, não a única cópia que você deve manter.

## Arquivos de projeto Scape

Use **Arquivo → Exportar arquivo do projeto** para salvar o projeto de edição. Cada produto escreve seu próprio sufixo: o Soundscaper salva `.sscape` e o Framescaper salva `.fscape`, e a entrada do menu nomeia aquele que se aplica. O formato por trás de ambos é o mesmo, então é a escolha adequada quando você precisa preservar o estado de edição multimídia.

No desktop, o áudio e o vídeo importados permanecem como referências aos arquivos originais por padrão. Mantenha esses arquivos em seus locais originais ao reabrir o projeto. A biblioteca local também guarda caches de edição. Gravações e mídias geradas ou processadas são incluídas porque não têm um original externo inalterado.

Escolha **Arquivo → Gerenciamento do projeto → Consolidar mídias** para incluir as mídias referenciadas no arquivo do projeto. A consolidação salva o projeto imediatamente; escolha um destino na caixa de diálogo de salvamento. Depois de salvo, a cópia consolidada pode ser movida ou compartilhada sem os arquivos de mídia originais. Se alguma mídia não puder ser consolidada ou o salvamento falhar, o editor informa o problema.

As exportações do navegador incluem as mídias automaticamente. Antes de abrir no navegador um projeto desktop com referências externas, consolide-o no desktop.

Qualquer produto abre qualquer sufixo. `.sscape`, `.fscape`, o reservado `.liscape`, e os arquivos mais antigos `.scape` exportados antes de os produtos terem seus próprios sufixos abrem em todos os lugares, e salvar um de um produto diferente simplesmente o renomeia - por exemplo, um `Mix.sscape` salvo do Framescaper se torna `Mix.fscape`. Nada sobre o projeto muda com o nome.

Importar ou abrir uma cópia Scape pode encontrar um projeto existente com o mesmo ID. Use o fluxo de trabalho de cópia oferecido quando ambas as versões devem permanecer na biblioteca local.

## Audacity AUP3 e AUP4

A exportação de projetos do Audacity está disponível em **Arquivo → Exportar outros**. Escolha **Exportar AUP3** para o perfil de projeto do Audacity 3.7.9 ou **Exportar AUP4** para o perfil atual de intercâmbio do Audacity. Cada exportação gera um relatório de compatibilidade que descreve conversões, efeitos indisponíveis e estados exclusivos do Soundscaper que foram omitidos.

Ambos os formatos contêm apenas áudio. O vídeo é omitido, e as preferências do navegador, o histórico de desfazer, o roteamento do mixer e a biblioteca de projetos do navegador não são transferidos. Não use nenhum deles como único backup de um projeto Soundscaper ou Framescaper.

## Adobe Audition SESX

Na edição de desktop, use **Arquivo → Abrir** para importar uma sessão Adobe Audition `.sesx`. Mantenha os arquivos de áudio referenciados na estrutura de pastas relativa sob a pasta da sessão, ou escolha uma pasta de mídia quando solicitado. A importação cria um novo projeto local com faixas de áudio, clipes, posicionamento, cortes, fades simples e configurações estáticas do mixer compatíveis.

A importação SESX funciona em uma direção. Efeitos do Audition, automação, roteamento, vídeo, marcadores, loops, alongamento, crossfades vinculados e curvas exatas de fade não são transferidos. Abra **Arquivo → Relatório de entrega** após a importação para revisar mídias ausentes e outros conteúdos omitidos. Guarde o arquivo SESX e as mídias originais para continuar o trabalho no Audition.

## Backup renderizado

Para trabalhos importantes, mantenha ambos:

1. Uma cópia do projeto Scape (`.sscape` ou `.fscape`) para edição futura.
2. Um arquivo de áudio ou vídeo renderizado que pode ser reproduzido sem o editor.

Armazene esses arquivos fora do diretório do navegador ou dos dados do aplicativo.
